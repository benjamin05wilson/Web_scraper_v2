// ============================================================================
// PRODUCT DETECTOR - ML-based product detection orchestrator
// ============================================================================

import type { Page, CDPSession } from 'playwright';
import { ElementScorer } from '../ml/ElementScorer.js';
import { StructuralAnalyzer } from '../ml/StructuralAnalyzer.js';
import { ContentClassifier } from '../ml/ContentClassifier.js';
import { LazyLoadHandler } from '../ml/LazyLoadHandler.js';
import { getGeminiService } from '../ai/GeminiService.js';
import type {
  DetectionResult,
  DetectorConfig,
  ElementScore,
  CandidateElement,
  ClassificationResult,
} from '../types/detection-types.js';
import type {
  GridRegionResult,
  SelectorValidationResult,
  RegionHTMLResult,
  MultiStepDetectionResult,
  MultiStepDetectionConfig,
} from '../ai/types.js';
import { DEFAULT_MULTI_STEP_CONFIG } from '../ai/types.js';

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
          const priceRegex = /[£$€¥₹]\\s*\\d+([,.]\\d{2,3})?|\\d+([,.]\\d{2,3})?\\s*[£$€¥₹MAD]/gi;
          const priceMatches = text.match(priceRegex) || [];
          const priceCount = priceMatches.length;
          const hasPricePattern = priceCount > 0 ||
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
            priceCount,  // Number of price matches (2+ suggests RRP + sale price)
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

  /**
   * AI-enhanced product detection using Gemini Vision
   * Falls back to ML detection if AI fails
   */
  async detectProductWithAI(): Promise<DetectionResult & { source: 'ai' | 'ml' }> {
    const gemini = getGeminiService();

    if (!gemini.isEnabled) {
      console.log('[ProductDetector] Gemini not enabled, using ML detection');
      const result = await this.detectProduct();
      return { ...result, source: 'ml' };
    }

    console.log('[ProductDetector] Starting AI-enhanced product detection...');

    try {
      // Take screenshot
      const screenshotBuffer = await this.page.screenshot({ type: 'png' });
      const screenshotBase64 = screenshotBuffer.toString('base64');

      // Get simplified DOM structure for context
      const domStructure = await this.page.evaluate(() => {
        const elements: string[] = [];
        const seen = new Set<Element>();

        // Find elements that might be product containers
        const selectors = [
          '[class*="product"]',
          '[class*="item"]',
          '[class*="card"]',
          '[class*="tile"]',
          '[class*="grid"]',
          '[class*="list"]',
          'article',
          'section'
        ];

        for (const sel of selectors) {
          try {
            const found = document.querySelectorAll(sel);
            for (const el of found) {
              if (seen.has(el)) continue;
              seen.add(el);

              const rect = el.getBoundingClientRect();
              if (rect.width < 50 || rect.height < 50) continue;

              const tag = el.tagName.toLowerCase();
              const classes = el.className ? `.${el.className.split(' ').slice(0, 3).join('.')}` : '';
              const childCount = el.children.length;
              const hasImg = el.querySelector('img') ? '[has-img]' : '';
              const hasPrice = el.textContent?.match(/[$€£¥]\d+|\d+\.\d{2}/) ? '[has-price]' : '';

              elements.push(`<${tag}${classes}${hasImg}${hasPrice}>(${childCount} children)`);

              if (elements.length >= 50) break;
            }
          } catch (e) {
            // Invalid selector
          }
          if (elements.length >= 50) break;
        }

        return elements.join('\n');
      });

      // Call Gemini
      const result = await gemini.detectProducts(screenshotBase64, domStructure);

      if (!result.success || !result.data) {
        console.log(`[ProductDetector] AI detection failed: ${result.error}, falling back to ML`);
        const mlResult = await this.detectProduct();
        return { ...mlResult, source: 'ml' };
      }

      const aiResult = result.data;
      console.log(`[ProductDetector] AI detected: found=${aiResult.products_found}, selector=${aiResult.item_selector}, count=${aiResult.item_count}, confidence=${aiResult.confidence} (latency: ${result.latencyMs}ms)`);

      if (!aiResult.products_found || !aiResult.item_selector || aiResult.confidence < 0.5) {
        console.log('[ProductDetector] AI found no products or low confidence, falling back to ML');
        const mlResult = await this.detectProduct();
        return { ...mlResult, source: 'ml' };
      }

      // Sanitize AI-suggested selector - remove invalid pseudo-selectors the AI might add
      let sanitizedSelector = aiResult.item_selector
        .replace(/\[has-img\]/gi, '')
        .replace(/\[has-price\]/gi, '')
        .replace(/\[has-link\]/gi, '')
        .replace(/\[has-text\]/gi, '')
        .replace(/\[contains-.*?\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      // If sanitization removed everything meaningful, fall back
      if (!sanitizedSelector || sanitizedSelector.length < 2) {
        console.log('[ProductDetector] AI selector invalid after sanitization, falling back to ML');
        const mlResult = await this.detectProduct();
        return { ...mlResult, source: 'ml' };
      }

      console.log(`[ProductDetector] Sanitized selector: ${sanitizedSelector}`);

      // Validate AI-suggested selector
      const selectorCheck = await this.page.evaluate((selector) => {
        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length === 0) return { valid: false, count: 0, reason: 'No elements found' };
          if (elements.length < 3) return { valid: false, count: elements.length, reason: 'Too few elements' };
          if (elements.length > 200) return { valid: false, count: elements.length, reason: 'Too many elements' };

          // Check if elements have images and reasonable size
          let validCount = 0;
          for (const el of elements) {
            const rect = el.getBoundingClientRect();
            if (rect.width >= 50 && rect.height >= 50 && el.querySelector('img')) {
              validCount++;
            }
          }

          if (validCount < 3) return { valid: false, count: validCount, reason: 'Not enough valid product elements' };

          return { valid: true, count: elements.length, validCount };
        } catch (e) {
          return { valid: false, count: 0, reason: 'Invalid selector syntax' };
        }
      }, sanitizedSelector);

      if (!selectorCheck.valid) {
        console.log(`[ProductDetector] AI selector validation failed: ${selectorCheck.reason}, trying ML detection`);
        const mlResult = await this.detectProduct();
        return { ...mlResult, source: 'ml' };
      }

      console.log(`[ProductDetector] AI selector validated: ${selectorCheck.count} elements found`);

      // Get bounding box of first element
      const boundingBox = await this.getBoundingBox(sanitizedSelector);

      // Generate a generic selector (the sanitized AI selector should already be generic)
      const genericSelector = sanitizedSelector;

      return {
        selectedElement: {
          selector: `${sanitizedSelector}:first-of-type`,
          genericSelector,
          boundingBox,
        },
        confidence: aiResult.confidence,
        fallbackRecommended: aiResult.confidence < 0.7,
        reason: aiResult.confidence < 0.7
          ? `AI detection (${(aiResult.confidence * 100).toFixed(0)}% confidence) - manual verification recommended`
          : undefined,
        allCandidates: [],
        source: 'ai',
      };

    } catch (error) {
      console.error('[ProductDetector] AI detection error:', error);
      const mlResult = await this.detectProduct();
      return { ...mlResult, source: 'ml' };
    }
  }

  // ===========================================================================
  // MULTI-STEP AI DETECTION PIPELINE
  // ===========================================================================

  /**
   * Multi-step AI detection pipeline for near-100% accuracy
   * Pipeline: Grid Detection → HTML Extraction → Candidate Generation →
   *           Live Validation → AI Refinement Loop → Final Verification
   */
  async detectProductWithMultiStepAI(
    config: Partial<MultiStepDetectionConfig> = {}
  ): Promise<MultiStepDetectionResult> {
    const fullConfig = { ...DEFAULT_MULTI_STEP_CONFIG, ...config };
    const gemini = getGeminiService();

    console.log('[ProductDetector] Starting multi-step AI detection pipeline...');

    // Track pipeline state for result
    const pipelineState = {
      gridDetected: false,
      candidatesGenerated: 0,
      refinementIterations: 0,
      verified: false,
    };

    try {
      // =====================================================================
      // Step 1: Visual Grid Detection
      // =====================================================================
      let gridRegion: GridRegionResult | null = null;
      let screenshotBase64: string;

      if (!fullConfig.skipVisualStep) {
        console.log('[ProductDetector] Step 1: Visual grid detection...');
        const screenshotBuffer = await this.page.screenshot({ type: 'png' });
        screenshotBase64 = screenshotBuffer.toString('base64');

        const gridResult = await gemini.detectProductGridRegion(screenshotBase64);

        if (gridResult.success && gridResult.data?.grid_found) {
          gridRegion = gridResult.data;
          pipelineState.gridDetected = true;
          console.log(`[ProductDetector] Grid detected: ${gridRegion.estimated_columns}x${gridRegion.estimated_rows} at (${gridRegion.region.left_percent}%, ${gridRegion.region.top_percent}%)`);
        } else {
          console.log('[ProductDetector] No grid detected, will use full page');
        }
      } else {
        // Still need screenshot for verification
        const screenshotBuffer = await this.page.screenshot({ type: 'png' });
        screenshotBase64 = screenshotBuffer.toString('base64');
      }

      // =====================================================================
      // Step 2: HTML Extraction from Region
      // =====================================================================
      console.log('[ProductDetector] Step 2: Extracting HTML from region...');
      const regionHTML = await this.extractRegionHTML(gridRegion);
      console.log(`[ProductDetector] Extracted ${regionHTML.sampleElements.length} sample elements, ${regionHTML.containerCandidates.length} container candidates`);

      if (regionHTML.sampleElements.length < 2) {
        console.log('[ProductDetector] Not enough sample elements, falling back to single AI detection');
        const fallback = await this.detectProductWithAI();
        return {
          selector: fallback.selectedElement?.selector || '',
          genericSelector: fallback.selectedElement?.genericSelector || '',
          confidence: fallback.confidence,
          source: 'single-ai',
          iterations: 1,
          pipeline: pipelineState,
        };
      }

      // =====================================================================
      // Step 3: Generate Selector Candidates
      // =====================================================================
      console.log('[ProductDetector] Step 3: Generating selector candidates...');
      const sampleHTMLs = regionHTML.sampleElements.map(e => e.outerHTML);

      const candidatesResult = await gemini.generateSelectorCandidates(
        sampleHTMLs,
        regionHTML.fullHTML.substring(0, 5000),
        regionHTML.containerCandidates
      );

      if (!candidatesResult.success || !candidatesResult.data?.candidates.length) {
        console.log('[ProductDetector] Failed to generate candidates, falling back to ML');
        const fallback = await this.detectProduct();
        return {
          selector: fallback.selectedElement?.selector || '',
          genericSelector: fallback.selectedElement?.genericSelector || '',
          confidence: fallback.confidence,
          source: 'ml',
          iterations: 1,
          pipeline: pipelineState,
        };
      }

      let candidates = candidatesResult.data.candidates;
      pipelineState.candidatesGenerated = candidates.length;
      console.log(`[ProductDetector] Generated ${candidates.length} candidates:`);
      candidates.forEach((c, i) => console.log(`  ${i + 1}. ${c.selector} (${c.specificity}, priority: ${c.priority})`));

      // Estimated product count from grid or sample
      const estimatedProductCount = gridRegion
        ? gridRegion.estimated_columns * gridRegion.estimated_rows
        : regionHTML.sampleElements.length * 3;

      // =====================================================================
      // Steps 4-5: Validation + Refinement Loop
      // =====================================================================
      let acceptedSelector: string | null = null;
      let iteration = 0;

      while (iteration < fullConfig.maxRefinementIterations && !acceptedSelector) {
        iteration++;
        pipelineState.refinementIterations = iteration;
        console.log(`[ProductDetector] Step 4-5: Validation/Refinement iteration ${iteration}...`);

        // Step 4: Validate all current candidates
        const validationResults = await this.validateSelectorCandidates(
          candidates.map(c => c.selector)
        );

        console.log('[ProductDetector] Validation results:');
        validationResults.forEach(v => {
          console.log(`  ${v.selector}: ${v.matchCount} matches, ${v.hasPrices} prices, ${v.hasImages} images${v.issues.length ? ` [${v.issues.join(', ')}]` : ''}`);
        });

        // Step 5: AI refinement decision
        const refinementResult = await gemini.refineSelectorWithValidation(
          validationResults,
          estimatedProductCount,
          iteration
        );

        if (!refinementResult.success || !refinementResult.data) {
          console.log('[ProductDetector] Refinement failed, using best ML candidate');
          break;
        }

        const decision = refinementResult.data;
        console.log(`[ProductDetector] AI decision: ${decision.action} - ${decision.reasoning}`);

        if (decision.action === 'accept' && decision.selected_selector) {
          acceptedSelector = decision.selected_selector;
          console.log(`[ProductDetector] Selector accepted: ${acceptedSelector}`);
        } else if (decision.action === 'refine' && decision.refined_selector) {
          // Add refined selector as new candidate for next iteration
          candidates = [{
            selector: decision.refined_selector,
            reasoning: decision.reasoning,
            specificity: 'medium',
            expected_count: estimatedProductCount,
            priority: 1,
          }];
          console.log(`[ProductDetector] Selector refined to: ${decision.refined_selector}`);
        } else if (decision.action === 'reject_all') {
          console.log('[ProductDetector] All selectors rejected by AI');
          break;
        }
      }

      // If no selector accepted after iterations, use best ML candidate
      if (!acceptedSelector) {
        console.log('[ProductDetector] No AI-accepted selector, falling back to ML');
        const fallback = await this.detectProduct();
        return {
          selector: fallback.selectedElement?.selector || '',
          genericSelector: fallback.selectedElement?.genericSelector || '',
          confidence: fallback.confidence,
          source: 'ml',
          iterations: iteration,
          pipeline: pipelineState,
        };
      }

      // =====================================================================
      // Step 6: Final Verification
      // =====================================================================
      let finalConfidence = 0.8; // Default confidence for accepted selectors

      if (fullConfig.enableVerification) {
        console.log('[ProductDetector] Step 6: Final verification...');

        // Get sample HTML of matched elements for verification
        const verificationSamples = await this.page.evaluate((selector) => {
          try {
            const elements = document.querySelectorAll(selector);
            return Array.from(elements)
              .slice(0, 5)
              .map(el => el.outerHTML.substring(0, 1000));
          } catch {
            return [];
          }
        }, acceptedSelector);

        if (verificationSamples.length > 0) {
          const verifyResult = await gemini.verifyProductElements(
            acceptedSelector,
            verificationSamples,
            screenshotBase64!
          );

          if (verifyResult.success && verifyResult.data) {
            pipelineState.verified = verifyResult.data.verified;
            finalConfidence = verifyResult.data.confidence;

            if (!verifyResult.data.verified) {
              console.log(`[ProductDetector] Verification failed: ${verifyResult.data.issues.join(', ')}`);
              // Still use the selector but with reduced confidence
              finalConfidence = Math.min(finalConfidence, 0.5);
            } else {
              console.log(`[ProductDetector] Verification passed: ${verifyResult.data.product_count} products confirmed`);
            }
          }
        }
      }

      // Generate generic selector (the accepted selector should already be generic)
      const genericSelector = acceptedSelector;

      console.log(`[ProductDetector] Multi-step detection complete: ${acceptedSelector} (confidence: ${(finalConfidence * 100).toFixed(0)}%)`);

      return {
        selector: acceptedSelector,
        genericSelector,
        confidence: finalConfidence,
        source: 'multi-step-ai',
        iterations: iteration,
        pipeline: pipelineState,
      };

    } catch (error) {
      console.error('[ProductDetector] Multi-step detection error:', error);
      const fallback = await this.detectProduct();
      return {
        selector: fallback.selectedElement?.selector || '',
        genericSelector: fallback.selectedElement?.genericSelector || '',
        confidence: fallback.confidence,
        source: 'ml',
        iterations: 0,
        pipeline: pipelineState,
      };
    }
  }

  /**
   * Step 2: Extract HTML from the detected grid region
   */
  private async extractRegionHTML(gridRegion: GridRegionResult | null): Promise<RegionHTMLResult> {
    const script = `
      (function() {
        const viewport = { width: window.innerWidth, height: window.innerHeight };

        // Define region bounds (percentage to pixels)
        const region = ${gridRegion ? JSON.stringify(gridRegion.region) : '{ top_percent: 10, left_percent: 0, width_percent: 100, height_percent: 80 }'};
        const bounds = {
          top: viewport.height * region.top_percent / 100,
          left: viewport.width * region.left_percent / 100,
          right: viewport.width * (region.left_percent + region.width_percent) / 100,
          bottom: viewport.height * (region.top_percent + region.height_percent) / 100,
        };

        console.log('[ExtractRegion] Bounds:', bounds);

        // Sample points within the region to find elements
        const samplePoints = [];
        const cols = 5;
        const rows = 4;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = bounds.left + (bounds.right - bounds.left) * (c + 0.5) / cols;
            const y = bounds.top + (bounds.bottom - bounds.top) * (r + 0.5) / rows;
            samplePoints.push({ x, y });
          }
        }

        // Find elements at sample points
        const foundElements = new Set();
        const elementDetails = [];

        for (const point of samplePoints) {
          const element = document.elementFromPoint(point.x, point.y);
          if (!element || element === document.body || element === document.documentElement) continue;

          // Walk up to find a reasonable container (product card)
          let current = element;
          let depth = 0;
          while (current && current !== document.body && depth < 8) {
            const rect = current.getBoundingClientRect();

            // Skip if too small or too large
            if (rect.width < 80 || rect.height < 80) {
              current = current.parentElement;
              depth++;
              continue;
            }
            if (rect.width > viewport.width * 0.6) {
              break; // Too wide, likely a container
            }

            // Check if this looks like a product card (has image and some text)
            const hasImg = current.querySelector('img') !== null;
            const hasLink = current.tagName === 'A' || current.querySelector('a') !== null;
            const textLength = (current.textContent || '').trim().length;

            if (hasImg && (hasLink || textLength > 20) && !foundElements.has(current)) {
              foundElements.add(current);
              elementDetails.push({
                element: current,
                outerHTML: current.outerHTML.substring(0, 2000),
                selector: '', // Will fill in below
                boundingBox: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
              });
              break;
            }

            current = current.parentElement;
            depth++;
          }
        }

        console.log('[ExtractRegion] Found', elementDetails.length, 'candidate elements');

        // Generate selectors for found elements
        function getSelector(el) {
          if (el.id && !el.id.match(/^[0-9]/)) {
            return '#' + CSS.escape(el.id);
          }

          const tag = el.tagName.toLowerCase();
          const classes = Array.from(el.classList)
            .filter(c => !c.match(/^[0-9]|hover|active|focus|selected|ng-|js-/i))
            .slice(0, 2);

          if (classes.length > 0) {
            return tag + '.' + classes.map(c => CSS.escape(c)).join('.');
          }

          return tag;
        }

        for (const detail of elementDetails) {
          detail.selector = getSelector(detail.element);
          delete detail.element; // Can't serialize DOM elements
        }

        // Find common container (parent of all found elements)
        let containerHTML = '';
        const containerCandidates = [];

        if (elementDetails.length >= 2) {
          // Get first element to trace up
          const firstEl = document.querySelector(elementDetails[0].selector);
          if (firstEl) {
            let current = firstEl.parentElement;
            let depth = 0;
            while (current && current !== document.body && depth < 5) {
              const childCount = current.children.length;
              if (childCount >= elementDetails.length * 0.8) {
                // This could be the container
                containerHTML = current.outerHTML.substring(0, 8000);
                containerCandidates.push(getSelector(current));
              }
              current = current.parentElement;
              depth++;
            }
          }
        }

        // Build full HTML context (limited size)
        let fullHTML = '';
        if (containerHTML) {
          fullHTML = containerHTML;
        } else {
          fullHTML = elementDetails.map(e => e.outerHTML).join('\\n\\n');
        }

        return {
          fullHTML: fullHTML.substring(0, 10000),
          sampleElements: elementDetails.slice(0, 5),
          containerCandidates: containerCandidates.slice(0, 3),
        };
      })()
    `;

    try {
      const result = await this.page.evaluate(script);
      return result as RegionHTMLResult;
    } catch (error) {
      console.error('[ProductDetector] extractRegionHTML error:', error);
      return {
        fullHTML: '',
        sampleElements: [],
        containerCandidates: [],
      };
    }
  }

  /**
   * Step 4: Validate selector candidates against live page
   */
  private async validateSelectorCandidates(selectors: string[]): Promise<SelectorValidationResult[]> {
    const script = `
      (function() {
        const selectors = ${JSON.stringify(selectors)};
        const results = [];

        for (const selector of selectors) {
          const result = {
            selector,
            valid: false,
            matchCount: 0,
            hasImages: 0,
            hasPrices: 0,
            hasLinks: 0,
            sampleHTML: [],
            avgSize: { width: 0, height: 0 },
            inViewport: 0,
            issues: [],
          };

          try {
            const elements = document.querySelectorAll(selector);
            result.matchCount = elements.length;
            result.valid = true;

            if (elements.length === 0) {
              result.issues.push('No elements matched');
              results.push(result);
              continue;
            }

            let totalWidth = 0;
            let totalHeight = 0;
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const pricePattern = /[£$€¥₹]\\s*\\d+|\\d+[.,]\\d{2}|\\d+\\s*(MAD|USD|EUR|GBP)/i;

            for (let i = 0; i < elements.length; i++) {
              const el = elements[i];
              const rect = el.getBoundingClientRect();

              totalWidth += rect.width;
              totalHeight += rect.height;

              // Check if in viewport
              if (rect.top < viewport.height && rect.bottom > 0 &&
                  rect.left < viewport.width && rect.right > 0) {
                result.inViewport++;
              }

              // Check for images
              if (el.querySelector('img') || el.tagName === 'IMG') {
                result.hasImages++;
              }

              // Check for prices
              const text = el.textContent || '';
              if (pricePattern.test(text) || el.querySelector('[class*="price"]')) {
                result.hasPrices++;
              }

              // Check for links
              if (el.tagName === 'A' || el.querySelector('a[href]')) {
                result.hasLinks++;
              }

              // Sample HTML (first 3 elements)
              if (i < 3) {
                result.sampleHTML.push(el.outerHTML.substring(0, 500));
              }
            }

            result.avgSize = {
              width: Math.round(totalWidth / elements.length),
              height: Math.round(totalHeight / elements.length),
            };

            // Detect issues
            if (elements.length < 3) {
              result.issues.push('Too few elements (' + elements.length + ')');
            }
            if (elements.length > 200) {
              result.issues.push('Too many elements (' + elements.length + ')');
            }
            if (result.hasImages < elements.length * 0.5) {
              result.issues.push('Less than 50% have images');
            }
            if (result.hasPrices < elements.length * 0.3) {
              result.issues.push('Less than 30% have prices');
            }
            if (result.avgSize.width < 80 || result.avgSize.height < 80) {
              result.issues.push('Elements too small (avg ' + result.avgSize.width + 'x' + result.avgSize.height + ')');
            }
            if (result.avgSize.width > viewport.width * 0.8) {
              result.issues.push('Elements too wide (probably containers)');
            }

          } catch (e) {
            result.issues.push('Invalid selector syntax: ' + e.message);
          }

          results.push(result);
        }

        return results;
      })()
    `;

    try {
      const results = await this.page.evaluate(script);
      return results as SelectorValidationResult[];
    } catch (error) {
      console.error('[ProductDetector] validateSelectorCandidates error:', error);
      return selectors.map(s => ({
        selector: s,
        valid: false,
        matchCount: 0,
        hasImages: 0,
        hasPrices: 0,
        hasLinks: 0,
        sampleHTML: [],
        avgSize: { width: 0, height: 0 },
        inViewport: 0,
        issues: ['Validation failed'],
      }));
    }
  }

  // ===========================================================================
  // DIVERSE EXAMPLE FINDER - For field confirmation wizard
  // ===========================================================================

  /**
   * Find diverse product examples for the field confirmation wizard.
   * Returns cards with sale prices (2+ prices) AND cards without sale (1 price).
   * This helps users verify their selectors work for both scenarios.
   */
  async findDiverseExamples(
    containerSelector: string,
    maxPerType: number = 2
  ): Promise<{
    withSale: Array<{
      selector: string;
      screenshot?: string;
      fields: Array<{
        field: 'Title' | 'RRP' | 'Sale Price' | 'URL' | 'Image';
        selector: string;
        value: string;
        bounds: { x: number; y: number; width: number; height: number };
      }>;
    }>;
    withoutSale: Array<{
      selector: string;
      screenshot?: string;
      fields: Array<{
        field: 'Title' | 'RRP' | 'URL' | 'Image';
        selector: string;
        value: string;
        bounds: { x: number; y: number; width: number; height: number };
      }>;
    }>;
  }> {
    console.log(`[ProductDetector] Finding diverse examples for: ${containerSelector}`);

    const script = `
      (function() {
        const containerSelector = ${JSON.stringify(containerSelector)};
        const maxPerType = ${maxPerType};
        const containers = document.querySelectorAll(containerSelector);

        console.log('[DiverseExamples] Found', containers.length, 'containers');

        const withSale = [];
        const withoutSale = [];

        // Price pattern to detect currency values
        // Use global version for .match() to count all prices
        // Use non-global version for .test() to avoid lastIndex issues
        const pricePatternGlobal = /[£$€¥₹]\\s*\\d+([,.]\\d{2,3})?|\\d+([,.]\\d{2,3})?\\s*[£$€¥MAD]/gi;
        const pricePattern = /[£$€¥₹]\\s*\\d+([,.]\\d{2,3})?|\\d+([,.]\\d{2,3})?\\s*[£$€¥MAD]/i;

        // Helper to get a unique selector for an element within its container
        function getRelativeSelector(el, container) {
          if (el === container) return ':self';

          const tag = el.tagName.toLowerCase();

          // Try classes
          const classes = Array.from(el.classList)
            .filter(c => !c.match(/^[0-9]|hover|active|focus|selected/i))
            .slice(0, 2);

          if (classes.length > 0) {
            const classSelector = tag + '.' + classes.map(c => CSS.escape(c)).join('.');
            // Verify it's unique within container
            const matches = container.querySelectorAll(classSelector);
            if (matches.length === 1) return classSelector;
          }

          // Try tag with nth-of-type
          const siblings = container.querySelectorAll(tag);
          if (siblings.length === 1) return tag;

          const index = Array.from(siblings).indexOf(el);
          return tag + ':nth-of-type(' + (index + 1) + ')';
        }

        // Helper to get nth-child selector for container
        function getNthSelector(container, index) {
          // Get the generic part of the container selector
          const tag = container.tagName.toLowerCase();
          const classes = Array.from(container.classList)
            .filter(c => !c.match(/^[0-9]|hover|active|focus|selected/i))
            .slice(0, 2);

          if (classes.length > 0) {
            return tag + '.' + classes.map(c => CSS.escape(c)).join('.') + ':nth-of-type(' + (index + 1) + ')';
          }
          return containerSelector + ':nth-of-type(' + (index + 1) + ')';
        }

        // Analyze each container
        for (let i = 0; i < containers.length; i++) {
          const container = containers[i];
          const text = container.textContent || '';
          const priceMatches = text.match(pricePatternGlobal) || [];
          const priceCount = priceMatches.length;

          // Skip if too few or too many prices (likely not a product)
          if (priceCount === 0 || priceCount > 5) continue;

          // Find elements for each field
          const fields = [];
          const rect = container.getBoundingClientRect();

          // Title: heading or first significant text
          const titleCandidates = container.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="name"]');
          let titleEl = null;
          for (const candidate of titleCandidates) {
            const candidateText = (candidate.textContent || '').trim();
            if (candidateText.length >= 5 && candidateText.length <= 200 && !pricePattern.test(candidateText)) {
              titleEl = candidate;
              break;
            }
          }
          if (titleEl) {
            const titleRect = titleEl.getBoundingClientRect();
            fields.push({
              field: 'Title',
              selector: getRelativeSelector(titleEl, container),
              value: (titleEl.textContent || '').trim().substring(0, 100),
              bounds: { x: titleRect.x, y: titleRect.y, width: titleRect.width, height: titleRect.height },
            });
          }

          // Prices: find elements containing price patterns
          const allElements = container.querySelectorAll('*');
          const priceElements = [];
          for (const el of allElements) {
            // Skip if this element contains other price elements (we want leaf nodes)
            let hasChildPrice = false;
            for (const child of el.querySelectorAll('*')) {
              if (pricePattern.test(child.textContent || '')) {
                hasChildPrice = true;
                break;
              }
            }
            if (hasChildPrice) continue;

            const elText = (el.textContent || '').trim();
            if (pricePattern.test(elText)) {
              const numStr = elText.replace(/[^0-9.,]/g, '').replace(',', '.');
              const num = parseFloat(numStr);
              if (!isNaN(num)) {
                const elRect = el.getBoundingClientRect();
                priceElements.push({
                  el,
                  value: elText,
                  numValue: num,
                  bounds: { x: elRect.x, y: elRect.y, width: elRect.width, height: elRect.height },
                });
              }
            }
          }

          // Sort prices by value (descending) - larger is RRP, smaller is sale
          priceElements.sort((a, b) => b.numValue - a.numValue);

          if (priceElements.length >= 2) {
            // Has sale price - RRP is larger, sale is smaller
            fields.push({
              field: 'RRP',
              selector: getRelativeSelector(priceElements[0].el, container),
              value: priceElements[0].value,
              bounds: priceElements[0].bounds,
            });
            fields.push({
              field: 'Sale Price',
              selector: getRelativeSelector(priceElements[1].el, container),
              value: priceElements[1].value,
              bounds: priceElements[1].bounds,
            });
          } else if (priceElements.length === 1) {
            // Only one price - this is the RRP (no sale)
            fields.push({
              field: 'RRP',
              selector: getRelativeSelector(priceElements[0].el, container),
              value: priceElements[0].value,
              bounds: priceElements[0].bounds,
            });
          }

          // URL: product link
          const links = container.querySelectorAll('a[href]');
          let urlEl = container.tagName === 'A' ? container : null;
          if (!urlEl) {
            for (const link of links) {
              const href = link.getAttribute('href') || '';
              if (href && href !== '#' && !href.startsWith('javascript:')) {
                urlEl = link;
                break;
              }
            }
          }
          if (urlEl) {
            const urlRect = urlEl.getBoundingClientRect();
            fields.push({
              field: 'URL',
              selector: urlEl === container ? ':self' : getRelativeSelector(urlEl, container),
              value: urlEl.getAttribute('href') || '',
              bounds: { x: urlRect.x, y: urlRect.y, width: urlRect.width, height: urlRect.height },
            });
          }

          // Image: first significant image
          const images = container.querySelectorAll('img');
          for (const img of images) {
            const imgRect = img.getBoundingClientRect();
            if (imgRect.width >= 50 && imgRect.height >= 50) {
              fields.push({
                field: 'Image',
                selector: getRelativeSelector(img, container),
                value: img.getAttribute('src') || img.getAttribute('data-src') || '',
                bounds: { x: imgRect.x, y: imgRect.y, width: imgRect.width, height: imgRect.height },
              });
              break;
            }
          }

          // Categorize by sale status
          const example = {
            selector: getNthSelector(container, i),
            containerIndex: i,
            fields,
            bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };

          if (priceElements.length >= 2 && withSale.length < maxPerType) {
            withSale.push(example);
          } else if (priceElements.length === 1 && withoutSale.length < maxPerType) {
            withoutSale.push(example);
          }

          // Stop if we have enough of both
          if (withSale.length >= maxPerType && withoutSale.length >= maxPerType) {
            break;
          }
        }

        console.log('[DiverseExamples] Found', withSale.length, 'with sale,', withoutSale.length, 'without sale');

        return { withSale, withoutSale };
      })()
    `;

    try {
      const result = await this.page.evaluate(script) as {
        withSale: Array<{
          selector: string;
          containerIndex: number;
          fields: Array<{
            field: 'Title' | 'RRP' | 'Sale Price' | 'URL' | 'Image';
            selector: string;
            value: string;
            bounds: { x: number; y: number; width: number; height: number };
          }>;
          bounds: { x: number; y: number; width: number; height: number };
        }>;
        withoutSale: Array<{
          selector: string;
          containerIndex: number;
          fields: Array<{
            field: 'Title' | 'RRP' | 'URL' | 'Image';
            selector: string;
            value: string;
            bounds: { x: number; y: number; width: number; height: number };
          }>;
          bounds: { x: number; y: number; width: number; height: number };
        }>;
      };

      console.log(`[ProductDetector] Found ${result.withSale.length} examples with sale, ${result.withoutSale.length} without sale`);

      return result;
    } catch (error) {
      console.error('[ProductDetector] findDiverseExamples error:', error);
      return { withSale: [], withoutSale: [] };
    }
  }

  /**
   * Capture a screenshot of a specific element with another element highlighted.
   * Used for the field confirmation wizard.
   */
  async captureFieldScreenshot(
    containerSelector: string,
    fieldSelector: string,
    highlightColor: string = '#ff0000'
  ): Promise<{
    screenshot: string;
    fieldValue: string;
    fieldBounds: { x: number; y: number; width: number; height: number };
  } | null> {
    console.log(`[ProductDetector] captureFieldScreenshot: container="${containerSelector}", field="${fieldSelector}"`);
    try {
      // First, scroll the container into view
      const scrollResult = await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el) {
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          return { found: true, tag: el.tagName };
        }
        return { found: false };
      }, containerSelector);
      console.log(`[ProductDetector] Container scroll result:`, scrollResult);

      // Wait for scroll to complete
      await this.page.waitForTimeout(200);

      // Add highlight overlay to the field element
      const highlightId = 'scraper-field-highlight-' + Date.now();
      const evalArgs = {
        containerSel: containerSelector,
        fieldSel: fieldSelector,
        color: highlightColor,
        id: highlightId,
      };
      const fieldInfo = await this.page.evaluate((args: { containerSel: string; fieldSel: string; color: string; id: string }) => {
        const container = document.querySelector(args.containerSel);
        if (!container) return null;

        // Find field element
        let fieldEl: Element | null = null;
        if (args.fieldSel === ':self') {
          fieldEl = container;
        } else {
          fieldEl = container.querySelector(args.fieldSel);
        }

        if (!fieldEl) return null;

        const fieldRect = fieldEl.getBoundingClientRect();

        // Create highlight overlay
        const overlay = document.createElement('div');
        overlay.id = args.id;
        overlay.style.cssText = `
          position: fixed;
          left: ${fieldRect.left - 4}px;
          top: ${fieldRect.top - 4}px;
          width: ${fieldRect.width + 8}px;
          height: ${fieldRect.height + 8}px;
          border: 4px solid ${args.color};
          background: rgba(255, 0, 0, 0.1);
          pointer-events: none;
          z-index: 999999;
          border-radius: 4px;
          box-shadow: 0 0 10px rgba(255, 0, 0, 0.5);
        `;
        document.body.appendChild(overlay);

        // Get field value
        let value = '';
        if (fieldEl.tagName === 'IMG') {
          value = (fieldEl as HTMLImageElement).src || (fieldEl as HTMLImageElement).getAttribute('data-src') || '';
        } else if (fieldEl.tagName === 'A') {
          value = (fieldEl as HTMLAnchorElement).href || '';
        } else {
          value = (fieldEl.textContent || '').trim();
        }

        return {
          value,
          bounds: {
            x: fieldRect.left,
            y: fieldRect.top,
            width: fieldRect.width,
            height: fieldRect.height,
          },
        };
      }, evalArgs) as { value: string; bounds: { x: number; y: number; width: number; height: number } } | null;

      console.log(`[ProductDetector] Field info result:`, fieldInfo ? { value: fieldInfo.value.substring(0, 50), bounds: fieldInfo.bounds } : 'null');

      if (!fieldInfo) {
        console.log(`[ProductDetector] Field not found, returning null`);
        return null;
      }

      // Get container bounds for clipping
      const containerBounds = await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: Math.max(0, rect.left - 20),
          y: Math.max(0, rect.top - 20),
          width: rect.width + 40,
          height: rect.height + 40,
        };
      }, containerSelector);

      if (!containerBounds) {
        // Remove highlight
        await this.page.evaluate((id) => {
          const overlay = document.getElementById(id);
          if (overlay) overlay.remove();
        }, highlightId);
        return null;
      }

      console.log(`[ProductDetector] Container bounds for screenshot:`, containerBounds);

      // Ensure bounds are valid for screenshot
      const viewport = this.page.viewportSize();
      console.log(`[ProductDetector] Viewport size:`, viewport);

      // Clamp bounds to viewport
      const clampedBounds = {
        x: Math.max(0, Math.round(containerBounds.x)),
        y: Math.max(0, Math.round(containerBounds.y)),
        width: Math.max(50, Math.round(containerBounds.width)),
        height: Math.max(50, Math.round(containerBounds.height)),
      };

      // Ensure we don't exceed viewport
      if (viewport) {
        clampedBounds.width = Math.min(clampedBounds.width, viewport.width - clampedBounds.x);
        clampedBounds.height = Math.min(clampedBounds.height, viewport.height - clampedBounds.y);
      }

      console.log(`[ProductDetector] Clamped bounds for screenshot:`, clampedBounds);

      // Capture screenshot of just the container area
      const screenshotBuffer = await this.page.screenshot({
        type: 'png',
        clip: clampedBounds,
      });

      console.log(`[ProductDetector] Screenshot buffer size: ${screenshotBuffer.length} bytes`);

      // Remove highlight overlay
      await this.page.evaluate((id) => {
        const overlay = document.getElementById(id);
        if (overlay) overlay.remove();
      }, highlightId);

      const base64Screenshot = screenshotBuffer.toString('base64');
      console.log(`[ProductDetector] Base64 screenshot length: ${base64Screenshot.length} chars`);

      return {
        screenshot: base64Screenshot,
        fieldValue: fieldInfo.value,
        fieldBounds: fieldInfo.bounds,
      };
    } catch (error) {
      console.error('[ProductDetector] captureFieldScreenshot error:', error);
      return null;
    }
  }
}
