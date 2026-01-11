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

export interface BrowserSessionData {
  sessionId: string;
  startTime: number;
  endTime: number;
  actions: SessionAction[];
}

export interface SessionAction {
  id: string;
  action: ActionMetadata;
  before: PageState;
  after: PageState;
  consoleLogs: ConsoleLogEntry[];
  networkRequests: NetworkRequestEntry[];
}

export interface ActionMetadata {
  type: 'click' | 'input' | 'keydown' | 'change' | 'focus' | 'navigate';
  selector?: string;
  timestamp: number;
  x?: number;
  y?: number;
  value?: string;
  key?: string;
}

export interface PageState {
  html: string;
  screenshot: string; // base64
  timestamp: number;
  url: string;
  title: string;
}

export interface ConsoleLogEntry {
  type: 'log' | 'error' | 'warn' | 'info' | 'debug';
  text: string;
  timestamp: number;
}

export interface NetworkRequestEntry {
  url: string;
  method: string;
  status: number;
  timestamp: number;
  duration: number;
}
