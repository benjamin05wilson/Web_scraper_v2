# Setup Guide - Windows Browser Scraper

## Prerequisites

### Required Software
1. **Node.js 18+** - [Download](https://nodejs.org/)
2. **Google Chrome** - Latest stable version
3. **Git** - For version control

### Recommended Hardware
- **GPU**: NVIDIA (NVENC) or Intel (QuickSync) for hardware encoding
- **RAM**: 8GB+ (browser + Node.js)
- **CPU**: 4+ cores recommended

## Installation

### 1. Clone and Install Dependencies

```bash
cd c:\Users\BVWILSON\Desktop\scraper\new
npm install
```

### 2. Install Playwright Browsers

```bash
npx playwright install chromium
# Or to use your installed Chrome:
npx playwright install chrome
```

### 3. Verify GPU Acceleration

Open Chrome and navigate to `chrome://gpu` to verify:
- Graphics Feature Status shows "Hardware accelerated"
- Video Decode/Encode shows hardware support

## Running the Application

### Development Mode

```bash
# Terminal 1: Start backend server
npm run server

# Terminal 2: Start frontend dev server
npm run client
```

Or run both concurrently:
```bash
npm run dev
```

### Access Points
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **WebSocket**: ws://localhost:3001/ws

## Configuration

### Environment Variables

Create a `.env` file (optional):
```env
PORT=3001
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

### Chrome Flags

The application automatically configures Chrome with optimized flags for:
- GPU acceleration (D3D11 ANGLE)
- Hardware video encoding
- Low-latency capture
- Anti-detection features

See [src/server/config/chrome-flags.ts](src/server/config/chrome-flags.ts) for details.

## Usage Guide

### 1. Create a Session

1. Enter a URL in the navigation bar
2. Click "Start Session"
3. Wait for browser to load and streaming to begin

### 2. Navigate and Interact

- Click, scroll, and type naturally in the browser view
- All interactions are forwarded to the real browser
- Keyboard shortcuts work (Ctrl+C, etc.)

### 3. Select Elements

1. Click "Select Mode" in the sidebar
2. Hover over elements to see highlights
3. Click an element to select it
4. Assign the selected element a role (Title, Price, URL, etc.)

### 4. Record Pre-Actions

For sites with popups, cookie banners, etc.:

1. Click "Start Recording"
2. Interact with the page (click accept buttons, close modals)
3. Click "Stop Recording"
4. These actions will run before each scrape

### 5. Configure and Execute

1. Set optional "Item Container" selector for repeated elements
2. Configure pagination if needed
3. Click "Execute Scrape"
4. View results in the Results panel
5. Export as JSON

## Troubleshooting

### Browser Not Starting

```
Error: Failed to launch chrome
```

**Solutions:**
1. Ensure Chrome is installed at the expected path
2. Try running as Administrator
3. Check if another Chrome instance is using the same debugging port

### Black Screen / No Video

```
No frames being received
```

**Solutions:**
1. Verify GPU drivers are up to date
2. Check Chrome GPU acceleration: `chrome://gpu`
3. Try reducing resolution in config
4. Check Windows Display settings for GPU preference

### High Latency

**Solutions:**
1. Enable hardware encoding in Chrome flags
2. Use wired network connection
3. Reduce capture resolution/framerate
4. Close other GPU-intensive applications

### Selector Not Working

```
Selector matches 0 elements
```

**Solutions:**
1. Use the "Test Selector" feature
2. Check if element loads dynamically (may need wait)
3. Try a different selector strategy (ID, class, text)
4. Verify the element exists on the page

### WebSocket Disconnects

```
WebSocket connection closed
```

**Solutions:**
1. Check backend server is running
2. Verify firewall isn't blocking connections
3. Check for errors in server console

## Performance Tuning

### For Lowest Latency

```typescript
// In chrome-flags.ts
'--disable-frame-rate-limit',
'--disable-gpu-vsync',
```

### For Best Quality

```typescript
// In WebRTCManager.ts
SCREENCAST_CONFIG.quality = 100;
SCREENCAST_CONFIG.maxWidth = 1920;
SCREENCAST_CONFIG.maxHeight = 1080;
```

### For Memory Optimization

```typescript
// In chrome-flags.ts
'--js-flags=--max-old-space-size=2048',
'--renderer-process-limit=2',
```

## Security Notes

⚠️ This application is designed for **local development and testing only**.

- Browser runs with security features disabled for scraping
- Do not expose the backend to the public internet
- Do not scrape sites without permission
- Respect robots.txt and rate limits
- Some sites may detect and block automated access

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/sessions` | GET | List active sessions |

### WebSocket Messages

See [ARCHITECTURE.md](ARCHITECTURE.md) for full message protocol documentation.

## Build for Production

```bash
npm run build
npm start
```

This will:
1. Build React frontend to `dist/client`
2. Compile TypeScript server to `dist/server`
3. Start production server
