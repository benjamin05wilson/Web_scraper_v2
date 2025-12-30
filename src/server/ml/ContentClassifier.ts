// ============================================================================
// CONTENT CLASSIFIER - Product vs non-product classification
// ============================================================================

/**
 * Classifies elements as products vs non-products (banners, ads, category links).
 * Uses pattern matching on class names, IDs, and content analysis.
 */
export class ContentClassifier {
  // Patterns that indicate non-product elements (must be more specific to avoid false positives)
  private nonProductPatterns = {
    banner: [
      /^banner$/i, /^hero$/i, /hero-banner/i, /promo-banner/i,
      /carousel-slide/i, /slider-item/i, /masthead/i,
      /jumbotron/i, /billboard/i, /marquee/i,
    ],
    ad: [
      /^ad-/i, /^ad_/i, /-ad$/i, /_ad$/i, /advertisement/i,
      /sponsored/i, /dfp/i, /adsense/i, /adunit/i, /google-ad/i,
      /^ads-/i, /^ads_/i,
    ],
    category: [
      /^nav-/i, /^nav_/i, /-nav$/i, /^menu-/i, /^menu$/i,
      /breadcrumb/i, /pagination/i, /^sort-/i, /filter-bar/i,
    ],
    ui: [
      /^header$/i, /^footer$/i, /^sidebar$/i, /^modal/i, /^popup/i,
      /^overlay$/i, /tooltip/i, /dropdown-menu/i, /cookie-banner/i, /consent/i,
      /notification-/i, /^alert$/i, /^toast$/i, /^dialog$/i,
    ],
  };

  // Patterns that indicate product elements
  private productPatterns = [
    /product/i, /item/i, /card/i, /tile/i, /listing/i,
    /goods/i, /sku/i, /offer/i, /result/i, /hit/i,
    /merchandise/i, /article/i,
  ];

  // Price patterns for multiple currencies
  private pricePatterns = [
    /[£$€¥₹]\s*\d+([,.]\d{2,3})?/,           // $25.99, £25, €25,99
    /\d+([,.]\d{2,3})?\s*[£$€¥₹]/,           // 25.99$, 25£
    /\d{1,3}([,.]\d{3})*([,.]\d{2})?\s*MAD/i, // Moroccan Dirham
    /\d{1,3}([,.]\d{3})*([,.]\d{2})?\s*(USD|EUR|GBP|AUD|CAD)/i,
  ];

  // Product link patterns
  private productLinkPatterns = [
    /\/product\//i, /\/p\//i, /\/item\//i, /\/dp\//i,
    /\/pd\//i, /\/products\//i, /\/goods\//i, /[?&]sku=/i,
    /\/buy\//i, /\/shop\//i, /\/detail\//i,
  ];

  /**
   * Generate browser-side classification script
   * This runs in the browser context for each candidate element
   */
  getClassificationScript(selector: string): string {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) {
          return {
            isProduct: false,
            isNonProduct: false,
            category: 'unknown',
            confidence: 0,
            matchedPatterns: []
          };
        }

        const classes = Array.from(el.classList).join(' ');
        const id = el.id || '';
        const combined = classes + ' ' + id;
        const matchedPatterns = [];

        // FIRST: Check for product signals (we want to keep products even if they have some non-product class names)

        // Product patterns
        const productPatterns = ${JSON.stringify(this.productPatterns.map(r => r.source))};
        let hasProductClass = false;
        for (const patternStr of productPatterns) {
          const pattern = new RegExp(patternStr, 'i');
          if (pattern.test(combined)) {
            hasProductClass = true;
            matchedPatterns.push('product:' + patternStr);
            break;
          }
        }

        // Content signals
        const text = el.textContent || '';

        // Check for price
        const pricePatterns = ${JSON.stringify(this.pricePatterns.map(r => r.source))};
        let hasPrice = false;
        for (const patternStr of pricePatterns) {
          const pattern = new RegExp(patternStr);
          if (pattern.test(text)) {
            hasPrice = true;
            matchedPatterns.push('price:' + patternStr);
            break;
          }
        }

        // Check for price-related classes
        const priceClasses = ['price', 'cost', 'amount', 'money'];
        for (const cls of priceClasses) {
          if (el.querySelector('[class*="' + cls + '"]')) {
            hasPrice = true;
            matchedPatterns.push('priceClass:' + cls);
            break;
          }
        }

        // Check for product image
        const img = el.querySelector('img');
        let hasProductImage = false;
        if (img) {
          const rect = img.getBoundingClientRect();
          const hasReasonableSize = rect.width >= 50 && rect.height >= 50;
          const src = img.src || img.getAttribute('data-src') || '';
          const isNotIcon = !src.includes('icon') && !src.includes('logo');
          hasProductImage = hasReasonableSize && isNotIcon;
          if (hasProductImage) {
            matchedPatterns.push('productImage');
          }
        }

        // Check for product link
        const linkPatterns = ${JSON.stringify(this.productLinkPatterns.map(r => r.source))};
        let hasProductLink = false;
        const links = el.querySelectorAll('a[href]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          for (const patternStr of linkPatterns) {
            const pattern = new RegExp(patternStr, 'i');
            if (pattern.test(href)) {
              hasProductLink = true;
              matchedPatterns.push('productLink:' + patternStr);
              break;
            }
          }
          if (hasProductLink) break;
        }

        // Count strong product signals
        const productSignals = [hasProductClass, hasPrice, hasProductImage, hasProductLink];
        const positiveSignals = productSignals.filter(Boolean).length;

        // If element has 2+ product signals, it's likely a product - don't filter it
        if (positiveSignals >= 2) {
          return {
            isProduct: true,
            isNonProduct: false,
            category: 'product',
            confidence: 0.6 + (positiveSignals * 0.1),
            matchedPatterns
          };
        }

        // ONLY check non-product patterns if we don't have strong product signals
        const nonProductPatterns = {
          banner: ${JSON.stringify(this.nonProductPatterns.banner.map(r => r.source))},
          ad: ${JSON.stringify(this.nonProductPatterns.ad.map(r => r.source))},
          category: ${JSON.stringify(this.nonProductPatterns.category.map(r => r.source))},
          ui: ${JSON.stringify(this.nonProductPatterns.ui.map(r => r.source))}
        };

        // Check for non-product patterns (only if lacking product signals)
        for (const [category, patterns] of Object.entries(nonProductPatterns)) {
          for (const patternStr of patterns) {
            const pattern = new RegExp(patternStr, 'i');
            if (pattern.test(combined)) {
              matchedPatterns.push(category + ':' + patternStr);
              return {
                isProduct: false,
                isNonProduct: true,
                category: category,
                confidence: 0.8,
                matchedPatterns
              };
            }
          }
        }

        // If we have at least 1 product signal, consider it a potential product
        if (positiveSignals >= 1) {
          return {
            isProduct: true,
            isNonProduct: false,
            category: 'product',
            confidence: 0.5 + (positiveSignals * 0.1),
            matchedPatterns
          };
        }

        // No strong signals either way - don't filter, let scoring decide
        return {
          isProduct: false,
          isNonProduct: false,
          category: 'unknown',
          confidence: 0.5,
          matchedPatterns
        };
      })()
    `;
  }

  /**
   * Generate script to check if element is a banner by visual characteristics
   */
  getBannerCheckScript(selector: string): string {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { isBanner: false, reason: 'not found' };

        const rect = el.getBoundingClientRect();
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight
        };

        // Banners are typically very wide (aspect ratio > 4)
        const aspectRatio = rect.width / rect.height;
        if (aspectRatio > 4) {
          return { isBanner: true, reason: 'aspect_ratio_' + aspectRatio.toFixed(1) };
        }

        // Full-width elements that are also short are often banners
        if (rect.width > viewport.width * 0.95 && rect.height < 200) {
          return { isBanner: true, reason: 'full_width_short' };
        }

        return { isBanner: false, reason: 'not_banner' };
      })()
    `;
  }

  /**
   * Generate script to detect price patterns in element
   */
  getPriceDetectionScript(selector: string): string {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { hasPrice: false, prices: [] };

        const text = el.textContent || '';

        // Price patterns
        const priceRegex = /[£$€¥₹]\\s*\\d{1,3}(?:[,.]\\d{3})*(?:[,.]\\d{1,2})?|\\d{1,3}(?:[,.]\\d{3})*(?:[,.]\\d{1,2})?\\s*[£$€¥₹MAD]*/gi;
        const matches = text.match(priceRegex);

        if (!matches || matches.length === 0) {
          return { hasPrice: false, prices: [] };
        }

        // Filter valid prices
        const prices = matches
          .map(m => m.trim())
          .filter(m => {
            // Parse to check if valid
            const cleaned = m.replace(/[£$€¥₹MAD\\s]/gi, '').replace(/,/g, '.');
            const parts = cleaned.split('.');
            let numStr = cleaned;
            if (parts.length > 2) {
              numStr = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
            }
            const value = parseFloat(numStr);
            return !isNaN(value) && value > 0 && value < 100000;
          });

        return {
          hasPrice: prices.length > 0,
          prices: prices.slice(0, 5) // Return up to 5 prices
        };
      })()
    `;
  }

  /**
   * Generate script to check for product link patterns
   */
  getProductLinkScript(selector: string): string {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { hasProductLink: false, links: [] };

        const linkPatterns = ${JSON.stringify(this.productLinkPatterns.map(r => r.source))};
        const links = el.querySelectorAll('a[href]');
        const productLinks = [];

        for (const link of links) {
          const href = link.getAttribute('href') || '';
          for (const patternStr of linkPatterns) {
            const pattern = new RegExp(patternStr, 'i');
            if (pattern.test(href)) {
              productLinks.push(href);
              break;
            }
          }
        }

        return {
          hasProductLink: productLinks.length > 0,
          links: productLinks.slice(0, 3)
        };
      })()
    `;
  }
}
