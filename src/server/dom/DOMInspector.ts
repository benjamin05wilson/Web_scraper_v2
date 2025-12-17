// ============================================================================
// DOM INSPECTOR - Element Selection & Selector Generation
// ============================================================================

import type { Page, CDPSession } from 'playwright';
import type { ElementSelector, DOMHighlight } from '../../shared/types.js';

// Script injected into the page for DOM inspection
const DOM_INSPECTION_SCRIPT = `
(function() {
  // Avoid re-injection
  if (window.__scraperInspectorActive) return;
  window.__scraperInspectorActive = true;

  // State
  let highlightElement = null;
  let lastHoveredElement = null;
  let isSelectionMode = false;

  // Create highlight overlay
  function createHighlight() {
    const el = document.createElement('div');
    el.id = '__scraper_highlight__';
    el.style.cssText = \`
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      border: 2px solid #0066ff;
      background: rgba(0, 102, 255, 0.1);
      transition: all 0.05s ease-out;
      display: none;
    \`;
    document.body.appendChild(el);
    return el;
  }

  // Get unique CSS selector for element
  function getCSSSelector(el) {
    if (!el || el === document.body || el === document.documentElement) {
      return el?.tagName?.toLowerCase() || '';
    }

    // Try ID first
    if (el.id && !el.id.match(/^[0-9]/)) {
      const idSelector = '#' + CSS.escape(el.id);
      if (document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    }

    // Try unique class combination
    if (el.classList.length > 0) {
      const classes = Array.from(el.classList)
        .filter(c => !c.match(/^[0-9]/) && !c.includes('hover') && !c.includes('active'))
        .map(c => '.' + CSS.escape(c))
        .join('');

      if (classes) {
        const classSelector = el.tagName.toLowerCase() + classes;
        if (document.querySelectorAll(classSelector).length === 1) {
          return classSelector;
        }
      }
    }

    // Try data attributes
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.value) {
        const dataSelector = el.tagName.toLowerCase() + '[' + attr.name + '="' + CSS.escape(attr.value) + '"]';
        if (document.querySelectorAll(dataSelector).length === 1) {
          return dataSelector;
        }
      }
    }

    // Build path selector
    const path = [];
    let current = el;

    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();

      // Add unique identifier if available
      if (current.id && !current.id.match(/^[0-9]/)) {
        selector = '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      }

      // Add class if useful
      const uniqueClass = Array.from(current.classList).find(c => {
        const sel = current.tagName.toLowerCase() + '.' + CSS.escape(c);
        return document.querySelectorAll(sel).length < 10;
      });

      if (uniqueClass) {
        selector += '.' + CSS.escape(uniqueClass);
      }

      // Add nth-child if needed
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  // Get XPath for element
  function getXPath(el) {
    if (!el) return '';

    if (el.id) {
      return '//*[@id="' + el.id + '"]';
    }

    const parts = [];
    let current = el;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;

      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }

      const tagName = current.tagName.toLowerCase();
      parts.unshift(tagName + '[' + index + ']');
      current = current.parentElement;
    }

    return '/' + parts.join('/');
  }

  // Get all relevant attributes
  function getAttributes(el) {
    const attrs = {};
    for (const attr of el.attributes) {
      if (!attr.name.startsWith('on')) { // Skip event handlers
        attrs[attr.name] = attr.value;
      }
    }
    return attrs;
  }

  // Get a generic selector that matches similar elements (for scraping multiple items)
  function getGenericSelector(el) {
    const tag = el.tagName.toLowerCase();

    // Strategy 1: Find a class that matches multiple similar elements
    if (el.classList.length > 0) {
      for (const className of el.classList) {
        // Skip dynamic/state classes
        if (className.match(/^[0-9]|hover|active|focus|selected|current|open|close/i)) continue;

        const classSelector = tag + '.' + CSS.escape(className);
        const matches = document.querySelectorAll(classSelector);

        // Good if it matches 2+ elements but not too many (likely structural)
        if (matches.length >= 2 && matches.length <= 100) {
          // Verify these are similar elements (same parent type or structure)
          const firstParent = matches[0].parentElement?.tagName;
          const allSameParent = Array.from(matches).every(m => m.parentElement?.tagName === firstParent);
          if (allSameParent) {
            return classSelector;
          }
        }
      }
    }

    // Strategy 2: Find data attribute pattern
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.name !== 'data-id') {
        // Try selector with just the attribute name (any value)
        const attrSelector = tag + '[' + attr.name + ']';
        const matches = document.querySelectorAll(attrSelector);
        if (matches.length >= 2 && matches.length <= 100) {
          return attrSelector;
        }
      }
    }

    // Strategy 3: Look for common parent with repeating structure
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length >= 2) {
        // Find a class on parent that identifies the container
        for (const parentClass of parent.classList) {
          if (parentClass.match(/list|grid|items|products|results|container|wrapper/i)) {
            return '.' + CSS.escape(parentClass) + ' > ' + tag;
          }
        }
        // Fallback: use parent tag + child tag
        const parentTag = parent.tagName.toLowerCase();
        const selector = parentTag + ' > ' + tag;
        const matches = document.querySelectorAll(selector);
        if (matches.length >= 2 && matches.length <= 100) {
          return selector;
        }
      }
    }

    // Strategy 4: Use tag + partial class match for common patterns
    const commonPatterns = ['title', 'name', 'price', 'description', 'image', 'link', 'item', 'product', 'card'];
    for (const className of el.classList) {
      const lowerClass = className.toLowerCase();
      for (const pattern of commonPatterns) {
        if (lowerClass.includes(pattern)) {
          const selector = tag + '.' + CSS.escape(className);
          const matches = document.querySelectorAll(selector);
          if (matches.length >= 2) {
            return selector;
          }
        }
      }
    }

    return null;
  }

  // Build element info
  function getElementInfo(el) {
    const rect = el.getBoundingClientRect();
    const genericSelector = getGenericSelector(el);
    const genericCount = genericSelector ? document.querySelectorAll(genericSelector).length : 0;

    return {
      css: getCSSSelector(el),
      cssGeneric: genericSelector,
      cssGenericCount: genericCount,
      xpath: getXPath(el),
      text: el.textContent?.trim().substring(0, 100) || null,
      tagName: el.tagName.toLowerCase(),
      attributes: getAttributes(el),
      boundingBox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }
    };
  }

  // Update highlight position
  function updateHighlight(el) {
    if (!highlightElement) highlightElement = createHighlight();

    if (!el) {
      highlightElement.style.display = 'none';
      return;
    }

    const rect = el.getBoundingClientRect();
    highlightElement.style.display = 'block';
    highlightElement.style.top = rect.top + 'px';
    highlightElement.style.left = rect.left + 'px';
    highlightElement.style.width = rect.width + 'px';
    highlightElement.style.height = rect.height + 'px';
  }

  // Get best element at point (skip overlays, ads, invisible elements)
  function getBestElementAtPoint(x, y) {
    // Get all elements at this point using elementsFromPoint
    const elements = document.elementsFromPoint(x, y);

    // Tags to skip - usually overlays, ads, or non-content
    const skipTags = ['ins', 'iframe', 'script', 'style', 'noscript'];
    const skipClasses = ['overlay', 'modal', 'popup', 'ad-', 'banner', 'cookie', 'gdpr', 'consent'];
    const skipIds = ['__scraper_highlight__'];

    for (const el of elements) {
      // Skip our own elements
      if (skipIds.includes(el.id)) continue;
      if (el.className && typeof el.className === 'string' && el.className.includes('__scraper_')) continue;

      // Skip non-content tags
      const tag = el.tagName.toLowerCase();
      if (skipTags.includes(tag)) continue;

      // Skip if invisible or zero-size
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.opacity === '0') continue;
      if (style.pointerEvents === 'none' && tag !== 'img') continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Skip elements with skip classes
      const classStr = (typeof el.className === 'string' ? el.className : '').toLowerCase();
      if (skipClasses.some(c => classStr.includes(c))) continue;

      // Skip if element covers entire viewport (likely a container/wrapper)
      if (rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95) {
        continue;
      }

      // Prefer elements with actual text content or meaningful attributes
      const hasText = el.textContent && el.textContent.trim().length > 0 && el.textContent.trim().length < 500;
      const hasHref = el.hasAttribute('href');
      const hasSrc = el.hasAttribute('src');
      const isInteractive = ['a', 'button', 'input', 'select', 'img'].includes(tag);

      // Good candidate if it has content or is interactive
      if (hasText || hasHref || hasSrc || isInteractive) {
        return el;
      }

      // Also accept if it's a reasonably-sized container
      if (rect.width < window.innerWidth * 0.8 && rect.height < window.innerHeight * 0.8) {
        return el;
      }
    }

    // Fallback to first non-scraper element
    return elements.find(el =>
      el.id !== '__scraper_highlight__' &&
      !(el.className && typeof el.className === 'string' && el.className.includes('__scraper_'))
    ) || null;
  }

  // Handle mouse move - only update cursor, no highlighting
  function onMouseMove(e) {
    if (!isSelectionMode) return;
    // Just change cursor to indicate clickable - no highlight on hover
    document.body.style.cursor = 'crosshair';
  }

  // Handle click (for selection) - highlight only on click
  function onClick(e) {
    if (!isSelectionMode) return;

    e.preventDefault();
    e.stopPropagation();

    const el = getBestElementAtPoint(e.clientX, e.clientY);
    if (el && el.id !== '__scraper_highlight__') {
      // Update highlight to show what was clicked
      updateHighlight(el);
      lastHoveredElement = el;

      // Send selection event
      window.__scraperSendSelect?.(getElementInfo(el));
    }

    return false;
  }

  // Public API
  window.__scraperInspector = {
    enable() {
      isSelectionMode = true;
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('click', onClick, true);
    },

    disable() {
      isSelectionMode = false;
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      updateHighlight(null);
      lastHoveredElement = null;
      document.body.style.cursor = '';
    },

    getElementAtPoint(x, y) {
      const el = getBestElementAtPoint(x, y);
      return el ? getElementInfo(el) : null;
    },

    querySelector(selector) {
      try {
        const el = document.querySelector(selector);
        return el ? getElementInfo(el) : null;
      } catch {
        return null;
      }
    },

    querySelectorAll(selector) {
      try {
        const els = document.querySelectorAll(selector);
        return Array.from(els).map(getElementInfo);
      } catch {
        return [];
      }
    },

    highlightSelector(selector) {
      try {
        const el = document.querySelector(selector);
        updateHighlight(el);
        return !!el;
      } catch {
        updateHighlight(null);
        return false;
      }
    },

    clearHighlight() {
      updateHighlight(null);
    },

    testSelector(selector) {
      try {
        const els = document.querySelectorAll(selector);
        return {
          valid: true,
          count: els.length,
          elements: Array.from(els).slice(0, 10).map(getElementInfo)
        };
      } catch (e) {
        return {
          valid: false,
          error: e.message,
          count: 0,
          elements: []
        };
      }
    },

    // Find common selector pattern between multiple selected elements
    findCommonPattern(elements) {
      if (!elements || elements.length < 2) return null;

      // Get the actual DOM elements from selectors
      const domElements = elements.map(sel => document.querySelector(sel.css)).filter(Boolean);
      if (domElements.length < 2) return null;

      const targetTag = domElements[0].tagName.toLowerCase();

      // Strategy 1: Find common classes on the elements themselves
      const classSets = domElements.map(el => new Set(el.classList));
      const commonClasses = [...classSets[0]].filter(cls =>
        classSets.every(set => set.has(cls)) &&
        !cls.match(/^[0-9]|hover|active|focus|selected|current|open|close/i)
      );

      if (commonClasses.length > 0) {
        // Try each common class
        for (const cls of commonClasses) {
          const selector = targetTag + '.' + CSS.escape(cls);
          const matches = document.querySelectorAll(selector);
          if (matches.length >= elements.length && matches.length <= 200) {
            return { selector, count: matches.length };
          }
        }
      }

      // Strategy 2: Find common ancestor with ID or unique class + descendant tag path
      // This handles cases like: #product-fill .data-pushed h2 > a > span
      function getAncestorPath(el) {
        const path = [];
        let curr = el;
        while (curr && curr !== document.body && curr !== document.documentElement) {
          const info = { tag: curr.tagName.toLowerCase(), id: curr.id, classes: Array.from(curr.classList) };
          path.unshift(info);
          curr = curr.parentElement;
        }
        return path;
      }

      const ancestorPaths = domElements.map(getAncestorPath);
      const minPathLen = Math.min(...ancestorPaths.map(p => p.length));

      // Find the deepest common ancestor with a unique identifier (ID or meaningful class)
      let bestAncestorSelector = null;
      let bestAncestorDepth = -1;

      for (let depth = 0; depth < minPathLen; depth++) {
        const ancestorsAtDepth = ancestorPaths.map(p => p[depth]);

        // Check if all elements share same ID at this depth
        const firstId = ancestorsAtDepth[0].id;
        if (firstId && !firstId.match(/^[0-9]/) && ancestorsAtDepth.every(a => a.id === firstId)) {
          bestAncestorSelector = '#' + CSS.escape(firstId);
          bestAncestorDepth = depth;
        }

        // Check for common meaningful class at this depth
        const firstClasses = ancestorsAtDepth[0].classes.filter(c =>
          !c.match(/^[0-9]|hover|active|focus|selected|current|open|close|ng-|_|js-/i) &&
          c.length > 2
        );
        for (const cls of firstClasses) {
          if (ancestorsAtDepth.every(a => a.classes.includes(cls))) {
            // Prefer classes that seem semantic
            if (cls.match(/product|item|card|entry|post|article|result|listing|row|data/i)) {
              const testSel = '.' + CSS.escape(cls);
              const matches = document.querySelectorAll(testSel);
              if (matches.length <= 200) {
                bestAncestorSelector = testSel;
                bestAncestorDepth = depth;
              }
            }
          }
        }
      }

      if (bestAncestorSelector && bestAncestorDepth >= 0) {
        // Build a descendant selector from the common ancestor to the target element
        // Get the tag path from ancestor to target (using the remaining path)
        const remainingPath = ancestorPaths[0].slice(bestAncestorDepth + 1);

        // Try different combinations:
        // 1. Just ancestor + target tag
        let selector = bestAncestorSelector + ' ' + targetTag;
        let matches = document.querySelectorAll(selector);
        if (matches.length >= elements.length && matches.length <= 200) {
          return { selector, count: matches.length };
        }

        // 2. Ancestor + last 2-3 tags in path (e.g., "h2 > a > span")
        if (remainingPath.length >= 2) {
          const lastTags = remainingPath.slice(-3).map(p => p.tag).join(' > ');
          selector = bestAncestorSelector + ' ' + lastTags;
          matches = document.querySelectorAll(selector);
          if (matches.length >= elements.length && matches.length <= 200) {
            return { selector, count: matches.length };
          }
        }

        // 3. Try with intermediate class if available
        for (let i = remainingPath.length - 1; i >= 0; i--) {
          const node = remainingPath[i];
          const meaningfulClass = node.classes.find(c =>
            !c.match(/^[0-9]|hover|active|focus|selected|current|open|close|ng-|_|js-/i) &&
            c.length > 2
          );
          if (meaningfulClass) {
            selector = bestAncestorSelector + ' .' + CSS.escape(meaningfulClass) + ' ' + targetTag;
            matches = document.querySelectorAll(selector);
            if (matches.length >= elements.length && matches.length <= 200) {
              return { selector, count: matches.length };
            }
          }
        }
      }

      // Strategy 3: Find common parent structure
      const parents = domElements.map(el => el.parentElement);
      if (parents.every(p => p && p.tagName === parents[0]?.tagName)) {
        // Same parent tag type - look for common container class
        const grandparents = parents.map(p => p?.parentElement);
        for (const gp of grandparents) {
          if (!gp) continue;
          for (const cls of gp.classList) {
            if (cls.match(/list|grid|items|products|results|container|wrapper|row|col/i)) {
              const selector = '.' + CSS.escape(cls) + ' ' + targetTag;
              const matches = document.querySelectorAll(selector);
              if (matches.length >= elements.length) {
                return { selector, count: matches.length };
              }
            }
          }
        }
      }

      // Strategy 4: Find common data attributes
      const attrSets = domElements.map(el => {
        const attrs = {};
        for (const attr of el.attributes) {
          if (attr.name.startsWith('data-') || attr.name === 'role' || attr.name === 'itemprop') {
            attrs[attr.name] = true;
          }
        }
        return attrs;
      });

      const commonAttrs = Object.keys(attrSets[0]).filter(attr =>
        attrSets.every(set => set[attr])
      );

      for (const attr of commonAttrs) {
        const selector = targetTag + '[' + attr + ']';
        const matches = document.querySelectorAll(selector);
        if (matches.length >= elements.length && matches.length <= 200) {
          return { selector, count: matches.length };
        }
      }

      // Strategy 5: Use common tag path structure (more lenient)
      const paths = domElements.map(el => {
        const path = [];
        let curr = el;
        while (curr && curr !== document.body) {
          path.unshift(curr.tagName.toLowerCase());
          curr = curr.parentElement;
        }
        return path;
      });

      // Find common path prefix
      const pathMinLen = Math.min(...paths.map(p => p.length));
      let commonLen = 0;
      for (let i = 0; i < pathMinLen; i++) {
        if (paths.every(p => p[i] === paths[0][i])) {
          commonLen = i + 1;
        } else {
          break;
        }
      }

      if (commonLen > 0 && commonLen < paths[0].length) {
        const selector = paths[0].slice(0, commonLen).join(' > ') + ' ' + targetTag;
        const matches = document.querySelectorAll(selector);
        if (matches.length >= elements.length) {
          return { selector, count: matches.length };
        }
      }

      // Strategy 6: Last resort - find any common ancestor ID and use descendant
      for (const el of domElements) {
        let curr = el.parentElement;
        while (curr && curr !== document.body) {
          if (curr.id && !curr.id.match(/^[0-9]/)) {
            const selector = '#' + CSS.escape(curr.id) + ' ' + targetTag;
            const matches = document.querySelectorAll(selector);
            // Check that this selector matches all our elements
            const matchesAll = domElements.every(de =>
              Array.from(matches).includes(de)
            );
            if (matchesAll && matches.length <= 200) {
              return { selector, count: matches.length };
            }
          }
          curr = curr.parentElement;
        }
      }

      return null;
    },

    // Highlight ALL elements matching a selector
    highlightAll(selector) {
      try {
        // Remove existing multi-highlights and scroll listener
        document.querySelectorAll('.__scraper_multi_highlight__').forEach(el => el.remove());
        if (window.__scraperScrollHandler) {
          window.removeEventListener('scroll', window.__scraperScrollHandler, true);
        }

        const matches = document.querySelectorAll(selector);
        const highlights = [];

        matches.forEach((el, idx) => {
          const rect = el.getBoundingClientRect();
          const highlight = document.createElement('div');
          highlight.className = '__scraper_multi_highlight__';
          highlight.dataset.targetIndex = String(idx);
          highlight.style.cssText = \`
            position: fixed;
            pointer-events: none;
            z-index: 2147483646;
            border: 2px solid #00cc66;
            background: rgba(0, 204, 102, 0.15);
            top: \${rect.top}px;
            left: \${rect.left}px;
            width: \${rect.width}px;
            height: \${rect.height}px;
            transition: none;
          \`;
          document.body.appendChild(highlight);
          highlights.push({ highlight, target: el });
        });

        // Store for scroll updates
        window.__scraperHighlights = { selector, highlights };

        // Update positions on scroll
        const updatePositions = () => {
          if (!window.__scraperHighlights) return;
          window.__scraperHighlights.highlights.forEach(({ highlight, target }) => {
            const rect = target.getBoundingClientRect();
            highlight.style.top = rect.top + 'px';
            highlight.style.left = rect.left + 'px';
            highlight.style.width = rect.width + 'px';
            highlight.style.height = rect.height + 'px';
          });
        };

        window.__scraperScrollHandler = updatePositions;
        window.addEventListener('scroll', updatePositions, true);

        return matches.length;
      } catch (e) {
        return 0;
      }
    },

    // Clear all multi-highlights
    clearMultiHighlight() {
      document.querySelectorAll('.__scraper_multi_highlight__').forEach(el => el.remove());
      if (window.__scraperScrollHandler) {
        window.removeEventListener('scroll', window.__scraperScrollHandler, true);
        window.__scraperScrollHandler = null;
      }
      window.__scraperHighlights = null;
    }
  };
})();
`;

export class DOMInspector {
  private page: Page;
  private cdp: CDPSession;
  private isInjected: boolean = false;
  private onHover?: (info: ElementSelector) => void;
  private onSelect?: (info: ElementSelector) => void;

  constructor(page: Page, cdp: CDPSession) {
    this.page = page;
    this.cdp = cdp;
  }

  async inject(): Promise<void> {
    if (this.isInjected) return;

    // Inject the inspection script
    await this.page.evaluate(DOM_INSPECTION_SCRIPT);

    // Set up callbacks
    await this.page.exposeFunction('__scraperSendHover', (info: ElementSelector) => {
      this.onHover?.(info);
    });

    await this.page.exposeFunction('__scraperSendSelect', (info: ElementSelector) => {
      this.onSelect?.(info);
    });

    this.isInjected = true;
    console.log('[DOMInspector] Injected successfully');
  }

  async reinject(): Promise<void> {
    // Re-inject after navigation
    await this.page.evaluate(DOM_INSPECTION_SCRIPT);
  }

  async enableSelectionMode(): Promise<void> {
    await this.inject();
    await this.page.evaluate(() => {
      (window as any).__scraperInspector?.enable();
    });
    console.log('[DOMInspector] Selection mode enabled');
  }

  async disableSelectionMode(): Promise<void> {
    await this.page.evaluate(() => {
      (window as any).__scraperInspector?.disable();
    });
    console.log('[DOMInspector] Selection mode disabled');
  }

  setHoverCallback(callback: (info: ElementSelector) => void): void {
    this.onHover = callback;
  }

  setSelectCallback(callback: (info: ElementSelector) => void): void {
    this.onSelect = callback;
  }

  async getElementAtPoint(x: number, y: number): Promise<ElementSelector | null> {
    await this.inject();
    return await this.page.evaluate((coords) => {
      return (window as any).__scraperInspector?.getElementAtPoint(coords.x, coords.y) || null;
    }, { x, y });
  }

  async testSelector(selector: string): Promise<{
    valid: boolean;
    count: number;
    error?: string;
    elements: ElementSelector[];
  }> {
    await this.inject();
    return await this.page.evaluate((sel) => {
      return (window as any).__scraperInspector?.testSelector(sel) || {
        valid: false,
        error: 'Inspector not available',
        count: 0,
        elements: [],
      };
    }, selector);
  }

  async highlightSelector(selector: string): Promise<boolean> {
    await this.inject();
    return await this.page.evaluate((sel) => {
      return (window as any).__scraperInspector?.highlightSelector(sel) || false;
    }, selector);
  }

  async clearHighlight(): Promise<void> {
    await this.page.evaluate(() => {
      (window as any).__scraperInspector?.clearHighlight();
    });
  }

  async querySelector(selector: string): Promise<ElementSelector | null> {
    await this.inject();
    return await this.page.evaluate((sel) => {
      return (window as any).__scraperInspector?.querySelector(sel) || null;
    }, selector);
  }

  async querySelectorAll(selector: string): Promise<ElementSelector[]> {
    await this.inject();
    return await this.page.evaluate((sel) => {
      return (window as any).__scraperInspector?.querySelectorAll(sel) || [];
    }, selector);
  }

  // =========================================================================
  // CDP-based highlighting (alternative approach for overlay)
  // =========================================================================

  async highlightWithCDP(selector: string): Promise<DOMHighlight | null> {
    try {
      // Get document
      const { root } = await this.cdp.send('DOM.getDocument', { depth: 0 });

      // Query selector
      const { nodeId } = await this.cdp.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector,
      });

      if (!nodeId) return null;

      // Get box model
      const { model } = await this.cdp.send('DOM.getBoxModel', { nodeId });
      if (!model) return null;

      // Get node info
      const { node } = await this.cdp.send('DOM.describeNode', { nodeId });

      // Highlight using CDP Overlay
      await this.cdp.send('Overlay.highlightNode', {
        highlightConfig: {
          contentColor: { r: 0, g: 102, b: 255, a: 0.1 },
          borderColor: { r: 0, g: 102, b: 255, a: 1 },
          paddingColor: { r: 0, g: 102, b: 255, a: 0.05 },
        },
        nodeId,
      });

      // Calculate bounding box from content quad
      const quad = model.content;
      const x = Math.min(quad[0], quad[2], quad[4], quad[6]);
      const y = Math.min(quad[1], quad[3], quad[5], quad[7]);
      const width = Math.max(quad[0], quad[2], quad[4], quad[6]) - x;
      const height = Math.max(quad[1], quad[3], quad[5], quad[7]) - y;

      return {
        selector,
        boundingBox: { x, y, width, height },
        tagName: node.nodeName.toLowerCase(),
        className: node.attributes?.find((_, i, arr) => arr[i - 1] === 'class') || undefined,
        id: node.attributes?.find((_, i, arr) => arr[i - 1] === 'id') || undefined,
      };
    } catch (error) {
      console.error('[DOMInspector] CDP highlight error:', error);
      return null;
    }
  }

  async hideHighlightCDP(): Promise<void> {
    await this.cdp.send('Overlay.hideHighlight');
  }

  // Find common pattern between multiple selected elements
  async findCommonPattern(elements: ElementSelector[]): Promise<{ selector: string; count: number } | null> {
    await this.inject();
    return await this.page.evaluate((els) => {
      return (window as any).__scraperInspector?.findCommonPattern(els) || null;
    }, elements);
  }

  // Highlight all elements matching a selector
  async highlightAll(selector: string): Promise<number> {
    await this.inject();
    return await this.page.evaluate((sel) => {
      return (window as any).__scraperInspector?.highlightAll(sel) || 0;
    }, selector);
  }

  // Clear multi-highlights
  async clearMultiHighlight(): Promise<void> {
    await this.page.evaluate(() => {
      (window as any).__scraperInspector?.clearMultiHighlight();
    });
  }
}
