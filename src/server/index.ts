// ============================================================================
// MAIN SERVER - WebSocket + Express + WebRTC Signaling
// ============================================================================

// Load environment variables from .env file
import 'dotenv/config';

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
import { PaginationDetector } from './scraper/PaginationDetector.js';
import { ScrollTestHandler } from './scraper/ScrollTestHandler.js';
import { PopupHandler } from './scraper/PopupHandler.js';
import { NetworkInterceptor, type NetworkInterceptorConfig } from './scraper/handlers/NetworkInterceptor.js';
import { getGeminiService } from './ai/GeminiService.js';

import type {
  WSMessage,
  SessionConfig,
  MouseEvent,
  KeyboardEvent,
  ScrollEvent,
  ScraperConfig,
  Config,
  AdvancedScraperConfig,
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
  scrollTestHandler?: ScrollTestHandler;
  networkInterceptor?: NetworkInterceptor;
}

const sessions = new Map<string, ActiveSession>();
const browserManager = new BrowserManager();

// ============================================================================
// EXPRESS SERVER
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// STATIC FILE SERVING (Production Only)
// ============================================================================

// Serve static files from built client directory in production
if (process.env.NODE_ENV === 'production') {
  const clientPath = path.join(process.cwd(), 'dist', 'client');

  // Serve static assets (JS, CSS, images) with caching
  app.use(express.static(clientPath, {
    maxAge: '1y', // Cache static assets for 1 year
    etag: true,
    lastModified: true,
  }));

  // SPA fallback: All non-API/non-WS routes serve index.html
  // This ensures React Router works on direct navigation/refresh
  app.get('*', (req, res, next) => {
    // Skip API routes, WebSocket, and health check
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/health')) {
      return next();
    }

    // Serve index.html for all other routes
    res.sendFile(path.join(clientPath, 'index.html'));
  });

  console.log('[Server] Production mode: Serving static files from', clientPath);
} else {
  console.log('[Server] Development mode: Frontend served by Vite dev server');
}

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

// AI status endpoint
app.get('/api/ai/status', (_, res) => {
  const gemini = getGeminiService();
  res.json({
    enabled: gemini.isEnabled,
    model: 'gemini-2.0-flash',
    rateLimitRemaining: gemini.getRateLimitRemaining(),
  });
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

      // Use AI-enhanced detection if available
      const gemini = getGeminiService();
      console.log(`[Server] Auto-detecting product (AI ${gemini.isEnabled ? 'enabled' : 'disabled'})...`);

      const detected = gemini.isEnabled
        ? await session.inspector.autoDetectProductWithAI()
        : await session.inspector.autoDetectProduct();
      (session as any)._autoDetecting = false;

      if (detected) {
        // Send as a selected element so the UI can use it
        send(ws, 'dom:selected', { element: detected }, session.id);

        // Capture screenshot of the detected element
        let screenshotBase64: string | null = null;
        const highlightSelector = detected.css;
        if (highlightSelector) {
          try {
            // Highlight and scroll to element first
            await session.inspector.highlightSelected(highlightSelector);
            await session.browserSession.page.waitForTimeout(300);

            // Take screenshot of the element
            const element = await session.browserSession.page.$(highlightSelector);
            if (element) {
              const screenshotBuffer = await element.screenshot({ type: 'png' });
              screenshotBase64 = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
              console.log('[Server] Captured product element screenshot');
            }
          } catch (err) {
            console.log('[Server] Screenshot capture failed:', err);
          }
        }

        send(ws, 'dom:autoDetect', {
          success: true,
          element: detected,
          screenshot: screenshotBase64,
        }, session.id);
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

          // Build advanced config from lazyLoad settings if present
          const typedSavedConfig = savedConfig as Config;
          let advancedConfig: AdvancedScraperConfig | undefined;
          if (typedSavedConfig.lazyLoad) {
            advancedConfig = {
              scrollStrategy: typedSavedConfig.lazyLoad.scrollStrategy,
              scrollDelay: typedSavedConfig.lazyLoad.scrollDelay,
              maxScrollIterations: typedSavedConfig.lazyLoad.maxScrollIterations,
              stabilityTimeout: typedSavedConfig.lazyLoad.stabilityTimeout,
              rapidScrollStep: typedSavedConfig.lazyLoad.rapidScrollStep,
              rapidScrollDelay: typedSavedConfig.lazyLoad.rapidScrollDelay,
              loadingIndicators: typedSavedConfig.lazyLoad.loadingIndicators,
            };
            console.log(`[Server] Applied lazyLoad settings: ${JSON.stringify(advancedConfig)}`);
          }

          // Convert dismiss_actions to preActions format for ScrapingEngine
          let preActions: ScraperConfig['preActions'] | undefined;
          if (savedConfig.dismiss_actions && Array.isArray(savedConfig.dismiss_actions) && savedConfig.dismiss_actions.length > 0) {
            preActions = {
              id: 'dismiss-actions',
              name: 'Dismiss Popups',
              createdAt: Date.now(),
              actions: savedConfig.dismiss_actions.map((action: any, idx: number) => ({
                id: `dismiss-${idx}`,
                type: 'click' as const,
                selector: action.selector,
                description: `Click ${action.selector}`,
                timestamp: action.timestamp || Date.now(),
              })),
            };
            console.log(`[Server] Converted ${savedConfig.dismiss_actions.length} dismiss actions to preActions`);
          }

          // Build pagination config based on saved pagination data
          let paginationConfig: ScraperConfig['pagination'] | undefined;
          let scrollPositions: number[] | undefined;

          if (savedConfig.pagination) {
            const paginationType = savedConfig.pagination.type;
            // For infinite_scroll, we don't need a selector - just enable auto-scroll
            if (paginationType === 'infinite_scroll') {
              // Infinite scroll is handled by autoScroll
              // If we have recorded scroll positions, use them
              if (savedConfig.pagination.scrollPositions && savedConfig.pagination.scrollPositions.length > 0) {
                scrollPositions = savedConfig.pagination.scrollPositions as number[];
                console.log(`[Server] Pagination type: infinite_scroll with ${scrollPositions!.length} recorded scroll positions`);
              } else {
                console.log(`[Server] Pagination type: infinite_scroll - using auto-scroll`);
              }
            } else if (paginationType === 'next_page' || paginationType === 'url_pattern') {
              paginationConfig = {
                enabled: true,
                type: paginationType,
                selector: savedConfig.pagination.selector || '',
                pattern: savedConfig.pagination.pattern,
                offset: savedConfig.pagination.offset,
                maxPages: savedConfig.pagination.max_pages || 10,
                waitAfterClick: 1000,
              };
              console.log(`[Server] Pagination type: ${paginationType}, selector: ${paginationConfig.selector || 'N/A'}`);
              if (paginationConfig.offset) {
                console.log(`[Server] Offset config: key=${paginationConfig.offset.key}, start=${paginationConfig.offset.start}, increment=${paginationConfig.offset.increment}`);
              }
            }
          }

          // Add scroll positions to advanced config if available
          if (scrollPositions && advancedConfig) {
            (advancedConfig as any).scrollPositions = scrollPositions;
          } else if (scrollPositions) {
            advancedConfig = { scrollPositions } as any;
          }

          // If the saved config already has selectors in the correct format (AssignedSelector[]), use them
          if (Array.isArray(savedConfig.selectors)) {
            config = {
              ...savedConfig,
              name: requestConfig.name,
              startUrl: requestConfig.url || requestConfig.startUrl || savedConfig.startUrl || savedConfig.url || session.browserSession.page.url(),
              selectors: savedConfig.selectors,
              preActions,
              pagination: paginationConfig,
              itemContainer: savedConfig.itemContainer || typedSavedConfig.itemContainer,
              targetProducts: requestConfig.targetProducts || typedSavedConfig.targetItems || 0,
              advanced: advancedConfig,
            };
          } else {
            config = {
              name: requestConfig.name,
              startUrl: requestConfig.url || requestConfig.startUrl || savedConfig.startUrl || savedConfig.url || session.browserSession.page.url(),
              selectors: convertedSelectors,
              preActions,
              pagination: paginationConfig,
              itemContainer: savedConfig.itemContainer || typedSavedConfig.itemContainer,
              autoScroll: savedConfig.autoScroll !== false,
              targetProducts: requestConfig.targetProducts || typedSavedConfig.targetItems || 0,
              advanced: advancedConfig,
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

      // Set up frame forwarding FIRST (before starting screencast)
      // This ensures the callback is set even if screencast was already running
      session.webrtc.setFrameCallback((frame, _timestamp) => {
        // Send frame via binary WebSocket message
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(frame);
        }
      });

      // Start CDP screencast (will do nothing if already running)
      if (!session.webrtc.isActive()) {
        await session.webrtc.startScreencast();
        console.log(`[Server] webrtc:offer - screencast started for session: ${session.id}`);
      } else {
        console.log(`[Server] webrtc:offer - screencast already running, updated callback for session: ${session.id}`);
      }
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

    // =========================================================================
    // PAGINATION DETECTION
    // =========================================================================

    case 'pagination:detect': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      console.log('[Server] Detecting pagination candidates...');
      try {
        const detector = new PaginationDetector(session.browserSession.page);
        const candidates = await detector.detectCandidates();
        console.log(`[Server] Found ${candidates.length} pagination candidates`);

        // Determine detected type based on candidates
        let detectedType: 'url_pattern' | 'next_page' | 'infinite_scroll' | null = null;
        if (candidates.length > 0) {
          const topCandidate = candidates[0];
          if (topCandidate.type === 'load_more') {
            detectedType = 'infinite_scroll';
          } else if (topCandidate.type === 'numbered' && topCandidate.attributes?.href) {
            detectedType = 'url_pattern';
          } else {
            detectedType = 'next_page';
          }
        }

        send(ws, 'pagination:candidates', { candidates, detectedType }, session.id);
      } catch (error) {
        console.error('[Server] Pagination detection failed:', error);
        send(ws, 'pagination:candidates', { candidates: [], detectedType: null, error: String(error) }, session.id);
      }
      break;
    }

    // Background pagination detection for automated builder flow
    // Tests both pagination clicks and infinite scroll, returns best method
    case 'pagination:autoStart': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { itemSelector } = (payload as { itemSelector?: string }) || {};

      // Use AI-enhanced detection if available
      const geminiForPagination = getGeminiService();
      console.log(`[Server] Starting smart pagination detection (AI ${geminiForPagination.isEnabled ? 'enabled' : 'disabled'})...`);

      // Run smart detection - tests both methods and picks best
      const detector = new PaginationDetector(session.browserSession.page);
      const detectMethod = geminiForPagination.isEnabled
        ? detector.detectBestMethodWithAI(itemSelector)
        : detector.detectBestMethod(itemSelector);

      detectMethod
        .then(result => {
          console.log(`[Server] Smart detection complete: method=${result.method}`);

          // Build pagination pattern for config
          let paginationPattern: {
            type: 'url_pattern' | 'next_page' | 'infinite_scroll';
            selector?: string;
            scrollPositions?: number[];
            productsPerPage?: number;
            offset?: {
              key: string;
              start: number;
              increment: number;
            };
          } | null = null;

          if (result.method === 'pagination' && result.pagination) {
            paginationPattern = {
              type: result.pagination.type,
              selector: result.pagination.selector,
              productsPerPage: result.pagination.productsLoaded,
            };
            // Include offset info if detected
            if (result.pagination.offset) {
              paginationPattern.offset = {
                key: result.pagination.offset.key,
                start: result.pagination.offset.start,
                increment: result.pagination.offset.increment,
              };
              console.log(`[Server] Detected offset pattern: ${result.pagination.offset.key}=${result.pagination.offset.start} (increment: ${result.pagination.offset.increment})`);
            }
          } else if (result.method === 'infinite_scroll' && result.scroll) {
            paginationPattern = {
              type: 'infinite_scroll',
              scrollPositions: result.scroll.scrollPositions,
              productsPerPage: result.scroll.productsLoaded,
            };
          }

          send(ws, 'pagination:result', {
            candidates: result.candidates,
            success: true,
            method: result.method,
            pagination: paginationPattern,
            hasInfiniteScroll: result.method === 'infinite_scroll',
          }, session.id);
        })
        .catch(error => {
          console.error('[Server] Smart pagination detection failed:', error);
          send(ws, 'pagination:result', { candidates: [], success: false, error: String(error) }, session.id);
        });

      // Immediately acknowledge the start
      send(ws, 'pagination:autoStart', { started: true }, session.id);
      break;
    }

    // =========================================================================
    // POPUP AUTO-CLOSE
    // =========================================================================

    case 'popup:autoClose': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      // Use AI-enhanced detection if available
      const geminiForPopups = getGeminiService();
      console.log(`[Server] Auto-closing popups (AI ${geminiForPopups.isEnabled ? 'enabled' : 'disabled'})...`);

      try {
        const handler = new PopupHandler(session.browserSession.page);
        const result = geminiForPopups.isEnabled
          ? await handler.autoClosePopupsWithAI()
          : await handler.autoClosePopups();

        console.log(`[Server] Popup auto-close complete: ${result.closed.length} closed, ${result.remaining} remaining`);

        // Convert closed results to dismiss actions format
        const dismissActions = result.closed
          .filter(c => c.success)
          .map(c => ({
            selector: c.selector,
            text: c.text,
          }));

        send(ws, 'popup:closed', {
          success: true,
          found: result.found,
          closed: result.closed.length,
          remaining: result.remaining,
          dismissActions,
        }, session.id);
      } catch (error) {
        console.error('[Server] Popup auto-close failed:', error);
        send(ws, 'popup:closed', {
          success: false,
          error: String(error),
          found: 0,
          closed: 0,
          remaining: 0,
          dismissActions: [],
        }, session.id);
      }
      break;
    }

    // =========================================================================
    // FIELD AUTO-LABELING (AI)
    // =========================================================================

    case 'fields:autoLabel': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const geminiForLabels = getGeminiService();
      if (!geminiForLabels.isEnabled) {
        send(ws, 'fields:labeled', {
          success: false,
          error: 'Gemini API not enabled',
          labels: [],
        }, session.id);
        break;
      }

      const { extractedItems, productSelector } = payload as {
        extractedItems: Array<{ index: number; type: 'text' | 'link' | 'image'; content: string; selector?: string }>;
        productSelector?: string;
      };

      console.log(`[Server] Auto-labeling ${extractedItems.length} fields with AI...`);

      try {
        // Take screenshot of product card if selector provided
        let screenshotBase64 = '';
        if (productSelector) {
          try {
            const element = await session.browserSession.page.$(productSelector);
            if (element) {
              const screenshotBuffer = await element.screenshot({ type: 'png' });
              screenshotBase64 = screenshotBuffer.toString('base64');
            }
          } catch (e) {
            // Fall back to full page screenshot
            const screenshotBuffer = await session.browserSession.page.screenshot({ type: 'png' });
            screenshotBase64 = screenshotBuffer.toString('base64');
          }
        } else {
          const screenshotBuffer = await session.browserSession.page.screenshot({ type: 'png' });
          screenshotBase64 = screenshotBuffer.toString('base64');
        }

        // Call Gemini for labeling
        const result = await geminiForLabels.labelFields(extractedItems, screenshotBase64);

        if (result.success && result.data) {
          console.log(`[Server] AI labeled ${result.data.labels.length} fields (latency: ${result.latencyMs}ms)`);
          send(ws, 'fields:labeled', {
            success: true,
            labels: result.data.labels,
            latencyMs: result.latencyMs,
          }, session.id);
        } else {
          send(ws, 'fields:labeled', {
            success: false,
            error: result.error || 'AI labeling failed',
            labels: [],
          }, session.id);
        }
      } catch (error) {
        console.error('[Server] Field auto-labeling failed:', error);
        send(ws, 'fields:labeled', {
          success: false,
          error: String(error),
          labels: [],
        }, session.id);
      }
      break;
    }

    // =========================================================================
    // SCROLL TEST
    // =========================================================================

    case 'scrollTest:start': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { itemSelector } = payload as { itemSelector: string };
      console.log(`[Server] Starting scroll test with item selector: ${itemSelector}`);

      try {
        const handler = new ScrollTestHandler(session.browserSession.page, itemSelector);
        await handler.startTest();
        session.scrollTestHandler = handler;
        send(ws, 'scrollTest:start', { started: true }, session.id);
      } catch (error) {
        console.error('[Server] Scroll test start failed:', error);
        send(ws, 'scrollTest:start', { started: false, error: String(error) }, session.id);
      }
      break;
    }

    case 'scrollTest:update': {
      const session = getSession(sessionId || getSessionId());
      if (!session || !session.scrollTestHandler) return;

      try {
        const update = await session.scrollTestHandler.getTestUpdate();
        send(ws, 'scrollTest:update', update, session.id);
      } catch (error) {
        console.error('[Server] Scroll test update failed:', error);
      }
      break;
    }

    case 'scrollTest:complete': {
      const session = getSession(sessionId || getSessionId());
      if (!session || !session.scrollTestHandler) {
        send(ws, 'scrollTest:result', { error: 'No scroll test in progress' }, session?.id);
        return;
      }

      try {
        const result = await session.scrollTestHandler.finishTest();
        session.scrollTestHandler = undefined;
        send(ws, 'scrollTest:result', result, session.id);
      } catch (error) {
        console.error('[Server] Scroll test finish failed:', error);
        send(ws, 'scrollTest:result', { error: String(error) }, session.id);
      }
      break;
    }

    // =========================================================================
    // NETWORK INTERCEPTION (for virtual scroll / XHR product extraction)
    // =========================================================================

    case 'network:startCapture': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const config = payload as NetworkInterceptorConfig | { autoDetect?: boolean };

      console.log('[Server] Starting network capture...');

      try {
        // Create network interceptor
        const interceptor = new NetworkInterceptor(
          session.browserSession.page,
          'autoDetect' in config && config.autoDetect
            ? { urlPatterns: [] } // Empty patterns = auto-detect mode
            : (config as NetworkInterceptorConfig)
        );

        // Start listening
        if ('autoDetect' in config && config.autoDetect) {
          await interceptor.startAutoDetect();
          console.log('[Server] Network capture started in auto-detect mode');
        } else {
          await interceptor.startListening();
          console.log('[Server] Network capture started with patterns:', (config as NetworkInterceptorConfig).urlPatterns);
        }

        session.networkInterceptor = interceptor;

        send(ws, 'network:startCapture', { success: true }, session.id);
      } catch (error) {
        console.error('[Server] Network capture start failed:', error);
        send(ws, 'network:startCapture', { success: false, error: String(error) }, session.id);
      }
      break;
    }

    case 'network:stopCapture': {
      const session = getSession(sessionId || getSessionId());
      if (!session || !session.networkInterceptor) {
        send(ws, 'network:stopCapture', { success: false, error: 'No capture in progress' }, session?.id);
        return;
      }

      console.log('[Server] Stopping network capture...');

      try {
        // Check if we were in auto-detect mode
        const detectedPatterns = session.networkInterceptor.stopAutoDetect();
        session.networkInterceptor.stopListening();

        const products = session.networkInterceptor.getProducts();
        console.log(`[Server] Network capture stopped. Products: ${products.length}, Patterns: ${detectedPatterns.length}`);

        // Send detected patterns if any
        if (detectedPatterns.length > 0) {
          send(ws, 'network:patternDetected', { patterns: detectedPatterns }, session.id);
        }

        send(ws, 'network:stopCapture', {
          success: true,
          productCount: products.length,
          patternCount: detectedPatterns.length,
        }, session.id);
      } catch (error) {
        console.error('[Server] Network capture stop failed:', error);
        send(ws, 'network:stopCapture', { success: false, error: String(error) }, session.id);
      }
      break;
    }

    case 'network:getProducts': {
      const session = getSession(sessionId || getSessionId());
      if (!session || !session.networkInterceptor) {
        send(ws, 'network:products', { products: [], error: 'No capture in progress' }, session?.id);
        return;
      }

      const products = session.networkInterceptor.getProducts();
      console.log(`[Server] Returning ${products.length} captured products`);

      send(ws, 'network:products', { products }, session.id);
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
