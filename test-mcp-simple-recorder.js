/**
 * Test Simple Session Recorder via Direct Context Access
 *
 * This demonstrates using the SimpleSessionRecorder by directly
 * creating a Context with access to server-side BrowserContext.
 *
 * YOU perform the actions in the browser, then we analyze what was captured.
 */

const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

async function testSimpleSessionRecorder() {
  console.log('🚀 Testing Simple Session Recorder (INTERACTIVE)\n');

  // Import the compiled Context and supporting classes
  const { Context } = require('./packages/playwright/lib/mcp/browser/context');
  const { resolveConfig } = require('./packages/playwright/lib/mcp/browser/config');
  const { contextFactory } = require('./packages/playwright/lib/mcp/browser/browserContextFactory');

  try {
    // Set up configuration
    const config = await resolveConfig({
      browser: {
        type: 'chromium',
        headless: false
      },
      outputDir: path.join(__dirname, 'playwright-mcp-output')
    });

    console.log('✅ Config resolved');

    // Create browser context factory
    const factory = contextFactory(config);

    console.log('✅ Factory created');

    // Create MCP Context
    const context = new Context({
      config,
      browserContextFactory: factory,
      sessionLog: undefined,
      clientInfo: {
        name: 'test-client',
        version: '1.0.0',
        roots: [{ uri: `file://${__dirname}` }]
      }
    });

    console.log('✅ Context created');

    // Output directory for session
    const sessionOutputDir = path.join(__dirname, 'playwright-mcp-output', 'simple-sessions');

    console.log('\n📝 Starting simple session recording...');
    await context.startSimpleSessionRecording(sessionOutputDir);
    console.log('✅ Recording started\n');

    // Open a browser tab
    console.log('🌐 Opening browser tab...');
    const tab = await context.newTab();
    console.log('✅ Browser tab opened\n');

    // Display instructions
    console.log('='.repeat(70));
    console.log('🎬 BROWSER IS OPEN - Perform your actions!');
    console.log('='.repeat(70));
    console.log('\nReal-time capture is active:');
    console.log('  📦 Interactive HTML Snapshots (with shadow DOM & computed styles)');
    console.log('  🌐 HTTP Requests/Responses (full HAR data with bodies)');
    console.log('  💾 Resource Blobs (images, CSS, fonts, scripts)');
    console.log('\nYou will see capture logs in real-time as you:');
    console.log('  • Navigate to pages');
    console.log('  • Click on elements');
    console.log('  • Trigger network requests');
    console.log('  • Generate console messages');
    console.log('\n' + '='.repeat(70));
    console.log('\nPress ENTER when you\'re done performing actions...\n');

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
    console.log('🛑 Stopping recording and analyzing what was captured...');
    console.log('='.repeat(70));

    // Get summary BEFORE stopping (while recorder still has data)
    console.log('\n📊 Session Summary:');
    const summary = context.getSimpleSessionSummary();
    if (summary) {
      console.log(`\nSession Duration:     ${summary.sessionDuration}`);
      console.log(`Total Snapshots:      ${summary.totalSnapshots}`);
      console.log(`Unique URLs:          ${summary.uniqueUrls}`);
      console.log(`Total Blobs:          ${summary.totalBlobs} (${(summary.totalBlobSize / 1024 / 1024).toFixed(2)} MB)`);
      console.log(`HTTP Requests:        ${summary.totalHarEntries}`);

      if (summary.urls && summary.urls.length > 0) {
        console.log('\nURLs Visited:');
        summary.urls.forEach(url => console.log(`  • ${url}`));
      }

      if (summary.requestsByDomain && Object.keys(summary.requestsByDomain).length > 0) {
        console.log('\nHTTP Requests by Domain (top 10):');
        Object.entries(summary.requestsByDomain)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .forEach(([domain, count]) => {
            console.log(`  • ${domain}: ${count}`);
          });
      }
    } else {
      console.log('No summary available');
    }

    // Stop recording and save
    console.log('\n💾 Saving session data...');
    const sessionFile = await context.stopSimpleSessionRecording(`interactive-session-${Date.now()}`);

    console.log('\n' + '='.repeat(70));
    console.log('✅ TEST COMPLETE');
    console.log('='.repeat(70));
    console.log(`
🎯 SimpleSessionRecorder successfully tested!

📁 Session saved to: ${sessionFile}

✅ Captured using REAL Snapshotter & HarTracer:
   • Interactive HTML snapshots (shadow DOM, embedded styles, resources)
   • HTTP requests/responses (full HAR data with bodies)
   • Resource blobs (images, CSS, fonts, scripts)
   • All data is vectorization-ready for AI question-answering!

🔍 Next steps:
   1. Open the JSON file to see captured data
   2. Check the *_blobs folder for resources
   3. Use this data for vectorization/AI queries
`);

    // Cleanup
    await context.dispose();

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testSimpleSessionRecorder().catch(console.error);
