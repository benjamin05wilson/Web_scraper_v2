// ============================================================================
// PRODUCT DETECTOR - ML-based product detection orchestrator
// ============================================================================

import type { Page, CDPSession } from 'playwright';
import { ElementScorer } from '../ml/ElementScorer.js';
import { StructuralAnalyzer } from '../ml/StructuralAnalyzer.js';
import { ContentClassifier } from '../ml/ContentClassifier.js';
import { LazyLoadHandler } from '../ml/LazyLoadHandler.js';
import type {
  DetectionResult,
  DetectorConfig,
  ElementScore,
  CandidateElement,
  ClassificationResult,
} from '../types/detection-types.js';

/**
 * Main orchestrator for ML-based product detection.
 * Coordinates all analysis components to find the best product element.
 */
export class ProductDetector {
  private page: Page;
  private scorer: ElementScorer;
  private structuralAnalyzer: StructuralAnalyzer;
  private classifier: ContentClassifier;
  private lazyLoadHandler: LazyLoadHandler;
  private config: DetectorConfig;

  constructor(page: Page, _cdp: CDPSession, config?: Partial<DetectorConfig>) {
    this.page = page;

    // Default config
    this.config = {
      weights: {
        structural: 0.30,
        visual: 0.25,
        content: 0.30,
        context: 0.15,
      },
      minConfidence: 0.6,
      minScore: 50,
      maxCandidates: 100,
      maxSiblingsToCheck: 10,
      minPatternSize: 3,
      patternBoost: 10,
      ...config,
    };

    this.scorer = new ElementScorer(this.config.weights);
    this.structuralAnalyzer = new StructuralAnalyzer();
    this.classifier = new ContentClassifier();
    this.lazyLoadHandler = new LazyLoadHandler();
  }

  /**
   * Main detection method - finds the best product element on the page
   */
  async detectProduct(): Promise<DetectionResult> {
    console.log('[ProductDetector] Starting ML-based product detection');

    try {
      // Step 0: Wait for page to stabilize
      await this.waitForPageStability();

      // Step 1: Inject helper functions into page
      await this.injectHelpers();

      // Step 2: Gather candidate elements
      const candidates = await this.gatherCandidates();
      console.log(`[ProductDetector] Found ${candidates.length} candidate elements`);

      if (candidates.length === 0) {
        return {
          selectedElement: null,
          confidence: 0,
          fallbackRecommended: true,
          reason: 'No candidate elements found on page',
          allCandidates: [],
        };
      }

      // Step 3: Score all candidates
      const scoredCandidates = await this.scoreCandidates(candidates);
      console.log(`[ProductDetector] Scored ${scoredCandidates.length} candidates`);

      // Step 4: Adjust scores based on classification (no filtering - just score adjustment)
      const adjustedCandidates = await this.adjustScoresWithClassification(scoredCandidates);
      console.log(`[ProductDetector] Adjusted scores for ${adjustedCandidates.length} candidates`);

      // Step 5: Analyze structural patterns
      const patternGroups = await this.analyzePatterns(adjustedCandidates);
      console.log(`[ProductDetector] Found ${patternGroups.size} structural pattern groups`);

      // Apply pattern boost
      this.scorer.applyPatternBoost(
        adjustedCandidates,
        patternGroups,
        this.config.patternBoost
      );

      // Step 6: Select best candidate
      const bestCandidate = this.selectBestCandidate(adjustedCandidates, patternGroups);

      if (!bestCandidate) {
        return {
          selectedElement: null,
          confidence: 0,
          fallbackRecommended: true,
          reason: 'No suitable candidate found after scoring',
          allCandidates: adjustedCandidates,
        };
      }

      console.log(`[ProductDetector] Best candidate: ${bestCandidate.selector} (score: ${bestCandidate.totalScore.toFixed(1)}, confidence: ${(bestCandidate.confidence * 100).toFixed(0)}%)`);
      console.log(`[ProductDetector] Best candidate tag: ${bestCandidate.tagName}`);

      // Step 7: Generate generic selector for the best candidate
      // Retry up to 3 times if we get a poor selector (just a tag name)
      let genericSelector = await this.generateGenericSelector(bestCandidate, patternGroups);
      console.log(`[ProductDetector] Generated generic selector (attempt 1): ${genericSelector}`);

      // If we just got a bare tag (like 'a' or 'div'), the DOM may not be fully ready
      // Wait a bit and try again
      const bareTagPattern = /^[a-z]+$/i;
      let attempts = 1;
      while (bareTagPattern.test(genericSelector) && attempts < 3) {
        console.log(`[ProductDetector] Generic selector is just a tag, retrying after wait...`);
        await this.page.waitForTimeout(500);
        genericSelector = await this.generateGenericSelector(bestCandidate, patternGroups);
        attempts++;
        console.log(`[ProductDetector] Generated generic selector (attempt ${attempts}): ${genericSelector}`);
      }

      // Final validation: if still just a tag, try to find any class on the element
      if (bareTagPattern.test(genericSelector)) {
        const fallbackSelector = await this.getFallbackGenericSelector(bestCandidate.selector);
        if (fallbackSelector) {
          console.log(`[ProductDetector] Using fallback generic selector: ${fallbackSelector}`);
          genericSelector = fallbackSelector;
        }
      }

      // Step 8: Get bounding box
      const boundingBox = await this.getBoundingBox(bestCandidate.selector);

      // Step 9: Handle lazy content if present
      await this.handleLazyContent(bestCandidate.selector);

      // Determine if fallback is recommended
      const fallbackRecommended = bestCandidate.confidence < this.config.minConfidence;

      // Find dominant pattern
      let dominantPattern: DetectionResult['dominantPattern'] = undefined;
      if (bestCandidate.patternGroup) {
        const patternSelectors = patternGroups.get(bestCandidate.patternGroup);
        if (patternSelectors) {
          dominantPattern = {
            hash: bestCandidate.patternGroup,
            count: patternSelectors.length,
            sampleSelector: patternSelectors[0],
          };
        }
      }

      return {
        selectedElement: {
          selector: bestCandidate.selector,
          genericSelector,
          boundingBox,
        },
        confidence: bestCandidate.confidence,
        fallbackRecommended,
        reason: fallbackRecommended
          ? `Low confidence (${(bestCandidate.confidence * 100).toFixed(0)}%) - manual verification recommended`
          : undefined,
        allCandidates: adjustedCandidates,
        dominantPattern,
      };

    } catch (error) {
      console.error('[ProductDetector] Detection error:', error);
      return {
        selectedElement: null,
        confidence: 0,
        fallbackRecommended: true,
        reason: `Detection error: ${error instanceof Error ? error.message : String(error)}`,
        allCandidates: [],
      };
    }
  }

  /**
   * Wait for page to stabilize (DOM to settle)
   */
  private async waitForPageStability(): Promise<void> {
    // Wait for DOM content to be loaded
    try {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 2000 });
    } catch {
      // Timeout is fine, continue
    }

    // Brief wait for initial render
    await this.page.waitForTimeout(100);
  }

  /**
   * Inject helper functions into the page
   */
  private async injectHelpers(): Promise<void> {
    // Inject structural analyzer helpers
    await this.page.evaluate(this.structuralAnalyzer.getPatternExtractionScript());
  }

  /**
   * Gather candidate elements using multiple strategies
   */
  private async gatherCandidates(): Promise<CandidateElement[]> {
    const maxCandidates = this.config.maxCandidates;

    const script = `
      (function() {
        const candidates = [];
        const seen = new Set();
        const maxCandidates = ${maxCandidates};

        // Helper to generate a unique selector for an element
        function getSelector(el) {
          // Try ID first
          if (el.id && !el.id.match(/^[0-9]/)) {
            return '#' + CSS.escape(el.id);
          }

          // Try data attributes
          const dataAttrs = ['data-product', 'data-productid', 'data-product-id', 'data-item', 'data-sku'];
          for (const attr of dataAttrs) {
            const value = el.getAttribute(attr);
            if (value) {
              return '[' + attr + '="' + CSS.escape(value) + '"]';
            }
          }

          // Build path selector
          const path = [];
          let current = el;
          let depth = 0;

          while (current && current.tagName !== 'BODY' && depth < 5) {
            let selector = current.tagName.toLowerCase();

            if (current.id && !current.id.match(/^[0-9]/)) {
              selector = '#' + CSS.escape(current.id);
              path.unshift(selector);
              break;
            }

            // Add first meaningful class
            const classes = Array.from(current.classList)
              .filter(c => !c.match(/^[0-9]|hover|active|focus|selected|ng-|js-/i))
              .slice(0, 2);
            if (classes.length > 0) {
              selector += '.' + classes.map(c => CSS.escape(c)).join('.');
            }

            // Add nth-of-type if needed
            if (current.parentElement) {
              const siblings = Array.from(current.parentElement.children)
                .filter(c => c.tagName === current.tagName);
              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += ':nth-of-type(' + index + ')';
              }
            }

            path.unshift(selector);
            current = current.parentElement;
            depth++;
          }

          return path.join(' > ');
        }

        // Helper to extract signals from element
        function extractSignals(el) {
          const rect = el.getBoundingClientRect();
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          const tagName = el.tagName.toLowerCase();

          // Structural signals
          const semanticTags = ['article', 'section', 'li', 'figure', 'aside'];
          const hasSemanticTag = semanticTags.includes(tagName);

          const productDataAttrs = ['data-product', 'data-productid', 'data-product-id', 'data-item', 'data-sku', 'data-itemid'];
          const hasProductDataAttr = productDataAttrs.some(attr => el.hasAttribute(attr));

          const hasSchemaOrg = el.hasAttribute('itemtype') && el.getAttribute('itemtype').includes('Product');

          let nestingDepth = 0;
          let current = el;
          while (current && current.tagName !== 'BODY') {
            nestingDepth++;
            current = current.parentElement;
          }

          // Visual signals
          const aspectRatio = rect.height > 0 ? rect.width / rect.height : 0;
          const parentStyle = el.parentElement ? getComputedStyle(el.parentElement) : null;
          const isGridPositioned = parentStyle ?
            (parentStyle.display.includes('grid') || parentStyle.display.includes('flex')) : false;

          // Check siblings
          const parent = el.parentElement;
          let hasSimilarSiblings = false;
          let siblingCount = 0;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName && c !== el);
            siblingCount = siblings.length;
            hasSimilarSiblings = siblingCount >= 2;
          }

          // Content signals
          const images = el.querySelectorAll('img');
          const hasImage = images.length > 0;
          const imageCount = images.length;

          const text = (el.textContent || '').trim();
          const textLength = text.length;

          // Price detection
          const priceRegex = /[£$€¥₹]\\s*\\d+([,.]\\d{2,3})?|\\d+([,.]\\d{2,3})?\\s*[£$€¥₹MAD]/i;
          const hasPricePattern = priceRegex.test(text) ||
            el.querySelector('[class*="price"]') !== null;

          // Link detection
          const links = el.querySelectorAll('a[href]');
          const linkCount = links.length;
          const productLinkPatterns = ['/product/', '/p/', '/item/', '/dp/', '/pd/', '/products/'];
          let hasProductLink = false;
          for (const link of links) {
            const href = link.getAttribute('href') || '';
            if (productLinkPatterns.some(p => href.includes(p))) {
              hasProductLink = true;
              break;
            }
          }

          // Title detection
          const hasTitle = el.querySelector('h1, h2, h3, h4, h5, h6') !== null ||
            (links.length > 0 && links[0].textContent && links[0].textContent.trim().length > 5);

          return {
            // Structural
            hasSemanticTag,
            hasProductDataAttr,
            hasSchemaOrg,
            nestingDepth,
            tagName,

            // Visual
            aspectRatio,
            isGridPositioned,
            hasSimilarSiblings,
            relativeSize: {
              widthRatio: rect.width / viewport.width,
              heightRatio: rect.height / viewport.height
            },
            boundingBox: {
              x: rect.left + window.scrollX,
              y: rect.top + window.scrollY,
              width: rect.width,
              height: rect.height
            },

            // Content
            hasImage,
            imageCount,
            hasPricePattern,
            hasProductLink,
            hasTitle,
            textLength,
            linkCount,

            // Context
            parentIsGrid: isGridPositioned,
            parentTagName: parent ? parent.tagName.toLowerCase() : 'body',
            siblingCount,
            structuralSimilarityToSiblings: hasSimilarSiblings ? 0.8 : 0.2
          };
        }

        // Strategy 1: Semantic elements
        const semanticSelectors = [
          'article',
          '[role="listitem"]',
          '[itemtype*="Product"]'
        ];

        // Strategy 2: Data attributes
        const dataAttrSelectors = [
          '[data-product]',
          '[data-product-id]',
          '[data-productid]',
          '[data-item]',
          '[data-sku]',
          '[data-itemid]'
        ];

        // Strategy 3: Common class patterns (expanded for more sites)
        const classSelectors = [
          // Product-specific
          '[class*="product-card"]',
          '[class*="product-item"]',
          '[class*="product-tile"]',
          '[class*="product_card"]',
          '[class*="product_item"]',
          '[class*="product_tile"]',
          '[class*="productCard"]',
          '[class*="productItem"]',
          '[class*="productTile"]',
          '[class*="ProductCard"]',
          '[class*="ProductItem"]',
          '[class*="ProductTile"]',
          // Item patterns
          '[class*="item-card"]',
          '[class*="item-tile"]',
          '[class*="itemCard"]',
          '[class*="ItemCard"]',
          // Listing patterns
          '[class*="listing-item"]',
          '[class*="listing-card"]',
          '[class*="listingItem"]',
          '[class*="ListingItem"]',
          // Search/results patterns
          '[class*="search-result"]',
          '[class*="searchResult"]',
          '[class*="SearchResult"]',
          // Grid patterns
          '[class*="grid-item"]',
          '[class*="gridItem"]',
          '[class*="GridItem"]',
          // Card patterns
          '[class*="card-product"]',
          '[class*="cardProduct"]',
          // Tile patterns
          '[class*="tile-product"]',
          '[class*="tileProduct"]',
          // Other common patterns
          '[class*="plp-card"]',
          '[class*="plp-item"]',
          '[class*="plp-tile"]',
          '[class*="hit-card"]',
          '[class*="hitCard"]',
          // Anchor/link based product cards (many sites use this)
          'a[class*="product"]',
          'a[class*="card"]',
          'a[class*="tile"]'
        ];

        const allSelectors = [
          ...semanticSelectors,
          ...dataAttrSelectors,
          ...classSelectors
        ];

        // Gather from explicit selectors
        for (const selector of allSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              if (seen.has(el) || candidates.length >= maxCandidates) continue;

              // Basic size filter
              const rect = el.getBoundingClientRect();
              if (rect.width < 50 || rect.height < 50) continue;
              if (rect.width > window.innerWidth * 0.9) continue; // Too wide, probably container

              seen.add(el);
              const elSelector = getSelector(el);
              const signals = extractSignals(el);

              candidates.push({
                selector: elSelector,
                tagName: el.tagName.toLowerCase(),
                signals
              });
            }
          } catch (e) {
            // Invalid selector, skip
          }
        }

        // Strategy 4: Grid children
        const gridContainers = document.querySelectorAll('[class*="grid"], [class*="list"], [class*="products"], [class*="results"]');
        for (const container of gridContainers) {
          const style = getComputedStyle(container);
          if (style.display.includes('grid') || style.display.includes('flex')) {
            for (const child of container.children) {
              if (seen.has(child) || candidates.length >= maxCandidates) continue;

              const rect = child.getBoundingClientRect();
              if (rect.width < 50 || rect.height < 50) continue;
              if (rect.width > window.innerWidth * 0.9) continue;

              seen.add(child);
              const elSelector = getSelector(child);
              const signals = extractSignals(child);

              candidates.push({
                selector: elSelector,
                tagName: child.tagName.toLowerCase(),
                signals
              });
            }
          }
        }

        // Strategy 5: Elements with images + prices (ALWAYS run this, not just fallback)
        // This is key for sites that don't follow standard naming patterns
        const allElements = document.querySelectorAll('div, article, section, li, figure, a');
        for (const el of allElements) {
          if (seen.has(el) || candidates.length >= maxCandidates) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width < 80 || rect.height < 80) continue;
          if (rect.width > window.innerWidth * 0.6) continue; // Products usually < 60% width

          // Must have image
          const img = el.querySelector('img');
          if (!img) continue;

          // Image must be reasonably sized (not an icon)
          const imgRect = img.getBoundingClientRect();
          if (imgRect.width < 50 || imgRect.height < 50) continue;

          // Check for price
          const text = el.textContent || '';
          const hasPrice = /[£$€¥₹]\\s*\\d+|\\d+[.,]\\d{2}|\\d+\\s*(MAD|USD|EUR|GBP)/i.test(text);

          // Check for price class
          const hasPriceClass = el.querySelector('[class*="price"], [class*="Price"], [class*="cost"], [class*="Cost"]') !== null;

          if (hasPrice || hasPriceClass) {
            seen.add(el);
            const elSelector = getSelector(el);
            const signals = extractSignals(el);

            candidates.push({
              selector: elSelector,
              tagName: el.tagName.toLowerCase(),
              signals
            });
          }
        }

        // Strategy 6: Find the smallest repeated elements that contain both images and links
        // This helps find product cards when they don't match any naming pattern
        const elementsWithImgAndLink = Array.from(document.querySelectorAll('div, article, section, li, figure, a'))
          .filter(el => {
            if (seen.has(el)) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 80 || rect.height < 80) return false;
            if (rect.width > window.innerWidth * 0.5) return false;

            const hasImg = el.querySelector('img') !== null;
            const hasLink = el.tagName === 'A' || el.querySelector('a[href]') !== null;
            return hasImg && hasLink;
          });

        // Group by parent to find repeating patterns
        const parentGroups = new Map();
        for (const el of elementsWithImgAndLink) {
          const parent = el.parentElement;
          if (!parent) continue;
          if (!parentGroups.has(parent)) {
            parentGroups.set(parent, []);
          }
          parentGroups.get(parent).push(el);
        }

        // Find the group with the most repeated elements (likely products)
        let bestGroup = null;
        let bestCount = 0;
        for (const [parent, children] of parentGroups) {
          // Only consider groups with 3+ similar elements
          if (children.length >= 3 && children.length > bestCount) {
            bestCount = children.length;
            bestGroup = children;
          }
        }

        if (bestGroup && bestGroup.length > 0) {
          for (const el of bestGroup) {
            if (seen.has(el) || candidates.length >= maxCandidates) continue;
            seen.add(el);
            const elSelector = getSelector(el);
            const signals = extractSignals(el);
            candidates.push({
              selector: elSelector,
              tagName: el.tagName.toLowerCase(),
              signals
            });
          }
        }

        return candidates;
      })()
    `;

    const result = await this.page.evaluate(script);
    return result as CandidateElement[];
  }

  /**
   * Score all candidate elements
   */
  private async scoreCandidates(candidates: CandidateElement[]): Promise<ElementScore[]> {
    return candidates.map(candidate => {
      return this.scorer.scoreElement(
        candidate.selector,
        candidate.tagName,
        candidate.signals
      );
    });
  }

  /**
   * Adjust scores based on classification - no filtering, just score/confidence adjustments
   * Products get boosted, non-products get penalized but stay in the list
   */
  private async adjustScoresWithClassification(scores: ElementScore[]): Promise<ElementScore[]> {
    for (const score of scores) {
      // Check classification
      const classificationScript = this.classifier.getClassificationScript(score.selector);
      const classification = await this.page.evaluate(classificationScript) as ClassificationResult;

      if (classification.isProduct) {
        // Boost products based on classification confidence
        const boost = 15 * classification.confidence;
        score.totalScore += boost;
        score.confidence = Math.min(1, score.confidence + 0.1);
        console.log(`[ProductDetector] Boosted ${score.selector} as product (+${boost.toFixed(1)})`);
      } else if (classification.isNonProduct) {
        // Penalize non-products but keep them in the list
        const penalty = 20 * classification.confidence;
        score.totalScore -= penalty;
        score.confidence = Math.max(0, score.confidence - 0.15);
        console.log(`[ProductDetector] Penalized ${score.selector} as ${classification.category} (-${penalty.toFixed(1)})`);
      }

      // Check for banner visuals - additional penalty
      const bannerScript = this.classifier.getBannerCheckScript(score.selector);
      const bannerCheck = await this.page.evaluate(bannerScript) as { isBanner: boolean; reason: string };

      if (bannerCheck.isBanner) {
        score.totalScore -= 25;
        score.confidence = Math.max(0, score.confidence - 0.2);
        console.log(`[ProductDetector] Penalized ${score.selector} as banner (${bannerCheck.reason})`);
      }

      // Check if element is fixed/sticky positioned - these are almost never product cards
      // They are usually sidebars, sticky carts, headers, or navigation elements
      const fixedStickyPatterns = ['fixed', 'Fixed', 'sticky', 'Sticky', 'absolute', 'Absolute'];
      const hasFixedStickyClass = fixedStickyPatterns.some(p => score.selector.includes(p));
      if (hasFixedStickyClass) {
        score.totalScore -= 50; // Heavy penalty - fixed/sticky elements are never product cards
        score.confidence = Math.max(0, score.confidence - 0.3);
        console.log(`[ProductDetector] Penalized ${score.selector.substring(0, 60)}... as fixed/sticky element (-50)`);
      }

      // Check if element is inside a carousel - penalize to prefer main grid items
      // Carousel products are usually featured/promotional, not the main listing
      const carouselPatterns = ['carousel', 'Carousel', 'slider', 'Slider', 'swiper', 'Swiper', 'embla', 'Embla'];
      const isInCarousel = carouselPatterns.some(p => score.selector.toLowerCase().includes(p.toLowerCase()));
      if (isInCarousel) {
        score.totalScore -= 15;
        score.confidence = Math.max(0, score.confidence - 0.1);
        console.log(`[ProductDetector] Penalized ${score.selector.substring(0, 60)}... as carousel item (-15)`);
      }
    }

    // Sort by score descending and return all candidates
    return scores.sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * Analyze structural patterns among candidates
   */
  private async analyzePatterns(scores: ElementScore[]): Promise<Map<string, string[]>> {
    const selectors = scores.map(s => s.selector);
    const script = this.structuralAnalyzer.getPatternGroupingScript(selectors);
    const result = await this.page.evaluate(script) as Record<string, string[]>;

    return new Map(Object.entries(result));
  }

  /**
   * Select the best candidate based on scores and patterns
   */
  private selectBestCandidate(
    scores: ElementScore[],
    _patternGroups: Map<string, string[]>
  ): ElementScore | null {
    if (scores.length === 0) return null;

    // Sort by total score (already includes pattern boost)
    const sorted = [...scores].sort((a, b) => b.totalScore - a.totalScore);

    // Log top 5 candidates for debugging
    console.log('[ProductDetector] Top 5 candidates:');
    sorted.slice(0, 5).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.tagName} (score: ${s.totalScore.toFixed(1)}, conf: ${(s.confidence * 100).toFixed(0)}%) - ${s.selector.substring(0, 80)}`);
    });

    // Also log top anchor candidates for debugging
    const topAnchors = sorted.filter(s => s.tagName === 'a').slice(0, 3);
    if (topAnchors.length > 0) {
      console.log('[ProductDetector] Top anchor candidates:');
      topAnchors.forEach((s, i) => {
        console.log(`  ${i + 1}. a (score: ${s.totalScore.toFixed(1)}, conf: ${(s.confidence * 100).toFixed(0)}%) - ${s.selector.substring(0, 80)}`);
      });
    }

    // Also log anchors WITH product classes specifically
    const anchorsWithProductClasses = sorted.filter(s =>
      s.tagName === 'a' && /a\.[^>]*(?:product|item|card|tile|box)/i.test(s.selector)
    ).slice(0, 3);
    if (anchorsWithProductClasses.length > 0) {
      console.log('[ProductDetector] Anchors WITH product classes:');
      anchorsWithProductClasses.forEach((s, i) => {
        console.log(`  ${i + 1}. a (score: ${s.totalScore.toFixed(1)}, conf: ${(s.confidence * 100).toFixed(0)}%) - ${s.selector.substring(0, 80)}`);
      });
    }

    // If the top candidate is a div and there are ANY anchor candidates, prefer anchors
    // Anchors are almost always the correct product element in e-commerce sites
    const topCandidate = sorted[0];
    if (topCandidate.tagName === 'div') {
      // FIRST: Look for anchors with product-related classes - these are highest priority
      // These are much more likely to generate good generic selectors
      if (anchorsWithProductClasses.length > 0) {
        const bestAnchor = anchorsWithProductClasses[0];
        if ((topCandidate.totalScore - bestAnchor.totalScore) < 30) {
          console.log(`[ProductDetector] Preferring anchor WITH product classes (div: ${topCandidate.totalScore.toFixed(1)}, anchor: ${bestAnchor.totalScore.toFixed(1)})`);
          return bestAnchor;
        }
      }

      // Look for anchor tags anywhere in the list that have reasonable scores (within 25 points)
      // PREFER anchors that have classes (for better generic selector generation)
      const anchorCandidates = sorted.filter(
        s => s.tagName === 'a' && (topCandidate.totalScore - s.totalScore) < 25
      );

      if (anchorCandidates.length > 0) {
        // Check if any anchor has classes in its selector (e.g., a.ProductBox_productBox)
        const anchorsWithClasses = anchorCandidates.filter(s => s.selector.includes('a.'));
        if (anchorsWithClasses.length > 0) {
          console.log(`[ProductDetector] Preferring anchor WITH classes over div (div: ${topCandidate.totalScore.toFixed(1)}, anchor: ${anchorsWithClasses[0].totalScore.toFixed(1)})`);
          return anchorsWithClasses[0];
        }
        console.log(`[ProductDetector] Preferring anchor over div (div: ${topCandidate.totalScore.toFixed(1)}, anchor: ${anchorCandidates[0].totalScore.toFixed(1)})`);
        return anchorCandidates[0];
      }
    }

    // Return highest scoring
    return sorted[0];
  }

  /**
   * Generate a generic selector that matches multiple similar elements
   */
  private async generateGenericSelector(
    score: ElementScore,
    patternGroups: Map<string, string[]>
  ): Promise<string> {
    // If element is part of a pattern group, generate selector from pattern
    if (score.patternGroup && patternGroups.has(score.patternGroup)) {
      const groupSelectors = patternGroups.get(score.patternGroup)!;
      if (groupSelectors.length >= 3) {
        // Find common selector pattern
        const script = `
          (function() {
            const selectors = ${JSON.stringify(groupSelectors.slice(0, 10))};
            const elements = selectors.map(s => document.querySelector(s)).filter(Boolean);

            if (elements.length === 0) return null;

            // Check for common tag
            const tags = new Set(elements.map(e => e.tagName.toLowerCase()));
            if (tags.size !== 1) return null;
            const tag = [...tags][0];

            // Find common classes
            const classSets = elements.map(e => new Set(Array.from(e.classList)
              .filter(c => !c.match(/^[0-9]|hover|active|focus|selected|ng-|js-/i))));

            if (classSets.length === 0) return tag;

            // Intersection of all class sets
            let commonClasses = [...classSets[0]];
            for (const classSet of classSets.slice(1)) {
              commonClasses = commonClasses.filter(c => classSet.has(c));
            }

            if (commonClasses.length === 0) return tag;

            // Build selector with first 1-2 common classes
            const classStr = commonClasses.slice(0, 2).map(c => CSS.escape(c)).join('.');
            return tag + '.' + classStr;
          })()
        `;

        const genericSelector = await this.page.evaluate(script);
        if (genericSelector) {
          return genericSelector as string;
        }
      }
    }

    // Fallback: extract generic from specific selector
    const script = `
      (function() {
        const el = document.querySelector(${JSON.stringify(score.selector)});
        if (!el) {
          console.log('[GenericSelector] Element not found for selector');
          return null;
        }

        const tag = el.tagName.toLowerCase();
        console.log('[GenericSelector] Element tag:', tag);
        console.log('[GenericSelector] Element classes:', Array.from(el.classList).join(', '));

        // Helper function to test if a selector matches multiple elements
        function testSelector(selector) {
          try {
            const matches = document.querySelectorAll(selector);
            return { count: matches.length, valid: matches.length >= 2 && matches.length <= 200 };
          } catch (e) {
            return { count: 0, valid: false };
          }
        }

        // Helper to filter out dynamic classes
        function filterClasses(classList) {
          return Array.from(classList)
            .filter(c => !c.match(/^[0-9]|hover|active|focus|selected|ng-|js-/i) && !c.includes('@') && !c.includes('/'));
        }

        // Helper to check if a class is a generic Tailwind utility (not useful for identification)
        function isGenericTailwindClass(cls) {
          // Common Tailwind utility prefixes that are too generic
          const genericPrefixes = [
            'flex', 'grid', 'block', 'inline', 'hidden', 'relative', 'absolute', 'fixed', 'sticky',
            'w-', 'h-', 'min-', 'max-', 'p-', 'm-', 'px-', 'py-', 'mx-', 'my-', 'pt-', 'pb-', 'pl-', 'pr-',
            'mt-', 'mb-', 'ml-', 'mr-', 'gap-', 'space-', 'text-', 'font-', 'bg-', 'border-', 'rounded',
            'shadow', 'opacity-', 'z-', 'top-', 'bottom-', 'left-', 'right-', 'inset-',
            'items-', 'justify-', 'self-', 'place-', 'order-', 'col-', 'row-',
            'overflow', 'cursor-', 'pointer-', 'select-', 'resize', 'whitespace-',
            'break-', 'truncate', 'leading-', 'tracking-', 'align-', 'decoration-',
            'list-', 'outline-', 'ring-', 'fill-', 'stroke-', 'sr-only',
            'transition', 'duration-', 'ease-', 'delay-', 'animate-',
            'hover:', 'focus:', 'active:', 'disabled:', 'group-', 'peer-',
            'sm:', 'md:', 'lg:', 'xl:', '2xl:', 'dark:'
          ];

          // Check if starts with any generic prefix
          for (const prefix of genericPrefixes) {
            if (cls.startsWith(prefix) || cls === prefix.replace('-', '')) {
              // EXCEPTION: Custom Tailwind classes with brackets like grid-cols-[18rem_1fr] are often site-specific
              if (cls.includes('[') && cls.includes(']')) {
                return false; // Keep these, they're unique
              }
              return true; // Generic utility, skip
            }
          }
          return false;
        }

        // Helper to find non-generic classes
        function findNonGenericClasses(classList) {
          return filterClasses(classList).filter(c => !isGenericTailwindClass(c));
        }

        // Semantic tags are good generic selectors
        const semanticTags = ['article', 'section', 'li', 'figure'];
        if (semanticTags.includes(tag)) {
          // Still try to add a class for specificity
          const classes = filterClasses(el.classList);
          if (classes.length > 0) {
            const testSel = tag + '.' + CSS.escape(classes[0]);
            if (testSelector(testSel).valid) return testSel;
          }
          return tag;
        }

        // Get all classes, filtering out dynamic ones
        const classes = filterClasses(el.classList);
        const nonGenericClasses = findNonGenericClasses(el.classList);
        console.log('[GenericSelector] Filtered classes:', classes.join(', '));
        console.log('[GenericSelector] Non-generic classes:', nonGenericClasses.join(', '));

        // Prioritize product-related class names
        const productClassPatterns = [/product/i, /item/i, /card/i, /tile/i, /box/i, /listing/i];
        const productClasses = classes.filter(c => productClassPatterns.some(p => p.test(c)));
        console.log('[GenericSelector] Product classes:', productClasses.join(', '));

        // Try product classes first
        for (const cls of productClasses) {
          const testSel = tag + '.' + CSS.escape(cls);
          const result = testSelector(testSel);
          console.log('[GenericSelector] Testing product class selector:', testSel, '- count:', result.count, 'valid:', result.valid);
          if (result.valid) return testSel;
        }

        // Try non-generic classes (custom classes, not Tailwind utilities)
        for (const cls of nonGenericClasses) {
          const testSel = tag + '.' + CSS.escape(cls);
          const result = testSelector(testSel);
          console.log('[GenericSelector] Testing non-generic class:', testSel, '- count:', result.count, 'valid:', result.valid);
          if (result.valid) return testSel;
        }

        // Try all classes (including Tailwind but might be unique combinations)
        for (const cls of classes) {
          // Skip if already tried as non-generic
          if (nonGenericClasses.includes(cls)) continue;
          const testSel = tag + '.' + CSS.escape(cls);
          const result = testSelector(testSel);
          console.log('[GenericSelector] Testing class selector:', testSel, '- count:', result.count, 'valid:', result.valid);
          if (result.valid) return testSel;
        }

        // Try combining tag with multiple classes for better specificity
        if (classes.length >= 2) {
          const twoClassSelector = tag + '.' + CSS.escape(classes[0]) + '.' + CSS.escape(classes[1]);
          if (testSelector(twoClassSelector).valid) return twoClassSelector;
        }

        // Fallback: look at parent's children with same tag+class pattern
        const parent = el.parentElement;
        if (parent && classes.length > 0) {
          const firstClass = classes[0];
          const siblingSelector = tag + '.' + CSS.escape(firstClass);
          const siblings = parent.querySelectorAll(':scope > ' + siblingSelector);
          if (siblings.length >= 2) {
            return siblingSelector;
          }
        }

        // NEW: If tag is 'div' with no good classes, try to find a better child element
        // This handles cases where we accidentally selected a wrapper div
        if (tag === 'div' && classes.length === 0) {
          // Look for anchor children that are likely product cards
          const anchors = el.querySelectorAll('a');
          for (const anchor of anchors) {
            const anchorClasses = filterClasses(anchor.classList);
            const productAnchorClasses = anchorClasses.filter(c => productClassPatterns.some(p => p.test(c)));

            for (const cls of productAnchorClasses) {
              const testSel = 'a.' + CSS.escape(cls);
              if (testSelector(testSel).valid) return testSel;
            }

            for (const cls of anchorClasses) {
              const testSel = 'a.' + CSS.escape(cls);
              if (testSelector(testSel).valid) return testSel;
            }
          }

          // Also look for any child with product-related classes
          const allChildren = el.querySelectorAll('*');
          for (const child of allChildren) {
            const childTag = child.tagName.toLowerCase();
            const childClasses = filterClasses(child.classList);
            const productChildClasses = childClasses.filter(c => productClassPatterns.some(p => p.test(c)));

            for (const cls of productChildClasses) {
              const testSel = childTag + '.' + CSS.escape(cls);
              if (testSelector(testSel).valid) return testSel;
            }
          }
        }

        // NEW: Look at siblings to find a common selector pattern
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
          if (siblings.length >= 2) {
            // Find classes common across all siblings
            const siblingsClasses = siblings.map(s => new Set(filterClasses(s.classList)));
            if (siblingsClasses.length > 0 && siblingsClasses[0].size > 0) {
              let commonClasses = [...siblingsClasses[0]];
              for (const classSet of siblingsClasses.slice(1)) {
                commonClasses = commonClasses.filter(c => classSet.has(c));
              }

              // Prioritize product-related common classes
              const productCommon = commonClasses.filter(c => productClassPatterns.some(p => p.test(c)));
              for (const cls of productCommon) {
                const testSel = tag + '.' + CSS.escape(cls);
                if (testSelector(testSel).valid) return testSel;
              }

              for (const cls of commonClasses) {
                const testSel = tag + '.' + CSS.escape(cls);
                if (testSelector(testSel).valid) return testSel;
              }
            }
          }
        }

        // Last resort: use first class even if it only matches 1
        if (classes.length > 0) {
          return tag + '.' + CSS.escape(classes[0]);
        }

        return tag;
      })()
    `;

    const result = await this.page.evaluate(script);
    return (result as string) || score.tagName;
  }

  /**
   * Fallback method to get a generic selector when primary method fails
   * This directly queries the element and tries harder to find usable classes
   */
  private async getFallbackGenericSelector(specificSelector: string): Promise<string | null> {
    const script = `
      (function() {
        const el = document.querySelector(${JSON.stringify(specificSelector)});
        if (!el) return null;

        const tag = el.tagName.toLowerCase();

        // Helper to filter usable classes
        function filterUsableClasses(classes) {
          return classes.filter(c => {
            // Skip classes that start with numbers
            if (/^[0-9]/.test(c)) return false;
            // Skip very short classes (likely utility)
            if (c.length < 3) return false;
            // Skip obvious state classes
            if (/^(hover|active|focus|selected|current|open|closed|visible|hidden)$/i.test(c)) return false;
            return true;
          });
        }

        // Helper to find product-related classes
        function findProductClasses(classes) {
          const productPatterns = [/product/i, /item/i, /card/i, /tile/i, /box/i, /listing/i];
          return classes.filter(c => productPatterns.some(p => p.test(c)));
        }

        // Get ALL classes, even those that might have been filtered before
        const allClasses = Array.from(el.classList);
        console.log('[FallbackSelector] Element tag:', tag, 'classes:', allClasses.join(', '));

        const usableClasses = filterUsableClasses(allClasses);
        console.log('[FallbackSelector] Usable classes:', usableClasses.join(', '));

        // Try product-related classes first
        const productClasses = findProductClasses(usableClasses);
        for (const cls of productClasses) {
          const testSelector = tag + '.' + CSS.escape(cls);
          try {
            const matches = document.querySelectorAll(testSelector);
            console.log('[FallbackSelector] Testing product class:', testSelector, '- matches:', matches.length);
            if (matches.length >= 2 && matches.length <= 200) {
              return testSelector;
            }
          } catch (e) {
            // Invalid selector, skip
          }
        }

        // Try each class
        for (const cls of usableClasses) {
          const testSelector = tag + '.' + CSS.escape(cls);
          try {
            const matches = document.querySelectorAll(testSelector);
            console.log('[FallbackSelector] Testing:', testSelector, '- matches:', matches.length);
            if (matches.length >= 2 && matches.length <= 200) {
              return testSelector;
            }
          } catch (e) {
            // Invalid selector, skip
          }
        }

        // ALWAYS look at parent elements to build a better selector
        // This is crucial for Tailwind sites where product items have no unique classes
        if (el.parentElement) {
          const parent = el.parentElement;
          const parentClasses = filterUsableClasses(Array.from(parent.classList));
          const parentProductClasses = findProductClasses(parentClasses);
          console.log('[FallbackSelector] Checking parent. Parent classes:', parentClasses.join(', '));

          // Helper to find classes with brackets (custom Tailwind values)
          function findBracketClasses(classes) {
            return classes.filter(c => c.includes('[') && c.includes(']'));
          }

          // FIRST: Look for the immediate parent grid/flex container with unique classes
          // The parent of product items is usually the grid that holds them
          const parentStyle = getComputedStyle(parent);
          if (parentStyle.display.includes('grid') || parentStyle.display.includes('flex')) {
            console.log('[FallbackSelector] Parent is grid/flex container');

            // Look for bracket classes on parent (like gap-x-[1px], grid-cols-[...])
            const parentBracketClasses = findBracketClasses(Array.from(parent.classList));
            if (parentBracketClasses.length > 0) {
              for (const cls of parentBracketClasses) {
                const testSelector = parent.tagName.toLowerCase() + '.' + CSS.escape(cls) + ' > ' + tag;
                try {
                  const matches = document.querySelectorAll(testSelector);
                  console.log('[FallbackSelector] Testing parent bracket class:', testSelector, '- matches:', matches.length);
                  if (matches.length >= 2 && matches.length <= 100) {
                    return testSelector;
                  }
                } catch (e) {}
              }
            }

            // Try parent's product classes combined with child tag
            for (const cls of parentProductClasses) {
              const testSelector = parent.tagName.toLowerCase() + '.' + CSS.escape(cls) + ' > ' + tag;
              try {
                const matches = document.querySelectorAll(testSelector);
                console.log('[FallbackSelector] Testing parent+child:', testSelector, '- matches:', matches.length);
                if (matches.length >= 2 && matches.length <= 200) {
                  return testSelector;
                }
              } catch (e) {}
            }

            // Try all parent classes
            for (const cls of parentClasses) {
              const testSelector = parent.tagName.toLowerCase() + '.' + CSS.escape(cls) + ' > ' + tag;
              try {
                const matches = document.querySelectorAll(testSelector);
                console.log('[FallbackSelector] Testing parent+child:', testSelector, '- matches:', matches.length);
                if (matches.length >= 2 && matches.length <= 200) {
                  return testSelector;
                }
              } catch (e) {}
            }

            // Try combining multiple parent classes for specificity
            // This helps when individual Tailwind classes are too common
            const allParentClasses = Array.from(parent.classList).filter(c =>
              !c.match(/^[0-9]|hover|active|focus|selected|ng-|js-/i) && !c.includes('@') && !c.includes('/')
            );
            if (allParentClasses.length >= 2) {
              // Use 2-3 classes together
              const classesToUse = allParentClasses.slice(0, 3);
              const multiClassSelector = parent.tagName.toLowerCase() + '.' +
                classesToUse.map(c => CSS.escape(c)).join('.') + ' > ' + tag;
              try {
                const matches = document.querySelectorAll(multiClassSelector);
                console.log('[FallbackSelector] Testing multi-class parent:', multiClassSelector, '- matches:', matches.length);
                if (matches.length >= 2 && matches.length <= 100) {
                  return multiClassSelector;
                }
              } catch (e) {}
            }
          }

          // If parent has product classes, use just the parent selector as fallback
          if (parentProductClasses.length > 0) {
            return parent.tagName.toLowerCase() + '.' + CSS.escape(parentProductClasses[0]) + ' > ' + tag;
          }

          // For Tailwind-based sites: Try to find a unique structural path
          // Look for the grid container that holds the products (might be parent or ancestor)
          const grandparent = parent.parentElement;
          if (grandparent) {
            // Try to build a selector using multiple parent classes for specificity
            const gpClasses = filterUsableClasses(Array.from(grandparent.classList));
            console.log('[FallbackSelector] Checking grandparent. Classes:', gpClasses.join(', '));

            // Look for grid/flex containers in the hierarchy
            let gridContainer = null;
            let current = parent;
            let depth = 0;
            while (current && current.tagName !== 'BODY' && depth < 5) {
              const style = getComputedStyle(current);
              if (style.display.includes('grid') || style.display.includes('flex')) {
                gridContainer = current;
                break;
              }
              current = current.parentElement;
              depth++;
            }

            if (gridContainer) {
              // Try to build a selector from the grid container down to the element
              const containerClasses = filterUsableClasses(Array.from(gridContainer.classList));
              console.log('[FallbackSelector] Found grid container. Classes:', containerClasses.join(', '));

              // Find unique classes that might identify this grid
              const gridIdentifyingClasses = containerClasses.filter(c => {
                // KEEP: Custom Tailwind classes with brackets like grid-cols-[18rem_1fr] - these are site-specific!
                if (c.includes('[') && c.includes(']')) return true;
                // Skip very common Tailwind grid classes
                if (/^(grid|flex|gap-|items-|justify-|col-|row-)/.test(c)) return false;
                // Keep classes that look more specific
                return c.length > 5;
              });

              // Try each identifying class
              for (const cls of gridIdentifyingClasses) {
                // Test direct children
                const testSelector = gridContainer.tagName.toLowerCase() + '.' + CSS.escape(cls) + ' > ' + tag;
                try {
                  const matches = document.querySelectorAll(testSelector);
                  console.log('[FallbackSelector] Testing grid+child:', testSelector, '- matches:', matches.length);
                  if (matches.length >= 2 && matches.length <= 100) {
                    return testSelector;
                  }
                } catch (e) {}
              }

              // If no specific classes, use multiple Tailwind classes together for specificity
              if (containerClasses.length >= 2) {
                const multiClassSelector = gridContainer.tagName.toLowerCase() + '.' +
                  containerClasses.slice(0, 3).map(c => CSS.escape(c)).join('.') + ' > ' + tag;
                try {
                  const matches = document.querySelectorAll(multiClassSelector);
                  console.log('[FallbackSelector] Testing multi-class:', multiClassSelector, '- matches:', matches.length);
                  if (matches.length >= 2 && matches.length <= 100) {
                    return multiClassSelector;
                  }
                } catch (e) {}
              }
            }
          }
        }

        // If no single class works, try the first usable class even if it only matches 1
        // This is better than returning just the tag
        if (usableClasses.length > 0) {
          return tag + '.' + CSS.escape(usableClasses[0]);
        }

        // LAST RESORT: Walk up the ancestor tree looking for ANY element with classes
        // This handles cases like li inside ul inside div.css-xxx
        let ancestor = el.parentElement;
        let depth = 0;
        while (ancestor && ancestor.tagName !== 'BODY' && depth < 6) {
          const ancestorClasses = filterUsableClasses(Array.from(ancestor.classList));
          console.log('[FallbackSelector] Checking ancestor depth', depth, ':', ancestor.tagName, 'classes:', ancestorClasses.join(', '));

          if (ancestorClasses.length > 0) {
            // Try descendant selector (space, not >)
            for (const cls of ancestorClasses) {
              const testSelector = ancestor.tagName.toLowerCase() + '.' + CSS.escape(cls) + ' ' + tag;
              try {
                const matches = document.querySelectorAll(testSelector);
                console.log('[FallbackSelector] Testing ancestor descendant:', testSelector, '- matches:', matches.length);
                if (matches.length >= 2 && matches.length <= 200) {
                  return testSelector;
                }
              } catch (e) {}
            }

            // If the element's immediate parent is UL/OL, try ancestor > ul/ol > tag
            if (el.parentElement && (el.parentElement.tagName === 'UL' || el.parentElement.tagName === 'OL')) {
              const listTag = el.parentElement.tagName.toLowerCase();
              for (const cls of ancestorClasses) {
                const testSelector = ancestor.tagName.toLowerCase() + '.' + CSS.escape(cls) + ' > ' + listTag + ' > ' + tag;
                try {
                  const matches = document.querySelectorAll(testSelector);
                  console.log('[FallbackSelector] Testing ancestor > list > tag:', testSelector, '- matches:', matches.length);
                  if (matches.length >= 2 && matches.length <= 200) {
                    return testSelector;
                  }
                } catch (e) {}
              }
              // Also try without direct child on list
              for (const cls of ancestorClasses) {
                const testSelector = ancestor.tagName.toLowerCase() + '.' + CSS.escape(cls) + ' ' + listTag + ' > ' + tag;
                try {
                  const matches = document.querySelectorAll(testSelector);
                  console.log('[FallbackSelector] Testing ancestor list > tag:', testSelector, '- matches:', matches.length);
                  if (matches.length >= 2 && matches.length <= 200) {
                    return testSelector;
                  }
                } catch (e) {}
              }
            }
          }

          ancestor = ancestor.parentElement;
          depth++;
        }

        return null;
      })()
    `;

    return await this.page.evaluate(script) as string | null;
  }

  /**
   * Get bounding box for an element
   */
  private async getBoundingBox(selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
    const script = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { x: 0, y: 0, width: 0, height: 0 };

        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height
        };
      })()
    `;

    return await this.page.evaluate(script) as { x: number; y: number; width: number; height: number };
  }

  /**
   * Handle lazy content in the selected element
   */
  private async handleLazyContent(selector: string): Promise<void> {
    const hasLazyScript = this.lazyLoadHandler.getHasLazyContentScript(selector);
    const lazyCheck = await this.page.evaluate(hasLazyScript) as { hasLazy: boolean };

    if (lazyCheck.hasLazy) {
      console.log('[ProductDetector] Found lazy content, forcing load');
      const forceLoadScript = this.lazyLoadHandler.getForceLoadImagesScript(selector);
      const loadResult = await this.page.evaluate(forceLoadScript) as { loaded: number };
      console.log(`[ProductDetector] Force loaded ${loadResult.loaded} images`);
    }
  }

  /**
   * Highlight the detected element on the page
   */
  async highlightElement(selector: string): Promise<void> {
    const script = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;

        // Store original styles
        el.setAttribute('data-scraper-original-outline', el.style.outline || '');
        el.setAttribute('data-scraper-original-boxshadow', el.style.boxShadow || '');
        el.setAttribute('data-scraper-detected', 'true');

        // Apply highlight
        el.style.cssText += '; outline: 4px solid #00cc66 !important; box-shadow: 0 0 20px rgba(0,204,102,0.5), inset 0 0 10px rgba(0,204,102,0.1) !important; outline-offset: 2px !important;';

        // Scroll into view
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        return true;
      })()
    `;

    await this.page.evaluate(script);
  }
}
