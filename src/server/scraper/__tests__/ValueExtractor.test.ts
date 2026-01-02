import { describe, test, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  isPlaceholderUrl,
  resolveUrl,
  extractText,
  extractHref,
  extractSrc,
  extractAttribute,
  extractInnerHTML,
  extractValue,
} from '../utils/ValueExtractor.js';

describe('ValueExtractor', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="container">
            <h1 id="title">  Product Title  </h1>
            <p id="price">£25.99</p>
            <a id="link" href="/products/item-1">View Product</a>
            <a id="external-link" href="https://example.com/page">External</a>
            <a id="empty-link" href="#">Empty</a>
            <img id="img-normal" src="https://cdn.example.com/image.jpg" />
            <img id="img-lazy" src="data:image/gif;base64,placeholder" data-src="https://cdn.example.com/real.jpg" />
            <img id="img-lazy-2" src="/placeholder.png" data-lazy-src="https://cdn.example.com/lazy.jpg" />
            <img id="img-srcset" src="small.jpg 480w, medium.jpg 800w" />
            <div id="custom-attr" data-product-id="12345">Content</div>
            <div id="html-content"><strong>Bold</strong> text</div>
            <span id="whitespace">  Multiple   spaces   here  </span>
          </div>
        </body>
      </html>
    `);
    document = dom.window.document;
  });

  describe('isPlaceholderUrl', () => {
    test('returns true for placeholder patterns', () => {
      expect(isPlaceholderUrl('placeholder.png')).toBe(true);
      expect(isPlaceholderUrl('/images/loading.gif')).toBe(true);
      expect(isPlaceholderUrl('blank.jpg')).toBe(true);
      expect(isPlaceholderUrl('data:image/gif;base64,abc')).toBe(true);
      expect(isPlaceholderUrl('/spacer.gif')).toBe(true);
      expect(isPlaceholderUrl('/1x1.gif')).toBe(true);
    });

    test('returns false for real image URLs', () => {
      expect(isPlaceholderUrl('https://cdn.example.com/product.jpg')).toBe(false);
      expect(isPlaceholderUrl('/images/hero.png')).toBe(false);
    });

    test('returns true for null/undefined', () => {
      expect(isPlaceholderUrl(null)).toBe(true);
      expect(isPlaceholderUrl(undefined)).toBe(true);
    });
  });

  describe('resolveUrl', () => {
    const baseUrl = 'https://example.com';

    test('returns absolute URLs unchanged', () => {
      expect(resolveUrl('https://other.com/image.jpg', baseUrl)).toBe('https://other.com/image.jpg');
      expect(resolveUrl('http://other.com/image.jpg', baseUrl)).toBe('http://other.com/image.jpg');
    });

    test('resolves relative URLs', () => {
      expect(resolveUrl('/images/product.jpg', baseUrl)).toBe('https://example.com/images/product.jpg');
      expect(resolveUrl('product.jpg', baseUrl)).toBe('https://example.com/product.jpg');
    });

    test('handles protocol-relative URLs', () => {
      expect(resolveUrl('//cdn.example.com/image.jpg', baseUrl)).toBe('https://cdn.example.com/image.jpg');
    });

    test('returns null for null/undefined', () => {
      expect(resolveUrl(null, baseUrl)).toBeNull();
      expect(resolveUrl(undefined, baseUrl)).toBeNull();
    });
  });

  describe('extractText', () => {
    test('extracts and trims text content', () => {
      const el = document.getElementById('title');
      expect(extractText(el)).toBe('Product Title');
    });

    test('normalizes internal whitespace', () => {
      const el = document.getElementById('whitespace');
      expect(extractText(el)).toBe('Multiple spaces here');
    });

    test('returns null for null element', () => {
      expect(extractText(null)).toBeNull();
    });

    test('returns null for empty text', () => {
      const el = document.createElement('div');
      el.textContent = '   ';
      expect(extractText(el)).toBeNull();
    });
  });

  describe('extractHref', () => {
    test('extracts href attribute', () => {
      const el = document.getElementById('link');
      expect(extractHref(el, 'https://example.com')).toBe('https://example.com/products/item-1');
    });

    test('returns absolute URLs unchanged', () => {
      const el = document.getElementById('external-link');
      expect(extractHref(el, 'https://example.com')).toBe('https://example.com/page');
    });

    test('returns null for empty hash links', () => {
      const el = document.getElementById('empty-link');
      expect(extractHref(el, 'https://example.com')).toBeNull();
    });

    test('returns null for null element', () => {
      expect(extractHref(null, 'https://example.com')).toBeNull();
    });
  });

  describe('extractSrc', () => {
    test('extracts normal src', () => {
      const el = document.getElementById('img-normal');
      expect(extractSrc(el, '')).toBe('https://cdn.example.com/image.jpg');
    });

    test('falls back to data-src for placeholder', () => {
      const el = document.getElementById('img-lazy');
      expect(extractSrc(el, '')).toBe('https://cdn.example.com/real.jpg');
    });

    test('falls back to data-lazy-src', () => {
      const el = document.getElementById('img-lazy-2');
      expect(extractSrc(el, 'https://example.com')).toBe('https://cdn.example.com/lazy.jpg');
    });

    test('returns null for null element', () => {
      expect(extractSrc(null, '')).toBeNull();
    });
  });

  describe('extractAttribute', () => {
    test('extracts custom attribute', () => {
      const el = document.getElementById('custom-attr');
      expect(extractAttribute(el, 'data-product-id')).toBe('12345');
    });

    test('returns null for missing attribute', () => {
      const el = document.getElementById('custom-attr');
      expect(extractAttribute(el, 'data-missing')).toBeNull();
    });

    test('returns null for null element', () => {
      expect(extractAttribute(null, 'data-product-id')).toBeNull();
    });
  });

  describe('extractInnerHTML', () => {
    test('extracts innerHTML', () => {
      const el = document.getElementById('html-content');
      expect(extractInnerHTML(el)).toBe('<strong>Bold</strong> text');
    });

    test('returns null for null element', () => {
      expect(extractInnerHTML(null)).toBeNull();
    });
  });

  describe('extractValue', () => {
    test('extracts text by default', () => {
      const el = document.getElementById('title');
      expect(extractValue(el, 'text')).toBe('Product Title');
    });

    test('extracts href', () => {
      const el = document.getElementById('link');
      expect(extractValue(el, 'href', undefined, { baseUrl: 'https://example.com' })).toBe(
        'https://example.com/products/item-1'
      );
    });

    test('extracts src', () => {
      const el = document.getElementById('img-normal');
      expect(extractValue(el, 'src')).toBe('https://cdn.example.com/image.jpg');
    });

    test('extracts attribute', () => {
      const el = document.getElementById('custom-attr');
      expect(extractValue(el, 'attribute', undefined, { attributeName: 'data-product-id' })).toBe('12345');
    });

    test('extracts innerHTML', () => {
      const el = document.getElementById('html-content');
      expect(extractValue(el, 'innerHTML')).toBe('<strong>Bold</strong> text');
    });

    test('returns null for null element', () => {
      expect(extractValue(null, 'text')).toBeNull();
    });
  });
});
