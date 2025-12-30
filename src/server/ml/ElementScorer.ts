// ============================================================================
// ELEMENT SCORER - Multi-factor scoring engine for product detection
// ============================================================================

import type {
  ScoringWeights,
  SignalBreakdown,
  ElementScore,
} from '../types/detection-types.js';

/**
 * Multi-factor scoring engine that evaluates elements based on
 * structural, visual, content, and context signals.
 */
export class ElementScorer {
  private weights: ScoringWeights;

  constructor(weights?: Partial<ScoringWeights>) {
    this.weights = {
      structural: 0.30,
      visual: 0.25,
      content: 0.30,
      context: 0.15,
      ...weights,
    };
  }

  /**
   * Score an element based on all signal categories
   */
  scoreElement(selector: string, tagName: string, signals: SignalBreakdown): ElementScore {
    // CRITICAL: Price is a REQUIRED signal for products
    // If no price pattern is found, score the element as 0
    if (!signals.hasPricePattern) {
      return {
        selector,
        tagName,
        totalScore: 0,
        confidence: 0,
        breakdown: { structural: 0, visual: 0, content: 0, context: 0 },
        signals,
      };
    }

    const structural = this.scoreStructural(signals);
    const visual = this.scoreVisual(signals);
    const content = this.scoreContent(signals);
    const context = this.scoreContext(signals);

    const totalScore =
      structural * this.weights.structural +
      visual * this.weights.visual +
      content * this.weights.content +
      context * this.weights.context;

    // Confidence based on score and signal agreement
    const confidence = this.calculateConfidence(totalScore, { structural, visual, content, context });

    return {
      selector,
      tagName,
      totalScore,
      confidence,
      breakdown: { structural, visual, content, context },
      signals,
    };
  }

  /**
   * Score structural signals (semantic tags, data attributes, schema.org)
   */
  private scoreStructural(signals: SignalBreakdown): number {
    let score = 0;

    // Semantic tags are highly predictive (+30)
    if (signals.hasSemanticTag) {
      score += 30;
    }

    // Product data attributes are strong signals (+25)
    if (signals.hasProductDataAttr) {
      score += 25;
    }

    // Schema.org markup indicates structured product data (+20)
    if (signals.hasSchemaOrg) {
      score += 20;
    }

    // Reasonable nesting depth (3-8 levels from body is typical for products)
    if (signals.nestingDepth >= 3 && signals.nestingDepth <= 8) {
      score += 15;
    } else if (signals.nestingDepth < 3) {
      // Too shallow - likely a container, not a product
      score -= 20;
    } else if (signals.nestingDepth > 12) {
      // Too deep - might be over-nested
      score -= 10;
    }

    // Specific tag bonuses
    const goodTags = ['article', 'li', 'figure', 'section'];
    if (goodTags.includes(signals.tagName.toLowerCase())) {
      score += 10;
    }

    // Anchor tags are often the actual clickable product cards - VERY strong bonus
    // Most e-commerce sites wrap products in <a> tags for the link
    if (signals.tagName.toLowerCase() === 'a') {
      score += 45;
    }

    // Penalize generic div containers that likely wrap the actual product
    // Divs without special attributes are usually just wrappers
    // Apply very strong penalty to push them below <a> elements
    if (signals.tagName.toLowerCase() === 'div' && !signals.hasProductDataAttr && !signals.hasSemanticTag) {
      score -= 40;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Score visual signals (aspect ratio, size, positioning)
   */
  private scoreVisual(signals: SignalBreakdown): number {
    let score = 0;
    const { relativeSize, aspectRatio, isGridPositioned, hasSimilarSiblings } = signals;

    // Product cards typically have 0.5-2.0 aspect ratio (portrait to slightly landscape)
    if (aspectRatio >= 0.5 && aspectRatio <= 2.0) {
      score += 25;
    } else if (aspectRatio > 3.0) {
      // Very wide - likely a banner
      score -= 15;
    } else if (aspectRatio < 0.3) {
      // Very tall and narrow - unusual for products
      score -= 10;
    }

    // Size relative to viewport
    // Products typically take 10-40% of viewport width
    if (relativeSize.widthRatio >= 0.10 && relativeSize.widthRatio <= 0.40) {
      score += 20;
    } else if (relativeSize.widthRatio > 0.70) {
      // Too large - probably a container or banner
      score -= 30;
    } else if (relativeSize.widthRatio < 0.05) {
      // Too small - probably not a main product card
      score -= 10;
    }

    // Grid/flex positioning is a strong signal for product grids
    if (isGridPositioned) {
      score += 20;
    }

    // Similar siblings indicate a repeating pattern (product grid)
    if (hasSimilarSiblings) {
      score += 25;
    }

    // Reasonable height
    if (relativeSize.heightRatio >= 0.15 && relativeSize.heightRatio <= 0.60) {
      score += 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Score content signals (image, price, link, title)
   */
  private scoreContent(signals: SignalBreakdown): number {
    let score = 0;

    // Image is almost always present in product cards (+20)
    if (signals.hasImage) {
      score += 20;
    }

    // Price pattern is highly predictive of products (+30)
    if (signals.hasPricePattern) {
      score += 30;
    }

    // Product link indicates clickable product (+15)
    if (signals.hasProductLink) {
      score += 15;
    }

    // Title (heading or link with text) (+15)
    if (signals.hasTitle) {
      score += 15;
    }

    // Text length - products typically have 20-500 characters
    if (signals.textLength >= 20 && signals.textLength <= 500) {
      score += 10;
    } else if (signals.textLength > 1000) {
      // Too much text - might be a container with multiple products
      score -= 15;
    } else if (signals.textLength < 10) {
      // Too little text - might not be a product
      score -= 10;
    }

    // Image count - products usually have 1-3 images
    if (signals.imageCount >= 1 && signals.imageCount <= 3) {
      score += 5;
    } else if (signals.imageCount > 5) {
      // Too many images - probably a container
      score -= 10;
    }

    // Link count - products usually have 1-5 links
    if (signals.linkCount >= 1 && signals.linkCount <= 5) {
      score += 5;
    } else if (signals.linkCount > 10) {
      // Too many links - probably a container
      score -= 15;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Score context signals (parent layout, siblings)
   */
  private scoreContext(signals: SignalBreakdown): number {
    let score = 50; // Start neutral

    // Parent is a grid container - strong signal
    if (signals.parentIsGrid) {
      score += 20;
    }

    // Has siblings with similar structure - indicates repeating pattern
    if (signals.structuralSimilarityToSiblings > 0.7) {
      score += 20;
    } else if (signals.structuralSimilarityToSiblings > 0.5) {
      score += 10;
    }

    // Sibling count - product grids typically have 4-100 items
    if (signals.siblingCount >= 2 && signals.siblingCount <= 100) {
      score += 10;
    } else if (signals.siblingCount === 0) {
      // No siblings - might be a unique element, not a product in a grid
      score -= 20;
    } else if (signals.siblingCount > 200) {
      // Too many siblings - might be list items or something else
      score -= 5;
    }

    // Parent tag hints
    const goodParentTags = ['ul', 'ol', 'section', 'main', 'div'];
    if (goodParentTags.includes(signals.parentTagName.toLowerCase())) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate confidence based on total score and signal agreement
   */
  private calculateConfidence(
    totalScore: number,
    breakdown: { structural: number; visual: number; content: number; context: number }
  ): number {
    // Base confidence from total score
    let confidence = totalScore / 100;

    // Calculate variance in scores - high variance means signals disagree
    const scores = Object.values(breakdown);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - average, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // Reduce confidence if signals disagree (high standard deviation)
    if (stdDev > 30) {
      confidence *= 0.7;
    } else if (stdDev > 20) {
      confidence *= 0.85;
    } else if (stdDev < 10) {
      // Signals strongly agree - boost confidence slightly
      confidence *= 1.1;
    }

    // Additional boost if multiple strong signals present
    const strongSignals = scores.filter(s => s >= 60).length;
    if (strongSignals >= 3) {
      confidence *= 1.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Apply pattern boost to scores when elements share structural patterns
   */
  applyPatternBoost(scores: ElementScore[], patternGroups: Map<string, string[]>, boost: number): void {
    for (const score of scores) {
      for (const [hash, selectors] of patternGroups) {
        if (selectors.includes(score.selector) && selectors.length >= 3) {
          score.totalScore += boost;
          score.confidence = Math.min(1, score.confidence + 0.1);
          score.patternGroup = hash;
          score.patternGroupSize = selectors.length;
        }
      }
    }
  }
}
