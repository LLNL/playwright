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

/**
 * Interface for storing action data in JSONL format for enhanced tracing
 */
export interface ActionData {
  /** Timestamp when the action was performed */
  timestamp: number;
  /** Unique identifier for the action call */
  callId: string;
  /** Action details for intelligent naming */
  action: {
    /** Action type (click, fill, navigate, press, etc.) */
    name: string;
    /** CSS selector for the target element */
    selector: string;
    /** Text content for fill/type actions */
    text?: string;
    /** Key name for press actions */
    key?: string;
    /** URL for navigation actions */
    url?: string;
  };
}

/**
 * Interface for managing trace segments during session recording
 */
export interface SessionSegment {
  /** Segment number (1-based) */
  number: number;
  /** Path to the trace file for this segment */
  traceFile: string;
  /** Path to the JSONL action file for this segment */
  actionFile: string;
  /** Number of actions recorded in this segment */
  actionCount: number;
}

/**
 * Enhanced tracing parameters for browser_start_tracing tool
 */
export interface EnhancedTracingParams {
  /** Enable intelligent human action recording */
  userActions?: boolean;
  /** Maximum actions per trace segment (default: 120) */
  maxActionsPerSegment?: number;
}