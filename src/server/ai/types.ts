// ============================================================================
// GEMINI AI TYPES
// ============================================================================
// TypeScript interfaces for AI detection responses

/**
 * Popup detection result from Gemini
 */
export interface GeminiPopupResult {
  popups_found: boolean;
  popups: Array<{
    type: 'cookie' | 'newsletter' | 'age_verification' | 'language' | 'promo' | 'other';
    close_action: 'click_accept' | 'click_close' | 'click_outside' | 'press_escape';
    button_text: string;
    approximate_location: { x: number; y: number }; // percentage from top-left
    confidence: number;
  }>;
}

/**
 * Pagination detection result from Gemini
 */
export interface GeminiPaginationResult {
  method: 'numbered_pages' | 'next_button' | 'load_more' | 'infinite_scroll' | 'none';
  selector?: string; // Legacy field, may still be returned
  url_pattern?: string; // e.g., "?page={n}" or "/page/{n}"
  offset_config?: {
    key: string;
    start: number;
    increment: number;
  };
  // New attribute-based identification (preferred over selector)
  button_attributes?: {
    text?: string; // Exact button text like "Next", "Load More", "2"
    aria_label?: string; // aria-label attribute value
    classes?: string[]; // Relevant class names (not dynamic ones)
    data_attributes?: Record<string, string>; // data-* attributes
    tag?: 'a' | 'button' | 'div' | 'span'; // HTML tag
    rel?: string; // rel attribute (e.g., "next")
  };
  confidence: number;
  reasoning?: string;
}

/**
 * Product detection result from Gemini
 */
export interface GeminiProductResult {
  products_found: boolean;
  container_selector?: string;
  item_selector?: string;
  item_count?: number;
  sample_selectors?: string[];
  visual_description?: string;
  confidence: number;
}

/**
 * Field labeling result from Gemini
 */
export interface GeminiFieldLabelResult {
  labels: Array<{
    index: number;
    field: 'title' | 'price' | 'original_price' | 'sale_price' | 'url' | 'image' | 'skip';
    confidence: number;
    reason?: string;
  }>;
}

/**
 * Generic AI detection result wrapper
 */
export interface AIDetectionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  source: 'ai' | 'fallback';
  latencyMs: number;
}

/**
 * Extracted item for field labeling
 */
export interface ExtractedItem {
  index: number;
  type: 'text' | 'link' | 'image';
  content: string; // text content, href, or src
  selector?: string;
}

// ============================================================================
// MULTI-STEP AI DETECTION TYPES
// ============================================================================

/**
 * Step 1: Grid region detection result
 */
export interface GridRegionResult {
  grid_found: boolean;
  region: {
    top_percent: number;    // 0-100 percentage from top
    left_percent: number;   // 0-100 percentage from left
    width_percent: number;  // 0-100 region width
    height_percent: number; // 0-100 region height
  };
  estimated_columns: number;
  estimated_rows: number;
  visual_description: string;
  confidence: number;
}

/**
 * Step 3: Selector candidate from AI
 */
export interface SelectorCandidate {
  selector: string;
  reasoning: string;
  specificity: 'high' | 'medium' | 'low';
  expected_count: number;
  priority: number;
}

/**
 * Step 3: Multiple selector candidates result
 */
export interface SelectorCandidatesResult {
  candidates: SelectorCandidate[];
  container_selector?: string;
  confidence: number;
}

/**
 * Step 4: Validation result for a single selector
 */
export interface SelectorValidationResult {
  selector: string;
  valid: boolean;
  matchCount: number;
  hasImages: number;
  hasPrices: number;
  hasLinks: number;
  sampleHTML: string[];
  avgSize: { width: number; height: number };
  inViewport: number;
  issues: string[];
}

/**
 * Step 5: AI refinement result
 */
export interface RefinedSelectorResult {
  action: 'accept' | 'refine' | 'reject_all';
  selected_selector?: string;
  refined_selector?: string;
  reasoning: string;
  confidence: number;
}

/**
 * Step 6: Product verification result
 */
export interface ProductVerificationResult {
  verified: boolean;
  product_count: number;
  non_product_count: number;
  issues: string[];
  confidence: number;
}

/**
 * Configuration for multi-step detection pipeline
 */
export interface MultiStepDetectionConfig {
  maxRefinementIterations: number;      // default: 3
  minAcceptableMatchCount: number;      // default: 3
  maxAcceptableMatchCount: number;      // default: 200
  minPriceRatio: number;                // default: 0.6
  skipVisualStep: boolean;              // default: false
  enableVerification: boolean;          // default: true
}

/**
 * Default configuration for multi-step detection
 */
export const DEFAULT_MULTI_STEP_CONFIG: MultiStepDetectionConfig = {
  maxRefinementIterations: 3,
  minAcceptableMatchCount: 3,
  maxAcceptableMatchCount: 200,
  minPriceRatio: 0.6,
  skipVisualStep: false,
  enableVerification: true,
};

/**
 * Region HTML extraction result
 */
export interface RegionHTMLResult {
  fullHTML: string;
  sampleElements: Array<{
    outerHTML: string;
    selector: string;
    boundingBox: { x: number; y: number; width: number; height: number };
  }>;
  containerCandidates: string[];
}

/**
 * Extended detection result with multi-step metadata
 */
export interface MultiStepDetectionResult {
  selector: string;
  genericSelector: string;
  confidence: number;
  source: 'multi-step-ai' | 'single-ai' | 'ml';
  iterations: number;
  pipeline: {
    gridDetected: boolean;
    candidatesGenerated: number;
    refinementIterations: number;
    verified: boolean;
  };
}

// ============================================================================
// PAGINATION VERIFICATION TYPES
// ============================================================================

/**
 * Method types for pagination
 */
export type PaginationMethodType = 'infinite_scroll' | 'next_button' | 'load_more' | 'url_pattern';

/**
 * Result from AI visual verification of pagination
 */
export interface PaginationVerificationResult {
  verified: boolean;
  confidence: number;
  productCountDelta: number;
  reasoning: string;
  visualChanges: {
    newProductsVisible: boolean;
    scrollPositionChanged: boolean;
    pageIndicatorChanged: boolean;
    urlChanged?: boolean;
  };
  recommendations?: string[];
}

/**
 * Result from testing a single pagination method
 */
export interface PaginationTestResult {
  method: PaginationMethodType;
  selector?: string;
  beforeScreenshot: string;
  afterScreenshot: string;
  beforeProductCount: number;
  afterProductCount: number;
  beforeUrl: string;
  afterUrl: string;
  verified: boolean;
  confidence: number;
  aiVerification?: PaginationVerificationResult;
  error?: string;
  testDurationMs: number;
}

/**
 * All tested pagination methods with ranking
 */
export interface PaginationTestAllResult {
  testedMethods: PaginationTestResult[];
  bestMethod: PaginationTestResult | null;
  totalTestDurationMs: number;
}

/**
 * AI-detected pagination candidate
 */
export type PaginationCandidateType = 'infinite_scroll' | 'next_button' | 'load_more' | 'page_number' | 'none';

export interface PaginationCandidateResult {
  found: boolean;
  selector: string | null;
  type: PaginationCandidateType;
  reasoning: string;
  hasInfiniteScroll: boolean;
}

// ============================================================================
// USER-GUIDED PAGINATION DEMO TYPES
// ============================================================================

/**
 * User-demonstrated pagination method
 * Captured from user scrolling or clicking during demo mode
 */
export interface UserDemonstratedPagination {
  method: 'scroll' | 'click';
  // For scroll method
  scrollDistance?: number;  // Total deltaY accumulated
  // For click method
  clickSelector?: string;   // CSS selector of clicked element
  clickText?: string;       // Text content of clicked element (for display)
  clickCoordinates?: { x: number; y: number };  // Backup if selector fails
  // Verification
  beforeProductCount: number;
  afterProductCount: number;
  productDelta: number;
  verified: boolean;
}

/**
 * Pagination demonstration session state (server-side)
 */
export interface PaginationDemoSession {
  active: boolean;
  startTime: number;
  startProductCount: number;
  startUrl: string;
  accumulatedScrollY: number;
  lastClickedElement?: {
    selector: string;
    coordinates: { x: number; y: number };
  };
  itemSelector: string;
}

/**
 * Demo event for callback notifications
 */
export interface PaginationDemoEvent {
  type: 'progress' | 'autoComplete' | 'wrongNavigation' | 'error';
  data: any;
}

// ============================================================================
// HTML-BASED FIELD SELECTOR DETECTION TYPES
// ============================================================================

/**
 * Individual field selector result from Gemini HTML analysis
 */
export interface FieldSelectorResult {
  selector: string;       // CSS selector RELATIVE to product container
  confidence: number;     // 0-1 confidence score
  sampleValue?: string;   // Example value found (for verification)
}

/**
 * Result from Gemini HTML-based field selector detection
 * Used by the builder to get accurate selectors from page HTML
 */
export interface GeminiFieldSelectorsResult {
  success: boolean;
  containerSelector: string;  // The selector used for product containers
  fields: {
    title: FieldSelectorResult | null;
    rrp: FieldSelectorResult | null;
    salePrice: FieldSelectorResult | null;
    url: FieldSelectorResult | null;
    image: FieldSelectorResult | null;
  };
  hasSalePrice: boolean;      // True if products have sale pricing
  confidence: number;         // Overall confidence
  reasoning?: string;         // AI's explanation
}
