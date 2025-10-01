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

import * as fs from 'fs';
import * as path from 'path';
import { ActionData } from './enhancedTracing';

/**
 * Interface for enriched action data ready for RAG consumption
 */
export interface EnrichedActionData {
  /** Original action data from recording */
  raw_action: ActionData;
  
  /** Session metadata */
  session_id: string;
  session_timestamp: number;
  
  /** Enriched context for embeddings */
  visual_context: string;
  business_context: string;
  journey_context: string;
  dom_context: string;
  network_context: string;
  
  /** Combined context for embedding generation */
  embedding_text: string;
  
  /** Asset references */
  screenshot_path?: string;
  trace_segment_path: string;
  
  /** Business intelligence tags */
  business_tags: string[];
  ui_component_type: string;
  interaction_pattern: string;
}

/**
 * Interface for session data loaded from disk
 */
export interface SessionData {
  session_id: string;
  session_path: string;
  actions: ActionData[];
  trace_files: string[];
  screenshots: string[];
  network_logs?: any[];
  start_time: number;
  end_time: number;
  base_url?: string;
}

/**
 * Queue item for session processing
 */
export interface SessionQueueItem {
  session_path: string;
  priority: number;
  queued_at: number;
  retry_count: number;
}

/**
 * Background service for processing recorded browser sessions into RAG-ready data
 */
export class SessionProcessor {
  private queue: SessionQueueItem[] = [];
  private processing = false;
  private readonly maxRetries = 3;
  private readonly batchSize = 25;

  constructor(
    private readonly outputCallback?: (enrichedData: EnrichedActionData[]) => Promise<void>
  ) {}

  /**
   * Queue a session for processing
   */
  async queueSession(sessionPath: string, priority = 1): Promise<void> {
    const queueItem: SessionQueueItem = {
      session_path: sessionPath,
      priority,
      queued_at: Date.now(),
      retry_count: 0
    };

    // Insert based on priority (higher priority first)
    const insertIndex = this.queue.findIndex(item => item.priority < priority);
    if (insertIndex === -1) {
      this.queue.push(queueItem);
    } else {
      this.queue.splice(insertIndex, 0, queueItem);
    }

    console.log(`🔄 Queued session for processing: ${sessionPath} (priority: ${priority})`);
    
    // Start processing if not already running
    if (!this.processing) {
      this.processNext();
    }
  }

  /**
   * Process the next session in the queue
   */
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const queueItem = this.queue.shift()!;

    try {
      console.log(`🔍 Processing session: ${queueItem.session_path}`);
      await this.processSession(queueItem.session_path);
      console.log(`✅ Completed processing: ${queueItem.session_path}`);
    } catch (error) {
      console.error(`❌ Failed to process session: ${queueItem.session_path}`, error);
      
      // Retry logic
      if (queueItem.retry_count < this.maxRetries) {
        queueItem.retry_count++;
        queueItem.priority = Math.max(0, queueItem.priority - 1); // Lower priority on retry
        this.queue.push(queueItem);
        console.log(`🔄 Retrying session (attempt ${queueItem.retry_count}): ${queueItem.session_path}`);
      } else {
        console.error(`💀 Max retries exceeded for session: ${queueItem.session_path}`);
      }
    } finally {
      this.processing = false;
      
      // Process next item in queue
      if (this.queue.length > 0) {
        setTimeout(() => this.processNext(), 100);
      }
    }
  }

  /**
   * Process a single session
   */
  private async processSession(sessionPath: string): Promise<void> {
    // Load session data from disk
    const sessionData = await this.loadSessionData(sessionPath);
    
    if (sessionData.actions.length === 0) {
      console.log(`⚠️ No actions found in session: ${sessionPath}`);
      return;
    }

    console.log(`📊 Processing ${sessionData.actions.length} actions from session: ${sessionData.session_id}`);

    // Process actions in batches to control memory usage
    const enrichedBatches: EnrichedActionData[] = [];
    
    for (let i = 0; i < sessionData.actions.length; i += this.batchSize) {
      const batch = sessionData.actions.slice(i, i + this.batchSize);
      console.log(`🔄 Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(sessionData.actions.length / this.batchSize)}`);
      
      const enrichedBatch = await Promise.all(
        batch.map(action => this.enrichAction(action, sessionData))
      );
      
      enrichedBatches.push(...enrichedBatch);
      
      // Send to callback if provided (e.g., for OpenSearch indexing)
      if (this.outputCallback) {
        await this.outputCallback(enrichedBatch);
      }
    }

    console.log(`🎯 Enriched ${enrichedBatches.length} actions for session: ${sessionData.session_id}`);
  }

  /**
   * Load session data from a session directory
   */
  private async loadSessionData(sessionPath: string): Promise<SessionData> {
    const sessionId = path.basename(sessionPath);
    
    // Load action files (JSONL format)
    const actionsDir = path.join(sessionPath, 'actions');
    const actions: ActionData[] = [];
    
    if (fs.existsSync(actionsDir)) {
      const actionFiles = fs.readdirSync(actionsDir)
        .filter(file => file.endsWith('.jsonl'))
        .sort();
      
      for (const file of actionFiles) {
        const filePath = path.join(actionsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            actions.push(JSON.parse(line) as ActionData);
          } catch (error) {
            console.warn(`⚠️ Failed to parse action line: ${line}`);
          }
        }
      }
    }

    // Load trace files
    const tracesDir = path.join(sessionPath, 'traces');
    const traceFiles: string[] = [];
    
    if (fs.existsSync(tracesDir)) {
      traceFiles.push(...fs.readdirSync(tracesDir)
        .filter(file => file.endsWith('.zip'))
        .map(file => path.join(tracesDir, file)));
    }

    // Load screenshots
    const screenshotsDir = path.join(sessionPath, 'screenshots');
    const screenshots: string[] = [];
    
    if (fs.existsSync(screenshotsDir)) {
      screenshots.push(...fs.readdirSync(screenshotsDir)
        .filter(file => /\.(png|jpg|jpeg)$/i.test(file))
        .map(file => path.join(screenshotsDir, file)));
    }

    // Determine session timeframe
    const startTime = actions.length > 0 ? Math.min(...actions.map(a => a.timestamp)) : Date.now();
    const endTime = actions.length > 0 ? Math.max(...actions.map(a => a.timestamp)) : Date.now();

    return {
      session_id: sessionId,
      session_path: sessionPath,
      actions,
      trace_files: traceFiles,
      screenshots,
      start_time: startTime,
      end_time: endTime
    };
  }

  /**
   * Enrich a single action with context for RAG consumption
   */
  private async enrichAction(action: ActionData, session: SessionData): Promise<EnrichedActionData> {
    // Build context from existing data
    const visualContext = await this.buildVisualContext(action, session);
    const businessContext = this.buildBusinessContext(action, session);
    const journeyContext = this.buildJourneyContext(action, session);
    const domContext = this.buildDOMContext(action);
    const networkContext = this.buildNetworkContext(action, session);

    // Combine all contexts for embedding
    const embeddingText = [
      visualContext,
      businessContext,
      journeyContext,
      domContext,
      networkContext
    ].filter(Boolean).join(' | ');

    // Generate business tags
    const businessTags = this.generateBusinessTags(action, businessContext, journeyContext);
    
    // Determine UI component type
    const uiComponentType = this.determineUIComponentType(action);
    
    // Analyze interaction pattern
    const interactionPattern = this.analyzeInteractionPattern(action, session);

    return {
      raw_action: action,
      session_id: session.session_id,
      session_timestamp: session.start_time,
      visual_context: visualContext,
      business_context: businessContext,
      journey_context: journeyContext,
      dom_context: domContext,
      network_context: networkContext,
      embedding_text: embeddingText,
      screenshot_path: await this.findRelevantScreenshot(action, session),
      trace_segment_path: this.findRelevantTraceSegment(action, session),
      business_tags: businessTags,
      ui_component_type: uiComponentType,
      interaction_pattern: interactionPattern
    };
  }

  /**
   * Build visual context description from available data
   */
  private async buildVisualContext(action: ActionData, session: SessionData): Promise<string> {
    // For now, extract what we can from the selector and action type
    const selector = action.action.selector;
    const actionType = action.action.name;
    
    // Basic visual inference from selector
    let elementType = 'element';
    if (selector.includes('button')) elementType = 'button';
    else if (selector.includes('input')) elementType = 'input field';
    else if (selector.includes('a[')) elementType = 'link';
    else if (selector.includes('form')) elementType = 'form';
    
    // Infer visual properties from selector patterns
    let visualProperties = '';
    if (selector.includes('#')) visualProperties += 'identified element ';
    if (selector.includes('.')) visualProperties += 'styled element ';
    if (selector.includes('[type=')) {
      const typeMatch = selector.match(/\[type=['""]?([^'""\]]+)/);
      if (typeMatch) visualProperties += `${typeMatch[1]} type `;
    }

    return `${actionType} on ${visualProperties}${elementType}`.trim();
  }

  /**
   * Build business context from URL and action patterns
   */
  private buildBusinessContext(action: ActionData, session: SessionData): string {
    const actionName = action.action.name;
    const selector = action.action.selector;
    const url = action.action.url || session.base_url || '';
    
    // Infer business function from URL patterns
    let businessFunction = 'general_interaction';
    if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) {
      businessFunction = 'authentication';
    } else if (url.includes('/checkout') || url.includes('/payment') || url.includes('/cart')) {
      businessFunction = 'ecommerce_transaction';
    } else if (url.includes('/profile') || url.includes('/account') || url.includes('/settings')) {
      businessFunction = 'account_management';
    } else if (url.includes('/search') || url.includes('/browse') || url.includes('/catalog')) {
      businessFunction = 'content_discovery';
    }
    
    // Enhance with action-specific context
    let actionIntent = actionName;
    if (actionName === 'click' && selector.includes('submit')) {
      actionIntent = 'form_submission';
    } else if (actionName === 'fill' || actionName === 'type') {
      actionIntent = 'data_entry';
    } else if (actionName === 'navigate') {
      actionIntent = 'page_navigation';
    }
    
    return `${businessFunction} ${actionIntent}`;
  }

  /**
   * Build journey context from action sequence
   */
  private buildJourneyContext(action: ActionData, session: SessionData): string {
    // Find actions that happened before this one
    const actionIndex = session.actions.findIndex(a => 
      a.timestamp === action.timestamp && a.callId === action.callId
    );
    
    if (actionIndex === -1) return 'isolated_action';
    
    // Get previous actions (up to 5)
    const previousActions = session.actions
      .slice(Math.max(0, actionIndex - 5), actionIndex)
      .map(a => a.action.name);
    
    // Determine flow phase based on action sequence
    let flowPhase = 'middle_of_flow';
    if (actionIndex < 3) flowPhase = 'beginning_of_session';
    else if (actionIndex > session.actions.length - 3) flowPhase = 'end_of_session';
    
    // Build sequence description
    const sequenceDescription = previousActions.length > 0 
      ? `after ${previousActions.join(' → ')}`
      : 'session_start';
    
    return `${flowPhase} ${sequenceDescription}`;
  }

  /**
   * Build DOM context from selector information
   */
  private buildDOMContext(action: ActionData): string {
    const selector = action.action.selector;
    
    // Extract hierarchy information from selector
    let hierarchy = 'unknown_hierarchy';
    if (selector.includes('>')) {
      hierarchy = 'nested_element';
    } else if (selector.includes(' ')) {
      hierarchy = 'descendant_element';
    } else {
      hierarchy = 'direct_element';
    }
    
    // Extract semantic information
    let semanticRole = 'generic_element';
    if (selector.includes('nav')) semanticRole = 'navigation_element';
    else if (selector.includes('form')) semanticRole = 'form_element';
    else if (selector.includes('header')) semanticRole = 'header_element';
    else if (selector.includes('footer')) semanticRole = 'footer_element';
    else if (selector.includes('main')) semanticRole = 'main_content_element';
    
    return `${hierarchy} ${semanticRole}`;
  }

  /**
   * Build network context (placeholder for future enhancement)
   */
  private buildNetworkContext(action: ActionData, session: SessionData): string {
    // This would be enhanced to analyze network activity around the action timestamp
    // For now, return basic context based on action type
    const actionName = action.action.name;
    
    if (actionName === 'navigate') return 'page_load_network_activity';
    if (actionName === 'click' && action.action.selector.includes('submit')) return 'form_submission_network_activity';
    if (actionName === 'fill') return 'minimal_network_activity';
    
    return 'standard_network_activity';
  }

  /**
   * Generate business intelligence tags
   */
  private generateBusinessTags(action: ActionData, businessContext: string, journeyContext: string): string[] {
    const tags: string[] = [];
    
    // Add action type tag
    tags.push(action.action.name);
    
    // Add business function tags
    if (businessContext.includes('authentication')) tags.push('authentication', 'security');
    if (businessContext.includes('ecommerce')) tags.push('ecommerce', 'transaction');
    if (businessContext.includes('account')) tags.push('account_management', 'user_profile');
    if (businessContext.includes('discovery')) tags.push('search', 'browse', 'content');
    
    // Add interaction tags
    if (businessContext.includes('form_submission')) tags.push('form', 'submission');
    if (businessContext.includes('data_entry')) tags.push('input', 'data_entry');
    if (businessContext.includes('navigation')) tags.push('navigation', 'page_transition');
    
    // Add journey tags
    if (journeyContext.includes('beginning')) tags.push('session_start', 'initial_action');
    if (journeyContext.includes('end')) tags.push('session_end', 'final_action');
    
    return [...new Set(tags)]; // Remove duplicates
  }

  /**
   * Determine UI component type
   */
  private determineUIComponentType(action: ActionData): string {
    const selector = action.action.selector.toLowerCase();
    
    if (selector.includes('button')) return 'button';
    if (selector.includes('input[type="text"]') || selector.includes('input[type="email"]')) return 'text_input';
    if (selector.includes('input[type="password"]')) return 'password_input';
    if (selector.includes('input[type="submit"]')) return 'submit_button';
    if (selector.includes('select')) return 'dropdown';
    if (selector.includes('textarea')) return 'text_area';
    if (selector.includes('a[')) return 'link';
    if (selector.includes('form')) return 'form';
    if (selector.includes('nav')) return 'navigation';
    
    return 'generic_element';
  }

  /**
   * Analyze interaction pattern
   */
  private analyzeInteractionPattern(action: ActionData, session: SessionData): string {
    const actionIndex = session.actions.findIndex(a => 
      a.timestamp === action.timestamp && a.callId === action.callId
    );
    
    if (actionIndex === -1) return 'isolated';
    
    // Check for repeated actions
    const sameActionType = session.actions.filter(a => a.action.name === action.action.name);
    if (sameActionType.length > 3) return 'repeated_action_pattern';
    
    // Check for form filling pattern
    const recentActions = session.actions.slice(Math.max(0, actionIndex - 3), actionIndex + 1);
    const fillActions = recentActions.filter(a => a.action.name === 'fill' || a.action.name === 'type');
    if (fillActions.length >= 2) return 'form_filling_pattern';
    
    // Check for navigation pattern
    const navActions = recentActions.filter(a => a.action.name === 'navigate' || a.action.name === 'click');
    if (navActions.length >= 2) return 'navigation_pattern';
    
    return 'standard_interaction';
  }

  /**
   * Find relevant screenshot for this action
   */
  private async findRelevantScreenshot(action: ActionData, session: SessionData): Promise<string | undefined> {
    // For now, return the first screenshot found
    // This could be enhanced to find the screenshot closest to the action timestamp
    return session.screenshots[0];
  }

  /**
   * Find relevant trace segment for this action
   */
  private findRelevantTraceSegment(action: ActionData, session: SessionData): string {
    // For now, return the first trace file
    // This could be enhanced to find the trace segment containing this action
    return session.trace_files[0] || '';
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { length: number; processing: boolean; items: SessionQueueItem[] } {
    return {
      length: this.queue.length,
      processing: this.processing,
      items: [...this.queue]
    };
  }
}

/**
 * Global session processor instance
 */
export const globalSessionProcessor = new SessionProcessor();