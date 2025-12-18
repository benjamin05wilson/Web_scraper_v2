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
          // Helper: Parse a price string to a number
          function parsePrice(priceStr) {
            if (!priceStr) return NaN;
            // Remove currency symbols and whitespace, handle comma as decimal separator
            var cleaned = priceStr.replace(/[£$€¥₹MAD\\s]/gi, '').replace(/,/g, '.');
            // If there are multiple dots, keep only the last one as decimal
            var parts = cleaned.split('.');
            if (parts.length > 2) {
              cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
            }
            return parseFloat(cleaned);
          }

          // Helper: Extract all prices from an element
          function extractAllPrices(el) {
            var text = el.textContent || '';
            // Match price patterns: £25.45, $99.99, €19,99, 25.45 MAD, etc.
            var priceRegex = /[£$€¥₹]?\\s*\\d{1,3}(?:[,.]\\d{3})*(?:[,.]\\d{1,2})?(?:\\s*MAD)?|\\d{1,3}(?:[,.]\\d{3})*(?:[,.]\\d{1,2})?\\s*[£$€¥₹MAD]*/gi;
            var matches = text.match(priceRegex);

            if (!matches || matches.length === 0) {
              return [];
            }

            // Parse all prices
            var prices = matches
              .map(function(m) {
                var value = parsePrice(m);
                return { original: m.trim(), value: value };
              })
              .filter(function(p) { return !isNaN(p.value) && p.value > 0; });

            return prices;
          }

          // Helper: Extract just one price (lowest) - legacy behavior
          function extractPrice(el) {
            var prices = extractAllPrices(el);
            if (prices.length === 0) {
              return (el.textContent || '').trim();
            }
            // Sort and return lowest
            prices.sort(function(a, b) { return a.value - b.value; });
            return prices[0].original;
          }

          var containers = document.querySelectorAll(${JSON.stringify(containerSelector)});
          if (containers.length === 0) {
            throw new Error('No containers found for selector: ${containerSelector}');
          }

          var selectors = ${JSON.stringify(selectors)};
          var items = [];

          // Check if we have separate price roles
          var hasOriginalPrice = selectors.some(function(s) { return s.role === 'originalPrice'; });
          var hasSalePrice = selectors.some(function(s) { return s.role === 'salePrice'; });
          var hasBothPriceTypes = hasOriginalPrice && hasSalePrice;

          // Group selectors by role and sort by priority for fallback support
          var selectorsByRole = {};
          selectors.forEach(function(sel) {
            var role = sel.role;
            if (!selectorsByRole[role]) {
              selectorsByRole[role] = [];
            }
            selectorsByRole[role].push(sel);
          });
          // Sort each group by priority (lower = first)
          Object.keys(selectorsByRole).forEach(function(role) {
            selectorsByRole[role].sort(function(a, b) {
              return (a.priority || 0) - (b.priority || 0);
            });
          });

          // Helper to extract value from element based on extraction type
          function extractValue(el, sel) {
            if (!el) return null;
            var value = null;
            switch (sel.extractionType) {
              case 'text':
                if (sel.role === 'price') {
                  value = extractPrice(el);
                } else if (sel.role === 'originalPrice' || sel.role === 'salePrice') {
                  value = (el.textContent || '').trim();
                } else {
                  value = (el.textContent || '').trim() || null;
                }
                break;
              case 'href':
                value = el.getAttribute('href') || null;
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
            return value;
          }

          containers.forEach(function(container, idx) {
            var item = {};

            // For each role, try selectors in priority order until we get a value
            Object.keys(selectorsByRole).forEach(function(role) {
              var roleSelectors = selectorsByRole[role];
              var value = null;

              // Try each selector in priority order
              for (var i = 0; i < roleSelectors.length && !value; i++) {
                var sel = roleSelectors[i];
                var cssSelector = sel.selector.css;
                var el = container.querySelector(cssSelector);

                if (idx === 0) {
                  // Debug first container
                  console.log('[ScrapingEngine] Container #' + idx + ' - Role: ' + role + ', Selector: "' + cssSelector + '", Found: ' + (el ? 'YES' : 'NO'));
                }

                if (el) {
                  value = extractValue(el, sel);
                  if (idx === 0) {
                    console.log('[ScrapingEngine] Container #' + idx + ' - Role: ' + role + ', Value: "' + (value || 'null').substring(0, 50) + '"');
                  }
                }
              }

              item[roleSelectors[0].customName || role] = value;
            });

            // Auto-detect sale price: if both prices exist, ensure salePrice <= originalPrice
            if (hasBothPriceTypes && item.originalPrice && item.salePrice) {
              var origVal = parsePrice(item.originalPrice);
              var saleVal = parsePrice(item.salePrice);

              // If original is actually lower than sale, swap them
              if (!isNaN(origVal) && !isNaN(saleVal) && origVal < saleVal) {
                var temp = item.originalPrice;
                item.originalPrice = item.salePrice;
                item.salePrice = temp;
              }
            }

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
    // Find a common container for related elements - this is the ONLY reliable way
    // to ensure title/price/etc from the same product are matched together
    const result = await this.cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          var selectors = ${JSON.stringify(selectors)};

          // Helper: Parse a price string to a number
          function parsePrice(priceStr) {
            if (!priceStr) return NaN;
            // Remove currency symbols and whitespace, handle comma as decimal separator
            var cleaned = priceStr.replace(/[£$€¥₹MAD\\s]/gi, '').replace(/,/g, '.');
            // If there are multiple dots, keep only the last one as decimal
            var parts = cleaned.split('.');
            if (parts.length > 2) {
              cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
            }
            return parseFloat(cleaned);
          }

          // Helper: Extract the lowest/first price from an element containing multiple prices
          function extractPrice(el) {
            var text = el.textContent || '';
            // Match price patterns: £25.45, $99.99, €19,99, 25.45, etc.
            var priceRegex = /[£$€¥₹]?\\s*\\d{1,3}(?:[,.]\\d{3})*(?:[,.]\\d{1,2})?(?:\\s*MAD)?|\\d{1,3}(?:[,.]\\d{3})*(?:[,.]\\d{1,2})?\\s*[£$€¥₹MAD]*/gi;
            var matches = text.match(priceRegex);

            if (!matches || matches.length === 0) {
              return text.trim(); // Fallback to full text if no price found
            }

            // Parse all prices and find the lowest
            var prices = matches
              .map(function(m) {
                // Extract just the number, handling different formats
                var cleaned = m.replace(/[£$€¥₹MAD\\s]/gi, '').replace(/,/g, '.');
                return { original: m.trim(), value: parseFloat(cleaned) };
              })
              .filter(function(p) { return !isNaN(p.value) && p.value > 0; });

            if (prices.length === 0) {
              return matches[0].trim(); // Return first match if parsing fails
            }

            // Sort by value and return the lowest price (usually the sale/current price)
            prices.sort(function(a, b) { return a.value - b.value; });
            return prices[0].original;
          }

          // Check if we have separate price roles
          var hasOriginalPrice = selectors.some(function(s) { return s.role === 'originalPrice'; });
          var hasSalePrice = selectors.some(function(s) { return s.role === 'salePrice'; });
          var hasBothPriceTypes = hasOriginalPrice && hasSalePrice;

          // Helper: Find the closest common ancestor of multiple elements
          function findCommonAncestor(elements) {
            if (elements.length === 0) return null;
            if (elements.length === 1) return elements[0].parentElement;

            // Get all ancestors of first element
            const ancestors = [];
            let el = elements[0];
            while (el.parentElement) {
              ancestors.push(el.parentElement);
              el = el.parentElement;
            }

            // Find first common ancestor
            for (const ancestor of ancestors) {
              if (elements.every(e => ancestor.contains(e))) {
                return ancestor;
              }
            }
            return document.body;
          }

          // Helper: Find the item container pattern
          function findItemContainers(selectors) {
            // Debug: Log what selectors we're looking for
            console.log('[ScrapingEngine] Looking for selectors:', selectors.map(s => s.selector.css));

            // Helper: Check if an element is a valid container (not header/nav/button/etc)
            function isValidContainer(el) {
              const tagName = el.tagName.toLowerCase();
              // Skip these elements - they're never product containers
              const invalidTags = ['button', 'nav', 'header', 'footer', 'aside', 'form', 'input', 'select', 'a', 'img', 'svg', 'path', 'span', 'label', 'ul', 'option'];
              if (invalidTags.includes(tagName)) return false;

              // Skip if it's inside header/nav/dropdown
              if (el.closest('header, nav, footer, aside, [class*="dropdown"], [class*="menu"], [role="menu"], [role="listbox"]')) return false;

              // Check class names for header/nav/dropdown patterns
              const className = el.className || '';
              if (typeof className === 'string') {
                const lowerClass = className.toLowerCase();
                if (lowerClass.match(/header|nav|menu|footer|sidebar|modal|popup|banner|cookie|dropdown|select|toggle|language|country|region|locale|currency/)) {
                  return false;
                }
              }

              // Skip li elements unless they have product-related classes
              if (tagName === 'li') {
                if (typeof className === 'string' && className.toLowerCase().match(/product|item|card|tile|entry|listing|result|data|goods/)) {
                  return true; // Allow product list items
                }
                return false; // Reject other li elements
              }

              return true;
            }

            // Helper: Check if element has product-related class
            function hasProductClass(el) {
              const className = el.className || '';
              if (typeof className === 'string') {
                return className.toLowerCase().match(/product|item|card|tile|entry|listing|result|data-pushed|goods|sku|offer/);
              }
              return false;
            }

            // Get ALL elements matching each selector
            const allElementsPerSelector = selectors.map(sel => {
              const selector = sel.selector.css;
              const elements = document.querySelectorAll(selector);
              console.log('[ScrapingEngine] Selector "' + selector + '" found: ' + elements.length + ' elements');
              return { selector: sel, elements: Array.from(elements) };
            });

            // If we have generic selectors that match many elements, use those to find containers
            const hasMultipleMatches = allElementsPerSelector.some(s => s.elements.length > 1);

            if (hasMultipleMatches) {
              // Find common container for matched elements
              // Get the selector with most matches to use as anchor
              const sortedByMatches = [...allElementsPerSelector].sort((a, b) => b.elements.length - a.elements.length);
              const primaryElements = sortedByMatches[0].elements;

              if (primaryElements.length > 1) {
                console.log('[ScrapingEngine] Using ' + primaryElements.length + ' elements from "' + sortedByMatches[0].selector.selector.css + '" to find container');

                // Build a map of potential containers by walking up from EACH primary element
                // and finding which ancestor pattern appears most frequently
                const containerCandidates = new Map(); // selector -> { count, containers, containedElements }

                // Sample up to 20 elements to avoid performance issues
                const sampleSize = Math.min(20, primaryElements.length);
                const sampleElements = primaryElements.slice(0, sampleSize);

                for (const el of sampleElements) {
                  let parent = el.parentElement;
                  let depth = 0;
                  const maxDepth = 10;

                  while (parent && parent !== document.body && depth < maxDepth) {
                    depth++;

                    // Skip invalid containers
                    if (!isValidContainer(parent)) {
                      parent = parent.parentElement;
                      continue;
                    }

                    const tagName = parent.tagName.toLowerCase();
                    const classes = parent.className && typeof parent.className === 'string'
                      ? parent.className.split(' ').filter(c => c && !c.includes('--') && c.length > 1 && !c.match(/^(is-|has-|js-|ng-|_)/))
                      : [];

                    // Build selector candidates for this parent
                    const selectorCandidates = [];

                    // Prioritize product-related classes
                    const productClasses = classes.filter(c => c.toLowerCase().match(/product|item|card|tile|entry|listing|result|data|goods|sku|offer/));
                    if (productClasses.length > 0) {
                      selectorCandidates.push(tagName + '.' + productClasses[0]);
                    }

                    // Then try first class
                    if (classes.length > 0) {
                      selectorCandidates.push(tagName + '.' + classes[0]);
                    }

                    for (const selector of selectorCandidates) {
                      if (!containerCandidates.has(selector)) {
                        const allMatches = document.querySelectorAll(selector);
                        // Filter to only valid containers
                        const validMatches = Array.from(allMatches).filter(isValidContainer);
                        containerCandidates.set(selector, {
                          count: 0,
                          containers: validMatches,
                          containedElements: new Set(),
                          hasProductClass: hasProductClass(parent)
                        });
                      }

                      const candidate = containerCandidates.get(selector);
                      // Check if this element is in one of the containers
                      for (const container of candidate.containers) {
                        if (container.contains(el)) {
                          candidate.containedElements.add(el);
                          break;
                        }
                      }
                    }

                    parent = parent.parentElement;
                  }
                }

                // Find the best container: most elements contained + reasonable count + ideally has product class
                let bestSelector = null;
                let bestScore = 0;
                let bestContainers = [];

                for (const [selector, data] of containerCandidates) {
                  const containedCount = data.containedElements.size;
                  const containerCount = data.containers.length;

                  // Skip if too few or too many containers
                  if (containerCount < 2 || containerCount > 500) continue;

                  // Skip if doesn't contain enough of our sampled elements
                  if (containedCount < sampleSize * 0.3) continue;

                  // Score: prioritize high containment ratio, then product classes
                  let score = containedCount / sampleSize;
                  if (data.hasProductClass) score += 0.5;
                  // Prefer containers in reasonable quantity range
                  if (containerCount >= 5 && containerCount <= 200) score += 0.2;

                  console.log('[ScrapingEngine] Candidate "' + selector + '": ' + containerCount + ' containers, contains ' + containedCount + '/' + sampleSize + ' elements, score=' + score.toFixed(2));

                  if (score > bestScore) {
                    bestScore = score;
                    bestSelector = selector;
                    bestContainers = data.containers;
                  }
                }

                if (bestSelector && bestContainers.length > 0) {
                  console.log('[ScrapingEngine] Best container: ' + bestSelector + ' (' + bestContainers.length + ' items)');
                  return { containers: bestContainers, selector: bestSelector };
                }
              }
            }

            // Fallback: Get first element from each selector
            const firstElements = selectors
              .map(sel => {
                const el = document.querySelector(sel.selector.css);
                console.log('[ScrapingEngine] Selector "' + sel.selector.css + '" found:', el ? 'YES (' + (el.textContent || '').substring(0, 30) + ')' : 'NO');
                return el;
              })
              .filter(el => el !== null);

            console.log('[ScrapingEngine] Found ' + firstElements.length + ' elements from ' + selectors.length + ' selectors');

            if (firstElements.length < 2) {
              console.log('[ScrapingEngine] Need at least 2 selectors to detect container pattern');
              return null;
            }

            // Walk up the DOM from first element to find a container that repeats
            const firstEl = firstElements[0];
            let container = firstEl.parentElement;
            let containerSelector = null;
            let allContainers = [];

            while (container && container !== document.body) {
              // Skip invalid containers
              if (!isValidContainer(container)) {
                container = container.parentElement;
                continue;
              }

              const tagName = container.tagName.toLowerCase();
              const classes = container.className && typeof container.className === 'string'
                ? container.className.split(' ').filter(c => c && !c.includes('--'))
                : [];

              const selectorStrategies = [];

              // Prioritize product-related classes
              const productClasses = classes.filter(c => c.toLowerCase().match(/product|item|card|tile|entry|listing|result|data|goods/));
              if (productClasses.length > 0) {
                selectorStrategies.push(tagName + '.' + productClasses[0]);
              }

              if (classes.length > 0) {
                selectorStrategies.push(tagName + '.' + classes.join('.'));
                selectorStrategies.push(tagName + '.' + classes[0]);
              }
              selectorStrategies.push(tagName);

              for (const selector of selectorStrategies) {
                const matches = document.querySelectorAll(selector);
                const validMatches = Array.from(matches).filter(isValidContainer);
                console.log('[ScrapingEngine] Trying container selector "' + selector + '": ' + validMatches.length + ' valid matches');

                if (validMatches.length > 1 && validMatches.length < 200) {
                  const containersWithAllElements = validMatches.filter(c => {
                    return selectors.every(sel => c.querySelector(sel.selector.css));
                  });

                  console.log('[ScrapingEngine] Containers with ALL our elements: ' + containersWithAllElements.length);

                  if (containersWithAllElements.length > 1) {
                    containerSelector = selector;
                    allContainers = containersWithAllElements;
                    console.log('[ScrapingEngine] Found good container pattern: ' + selector);
                    break;
                  }
                }
              }

              if (containerSelector) break;
              container = container.parentElement;
            }

            if (!containerSelector || allContainers.length === 0) {
              console.log('[ScrapingEngine] Could not find repeating container pattern');
              return null;
            }

            return { containers: allContainers, selector: containerSelector };
          }

          // Find container pattern
          const containerInfo = findItemContainers(selectors);

          if (!containerInfo || containerInfo.containers.length === 0) {
            console.error('[ScrapingEngine] ERROR: Could not detect item container pattern.');
            console.error('[ScrapingEngine] Make sure you select elements that are inside the same product card.');
            console.error('[ScrapingEngine] For example: select a title AND price from the SAME product.');
            return { error: 'NO_CONTAINER_DETECTED', items: [] };
          }

          console.log('[ScrapingEngine] Auto-detected container: ' + containerInfo.selector);
          console.log('[ScrapingEngine] Found ' + containerInfo.containers.length + ' item containers');

          // Group selectors by role and sort by priority for fallback support
          var selectorsByRole = {};
          selectors.forEach(function(sel) {
            var role = sel.role;
            if (!selectorsByRole[role]) {
              selectorsByRole[role] = [];
            }
            selectorsByRole[role].push(sel);
          });
          // Sort each group by priority (lower = first)
          Object.keys(selectorsByRole).forEach(function(role) {
            selectorsByRole[role].sort(function(a, b) {
              return (a.priority || 0) - (b.priority || 0);
            });
          });

          // Helper to find element using multiple strategies
          function findElement(container, sel) {
            var el = null;
            var css = sel.selector.css;

            // Strategy 1: Use the selector directly
            el = container.querySelector(css);

            // Strategy 2: Try with container context
            if (!el && css.includes(' ')) {
              var parts = css.split(' ');
              for (var i = Math.min(3, parts.length); i >= 1 && !el; i--) {
                var partialSelector = parts.slice(-i).join(' ');
                el = container.querySelector(partialSelector);
              }
            }

            // Strategy 3: Try by tag + class
            if (!el && sel.selector.tagName) {
              var tagSelector = sel.selector.tagName.toLowerCase();
              var classAttr = sel.selector.attributes && sel.selector.attributes.class;
              if (classAttr) {
                var firstClass = classAttr.split(' ')[0];
                el = container.querySelector(tagSelector + '.' + firstClass) ||
                     container.querySelector('.' + firstClass) ||
                     container.querySelector(tagSelector);
              } else {
                el = container.querySelector(tagSelector);
              }
            }

            return el;
          }

          // Helper to extract value from element
          function extractValue(el, sel) {
            if (!el) return null;
            var value = null;
            switch (sel.extractionType) {
              case 'text':
                if (sel.role === 'price') {
                  value = extractPrice(el);
                } else if (sel.role === 'originalPrice' || sel.role === 'salePrice') {
                  value = (el.textContent || '').trim();
                } else {
                  value = (el.textContent || '').trim() || null;
                }
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
                if (sel.role === 'price') {
                  value = extractPrice(el);
                } else if (sel.role === 'originalPrice' || sel.role === 'salePrice') {
                  value = (el.textContent || '').trim();
                } else {
                  value = (el.textContent || '').trim() || null;
                }
            }
            return value;
          }

          const items = [];
          containerInfo.containers.forEach((container, idx) => {
            const item = {};
            let hasAnyValue = false;

            // For each role, try selectors in priority order until we get a value
            Object.keys(selectorsByRole).forEach(function(role) {
              var roleSelectors = selectorsByRole[role];
              var value = null;

              // Try each selector in priority order
              for (var i = 0; i < roleSelectors.length && !value; i++) {
                var sel = roleSelectors[i];
                var cssSelector = sel.selector.css;
                var el = findElement(container, sel);

                if (idx === 0) {
                  // Debug first container
                  console.log('[ScrapingEngine] Container #' + idx + ' - Role: ' + role + ', Selector: "' + cssSelector + '", Found: ' + (el ? 'YES' : 'NO'));
                }

                if (el) {
                  value = extractValue(el, sel);
                  if (idx === 0) {
                    console.log('[ScrapingEngine] Container #' + idx + ' - Role: ' + role + ', Value: "' + (value || 'null').substring(0, 50) + '"');
                  }
                  if (value) hasAnyValue = true;
                }
              }

              item[roleSelectors[0].customName || role] = value;
            });

            // Auto-detect sale price: if both prices exist, ensure salePrice <= originalPrice
            if (hasBothPriceTypes && item.originalPrice && item.salePrice) {
              var origVal = parsePrice(item.originalPrice);
              var saleVal = parsePrice(item.salePrice);

              // If original is actually lower than sale, swap them
              if (!isNaN(origVal) && !isNaN(saleVal) && origVal < saleVal) {
                var temp = item.originalPrice;
                item.originalPrice = item.salePrice;
                item.salePrice = temp;
              }
            }

            // Only add items that have at least one value
            if (hasAnyValue) {
              items.push(item);
            }
          });

          return {
            containerSelector: containerInfo.selector,
            containerCount: containerInfo.containers.length,
            items: items
          };
        })()
      `,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Extraction failed');
    }

    const extractionResult = result.result.value as {
      error?: string;
      containerSelector?: string;
      containerCount?: number;
      items: ScrapedItem[]
    };

    // Log container detection info
    if (extractionResult.error === 'NO_CONTAINER_DETECTED') {
      console.error('[ScrapingEngine] Failed to detect item container pattern');
      console.error('[ScrapingEngine] Tip: Select elements from within the same product card (e.g., title + price from same item)');
      return [];
    }

    if (extractionResult.containerSelector) {
      console.log(`[ScrapingEngine] Using auto-detected container: ${extractionResult.containerSelector}`);
      console.log(`[ScrapingEngine] Extracting from ${extractionResult.containerCount} items`);
    }

    return extractionResult.items;
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
    const slowScrollDelay = 1000; // Ms between scrolls - VERY SLOW for lazy load
    const scrollStepSize = 250; // Pixels to scroll each step (small for slow scrolling)
    const loadingWaitTimeout = 3000; // Max ms to wait for loading indicator to disappear
    const maxCycles = 10; // Max number of bottom-up cycles to prevent infinite loops

    console.log('[ScrapingEngine] Auto-scroll: starting lazy load detection (cyclic bottom-up strategy)...');

    // First, try to disable lazy loading mechanisms
    await this.disableLazyLoading();
    await new Promise((r) => setTimeout(r, 500));

    // Helper to get current element count
    const getElementCount = async (): Promise<number> => {
      return await this.page.evaluate((sels) => {
        let total = 0;
        sels.forEach((sel: { selector: { css: string } }) => {
          total += document.querySelectorAll(sel.selector.css).length;
        });
        return total;
      }, selectors);
    };

    // Helper to scroll to bottom and wait for page to expand
    const scrollToBottomAndWait = async (): Promise<number> => {
      let pageHeight = await this.page.evaluate(() => document.documentElement.scrollHeight);
      let previousHeight = 0;
      let heightStableCount = 0;

      while (heightStableCount < 3) {
        await this.page.evaluate(() => {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        });

        await this.triggerLazyLoadEvents();
        await new Promise((r) => setTimeout(r, 800));
        await this.waitForLoadingToComplete(loadingWaitTimeout);

        const newHeight = await this.page.evaluate(() => document.documentElement.scrollHeight);

        if (newHeight === previousHeight) {
          heightStableCount++;
        } else {
          heightStableCount = 0;
          console.log(`[ScrapingEngine] Page expanded to ${newHeight}px`);
        }

        previousHeight = newHeight;
        pageHeight = newHeight;
      }

      return pageHeight;
    };

    // Helper to slowly scroll up and detect new elements - STOPS IMMEDIATELY when new products found
    const slowScrollUp = async (pageHeight: number, startCount: number): Promise<{ newCount: number; foundNew: boolean }> => {
      let currentPosition = pageHeight;
      let lastCount = startCount;

      console.log(`[ScrapingEngine] Slowly scrolling up from ${pageHeight}px...`);

      while (currentPosition > 0) {
        // Scroll up by small increment
        currentPosition = Math.max(0, currentPosition - scrollStepSize);

        await this.page.evaluate((pos) => {
          window.scrollTo({ top: pos, behavior: 'smooth' });
        }, currentPosition);

        // Wait for smooth scroll to complete - SLOW
        await new Promise((r) => setTimeout(r, slowScrollDelay));

        // Trigger lazy load events
        await this.triggerLazyLoadEvents();

        // Wait for any loading
        await this.waitForLoadingToComplete(loadingWaitTimeout);

        // Check element count
        const currentCount = await getElementCount();

        if (currentCount > lastCount) {
          console.log(`[ScrapingEngine] NEW PRODUCTS LOADED! ${currentCount} elements (was ${lastCount}) at ${currentPosition}px`);
          console.log(`[ScrapingEngine] Stopping scroll-up immediately, will go back to bottom...`);
          // Return immediately - don't continue scrolling up
          return { newCount: currentCount, foundNew: true };
        }

        // Log progress every 5 steps
        if (Math.floor(currentPosition / scrollStepSize) % 5 === 0 && currentPosition > 0) {
          console.log(`[ScrapingEngine] Scroll position: ${currentPosition}px, elements: ${lastCount}`);
        }
      }

      // Reached top without finding new elements
      return { newCount: lastCount, foundNew: false };
    };

    // Get initial element count
    let totalElementCount = await getElementCount();
    console.log(`[ScrapingEngine] Initial element count: ${totalElementCount}`);

    // Main cycle: scroll to bottom -> scroll up slowly -> if new elements found, repeat
    let cycleCount = 0;
    let keepGoing = true;

    while (keepGoing && cycleCount < maxCycles) {
      cycleCount++;
      console.log(`[ScrapingEngine] === CYCLE ${cycleCount}/${maxCycles} ===`);

      // Step 1: Scroll to bottom and wait for page to fully expand
      console.log('[ScrapingEngine] Step 1: Scrolling to bottom...');
      const pageHeight = await scrollToBottomAndWait();
      console.log(`[ScrapingEngine] Page height: ${pageHeight}px`);

      // Check if we got new elements just from scrolling down
      const afterBottomCount = await getElementCount();
      if (afterBottomCount > totalElementCount) {
        console.log(`[ScrapingEngine] Found ${afterBottomCount - totalElementCount} new elements after scrolling to bottom`);
        totalElementCount = afterBottomCount;
      }

      // Step 2: Slowly scroll up
      console.log('[ScrapingEngine] Step 2: Slowly scrolling up...');
      const { newCount, foundNew } = await slowScrollUp(pageHeight, totalElementCount);

      if (newCount > totalElementCount) {
        console.log(`[ScrapingEngine] Cycle ${cycleCount} found ${newCount - totalElementCount} new elements!`);
        totalElementCount = newCount;
      }

      // If we found new elements during scroll up, do another cycle
      if (foundNew) {
        console.log('[ScrapingEngine] New elements detected during scroll-up, will repeat cycle...');
        // Small pause before next cycle
        await new Promise((r) => setTimeout(r, 500));
      } else {
        console.log('[ScrapingEngine] No new elements found during scroll-up, finishing...');
        keepGoing = false;
      }
    }

    if (cycleCount >= maxCycles) {
      console.log(`[ScrapingEngine] Reached max cycles (${maxCycles}), stopping`);
    }

    // Final wait for any remaining loading
    await this.waitForLoadingToComplete(loadingWaitTimeout);

    // Scroll back to top before extraction
    await this.page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await new Promise((r) => setTimeout(r, 300));

    console.log(`[ScrapingEngine] Auto-scroll finished after ${cycleCount} cycles: ${totalElementCount} total elements found`);
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

      try {
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
      } catch (error) {
        // Pre-actions are optional (e.g., cookie popups may not always appear)
        // Log and continue instead of failing the entire scrape
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[ScrapingEngine] Pre-action failed (non-fatal), continuing: ${errorMessage}`);
      }
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
