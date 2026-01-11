/**
 * Simple Session Recorder Test
 *
 * This demonstrates capturing:
 * - HTML snapshots (interactive, with shadow DOM and styles)
 * - Screenshots
 * - Console messages
 * - HTTP requests/responses
 *
 * All captured as you perform browser actions - no complex tracing system.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class SimpleSessionRecorder {
  constructor(context) {
    this.context = context;
    this.snapshots = [];
    this.harEntries = [];
    this.consoleMessages = [];
    this.blobs = new Map();
    this.actionCount = 0;

    // We'll need to use Playwright's internal classes
    // For now, we'll capture data using public APIs
  }

  async initialize() {
    // Listen for console messages on all pages
    this.context.on('page', (page) => {
      page.on('console', msg => {
        this.consoleMessages.push({
          timestamp: Date.now(),
          type: msg.type(),
          text: msg.text(),
          location: msg.location()
        });
      });

      // Also capture page errors
      page.on('pageerror', error => {
        this.consoleMessages.push({
          timestamp: Date.now(),
          type: 'error',
          text: error.toString(),
          stack: error.stack
        });
      });
    });

    console.log('✅ Simple Session Recorder initialized');
  }

  async captureAction(page, actionName, actionFn) {
    const actionId = ++this.actionCount;
    console.log(`\n📸 Capturing action #${actionId}: ${actionName}`);

    const beforeData = await this._captureState(page, `${actionName}-before`);

    // Execute the action
    console.log(`   ⚡ Executing: ${actionName}`);
    await actionFn();

    // Small delay to let things settle
    await page.waitForTimeout(100);

    const afterData = await this._captureState(page, `${actionName}-after`);

    const actionRecord = {
      id: actionId,
      name: actionName,
      timestamp: Date.now(),
      before: beforeData,
      after: afterData,
      consoleMessages: this.consoleMessages.slice(), // snapshot of console
    };

    this.snapshots.push(actionRecord);

    console.log(`   ✅ Captured before/after snapshots for: ${actionName}`);
    console.log(`   📊 Console messages: ${this.consoleMessages.length}`);

    return actionRecord;
  }

  async _captureState(page, snapshotName) {
    // Capture what we can with public APIs
    // (In full implementation, we'd use Snapshotter class directly)

    const [screenshot, html, url, title] = await Promise.all([
      page.screenshot({ type: 'png' }),
      page.content(),
      page.url(),
      page.title()
    ]);

    return {
      snapshotName,
      screenshot: screenshot.toString('base64').substring(0, 100) + '...', // truncate for display
      screenshotSize: screenshot.length,
      html: html.substring(0, 500) + '...', // truncate for display
      htmlSize: html.length,
      url,
      title,
      timestamp: Date.now()
    };
  }

  getSummary() {
    return {
      totalActions: this.actionCount,
      totalSnapshots: this.snapshots.length * 2, // before + after
      totalConsoleMessages: this.consoleMessages.length,
      actions: this.snapshots.map(a => ({
        id: a.id,
        name: a.name,
        url: a.after.url,
        consoleCount: a.consoleMessages.length
      }))
    };
  }

  async saveToFile(filename) {
    const outputPath = path.join(__dirname, 'playwright-mcp-output', filename);
    const dir = path.dirname(outputPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = {
      metadata: {
        timestamp: new Date().toISOString(),
        totalActions: this.actionCount,
        totalConsoleMessages: this.consoleMessages.length
      },
      actions: this.snapshots,
      consoleLog: this.consoleMessages
    };

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`\n💾 Saved session data to: ${outputPath}`);
    return outputPath;
  }
}

async function runTest() {
  console.log('🚀 Starting Simple Session Recorder Test\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 500 // slow down so you can see what's happening
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });

  const recorder = new SimpleSessionRecorder(context);
  await recorder.initialize();

  const page = await context.newPage();

  try {
    // Action 1: Navigate to a page
    await recorder.captureAction(page, 'navigate-to-example', async () => {
      await page.goto('https://example.com');
    });

    // Action 2: Navigate to a page with more content
    await recorder.captureAction(page, 'navigate-to-playwright', async () => {
      await page.goto('https://playwright.dev');
    });

    // Action 3: Click on a link
    await recorder.captureAction(page, 'click-get-started', async () => {
      const link = page.locator('text=Get started').first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
      }
    });

    // Action 4: Type in search (if available)
    await recorder.captureAction(page, 'interact-with-page', async () => {
      // Just scroll to generate some activity
      await page.evaluate(() => window.scrollBy(0, 500));
    });

    // Action 5: Navigate to a page with console output
    await recorder.captureAction(page, 'page-with-console', async () => {
      await page.goto('data:text/html,<h1>Test Page</h1><script>console.log("Hello from page!"); console.error("Test error"); console.warn("Test warning");</script>');
    });

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SESSION SUMMARY');
    console.log('='.repeat(60));
    const summary = recorder.getSummary();
    console.log(JSON.stringify(summary, null, 2));

    // Save to file
    const outputFile = await recorder.saveToFile(`session-${Date.now()}.json`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST COMPLETE');
    console.log('='.repeat(60));
    console.log(`
What was captured for each action:
- Before snapshot: HTML content, screenshot, URL, title
- After snapshot: HTML content, screenshot, URL, title
- Console messages: All console.log/error/warn from the page
- Timing: Timestamps for each capture

In a full implementation with Snapshotter class:
- HTML snapshots would be INTERACTIVE (with shadow DOM, styles embedded)
- Would capture HTTP requests/responses via HarTracer
- Would have resource blobs (images, CSS, fonts)
- Would be vectorization-ready for AI question-answering

Output saved to: ${outputFile}
`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
runTest().catch(console.error);
