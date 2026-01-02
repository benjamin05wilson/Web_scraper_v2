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

    this.rateLimiter = new RateLimiter(10, 10); // 10 requests per minute
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

    const prompt = `Analyze this product card screenshot and label each extracted piece of content.

Extracted content from the product card:
${itemsJson}

For each extracted item (by index), determine what field it represents:
- "title": The product name/title (usually the longest text, descriptive)
- "price": The current selling price (has currency symbol like $, €, £, or numbers with decimals)
- "original_price": The original price before discount (often struck through or in gray)
- "sale_price": A discounted/sale price (often in red or highlighted)
- "url": Link to the product detail page (URLs containing /product/, /p/, /item/, /dp/)
- "image": Product image URL (ends in .jpg, .png, .webp, or image CDN URLs)
- "skip": Content to ignore (ratings, review counts, brand names, "Add to cart", etc.)

Rules:
- Prices have currency symbols ($, EUR, €, £, ¥) or end with decimals (.00, .99)
- Titles are usually the longest text and describe the product
- Product URLs often contain /product/, /p/, /item/, /dp/, or product IDs
- Only label ONE item as "title" (pick the best product name)
- Only label ONE item as "price" unless there's a sale (then use original_price + sale_price)

Return ONLY valid JSON in this exact format:
{
  "labels": [
    { "index": 0, "field": "title", "confidence": 0.95 },
    { "index": 1, "field": "price", "confidence": 0.9 },
    { "index": 2, "field": "image", "confidence": 1.0 },
    { "index": 3, "field": "url", "confidence": 0.88 },
    { "index": 4, "field": "skip", "confidence": 0.7, "reason": "brand name" }
  ]
}`;

    return this.callWithRetry<GeminiFieldLabelResult>(prompt, screenshotBase64);
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
