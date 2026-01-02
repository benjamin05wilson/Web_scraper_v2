// ============================================================================
// POPUP HANDLER - Automatically detects and closes popups
// ============================================================================

import type { Page } from 'playwright';

export interface PopupCloseResult {
  selector: string;
  text?: string;
  success: boolean;
}

export interface PopupDetectionResult {
  found: number;
  closed: PopupCloseResult[];
  remaining: number;
}

// Common popup/modal selectors to look for
const POPUP_SELECTORS = [
  // Cookie consent / GDPR
  '[class*="cookie"] button[class*="accept"]',
  '[class*="cookie"] button[class*="agree"]',
  '[class*="cookie"] button[class*="allow"]',
  '[class*="cookie"] button[class*="consent"]',
  '[class*="cookie"] button[class*="ok"]',
  '[class*="gdpr"] button[class*="accept"]',
  '[class*="consent"] button[class*="accept"]',
  '[class*="consent"] button[class*="agree"]',
  '[id*="cookie"] button[class*="accept"]',
  '[id*="cookie"] button[class*="agree"]',
  '[data-testid*="cookie"] button',
  '[aria-label*="cookie" i] button',
  '[aria-label*="accept" i][aria-label*="cookie" i]',
  'button[aria-label*="accept" i]',

  // Generic close buttons on modals/overlays
  '[class*="modal"] [class*="close"]',
  '[class*="modal"] button[aria-label*="close" i]',
  '[class*="overlay"] [class*="close"]',
  '[class*="popup"] [class*="close"]',
  '[class*="dialog"] [class*="close"]',
  '[role="dialog"] button[aria-label*="close" i]',
  '[role="dialog"] [class*="close"]',

  // Specific common patterns
  '.onetrust-close-btn-handler',
  '#onetrust-accept-btn-handler',
  '.cc-dismiss',
  '.cc-accept',
  '.fc-cta-consent',
  '.fc-button-label',
  '[data-action="accept"]',
  'button[data-gdpr-action="accept"]',
  '.js-cookie-accept',
  '.cookie-accept',
  '.accept-cookies',
  '#accept-cookies',
  '.cookie-banner__accept',
  '.cookie-notice__accept',

  // Newsletter/signup modals - close buttons
  '[class*="newsletter"] [class*="close"]',
  '[class*="subscribe"] [class*="close"]',
  '[class*="signup"] [class*="close"]',
  '[class*="sign-up"] [class*="close"]',

  // Generic X close buttons
  'button[class*="close"]:not([class*="closeout"])',
  '[class*="modal"] svg[class*="close"]',
  '[class*="modal"] [data-dismiss="modal"]',

  // Language selectors - look for confirm/continue buttons
  '[class*="language"] button[class*="confirm"]',
  '[class*="language"] button[class*="continue"]',
  '[class*="country"] button[class*="confirm"]',
  '[class*="country"] button[class*="continue"]',
];

// Text patterns that indicate "accept/close" buttons
const ACCEPT_TEXT_PATTERNS = [
  /^accept$/i,
  /^accept all$/i,
  /^agree$/i,
  /^i agree$/i,
  /^ok$/i,
  /^okay$/i,
  /^got it$/i,
  /^allow$/i,
  /^allow all$/i,
  /^continue$/i,
  /^confirm$/i,
  /^close$/i,
  /^dismiss$/i,
  /^no thanks$/i,
  /^not now$/i,
  /^maybe later$/i,
  /^×$/,  // X character
  /^✕$/,  // X symbol
  /^✖$/,  // X symbol
];

export class PopupHandler {
  constructor(private page: Page) {}

  /**
   * Automatically detect and close common popups
   */
  async autoClosePopups(): Promise<PopupDetectionResult> {
    const closed: PopupCloseResult[] = [];
    let found = 0;

    console.log('[PopupHandler] Starting auto-close...');

    // First, try specific selectors
    for (const selector of POPUP_SELECTORS) {
      try {
        const elements = await this.page.$$(selector);
        for (const element of elements) {
          const isVisible = await element.isVisible().catch(() => false);
          if (isVisible) {
            found++;
            const text = await element.textContent().catch(() => '');
            try {
              await element.click({ timeout: 2000 });
              await this.page.waitForTimeout(500); // Wait for animation
              closed.push({ selector, text: text?.trim(), success: true });
              console.log(`[PopupHandler] Closed: ${selector} (${text?.trim()})`);
            } catch (e) {
              closed.push({ selector, text: text?.trim(), success: false });
            }
          }
        }
      } catch {
        // Selector not found, continue
      }
    }

    // Second pass: look for buttons with accept-like text
    try {
      const buttons = await this.page.$$('button, [role="button"], a[class*="button"], a[class*="btn"]');
      for (const button of buttons) {
        const isVisible = await button.isVisible().catch(() => false);
        if (!isVisible) continue;

        const text = await button.textContent().catch(() => '');
        const ariaLabel = await button.getAttribute('aria-label').catch(() => '');
        const combinedText = `${text} ${ariaLabel}`.trim();

        // Check if text matches accept patterns
        const matchesPattern = ACCEPT_TEXT_PATTERNS.some(pattern => pattern.test(combinedText));
        if (matchesPattern) {
          // Check if it's in a modal/overlay context
          const isInPopup = await button.evaluate((el) => {
            let parent = el.parentElement;
            while (parent) {
              const classes = parent.className?.toLowerCase() || '';
              const role = parent.getAttribute('role');
              if (
                classes.includes('modal') ||
                classes.includes('overlay') ||
                classes.includes('popup') ||
                classes.includes('dialog') ||
                classes.includes('cookie') ||
                classes.includes('consent') ||
                classes.includes('banner') ||
                role === 'dialog' ||
                role === 'alertdialog'
              ) {
                return true;
              }
              parent = parent.parentElement;
            }
            return false;
          }).catch(() => false);

          if (isInPopup) {
            found++;
            try {
              await button.click({ timeout: 2000 });
              await this.page.waitForTimeout(500);
              const selector = await this.getSelector(button);
              closed.push({ selector, text: combinedText, success: true });
              console.log(`[PopupHandler] Closed by text: "${combinedText}"`);
            } catch {
              // Click failed
            }
          }
        }
      }
    } catch {
      // Error scanning buttons
    }

    // Check for remaining popups
    const remaining = await this.countRemainingPopups();

    console.log(`[PopupHandler] Found: ${found}, Closed: ${closed.filter(c => c.success).length}, Remaining: ${remaining}`);

    return { found, closed, remaining };
  }

  /**
   * Count how many popup-like elements are still visible
   */
  private async countRemainingPopups(): Promise<number> {
    try {
      return await this.page.evaluate(() => {
        const popupSelectors = [
          '[class*="modal"]:not([style*="display: none"])',
          '[class*="overlay"]:not([style*="display: none"])',
          '[class*="popup"]:not([style*="display: none"])',
          '[class*="cookie"]:not([style*="display: none"])',
          '[class*="consent"]:not([style*="display: none"])',
          '[class*="banner"]:not([style*="display: none"])',
          '[role="dialog"]',
          '[role="alertdialog"]',
        ];

        let count = 0;
        for (const selector of popupSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            // Check if actually visible and takes up significant space
            if (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              parseFloat(style.opacity) > 0 &&
              rect.width > 100 &&
              rect.height > 50
            ) {
              count++;
            }
          }
        }
        return count;
      });
    } catch {
      return 0;
    }
  }

  /**
   * Get a CSS selector for an element
   */
  private async getSelector(element: any): Promise<string> {
    try {
      return await element.evaluate((el: Element) => {
        if (el.id) return `#${el.id}`;
        if (el.className) {
          const classes = el.className.split(' ').filter(Boolean).slice(0, 2).join('.');
          return `${el.tagName.toLowerCase()}.${classes}`;
        }
        return el.tagName.toLowerCase();
      });
    } catch {
      return 'unknown';
    }
  }
}
