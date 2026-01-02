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
