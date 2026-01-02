// ============================================================================
// LAZY LOAD HANDLER
// ============================================================================
// Handles lazy-loading content, scrolling, and waiting for dynamic content

import type { Page, CDPSession } from 'playwright';
import type { AssignedSelector } from '../../../shared/types.js';

/**
 * Scroll strategy for different site behaviors
 */
export type ScrollStrategy =
  | 'adaptive'  // Wait for DOM stability (default, good for most sites)
  | 'rapid'     // Fast incremental scrolling (for sites like Defacto that load on scroll position)
  | 'fixed';    // Fixed delay between scrolls

/**
 * Configuration for lazy load handling
 */
export interface LazyLoadConfig {
  /** Scroll strategy to use (default: 'adaptive') */
  scrollStrategy?: ScrollStrategy;
  /** Delay between scroll steps in ms (used for 'fixed' strategy) */
  scrollDelay?: number;
  /** Maximum scroll iterations (default: 100) */
  maxIterations?: number;
  /** Time to wait for DOM stability in ms (default: 500) */
  stabilityTimeout?: number;
  /** Maximum time to wait for loading indicators in ms (default: 3000) */
  loadingTimeout?: number;
  /** Custom loading indicator selectors */
  loadingIndicators?: string[];
  /** Target number of products to load (0 = unlimited) */
  targetProducts?: number;
  /** Number of times to see no change before giving up (default: 3) */
  noChangeThreshold?: number;
  /** Scroll step size in pixels for rapid mode (default: 500) */
  rapidScrollStep?: number;
  /** Delay between rapid scroll steps in ms (default: 100) */
  rapidScrollDelay?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<LazyLoadConfig> = {
  scrollStrategy: 'adaptive',
  scrollDelay: 800, // Used for 'fixed' strategy
  maxIterations: 100,
  stabilityTimeout: 500,
  loadingTimeout: 3000,
  loadingIndicators: [],
  targetProducts: 0,
  noChangeThreshold: 3,
  rapidScrollStep: 500,   // Pixels per scroll in rapid mode
  rapidScrollDelay: 100,  // Ms between scrolls in rapid mode
};

/**
 * Default loading indicator selectors
 */
const DEFAULT_LOADING_SELECTORS = [
  '.loading-spinner',
  '.load-spinner',
  '.spinner-loading',
  '.lds-ring',
  '.lds-dual-ring',
  '.sk-spinner',
  '.loading-overlay',
  '.load-overlay',
  '.infinite-loading',
  '.load-more-spinner',
  '.pagination-loader',
  '.v-progress-circular',
  '.MuiCircularProgress-root',
  '.ant-spin',
  '.spinner-border',
  '.chakra-spinner',
  '.el-loading-spinner',
  '[data-loading="true"]',
  '[aria-busy="true"]',
  '.skeleton-loader',
  '.skeleton-loading',
  '.loading-skeleton',
];

/**
 * Handles lazy loading, scrolling, and content loading
 */
export class LazyLoadHandler {
  private page: Page;
  private config: Required<LazyLoadConfig>;

  constructor(page: Page, _cdp: CDPSession, config: LazyLoadConfig = {}) {
    this.page = page;
    // Filter out undefined values so they don't override defaults
    const cleanConfig = Object.fromEntries(
      Object.entries(config).filter(([, v]) => v !== undefined)
    ) as LazyLoadConfig;
    this.config = { ...DEFAULT_CONFIG, ...cleanConfig };
  }

  /**
   * Inject IntersectionObserver override BEFORE page navigation
   * This tricks lazy loaders into thinking all elements are visible
   */
  async injectObserverOverride(): Promise<void> {
    await this.page.addInitScript(`
      (function() {
        window.IntersectionObserver = function FakeIntersectionObserver(callback, options) {
          this._callback = callback;
          this._elements = [];
        };

        window.IntersectionObserver.prototype.observe = function(target) {
          var self = this;
          this._elements.push(target);

          var entry = {
            target: target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
            time: performance.now()
          };

          setTimeout(function() {
            if (self._callback) {
              self._callback([entry], self);
            }
          }, 10);
        };

        window.IntersectionObserver.prototype.unobserve = function(target) {
          var idx = this._elements.indexOf(target);
          if (idx > -1) this._elements.splice(idx, 1);
        };

        window.IntersectionObserver.prototype.disconnect = function() {
          this._elements = [];
        };

        window.IntersectionObserver.prototype.takeRecords = function() {
          return [];
        };

        console.log('[LazyLoadHandler] IntersectionObserver intercepted');
      })();
    `);
  }

  /**
   * Inject IntersectionObserver override into an already-loaded page
   * Use this after navigating to a new page via goto()
   */
  async injectObserverOverrideIntoPage(): Promise<void> {
    await this.page.evaluate(`
      (function() {
        // Only inject if not already done
        if (window.__lazyLoadIntercepted) return;
        window.__lazyLoadIntercepted = true;

        window.IntersectionObserver = function FakeIntersectionObserver(callback, options) {
          this._callback = callback;
          this._elements = [];
        };

        window.IntersectionObserver.prototype.observe = function(target) {
          var self = this;
          this._elements.push(target);

          var entry = {
            target: target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
            time: performance.now()
          };

          setTimeout(function() {
            if (self._callback) {
              self._callback([entry], self);
            }
          }, 10);
        };

        window.IntersectionObserver.prototype.unobserve = function(target) {
          var idx = this._elements.indexOf(target);
          if (idx > -1) this._elements.splice(idx, 1);
        };

        window.IntersectionObserver.prototype.disconnect = function() {
          this._elements = [];
        };

        window.IntersectionObserver.prototype.takeRecords = function() {
          return [];
        };

        console.log('[LazyLoadHandler] IntersectionObserver injected into page');
      })();
    `);
  }

  /**
   * Disable lazy loading mechanisms on the page
   */
  async disableLazyLoading(): Promise<void> {
    await this.page.evaluate(`
      (function() {
        // Force all images to load eagerly
        document.querySelectorAll('img[loading="lazy"]').forEach(function(img) {
          img.setAttribute('loading', 'eager');
        });

        // Replace data-src with src for lazy-loaded images
        document.querySelectorAll('img[data-src]').forEach(function(img) {
          var dataSrc = img.getAttribute('data-src');
          if (dataSrc && !img.getAttribute('src')) {
            img.setAttribute('src', dataSrc);
          }
        });

        // Handle other lazy-load attributes
        var lazyAttrs = ['data-lazy-src', 'data-original', 'data-lazy', 'data-srcset'];
        lazyAttrs.forEach(function(attr) {
          document.querySelectorAll('img[' + attr + ']').forEach(function(img) {
            var value = img.getAttribute(attr);
            if (value) {
              if (attr.indexOf('srcset') !== -1) {
                img.setAttribute('srcset', value);
              } else {
                img.setAttribute('src', value);
              }
            }
          });
        });

        // Trigger scroll and resize events
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
      })();
    `);
  }

  /**
   * Force all images to have their real src populated
   */
  async forceImagesLoad(): Promise<number> {
    const result = await this.page.evaluate(`
      (function() {
        var imagesFixed = 0;
        document.querySelectorAll('img').forEach(function(img) {
          var currentSrc = img.getAttribute('src') || '';
          var isPlaceholder = !currentSrc ||
                              currentSrc.indexOf('placeholder') !== -1 ||
                              currentSrc.indexOf('loading') !== -1 ||
                              currentSrc.indexOf('blank') !== -1 ||
                              currentSrc.indexOf('data:image') === 0;

          if (isPlaceholder) {
            var realSrc = img.getAttribute('data-src') ||
                          img.getAttribute('data-lazy-src') ||
                          img.getAttribute('data-original') ||
                          img.getAttribute('data-lazy') ||
                          img.getAttribute('data-srcset');

            if (realSrc) {
              if (realSrc.indexOf(',') !== -1 || realSrc.indexOf(' ') !== -1) {
                var firstUrl = realSrc.split(',')[0].split(' ')[0].trim();
                if (firstUrl) realSrc = firstUrl;
              }
              img.setAttribute('src', realSrc);
              img.removeAttribute('loading');
              imagesFixed++;
            }
          }
        });
        return imagesFixed;
      })();
    `);

    return (result as number) || 0;
  }

  /**
   * Wait for DOM to stabilize (no mutations for specified duration)
   * This is the key improvement over fixed delays
   */
  async waitForDomStable(stabilityMs?: number): Promise<void> {
    const timeout = stabilityMs || this.config.stabilityTimeout;

    await this.page.evaluate(
      (ms) => {
        return new Promise<void>((resolve) => {
          let timeoutId: number;

          const observer = new MutationObserver(() => {
            clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => {
              observer.disconnect();
              resolve();
            }, ms);
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
          });

          // Initial timeout in case no mutations occur
          timeoutId = window.setTimeout(() => {
            observer.disconnect();
            resolve();
          }, ms);
        });
      },
      timeout
    );
  }

  /**
   * Wait for loading indicators to disappear
   */
  async waitForLoadingComplete(timeout?: number): Promise<void> {
    const maxWait = timeout || this.config.loadingTimeout;
    const startTime = Date.now();
    const checkInterval = 150;

    const loadingSelectors = [
      ...DEFAULT_LOADING_SELECTORS,
      ...(this.config.loadingIndicators || []),
    ];

    while (Date.now() - startTime < maxWait) {
      const isLoading = await this.page.evaluate(
        (selectors) => {
          for (const selector of selectors) {
            try {
              const elements = document.querySelectorAll(selector);
              for (const el of elements) {
                const style = getComputedStyle(el);
                if (
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  style.opacity !== '0'
                ) {
                  const rect = el.getBoundingClientRect();
                  if (
                    rect.width >= 10 &&
                    rect.height >= 10 &&
                    rect.top < window.innerHeight &&
                    rect.bottom > 0
                  ) {
                    return true;
                  }
                }
              }
            } catch {
              // Invalid selector, continue
            }
          }
          return false;
        },
        loadingSelectors
      );

      if (!isLoading) {
        return;
      }

      await new Promise((r) => setTimeout(r, checkInterval));
    }
  }

  /**
   * Trigger scroll events to activate lazy loaders
   */
  async triggerScrollEvents(): Promise<void> {
    await this.page.evaluate(() => {
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new Event('scroll', { bubbles: true }));
        document.dispatchEvent(new Event('scroll', { bubbles: true }));
      }

      document
        .querySelectorAll(
          '[class*="scroll"], [class*="list"], [class*="grid"], [class*="products"]'
        )
        .forEach((el) => {
          el.dispatchEvent(new Event('scroll', { bubbles: true }));
        });
    });
  }

  /**
   * Get count of elements matching selectors
   */
  async getElementCount(selectors: AssignedSelector[]): Promise<number> {
    return await this.page.evaluate((sels) => {
      let total = 0;
      sels.forEach((sel: { selector: { css: string } }) => {
        if (sel.selector.css === ':parent-link') return;
        try {
          total += document.querySelectorAll(sel.selector.css).length;
        } catch {
          // Invalid selector
        }
      });
      return total;
    }, selectors);
  }

  /**
   * Scroll to load all lazy content
   * Uses the configured scroll strategy
   */
  async scrollToLoadContent(selectors: AssignedSelector[]): Promise<number> {
    const { scrollStrategy, targetProducts } = this.config;

    console.log(`[LazyLoadHandler] Starting scroll (strategy: ${scrollStrategy})...`);
    if (targetProducts > 0) {
      console.log(`[LazyLoadHandler] Target: ${targetProducts} products`);
    }

    // Disable lazy loading first
    await this.disableLazyLoading();
    await new Promise((r) => setTimeout(r, 300));

    let totalElementCount = await this.getElementCount(selectors);
    const initialCount = totalElementCount;
    console.log(`[LazyLoadHandler] Initial element count: ${totalElementCount}`);

    // Use appropriate scroll strategy
    if (scrollStrategy === 'rapid') {
      totalElementCount = await this.rapidScrollToBottom(selectors, totalElementCount);
    } else {
      totalElementCount = await this.adaptiveScrollToBottom(selectors, totalElementCount);
    }

    const afterStrategy1 = totalElementCount;
    console.log(
      `[LazyLoadHandler] Strategy 1 complete: ${totalElementCount} elements (${totalElementCount - initialCount} new)`
    );

    // Strategy 2: Scroll up (some sites load content on scroll-up) - skip for rapid mode
    if (scrollStrategy !== 'rapid' && (targetProducts === 0 || totalElementCount < targetProducts)) {
      totalElementCount = await this.scrollUpToFindMore(selectors, totalElementCount, afterStrategy1);
    }

    // Final cleanup
    await this.waitForLoadingComplete();
    await this.forceImagesLoad();

    // Scroll back to top
    await this.page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await new Promise((r) => setTimeout(r, 200));

    console.log(
      `[LazyLoadHandler] Complete: ${totalElementCount} total (${totalElementCount - initialCount} loaded via scroll)`
    );

    return totalElementCount;
  }

  /**
   * Rapid scroll strategy - for sites like Defacto that lazy load on scroll position
   *
   * Uses Playwright's mouse.wheel() to simulate REAL mouse wheel scrolling.
   * This triggers actual wheel events that lazy loaders listen for.
   */
  private async rapidScrollToBottom(
    selectors: AssignedSelector[],
    initialCount: number
  ): Promise<number> {
    const { maxIterations, noChangeThreshold, targetProducts } = this.config;

    // Settings for mouse wheel scrolling:
    const wheelDelta = 300;        // Pixels per wheel event
    const scrollDelay = 600;       // Ms between wheel events
    const loadingWait = 1500;      // Ms to wait for loading indicators

    console.log(`[LazyLoadHandler] Rapid scroll mode using MOUSE WHEEL (delta: ${wheelDelta}px)`);
    console.log(`[LazyLoadHandler] Strategy: Wheel scroll DOWN, then wheel scroll UP`);

    let totalElementCount = initialCount;
    let passCount = 0;
    const maxPasses = 3;

    while (passCount < maxPasses) {
      passCount++;
      const beforePassCount = totalElementCount;

      // Check target
      if (targetProducts > 0 && totalElementCount >= targetProducts) {
        console.log(`[LazyLoadHandler] Reached target of ${targetProducts}`);
        break;
      }

      // =====================================================================
      // PHASE 1: Mouse wheel scroll DOWN
      // =====================================================================
      console.log(`[LazyLoadHandler] Pass ${passCount}: Mouse wheel scrolling DOWN...`);

      let prevScrollHeight = 0;
      let currentScrollHeight = await this.page.evaluate(() => document.documentElement.scrollHeight);
      let noNewContentDown = 0;
      let downIteration = 0;

      while (downIteration < maxIterations && noNewContentDown < noChangeThreshold) {
        downIteration++;

        // Check if at bottom
        const atBottom = await this.page.evaluate(() =>
          window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 10
        );

        if (atBottom) {
          // Check if page expanded
          currentScrollHeight = await this.page.evaluate(() => document.documentElement.scrollHeight);
          if (currentScrollHeight <= prevScrollHeight) {
            noNewContentDown++;
            console.log(`[LazyLoadHandler] At bottom, no expansion (${noNewContentDown}/${noChangeThreshold})`);
          } else {
            console.log(`[LazyLoadHandler] Page expanded: ${prevScrollHeight}px -> ${currentScrollHeight}px`);
            prevScrollHeight = currentScrollHeight;
            noNewContentDown = 0;
          }
        }

        // Use Playwright's mouse.wheel() - this fires REAL wheel events!
        await this.page.mouse.wheel(0, wheelDelta);

        // Wait for scroll and content to load
        await new Promise((r) => setTimeout(r, scrollDelay));
        await this.triggerScrollEvents();
        await this.waitForLoadingComplete(loadingWait);

        // Check for new elements
        const afterCount = await this.getElementCount(selectors);
        if (afterCount > totalElementCount) {
          const newItems = afterCount - totalElementCount;
          console.log(`[LazyLoadHandler] Wheel-down loaded ${newItems} new elements (total: ${afterCount})`);
          totalElementCount = afterCount;
          noNewContentDown = 0;
        }

        // Check target
        if (targetProducts > 0 && totalElementCount >= targetProducts) {
          console.log(`[LazyLoadHandler] Reached target of ${targetProducts}`);
          break;
        }
      }

      // =====================================================================
      // PHASE 2: Mouse wheel scroll UP
      // =====================================================================
      console.log(`[LazyLoadHandler] Pass ${passCount}: Mouse wheel scrolling UP...`);

      let scrollPosition = await this.page.evaluate(() => window.scrollY);
      let noNewContentUp = 0;
      let upIteration = 0;

      while (scrollPosition > 0 && upIteration < maxIterations && noNewContentUp < noChangeThreshold) {
        upIteration++;

        // Check target
        if (targetProducts > 0 && totalElementCount >= targetProducts) {
          console.log(`[LazyLoadHandler] Reached target of ${targetProducts}`);
          break;
        }

        // Use Playwright's mouse.wheel() with NEGATIVE delta to scroll UP
        await this.page.mouse.wheel(0, -wheelDelta);

        // Wait for scroll and content to load
        await new Promise((r) => setTimeout(r, scrollDelay));
        await this.triggerScrollEvents();
        await this.waitForLoadingComplete(loadingWait);

        // Update scroll position
        scrollPosition = await this.page.evaluate(() => window.scrollY);

        // Check for new elements
        const afterCount = await this.getElementCount(selectors);
        if (afterCount > totalElementCount) {
          const newItems = afterCount - totalElementCount;
          console.log(`[LazyLoadHandler] Wheel-up loaded ${newItems} new elements (total: ${afterCount})`);
          totalElementCount = afterCount;
          noNewContentUp = 0;

          // When we find new content on scroll-up, go back to bottom and continue
          console.log(`[LazyLoadHandler] New content found, jumping to bottom...`);
          await this.page.evaluate(() => {
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
          });
          await new Promise((r) => setTimeout(r, 500));
          break; // Start scroll-up again from new bottom position
        } else {
          noNewContentUp++;
        }
      }

      // Check if this pass found new elements
      const afterPassCount = await this.getElementCount(selectors);
      if (afterPassCount > totalElementCount) {
        totalElementCount = afterPassCount;
      }

      const passNewItems = totalElementCount - beforePassCount;
      console.log(`[LazyLoadHandler] Pass ${passCount} complete: ${passNewItems} new elements`);

      // If no new elements in this pass, we're done
      if (passNewItems === 0) {
        console.log(`[LazyLoadHandler] No new elements in pass ${passCount}, stopping`);
        break;
      }
    }

    // Final element count
    const finalCount = await this.getElementCount(selectors);
    if (finalCount > totalElementCount) {
      totalElementCount = finalCount;
    }

    console.log(`[LazyLoadHandler] Rapid scroll complete: ${totalElementCount} total elements`);
    return totalElementCount;
  }

  /**
   * Adaptive scroll strategy - scrolls SLOWLY down to trigger lazy loading
   * Many sites require seeing the scroll happen progressively to load content
   */
  private async adaptiveScrollToBottom(
    selectors: AssignedSelector[],
    initialCount: number
  ): Promise<number> {
    const { maxIterations, noChangeThreshold, targetProducts, scrollDelay, stabilityTimeout, scrollStrategy } =
      this.config;

    // Scroll step size - scroll slowly like a human would
    const scrollStep = 400; // Pixels per scroll step
    const stepDelay = scrollStrategy === 'fixed' ? scrollDelay : 600; // Ms between steps

    let totalElementCount = initialCount;
    let iteration = 0;
    let noChangeCount = 0;
    let currentScrollY = 0;

    console.log(`[LazyLoadHandler] Adaptive scroll: scrolling slowly DOWN (${scrollStep}px steps, ${stepDelay}ms delay)`);

    while (iteration < maxIterations && noChangeCount < noChangeThreshold) {
      // Check target
      if (targetProducts > 0 && totalElementCount >= targetProducts) {
        console.log(`[LazyLoadHandler] Reached target of ${targetProducts}`);
        break;
      }

      iteration++;
      const beforeCount = totalElementCount;
      const beforeHeight = await this.page.evaluate(
        () => document.documentElement.scrollHeight
      );

      // Get current scroll position and document height
      const scrollInfo = await this.page.evaluate(() => ({
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));

      // Check if we're at the bottom
      const atBottom = scrollInfo.scrollY + scrollInfo.innerHeight >= scrollInfo.scrollHeight - 50;

      if (atBottom) {
        // We're at the bottom - check if document expanded
        const afterHeight = await this.page.evaluate(
          () => document.documentElement.scrollHeight
        );

        if (afterHeight <= beforeHeight) {
          // Document didn't expand, no more content to load
          noChangeCount++;
          console.log(
            `[LazyLoadHandler] At bottom, no expansion (${noChangeCount}/${noChangeThreshold})`
          );

          if (noChangeCount >= noChangeThreshold) {
            break;
          }

          // Wait a bit and try again (some sites load on delay)
          await new Promise((r) => setTimeout(r, stepDelay));
          continue;
        } else {
          // Document expanded, keep scrolling
          console.log(`[LazyLoadHandler] Page expanded: ${beforeHeight}px -> ${afterHeight}px`);
          noChangeCount = 0;
        }
      }

      // Scroll down slowly
      currentScrollY = scrollInfo.scrollY + scrollStep;
      await this.page.evaluate((y) => {
        window.scrollTo({ top: y, behavior: 'smooth' });
      }, currentScrollY);

      // Wait for scroll and content to load
      await new Promise((r) => setTimeout(r, stepDelay));

      // Wait for DOM stability if using adaptive strategy
      if (scrollStrategy !== 'fixed') {
        await this.waitForDomStable(stabilityTimeout);
      }

      await this.triggerScrollEvents();
      await this.waitForLoadingComplete();

      // Check for new elements
      const afterCount = await this.getElementCount(selectors);
      const afterHeight = await this.page.evaluate(
        () => document.documentElement.scrollHeight
      );

      if (afterCount > beforeCount) {
        console.log(
          `[LazyLoadHandler] Scroll-down loaded ${afterCount - beforeCount} new elements (total: ${afterCount})`
        );
        totalElementCount = afterCount;
        noChangeCount = 0;
      } else if (afterHeight > beforeHeight) {
        // Page expanded but element count same - virtual scroll or loading
        console.log(`[LazyLoadHandler] Page expanded: ${beforeHeight}px -> ${afterHeight}px`);
        noChangeCount = 0;
      }
      // Note: Don't increment noChangeCount here - only at bottom

      // Log progress every 10 iterations
      if (iteration % 10 === 0) {
        console.log(`[LazyLoadHandler] Scroll progress: iteration ${iteration}, Y=${currentScrollY}, ${totalElementCount} elements`);
      }
    }

    console.log(`[LazyLoadHandler] Adaptive scroll-down complete: ${totalElementCount} elements after ${iteration} iterations`);
    return totalElementCount;
  }

  /**
   * Scroll up strategy to find content that only loads on scroll-up
   */
  private async scrollUpToFindMore(
    selectors: AssignedSelector[],
    currentCount: number,
    afterStrategy1: number
  ): Promise<number> {
    const { maxIterations, noChangeThreshold, targetProducts, scrollDelay, stabilityTimeout, scrollStrategy } =
      this.config;

    console.log('[LazyLoadHandler] Strategy 2: Scroll up to find more...');

    let totalElementCount = currentCount;
    const earlyBailIterations = 5;
    let scrollUpIteration = 0;
    let scrollUpNoChange = 0;
    let foundContentOnScrollUp = false;
    let iterationsWithoutNew = 0;

    while (scrollUpIteration < maxIterations && scrollUpNoChange < noChangeThreshold) {
      if (targetProducts > 0 && totalElementCount >= targetProducts) {
        break;
      }

      scrollUpIteration++;
      const beforeCount = totalElementCount;

      // Early bail if scroll-up isn't finding anything
      if (iterationsWithoutNew >= earlyBailIterations && !foundContentOnScrollUp) {
        console.log('[LazyLoadHandler] Scroll-up found nothing, stopping');
        break;
      }

      const scrollTop = await this.page.evaluate(() => window.scrollY);
      if (scrollTop <= 50) {
        if (foundContentOnScrollUp) {
          // Go back to bottom
          await this.page.evaluate(() => {
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior: 'instant',
            });
          });
          await new Promise((r) => setTimeout(r, 300));
          foundContentOnScrollUp = false;
          iterationsWithoutNew = 0;
        } else {
          scrollUpNoChange++;
          await this.page.evaluate(() => {
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior: 'instant',
            });
          });
          await new Promise((r) => setTimeout(r, 300));
        }
        continue;
      }

      // Scroll up
      await this.page.evaluate(() => {
        window.scrollTo({
          top: Math.max(0, window.scrollY - 300),
          behavior: 'smooth',
        });
      });

      if (scrollStrategy === 'fixed') {
        await new Promise((r) => setTimeout(r, scrollDelay + 200));
      } else {
        await this.waitForDomStable(stabilityTimeout + 200);
      }

      await this.triggerScrollEvents();
      await this.waitForLoadingComplete();

      const afterCount = await this.getElementCount(selectors);
      if (afterCount > beforeCount) {
        console.log(
          `[LazyLoadHandler] Scroll-up loaded ${afterCount - beforeCount} new elements`
        );
        totalElementCount = afterCount;
        scrollUpNoChange = 0;
        foundContentOnScrollUp = true;
        iterationsWithoutNew = 0;

        // Go back to bottom to trigger more loading
        await this.page.evaluate(() => {
          window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: 'instant',
          });
        });
        await new Promise((r) => setTimeout(r, 300));
      } else {
        iterationsWithoutNew++;
      }
    }

    console.log(
      `[LazyLoadHandler] Strategy 2 complete: ${totalElementCount - afterStrategy1} new from scroll-up`
    );

    return totalElementCount;
  }
}
