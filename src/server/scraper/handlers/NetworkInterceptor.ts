// ============================================================================
// NETWORK INTERCEPTOR - Capture product data from XHR/fetch requests
// ============================================================================
// Solves the virtual scroll problem by intercepting API responses instead of
// scraping the DOM (which fails when elements are recycled)

import type { Page, Response } from 'playwright';

/**
 * Product data extracted from intercepted network requests
 */
export interface InterceptedProduct {
  id: string;
  title?: string;
  price?: string;
  url?: string;
  image?: string;
  raw: Record<string, unknown>; // Full JSON for custom extraction
}

/**
 * Configuration for network interception
 */
export interface NetworkInterceptorConfig {
  /** URL patterns to intercept (substring match or regex) */
  urlPatterns: string[];
  /** JSON path to product data in response (e.g., "data.products" or "tile") */
  dataPath?: string;
  /** Field mappings from JSON to our standard fields */
  fieldMappings?: {
    id?: string;      // JSON path to ID field
    title?: string;   // JSON path to title
    price?: string;   // JSON path to price
    url?: string;     // JSON path to URL
    image?: string;   // JSON path to image
  };
}

/**
 * Result from auto-detection
 */
export interface DetectedPattern {
  pattern: string;
  sampleData: Record<string, unknown>;
  confidence: number;
  suggestedMappings: {
    id?: string;
    title?: string;
    price?: string;
    url?: string;
    image?: string;
  };
}

// Common product API patterns to watch for during auto-detection
const PRODUCT_API_PATTERNS = [
  /\/tile\/\d+/,           // otto.de style
  /\/api\/products?\//i,   // Generic REST
  /\/graphql/i,            // GraphQL
  /\/v\d+\/items?\//i,     // Versioned API
  /\/catalog\//i,          // E-commerce catalog
  /\/_next\/data.*\.json/i,// Next.js data fetching
  /\/product[s]?\/\d+/i,   // Product by ID
  /\/sku\//i,              // SKU-based
  /\/item[s]?\//i,         // Item endpoints
];

// Common field names for auto-detection
const FIELD_PATTERNS = {
  id: ['id', 'productId', 'sku', 'itemId', 'variationId', 'articleId'],
  title: ['title', 'name', 'productName', 'displayName', 'label', 'headline'],
  price: ['price', 'currentPrice', 'salePrice', 'finalPrice', 'displayPrice', 'priceValue'],
  url: ['url', 'href', 'link', 'productUrl', 'pdpUrl', 'detailUrl', 'canonicalUrl'],
  image: ['image', 'imageUrl', 'img', 'thumbnail', 'mainImage', 'primaryImage', 'pictureUrl'],
};

/**
 * NetworkInterceptor - Captures product data from XHR/fetch responses
 *
 * Usage:
 * ```typescript
 * const interceptor = new NetworkInterceptor(page, {
 *   urlPatterns: ['/crocotile/tile/'],
 *   dataPath: 'tile',
 *   fieldMappings: { title: 'title', price: 'price.current' }
 * });
 *
 * await interceptor.startListening();
 * // ... scroll page to trigger XHR requests ...
 * const products = interceptor.getProducts();
 * ```
 */
export class NetworkInterceptor {
  private page: Page;
  private config: NetworkInterceptorConfig;
  private capturedProducts: Map<string, InterceptedProduct> = new Map();
  private isListening = false;
  private responseHandler: ((response: Response) => Promise<void>) | null = null;

  // For auto-detection mode
  private detectedPatterns: Map<string, DetectedPattern> = new Map();
  private autoDetectMode = false;

  constructor(page: Page, config: NetworkInterceptorConfig) {
    this.page = page;
    this.config = config;
  }

  /**
   * Start listening for network responses
   */
  async startListening(): Promise<void> {
    if (this.isListening) return;
    this.isListening = true;

    this.responseHandler = async (response: Response) => {
      await this.handleResponse(response);
    };

    this.page.on('response', this.responseHandler);
    console.log('[NetworkInterceptor] Started listening for responses');
  }

  /**
   * Stop listening for network responses
   */
  stopListening(): void {
    if (!this.isListening || !this.responseHandler) return;

    this.page.off('response', this.responseHandler);
    this.responseHandler = null;
    this.isListening = false;
    console.log('[NetworkInterceptor] Stopped listening');
  }

  /**
   * Start auto-detection mode - watches for any product-like API responses
   */
  async startAutoDetect(): Promise<void> {
    this.autoDetectMode = true;
    this.detectedPatterns.clear();

    if (!this.isListening) {
      await this.startListening();
    }
    console.log('[NetworkInterceptor] Auto-detect mode enabled');
  }

  /**
   * Stop auto-detection and return detected patterns
   */
  stopAutoDetect(): DetectedPattern[] {
    this.autoDetectMode = false;
    const patterns = Array.from(this.detectedPatterns.values());
    console.log(`[NetworkInterceptor] Auto-detect found ${patterns.length} patterns`);
    return patterns;
  }

  /**
   * Handle incoming response
   */
  private async handleResponse(response: Response): Promise<void> {
    const url = response.url();

    // In auto-detect mode, check for product-like patterns
    if (this.autoDetectMode) {
      await this.tryAutoDetect(response);
      return;
    }

    // In normal mode, check if URL matches configured patterns
    const matches = this.config.urlPatterns.some(pattern => {
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        // Treat as regex
        const regex = new RegExp(pattern.slice(1, -1));
        return regex.test(url);
      }
      return url.includes(pattern);
    });

    if (!matches) return;
    if (response.status() !== 200) return;

    try {
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;

      const json = await response.json();
      const product = this.extractProduct(json, url);

      if (product && product.id) {
        // Avoid duplicates
        if (!this.capturedProducts.has(product.id)) {
          this.capturedProducts.set(product.id, product);
          console.log(`[NetworkInterceptor] Captured: ${product.id} - ${product.title || 'untitled'}`);
        }
      }
    } catch {
      // Not JSON or parsing failed - ignore
    }
  }

  /**
   * Try to auto-detect product API patterns from response
   */
  private async tryAutoDetect(response: Response): Promise<void> {
    const url = response.url();

    // Check if URL matches any known product API patterns
    const matchedPattern = PRODUCT_API_PATTERNS.find(pattern => pattern.test(url));
    if (!matchedPattern) return;
    if (response.status() !== 200) return;

    try {
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;

      const json = await response.json();

      // Check if response looks like product data
      const analysis = this.analyzeProductData(json, url);
      if (!analysis) return;

      // Extract a simplified pattern from the URL
      const urlPattern = this.extractUrlPattern(url);

      // Store or update the detected pattern
      const existing = this.detectedPatterns.get(urlPattern);
      if (!existing || analysis.confidence > existing.confidence) {
        this.detectedPatterns.set(urlPattern, {
          pattern: urlPattern,
          sampleData: json,
          confidence: analysis.confidence,
          suggestedMappings: analysis.mappings,
        });
        console.log(`[NetworkInterceptor] Detected pattern: ${urlPattern} (confidence: ${analysis.confidence})`);
      }
    } catch {
      // Ignore parsing errors
    }
  }

  /**
   * Analyze JSON data to see if it looks like product data
   */
  private analyzeProductData(
    data: unknown,
    url: string
  ): { confidence: number; mappings: DetectedPattern['suggestedMappings'] } | null {
    if (!data || typeof data !== 'object') return null;

    const obj = data as Record<string, unknown>;
    let confidence = 0;
    const mappings: DetectedPattern['suggestedMappings'] = {};

    // Try to find each field type
    for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
      const found = this.findFieldInObject(obj, patterns);
      if (found) {
        mappings[field as keyof typeof mappings] = found.path;
        confidence += found.confidence;
      }
    }

    // Need at least title and price to be considered product data
    if (!mappings.title && !mappings.price) return null;

    // Bonus confidence if we found both title and price
    if (mappings.title && mappings.price) confidence += 20;

    // Extract ID from URL if not found in data
    if (!mappings.id) {
      const urlMatch = url.match(/\/(\d+)(?:\?|$)/);
      if (urlMatch) {
        mappings.id = '_url_id_'; // Special marker for URL-based ID
        confidence += 10;
      }
    }

    return confidence >= 30 ? { confidence, mappings } : null;
  }

  /**
   * Find a field in an object by checking common patterns
   */
  private findFieldInObject(
    obj: Record<string, unknown>,
    patterns: string[],
    prefix = ''
  ): { path: string; confidence: number } | null {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;

      // Check if key matches any pattern
      const matchedPattern = patterns.find(p =>
        key.toLowerCase() === p.toLowerCase() ||
        key.toLowerCase().includes(p.toLowerCase())
      );

      if (matchedPattern) {
        // Exact match = higher confidence
        const isExact = key.toLowerCase() === matchedPattern.toLowerCase();
        const hasValue = value !== null && value !== undefined && value !== '';

        if (hasValue) {
          return {
            path: currentPath,
            confidence: isExact ? 25 : 15,
          };
        }
      }

      // Recurse into nested objects (max depth 3)
      if (value && typeof value === 'object' && !Array.isArray(value) && prefix.split('.').length < 3) {
        const nested = this.findFieldInObject(value as Record<string, unknown>, patterns, currentPath);
        if (nested) return nested;
      }
    }

    return null;
  }

  /**
   * Extract a simplified URL pattern for matching
   */
  private extractUrlPattern(url: string): string {
    try {
      const parsed = new URL(url);
      // Replace numeric IDs with wildcard
      const path = parsed.pathname.replace(/\/\d+/g, '/*');
      return path;
    } catch {
      return url;
    }
  }

  /**
   * Extract product data from JSON response
   */
  private extractProduct(json: unknown, url: string): InterceptedProduct | null {
    if (!json || typeof json !== 'object') return null;

    // Navigate to data path if specified
    let data = json as Record<string, unknown>;
    if (this.config.dataPath) {
      for (const key of this.config.dataPath.split('.')) {
        if (data && typeof data === 'object' && key in data) {
          data = data[key] as Record<string, unknown>;
        } else {
          return null;
        }
      }
    }

    if (!data) return null;

    // Extract ID from URL or data
    const id = this.extractId(url, data);
    if (!id) return null;

    // Map fields using config or auto-detect
    const mappings = this.config.fieldMappings || {};

    return {
      id,
      title: this.getNestedValue(data, mappings.title) || this.autoDetectField(data, FIELD_PATTERNS.title) || undefined,
      price: this.formatPrice(this.getNestedValue(data, mappings.price) || this.autoDetectField(data, FIELD_PATTERNS.price)),
      url: this.resolveUrl(this.getNestedValue(data, mappings.url) || this.autoDetectField(data, FIELD_PATTERNS.url)),
      image: this.resolveUrl(this.getNestedValue(data, mappings.image) || this.autoDetectField(data, FIELD_PATTERNS.image)),
      raw: data,
    };
  }

  /**
   * Extract product ID from URL or data
   */
  private extractId(url: string, data: Record<string, unknown>): string | null {
    // Try to get ID from configured mapping
    if (this.config.fieldMappings?.id) {
      const idValue = this.getNestedValue(data, this.config.fieldMappings.id);
      if (idValue) return String(idValue);
    }

    // Try common ID field names
    for (const fieldName of FIELD_PATTERNS.id) {
      const value = this.getNestedValue(data, fieldName);
      if (value) return String(value);
    }

    // Extract from URL (e.g., /tile/1902242543)
    const urlMatch = url.match(/\/(\d+)(?:\?|$)/);
    if (urlMatch) return urlMatch[1];

    // Last resort: generate from URL hash
    return null;
  }

  /**
   * Get nested value from object using dot notation path
   */
  private getNestedValue(obj: Record<string, unknown>, path?: string): string | null {
    if (!path) return null;

    let current: unknown = obj;
    for (const key of path.split('.')) {
      if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return null;
      }
    }

    return current !== null && current !== undefined ? String(current) : null;
  }

  /**
   * Auto-detect field by trying common field names
   */
  private autoDetectField(data: Record<string, unknown>, fieldNames: string[]): string | null {
    for (const fieldName of fieldNames) {
      // Try direct access
      if (fieldName in data && data[fieldName]) {
        return String(data[fieldName]);
      }

      // Try case-insensitive search
      const key = Object.keys(data).find(k => k.toLowerCase() === fieldName.toLowerCase());
      if (key && data[key]) {
        return String(data[key]);
      }
    }

    // Try nested search (one level)
    for (const [, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        for (const fieldName of fieldNames) {
          if (fieldName in nested && nested[fieldName]) {
            return String(nested[fieldName]);
          }
        }
      }
    }

    return null;
  }

  /**
   * Format price value for display
   */
  private formatPrice(value: string | null): string | undefined {
    if (!value) return undefined;

    // If it's already formatted with currency symbol, return as-is
    if (/[€$£¥]/.test(value)) return value;

    // Try to parse as number and format
    const num = parseFloat(value.replace(',', '.'));
    if (!isNaN(num)) {
      // Assume euros for now (could be made configurable)
      return `${num.toFixed(2)} €`;
    }

    return value;
  }

  /**
   * Resolve relative URLs to absolute
   */
  private resolveUrl(value: string | null): string | undefined {
    if (!value) return undefined;

    // Already absolute
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }

    // Protocol-relative
    if (value.startsWith('//')) {
      return `https:${value}`;
    }

    // Relative URL - resolve against page URL
    try {
      const base = new URL(this.page.url());
      return new URL(value, base).toString();
    } catch {
      return value;
    }
  }

  /**
   * Get all captured products
   */
  getProducts(): InterceptedProduct[] {
    return Array.from(this.capturedProducts.values());
  }

  /**
   * Get product count
   */
  getProductCount(): number {
    return this.capturedProducts.size;
  }

  /**
   * Clear captured products
   */
  clear(): void {
    this.capturedProducts.clear();
  }

  /**
   * Check if currently listening
   */
  isActive(): boolean {
    return this.isListening;
  }

  /**
   * Update configuration (e.g., after auto-detection)
   */
  updateConfig(config: Partial<NetworkInterceptorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
