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
 * Test for Browser Session Recorder
 * Opens browser, waits for you to perform actions, then shows what was captured
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { BrowserSessionRecorder } from './index';

async function testBrowserSessionRecorder() {
  console.log('🚀 Testing Browser Session Recorder\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    viewport: null
  });

  const page: Page = await context.newPage();

  // Create and start the recorder
  const recorder = new BrowserSessionRecorder(`session-${Date.now()}`);
  await recorder.start(page);

  console.log(`\n📹 Browser session recording started: ${recorder.sessionId}`);
  console.log('\n✅ Recorder started!');
  console.log('\n' + '='.repeat(70));
  console.log('🎬 PERFORM YOUR ACTIONS IN THE BROWSER');
  console.log('='.repeat(70));
  console.log('\nThe recorder will capture:');
  console.log('  ✅ Before/after HTML snapshots (interactive, with styles & shadow DOM)');
  console.log('  ✅ Before/after screenshots');
  console.log('  ✅ Console messages (recent)');
  console.log('  ✅ Network requests (recent)');
  console.log('  ✅ Element highlighting with "session-recorded-element" class');
  console.log('\nTry:');
  console.log('  - Navigate to a website (e.g., https://example.com)');
  console.log('  - Click buttons and links');
  console.log('  - Fill out forms');
  console.log('  - Type and press Enter');
  console.log('  - Interact with the page');
  console.log('\n' + '='.repeat(70));
  console.log('Press ENTER when done to see results...');
  console.log('='.repeat(70) + '\n');

  // Wait for user to press enter
  await waitForEnter();

  // Stop recording
  await recorder.stop();

  // Get the data
  const sessionData = recorder.getSessionData();
  const summary = recorder.getSummary();

  console.log(`\n🛑 Recording stopped. Captured ${sessionData.actions.length} actions.`);
  console.log('\n' + '='.repeat(70));
  console.log('📊 SESSION SUMMARY');
  console.log('='.repeat(70));
  console.log(JSON.stringify(summary, null, 2));

  // Save the full session data
  const outputDir = path.join(__dirname, 'browser-session-output');
  if (!fs.existsSync(outputDir))
    fs.mkdirSync(outputDir, { recursive: true });

  const outputFile = path.join(outputDir, `${sessionData.sessionId}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(sessionData, null, 2));

  console.log(`\n💾 Full session data saved to: ${outputFile}`);
  console.log(`   File size: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`);

  // Show details of each action
  console.log('\n' + '='.repeat(70));
  console.log('📋 ACTION DETAILS');
  console.log('='.repeat(70));

  sessionData.actions.forEach((action, i) => {
    console.log(`\nAction #${i + 1}: ${action.action.type}`);
    console.log(`  Selector: ${action.action.selector || 'N/A'}`);
    console.log(`  URL: ${action.after.url}`);
    console.log(`  Before HTML size: ${action.before.html.length} chars`);
    console.log(`  After HTML size: ${action.after.html.length} chars`);
    console.log(`  Before screenshot: ${action.before.screenshot.length} chars (base64)`);
    console.log(`  After screenshot: ${action.after.screenshot.length} chars (base64)`);
    console.log(`  Console logs: ${action.consoleLogs.length}`);
    console.log(`  Network requests: ${action.networkRequests.length}`);

    if (action.consoleLogs.length > 0) {
      console.log(`  Recent console messages:`);
      action.consoleLogs.forEach(log => {
        console.log(`    [${log.type}] ${log.text}`);
      });
    }

    if (action.networkRequests.length > 0) {
      console.log(`  Recent network requests:`);
      action.networkRequests.slice(0, 3).forEach(req => {
        console.log(`    ${req.method} ${req.url} (${req.status || 'pending'})`);
      });
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(70));
  console.log('\n📦 What was captured:');
  console.log('  ✅ Interactive HTML snapshots (can be saved and opened in browser)');
  console.log('  ✅ Screenshots showing visual state (base64 encoded)');
  console.log('  ✅ Highlighted elements with "session-recorded-element" class');
  console.log('  ✅ Console messages around each action');
  console.log('  ✅ Network requests around each action');
  console.log('\n🎯 This data is ready for:');
  console.log('  🤖 Vectorization and embedding generation');
  console.log('  💬 AI-powered question answering');
  console.log('  🔍 Session analysis and debugging');
  console.log('  🧪 Automated test generation');

  await browser.close();
}

function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

testBrowserSessionRecorder().catch(console.error);
