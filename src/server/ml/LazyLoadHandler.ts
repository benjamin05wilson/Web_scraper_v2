// ============================================================================
// LAZY LOAD HANDLER - Detection and resolution of lazy-loaded content
// ============================================================================

/**
 * Handles detection and resolution of lazy-loaded content,
 * particularly images which are common pain points for scraping.
 */
export class LazyLoadHandler {
  // Common lazy load attribute patterns (ordered by prevalence)
  private lazyAttrs = [
    'data-src',
    'data-lazy-src',
    'data-original',
    'data-lazy',
    'data-srcset',
    'data-bg',
    'data-background',
    'data-image',
    'data-img-src',
    'loading-src',
    'data-defer-src',
    'data-ll-src',
  ];

  // Placeholder URL patterns to detect
  private placeholderPatterns = [
    /placeholder/i,
    /loading/i,
    /blank/i,
    /spacer/i,
    /pixel/i,
    /transparent/i,
    /lazy/i,
    /^data:image\/gif/,
    /^data:image\/png/,
    /^data:image\/svg/,
    /1x1/,
    /spinner/i,
  ];

  /**
   * Generate browser-side script to check if element has lazy content
   */
  getHasLazyContentScript(selector: string): string {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { hasLazy: false, details: [] };

        const lazyAttrs = ${JSON.stringify(this.lazyAttrs)};
        const placeholderPatterns = ${JSON.stringify(this.placeholderPatterns.map(r => r.source))};
        const details = [];

        function isPlaceholderUrl(url) {
          if (!url) return false;
          for (const patternStr of placeholderPatterns) {
            const pattern = new RegExp(patternStr, 'i');
            if (pattern.test(url)) return true;
          }
          return false;
        }

        // Check images
        const images = el.querySelectorAll('img');
        for (const img of images) {
          const src = img.getAttribute('src') || '';

          // Check if current src is a placeholder
          if (!src || isPlaceholderUrl(src)) {
            // Check for lazy load attributes
            for (const attr of lazyAttrs) {
              if (img.hasAttribute(attr)) {
                const lazyValue = img.getAttribute(attr);
                if (lazyValue && !isPlaceholderUrl(lazyValue)) {
                  details.push({
                    type: 'image',
                    attribute: attr,
                    placeholder: src || 'empty',
                    realSrc: lazyValue
                  });
                }
              }
            }
          }
        }

        // Check for lazy background images
        const bgElements = el.querySelectorAll('[data-bg], [data-background], [data-bg-src]');
        for (const bgEl of bgElements) {
          const dataBg = bgEl.getAttribute('data-bg') || bgEl.getAttribute('data-background') || bgEl.getAttribute('data-bg-src');
          if (dataBg && !isPlaceholderUrl(dataBg)) {
            details.push({
              type: 'background',
              attribute: 'data-bg',
              placeholder: 'none',
              realSrc: dataBg
            });
          }
        }

        return {
          hasLazy: details.length > 0,
          details
        };
      })()
    `;
  }

  /**
   * Generate script to check if a specific image is lazy-loaded
   */
  getIsLazyImageScript(imgSelector: string): string {
    return `
      (function() {
        const img = document.querySelector(${JSON.stringify(imgSelector)});
        if (!img || img.tagName !== 'IMG') {
          return { isLazy: false, reason: 'not_found' };
        }

        const src = img.getAttribute('src') || '';
        const placeholderPatterns = ${JSON.stringify(this.placeholderPatterns.map(r => r.source))};

        function isPlaceholderUrl(url) {
          if (!url) return true; // Empty src is placeholder
          for (const patternStr of placeholderPatterns) {
            const pattern = new RegExp(patternStr, 'i');
            if (pattern.test(url)) return true;
          }
          return false;
        }

        const isPlaceholder = isPlaceholderUrl(src);

        // Check if has lazy attrs
        const lazyAttrs = ${JSON.stringify(this.lazyAttrs)};
        let hasLazyAttr = false;
        let lazyAttrName = '';
        let lazyAttrValue = '';

        for (const attr of lazyAttrs) {
          if (img.hasAttribute(attr)) {
            hasLazyAttr = true;
            lazyAttrName = attr;
            lazyAttrValue = img.getAttribute(attr) || '';
            break;
          }
        }

        return {
          isLazy: isPlaceholder && hasLazyAttr,
          isPlaceholder,
          hasLazyAttr,
          lazyAttrName,
          lazyAttrValue,
          currentSrc: src
        };
      })()
    `;
  }

  /**
   * Generate script to get real image source with fallback chain
   */
  getRealImageSourceScript(selector: string): string {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { found: false, src: null, method: 'not_found' };

        // Find the main image
        const img = el.querySelector('img');
        if (!img) return { found: false, src: null, method: 'no_image' };

        const lazyAttrs = ${JSON.stringify(this.lazyAttrs)};
        const placeholderPatterns = ${JSON.stringify(this.placeholderPatterns.map(r => r.source))};

        function isPlaceholderUrl(url) {
          if (!url) return true;
          for (const patternStr of placeholderPatterns) {
            const pattern = new RegExp(patternStr, 'i');
            if (pattern.test(url)) return true;
          }
          return false;
        }

        function resolveUrl(url) {
          if (!url) return null;
          if (url.startsWith('http')) return url;
          if (url.startsWith('//')) return 'https:' + url;
          try {
            return new URL(url, window.location.origin).href;
          } catch {
            return url;
          }
        }

        // Try src first
        const src = img.getAttribute('src');
        if (src && !isPlaceholderUrl(src)) {
          return { found: true, src: resolveUrl(src), method: 'src' };
        }

        // Try lazy load attributes in order
        for (const attr of lazyAttrs) {
          const value = img.getAttribute(attr);
          if (value && !isPlaceholderUrl(value)) {
            // Handle srcset format (take first URL)
            if (attr.includes('srcset') || value.includes(',')) {
              const firstUrl = value.split(',')[0].split(' ')[0].trim();
              if (firstUrl) {
                return { found: true, src: resolveUrl(firstUrl), method: attr + '_srcset' };
              }
            }
            return { found: true, src: resolveUrl(value), method: attr };
          }
        }

        // Try srcset attribute
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          const firstUrl = srcset.split(',')[0].split(' ')[0].trim();
          if (firstUrl && !isPlaceholderUrl(firstUrl)) {
            return { found: true, src: resolveUrl(firstUrl), method: 'srcset' };
          }
        }

        // Last resort: check for currentSrc (browser may have loaded it)
        if (img.currentSrc && !isPlaceholderUrl(img.currentSrc)) {
          return { found: true, src: img.currentSrc, method: 'currentSrc' };
        }

        return { found: false, src: null, method: 'not_resolved' };
      })()
    `;
  }

  /**
   * Generate script to force load all images in an element
   */
  getForceLoadImagesScript(selector: string): string {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { loaded: 0, errors: 0 };

        const lazyAttrs = ${JSON.stringify(this.lazyAttrs)};
        const placeholderPatterns = ${JSON.stringify(this.placeholderPatterns.map(r => r.source))};
        let loaded = 0;
        let errors = 0;

        function isPlaceholderUrl(url) {
          if (!url) return true;
          for (const patternStr of placeholderPatterns) {
            const pattern = new RegExp(patternStr, 'i');
            if (pattern.test(url)) return true;
          }
          return false;
        }

        const images = el.querySelectorAll('img');
        for (const img of images) {
          const src = img.getAttribute('src') || '';

          // Only process if current src is placeholder or empty
          if (!src || isPlaceholderUrl(src)) {
            for (const attr of lazyAttrs) {
              const lazyValue = img.getAttribute(attr);
              if (lazyValue && !isPlaceholderUrl(lazyValue)) {
                try {
                  // Handle srcset format
                  if (attr.includes('srcset') || lazyValue.includes(',')) {
                    const firstUrl = lazyValue.split(',')[0].split(' ')[0].trim();
                    img.src = firstUrl;
                  } else {
                    img.src = lazyValue;
                  }

                  // Remove loading attribute to allow immediate load
                  img.removeAttribute('loading');
                  img.removeAttribute('decoding');

                  loaded++;
                  break;
                } catch (e) {
                  errors++;
                }
              }
            }
          }
        }

        return { loaded, errors };
      })()
    `;
  }

  /**
   * Generate script to extract all image URLs from element with lazy load handling
   */
  getExtractAllImagesScript(selector: string): string {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { images: [] };

        const lazyAttrs = ${JSON.stringify(this.lazyAttrs)};
        const placeholderPatterns = ${JSON.stringify(this.placeholderPatterns.map(r => r.source))};
        const images = [];

        function isPlaceholderUrl(url) {
          if (!url) return true;
          for (const patternStr of placeholderPatterns) {
            const pattern = new RegExp(patternStr, 'i');
            if (pattern.test(url)) return true;
          }
          return false;
        }

        function resolveUrl(url) {
          if (!url) return null;
          if (url.startsWith('http')) return url;
          if (url.startsWith('//')) return 'https:' + url;
          try {
            return new URL(url, window.location.origin).href;
          } catch {
            return url;
          }
        }

        function getBestSrc(img) {
          // Try src
          const src = img.getAttribute('src');
          if (src && !isPlaceholderUrl(src)) {
            return { url: resolveUrl(src), source: 'src' };
          }

          // Try lazy attrs
          for (const attr of lazyAttrs) {
            const value = img.getAttribute(attr);
            if (value && !isPlaceholderUrl(value)) {
              if (value.includes(',')) {
                const firstUrl = value.split(',')[0].split(' ')[0].trim();
                return { url: resolveUrl(firstUrl), source: attr };
              }
              return { url: resolveUrl(value), source: attr };
            }
          }

          // Try srcset
          const srcset = img.getAttribute('srcset');
          if (srcset) {
            const firstUrl = srcset.split(',')[0].split(' ')[0].trim();
            if (!isPlaceholderUrl(firstUrl)) {
              return { url: resolveUrl(firstUrl), source: 'srcset' };
            }
          }

          // Try currentSrc
          if (img.currentSrc && !isPlaceholderUrl(img.currentSrc)) {
            return { url: img.currentSrc, source: 'currentSrc' };
          }

          return null;
        }

        const imgElements = el.querySelectorAll('img');
        for (const img of imgElements) {
          const result = getBestSrc(img);
          if (result) {
            images.push({
              url: result.url,
              source: result.source,
              alt: img.alt || '',
              width: img.naturalWidth || img.width || 0,
              height: img.naturalHeight || img.height || 0
            });
          }
        }

        return { images };
      })()
    `;
  }

  /**
   * Get list of lazy load attributes to check
   */
  getLazyAttributes(): string[] {
    return [...this.lazyAttrs];
  }
}
