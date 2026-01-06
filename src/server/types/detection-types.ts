// ============================================================================
// DETECTION TYPES - Types for ML-based product detection
// ============================================================================

/**
 * Configurable weights for multi-factor scoring
 */
export interface ScoringWeights {
  structural: number;  // default: 0.30
  visual: number;      // default: 0.25
  content: number;     // default: 0.30
  context: number;     // default: 0.15
}

/**
 * Individual signal values extracted from an element
 */
export interface SignalBreakdown {
  // Structural signals
  hasSemanticTag: boolean;        // article, section, li, figure
  hasProductDataAttr: boolean;    // data-product, data-sku, data-productid, etc.
  hasSchemaOrg: boolean;          // itemtype="Product" or similar
  nestingDepth: number;           // depth from body
  tagName: string;                // element tag name

  // Visual signals
  aspectRatio: number;            // width/height
  isGridPositioned: boolean;      // CSS grid/flex child
  hasSimilarSiblings: boolean;    // siblings with same structure
  relativeSize: {                 // relative to viewport
    widthRatio: number;
    heightRatio: number;
  };
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  // Content signals
  hasImage: boolean;
  imageCount: number;
  hasPricePattern: boolean;
  priceCount?: number;            // Number of price patterns found (2+ = RRP + sale)
  hasProductLink: boolean;
  hasTitle: boolean;              // h1-h6 or link with text
  textLength: number;
  linkCount: number;

  // Context signals
  parentIsGrid: boolean;          // parent has display: grid or flex
  parentTagName: string;
  siblingCount: number;
  structuralSimilarityToSiblings: number;  // 0-1
}

/**
 * Scoring result for a single element
 */
export interface ElementScore {
  // Element identification (for serialization)
  selector: string;
  tagName: string;

  // Scores
  totalScore: number;             // 0-100 weighted sum
  confidence: number;             // 0-1, threshold for fallback

  // Score breakdown by category
  breakdown: {
    structural: number;           // 0-100
    visual: number;               // 0-100
    content: number;              // 0-100
    context: number;              // 0-100
  };

  // Raw signals for debugging
  signals: SignalBreakdown;

  // Pattern matching info
  patternGroup?: string;          // hash of structural pattern
  patternGroupSize?: number;      // how many elements share this pattern
}

/**
 * Structural pattern fingerprint for an element
 */
export interface StructuralPattern {
  tagPath: string[];              // ['div', 'article', 'div']
  classPatterns: string[];        // Common class name patterns (filtered)
  depth: number;                  // nesting depth from body
  childStructure: string;         // Hash of immediate children structure
  hash: string;                   // Unique hash for this pattern
}

/**
 * Classification result from ContentClassifier
 */
export interface ClassificationResult {
  isProduct: boolean;
  isNonProduct: boolean;
  category: 'product' | 'banner' | 'ad' | 'category' | 'ui' | 'unknown';
  confidence: number;
  matchedPatterns: string[];      // which patterns matched
}

/**
 * Final detection result returned to caller
 */
export interface DetectionResult {
  // Selected element (null if none found)
  selectedElement: {
    selector: string;
    genericSelector: string;      // selector that matches multiple items
    boundingBox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  } | null;

  // Confidence metrics
  confidence: number;             // 0-1
  fallbackRecommended: boolean;   // true if confidence < threshold
  reason?: string;                // explanation if fallback recommended

  // All scored candidates (for debugging/alternative selection)
  allCandidates: ElementScore[];

  // Pattern analysis
  dominantPattern?: {
    hash: string;
    count: number;
    sampleSelector: string;
  };
}

/**
 * Configuration for the ProductDetector
 */
export interface DetectorConfig {
  // Scoring weights
  weights: ScoringWeights;

  // Thresholds
  minConfidence: number;          // Below this, recommend manual (default: 0.6)
  minScore: number;               // Minimum score to consider (default: 50)

  // Limits
  maxCandidates: number;          // Max candidates to evaluate (default: 100)
  maxSiblingsToCheck: number;     // Max siblings for similarity (default: 10)

  // Pattern detection
  minPatternSize: number;         // Min elements for pattern boost (default: 3)
  patternBoost: number;           // Score boost for pattern match (default: 10)
}

/**
 * Default configuration values
 */
export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
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
};

/**
 * Candidate element info passed from browser context
 */
export interface CandidateElement {
  selector: string;
  tagName: string;
  signals: SignalBreakdown;
}

/**
 * WebSocket message payload for auto-detect result
 */
export interface AutoDetectResultPayload {
  success: boolean;
  element: {
    css: string;
    cssGeneric: string;
    boundingBox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  } | null;
  confidence: number;
  fallbackRecommended: boolean;
  reason?: string;
  candidateCount: number;
}
