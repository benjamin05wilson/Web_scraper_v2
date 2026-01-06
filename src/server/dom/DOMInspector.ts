// ============================================================================
// DOM INSPECTOR - Element Selection & Selector Generation
// ============================================================================

import type { Page, CDPSession } from 'playwright';
import type { ElementSelector, DOMHighlight, UrlHoverPayload, ContainerContentPayload, ExtractedContentItem } from '../../shared/types.js';
import { ProductDetector } from './ProductDetector.js';
import type { DetectionResult } from '../types/detection-types.js';
import type { MultiStepDetectionResult, MultiStepDetectionConfig } from '../ai/types.js';

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
  let lastHoveredUrl = null;
  let urlCaptureEnabled = true;

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

    // Strategy 0: For semantic tags like article, just use the tag if it matches multiple items
    const semanticTags = ['article', 'section', 'li', 'tr', 'figure', 'card'];
    if (semanticTags.includes(tag)) {
      const tagMatches = document.querySelectorAll(tag);
      if (tagMatches.length >= 2 && tagMatches.length <= 200) {
        return tag;
      }
    }

    // Strategy 1: Find a class that matches multiple similar elements
    if (el.classList.length > 0) {
      for (const className of el.classList) {
        // Skip dynamic/state classes
        if (className.match(/^[0-9]|hover|active|focus|selected|current|open|close/i)) continue;

        const classSelector = tag + '.' + CSS.escape(className);
        const matches = document.querySelectorAll(classSelector);

        // Good if it matches 2+ elements but not too many (likely structural)
        if (matches.length >= 2 && matches.length <= 100) {
          // Verify these are similar elements (same parent TYPE, not necessarily same parent element)
          const firstParent = matches[0].parentElement?.tagName;
          const allSameParentType = Array.from(matches).every(m => m.parentElement?.tagName === firstParent);
          if (allSameParentType) {
            return classSelector;
          }
        }
      }

      // Strategy 1b: Relax parent check - just verify count is reasonable for product grids
      for (const className of el.classList) {
        if (className.match(/^[0-9]|hover|active|focus|selected|current|open|close/i)) continue;

        const classSelector = tag + '.' + CSS.escape(className);
        const matches = document.querySelectorAll(classSelector);

        // Accept 2-200 matches even if parents differ (common for product grids)
        if (matches.length >= 2 && matches.length <= 200) {
          return classSelector;
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

  // Find the closest link element from an element
  function findLinkFromElement(el) {
    let current = el;
    while (current && current !== document.body) {
      if (current.tagName === 'A' && current.href) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  // Get link info for URL capture
  function getLinkInfo(linkEl) {
    if (!linkEl || !linkEl.href) return null;

    // Skip javascript: and # links
    const href = linkEl.href;
    if (href.startsWith('javascript:') || href === window.location.href + '#') {
      return null;
    }

    return {
      url: href,
      text: linkEl.textContent?.trim().substring(0, 100) || '',
      title: linkEl.title || linkEl.getAttribute('aria-label') || ''
    };
  }

  // Handle mouse move for URL capture
  function onMouseMoveForUrls(e) {
    if (!urlCaptureEnabled) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;

    const link = findLinkFromElement(el);
    const linkInfo = link ? getLinkInfo(link) : null;

    // Only send if URL changed
    if (linkInfo?.url !== lastHoveredUrl) {
      lastHoveredUrl = linkInfo?.url || null;
      if (linkInfo) {
        window.__scraperSendUrlHover?.({
          ...linkInfo,
          x: e.clientX,
          y: e.clientY
        });
      } else {
        window.__scraperSendUrlHover?.(null);
      }
    }
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
      // Clear any previous data-scraper-detected attribute
      const prevDetected = document.querySelector('[data-scraper-detected="true"]');
      if (prevDetected) {
        prevDetected.removeAttribute('data-scraper-detected');
      }

      // Mark this element for fallback detection
      el.setAttribute('data-scraper-detected', 'true');

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

    enableUrlCapture() {
      urlCaptureEnabled = true;
      document.addEventListener('mousemove', onMouseMoveForUrls, true);
    },

    disableUrlCapture() {
      urlCaptureEnabled = false;
      document.removeEventListener('mousemove', onMouseMoveForUrls, true);
      lastHoveredUrl = null;
    },

    getLinkAtPoint(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const link = findLinkFromElement(el);
      return link ? getLinkInfo(link) : null;
    },

    getAllLinks() {
      const links = document.querySelectorAll('a[href]');
      const results = [];
      const seen = new Set();

      for (const link of links) {
        const info = getLinkInfo(link);
        if (info && !seen.has(info.url)) {
          seen.add(info.url);
          results.push(info);
        }
      }
      return results;
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
        // Note: We don't exclude underscores because CSS Modules use them (e.g., price_singlePrice__hTG4o)
        const firstClasses = ancestorsAtDepth[0].classes.filter(c =>
          !c.match(/^[0-9]|^hover$|^active$|^focus$|^selected$|^current$|^open$|^close$|^ng-|^js-|^is-|^has-/i) &&
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
        // Note: We don't exclude underscores because CSS Modules use them (e.g., price_singlePrice__hTG4o)
        for (let i = remainingPath.length - 1; i >= 0; i--) {
          const node = remainingPath[i];
          const meaningfulClass = node.classes.find(c =>
            !c.match(/^[0-9]|^hover$|^active$|^focus$|^selected$|^current$|^open$|^close$|^ng-|^js-|^is-|^has-/i) &&
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
    },

    // Highlight a single selected element with scroll tracking
    highlightSelected(selector) {
      try {
        console.log('[Injected] highlightSelected called with:', selector);

        // Remove existing selected highlight (check both body and documentElement)
        document.querySelectorAll('.__scraper_selected_highlight__').forEach(el => el.remove());
        if (document.documentElement) {
          document.documentElement.querySelectorAll('.__scraper_selected_highlight__').forEach(el => el.remove());
        }
        if (window.__scraperSelectedScrollHandler) {
          window.removeEventListener('scroll', window.__scraperSelectedScrollHandler, true);
        }

        // Try to find element - first by selector, then by data attribute fallback
        let el = null;
        try {
          el = document.querySelector(selector);
        } catch (e) {
          console.log('[Injected] querySelector failed:', e.message);
        }

        // Fallback: use data-scraper-detected attribute
        if (!el) {
          el = document.querySelector('[data-scraper-detected="true"]');
          if (el) console.log('[Injected] Using data-scraper-detected fallback');
        }

        if (!el) {
          console.log('[Injected] Element not found');
          return false;
        }

        const rect = el.getBoundingClientRect();
        console.log('[Injected] Element rect:', rect.top, rect.left, rect.width, rect.height);

        const highlight = document.createElement('div');
        highlight.className = '__scraper_selected_highlight__';
        highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #00cc66;background:rgba(0,204,102,0.2);top:' + rect.top + 'px;left:' + rect.left + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;border-radius:4px;box-shadow:0 0 10px rgba(0,204,102,0.5);';

        // Append to documentElement (html) instead of body to avoid site scripts removing it
        (document.documentElement || document.body).appendChild(highlight);
        console.log('[Injected] Highlight created at', rect.top, rect.left, rect.width, rect.height);

        // Store for scroll updates
        window.__scraperSelectedHighlight = { highlight, target: el };

        // Update position on scroll
        const updatePosition = () => {
          if (!window.__scraperSelectedHighlight) return;
          const { highlight, target } = window.__scraperSelectedHighlight;
          const r = target.getBoundingClientRect();
          highlight.style.top = r.top + 'px';
          highlight.style.left = r.left + 'px';
          highlight.style.width = r.width + 'px';
          highlight.style.height = r.height + 'px';
        };

        window.__scraperSelectedScrollHandler = updatePosition;
        window.addEventListener('scroll', updatePosition, true);

        return true;
      } catch (e) {
        console.log('[Injected] highlightSelected error:', e.message || e);
        return false;
      }
    },

    // Clear selected highlight
    clearSelectedHighlight() {
      console.log('[Injected] clearSelectedHighlight called');
      document.querySelectorAll('.__scraper_selected_highlight__').forEach(el => el.remove());
      if (document.documentElement) {
        document.documentElement.querySelectorAll('.__scraper_selected_highlight__').forEach(el => el.remove());
      }
      if (window.__scraperSelectedScrollHandler) {
        window.removeEventListener('scroll', window.__scraperSelectedScrollHandler, true);
        window.__scraperSelectedScrollHandler = null;
      }
      window.__scraperSelectedHighlight = null;
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
  private onUrlHover?: (info: UrlHoverPayload | null) => void;
  private urlCaptureEnabled: boolean = false;
  public productDetector: ProductDetector;

  constructor(page: Page, cdp: CDPSession) {
    this.page = page;
    this.cdp = cdp;
    this.productDetector = new ProductDetector(page, cdp);
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

    await this.page.exposeFunction('__scraperSendUrlHover', (info: UrlHoverPayload | null) => {
      this.onUrlHover?.(info);
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
    console.log('[DOMInspector] CDP highlight for selector:', selector);

    try {
      // Enable Overlay domain if not already enabled
      try {
        await this.cdp.send('Overlay.enable');
      } catch (e) {
        // May already be enabled
      }

      // Get document
      const { root } = await this.cdp.send('DOM.getDocument', { depth: 0 });

      // Try CDP querySelector first
      let nodeId: number | undefined;
      try {
        const result = await this.cdp.send('DOM.querySelector', {
          nodeId: root.nodeId,
          selector,
        });
        nodeId = result.nodeId;
        console.log('[DOMInspector] CDP querySelector nodeId:', nodeId);
      } catch (e) {
        console.log('[DOMInspector] CDP querySelector failed, trying fallback');
      }

      // If CDP querySelector failed, use page.evaluate to get bounding box and highlight by rect
      if (!nodeId) {
        console.log('[DOMInspector] Using bounding box fallback for highlight');
        const rect = await this.page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }, selector);

        if (rect) {
          // Highlight using highlightRect instead of highlightNode
          await this.cdp.send('Overlay.highlightRect', {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            color: { r: 0, g: 204, b: 102, a: 0.2 },
            outlineColor: { r: 0, g: 204, b: 102, a: 1 },
          });
          console.log('[DOMInspector] Highlighted using rect fallback');
          return {
            selector,
            boundingBox: rect,
            tagName: 'div',
          };
        }
        return null;
      }

      // Get box model
      const { model } = await this.cdp.send('DOM.getBoxModel', { nodeId });
      if (!model) return null;

      // Get node info
      const { node } = await this.cdp.send('DOM.describeNode', { nodeId });

      // Highlight using CDP Overlay - green color to match selection highlight
      await this.cdp.send('Overlay.highlightNode', {
        highlightConfig: {
          contentColor: { r: 0, g: 204, b: 102, a: 0.2 },
          borderColor: { r: 0, g: 204, b: 102, a: 1 },
          paddingColor: { r: 0, g: 204, b: 102, a: 0.1 },
          showInfo: true, // Shows element tag info
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

  // Highlight a selected element with scroll tracking (stays in place when scrolling)
  async highlightSelected(selector: string): Promise<boolean> {
    await this.inject();
    console.log('[DOMInspector] highlightSelected called with:', selector);
    const result = await this.page.evaluate((sel) => {
      console.log('[Browser] highlightSelected selector:', sel);
      console.log('[Browser] __scraperInspector exists:', !!(window as any).__scraperInspector);
      if (!(window as any).__scraperInspector) {
        console.log('[Browser] ERROR: __scraperInspector not injected!');
        return false;
      }
      const success = (window as any).__scraperInspector.highlightSelected(sel);
      console.log('[Browser] highlightSelected result:', success);
      return success;
    }, selector);
    console.log('[DOMInspector] highlightSelected result:', result);
    return result;
  }

  // Clear selected highlight
  async clearSelectedHighlight(): Promise<void> {
    await this.page.evaluate(() => {
      (window as any).__scraperInspector?.clearSelectedHighlight();
    });
  }

  // =========================================================================
  // URL CAPTURE METHODS
  // =========================================================================

  setUrlHoverCallback(callback: (info: UrlHoverPayload | null) => void): void {
    this.onUrlHover = callback;
  }

  async enableUrlCapture(): Promise<void> {
    await this.inject();
    this.urlCaptureEnabled = true;
    await this.page.evaluate(() => {
      (window as any).__scraperInspector?.enableUrlCapture();
    });
    console.log('[DOMInspector] URL capture enabled');
  }

  async disableUrlCapture(): Promise<void> {
    this.urlCaptureEnabled = false;
    await this.page.evaluate(() => {
      (window as any).__scraperInspector?.disableUrlCapture();
    });
    console.log('[DOMInspector] URL capture disabled');
  }

  isUrlCaptureEnabled(): boolean {
    return this.urlCaptureEnabled;
  }

  async getLinkAtPoint(x: number, y: number): Promise<{ url: string; text?: string; title?: string } | null> {
    await this.inject();
    return await this.page.evaluate((coords) => {
      return (window as any).__scraperInspector?.getLinkAtPoint(coords.x, coords.y) || null;
    }, { x, y });
  }

  async getAllLinks(): Promise<Array<{ url: string; text?: string; title?: string }>> {
    await this.inject();
    return await this.page.evaluate(() => {
      return (window as any).__scraperInspector?.getAllLinks() || [];
    });
  }

  // =========================================================================
  // CONTAINER CONTENT EXTRACTION
  // =========================================================================

  async extractContainerContent(selector: string): Promise<ContainerContentPayload> {
    await this.inject();
    console.log('[DOMInspector] extractContainerContent called with:', selector);

    // Use a string-based function to avoid TypeScript transpilation issues
    // Supports comma-separated selectors (e.g., for Zara's split layout)
    const extractionScript = `
      (function(containerSelector) {
        console.log('[Browser] extractContainerContent selector:', containerSelector);

        // Handle multiple comma-separated selectors
        var selectors = containerSelector.split(',').map(function(s) { return s.trim(); });
        var containers = [];

        for (var i = 0; i < selectors.length; i++) {
          console.log('[Browser] Trying selector:', selectors[i]);
          var container = document.querySelector(selectors[i]);
          console.log('[Browser] Found container:', container ? 'YES' : 'NO');
          if (container) {
            containers.push(container);
          }
        }

        console.log('[Browser] Total containers found:', containers.length);
        if (containers.length > 0) {
          console.log('[Browser] First container tagName:', containers[0].tagName);
          console.log('[Browser] First container outerHTML (first 200):', containers[0].outerHTML.substring(0, 200));
        }
        if (containers.length === 0) return [];

        var extracted = [];
        var seen = {};

        // Helper to add unique items
        function addItem(item) {
          var key = item.type + ':' + item.value;
          if (!seen[key] && item.value.trim().length > 0) {
            seen[key] = true;
            extracted.push(item);
          }
        }

        // Helper to get relative selector within container
        function getRelativeSelector(el, base) {
          if (el === base) return '';

          var tag = el.tagName.toLowerCase();

          // Helper to check if selector is unique within base
          function isUnique(selector) {
            try {
              var matches = base.querySelectorAll(selector);
              return matches.length === 1 && matches[0] === el;
            } catch (e) {
              return false;
            }
          }

          // Try class-based selector with ALL valid classes first
          if (el.classList && el.classList.length > 0) {
            var validClasses = Array.from(el.classList).filter(function(c) {
              // Filter out dynamic/state classes but KEEP classes with underscores (common in CSS modules)
              // Only exclude classes that START with js- or ng- or are state classes
              return !c.match(/^[0-9]|^hover$|^active$|^focus$|^selected$|^current$|^open$|^close$|^ng-|^js-|^is-|^has-/i);
            });

            if (validClasses.length > 0) {
              // Escape classes for CSS selector (handles @, /, etc.)
              var escapedClasses = validClasses.map(function(c) { return CSS.escape(c); });

              // Try all classes together first for maximum specificity
              var fullSelector = tag + '.' + escapedClasses.join('.');
              if (isUnique(fullSelector)) {
                return fullSelector;
              }

              // Try each class individually
              for (var i = 0; i < escapedClasses.length; i++) {
                var singleSelector = tag + '.' + escapedClasses[i];
                if (isUnique(singleSelector)) {
                  return singleSelector;
                }
              }

              // If single classes don't work, try combinations
              for (var i = 0; i < escapedClasses.length; i++) {
                for (var j = i + 1; j < escapedClasses.length; j++) {
                  var comboSelector = tag + '.' + escapedClasses[i] + '.' + escapedClasses[j];
                  if (isUnique(comboSelector)) {
                    return comboSelector;
                  }
                }
              }

              // Use all classes even if not unique (better than nothing)
              return fullSelector;
            }
          }

          // Try position-based selector within parent
          var parent = el.parentElement;
          if (parent && parent !== base) {
            var siblings = Array.from(parent.children).filter(function(s) { return s.tagName === el.tagName; });
            if (siblings.length > 1) {
              var index = siblings.indexOf(el) + 1;
              var parentSelector = getRelativeSelector(parent, base);
              var posSelector = parentSelector ? parentSelector + ' > ' + tag + ':nth-of-type(' + index + ')' : tag + ':nth-of-type(' + index + ')';
              if (isUnique(posSelector)) {
                return posSelector;
              }
            }

            // Try parent selector combined with tag
            var parentSelector = getRelativeSelector(parent, base);
            if (parentSelector) {
              var childSelector = parentSelector + ' > ' + tag;
              if (isUnique(childSelector)) {
                return childSelector;
              }
              // Try with :first-of-type
              var firstSelector = parentSelector + ' > ' + tag + ':first-of-type';
              if (isUnique(firstSelector)) {
                return firstSelector;
              }
            }
          }

          // Fallback: try nth-of-type directly within container
          var allSiblings = base.querySelectorAll(tag);
          if (allSiblings.length > 1) {
            var idx = Array.from(allSiblings).indexOf(el) + 1;
            return tag + ':nth-of-type(' + idx + ')';
          }

          return tag;
        }

        // Process each container
        for (var c = 0; c < containers.length; c++) {
          var container = containers[c];

          // Extract all text nodes (leaf text content)
          var walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            null
          );

          var textNodeParents = new Set();
          var node;
          while ((node = walker.nextNode())) {
            var text = node.textContent ? node.textContent.trim() : '';
            if (text && text.length > 0 && text.length < 200) {
              var parent = node.parentElement;
              if (parent && !textNodeParents.has(parent)) {
                textNodeParents.add(parent);
                addItem({
                  type: 'text',
                  value: text,
                  selector: getRelativeSelector(parent, container),
                  displayText: text.length > 60 ? text.substring(0, 60) + '...' : text,
                  tagName: parent.tagName.toLowerCase()
                });
              }
            }
          }

          // SPECIAL HANDLING: Look for split prices (currency symbol in one element, number in adjacent element)
          // Common pattern: <span>$</span><span>99.99</span> or similar
          // Also handles price ranges like "$59.95 - $379.95" and multiple prices like "$69.95 $34.98"
          var priceContainers = container.querySelectorAll('[class*="price"], [class*="Price"], [class*="cost"], [class*="Cost"], [class*="amount"], [class*="Amount"]');
          for (var p = 0; p < priceContainers.length; p++) {
            var priceEl = priceContainers[p];
            // Get the combined text of this element and its children, preserving some spacing for ranges
            var fullPriceText = priceEl.textContent ? priceEl.textContent.trim().replace(/\\s+/g, ' ') : '';

            // First try to match a price RANGE (e.g., "$59.95 - $379.95" or "$29.98 - $189.98")
            var priceRangeMatch = fullPriceText.match(/[£$€¥₹]\\s*\\d+([,.]\\d{1,3})*([,.]\\d{1,2})?\\s*[-–—]\\s*[£$€¥₹]?\\s*\\d+([,.]\\d{1,3})*([,.]\\d{1,2})?/);
            if (priceRangeMatch) {
              var fullPriceRange = priceRangeMatch[0].replace(/\\s+/g, ' ').trim();
              addItem({
                type: 'text',
                value: fullPriceRange,
                selector: getRelativeSelector(priceEl, container),
                displayText: fullPriceRange,
                tagName: priceEl.tagName.toLowerCase(),
                isPrice: true
              });
            } else {
              // Find ALL prices in the element (handles "$69.95 $34.98" original+sale pattern)
              var priceRegex = /[£$€¥₹]\\s*\\d+([,.]\\d{1,3})*([,.]\\d{1,2})?/g;
              var allPriceMatches = fullPriceText.match(priceRegex);
              if (allPriceMatches && allPriceMatches.length > 0) {
                // Add each price found
                for (var pm = 0; pm < allPriceMatches.length; pm++) {
                  var foundPrice = allPriceMatches[pm].trim();
                  addItem({
                    type: 'text',
                    value: foundPrice,
                    selector: getRelativeSelector(priceEl, container),
                    displayText: foundPrice,
                    tagName: priceEl.tagName.toLowerCase(),
                    isPrice: true
                  });
                }
              }
            }
          }

          // Also check for elements that contain ONLY a currency symbol and combine with next sibling
          var allElements = container.querySelectorAll('*');
          for (var e = 0; e < allElements.length; e++) {
            var el = allElements[e];
            var elText = el.textContent ? el.textContent.trim() : '';
            // Check if element contains ONLY a currency symbol
            if (/^[£$€¥₹]$/.test(elText)) {
              // Look at the parent's full text content - it might have the full price
              var priceParent = el.parentElement;
              if (priceParent) {
                var parentText = priceParent.textContent ? priceParent.textContent.trim().replace(/\\s+/g, ' ') : '';
                // Try price range first
                var parentRangeMatch = parentText.match(/[£$€¥₹]\\s*\\d+([,.]\\d{1,3})*([,.]\\d{1,2})?\\s*[-–—]\\s*[£$€¥₹]?\\s*\\d+([,.]\\d{1,3})*([,.]\\d{1,2})?/);
                if (parentRangeMatch) {
                  addItem({
                    type: 'text',
                    value: parentRangeMatch[0].replace(/\\s+/g, ' ').trim(),
                    selector: getRelativeSelector(priceParent, container),
                    displayText: parentRangeMatch[0].replace(/\\s+/g, ' ').trim(),
                    tagName: priceParent.tagName.toLowerCase(),
                    isPrice: true
                  });
                } else {
                  // Find ALL prices in parent (handles multiple prices like "$69.95 $34.98")
                  var parentPriceRegex = /[£$€¥₹]\\s*\\d+([,.]\\d{1,3})*([,.]\\d{1,2})?/g;
                  var parentPriceMatches = parentText.match(parentPriceRegex);
                  if (parentPriceMatches && parentPriceMatches.length > 0) {
                    for (var ppm = 0; ppm < parentPriceMatches.length; ppm++) {
                      addItem({
                        type: 'text',
                        value: parentPriceMatches[ppm].trim(),
                        selector: getRelativeSelector(priceParent, container),
                        displayText: parentPriceMatches[ppm].trim(),
                        tagName: priceParent.tagName.toLowerCase(),
                        isPrice: true
                      });
                    }
                  }
                }
              }
            }
          }

          // ADDITIONAL: Find ALL price-like text in the container (for multiple price rows)
          // This catches cases where there are multiple prices not in [class*="price"] elements
          // We need to find the actual elements containing these prices
          var allElementsForPrices = container.querySelectorAll('*');
          for (var ep = 0; ep < allElementsForPrices.length; ep++) {
            var priceEl = allElementsForPrices[ep];
            // Skip if this element has children (we want leaf-ish elements)
            // But allow elements with only text children or span/small children
            var hasBlockChildren = false;
            for (var ch = 0; ch < priceEl.children.length; ch++) {
              var childTag = priceEl.children[ch].tagName.toLowerCase();
              if (['div', 'p', 'ul', 'li', 'article', 'section'].indexOf(childTag) !== -1) {
                hasBlockChildren = true;
                break;
              }
            }
            if (hasBlockChildren) continue;

            var elPriceText = priceEl.textContent ? priceEl.textContent.trim().replace(/\\s+/g, ' ') : '';
            // Check for price range pattern first
            var elPriceRangeMatch = elPriceText.match(/[£$€¥₹]\\s*\\d+([,.]\\d{1,3})*([,.]\\d{1,2})?\\s*[-–—]\\s*[£$€¥₹]?\\s*\\d+([,.]\\d{1,3})*([,.]\\d{1,2})?/);
            if (elPriceRangeMatch) {
              var foundRange = elPriceRangeMatch[0].replace(/\\s+/g, ' ').trim();
              addItem({
                type: 'text',
                value: foundRange,
                selector: getRelativeSelector(priceEl, container),
                displayText: foundRange,
                tagName: priceEl.tagName.toLowerCase(),
                isPrice: true
              });
            } else {
              // Find ALL individual prices (handles "$69.95 $34.98" pattern)
              var elPriceRegex = /[£$€¥₹]\\s*\\d+([,.]\\d{1,3})*([,.]\\d{1,2})?/g;
              var elPriceMatches = elPriceText.match(elPriceRegex);
              if (elPriceMatches && elPriceMatches.length > 0) {
                for (var epm = 0; epm < elPriceMatches.length; epm++) {
                  addItem({
                    type: 'text',
                    value: elPriceMatches[epm].trim(),
                    selector: getRelativeSelector(priceEl, container),
                    displayText: elPriceMatches[epm].trim(),
                    tagName: priceEl.tagName.toLowerCase(),
                    isPrice: true
                  });
                }
              }
            }
          }

          // Extract all links
          var links = container.querySelectorAll('a[href]');
          console.log('[Browser] Found links in container:', links.length);
          console.log('[Browser] Container tagName:', container.tagName);

          // Check if the container itself is a link (common pattern where <a> wraps everything)
          if (container.tagName === 'A' && container.getAttribute('href')) {
            var containerHref = container.getAttribute('href');
            console.log('[Browser] Container IS a link:', containerHref);
            if (containerHref && !containerHref.startsWith('#') && !containerHref.startsWith('javascript:')) {
              var containerUrl = containerHref;
              try {
                containerUrl = new URL(containerHref, window.location.href).href;
              } catch (e) {
                containerUrl = containerHref;
              }
              addItem({
                type: 'link',
                value: containerUrl,
                selector: ':self',  // Special selector indicating the container itself is the link
                displayText: containerUrl.length > 60 ? containerUrl.substring(0, 60) + '...' : containerUrl,
                tagName: 'a'
              });
            }
          }

          // Also check if container is INSIDE a link (Dunelm pattern: div inside <a>)
          if (links.length === 0 && container.tagName !== 'A') {
            var parentLink = container.closest('a[href]');
            if (parentLink) {
              var parentHref = parentLink.getAttribute('href');
              console.log('[Browser] Container is INSIDE a link:', parentHref);
              if (parentHref && !parentHref.startsWith('#') && !parentHref.startsWith('javascript:')) {
                var parentUrl = parentHref;
                try {
                  parentUrl = new URL(parentHref, window.location.href).href;
                } catch (e) {
                  parentUrl = parentHref;
                }
                addItem({
                  type: 'link',
                  value: parentUrl,
                  selector: ':parent-link',
                  displayText: parentUrl.length > 60 ? parentUrl.substring(0, 60) + '...' : parentUrl,
                  tagName: 'a'
                });
              }
            }
          }

          links.forEach(function(link) {
            var href = link.getAttribute('href');
            console.log('[Browser] Processing link href:', href);
            if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
              // Resolve relative URLs
              var fullUrl = href;
              try {
                fullUrl = new URL(href, window.location.href).href;
              } catch (e) {
                fullUrl = href;
              }
              console.log('[Browser] Adding link:', fullUrl.substring(0, 50));

              addItem({
                type: 'link',
                value: fullUrl,
                selector: getRelativeSelector(link, container),
                displayText: fullUrl.length > 60 ? fullUrl.substring(0, 60) + '...' : fullUrl,
                tagName: 'a'
              });
            }
          });

          // Extract all images
          var images = container.querySelectorAll('img[src]');
          images.forEach(function(img) {
            var src = img.getAttribute('src');
            if (src) {
              // Resolve relative URLs
              var fullUrl = src;
              try {
                fullUrl = new URL(src, window.location.href).href;
              } catch (e) {
                fullUrl = src;
              }

              var alt = img.getAttribute('alt');
              addItem({
                type: 'image',
                value: fullUrl,
                selector: getRelativeSelector(img, container),
                displayText: alt || fullUrl.split('/').pop() || fullUrl,
                tagName: 'img'
              });
            }
          });
        }

        return extracted;
      })
    `;

    // Retry extraction if no items found (handles lazy-loaded content)
    let items: ExtractedContentItem[] = [];
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      items = await this.page.evaluate(
        ({ script, sel }) => {
          // eslint-disable-next-line no-eval
          const fn = eval(script);
          const result = fn(sel);
          console.log('[Browser] Extracted items count:', result ? result.length : 0);
          return result;
        },
        { script: extractionScript, sel: selector }
      ) as ExtractedContentItem[];

      attempts++;
      console.log(`[DOMInspector] Extraction attempt ${attempts}: ${items?.length || 0} items`);

      // If we found items, we're done
      if (items && items.length > 0) {
        break;
      }

      // If no items and more attempts remaining, wait and retry
      if (attempts < maxAttempts) {
        console.log('[DOMInspector] No items found, retrying after wait...');
        await this.page.waitForTimeout(300);
      }
    }

    console.log('[DOMInspector] Final extracted items:', items?.length || 0);
    return {
      items: items || [],
      containerSelector: selector,
    };
  }

  // =========================================================================
  // AUTO-DETECT PRODUCT CONTAINERS (ML-BASED)
  // =========================================================================

  /**
   * Auto-detect product using AI-enhanced detection (Gemini Vision).
   * Falls back to ML-based detection if AI is unavailable or fails.
   * Returns element selector along with confidence score and source.
   */
  async autoDetectProductWithAI(): Promise<(ElementSelector & { confidence: number; fallbackRecommended: boolean; source: 'ai' | 'ml' }) | null> {
    await this.inject();

    // Check if this is a Zara page - use Zara-specific detection
    const currentUrl = this.page.url();
    if (currentUrl.includes('zara.com')) {
      const zaraResult = await this.autoDetectZaraProduct();
      if (zaraResult) {
        return { ...zaraResult, confidence: 0.9, fallbackRecommended: false, source: 'ml' as const };
      }
      return null;
    }

    console.log('[DOMInspector] Using AI-enhanced product detection');

    try {
      // Use the AI-enhanced ProductDetector
      const result = await this.productDetector.detectProductWithAI();

      if (!result.selectedElement) {
        console.log('[DOMInspector] No product detected:', result.reason);
        return null;
      }

      const { selectedElement, confidence, fallbackRecommended, reason, source } = result;

      console.log(`[DOMInspector] ${source.toUpperCase()}-detected product: ${selectedElement.selector}`);
      console.log(`[DOMInspector] Confidence: ${(confidence * 100).toFixed(0)}%`);
      console.log(`[DOMInspector] Generic selector: ${selectedElement.genericSelector}`);

      if (fallbackRecommended) {
        console.log(`[DOMInspector] Low confidence - ${reason}`);
      }

      // Return in the expected ElementSelector format
      return {
        tagName: '',
        css: selectedElement.genericSelector,
        cssSpecific: selectedElement.selector,
        boundingBox: selectedElement.boundingBox,
        text: '',
        attributes: {},
        confidence,
        fallbackRecommended,
        source,
      };

    } catch (error) {
      console.error('[DOMInspector] AI auto-detect error:', error);
      // Fall back to legacy detection on error
      return this.legacyAutoDetectProduct() as any;
    }
  }

  /**
   * Auto-detect product using multi-step AI pipeline for maximum accuracy.
   * Uses a 6-step verification pipeline with iterative refinement.
   * Falls back to single-AI detection or ML if pipeline fails.
   */
  async autoDetectProductWithMultiStepAI(
    config?: Partial<MultiStepDetectionConfig>
  ): Promise<(ElementSelector & {
    confidence: number;
    fallbackRecommended: boolean;
    source: MultiStepDetectionResult['source'];
    iterations: number;
    pipeline: MultiStepDetectionResult['pipeline'];
  }) | null> {
    await this.inject();

    // Check if this is a Zara page - use Zara-specific detection
    const currentUrl = this.page.url();
    if (currentUrl.includes('zara.com')) {
      const zaraResult = await this.autoDetectZaraProduct();
      if (zaraResult) {
        return {
          ...zaraResult,
          confidence: 0.9,
          fallbackRecommended: false,
          source: 'ml' as const,
          iterations: 0,
          pipeline: {
            gridDetected: false,
            candidatesGenerated: 0,
            refinementIterations: 0,
            verified: false,
          },
        };
      }
      return null;
    }

    console.log('[DOMInspector] Using multi-step AI product detection pipeline');

    try {
      // Use the multi-step AI pipeline
      const result = await this.productDetector.detectProductWithMultiStepAI(config);

      if (!result.selector) {
        console.log('[DOMInspector] Multi-step AI detection returned no selector');
        return null;
      }

      console.log(`[DOMInspector] Multi-step AI detected: ${result.selector}`);
      console.log(`[DOMInspector] Source: ${result.source}, Iterations: ${result.iterations}`);
      console.log(`[DOMInspector] Pipeline: grid=${result.pipeline.gridDetected}, candidates=${result.pipeline.candidatesGenerated}, refinements=${result.pipeline.refinementIterations}, verified=${result.pipeline.verified}`);
      console.log(`[DOMInspector] Confidence: ${(result.confidence * 100).toFixed(0)}%`);

      // Get bounding box for the first matched element
      const boundingBox = await this.page.evaluate((selector) => {
        try {
          const el = document.querySelector(selector);
          if (!el) return { x: 0, y: 0, width: 0, height: 0 };
          const rect = el.getBoundingClientRect();
          return {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          };
        } catch {
          return { x: 0, y: 0, width: 0, height: 0 };
        }
      }, result.selector);

      // Return in the expected ElementSelector format with multi-step metadata
      return {
        tagName: '',
        css: result.genericSelector,
        cssSpecific: result.selector,
        boundingBox,
        text: '',
        attributes: {},
        confidence: result.confidence,
        fallbackRecommended: result.confidence < 0.6,
        source: result.source,
        iterations: result.iterations,
        pipeline: result.pipeline,
      };

    } catch (error) {
      console.error('[DOMInspector] Multi-step AI detection error:', error);
      // Fall back to single AI detection on error
      const fallbackResult = await this.autoDetectProductWithAI();
      if (fallbackResult) {
        return {
          ...fallbackResult,
          source: fallbackResult.source === 'ai' ? 'single-ai' as const : fallbackResult.source,
          iterations: 0,
          pipeline: {
            gridDetected: false,
            candidatesGenerated: 0,
            refinementIterations: 0,
            verified: false,
          },
        };
      }
      return null;
    }
  }

  /**
   * Auto-detect product using ML-based multi-factor scoring.
   * Returns element selector along with confidence score.
   */
  async autoDetectProduct(): Promise<ElementSelector | null> {
    await this.inject();

    // Check if this is a Zara page - use Zara-specific detection
    const currentUrl = this.page.url();
    if (currentUrl.includes('zara.com')) {
      return this.autoDetectZaraProduct();
    }

    console.log('[DOMInspector] Using ML-based product detection');

    try {
      // Use the ML-based ProductDetector
      const result = await this.productDetector.detectProduct();

      if (!result.selectedElement) {
        console.log('[DOMInspector] No product detected:', result.reason);
        return null;
      }

      const { selectedElement, confidence, fallbackRecommended, reason } = result;

      console.log(`[DOMInspector] ML-detected product: ${selectedElement.selector}`);
      console.log(`[DOMInspector] Confidence: ${(confidence * 100).toFixed(0)}%`);
      console.log(`[DOMInspector] Generic selector: ${selectedElement.genericSelector}`);

      if (fallbackRecommended) {
        console.log(`[DOMInspector] Low confidence - ${reason}`);
      }

      // Don't highlight here - let the server's highlightSelected handle it
      // to ensure only ONE highlight method is used

      // Return in the expected ElementSelector format
      return {
        tagName: '', // Will be filled by browser
        css: selectedElement.genericSelector,
        cssSpecific: selectedElement.selector,
        boundingBox: selectedElement.boundingBox,
        text: '',
        attributes: {},
        // Include confidence info as extra properties
        confidence,
        fallbackRecommended,
      } as ElementSelector & { confidence: number; fallbackRecommended: boolean };

    } catch (error) {
      console.error('[DOMInspector] ML auto-detect error:', error);
      // Fall back to legacy detection on error
      return this.legacyAutoDetectProduct();
    }
  }

  /**
   * Get detailed auto-detect result with all candidates for debugging
   */
  async autoDetectProductWithDetails(): Promise<DetectionResult> {
    await this.inject();

    // Check for Zara special case
    const currentUrl = this.page.url();
    if (currentUrl.includes('zara.com')) {
      const zaraResult = await this.autoDetectZaraProduct();
      return {
        selectedElement: zaraResult ? {
          selector: zaraResult.css,
          genericSelector: zaraResult.css,
          boundingBox: zaraResult.boundingBox,
        } : null,
        confidence: zaraResult ? 0.9 : 0,
        fallbackRecommended: !zaraResult,
        reason: zaraResult ? undefined : 'Zara detection failed',
        allCandidates: [],
      };
    }

    return this.productDetector.detectProduct();
  }

  /**
   * Legacy auto-detect (fallback for errors)
   */
  private async legacyAutoDetectProduct(): Promise<ElementSelector | null> {
    console.log('[DOMInspector] Using legacy auto-detect fallback');

    const detectScript = `
      (function() {
        var productPatterns = [
          'article',
          '[role="listitem"]',
          '[itemtype*="Product"]',
          '[data-product]',
          '[data-item]',
          '[data-sku]',
          '[class*="product"]',
          '[class*="item"]',
          '[class*="card"]',
        ];

        function isLikelyProduct(el) {
          if (!el || el.tagName === 'BODY' || el.tagName === 'HTML') return false;
          var rect = el.getBoundingClientRect();
          if (rect.width < 100 || rect.height < 100 || rect.width > window.innerWidth * 0.8) return false;
          var productChildren = el.querySelectorAll('[class*="product"], [class*="item"], [class*="card"], article');
          if (productChildren.length > 3) return false;
          var hasImage = el.querySelector('img') !== null;
          var hasPrice = /\\$|£|€|\\d+[.,]\\d{2}/i.test(el.textContent || '');
          var hasLink = el.querySelector('a[href]') !== null;
          return hasImage && (hasPrice || hasLink);
        }

        function addHighlight(el) {
          el.setAttribute('data-scraper-detected', 'true');
          el.style.cssText += '; outline: 4px solid #00cc66 !important; box-shadow: 0 0 20px rgba(0,204,102,0.5) !important;';
        }

        for (var i = 0; i < productPatterns.length; i++) {
          try {
            var elements = document.querySelectorAll(productPatterns[i]);
            for (var j = 0; j < elements.length; j++) {
              var el = elements[j];
              if (isLikelyProduct(el)) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                addHighlight(el);
                var tag = el.tagName.toLowerCase();
                var css = tag;
                if (['article', 'section', 'li'].indexOf(tag) !== -1) {
                  css = tag;
                } else if (el.classList.length > 0) {
                  var cls = Array.from(el.classList).filter(function(c) { return !c.match(/^[0-9]/); })[0];
                  if (cls) css = tag + '.' + CSS.escape(cls);
                }
                var rect = el.getBoundingClientRect();
                return {
                  tagName: tag,
                  css: css,
                  boundingBox: {
                    x: rect.left + window.scrollX,
                    y: rect.top + window.scrollY,
                    width: rect.width,
                    height: rect.height
                  },
                  text: '',
                  attributes: {}
                };
              }
            }
          } catch (e) {}
        }
        return null;
      })()
    `;

    try {
      const result = await this.page.evaluate(detectScript) as ElementSelector | null;
      if (result) {
        console.log('[DOMInspector] Legacy detected:', result.css);
      }
      return result;
    } catch (error) {
      console.error('[DOMInspector] Legacy auto-detect error:', error);
      return null;
    }
  }

  // =========================================================================
  // ZARA-SPECIFIC AUTO-DETECT
  // =========================================================================

  private async autoDetectZaraProduct(): Promise<ElementSelector | null> {
    console.log('[DOMInspector] Using Zara-specific product detection');

    // Zara has images and info in SEPARATE rows - we need to find BOTH and combine them
    const zaraDetectScript = `
      (function() {
        // Find the first product image card
        var imageCards = document.querySelectorAll('li.product-grid-product[data-productid]');
        console.log('[Zara] Found image cards:', imageCards.length);

        var firstImageCard = null;
        var productId = null;

        for (var i = 0; i < imageCards.length; i++) {
          var card = imageCards[i];
          var rect = card.getBoundingClientRect();
          var hasImage = card.querySelector('img') !== null;

          if (hasImage && rect.width >= 50 && rect.height >= 50) {
            firstImageCard = card;
            productId = card.getAttribute('data-productid');
            console.log('[Zara] Found first visible image card, productId:', productId);
            break;
          }
        }

        if (!firstImageCard) {
          console.log('[Zara] No image cards found');
          return null;
        }

        // Now find the corresponding info card
        // The info is in a separate row - look for li with product-grid-product-info
        // that has a link pointing to the same product
        var infoCards = document.querySelectorAll('.product-grid-product-info');
        console.log('[Zara] Found info cards:', infoCards.length);

        var matchingInfoCard = null;

        // Try to find info card by position (same index in the grid)
        var imageIndex = Array.from(imageCards).indexOf(firstImageCard);
        var infoLis = document.querySelectorAll('li.product-grid-block-dynamic__product-info');

        if (infoLis.length > imageIndex) {
          matchingInfoCard = infoLis[imageIndex];
          console.log('[Zara] Found matching info card by position index:', imageIndex);
        }

        // If we found both, create a combined bounding box
        if (firstImageCard && matchingInfoCard) {
          var imgRect = firstImageCard.getBoundingClientRect();
          var infoRect = matchingInfoCard.getBoundingClientRect();

          // Combined bounding box that covers both
          var minX = Math.min(imgRect.left, infoRect.left);
          var minY = Math.min(imgRect.top, infoRect.top);
          var maxX = Math.max(imgRect.right, infoRect.right);
          var maxY = Math.max(imgRect.bottom, infoRect.bottom);

          console.log('[Zara] Creating combined bounding box for image + info');

          // Scroll the image card into view only if not visible
          if (imgRect.top < 0 || imgRect.bottom > window.innerHeight) {
            firstImageCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }

          // Return info with a combined selector that will match both
          return {
            tagName: 'li',
            css: 'li.product-grid-product[data-productid]',
            combinedCss: 'li.product-grid-product[data-productid], li.product-grid-block-dynamic__product-info',
            boundingBox: {
              x: minX + window.scrollX,
              y: minY + window.scrollY,
              width: maxX - minX,
              height: maxY - minY
            },
            text: (firstImageCard.textContent || '').substring(0, 50) + ' | ' + (matchingInfoCard.textContent || '').substring(0, 50),
            attributes: { productId: productId },
            // Store both selectors for extraction
            imageSelector: 'li.product-grid-product[data-productid]',
            infoSelector: 'li.product-grid-block-dynamic__product-info'
          };
        }

        // Fallback: just return the image card
        console.log('[Zara] No matching info card found, returning image card only');
        var rect = firstImageCard.getBoundingClientRect();
        // Scroll only if not visible
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          firstImageCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        return {
          tagName: 'li',
          css: 'li.product-grid-product[data-productid]',
          boundingBox: {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height
          },
          text: (firstImageCard.textContent || '').substring(0, 100).trim(),
          attributes: { productId: productId }
        };
      })()
    `;

    try {
      interface ZaraResult extends ElementSelector {
        combinedCss?: string;
        imageSelector?: string;
        infoSelector?: string;
      }
      const result = await this.page.evaluate(zaraDetectScript) as ZaraResult | null;
      if (result) {
        console.log('[DOMInspector] Zara auto-detected product:', result.css);
        // If we have a combined selector (both image and info), highlight both
        if (result.combinedCss && result.imageSelector && result.infoSelector) {
          console.log('[DOMInspector] Highlighting combined selectors:', result.combinedCss);
          await this.highlightMultipleSelectors(result.imageSelector, result.infoSelector);
        } else if (result.css) {
          await this.highlightSelected(result.css);
        }
      } else {
        console.log('[DOMInspector] Zara auto-detect: no product found');
      }
      return result;
    } catch (error) {
      console.error('[DOMInspector] Zara auto-detect error:', error);
      return null;
    }
  }

  // Highlight multiple selectors (for Zara's split layout)
  private async highlightMultipleSelectors(selector1: string, selector2: string): Promise<void> {
    const script = `
      (function(sel1, sel2) {
        // Clear existing highlights
        document.querySelectorAll('.__scraper_selected_highlight__').forEach(function(el) { el.remove(); });

        function highlightElement(selector, index) {
          var el = document.querySelector(selector);
          if (!el) return;

          var rect = el.getBoundingClientRect();
          var highlight = document.createElement('div');
          highlight.className = '__scraper_selected_highlight__';
          highlight.setAttribute('data-index', String(index));
          // Use absolute positioning with scroll offset so it stays with the element
          highlight.style.cssText =
            'position: absolute;' +
            'top: ' + (rect.top + window.scrollY) + 'px;' +
            'left: ' + (rect.left + window.scrollX) + 'px;' +
            'width: ' + rect.width + 'px;' +
            'height: ' + rect.height + 'px;' +
            'border: 3px solid #00cc66;' +
            'background: rgba(0, 204, 102, 0.15);' +
            'pointer-events: none;' +
            'z-index: 999999;' +
            'box-sizing: border-box;';
          document.body.appendChild(highlight);
        }

        highlightElement(sel1, 0);
        highlightElement(sel2, 1);
      })('${selector1.replace(/'/g, "\\'")}', '${selector2.replace(/'/g, "\\'")}')
    `;
    await this.page.evaluate(script);
  }
}
