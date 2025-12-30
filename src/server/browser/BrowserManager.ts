// ============================================================================
// BROWSER MANAGER - Playwright + CDP Integration
// ============================================================================

import { chromium, Browser, BrowserContext, Page, CDPSession } from 'playwright';
import { EventEmitter } from 'events';
import {
  CHROME_FLAGS_WINDOWS,
  IGNORED_DEFAULT_ARGS,
  CHROME_ENV_WINDOWS,
} from '../config/chrome-flags.js';
import type { SessionConfig, MouseEvent, KeyboardEvent, ScrollEvent } from '../../shared/types.js';

export interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  config: SessionConfig;
}

export class BrowserManager extends EventEmitter {
  private sessions: Map<string, BrowserSession> = new Map();

  constructor() {
    super();
  }

  async createSession(sessionId: string, config: SessionConfig): Promise<BrowserSession> {
    console.log(`[BrowserManager] Creating session ${sessionId}`);

    // Try to launch with installed Chrome first, fall back to bundled Chromium
    let browser: Browser;
    try {
      console.log('[BrowserManager] Attempting to use installed Chrome...');
      browser = await chromium.launch({
        headless: false,
        channel: 'chrome', // Use installed Chrome for best GPU support
        args: CHROME_FLAGS_WINDOWS,
        ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
        env: {
          ...process.env,
          ...CHROME_ENV_WINDOWS,
        },
      });
      console.log('[BrowserManager] Using installed Chrome');
    } catch (chromeError) {
      console.log('[BrowserManager] Chrome not found, using bundled Chromium:', chromeError);
      browser = await chromium.launch({
        headless: false,
        args: CHROME_FLAGS_WINDOWS,
        ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
        env: {
          ...process.env,
          ...CHROME_ENV_WINDOWS,
        },
      });
      console.log('[BrowserManager] Using bundled Chromium');
    }

    // Create context with viewport
    const context = await browser.newContext({
      viewport: config.viewport,
      userAgent: config.userAgent,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      javaScriptEnabled: true,
      hasTouch: false,
      isMobile: false,
      deviceScaleFactor: 1,
    });

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

    const session: BrowserSession = {
      id: sessionId,
      browser,
      context,
      page,
      cdp,
      config,
    };

    this.sessions.set(sessionId, session);

    // Set up page event listeners
    this.setupPageListeners(session);

    console.log(`[BrowserManager] Session ${sessionId} created successfully`);
    return session;
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
      await session.browser.close().catch(() => {});
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
