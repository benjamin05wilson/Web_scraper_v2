// ============================================================================
// CONTAINER DETECTOR UTILITY
// ============================================================================
// Auto-detects repeating product container patterns in the DOM

import type { AssignedSelector } from '../../../shared/types.js';

/**
 * Result of container detection
 */
export interface ContainerDetectionResult {
  /** Found container elements */
  containers: Element[];
  /** CSS selector that matches the containers */
  selector: string;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Tags that are never valid product containers
 */
const INVALID_CONTAINER_TAGS = [
  'button',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'input',
  'select',
  'a',
  'img',
  'svg',
  'path',
  'span',
  'label',
  'option',
];

/**
 * Patterns in class names that indicate non-product containers
 */
const INVALID_CLASS_PATTERNS = [
  'header',
  'nav',
  'menu',
  'footer',
  'sidebar',
  'modal',
  'popup',
  'banner',
  'cookie',
  'dropdown',
  'select',
  'toggle',
  'language',
  'country',
  'region',
  'locale',
  'currency',
];

/**
 * Patterns in class names that indicate product containers
 */
const PRODUCT_CLASS_PATTERNS = [
  'product',
  'item',
  'card',
  'tile',
  'entry',
  'listing',
  'result',
  'data',
  'goods',
  'sku',
  'offer',
];

/**
 * Check if an element is a valid container candidate
 */
export function isValidContainer(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();

  // Skip invalid tags
  if (INVALID_CONTAINER_TAGS.includes(tagName)) {
    return false;
  }

  // Skip if inside header/nav/dropdown
  if (
    element.closest(
      'header, nav, footer, aside, [class*="dropdown"], [class*="menu"], [role="menu"], [role="listbox"]'
    )
  ) {
    return false;
  }

  // Check class names for invalid patterns
  const className = element.className;
  if (typeof className === 'string' && className.length > 0) {
    const lowerClass = className.toLowerCase();
    if (INVALID_CLASS_PATTERNS.some((pattern) => lowerClass.includes(pattern))) {
      return false;
    }
  }

  // Special handling for li elements
  if (tagName === 'li') {
    // Allow li only if it has product-related classes
    if (typeof className === 'string') {
      return PRODUCT_CLASS_PATTERNS.some((pattern) =>
        className.toLowerCase().includes(pattern)
      );
    }
    return false;
  }

  return true;
}

/**
 * Check if an element has product-related class names
 */
export function hasProductClass(element: Element): boolean {
  const className = element.className;
  if (typeof className === 'string') {
    return PRODUCT_CLASS_PATTERNS.some((pattern) =>
      className.toLowerCase().includes(pattern)
    );
  }
  return false;
}

/**
 * Build a CSS selector for an element based on its tag and classes
 */
export function buildSelector(element: Element): string[] {
  const tagName = element.tagName.toLowerCase();
  const className = element.className;
  const selectors: string[] = [];

  if (typeof className === 'string' && className.length > 0) {
    // Get clean class names (filter out modifiers and framework-specific classes)
    const classes = className
      .split(' ')
      .filter(
        (c) =>
          c &&
          !c.includes('--') &&
          c.length > 1 &&
          !c.match(/^(is-|has-|js-|ng-|_)/)
      );

    // Prioritize product-related classes
    const productClasses = classes.filter((c) =>
      PRODUCT_CLASS_PATTERNS.some((pattern) => c.toLowerCase().includes(pattern))
    );

    if (productClasses.length > 0) {
      selectors.push(`${tagName}.${productClasses[0]}`);
    }

    // Also add first class as fallback
    if (classes.length > 0 && classes[0] !== productClasses[0]) {
      selectors.push(`${tagName}.${classes[0]}`);
    }
  }

  // Tag-only selector as last resort
  selectors.push(tagName);

  return selectors;
}

/**
 * Score a container candidate based on various heuristics
 *
 * @param containers - Elements matching the selector
 * @param containedElements - How many target elements are inside these containers
 * @param sampleSize - Total number of target elements sampled
 * @param hasProductClassName - Whether the container has product-related classes
 */
export function scoreCandidate(
  containers: Element[],
  containedElements: number,
  sampleSize: number,
  hasProductClassName: boolean
): number {
  const containerCount = containers.length;

  // Skip if too few or too many containers
  if (containerCount < 2 || containerCount > 500) {
    return 0;
  }

  // Skip if doesn't contain enough sampled elements
  if (containedElements < sampleSize * 0.3) {
    return 0;
  }

  // Base score: containment ratio
  let score = containedElements / sampleSize;

  // Bonus for product-related class names
  if (hasProductClassName) {
    score += 0.5;
  }

  // Bonus for reasonable container count
  if (containerCount >= 5 && containerCount <= 200) {
    score += 0.2;
  }

  return score;
}

/**
 * Find the best container pattern for a set of selectors
 * Works by walking up the DOM from matched elements to find a common parent pattern
 */
export function findContainers(
  selectors: AssignedSelector[],
  document: Document
): ContainerDetectionResult | null {
  // Get all elements matching each selector
  const allElementsPerSelector = selectors.map((sel) => {
    const css = sel.selector.css;
    // Skip :parent-link as it needs container context
    if (css === ':parent-link') {
      return { selector: sel, elements: [] as Element[] };
    }
    try {
      const elements = Array.from(document.querySelectorAll(css));
      return { selector: sel, elements };
    } catch {
      return { selector: sel, elements: [] as Element[] };
    }
  });

  // Check if any selector matches multiple elements
  const hasMultipleMatches = allElementsPerSelector.some((s) => s.elements.length > 1);

  if (hasMultipleMatches) {
    // Get the selector with most matches to use as anchor
    const sortedByMatches = [...allElementsPerSelector].sort(
      (a, b) => b.elements.length - a.elements.length
    );
    const primaryElements = sortedByMatches[0].elements;

    if (primaryElements.length > 1) {
      const result = findContainersFromElements(primaryElements, selectors, document);
      if (result) return result;
    }
  }

  // Fallback: Use first elements from each selector
  const firstElements = selectors
    .map((sel) => {
      if (sel.selector.css === ':parent-link') return null;
      try {
        return document.querySelector(sel.selector.css);
      } catch {
        return null;
      }
    })
    .filter((el): el is Element => el !== null);

  if (firstElements.length < 2) {
    return null;
  }

  return findContainersFromFirstElements(firstElements, selectors, document);
}

/**
 * Find containers by walking up from primary elements
 */
function findContainersFromElements(
  primaryElements: Element[],
  _selectors: AssignedSelector[],
  document: Document
): ContainerDetectionResult | null {
  const containerCandidates = new Map<
    string,
    {
      containers: Element[];
      containedElements: Set<Element>;
      hasProductClass: boolean;
    }
  >();

  // Sample up to 20 elements
  const sampleSize = Math.min(20, primaryElements.length);
  const sampleElements = primaryElements.slice(0, sampleSize);

  for (const el of sampleElements) {
    let parent = el.parentElement;
    let depth = 0;
    const maxDepth = 10;

    while (parent && parent !== document.body && depth < maxDepth) {
      depth++;

      if (!isValidContainer(parent)) {
        parent = parent.parentElement;
        continue;
      }

      const selectorStrategies = buildSelector(parent);

      for (const selector of selectorStrategies) {
        if (!containerCandidates.has(selector)) {
          try {
            const allMatches = Array.from(document.querySelectorAll(selector));
            const validMatches = allMatches.filter(isValidContainer);
            containerCandidates.set(selector, {
              containers: validMatches,
              containedElements: new Set(),
              hasProductClass: hasProductClass(parent),
            });
          } catch {
            continue;
          }
        }

        const candidate = containerCandidates.get(selector)!;
        for (const container of candidate.containers) {
          if (container.contains(el)) {
            candidate.containedElements.add(el);
            break;
          }
        }
      }

      parent = parent.parentElement;
    }
  }

  // Find the best container
  let bestSelector: string | null = null;
  let bestScore = 0;
  let bestContainers: Element[] = [];

  for (const [selector, data] of containerCandidates) {
    const score = scoreCandidate(
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
  }

  if (bestSelector && bestContainers.length > 0) {
    return {
      containers: bestContainers,
      selector: bestSelector,
      confidence: bestScore,
    };
  }

  return null;
}

/**
 * Find containers by walking up from first matched elements
 */
function findContainersFromFirstElements(
  firstElements: Element[],
  selectors: AssignedSelector[],
  document: Document
): ContainerDetectionResult | null {
  const firstEl = firstElements[0];
  let container = firstEl.parentElement;
  let containerSelector: string | null = null;
  let allContainers: Element[] = [];

  while (container && container !== document.body) {
    if (!isValidContainer(container)) {
      container = container.parentElement;
      continue;
    }

    const selectorStrategies = buildSelector(container);

    for (const selector of selectorStrategies) {
      try {
        const matches = Array.from(document.querySelectorAll(selector));
        const validMatches = matches.filter(isValidContainer);

        if (validMatches.length > 1 && validMatches.length < 200) {
          // Check if containers have all our elements
          const containersWithAllElements = validMatches.filter((c) =>
            selectors.every((sel) => {
              if (sel.selector.css === ':parent-link') {
                return c.closest('a[href]') !== null;
              }
              try {
                return c.querySelector(sel.selector.css) !== null;
              } catch {
                return false;
              }
            })
          );

          if (containersWithAllElements.length > 1) {
            containerSelector = selector;
            allContainers = containersWithAllElements;
            break;
          }
        }
      } catch {
        continue;
      }
    }

    if (containerSelector) break;
    container = container.parentElement;
  }

  if (!containerSelector || allContainers.length === 0) {
    return null;
  }

  return {
    containers: allContainers,
    selector: containerSelector,
    confidence: 0.7, // Default confidence for fallback method
  };
}

/**
 * Browser-compatible version for injection into page context
 */
export function getBrowserContainerDetectorScript(): string {
  return `
    (function() {
      var INVALID_TAGS = ['button', 'nav', 'header', 'footer', 'aside', 'form', 'input', 'select', 'a', 'img', 'svg', 'path', 'span', 'label', 'option'];
      var INVALID_PATTERNS = ['header', 'nav', 'menu', 'footer', 'sidebar', 'modal', 'popup', 'banner', 'cookie', 'dropdown', 'select', 'toggle', 'language', 'country', 'region', 'locale', 'currency'];
      var PRODUCT_PATTERNS = ['product', 'item', 'card', 'tile', 'entry', 'listing', 'result', 'data', 'goods', 'sku', 'offer'];

      function isValidContainer(el) {
        var tagName = el.tagName.toLowerCase();
        if (INVALID_TAGS.indexOf(tagName) !== -1) return false;
        if (el.closest('header, nav, footer, aside, [class*="dropdown"], [class*="menu"], [role="menu"], [role="listbox"]')) return false;
        var className = el.className || '';
        if (typeof className === 'string' && className.length > 0) {
          var lowerClass = className.toLowerCase();
          for (var i = 0; i < INVALID_PATTERNS.length; i++) {
            if (lowerClass.indexOf(INVALID_PATTERNS[i]) !== -1) return false;
          }
        }
        if (tagName === 'li') {
          if (typeof className === 'string') {
            for (var j = 0; j < PRODUCT_PATTERNS.length; j++) {
              if (className.toLowerCase().indexOf(PRODUCT_PATTERNS[j]) !== -1) return true;
            }
          }
          return false;
        }
        return true;
      }

      function hasProductClass(el) {
        var className = el.className || '';
        if (typeof className === 'string') {
          for (var i = 0; i < PRODUCT_PATTERNS.length; i++) {
            if (className.toLowerCase().indexOf(PRODUCT_PATTERNS[i]) !== -1) return true;
          }
        }
        return false;
      }

      function buildSelector(el) {
        var tagName = el.tagName.toLowerCase();
        var className = el.className || '';
        var selectors = [];
        if (typeof className === 'string' && className.length > 0) {
          var classes = className.split(' ').filter(function(c) {
            return c && c.indexOf('--') === -1 && c.length > 1 && !c.match(/^(is-|has-|js-|ng-|_)/);
          });
          var productClasses = classes.filter(function(c) {
            for (var i = 0; i < PRODUCT_PATTERNS.length; i++) {
              if (c.toLowerCase().indexOf(PRODUCT_PATTERNS[i]) !== -1) return true;
            }
            return false;
          });
          if (productClasses.length > 0) {
            selectors.push(tagName + '.' + productClasses[0]);
          }
          if (classes.length > 0 && classes[0] !== productClasses[0]) {
            selectors.push(tagName + '.' + classes[0]);
          }
        }
        selectors.push(tagName);
        return selectors;
      }

      function scoreCandidate(containers, containedCount, sampleSize, hasProductClassName) {
        var containerCount = containers.length;
        if (containerCount < 2 || containerCount > 500) return 0;
        if (containedCount < sampleSize * 0.3) return 0;
        var score = containedCount / sampleSize;
        if (hasProductClassName) score += 0.5;
        if (containerCount >= 5 && containerCount <= 200) score += 0.2;
        return score;
      }

      return {
        isValidContainer: isValidContainer,
        hasProductClass: hasProductClass,
        buildSelector: buildSelector,
        scoreCandidate: scoreCandidate
      };
    })()
  `;
}
