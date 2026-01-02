// ============================================================================
// SCRAPING ENGINE V2 - Refactored with Modular Architecture
// ============================================================================
// Orchestrates scraping using extracted utilities and handlers

import type { Page, CDPSession } from 'playwright';
import type {
  ScraperConfig,
  ScrapeResult,
  ScrapedItem,
  AdvancedScraperConfig,
  NetworkExtractionConfig,
} from '../../shared/types.js';

import { LazyLoadHandler, type LazyLoadConfig } from './handlers/LazyLoadHandler.js';
import { PaginationHandler, type PaginationConfig } from './handlers/PaginationHandler.js';
import { PreActionsHandler } from './handlers/PreActionsHandler.js';
import { NetworkInterceptor, type InterceptedProduct } from './handlers/NetworkInterceptor.js';
import { BaseExtractor } from './adapters/BaseExtractor.js';
import { DefaultExtractor } from './adapters/DefaultExtractor.js';
import { ZaraExtractor } from './adapters/ZaraExtractor.js';
import {
  wrapError,
  type ScrapeError,
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,
  calculateRetryDelay,
} from './types/errors.js';

// Re-export AdvancedScraperConfig for convenience
export type { AdvancedScraperConfig };

/**
 * Extended scraper config - alias for ScraperConfig (which now includes advanced options)
 */
export type ExtendedScraperConfig = ScraperConfig;

/**
 * ScrapingEngine V2 - Modular, testable, maintainable
 *
 * Orchestrates:
 * - Navigation
 * - Pre-actions (cookie banners, etc.)
 * - Lazy load handling
 * - Data extraction (via adapters)
 * - Pagination
 * - Error handling with retry support
 */
export class ScrapingEngineV2 {
  private page: Page;
  private cdp: CDPSession;
  private extractors: BaseExtractor[];
  private retryConfig: RetryConfig;

  constructor(page: Page, cdp: CDPSession) {
    this.page = page;
    this.cdp = cdp;

    // Register extractors (order by priority)
    this.extractors = [
      new ZaraExtractor(page, cdp),
      new DefaultExtractor(page, cdp),
    ].sort((a, b) => a.getPriority() - b.getPriority());

    this.retryConfig = DEFAULT_RETRY_CONFIG;
  }

  /**
   * Main execution entry point
   */
  async execute(config: ExtendedScraperConfig): Promise<ScrapeResult> {
    const startTime = Date.now();
    const allItems: ScrapedItem[] = [];
    const errors: ScrapeError[] = [];
    let pagesScraped = 0;
    const targetProducts = config.targetProducts || 0;

    // Check for network extraction mode (for virtual scroll / XHR-based sites)
    if ((config as any).networkExtraction?.enabled) {
      console.log(`[ScrapingEngineV2] Using NETWORK EXTRACTION mode`);
      return this.executeWithNetworkExtraction(config, startTime, targetProducts);
    }

    // Normalize selectors
    const selectors = Array.isArray(config.selectors) ? config.selectors : [];
    config = { ...config, selectors };

    console.log(`[ScrapingEngineV2] Starting: ${config.name}`);
    console.log(`[ScrapingEngineV2] URL: ${config.startUrl}`);
    console.log(`[ScrapingEngineV2] Selectors: ${selectors.length}`);
    console.log(`[ScrapingEngineV2] Target: ${targetProducts || 'unlimited'}`);

    // Validate selectors
    if (selectors.length === 0) {
      return {
        success: false,
        items: [],
        pagesScraped: 0,
        duration: Date.now() - startTime,
        errors: ['No selectors configured. Please configure selectors in the Builder first.'],
      };
    }

    // Set up retry config from advanced options
    if (config.advanced?.retryCount) {
      this.retryConfig = {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: config.advanced.retryCount,
        retryDelay: config.advanced.retryDelay || DEFAULT_RETRY_CONFIG.retryDelay,
      };
    }

    try {
      // Create handlers
      const lazyLoadConfig: LazyLoadConfig = {
        scrollStrategy: config.advanced?.scrollStrategy,
        scrollDelay: config.advanced?.scrollDelay,
        maxIterations: config.advanced?.maxScrollIterations,
        loadingIndicators: config.advanced?.loadingIndicators,
        stabilityTimeout: config.advanced?.stabilityTimeout,
        rapidScrollStep: config.advanced?.rapidScrollStep,
        rapidScrollDelay: config.advanced?.rapidScrollDelay,
        targetProducts,
      };
      const lazyLoadHandler = new LazyLoadHandler(this.page, this.cdp, lazyLoadConfig);

      // Inject lazy load interceptor BEFORE navigation
      await lazyLoadHandler.injectObserverOverride();

      // Navigate with retry support
      await this.navigateWithRetry(config.startUrl);
      console.log(`[ScrapingEngineV2] Navigated to: ${this.page.url()}`);

      // Execute pre-actions
      if (config.preActions && config.preActions.actions.length > 0) {
        const preActionsHandler = new PreActionsHandler(this.page, {
          actions: config.preActions.actions,
        });
        await preActionsHandler.execute();
      }

      // Auto-scroll to load lazy content
      if (config.autoScroll !== false) {
        console.log('[ScrapingEngineV2] Loading lazy content...');
        await lazyLoadHandler.scrollToLoadContent(selectors);
      }

      // Set up pagination
      const paginationConfig: PaginationConfig = {
        enabled: config.pagination?.enabled || false,
        type: config.pagination?.type,
        selector: config.pagination?.selector,
        pattern: config.pagination?.pattern,
        offset: config.pagination?.offset,
        maxPages: config.pagination?.maxPages || 1,
        waitAfterClick: config.pagination?.waitAfterClick,
      };
      const paginationHandler = new PaginationHandler(this.page, paginationConfig);

      // Log pagination config for debugging
      if (paginationConfig.enabled) {
        console.log(`[ScrapingEngineV2] Pagination: type=${paginationConfig.type}, maxPages=${paginationConfig.maxPages}`);
        if (paginationConfig.offset) {
          console.log(`[ScrapingEngineV2] Offset config: key=${paginationConfig.offset.key}, start=${paginationConfig.offset.start}, increment=${paginationConfig.offset.increment}`);
        }
      }
      const maxPages = paginationConfig.enabled ? paginationConfig.maxPages : 1;

      // Select appropriate extractor
      const extractor = this.selectExtractor(config);
      console.log(`[ScrapingEngineV2] Using extractor: ${extractor.getName()}`);

      // Scrape pages
      for (let pageNum = 0; pageNum < maxPages; pageNum++) {
        console.log(`[ScrapingEngineV2] Scraping page ${pageNum + 1}/${maxPages}`);

        // Extract data
        const result = await extractor.extract(config);
        allItems.push(...result.items);
        pagesScraped++;

        // Log extraction errors but continue
        if (result.errors.length > 0) {
          result.errors.forEach((err) => {
            console.warn(`[ScrapingEngineV2] Extraction warning: ${err.error}`);
          });
        }

        console.log(
          `[ScrapingEngineV2] Page ${pageNum + 1}: ${result.items.length} items (total: ${allItems.length})`
        );

        // Check target
        if (targetProducts > 0 && allItems.length >= targetProducts) {
          console.log(`[ScrapingEngineV2] Reached target: ${targetProducts}`);
          allItems.length = targetProducts;
          break;
        }

        // Navigate to next page
        if (paginationConfig.enabled && pageNum < maxPages - 1) {
          const hasNext = await paginationHandler.goToNextPage();
          if (!hasNext) {
            console.log('[ScrapingEngineV2] No more pages');
            break;
          }

          // After URL navigation, the page is fresh - re-inject lazy load blocker
          // and scroll to load content
          if (config.autoScroll !== false) {
            console.log('[ScrapingEngineV2] Re-initializing lazy load handling for new page...');
            // Re-inject the IntersectionObserver override into the new page
            await lazyLoadHandler.injectObserverOverrideIntoPage();
            await lazyLoadHandler.disableLazyLoading();
            await new Promise((r) => setTimeout(r, 500));
            // Scroll to load lazy content on this page
            await lazyLoadHandler.scrollToLoadContent(selectors);
          }
        }
      }

      // Final truncation
      if (targetProducts > 0 && allItems.length > targetProducts) {
        allItems.length = targetProducts;
      }

      return {
        success: true,
        items: allItems,
        pagesScraped,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const scrapeError = wrapError(error);
      errors.push(scrapeError);
      console.error(`[ScrapingEngineV2] Error: ${scrapeError.message}`);

      return {
        success: false,
        items: allItems, // Return partial results
        pagesScraped,
        duration: Date.now() - startTime,
        errors: [scrapeError.message],
      };
    }
  }

  /**
   * Navigate to URL with retry support for transient errors
   */
  private async navigateWithRetry(url: string): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        await this.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const scrapeError = wrapError(error);

        if (!scrapeError.retriable || attempt >= this.retryConfig.maxRetries) {
          throw lastError;
        }

        const delay = calculateRetryDelay(attempt, this.retryConfig);
        console.log(
          `[ScrapingEngineV2] Navigation failed, retrying in ${delay}ms (attempt ${attempt + 1}/${this.retryConfig.maxRetries})`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastError || new Error('Navigation failed');
  }

  /**
   * Select the appropriate extractor for the config
   */
  private selectExtractor(config: ScraperConfig): BaseExtractor {
    for (const extractor of this.extractors) {
      if (extractor.canHandle(config)) {
        return extractor;
      }
    }
    // Should never happen since DefaultExtractor handles everything
    return this.extractors[this.extractors.length - 1];
  }

  /**
   * Execute with network extraction mode (for virtual scroll / XHR-based sites)
   */
  private async executeWithNetworkExtraction(
    config: ExtendedScraperConfig,
    startTime: number,
    targetProducts: number
  ): Promise<ScrapeResult> {
    const networkConfig = (config as any).networkExtraction as NetworkExtractionConfig;

    console.log(`[ScrapingEngineV2] Network extraction: ${config.name}`);
    console.log(`[ScrapingEngineV2] URL patterns: ${networkConfig.urlPatterns.join(', ')}`);
    console.log(`[ScrapingEngineV2] Target products: ${targetProducts || 'unlimited'}`);

    try {
      // Create network interceptor
      const interceptor = new NetworkInterceptor(this.page, {
        urlPatterns: networkConfig.urlPatterns,
        dataPath: networkConfig.dataPath,
        fieldMappings: networkConfig.fieldMappings,
      });

      // Start listening BEFORE navigation
      await interceptor.startListening();

      // Navigate to start URL with retry support
      await this.navigateWithRetry(config.startUrl);
      console.log(`[ScrapingEngineV2] Navigated to: ${this.page.url()}`);

      // Execute pre-actions (popups, cookies, etc.) if defined
      if (config.preActions && config.preActions.actions.length > 0) {
        const preActionsHandler = new PreActionsHandler(this.page, {
          actions: config.preActions.actions,
        });
        await preActionsHandler.execute();
      }

      // Scroll to trigger XHR requests for products
      console.log('[ScrapingEngineV2] Scrolling to trigger network requests...');
      await this.scrollToTriggerNetworkRequests(interceptor, targetProducts);

      // Get captured products
      const capturedProducts = interceptor.getProducts();
      console.log(`[ScrapingEngineV2] Captured ${capturedProducts.length} products from network`);

      // Stop interceptor
      interceptor.stopListening();

      // Convert intercepted products to ScrapedItem format
      const items: ScrapedItem[] = capturedProducts.map((product: InterceptedProduct) => ({
        title: product.title || null,
        price: product.price || null,
        url: product.url || null,
        image: product.image || null,
      }));

      // Truncate to target if needed
      if (targetProducts > 0 && items.length > targetProducts) {
        items.length = targetProducts;
      }

      return {
        success: true,
        items,
        pagesScraped: 1,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const scrapeError = wrapError(error);
      console.error(`[ScrapingEngineV2] Network extraction error: ${scrapeError.message}`);

      return {
        success: false,
        items: [],
        pagesScraped: 0,
        duration: Date.now() - startTime,
        errors: [scrapeError.message],
      };
    }
  }

  /**
   * Scroll to trigger network requests for product data
   */
  private async scrollToTriggerNetworkRequests(
    interceptor: NetworkInterceptor,
    targetProducts: number
  ): Promise<void> {
    const maxScrollIterations = 50;
    const scrollStepSize = 500;
    const scrollDelay = 800;

    let iteration = 0;
    let noChangeCount = 0;
    const maxNoChange = 5;

    while (iteration < maxScrollIterations && noChangeCount < maxNoChange) {
      const beforeCount = interceptor.getProductCount();

      // Check if we've reached target
      if (targetProducts > 0 && beforeCount >= targetProducts) {
        console.log(`[ScrapingEngineV2] Reached target of ${targetProducts} products`);
        break;
      }

      // Scroll down
      await this.page.evaluate((step) => {
        window.scrollBy({ top: step, behavior: 'smooth' });
      }, scrollStepSize);

      // Wait for network requests
      await new Promise((r) => setTimeout(r, scrollDelay));

      const afterCount = interceptor.getProductCount();

      if (afterCount > beforeCount) {
        console.log(`[ScrapingEngineV2] Network scroll: captured ${afterCount - beforeCount} new products (total: ${afterCount})`);
        noChangeCount = 0;
      } else {
        noChangeCount++;
      }

      iteration++;

      // Log progress periodically
      if (iteration % 10 === 0) {
        console.log(`[ScrapingEngineV2] Scroll iteration ${iteration}, ${afterCount} products captured`);
      }
    }

    // Final scroll to bottom to catch any remaining
    await this.page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    });
    await new Promise((r) => setTimeout(r, 1000));

    console.log(`[ScrapingEngineV2] Network scroll complete: ${interceptor.getProductCount()} products`);
  }

  /**
   * Register a custom extractor
   */
  registerExtractor(extractor: BaseExtractor): void {
    this.extractors.push(extractor);
    this.extractors.sort((a, b) => a.getPriority() - b.getPriority());
  }

  /**
   * Validate configuration before scraping
   */
  async validateConfig(config: ScraperConfig): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      await this.page.goto(config.startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
    } catch {
      return {
        valid: false,
        errors: [`Cannot load URL: ${config.startUrl}`],
        warnings: [],
      };
    }

    for (const selector of config.selectors) {
      if (selector.selector.css === ':parent-link') continue;

      try {
        const count = await this.page.evaluate(
          (css) => document.querySelectorAll(css).length,
          selector.selector.css
        );

        if (count === 0) {
          errors.push(
            `Selector "${selector.role}" (${selector.selector.css}) matches 0 elements`
          );
        } else if (count > 100) {
          warnings.push(
            `Selector "${selector.role}" matches ${count} elements`
          );
        }
      } catch {
        errors.push(`Invalid selector: ${selector.selector.css}`);
      }
    }

    if (config.itemContainer) {
      try {
        const count = await this.page.evaluate(
          (css) => document.querySelectorAll(css).length,
          config.itemContainer
        );
        if (count === 0) {
          errors.push(`Item container matches 0 elements: ${config.itemContainer}`);
        }
      } catch {
        errors.push(`Invalid item container selector: ${config.itemContainer}`);
      }
    }

    // Validate pagination selector if enabled (only for click-based pagination)
    if (config.pagination?.enabled && config.pagination.selector) {
      try {
        const exists = await this.page.evaluate(
          (css) => !!document.querySelector(css),
          config.pagination.selector
        );
        if (!exists) {
          warnings.push(`Pagination selector not found: ${config.pagination.selector}`);
        }
      } catch {
        warnings.push(`Invalid pagination selector: ${config.pagination.selector}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
