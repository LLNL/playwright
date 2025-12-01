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

import path from 'path';
import { z } from '../../sdk/bundle';
import { defineTool } from './tool';

import type { Tracing } from '../../../../../playwright-core/src/client/tracing';
import type { EnhancedTracingParams } from '../enhancedTracing';

const tracingStart = defineTool({
  capability: 'tracing',

  schema: {
    name: 'browser_start_tracing',
    title: 'Start tracing',
    description: 'Start trace recording. Captures all browser interactions including human actions when enhanced tracing is enabled.',
    inputSchema: z.object({
      userActions: z.boolean().default(false).describe('Enable intelligent human action recording with custom action names'),
      maxActionsPerSegment: z.number().default(120).describe('Maximum actions per trace segment for performance optimization'),
    }),
    type: 'readOnly',
  },

  handle: async (context, params, response) => {
    const typedParams = params as EnhancedTracingParams;
    const browserContext = await context.ensureBrowserContext();
    const tracesDir = await context.outputFile(`traces`, { origin: 'code', reason: 'Collecting trace' });
    const name = 'trace-' + Date.now();

    // Use CLI config as defaults for enhanced tracing
    const userActions = typedParams.userActions ?? context.config.enhancedTracing ?? false;
    const maxActionsPerSegment = typedParams.maxActionsPerSegment ?? context.config.maxActionsPerSegment ?? 120;

    // Initialize enhanced tracing if requested
    if (userActions) {
      try {
        // Create session directory with enhanced structure
        const sessionDir = path.join(tracesDir, `session-${Date.now()}`);
        await context.initializeSessionSegmentManager(sessionDir, maxActionsPerSegment);

        // Enable user session state
        context.setUserSessionActive(true);
        context.setEnhancedTracingEnabled(true);

        // Debug: Verify session manager was created
        const sessionManager = context.getSessionSegmentManager();
        if (sessionManager) {
          response.addResult('🎯 Intelligent action recording enabled');
          response.addResult('   - Custom action names will replace "Bounding box" entries');
          response.addResult(`   - Session segments: ${maxActionsPerSegment} actions per trace file`);
          response.addResult(`   - Session directory: ${sessionDir}`);
          response.addResult('✅ Session manager initialized successfully');
        } else {
          response.addError('❌ Session manager failed to initialize');
        }

        // Check if browser is headless and warn user
        if (context.config.browser.launchOptions.headless) {
          response.addResult('⚠️  WARNING: Browser is running in headless mode');
          response.addResult('   For manual interactions, restart without --headless flag');
        } else {
          response.addResult('✅ Browser is headed - ready for manual interactions');
        }
      } catch (error) {
        response.addError(`Failed to initialize enhanced tracing: ${error}`);
        response.addError(`Error details: ${error.message}`);
        response.addError(`Stack trace: ${error.stack}`);
        // Fall back to standard tracing
      }
    }

    // Start standard Playwright tracing
    await (browserContext.tracing as Tracing).start({
      name,
      screenshots: true,
      snapshots: true,
      _live: true,
    });

    const traceLegend = `- Action log: ${tracesDir}/${name}.trace
- Network log: ${tracesDir}/${name}.network
- Resources with content by sha1: ${tracesDir}/resources`;

    response.addResult(`Tracing started, saving to ${tracesDir}.\n${traceLegend}`);
    (browserContext.tracing as any)[traceLegendSymbol] = traceLegend;
  },
});

const tracingStop = defineTool({
  capability: 'tracing',

  schema: {
    name: 'browser_stop_tracing',
    title: 'Stop tracing',
    description: 'Stop trace recording and return enhanced trace files with intelligent action names if enhanced tracing was enabled',
    inputSchema: z.object({}),
    type: 'readOnly',
  },

  handle: async (context, params, response) => {
    const browserContext = await context.ensureBrowserContext();

    // Handle enhanced tracing session finalization
    if (context.isUserSessionActive() && context.isEnhancedTracingEnabled()) {
      try {
        // Force flush any pending actions from the input recorder
        await context.flushInputRecorder();

        // Add debug information BEFORE finalizing (since finalize clears the session manager)
        const sessionManager = context.getSessionSegmentManager();
        if (sessionManager) {
          response.addResult(`📊 Session Debug: ${sessionManager.getActionCount()} actions recorded`);
        } else {
          response.addResult('📊 Session Debug: No session manager found');
        }

        // Finalize enhanced tracing session and get session folder path
        const enhancedTraceFiles = await context.finalizeSession();
        const sessionPath = context.getSessionPath();

        if (enhancedTraceFiles.length > 0) {
          response.addResult(`✅ Processed ${enhancedTraceFiles.length} enhanced trace segment(s)`);
          response.addResult('🎯 Actions show as "Click Submit Button" instead of "Bounding box"');

          // Return session folder path and trace file names
          if (sessionPath) {
            response.addResult(`📁 Session folder: ${sessionPath}`);
            response.addResult('📂 Contains: trace files, action JSONL files, and metadata');
          }

          // List trace files for easy access
          for (const [index, traceFilePath] of enhancedTraceFiles.entries()) {
            const fileName = path.basename(traceFilePath);
            response.addResult(`📦 Trace file ${index + 1}: ${traceFilePath}`);
          }

          response.addResult('');
          response.addResult('🔍 View traces with: npx playwright show-trace <file>');
          response.addResult('📋 Each trace contains both tool actions and human actions');
        } else {
          response.addError('No enhanced trace files were generated');
          if (sessionPath) {
            response.addResult(`📁 Session folder: ${sessionPath}`);
            response.addResult('📂 Check folder contents for debugging');
          }
        }

        // Clear enhanced tracing state
        context.setUserSessionActive(false);
        context.setEnhancedTracingEnabled(false);

      } catch (sessionError) {
        response.addError(`Failed to finalize enhanced session: ${sessionError}`);
        // Fall back to standard tracing stop
        await browserContext.tracing.stop();
      }
    } else {
      // Standard tracing stop for non-enhanced sessions
      await browserContext.tracing.stop();
    }

    const traceLegend = (browserContext.tracing as any)[traceLegendSymbol];
    if (traceLegend) {
      response.addResult(`Tracing stopped.\n${traceLegend}`);
    } else {
      response.addResult('Tracing stopped.');
    }
  },
});

export default [
  tracingStart,
  tracingStop,
];

const traceLegendSymbol = Symbol('tracesDir');
