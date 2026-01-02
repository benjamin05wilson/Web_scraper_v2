// ============================================================================
// SCROLL TEST HANDLER
// ============================================================================
// Tracks item loading during user scroll test to determine optimal scroll settings

import type { Page } from 'playwright';
import type { ScrollTestResult, ScrollTestUpdate, ScrollStrategy } from '../../shared/types.js';

/**
 * Loading indicator selectors commonly used across frameworks
 */
const COMMON_LOADING_INDICATORS = [
  '.loading',
  '.loading-spinner',
  '.spinner',
  '.loader',
  '[class*="loading"]',
  '[class*="spinner"]',
  '.lds-ring',
  '.lds-dual-ring',
  '.MuiCircularProgress-root',
  '.ant-spin',
  '.chakra-spinner',
  '[data-loading="true"]',
  '[aria-busy="true"]',
  '.skeleton',
  '.skeleton-loader',
  '[class*="skeleton"]',
  '.placeholder',
  '.shimmer',
  '.infinite-loading',
  '.load-more-spinner',
];

interface ScrollEvent {
  timestamp: number;
  scrollY: number;
  itemCount: number;
}

/**
 * Handles scroll testing to detect lazy loading behavior
 */
export class ScrollTestHandler {
  private page: Page;
  private itemSelector: string;
  private isActive: boolean = false;

  // Test data
  private initialCount: number = 0;
  private scrollEvents: ScrollEvent[] = [];
  private itemsLoadedPerScroll: number[] = [];
  private loadingIndicatorsFound: string[] = [];
  private lastItemCount: number = 0;
  private lastScrollTime: number = 0;
  private loadDelays: number[] = [];

  constructor(page: Page, itemSelector: string) {
    this.page = page;
    this.itemSelector = itemSelector;
  }

  /**
   * Start the scroll test
   */
  async startTest(): Promise<void> {
    this.isActive = true;
    this.scrollEvents = [];
    this.itemsLoadedPerScroll = [];
    this.loadingIndicatorsFound = [];
    this.loadDelays = [];

    // Get initial item count
    this.initialCount = await this.getItemCount();
    this.lastItemCount = this.initialCount;

    // Detect any existing loading indicators
    await this.detectLoadingIndicators();

    // Set up scroll listener
    await this.setupScrollListener();

    console.log(`[ScrollTestHandler] Started test. Initial items: ${this.initialCount}`);
  }

  /**
   * Set up scroll listener to track scroll events
   */
  private async setupScrollListener(): Promise<void> {
    await this.page.evaluate(() => {
      // Store scroll handler reference for cleanup
      (window as unknown as { __scrollTestHandler?: () => void }).__scrollTestHandler = () => {
        const event = new CustomEvent('scrollTestEvent', {
          detail: {
            scrollY: window.scrollY,
            timestamp: Date.now(),
          },
        });
        document.dispatchEvent(event);
      };

      window.addEventListener('scroll', (window as unknown as { __scrollTestHandler: () => void }).__scrollTestHandler, {
        passive: true,
      });
    });
  }

  /**
   * Get current item count
   */
  private async getItemCount(): Promise<number> {
    return this.page.evaluate((selector) => {
      // Handle multiple selector formats
      const selectors = selector.split(',').map((s) => s.trim());
      let count = 0;

      for (const sel of selectors) {
        try {
          count += document.querySelectorAll(sel).length;
        } catch {
          // Invalid selector, skip
        }
      }

      return count;
    }, this.itemSelector);
  }

  /**
   * Get current scroll position
   */
  private async getScrollPosition(): Promise<number> {
    return this.page.evaluate(() => window.scrollY);
  }

  /**
   * Detect loading indicators present on the page
   */
  private async detectLoadingIndicators(): Promise<void> {
    const found = await this.page.evaluate((indicators) => {
      const present: string[] = [];

      for (const selector of indicators) {
        try {
          const el = document.querySelector(selector);
          if (el) {
            const style = getComputedStyle(el);
            // Only count visible indicators
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              present.push(selector);
            }
          }
        } catch {
          // Invalid selector, skip
        }
      }

      return present;
    }, COMMON_LOADING_INDICATORS);

    this.loadingIndicatorsFound = found;
  }

  /**
   * Get current test status update
   */
  async getTestUpdate(): Promise<ScrollTestUpdate> {
    const currentCount = await this.getItemCount();
    const scrollPosition = await this.getScrollPosition();

    // Track items loaded since last check
    if (currentCount > this.lastItemCount) {
      const newItems = currentCount - this.lastItemCount;
      this.itemsLoadedPerScroll.push(newItems);

      // Calculate load delay if we had a recent scroll
      if (this.lastScrollTime > 0) {
        const delay = Date.now() - this.lastScrollTime;
        this.loadDelays.push(delay);
      }

      this.lastItemCount = currentCount;
    }

    // Track scroll event
    this.scrollEvents.push({
      timestamp: Date.now(),
      scrollY: scrollPosition,
      itemCount: currentCount,
    });
    this.lastScrollTime = Date.now();

    return {
      initialCount: this.initialCount,
      currentCount,
      scrollPosition,
      itemsLoaded: this.itemsLoadedPerScroll,
    };
  }

  /**
   * Finish the test and calculate recommendations
   */
  async finishTest(): Promise<ScrollTestResult> {
    this.isActive = false;

    // Get final counts
    const finalCount = await this.getItemCount();
    const finalScrollPosition = await this.getScrollPosition();

    // Clean up scroll listener
    await this.page.evaluate(() => {
      const handler = (window as unknown as { __scrollTestHandler?: () => void }).__scrollTestHandler;
      if (handler) {
        window.removeEventListener('scroll', handler);
        delete (window as unknown as { __scrollTestHandler?: () => void }).__scrollTestHandler;
      }
    });

    // Re-detect loading indicators at end
    await this.detectLoadingIndicators();

    // Calculate statistics
    const avgLoadDelay =
      this.loadDelays.length > 0
        ? Math.round(this.loadDelays.reduce((a, b) => a + b, 0) / this.loadDelays.length)
        : 500;

    const totalItemsLoaded = finalCount - this.initialCount;
    const scrollIterations = this.itemsLoadedPerScroll.length;

    // Determine recommended strategy
    const recommendedStrategy = this.determineStrategy(avgLoadDelay, this.itemsLoadedPerScroll);
    const recommendedDelay = this.calculateRecommendedDelay(avgLoadDelay, recommendedStrategy);
    const recommendedMaxIterations = this.calculateMaxIterations(
      totalItemsLoaded,
      scrollIterations,
      finalScrollPosition
    );

    console.log(`[ScrollTestHandler] Test complete. Items: ${this.initialCount} -> ${finalCount}`);
    console.log(`[ScrollTestHandler] Recommended: ${recommendedStrategy}, ${recommendedDelay}ms delay`);

    return {
      initialItemCount: this.initialCount,
      finalItemCount: finalCount,
      itemsLoadedPerScroll: this.itemsLoadedPerScroll,
      totalScrollDistance: finalScrollPosition,
      scrollIterations,
      avgLoadDelay,
      recommendedStrategy,
      recommendedDelay,
      recommendedMaxIterations,
      loadingIndicatorsFound: this.loadingIndicatorsFound,
    };
  }

  /**
   * Determine the best scroll strategy based on observed behavior
   */
  private determineStrategy(avgDelay: number, itemsPerScroll: number[]): ScrollStrategy {
    // If items load quickly and consistently, use rapid
    if (avgDelay < 300 && itemsPerScroll.length > 0) {
      const variance = this.calculateVariance(itemsPerScroll);
      if (variance < 5) {
        return 'rapid';
      }
    }

    // If items load slowly or with high variance, use adaptive
    if (avgDelay > 800 || itemsPerScroll.length === 0) {
      return 'adaptive';
    }

    // For moderate cases, check loading indicators
    if (this.loadingIndicatorsFound.length > 0) {
      return 'adaptive'; // Wait for DOM stability
    }

    // Default to rapid for most e-commerce sites
    return 'rapid';
  }

  /**
   * Calculate variance of an array
   */
  private calculateVariance(arr: number[]): number {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const squaredDiffs = arr.map((x) => Math.pow(x - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Calculate recommended delay based on observed behavior
   */
  private calculateRecommendedDelay(avgDelay: number, strategy: ScrollStrategy): number {
    switch (strategy) {
      case 'rapid':
        // For rapid, use shorter delays
        return Math.max(100, Math.min(avgDelay * 0.5, 300));
      case 'adaptive':
        // For adaptive, give more time for stability
        return Math.max(500, Math.min(avgDelay * 1.5, 2000));
      case 'fixed':
        // For fixed, use observed delay with buffer
        return Math.max(300, Math.min(avgDelay * 1.2, 1500));
      default:
        return 500;
    }
  }

  /**
   * Calculate recommended max iterations
   */
  private calculateMaxIterations(
    totalItems: number,
    scrollIterations: number,
    _scrollDistance: number
  ): number {
    if (scrollIterations === 0) {
      // No items loaded during test, use conservative estimate
      return 50;
    }

    // Estimate items per scroll
    const avgItemsPerScroll = totalItems / scrollIterations;

    // If targeting ~500 items, how many iterations needed?
    const targetItems = 500;
    const estimatedIterations = Math.ceil(targetItems / Math.max(avgItemsPerScroll, 1));

    // Add buffer and cap at reasonable maximum
    return Math.min(Math.max(estimatedIterations * 1.5, 30), 150);
  }

  /**
   * Check if test is currently active
   */
  isTestActive(): boolean {
    return this.isActive;
  }
}
