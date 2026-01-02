// ============================================================================
// BASE EXTRACTOR - Abstract Base Class
// ============================================================================
// Defines the interface for site-specific extraction adapters

import type { Page, CDPSession } from 'playwright';
import type { ScraperConfig, AssignedSelector, ScrapedItem } from '../../../shared/types.js';
import type { ItemExtractionError } from '../types/errors.js';

/**
 * Result of extraction from a single page
 */
export interface ExtractionResult {
  /** Successfully extracted items */
  items: ScrapedItem[];
  /** Errors encountered during extraction */
  errors: ItemExtractionError[];
  /** Container selector used (if auto-detected) */
  containerSelector?: string;
  /** Number of containers found */
  containerCount?: number;
}

/**
 * Context passed to extractors
 */
export interface ExtractionContext {
  page: Page;
  cdp: CDPSession;
  config: ScraperConfig;
  baseUrl: string;
}

/**
 * Abstract base class for site-specific extractors
 * Implement this to add custom extraction logic for specific sites
 */
export abstract class BaseExtractor {
  protected page: Page;
  protected cdp: CDPSession;

  constructor(page: Page, cdp: CDPSession) {
    this.page = page;
    this.cdp = cdp;
  }

  /**
   * Check if this extractor can handle the given config
   * Override this to detect site-specific patterns
   */
  abstract canHandle(config: ScraperConfig): boolean;

  /**
   * Extract data from the current page
   * Override this with site-specific extraction logic
   */
  abstract extract(config: ScraperConfig): Promise<ExtractionResult>;

  /**
   * Get the priority of this extractor (lower = higher priority)
   * Default extractors should have higher numbers
   */
  getPriority(): number {
    return 100;
  }

  /**
   * Get a descriptive name for this extractor
   */
  abstract getName(): string;

  /**
   * Helper: Execute JavaScript in the browser context via CDP
   */
  protected async evaluate<T>(expression: string): Promise<T> {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.text ||
          result.exceptionDetails.exception?.description ||
          'Evaluation failed'
      );
    }

    return result.result.value as T;
  }

  /**
   * Helper: Group selectors by role for fallback support
   */
  protected groupSelectorsByRole(
    selectors: AssignedSelector[]
  ): Record<string, AssignedSelector[]> {
    const grouped: Record<string, AssignedSelector[]> = {};

    for (const sel of selectors) {
      if (!grouped[sel.role]) {
        grouped[sel.role] = [];
      }
      grouped[sel.role].push(sel);
    }

    // Sort each group by priority
    for (const role of Object.keys(grouped)) {
      grouped[role].sort((a, b) => (a.priority || 0) - (b.priority || 0));
    }

    return grouped;
  }

  /**
   * Helper: Check if config has separate price roles
   */
  protected hasSeparatePriceRoles(selectors: AssignedSelector[]): {
    hasOriginalPrice: boolean;
    hasSalePrice: boolean;
    hasBothPriceTypes: boolean;
  } {
    const hasOriginalPrice = selectors.some((s) => s.role === 'originalPrice');
    const hasSalePrice = selectors.some((s) => s.role === 'salePrice');
    return {
      hasOriginalPrice,
      hasSalePrice,
      hasBothPriceTypes: hasOriginalPrice && hasSalePrice,
    };
  }
}
