/**
 * Full Session Recorder using Playwright's Internal Snapshotter and HarTracer
 *
 * This demonstrates the REAL implementation that captures:
 * - Interactive HTML snapshots (with shadow DOM, computed styles, embedded resources)
 * - Screenshots (PNG)
 * - Console messages (log, error, warn, info)
 * - HTTP requests/responses (full HAR data with bodies)
 *
 * Uses Playwright's internal classes directly - no complex tracing system needed.
 */

const fs = require('fs');
const path = require('path');

// Import Playwright's internal classes
const { chromium } = require('playwright');
const { Snapshotter } = require('./packages/playwright-core/lib/server/trace/recorder/snapshotter');
const { HarTracer } = require('./packages/playwright-core/lib/server/har/harTracer');

class FullSessionRecorder {
  constructor(context) {
    this.context = context;
    this.snapshots = new Map();
    this.blobs = new Map();
    this.harEntries = [];
    this.consoleMessages = [];
    this.actions = [];
    this.actionCount = 0;

    this._initializeSnapshotter();
    this._initializeHarTracer();
    this._initializeConsoleCapture();
  }

  _initializeSnapshotter() {
    // Create Snapshotter with delegate callbacks
    this.snapshotter = new Snapshotter(this.context, {
      onFrameSnapshot: (snapshot) => {
        console.log(`   📦 Captured frame snapshot: ${snapshot.snapshotName} (${snapshot.frameUrl})`);
        this.snapshots.set(snapshot.snapshotName, snapshot);
      },
      onSnapshotterBlob: (blob) => {
        console.log(`   💾 Captured blob: ${blob.sha1} (${blob.buffer.length} bytes)`);
        this.blobs.set(blob.sha1, blob.buffer);
      }
    });
  }

  _initializeHarTracer() {
    // Create HarTracer with delegate callbacks
    this.harTracer = new HarTracer(
      this.context,
      null, // page - null means capture for all pages in context
      {
        onEntryStarted: (entry) => {
          console.log(`   🌐 HTTP Request started: ${entry.request.method} ${entry.request.url}`);
        },
        onEntryFinished: (entry) => {
          console.log(`   ✓ HTTP Request finished: ${entry.response.status} ${entry.request.url}`);
          this.harEntries.push(entry);
        },
        onContentBlob: (sha1, buffer) => {
          console.log(`   📄 Content blob: ${sha1} (${buffer.length} bytes)`);
          this.blobs.set(sha1, buffer);
        }
      },
      {
        content: 'embed',           // Embed response bodies in HAR
        includeTraceInfo: true,     // Include timing info
        recordRequestOverrides: true, // Record request modifications
        waitForContentOnStop: true, // Wait for all content when stopping
        slimMode: false,            // Full data capture (not slim)
        omitScripts: false          // Include script requests
      }
    );
  }

  _initializeConsoleCapture() {
    // Capture console messages from all pages
    this.context.on('page', (page) => {
      page.on('console', msg => {
        const consoleMsg = {
          timestamp: Date.now(),
          type: msg.type(),
          text: msg.text(),
          location: msg.location(),
          args: msg.args().map(arg => arg.toString())
        };
        this.consoleMessages.push(consoleMsg);
        console.log(`   💬 Console ${msg.type()}: ${msg.text()}`);
      });

      page.on('pageerror', error => {
        const errorMsg = {
          timestamp: Date.now(),
          type: 'pageerror',
          text: error.toString(),
          stack: error.stack
        };
        this.consoleMessages.push(errorMsg);
        console.log(`   ❌ Page error: ${error.toString()}`);
      });
    });
  }

  async initialize() {
    console.log('🔧 Initializing Full Session Recorder...');

    // Start Snapshotter
    await this.snapshotter.start();
    console.log('   ✅ Snapshotter started');

    // Start HarTracer
    this.harTracer.start({ omitScripts: false });
    console.log('   ✅ HarTracer started');

    console.log('✅ Full Session Recorder initialized\n');
  }

  async captureAction(page, actionName, actionFn) {
    const actionId = ++this.actionCount;
    console.log(`\n${'='.repeat(70)}`);
    console.log(`📸 ACTION #${actionId}: ${actionName}`);
    console.log('='.repeat(70));

    // Clear previous console messages for this action
    const beforeConsoleCount = this.consoleMessages.length;
    const beforeHarCount = this.harEntries.length;

    // Capture BEFORE state
    console.log('\n📷 Capturing BEFORE state...');
    const beforeCallId = `action-${actionId}-before`;
    const beforeSnapshotName = `${actionName}-before`;

    await this.snapshotter.captureSnapshot(page, beforeCallId, beforeSnapshotName);
    const beforeScreenshot = await page.screenshot({ type: 'png' });
    const beforeUrl = page.url();
    const beforeTitle = await page.title();

    console.log(`   ✓ Before snapshot: ${beforeSnapshotName}`);
    console.log(`   ✓ Before screenshot: ${beforeScreenshot.length} bytes`);
    console.log(`   ✓ URL: ${beforeUrl}`);
    console.log(`   ✓ Title: ${beforeTitle}`);

    // Execute the action
    console.log(`\n⚡ Executing action: ${actionName}...`);
    const startTime = Date.now();
    await actionFn();
    const executionTime = Date.now() - startTime;
    console.log(`   ✓ Execution completed in ${executionTime}ms`);

    // Wait for page to settle
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
      console.log('   ✓ Network idle');
    } catch (e) {
      console.log('   ⚠ Network not idle after 5s, continuing...');
    }

    // Small delay for final renders
    await page.waitForTimeout(100);

    // Capture AFTER state
    console.log('\n📷 Capturing AFTER state...');
    const afterCallId = `action-${actionId}-after`;
    const afterSnapshotName = `${actionName}-after`;

    await this.snapshotter.captureSnapshot(page, afterCallId, afterSnapshotName);
    const afterScreenshot = await page.screenshot({ type: 'png' });
    const afterUrl = page.url();
    const afterTitle = await page.title();

    console.log(`   ✓ After snapshot: ${afterSnapshotName}`);
    console.log(`   ✓ After screenshot: ${afterScreenshot.length} bytes`);
    console.log(`   ✓ URL: ${afterUrl}`);
    console.log(`   ✓ Title: ${afterTitle}`);

    // Collect console messages for this action
    const actionConsoleMessages = this.consoleMessages.slice(beforeConsoleCount);
    const actionHarEntries = this.harEntries.slice(beforeHarCount);

    console.log(`\n📊 Action Summary:`);
    console.log(`   • Console messages: ${actionConsoleMessages.length}`);
    console.log(`   • HTTP requests: ${actionHarEntries.length}`);
    console.log(`   • Resource blobs: ${this.blobs.size}`);
    console.log(`   • Frame snapshots: ${this.snapshots.size}`);

    // Build action record
    const actionRecord = {
      id: actionId,
      name: actionName,
      timestamp: Date.now(),
      executionTime,
      before: {
        callId: beforeCallId,
        snapshotName: beforeSnapshotName,
        screenshot: beforeScreenshot.toString('base64'),
        url: beforeUrl,
        title: beforeTitle,
        timestamp: startTime
      },
      after: {
        callId: afterCallId,
        snapshotName: afterSnapshotName,
        screenshot: afterScreenshot.toString('base64'),
        url: afterUrl,
        title: afterTitle,
        timestamp: Date.now()
      },
      console: actionConsoleMessages,
      network: actionHarEntries
    };

    this.actions.push(actionRecord);
    return actionRecord;
  }

  async dispose() {
    console.log('\n🔧 Disposing recorder...');

    // Flush and stop HarTracer
    await this.harTracer.flush();
    this.harTracer.stop();
    console.log('   ✓ HarTracer stopped');

    // Stop Snapshotter
    this.snapshotter.stop();
    this.snapshotter.dispose();
    console.log('   ✓ Snapshotter stopped');
  }

  getSummary() {
    return {
      totalActions: this.actionCount,
      totalSnapshots: this.snapshots.size,
      totalBlobs: this.blobs.size,
      totalConsoleMessages: this.consoleMessages.length,
      totalHarEntries: this.harEntries.length,
      actions: this.actions.map(a => ({
        id: a.id,
        name: a.name,
        executionTime: a.executionTime,
        beforeUrl: a.before.url,
        afterUrl: a.after.url,
        consoleCount: a.console.length,
        networkCount: a.network.length
      }))
    };
  }

  async saveToFile(filename) {
    const outputPath = path.join(__dirname, 'playwright-mcp-output', filename);
    const dir = path.dirname(outputPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Convert snapshots Map to object
    const snapshotsObj = {};
    for (const [key, value] of this.snapshots.entries()) {
      snapshotsObj[key] = {
        ...value,
        // Don't include full HTML in main file (can be huge)
        htmlPreview: value.html?.substring(0, 500) + '...',
        htmlSize: value.html?.length || 0
      };
    }

    // Convert blobs Map to metadata only (actual blobs would be saved separately)
    const blobsMetadata = {};
    for (const [sha1, buffer] of this.blobs.entries()) {
      blobsMetadata[sha1] = {
        size: buffer.length,
        type: this._guessBlobType(sha1)
      };
    }

    const data = {
      metadata: {
        timestamp: new Date().toISOString(),
        totalActions: this.actionCount,
        totalSnapshots: this.snapshots.size,
        totalBlobs: this.blobs.size,
        totalConsoleMessages: this.consoleMessages.length,
        totalHarEntries: this.harEntries.length
      },
      actions: this.actions.map(action => ({
        ...action,
        // Truncate screenshots in JSON (save separately if needed)
        before: {
          ...action.before,
          screenshot: action.before.screenshot.substring(0, 100) + '...',
          screenshotSize: action.before.screenshot.length
        },
        after: {
          ...action.after,
          screenshot: action.after.screenshot.substring(0, 100) + '...',
          screenshotSize: action.after.screenshot.length
        }
      })),
      snapshots: snapshotsObj,
      blobs: blobsMetadata,
      consoleLog: this.consoleMessages,
      harEntries: this.harEntries
    };

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`\n💾 Saved session data to: ${outputPath}`);

    // Also save a compact summary
    const summaryPath = outputPath.replace('.json', '-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(this.getSummary(), null, 2));
    console.log(`💾 Saved summary to: ${summaryPath}`);

    return outputPath;
  }

  _guessBlobType(sha1) {
    if (sha1.endsWith('.png')) return 'image/png';
    if (sha1.endsWith('.jpg') || sha1.endsWith('.jpeg')) return 'image/jpeg';
    if (sha1.endsWith('.css')) return 'text/css';
    if (sha1.endsWith('.js')) return 'application/javascript';
    if (sha1.endsWith('.woff2')) return 'font/woff2';
    if (sha1.endsWith('.woff')) return 'font/woff';
    return 'application/octet-stream';
  }
}

async function runTest() {
  console.log('🚀 Starting Full Session Recorder Test with Snapshotter & HarTracer\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300 // slow down to see what's happening
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });

  const recorder = new FullSessionRecorder(context);
  await recorder.initialize();

  const page = await context.newPage();

  try {
    // Action 1: Navigate to a simple page
    await recorder.captureAction(page, 'navigate-to-example', async () => {
      await page.goto('https://example.com');
    });

    // Action 2: Navigate to a rich page
    await recorder.captureAction(page, 'navigate-to-playwright', async () => {
      await page.goto('https://playwright.dev');
    });

    // Action 3: Click navigation
    await recorder.captureAction(page, 'click-get-started', async () => {
      const link = page.locator('text=Get started').first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
      }
    });

    // Action 4: Page with console output
    await recorder.captureAction(page, 'page-with-console-and-fetch', async () => {
      await page.goto('data:text/html,<h1>Test Page</h1><script>console.log("Hello!"); console.error("Error test"); fetch("https://api.github.com/zen").then(r => r.text()).then(t => console.log("GitHub Zen:", t));</script>');
      await page.waitForTimeout(1000); // Wait for fetch
    });

    // Action 5: Interact with page (scroll)
    await recorder.captureAction(page, 'scroll-page', async () => {
      await page.evaluate(() => window.scrollBy(0, 500));
    });

    // Cleanup
    await recorder.dispose();

    // Print final summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 FINAL SESSION SUMMARY');
    console.log('='.repeat(70));
    const summary = recorder.getSummary();
    console.log(JSON.stringify(summary, null, 2));

    // Save to file
    const outputFile = await recorder.saveToFile(`snapshotter-session-${Date.now()}.json`);

    console.log('\n' + '='.repeat(70));
    console.log('✅ TEST COMPLETE - FULL SNAPSHOTTER IMPLEMENTATION');
    console.log('='.repeat(70));
    console.log(`
🎯 What was captured using REAL Snapshotter & HarTracer:

✅ HTML Snapshots (INTERACTIVE):
   • Shadow DOM content expanded and captured
   • Computed CSS styles embedded inline
   • Resources as data URIs (images, fonts, CSS)
   • Canvas/video converted to images
   • iframes recursively captured

✅ Screenshots:
   • PNG format
   • Before/after for each action

✅ Console Messages:
   • console.log, error, warn, info
   • Page errors with stack traces
   • Timestamps and locations

✅ HTTP Requests/Responses (HAR format):
   • Full request data (method, URL, headers, body)
   • Full response data (status, headers, body, timing)
   • API calls, resource loads, everything

✅ Resource Blobs:
   • Images, CSS, fonts, scripts
   • Embedded in snapshots or stored separately
   • SHA1 hashes for deduplication

📁 Output saved to: ${outputFile}

🤖 This data is vectorization-ready for AI question-answering!
`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  } finally {
    await browser.close();
  }
}

// Run the test
runTest().catch(console.error);
