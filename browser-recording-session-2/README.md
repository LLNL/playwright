# Browser Recording Session

## Overview

Standalone browser session recorder that captures **user actions** (not programmatic test scripts) for AI-powered vectorization and question answering.

## Key Difference from Playwright Trace

- **Playwright Trace**: Records programmatic actions (test scripts, MCP tool calls)
- **Browser Recording Session**: Records **actual user interactions** (clicks, typing, navigation)

This is similar to how `codegen` watches user actions, but focused on comprehensive session capture for later analysis.

## What Gets Captured

For each user action, we capture:

### ✅ HTML Snapshots (Interactive)
- **Before snapshot**: DOM state before action
- **After snapshot**: DOM state after action, with element highlighted
- Includes shadow DOM, computed styles, form state
- Can be opened and interacted with (Playwright's "magic" HTML)

### ✅ Screenshots
- **Before screenshot**: Visual state before action
- **After screenshot**: Visual state after action, with highlighted element

### ✅ Element Highlighting
- Target element gets `session-recorded-element` class in after snapshot
- Allows visual identification of what was clicked/typed

### ✅ Console Logs (Lightweight)
- Console messages from ~1 second before action
- Types: log, error, warn, info, debug
- Limited to last 100 messages to avoid memory issues

### ✅ Network Requests (Lightweight)
- HTTP requests from ~1 second before action
- Captures: URL, method, status, duration
- Limited to last 50 requests

### ✅ Action Metadata
- Action type: click, input, keydown, change, focus, navigate
- Element selector
- Input values, key presses
- Mouse coordinates
- Timestamp

## Architecture

### Standalone Design
- **No client/server complexity**: Direct page control
- **Extracted from Playwright**: Reuses snapshot capture logic
- **No trace ZIP format**: Simple JSON output
- **No test runner**: Works with any browser session

### Core Components

```
browser-recording-session/
├── README.md                  # This file
├── index.ts                   # Public exports
├── types.ts                   # TypeScript interfaces
├── sessionRecorder.ts         # Main recorder class
└── snapshotterInjected.ts     # Browser-side snapshot capture
```

### Flow

1. **User action detected** (in browser, capture phase)
2. **Capture BEFORE** (HTML snapshot + screenshot)
3. **Action executes** (user's click/type already happened)
4. **Wait briefly** for DOM updates (50ms)
5. **Add class** `session-recorded-element` to target element
6. **Capture AFTER** (HTML snapshot + screenshot with highlight)
7. **Remove class** from element
8. **Store action** with all metadata

## Usage

```typescript
import { BrowserSessionRecorder } from './browser-recording-session';

// Create recorder
const recorder = new BrowserSessionRecorder('my-session-id');

// Start recording on a Playwright page
await recorder.start(page);

// User performs actions in browser...
// (recorder captures automatically)

// Stop recording
await recorder.stop();

// Get captured data
const sessionData = recorder.getSessionData();
const summary = recorder.getSummary();

// Session data includes:
// - All actions with before/after snapshots
// - Screenshots
// - Console logs
// - Network requests
// - Element highlighting
```

## Output Format

```json
{
  "sessionId": "session-1699876543210",
  "startTime": 1699876543210,
  "endTime": 1699876598765,
  "actions": [
    {
      "id": "action-1699876545123-abc123",
      "action": {
        "type": "click",
        "selector": "button.submit",
        "timestamp": 1699876545123,
        "x": 450,
        "y": 320
      },
      "before": {
        "html": "<!DOCTYPE html><html>...</html>",
        "screenshot": "base64-encoded-png...",
        "timestamp": 1699876545120,
        "url": "https://example.com",
        "title": "Example Page"
      },
      "after": {
        "html": "<!DOCTYPE html><html>...<button class=\"submit session-recorded-element\">...</html>",
        "screenshot": "base64-encoded-png...",
        "timestamp": 1699876545180,
        "url": "https://example.com",
        "title": "Example Page"
      },
      "consoleLogs": [
        {
          "type": "log",
          "text": "Button clicked",
          "timestamp": 1699876545125
        }
      ],
      "networkRequests": [
        {
          "url": "https://api.example.com/submit",
          "method": "POST",
          "status": 200,
          "timestamp": 1699876545130,
          "duration": 45
        }
      ]
    }
  ]
}
```

## Use Cases

### 🤖 AI-Powered Analysis
- Vectorize session data for embedding generation
- Question answering: "What did the user click on the checkout page?"
- Session understanding: "What errors occurred during signup?"

### 🐛 Debugging
- Visual playback of user sessions
- See exact DOM state before/after each action
- Identify UI issues and bugs

### 📊 Analytics
- User behavior analysis
- Interaction patterns
- Performance bottlenecks

### 🧪 Test Generation
- Convert user sessions to automated tests
- Generate test assertions from captured state
- Record real user flows

## Advantages Over Alternatives

### vs Playwright Trace
- ✅ Captures user actions, not programmatic scripts
- ✅ Simpler output format (JSON, not ZIP)
- ✅ Lightweight (no full frame hierarchy)
- ✅ Element highlighting built-in

### vs Screen Recording
- ✅ Interactive HTML (not just video)
- ✅ Searchable/queryable data
- ✅ Console and network data included
- ✅ Perfect for vectorization/AI

### vs Manual Snapshots
- ✅ Automatic before/after capture
- ✅ Action metadata included
- ✅ No manual intervention needed
- ✅ Consistent format

## Performance Considerations

### Lightweight by Design
- Console logs: Max 100 recent messages
- Network requests: Max 50 recent requests
- Screenshots: Viewport only (not full page)
- Actions queued to prevent race conditions

### Memory Management
- Rolling buffers for console/network
- Snapshots only captured on action
- No continuous recording overhead

## Future Enhancements

- [ ] Configurable capture depth
- [ ] Custom element selectors
- [ ] Video recording integration
- [ ] Real-time streaming
- [ ] Session replay viewer
- [ ] Automatic test generation
- [ ] Performance metrics capture
- [ ] Accessibility tree capture

## Technical Notes

### Snapshot Capture
Extracted from Playwright's `snapshotterInjected.ts`:

**Source File**: `packages/playwright-core/src/server/trace/recorder/snapshotterInjected.ts`

**What to Extract**:
- The `frameSnapshotStreamer()` function (approximately lines 30-400)
- Core DOM traversal and capture logic
- Shadow DOM handling
- Computed style capture
- Form state preservation (inputs, checkboxes, selects)
- Text escaping utilities

**What NOT to Include**:
- The init script wrapper/boilerplate
- Communication with Snapshotter class
- Frame ID tracking
- Resource blob SHA calculation (we'll handle differently)

**Adaptations Needed**:
- Simplify to just return snapshot data directly
- Remove frame hierarchy tracking
- Expose as `window.__playwrightCaptureSnapshot()`
- Keep computed styles inline for standalone HTML

**Key Features to Preserve**:
- Captures full DOM with computed styles
- Preserves shadow DOM
- Captures form state (inputs, checkboxes, selections)
- Inline styles for accurate rendering
- Text and attribute escaping

### Event Capture Phase
Uses `addEventListener` with `capture: true` to intercept events **before** they bubble, allowing us to capture the "before" state before the DOM updates.

### Element Highlighting
The `session-recorded-element` class is:
- Added after action completes
- Present in "after" snapshot only
- Removed immediately after snapshot
- Can be styled for visualization

## License

Same as Playwright (Apache 2.0)
