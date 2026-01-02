// ============================================================================
// PAGINATION HANDLER
// ============================================================================
// Handles navigation between pages for paginated content

import type { Page } from 'playwright';
import type { OffsetConfig } from '../../../shared/types.js';

/**
 * Pagination configuration
 */
export interface PaginationConfig {
  /** Whether pagination is enabled */
  enabled: boolean;
  /** Pagination type: 'url_pattern' for URL-based, 'next_page'/'infinite_scroll' for click-based, 'hybrid' for both */
  type?: 'url_pattern' | 'next_page' | 'infinite_scroll' | 'hybrid';
  /** CSS selector for the next page button/link (for click-based pagination) */
  selector?: string;
  /** URL pattern with {page} or {offset} placeholder */
  pattern?: string;
  /** Offset configuration for URL-based offset pagination */
  offset?: OffsetConfig;
  /** Maximum number of pages to scrape */
  maxPages: number;
  /** Delay after clicking next page in ms */
  waitAfterClick?: number;
}

/**
 * Pagination state
 */
export interface PaginationState {
  currentPage: number;
  hasNextPage: boolean;
  totalPagesScraped: number;
}

/**
 * Handles pagination for multi-page scraping
 */
export class PaginationHandler {
  private page: Page;
  private config: PaginationConfig;
  private state: PaginationState;

  constructor(page: Page, config: PaginationConfig) {
    this.page = page;
    this.config = config;
    this.state = {
      currentPage: 1,
      hasNextPage: false,
      totalPagesScraped: 0,
    };
  }

  /**
   * Check if we should continue to next page
   */
  shouldContinue(): boolean {
    return (
      this.config.enabled &&
      this.state.currentPage < this.config.maxPages &&
      this.state.hasNextPage
    );
  }

  /**
   * Check if the next page button exists and is clickable
   * For URL-based pagination, always returns true if within maxPages
   */
  async checkNextPageExists(): Promise<boolean> {
    // For URL-based pagination, we can always go to next page within limits
    if (this.config.type === 'url_pattern' && this.config.offset) {
      const hasNext = this.state.currentPage < this.config.maxPages;
      this.state.hasNextPage = hasNext;
      return hasNext;
    }

    // Click-based pagination - check if selector exists
    if (!this.config.selector) {
      this.state.hasNextPage = false;
      return false;
    }

    const exists = await this.page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;

      // Check if disabled
      if (el.hasAttribute('disabled')) return false;
      if (el.classList.contains('disabled')) return false;
      if (el.getAttribute('aria-disabled') === 'true') return false;

      // Check if visible
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;

      return true;
    }, this.config.selector);

    this.state.hasNextPage = exists;
    return exists;
  }

  /**
   * Navigate to the next page
   * Returns true if navigation was successful
   */
  async goToNextPage(): Promise<boolean> {
    // Check pagination type
    if (this.config.type === 'url_pattern' && this.config.offset) {
      return this.goToNextPageByUrl();
    }

    // Hybrid mode: scroll to load lazy content, then click for more
    if (this.config.type === 'hybrid') {
      return this.goToNextPageHybrid();
    }

    // Click-based pagination (next_page or infinite_scroll)
    return this.goToNextPageByClick();
  }

  /**
   * Navigate to next page using hybrid mode (scroll + click)
   * First scrolls to load any lazy content, then clicks load-more button
   */
  private async goToNextPageHybrid(): Promise<boolean> {
    console.log('[PaginationHandler] Using hybrid mode: scroll + click');

    // Step 1: Scroll to bottom to trigger any lazy loading
    const initialHeight = await this.page.evaluate(() => document.documentElement.scrollHeight);
    let currentY = 0;
    const scrollStep = 500;
    const maxScrolls = 20; // Prevent infinite scroll
    let scrollCount = 0;

    while (scrollCount < maxScrolls) {
      currentY += scrollStep;
      await this.page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), currentY);
      await new Promise((r) => setTimeout(r, 400));
      scrollCount++;

      // Check if we reached the bottom
      const scrollInfo = await this.page.evaluate(() => ({
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));

      if (scrollInfo.scrollY + scrollInfo.innerHeight >= scrollInfo.scrollHeight - 100) {
        break;
      }
    }

    // Step 2: Look for and click the load-more button
    if (this.config.selector) {
      // Scroll button into view
      await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, this.config.selector);
      await new Promise((r) => setTimeout(r, 500));

      // Check if button exists and is clickable
      const exists = await this.checkNextPageExists();
      if (exists) {
        const clicked = await this.goToNextPageByClick();
        if (clicked) {
          console.log('[PaginationHandler] Hybrid mode: scroll + click successful');
          return true;
        }
      }
    }

    // Check if scroll alone loaded new content
    const newHeight = await this.page.evaluate(() => document.documentElement.scrollHeight);
    if (newHeight > initialHeight + 200) {
      console.log(`[PaginationHandler] Hybrid mode: scroll loaded content (height ${initialHeight} -> ${newHeight})`);
      this.state.currentPage++;
      this.state.totalPagesScraped++;
      // Scroll back to top for scraping
      await this.page.evaluate(() => window.scrollTo(0, 0));
      await new Promise((r) => setTimeout(r, 300));
      return true;
    }

    console.log('[PaginationHandler] Hybrid mode: no more content to load');
    this.state.hasNextPage = false;
    return false;
  }

  /**
   * Navigate to next page using URL manipulation (offset-based)
   */
  private async goToNextPageByUrl(): Promise<boolean> {
    if (!this.config.offset) {
      console.log('[PaginationHandler] No offset config for URL pagination');
      return false;
    }

    const { key, start, increment } = this.config.offset;
    const nextPage = this.state.currentPage + 1;

    // Calculate the offset value for the next page
    // Page 1 = start, Page 2 = start + increment, Page 3 = start + 2*increment, etc.
    const offsetValue = start + (nextPage - 1) * increment;

    try {
      const currentUrl = new URL(this.page.url());
      currentUrl.searchParams.set(key, String(offsetValue));
      const nextUrl = currentUrl.toString();

      console.log(`[PaginationHandler] Navigating to page ${nextPage} via URL: ${key}=${offsetValue}`);

      await this.page.goto(nextUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      // Wait for configured delay
      if (this.config.waitAfterClick && this.config.waitAfterClick > 0) {
        await new Promise((r) => setTimeout(r, this.config.waitAfterClick));
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }

      this.state.currentPage++;
      this.state.totalPagesScraped++;
      this.state.hasNextPage = this.state.currentPage < this.config.maxPages;
      console.log(`[PaginationHandler] Navigated to page ${this.state.currentPage}`);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PaginationHandler] Failed to navigate by URL: ${message}`);
      this.state.hasNextPage = false;
      return false;
    }
  }

  /**
   * Navigate to next page using click (selector-based)
   */
  private async goToNextPageByClick(): Promise<boolean> {
    // First check if next page exists
    const exists = await this.checkNextPageExists();
    if (!exists) {
      console.log('[PaginationHandler] No next page found');
      return false;
    }

    if (!this.config.selector) {
      console.log('[PaginationHandler] No selector for click-based pagination');
      return false;
    }

    try {
      // Click and wait for navigation
      await Promise.all([
        this.page
          .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 })
          .catch(() => {
            // Navigation might not happen for SPA pagination
          }),
        this.page.click(this.config.selector),
      ]);

      // Wait for configured delay
      if (this.config.waitAfterClick && this.config.waitAfterClick > 0) {
        await new Promise((r) => setTimeout(r, this.config.waitAfterClick));
      } else {
        // Default brief wait for JS execution
        await new Promise((r) => setTimeout(r, 500));
      }

      this.state.currentPage++;
      this.state.totalPagesScraped++;
      console.log(`[PaginationHandler] Navigated to page ${this.state.currentPage}`);

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PaginationHandler] Failed to navigate: ${message}`);
      this.state.hasNextPage = false;
      return false;
    }
  }

  /**
   * Get current pagination state
   */
  getState(): PaginationState {
    return { ...this.state };
  }

  /**
   * Reset pagination state (for new scrape)
   */
  reset(): void {
    this.state = {
      currentPage: 1,
      hasNextPage: false,
      totalPagesScraped: 0,
    };
  }

  /**
   * Get remaining pages to scrape
   */
  getRemainingPages(): number {
    if (!this.config.enabled) return 0;
    return Math.max(0, this.config.maxPages - this.state.currentPage);
  }
}
