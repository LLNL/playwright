# Session Recording Architecture - Findings & Design

**Date:** November 11, 2025
**Branch:** feat/browser-recording-feature

## Problem Statement

We need to record browser sessions with rich data capture for **AI-powered vectorization and question-answering**, not just visual debugging. The goal is to capture comprehensive session data that can be indexed and queried by AI systems.

## Key Requirements

### Must Have
1. **HTML Snapshots** - Interactive HTML with shadow DOM, computed styles, embedded resources
2. **Screenshots** - Visual representation of page state
3. **Action Metadata** - Before/after snapshots for every user action
4. **Console Messages** - All console.log/error/warn/info from pages
5. **HTTP Requests/Responses** - Complete network activity with bodies

### Nice to Have
- Timing information
- Page titles and URLs
- Stack traces for errors

### Explicitly NOT Needed
- ❌ Playwright's full tracing system (too complex)
- ❌ Binary trace format
- ❌ Trace ZIP files with complex post-processing
- ❌ Video recording
- ❌ Trace viewer compatibility

## Critical Discoveries

### 1. Snapshotter Creates "Magic" Interactive HTML

Playwright's `Snapshotter` class doesn't just capture `innerHTML`. It creates **interactive HTML snapshots** that include:
- Shadow DOM content (expanded and captured)
- Computed CSS styles (embedded inline)
- Resources as data URIs (images, fonts, CSS files)
- Canvas and video elements (converted to images)
- iframes (recursively captured)

**This is essential** - you can't replicate this with `page.content()`.

### 2. Snapshotter Can Be Used Standalone

Found in `packages/playwright-core/src/server/trace/test/inMemorySnapshotter.ts`:
```typescript
export class InMemorySnapshotter implements SnapshotterDelegate, HarTracerDelegate {
  constructor(context: BrowserContext) {
    this._snapshotter = new Snapshotter(context, this);
    this._harTracer = new HarTracer(context, null, this, {
      content: 'attach',
      includeTraceInfo: true
    });
  }
}
```

**Key insight:** You don't need Playwright's full tracing system. Snapshotter and HarTracer can be composed together directly.

### 3. The "Before" Snapshot Challenge

**Problem:** User actions execute before callbacks fire, so you can't capture "before" state in the callback.

**Solution:** Use JavaScript **capture phase** event listeners:
```javascript
// Capture phase runs BEFORE the event bubbles up
element.addEventListener('click', captureBeforeState, { capture: true });
```

This lets us capture DOM state before the browser processes the user action.

### 4. What Each Component Captures

#### Snapshotter
- ✅ DOM snapshots (via `SnapshotterDelegate.onFrameSnapshot()`)
- ✅ Resource blobs (via `SnapshotterDelegate.onSnapshotterBlob()`)
- ❌ HTTP requests/responses
- ❌ Console messages

#### HarTracer
- ✅ HTTP requests (method, URL, headers, cookies, body)
- ✅ HTTP responses (status, headers, cookies, body, timing)
- ✅ HAR format entries (standard archive format)
- ❌ DOM snapshots
- ❌ Console messages

#### Console Listeners
- ✅ Console messages (via `page.on('console')`)
- ✅ Page errors (via `page.on('pageerror')`)
- Simple JavaScript, no special Playwright component needed

## Proposed Architecture

### Simple Session Recorder

```typescript
class SimpleSessionRecorder {
  private snapshotter: Snapshotter;           // For HTML snapshots
  private harTracer: HarTracer;               // For HTTP capture
  private consoleMessages: ConsoleMessage[];  // For console capture
  private snapshots: Map<string, Snapshot>;   // Storage

  constructor(browserContext: BrowserContext) {
    // Initialize Snapshotter
    this.snapshotter = new Snapshotter(browserContext, {
      onFrameSnapshot: (snapshot) => this.storeSnapshot(snapshot),
      onSnapshotterBlob: (blob) => this.storeBlob(blob)
    });

    // Initialize HarTracer
    this.harTracer = new HarTracer(browserContext, null, {
      onEntryStarted: (entry) => this.storeHarEntry(entry, 'started'),
      onEntryFinished: (entry) => this.storeHarEntry(entry, 'finished')
    }, {
      content: 'embed',      // Include response bodies
      omitScripts: false,    // Keep script requests
      slimMode: false        // Full data capture
    });

    // Listen for console messages
    browserContext.on('page', (page) => {
      page.on('console', msg => this.consoleMessages.push({
        timestamp: Date.now(),
        type: msg.type(),
        text: msg.text(),
        location: msg.location()
      }));

      page.on('pageerror', error => this.consoleMessages.push({
        timestamp: Date.now(),
        type: 'error',
        text: error.toString(),
        stack: error.stack
      }));
    });
  }

  async captureAction(page: Page, actionName: string, actionFn: Function) {
    // 1. Capture BEFORE state
    const beforeCallId = `${actionName}-before-${Date.now()}`;
    await this.snapshotter.captureSnapshot(page, beforeCallId, 'before');
    const beforeScreenshot = await page.screenshot();

    // 2. Execute the action
    await actionFn();

    // 3. Wait for page to settle
    await page.waitForLoadState('networkidle');

    // 4. Capture AFTER state
    const afterCallId = `${actionName}-after-${Date.now()}`;
    await this.snapshotter.captureSnapshot(page, afterCallId, 'after');
    const afterScreenshot = await page.screenshot();

    // 5. Collect all data for this action
    return {
      actionName,
      timestamp: Date.now(),
      before: {
        snapshot: this.snapshots.get(beforeCallId),
        screenshot: beforeScreenshot,
        console: this.getRecentConsole(),
        network: this.getRecentHarEntries()
      },
      after: {
        snapshot: this.snapshots.get(afterCallId),
        screenshot: afterScreenshot,
        console: this.getRecentConsole(),
        network: this.getRecentHarEntries()
      }
    };
  }
}
```

## Storage Format (Vectorization-Friendly)

### Action Record
```json
{
  "actionId": "uuid",
  "actionName": "click-login-button",
  "timestamp": 1762876425536,
  "before": {
    "snapshotId": "uuid",
    "screenshotId": "uuid",
    "url": "https://example.com/login",
    "title": "Login Page",
    "consoleMessages": [...],
    "networkRequests": [...]
  },
  "after": {
    "snapshotId": "uuid",
    "screenshotId": "uuid",
    "url": "https://example.com/dashboard",
    "title": "Dashboard",
    "consoleMessages": [...],
    "networkRequests": [...]
  }
}
```

### Snapshot Record
```json
{
  "snapshotId": "uuid",
  "html": "<interactive HTML with styles and resources embedded>",
  "frameTree": [...],
  "resourceBlobs": {
    "sha1-hash": "base64-data",
    ...
  }
}
```

### Network Record (HAR Entry)
```json
{
  "request": {
    "method": "POST",
    "url": "https://api.example.com/login",
    "headers": [...],
    "postData": {...}
  },
  "response": {
    "status": 200,
    "headers": [...],
    "content": {
      "mimeType": "application/json",
      "text": "{\"token\": \"...\"}"
    },
    "timings": {...}
  }
}
```

## Why This Architecture?

### ✅ Advantages
1. **No Complexity** - Direct use of Snapshotter/HarTracer, no trace ZIP post-processing
2. **Vectorization-Ready** - JSON format with structured text data
3. **Complete Data** - HTML, screenshots, console, network all captured
4. **Interactive Snapshots** - Snapshotter's "magic" HTML preserved
5. **Standalone** - Doesn't depend on Playwright's tracing infrastructure

### ❌ What We're NOT Using
1. Playwright's binary trace format
2. Trace ZIP files
3. SessionSegmentManager (complex rotation logic)
4. ActionFileWriter (file-based storage)
5. Trace viewer integration

## Implementation Files

### Proof of Concept (Public APIs)
- `test-simple-recorder.js` - Working demo using public Playwright APIs
- Captures: HTML (via page.content()), screenshots, console, basic data
- **Limitation:** HTML is not interactive, missing shadow DOM/styles

### Full Implementation (Internal APIs)
- `test-snapshotter-recorder.js` - **TO BE CREATED**
- Uses: Snapshotter, HarTracer, direct component integration
- Captures: Interactive HTML, screenshots, console, HTTP requests/responses
- **Goal:** Production-ready session recording for vectorization

## Key Code Locations

### Snapshotter
- `packages/playwright-core/src/server/trace/recorder/snapshotter.ts`
- `packages/playwright-core/src/server/trace/recorder/snapshotterInjected.ts`

### HarTracer
- `packages/playwright-core/src/server/har/harTracer.ts`

### Test Examples
- `packages/playwright-core/src/server/trace/test/inMemorySnapshotter.ts`
- Shows how to use Snapshotter + HarTracer together

### Current MCP Implementation (Complex, to be replaced)
- `packages/playwright/src/mcp/browser/context.ts`
- Contains: SessionSegmentManager, ActionFileWriter, InputRecorder
- **Issue:** Too complex, post-processes trace ZIPs

## Next Steps

1. ✅ Create proof-of-concept test (DONE - `test-simple-recorder.js`)
2. ❌ Create full implementation using Snapshotter/HarTracer standalone (BLOCKED - see below)
3. ⏳ **Integrate Snapshotter/HarTracer into MCP Context** (CORRECT APPROACH)
4. ⏳ Test interactive HTML snapshots
5. ⏳ Test HTTP request/response capture
6. ⏳ Design vectorization pipeline
7. ⏳ Integrate with MCP browser recording feature

## Critical Discovery: Client vs Server API Issue

**Problem:** Snapshotter and HarTracer are **server-side classes** that require the internal `BrowserContext` object from `packages/playwright-core/src/server/browserContext.ts`.

When we use `require('playwright')` or `require('playwright-core')`, we get the **client-side API** which communicates with the server over a protocol/channel. The client-side `BrowserContext` is a proxy object, not the real server-side one.

**Why the standalone test fails:**
```javascript
const { chromium } = require('playwright');
const { Snapshotter } = require('./packages/playwright-core/lib/server/trace/recorder/snapshotter');

// This creates CLIENT-side context
const context = await browser.newContext();

// This fails - Snapshotter expects SERVER-side context
const snapshotter = new Snapshotter(context, delegate);
// Error: Cannot evaluate a string with arguments
```

**The solution:** Integrate at the **MCP server level** where we already have access to server-side objects.

### Integration Point: MCP Context Class

File: `packages/playwright/src/mcp/browser/context.ts`

The MCP `Context` class already:
- Has access to `browserContext` via `_ensureBrowserContext()`
- Manages browser lifecycle
- Handles tracing (currently using complex SessionSegmentManager)

**We need to:**
1. Access the **server-side** BrowserContext from the client-side one
2. Initialize Snapshotter and HarTracer with the server context
3. Capture data during user actions
4. Store in vectorization-friendly format

### Accessing Server-Side Context

The client-side BrowserContext has a `_channel` that communicates with the server. We need to either:

**Option A:** Add a new MCP tool that creates server-side Snapshotter/HarTracer
- Implement `mcp_start_session_recording` tool
- Tool runs on server-side, has access to real BrowserContext
- Returns recording ID for later retrieval

**Option B:** Modify existing enhanced tracing to use Snapshotter directly
- Replace SessionSegmentManager complexity with simple Snapshotter
- Keep HarTracer for network
- Store directly instead of post-processing trace ZIPs

**Recommended:** Option B - Simplify existing enhanced tracing implementation

## References

- **InMemorySnapshotter Pattern:** `packages/playwright-core/src/server/trace/test/inMemorySnapshotter.ts`
- **Snapshotter Interface:** `packages/playwright-core/src/server/trace/recorder/snapshotter.ts`
- **HarTracer Interface:** `packages/playwright-core/src/server/har/harTracer.ts`
- **HAR Format Spec:** http://www.softwareishard.com/blog/har-12-spec/

## Conclusion

**The winning approach:** Use Playwright's Snapshotter and HarTracer directly, compose them together without the full tracing system. This gives us the "magic" interactive HTML snapshots we need for vectorization, without unnecessary complexity.

The key insight was discovering that `InMemorySnapshotter` already proved this pattern works - Snapshotter and HarTracer are independent components that can be used standalone.
