// ============================================================================
// SCRAPING ENGINE - Rapid Execution for JS-Heavy Sites
// ============================================================================
// NO fallbacks, NO retries, NO auto-waits - FAIL FAST

import type { Page, CDPSession } from 'playwright';
import type {
  ScraperConfig,
  AssignedSelector,
  ScrapeResult,
  ScrapedItem,
  RecorderAction,
} from '../../shared/types.js';

export class ScrapingEngine {
  private page: Page;
  private cdp: CDPSession;

  constructor(page: Page, cdp: CDPSession) {
    this.page = page;
    this.cdp = cdp;
  }

  // =========================================================================
  // MAIN SCRAPE EXECUTION
  // =========================================================================

  async execute(config: ScraperConfig): Promise<ScrapeResult> {
    const startTime = Date.now();
    const allItems: ScrapedItem[] = [];
    let pagesScraped = 0;

    console.log(`[ScrapingEngine] Starting scrape: ${config.name}`);
    console.log(`[ScrapingEngine] URL: ${config.startUrl}`);
    console.log(`[ScrapingEngine] Selectors: ${config.selectors.length}`);

    try {
      // Inject IntersectionObserver override BEFORE navigation to catch all lazy loaders
      await this.injectLazyLoadBlocker();

      // Navigate to start URL
      await this.page.goto(config.startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Execute pre-actions (popups, cookies, etc.) if defined
      if (config.preActions && config.preActions.actions.length > 0) {
        console.log(`[ScrapingEngine] Executing ${config.preActions.actions.length} pre-actions`);
        await this.executePreActions(config.preActions.actions);
      }

      // Auto-scroll to load lazy content if enabled
      if (config.autoScroll !== false) {
        console.log('[ScrapingEngine] Auto-scrolling to load lazy content...');
        await this.autoScrollToLoadContent(config.selectors);
      }

      // Scrape pages
      const maxPages = config.pagination?.enabled ? config.pagination.maxPages : 1;

      for (let pageNum = 0; pageNum < maxPages; pageNum++) {
        console.log(`[ScrapingEngine] Scraping page ${pageNum + 1}/${maxPages}`);

        // Extract data from current page
        const pageItems = await this.extractPageData(config);
        allItems.push(...pageItems);
        pagesScraped++;

        console.log(`[ScrapingEngine] Extracted ${pageItems.length} items from page ${pageNum + 1}`);

        // Check for pagination
        if (config.pagination?.enabled && pageNum < maxPages - 1) {
          const hasNextPage = await this.goToNextPage(config.pagination.selector);
          if (!hasNextPage) {
            console.log('[ScrapingEngine] No more pages');
            break;
          }

          // Wait after click if configured
          if (config.pagination.waitAfterClick) {
            await new Promise((r) => setTimeout(r, config.pagination!.waitAfterClick));
          }
        }
      }

      return {
        success: true,
        items: allItems,
        pagesScraped,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ScrapingEngine] FATAL: ${errorMessage}`);

      return {
        success: false,
        items: allItems,
        pagesScraped,
        duration: Date.now() - startTime,
        errors: [errorMessage],
      };
    }
  }

  // =========================================================================
  // DATA EXTRACTION
  // =========================================================================

  private async extractPageData(config: ScraperConfig): Promise<ScrapedItem[]> {
    // If item container is defined, extract from repeated elements
    if (config.itemContainer) {
      return this.extractFromContainers(config.itemContainer, config.selectors);
    }

    // Check if any selector matches multiple elements - if so, extract all
    // This is the case when user selects a pattern that matches multiple items
    return this.extractMultipleItems(config.selectors);
  }

  private async extractFromContainers(
    containerSelector: string,
    selectors: AssignedSelector[]
  ): Promise<ScrapedItem[]> {
    // Use CDP Runtime.evaluate for maximum speed
    const result = await this.cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const containers = document.querySelectorAll(${JSON.stringify(containerSelector)});
          if (containers.length === 0) {
            throw new Error('No containers found for selector: ${containerSelector}');
          }

          const selectors = ${JSON.stringify(selectors)};
          const items = [];

          containers.forEach((container, idx) => {
            const item = {};

            selectors.forEach(sel => {
              const el = container.querySelector(sel.selector.css);
              if (!el) {
                item[sel.role] = null;
                return;
              }

              let value = null;
              switch (sel.extractionType) {
                case 'text':
                  value = el.textContent?.trim() || null;
                  break;
                case 'href':
                  value = el.getAttribute('href') || null;
                  // Make relative URLs absolute
                  if (value && !value.startsWith('http')) {
                    value = new URL(value, window.location.origin).href;
                  }
                  break;
                case 'src':
                  value = el.getAttribute('src') || null;
                  if (value && !value.startsWith('http')) {
                    value = new URL(value, window.location.origin).href;
                  }
                  break;
                case 'attribute':
                  value = sel.attributeName ? el.getAttribute(sel.attributeName) : null;
                  break;
                case 'innerHTML':
                  value = el.innerHTML;
                  break;
              }

              item[sel.customName || sel.role] = value;
            });

            items.push(item);
          });

          return items;
        })()
      `,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Extraction failed');
    }

    return result.result.value as ScrapedItem[];
  }

  private async extractMultipleItems(selectors: AssignedSelector[]): Promise<ScrapedItem[]> {
    // Find the selector that matches the most elements (likely the main content)
    // and use that count to determine how many items we're scraping
    const result = await this.cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const selectors = ${JSON.stringify(selectors)};

          // Find max count among all selectors
          let maxCount = 0;
          selectors.forEach(sel => {
            const count = document.querySelectorAll(sel.selector.css).length;
            if (count > maxCount) maxCount = count;
          });

          // If only one element, return single item
          if (maxCount <= 1) {
            const item = {};
            selectors.forEach(sel => {
              const el = document.querySelector(sel.selector.css);
              if (!el) {
                item[sel.customName || sel.role] = null;
                return;
              }

              let value = null;
              switch (sel.extractionType) {
                case 'text':
                  value = el.textContent?.trim() || null;
                  break;
                case 'href':
                  value = el.getAttribute('href');
                  if (value && !value.startsWith('http')) {
                    value = new URL(value, window.location.origin).href;
                  }
                  break;
                case 'src':
                  value = el.getAttribute('src');
                  if (value && !value.startsWith('http')) {
                    value = new URL(value, window.location.origin).href;
                  }
                  break;
                case 'attribute':
                  value = sel.attributeName ? el.getAttribute(sel.attributeName) : null;
                  break;
                case 'innerHTML':
                  value = el.innerHTML;
                  break;
                default:
                  value = el.textContent?.trim() || null;
              }
              item[sel.customName || sel.role] = value;
            });
            return [item];
          }

          // Multiple elements - extract all
          const items = [];
          for (let i = 0; i < maxCount; i++) {
            const item = {};

            selectors.forEach(sel => {
              const elements = document.querySelectorAll(sel.selector.css);
              const el = elements[i]; // Get the i-th element

              if (!el) {
                item[sel.customName || sel.role] = null;
                return;
              }

              let value = null;
              switch (sel.extractionType) {
                case 'text':
                  value = el.textContent?.trim() || null;
                  break;
                case 'href':
                  value = el.getAttribute('href');
                  if (value && !value.startsWith('http')) {
                    value = new URL(value, window.location.origin).href;
                  }
                  break;
                case 'src':
                  value = el.getAttribute('src');
                  if (value && !value.startsWith('http')) {
                    value = new URL(value, window.location.origin).href;
                  }
                  break;
                case 'attribute':
                  value = sel.attributeName ? el.getAttribute(sel.attributeName) : null;
                  break;
                case 'innerHTML':
                  value = el.innerHTML;
                  break;
                default:
                  value = el.textContent?.trim() || null;
              }
              item[sel.customName || sel.role] = value;
            });

            items.push(item);
          }

          return items;
        })()
      `,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Extraction failed');
    }

    return result.result.value as ScrapedItem[];
  }

  // =========================================================================
  // PAGINATION
  // =========================================================================

  private async goToNextPage(selector: string): Promise<boolean> {
    // Check if next page button exists and is clickable
    const exists = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;

      // Check if disabled
      if (el.hasAttribute('disabled')) return false;
      if (el.classList.contains('disabled')) return false;
      if (el.getAttribute('aria-disabled') === 'true') return false;

      // Check if visible
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;

      return true;
    }, selector);

    if (!exists) {
      return false;
    }

    // Click and wait for navigation
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
      this.page.click(selector),
    ]);

    // Brief wait for any JS to execute
    await new Promise((r) => setTimeout(r, 500));

    return true;
  }

  // =========================================================================
  // AUTO-SCROLL FOR LAZY LOADING
  // =========================================================================

  // Inject script BEFORE page load to intercept IntersectionObserver
  private async injectLazyLoadBlocker(): Promise<void> {
    // Use a string-based script to avoid TypeScript compilation issues
    await this.page.addInitScript(`
      (function() {
        // Create a fake IntersectionObserver that immediately reports everything as visible
        window.IntersectionObserver = function FakeIntersectionObserver(callback, options) {
          this._callback = callback;
          this._elements = [];
        };

        window.IntersectionObserver.prototype.observe = function(target) {
          var self = this;
          this._elements.push(target);

          // Immediately trigger callback saying element is visible
          var entry = {
            target: target,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
            time: performance.now()
          };

          // Call callback async to mimic real behavior
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

        console.log('[ScrapingEngine] IntersectionObserver intercepted for lazy load bypass');
      })();
    `);

    console.log('[ScrapingEngine] Lazy load blocker injected');
  }

  // Disable lazy loading mechanisms to force all content to load
  private async disableLazyLoading(): Promise<void> {
    await this.page.evaluate(`
      (function() {
        // 1. Force all images to load eagerly
        document.querySelectorAll('img[loading="lazy"]').forEach(function(img) {
          img.setAttribute('loading', 'eager');
        });

        // 2. Replace data-src with src for lazy-loaded images
        document.querySelectorAll('img[data-src]').forEach(function(img) {
          var dataSrc = img.getAttribute('data-src');
          if (dataSrc && !img.getAttribute('src')) {
            img.setAttribute('src', dataSrc);
          }
        });

        // 3. Also check for data-lazy-src, data-original, etc.
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

        // 4. Trigger scroll event to activate scroll-based lazy loaders
        window.dispatchEvent(new Event('scroll'));

        // 5. Trigger resize to catch viewport-based loaders
        window.dispatchEvent(new Event('resize'));

        console.log('[ScrapingEngine] Disabled lazy loading mechanisms');
      })();
    `);
  }

  // Force trigger lazy loading by simulating scroll events
  private async triggerLazyLoadEvents(): Promise<void> {
    await this.page.evaluate(() => {
      // Dispatch multiple scroll events
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new Event('scroll', { bubbles: true }));
        document.dispatchEvent(new Event('scroll', { bubbles: true }));
      }

      // Also trigger on common scrollable containers
      document.querySelectorAll('[class*="scroll"], [class*="list"], [class*="grid"], [class*="products"]').forEach(el => {
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
    });
  }

  private async autoScrollToLoadContent(selectors: AssignedSelector[]): Promise<void> {
    const baseScrollDelay = 400; // Ms between scrolls - give time for lazy load to trigger
    const maxScrollAttempts = 100; // Max scroll iterations
    const stableCountThreshold = 4; // Stop after N scrolls with no new elements
    const loadingWaitTimeout = 3000; // Max ms to wait for loading indicator to disappear

    let lastElementCount = 0;
    let stableCount = 0;
    let previousScrollTop = -1;

    console.log('[ScrapingEngine] Auto-scroll: starting lazy load detection...');

    // First, try to disable lazy loading mechanisms
    await this.disableLazyLoading();
    await new Promise((r) => setTimeout(r, 500)); // Wait for any triggered loads

    for (let i = 0; i < maxScrollAttempts; i++) {
      // Get current element count and scroll position info
      const { count, lastElementBottom, viewportHeight, pageHeight, currentScroll } = await this.page.evaluate((sels) => {
        let total = 0;
        let lastBottom = 0;

        sels.forEach((sel: { selector: { css: string } }) => {
          const elements = document.querySelectorAll(sel.selector.css);
          total += elements.length;

          // Find the bottommost element
          elements.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const absoluteBottom = rect.bottom + window.scrollY;
            if (absoluteBottom > lastBottom) {
              lastBottom = absoluteBottom;
            }
          });
        });

        return {
          count: total,
          lastElementBottom: lastBottom,
          viewportHeight: window.innerHeight,
          pageHeight: document.documentElement.scrollHeight,
          currentScroll: window.scrollY
        };
      }, selectors);

      // Check if we've loaded new content
      if (count > lastElementCount) {
        lastElementCount = count;
        stableCount = 0;
        console.log(`[ScrapingEngine] Auto-scroll: found ${count} elements`);
      } else {
        stableCount++;
        if (stableCount >= stableCountThreshold) {
          console.log(`[ScrapingEngine] Auto-scroll complete: no new content after ${stableCountThreshold} scrolls`);
          break;
        }
      }

      // Check if we've reached true bottom (scroll position didn't change)
      const atBottom = currentScroll + viewportHeight >= pageHeight - 10;
      const scrollStuck = Math.abs(currentScroll - previousScrollTop) < 5 && previousScrollTop >= 0;

      if ((atBottom || scrollStuck) && stableCount > 0) {
        console.log('[ScrapingEngine] Auto-scroll: reached bottom of page');
        break;
      }

      previousScrollTop = currentScroll;

      // Scroll strategy: scroll DOWN past the last element by a significant amount
      // This ensures lazy load triggers (often placed BEFORE the end of content) get activated
      // Scroll to position that puts the last element near the TOP of viewport (1/4 down)
      const targetScroll = Math.max(0, lastElementBottom - (viewportHeight / 4));

      // Also try scrolling a bit further if we're not making progress
      const scrollAmount = stableCount > 1 ? targetScroll + viewportHeight : targetScroll;

      await this.page.evaluate((target) => {
        window.scrollTo({ top: target, behavior: 'instant' });
      }, scrollAmount);

      // Trigger lazy load events after scrolling
      await this.triggerLazyLoadEvents();

      // Wait for scroll to complete and content to potentially load
      await new Promise((r) => setTimeout(r, baseScrollDelay));

      // Check for loading indicators and wait if found
      await this.waitForLoadingToComplete(loadingWaitTimeout);
    }

    // Final wait for any remaining loading
    await this.waitForLoadingToComplete(loadingWaitTimeout);

    // Scroll back to top before extraction
    await this.page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 200));

    console.log(`[ScrapingEngine] Auto-scroll finished: ${lastElementCount} total elements found`);
  }

  // Wait for loading indicators to disappear
  private async waitForLoadingToComplete(timeout: number): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 150; // Check every 150ms

    while (Date.now() - startTime < timeout) {
      const isLoading = await this.page.evaluate(() => {
        // More specific loading indicator selectors - avoid wildcards that cause false positives
        const loadingSelectors = [
          // Spinners and loaders - exact class matches
          '.loading-spinner', '.load-spinner', '.spinner-loading',
          '.lds-ring', '.lds-dual-ring', '.sk-spinner',
          // Loading overlays with specific naming
          '.loading-overlay', '.load-overlay', '.infinite-loading',
          '.load-more-spinner', '.pagination-loader',
          // Framework-specific spinners (these are actual spinner components)
          '.v-progress-circular', '.MuiCircularProgress-root', '.ant-spin',
          '.spinner-border', '.chakra-spinner', '.el-loading-spinner',
          // Loading states via attributes
          '[data-loading="true"]', '[aria-busy="true"]',
          // Skeleton screens with specific classes
          '.skeleton-loader', '.skeleton-loading', '.loading-skeleton'
        ];

        for (const selector of loadingSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const style = getComputedStyle(el);
              // Check if visible and has actual size
              if (style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  style.opacity !== '0') {
                const rect = el.getBoundingClientRect();
                // Must have meaningful size (at least 10x10) and be in viewport
                if (rect.width >= 10 && rect.height >= 10 &&
                    rect.top < window.innerHeight && rect.bottom > 0) {
                  return true; // Loading indicator found
                }
              }
            }
          } catch {
            // Invalid selector, continue
          }
        }

        return false; // No loading indicator found
      });

      if (!isLoading) {
        return; // Loading complete
      }

      // Wait before checking again
      await new Promise((r) => setTimeout(r, checkInterval));
    }

    // Don't log timeout - it's expected when no loading indicator exists
  }

  // =========================================================================
  // PRE-ACTIONS EXECUTION
  // =========================================================================

  private async executePreActions(actions: RecorderAction[]): Promise<void> {
    for (const action of actions) {
      console.log(`[ScrapingEngine] Pre-action: ${action.type} on ${action.selector}`);

      // Check if element exists first
      const exists = await this.page
        .waitForSelector(action.selector, { timeout: 3000, state: 'visible' })
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        console.log(`[ScrapingEngine] Pre-action element not found, skipping: ${action.selector}`);
        continue; // Skip if not found (popup might not appear)
      }

      switch (action.type) {
        case 'click':
          await this.page.click(action.selector, { timeout: 3000 });
          break;
        case 'type':
          if (action.value) {
            await this.page.fill(action.selector, action.value, { timeout: 3000 });
          }
          break;
        case 'select':
          if (action.value) {
            await this.page.selectOption(action.selector, action.value, { timeout: 3000 });
          }
          break;
      }

      // Small delay between pre-actions
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // =========================================================================
  // VALIDATION
  // =========================================================================

  async validateConfig(config: ScraperConfig): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Navigate to URL first
    try {
      await this.page.goto(config.startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (error) {
      return {
        valid: false,
        errors: [`Cannot load URL: ${config.startUrl}`],
        warnings: [],
      };
    }

    // Validate each selector
    for (const selector of config.selectors) {
      const count = await this.page.evaluate(
        (css) => document.querySelectorAll(css).length,
        selector.selector.css
      );

      if (count === 0) {
        errors.push(`Selector "${selector.role}" (${selector.selector.css}) matches 0 elements`);
      } else if (count > 100) {
        warnings.push(
          `Selector "${selector.role}" matches ${count} elements - consider using item container`
        );
      }
    }

    // Validate item container if set
    if (config.itemContainer) {
      const containerCount = await this.page.evaluate(
        (css) => document.querySelectorAll(css).length,
        config.itemContainer
      );

      if (containerCount === 0) {
        errors.push(`Item container selector matches 0 elements: ${config.itemContainer}`);
      } else {
        console.log(`[ScrapingEngine] Found ${containerCount} item containers`);
      }
    }

    // Validate pagination selector if enabled
    if (config.pagination?.enabled) {
      const paginationExists = await this.page.evaluate(
        (css) => !!document.querySelector(css),
        config.pagination.selector
      );

      if (!paginationExists) {
        warnings.push(`Pagination selector not found: ${config.pagination.selector}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // =========================================================================
  // BULK EXTRACTION (for speed)
  // =========================================================================

  async bulkExtract(selectors: { name: string; css: string; extractionType: string }[]): Promise<
    Record<string, string | null>
  > {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const selectors = ${JSON.stringify(selectors)};
          const result = {};

          selectors.forEach(({ name, css, extractionType }) => {
            const el = document.querySelector(css);
            if (!el) {
              result[name] = null;
              return;
            }

            switch (extractionType) {
              case 'text':
                result[name] = el.textContent?.trim() || null;
                break;
              case 'href':
                result[name] = el.getAttribute('href');
                break;
              case 'src':
                result[name] = el.getAttribute('src');
                break;
              default:
                result[name] = el.textContent?.trim() || null;
            }
          });

          return result;
        })()
      `,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error('Bulk extraction failed');
    }

    return result.result.value as Record<string, string | null>;
  }
}
