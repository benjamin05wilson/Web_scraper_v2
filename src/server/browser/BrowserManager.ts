// ============================================================================
// BROWSER MANAGER - Playwright + CDP Integration with Stealth & Cloudflare Support
// ============================================================================

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page, CDPSession } from 'playwright';
import { EventEmitter } from 'events';
import {
  CHROME_FLAGS_WINDOWS,
  IGNORED_DEFAULT_ARGS,
  CHROME_ENV_WINDOWS,
} from '../config/chrome-flags.js';
import type { SessionConfig, MouseEvent, KeyboardEvent, ScrollEvent } from '../../shared/types.js';
import { MOBILE_PRESETS } from '../../shared/types.js';
import { profileManager } from './ProfileManager.js';
import { CloudflareBypass, isLikelyProtected } from './CloudflareBypass.js';

// Apply stealth plugin globally
chromium.use(StealthPlugin());

export interface BrowserSession {
  id: string;
  browser: Browser | null; // null when using persistent context
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  config: SessionConfig;
  isPersistent?: boolean;
  cloudflareBypass?: CloudflareBypass;
}

export class BrowserManager extends EventEmitter {
  private sessions: Map<string, BrowserSession> = new Map();

  constructor() {
    super();
  }

  async createSession(sessionId: string, config: SessionConfig): Promise<BrowserSession> {
    console.log(`[BrowserManager] Creating session ${sessionId}`);

    // Check if running in Docker/production
    const isProduction = process.env.NODE_ENV === 'production';

    // Use Docker-compatible flags in production
    const chromeFlags = isProduction ? [
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
    ] : CHROME_FLAGS_WINDOWS;

    console.log(`[BrowserManager] Running in ${isProduction ? 'production (Docker)' : 'development'} mode`);

    let browser: Browser;

    if (isProduction) {
      // In production/Docker, use bundled Chromium directly (skip Chrome check)
      console.log('[BrowserManager] Launching bundled Chromium...');
      browser = await chromium.launch({
        headless: false, // Headful for streaming (Xvfb provides display)
        args: chromeFlags,
        ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
      });
      console.log('[BrowserManager] Chromium launched');
    } else {
      // In development, try Chrome first, fall back to Chromium
      try {
        console.log('[BrowserManager] Attempting to use installed Chrome...');
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
        console.log('[BrowserManager] Using installed Chrome');
      } catch (chromeError) {
        console.log('[BrowserManager] Chrome not found, using bundled Chromium');
        browser = await chromium.launch({
          headless: false,
          args: chromeFlags,
          ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
          env: {
            ...process.env,
            ...CHROME_ENV_WINDOWS,
          },
        });
        console.log('[BrowserManager] Using bundled Chromium');
      }
    }

    // Get mobile preset if mobile emulation is enabled
    const mobilePreset = config.useMobileEmulation ? MOBILE_PRESETS.iPhoneSafari : null;

    // Create context with viewport (use mobile settings if enabled)
    const context = await browser.newContext({
      viewport: mobilePreset?.viewport || config.viewport,
      userAgent: mobilePreset?.userAgent || config.userAgent,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      javaScriptEnabled: true,
      hasTouch: mobilePreset?.hasTouch || false,
      isMobile: mobilePreset?.isMobile || false,
      deviceScaleFactor: mobilePreset ? 3 : 1, // Retina for mobile
    });

    if (mobilePreset) {
      console.log('[BrowserManager] Using mobile emulation (iPhone Safari)');
    }

    // Create page
    const page = await context.newPage();

    // Create CDP session for low-level control
    const cdp = await page.context().newCDPSession(page);

    // Enable CDP domains we need
    await Promise.all([
      cdp.send('DOM.enable'),
      cdp.send('CSS.enable'),
      cdp.send('Overlay.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Page.enable'),
    ]);

    // Navigate to URL
    if (config.url) {
      await page.goto(config.url, { waitUntil: 'domcontentloaded' });
    }

    // Create CloudflareBypass instance for this session
    const cloudflareBypass = new CloudflareBypass(page);

    const session: BrowserSession = {
      id: sessionId,
      browser,
      context,
      page,
      cdp,
      config,
      isPersistent: false,
      cloudflareBypass,
    };

    this.sessions.set(sessionId, session);

    // Set up page event listeners
    this.setupPageListeners(session);

    // Check for Cloudflare and handle if needed
    if (config.url && isLikelyProtected(config.url)) {
      await this.handleCloudflareIfNeeded(session);
    }

    console.log(`[BrowserManager] Session ${sessionId} created successfully`);
    return session;
  }

  /**
   * Connect to user's real Chrome browser via CDP (Chrome DevTools Protocol)
   * This bypasses bot detection by using an actual Chrome instance with real fingerprint
   *
   * Auto-launches Chrome with debug port if not already running
   */
  async connectToRealChrome(sessionId: string, config: SessionConfig): Promise<BrowserSession> {
    const debugPort = config.chromeDebugPort || 9222;
    console.log(`[BrowserManager] Connecting to real Chrome on port ${debugPort}...`);

    let browser: Browser;

    try {
      // First, try to connect to existing Chrome instance
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
      console.log('[BrowserManager] Connected to existing real Chrome');
    } catch {
      // Chrome not running with debug port - auto-launch it
      console.log('[BrowserManager] Chrome not running, auto-launching...');
      browser = await this.launchRealChrome(debugPort);
      console.log('[BrowserManager] Auto-launched real Chrome with debug port');
    }

    // Get the default context (user's actual browser context with cookies, history, etc.)
    const contexts = browser.contexts();
    let context: BrowserContext;

    if (contexts.length > 0) {
      context = contexts[0];
      console.log('[BrowserManager] Using existing browser context');
    } else {
      // Create new context if none exist
      context = await browser.newContext({
        viewport: config.viewport,
        ignoreHTTPSErrors: true,
      });
      console.log('[BrowserManager] Created new browser context');
    }

    // Get existing page or create new one
    const pages = context.pages();
    let page: Page;

    if (pages.length > 0 && !pages[0].url().startsWith('chrome://')) {
      page = pages[0];
      console.log('[BrowserManager] Using existing page');
    } else {
      page = await context.newPage();
      console.log('[BrowserManager] Created new page');
    }

    // Set viewport - CRITICAL for click handling to work
    // Real Chrome doesn't have viewport set by default, which breaks input handling
    await page.setViewportSize(config.viewport || { width: 1280, height: 720 });
    console.log(`[BrowserManager] Set viewport to ${config.viewport?.width}x${config.viewport?.height}`);

    // Create CDP session
    const cdp = await context.newCDPSession(page);

    // Enable CDP domains - Input.enable is CRITICAL for mouse/keyboard to work in Real Chrome
    await Promise.all([
      cdp.send('DOM.enable'),
      cdp.send('CSS.enable'),
      cdp.send('Overlay.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Page.enable'),
      (cdp.send as any)('Input.enable').catch(() => {}), // May fail but mouse.click still works via Playwright
    ]);

    // Navigate to URL
    if (config.url) {
      await page.goto(config.url, { waitUntil: 'domcontentloaded' });
    }

    // Create CloudflareBypass instance
    const cloudflareBypass = new CloudflareBypass(page);

    const session: BrowserSession = {
      id: sessionId,
      browser,
      context,
      page,
      cdp,
      config,
      isPersistent: true, // Treat as persistent since it's the user's real browser
      cloudflareBypass,
    };

    this.sessions.set(sessionId, session);
    this.setupPageListeners(session);

    console.log(`[BrowserManager] Real Chrome session ${sessionId} created successfully`);
    return session;
  }

  /**
   * Auto-launch Chrome with remote debugging enabled
   * Uses user's default Chrome profile for maximum trust/fingerprint
   */
  private async launchRealChrome(debugPort: number): Promise<Browser> {
    const { spawn } = await import('child_process');
    const path = await import('path');
    const os = await import('os');

    // Common Chrome paths on Windows
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    ];

    // Find Chrome
    let chromePath: string | null = null;
    const fs = await import('fs');
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

    console.log(`[BrowserManager] Launching Chrome from: ${chromePath}`);
    console.log(`[BrowserManager] User data dir: ${userDataDir}`);

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
          console.log(`[BrowserManager] Waiting for Chrome to start... (${i + 1}/${maxAttempts})`);
        }
      }
    }

    throw new Error(`Chrome failed to start after ${maxAttempts * delayMs / 1000} seconds`);
  }

  /**
   * Create a session with persistent browser profile (for Cloudflare bypass)
   */
  async createPersistentSession(sessionId: string, config: SessionConfig): Promise<BrowserSession> {
    console.log(`[BrowserManager] Creating persistent session ${sessionId}`);

    // Initialize profile manager
    await profileManager.init();

    // Get or create profile directory for this domain
    const domain = config.url ? profileManager.extractDomain(config.url) : 'default';
    const profilePath = await profileManager.ensureProfileDir(domain);

    console.log(`[BrowserManager] Using profile: ${profilePath}`);

    // Check if running in Docker/production
    const isProduction = process.env.NODE_ENV === 'production';

    const chromeFlags = isProduction ? [
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
    ] : CHROME_FLAGS_WINDOWS;

    // Launch persistent context (keeps cookies, localStorage, etc.)
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      channel: isProduction ? undefined : 'chrome',
      args: chromeFlags,
      ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
      viewport: config.viewport,
      userAgent: config.userAgent,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      javaScriptEnabled: true,
      hasTouch: false,
      isMobile: false,
      deviceScaleFactor: 1,
    });

    // Get existing page or create new one
    const page = context.pages()[0] || await context.newPage();

    // Create CDP session
    const cdp = await context.newCDPSession(page);

    // Enable CDP domains
    await Promise.all([
      cdp.send('DOM.enable'),
      cdp.send('CSS.enable'),
      cdp.send('Overlay.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Page.enable'),
    ]);

    // Navigate to URL
    if (config.url) {
      await page.goto(config.url, { waitUntil: 'domcontentloaded' });
    }

    // Create CloudflareBypass instance
    const cloudflareBypass = new CloudflareBypass(page);

    const session: BrowserSession = {
      id: sessionId,
      browser: null, // Persistent context doesn't expose browser object
      context,
      page,
      cdp,
      config,
      isPersistent: true,
      cloudflareBypass,
    };

    this.sessions.set(sessionId, session);
    this.setupPageListeners(session);

    // Check for Cloudflare
    if (config.url) {
      await this.handleCloudflareIfNeeded(session);
    }

    console.log(`[BrowserManager] Persistent session ${sessionId} created successfully`);
    return session;
  }

  /**
   * Handle Cloudflare challenge if detected
   */
  private async handleCloudflareIfNeeded(session: BrowserSession): Promise<void> {
    if (!session.cloudflareBypass) return;

    const challenge = await session.cloudflareBypass.detectChallenge();
    if (challenge === 'none') {
      console.log(`[BrowserManager] No Cloudflare challenge detected`);
      return;
    }

    console.log(`[BrowserManager] Cloudflare ${challenge} detected`);
    this.emit('cloudflare:detected', {
      sessionId: session.id,
      challengeType: challenge,
      url: session.page.url(),
    });

    // Try auto-pass first (for interstitial pages)
    if (challenge === 'interstitial') {
      const autoPass = await session.cloudflareBypass.waitForAutoPass(10000);
      if (autoPass) {
        this.emit('cloudflare:passed', { sessionId: session.id });
        return;
      }
    }

    // For turnstile/captcha, emit event and wait for manual solve
    this.emit('cloudflare:needsManualSolve', {
      sessionId: session.id,
      challengeType: challenge,
    });
  }

  /**
   * Export Cloudflare cookies for current session
   */
  async exportCloudflareCookies(sessionId: string): Promise<{ success: boolean; cookieCount: number }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, cookieCount: 0 };
    }

    const domain = session.config.url ? profileManager.extractDomain(session.config.url) : 'default';
    const cookies = await profileManager.exportCloudflareCookies(session.context, domain);

    return { success: cookies.length > 0, cookieCount: cookies.length };
  }

  /**
   * Get Cloudflare status for current session
   */
  async getCloudflareStatus(sessionId: string): Promise<{ hasChallenge: boolean; challengeType: string; hasClearance: boolean } | null> {
    const session = this.sessions.get(sessionId);
    if (!session?.cloudflareBypass) {
      return null;
    }

    const status = await session.cloudflareBypass.getStatus();
    return {
      hasChallenge: status.hasChallenge,
      challengeType: status.challengeType,
      hasClearance: status.hasClearance,
    };
  }

  private setupPageListeners(session: BrowserSession): void {
    const { page, id } = session;

    // DOM content loaded
    page.on('domcontentloaded', () => {
      this.emit('page:domcontentloaded', { sessionId: id, url: page.url() });
    });

    // Navigation events
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.emit('page:navigated', { sessionId: id, url: frame.url() });
      }
    });

    // Console messages (useful for debugging)
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.emit('page:console', { sessionId: id, type: 'error', text: msg.text() });
      }
    });

    // Dialog handling (alerts, confirms, prompts)
    page.on('dialog', async (dialog) => {
      this.emit('page:dialog', {
        sessionId: id,
        type: dialog.type(),
        message: dialog.message(),
      });
      // Auto-dismiss for scraping
      await dialog.dismiss();
    });
  }

  getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    console.log(`[BrowserManager] Destroying session ${sessionId}`);

    // Remove from map first to prevent double cleanup
    this.sessions.delete(sessionId);

    try {
      // Try to detach CDP, but ignore errors if already detached
      try {
        await session.cdp.detach();
      } catch {
        // CDP session may already be detached
      }

      // Close page if still open
      if (!session.page.isClosed()) {
        await session.page.close();
      }

      // Close context and browser
      await session.context.close().catch(() => {});
      // For persistent context, browser is null
      if (session.browser) {
        await session.browser.close().catch(() => {});
      }
    } catch (error) {
      console.error(`[BrowserManager] Error destroying session:`, error);
    }
  }

  // =========================================================================
  // INPUT HANDLING (CDP-based for lowest latency)
  // =========================================================================

  async handleMouseEvent(sessionId: string, event: MouseEvent): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const { cdp, page } = session;
    const viewport = page.viewportSize();
    if (!viewport) return;

    // Clamp coordinates to viewport
    const x = Math.max(0, Math.min(event.x, viewport.width));
    const y = Math.max(0, Math.min(event.y, viewport.height));

    const modifiers = this.getModifierFlags(event.modifiers);
    const button = event.button === 'left' ? 'left' : event.button === 'right' ? 'right' : 'middle';

    switch (event.type) {
      case 'move':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x,
          y,
          modifiers,
        });
        break;

      case 'down':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button,
          clickCount: 1,
          modifiers,
        });
        break;

      case 'up':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button,
          clickCount: 1,
          modifiers,
        });
        break;

      case 'click':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button,
          clickCount: 1,
          modifiers,
        });
        // Small delay to allow DOM to process the mousedown before mouseup
        // This prevents click-through when elements close on mousedown
        await new Promise(resolve => setTimeout(resolve, 50));
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button,
          clickCount: 1,
          modifiers,
        });
        break;

      case 'dblclick':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button,
          clickCount: 2,
          modifiers,
        });
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button,
          clickCount: 2,
          modifiers,
        });
        break;

      case 'contextmenu':
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button: 'right',
          clickCount: 1,
          modifiers,
        });
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button: 'right',
          clickCount: 1,
          modifiers,
        });
        break;
    }
  }

  async handleKeyboardEvent(sessionId: string, event: KeyboardEvent): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const { cdp } = session;
    const modifiers = this.getModifierFlags(event.modifiers);

    // Map key to keyCode
    const keyCode = this.getKeyCode(event.key);

    switch (event.type) {
      case 'keydown':
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: keyCode,
          modifiers,
        });

        // For printable characters, also send char event
        if (event.key.length === 1) {
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'char',
            text: event.key,
            key: event.key,
            code: event.code,
            windowsVirtualKeyCode: keyCode,
            nativeVirtualKeyCode: keyCode,
            modifiers,
          });
        }
        break;

      case 'keyup':
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: keyCode,
          modifiers,
        });
        break;
    }
  }

  async handleScroll(sessionId: string, event: ScrollEvent): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const { cdp } = session;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: event.x,
      y: event.y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  }

  // =========================================================================
  // NAVIGATION
  // =========================================================================

  async navigate(sessionId: string, url: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    await session.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  // =========================================================================
  // CDP ACCESS
  // =========================================================================

  getCDPSession(sessionId: string): CDPSession | undefined {
    return this.sessions.get(sessionId)?.cdp;
  }

  getPage(sessionId: string): Page | undefined {
    return this.sessions.get(sessionId)?.page;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private getModifierFlags(modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  }): number {
    let flags = 0;
    if (modifiers?.alt) flags |= 1;
    if (modifiers?.ctrl) flags |= 2;
    if (modifiers?.meta) flags |= 4;
    if (modifiers?.shift) flags |= 8;
    return flags;
  }

  private getKeyCode(key: string): number {
    // Common key codes
    const keyMap: Record<string, number> = {
      Backspace: 8,
      Tab: 9,
      Enter: 13,
      Shift: 16,
      Control: 17,
      Alt: 18,
      Escape: 27,
      Space: 32,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
      Delete: 46,
      a: 65, b: 66, c: 67, d: 68, e: 69, f: 70, g: 71, h: 72, i: 73,
      j: 74, k: 75, l: 76, m: 77, n: 78, o: 79, p: 80, q: 81, r: 82,
      s: 83, t: 84, u: 85, v: 86, w: 87, x: 88, y: 89, z: 90,
      '0': 48, '1': 49, '2': 50, '3': 51, '4': 52,
      '5': 53, '6': 54, '7': 55, '8': 56, '9': 57,
    };

    return keyMap[key] || key.charCodeAt(0);
  }

  async cleanup(): Promise<void> {
    console.log('[BrowserManager] Cleaning up all sessions');
    for (const sessionId of this.sessions.keys()) {
      await this.destroySession(sessionId);
    }
  }
}
