/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { debug } from 'playwright-core/lib/utilsBundle';

import { logUnhandledError } from '../log';
import { Tab } from './tab';
import { outputFile  } from './config';
import * as codegen from './codegen';

import type * as playwright from '../../../types/test';
import type { FullConfig } from './config';
import type { Tool } from './tools/tool';
import type { BrowserContextFactory, ClientInfo } from './browserContextFactory';
import type * as actions from './actions';
import type { SessionLog } from './sessionLog';
import type { Tracing } from '../../../../playwright-core/src/client/tracing';
import type { ActionData, SessionSegment } from './enhancedTracing';

const testDebug = debug('pw:mcp:test');

type ContextOptions = {
  tools: Tool[];
  config: FullConfig;
  browserContextFactory: BrowserContextFactory;
  sessionLog: SessionLog | undefined;
  clientInfo: ClientInfo;
};

export class Context {
  readonly tools: Tool[];
  readonly config: FullConfig;
  readonly sessionLog: SessionLog | undefined;
  readonly options: ContextOptions;
  private _browserContextPromise: Promise<{ browserContext: playwright.BrowserContext, close: () => Promise<void> }> | undefined;
  private _browserContextFactory: BrowserContextFactory;
  private _tabs: Tab[] = [];
  private _currentTab: Tab | undefined;
  private _clientInfo: ClientInfo;

  private static _allContexts: Set<Context> = new Set();
  private _closeBrowserContextPromise: Promise<void> | undefined;
  private _runningToolName: string | undefined;
  private _abortController = new AbortController();

  // Enhanced tracing session management properties
  private _sessionSegmentManager: SessionSegmentManager | undefined;
  private _userSessionActive: boolean = false;
  private _enhancedTracingEnabled: boolean = false;

  constructor(options: ContextOptions) {
    this.tools = options.tools;
    this.config = options.config;
    this.sessionLog = options.sessionLog;
    this.options = options;
    this._browserContextFactory = options.browserContextFactory;
    this._clientInfo = options.clientInfo;
    testDebug('create context');
    Context._allContexts.add(this);
  }

  static async disposeAll() {
    await Promise.all([...Context._allContexts].map(context => context.dispose()));
  }

  tabs(): Tab[] {
    return this._tabs;
  }

  currentTab(): Tab | undefined {
    return this._currentTab;
  }

  currentTabOrDie(): Tab {
    if (!this._currentTab)
      throw new Error('No open pages available. Use the "browser_navigate" tool to navigate to a page first.');
    return this._currentTab;
  }

  async newTab(): Promise<Tab> {
    const { browserContext } = await this._ensureBrowserContext();
    const page = await browserContext.newPage();
    this._currentTab = this._tabs.find(t => t.page === page)!;
    return this._currentTab;
  }

  async selectTab(index: number) {
    const tab = this._tabs[index];
    if (!tab)
      throw new Error(`Tab ${index} not found`);
    await tab.page.bringToFront();
    this._currentTab = tab;
    return tab;
  }

  async ensureTab(): Promise<Tab> {
    const { browserContext } = await this._ensureBrowserContext();
    if (!this._currentTab)
      await browserContext.newPage();
    return this._currentTab!;
  }

  async closeTab(index: number | undefined): Promise<string> {
    const tab = index === undefined ? this._currentTab : this._tabs[index];
    if (!tab)
      throw new Error(`Tab ${index} not found`);
    const url = tab.page.url();
    await tab.page.close();
    return url;
  }

  async outputFile(name: string): Promise<string> {
    return outputFile(this.config, this._clientInfo.rootPath, name);
  }

  private _onPageCreated(page: playwright.Page) {
    const tab = new Tab(this, page, tab => this._onPageClosed(tab));
    this._tabs.push(tab);
    if (!this._currentTab)
      this._currentTab = tab;
  }

  private _onPageClosed(tab: Tab) {
    const index = this._tabs.indexOf(tab);
    if (index === -1)
      return;
    this._tabs.splice(index, 1);

    if (this._currentTab === tab)
      this._currentTab = this._tabs[Math.min(index, this._tabs.length - 1)];
    if (!this._tabs.length)
      void this.closeBrowserContext();
  }

  async closeBrowserContext() {
    if (!this._closeBrowserContextPromise)
      this._closeBrowserContextPromise = this._closeBrowserContextImpl().catch(logUnhandledError);
    await this._closeBrowserContextPromise;
    this._closeBrowserContextPromise = undefined;
  }

  isRunningTool() {
    return this._runningToolName !== undefined;
  }

  setRunningTool(name: string | undefined) {
    this._runningToolName = name;
  }

  private async _closeBrowserContextImpl() {
    if (!this._browserContextPromise)
      return;

    testDebug('close context');

    const promise = this._browserContextPromise;
    this._browserContextPromise = undefined;

    await promise.then(async ({ browserContext, close }) => {
      if (this.config.saveTrace)
        await browserContext.tracing.stop();
      await close();
    });
  }

  async dispose() {
    this._abortController.abort('MCP context disposed');
    await this.closeBrowserContext();
    Context._allContexts.delete(this);
  }

  private async _setupRequestInterception(context: playwright.BrowserContext) {
    if (this.config.network?.allowedOrigins?.length) {
      await context.route('**', route => route.abort('blockedbyclient'));

      for (const origin of this.config.network.allowedOrigins)
        await context.route(`*://${origin}/**`, route => route.continue());
    }

    if (this.config.network?.blockedOrigins?.length) {
      for (const origin of this.config.network.blockedOrigins)
        await context.route(`*://${origin}/**`, route => route.abort('blockedbyclient'));
    }
  }

  async ensureBrowserContext(): Promise<playwright.BrowserContext> {
    const { browserContext } = await this._ensureBrowserContext();
    return browserContext;
  }

  private _ensureBrowserContext() {
    if (!this._browserContextPromise) {
      this._browserContextPromise = this._setupBrowserContext();
      this._browserContextPromise.catch(() => {
        this._browserContextPromise = undefined;
      });
    }
    return this._browserContextPromise;
  }

  private async _setupBrowserContext(): Promise<{ browserContext: playwright.BrowserContext, close: () => Promise<void> }> {
    if (this._closeBrowserContextPromise)
      throw new Error('Another browser context is being closed.');
    // TODO: move to the browser context factory to make it based on isolation mode.
    const result = await this._browserContextFactory.createContext(this._clientInfo, this._abortController.signal, this._runningToolName);
    const { browserContext } = result;
    await this._setupRequestInterception(browserContext);
    if (this.sessionLog) {
      console.log('🎯 Creating InputRecorder - sessionLog exists');
      await InputRecorder.create(this, browserContext);
    } else {
      console.log('❌ No sessionLog - InputRecorder not created');
    }
    for (const page of browserContext.pages())
      this._onPageCreated(page);
    browserContext.on('page', page => this._onPageCreated(page));
    if (this.config.saveTrace) {
      await (browserContext.tracing as Tracing).start({
        name: 'trace-' + Date.now(),
        screenshots: true,
        snapshots: true,
        _live: true,
      });
    }
    return result;
  }

  // Enhanced tracing session management methods
  
  /**
   * Initialize session segment manager for enhanced tracing
   */
  async initializeSessionSegmentManager(sessionDir: string, maxActionsPerSegment: number): Promise<void> {
    this._sessionSegmentManager = new SessionSegmentManager(sessionDir, maxActionsPerSegment);
    await this._sessionSegmentManager.initialize();
    this._enhancedTracingEnabled = true;
  }

  /**
   * Set user session active state
   */
  setUserSessionActive(active: boolean): void {
    this._userSessionActive = active;
  }

  /**
   * Check if user session is active
   */
  isUserSessionActive(): boolean {
    return this._userSessionActive;
  }

  /**
   * Get the session segment manager
   */
  getSessionSegmentManager(): SessionSegmentManager | undefined {
    return this._sessionSegmentManager;
  }

  /**
   * Get the session directory path
   */
  getSessionPath(): string | undefined {
    return this._sessionSegmentManager?.getSessionDir();
  }

  /**
   * Check if enhanced tracing is enabled
   */
  isEnhancedTracingEnabled(): boolean {
    return this._enhancedTracingEnabled;
  }

  /**
   * Set enhanced tracing enabled state
   */
  setEnhancedTracingEnabled(enabled: boolean): void {
    this._enhancedTracingEnabled = enabled;
  }

  /**
   * Flush any pending actions from input recorder
   */
  async flushInputRecorder(): Promise<void> {
    // Force any pending recorder actions to be processed
    // This ensures all actions are captured before session finalization
    if (this._sessionSegmentManager) {
      await this._sessionSegmentManager.flushPendingActions();
    }
  }

  /**
   * Finalize session and return enhanced trace files
   */
  async finalizeSession(): Promise<string[]> {
    if (this._sessionSegmentManager) {
      const browserContext = await this._getBrowserContextForTracing();
      const traceFiles = await this._sessionSegmentManager.finalize(browserContext);
      this._sessionSegmentManager = undefined;
      return traceFiles;
    }
    this._userSessionActive = false;
    this._enhancedTracingEnabled = false;
    return [];
  }

  /**
   * Get browser context for tracing operations
   */
  async _getBrowserContextForTracing(): Promise<playwright.BrowserContext> {
    return await this.ensureBrowserContext();
  }

  lookupSecret(secretName: string): { value: string, code: string } {
    if (!this.config.secrets?.[secretName])
      return { value: secretName, code: codegen.quote(secretName) };
    return {
      value: this.config.secrets[secretName]!,
      code: `process.env['${secretName}']`,
    };
  }
}

/**
 * Handles writing action data to JSONL files with atomic operations
 */
export class ActionFileWriter {
  private _filePath: string;
  private _fileHandle: any = null;

  constructor(filePath: string) {
    this._filePath = filePath;
  }

  /**
   * Open the file for writing, creating directories as needed
   */
  async open(): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    
    // Create directory if it doesn't exist
    const dir = path.dirname(this._filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    
    // Open file for appending
    this._fileHandle = await fs.promises.open(this._filePath, 'a');
  }

  /**
   * Append action data to the JSONL file
   */
  async append(actionData: ActionData): Promise<void> {
    if (!this._fileHandle) {
      throw new Error('ActionFileWriter not opened');
    }
    
    const jsonLine = JSON.stringify(actionData) + '\n';
    await this._fileHandle.write(jsonLine);
    await this._fileHandle.sync(); // Ensure data is written to disk
  }

  /**
   * Close the file handle
   */
  async close(): Promise<void> {
    if (this._fileHandle) {
      await this._fileHandle.close();
      this._fileHandle = null;
    }
  }
}

/**
 * Manages session segments for enhanced tracing with automatic rotation
 */
export class SessionSegmentManager {
  private _sessionDir: string;
  private _maxActionsPerSegment: number;
  private _currentSegment: SessionSegment | null = null;
  private _actionFileWriter: ActionFileWriter | null = null;
  private _segments: SessionSegment[] = [];

  constructor(sessionDir: string, maxActionsPerSegment: number) {
    this._sessionDir = sessionDir;
    this._maxActionsPerSegment = maxActionsPerSegment;
  }

  /**
   * Initialize the first segment
   */
  async initialize(): Promise<void> {
    await this._createNewSegment();
  }

  /**
   * Get the session directory path
   */
  getSessionDir(): string {
    return this._sessionDir;
  }

  /**
   * Record an action and handle segment rotation if needed
   */
  async recordAction(actionData: ActionData): Promise<void> {
    if (!this._currentSegment || !this._actionFileWriter) {
      throw new Error('SessionSegmentManager not initialized');
    }

    await this._actionFileWriter.append(actionData);
    this._currentSegment.actionCount++;

    if (this.shouldRotate()) {
      await this.rotateSegment();
    }
  }

  /**
   * Check if segment should rotate based on action count
   */
  shouldRotate(): boolean {
    return this._currentSegment !== null && 
           this._currentSegment.actionCount >= this._maxActionsPerSegment;
  }

  /**
   * Rotate to a new segment
   */
  async rotateSegment(): Promise<void> {
    if (this._actionFileWriter) {
      await this._actionFileWriter.close();
    }
    await this._createNewSegment();
  }

  /**
   * Flush any pending actions to ensure they're written to disk
   */
  async flushPendingActions(): Promise<void> {
    // Force any pending action file writes to complete
    if (this._actionFileWriter && this._actionFileWriter._fileHandle) {
      await this._actionFileWriter._fileHandle.sync();
    }
  }

  /**
   * Get total action count across all segments for debugging
   */
  getActionCount(): number {
    let totalActions = 0;
    for (const segment of this._segments) {
      totalActions += segment.actionCount;
    }
    return totalActions;
  }

  /**
   * Finalize the session, process traces, and return enhanced trace file paths
   */
  async finalize(browserContext?: playwright.BrowserContext): Promise<string[]> {
    const enhancedTraceFiles: string[] = [];
    
    try {
      // Close current action file
      if (this._actionFileWriter) {
        await this._actionFileWriter.close();
        this._actionFileWriter = null;
      }
      
      // Stop tracing and process each segment
      for (const segment of this._segments) {
        if (browserContext) {
          // Stop tracing for this segment and save to the segment's trace file
          try {
            await browserContext.tracing.stopChunk({ path: segment.traceFile });
            
            // Post-process the trace file with enhanced action names
            const enhancedTraceFile = await this._postProcessTraceWithActions(
              segment.traceFile, 
              segment.actionFile
            );
            
            if (enhancedTraceFile) {
              enhancedTraceFiles.push(enhancedTraceFile);
            } else {
              // Fallback to original trace file if post-processing fails
              enhancedTraceFiles.push(segment.traceFile);
            }
          } catch (error) {
            console.error(`Failed to process segment ${segment.number}:`, error);
            // Include original trace file even if processing fails
            enhancedTraceFiles.push(segment.traceFile);
          }
        }
      }
      
    } catch (error) {
      console.error('Error during session finalization:', error);
    }
    
    return enhancedTraceFiles;
  }

  /**
   * Post-process trace file by replacing "Bounding box" with intelligent action names
   */
  private async _postProcessTraceWithActions(
    traceFilePath: string, 
    actionFilePath: string
  ): Promise<string | null> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const AdmZip = await import('adm-zip');
      
      // Check if files exist
      if (!await fs.promises.access(traceFilePath).then(() => true).catch(() => false) ||
          !await fs.promises.access(actionFilePath).then(() => true).catch(() => false)) {
        console.warn(`Missing files for post-processing: ${traceFilePath} or ${actionFilePath}`);
        return null;
      }
      
      // Read action data from JSONL file
      const actionData = await fs.promises.readFile(actionFilePath, 'utf-8');
      const actions = actionData.trim().split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line) as ActionData;
          } catch {
            return null;
          }
        })
        .filter(action => action !== null) as ActionData[];
      
      if (actions.length === 0) {
        console.warn('No valid actions found in JSONL file');
        return traceFilePath; // Return original if no actions to process
      }
      
      // Extract and process trace.zip
      const zip = new (AdmZip.default || AdmZip)(traceFilePath);
      const traceEntry = zip.getEntry('trace.trace');
      
      if (!traceEntry) {
        console.warn('No trace.trace found in ZIP file');
        return traceFilePath;
      }
      
      // Parse trace events
      const traceContent = traceEntry.getData().toString('utf8');
      const traceLines = traceContent.split('\n').filter(line => line.trim());
      const enhancedLines: string[] = [];
      
      // Process each trace event line
      for (const line of traceLines) {
        try {
          const event = JSON.parse(line);
          
          let wasEnhanced = false;
          
          // Look for "Bounding box" events to replace (correct Playwright trace format)
          if (event.type === 'before' && event.title === 'Bounding box') {
            
            // Find matching action from JSONL data by timestamp proximity
            const eventTime = event.wallTime || event.startTime || 0;
            const matchingAction = this._findMatchingAction(actions, eventTime, event);
            
            if (matchingAction) {
              // Replace with intelligent action name
              const enhancedName = this._generateIntelligentActionName(matchingAction);
              event.title = enhancedName;
              wasEnhanced = true;
              
              // Add additional context if available
              if (matchingAction.action.selector && event.params) {
                event.params.selector = matchingAction.action.selector;
              }
            }
          }
          
          // Look for action-type events (fallback for different trace formats)
          else if (event.type === 'action' && 
              event.action && 
              (event.action.name === 'Bounding box' || event.action.name?.includes('Bounding box'))) {
            
            const eventTime = event.timestamp || event.time || 0;
            const matchingAction = this._findMatchingAction(actions, eventTime, event);
            
            if (matchingAction) {
              const enhancedName = this._generateIntelligentActionName(matchingAction);
              event.action.name = enhancedName;
              wasEnhanced = true;
              
              if (matchingAction.action.selector) {
                event.action.selector = matchingAction.action.selector;
              }
            }
          }
          
          // ENHANCED APPROACH: Also look for any trace events that match our recorded actions
          // This works even if Playwright doesn't generate "Bounding box" entries
          else if (!wasEnhanced) {
            const eventTime = event.wallTime || event.startTime || event.timestamp || event.time || 0;
            const matchingAction = this._findMatchingAction(actions, eventTime, event);
            
            if (matchingAction) {
              // Enhance various event types that might correspond to user actions
              if (event.type === 'before' && event.title) {
                const enhancedName = this._generateIntelligentActionName(matchingAction);
                event.title = enhancedName;
                wasEnhanced = true;
              }
              else if (event.type === 'action' && event.action?.name) {
                const enhancedName = this._generateIntelligentActionName(matchingAction);
                event.action.name = enhancedName;
                wasEnhanced = true;
              }
              
              // Add selector context if available and event supports it
              if (matchingAction.action.selector) {
                if (event.params && !event.params.selector) {
                  event.params.selector = matchingAction.action.selector;
                }
                else if (event.action && !event.action.selector) {
                  event.action.selector = matchingAction.action.selector;
                }
              }
            }
          }
          
          enhancedLines.push(JSON.stringify(event));
        } catch (parseError) {
          // Keep original line if parsing fails
          enhancedLines.push(line);
        }
      }
      
      // Create enhanced trace file
      const enhancedTraceContent = enhancedLines.join('\n');
      const enhancedZip = new (AdmZip.default || AdmZip)();
      
      // Copy all original entries
      for (const entry of zip.getEntries()) {
        if (entry.entryName === 'trace.trace') {
          enhancedZip.addFile('trace.trace', Buffer.from(enhancedTraceContent, 'utf8'));
        } else {
          enhancedZip.addFile(entry.entryName, entry.getData());
        }
      }
      
      // Generate enhanced trace file path
      const dir = path.dirname(traceFilePath);
      const name = path.basename(traceFilePath, '.zip');
      const enhancedPath = path.join(dir, `enhanced-${name}.zip`);
      
      // Write enhanced trace file
      enhancedZip.writeZip(enhancedPath);
      
      console.log(`Enhanced trace created: ${enhancedPath} (${actions.length} actions processed)`);
      return enhancedPath;
      
    } catch (error) {
      console.error('Failed to post-process trace file:', error);
      return null;
    }
  }

  /**
   * Find matching action from JSONL data based on timestamp and context
   */
  private _findMatchingAction(actions: ActionData[], eventTime: number, event: any): ActionData | null {
    // Try to find action within reasonable time window (±2 seconds)
    const timeWindow = 2000;
    const candidates = actions.filter(action => 
      Math.abs(action.timestamp - eventTime) <= timeWindow
    );
    
    if (candidates.length === 0) {
      return null;
    }
    
    // If multiple candidates, prefer the closest in time
    return candidates.reduce((closest, current) => 
      Math.abs(current.timestamp - eventTime) < Math.abs(closest.timestamp - eventTime) 
        ? current : closest
    );
  }

  /**
   * Generate intelligent action name based on action data
   */
  private _generateIntelligentActionName(actionData: ActionData): string {
    const action = actionData.action;
    
    switch (action.name?.toLowerCase()) {
      case 'click':
        return `Click ${this._getElementDescription(action.selector)}`;
      
      case 'fill':
      case 'type':
        const content = action.text ? ` "${action.text}"` : '';
        return `Type${content} in ${this._getElementDescription(action.selector)}`;
      
      case 'press':
        return `Press ${action.key || 'Key'}`;
      
      case 'navigate':
        return `Navigate to ${action.url || 'Page'}`;
      
      case 'check':
        return `Check ${this._getElementDescription(action.selector)}`;
      
      case 'uncheck':
        return `Uncheck ${this._getElementDescription(action.selector)}`;
      
      case 'select':
        return `Select ${this._getElementDescription(action.selector)}`;
      
      case 'hover':
        return `Hover ${this._getElementDescription(action.selector)}`;
      
      case 'scroll':
        return `Scroll ${this._getElementDescription(action.selector)}`;
      
      default:
        return `${action.name || 'Action'} ${this._getElementDescription(action.selector)}`;
    }
  }

  /**
   * Generate human-readable element description from selector
   */
  private _getElementDescription(selector?: string): string {
    if (!selector) return 'Element';
    
    // Extract meaningful parts from selector
    if (selector.includes('[data-testid=')) {
      const testId = selector.match(/\[data-testid=['"]([^'"]+)['"]\]/)?.[1];
      if (testId) {
        return testId.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }
    }
    
    if (selector.includes('button')) return 'Button';
    if (selector.includes('input[type="email"]')) return 'Email Field';
    if (selector.includes('input[type="password"]')) return 'Password Field';
    if (selector.includes('input[type="text"]')) return 'Text Field';
    if (selector.includes('input[type="submit"]')) return 'Submit Button';
    if (selector.includes('textarea')) return 'Text Area';
    if (selector.includes('select')) return 'Dropdown';
    if (selector.includes('checkbox')) return 'Checkbox';
    if (selector.includes('radio')) return 'Radio Button';
    if (selector.includes('a')) return 'Link';
    if (selector.includes('form')) return 'Form';
    
    // Try to extract ID or class for description
    const idMatch = selector.match(/#([^.\s\[]+)/);
    if (idMatch) {
      return idMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    
    const classMatch = selector.match(/\.([^#.\s\[]+)/);
    if (classMatch) {
      return classMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    
    // Generic element type
    const tagMatch = selector.match(/^([a-zA-Z]+)/);
    if (tagMatch) {
      return tagMatch[1].charAt(0).toUpperCase() + tagMatch[1].slice(1);
    }
    
    return 'Element';
  }

  /**
   * Get all segments created during the session
   */
  getSegments(): SessionSegment[] {
    return [...this._segments];
  }

  /**
   * Get the current segment
   */
  getCurrentSegment(): SessionSegment | null {
    return this._currentSegment;
  }

  /**
   * Create a new segment with zero-padded numbering
   */
  private async _createNewSegment(): Promise<void> {
    const segmentNumber = this._segments.length + 1;
    const paddedNumber = segmentNumber.toString().padStart(3, '0');
    
    const traceFile = `${this._sessionDir}/traces/trace-${paddedNumber}.zip`;
    const actionFile = `${this._sessionDir}/actions/actions-${paddedNumber}.jsonl`;

    this._currentSegment = {
      number: segmentNumber,
      traceFile,
      actionFile,
      actionCount: 0,
    };

    this._segments.push(this._currentSegment);
    this._actionFileWriter = new ActionFileWriter(actionFile);
    await this._actionFileWriter.open();
  }
}

export class InputRecorder {
  private _context: Context;
  private _browserContext: playwright.BrowserContext;

  private constructor(context: Context, browserContext: playwright.BrowserContext) {
    this._context = context;
    this._browserContext = browserContext;
  }

  static async create(context: Context, browserContext: playwright.BrowserContext) {
    const recorder = new InputRecorder(context, browserContext);
    await recorder._initialize();
    return recorder;
  }

  private async _initialize() {
    console.log('🎯 InputRecorder initializing...');
    const sessionLog = this._context.sessionLog!;
    await (this._browserContext as any)._enableRecorder({
      mode: 'recording',
      recorderMode: 'api',
    }, {
      actionAdded: async (page: playwright.Page, data: actions.ActionInContext, code: string) => {
        console.log(`🎯 ActionAdded callback triggered: ${data.action.name}`);
        
        if (this._context.isRunningTool()) {
          console.log(`❌ Skipping action - tool is running`);
          return;
        }
        console.log(`✅ Tool not running, proceeding with action`);
        
        const tab = Tab.forPage(page);
        if (tab) {
          console.log(`✅ Found tab for page, logging action`);
          sessionLog.logUserAction(data.action, tab, code, false);
          
          // Also record in enhanced tracing system if active
          if (this._context.isUserSessionActive() && this._context.isEnhancedTracingEnabled()) {
            console.log(`✅ Enhanced tracing active, checking session manager`);
            const sessionManager = this._context.getSessionSegmentManager();
            if (sessionManager) {
              console.log(`✅ Session manager found, recording action: ${data.action.name}`);
              
              // Generate "Bounding box" trace entry for this user action
              await this._generateBoundingBoxTraceEntry(page, data);
              
              const actionData: ActionData = {
                timestamp: performance.now(),
                callId: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                action: {
                  name: data.action.name,
                  selector: (data.action as any).selector || '',
                  text: (data.action as any).text,
                  key: (data.action as any).key,
                  url: (data.action as any).url
                }
              };
              
              sessionManager.recordAction(actionData).catch(error => {
                console.error('Failed to record action in session manager:', error);
              });
            } else {
              console.log(`❌ No session manager found`);
            }
          } else {
            console.log(`❌ Enhanced tracing not active: userSession=${this._context.isUserSessionActive()}, enhanced=${this._context.isEnhancedTracingEnabled()}`);
          }
        } else {
          console.log(`❌ No tab found for page`);
        }
      },
      actionUpdated: (page: playwright.Page, data: actions.ActionInContext, code: string) => {
        if (this._context.isRunningTool())
          return;
        const tab = Tab.forPage(page);
        if (tab)
          sessionLog.logUserAction(data.action, tab, code, true);
      },
      signalAdded: (page: playwright.Page, data: actions.SignalInContext) => {
        if (this._context.isRunningTool())
          return;
        if (data.signal.name !== 'navigation')
          return;
        const tab = Tab.forPage(page);
        const navigateAction: actions.Action = {
          name: 'navigate',
          url: data.signal.url,
          signals: [],
        };
        if (tab)
          sessionLog.logUserAction(navigateAction, tab, `await page.goto('${data.signal.url}');`, false);
      },
    });
  }

  /**
   * Trigger Playwright's bounding box trace generation for user actions
   * This causes Playwright to automatically add "Bounding box" entries to the trace
   */
  private async _generateBoundingBoxTraceEntry(page: playwright.Page, data: actions.ActionInContext) {
    try {
      const selector = (data.action as any).selector;
      if (selector) {
        // Get the element that was interacted with and call boundingBox()
        // This triggers Playwright's internal trace generation for bounding box
        const element = await page.locator(selector).first();
        await element.boundingBox().catch(() => null);
        
        // The boundingBox() call above automatically adds a "Bounding box" entry 
        // to Playwright's trace, which our post-processing can then enhance
      }
    } catch (error) {
      // Don't let bounding box generation errors break the recording
      console.warn('Failed to trigger bounding box trace entry:', error);
    }
  }

}
