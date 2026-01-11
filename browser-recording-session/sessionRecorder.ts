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

import type { Page } from 'playwright-core';
import type { ActionMetadata, BrowserSessionData, ConsoleLogEntry, NetworkRequestEntry, PageState, SessionAction } from './types';
import fs from 'fs';
import path from 'path';

const snapshotterInjectedJs = fs.readFileSync(path.join(__dirname, 'lib/snapshotterInjected.js'), 'utf8');

export class BrowserSessionRecorder {
  private _page: Page | null = null;
  private _data: BrowserSessionData;
  private _isRecording = false;
  private _actionQueue: (() => Promise<void>)[] = [];
  private _processingAction = false;
  private _consoleLogs: ConsoleLogEntry[] = [];
  private _networkRequests: { [requestId: string]: NetworkRequestEntry & { _startTime: number } } = {};

  constructor(public sessionId: string) {
    this._data = {
      sessionId,
      startTime: Date.now(),
      endTime: 0,
      actions: [],
    };
  }

  async start(page: Page) {
    if (this._isRecording)
      return;
    this._page = page;
    this._isRecording = true;
    this._data.startTime = Date.now();

    const reattach = async () => {
      await this._page!.exposeFunction('__playwright_onAction', (action: ActionMetadata) => this._onAction(action));
      await this._page!.evaluate(snapshotterInjectedJs);
      await this._page!.evaluate(this._recorderScript());
    };

    this._page.on('framenavigated', async (frame) => {
      if (frame === this._page!.mainFrame()) {
        await reattach();
      }
    });

    await reattach();

    this._page.on('console', msg => {
      if (this._consoleLogs.length >= 100)
        this._consoleLogs.shift();
      
      this._consoleLogs.push({
        type: msg.type() as any,
        text: msg.text(),
        timestamp: Date.now(),
      });
    });

    this._page.on('request', request => {
      this._networkRequests[request.resourceType() + request.url()] = {
        url: request.url(),
        method: request.method(),
        status: 0,
        timestamp: Date.now(),
        duration: 0,
        _startTime: performance.now(),
      };
    });

    this._page.on('response', response => {
      const request = this._networkRequests[response.request().resourceType() + response.request().url()];
      if (request) {
        request.status = response.status();
        request.duration = performance.now() - request._startTime;
      }
    });
  }

  async stop() {
    if (!this._isRecording || !this._page)
      return;

    this._isRecording = false;
    this._data.endTime = Date.now();
    // Safely stop recording in the page if the function is still available.
    // A navigation may have replaced the page context, so __playwright_stopRecording
    // might not exist anymore — in that case do nothing.
    try {
      await this._page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn = (window as any).__playwright_stopRecording;
        if (typeof fn === 'function')
          fn();
      });
    } catch (e) {
      // Ignore errors coming from missing function or navigation between frames.
    }
  }

  getSessionData(): BrowserSessionData {
    return this._data;
  }

  getSummary() {
    return {
      sessionId: this._data.sessionId,
      startTime: this._data.startTime,
      endTime: this._data.endTime,
      actions: this._data.actions.length,
      console: this._consoleLogs.length,
      network: Object.keys(this._networkRequests).length,
    };
  }

  private _onAction(action: ActionMetadata) {
    this._actionQueue.push(() => this._processAction(action));
    this._processQueue();
  }

  private async _processQueue() {
    if (this._processingAction || this._actionQueue.length === 0)
      return;

    this._processingAction = true;
    const actionTask = this._actionQueue.shift();
    if (actionTask)
      await actionTask();

    this._processingAction = false;
    this._processQueue();
  }

  private async _processAction(action: ActionMetadata) {
    if (!this._page)
      return;

    const beforeState = await this._capturePageState();

    // A small delay to ensure the action's effects are rendered before the next snapshot.
    await new Promise(r => setTimeout(r, 50));

    const afterState = await this._capturePageState();

    const sessionAction: SessionAction = {
      id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      action,
      before: beforeState,
      after: afterState,
      consoleLogs: [...this._consoleLogs],
      networkRequests: Object.values(this._networkRequests).map(r => {
        const { _startTime, ...rest } = r;
        return rest;
      }).slice(-50),
    };

    this._data.actions.push(sessionAction);
  }

  private async _capturePageState(): Promise<PageState> {
    if (!this._page)
      throw new Error('Page not available');
    const [html, screenshot, url, title] = await Promise.all([
      this._page.evaluate('window.__playwrightCaptureSnapshot()'),
      this._page.screenshot(),
      this._page.url(),
      this._page.title(),
    ]);
    return {
      html: html as string,
      screenshot: screenshot.toString('base64'),
      timestamp: Date.now(),
      url,
      title,
    };
  }

  private _recorderScript(): string {
    return `
      (() => {
        if (window.__playwright_recording_started) return;
        window.__playwright_recording_started = true;

        const handleEvent = (e) => {
          const target = e.target;
          if (!(target instanceof Element)) return;

          // For this simplified approach, we don't need a selector.
          // The action is recorded, and snapshots provide the context.
          const action = {
            type: e.type,
            timestamp: Date.now(),
          };

          if (e.type === 'click') {
            action.x = e.clientX;
            action.y = e.clientY;
          }
          if (e.type === 'input' || e.type === 'change') {
            action.value = target.value;
          }
          if (e.type === 'keydown') {
            action.key = e.key;
          }
          window.__playwright_onAction(action);
        };

        ['click', 'input', 'keydown', 'change', 'focus'].forEach(eventType => {
          document.addEventListener(eventType, handleEvent, { capture: true });
        });

        window.__playwright_stopRecording = () => {
          ['click', 'input', 'keydown', 'change', 'focus'].forEach(eventType => {
            document.removeEventListener(eventType, handleEvent, { capture: true });
          });
          delete window.__playwright_recording_started;
        };
      })();
    `;
  }
}
