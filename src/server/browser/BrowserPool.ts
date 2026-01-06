/**
 * Browser Pool - Pre-warmed browser instances for batch processing.
 * Uses Real Chrome via CDP for best Cloudflare/bot protection bypass.
 * Each pooled browser is a separate context within the shared Chrome instance.
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page, CDPSession } from 'playwright';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  CHROME_FLAGS_WINDOWS,
  IGNORED_DEFAULT_ARGS,
  CHROME_ENV_WINDOWS,
} from '../config/chrome-flags.js';
import { profileManager } from './ProfileManager.js';

// Apply stealth plugin globally (fallback for non-Real Chrome mode)
chromium.use(StealthPlugin());

export interface PooledBrowser {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  status: 'warming' | 'idle' | 'busy' | 'unhealthy';
  createdAt: number;
  lastUsedAt: number;
  jobCount: number;
  currentDomain?: string;
  healthCheckFailures: number;
  isExecuting: boolean;      // True while a scrape job is actively running
  currentJobId?: string;     // Track which job is currently running
  scraper?: any;             // Persistent ScrapingEngine instance (same as scraper page session.scraper)
}

export interface PoolConfig {
  minSize: number;
  maxSize: number;
  warmupCount: number;
  idleTimeoutMs: number;
  healthCheckIntervalMs: number;
  maxJobsPerBrowser: number;
  memoryThresholdMb: number;
  injectCloudflareCookies?: boolean; // Auto-inject saved Cloudflare cookies
  useRealChrome?: boolean; // Use Real Chrome via CDP (default: true)
  chromeDebugPort?: number; // CDP port for Real Chrome (default: 9222)
  shareContext?: boolean; // Share single context across all browsers (for captcha solving)
}

const DEFAULT_CONFIG: PoolConfig = {
  minSize: 5,
  maxSize: 50,
  warmupCount: 10,
  idleTimeoutMs: 60000,
  healthCheckIntervalMs: 30000,
  maxJobsPerBrowser: 50,
  memoryThresholdMb: 800,
  injectCloudflareCookies: true, // Auto-inject by default
  useRealChrome: true, // Use Real Chrome by default
  chromeDebugPort: 9222,
  shareContext: true, // Share context so captchas can be solved (default: true)
};

export class BrowserPool extends EventEmitter {
  private pool: Map<string, PooledBrowser> = new Map();
  private config: PoolConfig;
  private healthCheckTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private isProduction: boolean;
  private sharedBrowser: Browser | null = null; // Shared Real Chrome instance
  private sharedContext: BrowserContext | null = null; // Shared context for captcha solving

  constructor(config: Partial<PoolConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  /**
   * Get or create the shared Real Chrome browser instance
   */
  private async getSharedBrowser(): Promise<Browser> {
    if (this.sharedBrowser && this.sharedBrowser.isConnected()) {
      return this.sharedBrowser;
    }

    const debugPort = this.config.chromeDebugPort || 9222;
    console.log(`[BrowserPool] Connecting to Real Chrome on port ${debugPort}...`);

    try {
      // First, try to connect to existing Chrome instance
      this.sharedBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
      console.log('[BrowserPool] Connected to existing Real Chrome');
    } catch {
      // Chrome not running with debug port - auto-launch it
      console.log('[BrowserPool] Chrome not running, auto-launching...');
      this.sharedBrowser = await this.launchRealChrome(debugPort);
      console.log('[BrowserPool] Auto-launched Real Chrome with debug port');
    }

    return this.sharedBrowser;
  }

  /**
   * Auto-launch Chrome with remote debugging enabled
   */
  private async launchRealChrome(debugPort: number): Promise<Browser> {
    // Common Chrome paths on Windows
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    ];

    // Find Chrome
    let chromePath: string | null = null;
    for (const p of chromePaths) {
      if (fs.existsSync(p)) {
        chromePath = p;
        break;
      }
    }

    if (!chromePath) {
      throw new Error('Chrome not found. Please install Google Chrome.');
    }

    // Use a separate user data dir to avoid conflicts with existing Chrome
    const userDataDir = path.join(os.homedir(), '.chrome-scraper-profile');

    console.log(`[BrowserPool] Launching Chrome from: ${chromePath}`);
    console.log(`[BrowserPool] User data dir: ${userDataDir}`);

    // Launch Chrome with remote debugging
    const chromeProcess = spawn(chromePath, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ], {
      detached: true,
      stdio: 'ignore',
    });

    // Don't wait for Chrome to exit
    chromeProcess.unref();

    // Wait for Chrome to start and be ready for CDP connection
    const maxAttempts = 20;
    const delayMs = 500;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
        return browser;
      } catch {
        // Chrome not ready yet, keep waiting
        if (i < maxAttempts - 1) {
          console.log(`[BrowserPool] Waiting for Chrome to start... (${i + 1}/${maxAttempts})`);
        }
      }
    }

    throw new Error(`Chrome failed to start after ${maxAttempts * delayMs / 1000} seconds`);
  }

  /**
   * Pre-warm browsers on batch start.
   */
  async warmup(count?: number): Promise<void> {
    const targetCount = Math.min(count ?? this.config.warmupCount, this.config.maxSize);
    console.log(`[BrowserPool] Warming up ${targetCount} browsers...`);

    const startTime = Date.now();
    const promises: Promise<PooledBrowser | null>[] = [];

    for (let i = 0; i < targetCount; i++) {
      promises.push(this.createBrowser().catch((err) => {
        console.error(`[BrowserPool] Failed to create browser ${i}:`, err.message);
        return null;
      }));
    }

    const results = await Promise.all(promises);
    const successCount = results.filter(Boolean).length;

    console.log(
      `[BrowserPool] Warmup complete. ${successCount}/${targetCount} browsers ready in ${Date.now() - startTime}ms`
    );

    this.startHealthCheck();
    this.emit('pool:ready', { size: this.pool.size });
  }

  /**
   * Pre-warm browsers with domain pre-navigation.
   * Browsers are created AND navigated to their assigned domain during warmup.
   * This warms up DNS, SSL, cookies, and page cache for faster subsequent scraping.
   * Also injects any saved Cloudflare cookies for protected domains.
   */
  async warmupWithDomains(domains: string[], count?: number): Promise<void> {
    const targetCount = Math.min(count ?? this.config.warmupCount, this.config.maxSize);
    const uniqueDomains = [...new Set(domains)];
    console.log(`[BrowserPool] Warming up ${targetCount} browsers with ${uniqueDomains.length} domains...`);

    // Initialize profile manager for cookie injection
    if (this.config.injectCloudflareCookies) {
      await profileManager.init();
    }

    const startTime = Date.now();
    const promises: Promise<PooledBrowser | null>[] = [];

    for (let i = 0; i < targetCount; i++) {
      // Distribute domains across browsers round-robin style
      const domain = uniqueDomains.length > 0 ? uniqueDomains[i % uniqueDomains.length] : undefined;

      promises.push(
        this.createBrowserWithDomain(domain).catch((err) => {
          console.error(`[BrowserPool] Failed to create browser ${i}:`, err.message);
          return null;
        })
      );
    }

    const results = await Promise.all(promises);
    const successCount = results.filter(Boolean).length;
    const prenavCount = results.filter((b) => b?.currentDomain).length;

    console.log(
      `[BrowserPool] Warmup complete. ${successCount}/${targetCount} browsers ready (${prenavCount} pre-navigated) in ${Date.now() - startTime}ms`
    );

    this.startHealthCheck();
    this.emit('pool:ready', { size: this.pool.size, preNavigated: prenavCount });
  }

  /**
   * Create a browser and optionally pre-navigate to a domain.
   * Injects saved Cloudflare cookies before navigation if available.
   */
  private async createBrowserWithDomain(domain?: string): Promise<PooledBrowser> {
    const browser = await this.createBrowser();

    if (domain) {
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');

      // Inject Cloudflare cookies BEFORE navigation if available
      if (this.config.injectCloudflareCookies) {
        try {
          const injected = await profileManager.importCookies(browser.context, cleanDomain);
          if (injected) {
            console.log(`[BrowserPool] Injected saved cookies for ${cleanDomain}`);
          }
        } catch (err) {
          console.log(`[BrowserPool] Cookie injection for ${cleanDomain} failed (non-fatal): ${(err as Error).message}`);
        }
      }

      try {
        // Navigate to the domain's homepage to warm up DNS, SSL, cookies
        const url = domain.startsWith('http') ? domain : `https://${domain}`;
        await browser.page.goto(url, {
          waitUntil: 'commit', // Fastest wait - just HTTP response started
          timeout: 20000, // 20 second timeout for pre-navigation (IKEA can be slow)
        });
        browser.currentDomain = cleanDomain;
        console.log(`[BrowserPool] Browser ${browser.id.substring(0, 8)} pre-navigated to ${domain}`);
      } catch (err) {
        // Pre-navigation failure is non-fatal - browser is still usable
        console.log(`[BrowserPool] Pre-navigation to ${domain} failed (non-fatal): ${(err as Error).message}`);
      }
    }

    return browser;
  }

  /**
   * Create a single browser instance.
   * Uses Real Chrome via CDP when enabled (default), falls back to Playwright launch.
   */
  private async createBrowser(): Promise<PooledBrowser> {
    const id = uuidv4();

    // Use Real Chrome mode (default) - creates contexts in shared Chrome instance
    if (this.config.useRealChrome && !this.isProduction) {
      return this.createRealChromeBrowser(id);
    }

    // Fallback: Launch separate browser instances (production/Docker or when Real Chrome disabled)
    const chromeFlags = this.isProduction
      ? [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--mute-audio',
        ]
      : CHROME_FLAGS_WINDOWS;

    let browser: Browser;

    if (this.isProduction) {
      browser = await chromium.launch({
        headless: false,
        args: chromeFlags,
        ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
      });
    } else {
      try {
        browser = await chromium.launch({
          headless: false,
          channel: 'chrome',
          args: chromeFlags,
          ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
          env: {
            ...process.env,
            ...CHROME_ENV_WINDOWS,
          },
        });
      } catch {
        browser = await chromium.launch({
          headless: false,
          args: chromeFlags,
          ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
          env: {
            ...process.env,
            ...CHROME_ENV_WINDOWS,
          },
        });
      }
    }

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });

    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);

    const pooledBrowser: PooledBrowser = {
      id,
      browser,
      context,
      page,
      cdp,
      status: 'idle',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      jobCount: 0,
      healthCheckFailures: 0,
      isExecuting: false,
    };

    this.pool.set(id, pooledBrowser);
    this.emit('browser:created', { id, poolSize: this.pool.size });
    return pooledBrowser;
  }

  /**
   * Create a browser using Real Chrome via CDP.
   * When shareContext is true (default), all browsers share the same context/cookies
   * so captchas solved in one tab apply to all. Each "browser" gets its own page (tab).
   */
  private async createRealChromeBrowser(id: string): Promise<PooledBrowser> {
    const browser = await this.getSharedBrowser();

    let context: BrowserContext;

    if (this.config.shareContext) {
      // Use shared context - all browsers share cookies, so captcha solved once works for all
      if (!this.sharedContext) {
        // Get existing context or create one
        const existingContexts = browser.contexts();
        if (existingContexts.length > 0) {
          this.sharedContext = existingContexts[0];
          console.log('[BrowserPool] Using existing browser context (shared)');
        } else {
          this.sharedContext = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            ignoreHTTPSErrors: true,
          });
          console.log('[BrowserPool] Created new shared context');
        }
      }
      context = this.sharedContext;
    } else {
      // Create isolated context per browser (original behavior)
      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true,
      });
    }

    // Create a new page (tab) for this pooled browser
    const page = await context.newPage();

    // Set viewport explicitly - critical for click handling in Real Chrome
    await page.setViewportSize({ width: 1920, height: 1080 });

    const cdp = await context.newCDPSession(page);

    // Enable CDP domains
    await Promise.all([
      cdp.send('DOM.enable'),
      cdp.send('CSS.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Page.enable'),
      (cdp.send as any)('Input.enable').catch(() => {}), // May not be available, type not in declarations
    ]);

    const pooledBrowser: PooledBrowser = {
      id,
      browser, // Reference to shared browser
      context,
      page,
      cdp,
      status: 'idle',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      jobCount: 0,
      healthCheckFailures: 0,
      isExecuting: false,
    };

    this.pool.set(id, pooledBrowser);
    this.emit('browser:created', { id, poolSize: this.pool.size, realChrome: true, sharedContext: this.config.shareContext });
    console.log(`[BrowserPool] Created Real Chrome page ${id.substring(0, 8)} (shared context: ${this.config.shareContext})`);
    return pooledBrowser;
  }

  /**
   * Acquire browser from pool (prefer domain affinity).
   * Only returns browsers that are idle AND not currently executing a job.
   */
  async acquire(preferredDomain?: string): Promise<PooledBrowser | null> {
    // Reject if shutting down
    if (this.isShuttingDown) {
      console.log('[BrowserPool] Pool is shutting down, rejecting acquire request');
      return null;
    }

    // 1. Try to find idle browser with same domain (affinity)
    // CRITICAL: Also check isExecuting to prevent reuse during active scrape
    if (preferredDomain) {
      for (const browser of this.pool.values()) {
        if (browser.status === 'idle' && !browser.isExecuting && browser.currentDomain === preferredDomain) {
          browser.status = 'busy';
          browser.lastUsedAt = Date.now();
          this.emit('browser:acquired', { id: browser.id, domain: preferredDomain, affinity: true });
          return browser;
        }
      }
    }

    // 2. Find any idle browser that's not executing
    for (const browser of this.pool.values()) {
      if (browser.status === 'idle' && !browser.isExecuting) {
        browser.status = 'busy';
        browser.lastUsedAt = Date.now();
        browser.currentDomain = preferredDomain;
        this.emit('browser:acquired', { id: browser.id, domain: preferredDomain, affinity: false });
        return browser;
      }
    }

    // 3. If pool not at max, create new browser
    if (this.pool.size < this.config.maxSize) {
      try {
        const newBrowser = await this.createBrowser();
        newBrowser.status = 'busy';
        newBrowser.currentDomain = preferredDomain;
        this.emit('browser:acquired', { id: newBrowser.id, domain: preferredDomain, affinity: false });
        return newBrowser;
      } catch (err) {
        console.error('[BrowserPool] Failed to create new browser:', (err as Error).message);
        return null;
      }
    }

    // 4. Pool exhausted
    this.emit('pool:exhausted', { size: this.pool.size, maxSize: this.config.maxSize });
    return null;
  }

  /**
   * Release browser back to pool.
   */
  release(browserId: string): void {
    const browser = this.pool.get(browserId);
    if (!browser) return;

    browser.status = 'idle';
    browser.lastUsedAt = Date.now();
    browser.jobCount++;

    // Recycle if too many jobs
    if (browser.jobCount >= this.config.maxJobsPerBrowser) {
      this.recycleBrowser(browserId);
      return;
    }

    this.emit('browser:released', { id: browserId, jobCount: browser.jobCount });
  }

  /**
   * Get a browser by ID.
   */
  get(browserId: string): PooledBrowser | undefined {
    return this.pool.get(browserId);
  }

  /**
   * Mark a browser as currently executing a job.
   * This prevents the browser from being acquired by another job.
   */
  markExecuting(browserId: string, jobId?: string): void {
    const browser = this.pool.get(browserId);
    if (browser) {
      browser.isExecuting = true;
      browser.currentJobId = jobId;
      console.log(`[BrowserPool] Browser ${browserId.substring(0, 8)} marked as executing job ${jobId?.substring(0, 8) || 'unknown'}`);
    }
  }

  /**
   * Mark a browser as done executing.
   * Call this AFTER the scrape completes (success or failure) to allow reuse.
   */
  markDone(browserId: string): void {
    const browser = this.pool.get(browserId);
    if (browser) {
      browser.isExecuting = false;
      browser.currentJobId = undefined;
      console.log(`[BrowserPool] Browser ${browserId.substring(0, 8)} marked as done`);
    }
  }

  /**
   * Recycle (close and replace) a browser.
   * In Real Chrome mode with shared context, only closes the page (tab).
   * In Real Chrome mode without shared context, closes the context.
   * In standard mode, closes the browser.
   */
  private async recycleBrowser(browserId: string): Promise<void> {
    const browser = this.pool.get(browserId);
    if (!browser) return;

    console.log(`[BrowserPool] Recycling browser ${browserId.substring(0, 8)} (${browser.jobCount} jobs)`);

    try {
      if (this.config.useRealChrome && !this.isProduction) {
        if (this.config.shareContext) {
          // Shared context mode: only close the page (tab), keep the context
          await browser.page.close();
        } else {
          // Isolated context mode: close the context
          await browser.context.close();
        }
      } else {
        // Standard mode: close the browser
        await browser.browser.close();
      }
    } catch {
      // Ignore close errors
    }

    this.pool.delete(browserId);
    this.emit('browser:recycled', { id: browserId });

    // Replace if below min size
    if (this.pool.size < this.config.minSize && !this.isShuttingDown) {
      try {
        await this.createBrowser();
      } catch (err) {
        console.error('[BrowserPool] Failed to replace recycled browser:', (err as Error).message);
      }
    }
  }

  /**
   * Start periodic health check.
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      for (const [id, browser] of this.pool.entries()) {
        if (browser.status === 'busy') continue;

        const healthy = await this.checkHealth(browser);
        if (!healthy) {
          browser.healthCheckFailures++;
          browser.status = 'unhealthy';
          if (browser.healthCheckFailures >= 3) {
            await this.recycleBrowser(id);
          }
        } else {
          browser.healthCheckFailures = 0;
          if (browser.status === 'unhealthy') {
            browser.status = 'idle';
          }
        }

        // Close idle browsers exceeding timeout (if above min)
        if (
          browser.status === 'idle' &&
          Date.now() - browser.lastUsedAt > this.config.idleTimeoutMs &&
          this.pool.size > this.config.minSize
        ) {
          await this.recycleBrowser(id);
        }
      }
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Check if a browser is healthy.
   */
  private async checkHealth(browser: PooledBrowser): Promise<boolean> {
    try {
      await browser.page.evaluate(() => document.readyState, { timeout: 5000 });
      return browser.browser.isConnected();
    } catch {
      return false;
    }
  }

  /**
   * Get pool statistics.
   */
  getStats(): { total: number; idle: number; busy: number; unhealthy: number } {
    let idle = 0,
      busy = 0,
      unhealthy = 0;
    for (const browser of this.pool.values()) {
      if (browser.status === 'idle') idle++;
      else if (browser.status === 'busy') busy++;
      else if (browser.status === 'unhealthy') unhealthy++;
    }
    return { total: this.pool.size, idle, busy, unhealthy };
  }

  /**
   * Scale pool to target size.
   */
  async scaleTo(targetSize: number): Promise<void> {
    const clamped = Math.max(this.config.minSize, Math.min(this.config.maxSize, targetSize));
    const current = this.pool.size;

    if (clamped > current) {
      // Scale up
      const toAdd = clamped - current;
      console.log(`[BrowserPool] Scaling up: +${toAdd} browsers`);
      const promises = [];
      for (let i = 0; i < toAdd; i++) {
        promises.push(
          this.createBrowser().catch((err) => {
            console.error('[BrowserPool] Scale up failed:', (err as Error).message);
            return null;
          })
        );
      }
      await Promise.all(promises);
    } else if (clamped < current) {
      // Scale down (only idle browsers)
      let toRemove = current - clamped;
      for (const [id, browser] of this.pool.entries()) {
        if (toRemove <= 0) break;
        if (browser.status === 'idle') {
          await this.recycleBrowser(id);
          toRemove--;
        }
      }
    }

    this.emit('pool:scaled', { from: current, to: this.pool.size });
  }

  /**
   * Check if pool is shutting down.
   */
  isShutdown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Wait for all busy browsers to become idle (with timeout).
   */
  private async waitForBusyBrowsers(timeoutMs = 30000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      const busyCount = [...this.pool.values()].filter(b => b.status === 'busy').length;
      if (busyCount === 0) {
        console.log('[BrowserPool] All browsers idle, proceeding with shutdown');
        return;
      }
      console.log(`[BrowserPool] Waiting for ${busyCount} busy browsers to finish...`);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    const remaining = [...this.pool.values()].filter(b => b.status === 'busy').length;
    console.log(`[BrowserPool] Timeout waiting for browsers, ${remaining} still busy`);
  }

  /**
   * Shutdown pool and close all browsers.
   */
  async shutdown(waitForJobs = true): Promise<void> {
    this.isShuttingDown = true;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    // Wait for busy browsers to complete (with timeout)
    if (waitForJobs) {
      await this.waitForBusyBrowsers(10000); // 10 second timeout
    }

    console.log(`[BrowserPool] Shutting down ${this.pool.size} browsers...`);

    const closePromises = [];

    // In Real Chrome mode, close pages/contexts but keep Chrome running
    if (this.config.useRealChrome && !this.isProduction) {
      if (this.config.shareContext) {
        // Shared context mode: close all pages (tabs)
        for (const browser of this.pool.values()) {
          closePromises.push(
            browser.page.close().catch(() => {
              // Ignore close errors
            })
          );
        }
        // Don't close the shared context - it preserves cookies for next batch
      } else {
        // Isolated context mode: close each context
        for (const browser of this.pool.values()) {
          closePromises.push(
            browser.context.close().catch(() => {
              // Ignore close errors
            })
          );
        }
      }
      // Don't close the shared browser - leave Chrome running for next batch
      // User can close it manually if they want
    } else {
      // Standard mode: close each browser
      for (const browser of this.pool.values()) {
        closePromises.push(
          browser.browser.close().catch(() => {
            // Ignore close errors
          })
        );
      }
    }

    await Promise.all(closePromises);
    this.pool.clear();
    this.isShuttingDown = false;

    console.log('[BrowserPool] Shutdown complete');
    this.emit('pool:shutdown');
  }

  /**
   * Get config.
   */
  getConfig(): PoolConfig {
    return { ...this.config };
  }
}

// Singleton instance for reuse
let browserPoolInstance: BrowserPool | null = null;

export function getBrowserPool(config?: Partial<PoolConfig>): BrowserPool {
  if (!browserPoolInstance) {
    browserPoolInstance = new BrowserPool(config);
  }
  return browserPoolInstance;
}

export function resetBrowserPool(): void {
  if (browserPoolInstance) {
    browserPoolInstance.shutdown();
    browserPoolInstance = null;
  }
}
