// ============================================================================
// MAIN SERVER - WebSocket + Express + WebRTC Signaling
// ============================================================================

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';

import { BrowserManager, type BrowserSession } from './browser/BrowserManager.js';
import { DOMInspector } from './dom/DOMInspector.js';
import { InteractionRecorder } from './recorder/InteractionRecorder.js';
import { ScrapingEngine } from './scraper/ScrapingEngine.js';
import { WebRTCManager } from './streaming/WebRTCManager.js';
import { scrapeNextUrlsFromList } from './scraper/NextScraper.js';

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

// Training endpoint - extracts selectors from labeled data
// For now, just returns the data back as-is since we're using manual selection
app.post('/api/train', (req, res) => {
  const { url, wanted_dict } = req.body;
  console.log(`[Server] Train request for ${url}`);

  // Return the selected data as results
  // The selectors were already captured during manual selection
  const results: Record<string, string[]> = {};

  if (wanted_dict) {
    for (const [field, items] of Object.entries(wanted_dict)) {
      if (Array.isArray(items) && items.length > 0) {
        results[field] = items.map((item: any) => item.text || item.href || item.src || '').filter(Boolean);
      }
    }
  }

  res.json({ success: true, results });
});

// Configs directory
const CONFIGS_DIR = path.join(process.cwd(), 'configs');

// Ensure configs directory exists
if (!fs.existsSync(CONFIGS_DIR)) {
  fs.mkdirSync(CONFIGS_DIR, { recursive: true });
}

// Save config endpoint
app.post('/api/save', (req, res) => {
  try {
    const { file_path, ...config } = req.body;

    if (!file_path) {
      return res.status(400).json({ error: 'file_path is required' });
    }

    const filename = file_path.endsWith('.json') ? file_path : `${file_path}.json`;
    const filePath = path.join(CONFIGS_DIR, filename);

    // Write config to file
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

    console.log(`[Server] Config saved to: ${filePath}`);
    res.json({ success: true, path: filePath });
  } catch (error) {
    console.error('[Server] Save error:', error);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// List configs endpoint
app.get('/api/configs', (_, res) => {
  try {
    const files = fs.readdirSync(CONFIGS_DIR).filter((f) => f.endsWith('.json'));
    const configs = files.map((f) => {
      const content = fs.readFileSync(path.join(CONFIGS_DIR, f), 'utf-8');
      return { name: f.replace('.json', ''), ...JSON.parse(content) };
    });
    res.json(configs);
  } catch (error) {
    res.json([]);
  }
});

// Get single config
app.get('/api/configs/:name', (req, res) => {
  try {
    const filePath = path.join(CONFIGS_DIR, `${req.params.name}.json`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json(JSON.parse(content));
    } else {
      res.status(404).json({ error: 'Config not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to read config' });
  }
});

// Delete config
app.delete('/api/configs/:name', (req, res) => {
  try {
    const filePath = path.join(CONFIGS_DIR, `${req.params.name}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Config not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete config' });
  }
});

// ============================================================================
// BATCH ENDPOINTS
// ============================================================================

// Next URL scraping endpoint
app.post('/api/batch/next-scrape', async (req, res) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, error: 'No URLs provided' });
    }

    console.log(`[Server] Starting Next URL scraping for ${urls.length} URLs`);

    const results = await scrapeNextUrlsFromList(urls);

    console.log(`[Server] Next URL scraping complete: ${results.length} products found`);

    res.json({
      success: true,
      results: results,
      count: results.length,
    });
  } catch (error) {
    console.error('[Server] Next scraping error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
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
          // Also highlight the selected element with scroll tracking
          if (info.css) {
            inspector.highlightSelected(info.css).catch(() => {});
          }
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
        // Clear any selected highlight when exiting selection mode
        console.log('[Server] Clearing selected highlight (selection mode off)');
        await session.inspector.clearSelectedHighlight().catch(() => {});
      }

      send(ws, 'dom:select', { enabled: session.selectionMode }, session.id);
      break;
    }

    // =========================================================================
    // AUTO-DETECT PRODUCT
    // =========================================================================

    case 'dom:autoDetect': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      // Prevent multiple simultaneous auto-detects
      if ((session as any)._autoDetecting) {
        console.log('[Server] Auto-detect already in progress, skipping');
        return;
      }
      (session as any)._autoDetecting = true;

      console.log('[Server] Auto-detecting product...');
      const detected = await session.inspector.autoDetectProduct();
      (session as any)._autoDetecting = false;

      if (detected) {
        // Send as a selected element so the UI can use it
        send(ws, 'dom:selected', { element: detected }, session.id);
        send(ws, 'dom:autoDetect', { success: true, element: detected }, session.id);

        // Also call highlightSelected to show the overlay highlight
        // Use the GENERIC selector (css) for highlighting, not cssSpecific
        // This ensures the highlight matches what will be extracted
        // The generic selector finds the FIRST matching element, which is what extraction uses
        const highlightSelector = detected.css;
        if (highlightSelector) {
          // Wait 600ms for smooth scroll to complete before highlighting
          setTimeout(async () => {
            console.log('[Server] Calling highlightSelected for auto-detected element:', highlightSelector);
            try {
              await session.inspector.highlightSelected(highlightSelector);
            } catch (err) {
              console.log('[Server] highlightSelected failed:', err);
            }
          }, 600);
        }
      } else {
        send(ws, 'dom:autoDetect', { success: false, error: 'No product found' }, session.id);
      }
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

      // Block navigation during recording to prevent accidental redirects
      const currentUrl = session.browserSession.page.url();
      await session.browserSession.page.route('**/*', async (route) => {
        const request = route.request();
        // Allow same-page requests (XHR, fetch, resources) but block navigation
        if (request.isNavigationRequest()) {
          const targetUrl = request.url();
          // Allow if staying on the same page (e.g., hash changes or same URL)
          if (targetUrl === currentUrl || targetUrl.startsWith(currentUrl + '#')) {
            await route.continue();
          } else {
            console.log(`[Server] Blocked navigation during recording: ${targetUrl}`);
            await route.abort('aborted');
          }
        } else {
          await route.continue();
        }
      });

      send(ws, 'recorder:start', { sequence }, session.id);
      break;
    }

    case 'recorder:stop': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const sequence = await session.recorder.stopRecording();
      session.recordingMode = false;

      // Remove navigation blocking when recording stops
      await session.browserSession.page.unroute('**/*');

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
      console.log(`[Server] scrape:execute received, sessionId from message: ${sessionId}`);
      console.log(`[Server] getSessionId() fallback: ${getSessionId()}`);
      const session = getSession(sessionId || getSessionId());
      if (!session) {
        console.error(`[Server] No session found for sessionId: ${sessionId || getSessionId()}`);
        return;
      }
      console.log(`[Server] Found session: ${session.id}`);

      const requestConfig = payload as ScraperConfig & { url?: string; targetProducts?: number };

      // Disable selection mode during scraping
      if (session.selectionMode) {
        await session.inspector.disableSelectionMode();
        session.selectionMode = false;
      }

      console.log(`[Server] Executing scrape: ${requestConfig.name}`);
      console.log(`[Server] Received URL: ${requestConfig.url}`);
      console.log(`[Server] Received startUrl: ${requestConfig.startUrl}`);

      // Load the saved config from disk if a name is provided
      let config: ScraperConfig;
      if (requestConfig.name) {
        const configPath = path.join(CONFIGS_DIR, `${requestConfig.name}.json`);
        if (fs.existsSync(configPath)) {
          const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          console.log(`[Server] Loaded config from: ${configPath}`);

          // Convert saved config format (Config type) to ScraperConfig format
          // Saved configs have selectors as: { Title?: string | string[], Price?: string | string[], ... }
          // ScrapingEngine expects: selectors: AssignedSelector[]
          const convertedSelectors: ScraperConfig['selectors'] = [];

          if (savedConfig.selectors && typeof savedConfig.selectors === 'object') {
            // Map field names to selector roles
            const fieldToRole: Record<string, string> = {
              'Title': 'title',
              'Price': 'price',
              'OriginalPrice': 'originalPrice',
              'SalePrice': 'salePrice',
              'URL': 'url',
              'Image': 'image',
            };

            for (const [field, selectorValue] of Object.entries(savedConfig.selectors)) {
              if (!selectorValue) continue;

              const role = fieldToRole[field] || field.toLowerCase();
              const selectorStrings = Array.isArray(selectorValue) ? selectorValue : [selectorValue];

              // Add each selector string as an AssignedSelector
              selectorStrings.forEach((css: string, index: number) => {
                if (typeof css === 'string' && css.trim()) {
                  convertedSelectors.push({
                    role: role as any,
                    selector: {
                      css: css.trim(),
                      xpath: '',
                      attributes: {},
                      tagName: '',
                      boundingBox: { x: 0, y: 0, width: 0, height: 0 },
                    },
                    extractionType: role === 'url' ? 'href' : role === 'image' ? 'src' : 'text',
                    priority: index, // First selector has priority 0 (highest)
                  });
                }
              });
            }
          }

          // If the saved config already has selectors in the correct format (AssignedSelector[]), use them
          if (Array.isArray(savedConfig.selectors)) {
            config = {
              ...savedConfig,
              name: requestConfig.name,
              startUrl: requestConfig.url || requestConfig.startUrl || savedConfig.startUrl || savedConfig.url || session.browserSession.page.url(),
              selectors: savedConfig.selectors,
              itemContainer: savedConfig.itemContainer,
              targetProducts: requestConfig.targetProducts || 0, // Pass target from request
            };
          } else {
            config = {
              name: requestConfig.name,
              startUrl: requestConfig.url || requestConfig.startUrl || savedConfig.startUrl || savedConfig.url || session.browserSession.page.url(),
              selectors: convertedSelectors,
              pagination: savedConfig.pagination ? {
                enabled: true,
                selector: savedConfig.pagination.selector || '',
                maxPages: savedConfig.pagination.max_pages || 1,
                waitAfterClick: 1000,
              } : undefined,
              itemContainer: savedConfig.itemContainer,
              autoScroll: savedConfig.autoScroll !== false,
              targetProducts: requestConfig.targetProducts || 0, // Pass target from request
            };
          }

          console.log(`[Server] Converted ${convertedSelectors.length} selectors from saved config`);
          if (config.itemContainer) {
            console.log(`[Server] Item container: ${config.itemContainer}`);
          }
        } else {
          console.error(`[Server] Config not found: ${configPath}`);
          send(ws, 'scrape:result', { success: false, error: `Config "${requestConfig.name}" not found` }, session.id);
          break;
        }
      } else {
        // Use config as-is, but ensure startUrl is set
        config = {
          ...requestConfig,
          startUrl: requestConfig.url || requestConfig.startUrl || session.browserSession.page.url(),
          selectors: requestConfig.selectors || [],
          targetProducts: requestConfig.targetProducts || 0,
        };
      }

      console.log(`[Server] Final startUrl for scrape: ${config.startUrl}`);
      console.log(`[Server] Target products: ${config.targetProducts || 'unlimited'}`);
      console.log(`[Server] Config selectors count: ${config.selectors?.length || 0}`);
      console.log(`[Server] Item container: ${config.itemContainer || 'none'}`);

      try {
        const result = await session.scraper.execute(config);
        console.log(`[Server] Scrape complete: ${result.items?.length || 0} items`);
        send(ws, 'scrape:result', result, session.id);
      } catch (scrapeError) {
        console.error(`[Server] Scrape execution error:`, scrapeError);
        send(ws, 'scrape:error', { error: String(scrapeError) }, session.id);
      }
      break;
    }

    // =========================================================================
    // WEBRTC SIGNALING
    // =========================================================================

    case 'webrtc:offer': {
      const targetSessionId = sessionId || getSessionId();
      console.log(`[Server] webrtc:offer received for sessionId: ${targetSessionId}`);
      const session = getSession(targetSessionId);
      if (!session) {
        console.log(`[Server] webrtc:offer - no session found for: ${targetSessionId}`);
        return;
      }
      console.log(`[Server] webrtc:offer - found session, starting screencast`);

      // Start CDP screencast as fallback
      await session.webrtc.startScreencast();

      // Set up frame forwarding
      session.webrtc.setFrameCallback((frame, _timestamp) => {
        // Send frame via binary WebSocket message
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(frame);
        }
      });

      console.log(`[Server] webrtc:offer - screencast started for session: ${session.id}`);
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
