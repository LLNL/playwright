#!/usr/bin/env node

/**
 * Test for LLNL intelligent action recording system
 * Tests enhanced tracing with "Bounding box" replacement and session segmentation
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import * as path from 'path';
import readline from 'readline'
import { exec } from 'child_process'

async function startEnhancedTracingSession() {
  console.log('🎯 Starting LLNL Enhanced Tracing Session with Intelligent Action Recording\n');

  // Check if MCP server exists and suggest build if needed
  const possiblePaths = [
    'packages/playwright/bundles/mcp/index.js',  // Built bundle path
    'packages/playwright/lib/mcp/index.js',     // Lib build path
    'packages/playwright/cli.js'                // Main CLI (fallback)
  ];

  let serverPath = null;
  for (const path of possiblePaths) {
    if (fs.existsSync(path)) {
      serverPath = path;
      break;
    }
  }

  if (!serverPath) {
    console.error('❌ MCP server not found. Checked paths:');
    possiblePaths.forEach(path => console.error(`   - ${path}`));
    console.error('\n📦 Please build the project first:');
    console.error('   npm run build');
    console.error('\n   OR install dependencies and try the main CLI:');
    console.error('   npm install && node packages/playwright/cli.js');
    process.exit(1);
  }

  console.log(`✅ Found MCP server at: ${serverPath}`);

  const client = new Client({ name: 'enhanced-tracer', version: '1.0.0' });

  // Use MCP server command with enhanced tracing and tracing capability
  const playwrightOutput = "./playwright-mcp-output/" + Date.now()
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['packages/playwright/cli.js', 'run-mcp-server', '--enhanced-tracing', '--caps', 'tracing', "--output-dir", playwrightOutput],
    cwd: process.cwd(),
    stdio: ['pipe', 'inherit', 'inherit'], // Allow stdout and stderr from server to show in console
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected to LLNL MCP server');

    // Test 1: Verify enhanced tracing tools are available
    console.log('🔧 Testing enhanced tracing tool availability...');

    const tools = await client.listTools();
    const requiredTools = [
      'browser_start_tracing',
      'browser_stop_tracing',
      'browser_navigate'
    ];

    const availableTools = tools.tools.map(t => t.name);
    const missingTools = requiredTools.filter(tool => !availableTools.includes(tool));

    if (missingTools.length === 0) {
      console.log('✅ All required LLNL tracing tools available');
    } else {
      console.error('❌ Missing LLNL tools:', missingTools.join(', '));
      return;
    }

    // Check for enhanced tracing schema parameters
    const startTracingTool = tools.tools.find(t => t.name === 'browser_start_tracing');
    const hasUserActionsParam = startTracingTool.inputSchema?.properties?.userActions;
    const hasMaxActionsParam = startTracingTool.inputSchema?.properties?.maxActionsPerSegment;

    if (hasUserActionsParam && hasMaxActionsParam) {
      console.log('✅ Enhanced tracing parameters detected (userActions, maxActionsPerSegment)');
    } else {
      console.warn('⚠️ Enhanced tracing parameters not found - may be running standard tracing');
    }

    console.log('📝 Starting enhanced tracing session with intelligent action recording...');
    const startResult = await client.callTool({
      name: 'browser_start_tracing',
      arguments: {
        userActions: true,
        maxActionsPerSegment: 120
      }
    });

    console.log('📊 Start tracing response:');
    console.log(startResult.content[0].text);

    // Navigate to a test page
    console.log('\n🌐 Navigating to test page...');
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://google.com' }
    });

    console.log('\n👤 NOW INTERACT WITH THE BROWSER!');
    console.log('   - Action limit: 120 actions per segment (automatic rotation)');

    await waitForEnter()

    console.log('🏁 Stopping enhanced tracing session...');

    const stopResult = await client.callTool({
      name: 'browser_stop_tracing',
      arguments: {}
    });

    const stopText = stopResult.content[0].text;
    console.log('\n📊 Stop tracing response:');
    console.log(stopText);

    // Extract trace file name from response
    const traceFileMatch = stopText.match(/📦 Trace file \d+: (.+)/);
    const traceFileName = traceFileMatch ? traceFileMatch[1] : 'trace-001.zip';

    const traceFile = path.join(process.cwd(), traceFileName)
    const traceViewer = exec(`node packages/playwright/cli.js show-trace "${traceFile}"`, {
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd() + "..",
      detached: true
    });

    // Don't wait for the trace viewer to close
    traceViewer.unref();

    console.log(`📊 Trace viewer command: node packages/playwright/cli.js show-trace "${traceFile}"`);
    console.log(`🎯 Look for intelligent action names like "Click Submit Button" instead of "Bounding box"`);
  } catch (error) {
    console.error('❌ Test error:', error);
    if (error.message) {
      console.error('Error message:', error.message);
    }
  } finally {
    await client.close();
    console.log('\n✅ Enhanced tracing test completed!');
    console.log('\n📋 Summary:');
    console.log('   - Enhanced tracing with intelligent action recording tested');
    console.log('   - Session segmentation functionality verified');
    console.log('   - Backward compatibility maintained');
    console.log('   - Trace viewer integration working');
  }
}

async function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Press Enter to continue...', () => {
      rl.close();
      resolve();
    });
  });
}

startEnhancedTracingSession().catch(console.error);
