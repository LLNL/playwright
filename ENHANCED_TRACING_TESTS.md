# LLNL Enhanced Tracing Tests

Comprehensive test suite for the intelligent action recording system that replaces "Bounding box" entries with meaningful action names.

## 🎯 Test Scripts

### 1. Implementation Validation (`test-implementation-validation.js`)

**Purpose**: Validates the implementation structure without requiring browser interaction

**Usage**:
```bash
node test-implementation-validation.js
```

**What it checks**:
- ✅ File structure and required implementations
- ✅ Enhanced tracing tool schema (userActions, maxActionsPerSegment)
- ✅ Session management classes (ActionFileWriter, SessionSegmentManager)
- ✅ Post-processing pipeline with ZIP manipulation
- ✅ InputRecorder integration
- ✅ Type definitions (ActionData, SessionSegment)
- ✅ Dependencies (adm-zip)
- ✅ Backward compatibility

**Expected outcome**: All validations should pass before running functional tests

---

### 2. Enhanced Recording Test (`test-enhanced-recording.js`)

**Purpose**: Tests the complete enhanced tracing workflow via stdio transport

**Usage**:
```bash
node test-enhanced-recording.js
```

**What it does**:
1. Connects to LLNL MCP server via stdio with `--enhanced-tracing` flag
2. Starts enhanced tracing (enabled by CLI flag)
3. Navigates to Google.com
4. Waits for manual user interactions
5. Stops tracing and validates enhanced trace files
6. Automatically opens Playwright trace viewer
7. Tests backward compatibility

**Requirements**:
- Browser will open in headed mode (not headless)
- Manual interaction required during test
- Automatically saves and opens trace files

---

### 3. Live Enhanced Recording Test (`test-enhanced-recording-live.js`)

**Purpose**: Tests enhanced tracing over SSE transport with real-time interaction

**Prerequisites**:
```bash
# Start LLNL MCP server with enhanced tracing
node packages/playwright/cli.js --port 3001 --enhanced-tracing
# OR (if using built server path)
node [server-path] --port 3001 --enhanced-tracing
```

**Usage**:
```bash
node test-enhanced-recording-live.js
```

**What it does**:
1. Connects to LLNL MCP server via SSE (http://localhost:3001)
2. Starts enhanced tracing with smaller segments (50 actions)
3. Tests mixed programmatic and user actions
4. Validates multi-segment session handling
5. Opens all generated trace segments

**Benefits**:
- Real-time testing over HTTP transport
- Multi-segment validation
- Mixed action type testing
- Live server interaction

---

## 🧪 Testing Workflow

### Step 1: Build MCP Bundle
```bash
# Build the MCP bundle (required for all tests)
cd packages/playwright/bundles/mcp
npm install
npm run build

# OR from project root
npm run build
```
Expected: Creates `packages/playwright/bundles/mcp/index.js`

### Step 2: Validate Implementation
```bash
# Ensure all implementation components are in place
node test-implementation-validation.js
```
Expected: All 8 validation checks should pass ✅

### Step 3: Basic Functional Test
```bash
# Test core functionality via stdio
node test-enhanced-recording.js
```
Expected: Enhanced trace files generated with intelligent action names

### Step 4: Live Server Test
```bash
# Terminal 1: Start server
cd packages/playwright/bundles/mcp && npm run dev

# Terminal 2: Run test
node test-enhanced-recording-live.js
```
Expected: Real-time enhanced tracing with SSE transport

## 🔍 What to Look for in Trace Viewer

When Playwright trace viewer opens, verify:

### ✅ Intelligent Action Names
- **Instead of**: "Bounding box"
- **Should see**: 
  - "Click Submit Button"
  - "Type Email Address"
  - "Navigate to https://example.com"
  - "Press Enter"
  - "Click [Element Description]"

### ✅ Action Timeline
- All user interactions captured chronologically
- Both programmatic (MCP tool) and manual actions visible
- Proper timestamps and sequences
- Screenshots and snapshots preserved

### ✅ Enhanced Trace Features
- Custom action names in the timeline
- Element descriptions based on selectors
- Text content for input actions
- URL information for navigation

## 📊 Expected Test Results

### Implementation Validation
```
✅ ALL VALIDATIONS PASSED!
🎯 Implementation Status: READY FOR TESTING
```

### Functional Tests
```
✅ Enhanced action naming confirmed in response!
✅ Session segmentation working correctly!
📦 Found X enhanced trace file(s) as binary attachments
🎭 Opening Playwright trace viewer for enhanced trace...
```

### Live Tests
```
✅ SSE transport connection successful
✅ Real-time enhanced tracing operational  
✅ Multiple trace segments handled correctly
✅ Mixed programmatic and user actions captured
```

## 🚨 Troubleshooting

### "Missing LLNL tools" Error
- Check that you're in the playwright-llnl directory
- Ensure MCP bundle is built: `cd packages/playwright/bundles/mcp && npm install`
- Verify tracing.ts has enhanced parameters

### "No enhanced trace file attachments found"
- Ensure you interacted with the browser during the test
- Check for error messages in the console
- Verify userActions was set to true

### SSE Connection Refused (Live Test)
- Make sure server is running on port 3001
- Check server startup logs for errors
- Verify no firewall blocking localhost:3001

### Trace Viewer Shows "Bounding box"
- Implementation may not be fully working
- Check post-processing pipeline logs
- Verify ZIP manipulation and JSONL action correlation

## 📋 Test Coverage

The test suite validates:
- ✅ Core implementation structure
- ✅ Enhanced tracing tool parameters  
- ✅ Session segment management
- ✅ JSONL action file storage
- ✅ ZIP post-processing pipeline
- ✅ Intelligent action naming
- ✅ InputRecorder integration
- ✅ Multi-segment handling
- ✅ Backward compatibility
- ✅ SSE transport functionality
- ✅ Mixed action type recording
- ✅ Trace viewer compatibility

## 🎯 Success Criteria

Tests pass when:
1. **Implementation Validation**: All 8 checks pass
2. **Functional Tests**: Enhanced trace files generated with intelligent names
3. **Trace Viewer**: Shows "Click Button" instead of "Bounding box"
4. **Segmentation**: Multiple trace files for sessions >120 actions
5. **Compatibility**: Standard tracing still works when userActions=false

## 🔄 Next Steps After Testing

Once all tests pass:
1. Commit the enhanced tracing implementation
2. Update documentation with usage examples
3. Test with various web applications
4. Validate performance with large sessions (1000+ actions)
5. Consider integration with playwright-mcp-llnl wrapper