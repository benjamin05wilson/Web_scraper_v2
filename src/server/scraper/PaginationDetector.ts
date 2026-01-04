// ============================================================================
// PAGINATION DETECTOR
// ============================================================================
// Analyzes DOM to find pagination candidates for auto-detection

import type { Page } from 'playwright';
import type { PaginationCandidate } from '../../shared/types.js';
import { getGeminiService } from '../ai/GeminiService.js';

/**
 * Offset pattern for URL-based pagination (e.g., ?o=0 → ?o=24 → ?o=48)
 */
export interface OffsetPattern {
  key: string;         // e.g., 'o', 'offset', 'start'
  start: number;       // Starting value (usually 0)
  increment: number;   // How much to add per page (e.g., 24)
  type: 'offset' | 'page'; // offset multiplies, page is literal
}

/**
 * Detects pagination elements in the DOM
 */
export class PaginationDetector {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Detect pagination candidates in the current page
   */
  async detectCandidates(): Promise<PaginationCandidate[]> {
    // Use a string-based evaluate to avoid esbuild __name helper injection
    // DYNAMIC DETECTION: Uses position, behavior, and structure rather than hardcoded text patterns
    const detectScript = `
      (function() {
        var results = [];
        var seen = new Set();

        function generateSelector(el) {
          // Priority 1: ID selector (most stable)
          if (el.id) {
            return '#' + CSS.escape(el.id);
          }

          // Priority 2: Try to build a unique selector using classes only (more stable than nth-child)
          var uniqueClasses = [];
          for (var i = 0; i < el.classList.length; i++) {
            var c = el.classList[i];
            // Skip utility classes
            if (!c.match(/^(hover|active|focus|disabled|hidden|visible|flex|grid|p-|m-|w-|h-|text-|bg-|js-|is-|has-)/)) {
              uniqueClasses.push(c);
            }
          }

          // Try class-only selector first
          if (uniqueClasses.length > 0) {
            var classSelector = el.tagName.toLowerCase() + '.' + uniqueClasses.map(function(c) { return CSS.escape(c); }).join('.');
            var matches = document.querySelectorAll(classSelector);
            if (matches.length === 1) {
              return classSelector;
            }
          }

          // Priority 3: Use data attributes if available
          var dataAttrs = ['data-testid', 'data-id', 'data-action', 'data-component'];
          for (var j = 0; j < dataAttrs.length; j++) {
            var attrVal = el.getAttribute(dataAttrs[j]);
            if (attrVal) {
              var attrSelector = el.tagName.toLowerCase() + '[' + dataAttrs[j] + '="' + CSS.escape(attrVal) + '"]';
              if (document.querySelectorAll(attrSelector).length === 1) {
                return attrSelector;
              }
            }
          }

          // Priority 4: Combine tag + classes + text content hint
          if (uniqueClasses.length > 0) {
            var text = (el.textContent || '').trim().substring(0, 20);
            // Just return the class selector even if not unique - we'll verify later
            return el.tagName.toLowerCase() + '.' + uniqueClasses.map(function(c) { return CSS.escape(c); }).join('.');
          }

          // Fallback: Build path with nth-child (less stable but necessary)
          var parts = [];
          var current = el;
          while (current && current !== document.body) {
            var selector = current.tagName.toLowerCase();
            var classes = [];
            for (var k = 0; k < current.classList.length; k++) {
              var cls = current.classList[k];
              if (!cls.match(/^(hover|active|focus|disabled|hidden|visible|flex|grid|p-|m-|w-|h-|text-|bg-)/)) {
                classes.push(cls);
              }
            }
            if (classes.length > 0 && classes.length <= 3) {
              selector += '.' + classes.map(function(c) { return CSS.escape(c); }).join('.');
            }
            var parent = current.parentElement;
            if (parent) {
              var siblings = [];
              for (var m = 0; m < parent.children.length; m++) {
                if (parent.children[m].tagName === current.tagName) {
                  siblings.push(parent.children[m]);
                }
              }
              if (siblings.length > 1) {
                var index = siblings.indexOf(current) + 1;
                selector += ':nth-child(' + index + ')';
              }
            }
            parts.unshift(selector);
            current = current.parentElement;
            if (parts.length >= 4) break;
          }
          return parts.join(' > ');
        }

        function getBoundingBox(el) {
          var rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }

        function isVisible(el) {
          var style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          var rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        // Generate a unique selector for a numbered page button using data attributes or text content
        function generateNumberedPageSelector(el, pageNum) {
          // Try data-page attribute (common for pagination)
          var dataPage = el.getAttribute('data-page');
          if (dataPage) {
            return el.tagName.toLowerCase() + '[data-page="' + CSS.escape(dataPage) + '"]';
          }

          // Try data-ts-link or other data attributes that might be unique
          var dataAttrs = ['data-ts-link', 'data-testid', 'data-id', 'data-value'];
          for (var i = 0; i < dataAttrs.length; i++) {
            var attrVal = el.getAttribute(dataAttrs[i]);
            if (attrVal && attrVal.indexOf('"san_NaviPaging":"' + pageNum + '"') !== -1) {
              return el.tagName.toLowerCase() + '[' + dataAttrs[i] + '*="san_NaviPaging\\":\\"' + pageNum + '"]';
            }
            if (attrVal) {
              var selector = el.tagName.toLowerCase() + '[' + dataAttrs[i] + '="' + CSS.escape(attrVal) + '"]';
              if (document.querySelectorAll(selector).length === 1) {
                return selector;
              }
            }
          }

          // Try aria-label
          var ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.indexOf(pageNum) !== -1) {
            return el.tagName.toLowerCase() + '[aria-label="' + CSS.escape(ariaLabel) + '"]';
          }

          // Use text content matching - most reliable for numbered buttons
          // This creates a selector like: button:has-text("2") but we need CSS-compatible version
          // Use the :nth-of-type approach within the parent
          var parent = el.parentElement;
          if (parent) {
            var siblings = parent.querySelectorAll(el.tagName.toLowerCase());
            for (var j = 0; j < siblings.length; j++) {
              if (siblings[j] === el) {
                // Check if parent has a useful class
                var parentClass = '';
                if (parent.className) {
                  var classes = parent.className.split(/\\s+/).filter(function(c) {
                    return c.match(/pag|page/i);
                  });
                  if (classes.length > 0) {
                    parentClass = '.' + CSS.escape(classes[0]) + ' ';
                  }
                }
                return parentClass + el.tagName.toLowerCase() + ':nth-of-type(' + (j + 1) + ')';
              }
            }
          }

          // Fallback to generateSelector
          return generateSelector(el);
        }

        // ============================================================================
        // DYNAMIC DETECTION STRATEGY
        // ============================================================================
        // Instead of hardcoding text patterns, we use behavioral/structural signals:
        // 1. Find product grid/list containers
        // 2. Look for isolated clickable elements AFTER the products
        // 3. Score based on position, isolation, and element characteristics
        // ============================================================================

        // Step 1: Find the main product container
        function findProductContainer() {
          var candidates = [];

          // Look for grids/lists with multiple similar children (products)
          var containers = document.querySelectorAll('[class*="grid"], [class*="list"], [class*="product"], [class*="result"], [class*="item"], main, [role="main"], article');

          containers.forEach(function(container) {
            // Count direct children that look like product cards
            var children = container.children;
            if (children.length < 3) return;

            // Check if children have similar structure (images + text)
            var hasImages = 0;
            var hasPrices = 0;
            for (var i = 0; i < Math.min(children.length, 10); i++) {
              if (children[i].querySelector('img')) hasImages++;
              if (children[i].textContent && /[\\$€£¥₹]|\\d+[.,]\\d{2}/.test(children[i].textContent)) hasPrices++;
            }

            if (hasImages >= 3 || hasPrices >= 3) {
              candidates.push({
                el: container,
                score: hasImages + hasPrices,
                childCount: children.length
              });
            }
          });

          // Return the best candidate
          candidates.sort(function(a, b) { return b.score - a.score; });
          return candidates[0] ? candidates[0].el : null;
        }

        // Step 2: Find clickable elements positioned after the product grid
        function findPostGridButtons(productContainer) {
          var buttons = [];
          if (!productContainer) return buttons;

          var containerRect = productContainer.getBoundingClientRect();
          var containerBottom = containerRect.bottom;

          // Find all clickable elements
          document.querySelectorAll('button, a, [role="button"], [onclick]').forEach(function(el) {
            if (!isVisible(el) || seen.has(el)) return;

            var rect = el.getBoundingClientRect();
            var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
            var textLower = text.toLowerCase();
            var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

            // Skip if too much text (likely not a simple button)
            if (text.length > 50) return;

            // Skip if it's a navigation/header element (top of page)
            if (rect.top < 200) return;

            // SKIP "Previous" buttons - they navigate backwards!
            var isPrevious = /\b(prev|previous|zurück|précédent|anterior|vorige|indietro)\b/.test(textLower) ||
                            /\b(prev|previous|back)\b/.test(ariaLabel);
            if (isPrevious) {
              console.log('[findPostGridButtons] Skipping previous button:', text);
              return;
            }

            // Skip disabled buttons
            if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
              console.log('[findPostGridButtons] Skipping disabled button:', text);
              return;
            }

            // SKIP common non-pagination elements - ratings, reviews, category links, etc.
            // Skip if text looks like a rating (e.g., "5.02 reviews", "4.5 stars", "3.9/5")
            if (/\\d+\\.\\d+\\s*(review|star|rating|out of)/i.test(text)) {
              console.log('[findPostGridButtons] Skipping rating/review:', text);
              return;
            }
            // Skip if text contains product-related category words
            if (/\\b(cardigan|shirt|dress|pants|shoes|jacket|sweater|blouse|skirt|coat|jeans|boots|sneakers|top|bottom|wear|clothing|outfit)s?\\b/i.test(textLower)) {
              console.log('[findPostGridButtons] Skipping product category:', text);
              return;
            }
            // Skip if text is a help/support link
            if (/\\b(order|help|support|contact|faq|return|shipping|track|where|my account|sign in|log in)\\b/i.test(textLower)) {
              console.log('[findPostGridButtons] Skipping help/support link:', text);
              return;
            }
            // Skip if it's a filter/sort option
            if (/\\b(filter|sort|refine|brand|size|color|price|category)\\b/i.test(textLower)) {
              console.log('[findPostGridButtons] Skipping filter/sort:', text);
              return;
            }
            // Skip if it looks like a "More +" or "See more X" category expander (not pagination)
            if (/^more\\s*\\+?$/i.test(text) || /^see\\s+more\\s+\\w/i.test(text)) {
              console.log('[findPostGridButtons] Skipping category expander:', text);
              return;
            }

            // Calculate position score - prefer buttons near/after the product grid
            var positionScore = 0;

            // Is it below or near the bottom of the product container?
            if (rect.top >= containerBottom - 100) {
              positionScore += 0.3;
            }

            // Is it horizontally centered?
            var viewportCenter = window.innerWidth / 2;
            var elCenter = rect.left + rect.width / 2;
            if (Math.abs(elCenter - viewportCenter) < 200) {
              positionScore += 0.2;
            }

            // Is it isolated (not part of a dense button group)?
            var nearbyButtons = 0;
            document.querySelectorAll('button, a[href], [role="button"]').forEach(function(other) {
              if (other === el) return;
              var otherRect = other.getBoundingClientRect();
              var distance = Math.sqrt(Math.pow(rect.left - otherRect.left, 2) + Math.pow(rect.top - otherRect.top, 2));
              if (distance < 100) nearbyButtons++;
            });
            if (nearbyButtons <= 2) {
              positionScore += 0.2;
            }

            // Check structural signals
            var structureScore = 0;

            // Button element gets bonus
            if (el.tagName === 'BUTTON') structureScore += 0.1;

            // Has arrow/chevron icon
            if (el.querySelector('svg') || /[→›>▶]/.test(el.innerHTML)) {
              structureScore += 0.1;
            }

            // Short text (1-3 words) is typical for load more buttons
            var wordCount = text.split(/\\s+/).length;
            if (wordCount >= 1 && wordCount <= 4) {
              structureScore += 0.15;
            }

            // PENALTY for empty text - likely not a load more button
            if (text.length === 0) {
              structureScore -= 0.3;
            }

            // PENALTY for navigation-related classes (expander, nav, menu, etc.)
            var className = (el.className || '').toLowerCase();
            if (/nav|menu|expand|collapse|toggle|dropdown|header|footer|sidebar/.test(className)) {
              structureScore -= 0.4;
            }

            // BONUS for pagination-related keywords in text
            if (/\\b(load\\s*more|show\\s*more|view\\s*more|more\\s*products|more\\s*results|see\\s*all)\\b/i.test(text)) {
              structureScore += 0.35;
            }

            // BONUS for pagination-related class names
            if (/load-?more|show-?more|view-?more|pagination|paging/i.test(className)) {
              structureScore += 0.25;
            }

            // Total confidence
            var confidence = positionScore + structureScore;

            // Higher threshold to reduce false positives - must have pagination signals
            if (confidence >= 0.5) {
              buttons.push({
                el: el,
                text: text,
                confidence: Math.min(confidence, 0.85), // Cap at 0.85 so numbered pagination wins
                rect: rect
              });
            }
          });

          return buttons;
        }

        // Step 3: Also check for URL-based pagination links AND numbered page links
        function findPaginationLinks() {
          var links = [];

          // First, look for a pagination container with numbered links
          // Include reptile framework patterns (reptile-tilelist-paging, reptile_paging, etc.)
          var paginationContainers = document.querySelectorAll(
            '[class*="pagination"], [class*="paging"], [class*="page-nav"], ' +
            '[class*="reptile"][class*="paging"], [class*="tilelist-paging"], ' +
            '[id*="paging"], [id*="pagination"], ' +
            'nav[aria-label*="page"], nav[aria-label*="Seite"], ' +
            '[role="navigation"], [class*="paginator"], ' +
            'ul[class*="page"], ol[class*="page"]'
          );

          console.log('[findPaginationLinks] Found ' + paginationContainers.length + ' pagination containers');

          // Helper to process elements for pagination
          function processPageElement(el) {
            if (!isVisible(el)) return;
            var text = (el.textContent || '').trim();
            // Check if it's a page number (just a number like "2", "3", etc.)
            if (/^\\d+$/.test(text)) {
              var pageNum = parseInt(text, 10);
              // Page 2 is most reliable indicator of pagination
              if (pageNum === 2) {
                // Generate a more specific selector for this numbered button
                var specificSelector = generateNumberedPageSelector(el, pageNum);
                console.log('[findPaginationLinks] Found Page 2 button: ' + specificSelector);
                links.push({
                  el: el,
                  text: 'Page ' + pageNum,
                  type: 'numbered',
                  confidence: 0.98, // Highest confidence for page 2 numbered pagination
                  specificSelector: specificSelector
                });
              } else if (pageNum > 2 && pageNum <= 5) {
                var specificSelector2 = generateNumberedPageSelector(el, pageNum);
                links.push({
                  el: el,
                  text: 'Page ' + pageNum,
                  type: 'numbered',
                  confidence: 0.88,
                  specificSelector: specificSelector2
                });
              }
            }
            // Also check for "Next" or arrow buttons in pagination container
            // But SKIP "Previous" buttons!
            var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            var isPrevious = /\b(prev|previous|zurück|back)\b/.test(text.toLowerCase()) ||
                            /\b(prev|previous|back)\b/.test(ariaLabel);
            var isDisabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

            if (isPrevious || isDisabled) {
              // Skip previous or disabled buttons
            } else if (/^(next|weiter|suivant|siguiente|>|»|→)$/i.test(text) ||
                el.querySelector('[class*="next"], [class*="arrow-right"], [class*="chevron-right"]')) {
              links.push({
                el: el,
                text: text || 'Next',
                type: 'next_button',
                confidence: 0.85 // Lower than numbered for next buttons
              });
            }
          }

          paginationContainers.forEach(function(container) {
            console.log('[findPaginationLinks] Checking container: ' + (container.className || container.id || container.tagName));
            // Find links that are just numbers (page 2, 3, 4...)
            // Also check li > a patterns (common for list-based pagination)
            container.querySelectorAll('a, button, li > a, li > button').forEach(processPageElement);
          });

          // FALLBACK 1: If no containers found or no links found, search ALL buttons for page numbers
          if (links.length === 0) {
            console.log('[findPaginationLinks] No links found in containers, trying fallback search...');
            // Look for buttons/links with just a number "2" that might be page numbers
            document.querySelectorAll('button, a, li > a, li > button').forEach(function(el) {
              if (!isVisible(el)) return;
              var text = (el.textContent || '').trim();
              // Only process numbers (page numbers)
              if (/^\\d+$/.test(text)) {
                var pageNum = parseInt(text, 10);
                // Check if this looks like a pagination button (has siblings with other numbers)
                var parent = el.parentElement;
                // Go up to grandparent (for li > a patterns)
                if (parent && parent.tagName === 'LI') {
                  parent = parent.parentElement;
                }
                if (parent) {
                  var siblingNumbers = 0;
                  parent.querySelectorAll('button, a, li > a, li > button').forEach(function(sib) {
                    var sibText = (sib.textContent || '').trim();
                    if (/^\\d+$/.test(sibText)) siblingNumbers++;
                  });
                  // If there are multiple number buttons in the same parent, it's likely pagination
                  if (siblingNumbers >= 2 && pageNum === 2) {
                    var specificSelector = generateNumberedPageSelector(el, pageNum);
                    console.log('[findPaginationLinks] Fallback found Page 2: ' + specificSelector);
                    links.push({
                      el: el,
                      text: 'Page ' + pageNum,
                      type: 'numbered',
                      confidence: 0.96,
                      specificSelector: specificSelector
                    });
                  }
                }
              }
            });
          }

          // FALLBACK 2: Look for ul/ol with numbered li children (common pagination pattern)
          if (links.length === 0) {
            console.log('[findPaginationLinks] Trying ul/ol list fallback...');
            document.querySelectorAll('ul, ol').forEach(function(list) {
              var listItems = list.querySelectorAll('li');
              if (listItems.length < 3 || listItems.length > 20) return; // Reasonable pagination size

              var numberedItems = 0;
              var page2El = null;

              listItems.forEach(function(li) {
                var link = li.querySelector('a, button');
                if (!link || !isVisible(link)) return;
                var text = (link.textContent || '').trim();
                if (/^\\d+$/.test(text)) {
                  numberedItems++;
                  if (text === '2') page2El = link;
                }
              });

              // If we found at least 3 numbered items and a page 2, it's pagination
              if (numberedItems >= 3 && page2El) {
                var specificSelector = generateNumberedPageSelector(page2El, 2);
                console.log('[findPaginationLinks] ul/ol fallback found Page 2: ' + specificSelector);
                links.push({
                  el: page2El,
                  text: 'Page 2',
                  type: 'numbered',
                  confidence: 0.94,
                  specificSelector: specificSelector
                });
              }
            });
          }

          // Also check all links for page parameter in URL
          document.querySelectorAll('a[href]').forEach(function(el) {
            if (!isVisible(el) || seen.has(el)) return;

            var href = el.getAttribute('href') || '';
            var text = (el.textContent || '').trim();

            // Check for page number in URL
            var pageMatch = href.match(/[?&](page|p|pg|offset|start|skip)[=\\/](\\d+)/i);
            if (pageMatch) {
              var pageNum = parseInt(pageMatch[2], 10);
              // Look for page 2 or small offset values
              if (pageNum === 2 || (pageMatch[1].toLowerCase() === 'offset' && pageNum > 0 && pageNum <= 100)) {
                links.push({
                  el: el,
                  text: text || 'Page ' + pageNum,
                  type: 'numbered',
                  confidence: 0.9 // Higher confidence for URL-based pagination
                });
              }
            }

            // Check for path-based pagination
            var pathMatch = href.match(/\\/page[\\/-]?(\\d+)/i);
            if (pathMatch && pathMatch[1] === '2') {
              links.push({
                el: el,
                text: text || 'Page 2',
                type: 'numbered',
                confidence: 0.9
              });
            }
          });

          return links;
        }

        // Step 4: Find elements with arrow icons (next buttons)
        function findArrowButtons() {
          var arrows = [];

          document.querySelectorAll('button, a, [role="button"]').forEach(function(el) {
            if (!isVisible(el) || seen.has(el)) return;

            var text = (el.textContent || '').trim().toLowerCase();
            var html = el.innerHTML;
            var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            var className = (el.className || '').toLowerCase();

            // SKIP "Previous" buttons - they go backwards, not forwards!
            var isPrevious = /\b(prev|previous|zurück|précédent|anterior|vorige|indietro)\b/.test(text) ||
                            /\b(prev|previous|zurück|back)\b/.test(ariaLabel) ||
                            /\b(prev|previous)\b/.test(className) ||
                            // Check for left-pointing arrows (previous direction)
                            /[←‹«<◀⏮]/.test(html);

            if (isPrevious) {
              console.log('[findArrowButtons] Skipping previous button:', text || ariaLabel || '[arrow]');
              return;
            }

            // Skip disabled buttons
            if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
              console.log('[findArrowButtons] Skipping disabled button:', text || '[arrow]');
              return;
            }

            // Check for arrow symbols or SVG icons (right-pointing = next)
            var hasNextArrow = /[→›»>▶⏭]/.test(html) ||
                              el.querySelector('svg[class*="arrow"], svg[class*="chevron"], svg[class*="next"], [class*="icon-arrow"], [class*="icon-next"]');

            // Also check for explicit "next" indicators
            var isNextButton = /\b(next|weiter|suivant|siguiente|nächste|prossimo|volgende)\b/.test(text) ||
                              /\b(next|forward)\b/.test(ariaLabel) ||
                              /\b(next)\b/.test(className);

            if ((hasNextArrow || isNextButton) && text.length < 20) {
              var rect = el.getBoundingClientRect();
              // Skip header/nav arrows
              if (rect.top < 150) return;

              // Boost confidence for explicit "next" text
              var conf = isNextButton ? 0.80 : 0.65;

              arrows.push({
                el: el,
                text: text || '[arrow]',
                type: 'next_button',
                confidence: conf
              });
            }
          });

          return arrows;
        }

        // Step 5: Find the single prominent button after products (load more pattern)
        function findLoadMoreButton(productContainer) {
          if (!productContainer) return null;

          var containerRect = productContainer.getBoundingClientRect();

          // Helper to check if button looks like pagination (not load more)
          function isPaginationButton(el) {
            var text = (el.textContent || '').trim();
            var className = (el.className || '').toLowerCase();

            // Skip if it's a page number
            if (/^\\d+$/.test(text)) return true;

            // Skip if it's an arrow (single char or with whitespace)
            if (/^[<>»«→←›‹▶▷►]$/.test(text)) return true;
            // Also check if text is very short and mostly arrow-like
            if (text.length <= 3 && /[<>»«→←›‹▶▷►]/.test(text)) return true;

            // Skip if has paging class
            if (/paging|pagina|page-nav/.test(className)) return true;

            // Skip if has next/prev/forward/back class patterns
            if (/\\b(next|prev|forward|back|arrow)\\b/.test(className)) return true;

            // Check aria-label for pagination patterns
            var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            if (/next|prev|page|seite|nächste|vorherige|suivant|précédent/.test(ariaLabel)) return true;

            // Check if contains arrow SVG/icon
            if (el.querySelector('svg[class*="arrow"], svg[class*="chevron"], [class*="icon-arrow"], [class*="icon-next"], [class*="icon-chevron"]')) return true;

            // Check parent for pagination indicators
            var parent = el.parentElement;
            if (parent) {
              var parentClass = (parent.className || '').toLowerCase();
              if (/paging|pagina|page-nav/.test(parentClass)) return true;
              // Check grandparent too
              var grandparent = parent.parentElement;
              if (grandparent) {
                var gpClass = (grandparent.className || '').toLowerCase();
                if (/paging|pagina|page-nav/.test(gpClass)) return true;
              }
            }

            return false;
          }

          // Look for a single button element after the product grid
          var candidateButtons = [];

          // Helper to check if a button is disabled or a "previous" button
          function isDisabledOrPrevious(el) {
            if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return true;
            var text = (el.textContent || '').trim().toLowerCase();
            var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            if (/\\b(prev|previous|zurück|back)\\b/.test(text) || /\\b(prev|previous|back)\\b/.test(ariaLabel)) return true;
            return false;
          }

          // Check siblings of product container
          var sibling = productContainer.nextElementSibling;
          while (sibling) {
            var buttons = sibling.querySelectorAll('button, [role="button"]');
            if (buttons.length === 1 && isVisible(buttons[0]) && !isPaginationButton(buttons[0]) && !isDisabledOrPrevious(buttons[0])) {
              var text = (buttons[0].textContent || '').replace(/\\s+/g, ' ').trim();
              if (text.length > 0 && text.length < 30) {
                candidateButtons.push({
                  el: buttons[0],
                  text: text,
                  confidence: 0.9
                });
              }
            }
            // Also check if sibling itself is a button
            if ((sibling.tagName === 'BUTTON' || sibling.getAttribute('role') === 'button') && isVisible(sibling) && !isPaginationButton(sibling) && !isDisabledOrPrevious(sibling)) {
              var sibText = (sibling.textContent || '').replace(/\\s+/g, ' ').trim();
              if (sibText.length > 0 && sibText.length < 30) {
                candidateButtons.push({
                  el: sibling,
                  text: sibText,
                  confidence: 0.9
                });
              }
            }
            sibling = sibling.nextElementSibling;
          }

          // Also look inside the container for a button at the end
          var allButtons = productContainer.querySelectorAll('button, [role="button"]');
          if (allButtons.length > 0) {
            var lastButton = allButtons[allButtons.length - 1];
            if (isVisible(lastButton) && !isPaginationButton(lastButton) && !isDisabledOrPrevious(lastButton)) {
              var rect = lastButton.getBoundingClientRect();
              // Is it near the bottom of the container?
              if (rect.top > containerRect.bottom - 200) {
                var btnText = (lastButton.textContent || '').replace(/\\s+/g, ' ').trim();
                if (btnText.length > 0 && btnText.length < 30) {
                  candidateButtons.push({
                    el: lastButton,
                    text: btnText,
                    confidence: 0.85
                  });
                }
              }
            }
          }

          return candidateButtons;
        }

        // ============================================================================
        // RUN DETECTION
        // ============================================================================

        var productContainer = findProductContainer();

        // Method 1: Find load more buttons after product grid
        var loadMoreButtons = findLoadMoreButton(productContainer);
        if (loadMoreButtons) {
          loadMoreButtons.forEach(function(btn) {
            if (!seen.has(btn.el)) {
              seen.add(btn.el);
              results.push({
                selector: generateSelector(btn.el),
                type: 'load_more',
                text: btn.text,
                confidence: btn.confidence,
                boundingBox: getBoundingBox(btn.el),
                attributes: { className: btn.el.className || undefined }
              });
            }
          });
        }

        // Method 2: Find buttons positioned after products
        var postGridButtons = findPostGridButtons(productContainer);
        postGridButtons.forEach(function(btn) {
          if (!seen.has(btn.el)) {
            seen.add(btn.el);
            results.push({
              selector: generateSelector(btn.el),
              type: 'load_more',
              text: btn.text,
              confidence: btn.confidence,
              boundingBox: getBoundingBox(btn.el),
              attributes: { className: btn.el.className || undefined }
            });
          }
        });

        // Method 3: Find pagination links with page numbers in URL
        var paginationLinks = findPaginationLinks();
        paginationLinks.forEach(function(link) {
          if (!seen.has(link.el)) {
            seen.add(link.el);
            // Use specificSelector if available (more unique for numbered buttons)
            var selector = link.specificSelector || generateSelector(link.el);
            results.push({
              selector: selector,
              type: link.type,
              text: link.text,
              confidence: link.confidence,
              boundingBox: getBoundingBox(link.el),
              attributes: { href: link.el.getAttribute('href') || undefined, className: link.el.className || undefined }
            });
          }
        });

        // Method 4: Find arrow/next buttons
        var arrowButtons = findArrowButtons();
        arrowButtons.forEach(function(btn) {
          if (!seen.has(btn.el)) {
            seen.add(btn.el);
            results.push({
              selector: generateSelector(btn.el),
              type: btn.type,
              text: btn.text,
              confidence: btn.confidence,
              boundingBox: getBoundingBox(btn.el),
              attributes: { className: btn.el.className || undefined }
            });
          }
        });

        // Sort by confidence and deduplicate
        results.sort(function(a, b) { return b.confidence - a.confidence; });
        var uniqueResults = [];
        var seenSelectors = new Set();
        for (var i = 0; i < results.length; i++) {
          if (!seenSelectors.has(results[i].selector)) {
            seenSelectors.add(results[i].selector);
            uniqueResults.push(results[i]);
          }
        }
        return uniqueResults.slice(0, 10);
      })()
    `;

    const candidates = await this.page.evaluate(detectScript) as PaginationCandidate[];
    return candidates;
  }

  /**
   * Analyze URL pattern between two URLs
   */
  detectUrlPattern(baseUrl: string, page2Url: string): string | null {
    try {
      const url1 = new URL(baseUrl);
      const url2 = new URL(page2Url);

      const params1 = new URLSearchParams(url1.search);
      const params2 = new URLSearchParams(url2.search);

      let detectedPattern: string | null = null;
      const hash2 = url2.hash || '';

      // Check query parameters for page number
      for (const [key, value] of params2.entries()) {
        const val1 = params1.get(key);
        if (value === '2' && (val1 === '1' || val1 === null || val1 === '')) {
          detectedPattern = `?${key}={page}${hash2}`;
          break;
        }
        // Check for offset-style pagination
        const num2 = parseInt(value);
        const num1 = parseInt(val1 || '0');
        if (!isNaN(num2) && !isNaN(num1) && num2 > num1 && num1 >= 0) {
          detectedPattern = `?${key}={page}${hash2}`;
          break;
        }
      }

      // Check path-based pagination
      if (!detectedPattern) {
        const path1 = url1.pathname;
        const path2 = url2.pathname;

        const pageMatch = path2.match(/\/page[/\-_]?(\d+)/i);
        if (pageMatch && pageMatch[1] === '2') {
          const separator = path2.match(/\/page([/\-_]?)\d+/i)?.[1] || '/';
          detectedPattern = `/page${separator}{page}${hash2}`;
        }

        if (!detectedPattern) {
          const endMatch2 = path2.match(/\/(\d+)\/?$/);
          const endMatch1 = path1.match(/\/(\d+)\/?$/);
          if (endMatch2 && endMatch2[1] === '2') {
            if (!endMatch1 || endMatch1[1] === '1') {
              detectedPattern = `/{page}${hash2}`;
            }
          }
        }
      }

      return detectedPattern;
    } catch {
      return null;
    }
  }

  /**
   * Test if a selector works as pagination (element exists and is clickable)
   */
  async testPaginationSelector(selector: string): Promise<boolean> {
    return this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;

      // Check if disabled
      if (el.hasAttribute('disabled')) return false;
      if (el.classList.contains('disabled')) return false;
      if (el.getAttribute('aria-disabled') === 'true') return false;

      // Check if visible
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;

      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }, selector);
  }

  /**
   * Highlight a pagination candidate on the page
   */
  async highlightCandidate(selector: string): Promise<void> {
    await this.page.evaluate((sel) => {
      // Remove previous highlights
      document.querySelectorAll('[data-pagination-highlight]').forEach((el) => {
        (el as HTMLElement).style.outline = '';
        el.removeAttribute('data-pagination-highlight');
      });

      // Add new highlight
      const el = document.querySelector(sel);
      if (el) {
        (el as HTMLElement).style.outline = '3px solid #22c55e';
        el.setAttribute('data-pagination-highlight', 'true');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, selector);
  }

  /**
   * Clear pagination highlights
   */
  async clearHighlights(): Promise<void> {
    await this.page.evaluate(() => {
      document.querySelectorAll('[data-pagination-highlight]').forEach((el) => {
        (el as HTMLElement).style.outline = '';
        el.removeAttribute('data-pagination-highlight');
      });
    });
  }

  /**
   * Calculate offset pattern by comparing two URLs
   * Finds the parameter that changed and calculates the increment
   */
  calculateOffsetPattern(url1: string, url2: string): { key: string; start: number; increment: number; type: 'offset' | 'page' } | null {
    try {
      const parsed1 = new URL(url1);
      const parsed2 = new URL(url2);

      const params1 = new URLSearchParams(parsed1.search);
      const params2 = new URLSearchParams(parsed2.search);

      // Find parameter that changed numerically
      for (const [key, val2] of params2.entries()) {
        const val1 = params1.get(key);
        const num1 = parseInt(val1 || '0', 10);
        const num2 = parseInt(val2, 10);

        if (!isNaN(num1) && !isNaN(num2) && num1 !== num2) {
          const increment = num2 - num1;

          // Determine if it's page-style (1, 2, 3) or offset-style (0, 24, 48)
          const isPageStyle = (num1 === 1 && num2 === 2) ||
                              (num1 === 0 && num2 === 1) ||
                              (Math.abs(increment) === 1);

          console.log(`[PaginationDetector] Found offset pattern: ${key}=${num1} → ${key}=${num2} (increment: ${increment}, type: ${isPageStyle ? 'page' : 'offset'})`);

          return {
            key,
            start: num1,
            increment: Math.abs(increment),
            type: isPageStyle ? 'page' : 'offset'
          };
        }
      }

      // Also check path-based pagination (/page/1 → /page/2)
      const path1 = parsed1.pathname;
      const path2 = parsed2.pathname;

      const pageMatch1 = path1.match(/\/page[\/\-_]?(\d+)/i);
      const pageMatch2 = path2.match(/\/page[\/\-_]?(\d+)/i);

      if (pageMatch1 && pageMatch2) {
        const num1 = parseInt(pageMatch1[1], 10);
        const num2 = parseInt(pageMatch2[1], 10);
        if (num1 !== num2) {
          console.log(`[PaginationDetector] Found path-based pagination: /page/${num1} → /page/${num2}`);
          return {
            key: 'page',
            start: num1,
            increment: Math.abs(num2 - num1),
            type: 'page'
          };
        }
      }

      return null;
    } catch (error) {
      console.log(`[PaginationDetector] Error calculating offset pattern:`, error);
      return null;
    }
  }

  /**
   * Detect offset pattern by clicking next page button and observing URL change
   * This is more reliable than static URL comparison
   */
  async detectOffsetPattern(): Promise<{ key: string; start: number; increment: number; type: 'offset' | 'page'; selector: string } | null> {
    console.log('[PaginationDetector] Detecting offset pattern by navigation...');

    // Find pagination candidates
    const candidates = await this.detectCandidates();
    const nextCandidate = candidates.find(c =>
      c.type === 'next_button' || c.type === 'numbered'
    );

    if (!nextCandidate) {
      console.log('[PaginationDetector] No pagination candidate found for offset detection');
      return null;
    }

    // Record current URL (page 1)
    const url1 = this.page.url();
    console.log(`[PaginationDetector] Current URL (page 1): ${url1}`);

    try {
      // Click pagination and wait for navigation
      const element = await this.page.$(nextCandidate.selector);
      if (!element) {
        console.log('[PaginationDetector] Pagination element not found');
        return null;
      }

      await element.click();

      // Wait for navigation or content load
      await Promise.race([
        this.page.waitForNavigation({ timeout: 5000 }).catch(() => {}),
        this.page.waitForTimeout(3000),
      ]);
      await this.page.waitForTimeout(500);

      // Record new URL (page 2)
      const url2 = this.page.url();
      console.log(`[PaginationDetector] New URL (page 2): ${url2}`);

      // Calculate offset pattern from URL difference
      const pattern = this.calculateOffsetPattern(url1, url2);

      // Go back to original page
      await this.page.goBack();
      await this.page.waitForTimeout(500);

      if (pattern) {
        return {
          ...pattern,
          selector: nextCandidate.selector
        };
      }

      return null;
    } catch (error) {
      console.log('[PaginationDetector] Error detecting offset pattern:', error);
      // Try to go back to original page
      try {
        await this.page.goto(url1, { waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch {}
      return null;
    }
  }

  /**
   * Get unique product identifiers (URLs or titles) to track new products loading
   * This is more reliable than counting elements for virtual scroll / lazy load detection
   */
  private async getProductIdentifiers(itemSelector?: string): Promise<Set<string>> {
    const identifiers = await this.page.evaluate((sel) => {
      const ids: string[] = [];

      // Find product elements
      let elements: NodeListOf<Element>;
      if (sel) {
        elements = document.querySelectorAll(sel);
      } else {
        // Try common selectors - ordered by specificity
        const selectors = [
          // IKEA specific
          '[class*="plp-fragment-wrapper"]',
          '[class*="plp-product"]',
          // Generic data attributes
          '[data-channel^="tile"]',
          '[data-product-id]',
          '[data-product]',
          '[data-sku]',
          '[data-item-id]',
          // Class-based patterns
          '[class*="product-tile"]',
          '[class*="product-card"]',
          '[class*="product-item"]',
          '[class*="productTile"]',
          '[class*="productCard"]',
          // Semantic elements
          'article.product',
          'article[class*="product"]',
          '.product-grid > div',
          '.products > div',
          'article',
        ];
        elements = document.querySelectorAll('_no_match_'); // empty
        for (const s of selectors) {
          const found = document.querySelectorAll(s);
          if (found.length >= 3) {
            elements = found;
            break;
          }
        }
      }

      // Extract unique identifiers from each product
      for (const el of elements) {
        // Try to get product URL
        const link = el.querySelector('a[href]') as HTMLAnchorElement;
        if (link?.href) {
          ids.push(link.href);
          continue;
        }

        // Try data attributes
        const productId = el.getAttribute('data-product-id') ||
                         el.getAttribute('data-sku') ||
                         el.getAttribute('data-item-id') ||
                         el.getAttribute('data-channel');
        if (productId) {
          ids.push(productId);
          continue;
        }

        // Fall back to title text
        const title = el.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]');
        if (title?.textContent?.trim()) {
          ids.push(title.textContent.trim());
          continue;
        }

        // Last resort: use innerHTML hash (first 100 chars)
        ids.push(el.innerHTML.substring(0, 100));
      }

      return ids;
    }, itemSelector);

    return new Set(identifiers);
  }

  /**
   * Get item count using provided selector or auto-detect
   */
  private async getItemCount(itemSelector?: string): Promise<number> {
    if (itemSelector) {
      const count = await this.page.evaluate((sel) => document.querySelectorAll(sel).length, itemSelector);
      // If specific selector found nothing, don't return 0 - let caller handle fallback
      return count;
    }
    // Try common product/item selectors, including data-attribute patterns used by modern sites
    return this.page.evaluate(`
      (function() {
        // Modern sites use data attributes for product tiles
        var selectors = [
          // IKEA specific (high priority)
          '[class*="plp-fragment-wrapper"]',
          '[class*="plp-product"]',
          // Data attribute patterns (otto.de, modern SPAs)
          '[data-channel^="tile"]',
          '[data-product-id]',
          '[data-product]',
          '[data-item-id]',
          '[data-item]',
          '[data-sku]',
          '[data-testid*="product"]',
          '[data-testid*="tile"]',
          '[data-testid*="item"]',
          // Class-based patterns
          '[class*="product-tile"]',
          '[class*="product-card"]',
          '[class*="product-item"]',
          '[class*="productTile"]',
          '[class*="productCard"]',
          // Semantic elements
          'article[class*="product"]',
          'article[class*="tile"]',
          'article',
          // Grid children (common pattern for product grids)
          '[class*="grid"] > div',
          '[class*="list"] > div',
        ];

        var bestCount = 0;
        var bestSelector = '';

        for (var i = 0; i < selectors.length; i++) {
          try {
            var elements = document.querySelectorAll(selectors[i]);
            var count = elements.length;

            // Prefer selectors that find a reasonable number of items (5-100 is typical for product pages)
            if (count >= 5 && count <= 200) {
              // Verify these look like product cards (have images or prices)
              var hasProductFeatures = 0;
              for (var j = 0; j < Math.min(count, 5); j++) {
                var el = elements[j];
                if (el.querySelector('img') || el.querySelector('[class*="price"]') || el.querySelector('[data-price]')) {
                  hasProductFeatures++;
                }
              }

              if (hasProductFeatures >= 2) {
                // This selector finds product-like elements
                console.log('[getItemCount] Found ' + count + ' items with selector: ' + selectors[i]);
                return count;
              }

              // Even without product features, track the best count
              if (count > bestCount) {
                bestCount = count;
                bestSelector = selectors[i];
              }
            }
          } catch (e) {
            // Selector syntax error, skip
          }
        }

        // Return best match even if it doesn't have product features
        if (bestCount > 0) {
          console.log('[getItemCount] Best match: ' + bestCount + ' items with selector: ' + bestSelector);
        }
        return bestCount;
      })()
    `);
  }

  /**
   * Test infinite scroll - scrolls SLOWLY to detect where new items load
   * First scrolls to find initial products (some pages lazy-load even the first batch),
   * then continues scrolling to detect where more items load.
   */
  async testInfiniteScroll(itemSelector?: string): Promise<{
    hasInfiniteScroll: boolean;
    initialCount: number;
    finalCount: number;
    scrollPositions: number[]; // Y positions where new items loaded
    scrollIterations: number;
  }> {
    // Scroll config
    const scrollStep = 400; // pixels per step
    const scrollDelay = 600; // ms between steps (allow time for lazy load)
    const maxScrollY = 100000; // max scroll distance (100k pixels - very long pages)
    const noChangeLimit = 10; // stop after this many steps with no new items

    // First, check if we have any items at the top
    let initialCount = await this.getItemCount(itemSelector);
    console.log(`[PaginationDetector] Items at page top: ${initialCount} (selector: ${itemSelector || 'auto-detect'})`);

    // If specific selector found nothing, try auto-detect
    if (initialCount === 0 && itemSelector) {
      const autoCount = await this.getItemCount(undefined);
      console.log(`[PaginationDetector] Auto-detect found: ${autoCount} items`);
      if (autoCount > 0) {
        initialCount = autoCount;
        // Don't use the specific selector since it's not finding items
        itemSelector = undefined;
      }
    }

    // Find the actual selector being used for item detection
    const effectiveSelector = itemSelector || await this.page.evaluate(`
      (function() {
        var selectors = [
          '[data-channel^="tile"]',
          '[data-product-id]',
          '[data-product]',
          '[class*="product-tile"]',
          '[class*="product-card"]',
          '[class*="product-item"]',
          '[class*="product"]',
          'article',
        ];
        for (var i = 0; i < selectors.length; i++) {
          var count = document.querySelectorAll(selectors[i]).length;
          if (count >= 5) return selectors[i];
        }
        return null;
      })()
    `) as string | null;

    let currentScrollY = 0;
    let scrollIterations = 0;
    const scrollPositions: number[] = [];

    // If no items found at top, scroll down to find where items first appear
    if (initialCount === 0) {
      console.log('[PaginationDetector] No items at top, scrolling to find initial products...');

      // Scroll down until we find items (or give up after 10 attempts)
      for (let i = 0; i < 10; i++) {
        currentScrollY += scrollStep;
        await this.page.evaluate((y) => {
          window.scrollTo({ top: y, behavior: 'smooth' });
        }, currentScrollY);
        await this.page.waitForTimeout(scrollDelay);
        scrollIterations++;

        initialCount = await this.getItemCount(itemSelector);
        if (initialCount > 0) {
          const actualScrollY = await this.page.evaluate('window.scrollY') as number;
          scrollPositions.push(actualScrollY);
          console.log(`[PaginationDetector] Found ${initialCount} items at Y=${actualScrollY}`);
          break;
        }
      }

      // If still no items, give up
      if (initialCount === 0) {
        console.log('[PaginationDetector] No items found after scrolling, giving up');
        await this.page.evaluate('window.scrollTo(0, 0)');
        return { hasInfiniteScroll: false, initialCount: 0, finalCount: 0, scrollPositions: [], scrollIterations };
      }
    } else {
      // Items found at top - scroll down to the LAST visible product
      // This ensures we start scrolling from where products end, not from page top
      console.log(`[PaginationDetector] Found ${initialCount} items, scrolling to last product...`);

      if (effectiveSelector) {
        // Scroll to the last product element
        const lastProductY = await this.page.evaluate((selector) => {
          const items = document.querySelectorAll(selector);
          if (items.length === 0) return 0;
          const lastItem = items[items.length - 1];
          const rect = lastItem.getBoundingClientRect();
          return window.scrollY + rect.bottom;
        }, effectiveSelector);

        if (lastProductY > 0) {
          currentScrollY = lastProductY;
          await this.page.evaluate((y) => {
            window.scrollTo({ top: y, behavior: 'smooth' });
          }, currentScrollY);
          await this.page.waitForTimeout(scrollDelay);
          console.log(`[PaginationDetector] Scrolled to last product at Y=${currentScrollY}`);
        }
      }
    }

    console.log(`[PaginationDetector] Testing infinite scroll from ${initialCount} initial items, starting at Y=${currentScrollY}`);

    // Track unique products by their identifiers (URLs/titles) instead of just counting elements
    // This handles virtual scroll where element count stays same but products change
    let seenProducts = await this.getProductIdentifiers(itemSelector);
    let totalUniqueProducts = seenProducts.size;
    console.log(`[PaginationDetector] Initial unique products: ${totalUniqueProducts}`);

    let currentCount = initialCount;
    let noChangeCount = 0;

    // Get total document height to track progress
    let documentHeight = await this.page.evaluate(() => document.documentElement.scrollHeight) as number;
    console.log(`[PaginationDetector] Document height: ${documentHeight}px, starting from Y=${currentScrollY}`);

    // Continue scrolling to find more items
    let scrollLoopCount = 0;
    while (currentScrollY < maxScrollY && noChangeCount < noChangeLimit) {
      scrollLoopCount++;
      // Scroll down slowly
      currentScrollY += scrollStep;
      await this.page.evaluate((y) => {
        window.scrollTo({ top: y, behavior: 'smooth' });
      }, currentScrollY);

      // Log progress every 5 iterations
      if (scrollLoopCount % 5 === 0) {
        console.log(`[PaginationDetector] Scroll loop ${scrollLoopCount}: Y=${currentScrollY}, noChangeCount=${noChangeCount}/${noChangeLimit}`);
      }

      // Wait for scroll animation and content to load
      await this.page.waitForTimeout(scrollDelay);
      scrollIterations++;

      // Trigger lazy load events that some sites require
      await this.page.evaluate(() => {
        // Fire scroll event on window and document
        window.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(new Event('scroll'));

        // Fire resize event (some lazy loaders check this)
        window.dispatchEvent(new Event('resize'));

        // Trigger custom scroll events that SPAs sometimes use
        try {
          const scrollContainer = document.querySelector('[class*="scroll"]') || document.documentElement;
          scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
        } catch (e) {}

        // For intersection observer-based lazy loaders, we need to make sure
        // elements below the fold are considered "intersecting"
        // Force a reflow
        void document.body.offsetHeight;

        // Some sites use a sentinel element at the bottom to trigger loading
        const sentinels = document.querySelectorAll('[class*="sentinel"], [class*="loader"], [class*="loading"], [class*="spinner"]');
        sentinels.forEach(s => {
          try {
            s.scrollIntoView();
          } catch (e) {}
        });
      });
      await this.page.waitForTimeout(300);

      // Check for and click any "load more" button that may have appeared
      const loadMoreClicked = await this.page.evaluate(() => {
        const loadMorePatterns = [
          'button[class*="load-more"]',
          'button[class*="loadmore"]',
          'button[class*="mehr"]', // German: "more"
          'button[class*="show-more"]',
          'button[class*="see-more"]',
          'a[class*="load-more"]',
          'a[class*="mehr"]',
          '[class*="load-more"]',
          '[data-load-more]',
          // German text patterns (for otto.de etc)
          'button:not([disabled])',
        ];

        for (const pattern of loadMorePatterns) {
          try {
            const elements = document.querySelectorAll(pattern);
            for (const el of elements) {
              const text = (el.textContent || '').toLowerCase();
              const isLoadMore =
                text.includes('mehr') || // German
                text.includes('more') ||
                text.includes('laden') || // German: "load"
                text.includes('load') ||
                text.includes('weitere'); // German: "further/more"

              if (isLoadMore && el instanceof HTMLElement) {
                const style = getComputedStyle(el);
                if (style.display !== 'none' && style.visibility !== 'hidden') {
                  const rect = el.getBoundingClientRect();
                  // Check if visible in viewport
                  if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0) {
                    console.log('[PaginationDetector] Clicking load more button:', el.textContent?.trim());
                    (el as HTMLElement).click();
                    return true;
                  }
                }
              }
            }
          } catch (e) {}
        }
        return false;
      });

      if (loadMoreClicked) {
        // Wait for new content to load after clicking
        await this.page.waitForTimeout(1500);
      }

      // Check if new items loaded - use product identifiers for accurate tracking
      const newCount = await this.getItemCount(itemSelector);
      const currentProducts = await this.getProductIdentifiers(itemSelector);

      // Find NEW products we haven't seen before
      let newProductCount = 0;
      for (const id of currentProducts) {
        if (!seenProducts.has(id)) {
          seenProducts.add(id);
          newProductCount++;
        }
      }

      // Also check if document height increased (indicates new content loaded even if item count same)
      const newDocumentHeight = await this.page.evaluate(() => document.documentElement.scrollHeight) as number;
      const heightIncreased = newDocumentHeight > documentHeight + 100; // 100px threshold

      if (newProductCount > 0) {
        // Found genuinely NEW products (by URL/title)
        const actualScrollY = await this.page.evaluate('window.scrollY') as number;
        scrollPositions.push(actualScrollY);
        totalUniqueProducts = seenProducts.size;
        console.log(`[PaginationDetector] Scroll Y=${actualScrollY}: +${newProductCount} NEW products (total unique: ${totalUniqueProducts}, elements: ${newCount})`);
        currentCount = newCount;
        noChangeCount = 0; // Reset counter when we find items
        documentHeight = newDocumentHeight;
      } else if (newCount > currentCount) {
        // Element count increased (fallback)
        const actualScrollY = await this.page.evaluate('window.scrollY') as number;
        scrollPositions.push(actualScrollY);
        console.log(`[PaginationDetector] Scroll Y=${actualScrollY}: ${currentCount} -> ${newCount} elements (+${newCount - currentCount})`);
        currentCount = newCount;
        noChangeCount = 0;
        documentHeight = newDocumentHeight;
      } else if (heightIncreased) {
        // Document grew but no new products detected with current selector
        // This likely means the selector is too specific - try auto-detecting products again
        const actualScrollY = await this.page.evaluate('window.scrollY') as number;

        // Try to find products with a broader auto-detect (ignore the specific selector)
        const autoDetectedProducts = await this.getProductIdentifiers(undefined);
        let autoNewProducts = 0;
        for (const id of autoDetectedProducts) {
          if (!seenProducts.has(id)) {
            seenProducts.add(id);
            autoNewProducts++;
          }
        }

        if (autoNewProducts > 0) {
          scrollPositions.push(actualScrollY);
          totalUniqueProducts = seenProducts.size;
          console.log(`[PaginationDetector] Scroll Y=${actualScrollY}: height grew ${documentHeight} -> ${newDocumentHeight}, found +${autoNewProducts} NEW products via auto-detect (total: ${totalUniqueProducts})`);
          noChangeCount = 0;
        } else {
          console.log(`[PaginationDetector] Scroll Y=${actualScrollY}: document height grew ${documentHeight} -> ${newDocumentHeight} (no new products yet)`);
          noChangeCount = 0; // Don't give up yet, content is loading
        }
        documentHeight = newDocumentHeight;
      } else {
        noChangeCount++;
      }

      // Check if we've reached the bottom of the actual document
      const scrollInfo = await this.page.evaluate(() => ({
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      }));

      const atBottom = scrollInfo.scrollY + scrollInfo.innerHeight >= scrollInfo.scrollHeight - 100;

      if (atBottom) {
        // At bottom - wait a bit longer for potential lazy load
        await this.page.waitForTimeout(1000);
        const finalCount = await this.getItemCount(itemSelector);
        if (finalCount === currentCount) {
          noChangeCount++;
          if (noChangeCount >= 3) {
            console.log(`[PaginationDetector] Reached bottom of page at Y=${scrollInfo.scrollY}, height=${scrollInfo.scrollHeight}`);
            break;
          }
        } else {
          // New items loaded at bottom
          const actualScrollY = await this.page.evaluate('window.scrollY') as number;
          scrollPositions.push(actualScrollY);
          console.log(`[PaginationDetector] Bottom load Y=${actualScrollY}: ${currentCount} -> ${finalCount} items`);
          currentCount = finalCount;
          noChangeCount = 0;
          documentHeight = await this.page.evaluate(() => document.documentElement.scrollHeight) as number;
        }
      }
    }

    // Scroll back to top
    await this.page.evaluate('window.scrollTo(0, 0)');
    await this.page.waitForTimeout(500);

    // Calculate products gained - use unique products if we tracked them
    const productsGained = totalUniqueProducts - initialCount;
    console.log(`[PaginationDetector] Scroll test complete: ${initialCount} -> ${totalUniqueProducts} unique products (+${productsGained}), ${scrollPositions.length} load points`);

    return {
      hasInfiniteScroll: scrollPositions.length > 0,
      initialCount,
      finalCount: totalUniqueProducts, // Use unique product count, not element count
      scrollPositions,
      scrollIterations,
    };
  }

  /**
   * Test clicking a pagination button and count products loaded
   * Returns success if URL changed (navigation) or item count changed
   * Also detects offset pattern from URL change
   */
  async testPaginationClick(selector: string, itemSelector?: string): Promise<{
    success: boolean;
    initialCount: number;
    finalCount: number;
    newUrl?: string;
    urlChanged: boolean;
    newProductsFound: number;
    offsetPattern?: OffsetPattern; // Added: detected offset pattern
    error?: string;
  }> {
    const initialCount = await this.getItemCount(itemSelector);
    const initialProducts = await this.getProductIdentifiers(itemSelector);
    const initialUrl = this.page.url();
    const initialHeight = await this.page.evaluate(() => document.documentElement.scrollHeight) as number;

    console.log(`[PaginationDetector] Testing pagination click: ${selector} (${initialProducts.size} unique products)`);

    try {
      // Click the pagination element
      console.log(`[PaginationDetector] Looking for element with selector: ${selector}`);
      const element = await this.page.$(selector);
      if (!element) {
        console.log(`[PaginationDetector] ERROR: Element not found with selector: ${selector}`);
        return { success: false, initialCount, finalCount: initialCount, urlChanged: false, newProductsFound: 0, error: 'Element not found' };
      }
      console.log(`[PaginationDetector] Element found, getting info...`);

      // Get element info for debugging
      const elementInfo = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tagName: el.tagName,
          text: (el.textContent || '').trim().substring(0, 50),
          href: el.getAttribute('href'),
          className: el.className,
          isVisible: rect.width > 0 && rect.height > 0,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        };
      }, selector);
      console.log(`[PaginationDetector] Element info:`, JSON.stringify(elementInfo));

      // Scroll element into view - use JavaScript scrollIntoView for reliability
      await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, selector);
      await this.page.waitForTimeout(1000);

      // Get element position to verify it's in viewport
      const box = await element.boundingBox();
      const viewportSize = this.page.viewportSize();
      if (box && viewportSize) {
        const inViewport = box.y >= 0 && box.y + box.height <= viewportSize.height;
        console.log(`[PaginationDetector] Button position: x=${box.x}, y=${box.y}, size=${box.width}x${box.height}, inViewport=${inViewport}`);
      }

      // Wait for any animations/transitions
      await this.page.waitForTimeout(500);

      // Try multiple click strategies for better compatibility
      let clickSucceeded = false;

      // Strategy 1: Use Playwright locator (more reliable for modern SPAs)
      try {
        const locator = this.page.locator(selector);
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ timeout: 5000 });
        clickSucceeded = true;
        console.log(`[PaginationDetector] Locator click succeeded`);
      } catch (e) {
        console.log(`[PaginationDetector] Locator click failed: ${e}`);
      }

      // Strategy 2: Force click if normal click failed
      if (!clickSucceeded) {
        try {
          await element.click({ force: true, timeout: 3000 });
          clickSucceeded = true;
          console.log(`[PaginationDetector] Force click succeeded`);
        } catch (e) {
          console.log(`[PaginationDetector] Force click failed: ${e}`);
        }
      }

      // Strategy 3: JavaScript click with proper event simulation
      if (!clickSucceeded) {
        console.log(`[PaginationDetector] Trying JS click with full event simulation`);
        await this.page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (el) {
            // Make sure it's in view
            el.scrollIntoView({ behavior: 'instant', block: 'center' });

            // For anchor elements, we need to trigger the click properly
            if (el.tagName === 'A') {
              // Try direct click first
              el.click();
            } else {
              // For buttons, dispatch full mouse event sequence
              const rect = el.getBoundingClientRect();
              const centerX = rect.left + rect.width / 2;
              const centerY = rect.top + rect.height / 2;

              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, view: window }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, view: window }));
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY, view: window }));
            }
          }
        }, selector);
      }

      // Strategy 4: If it's an anchor with href, try navigating directly
      if (!clickSucceeded && elementInfo?.href && elementInfo.href !== '#') {
        console.log(`[PaginationDetector] Anchor has href, but we want AJAX behavior - trying pointer events`);
        try {
          // Use Playwright's mouse to click at the element's center
          if (box) {
            await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            clickSucceeded = true;
            console.log(`[PaginationDetector] Mouse click at coordinates succeeded`);
          }
        } catch (e) {
          console.log(`[PaginationDetector] Mouse click failed: ${e}`);
        }
      }

      // Wait for navigation or content to load
      await Promise.race([
        this.page.waitForNavigation({ timeout: 5000 }).catch(() => {}),
        this.page.waitForTimeout(3000),
      ]);

      // Additional wait for dynamic content (AJAX load more)
      await this.page.waitForTimeout(1500);

      // Check if page height changed (indicates content loaded without navigation)
      const newHeight = await this.page.evaluate(() => document.documentElement.scrollHeight) as number;
      const heightChanged = newHeight > initialHeight + 100;
      if (heightChanged) {
        console.log(`[PaginationDetector] Page height increased: ${initialHeight} -> ${newHeight}`);
      }

      const finalCount = await this.getItemCount(itemSelector);
      const finalProducts = await this.getProductIdentifiers(itemSelector);
      const newUrl = this.page.url();
      const urlChanged = newUrl !== initialUrl;

      // Detect offset pattern from URL change
      let offsetPattern: OffsetPattern | undefined;
      if (urlChanged) {
        const detected = this.calculateOffsetPattern(initialUrl, newUrl);
        if (detected) {
          offsetPattern = detected;
          console.log(`[PaginationDetector] Detected offset pattern: ${detected.key}=${detected.start} → ${detected.start + detected.increment} (increment: ${detected.increment}, type: ${detected.type})`);
        }
      }

      // Count how many NEW products appeared (not seen on first page)
      let newProductsFound = 0;
      for (const id of finalProducts) {
        if (!initialProducts.has(id)) {
          newProductsFound++;
        }
      }

      console.log(`[PaginationDetector] Pagination click result: ${initialProducts.size} -> ${finalProducts.size} unique products (+${newProductsFound} new), URL changed: ${urlChanged}, height changed: ${heightChanged}`);

      // For load-more buttons that don't navigate, scroll back to top
      if (!urlChanged && (newProductsFound > 0 || heightChanged)) {
        await this.page.evaluate(() => window.scrollTo(0, 0));
        await this.page.waitForTimeout(500);
      }

      // Go back to original page if URL changed
      if (urlChanged) {
        await this.page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await this.page.waitForTimeout(1000);
      }

      // Success if URL changed, new products found, or height changed significantly
      const success = urlChanged || newProductsFound > 0 || heightChanged;

      return {
        success,
        initialCount,
        finalCount,
        newUrl: urlChanged ? newUrl : undefined,
        urlChanged,
        newProductsFound,
        offsetPattern,
      };
    } catch (error) {
      console.log(`[PaginationDetector] Pagination click failed:`, error);
      // Try to go back to original page
      try {
        await this.page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch {}
      return {
        success: false,
        initialCount,
        finalCount: initialCount,
        urlChanged: false,
        newProductsFound: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Smart detection - tests both pagination and scroll, returns the best method
   * Now includes offset pattern detection for URL-based pagination
   * Supports hybrid mode where both lazy load and pagination work together
   */
  async detectBestMethod(itemSelector?: string): Promise<{
    method: 'pagination' | 'infinite_scroll' | 'hybrid' | 'none';
    pagination?: {
      selector: string;
      type: 'next_page' | 'url_pattern';
      productsLoaded: number;
      offset?: OffsetPattern; // Added: offset pattern for URL-based pagination
    };
    scroll?: {
      productsLoaded: number;
      scrollPositions: number[];
    };
    candidates: PaginationCandidate[];
  }> {
    console.log('[PaginationDetector] Starting smart detection...');

    // First, find pagination candidates
    const candidates = await this.detectCandidates();
    console.log(`[PaginationDetector] Found ${candidates.length} pagination candidates`);

    // Test infinite scroll first (it's non-destructive)
    const scrollResult = await this.testInfiniteScroll(itemSelector);
    const scrollProductsGained = scrollResult.finalCount - scrollResult.initialCount;
    console.log(`[PaginationDetector] Scroll test: gained ${scrollProductsGained} products`);

    // Test best pagination candidate if we have one
    let bestPaginationResult: {
      selector: string;
      productsGained: number;
      newProductsFound: number;
      type: string;
      urlChanged: boolean;
      offsetPattern?: OffsetPattern;
    } | null = null;

    if (candidates.length > 0) {
      // Test the top candidate (highest confidence)
      const topCandidate = candidates[0];
      console.log(`[PaginationDetector] Top candidate: "${topCandidate.text}" (confidence: ${topCandidate.confidence}, type: ${topCandidate.type}, selector: ${topCandidate.selector})`);

      // Lower threshold to 0.3 since our dynamic detection uses behavioral signals
      if (topCandidate.confidence >= 0.3) {
        console.log(`[PaginationDetector] Testing click on candidate...`);
        const clickResult = await this.testPaginationClick(topCandidate.selector, itemSelector);
        console.log(`[PaginationDetector] Click test complete: success=${clickResult.success}, error=${clickResult.error || 'none'}`);
        if (clickResult.success) {
          const productsGained = clickResult.finalCount - clickResult.initialCount;
          console.log(`[PaginationDetector] Pagination click test: gained ${productsGained} elements, ${clickResult.newProductsFound} NEW products, URL changed: ${clickResult.urlChanged}`);
          if (clickResult.offsetPattern) {
            console.log(`[PaginationDetector] Offset pattern: ${clickResult.offsetPattern.key}=${clickResult.offsetPattern.start} (increment: ${clickResult.offsetPattern.increment})`);
          }
          // If offset pattern detected, it's URL-based pagination
          // Otherwise, determine type from candidate
          const paginationType = clickResult.offsetPattern
            ? 'url_pattern'
            : (topCandidate.type === 'numbered' ? 'url_pattern' : 'next_page');

          bestPaginationResult = {
            selector: topCandidate.selector,
            productsGained,
            newProductsFound: clickResult.newProductsFound,
            type: paginationType,
            urlChanged: clickResult.urlChanged,
            offsetPattern: clickResult.offsetPattern,
          };
        }
      }
    }

    // Compare and return best method
    const paginationNewProducts = bestPaginationResult?.newProductsFound || 0;
    const paginationUrlChanged = bestPaginationResult?.urlChanged || false;

    // Pagination is valid if:
    // 1. New products found > 0 (confirmed different products on page 2), OR
    // 2. URL changed AND we found products (traditional pagination)
    const paginationIsValid = paginationNewProducts > 0 || (paginationUrlChanged && bestPaginationResult?.productsGained !== undefined);

    console.log(`[PaginationDetector] Comparing: scroll gained ${scrollProductsGained}, pagination new products ${paginationNewProducts}, URL changed: ${paginationUrlChanged}`);

    // Check for HYBRID mode: both lazy loading AND pagination work
    // This happens when:
    // 1. Both scroll and pagination found new products, OR
    // 2. Scroll works AND there's a load-more button (lazy loaded pages)
    const scrollWorks = scrollProductsGained > 0;
    const paginationWorks = paginationIsValid && (paginationNewProducts > 0 || paginationUrlChanged);
    const isLoadMoreButton = bestPaginationResult?.type === 'next_page' ||
                             (candidates[0]?.type === 'load_more');

    if (scrollWorks && paginationWorks) {
      // HYBRID: Both methods work - use both for maximum product coverage
      console.log(`[PaginationDetector] Best method: HYBRID (scroll: +${scrollProductsGained}, pagination: +${paginationNewProducts} products)`);
      return {
        method: 'hybrid',
        pagination: {
          selector: bestPaginationResult!.selector,
          type: bestPaginationResult!.type as 'next_page' | 'url_pattern',
          productsLoaded: paginationNewProducts,
          offset: bestPaginationResult!.offsetPattern,
        },
        scroll: {
          productsLoaded: scrollProductsGained,
          scrollPositions: scrollResult.scrollPositions,
        },
        candidates,
      };
    }

    // If scroll works and there's a load-more button (even if click test failed),
    // treat as hybrid - scrolling may trigger the load-more automatically
    if (scrollWorks && isLoadMoreButton && candidates.length > 0) {
      console.log(`[PaginationDetector] Best method: HYBRID (scroll: +${scrollProductsGained}, load-more button detected)`);
      return {
        method: 'hybrid',
        pagination: {
          selector: candidates[0].selector,
          type: 'next_page',
          productsLoaded: paginationNewProducts || scrollProductsGained,
          offset: bestPaginationResult?.offsetPattern,
        },
        scroll: {
          productsLoaded: scrollProductsGained,
          scrollPositions: scrollResult.scrollPositions,
        },
        candidates,
      };
    }

    // Prefer pagination if it found new products and scroll didn't work as well
    if (paginationWorks && paginationNewProducts >= scrollProductsGained) {
      console.log(`[PaginationDetector] Best method: pagination (+${paginationNewProducts} new products per page, URL changed: ${paginationUrlChanged})`);
      return {
        method: 'pagination',
        pagination: {
          selector: bestPaginationResult!.selector,
          type: bestPaginationResult!.type as 'next_page' | 'url_pattern',
          productsLoaded: paginationNewProducts,
          offset: bestPaginationResult!.offsetPattern,
        },
        candidates,
      };
    }

    // Prefer infinite scroll if it found more new products
    if (scrollProductsGained > 0) {
      console.log(`[PaginationDetector] Best method: infinite_scroll (+${scrollProductsGained} products)`);
      return {
        method: 'infinite_scroll',
        scroll: {
          productsLoaded: scrollProductsGained,
          scrollPositions: scrollResult.scrollPositions,
        },
        candidates,
      };
    }

    // URL changed but couldn't verify new products - still treat as pagination
    if (paginationUrlChanged) {
      console.log(`[PaginationDetector] Best method: pagination (URL changed, could not verify new products)`);
      return {
        method: 'pagination',
        pagination: {
          selector: bestPaginationResult!.selector,
          type: bestPaginationResult!.type as 'next_page' | 'url_pattern',
          productsLoaded: scrollResult.initialCount, // Assume same products per page
          offset: bestPaginationResult!.offsetPattern,
        },
        candidates,
      };
    }

    console.log('[PaginationDetector] No pagination method found');
    return {
      method: 'none',
      candidates,
    };
  }

  /**
   * Build a CSS selector from AI-provided button attributes
   * Tries multiple strategies and validates each one
   */
  private async buildSelectorFromAttributes(attrs: {
    text?: string;
    aria_label?: string;
    classes?: string[];
    data_attributes?: Record<string, string>;
    tag?: 'a' | 'button' | 'div' | 'span';
    rel?: string;
  }): Promise<string | null> {
    const tag = attrs.tag || 'a, button';
    const selectorsToTry: string[] = [];

    // Strategy 1: rel="next" is very reliable
    if (attrs.rel === 'next') {
      selectorsToTry.push(`a[rel="next"]`);
      selectorsToTry.push(`[rel="next"]`);
    }

    // Strategy 2: aria-label (very reliable)
    if (attrs.aria_label) {
      const label = attrs.aria_label.replace(/"/g, '\\"');
      selectorsToTry.push(`${tag}[aria-label="${label}"]`);
      selectorsToTry.push(`[aria-label="${label}"]`);
      // Also try partial match
      selectorsToTry.push(`${tag}[aria-label*="${label.split(' ')[0]}"]`);
    }

    // Strategy 3: data attributes (very reliable)
    if (attrs.data_attributes) {
      for (const [key, value] of Object.entries(attrs.data_attributes)) {
        const safeValue = value.replace(/"/g, '\\"');
        selectorsToTry.push(`${tag}[data-${key}="${safeValue}"]`);
        selectorsToTry.push(`[data-${key}="${safeValue}"]`);
      }
    }

    // Strategy 4: stable class names (filter out dynamic ones)
    if (attrs.classes && attrs.classes.length > 0) {
      const stableClasses = attrs.classes.filter(c =>
        !c.match(/^(css-|sc-|[a-z]{1,3}[0-9]+|[0-9]+)/) && c.length > 2
      );
      if (stableClasses.length > 0) {
        // Try with tag
        selectorsToTry.push(`${attrs.tag || 'a'}.${stableClasses.join('.')}`);
        selectorsToTry.push(`${attrs.tag || 'button'}.${stableClasses.join('.')}`);
        // Try just classes
        selectorsToTry.push(`.${stableClasses.join('.')}`);
        // Try individual classes
        for (const cls of stableClasses) {
          selectorsToTry.push(`${attrs.tag || 'a'}.${cls}`);
          selectorsToTry.push(`.${cls}`);
        }
      }
    }

    // Strategy 5: Text-based selectors handled separately via findButtonByText

    console.log(`[PaginationDetector] Trying ${selectorsToTry.length} selectors from attributes...`);

    // Test each selector
    for (const selector of selectorsToTry) {
      try {
        const valid = await this.testPaginationSelector(selector);
        if (valid) {
          console.log(`[PaginationDetector] Found working selector: ${selector}`);
          return selector;
        }
      } catch (e) {
        // Invalid selector syntax, skip
      }
    }

    // Strategy 6: If we have text, try to find button by text content
    // Don't pass the AI's suggested tag - it's often wrong. Search all clickable elements.
    if (attrs.text && attrs.text.trim()) {
      const textSelector = await this.findButtonByText(attrs.text.trim());
      if (textSelector) {
        console.log(`[PaginationDetector] Found button by text: ${textSelector}`);
        return textSelector;
      }
    }

    // Strategy 7: Find next page links by href pattern (page=2, p=2, offset=X, etc.)
    const hrefSelector = await this.findNextPageByHref();
    if (hrefSelector) {
      console.log(`[PaginationDetector] Found next page by href: ${hrefSelector}`);
      return hrefSelector;
    }

    console.log(`[PaginationDetector] Could not build valid selector from attributes`);
    return null;
  }

  /**
   * Find a "next page" link by looking at href patterns
   * Note: Uses string-based evaluate to avoid tsx __name decorator issues
   */
  private async findNextPageByHref(): Promise<string | null> {
    const script = `
      (function() {
        var currentParams = new URLSearchParams(window.location.search);

        // Get current page number from URL if present
        var currentPage = 1;
        var pageKeys = ['page', 'p', 'pg', 'pn'];
        for (var i = 0; i < pageKeys.length; i++) {
          var val = currentParams.get(pageKeys[i]);
          if (val && !isNaN(parseInt(val))) {
            currentPage = parseInt(val);
            break;
          }
        }

        // Also check for offset
        var currentOffset = 0;
        var offsetKeys = ['offset', 'o', 'start', 'from'];
        for (var i = 0; i < offsetKeys.length; i++) {
          var val = currentParams.get(offsetKeys[i]);
          if (val && !isNaN(parseInt(val))) {
            currentOffset = parseInt(val);
            break;
          }
        }

        // Find all links on the page
        var links = document.querySelectorAll('a[href]');
        var candidates = [];

        for (var li = 0; li < links.length; li++) {
          var link = links[li];
          var href = link.getAttribute('href') || '';
          if (!href || href === '#' || href.indexOf('javascript:') === 0) continue;

          // Check if link is visible and reasonable size for pagination
          var rect = link.getBoundingClientRect();
          var style = window.getComputedStyle(link);
          if (rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden') {
            continue;
          }
          // Skip huge elements (probably not pagination buttons)
          if (rect.width > 300 || rect.height > 150) continue;

          var score = 0;
          var isNextPage = false;

          try {
            var linkUrl = new URL(href, window.location.origin);
            var linkParams = new URLSearchParams(linkUrl.search);

            // Check for page parameter pointing to next page
            for (var pi = 0; pi < pageKeys.length; pi++) {
              var val = linkParams.get(pageKeys[pi]);
              if (val && !isNaN(parseInt(val))) {
                var pageNum = parseInt(val);
                if (pageNum === currentPage + 1) {
                  isNextPage = true;
                  score += 10;
                } else if (pageNum === 2 && currentPage === 1) {
                  isNextPage = true;
                  score += 10;
                }
              }
            }

            // Check for offset parameter
            for (var oi = 0; oi < offsetKeys.length; oi++) {
              var val = linkParams.get(offsetKeys[oi]);
              if (val && !isNaN(parseInt(val))) {
                var offset = parseInt(val);
                if (offset > currentOffset) {
                  isNextPage = true;
                  score += 8;
                }
              }
            }

            // Check path patterns like /page/2
            var pathMatch = linkUrl.pathname.match(/\\/page\\/(\\d+)/i);
            if (pathMatch) {
              var pageNum = parseInt(pathMatch[1]);
              if (pageNum === currentPage + 1 || (pageNum === 2 && currentPage === 1)) {
                isNextPage = true;
                score += 10;
              }
            }
          } catch (e) {
            // Invalid URL, skip
            continue;
          }

          if (!isNextPage) continue;

          // Bonus for pagination context - check element and parents
          var checkEl = link;
          for (var ci = 0; ci < 3 && checkEl; ci++) {
            var classStr = typeof checkEl.className === 'string' ? checkEl.className : (checkEl.className && checkEl.className.baseVal) || '';
            var classes = classStr.toLowerCase();
            var id = checkEl.id ? checkEl.id.toLowerCase() : '';
            if (classes.indexOf('paginat') >= 0 || classes.indexOf('page') >= 0 || classes.indexOf('next') >= 0 ||
                id.indexOf('paginat') >= 0 || id.indexOf('page') >= 0) {
              score += 5;
              break;
            }
            checkEl = checkEl.parentElement;
          }

          // Bonus for aria-label or title containing "next"
          var ariaLabel = link.getAttribute('aria-label');
          ariaLabel = ariaLabel ? ariaLabel.toLowerCase() : '';
          var title = link.getAttribute('title');
          title = title ? title.toLowerCase() : '';
          if (ariaLabel.indexOf('next') >= 0 || title.indexOf('next') >= 0) {
            score += 3;
          }

          // Build selector for this element
          var selector = '';
          if (link.id) {
            selector = '#' + link.id;
          } else {
            var aria = link.getAttribute('aria-label');
            if (aria) {
              selector = 'a[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]';
            } else {
              // Try data attributes
              var attrs = link.attributes;
              for (var ai = 0; ai < attrs.length; ai++) {
                var attr = attrs[ai];
                if (attr.name.indexOf('data-') === 0 && attr.value) {
                  selector = 'a[' + attr.name + '="' + attr.value.replace(/"/g, '\\\\"') + '"]';
                  break;
                }
              }
              // Try classes
              if (!selector) {
                var linkClassStr = typeof link.className === 'string' ? link.className : (link.className && link.className.baseVal) || '';
                var linkClasses = [];
                var classParts = linkClassStr.split(' ');
                for (var cpi = 0; cpi < classParts.length; cpi++) {
                  var c = classParts[cpi];
                  if (c && c.length > 2 && !c.match(/^(css-|sc-|[a-z]{1,3}[0-9]+|[0-9]+)/)) {
                    linkClasses.push(c);
                  }
                }
                if (linkClasses.length > 0) {
                  selector = 'a.' + linkClasses.slice(0, 2).join('.');
                }
              }
              // Use href pattern as last resort
              if (!selector) {
                var hrefMatch = href.match(/[?&](page|p|offset|o)=(\\d+)/);
                if (hrefMatch) {
                  selector = 'a[href*="' + hrefMatch[1] + '=' + hrefMatch[2] + '"]';
                }
              }
            }
          }

          if (selector && score > 0) {
            candidates.push({ score: score, selector: selector });
          }
        }

        // Sort by score descending
        candidates.sort(function(a, b) { return b.score - a.score; });

        // Return best candidate's selector
        if (candidates.length > 0) {
          return candidates[0].selector;
        }

        return null;
      })()
    `;

    return await this.page.evaluate(script) as string | null;
  }

  /**
   * Find a pagination button by its text content and return a working selector
   * Note: Uses evaluateHandle to pass a string function to avoid tsx __name decorator issues
   */
  private async findButtonByText(text: string, preferredTag?: string): Promise<string | null> {
    // Use string-based evaluate to avoid tsx transpiler adding __name decorators
    const searchText = text.toLowerCase().trim();
    const isShortText = searchText.length <= 3;
    // Search all common clickable elements - AI often misidentifies the tag type
    const tagsJson = JSON.stringify(preferredTag ? [preferredTag] : ['a', 'button', 'span', 'div', '[role="button"]']);

    const script = `
      (function() {
        var searchText = ${JSON.stringify(searchText)};
        var isShortText = ${isShortText};
        var tags = ${tagsJson};

        for (var ti = 0; ti < tags.length; ti++) {
          var tagSelector = tags[ti];
          var elements = document.querySelectorAll(tagSelector);
          for (var ei = 0; ei < elements.length; ei++) {
            var el = elements[ei];

            // Get direct text content
            var directText = '';
            var childNodes = el.childNodes;
            for (var ni = 0; ni < childNodes.length; ni++) {
              var n = childNodes[ni];
              if (n.nodeType === Node.TEXT_NODE) {
                directText += (n.textContent ? n.textContent.trim() : '') + ' ';
              }
            }
            directText = directText.trim().toLowerCase();
            var fullText = el.textContent ? el.textContent.toLowerCase().trim() : '';
            var ariaLabel = el.getAttribute('aria-label');
            ariaLabel = ariaLabel ? ariaLabel.toLowerCase() : '';

            // Check text match
            var textMatches = false;
            if (isShortText) {
              textMatches = directText === searchText ||
                           fullText === searchText ||
                           (fullText.length <= 5 && fullText.indexOf(searchText) >= 0) ||
                           ariaLabel.indexOf('next') >= 0 || ariaLabel.indexOf('forward') >= 0 ||
                           ariaLabel.indexOf('page') >= 0;
            } else {
              textMatches = fullText === searchText ||
                           fullText.indexOf(searchText) >= 0 ||
                           ariaLabel.indexOf(searchText) >= 0;
            }

            if (!textMatches) continue;

            // Verify visible and reasonable size
            var rect = el.getBoundingClientRect();
            var style = window.getComputedStyle(el);
            if (rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden') {
              continue;
            }

            // For short text, must look like pagination button
            if (isShortText) {
              // Size check
              if (!(rect.width > 15 && rect.width < 300 && rect.height > 15 && rect.height < 150)) continue;

              // Context check - look for pagination-related class/id on element or parents
              var hasContext = false;
              var checkEl = el;
              for (var pi = 0; pi < 3 && checkEl; pi++) {
                var classStr = typeof checkEl.className === 'string' ? checkEl.className : (checkEl.className && checkEl.className.baseVal) || '';
                var classes = classStr.toLowerCase();
                var id = checkEl.id ? checkEl.id.toLowerCase() : '';
                if (classes.indexOf('paginat') >= 0 || classes.indexOf('page') >= 0 || classes.indexOf('next') >= 0 ||
                    classes.indexOf('prev') >= 0 || classes.indexOf('nav') >= 0 || classes.indexOf('arrow') >= 0 ||
                    id.indexOf('paginat') >= 0 || id.indexOf('page') >= 0 || id.indexOf('next') >= 0) {
                  hasContext = true;
                  break;
                }
                checkEl = checkEl.parentElement;
              }
              if (!hasContext) continue;
            }

            // Find clickable element if needed
            var targetEl = el;
            if (el.tagName !== 'A' && el.tagName !== 'BUTTON') {
              var clickableChild = el.querySelector('a[href], button, [role="button"]');
              if (clickableChild) {
                targetEl = clickableChild;
              } else {
                var clickableParent = el.closest('a, button, [role="button"]');
                if (clickableParent) {
                  targetEl = clickableParent;
                }
              }
            }

            // Build selector
            var tag = targetEl.tagName.toLowerCase();

            if (targetEl.id) {
              return '#' + targetEl.id;
            }

            // Check if a parent has an ID - more specific selector
            var parentWithId = null;
            var parentCheck = targetEl.parentElement;
            for (var depth = 0; depth < 4 && parentCheck; depth++) {
              if (parentCheck.id) {
                parentWithId = parentCheck;
                break;
              }
              parentCheck = parentCheck.parentElement;
            }

            var aria = targetEl.getAttribute('aria-label');
            if (aria) {
              var ariaSelector = tag + '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]';
              return parentWithId ? '#' + parentWithId.id + ' ' + ariaSelector : ariaSelector;
            }

            // Check href pattern for links
            if (tag === 'a') {
              var href = targetEl.getAttribute('href') || '';
              var hrefMatch = href.match(/[?&](page|p|offset)=(\\d+)/);
              if (hrefMatch) {
                var hrefSelector = 'a[href*="' + hrefMatch[1] + '=' + hrefMatch[2] + '"]';
                return parentWithId ? '#' + parentWithId.id + ' ' + hrefSelector : hrefSelector;
              }
            }

            // PREFER classes before data attributes (classes are more stable)
            var elClassStr = typeof targetEl.className === 'string' ? targetEl.className : (targetEl.className && targetEl.className.baseVal) || '';
            var elClasses = [];
            var classParts = elClassStr.split(' ');
            for (var ci = 0; ci < classParts.length; ci++) {
              var c = classParts[ci];
              if (c && c.length > 2 && !c.match(/^(css-|sc-|[a-z]{1,3}[0-9]+|[0-9]+)/)) {
                elClasses.push(c);
              }
            }
            if (elClasses.length > 0) {
              var classSelector = tag + '.' + elClasses.slice(0, 3).join('.');
              return parentWithId ? '#' + parentWithId.id + ' ' + classSelector : classSelector;
            }

            // Check data attributes - but avoid JSON content (matches multiple elements)
            var attrs = targetEl.attributes;
            for (var ai = 0; ai < attrs.length; ai++) {
              var attr = attrs[ai];
              if (attr.name.indexOf('data-') === 0 && attr.value) {
                // Skip attributes with JSON content - they often match multiple elements
                if (attr.value.indexOf('{') >= 0 || attr.value.indexOf('[') >= 0) continue;
                // Skip very long values
                if (attr.value.length > 50) continue;
                return tag + '[' + attr.name + '="' + attr.value.replace(/"/g, '\\\\"') + '"]';
              }
            }

            // Last resort: nth-child
            var parent = targetEl.parentElement;
            if (parent) {
              var siblings = parent.children;
              var idx = 0;
              for (var si = 0; si < siblings.length; si++) {
                if (siblings[si] === targetEl) {
                  idx = si + 1;
                  break;
                }
              }
              var parentClassStr = typeof parent.className === 'string' ? parent.className : (parent.className && parent.className.baseVal) || '';
              var parentClassParts = parentClassStr.split(' ');
              var parentClass = '';
              for (var pci = 0; pci < parentClassParts.length; pci++) {
                var pc = parentClassParts[pci];
                if (pc && pc.length > 2 && !pc.match(/^(css-|sc-)/)) {
                  parentClass = pc;
                  break;
                }
              }
              if (parentClass) {
                return '.' + parentClass + ' > ' + tag + ':nth-child(' + idx + ')';
              }
            }
          }
        }
        return null;
      })()
    `;

    return await this.page.evaluate(script) as string | null;
  }

  /**
   * AI-enhanced pagination detection using Gemini Vision
   * Falls back to regular detection if AI fails
   */
  async detectBestMethodWithAI(itemSelector?: string): Promise<{
    method: 'pagination' | 'infinite_scroll' | 'hybrid' | 'none';
    pagination?: {
      selector: string;
      type: 'next_page' | 'url_pattern';
      productsLoaded: number;
      offset?: OffsetPattern;
    };
    scroll?: {
      productsLoaded: number;
      scrollPositions: number[];
    };
    candidates: PaginationCandidate[];
    source: 'ai' | 'ml';
  }> {
    const gemini = getGeminiService();

    if (!gemini.isEnabled) {
      console.log('[PaginationDetector] Gemini not enabled, using ML detection');
      const result = await this.detectBestMethod(itemSelector);
      return { ...result, source: 'ml' };
    }

    console.log('[PaginationDetector] Starting AI-enhanced pagination detection...');

    try {
      // Take screenshot
      const screenshotBuffer = await this.page.screenshot({ type: 'png' });
      const screenshotBase64 = screenshotBuffer.toString('base64');
      const currentUrl = this.page.url();

      // Get HTML from bottom 30% of page (where pagination usually is)
      const paginationHtml = await this.page.evaluate(() => {
        const viewportHeight = window.innerHeight;
        const scrollHeight = document.documentElement.scrollHeight;
        const bottomAreaStart = scrollHeight - viewportHeight * 0.3;

        // Find elements in bottom area
        const elements = document.querySelectorAll('*');
        let html = '';
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          const absTop = rect.top + window.scrollY;
          if (absTop >= bottomAreaStart && el.children.length === 0) {
            // Leaf elements in bottom area
            const tag = el.tagName.toLowerCase();
            // Handle both regular className (string) and SVGAnimatedString
            const classNameStr = typeof el.className === 'string' ? el.className : ((el.className as any)?.baseVal || '');
            const classes = classNameStr ? `.${classNameStr.split(' ').slice(0, 2).join('.')}` : '';
            const text = el.textContent?.trim().substring(0, 20) || '';
            html += `<${tag}${classes}>${text}</${tag}>\n`;
          }
        }
        return html.substring(0, 2000);
      });

      // Call Gemini
      const result = await gemini.detectPagination(screenshotBase64, currentUrl, paginationHtml);

      if (!result.success || !result.data) {
        console.log(`[PaginationDetector] AI detection failed: ${result.error}, falling back to ML`);
        const mlResult = await this.detectBestMethod(itemSelector);
        return { ...mlResult, source: 'ml' };
      }

      const aiResult = result.data;
      console.log(`[PaginationDetector] AI detected: method=${aiResult.method}, confidence=${aiResult.confidence} (latency: ${result.latencyMs}ms)`);
      if (aiResult.button_attributes) {
        console.log(`[PaginationDetector] AI button attributes:`, JSON.stringify(aiResult.button_attributes));
      }

      // Handle AI detection results
      if (aiResult.method === 'none' || aiResult.confidence < 0.5) {
        console.log('[PaginationDetector] AI found no pagination or low confidence, running ML detection');
        const mlResult = await this.detectBestMethod(itemSelector);
        return { ...mlResult, source: 'ml' };
      }

      // If AI detected infinite scroll, skip button validation and go to scroll testing
      if (aiResult.method === 'infinite_scroll') {
        console.log('[PaginationDetector] AI detected infinite scroll, testing scroll behavior...');
        const mlResult = await this.detectBestMethod(itemSelector);
        // Return AI source since AI correctly identified it, but use ML's scroll data
        return { ...mlResult, source: 'ai' };
      }

      // Build selector from button_attributes (new approach) or use legacy selector
      let workingSelector: string | null = null;

      if (aiResult.button_attributes) {
        workingSelector = await this.buildSelectorFromAttributes(aiResult.button_attributes);
        if (workingSelector) {
          console.log(`[PaginationDetector] Built selector from attributes: ${workingSelector}`);
        }
      }

      // Fall back to legacy selector if attributes didn't work
      if (!workingSelector && aiResult.selector) {
        let legacySelector = aiResult.selector.trim();
        console.log(`[PaginationDetector] Using legacy selector: ${legacySelector}`);

        // Reject obviously invalid selectors before even trying querySelector
        const invalidPatterns = [
          /^[<>→←»«]$/, // Just arrow characters
          /^\.{0,1}$/, // Empty or just a dot
          /^#$/, // Just a hash
          /^\s*$/, // Whitespace only
          /^[0-9]+$/, // Just numbers
        ];
        const isInvalidSelector = legacySelector.length < 2 || invalidPatterns.some(p => p.test(legacySelector));

        if (isInvalidSelector) {
          console.log(`[PaginationDetector] AI selector is invalid: "${legacySelector}", running ML detection`);
          const mlResult = await this.detectBestMethod(itemSelector);
          return { ...mlResult, source: 'ml' };
        }

        // If selector is too long, try to simplify by extracting final element
        const descendantCount = (legacySelector.match(/\s*>\s*/g) || []).length;
        if (descendantCount > 3) {
          console.log(`[PaginationDetector] AI selector too long (${descendantCount} descendants), simplifying...`);

          // Extract the last part of the selector (the actual clickable element)
          const parts = legacySelector.split(/\s*>\s*/);
          const lastPart = parts[parts.length - 1].trim();

          // If the last part has useful identifiers (class, id, attribute), use it
          if (lastPart && (lastPart.includes('.') || lastPart.includes('[') || lastPart.includes('#'))) {
            console.log(`[PaginationDetector] Simplified to: ${lastPart}`);
            legacySelector = lastPart;
          } else if (lastPart) {
            // Try combining the last two parts for more specificity
            const secondLast = parts.length > 1 ? parts[parts.length - 2].trim() : '';
            if (secondLast && (secondLast.includes('.') || secondLast.includes('[') || secondLast.includes('#'))) {
              const combined = `${secondLast} > ${lastPart}`;
              console.log(`[PaginationDetector] Simplified to: ${combined}`);
              legacySelector = combined;
            } else {
              // Last resort: just use the tag with any available identifiers
              console.log(`[PaginationDetector] Using last part: ${lastPart}`);
              legacySelector = lastPart;
            }
          }
        }

        // Check if selector ends with a non-clickable element (svg, span, img, path, etc.)
        // These selectors target children of clickable elements and need to be fixed
        const nonClickableEndings = /\s*>\s*(svg|span|img|path|i|icon|div)(\s*$|\[)/i;
        const endsWithNonClickable = nonClickableEndings.test(legacySelector);

        // Check if selector targets a non-clickable child element
        // If so, try to find the parent clickable element BEFORE testing
        let needsParentFix = endsWithNonClickable;
        if (!needsParentFix) {
          const selectorValid = await this.testPaginationSelector(legacySelector);
          needsParentFix = !selectorValid;
        }

        if (needsParentFix) {
          // Try to find parent clickable element
          const parentSelector = await this.page.evaluate((selector) => {
            try {
              const el = document.querySelector(selector);
              if (!el) return null;

              // If this is a non-clickable element, find parent a or button
              const clickableTags = ['A', 'BUTTON'];
              if (!clickableTags.includes(el.tagName)) {
                const parent = el.closest('a, button, [role="button"]');
                if (parent) {
                  // Build a simple selector for the parent
                  if (parent.id) return `#${parent.id}`;
                  const classes = Array.from(parent.classList)
                    .filter(c => !c.match(/^(css-|sc-|[0-9])/))
                    .slice(0, 2);
                  if (classes.length > 0) {
                    return `${parent.tagName.toLowerCase()}.${classes.join('.')}`;
                  }
                  // Try aria-label
                  const ariaLabel = parent.getAttribute('aria-label');
                  if (ariaLabel) {
                    return `${parent.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
                  }
                }
              }
              return null;
            } catch {
              return null;
            }
          }, legacySelector);

          if (parentSelector) {
            console.log(`[PaginationDetector] AI selector targeted child, using parent: ${parentSelector}`);
            legacySelector = parentSelector;
          }
        }

        // Re-validate with potentially updated selector
        const finalValid = await this.testPaginationSelector(legacySelector);
        if (finalValid) {
          workingSelector = legacySelector;
        } else {
          console.log(`[PaginationDetector] AI legacy selector not valid: ${legacySelector}`);
        }
      }

      // If we have a working selector (from attributes or legacy), test pagination click
      if (workingSelector) {
        // Update aiResult.selector to use working selector
        aiResult.selector = workingSelector;

        // Test the pagination click
        const clickResult = await this.testPaginationClick(workingSelector, itemSelector);

        if (clickResult.success) {
          console.log(`[PaginationDetector] AI pagination validated: ${clickResult.newProductsFound} new products`);

          // Build offset pattern if provided by AI or detected from URL
          let offset: OffsetPattern | undefined;
          if (aiResult.offset_config) {
            offset = {
              key: aiResult.offset_config.key,
              start: aiResult.offset_config.start,
              increment: aiResult.offset_config.increment,
              type: aiResult.offset_config.increment === 1 ? 'page' : 'offset'
            };
          } else if (clickResult.offsetPattern) {
            offset = clickResult.offsetPattern;
          }

          // Also test scroll for hybrid detection
          const scrollResult = await this.testInfiniteScroll(itemSelector);
          const scrollWorks = scrollResult.finalCount > scrollResult.initialCount;

          if (scrollWorks) {
            return {
              method: 'hybrid',
              pagination: {
                selector: workingSelector,
                type: aiResult.method === 'numbered_pages' || aiResult.url_pattern ? 'url_pattern' : 'next_page',
                productsLoaded: clickResult.newProductsFound,
                offset,
              },
              scroll: {
                productsLoaded: scrollResult.finalCount - scrollResult.initialCount,
                scrollPositions: scrollResult.scrollPositions,
              },
              candidates: [],
              source: 'ai',
            };
          }

          return {
            method: 'pagination',
            pagination: {
              selector: workingSelector,
              type: aiResult.method === 'numbered_pages' || aiResult.url_pattern ? 'url_pattern' : 'next_page',
              productsLoaded: clickResult.newProductsFound,
              offset,
            },
            candidates: [],
            source: 'ai',
          };
        }
      }

      // AI didn't work out, fall back to ML
      console.log('[PaginationDetector] AI suggestion could not be validated, using ML detection');
      const mlResult = await this.detectBestMethod(itemSelector);
      return { ...mlResult, source: 'ml' };

    } catch (error) {
      console.error('[PaginationDetector] AI detection error:', error);
      const mlResult = await this.detectBestMethod(itemSelector);
      return { ...mlResult, source: 'ml' };
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async detectPaginationOrScroll(itemSelector?: string): Promise<{
    candidates: PaginationCandidate[];
    hasInfiniteScroll: boolean;
    isHybrid: boolean;
    scrollTestResult?: {
      initialCount: number;
      finalCount: number;
      scrollIterations: number;
    };
  }> {
    const result = await this.detectBestMethod(itemSelector);

    return {
      candidates: result.candidates,
      hasInfiniteScroll: result.method === 'infinite_scroll' || result.method === 'hybrid',
      isHybrid: result.method === 'hybrid',
      scrollTestResult: result.scroll ? {
        initialCount: 0,
        finalCount: result.scroll.productsLoaded,
        scrollIterations: result.scroll.scrollPositions.length,
      } : undefined,
    };
  }
}
