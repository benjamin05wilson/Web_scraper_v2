# Browser Scraper Architecture

## System Overview

This is a production-grade interactive web scraper that streams a real Chromium browser to a localhost frontend with sub-frame latency, enabling natural mouse/keyboard interaction and DOM-based element selection.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (localhost:3000)                    │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌────────────────────────────────────────────┐   │
│  │   Sidebar   │  │              Browser View                   │   │
│  │             │  │  ┌──────────────────────────────────────┐  │   │
│  │ - Selectors │  │  │     WebRTC <video> / Canvas         │  │   │
│  │ - Recorder  │  │  │     (GPU-accelerated rendering)     │  │   │
│  │ - Config    │  │  └──────────────────────────────────────┘  │   │
│  │ - Results   │  │  ┌──────────────────────────────────────┐  │   │
│  │             │  │  │     Overlay Layer (highlights)       │  │   │
│  └─────────────┘  │  └──────────────────────────────────────┘  │   │
│                    └────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    WebSocket + WebRTC DataChannel
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         BACKEND (localhost:3001)                     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │  WebSocket      │  │  Browser        │  │  Streaming          │ │
│  │  Server         │──│  Manager        │──│  Manager            │ │
│  │                 │  │  (Playwright)   │  │  (WebRTC/Screencast)│ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘ │
│           │                    │                      │             │
│           ▼                    ▼                      ▼             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │  DOM            │  │  Interaction    │  │  Scraping           │ │
│  │  Inspector      │  │  Recorder       │  │  Engine             │ │
│  │  (CDP)          │  │  (DOM-based)    │  │  (Rapid execution)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CHROMIUM BROWSER (Headed)                       │
├─────────────────────────────────────────────────────────────────────┤
│  - GPU acceleration enabled (DX11/D3D11 ANGLE)                      │
│  - Hardware video encoding (NVENC/QuickSync)                        │
│  - Full JavaScript execution                                         │
│  - Tab Capture API / CDP Screencast                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Streaming Architecture

### Option 1: CDP Screencast (Development/Fallback)
- Uses Chrome DevTools Protocol `Page.startScreencast`
- JPEG frames sent via WebSocket binary messages
- ~30-50ms latency
- Works out of the box, no user interaction required

### Option 2: Production WebRTC (Lowest Latency)
- Uses `getDisplayMedia` with `preferCurrentTab: true`
- Native WebRTC peer connection
- Hardware-accelerated H264 encoding
- ~8-16ms latency
- Requires one-time user permission

### Option 3: Tab Capture Extension (Best Quality)
- Chrome extension with `tabCapture` permission
- Direct frame access, no dialog
- Hardware encoding available
- Requires extension installation

## Input Flow

```
User Input → Frontend → WebSocket/DataChannel → Backend → CDP → Browser
     ↓
   Canvas   ←  Frame   ←    WebSocket    ←   Screencast  ← Browser
```

### Input Event Types
1. **Mouse Events**: move, down, up, click, dblclick, contextmenu
2. **Keyboard Events**: keydown, keyup (with modifier support)
3. **Scroll Events**: wheel delta + position

### Latency Optimization
- WebRTC DataChannel (unordered, no retransmits) for input: ~1-5ms
- CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`: ~1ms
- Total input latency: ~5-10ms

## DOM Selection System

### Selection Flow
```
1. Enable Selection Mode → Inject DOM inspection script
2. Mouse Move → Get element at point → Generate selectors
3. Highlight element in overlay layer
4. Mouse Click → Capture element with selectors
5. User assigns role (title, price, URL, nextPage)
```

### Selector Generation (Priority Order)
1. **ID selector**: `#product-123`
2. **Text-based**: `button:has-text("Accept")`
3. **aria-label**: `[aria-label="Close"]`
4. **data-testid**: `[data-testid="product-card"]`
5. **Unique class**: `div.product-card.featured`
6. **Path selector**: `#main > div.container > div:nth-of-type(2)`

### Why DOM-Based Only
- Coordinates break on different viewports
- Coordinates break on dynamic layouts
- DOM selectors are stable and debuggable
- No OCR/vision overhead

## Interaction Recorder

### Recorded Actions
```typescript
{
  id: "uuid",
  type: "click" | "type" | "select" | "scroll" | "wait",
  selector: "button:has-text('Accept Cookies')",
  value?: "search term", // for type actions
  timestamp: 1234567890,
  description: "Click on 'Accept Cookies'"
}
```

### Use Cases
- Cookie banners
- Age verification modals
- Login flows
- Navigation sequences

### Strict Mode Rules
- ❌ No coordinates
- ❌ No heuristics
- ❌ No retries
- ✓ DOM selectors only
- ✓ Fail fast on invalid selector

## Scraping Engine

### Execution Flow
```
1. Navigate to startUrl
2. Execute pre-actions (recorded sequence)
3. Wait for DOM ready
4. Extract data using precompiled selectors
5. If pagination enabled:
   a. Click next page selector
   b. Wait for navigation/content
   c. Repeat extraction
6. Return results
```

### Extraction Methods
- **text**: `element.textContent.trim()`
- **href**: `element.getAttribute('href')` + URL resolution
- **src**: `element.getAttribute('src')` + URL resolution
- **attribute**: `element.getAttribute(name)`
- **innerHTML**: `element.innerHTML`

### Performance Optimizations
- CDP `Runtime.evaluate` for bulk extraction
- No Playwright auto-waits
- Precompiled selector queries
- Parallel extraction when possible

## Windows-Specific Optimizations

### Chrome Launch Flags
```javascript
[
  // GPU Acceleration
  '--enable-gpu',
  '--use-angle=d3d11',
  '--enable-gpu-rasterization',
  '--enable-zero-copy',
  '--enable-hardware-overlays',

  // WebRTC
  '--enable-accelerated-video-decode',
  '--enable-accelerated-video-encode',

  // Performance
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',

  // Anti-detection
  '--disable-blink-features=AutomationControlled',
]
```

### GPU Encoding
- **NVIDIA**: NVENC H264 encoder
- **Intel**: QuickSync H264 encoder
- **AMD**: VCE H264 encoder

### Environment Variables
```bash
ANGLE_DEFAULT_PLATFORM=d3d11
__NV_PRIME_RENDER_OFFLOAD=1
```

## Message Protocol

### WebSocket Message Format
```typescript
interface WSMessage<T> {
  type: WSMessageType;
  sessionId?: string;
  payload: T;
  timestamp: number;
}
```

### Message Types
| Type | Direction | Description |
|------|-----------|-------------|
| `session:create` | C→S | Create new browser session |
| `session:created` | S→C | Session created confirmation |
| `navigate` | C→S | Navigate to URL |
| `input:mouse` | C→S | Mouse event |
| `input:keyboard` | C→S | Keyboard event |
| `dom:select` | C→S | Toggle selection mode |
| `dom:highlight` | S→C | Element highlight info |
| `dom:selected` | S→C | Element selected |
| `selector:test` | C→S | Test CSS selector |
| `recorder:start` | C→S | Start recording |
| `recorder:action` | S→C | Action recorded |
| `scrape:execute` | C→S | Execute scrape config |
| `scrape:result` | S→C | Scrape results |

## File Structure

```
src/
├── server/
│   ├── index.ts              # Main WebSocket server
│   ├── browser/
│   │   └── BrowserManager.ts # Playwright browser control
│   ├── dom/
│   │   └── DOMInspector.ts   # Element selection & selectors
│   ├── recorder/
│   │   └── InteractionRecorder.ts # Action recording
│   ├── scraper/
│   │   └── ScrapingEngine.ts # Data extraction
│   ├── streaming/
│   │   ├── WebRTCManager.ts  # CDP screencast streaming
│   │   └── ProductionWebRTC.ts # Native WebRTC streaming
│   └── config/
│       └── chrome-flags.ts   # Windows-optimized flags
├── client/
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Main app component
│   ├── components/
│   │   ├── BrowserView.tsx   # Video/canvas display
│   │   ├── Sidebar.tsx       # Configuration UI
│   │   └── NavBar.tsx        # URL bar & controls
│   ├── hooks/
│   │   ├── useWebSocket.ts   # WebSocket connection
│   │   └── useBrowserSession.ts # Session state
│   └── styles/
│       └── global.css        # Dark theme styles
└── shared/
    └── types.ts              # Shared TypeScript types
```

## Success Criteria

✅ **Windows only** - Full Windows support with DirectX
✅ **Real Chromium browser** - Using installed Chrome via Playwright
✅ **Live interaction** - Mouse, keyboard, scroll all work
✅ **No screenshots** - Real-time video streaming
✅ **No polling** - Event-driven via CDP/WebSocket
✅ **No VNC/RDP** - Native WebRTC/Screencast
✅ **No iframe mirroring** - Direct browser capture
✅ **No coordinate-based** - DOM selectors only
✅ **JavaScript-heavy sites** - Full JS execution
✅ **Sub-frame latency** - 8-50ms depending on method

## Future Improvements

1. **Full WebRTC with SFU** - For multi-client viewing
2. **Tab Capture Extension** - For lowest latency without dialog
3. **Worker-based rendering** - Offload canvas operations
4. **WASM video decoder** - Client-side hardware decode
5. **Puppeteer alternative** - Direct CDP for smaller footprint
