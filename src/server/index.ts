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
import { PaginationVerifier } from './scraper/PaginationVerifier.js';
import { PaginationDemoHandler } from './scraper/PaginationDemoHandler.js';
import { ScrollTestHandler } from './scraper/ScrollTestHandler.js';
import { PopupHandler } from './scraper/PopupHandler.js';
import { NetworkInterceptor, type NetworkInterceptorConfig } from './scraper/handlers/NetworkInterceptor.js';
import { getGeminiService } from './ai/GeminiService.js';
import { BrowserPool } from './browser/BrowserPool.js';
import { getConfigCache, resetConfigCache } from './config/ConfigCache.js';
import type { Page, CDPSession } from 'playwright';

import type {
  WSMessage,
  SessionConfig,
  MouseEvent,
  KeyboardEvent,
  ScrollEvent,
  ScraperConfig,
  Config,
  AdvancedScraperConfig,
  ScrapeResult,
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
  paginationDemoHandler?: PaginationDemoHandler;
}

const sessions = new Map<string, ActiveSession>();
const browserManager = new BrowserManager();

// ============================================================================
// BATCH PROCESSING STATE
// ============================================================================

let batchPool: BrowserPool | null = null;
const batchBrowserJobs = new Map<string, { slotId: number; domain: string }>();
// Store pending jobs waiting for captcha solve
const batchPendingCaptchaJobs = new Map<string, {
  configName: string;
  url: string;
  targetProducts: number;
  challengeType: string;
  detectedAt: number;
}>();
// Track active screencasts for batch browsers (browserId -> cleanup function)
const batchScreencasts = new Map<string, () => void>();

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
// SHARED SCRAPING FUNCTION (used by both single scraper and batch mode)
// ============================================================================

/**
 * Build a ScraperConfig from a saved config file - shared logic for config loading.
 * Returns the config object without executing the scrape.
 */
async function buildScraperConfig(
  configName: string,
  startUrl: string,
  targetProducts: number
): Promise<ScraperConfig> {
  // Load the saved config from disk
  const configPath = path.join(CONFIGS_DIR, `${configName}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config "${configName}" not found`);
  }

  const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log(`[buildScraperConfig] Loaded config from: ${configPath}`);

  // Check if this is the NEW format with saleProduct/nonSaleProduct sections
  const isNewFormat = savedConfig.selectors?.saleProduct || savedConfig.selectors?.nonSaleProduct;

  // Helper to convert a section's selectors
  const convertSectionSelectors = (
    section: Record<string, string | string[]>,
    productType: 'sale' | 'nonSale'
  ): ScraperConfig['selectors'] => {
    const result: ScraperConfig['selectors'] = [];
    const fieldToRole: Record<string, string> = {
      'Title': 'title',
      'Price': 'price',
      'URL': 'url',
      'Image': 'image',
    };

    for (const [field, selectorValue] of Object.entries(section)) {
      if (!selectorValue) continue;

      const role = fieldToRole[field] || field.toLowerCase();
      const selectorStrings = Array.isArray(selectorValue) ? selectorValue : [selectorValue];

      selectorStrings.forEach((css: string, index: number) => {
        if (typeof css === 'string' && css.trim()) {
          result.push({
            role: role as 'title' | 'price' | 'url' | 'image',
            selector: {
              css: css.trim(),
              xpath: '',
              attributes: {},
              tagName: '',
              boundingBox: { x: 0, y: 0, width: 0, height: 0 },
            },
            extractionType: role === 'url' ? 'href' : role === 'image' ? 'src' : 'text',
            priority: index,
            productType,
          });
        }
      });
    }
    return result;
  };

  // Prepare selector sets for both product types
  let saleProductSelectors: ScraperConfig['selectors'] = [];
  let nonSaleProductSelectors: ScraperConfig['selectors'] = [];
  let convertedSelectors: ScraperConfig['selectors'] = [];

  if (isNewFormat) {
    console.log(`[buildScraperConfig] Using NEW config format with saleProduct/nonSaleProduct sections`);
    if (savedConfig.selectors.saleProduct) {
      saleProductSelectors = convertSectionSelectors(savedConfig.selectors.saleProduct, 'sale');
    }
    if (savedConfig.selectors.nonSaleProduct) {
      nonSaleProductSelectors = convertSectionSelectors(savedConfig.selectors.nonSaleProduct, 'nonSale');
    }
    convertedSelectors = [...saleProductSelectors, ...nonSaleProductSelectors];
  } else if (savedConfig.selectors && typeof savedConfig.selectors === 'object') {
    console.log(`[buildScraperConfig] Using OLD config format with flat selectors`);
    const fieldToRole: Record<string, string> = {
      'Title': 'title',
      'Price': 'price',
      'RRP': 'originalPrice',
      'Sale Price': 'salePrice',
      'OriginalPrice': 'originalPrice',
      'SalePrice': 'salePrice',
      'URL': 'url',
      'Image': 'image',
    };

    for (const [field, selectorValue] of Object.entries(savedConfig.selectors)) {
      if (!selectorValue) continue;
      const role = fieldToRole[field] || field.toLowerCase();
      const selectorStrings = Array.isArray(selectorValue) ? selectorValue : [selectorValue];

      selectorStrings.forEach((css: string, index: number) => {
        if (typeof css === 'string' && css.trim()) {
          convertedSelectors.push({
            role: role as 'title' | 'price' | 'url' | 'image' | 'originalPrice' | 'salePrice',
            selector: {
              css: css.trim(),
              xpath: '',
              attributes: {},
              tagName: '',
              boundingBox: { x: 0, y: 0, width: 0, height: 0 },
            },
            extractionType: role === 'url' ? 'href' : role === 'image' ? 'src' : 'text',
            priority: index,
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
  }

  // Build pagination config
  let paginationConfig: ScraperConfig['pagination'] | undefined;
  let scrollPositions: number[] | undefined;

  if (savedConfig.pagination) {
    const paginationType = savedConfig.pagination.type;
    if (paginationType === 'infinite_scroll') {
      if (savedConfig.pagination.scrollPositions && savedConfig.pagination.scrollPositions.length > 0) {
        scrollPositions = savedConfig.pagination.scrollPositions as number[];
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
    }
  }

  // Add scroll positions to advanced config if available
  if (scrollPositions && advancedConfig) {
    (advancedConfig as AdvancedScraperConfig & { scrollPositions?: number[] }).scrollPositions = scrollPositions;
  } else if (scrollPositions) {
    advancedConfig = { scrollPositions } as AdvancedScraperConfig & { scrollPositions: number[] };
  }

  // Build the final ScraperConfig
  let config: ScraperConfig;
  if (Array.isArray(savedConfig.selectors)) {
    config = {
      ...savedConfig,
      name: configName,
      startUrl: startUrl,
      selectors: savedConfig.selectors,
      pagination: paginationConfig,
      itemContainer: savedConfig.itemContainer || typedSavedConfig.itemContainer,
      targetProducts: targetProducts || typedSavedConfig.targetItems || 0,
      advanced: advancedConfig,
    };
  } else {
    config = {
      name: configName,
      startUrl: startUrl,
      selectors: convertedSelectors,
      saleProductSelectors: isNewFormat ? saleProductSelectors : undefined,
      nonSaleProductSelectors: isNewFormat ? nonSaleProductSelectors : undefined,
      pagination: paginationConfig,
      itemContainer: savedConfig.itemContainer || typedSavedConfig.itemContainer,
      autoScroll: savedConfig.autoScroll !== false,
      targetProducts: targetProducts || typedSavedConfig.targetItems || 0,
      advanced: advancedConfig,
    };
  }

  return config;
}

/**
 * Execute scraping with a config - shared logic for single scraper page and batch mode.
 * This ensures both modes use identical config loading, selector conversion, and execution.
 */
async function executeScraperWithConfig(
  page: Page,
  cdp: CDPSession,
  configName: string,
  startUrl: string,
  targetProducts: number
): Promise<ScrapeResult> {
  // Load the saved config from disk
  const configPath = path.join(CONFIGS_DIR, `${configName}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config "${configName}" not found`);
  }

  const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log(`[executeScraperWithConfig] Loaded config from: ${configPath}`);

  // Check if this is the NEW format with saleProduct/nonSaleProduct sections
  const isNewFormat = savedConfig.selectors?.saleProduct || savedConfig.selectors?.nonSaleProduct;

  // Convert saved config format to ScraperConfig format
  // NEW format: { saleProduct: { Title, Price, URL, Image }, nonSaleProduct: { Title, Price, URL, Image } }
  // OLD format: { Title, Price, RRP, 'Sale Price', URL, Image }
  // ScrapingEngine expects: selectors with productType info for new format

  // Helper to convert a section's selectors
  const convertSectionSelectors = (
    section: Record<string, string | string[]>,
    productType: 'sale' | 'nonSale'
  ): ScraperConfig['selectors'] => {
    const result: ScraperConfig['selectors'] = [];
    const fieldToRole: Record<string, string> = {
      'Title': 'title',
      'Price': 'price',
      'URL': 'url',
      'Image': 'image',
    };

    for (const [field, selectorValue] of Object.entries(section)) {
      if (!selectorValue) continue;

      const role = fieldToRole[field] || field.toLowerCase();
      const selectorStrings = Array.isArray(selectorValue) ? selectorValue : [selectorValue];

      selectorStrings.forEach((css: string, index: number) => {
        if (typeof css === 'string' && css.trim()) {
          result.push({
            role: role as 'title' | 'price' | 'url' | 'image',
            selector: {
              css: css.trim(),
              xpath: '',
              attributes: {},
              tagName: '',
              boundingBox: { x: 0, y: 0, width: 0, height: 0 },
            },
            extractionType: role === 'url' ? 'href' : role === 'image' ? 'src' : 'text',
            priority: index,
            productType, // NEW: Tag selectors with their product type
          });
        }
      });
    }
    return result;
  };

  // Prepare selector sets for both product types
  let saleProductSelectors: ScraperConfig['selectors'] = [];
  let nonSaleProductSelectors: ScraperConfig['selectors'] = [];
  let convertedSelectors: ScraperConfig['selectors'] = [];

  if (isNewFormat) {
    // NEW FORMAT: Separate sale and non-sale selectors
    console.log(`[executeScraperWithConfig] Using NEW config format with saleProduct/nonSaleProduct sections`);

    if (savedConfig.selectors.saleProduct) {
      saleProductSelectors = convertSectionSelectors(savedConfig.selectors.saleProduct, 'sale');
      console.log(`[executeScraperWithConfig] Sale product selectors: ${saleProductSelectors.length}`);
    }
    if (savedConfig.selectors.nonSaleProduct) {
      nonSaleProductSelectors = convertSectionSelectors(savedConfig.selectors.nonSaleProduct, 'nonSale');
      console.log(`[executeScraperWithConfig] Non-sale product selectors: ${nonSaleProductSelectors.length}`);
    }

    // Combined selectors for backward compat (ScrapingEngine will handle separation)
    convertedSelectors = [...saleProductSelectors, ...nonSaleProductSelectors];
  } else if (savedConfig.selectors && typeof savedConfig.selectors === 'object') {
    // OLD FORMAT: Flat selectors
    console.log(`[executeScraperWithConfig] Using OLD config format with flat selectors`);

    const fieldToRole: Record<string, string> = {
      'Title': 'title',
      'Price': 'price',
      'RRP': 'originalPrice',           // From builder UI "RRP" label
      'Sale Price': 'salePrice',        // From builder UI "Sale Price" label
      'OriginalPrice': 'originalPrice', // Legacy/direct config format
      'SalePrice': 'salePrice',         // Legacy/direct config format
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
            role: role as 'title' | 'price' | 'url' | 'image' | 'originalPrice' | 'salePrice',
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
    console.log(`[executeScraperWithConfig] Applied lazyLoad settings: ${JSON.stringify(advancedConfig)}`);
  }

  // NOTE: preActions/dismiss_actions are NOT used - PopupHandler handles popups automatically
  // This is more reliable and faster than manual pre-action clicks

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
        console.log(`[executeScraperWithConfig] Pagination type: infinite_scroll with ${scrollPositions!.length} recorded scroll positions`);
      } else {
        console.log(`[executeScraperWithConfig] Pagination type: infinite_scroll - using auto-scroll`);
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
      console.log(`[executeScraperWithConfig] Pagination type: ${paginationType}, selector: ${paginationConfig.selector || 'N/A'}`);
      if (paginationConfig.offset) {
        console.log(`[executeScraperWithConfig] Offset config: key=${paginationConfig.offset.key}, start=${paginationConfig.offset.start}, increment=${paginationConfig.offset.increment}`);
      }
    }
  }

  // Add scroll positions to advanced config if available
  if (scrollPositions && advancedConfig) {
    (advancedConfig as AdvancedScraperConfig & { scrollPositions?: number[] }).scrollPositions = scrollPositions;
  } else if (scrollPositions) {
    advancedConfig = { scrollPositions } as AdvancedScraperConfig & { scrollPositions: number[] };
  }

  // Build the final ScraperConfig
  let config: ScraperConfig;

  // If the saved config already has selectors in the correct format (AssignedSelector[]), use them
  if (Array.isArray(savedConfig.selectors)) {
    config = {
      ...savedConfig,
      name: configName,
      startUrl: startUrl,
      selectors: savedConfig.selectors,
      // preActions removed - PopupHandler handles popups automatically
      pagination: paginationConfig,
      itemContainer: savedConfig.itemContainer || typedSavedConfig.itemContainer,
      targetProducts: targetProducts || typedSavedConfig.targetItems || 0,
      advanced: advancedConfig,
    };
  } else {
    config = {
      name: configName,
      startUrl: startUrl,
      selectors: convertedSelectors,
      // NEW: Include separate selector sets for sale/non-sale product detection
      saleProductSelectors: isNewFormat ? saleProductSelectors : undefined,
      nonSaleProductSelectors: isNewFormat ? nonSaleProductSelectors : undefined,
      // preActions removed - PopupHandler handles popups automatically
      pagination: paginationConfig,
      itemContainer: savedConfig.itemContainer || typedSavedConfig.itemContainer,
      autoScroll: savedConfig.autoScroll !== false,
      targetProducts: targetProducts || typedSavedConfig.targetItems || 0,
      advanced: advancedConfig,
    };
  }

  console.log(`[executeScraperWithConfig] Final startUrl: ${config.startUrl}`);
  console.log(`[executeScraperWithConfig] Target products: ${config.targetProducts || 'unlimited'}`);
  console.log(`[executeScraperWithConfig] Config selectors count: ${config.selectors?.length || 0}`);
  console.log(`[executeScraperWithConfig] Item container: ${config.itemContainer || 'none'}`);
  if (isNewFormat) {
    console.log(`[executeScraperWithConfig] Using NEW format: sale=${saleProductSelectors.length}, nonSale=${nonSaleProductSelectors.length} selectors`);
  }

  // Create scraper and execute
  const scraper = new ScrapingEngine(page, cdp);
  const result = await scraper.execute(config);
  console.log(`[executeScraperWithConfig] Scrape complete: ${result.items?.length || 0} items`);

  return result;
}

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
        // Choose browser mode based on config
        let browserSession;
        if (config.useRealChrome) {
          console.log('[Server] Using Real Chrome mode (CDP connection)');
          browserSession = await browserManager.connectToRealChrome(newSessionId, config);
        } else if (config.usePersistentProfile) {
          console.log('[Server] Using Persistent Profile mode');
          browserSession = await browserManager.createPersistentSession(newSessionId, config);
        } else {
          browserSession = await browserManager.createSession(newSessionId, config);
        }
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

          // Re-check for captcha after navigation (for retry support)
          const session = sessions.get(newSessionId);
          if (session?.browserSession.cloudflareBypass) {
            try {
              const challenge = await session.browserSession.cloudflareBypass.detectChallenge();
              if (challenge !== 'none') {
                console.log(`[Server] CAPTCHA detected after navigation: ${challenge}`);
                send(ws, 'captcha:status', {
                  hasChallenge: true,
                  challengeType: challenge,
                  url: session.browserSession.page.url(),
                  isRetry: true,
                }, newSessionId);
              }
            } catch (error) {
              console.error('[Server] CAPTCHA re-check failed:', error);
            }
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
      console.log(`[Server] Auto-detecting product (AI ${gemini.isEnabled ? 'enabled - using multi-step pipeline' : 'disabled'})...`);

      // Use the new multi-step AI pipeline for maximum accuracy when AI is enabled
      const detected = gemini.isEnabled
        ? await session.inspector.autoDetectProductWithMultiStepAI()
        : await session.inspector.autoDetectProduct();
      (session as any)._autoDetecting = false;

      if (detected) {
        // Send as a selected element so the UI can use it
        send(ws, 'dom:selected', { element: detected }, session.id);

        // Capture screenshot of the detected element
        let screenshotBase64: string | null = null;
        let screenshotBuffer: Buffer | null = null;
        const highlightSelector = detected.css;
        if (highlightSelector) {
          try {
            // Highlight and scroll to element first
            await session.inspector.highlightSelected(highlightSelector);
            await session.browserSession.page.waitForTimeout(300);

            // Take screenshot of the element
            const element = await session.browserSession.page.$(highlightSelector);
            if (element) {
              screenshotBuffer = await element.screenshot({ type: 'png' });
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

        // =====================================================================
        // AUTO-LABELING: Extract content and label with AI automatically
        // =====================================================================
        if (gemini.isEnabled && highlightSelector) {
          try {
            console.log('[Server] Auto-extracting content for AI labeling...');

            // Extract content from the detected product card
            const contentResult = await session.inspector.extractContainerContent(highlightSelector);

            if (contentResult.items && contentResult.items.length > 0) {
              console.log(`[Server] Extracted ${contentResult.items.length} items, sending to AI for labeling...`);

              // Send extraction result to client
              send(ws, 'container:content', contentResult, session.id);

              // Prepare items for AI labeling
              const extractedItems = contentResult.items.map((item, index) => ({
                index,
                type: item.type as 'text' | 'link' | 'image',
                content: item.value,
                selector: item.selector,
              }));

              // Get screenshot for labeling (reuse if we have it)
              let labelScreenshotBase64 = screenshotBuffer ? screenshotBuffer.toString('base64') : '';
              if (!labelScreenshotBase64) {
                const fullScreenshot = await session.browserSession.page.screenshot({ type: 'png' });
                labelScreenshotBase64 = fullScreenshot.toString('base64');
              }

              // Call AI for labeling
              const labelResult = await gemini.labelFields(extractedItems, labelScreenshotBase64);

              if (labelResult.success && labelResult.data) {
                console.log(`[Server] AI auto-labeled ${labelResult.data.labels.length} fields (latency: ${labelResult.latencyMs}ms)`);

                // Log price handling for debugging
                const priceLabels = labelResult.data.labels.filter(l => l.field === 'price' || l.field === 'original_price');
                if (priceLabels.length > 1) {
                  console.log(`[Server] Multiple price fields detected: ${priceLabels.map(l => `${l.field}(idx:${l.index})`).join(', ')}`);
                }

                send(ws, 'fields:labeled', {
                  success: true,
                  labels: labelResult.data.labels,
                  latencyMs: labelResult.latencyMs,
                  autoLabeled: true, // Flag to indicate this was automatic
                }, session.id);
              } else {
                console.log('[Server] AI auto-labeling failed:', labelResult.error);
              }
            } else {
              console.log('[Server] No content extracted for auto-labeling');
            }
          } catch (labelError) {
            console.error('[Server] Auto-labeling error:', labelError);
            // Don't send error to client - auto-labeling is optional enhancement
          }
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
      // Scraper page flow - use session's existing browser (user has already navigated)
      const session = getSession(sessionId || getSessionId());
      if (!session) {
        console.error(`[Server] No session found for sessionId: ${sessionId || getSessionId()}`);
        return;
      }

      const requestConfig = payload as ScraperConfig & { url?: string; targetProducts?: number };

      // Disable selection mode during scraping
      if (session.selectionMode) {
        await session.inspector.disableSelectionMode();
        session.selectionMode = false;
      }

      if (!requestConfig.name) {
        send(ws, 'scrape:error', { error: 'Config name is required' }, session.id);
        break;
      }

      const targetProducts = requestConfig.targetProducts || 0;

      console.log(`[Server] Executing scrape: ${requestConfig.name}, target: ${targetProducts || 'unlimited'}`);

      try {
        // Load and build config using the shared helper
        const config = await buildScraperConfig(
          requestConfig.name,
          session.browserSession.page.url(), // Use current page URL (user already navigated)
          targetProducts
        );

        // Use SESSION's scraper - this scrapes the CURRENT page without re-navigating
        // This is different from batch which needs to navigate to each URL
        config.startUrl = ''; // Empty = don't navigate, scrape current page

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

    // New: AI-verified pagination testing for 100% accurate detection
    case 'pagination:testAll': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { itemSelector } = (payload as { itemSelector: string });

      if (!itemSelector) {
        send(ws, 'pagination:allTested', {
          success: false,
          error: 'itemSelector is required for pagination verification',
          testedMethods: [],
        }, session.id);
        break;
      }

      console.log(`[Server] Starting AI-verified pagination testing with itemSelector: ${itemSelector}`);

      // Create verifier with item selector
      const verifier = new PaginationVerifier(session.browserSession.page, itemSelector);

      // Run verification with progress reporting
      verifier.testAllMethods((current, total, methodName) => {
        // Send progress update
        send(ws, 'pagination:testProgress', {
          current,
          total,
          methodName,
        }, session.id);
      })
        .then(result => {
          console.log(`[Server] Pagination testing complete: ${result.testedMethods.length} methods tested`);
          console.log(`[Server] Best method: ${result.bestMethod?.method || 'none'} (confidence: ${result.bestMethod?.confidence.toFixed(2) || 'N/A'})`);

          send(ws, 'pagination:allTested', {
            success: true,
            testedMethods: result.testedMethods,
            bestMethod: result.bestMethod,
            totalTestDurationMs: result.totalTestDurationMs,
          }, session.id);
        })
        .catch(error => {
          console.error('[Server] Pagination testing failed:', error);
          send(ws, 'pagination:allTested', {
            success: false,
            error: String(error),
            testedMethods: [],
          }, session.id);
        });

      break;
    }

    // User selected a pagination method from the tested results
    case 'pagination:selectMethod': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { method } = payload as { method: any };
      console.log(`[Server] User selected pagination method: ${method?.method}`);

      // Just acknowledge - the client will store this in config
      send(ws, 'pagination:result', {
        success: true,
        method: method?.method || 'none',
        pagination: method ? {
          type: method.method === 'infinite_scroll' ? 'infinite_scroll' : 'next_page',
          selector: method.selector,
        } : null,
      }, session.id);
      break;
    }

    // =========================================================================
    // USER-GUIDED PAGINATION DEMO
    // =========================================================================

    // Start user demonstration mode for pagination
    case 'pagination:startDemo': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { itemSelector } = payload as { itemSelector: string };

      if (!itemSelector) {
        send(ws, 'pagination:demoError', { error: 'itemSelector is required' }, session.id);
        break;
      }

      console.log(`[Server] Starting pagination demo with itemSelector: ${itemSelector}`);

      try {
        const handler = new PaginationDemoHandler(session.browserSession.page);

        // Set up event callback for auto-complete and wrong navigation
        handler.setEventCallback((event) => {
          switch (event.type) {
            case 'autoComplete':
              // Auto-complete triggered - send result to client
              console.log('[Server] Pagination demo auto-completed');
              session.paginationDemoHandler = undefined;
              send(ws, 'pagination:demoResult', event.data, session.id);
              break;
            case 'wrongNavigation':
              // User clicked on wrong element, navigated back
              console.log('[Server] Pagination demo - wrong navigation detected');
              send(ws, 'pagination:demoWrongNav', event.data, session.id);
              break;
            case 'error':
              console.error('[Server] Pagination demo error:', event.data);
              send(ws, 'pagination:demoError', event.data, session.id);
              break;
          }
        });

        session.paginationDemoHandler = handler;

        const result = await handler.startDemo(itemSelector);
        send(ws, 'pagination:demoStarted', {
          productCount: result.productCount,
          url: result.url,
        }, session.id);
      } catch (error) {
        console.error('[Server] Pagination demo start failed:', error);
        send(ws, 'pagination:demoError', { error: String(error) }, session.id);
      }
      break;
    }

    // Handle scroll during demo
    case 'pagination:demoScroll': {
      const session = getSession(sessionId || getSessionId());
      if (!session || !session.paginationDemoHandler) return;

      // Silently ignore if demo is no longer active (e.g., already auto-completed)
      if (!session.paginationDemoHandler.isActive()) {
        return;
      }

      const { deltaY } = payload as { deltaY: number };

      try {
        const result = await session.paginationDemoHandler.handleScroll(deltaY);
        send(ws, 'pagination:demoProgress', {
          type: 'scroll',
          currentCount: result.currentCount,
          delta: result.delta,
          shouldAutoComplete: result.shouldAutoComplete,
          accumulatedScroll: result.accumulatedScroll,
        }, session.id);
      } catch (error: any) {
        // Only log if it's not a "demo not active" error (which is expected during race conditions)
        if (!error.message?.includes('Demo not active')) {
          console.error('[Server] Pagination demo scroll failed:', error);
        }
        // Don't send error to client for expected race conditions
      }
      break;
    }

    // Handle click during demo
    case 'pagination:demoClick': {
      const session = getSession(sessionId || getSessionId());
      if (!session || !session.paginationDemoHandler) return;

      const { x, y } = payload as { x: number; y: number };

      try {
        const result = await session.paginationDemoHandler.handleClick(x, y);
        send(ws, 'pagination:demoProgress', {
          type: 'click',
          selector: result.selector,
          text: result.text,
          currentCount: result.currentCount,
          delta: result.delta,
          urlChanged: result.urlChanged,
          wrongNavigation: result.wrongNavigation,
          shouldAutoComplete: result.shouldAutoComplete,
        }, session.id);
      } catch (error: any) {
        console.error('[Server] Pagination demo click failed:', error);
        send(ws, 'pagination:demoError', { error: error.message }, session.id);
      }
      break;
    }

    // Manual complete demonstration (user clicks Done)
    case 'pagination:demoComplete': {
      const session = getSession(sessionId || getSessionId());
      if (!session || !session.paginationDemoHandler) {
        send(ws, 'pagination:demoError', { error: 'No demo in progress' }, session?.id);
        return;
      }

      try {
        const result = await session.paginationDemoHandler.completeDemo();
        session.paginationDemoHandler = undefined;
        send(ws, 'pagination:demoResult', result, session.id);
      } catch (error: any) {
        console.error('[Server] Pagination demo complete failed:', error);
        send(ws, 'pagination:demoError', { error: error.message }, session.id);
      }
      break;
    }

    // Cancel demonstration
    case 'pagination:demoCancel': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      if (session.paginationDemoHandler) {
        session.paginationDemoHandler.cancelDemo();
        session.paginationDemoHandler = undefined;
        console.log('[Server] Pagination demo cancelled');
      }
      break;
    }

    // =========================================================================
    // CAPTCHA DETECTION & POLLING
    // =========================================================================

    case 'captcha:check': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      console.log('[Server] Checking for CAPTCHA...');

      try {
        // Create CloudflareBypass if not exists
        if (!session.browserSession.cloudflareBypass) {
          const { CloudflareBypass } = await import('./browser/CloudflareBypass.js');
          session.browserSession.cloudflareBypass = new CloudflareBypass(session.browserSession.page);
        }

        const challengeType = await session.browserSession.cloudflareBypass.detectChallenge();
        console.log(`[Server] CAPTCHA check result: ${challengeType}`);

        send(ws, 'captcha:status', {
          hasChallenge: challengeType !== 'none',
          challengeType,
          url: session.browserSession.page.url(),
        }, session.id);
      } catch (error) {
        console.error('[Server] CAPTCHA check failed:', error);
        send(ws, 'captcha:status', {
          hasChallenge: false,
          challengeType: 'none',
          error: String(error),
        }, session.id);
      }
      break;
    }

    case 'captcha:startPolling': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { timeoutMs = 120000 } = payload as { timeoutMs?: number };
      console.log(`[Server] Starting CAPTCHA solve polling (timeout: ${timeoutMs}ms)...`);

      try {
        // Create CloudflareBypass if not exists
        if (!session.browserSession.cloudflareBypass) {
          const { CloudflareBypass } = await import('./browser/CloudflareBypass.js');
          session.browserSession.cloudflareBypass = new CloudflareBypass(session.browserSession.page);
        }

        // Use existing waitForManualSolve with polling
        const solved = await session.browserSession.cloudflareBypass.waitForManualSolve(timeoutMs);

        if (solved) {
          console.log('[Server] CAPTCHA solved successfully');
          send(ws, 'captcha:solved', {
            success: true,
            url: session.browserSession.page.url(),
          }, session.id);
        } else {
          console.log('[Server] CAPTCHA solve timed out');
          send(ws, 'captcha:timeout', {
            timedOut: true,
            url: session.browserSession.page.url(),
          }, session.id);
        }
      } catch (error) {
        console.error('[Server] CAPTCHA polling failed:', error);
        send(ws, 'captcha:timeout', {
          error: String(error),
        }, session.id);
      }
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

    // =========================================================================
    // BUILDER WIZARD - Field Confirmation
    // =========================================================================

    case 'builder:findDiverseExamples': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { containerSelector, maxPerType = 2 } = payload as {
        containerSelector: string;
        maxPerType?: number;
      };

      console.log(`[Server] Finding diverse product examples for: ${containerSelector}`);

      try {
        const result = await session.inspector.productDetector.findDiverseExamples(
          containerSelector,
          maxPerType
        );

        console.log(`[Server] Found ${result.withSale.length} sale items, ${result.withoutSale.length} non-sale items`);

        send(ws, 'builder:diverseExamples', {
          success: true,
          ...result,
        }, session.id);
      } catch (error) {
        console.error('[Server] findDiverseExamples failed:', error);
        send(ws, 'builder:diverseExamples', {
          success: false,
          error: String(error),
          withSale: [],
          withoutSale: [],
        }, session.id);
      }
      break;
    }

    case 'builder:captureFieldScreenshot': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { containerSelector, fieldSelector, highlightColor = '#ff0000' } = payload as {
        containerSelector: string;
        fieldSelector: string;
        highlightColor?: string;
      };

      console.log(`[Server] Capturing field screenshot: ${fieldSelector} in ${containerSelector}`);

      try {
        const result = await session.inspector.productDetector.captureFieldScreenshot(
          containerSelector,
          fieldSelector,
          highlightColor
        );

        if (result) {
          send(ws, 'builder:fieldScreenshot', {
            success: true,
            ...result,
          }, session.id);
        } else {
          send(ws, 'builder:fieldScreenshot', {
            success: false,
            error: 'Failed to capture screenshot',
          }, session.id);
        }
      } catch (error) {
        console.error('[Server] captureFieldScreenshot failed:', error);
        send(ws, 'builder:fieldScreenshot', {
          success: false,
          error: String(error),
        }, session.id);
      }
      break;
    }

    case 'builder:generateWizardSteps': {
      const session = getSession(sessionId || getSessionId());
      if (!session) return;

      const { containerSelector, phase, immediateNonSale } = payload as {
        containerSelector: string;
        phase?: 'sale' | 'nonSale';
        immediateNonSale?: boolean; // NEW: true = all fields, false = RRP only
      };
      const isNonSalePhase = phase === 'nonSale';
      const responseType = isNonSalePhase ? 'builder:nonSaleWizardSteps' : 'builder:wizardSteps';

      console.log(`[Server] Generating wizard steps for: ${containerSelector}, phase: ${phase || 'sale'}, immediateNonSale: ${immediateNonSale}`);

      try {
        // Step 1: Find diverse examples (with sale and without)
        const examples = await session.inspector.productDetector.findDiverseExamples(
          containerSelector,
          2
        );

        console.log(`[Server] Diverse examples found - withSale: ${examples.withSale.length}, withoutSale: ${examples.withoutSale.length}`);
        if (examples.withSale.length > 0) {
          console.log(`[Server] First sale example:`, JSON.stringify(examples.withSale[0], null, 2));
        }
        if (examples.withoutSale.length > 0) {
          console.log(`[Server] First non-sale example:`, JSON.stringify(examples.withoutSale[0], null, 2));
          console.log(`[Server] Non-sale example field names:`, examples.withoutSale[0].fields.map((f: { field: string }) => f.field));
        }

        // Check if we have the right type of examples for this phase
        if (isNonSalePhase && examples.withoutSale.length === 0) {
          send(ws, responseType, {
            success: false,
            error: 'No non-sale product examples found',
            steps: [],
          }, session.id);
          break;
        }

        if (!isNonSalePhase && examples.withSale.length === 0 && examples.withoutSale.length === 0) {
          send(ws, responseType, {
            success: false,
            error: 'No product examples found',
            steps: [],
          }, session.id);
          break;
        }

        const steps: Array<{
          field: string;
          question: string;
          screenshot: string;
          extractedValue: string;
          selector: string;
          elementBounds: { x: number; y: number; width: number; height: number };
          cardType: 'withSale' | 'withoutSale';
        }> = [];

        const fieldColors: Record<string, string> = {
          'Title': '#0070f3',
          'RRP': '#28a745',
          'Sale Price': '#17c653',
          'URL': '#ffc107',
          'Image': '#17a2b8',
        };

        // Helper to capture a field screenshot and add to steps
        const captureFieldStep = async (
          example: typeof examples.withSale[0],
          fieldData: { field: string; selector: string },
          question: string,
          cardType: 'withSale' | 'withoutSale'
        ) => {
          const highlightColor = fieldColors[fieldData.field] || '#ff0000';
          console.log(`[Server] Capturing screenshot for ${cardType} field ${fieldData.field}: container=${example.selector}, field=${fieldData.selector}`);

          const screenshot = await session.inspector.productDetector.captureFieldScreenshot(
            example.selector,
            fieldData.selector,
            highlightColor
          );

          if (screenshot) {
            console.log(`[Server] Screenshot result for ${fieldData.field} (${cardType}): ${screenshot.screenshot.length} bytes`);
            steps.push({
              field: fieldData.field,
              question,
              screenshot: screenshot.screenshot,
              extractedValue: screenshot.fieldValue,
              selector: fieldData.selector,
              elementBounds: screenshot.fieldBounds,
              cardType,
            });
          } else {
            console.log(`[Server] No screenshot for ${fieldData.field} (${cardType})`);
          }
        };

        // Track auto-detected fields that we don't ask the user about (e.g., RRP for sale products)
        const autoDetectedFields: Array<{ field: string; selector: string; value: string }> = [];

        // PHASE-BASED PROCESSING: Generate steps based on the requested phase
        if (isNonSalePhase) {
          // NON-SALE PHASE: Generate non-sale product steps
          // - If immediateNonSale=true: Show ALL fields (Title, RRP, URL, Image) - before pagination
          // - If immediateNonSale=false: Show RRP ONLY - after pagination (other fields already confirmed)
          const nonSaleExample = examples.withoutSale[0];
          console.log(`[Server] NON-SALE PHASE: Processing non-sale product fields (immediateNonSale=${immediateNonSale})...`);
          console.log(`[Server] NON-SALE example fields:`, nonSaleExample.fields.map(f => ({ field: f.field, value: f.value?.substring(0, 30) })));

          // Title - only for immediate wizard (before pagination)
          if (immediateNonSale) {
            const nonSaleTitleField = nonSaleExample.fields.find(f => f.field === 'Title');
            if (nonSaleTitleField) {
              await captureFieldStep(nonSaleExample, nonSaleTitleField, '📦 NON-SALE PRODUCT: Is this the TITLE?', 'withoutSale');
            } else {
              console.log(`[Server] NON-SALE: No Title field found`);
            }
          }

          // RRP - always ask (this is the key field for non-sale products)
          const nonSaleRrpField = nonSaleExample.fields.find(f => f.field === 'RRP');
          if (nonSaleRrpField) {
            await captureFieldStep(nonSaleExample, nonSaleRrpField, '📦 NON-SALE PRODUCT: Is this the REGULAR PRICE? (Full price, not discounted)', 'withoutSale');
          } else {
            console.log(`[Server] NON-SALE: No RRP field found - available fields:`, nonSaleExample.fields.map(f => f.field));
          }

          // Non-sale products don't have Sale Price, skip it

          // URL - only for immediate wizard (before pagination)
          if (immediateNonSale) {
            const nonSaleUrlField = nonSaleExample.fields.find(f => f.field === 'URL');
            if (nonSaleUrlField) {
              await captureFieldStep(nonSaleExample, nonSaleUrlField, '📦 NON-SALE PRODUCT: Is this the PRODUCT URL?', 'withoutSale');
            } else {
              console.log(`[Server] NON-SALE: No URL field found`);
            }
          }

          // Image - only for immediate wizard (before pagination)
          if (immediateNonSale) {
            const nonSaleImageField = nonSaleExample.fields.find(f => f.field === 'Image');
            if (nonSaleImageField) {
              await captureFieldStep(nonSaleExample, nonSaleImageField, '📦 NON-SALE PRODUCT: Is this the PRODUCT IMAGE?', 'withoutSale');
            } else {
              console.log(`[Server] NON-SALE: No Image field found`);
            }
          }

          console.log(`[Server] NON-SALE PHASE complete: generated ${steps.length} steps (immediateNonSale=${immediateNonSale})`);
        } else {
          // SALE PHASE (default): Only generate sale product steps (before pagination)
          // For sale products: Only ask about Sale Price (NOT RRP) - RRP is auto-detected silently
          if (examples.withSale.length > 0) {
            const saleExample = examples.withSale[0];
            console.log(`[Server] SALE PHASE: Processing sale product fields...`);

            const saleTitleField = saleExample.fields.find(f => f.field === 'Title');
            if (saleTitleField) {
              await captureFieldStep(saleExample, saleTitleField, '🏷️ SALE PRODUCT: Is this the TITLE?', 'withSale');
            }

            // NOTE: RRP is auto-detected silently for sale products - we don't ask the user about it
            // The RRP selector is still available in the detected fields for the config
            const saleRrpField = saleExample.fields.find(f => f.field === 'RRP');
            if (saleRrpField) {
              console.log(`[Server] SALE PHASE: RRP auto-detected silently: ${saleRrpField.selector} = "${saleRrpField.value?.substring(0, 30)}"`);
              // Add to auto-detected fields so client can include it in the config
              autoDetectedFields.push({
                field: 'RRP',
                selector: saleRrpField.selector,
                value: saleRrpField.value || '',
              });
            }

            // Only ask user to confirm the Sale Price (the discounted price)
            const salePriceField = saleExample.fields.find(f => f.field === 'Sale Price');
            if (salePriceField) {
              await captureFieldStep(saleExample, salePriceField, '🏷️ SALE PRODUCT: Is this the SALE PRICE? (Current discounted price)', 'withSale');
            }

            const saleUrlField = saleExample.fields.find(f => f.field === 'URL');
            if (saleUrlField) {
              await captureFieldStep(saleExample, saleUrlField, '🏷️ SALE PRODUCT: Is this the PRODUCT URL?', 'withSale');
            }

            const saleImageField = saleExample.fields.find(f => f.field === 'Image');
            if (saleImageField) {
              await captureFieldStep(saleExample, saleImageField, '🏷️ SALE PRODUCT: Is this the PRODUCT IMAGE?', 'withSale');
            }
          } else if (examples.withoutSale.length > 0) {
            // Fallback: No sale products, use non-sale for the initial phase
            const nonSaleExample = examples.withoutSale[0];
            console.log(`[Server] SALE PHASE but only NON-SALE products found, processing non-sale fields...`);

            for (const fieldData of nonSaleExample.fields) {
              const questions: Record<string, string> = {
                'Title': '📦 NON-SALE PRODUCT: Is this the TITLE?',
                'RRP': '📦 NON-SALE PRODUCT: Is this the REGULAR PRICE?',
                'URL': '📦 NON-SALE PRODUCT: Is this the PRODUCT URL?',
                'Image': '📦 NON-SALE PRODUCT: Is this the PRODUCT IMAGE?',
              };
              await captureFieldStep(nonSaleExample, fieldData, questions[fieldData.field] || `Is this the ${fieldData.field}?`, 'withoutSale');
            }
          }
        }

        console.log(`[Server] Generated ${steps.length} wizard steps total for phase: ${phase || 'sale'}`);
        if (autoDetectedFields.length > 0) {
          console.log(`[Server] Auto-detected fields (not shown to user): ${JSON.stringify(autoDetectedFields)}`);
        }

        send(ws, responseType, {
          success: true,
          steps,
          autoDetectedFields, // Fields like RRP that were detected but not shown to user
          exampleCount: {
            withSale: examples.withSale.length,
            withoutSale: examples.withoutSale.length,
          },
        }, session.id);
      } catch (error) {
        console.error('[Server] generateWizardSteps failed:', error);
        send(ws, responseType, {
          success: false,
          error: String(error),
          steps: [],
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

    // =========================================================================
    // BATCH PROCESSING - Browser Pool & HTTP-First Scraping
    // =========================================================================

    case 'batch:start': {
      const { warmupCount = 10, maxSlots = 10, domains = [] } = payload as {
        warmupCount?: number;
        maxSlots?: number;
        domains?: string[];
      };

      console.log(`[Server] Starting batch with warmupCount=${warmupCount}, maxSlots=${maxSlots}, domains=${domains.length}`);

      try {
        const startTime = Date.now();

        // Create pool if not exists
        if (!batchPool) {
          batchPool = new BrowserPool({ maxSize: maxSlots, warmupCount });
        }

        // Run warmup tasks in PARALLEL for faster startup
        const configCache = getConfigCache();

        const [configResult, browserWarmupResult] = await Promise.all([
          // 1. Pre-load all configs into memory cache
          configCache.preload().then((result) => {
            console.log(`[Server] Config cache ready: ${result.loaded} configs`);
            return result;
          }).catch((err) => {
            console.error('[Server] Config cache preload failed:', err);
            return { loaded: 0, errors: [err.message] };
          }),

          // 2. Warm up browser pool (with domain pre-navigation if domains provided)
          (domains.length > 0
            ? batchPool.warmupWithDomains?.(domains, warmupCount) || batchPool.warmup(warmupCount)
            : batchPool.warmup(warmupCount)
          ).then(() => {
            const stats = batchPool!.getStats();
            console.log(`[Server] Browser pool ready: ${stats.total} browsers`);
            return stats;
          }).catch((err) => {
            console.error('[Server] Browser warmup failed:', err);
            return { total: 0, idle: 0, busy: 0, unhealthy: 0 };
          }),
        ]);

        const totalTime = Date.now() - startTime;
        const browserStats = browserWarmupResult as { total: number; idle: number; busy: number; unhealthy: number };

        send(ws, 'batch:poolReady', {
          poolSize: browserStats.total,
          idleBrowsers: browserStats.idle,
          httpScraperAvailable: false, // HTTP scraper removed - browser only
          configsCached: configResult.loaded,
          warmupTimeMs: totalTime,
        }, sessionId);

        console.log(`[Server] Batch pool ready in ${totalTime}ms: ${browserStats.total} browsers, ${configResult.loaded} configs cached`);
      } catch (error) {
        console.error('[Server] Batch start failed:', error);
        sendError(ws, 'batch:error', error instanceof Error ? error.message : 'Batch start failed');
      }
      break;
    }

    case 'batch:stop': {
      console.log('[Server] Stopping batch...');

      try {
        // Shutdown browser pool and clear config cache
        await Promise.all([
          // Browser pool (wait for busy browsers with timeout)
          batchPool?.shutdown(true).finally(() => {
            batchPool = null;
          }),
          // Config cache (just clear memory)
          Promise.resolve(resetConfigCache()),
        ]);

        batchBrowserJobs.clear();

        send(ws, 'batch:stopped', {}, sessionId);
        console.log('[Server] Batch stopped');
      } catch (error) {
        console.error('[Server] Batch stop failed:', error);
        sendError(ws, 'batch:error', error instanceof Error ? error.message : 'Batch stop failed');
      }
      break;
    }

    case 'batch:acquireBrowser': {
      const { slotId, preferredDomain } = payload as { slotId: number; preferredDomain?: string };

      if (!batchPool) {
        send(ws, 'batch:error', { error: 'Pool not initialized' }, sessionId);
        break;
      }

      try {
        const browser = await batchPool.acquire(preferredDomain);

        if (!browser) {
          send(ws, 'batch:browserUnavailable', { slotId }, sessionId);
          break;
        }

        // Track the browser assignment
        batchBrowserJobs.set(browser.id, { slotId, domain: preferredDomain || '' });

        send(ws, 'batch:browserAcquired', {
          slotId,
          browserId: browser.id,
        }, sessionId);
      } catch (error) {
        console.error('[Server] Browser acquire failed:', error);
        send(ws, 'batch:browserUnavailable', { slotId, error: (error as Error).message }, sessionId);
      }
      break;
    }

    case 'batch:releaseBrowser': {
      const { browserId } = payload as { browserId: string };

      if (batchPool) {
        batchPool.release(browserId);
        batchBrowserJobs.delete(browserId);
      }
      break;
    }

    case 'batch:updateQueueDepth': {
      // Queue depth tracking (autoscaler removed)
      break;
    }

    case 'batch:browserScrape': {
      // Browser-based scraping - uses SAME logic as single scraper page
      const { browserId, configName, url, targetProducts = 100, jobId } = payload as {
        browserId: string;
        configName: string;
        url: string;
        targetProducts?: number;
        jobId?: string;
      };

      if (!batchPool || batchPool.isShutdown()) {
        send(ws, 'batch:scrapeResult', {
          browserId,
          success: false,
          error: 'Pool not initialized or shutting down',
          items: [],
          jobId,
        }, sessionId);
        break;
      }

      const browser = batchPool.get(browserId);
      if (!browser) {
        send(ws, 'batch:scrapeResult', {
          browserId,
          success: false,
          error: 'Browser not found',
          items: [],
          jobId,
        }, sessionId);
        break;
      }

      // CRITICAL: Mark browser as executing BEFORE any work starts
      // This prevents the browser from being reused while scrape is running
      batchPool.markExecuting(browserId, jobId);

      try {
        console.log(`[Server] batch:browserScrape starting for ${url} with config ${configName}, targetProducts=${targetProducts} (job: ${jobId?.substring(0, 8) || 'none'})`);

        // EXACT SAME LOGIC AS SCRAPER PAGE:
        // 1. Navigate to URL (like user does in scraper page)
        await browser.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });

        // 2. Build config with empty startUrl (don't re-navigate)
        const config = await buildScraperConfig(configName, '', targetProducts);

        // 3. Use browser's existing scraper instance if available, otherwise create new
        // This ensures pagination state is handled the same way
        if (!browser.scraper) {
          browser.scraper = new ScrapingEngine(browser.page, browser.cdp);
        }
        const result = await browser.scraper.execute(config);

        console.log(`[Server] batch:browserScrape completed for ${url}: ${result.items?.length || 0} items, success=${result.success}`);

        // Check if scrape was blocked by bot protection (captcha, cloudflare, etc.)
        if (!result.success && result.errors?.some(e =>
          e.includes('Cloudflare') || e.includes('CAPTCHA') || e.includes('access denied') || e.includes('blocked')
        )) {
          console.log(`[Server] Bot protection detected in batch scrape at ${url}`);

          // Store the pending job info for resumption
          batchPendingCaptchaJobs.set(browserId, {
            configName,
            url,
            targetProducts,
            challengeType: 'bot_protection',
            detectedAt: Date.now(),
          });

          // Start streaming frames so user can see and solve the captcha
          await startBatchScreencast(ws, browserId, browser.cdp, sessionId);

          // Send captcha detection to client
          send(ws, 'batch:captchaDetected', {
            browserId,
            challengeType: 'bot_protection',
            url: browser.page.url(),
            jobId,
          }, sessionId);

          // Don't send error result - wait for user to solve
          break;
        }

        send(ws, 'batch:scrapeResult', {
          browserId,
          success: result.success,
          items: result.items,
          count: result.items.length,
          error: result.errors?.[0],
          jobId,
        }, sessionId);

      } catch (error) {
        console.error(`[Server] Browser scrape failed for ${url}:`, error);
        // Make error message more user-friendly
        let errorMsg = error instanceof Error ? error.message : 'Scrape failed';
        if (errorMsg.includes('No containers found')) {
          errorMsg = 'No products found - page may have changed or selector is outdated';
        }
        send(ws, 'batch:scrapeResult', {
          browserId,
          success: false,
          error: errorMsg,
          items: [],
          jobId,
        }, sessionId);
      } finally {
        // CRITICAL: Mark browser as done AFTER scrape completes (success or failure)
        // This allows the browser to be reused for the next job
        batchPool.markDone(browserId);
      }
      break;
    }

    case 'batch:captchaSolved': {
      const { browserId } = payload as { browserId: string };

      // Stop the screencast for this browser
      stopBatchScreencast(browserId);

      if (!batchPool || batchPool.isShutdown()) {
        send(ws, 'batch:scrapeResult', {
          browserId,
          success: false,
          error: 'Pool not initialized or shutting down',
          items: [],
        }, sessionId);
        // Mark browser as done even on early exit
        batchPool?.markDone(browserId);
        break;
      }

      const browser = batchPool.get(browserId);
      if (!browser) {
        send(ws, 'batch:scrapeResult', {
          browserId,
          success: false,
          error: 'Browser not found',
          items: [],
        }, sessionId);
        batchPool.markDone(browserId);
        break;
      }

      // Get the pending job info
      const pendingJob = batchPendingCaptchaJobs.get(browserId);
      if (!pendingJob) {
        send(ws, 'batch:scrapeResult', {
          browserId,
          success: false,
          error: 'No pending captcha job found',
          items: [],
        }, sessionId);
        batchPool.markDone(browserId);
        break;
      }

      // Clear the pending job
      batchPendingCaptchaJobs.delete(browserId);

      try {
        console.log(`[Server] Resuming batch scrape after captcha solve for ${pendingJob.url}`);

        // Wait a moment for the page to settle after captcha solve
        await browser.page.waitForTimeout(1000);

        // Check if captcha is still present
        const { CloudflareBypass } = await import('./browser/CloudflareBypass.js');
        const captchaDetector = new CloudflareBypass(browser.page);
        const stillHasCaptcha = await captchaDetector.detectChallenge();

        if (stillHasCaptcha !== 'none') {
          console.log(`[Server] Captcha still detected after solve attempt: ${stillHasCaptcha}`);
          // Re-queue for captcha - browser stays marked as executing
          batchPendingCaptchaJobs.set(browserId, pendingJob);
          send(ws, 'batch:captchaDetected', {
            browserId,
            challengeType: stillHasCaptcha,
            url: browser.page.url(),
          }, sessionId);
          // Don't mark as done - still waiting for captcha solve
          break;
        }

        // Captcha solved - now scrape
        const result = await executeScraperWithConfig(
          browser.page,
          browser.cdp,
          pendingJob.configName,
          pendingJob.url,
          pendingJob.targetProducts
        );

        send(ws, 'batch:scrapeResult', {
          browserId,
          success: result.success,
          items: result.items,
          count: result.items.length,
          error: result.errors?.[0],
          captchaSolved: true,
        }, sessionId);

      } catch (error) {
        console.error(`[Server] Scrape failed after captcha solve:`, error);
        send(ws, 'batch:scrapeResult', {
          browserId,
          success: false,
          error: error instanceof Error ? error.message : 'Scrape failed after captcha solve',
          items: [],
          captchaSolved: true,
        }, sessionId);
      } finally {
        // Mark browser as done after captcha flow completes
        batchPool.markDone(browserId);
      }
      break;
    }

    case 'batch:slotInput': {
      // Handle user input on batch browser (for captcha solving)
      const { browserId, inputType, data } = payload as {
        browserId: string;
        inputType: string;
        data: { x?: number; y?: number; deltaY?: number };
      };

      if (!batchPool) break;

      const targetBrowser = batchPool.get(browserId);
      if (!targetBrowser) break;

      try {
        if (inputType === 'click' && typeof data.x === 'number' && typeof data.y === 'number') {
          // Click coordinates are in screencast resolution (max 1280x720)
          // Scale to actual viewport (1920x1080)
          const viewport = targetBrowser.page.viewportSize() || { width: 1920, height: 1080 };
          const screencastMaxWidth = 1280;
          const screencastMaxHeight = 720;

          // Calculate the actual screencast dimensions (maintains aspect ratio)
          const viewportAspect = viewport.width / viewport.height;
          const screencastAspect = screencastMaxWidth / screencastMaxHeight;
          let screencastWidth: number, screencastHeight: number;

          if (viewportAspect > screencastAspect) {
            screencastWidth = screencastMaxWidth;
            screencastHeight = screencastMaxWidth / viewportAspect;
          } else {
            screencastHeight = screencastMaxHeight;
            screencastWidth = screencastMaxHeight * viewportAspect;
          }

          // Scale coordinates from screencast to viewport
          const scaleX = viewport.width / screencastWidth;
          const scaleY = viewport.height / screencastHeight;
          const scaledX = Math.round(data.x * scaleX);
          const scaledY = Math.round(data.y * scaleY);

          await targetBrowser.page.mouse.click(scaledX, scaledY);
          console.log(`[Server] Batch click at (${scaledX}, ${scaledY}) [from ${data.x}, ${data.y}] on browser ${browserId.substring(0, 8)}`);
        } else if (inputType === 'scroll' && typeof data.deltaY === 'number') {
          // Scroll
          await targetBrowser.page.mouse.wheel(0, data.deltaY);
          console.log(`[Server] Batch scroll by ${data.deltaY} on browser ${browserId.substring(0, 8)}`);
        }
      } catch (err) {
        console.error(`[Server] Batch input error:`, err);
      }
      break;
    }

    case 'batch:getPoolStats': {
      if (!batchPool) {
        send(ws, 'batch:poolStats', { error: 'Pool not initialized' }, sessionId);
        break;
      }

      const stats = batchPool.getStats();

      send(ws, 'batch:poolStats', {
        pool: stats,
      }, sessionId);
      break;
    }

    // =========================================================================
    // CLOUDFLARE BYPASS
    // =========================================================================

    case 'cloudflare:exportCookies': {
      const currentSession = getSession(sessionId ?? null);
      if (!currentSession) {
        send(ws, 'cloudflare:cookiesExported', { success: false, error: 'No active session' }, sessionId);
        break;
      }

      try {
        const result = await browserManager.exportCloudflareCookies(currentSession.id);
        const url = currentSession.browserSession.page.url();
        let domain = 'unknown';
        try {
          domain = new URL(url).hostname.replace(/^www\./, '');
        } catch {}

        send(ws, 'cloudflare:cookiesExported', {
          success: result.success,
          cookieCount: result.cookieCount,
          domain,
        }, sessionId);

        console.log(`[Server] Exported ${result.cookieCount} Cloudflare cookies for ${domain}`);
      } catch (error) {
        console.error('[Server] Cookie export failed:', error);
        send(ws, 'cloudflare:cookiesExported', {
          success: false,
          error: error instanceof Error ? error.message : 'Export failed',
        }, sessionId);
      }
      break;
    }

    case 'cloudflare:getStatus': {
      const currentSession = getSession(sessionId ?? null);
      if (!currentSession) {
        send(ws, 'cloudflare:status', { error: 'No active session' }, sessionId);
        break;
      }

      try {
        const status = await browserManager.getCloudflareStatus(currentSession.id);
        send(ws, 'cloudflare:status', status || { hasChallenge: false, challengeType: 'none', hasClearance: false }, sessionId);
      } catch (error) {
        console.error('[Server] Cloudflare status check failed:', error);
        send(ws, 'cloudflare:status', {
          hasChallenge: false,
          challengeType: 'none',
          hasClearance: false,
          error: error instanceof Error ? error.message : 'Status check failed',
        }, sessionId);
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

/**
 * Start CDP screencast for a batch browser and stream frames to the client.
 * Used when captcha is detected so user can see and solve it.
 */
async function startBatchScreencast(
  ws: WebSocket,
  browserId: string,
  cdp: import('playwright').CDPSession,
  sessionId?: string
): Promise<void> {
  // Stop any existing screencast for this browser
  stopBatchScreencast(browserId);

  console.log(`[Server] Starting batch screencast for browser ${browserId.substring(0, 8)}`);

  // Set up frame handler
  const frameHandler = (params: { data: string; metadata: { timestamp: number }; sessionId: number }) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    // CRITICAL: Acknowledge the frame so CDP continues sending frames
    cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});

    // Send frame as binary for efficiency
    const frameBuffer = Buffer.from(params.data, 'base64');

    // Prepend browser ID so client knows which slot this frame belongs to
    const browserIdBuffer = Buffer.from(browserId + ':', 'utf8');
    const combined = Buffer.concat([browserIdBuffer, frameBuffer]);

    ws.send(combined);
  };

  cdp.on('Page.screencastFrame', frameHandler);

  // Start screencast
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 60,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 2,
  });

  // Store cleanup function
  batchScreencasts.set(browserId, () => {
    cdp.off('Page.screencastFrame', frameHandler);
    cdp.send('Page.stopScreencast').catch(() => {});
  });
}

/**
 * Stop screencast for a batch browser.
 */
function stopBatchScreencast(browserId: string): void {
  const cleanup = batchScreencasts.get(browserId);
  if (cleanup) {
    console.log(`[Server] Stopping batch screencast for browser ${browserId.substring(0, 8)}`);
    cleanup();
    batchScreencasts.delete(browserId);
  }
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
