// ============================================================================
// DEFAULT EXTRACTOR
// ============================================================================
// Standard extraction logic for most sites using container-based extraction

import type { Page, CDPSession } from 'playwright';
import type { ScraperConfig, ScrapedItem, AssignedSelector } from '../../../shared/types.js';
import { BaseExtractor, type ExtractionResult } from './BaseExtractor.js';
import { getBrowserPriceParserScript } from '../utils/PriceParser.js';
import { getBrowserValueExtractorScript } from '../utils/ValueExtractor.js';
import { getBrowserContainerDetectorScript } from '../utils/ContainerDetector.js';

/**
 * Default extractor for standard container-based extraction
 * Works for most e-commerce sites with repeating product cards
 */
export class DefaultExtractor extends BaseExtractor {
  constructor(page: Page, cdp: CDPSession) {
    super(page, cdp);
  }

  getName(): string {
    return 'DefaultExtractor';
  }

  /**
   * This extractor handles all configs as a fallback
   */
  canHandle(_config: ScraperConfig): boolean {
    return true;
  }

  /**
   * Lower priority so site-specific extractors take precedence
   */
  getPriority(): number {
    return 1000;
  }

  /**
   * Extract data from the current page
   */
  async extract(config: ScraperConfig): Promise<ExtractionResult> {
    // If item container is defined, use container-based extraction
    if (config.itemContainer) {
      return this.extractFromContainers(config.itemContainer, config.selectors);
    }

    // Otherwise, auto-detect containers
    return this.extractMultipleItems(config.selectors);
  }

  /**
   * Extract from explicitly defined containers
   */
  private async extractFromContainers(
    containerSelector: string,
    selectors: AssignedSelector[]
  ): Promise<ExtractionResult> {
    const priceParser = getBrowserPriceParserScript();
    const valueExtractor = getBrowserValueExtractorScript();

    const result = await this.evaluate<{
      items: ScrapedItem[];
      error?: string;
    }>(`
      (function() {
        var PriceParser = ${priceParser};
        var ValueExtractor = ${valueExtractor};

        // Try to find containers
        var containerSelector = ${JSON.stringify(containerSelector)};
        var containers = [];

        // Handle special characters in selectors
        var hasSpecialChars = containerSelector.indexOf('@') !== -1 ||
                              containerSelector.indexOf('/') !== -1;

        if (!hasSpecialChars) {
          try {
            containers = document.querySelectorAll(containerSelector);
          } catch (e) {}
        }

        // Fallback to class-based matching
        if (!containers || containers.length === 0) {
          var unescapedSelector = containerSelector.replace(/\\\\(.)/g, '$1');
          var dotIndex = unescapedSelector.indexOf('.');
          if (dotIndex > 0) {
            var tag = unescapedSelector.substring(0, dotIndex);
            var classStr = unescapedSelector.substring(dotIndex + 1);
            var classes = classStr.split('.').filter(Boolean);
            var candidates = document.querySelectorAll(tag);
            containers = [];
            for (var i = 0; i < candidates.length; i++) {
              var hasAll = true;
              for (var j = 0; j < classes.length; j++) {
                if (!candidates[i].classList.contains(classes[j])) {
                  hasAll = false;
                  break;
                }
              }
              if (hasAll) containers.push(candidates[i]);
            }
          }
        }

        if (!containers || containers.length === 0) {
          return { items: [], error: 'No containers found for: ' + containerSelector };
        }
        containers = Array.from(containers);

        var selectors = ${JSON.stringify(selectors)};
        var items = [];

        // Group selectors by role
        var selectorsByRole = {};
        selectors.forEach(function(sel) {
          if (!selectorsByRole[sel.role]) selectorsByRole[sel.role] = [];
          selectorsByRole[sel.role].push(sel);
        });
        Object.keys(selectorsByRole).forEach(function(role) {
          selectorsByRole[role].sort(function(a, b) {
            return (a.priority || 0) - (b.priority || 0);
          });
        });

        // Check for separate price roles
        var hasOriginalPrice = selectors.some(function(s) { return s.role === 'originalPrice'; });
        var hasSalePrice = selectors.some(function(s) { return s.role === 'salePrice'; });
        var hasBothPriceTypes = hasOriginalPrice && hasSalePrice;

        containers.forEach(function(container, idx) {
          var item = {};

          Object.keys(selectorsByRole).forEach(function(role) {
            var roleSelectors = selectorsByRole[role];
            var value = null;

            for (var i = 0; i < roleSelectors.length && !value; i++) {
              var sel = roleSelectors[i];
              var css = sel.selector.css;
              var el = null;

              if (css === ':parent-link') {
                el = container.closest('a[href]');
              } else {
                el = container.querySelector(css);
              }

              if (el) {
                var extractType = sel.extractionType || 'text';
                if (role === 'price' && extractType === 'text') {
                  value = PriceParser.extractLowestPrice(el.textContent || '');
                } else {
                  value = ValueExtractor.extractValue(el, extractType, {
                    attributeName: sel.attributeName,
                    baseUrl: window.location.origin
                  });
                }
              }
            }

            item[roleSelectors[0].customName || role] = value;
          });

          // Swap prices if needed
          if (hasBothPriceTypes && item.originalPrice && item.salePrice) {
            var origVal = PriceParser.parsePrice(item.originalPrice);
            var saleVal = PriceParser.parsePrice(item.salePrice);
            if (!isNaN(origVal) && !isNaN(saleVal) && origVal < saleVal) {
              var temp = item.originalPrice;
              item.originalPrice = item.salePrice;
              item.salePrice = temp;
            }
          }

          // Skip empty items
          var hasTitle = item.title !== null && item.title !== undefined;
          var hasPrice = item.price !== null && item.price !== undefined;
          if (!hasTitle && !hasPrice) return;

          items.push(item);
        });

        return { items: items };
      })()
    `);

    return {
      items: result.items || [],
      errors: result.error ? [{ itemIndex: -1, field: 'container', error: result.error }] : [],
      containerSelector,
      containerCount: result.items?.length || 0,
    };
  }

  /**
   * Auto-detect containers and extract items
   */
  private async extractMultipleItems(
    selectors: AssignedSelector[]
  ): Promise<ExtractionResult> {
    const priceParser = getBrowserPriceParserScript();
    const valueExtractor = getBrowserValueExtractorScript();
    const containerDetector = getBrowserContainerDetectorScript();

    const result = await this.evaluate<{
      items: ScrapedItem[];
      containerSelector?: string;
      containerCount?: number;
      error?: string;
    }>(`
      (function() {
        var PriceParser = ${priceParser};
        var ValueExtractor = ${valueExtractor};
        var ContainerDetector = ${containerDetector};
        var selectors = ${JSON.stringify(selectors)};

        // Get all elements for each selector
        var allElementsPerSelector = selectors.map(function(sel) {
          var css = sel.selector.css;
          if (css === ':parent-link') return { selector: sel, elements: [] };
          try {
            return { selector: sel, elements: Array.from(document.querySelectorAll(css)) };
          } catch (e) {
            return { selector: sel, elements: [] };
          }
        });

        // Find container pattern
        var hasMultiple = allElementsPerSelector.some(function(s) { return s.elements.length > 1; });
        if (!hasMultiple) {
          return { items: [], error: 'NO_CONTAINER_DETECTED' };
        }

        // Get primary elements
        var sorted = allElementsPerSelector.slice().sort(function(a, b) {
          return b.elements.length - a.elements.length;
        });
        var primaryElements = sorted[0].elements;

        if (primaryElements.length < 2) {
          return { items: [], error: 'NO_CONTAINER_DETECTED' };
        }

        // Find containers by walking up DOM
        var containerCandidates = new Map();
        var sampleSize = Math.min(20, primaryElements.length);

        for (var i = 0; i < sampleSize; i++) {
          var el = primaryElements[i];
          var parent = el.parentElement;
          var depth = 0;

          while (parent && parent !== document.body && depth < 10) {
            depth++;
            if (!ContainerDetector.isValidContainer(parent)) {
              parent = parent.parentElement;
              continue;
            }

            var selectorStrategies = ContainerDetector.buildSelector(parent);
            for (var j = 0; j < selectorStrategies.length; j++) {
              var selector = selectorStrategies[j];
              if (!containerCandidates.has(selector)) {
                try {
                  var matches = Array.from(document.querySelectorAll(selector));
                  var valid = matches.filter(ContainerDetector.isValidContainer);
                  containerCandidates.set(selector, {
                    containers: valid,
                    containedElements: new Set(),
                    hasProductClass: ContainerDetector.hasProductClass(parent)
                  });
                } catch (e) { continue; }
              }

              var candidate = containerCandidates.get(selector);
              for (var k = 0; k < candidate.containers.length; k++) {
                if (candidate.containers[k].contains(el)) {
                  candidate.containedElements.add(el);
                  break;
                }
              }
            }
            parent = parent.parentElement;
          }
        }

        // Score and select best container
        var bestSelector = null;
        var bestScore = 0;
        var bestContainers = [];

        containerCandidates.forEach(function(data, selector) {
          var score = ContainerDetector.scoreCandidate(
            data.containers,
            data.containedElements.size,
            sampleSize,
            data.hasProductClass
          );
          if (score > bestScore) {
            bestScore = score;
            bestSelector = selector;
            bestContainers = data.containers;
          }
        });

        if (!bestSelector || bestContainers.length === 0) {
          return { items: [], error: 'NO_CONTAINER_DETECTED' };
        }

        // Group selectors by role
        var selectorsByRole = {};
        selectors.forEach(function(sel) {
          if (!selectorsByRole[sel.role]) selectorsByRole[sel.role] = [];
          selectorsByRole[sel.role].push(sel);
        });
        Object.keys(selectorsByRole).forEach(function(role) {
          selectorsByRole[role].sort(function(a, b) {
            return (a.priority || 0) - (b.priority || 0);
          });
        });

        var hasOriginalPrice = selectors.some(function(s) { return s.role === 'originalPrice'; });
        var hasSalePrice = selectors.some(function(s) { return s.role === 'salePrice'; });
        var hasBothPriceTypes = hasOriginalPrice && hasSalePrice;

        // Extract from containers
        var items = [];
        bestContainers.forEach(function(container, idx) {
          var item = {};
          var hasAnyValue = false;

          Object.keys(selectorsByRole).forEach(function(role) {
            var roleSelectors = selectorsByRole[role];
            var value = null;

            for (var i = 0; i < roleSelectors.length && !value; i++) {
              var sel = roleSelectors[i];
              var el = ValueExtractor.findElement(container, sel.selector.css, sel.selector);

              if (el) {
                var extractType = sel.extractionType || 'text';
                if (role === 'price' && extractType === 'text') {
                  value = PriceParser.extractLowestPrice(el.textContent || '');
                } else {
                  value = ValueExtractor.extractValue(el, extractType, {
                    attributeName: sel.attributeName,
                    baseUrl: window.location.origin
                  });
                }
                if (value) hasAnyValue = true;
              }
            }

            item[roleSelectors[0].customName || role] = value;
          });

          // Swap prices if needed
          if (hasBothPriceTypes && item.originalPrice && item.salePrice) {
            var origVal = PriceParser.parsePrice(item.originalPrice);
            var saleVal = PriceParser.parsePrice(item.salePrice);
            if (!isNaN(origVal) && !isNaN(saleVal) && origVal < saleVal) {
              var temp = item.originalPrice;
              item.originalPrice = item.salePrice;
              item.salePrice = temp;
            }
          }

          if (hasAnyValue) items.push(item);
        });

        return {
          items: items,
          containerSelector: bestSelector,
          containerCount: bestContainers.length
        };
      })()
    `);

    return {
      items: result.items || [],
      errors: result.error
        ? [{ itemIndex: -1, field: 'container', error: result.error }]
        : [],
      containerSelector: result.containerSelector,
      containerCount: result.containerCount,
    };
  }
}
