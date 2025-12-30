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
    const targetProducts = config.targetProducts || 0; // 0 = unlimited

    // Ensure selectors is always an array
    const selectors = Array.isArray(config.selectors) ? config.selectors : [];

    console.log(`[ScrapingEngine] Starting scrape: ${config.name}`);
    console.log(`[ScrapingEngine] URL: ${config.startUrl}`);
    console.log(`[ScrapingEngine] Selectors: ${selectors.length}`);
    console.log(`[ScrapingEngine] Target products: ${targetProducts || 'unlimited'}`);

    // Validate we have at least one selector
    if (selectors.length === 0) {
      console.error('[ScrapingEngine] No selectors configured');
      return {
        success: false,
        items: [],
        pagesScraped: 0,
        duration: Date.now() - startTime,
        errors: ['No selectors configured. Please configure selectors in the Builder first.'],
      };
    }

    // Use normalized selectors throughout
    config = { ...config, selectors };

    try {
      // Inject IntersectionObserver override BEFORE navigation to catch all lazy loaders
      await this.injectLazyLoadBlocker();

      // Navigate to start URL
      console.log(`[ScrapingEngine] Navigating to: ${config.startUrl}`);
      await this.page.goto(config.startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      console.log(`[ScrapingEngine] Navigation complete, current URL: ${this.page.url()}`);

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

        console.log(`[ScrapingEngine] Extracted ${pageItems.length} items from page ${pageNum + 1} (total: ${allItems.length})`);

        // Check if we've reached target products
        if (targetProducts > 0 && allItems.length >= targetProducts) {
          console.log(`[ScrapingEngine] Reached target of ${targetProducts} products, stopping`);
          // Truncate to exact target
          allItems.length = targetProducts;
          break;
        }

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

      // Final truncation in case we went over on the last page
      if (targetProducts > 0 && allItems.length > targetProducts) {
        console.log(`[ScrapingEngine] Truncating ${allItems.length} items to target ${targetProducts}`);
        allItems.length = targetProducts;
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
      if (error instanceof Error && error.stack) {
        console.error(`[ScrapingEngine] Stack trace:`, error.stack);
      }

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
    // Check if this is Zara's split layout (comma-separated selectors for image + info cards)
    // For Zara, we need to pair image cards with info cards by index, not treat them as separate containers
    const isZaraSplitLayout = containerSelector.includes('li.product-grid-product[data-productid]') &&
                               containerSelector.includes('li.product-grid-block-dynamic__product-info');

    if (isZaraSplitLayout) {
      console.log('[ScrapingEngine] Detected Zara split layout - using paired extraction');
      return this.extractFromZaraSplitLayout(selectors);
    }

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

          // Try to find containers - handle selectors with special chars like @, /
          var containerSelector = ${JSON.stringify(containerSelector)};
          var containers = [];

          // Check if selector has special chars that need class-based matching
          // Check for both escaped (\@, \/) and unescaped (@, /) versions
          var hasSpecialChars = containerSelector.indexOf('@') !== -1 ||
                                containerSelector.indexOf('/') !== -1;

          if (!hasSpecialChars) {
            // Normal selector - try querySelector directly
            try {
              containers = document.querySelectorAll(containerSelector);
            } catch (e) {
              // Will fall through to class-based matching
            }
          }

          // If no results or has special chars, use class-based matching
          if (!containers || containers.length === 0) {
            // Parse selector: tag.class1.class2.class3
            // First unescape any CSS escape sequences for class matching
            // In browser JS, containerSelector has single backslashes like \\@ which we need to remove
            console.log('[ScrapingEngine] Original selector:', containerSelector);
            console.log('[ScrapingEngine] hasSpecialChars:', hasSpecialChars);
            var unescapedSelector = containerSelector.replace(/\\\\(.)/g, '$1');
            console.log('[ScrapingEngine] Unescaped selector:', unescapedSelector);
            var dotIndex = unescapedSelector.indexOf('.');
            if (dotIndex > 0) {
              var tag = unescapedSelector.substring(0, dotIndex);
              var classStr = unescapedSelector.substring(dotIndex + 1);
              // Split by dots to get individual class names
              var classes = classStr.split('.').filter(Boolean);

              console.log('[ScrapingEngine] Class-based matching: tag=' + tag + ', classes=' + JSON.stringify(classes));

              // Find all elements of the tag type
              var candidates = document.querySelectorAll(tag);
              console.log('[ScrapingEngine] Found ' + candidates.length + ' ' + tag + ' elements');

              // Log first candidate's classes for debugging
              if (candidates.length > 0) {
                console.log('[ScrapingEngine] First candidate classes:', Array.from(candidates[0].classList));
              }

              containers = [];

              for (var i = 0; i < candidates.length; i++) {
                // Check if element has ALL the required classes
                var hasAll = true;
                for (var j = 0; j < classes.length; j++) {
                  if (!candidates[i].classList.contains(classes[j])) {
                    hasAll = false;
                    break;
                  }
                }
                if (hasAll) {
                  containers.push(candidates[i]);
                }
              }

              console.log('[ScrapingEngine] Matched ' + containers.length + ' containers after class filtering');
            }
          }

          if (!containers || containers.length === 0) {
            throw new Error('No containers found for selector: ' + containerSelector);
          }
          // Convert NodeList to Array for consistent iteration
          containers = Array.from(containers);
          console.log('[ScrapingEngine] Found ' + containers.length + ' containers');

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
                // Try src first, then fall back to data-src for lazy-loaded images
                value = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || null;
                // Skip placeholder images (commonly used for lazy loading)
                if (value && (value.includes('placeholder') || value.includes('loading') || value.includes('blank') || value.startsWith('data:image'))) {
                  value = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || null;
                }
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
                var el = null;

                // Special handling for :parent-link - look UP the DOM instead of down
                if (cssSelector === ':parent-link') {
                  el = container.closest('a[href]');
                  if (idx === 0) {
                    console.log('[ScrapingEngine] Container #' + idx + ' - Role: ' + role + ', Using :parent-link (closest a[href]), Found: ' + (el ? 'YES' : 'NO'));
                  }
                } else {
                  el = container.querySelector(cssSelector);
                  if (idx === 0) {
                    // Debug first container
                    console.log('[ScrapingEngine] Container #' + idx + ' - Role: ' + role + ', Selector: "' + cssSelector + '", Found: ' + (el ? 'YES' : 'NO'));
                  }
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

            // Skip items where title AND price are both null (likely non-product cards like banners/promos)
            var hasTitle = item.title !== null && item.title !== undefined;
            var hasPrice = item.price !== null && item.price !== undefined;
            if (!hasTitle && !hasPrice) {
              if (idx === 0) {
                console.log('[ScrapingEngine] Skipping container #' + idx + ' - no title or price (likely not a product)');
              }
              return; // Skip this item
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
      console.error('[ScrapingEngine] Exception details:', JSON.stringify(result.exceptionDetails, null, 2));
      throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Extraction failed');
    }

    if (!result.result || result.result.value === undefined) {
      console.error('[ScrapingEngine] No result value returned:', JSON.stringify(result, null, 2));
      throw new Error('Extraction returned no data');
    }

    return result.result.value as ScrapedItem[];
  }

  // Special extraction for Zara's split layout where images and info are in separate rows
  private async extractFromZaraSplitLayout(selectors: AssignedSelector[]): Promise<ScrapedItem[]> {
    // Build a set of requested roles to only extract what the user selected
    const requestedRoles = new Set(selectors.map(s => s.role));

    const result = await this.cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          var selectors = ${JSON.stringify(selectors)};
          var requestedRoles = ${JSON.stringify([...requestedRoles])};

          // Helper: Parse a price string to a number
          function parsePrice(priceStr) {
            if (!priceStr) return NaN;
            var cleaned = priceStr.replace(/[£$€¥₹MAD\\s]/gi, '').replace(/,/g, '.');
            var parts = cleaned.split('.');
            if (parts.length > 2) {
              cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
            }
            return parseFloat(cleaned);
          }

          // Check if a role was requested by the user
          function isRoleRequested(role) {
            return requestedRoles.indexOf(role) !== -1;
          }

          // Get all image cards and info cards
          var imageCards = document.querySelectorAll('li.product-grid-product[data-productid]');
          var infoCards = document.querySelectorAll('li.product-grid-block-dynamic__product-info');

          console.log('[Zara] Found ' + imageCards.length + ' image cards and ' + infoCards.length + ' info cards');
          console.log('[Zara] Requested roles: ' + requestedRoles.join(', '));

          // Pair them by index
          var items = [];
          var numProducts = Math.min(imageCards.length, infoCards.length);

          for (var i = 0; i < numProducts; i++) {
            var imageCard = imageCards[i];
            var infoCard = infoCards[i];
            var item = {};

            // Extract from image card: image src (only if user selected 'image')
            if (isRoleRequested('image')) {
              var img = imageCard.querySelector('img');
              if (img) {
                var src = img.getAttribute('src');
                if (src) {
                  if (!src.startsWith('http')) {
                    src = new URL(src, window.location.origin).href;
                  }
                  item.image = src;
                }
              }
            }

            // Extract product link (only if user selected 'url')
            if (isRoleRequested('url')) {
              var link = imageCard.querySelector('a[href]');
              if (link) {
                var href = link.getAttribute('href');
                if (href && !href.startsWith('#')) {
                  if (!href.startsWith('http')) {
                    href = new URL(href, window.location.origin).href;
                  }
                  item.url = href;
                }
              }
            }

            // Extract from info card: title (only if user selected 'title')
            if (isRoleRequested('title')) {
              var titleEl = infoCard.querySelector('.product-grid-product-info__name, [class*="product-name"], a');
              if (titleEl) {
                item.title = (titleEl.textContent || '').trim();
              }
            }

            // Extract price (check for 'price', 'originalPrice' roles)
            if (isRoleRequested('price') || isRoleRequested('originalPrice')) {
              // Try user's configured selector first, then fall back to generic selectors
              var priceSelector = selectors.find(function(s) { return s.role === 'price' || s.role === 'originalPrice'; });
              var priceEl = null;
              if (priceSelector && priceSelector.selector && priceSelector.selector.css) {
                priceEl = infoCard.querySelector(priceSelector.selector.css);
              }
              // Fallback to generic price selectors
              if (!priceEl) {
                priceEl = infoCard.querySelector('.money-amount__main, .money-amount.money-amount--highlight span, [class*="price"], [class*="amount"]');
              }
              if (priceEl) {
                var priceValue = (priceEl.textContent || '').trim();
                // Use the role name that was requested
                if (isRoleRequested('price')) {
                  item.price = priceValue;
                }
                if (isRoleRequested('originalPrice')) {
                  item.originalPrice = priceValue;
                }
              }
            }

            // Check for sale price (only if user selected 'salePrice')
            if (isRoleRequested('salePrice')) {
              var salePriceEl = infoCard.querySelector('.money-amount--is-discounted, [class*="sale"], [class*="discount"]');
              if (salePriceEl) {
                item.salePrice = (salePriceEl.textContent || '').trim();
              }
            }

            // Only add if we have at least one extracted value
            if (Object.keys(item).length > 0) {
              items.push(item);
            }
          }

          console.log('[Zara] Extracted ' + items.length + ' products with roles: ' + requestedRoles.join(', '));
          return items;
        })()
      `,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Zara extraction failed');
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
              // Skip :parent-link as it needs container context
              if (selector === ':parent-link') {
                console.log('[ScrapingEngine] Selector ":parent-link" skipped (needs container context)');
                return { selector: sel, elements: [] };
              }
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
                // Skip :parent-link as it needs container context
                if (sel.selector.css === ':parent-link') {
                  console.log('[ScrapingEngine] Selector ":parent-link" skipped (needs container context)');
                  return null;
                }
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
                    return selectors.every(sel => {
                      // Handle :parent-link by checking closest parent link
                      if (sel.selector.css === ':parent-link') {
                        return c.closest('a[href]') !== null;
                      }
                      return c.querySelector(sel.selector.css);
                    });
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

            // Special handling for :parent-link - look UP the DOM
            if (css === ':parent-link') {
              return container.closest('a[href]');
            }

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
                // Try src first, then fall back to data-src for lazy-loaded images
                value = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || null;
                // Skip placeholder images
                if (value && (value.includes('placeholder') || value.includes('loading') || value.includes('blank') || value.startsWith('data:image'))) {
                  value = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || null;
                }
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

  // Force all images to have their src populated from data-src before extraction
  private async forceAllImagesToLoad(): Promise<void> {
    const result = await this.page.evaluate(`
      (function() {
        var imagesFixed = 0;

        // Find all images and ensure they have src populated
        document.querySelectorAll('img').forEach(function(img) {
          var currentSrc = img.getAttribute('src') || '';
          var isPlaceholder = !currentSrc ||
                              currentSrc.includes('placeholder') ||
                              currentSrc.includes('loading') ||
                              currentSrc.includes('blank') ||
                              currentSrc.startsWith('data:image');

          if (isPlaceholder) {
            // Try to find the real source from various data attributes
            var realSrc = img.getAttribute('data-src') ||
                          img.getAttribute('data-lazy-src') ||
                          img.getAttribute('data-original') ||
                          img.getAttribute('data-lazy') ||
                          img.getAttribute('data-srcset');

            if (realSrc) {
              // Handle srcset format (take first URL)
              if (realSrc.includes(',') || realSrc.includes(' ')) {
                var firstUrl = realSrc.split(',')[0].split(' ')[0].trim();
                if (firstUrl) realSrc = firstUrl;
              }

              img.setAttribute('src', realSrc);
              img.removeAttribute('loading'); // Remove lazy loading attribute
              imagesFixed++;
            }
          }
        });

        console.log('[ScrapingEngine] Forced ' + imagesFixed + ' lazy-loaded images to load');
        return imagesFixed;
      })();
    `);

    console.log(`[ScrapingEngine] Force-loaded images: ${result.result?.value || 0}`);
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
    const scrollDelay = 800; // Ms between scroll steps
    const slowScrollDelay = 1000; // Ms for slow scroll-up
    const scrollStepSize = 300; // Pixels per scroll step
    const loadingWaitTimeout = 3000; // Max ms to wait for loading indicator
    const maxIterations = 100; // Max scroll iterations to prevent infinite loops
    const noChangeThreshold = 3; // How many times at bottom with no change before giving up

    console.log('[ScrapingEngine] Auto-scroll: starting lazy load detection...');

    // First, try to disable lazy loading mechanisms
    await this.disableLazyLoading();
    await new Promise((r) => setTimeout(r, 500));

    // Helper to get current element count
    const getElementCount = async (): Promise<number> => {
      return await this.page.evaluate((sels) => {
        let total = 0;
        sels.forEach((sel: { selector: { css: string } }) => {
          // Skip :parent-link as it's not a valid CSS selector
          if (sel.selector.css === ':parent-link') return;
          total += document.querySelectorAll(sel.selector.css).length;
        });
        return total;
      }, selectors);
    };

    // Helper to get page metrics
    const getPageMetrics = async () => {
      return await this.page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        scrollTop: window.scrollY,
        clientHeight: document.documentElement.clientHeight,
      }));
    };

    // Get initial state
    let totalElementCount = await getElementCount();
    const initialCount = totalElementCount;
    console.log(`[ScrapingEngine] Initial element count: ${totalElementCount}`);

    // =========================================================================
    // STRATEGY 1: Jump to bottom repeatedly until nothing loads
    // Works for most sites (Zara, Amazon, typical infinite scroll)
    // =========================================================================
    console.log('[ScrapingEngine] Strategy 1: Scroll to bottom to load content...');

    let iteration = 0;
    let noChangeAtBottomCount = 0;
    let scrollDownLoadedContent = false;

    while (iteration < maxIterations && noChangeAtBottomCount < noChangeThreshold) {
      iteration++;
      const beforeCount = totalElementCount;
      const beforeHeight = await this.page.evaluate(() => document.documentElement.scrollHeight);

      // Jump straight to bottom (fast)
      await this.page.evaluate(() => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      });
      await new Promise((r) => setTimeout(r, scrollDelay));
      await this.triggerLazyLoadEvents();
      await this.waitForLoadingToComplete(loadingWaitTimeout);

      // Check for new elements
      const afterCount = await getElementCount();
      const afterHeight = await this.page.evaluate(() => document.documentElement.scrollHeight);

      if (afterCount > beforeCount) {
        console.log(`[ScrapingEngine] Loaded ${afterCount - beforeCount} new elements (total: ${afterCount})`);
        totalElementCount = afterCount;
        noChangeAtBottomCount = 0; // Reset counter since we found new content
        scrollDownLoadedContent = true;
      } else if (afterHeight > beforeHeight) {
        // Page expanded but no new elements yet - keep going
        console.log(`[ScrapingEngine] Page expanded: ${beforeHeight}px -> ${afterHeight}px`);
        noChangeAtBottomCount = 0;
      } else {
        // At bottom with no new content and no expansion
        noChangeAtBottomCount++;
        console.log(`[ScrapingEngine] At bottom, no new content (${noChangeAtBottomCount}/${noChangeThreshold})`);
      }

      // Log progress periodically
      if (iteration % 5 === 0) {
        console.log(`[ScrapingEngine] Progress: iteration ${iteration}, ${totalElementCount} elements`);
      }
    }

    const afterStrategy1Count = totalElementCount;
    console.log(`[ScrapingEngine] Strategy 1 complete: ${totalElementCount} elements (${totalElementCount - initialCount} new)`);

    // =========================================================================
    // STRATEGY 2: Try scroll-up to find more content
    // Many sites only load content when scrolling up from the bottom
    // But if Strategy 1 worked well, we bail out early if scroll-up finds nothing
    // =========================================================================
    const earlyBailIterations = 5; // If no new content after this many iterations, stop
    console.log('[ScrapingEngine] Strategy 2: Trying scroll-up to find more content...');
    {
      // We're already at bottom from Strategy 1, now slowly scroll up
      iteration = 0;
      noChangeAtBottomCount = 0;
      let scrollUpLoadedContent = false;
      let iterationsWithoutNewContent = 0;

      while (iteration < maxIterations && noChangeAtBottomCount < noChangeThreshold) {
        iteration++;
        const beforeCount = totalElementCount;
        const metrics = await getPageMetrics();

        // EARLY BAIL: If scroll-up hasn't found anything new after a few iterations, stop
        // This prevents wasting time when Strategy 1 already worked
        if (iterationsWithoutNewContent >= earlyBailIterations && !scrollUpLoadedContent) {
          console.log(`[ScrapingEngine] Scroll-up found nothing after ${earlyBailIterations} iterations, skipping rest`);
          break;
        }

        // Check if we're at the top
        if (metrics.scrollTop <= 50) {
          if (scrollUpLoadedContent) {
            // Found content during scroll-up, go back to bottom and try scroll-up again
            console.log('[ScrapingEngine] Reached top, going back to bottom...');
            await this.page.evaluate(() => {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
            });
            await new Promise((r) => setTimeout(r, 500));
            scrollUpLoadedContent = false; // Reset for next cycle
            iterationsWithoutNewContent = 0; // Reset early bail counter too
          } else {
            // Reached top without finding anything new
            noChangeAtBottomCount++;
            console.log(`[ScrapingEngine] At top, no new content (${noChangeAtBottomCount}/${noChangeThreshold})`);
            // Go back to bottom to try again
            await this.page.evaluate(() => {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
            });
            await new Promise((r) => setTimeout(r, 500));
          }
          continue;
        }

        // Scroll up slowly
        await this.page.evaluate((step) => {
          window.scrollTo({ top: Math.max(0, window.scrollY - step), behavior: 'smooth' });
        }, scrollStepSize);
        await new Promise((r) => setTimeout(r, slowScrollDelay));
        await this.triggerLazyLoadEvents();
        await this.waitForLoadingToComplete(loadingWaitTimeout);

        // Check for new elements
        const afterCount = await getElementCount();
        if (afterCount > beforeCount) {
          console.log(`[ScrapingEngine] Scroll-up loaded ${afterCount - beforeCount} new elements (total: ${afterCount})`);
          totalElementCount = afterCount;
          noChangeAtBottomCount = 0;
          scrollUpLoadedContent = true;
          iterationsWithoutNewContent = 0; // Reset early bail counter

          // Immediately go back to bottom when we find new content
          console.log('[ScrapingEngine] New content found, going back to bottom...');
          await this.page.evaluate(() => {
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
          });
          await new Promise((r) => setTimeout(r, 500));
        } else {
          iterationsWithoutNewContent++;
        }

        // Log progress periodically
        if (iteration % 10 === 0) {
          console.log(`[ScrapingEngine] Strategy 2 progress: iteration ${iteration}, ${totalElementCount} elements`);
        }
      }

      console.log(`[ScrapingEngine] Strategy 2 complete: ${totalElementCount} elements (${totalElementCount - afterStrategy1Count} new from scroll-up)`);
    }

    // Final wait for any remaining loading
    await this.waitForLoadingToComplete(loadingWaitTimeout);

    // Force all lazy-loaded images to have their src populated before extraction
    await this.forceAllImagesToLoad();

    // Scroll back to top before extraction
    await this.page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await new Promise((r) => setTimeout(r, 300));

    console.log(`[ScrapingEngine] Auto-scroll complete: ${totalElementCount} total elements (${totalElementCount - initialCount} loaded via scroll)`);
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
    // Block navigation during pre-actions to prevent accidental redirects
    // (e.g., clicking "Accept Cookies" might trigger a click on element behind it)
    const currentUrl = this.page.url();
    await this.page.route('**/*', async (route) => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        const targetUrl = request.url();
        if (targetUrl === currentUrl || targetUrl.startsWith(currentUrl + '#')) {
          await route.continue();
        } else {
          console.log(`[ScrapingEngine] Blocked navigation during pre-actions: ${targetUrl}`);
          await route.abort('aborted');
        }
      } else {
        await route.continue();
      }
    });

    try {
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
    } finally {
      // Remove navigation blocking after pre-actions complete
      await this.page.unroute('**/*');
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
      // Skip :parent-link validation - it will be checked via closest() at extraction time
      if (selector.selector.css === ':parent-link') {
        continue;
      }

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
                // Try src first, then fall back to data-src for lazy-loaded images
                var imgSrc = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || null;
                if (imgSrc && (imgSrc.includes('placeholder') || imgSrc.includes('loading') || imgSrc.includes('blank') || imgSrc.startsWith('data:image'))) {
                  imgSrc = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || null;
                }
                result[name] = imgSrc;
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
