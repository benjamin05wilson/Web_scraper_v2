/**
 * Browser Pool - Pre-warmed browser instances for batch processing.
 * Provides fast browser acquisition with domain affinity.
 */

import { chromium, Browser, BrowserContext, Page, CDPSession } from 'playwright';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  CHROME_FLAGS_WINDOWS,
  IGNORED_DEFAULT_ARGS,
  CHROME_ENV_WINDOWS,
} from '../config/chrome-flags.js';

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
}

export interface PoolConfig {
  minSize: number;
  maxSize: number;
  warmupCount: number;
  idleTimeoutMs: number;
  healthCheckIntervalMs: number;
  maxJobsPerBrowser: number;
  memoryThresholdMb: number;
}

const DEFAULT_CONFIG: PoolConfig = {
  minSize: 5,
  maxSize: 50,
  warmupCount: 10,
  idleTimeoutMs: 60000,
  healthCheckIntervalMs: 30000,
  maxJobsPerBrowser: 50,
  memoryThresholdMb: 800,
};

export class BrowserPool extends EventEmitter {
  private pool: Map<string, PooledBrowser> = new Map();
  private config: PoolConfig;
  private healthCheckTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private isProduction: boolean;

  constructor(config: Partial<PoolConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.isProduction = process.env.NODE_ENV === 'production';
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
   */
  async warmupWithDomains(domains: string[], count?: number): Promise<void> {
    const targetCount = Math.min(count ?? this.config.warmupCount, this.config.maxSize);
    const uniqueDomains = [...new Set(domains)];
    console.log(`[BrowserPool] Warming up ${targetCount} browsers with ${uniqueDomains.length} domains...`);

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
   */
  private async createBrowserWithDomain(domain?: string): Promise<PooledBrowser> {
    const browser = await this.createBrowser();

    if (domain) {
      try {
        // Navigate to the domain's homepage to warm up DNS, SSL, cookies
        const url = domain.startsWith('http') ? domain : `https://${domain}`;
        await browser.page.goto(url, {
          waitUntil: 'commit', // Fastest wait - just HTTP response started
          timeout: 20000, // 20 second timeout for pre-navigation (IKEA can be slow)
        });
        browser.currentDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
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
   */
  private async createBrowser(): Promise<PooledBrowser> {
    const id = uuidv4();

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
    };

    this.pool.set(id, pooledBrowser);
    this.emit('browser:created', { id, poolSize: this.pool.size });
    return pooledBrowser;
  }

  /**
   * Acquire browser from pool (prefer domain affinity).
   */
  async acquire(preferredDomain?: string): Promise<PooledBrowser | null> {
    // Reject if shutting down
    if (this.isShuttingDown) {
      console.log('[BrowserPool] Pool is shutting down, rejecting acquire request');
      return null;
    }

    // 1. Try to find idle browser with same domain (affinity)
    if (preferredDomain) {
      for (const browser of this.pool.values()) {
        if (browser.status === 'idle' && browser.currentDomain === preferredDomain) {
          browser.status = 'busy';
          browser.lastUsedAt = Date.now();
          this.emit('browser:acquired', { id: browser.id, domain: preferredDomain, affinity: true });
          return browser;
        }
      }
    }

    // 2. Find any idle browser
    for (const browser of this.pool.values()) {
      if (browser.status === 'idle') {
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
   * Recycle (close and replace) a browser.
   */
  private async recycleBrowser(browserId: string): Promise<void> {
    const browser = this.pool.get(browserId);
    if (!browser) return;

    console.log(`[BrowserPool] Recycling browser ${browserId.substring(0, 8)} (${browser.jobCount} jobs)`);

    try {
      await browser.browser.close();
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
    for (const browser of this.pool.values()) {
      closePromises.push(
        browser.browser.close().catch(() => {
          // Ignore close errors
        })
      );
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
