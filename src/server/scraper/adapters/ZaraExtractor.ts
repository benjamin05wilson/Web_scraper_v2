// ============================================================================
// ZARA EXTRACTOR
// ============================================================================
// Specialized extractor for Zara's split layout (images in one row, info in another)

import type { Page, CDPSession } from 'playwright';
import type { ScraperConfig, ScrapedItem } from '../../../shared/types.js';
import { BaseExtractor, type ExtractionResult } from './BaseExtractor.js';

/**
 * Extractor for Zara's unique split-card layout
 * Zara displays product images and info in separate rows that need to be paired by index
 */
export class ZaraExtractor extends BaseExtractor {
  constructor(page: Page, cdp: CDPSession) {
    super(page, cdp);
  }

  getName(): string {
    return 'ZaraExtractor';
  }

  /**
   * Detect Zara's split layout pattern
   */
  canHandle(config: ScraperConfig): boolean {
    if (!config.itemContainer) return false;

    const container = config.itemContainer;
    return (
      container.includes('li.product-grid-product[data-productid]') &&
      container.includes('li.product-grid-block-dynamic__product-info')
    );
  }

  /**
   * Higher priority than default extractor
   */
  getPriority(): number {
    return 10;
  }

  /**
   * Extract from Zara's split layout by pairing image cards with info cards
   */
  async extract(config: ScraperConfig): Promise<ExtractionResult> {
    const requestedRoles = new Set(config.selectors.map((s) => s.role));

    const result = await this.evaluate<{
      items: ScrapedItem[];
      imageCount: number;
      infoCount: number;
    }>(`
      (function() {
        var selectors = ${JSON.stringify(config.selectors)};
        var requestedRoles = ${JSON.stringify([...requestedRoles])};

        function parsePrice(priceStr) {
          if (!priceStr) return NaN;
          var cleaned = priceStr.replace(/[£$€¥₹MAD\\s]/gi, '').replace(/,/g, '.');
          var parts = cleaned.split('.');
          if (parts.length > 2) {
            cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
          }
          return parseFloat(cleaned);
        }

        function isRoleRequested(role) {
          return requestedRoles.indexOf(role) !== -1;
        }

        // Get image cards and info cards
        var imageCards = document.querySelectorAll('li.product-grid-product[data-productid]');
        var infoCards = document.querySelectorAll('li.product-grid-block-dynamic__product-info');

        console.log('[ZaraExtractor] Found ' + imageCards.length + ' image cards, ' + infoCards.length + ' info cards');

        // Pair by index
        var items = [];
        var numProducts = Math.min(imageCards.length, infoCards.length);

        for (var i = 0; i < numProducts; i++) {
          var imageCard = imageCards[i];
          var infoCard = infoCards[i];
          var item = {};

          // Extract image
          if (isRoleRequested('image')) {
            var img = imageCard.querySelector('img');
            if (img) {
              var src = img.getAttribute('src') || img.getAttribute('data-src');
              if (src) {
                if (src.indexOf('http') !== 0) {
                  src = new URL(src, window.location.origin).href;
                }
                item.image = src;
              }
            }
          }

          // Extract URL
          if (isRoleRequested('url')) {
            var link = imageCard.querySelector('a[href]');
            if (link) {
              var href = link.getAttribute('href');
              if (href && href !== '#') {
                if (href.indexOf('http') !== 0) {
                  href = new URL(href, window.location.origin).href;
                }
                item.url = href;
              }
            }
          }

          // Extract title
          if (isRoleRequested('title')) {
            var titleEl = infoCard.querySelector('.product-grid-product-info__name, [class*="product-name"], a');
            if (titleEl) {
              item.title = (titleEl.textContent || '').trim();
            }
          }

          // Extract price
          if (isRoleRequested('price') || isRoleRequested('originalPrice')) {
            var priceSelector = selectors.find(function(s) {
              return s.role === 'price' || s.role === 'originalPrice';
            });
            var priceEl = null;
            if (priceSelector && priceSelector.selector && priceSelector.selector.css) {
              priceEl = infoCard.querySelector(priceSelector.selector.css);
            }
            if (!priceEl) {
              priceEl = infoCard.querySelector('.money-amount__main, .money-amount.money-amount--highlight span, [class*="price"], [class*="amount"]');
            }
            if (priceEl) {
              var priceValue = (priceEl.textContent || '').trim();
              if (isRoleRequested('price')) item.price = priceValue;
              if (isRoleRequested('originalPrice')) item.originalPrice = priceValue;
            }
          }

          // Extract sale price
          if (isRoleRequested('salePrice')) {
            var salePriceEl = infoCard.querySelector('.money-amount--is-discounted, [class*="sale"], [class*="discount"]');
            if (salePriceEl) {
              item.salePrice = (salePriceEl.textContent || '').trim();
            }
          }

          // Only add if we have at least one value
          if (Object.keys(item).length > 0) {
            items.push(item);
          }
        }

        return {
          items: items,
          imageCount: imageCards.length,
          infoCount: infoCards.length
        };
      })()
    `);

    console.log(
      `[ZaraExtractor] Extracted ${result.items.length} items from ${result.imageCount} image cards / ${result.infoCount} info cards`
    );

    return {
      items: result.items || [],
      errors: [],
      containerSelector: 'zara-split-layout',
      containerCount: result.items?.length || 0,
    };
  }
}
