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
  lastClick?: { selector: string; x: number; y: number };
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

    this.state.accumulatedScrollY += deltaY;

    // Actually perform the scroll
    await this.page.evaluate((dy) => {
      window.scrollBy(0, dy);
    }, deltaY);

    // Wait for potential lazy loading
    await this.page.waitForTimeout(300);

    const currentCount = await this.countProducts(this.state.itemSelector);
    const delta = currentCount - this.state.startProductCount;

    // Check if we should trigger auto-complete
    const shouldAutoComplete = delta > 0;
    if (shouldAutoComplete) {
      this.scheduleAutoComplete();
    }

    console.log(`[PaginationDemo] Scroll: deltaY=${deltaY}, total=${this.state.accumulatedScrollY}, products=${currentCount} (delta: ${delta})`);

    return {
      currentCount,
      delta,
      shouldAutoComplete,
      accumulatedScroll: this.state.accumulatedScrollY,
    };
  }

  /**
   * Handle user click event
   */
  async handleClick(x: number, y: number): Promise<{
    selector: string;
    currentCount: number;
    delta: number;
    urlChanged: boolean;
    wrongNavigation: boolean;
    shouldAutoComplete: boolean;
  }> {
    if (!this.state?.active) throw new Error('Demo not active');

    const beforeUrl = this.page.url();

    // Get element at coordinates and its selector BEFORE clicking
    const elementInfo = await this.page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;

      // Build CSS selector with priority
      const getSelector = (element: Element): string => {
        if (element.id) return `#${element.id}`;
        if (element.getAttribute('data-testid')) {
          return `[data-testid="${element.getAttribute('data-testid')}"]`;
        }
        if (element.getAttribute('aria-label')) {
          return `[aria-label="${element.getAttribute('aria-label')}"]`;
        }
        // Class-based selector
        const classes = Array.from(element.classList)
          .filter(c => !c.match(/^(hover|active|focus|selected|js-|is-|has-)/))
          .slice(0, 3);
        if (classes.length > 0) {
          return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
        }
        return element.tagName.toLowerCase();
      };

      return {
        selector: getSelector(el),
        tagName: el.tagName,
        text: el.textContent?.trim().slice(0, 50),
      };
    }, { x, y });

    if (!elementInfo) {
      console.log(`[PaginationDemo] No element found at coordinates (${x}, ${y})`);
      throw new Error('No element at click coordinates');
    }

    console.log(`[PaginationDemo] Click on: ${elementInfo.selector} "${elementInfo.text}"`);

    // Store click info
    this.state.lastClick = { selector: elementInfo.selector, x, y };

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
