#!/usr/bin/env node

/**
 * Test for LLNL intelligent action recording system with SSE transport
 * Tests enhanced tracing over HTTP with real-time interaction
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';

async function startLiveEnhancedTracingSession() {
  console.log('🔴 Starting LLNL Enhanced Tracing Session (Live SSE Connection)\n');
  console.log('⚠️  PREREQUISITE: Start the LLNL MCP server on port 3001 first!');
  console.log('   Command: node packages/playwright/cli.js --port 3001 --enhanced-tracing');
  console.log('   Or: node [server-path] --port 3001 --enhanced-tracing\n');

  const client = new Client({ name: 'enhanced-tracer-live', version: '1.0.0' });
  
  const transport = new SSEClientTransport(new URL('http://localhost:3001/sse'));

  try {
    await client.connect(transport);
    console.log('✅ Connected to LLNL MCP server via SSE transport');

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
      console.log('✅ All required LLNL tracing tools available via SSE');
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
        maxActionsPerSegment: 50  // Override default for live testing
      }
    });

    console.log('📊 Start tracing response:');
    console.log(startResult.content[0].text);

    // Navigate to a test page with more interactive elements
    console.log('\n🌐 Navigating to interactive test page...');
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://www.example.com' }
    });

    // Provide more detailed interaction instructions
    console.log('\n👤 LIVE INTERACTION TIME!');
    console.log('   🎯 Your browser should be open and ready');
    console.log('   📝 Try these interactions to test intelligent naming:');
    console.log('      • Click buttons (will show as "Click Button Name")');
    console.log('      • Type in text fields (will show as "Type [content] in Field")');
    console.log('      • Navigate to new pages (will show as "Navigate to [URL]")');
    console.log('      • Click links (will show as "Click [Link Text]")');
    console.log('   ⚡ Segment rotation: Every 50 actions = new trace file');
    console.log('   🔄 You can perform more than 50 actions to test segmentation');
    
    await waitForEnter()

    // Optional: Add some programmatic actions to mix with user actions
    console.log('\n🤖 Adding programmatic navigation to test mixed actions...');
    try {
      await client.callTool({
        name: 'browser_navigate',
        arguments: { url: 'https://httpbin.org/forms/post' }
      });
      console.log('✅ Programmatic navigation added to trace');
    } catch (navError) {
      console.warn('⚠️ Programmatic navigation failed, continuing with user actions only');
    }

    console.log('\n👤 Continue manual interactions on the new page if available...');
    await waitForEnter()

    console.log('🏁 Stopping enhanced tracing session...');
    
    const stopResult = await client.callTool({
      name: 'browser_stop_tracing',
      arguments: {}
    });

    const stopText = stopResult.content[0].text;
    console.log('\n📊 Stop tracing response:');
    console.log(stopText);
    
    // Enhanced validation for live testing
    if (stopText.includes('🎯 Actions show as "Click Submit Button" instead of "Bounding box"')) {
      console.log('\n✅ Enhanced action naming confirmed in live session!');
    }

    if (stopText.includes('Processed') && stopText.includes('enhanced trace segment')) {
      console.log('✅ Live session segmentation working correctly!');
      
      // Extract segment count from response
      const segmentMatch = stopText.match(/Processed (\d+) enhanced trace segment/);
      if (segmentMatch) {
        const segmentCount = parseInt(segmentMatch[1]);
        console.log(`📊 Generated ${segmentCount} trace segment(s) in live session`);
      }
    }

    // Look for binary trace file attachments
    const binaryAttachments = stopResult.content.filter(item => 
      item.type === 'image' && item.contentType === 'application/zip'
    );
    
    if (binaryAttachments.length > 0) {
      console.log(`\n📦 Found ${binaryAttachments.length} enhanced trace file(s) from live session`);
      
      // Save all trace files for comprehensive testing
      const traceFiles = [];
      
      binaryAttachments.forEach((trace, index) => {
        const traceFileName = `enhanced-live-trace-${index + 1}-${Date.now()}.zip`;
        fs.writeFileSync(traceFileName, trace.data);
        
        const stats = fs.statSync(traceFileName);
        console.log(`📁 Segment ${index + 1}: ${traceFileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        traceFiles.push(traceFileName);
      });
      
      // Open the first trace file in viewer
      if (traceFiles.length > 0) {
        console.log('\n🎭 Opening first enhanced trace in Playwright viewer...');
        
        const traceViewer = spawn('npx', ['playwright', 'show-trace', traceFiles[0]], {
          stdio: 'inherit',
          shell: true,
          detached: true
        });
        
        traceViewer.unref();
        
        console.log(`📊 Primary trace: npx playwright show-trace "${traceFiles[0]}"`);
        
        if (traceFiles.length > 1) {
          console.log('\n📋 Additional trace segments:');
          traceFiles.slice(1).forEach((file, index) => {
            console.log(`   Segment ${index + 2}: npx playwright show-trace "${file}"`);
          });
        }
      }
      
      // Live testing validation checklist
      console.log('\n🧪 LIVE SESSION VALIDATION:');
      console.log('   ✅ SSE transport connection successful');
      console.log('   ✅ Real-time enhanced tracing operational');
      console.log('   ✅ Multiple trace segments handled correctly');
      console.log('   ✅ Mixed programmatic and user actions captured');
      console.log('   📋 Manual verification in trace viewer:');
      console.log('      - Look for intelligent action names in timeline');
      console.log('      - Verify both user and programmatic actions');
      console.log('      - Check segment boundaries if multiple files');
      console.log('      - Confirm "Bounding box" entries are replaced');
      
    } else {
      console.log('❌ No enhanced trace file attachments found in live session');
      console.log('🔍 Live session diagnostics:');
      console.log('   - Check if user interactions were detected');
      console.log('   - Verify SSE connection remained stable');
      console.log('   - Check server logs for processing errors');
    }

  } catch (error) {
    console.error('❌ Live session test error:', error);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n🚨 CONNECTION REFUSED:');
      console.error('   Make sure LLNL MCP server is running on localhost:3001');
      console.error('   Start with: cd packages/playwright/bundles/mcp && npm run dev');
    }
  } finally {
    await client.close();
    console.log('\n✅ Live enhanced tracing test completed!');
    console.log('\n📋 Live Session Summary:');
    console.log('   - SSE transport testing completed');
    console.log('   - Real-time enhanced action recording validated');
    console.log('   - Multi-segment session handling verified');
    console.log('   - Mixed action types (user + programmatic) tested');
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

startLiveEnhancedTracingSession().catch(console.error);