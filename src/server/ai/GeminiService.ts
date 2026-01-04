// ============================================================================
// GEMINI AI SERVICE
// ============================================================================
// Central service for Google Gemini API integration with rate limiting,
// retry logic, and structured response parsing.

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type {
  GeminiPopupResult,
  GeminiPaginationResult,
  GeminiProductResult,
  GeminiFieldLabelResult,
  ExtractedItem,
  AIDetectionResult,
  // Multi-step detection types
  GridRegionResult,
  SelectorCandidatesResult,
  SelectorValidationResult,
  RefinedSelectorResult,
  ProductVerificationResult,
  // Pagination verification types
  PaginationVerificationResult,
  PaginationCandidateResult,
} from './types.js';

// Rate limiter - simple token bucket
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number = 10, refillRatePerMinute: number = 10) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerMinute / 60;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      const waitTime = (1 - this.tokens) / this.refillRate * 1000;
      console.log(`[GeminiService] Rate limited, waiting ${Math.round(waitTime)}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.refill();
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  getRemaining(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

/**
 * Main Gemini AI Service
 */
export class GeminiService {
  private client: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private rateLimiter: RateLimiter;
  public readonly isEnabled: boolean;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || '';

    if (!apiKey) {
      console.warn('[GeminiService] GEMINI_API_KEY not set - AI features disabled');
      this.isEnabled = false;
    } else {
      try {
        this.client = new GoogleGenerativeAI(apiKey);
        this.model = this.client.getGenerativeModel({
          model: 'gemini-2.0-flash',
          generationConfig: {
            responseMimeType: 'application/json',
          },
        });
        this.isEnabled = true;
        console.log('[GeminiService] Initialized with Gemini 2.0 Flash (JSON mode)');
      } catch (error) {
        console.error('[GeminiService] Failed to initialize:', error);
        this.isEnabled = false;
      }
    }

    // Increased rate limit for multi-step detection pipeline (4-6 calls per detection)
    this.rateLimiter = new RateLimiter(20, 20); // 20 requests per minute
  }

  /**
   * Get remaining rate limit tokens
   */
  getRateLimitRemaining(): number {
    return this.rateLimiter.getRemaining();
  }

  /**
   * Parse JSON from AI response, handling markdown code blocks and embedded JSON
   */
  private parseJsonResponse<T>(text: string): T | null {
    try {
      // Remove markdown code blocks if present
      let cleaned = text.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      // Try direct parse first
      try {
        return JSON.parse(cleaned) as T;
      } catch {
        // If direct parse fails, try to extract JSON from the text
        // Look for JSON object pattern { ... }
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]) as T;
        }
        throw new Error('No valid JSON found in response');
      }
    } catch (error) {
      console.error('[GeminiService] Failed to parse JSON response:', error);
      console.error('[GeminiService] Raw response:', text.substring(0, 500));
      return null;
    }
  }

  /**
   * Call Gemini with retry logic
   */
  private async callWithRetry<T>(
    prompt: string,
    imageBase64?: string,
    maxRetries: number = 2
  ): Promise<AIDetectionResult<T>> {
    if (!this.isEnabled || !this.model) {
      return {
        success: false,
        error: 'AI service not enabled',
        source: 'fallback',
        latencyMs: 0,
      };
    }

    const startTime = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.rateLimiter.acquire();

        let result;
        if (imageBase64) {
          // Vision request with image
          result = await this.model.generateContent([
            prompt,
            {
              inlineData: {
                mimeType: 'image/png',
                data: imageBase64,
              },
            },
          ]);
        } else {
          // Text-only request
          result = await this.model.generateContent(prompt);
        }

        const responseText = result.response.text();
        const parsed = this.parseJsonResponse<T>(responseText);

        if (parsed) {
          return {
            success: true,
            data: parsed,
            source: 'ai',
            latencyMs: Date.now() - startTime,
          };
        } else {
          throw new Error('Failed to parse response');
        }
      } catch (error: any) {
        const isRateLimit = error?.message?.includes('429') || error?.message?.includes('rate');
        const isRetryable = isRateLimit || error?.message?.includes('timeout');

        console.error(`[GeminiService] Attempt ${attempt + 1} failed:`, error?.message || error);

        if (attempt < maxRetries && isRetryable) {
          const backoff = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`[GeminiService] Retrying in ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
        } else {
          return {
            success: false,
            error: error?.message || 'Unknown error',
            source: 'fallback',
            latencyMs: Date.now() - startTime,
          };
        }
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
      source: 'fallback',
      latencyMs: Date.now() - startTime,
    };
  }

  // ===========================================================================
  // POPUP DETECTION
  // ===========================================================================

  async detectPopups(screenshotBase64: string): Promise<AIDetectionResult<GeminiPopupResult>> {
    const prompt = `Analyze this webpage screenshot for popups, modals, or overlays that should be closed.

Look for:
1. Cookie consent banners (GDPR, cookie policy)
2. Newsletter signup modals
3. Age verification dialogs
4. Language/country selection modals
5. Promotional popups or discount offers
6. Any overlay blocking the main content

For each popup found, provide:
- type: "cookie" | "newsletter" | "age_verification" | "language" | "promo" | "other"
- close_action: "click_accept" | "click_close" | "click_outside" | "press_escape"
- button_text: The exact text of the button to click (e.g., "Accept All", "Close", "X", "Decline")
- approximate_location: { x: percentage from left (0-100), y: percentage from top (0-100) }
- confidence: 0-1 confidence score

Return ONLY valid JSON in this exact format:
{
  "popups_found": true,
  "popups": [
    {
      "type": "cookie",
      "close_action": "click_accept",
      "button_text": "Accept All Cookies",
      "approximate_location": { "x": 50, "y": 85 },
      "confidence": 0.95
    }
  ]
}

If no popups are found, return:
{ "popups_found": false, "popups": [] }`;

    return this.callWithRetry<GeminiPopupResult>(prompt, screenshotBase64);
  }

  // ===========================================================================
  // PAGINATION DETECTION
  // ===========================================================================

  async detectPagination(
    screenshotBase64: string,
    currentUrl: string,
    htmlSnippet?: string
  ): Promise<AIDetectionResult<GeminiPaginationResult>> {
    const prompt = `You are a JSON API. Analyze this e-commerce product listing page to detect the pagination method.

Current URL: ${currentUrl}

${htmlSnippet ? `HTML near the bottom of the page:\n${htmlSnippet.substring(0, 2000)}` : ''}

Look for these pagination methods (in order of preference):
1. Numbered page buttons (1, 2, 3... or "Page 1 of 10") → method: "numbered_pages"
2. Next/Previous buttons (arrows →, >, or text "Next", "Weiter", "Suivant") → method: "next_button"
3. "Load More" or "Show More" buttons → method: "load_more"
4. If page shows many products with no visible pagination controls, it likely uses infinite scroll → method: "infinite_scroll"
5. URL patterns like ?page=1, ?offset=0, /page/1, ?p=2, ?o=24

IMPORTANT: Do NOT return a CSS selector. Return the IDENTIFYING ATTRIBUTES of the button to click.

For button-based pagination, provide these attributes:
- text: The EXACT visible text on the button (e.g., "Next", "Load More", "2", "→", ">")
- aria_label: The aria-label attribute if present
- classes: ONLY stable, semantic class names (e.g., ["next", "pagination-btn"]) - NOT dynamic classes like "css-abc123"
- data_attributes: Any data-* attributes (e.g., {"page": "2", "testid": "next-btn"})
- tag: The HTML tag ("a" or "button" or "span" or "div")
- rel: The rel attribute if present (e.g., "next")

CRITICAL: You MUST respond with ONLY valid JSON. No explanations, no text before or after. Just the JSON object.

JSON format examples:

For button-based pagination:
{
  "method": "next_button",
  "button_attributes": {
    "text": ">",
    "aria_label": null,
    "classes": ["pagination-next"],
    "data_attributes": {},
    "tag": "button",
    "rel": null
  },
  "url_pattern": "?page={n}",
  "offset_config": null,
  "confidence": 0.9,
  "reasoning": "Found next button with arrow"
}

For infinite scroll (no visible pagination buttons, products load on scroll):
{
  "method": "infinite_scroll",
  "button_attributes": null,
  "url_pattern": null,
  "offset_config": null,
  "confidence": 0.7,
  "reasoning": "No pagination buttons visible, likely uses infinite scroll"
}

If truly no pagination:
{
  "method": "none",
  "button_attributes": null,
  "url_pattern": null,
  "offset_config": null,
  "confidence": 0.8,
  "reasoning": "Single page of products, no pagination needed"
}`;

    return this.callWithRetry<GeminiPaginationResult>(prompt, screenshotBase64);
  }

  // ===========================================================================
  // PRODUCT DETECTION
  // ===========================================================================

  async detectProducts(
    screenshotBase64: string,
    domStructure?: string
  ): Promise<AIDetectionResult<GeminiProductResult>> {
    const prompt = `Analyze this e-commerce page screenshot to identify the repeating product cards/tiles.

${domStructure ? `Simplified DOM structure:\n${domStructure.substring(0, 3000)}` : ''}

Look for:
1. Repeating visual elements in a grid or list layout
2. Each element should contain: product image, title/name, price
3. Clickable product cards that link to product detail pages
4. Multiple similar items (typically 10-50 products per page)

IGNORE:
- Promotional banners or hero images
- Featured/highlighted single products
- Navigation menus and headers
- Footer content
- Sidebar filters

For the product cards found, provide VALID CSS selectors.

IMPORTANT: Only use real CSS selector syntax:
- Tag names: article, div, a, li
- Classes: .product-card, .item
- Attributes: [data-product-id], [itemtype*="Product"]
- Combinations: article.product, div.product-card, a[href*="/product/"]

DO NOT use markers like [has-img] or [has-price] - these are NOT valid CSS.

Return ONLY valid JSON in this exact format:
{
  "products_found": true,
  "container_selector": "CSS selector for the grid/list containing all products",
  "item_selector": "Valid CSS selector that matches ALL product cards (e.g., article.product, div.product-card, a.product-item)",
  "item_count": 24,
  "visual_description": "Brief description of what the product cards look like",
  "confidence": 0.0-1.0
}

If no products are found, return:
{ "products_found": false, "confidence": 0 }`;

    return this.callWithRetry<GeminiProductResult>(prompt, screenshotBase64);
  }

  // ===========================================================================
  // FIELD LABELING
  // ===========================================================================

  async labelFields(
    extractedItems: ExtractedItem[],
    screenshotBase64: string
  ): Promise<AIDetectionResult<GeminiFieldLabelResult>> {
    const itemsJson = JSON.stringify(extractedItems, null, 2);

    const prompt = `You are labeling extracted content from a SINGLE product card on an e-commerce website.

EXTRACTED CONTENT (each item has an index):
${itemsJson}

YOUR TASK: Label each item with ONE of these field types:

═══════════════════════════════════════════════════════════════════════════════
FIELD DEFINITIONS (only ONE of each allowed, except "skip"):
═══════════════════════════════════════════════════════════════════════════════

"title" - The PRODUCT NAME that describes what the item is
  ✓ Examples: "Air-Yarn Crew Neck Short Cardigan", "Nike Air Max 90", "iPhone 15 Pro"
  ✗ NOT: brand names alone ("M&S", "Nike"), categories ("Knitwear", "Shoes"), rankings ("#8 bestseller")
  RULE: Usually the LONGEST descriptive text. Pick exactly ONE.

"price" - The CURRENT selling price (what customer pays TODAY)
  ✓ Examples: "£23", "$99.99", "€45.00", "¥2999"
  RULE: If multiple prices exist, the LOWEST numeric value is the "price"
  RULE: Pick exactly ONE price.

"original_price" - The price BEFORE discount (crossed out / "was" price)
  ✓ Only use if there's ALSO a lower "price"
  RULE: The HIGHER price when two prices are shown

"url" - Link to the PRODUCT DETAIL PAGE
  ✓ URLs containing: /product/, /p/, /item/, /dp/, /pdp/, product ID numbers
  RULE: Pick exactly ONE link (the main product link, not color variants)
  RULE: If multiple identical links, pick the FIRST one

"image" - The MAIN PRODUCT IMAGE
  ✓ The primary/largest product photo
  ✗ NOT: color swatches, thumbnails, brand logos, icons
  RULE: Pick exactly ONE image (the main product photo)

"skip" - EVERYTHING ELSE (most items will be this!)
  ✓ Brand names: "M&S", "Nike", "Apple"
  ✓ Categories: "Knitwear", "Shoes", "Electronics"
  ✓ Ratings: "5.0", "4.5 stars", "★★★★☆"
  ✓ Review counts: "1 review", "(245 reviews)", "1.2k ratings"
  ✓ Rankings: "#8 bestseller", "Top rated", "Best seller"
  ✓ Short filler words: "in", "new", "sale", "from"
  ✓ Color swatch images (small colored squares/circles)
  ✓ Color variant links (same product, different colors)
  ✓ Action buttons: "Add to cart", "Quick view", "♡"
  ✓ Promotional text: "Free shipping", "20% off", "Limited time"
  ✓ Duplicate links/images after the first one

═══════════════════════════════════════════════════════════════════════════════
DECISION PROCESS:
═══════════════════════════════════════════════════════════════════════════════

1. Find the PRICE first (look for currency symbols: £, $, €, ¥, ₹)
2. Find the TITLE (longest text that describes the actual product)
3. Find the main IMAGE (first/largest product photo, skip tiny swatches)
4. Find the product URL (first link to product page)
5. Mark EVERYTHING ELSE as "skip"

═══════════════════════════════════════════════════════════════════════════════
EXPECTED OUTPUT PATTERN FOR A TYPICAL PRODUCT CARD:
═══════════════════════════════════════════════════════════════════════════════
- 1 title
- 1 price (or 1 price + 1 original_price if on sale)
- 1 url
- 1 image
- ALL other items = "skip" (usually 60-80% of items should be skip!)

Return ONLY valid JSON:
{
  "labels": [
    { "index": 0, "field": "skip", "confidence": 0.95, "reason": "ranking badge" },
    { "index": 1, "field": "skip", "confidence": 0.9, "reason": "filler word" },
    { "index": 2, "field": "skip", "confidence": 0.95, "reason": "category name" },
    { "index": 3, "field": "price", "confidence": 0.98 },
    { "index": 4, "field": "skip", "confidence": 0.95, "reason": "brand name" },
    { "index": 5, "field": "title", "confidence": 0.95 },
    { "index": 6, "field": "skip", "confidence": 0.9, "reason": "rating" },
    { "index": 7, "field": "skip", "confidence": 0.9, "reason": "review count" },
    { "index": 8, "field": "url", "confidence": 0.95 },
    { "index": 9, "field": "skip", "confidence": 0.85, "reason": "duplicate link" },
    { "index": 10, "field": "image", "confidence": 0.95 },
    { "index": 11, "field": "skip", "confidence": 0.9, "reason": "color swatch" }
  ]
}

IMPORTANT: Label ALL items by their index. Most items should be "skip"!`;

    return this.callWithRetry<GeminiFieldLabelResult>(prompt, screenshotBase64);
  }

  // ===========================================================================
  // MULTI-STEP PRODUCT DETECTION PIPELINE
  // ===========================================================================

  /**
   * Step 1: Visual Grid Detection
   * Analyzes screenshot to find the product grid region and estimate dimensions
   */
  async detectProductGridRegion(
    screenshotBase64: string
  ): Promise<AIDetectionResult<GridRegionResult>> {
    const prompt = `You are an expert at analyzing e-commerce websites. Analyze this screenshot to find the main product grid/listing area.

TASK: Identify the rectangular region containing the product cards/tiles.

Look for:
1. A grid or list of REPEATING elements (not unique hero images)
2. Each element should look like a product: image + text (title/price)
3. Multiple similar-looking items arranged in columns/rows
4. Usually occupies the main content area (center of page)

IGNORE:
- Header/navigation bars at the top
- Footer at the bottom
- Sidebar filters (usually on left)
- Single hero/featured product banners
- Promotional carousels
- Category navigation tiles

ESTIMATE:
- How many columns of products are visible
- How many rows of products are visible

Return ONLY valid JSON in this exact format:
{
  "grid_found": true,
  "region": {
    "top_percent": 15,
    "left_percent": 5,
    "width_percent": 75,
    "height_percent": 70
  },
  "estimated_columns": 4,
  "estimated_rows": 3,
  "visual_description": "Grid of 12 product cards with white backgrounds, each showing a product image, title below, and price in bold",
  "confidence": 0.9
}

Notes:
- Percentages are from the top-left corner of the viewport (0-100 scale)
- top_percent: distance from top edge
- left_percent: distance from left edge
- width_percent: width of the region
- height_percent: height of the region

If no product grid is found:
{
  "grid_found": false,
  "region": { "top_percent": 0, "left_percent": 0, "width_percent": 100, "height_percent": 100 },
  "estimated_columns": 0,
  "estimated_rows": 0,
  "visual_description": "No clear product grid found - page may be a landing page or category overview",
  "confidence": 0.3
}`;

    return this.callWithRetry<GridRegionResult>(prompt, screenshotBase64);
  }

  /**
   * Step 3: Generate CSS Selector Candidates
   * Given sample HTML from the product region, generate multiple selector options
   */
  async generateSelectorCandidates(
    sampleElementsHTML: string[],
    containerHTML: string,
    containerCandidates: string[]
  ): Promise<AIDetectionResult<SelectorCandidatesResult>> {
    const prompt = `You are a CSS selector expert. Generate CSS selectors to match product cards in this HTML.

SAMPLE PRODUCT ELEMENTS (3-5 items from the grid):
${sampleElementsHTML.map((html, i) => `--- Sample ${i + 1} ---\n${html}\n`).join('\n')}

CONTAINER HTML (the parent element holding products):
${containerHTML.substring(0, 3000)}

CONTAINER SELECTOR CANDIDATES (found by walking up from products):
${containerCandidates.join(', ')}

YOUR TASK: Generate 3-5 CSS selector candidates to match ALL product cards.

RULES - READ CAREFULLY:
1. ONLY use valid CSS selector syntax that works with document.querySelectorAll()
2. Valid syntax examples:
   - Tag: article, div, li, a
   - Class: .product-card, .item
   - Attribute: [data-product-id], [itemtype*="Product"], [data-testid="product"]
   - Combinations: article.product, ul.products > li, div[data-product]
   - Child combinator: .products > .product-item
   - Descendant: .product-grid article

3. NEVER use these (they are INVALID or poorly supported):
   - :has() pseudo-class (browser support issues)
   - Custom markers like [has-img], [has-price], [contains-price]
   - JavaScript-style selectors
   - XPath

4. PREFER selectors that are:
   - Semantic (article.product > div.item-container)
   - Use data-* attributes when available
   - Use itemtype/itemscope for schema.org markup
   - Specific enough to avoid matching non-products

5. Order by SPECIFICITY:
   - First candidate: Most specific (fewer false positives, might miss some)
   - Last candidate: Most general (catches all, might have false positives)

Return ONLY valid JSON:
{
  "candidates": [
    {
      "selector": "article[data-product-id]",
      "reasoning": "Uses data attribute that appears on all product elements",
      "specificity": "high",
      "expected_count": 24,
      "priority": 1
    },
    {
      "selector": ".product-grid > article",
      "reasoning": "Direct children of product grid container",
      "specificity": "medium",
      "expected_count": 24,
      "priority": 2
    },
    {
      "selector": "article.product-card",
      "reasoning": "Class-based selector matching product card pattern",
      "specificity": "medium",
      "expected_count": 24,
      "priority": 3
    }
  ],
  "container_selector": ".product-grid",
  "confidence": 0.85
}`;

    return this.callWithRetry<SelectorCandidatesResult>(prompt);
  }

  /**
   * Step 5: Refine Selector Based on Validation Results
   * AI decides whether to accept, refine, or reject selectors
   */
  async refineSelectorWithValidation(
    validationResults: SelectorValidationResult[],
    targetProductCount: number,
    iterationNumber: number
  ): Promise<AIDetectionResult<RefinedSelectorResult>> {
    const resultsJson = JSON.stringify(validationResults, null, 2);

    const prompt = `You are a CSS selector refinement expert. Analyze these validation results and decide the best action.

ITERATION: ${iterationNumber} of 3 (refinement attempts remaining: ${3 - iterationNumber})

EXPECTED PRODUCT COUNT (estimated): ~${targetProductCount} products

VALIDATION RESULTS FOR EACH SELECTOR CANDIDATE:
${resultsJson}

Each result shows:
- selector: The CSS selector tested
- valid: Whether it's syntactically valid CSS
- matchCount: How many elements matched
- hasImages: How many have images inside
- hasPrices: How many contain price-like text (currency symbols, decimals)
- hasLinks: How many have <a> links inside
- sampleHTML: Sample of matched HTML (first 2-3 items)
- avgSize: Average width/height of matched elements
- inViewport: How many are in the visible viewport
- issues: Problems detected

DECISION CRITERIA:
1. ACCEPT if a selector matches reasonable count (${Math.max(3, targetProductCount - 5)}-${targetProductCount + 20}) with >60% having prices
2. REFINE if close but needs adjustment (e.g., too broad - add :not() exclusion; too narrow - try parent/child)
3. REJECT_ALL if no selector is close and we've exhausted refinements

REFINEMENT STRATEGIES:
- Too broad (matches non-products): Add :not(.banner), :not(.promo), or require attribute
- Too narrow (misses products): Try parent element, or remove overly specific class
- No prices: Products might be in different format, try sibling selector

Return ONLY valid JSON:
{
  "action": "accept",
  "selected_selector": "article.product-card",
  "refined_selector": null,
  "reasoning": "Selector matches 24 elements with 91% having prices - good match",
  "confidence": 0.9
}

OR for refinement:
{
  "action": "refine",
  "selected_selector": null,
  "refined_selector": "article.product-card:not(.banner):not(.featured)",
  "reasoning": "Original matched 30 elements but 6 were banners - added :not() exclusions",
  "confidence": 0.7
}

OR to reject:
{
  "action": "reject_all",
  "selected_selector": null,
  "refined_selector": null,
  "reasoning": "All selectors either match 0 elements or only non-product content",
  "confidence": 0.3
}`;

    return this.callWithRetry<RefinedSelectorResult>(prompt);
  }

  /**
   * Step 6: Final Product Verification
   * Verify that the selected elements are actually products
   */
  async verifyProductElements(
    selector: string,
    sampleHTMLElements: string[],
    screenshotBase64: string
  ): Promise<AIDetectionResult<ProductVerificationResult>> {
    const prompt = `You are verifying that CSS selector results are actual product cards.

SELECTOR BEING VERIFIED: ${selector}

SAMPLE HTML OF MATCHED ELEMENTS:
${sampleHTMLElements.map((html, i) => `--- Element ${i + 1} ---\n${html}\n`).join('\n')}

TASK: Analyze the sample HTML and screenshot to verify these are PRODUCT CARDS.

A valid PRODUCT CARD must have:
1. A product IMAGE (not a logo, icon, or category image)
2. A product TITLE/NAME (descriptive text, not just category name)
3. A PRICE (with currency symbol or decimal format) - OR "Out of stock" / "Coming soon"
4. Often has a clickable LINK to product detail page

These are NOT product cards:
- Category tiles (just a category name + generic image)
- Navigation links
- Promotional banners
- "Recently viewed" or "You may also like" headers without products
- Filter/sort controls
- Pagination elements

ANALYSIS:
- Count how many of the samples appear to be genuine products
- Count how many are NOT products (banners, categories, etc.)
- List any issues found

Return ONLY valid JSON:
{
  "verified": true,
  "product_count": 5,
  "non_product_count": 0,
  "issues": [],
  "confidence": 0.95
}

If problems found:
{
  "verified": false,
  "product_count": 2,
  "non_product_count": 3,
  "issues": [
    "3 elements appear to be category tiles, not products",
    "Elements lack price information"
  ],
  "confidence": 0.4
}`;

    return this.callWithRetry<ProductVerificationResult>(prompt, screenshotBase64);
  }

  // ===========================================================================
  // MULTI-IMAGE SUPPORT
  // ===========================================================================

  /**
   * Call Gemini with multiple images (e.g., before/after comparison)
   */
  private async callWithMultipleImages<T>(
    prompt: string,
    imagesBase64: string[],
    maxRetries: number = 2
  ): Promise<AIDetectionResult<T>> {
    if (!this.isEnabled || !this.model) {
      return {
        success: false,
        error: 'AI service not enabled',
        source: 'fallback',
        latencyMs: 0,
      };
    }

    const startTime = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.rateLimiter.acquire();

        // Build content array with prompt and all images
        const content: Array<string | { inlineData: { mimeType: string; data: string } }> = [prompt];
        for (const imageBase64 of imagesBase64) {
          content.push({
            inlineData: {
              mimeType: 'image/png',
              data: imageBase64,
            },
          });
        }

        const result = await this.model.generateContent(content);
        const responseText = result.response.text();
        const parsed = this.parseJsonResponse<T>(responseText);

        if (parsed) {
          return {
            success: true,
            data: parsed,
            source: 'ai',
            latencyMs: Date.now() - startTime,
          };
        } else {
          throw new Error('Failed to parse response');
        }
      } catch (error: any) {
        const isRateLimit = error?.message?.includes('429') || error?.message?.includes('rate');
        const isRetryable = isRateLimit || error?.message?.includes('timeout');

        console.error(`[GeminiService] Multi-image attempt ${attempt + 1} failed:`, error?.message || error);

        if (attempt < maxRetries && isRetryable) {
          const backoff = Math.pow(2, attempt) * 1000;
          console.log(`[GeminiService] Retrying in ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
        } else {
          return {
            success: false,
            error: error?.message || 'Unknown error',
            source: 'fallback',
            latencyMs: Date.now() - startTime,
          };
        }
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
      source: 'fallback',
      latencyMs: Date.now() - startTime,
    };
  }

  // ===========================================================================
  // PAGINATION VERIFICATION
  // ===========================================================================

  /**
   * Verify that pagination actually worked by comparing before/after screenshots
   * Uses AI to determine if NEW products are visible after pagination action
   */
  async verifyPaginationWorked(
    beforeScreenshot: string,
    afterScreenshot: string,
    methodDescription: string
  ): Promise<AIDetectionResult<PaginationVerificationResult>> {
    const prompt = `You are verifying whether pagination worked on an e-commerce product listing page.

I will provide TWO screenshots:
1. BEFORE screenshot - The page before pagination action
2. AFTER screenshot - The page after pagination action

PAGINATION METHOD USED: ${methodDescription}

YOUR TASK: Carefully compare the two screenshots and determine if NEW/DIFFERENT products are now visible.

VERIFICATION CRITERIA:

1. NEW PRODUCTS VISIBLE (most important):
   - Are there DIFFERENT product cards in the after screenshot?
   - For infinite scroll: Are there NEW products at the bottom that weren't visible before?
   - For page change: Is the ENTIRE product grid showing different products?

2. SCROLL POSITION CHANGE:
   - Has the viewport scrolled to show different content?
   - Did the product grid move up/down significantly?

3. PAGE INDICATOR CHANGE:
   - Did any page number indicator change (e.g., "Page 1" → "Page 2")?
   - Did "showing X-Y of Z" text change?
   - Did any "Next" button become "Previous"?

IMPORTANT - These are NOT valid pagination:
❌ Same products with different images (hover effects, lazy-loaded images)
❌ Same products slightly repositioned
❌ Loading spinners appearing/disappearing
❌ UI elements like filters or popups changing
❌ Minor layout shifts

✅ VALID pagination means:
- Completely DIFFERENT products visible (page change)
- OR ADDITIONAL products below the fold (infinite scroll/load more)

COUNT THE DIFFERENCE:
- Estimate how many new products are visible in the after screenshot
- If same products: productCountDelta should be 0

Return ONLY valid JSON:
{
  "verified": true,
  "confidence": 0.95,
  "productCountDelta": 24,
  "reasoning": "Clear page change - 24 completely different products are visible in the after screenshot. Product titles and images are entirely different from the before screenshot.",
  "visualChanges": {
    "newProductsVisible": true,
    "scrollPositionChanged": true,
    "pageIndicatorChanged": true
  },
  "recommendations": []
}

For failed pagination:
{
  "verified": false,
  "confidence": 0.85,
  "productCountDelta": 0,
  "reasoning": "Screenshots show the same products. The click may not have triggered navigation, or the element was not a pagination control.",
  "visualChanges": {
    "newProductsVisible": false,
    "scrollPositionChanged": false,
    "pageIndicatorChanged": false
  },
  "recommendations": ["Try clicking a different element", "Check if there are more pages available"]
}`;

    return this.callWithMultipleImages<PaginationVerificationResult>(
      prompt,
      [beforeScreenshot, afterScreenshot]
    );
  }

  /**
   * Use AI to detect the pagination element on a page
   * AI analyzes screenshot + simplified DOM to find the best pagination candidate
   */
  async detectPaginationElement(
    screenshot: string,
    simplifiedDom: string,
    productSelector: string
  ): Promise<AIDetectionResult<PaginationCandidateResult>> {
    const prompt = `You are analyzing an e-commerce product listing page to find the pagination control.

PRODUCT CARDS ARE SELECTED BY: ${productSelector}

SIMPLIFIED DOM (HTML structure, scripts/styles removed):
${simplifiedDom.slice(0, 15000)}${simplifiedDom.length > 15000 ? '\n... [truncated]' : ''}

YOUR TASK:
1. Look at the screenshot to identify how users navigate to see more products
2. Determine the pagination type:
   - "infinite_scroll" - Products load automatically when scrolling down (look for loading indicators at bottom)
   - "load_more" - A button that loads more products on the same page (e.g., "Load More", "Show More", "View More")
   - "next_button" - A "Next" or arrow button that goes to next page
   - "page_number" - Numbered page links (1, 2, 3, ...) - find the link to page 2
   - "none" - No pagination visible (single page with all products)

3. If there's a clickable element (not infinite scroll), provide its CSS selector from the DOM

CRITICAL - IGNORE THESE (NOT pagination):
❌ Header/footer navigation links
❌ Filter/sort dropdowns
❌ "View all categories" or category links
❌ Product ratings/reviews
❌ "Add to cart" or "Buy now" buttons
❌ Social media links
❌ Newsletter signup
❌ Help/FAQ/Terms/Privacy links

✅ LOOK FOR:
- Buttons/links below the product grid
- Elements with text like "Next", "More", "Show more", "Load more", page numbers
- Pagination containers with numbered links
- Arrow icons pointing right (→, >, »)

CSS SELECTOR TIPS:
- Prefer unique selectors: #id, [data-testid="..."], button.specific-class
- For numbered pagination, select page "2" link
- Avoid generic selectors like "a" or "button"

Return ONLY valid JSON:

If clickable pagination found:
{
  "found": true,
  "selector": "button.load-more-btn",
  "type": "load_more",
  "reasoning": "Found 'Load More' button below product grid with class 'load-more-btn'",
  "hasInfiniteScroll": false
}

If infinite scroll detected:
{
  "found": true,
  "selector": null,
  "type": "infinite_scroll",
  "reasoning": "Page has loading spinner at bottom indicating infinite scroll",
  "hasInfiniteScroll": true
}

If no pagination found:
{
  "found": false,
  "selector": null,
  "type": "none",
  "reasoning": "All products visible on single page, no pagination controls found",
  "hasInfiniteScroll": false
}`;

    return this.callWithRetry<PaginationCandidateResult>(prompt, screenshot);
  }
}

// Singleton instance
let geminiServiceInstance: GeminiService | null = null;

export function getGeminiService(): GeminiService {
  if (!geminiServiceInstance) {
    geminiServiceInstance = new GeminiService();
  }
  return geminiServiceInstance;
}
