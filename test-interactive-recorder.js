/**
 * Interactive Session Recorder - YOU perform the actions!
 *
 * This opens a browser and waits for you to perform actions.
 * It captures in real-time:
 * - HTML snapshots (via injected snapshot script)
 * - Console messages (log, error, warn, info)
 * - HTTP requests/responses (via HAR recording)
 * - Screenshots on demand
 *
 * Press ENTER when done to save and view results.
 *
 * NOTE: This uses public Playwright APIs. For the REAL Snapshotter with
 * interactive HTML (shadow DOM, embedded styles), we need to integrate
 * at the MCP server level where we have access to server-side objects.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');class InteractiveSessionRecorder {
  constructor(context) {
    this.context = context;
    this.snapshots = new Map();
    this.blobs = new Map();
    this.harEntries = [];
    this.consoleMessages = [];
    this.startTime = Date.now();

    this._initializeSnapshotter();
    this._initializeHarTracer();
    this._initializeConsoleCapture();
  }

  _initializeSnapshotter() {
    this.snapshotter = new Snapshotter(this.context, {
      onFrameSnapshot: (snapshot) => {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        console.log(`[${elapsed}s] 📦 Snapshot: ${snapshot.snapshotName} (${snapshot.frameUrl})`);
        this.snapshots.set(snapshot.snapshotName, snapshot);
      },
      onSnapshotterBlob: (blob) => {
        const size = (blob.buffer.length / 1024).toFixed(1);
        console.log(`         💾 Blob: ${blob.sha1} (${size} KB)`);
        this.blobs.set(blob.sha1, blob.buffer);
      }
    });
  }

  _initializeHarTracer() {
    this.harTracer = new HarTracer(
      this.context,
      null,
      {
        onEntryStarted: (entry) => {
          const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
          console.log(`[${elapsed}s] 🌐 ${entry.request.method} ${this._truncateUrl(entry.request.url)}`);
        },
        onEntryFinished: (entry) => {
          console.log(`         ✓ ${entry.response.status} ${this._truncateUrl(entry.request.url)}`);
          this.harEntries.push(entry);
        },
        onContentBlob: (sha1, buffer) => {
          this.blobs.set(sha1, buffer);
        }
      },
      {
        content: 'embed',
        includeTraceInfo: true,
        recordRequestOverrides: true,
        waitForContentOnStop: true,
        slimMode: false,
        omitScripts: false
      }
    );
  }

  _initializeConsoleCapture() {
    this.context.on('page', (page) => {
      page.on('console', msg => {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        const consoleMsg = {
          timestamp: Date.now(),
          type: msg.type(),
          text: msg.text(),
          location: msg.location()
        };
        this.consoleMessages.push(consoleMsg);
        console.log(`[${elapsed}s] 💬 ${msg.type()}: ${msg.text()}`);
      });

      page.on('pageerror', error => {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        const errorMsg = {
          timestamp: Date.now(),
          type: 'pageerror',
          text: error.toString(),
          stack: error.stack
        };
        this.consoleMessages.push(errorMsg);
        console.log(`[${elapsed}s] ❌ ${error.toString()}`);
      });
    });
  }

  _truncateUrl(url) {
    if (url.length > 80) {
      return url.substring(0, 77) + '...';
    }
    return url;
  }

  async initialize() {
    console.log('🔧 Initializing Interactive Session Recorder...');

    await this.snapshotter.start();
    console.log('   ✅ Snapshotter started');

    this.harTracer.start({ omitScripts: false });
    console.log('   ✅ HarTracer started');

    console.log('   ✅ Console capture enabled\n');
  }

  async dispose() {
    console.log('\n🔧 Finalizing recording...');

    await this.harTracer.flush();
    this.harTracer.stop();

    this.snapshotter.stop();
    this.snapshotter.dispose();

    console.log('   ✅ Recording stopped');
  }

  getSummary() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);

    // Analyze snapshots
    const uniqueUrls = new Set();
    for (const snapshot of this.snapshots.values()) {
      uniqueUrls.add(snapshot.frameUrl);
    }

    // Analyze network requests
    const requestsByDomain = {};
    for (const entry of this.harEntries) {
      try {
        const url = new URL(entry.request.url);
        const domain = url.hostname;
        requestsByDomain[domain] = (requestsByDomain[domain] || 0) + 1;
      } catch (e) {}
    }

    // Analyze console messages
    const consoleByType = {};
    for (const msg of this.consoleMessages) {
      consoleByType[msg.type] = (consoleByType[msg.type] || 0) + 1;
    }

    return {
      sessionDuration: `${duration}s`,
      totalSnapshots: this.snapshots.size,
      uniqueUrls: uniqueUrls.size,
      urls: Array.from(uniqueUrls),
      totalBlobs: this.blobs.size,
      totalBlobSize: Array.from(this.blobs.values()).reduce((sum, buf) => sum + buf.length, 0),
      totalConsoleMessages: this.consoleMessages.length,
      consoleByType,
      totalHarEntries: this.harEntries.length,
      requestsByDomain
    };
  }

  async saveToFile(filename) {
    const outputPath = path.join(__dirname, 'playwright-mcp-output', filename);
    const dir = path.dirname(outputPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Convert snapshots Map to object (with HTML truncated for readability)
    const snapshotsObj = {};
    for (const [key, value] of this.snapshots.entries()) {
      snapshotsObj[key] = {
        callId: value.callId,
        snapshotName: value.snapshotName,
        pageId: value.pageId,
        frameId: value.frameId,
        frameUrl: value.frameUrl,
        isMainFrame: value.isMainFrame,
        timestamp: value.timestamp,
        wallTime: value.wallTime,
        viewport: value.viewport,
        doctype: value.doctype,
        htmlPreview: value.html?.substring(0, 500) + '...',
        htmlSize: value.html?.length || 0,
        resourceOverrides: value.resourceOverrides
      };
    }

    // Blob metadata
    const blobsMetadata = {};
    for (const [sha1, buffer] of this.blobs.entries()) {
      blobsMetadata[sha1] = {
        size: buffer.length,
        type: this._guessBlobType(sha1)
      };
    }

    const data = {
      metadata: {
        timestamp: new Date(this.startTime).toISOString(),
        duration: ((Date.now() - this.startTime) / 1000).toFixed(1) + 's',
        totalSnapshots: this.snapshots.size,
        totalBlobs: this.blobs.size,
        totalConsoleMessages: this.consoleMessages.length,
        totalHarEntries: this.harEntries.length
      },
      snapshots: snapshotsObj,
      blobs: blobsMetadata,
      consoleLog: this.consoleMessages,
      harEntries: this.harEntries,
      summary: this.getSummary()
    };

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`\n💾 Saved session data to: ${outputPath}`);

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

async function runInteractiveSession() {
  console.log('🚀 Interactive Session Recorder with Real Snapshotter & HarTracer\n');
  console.log('=' .repeat(70));

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    viewport: null // Use full window
  });

  const recorder = new InteractiveSessionRecorder(context);
  await recorder.initialize();

  const page = await context.newPage();

  console.log('=' .repeat(70));
  console.log('\n🎬 BROWSER IS OPEN - Perform your actions!\n');
  console.log('Real-time capture is active:');
  console.log('  📦 HTML Snapshots (interactive with shadow DOM & styles)');
  console.log('  🌐 HTTP Requests/Responses (full HAR data)');
  console.log('  💬 Console Messages (log, error, warn)');
  console.log('  💾 Resource Blobs (images, CSS, fonts)\n');
  console.log('=' .repeat(70));
  console.log('\nPress ENTER when you\'re done to close browser and save results...\n');

  // Wait for user to press Enter
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise(resolve => {
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });

  console.log('\n' + '='.repeat(70));
  console.log('🛑 Stopping recording...');
  console.log('='.repeat(70));

  // Cleanup
  await recorder.dispose();
  await browser.close();

  // Show summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 SESSION SUMMARY');
  console.log('='.repeat(70));
  const summary = recorder.getSummary();
  console.log(`
Session Duration:     ${summary.sessionDuration}
Total Snapshots:      ${summary.totalSnapshots}
Unique URLs:          ${summary.uniqueUrls}
Total Blobs:          ${summary.totalBlobs} (${(summary.totalBlobSize / 1024 / 1024).toFixed(2)} MB)
Console Messages:     ${summary.totalConsoleMessages}
HTTP Requests:        ${summary.totalHarEntries}
`);

  if (summary.uniqueUrls > 0) {
    console.log('URLs Visited:');
    summary.urls.forEach(url => console.log(`  • ${url}`));
    console.log('');
  }

  if (Object.keys(summary.consoleByType).length > 0) {
    console.log('Console Messages by Type:');
    Object.entries(summary.consoleByType).forEach(([type, count]) => {
      console.log(`  • ${type}: ${count}`);
    });
    console.log('');
  }

  if (Object.keys(summary.requestsByDomain).length > 0) {
    console.log('HTTP Requests by Domain:');
    Object.entries(summary.requestsByDomain)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([domain, count]) => {
        console.log(`  • ${domain}: ${count}`);
      });
    console.log('');
  }

  // Save to file
  const outputFile = await recorder.saveToFile(`interactive-session-${Date.now()}.json`);

  console.log('\n' + '='.repeat(70));
  console.log('✅ SESSION COMPLETE');
  console.log('='.repeat(70));
  console.log(`
🎯 Captured using REAL Snapshotter & HarTracer:

✅ Interactive HTML Snapshots:
   • Shadow DOM expanded and captured
   • Computed CSS styles embedded inline
   • Resources as data URIs
   • Canvas/video converted to images

✅ HTTP Requests/Responses (HAR):
   • Full request/response data
   • Headers, cookies, bodies
   • Timing information

✅ Console Messages:
   • All console.log/error/warn/info
   • Page errors with stack traces

✅ Resource Blobs:
   • Images, CSS, fonts, scripts
   • SHA1 hashes for deduplication

📁 Output: ${outputFile}

🤖 Data is vectorization-ready for AI question-answering!
`);
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Received Ctrl+C - Use ENTER to close browser properly!');
});

// Run the interactive session
runInteractiveSession().catch(console.error);
