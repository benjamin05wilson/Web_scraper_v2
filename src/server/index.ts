// ============================================================================
// MAIN SERVER - WebSocket + Express + WebRTC Signaling
// ============================================================================

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { v4 as uuid } from 'uuid';

import { BrowserManager, type BrowserSession } from './browser/BrowserManager.js';
import { DOMInspector } from './dom/DOMInspector.js';
import { InteractionRecorder } from './recorder/InteractionRecorder.js';
import { ScrapingEngine } from './scraper/ScrapingEngine.js';
import { WebRTCManager } from './streaming/WebRTCManager.js';

import type {
  WSMessage,
  SessionConfig,
  MouseEvent,
  KeyboardEvent,
  ScrollEvent,
  ScraperConfig,
} from '../shared/types.js';

const PORT = parseInt(process.env.PORT || '3002', 10);

// ============================================================================
// SESSION STATE
// ============================================================================

interface ActiveSession {
  id: string;
  ws: WebSocket;
  browserSession: BrowserSession;
  inspector: DOMInspector;
  recorder: InteractionRecorder;
  scraper: ScrapingEngine;
  webrtc: WebRTCManager;
  selectionMode: boolean;
  recordingMode: boolean;
  urlCaptureMode: boolean;
  capturedUrls: Array<{ url: string; text?: string; title?: string; timestamp: number }>;
  lastHoveredUrl: string | null;
  lastUrlCheckTime: number;
}

const sessions = new Map<string, ActiveSession>();
const browserManager = new BrowserManager();

// ============================================================================
// EXPRESS SERVER
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

// API endpoints for scraper configs
app.get('/api/sessions', (_, res) => {
  const sessionList = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    url: s.browserSession.page.url(),
    selectionMode: s.selectionMode,
    recordingMode: s.recordingMode,
  }));
  res.json(sessionList);
});

const httpServer = createServer(app);

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('[Server] WebSocket connection established');

  let currentSessionId: string | null = null;

  ws.on('message', async (data) => {
    try {
      const message: WSMessage = JSON.parse(data.toString());
      // Debug log for non-move mouse events
      if (message.type !== 'input:mouse' || (message.payload as any)?.type !== 'move') {
        console.log(`[Server] Message received: ${message.type}, sessionId: ${message.sessionId || currentSessionId || 'none'}`);
      }
      await handleMessage(ws, message, () => currentSessionId, (id) => (currentSessionId = id));
    } catch (error) {
      console.error('[Server] Message handling error:', error);
      sendError(ws, 'message_error', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  ws.on('close', async () => {
    console.log('[Server] WebSocket connection closed');
    if (currentSessionId) {
      await cleanupSession(currentSessionId);
    }
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
  });
});

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

async function handleMessage(
  ws: WebSocket,
  message: WSMessage,
  getSessionId: () => string | null,
  setSessionId: (id: string) => void
): Promise<void> {
  const { type, payload, sessionId } = message;

  switch (type) {
    // =========================================================================
    // SESSION MANAGEMENT
    // =========================================================================

    case 'session:create': {
      const config = payload as SessionConfig;
      const newSessionId = uuid();

      console.log(`[Server] Creating session ${newSessionId} for ${config.url}`);

      try {
        const browserSession = await browserManager.createSession(newSessionId, config);
        const inspector = new DOMInspector(browserSession.page, browserSession.cdp);
        const recorder = new InteractionRecorder(browserSession.page, browserSession.cdp);
        const scraper = new ScrapingEngine(browserSession.page, browserSession.cdp);
        // Pass viewport dimensions to match screencast to browser viewport
        const webrtc = new WebRTCManager(browserSession.page, browserSession.cdp, {
          width: config.viewport?.width || 1280,
          height: config.viewport?.height || 720,
        });

        // Set up callbacks
        inspector.setHoverCallback((info) => {
          send(ws, 'dom:highlight', { element: info }, newSessionId);
        });

        inspector.setSelectCallback((info) => {
          send(ws, 'dom:selected', { element: info }, newSessionId);
        });

        recorder.setActionCallback((action) => {
          send(ws, 'recorder:action', { action }, newSessionId);
        });

        // Set up URL capture callback
        inspector.setUrlHoverCallback((info) => {
          send(ws, 'url:hover', info, newSessionId);
        });

        // Inject scripts
        await inspector.inject();

        // Enable URL capture by default
        await inspector.enableUrlCapture();

        // Re-inject on navigation
        browserSession.page.on('domcontentloaded', async () => {
          await inspector.reinject();
          if (sessions.get(newSessionId)?.recordingMode) {
            await recorder.inject();
          }
          // Re-enable URL capture if it was enabled
          if (sessions.get(newSessionId)?.urlCaptureMode) {
            await inspector.enableUrlCapture();
          }
        });

        const session: ActiveSession = {
          id: newSessionId,
          ws,
          browserSession,
          inspector,
          recorder,
          scraper,
          webrtc,
          selectionMode: false,
          recordingMode: false,
          urlCaptureMode: true,
          capturedUrls: [],
          lastHoveredUrl: null,
          lastUrlCheckTime: 0,
        };

        sessions.set(newSessionId, session);
        setSessionId(newSessionId);

        send(ws, 'session:created', {
          sessionId: newSessionId,
          url: browserSession.page.url(),
          viewport: config.viewport,
        }, newSessionId);

        console.log(`[Server] Session ${newSessionId} created successfully`);
      } catch (error) {
        console.error('[Server] Session creation failed:', error);
        sendError(ws, 'session:error', error instanceof Error ? error.message : 'Session creation failed');
      }
      break;
    }

    case 'session:destroy': {
      const sid = sessionId || getSessionId();
      if (sid) {
        await cleanupSession(sid);
        send(ws, 'session:destroyed', { sessionId: sid }, sid);
      }
      break;
    }

    // =========================================================================
    // NAVIGATION
    // =========================================================================

    case 'navigate': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { url } = payload as { url: string };
      await browserManager.navigate(session.id, url);
      send(ws, 'navigate:complete', { url: session.browserSession.page.url() }, session.id);
      break;
    }

    // =========================================================================
    // INPUT EVENTS (via DataChannel ideally, fallback to WS)
    // =========================================================================

    case 'input:mouse': {
      const sid = sessionId || getSessionId();
      const session = getSession(sid);
      if (!session) {
        console.warn('[Server] input:mouse - no session for ID:', sid);
        return;
      }

      const event = payload as MouseEvent;
      // Only log clicks, not moves (too noisy)
      if (event.type !== 'move') {
        console.log(`[Server] Mouse ${event.type} at (${event.x}, ${event.y})`);
      }
      await browserManager.handleMouseEvent(session.id, event);

      // Check for URL at mouse position (for URL capture feature)
      // Throttle to max once per 100ms to avoid overloading
      const now = Date.now();
      if (session.urlCaptureMode && event.type === 'move' && now - session.lastUrlCheckTime > 100) {
        session.lastUrlCheckTime = now;
        try {
          const linkInfo = await session.inspector.getLinkAtPoint(event.x, event.y);
          const newUrl = linkInfo?.url || null;
          // Only send if URL changed
          if (newUrl !== session.lastHoveredUrl) {
            session.lastHoveredUrl = newUrl;
            send(ws, 'url:hover', linkInfo, session.id);
          }
        } catch {
          // Ignore errors during URL detection
        }
      }
      break;
    }

    case 'input:keyboard': {
      const sid = sessionId || getSessionId();
      const session = getSession(sid);
      if (!session) {
        console.warn('[Server] input:keyboard - no session for ID:', sid);
        return;
      }

      const event = payload as KeyboardEvent;
      console.log(`[Server] Keyboard ${event.type}: ${event.key}`);
      await browserManager.handleKeyboardEvent(session.id, event);
      break;
    }

    case 'input:scroll': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const event = payload as ScrollEvent;
      await browserManager.handleScroll(session.id, event);
      break;
    }

    // =========================================================================
    // DOM SELECTION
    // =========================================================================

    case 'dom:hover': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { x, y } = payload as { x: number; y: number };
      const element = await session.inspector.getElementAtPoint(x, y);
      if (element) {
        send(ws, 'dom:highlight', { element }, session.id);
      }
      break;
    }

    case 'dom:select': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      // Toggle selection mode
      session.selectionMode = !session.selectionMode;

      if (session.selectionMode) {
        await session.inspector.enableSelectionMode();
      } else {
        await session.inspector.disableSelectionMode();
      }

      send(ws, 'dom:select', { enabled: session.selectionMode }, session.id);
      break;
    }

    // =========================================================================
    // SELECTOR TESTING
    // =========================================================================

    case 'selector:test': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { selector } = payload as { selector: string };
      const result = await session.inspector.testSelector(selector);

      // Highlight first match
      if (result.valid && result.count > 0) {
        await session.inspector.highlightSelector(selector);
      }

      send(ws, 'selector:result', result, session.id);
      break;
    }

    case 'selector:findPattern': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { elements } = payload as { elements: any[] };
      console.log(`[Server] Finding pattern for ${elements.length} elements`);
      const pattern = await session.inspector.findCommonPattern(elements);

      if (pattern) {
        // Highlight all matching elements
        const count = await session.inspector.highlightAll(pattern.selector);
        console.log(`[Server] Found pattern: ${pattern.selector} (${count} matches)`);
        send(ws, 'selector:pattern', { ...pattern, count }, session.id);
      } else {
        send(ws, 'selector:pattern', { selector: null, count: 0, error: 'No common pattern found' }, session.id);
      }
      break;
    }

    case 'selector:highlightAll': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { selector } = payload as { selector: string };
      const count = await session.inspector.highlightAll(selector);
      send(ws, 'selector:highlighted', { selector, count }, session.id);
      break;
    }

    case 'selector:clearHighlight': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      await session.inspector.clearMultiHighlight();
      break;
    }

    // =========================================================================
    // RECORDING
    // =========================================================================

    case 'recorder:start': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { name, description } = payload as { name: string; description?: string };
      const sequence = await session.recorder.startRecording(name, description);
      session.recordingMode = true;

      send(ws, 'recorder:start', { sequence }, session.id);
      break;
    }

    case 'recorder:stop': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const sequence = await session.recorder.stopRecording();
      session.recordingMode = false;

      send(ws, 'recorder:stop', { sequence }, session.id);
      break;
    }

    // =========================================================================
    // SCRAPING
    // =========================================================================

    case 'scrape:configure': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const config = payload as ScraperConfig;
      const validation = await session.scraper.validateConfig(config);

      send(ws, 'scrape:configure', validation, session.id);
      break;
    }

    case 'scrape:execute': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const config = payload as ScraperConfig;

      // Disable selection mode during scraping
      if (session.selectionMode) {
        await session.inspector.disableSelectionMode();
        session.selectionMode = false;
      }

      console.log(`[Server] Executing scrape: ${config.name}`);
      const result = await session.scraper.execute(config);

      send(ws, 'scrape:result', result, session.id);
      break;
    }

    // =========================================================================
    // WEBRTC SIGNALING
    // =========================================================================

    case 'webrtc:offer': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      // Start CDP screencast as fallback
      await session.webrtc.startScreencast();

      // Set up frame forwarding
      session.webrtc.setFrameCallback((frame, _timestamp) => {
        // Send frame via binary WebSocket message
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(frame);
        }
      });

      send(ws, 'webrtc:answer', { mode: 'screencast', started: true }, session.id);
      break;
    }

    case 'webrtc:ice': {
      // Handle ICE candidates if using full WebRTC
      break;
    }

    // =========================================================================
    // URL CAPTURE
    // =========================================================================

    case 'url:captured': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { url, text, title } = payload as { url: string; text?: string; title?: string };

      // Add to captured URLs (avoid duplicates)
      const exists = session.capturedUrls.some(u => u.url === url);
      if (!exists) {
        session.capturedUrls.push({
          url,
          text,
          title,
          timestamp: Date.now(),
        });
        console.log(`[Server] URL captured: ${url}`);

        // Send updated history to client
        send(ws, 'url:history', { urls: session.capturedUrls }, session.id);
      }
      break;
    }

    case 'url:history': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      // Send current URL history
      send(ws, 'url:history', { urls: session.capturedUrls }, session.id);
      break;
    }

    // =========================================================================
    // CONTAINER EXTRACTION
    // =========================================================================

    case 'container:extract': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { selector } = payload as { selector: string };
      console.log(`[Server] Extracting container content for: ${selector}`);

      try {
        const content = await session.inspector.extractContainerContent(selector);
        send(ws, 'container:content', content, session.id);
      } catch (error) {
        console.error('[Server] Container extraction failed:', error);
        send(ws, 'container:content', {
          items: [],
          containerSelector: selector,
          error: error instanceof Error ? error.message : 'Extraction failed',
        }, session.id);
      }
      break;
    }

    default:
      console.warn(`[Server] Unknown message type: ${type}`);
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function getSession(sessionId: string | null): ActiveSession | null {
  if (!sessionId) {
    console.warn('[Server] No session ID provided. Active sessions:', Array.from(sessions.keys()));
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session) {
    console.warn(`[Server] Session not found: ${sessionId}. Active sessions:`, Array.from(sessions.keys()));
    return null;
  }
  return session;
}

function send(ws: WebSocket, type: string, payload: unknown, sessionId?: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const message: WSMessage = {
    type: type as WSMessage['type'],
    payload,
    sessionId,
    timestamp: Date.now(),
  };

  ws.send(JSON.stringify(message));
}

function sendError(ws: WebSocket, type: string, error: string): void {
  send(ws, type, { error });
}

async function cleanupSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  console.log(`[Server] Cleaning up session ${sessionId}`);

  try {
    await session.webrtc.stopScreencast();
    await browserManager.destroySession(sessionId);
  } catch (error) {
    console.error('[Server] Cleanup error:', error);
  }

  sessions.delete(sessionId);
}

// ============================================================================
// STARTUP
// ============================================================================

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 Browser Scraper Server                                   ║
║                                                               ║
║   HTTP:      http://localhost:${PORT}                           ║
║   WebSocket: ws://localhost:${PORT}/ws                          ║
║                                                               ║
║   Ready for connections...                                    ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');

  for (const sessionId of sessions.keys()) {
    await cleanupSession(sessionId);
  }

  await browserManager.cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] Terminating...');
  await browserManager.cleanup();
  process.exit(0);
});
