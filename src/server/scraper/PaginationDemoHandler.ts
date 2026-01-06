// ============================================================================
// PAGINATION DEMO HANDLER
// ============================================================================
// Handles user-guided pagination demonstration mode
// User scrolls or clicks to show how pagination works, system captures the method

import type { Page } from 'playwright';
import type {
  UserDemonstratedPagination,
  PaginationDemoEvent,
} from '../ai/types.js';

interface DemoState {
  active: boolean;
  startProductCount: number;
  startUrl: string;
  accumulatedScrollY: number;
  lastClick?: { selector: string; text: string; x: number; y: number };
  itemSelector: string;
  autoCompleteTimer?: ReturnType<typeof setTimeout>;
  urlChanged: boolean;  // Track if URL changed during demo (for pagination detection)
}

type DemoEventCallback = (event: PaginationDemoEvent) => void;

export class PaginationDemoHandler {
  private page: Page;
  private state: DemoState | null = null;
  private eventCallback: DemoEventCallback | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Set callback for async events (auto-complete, wrong navigation)
   */
  setEventCallback(callback: DemoEventCallback): void {
    this.eventCallback = callback;
  }

  /**
   * Start demonstration mode
   */
  async startDemo(itemSelector: string): Promise<{ productCount: number; url: string }> {
    const productCount = await this.countProducts(itemSelector);
    const url = this.page.url();

    this.state = {
      active: true,
      startProductCount: productCount,
      startUrl: url,
      accumulatedScrollY: 0,
      itemSelector,
      urlChanged: false,
    };

    console.log(`[PaginationDemo] Started demo with ${productCount} products at ${url}`);
    return { productCount, url };
  }

  /**
   * Handle user scroll event
   */
  async handleScroll(deltaY: number): Promise<{
    currentCount: number;
    delta: number;
    shouldAutoComplete: boolean;
    accumulatedScroll: number;
  }> {
    if (!this.state?.active) throw new Error('Demo not active');

    // Store values locally in case state is cleared during async operations
    const itemSelector = this.state.itemSelector;
    const startProductCount = this.state.startProductCount;

    this.state.accumulatedScrollY += deltaY;
    const accumulatedScroll = this.state.accumulatedScrollY;

    // Actually perform the scroll
    await this.page.evaluate((dy) => {
      window.scrollBy(0, dy);
    }, deltaY);

    // Wait for potential lazy loading
    await this.page.waitForTimeout(300);

    // Check if state was cleared during async operations (e.g., by auto-complete)
    if (!this.state?.active) {
      console.log('[PaginationDemo] State cleared during scroll handling, ignoring');
      return {
        currentCount: 0,
        delta: 0,
        shouldAutoComplete: false,
        accumulatedScroll,
      };
    }

    const currentCount = await this.countProducts(itemSelector);
    const delta = currentCount - startProductCount;

    // Check if we should trigger auto-complete
    const shouldAutoComplete = delta > 0;
    if (shouldAutoComplete && this.state?.active) {
      this.scheduleAutoComplete();
    }

    console.log(`[PaginationDemo] Scroll: deltaY=${deltaY}, total=${accumulatedScroll}, products=${currentCount} (delta: ${delta})`);

    return {
      currentCount,
      delta,
      shouldAutoComplete,
      accumulatedScroll,
    };
  }

  /**
   * Handle user click event
   */
  async handleClick(x: number, y: number): Promise<{
    selector: string;
    text: string;
    currentCount: number;
    delta: number;
    urlChanged: boolean;
    wrongNavigation: boolean;
    shouldAutoComplete: boolean;
  }> {
    if (!this.state?.active) throw new Error('Demo not active');

    const beforeUrl = this.page.url();
    const viewport = this.page.viewportSize();
    console.log(`[PaginationDemo] handleClick called with (${x}, ${y}), viewport: ${viewport?.width}x${viewport?.height}`);

    // Get element at coordinates and its selector BEFORE clicking
    // Note: Use function declaration instead of arrow functions to avoid esbuild __name transformation issues
    const elementInfo = await this.page.evaluate(function(coords: { x: number; y: number }) {
      const el = document.elementFromPoint(coords.x, coords.y);
      if (!el) {
        return null;
      }

      // Build CSS selector with priority - inline to avoid function transformation issues
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector = '#' + el.id;
      } else if (el.getAttribute('data-testid')) {
        selector = '[data-testid="' + el.getAttribute('data-testid') + '"]';
      } else if (el.getAttribute('aria-label')) {
        selector = '[aria-label="' + el.getAttribute('aria-label') + '"]';
      } else {
        // Class-based selector
        const validClasses: string[] = [];
        for (let i = 0; i < el.classList.length && validClasses.length < 3; i++) {
          const c = el.classList[i];
          if (!/^(hover|active|focus|selected|js-|is-|has-)/.test(c)) {
            validClasses.push(c);
          }
        }
        if (validClasses.length > 0) {
          selector = el.tagName.toLowerCase() + '.' + validClasses.join('.');
        }
      }

      return {
        selector: selector,
        tagName: el.tagName,
        text: el.textContent ? el.textContent.trim().slice(0, 50) : '',
      };
    }, { x, y });

    if (!elementInfo) {
      console.log(`[PaginationDemo] No element found at coordinates (${x}, ${y})`);
      throw new Error('No element at click coordinates');
    }

    console.log(`[PaginationDemo] Click on: ${elementInfo.selector} "${elementInfo.text}"`);

    // Store click info including text
    this.state.lastClick = { selector: elementInfo.selector, text: elementInfo.text, x, y };

    // Actually click the element
    await this.page.mouse.click(x, y);

    // Wait for navigation or content change
    await Promise.race([
      this.page.waitForNavigation({ timeout: 3000 }).catch(() => {}),
      this.page.waitForTimeout(1500),
    ]);

    const afterUrl = this.page.url();
    const urlChanged = afterUrl !== beforeUrl;

    // Check for WRONG navigation (different host or product detail page)
    let wrongNavigation = false;
    try {
      const beforeHost = new URL(beforeUrl).hostname;
      const afterHost = new URL(afterUrl).hostname;
      wrongNavigation = beforeHost !== afterHost || this.isProductDetailPage(afterUrl, beforeUrl);
    } catch {
      // URL parsing failed - treat as wrong navigation to be safe
      wrongNavigation = urlChanged;
    }

    // If wrong navigation, go back automatically
    if (wrongNavigation) {
      console.log(`[PaginationDemo] Wrong navigation detected: ${beforeUrl} -> ${afterUrl}, going back...`);
      await this.page.goBack({ timeout: 5000 }).catch(() => {});
      await this.page.waitForTimeout(500);

      // Notify about wrong navigation
      this.eventCallback?.({
        type: 'wrongNavigation',
        data: { clickedUrl: afterUrl, returnedTo: this.state.startUrl },
      });

      return {
        selector: elementInfo.selector,
        text: elementInfo.text,
        currentCount: this.state.startProductCount,
        delta: 0,
        urlChanged: false,
        wrongNavigation: true,
        shouldAutoComplete: false,
      };
    }

    const currentCount = await this.countProducts(this.state.itemSelector);
    const delta = currentCount - this.state.startProductCount;

    // Track if URL changed for later verification
    if (urlChanged) {
      this.state.urlChanged = true;
    }

    // Check if we should trigger auto-complete:
    // - For infinite scroll: delta > 0 (more products loaded)
    // - For pagination clicks: URL changed AND products still present (page navigation)
    const isSuccessfulPagination = urlChanged && currentCount > 0;
    const shouldAutoComplete = delta > 0 || isSuccessfulPagination;
    if (shouldAutoComplete) {
      this.scheduleAutoComplete();
    }

    console.log(`[PaginationDemo] After click: products=${currentCount} (delta: ${delta}), urlChanged=${urlChanged}, isSuccessfulPagination=${isSuccessfulPagination}`);

    return {
      selector: elementInfo.selector,
      text: elementInfo.text,
      currentCount,
      delta,
      urlChanged,
      wrongNavigation: false,
      shouldAutoComplete,
    };
  }

  /**
   * Schedule auto-complete after 1.5 seconds of stability
   */
  private scheduleAutoComplete(): void {
    // Clear any existing timer
    if (this.state?.autoCompleteTimer) {
      clearTimeout(this.state.autoCompleteTimer);
    }

    this.state!.autoCompleteTimer = setTimeout(async () => {
      if (this.state?.active) {
        console.log('[PaginationDemo] Auto-completing demo...');
        try {
          const result = await this.completeDemo();
          this.eventCallback?.({
            type: 'autoComplete',
            data: result,
          });
        } catch (error: any) {
          console.error('[PaginationDemo] Auto-complete failed:', error.message);
          this.eventCallback?.({
            type: 'error',
            data: { error: error.message },
          });
        }
      }
    }, 1500); // 1.5 second delay for auto-complete
  }

  /**
   * Heuristic to detect if URL is a product detail page
   */
  private isProductDetailPage(newUrl: string, originalUrl: string): boolean {
    // Common patterns for product pages
    const productPatterns = [
      /\/product\//i,
      /\/item\//i,
      /\/p\//i,
      /\/dp\//i,  // Amazon
      /\/products\/[^/]+$/i,
      /\/artikel\//i,  // German sites
      /\/produkt\//i,  // German sites
      /\?sku=/i,
      /\?productId=/i,
      /\?itemId=/i,
    ];

    // Check if new URL matches product page patterns but original didn't
    const newIsProduct = productPatterns.some(p => p.test(newUrl));
    const originalIsProduct = productPatterns.some(p => p.test(originalUrl));

    return newIsProduct && !originalIsProduct;
  }

  /**
   * Complete the demo and return results
   */
  async completeDemo(): Promise<UserDemonstratedPagination> {
    if (!this.state?.active) throw new Error('Demo not active');

    // Clear auto-complete timer
    if (this.state.autoCompleteTimer) {
      clearTimeout(this.state.autoCompleteTimer);
    }

    const finalCount = await this.countProducts(this.state.itemSelector);
    const delta = finalCount - this.state.startProductCount;

    // For verification:
    // - Infinite scroll: delta > 0 (more products appeared)
    // - Pagination click: URL changed AND products present (navigated to new page)
    const isVerified = delta > 0 || (this.state.urlChanged && finalCount > 0);

    const result: UserDemonstratedPagination = {
      method: this.state.lastClick ? 'click' : 'scroll',
      beforeProductCount: this.state.startProductCount,
      afterProductCount: finalCount,
      productDelta: delta,
      verified: isVerified,
    };

    if (this.state.lastClick) {
      result.clickSelector = this.state.lastClick.selector;
      result.clickText = this.state.lastClick.text;
      result.clickCoordinates = { x: this.state.lastClick.x, y: this.state.lastClick.y };
    } else {
      result.scrollDistance = this.state.accumulatedScrollY;
    }

    console.log(`[PaginationDemo] Demo completed: method=${result.method}, delta=${delta}, verified=${result.verified}`);

    this.state = null;
    return result;
  }

  /**
   * Cancel the demo
   */
  cancelDemo(): void {
    if (this.state?.autoCompleteTimer) {
      clearTimeout(this.state.autoCompleteTimer);
    }
    console.log('[PaginationDemo] Demo cancelled');
    this.state = null;
  }

  /**
   * Check if demo is currently active
   */
  isActive(): boolean {
    return this.state?.active ?? false;
  }

  /**
   * Count products using the item selector
   */
  private async countProducts(selector: string): Promise<number> {
    return await this.page.evaluate((sel) => {
      return document.querySelectorAll(sel).length;
    }, selector);
  }
}
