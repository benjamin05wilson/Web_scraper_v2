// ============================================================================
// VALUE EXTRACTOR UTILITY
// ============================================================================
// Extracts values from DOM elements based on extraction type (text, href, src, etc.)

import type { AssignedSelector } from '../../../shared/types.js';
import { extractLowestPrice } from './PriceParser.js';

/**
 * Extraction types supported
 */
export type ExtractionType = 'text' | 'href' | 'src' | 'attribute' | 'innerHTML';

/**
 * Lazy load attribute fallbacks for images
 */
const LAZY_SRC_ATTRIBUTES = [
  'data-src',
  'data-lazy-src',
  'data-original',
  'data-lazy',
  'data-srcset',
];

/**
 * Placeholder patterns to skip
 */
const PLACEHOLDER_PATTERNS = [
  'placeholder',
  'loading',
  'blank',
  'data:image',
  'spacer',
  '1x1',
  'pixel',
];

/**
 * Check if a URL is a placeholder/loading image
 */
export function isPlaceholderUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Resolve a relative URL to absolute
 */
export function resolveUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
    // Handle protocol-relative URLs
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    return url;
  }
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * Extract text content from an element
 * Trims whitespace and normalizes internal spacing
 */
export function extractText(element: Element | null): string | null {
  if (!element) return null;
  const text = element.textContent?.trim();
  if (!text) return null;
  // Normalize internal whitespace
  return text.replace(/\s+/g, ' ');
}

/**
 * Extract href attribute with URL resolution
 */
export function extractHref(element: Element | null, baseUrl: string = ''): string | null {
  if (!element) return null;
  const href = element.getAttribute('href');
  if (!href || href === '#') return null;
  return resolveUrl(href, baseUrl);
}

/**
 * Extract image source with lazy-load fallback support
 * Tries src first, then falls back to various data-* attributes
 */
export function extractSrc(element: Element | null, baseUrl: string = ''): string | null {
  if (!element) return null;

  // First try the src attribute
  let src = element.getAttribute('src');

  // If src is a placeholder, try lazy-load attributes
  if (isPlaceholderUrl(src)) {
    for (const attr of LAZY_SRC_ATTRIBUTES) {
      const lazySrc = element.getAttribute(attr);
      if (lazySrc && !isPlaceholderUrl(lazySrc)) {
        src = lazySrc;
        break;
      }
    }
  }

  // Still a placeholder? Return null
  if (isPlaceholderUrl(src)) return null;

  // Handle srcset format (take first URL)
  if (src && (src.includes(',') || src.includes(' '))) {
    const firstUrl = src.split(',')[0].split(' ')[0].trim();
    if (firstUrl) src = firstUrl;
  }

  return resolveUrl(src, baseUrl);
}

/**
 * Extract a specific attribute value
 */
export function extractAttribute(
  element: Element | null,
  attributeName: string
): string | null {
  if (!element || !attributeName) return null;
  return element.getAttribute(attributeName);
}

/**
 * Extract innerHTML from an element
 */
export function extractInnerHTML(element: Element | null): string | null {
  if (!element) return null;
  return element.innerHTML || null;
}

/**
 * Extract value from element based on extraction type and role
 * This is the main unified extraction method
 */
export function extractValue(
  element: Element | null,
  extractionType: ExtractionType,
  role?: string,
  options?: {
    attributeName?: string;
    baseUrl?: string;
  }
): string | null {
  if (!element) return null;

  const baseUrl = options?.baseUrl || '';

  switch (extractionType) {
    case 'text': {
      const text = extractText(element);
      // Special handling for price roles - extract lowest price
      if (role === 'price' && text) {
        return extractLowestPrice(text);
      }
      return text;
    }

    case 'href':
      return extractHref(element, baseUrl);

    case 'src':
      return extractSrc(element, baseUrl);

    case 'attribute':
      return extractAttribute(element, options?.attributeName || '');

    case 'innerHTML':
      return extractInnerHTML(element);

    default:
      // Default to text extraction
      return extractText(element);
  }
}

/**
 * Extract value using an AssignedSelector configuration
 */
export function extractFromSelector(
  element: Element | null,
  selector: AssignedSelector,
  baseUrl: string = ''
): string | null {
  return extractValue(element, selector.extractionType as ExtractionType, selector.role, {
    attributeName: selector.attributeName,
    baseUrl,
  });
}

/**
 * Find element using selector with fallback strategies
 * Tries the exact CSS selector first, then various fallbacks
 */
export function findElement(
  container: Element,
  selector: AssignedSelector
): Element | null {
  const css = selector.selector.css;

  // Special handling for :parent-link - look UP the DOM
  if (css === ':parent-link') {
    return container.closest('a[href]');
  }

  // Strategy 1: Use the selector directly
  let element = container.querySelector(css);
  if (element) return element;

  // Strategy 2: Try with container context (for complex selectors)
  if (css.includes(' ')) {
    const parts = css.split(' ');
    for (let i = Math.min(3, parts.length); i >= 1 && !element; i--) {
      const partialSelector = parts.slice(-i).join(' ');
      try {
        element = container.querySelector(partialSelector);
      } catch {
        // Invalid selector, continue
      }
    }
  }

  // Strategy 3: Try by tag + class from selector metadata
  if (!element && selector.selector.tagName) {
    const tagSelector = selector.selector.tagName.toLowerCase();
    const classAttr = selector.selector.attributes?.class;
    if (classAttr) {
      const firstClass = classAttr.split(' ')[0];
      element =
        container.querySelector(`${tagSelector}.${firstClass}`) ||
        container.querySelector(`.${firstClass}`) ||
        container.querySelector(tagSelector);
    } else {
      element = container.querySelector(tagSelector);
    }
  }

  return element;
}

/**
 * Browser-compatible version for injection into page context
 */
export function getBrowserValueExtractorScript(): string {
  return `
    (function() {
      var LAZY_SRC_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-srcset'];
      var PLACEHOLDER_PATTERNS = ['placeholder', 'loading', 'blank', 'data:image', 'spacer', '1x1', 'pixel'];

      function isPlaceholder(url) {
        if (!url) return true;
        var lower = url.toLowerCase();
        for (var i = 0; i < PLACEHOLDER_PATTERNS.length; i++) {
          if (lower.indexOf(PLACEHOLDER_PATTERNS[i]) !== -1) return true;
        }
        return false;
      }

      function resolveUrl(url, baseUrl) {
        if (!url) return null;
        if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
        if (url.indexOf('//') === 0) return 'https:' + url;
        try {
          return new URL(url, baseUrl || window.location.origin).href;
        } catch (e) {
          return url;
        }
      }

      function extractText(el) {
        if (!el) return null;
        var text = (el.textContent || '').trim();
        return text ? text.replace(/\\s+/g, ' ') : null;
      }

      function extractHref(el, baseUrl) {
        if (!el) return null;
        var href = el.getAttribute('href');
        if (!href || href === '#') return null;
        return resolveUrl(href, baseUrl);
      }

      function extractSrc(el, baseUrl) {
        if (!el) return null;
        var src = el.getAttribute('src');
        if (isPlaceholder(src)) {
          for (var i = 0; i < LAZY_SRC_ATTRS.length; i++) {
            var lazySrc = el.getAttribute(LAZY_SRC_ATTRS[i]);
            if (lazySrc && !isPlaceholder(lazySrc)) {
              src = lazySrc;
              break;
            }
          }
        }
        if (isPlaceholder(src)) return null;
        if (src && (src.indexOf(',') !== -1 || src.indexOf(' ') !== -1)) {
          var firstUrl = src.split(',')[0].split(' ')[0].trim();
          if (firstUrl) src = firstUrl;
        }
        return resolveUrl(src, baseUrl);
      }

      function extractValue(el, type, options) {
        if (!el) return null;
        var baseUrl = options && options.baseUrl ? options.baseUrl : window.location.origin;
        switch (type) {
          case 'text':
            return extractText(el);
          case 'href':
            return extractHref(el, baseUrl);
          case 'src':
            return extractSrc(el, baseUrl);
          case 'attribute':
            return options && options.attributeName ? el.getAttribute(options.attributeName) : null;
          case 'innerHTML':
            return el.innerHTML || null;
          default:
            return extractText(el);
        }
      }

      function findElement(container, css, metadata) {
        if (css === ':parent-link') {
          return container.closest('a[href]');
        }
        var el = container.querySelector(css);
        if (el) return el;
        if (css.indexOf(' ') !== -1) {
          var parts = css.split(' ');
          for (var i = Math.min(3, parts.length); i >= 1 && !el; i--) {
            try {
              el = container.querySelector(parts.slice(-i).join(' '));
            } catch (e) {}
          }
        }
        if (!el && metadata && metadata.tagName) {
          var tag = metadata.tagName.toLowerCase();
          var classAttr = metadata.attributes && metadata.attributes.class;
          if (classAttr) {
            var firstClass = classAttr.split(' ')[0];
            el = container.querySelector(tag + '.' + firstClass) ||
                 container.querySelector('.' + firstClass) ||
                 container.querySelector(tag);
          } else {
            el = container.querySelector(tag);
          }
        }
        return el;
      }

      return {
        extractValue: extractValue,
        findElement: findElement,
        extractText: extractText,
        extractHref: extractHref,
        extractSrc: extractSrc
      };
    })()
  `;
}
