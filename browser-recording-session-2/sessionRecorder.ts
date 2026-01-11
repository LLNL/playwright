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

import type * as playwright from 'playwright';
import { frameSnapshotStreamer } from './snapshotterInjected';
import type { UserAction, Snapshot, RecordedAction, SessionData, ConsoleMessage, NetworkRequest } from './types';

export class BrowserSessionRecorder {
  private _page: playwright.Page | null = null;
  private _sessionData: SessionData;
  private _consoleLogs: ConsoleMessage[] = [];
  private _networkRequests: NetworkRequest[] = [];
  private _isRecording = false;
  private _actionQueue: Promise<void> = Promise.resolve();

  constructor(sessionId?: string) {
    this._sessionData = {
      sessionId: sessionId || `session-${Date.now()}`,
      startTime: Date.now(),
      actions: []
    };
  }

  async start(page: playwright.Page) {
    if (this._isRecording)
      throw new Error('Already recording');


    this._page = page;
    this._isRecording = true;

    // Inject snapshot capture script
    const snapshotScript = `(${frameSnapshotStreamer().toString()})()`;
    await page.addInitScript(snapshotScript);

    // Setup console listener (lightweight)
    page.on('console', msg => {
      this._consoleLogs.push({
        type: msg.type() as any,
        text: msg.text(),
        timestamp: Date.now()
      });

      // Keep only last 100 console messages to avoid memory issues
      if (this._consoleLogs.length > 100)
        this._consoleLogs.shift();

    });

    // Setup network listener (lightweight - just URL, method, status)
    page.on('request', request => {
      const startTime = Date.now();
      const requestData: NetworkRequest = {
        url: request.url(),
        method: request.method(),
        timestamp: startTime
      };

      request.response().then(response => {
        if (response) {
          requestData.status = response.status();
          requestData.duration = Date.now() - startTime;
        }
      }).catch(() => {
        // Ignore request failures
      });

      this._networkRequests.push(requestData);

      // Keep only last 50 requests
      if (this._networkRequests.length > 50)
        this._networkRequests.shift();

    });

    // Setup user action listeners
    await this._setupActionListeners();

    // eslint-disable-next-line no-console
    console.log(`📹 Browser session recording started: ${this._sessionData.sessionId}`);
  }

  private async _setupActionListeners() {
    if (!this._page)
      return;


    // Expose function for actions to call
    await this._page.exposeFunction('__recordUserAction', async (action: UserAction) => {
      // Queue actions to prevent race conditions
      this._actionQueue = this._actionQueue.then(() => this._captureAction(action));
    });

    // Inject action listener script into the page
    await this._page.evaluate(() => {
      // Helper to generate selector
      function generateSelector(element: Element): string {
        if (element.id)
          return `#${element.id}`;


        if (element.className && typeof element.className === 'string') {
          const classes = element.className.trim().split(/\s+/).filter(c => c && !c.startsWith('session-recorded'));
          if (classes.length > 0)
            return `${element.tagName.toLowerCase()}.${classes[0]}`;

        }

        // Fallback to tag name
        return element.tagName.toLowerCase();
      }

      // Listen for clicks (capture phase to get BEFORE state)
      document.addEventListener('click', async (e) => {
        const target = e.target as Element;
        (window as any).__recordUserAction({
          type: 'click',
          selector: generateSelector(target),
          timestamp: Date.now(),
          x: e.clientX,
          y: e.clientY
        });
      }, true); // Capture phase!

      // Listen for input
      document.addEventListener('input', async (e) => {
        const target = e.target as HTMLInputElement;
        (window as any).__recordUserAction({
          type: 'input',
          selector: generateSelector(target),
          value: target.value,
          timestamp: Date.now()
        });
      }, true);

      // Listen for keydown (for special keys)
      document.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
          const target = e.target as Element;
          (window as any).__recordUserAction({
            type: 'keydown',
            selector: generateSelector(target),
            key: e.key,
            timestamp: Date.now()
          });
        }
      }, true);

      // eslint-disable-next-line no-console
      console.log('✅ User action listeners installed');
    });
  }

  private async _captureAction(action: UserAction) {
    if (!this._page)
      return;


    const actionId = `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // eslint-disable-next-line no-console
    console.log(`📸 Capturing action: ${action.type} at ${action.selector}`);

    // 1. Capture BEFORE state
    const before = await this._captureSnapshot('before');

    // 2. Wait a tiny bit for the action to complete (it's already executed in browser)
    await this._page.waitForTimeout(50);

    // 3. Add highlight class to the element
    if (action.selector) {
      await this._page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (element)
          element.classList.add('session-recorded-element');

      }, action.selector).catch(() => {
        // Element might not exist anymore, that's ok
      });
    }

    // 4. Capture AFTER state (with highlighted element)
    const after = await this._captureSnapshot('after');

    // 5. Remove highlight class
    if (action.selector) {
      await this._page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (element)
          element.classList.remove('session-recorded-element');

      }, action.selector).catch(() => {
        // Element might not exist anymore, that's ok
      });
    }

    // 6. Get recent console logs and network requests
    const recentConsoleLogs = this._consoleLogs.filter(
      log => log.timestamp >= before.timestamp - 1000 // Last 1 second
    );

    const recentNetworkRequests = this._networkRequests.filter(
      req => req.timestamp >= before.timestamp - 1000 // Last 1 second
    );

    // 7. Store the recorded action
    const recordedAction: RecordedAction = {
      id: actionId,
      action,
      before,
      after,
      consoleLogs: recentConsoleLogs,
      networkRequests: recentNetworkRequests
    };

    this._sessionData.actions.push(recordedAction);

    // eslint-disable-next-line no-console
    console.log(`✅ Captured action #${this._sessionData.actions.length}: ${action.type}`);
  }

  private async _captureSnapshot(label: string): Promise<Snapshot> {
    if (!this._page)
      throw new Error('No page to capture');


    const timestamp = Date.now();

    // Capture HTML using our injected snapshot function
    const snapshotData = await this._page.evaluate(() => {
      return (window as any).__playwrightCaptureSnapshot();
    });

    // Capture screenshot
    const screenshotBuffer = await this._page.screenshot({
      fullPage: false // Just viewport for speed
    });
    const screenshot = screenshotBuffer.toString('base64');

    return {
      html: snapshotData.doctype + snapshotData.html,
      screenshot,
      timestamp,
      url: this._page.url(),
      title: await this._page.title()
    };
  }

  async stop() {
    if (!this._isRecording)
      return;


    // Wait for any pending actions to complete
    await this._actionQueue;

    this._sessionData.endTime = Date.now();
    this._isRecording = false;

    // eslint-disable-next-line no-console
    console.log(`🛑 Recording stopped. Captured ${this._sessionData.actions.length} actions.`);
  }

  getSessionData(): SessionData {
    return this._sessionData;
  }

  getSummary() {
    return {
      sessionId: this._sessionData.sessionId,
      duration: (this._sessionData.endTime || Date.now()) - this._sessionData.startTime,
      totalActions: this._sessionData.actions.length,
      actions: this._sessionData.actions.map(a => ({
        type: a.action.type,
        selector: a.action.selector,
        timestamp: a.action.timestamp,
        url: a.after.url,
        consoleCount: a.consoleLogs.length,
        networkCount: a.networkRequests.length
      }))
    };
  }
}
