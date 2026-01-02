import { describe, test, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  isValidContainer,
  hasProductClass,
  buildSelector,
  scoreCandidate,
  findContainers,
} from '../utils/ContainerDetector.js';
import type { AssignedSelector } from '../../../shared/types.js';

describe('ContainerDetector', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <header>
            <nav>
              <ul>
                <li><a href="/">Home</a></li>
              </ul>
            </nav>
          </header>
          <main>
            <div class="product-grid">
              <div class="product-card" data-id="1">
                <h3 class="product-title">Product 1</h3>
                <span class="product-price">£25.99</span>
                <a href="/products/1">View</a>
              </div>
              <div class="product-card" data-id="2">
                <h3 class="product-title">Product 2</h3>
                <span class="product-price">£35.99</span>
                <a href="/products/2">View</a>
              </div>
              <div class="product-card" data-id="3">
                <h3 class="product-title">Product 3</h3>
                <span class="product-price">£45.99</span>
                <a href="/products/3">View</a>
              </div>
            </div>
          </main>
          <footer>
            <div class="footer-links">
              <a href="/about">About</a>
            </div>
          </footer>
        </body>
      </html>
    `);
    document = dom.window.document;
  });

  describe('isValidContainer', () => {
    test('returns true for valid div containers', () => {
      const el = document.querySelector('.product-card');
      expect(isValidContainer(el!)).toBe(true);
    });

    test('returns false for navigation elements', () => {
      const nav = document.querySelector('nav');
      expect(isValidContainer(nav!)).toBe(false);
    });

    test('returns false for header elements', () => {
      const header = document.querySelector('header');
      expect(isValidContainer(header!)).toBe(false);
    });

    test('returns false for footer elements', () => {
      const footer = document.querySelector('footer');
      expect(isValidContainer(footer!)).toBe(false);
    });

    test('returns false for button elements', () => {
      const button = document.createElement('button');
      expect(isValidContainer(button)).toBe(false);
    });

    test('returns false for link elements', () => {
      const link = document.querySelector('a');
      expect(isValidContainer(link!)).toBe(false);
    });

    test('returns false for elements inside nav', () => {
      const li = document.querySelector('nav li');
      expect(isValidContainer(li!)).toBe(false);
    });

    test('returns true for li with product class', () => {
      const li = document.createElement('li');
      li.className = 'product-item';
      document.body.appendChild(li);
      expect(isValidContainer(li)).toBe(true);
    });

    test('returns false for li without product class', () => {
      const li = document.createElement('li');
      li.className = 'menu-item';
      document.body.appendChild(li);
      expect(isValidContainer(li)).toBe(false);
    });
  });

  describe('hasProductClass', () => {
    test('returns true for product-related classes', () => {
      const el = document.querySelector('.product-card');
      expect(hasProductClass(el!)).toBe(true);
    });

    test('returns true for item classes', () => {
      const el = document.createElement('div');
      el.className = 'item-wrapper';
      expect(hasProductClass(el)).toBe(true);
    });

    test('returns true for card classes', () => {
      const el = document.createElement('div');
      el.className = 'data-card';
      expect(hasProductClass(el)).toBe(true);
    });

    test('returns false for non-product classes', () => {
      const el = document.createElement('div');
      el.className = 'navigation-wrapper';
      expect(hasProductClass(el)).toBe(false);
    });

    test('returns false for elements without classes', () => {
      const el = document.createElement('div');
      expect(hasProductClass(el)).toBe(false);
    });
  });

  describe('buildSelector', () => {
    test('prioritizes product-related classes', () => {
      const el = document.querySelector('.product-card');
      const selectors = buildSelector(el!);
      expect(selectors[0]).toBe('div.product-card');
    });

    test('returns tag-only as fallback', () => {
      const el = document.createElement('div');
      const selectors = buildSelector(el);
      expect(selectors).toContain('div');
    });

    test('filters out modifier classes', () => {
      const el = document.createElement('div');
      el.className = 'product-card product-card--featured is-active';
      const selectors = buildSelector(el);
      expect(selectors[0]).toBe('div.product-card');
    });
  });

  describe('scoreCandidate', () => {
    test('returns 0 for too few containers', () => {
      const containers = [document.createElement('div')];
      expect(scoreCandidate(containers, 1, 5, false)).toBe(0);
    });

    test('returns 0 for too many containers', () => {
      const containers = Array(600).fill(document.createElement('div'));
      expect(scoreCandidate(containers, 100, 100, false)).toBe(0);
    });

    test('returns 0 for low containment ratio', () => {
      const containers = Array(10).fill(document.createElement('div'));
      expect(scoreCandidate(containers, 1, 10, false)).toBe(0);
    });

    test('returns higher score for product classes', () => {
      const containers = Array(10).fill(document.createElement('div'));
      const scoreWithout = scoreCandidate(containers, 10, 10, false);
      const scoreWith = scoreCandidate(containers, 10, 10, true);
      expect(scoreWith).toBeGreaterThan(scoreWithout);
    });

    test('returns bonus for reasonable container count', () => {
      const containers10 = Array(10).fill(document.createElement('div'));
      const containers300 = Array(300).fill(document.createElement('div'));
      const score10 = scoreCandidate(containers10, 10, 10, false);
      const score300 = scoreCandidate(containers300, 100, 100, false);
      expect(score10).toBeGreaterThan(score300);
    });
  });

  describe('findContainers', () => {
    // Helper to create minimal selector for tests
    const makeSelector = (css: string): AssignedSelector['selector'] => ({
      css,
      attributes: {},
      tagName: 'div',
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    });

    test('finds product containers from selectors', () => {
      const selectors: AssignedSelector[] = [
        {
          role: 'title',
          selector: makeSelector('.product-title'),
          extractionType: 'text',
        },
        {
          role: 'price',
          selector: makeSelector('.product-price'),
          extractionType: 'text',
        },
      ];

      const result = findContainers(selectors, document);
      expect(result).not.toBeNull();
      expect(result!.containers.length).toBe(3);
      expect(result!.selector).toBe('div.product-card');
    });

    test('returns null when not enough selectors match', () => {
      const selectors: AssignedSelector[] = [
        {
          role: 'title',
          selector: makeSelector('.nonexistent'),
          extractionType: 'text',
        },
      ];

      const result = findContainers(selectors, document);
      expect(result).toBeNull();
    });

    test('skips :parent-link selectors', () => {
      const selectors: AssignedSelector[] = [
        {
          role: 'title',
          selector: makeSelector('.product-title'),
          extractionType: 'text',
        },
        {
          role: 'url',
          selector: makeSelector(':parent-link'),
          extractionType: 'href',
        },
      ];

      // Should not throw
      const result = findContainers(selectors, document);
      expect(result).not.toBeNull();
    });
  });
});
