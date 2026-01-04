// ============================================================================
// PAGINATION VERIFIER
// ============================================================================
// Tests pagination methods using AI vision for both detection and verification
// AI analyzes screenshots + simplified DOM to find pagination elements
// Returns ranked results with before/after screenshots for user validation

import type { Page } from 'playwright';
import type {
  PaginationMethodType,
  PaginationTestResult,
  PaginationTestAllResult,
  PaginationVerificationResult,
  PaginationCandidateResult,
  PaginationCandidateType,
} from '../ai/types.js';
import { getGeminiService } from '../ai/GeminiService.js';

/**
 * Callback for reporting test progress
 */
export interface PaginationTestProgressCallback {
  (current: number, total: number, methodName: string): void;
}

/**
 * Configuration for pagination verification
 */
export interface PaginationVerifierConfig {
  maxCandidatesToTest: number;
  scrollDistance: number;
  scrollDelay: number;
  clickDelay: number;
  waitForContentMs: number;
}

const DEFAULT_CONFIG: PaginationVerifierConfig = {
  maxCandidatesToTest: 5,
  scrollDistance: 800,
  scrollDelay: 600,
  clickDelay: 500,
  waitForContentMs: 2000,
};

/**
 * Verifies pagination methods using AI vision comparison
 */
export class PaginationVerifier {
  private page: Page;
  private itemSelector: string;
  private config: PaginationVerifierConfig;
  private gemini = getGeminiService();

  constructor(
    page: Page,
    itemSelector: string,
    config: Partial<PaginationVerifierConfig> = {}
  ) {
    this.page = page;
    this.itemSelector = itemSelector;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Test all pagination methods and return ranked results
   * Uses AI to detect pagination elements instead of heuristics
   */
  async testAllMethods(
    onProgress?: PaginationTestProgressCallback
  ): Promise<PaginationTestAllResult> {
    const startTime = Date.now();
    const results: PaginationTestResult[] = [];

    // Step 1: Always test infinite scroll first (no AI needed for detection)
    if (onProgress) {
      onProgress(1, 2, 'Infinite Scroll');
    }
    console.log('[PaginationVerifier] Testing method 1/2: Infinite Scroll');

    try {
      const scrollResult = await this.testInfiniteScroll();
      if (scrollResult) {
        results.push(scrollResult);
        console.log(`[PaginationVerifier] Infinite scroll result: verified=${scrollResult.verified}, confidence=${scrollResult.confidence.toFixed(2)}`);
      }
    } catch (error: any) {
      console.error('[PaginationVerifier] Infinite scroll test failed:', error.message);
    }

    // Step 2: Ask AI to find pagination element
    if (onProgress) {
      onProgress(2, 2, 'AI Detection');
    }
    console.log('[PaginationVerifier] Testing method 2/2: AI Detection');

    try {
      const aiCandidate = await this.detectWithAI();

      if (aiCandidate && aiCandidate.found && aiCandidate.selector && aiCandidate.type !== 'infinite_scroll') {
        console.log(`[PaginationVerifier] AI detected: type=${aiCandidate.type}, selector=${aiCandidate.selector}`);
        console.log(`[PaginationVerifier] AI reasoning: ${aiCandidate.reasoning}`);

        const candidateResult = await this.testAICandidate(aiCandidate);
        if (candidateResult) {
          results.push(candidateResult);
          console.log(`[PaginationVerifier] AI candidate result: verified=${candidateResult.verified}, confidence=${candidateResult.confidence.toFixed(2)}`);
        }
      } else if (aiCandidate?.hasInfiniteScroll) {
        console.log('[PaginationVerifier] AI confirms infinite scroll is the pagination method');
      } else {
        console.log('[PaginationVerifier] AI did not find a pagination element');
      }
    } catch (error: any) {
      console.error('[PaginationVerifier] AI detection failed:', error.message);
    }

    // Sort by confidence (highest first)
    results.sort((a, b) => b.confidence - a.confidence);

    // Find best verified method
    const bestMethod = results.find(r => r.verified) || null;

    return {
      testedMethods: results,
      bestMethod,
      totalTestDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Detect pagination element using AI vision
   */
  private async detectWithAI(): Promise<PaginationCandidateResult | null> {
    if (!this.gemini.isEnabled) {
      console.log('[PaginationVerifier] AI not enabled, skipping AI detection');
      return null;
    }

    try {
      // Capture full page screenshot for AI analysis
      const screenshot = await this.captureFullPageScreenshot();

      // Get simplified DOM
      const simplifiedDom = await this.getSimplifiedDom();

      console.log(`[PaginationVerifier] Sending to AI: screenshot + ${simplifiedDom.length} chars of DOM`);

      // Ask AI to find pagination element
      const result = await this.gemini.detectPaginationElement(
        screenshot,
        simplifiedDom,
        this.itemSelector
      );

      if (result.success && result.data) {
        return result.data;
      }

      console.error('[PaginationVerifier] AI detection returned error:', result.error);
      return null;
    } catch (error: any) {
      console.error('[PaginationVerifier] AI detection failed:', error.message);
      return null;
    }
  }

  /**
   * Get simplified DOM for AI analysis
   * Removes scripts, styles, and truncates text
   */
  private async getSimplifiedDom(): Promise<string> {
    return await this.page.evaluate(() => {
      // Clone body to avoid modifying the actual page
      const clone = document.body.cloneNode(true) as HTMLElement;

      // Remove noise elements
      const noiseSelectors = 'script, style, noscript, iframe, svg, link, meta, head';
      clone.querySelectorAll(noiseSelectors).forEach(el => el.remove());

      // Simplify: keep only relevant attributes
      const relevantAttrs = ['id', 'class', 'href', 'aria-label', 'data-testid', 'role', 'rel', 'type'];
      const simplify = (el: Element) => {
        Array.from(el.attributes).forEach(attr => {
          if (!relevantAttrs.includes(attr.name) && !attr.name.startsWith('data-')) {
            el.removeAttribute(attr.name);
          }
        });
        Array.from(el.children).forEach(child => simplify(child));
      };
      simplify(clone);

      // Truncate long text content
      const truncateText = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent?.trim() || '';
          if (text.length > 50) {
            node.textContent = text.slice(0, 50) + '...';
          }
        }
        node.childNodes.forEach(truncateText);
      };
      truncateText(clone);

      // Get HTML and limit size
      let html = clone.outerHTML;
      if (html.length > 100000) {
        html = html.slice(0, 100000) + '\n<!-- truncated -->';
      }

      return html;
    });
  }

  /**
   * Capture full page screenshot for AI
   */
  private async captureFullPageScreenshot(): Promise<string> {
    const buffer = await this.page.screenshot({ type: 'png', fullPage: true });
    return buffer.toString('base64');
  }

  /**
   * Test an AI-detected pagination candidate with verification
   */
  private async testAICandidate(candidate: PaginationCandidateResult): Promise<PaginationTestResult | null> {
    if (!candidate.selector) {
      return null;
    }

    const startTime = Date.now();

    try {
      // Capture before state
      const beforeUrl = this.page.url();
      const beforeScreenshot = await this.captureScreenshot();
      const beforeCount = await this.countProducts();

      // Click the candidate
      const clickSuccess = await this.clickElement(candidate.selector);
      if (!clickSuccess) {
        return {
          method: this.aiTypeToMethod(candidate.type),
          selector: candidate.selector,
          beforeScreenshot,
          afterScreenshot: beforeScreenshot,
          beforeProductCount: beforeCount,
          afterProductCount: beforeCount,
          beforeUrl,
          afterUrl: beforeUrl,
          verified: false,
          confidence: 0,
          error: 'Failed to click element',
          testDurationMs: Date.now() - startTime,
        };
      }

      // Wait for navigation or content change
      await this.waitForContentChange(beforeUrl);

      // Capture after state
      const afterUrl = this.page.url();
      const afterScreenshot = await this.captureScreenshot();
      const afterCount = await this.countProducts();

      // Verify with AI
      const methodDesc = this.getAIMethodDescription(candidate, beforeUrl, afterUrl);
      const verification = await this.verifyWithAI(
        beforeScreenshot,
        afterScreenshot,
        methodDesc
      );

      // Navigate back to original page if URL changed
      if (beforeUrl !== afterUrl) {
        await this.navigateBack(beforeUrl);
      }

      // Calculate confidence - trust AI more heavily
      const confidence = this.calculateConfidenceAI({
        aiVerification: verification,
        aiDetection: candidate,
        productDelta: afterCount - beforeCount,
        urlChanged: beforeUrl !== afterUrl,
      });

      return {
        method: this.aiTypeToMethod(candidate.type),
        selector: candidate.selector,
        beforeScreenshot,
        afterScreenshot,
        beforeProductCount: beforeCount,
        afterProductCount: afterCount,
        beforeUrl,
        afterUrl,
        verified: verification?.verified ?? false,
        confidence,
        aiVerification: verification ?? undefined,
        testDurationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error(`[PaginationVerifier] AI candidate test failed:`, error.message);
      return null;
    }
  }

  /**
   * Convert AI candidate type to method type
   */
  private aiTypeToMethod(type: PaginationCandidateType): PaginationMethodType {
    switch (type) {
      case 'next_button':
        return 'next_button';
      case 'load_more':
        return 'load_more';
      case 'page_number':
        return 'url_pattern';
      case 'infinite_scroll':
        return 'infinite_scroll';
      default:
        return 'next_button';
    }
  }

  /**
   * Get method description for AI verification
   */
  private getAIMethodDescription(
    candidate: PaginationCandidateResult,
    beforeUrl: string,
    afterUrl: string
  ): string {
    const parts: string[] = [];

    switch (candidate.type) {
      case 'next_button':
        parts.push('Clicked "Next" button to go to next page');
        break;
      case 'load_more':
        parts.push('Clicked "Load More" button to load additional products');
        break;
      case 'page_number':
        parts.push('Clicked page number to navigate to a different page');
        break;
    }

    parts.push(`AI reasoning: ${candidate.reasoning}`);

    if (beforeUrl !== afterUrl) {
      parts.push(`URL changed from ${beforeUrl} to ${afterUrl}`);
    }

    return parts.join('. ');
  }

  /**
   * Calculate confidence score with heavy trust on AI
   */
  private calculateConfidenceAI(params: {
    aiVerification: PaginationVerificationResult | null;
    aiDetection: PaginationCandidateResult;
    productDelta: number;
    urlChanged: boolean;
  }): number {
    // If AI verification says it worked, trust it heavily
    if (params.aiVerification?.verified) {
      // Base: AI verification confidence (0-1) weighted at 60%
      let score = params.aiVerification.confidence * 0.6;

      // Bonus for product count increase (20%)
      if (params.productDelta > 0) {
        score += 0.2 * Math.min(params.productDelta / 20, 1);
      } else if (params.aiVerification.productCountDelta > 0) {
        // Trust AI's count if our selector-based count failed
        score += 0.15;
      }

      // Bonus for URL change (real navigation) (10%)
      if (params.urlChanged) {
        score += 0.1;
      }

      // Bonus if AI detection was confident (10%)
      if (params.aiDetection.found) {
        score += 0.1;
      }

      return Math.min(score, 1);
    }

    // If AI verification failed but detection found something, low confidence
    if (params.aiDetection.found) {
      return 0.2;
    }

    return 0;
  }

  /**
   * Test infinite scroll with AI verification
   * IMPORTANT: Scrolls to the LAST product first, then scrolls past it to trigger loading
   */
  private async testInfiniteScroll(): Promise<PaginationTestResult | null> {
    const startTime = Date.now();

    try {
      // Store initial scroll position
      const initialScrollY = await this.page.evaluate(() => window.scrollY);

      // First, scroll to the LAST product element to ensure we're at the end of current content
      const lastProductPosition = await this.scrollToLastProduct();
      console.log(`[PaginationVerifier] Scrolled to last product at Y=${lastProductPosition}`);

      // Wait for any lazy-loaded images to settle
      await this.page.waitForTimeout(500);

      // Capture BEFORE state - at the bottom of current products
      const beforeUrl = this.page.url();
      const beforeScreenshot = await this.captureScreenshot();
      const beforeCount = await this.countProducts();
      console.log(`[PaginationVerifier] Before scroll: ${beforeCount} products`);

      // Now scroll PAST the last product to trigger infinite scroll loading
      await this.performScrollPastEnd();

      // Wait for content to potentially load (with networkidle)
      await this.waitForNewContent();

      // Capture AFTER state
      const afterUrl = this.page.url();
      const afterScreenshot = await this.captureScreenshot();
      const afterCount = await this.countProducts();
      console.log(`[PaginationVerifier] After scroll: ${afterCount} products (delta: ${afterCount - beforeCount})`);

      // Verify with AI - tell it we scrolled from end of products
      const verification = await this.verifyWithAI(
        beforeScreenshot,
        afterScreenshot,
        `Infinite scroll - scrolled past the last of ${beforeCount} products to load more. Product count went from ${beforeCount} to ${afterCount}.`
      );

      // Scroll back to original position
      await this.page.evaluate((y) => window.scrollTo(0, y), initialScrollY);
      await this.page.waitForTimeout(300);

      // Calculate confidence
      const productDelta = afterCount - beforeCount;
      const confidence = this.calculateConfidence({
        aiVerification: verification,
        productDelta,
        urlChanged: beforeUrl !== afterUrl,
        selector: undefined,
      });

      // For infinite scroll: verified ONLY if product count increased
      // AI might be wrong about "new products visible" if it's just scroll position change
      const actuallyVerified = productDelta > 0 && confidence >= 0.5;

      return {
        method: 'infinite_scroll',
        beforeScreenshot,
        afterScreenshot,
        beforeProductCount: beforeCount,
        afterProductCount: afterCount,
        beforeUrl,
        afterUrl,
        verified: actuallyVerified,
        confidence,
        aiVerification: verification ?? undefined,
        testDurationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error('[PaginationVerifier] Infinite scroll test failed:', error.message);
      return null;
    }
  }

  /**
   * Scroll to the last product element
   * Returns the Y position of the last product
   */
  private async scrollToLastProduct(): Promise<number> {
    return await this.page.evaluate((selector) => {
      const products = document.querySelectorAll(selector);
      if (products.length === 0) return 0;

      const lastProduct = products[products.length - 1];
      const rect = lastProduct.getBoundingClientRect();
      const absoluteY = window.scrollY + rect.bottom;

      // Scroll so the last product is at the top of the viewport
      window.scrollTo(0, absoluteY - window.innerHeight + 100);

      return absoluteY;
    }, this.itemSelector);
  }

  /**
   * Scroll past the end of current content to trigger infinite scroll
   */
  private async performScrollPastEnd(): Promise<void> {
    // Scroll in steps to simulate natural scrolling behavior
    for (let i = 0; i < 4; i++) {
      await this.page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.8);
      });
      await this.page.waitForTimeout(400);
    }
  }

  /**
   * Wait for new content to load after scrolling
   */
  private async waitForNewContent(): Promise<void> {
    try {
      // Wait for network to settle (indicates AJAX loading complete)
      await this.page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      // networkidle timeout is ok - content might already be loaded
    }

    // Additional wait for DOM updates
    await this.page.waitForTimeout(this.config.waitForContentMs);
  }

  /**
   * Capture a screenshot as base64
   */
  private async captureScreenshot(): Promise<string> {
    const buffer = await this.page.screenshot({ type: 'png', fullPage: false });
    return buffer.toString('base64');
  }

  /**
   * Count products on the page using itemSelector
   */
  private async countProducts(): Promise<number> {
    return await this.page.evaluate((selector) => {
      return document.querySelectorAll(selector).length;
    }, this.itemSelector);
  }

  /**
   * Click an element safely
   */
  private async clickElement(selector: string): Promise<boolean> {
    try {
      const element = await this.page.$(selector);
      if (!element) {
        console.log(`[PaginationVerifier] Element not found: ${selector}`);
        return false;
      }

      // Check if element is visible and clickable
      const isVisible = await element.isVisible();
      if (!isVisible) {
        console.log(`[PaginationVerifier] Element not visible: ${selector}`);
        return false;
      }

      // Scroll element into view
      await element.scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(200);

      // Click with retry
      await element.click({ timeout: 5000 });
      await this.page.waitForTimeout(this.config.clickDelay);

      return true;
    } catch (error: any) {
      console.error(`[PaginationVerifier] Click failed:`, error.message);
      return false;
    }
  }

  /**
   * Wait for content to change after click
   */
  private async waitForContentChange(originalUrl: string): Promise<void> {
    try {
      // Wait for either navigation or network idle
      await Promise.race([
        this.page.waitForURL((url) => url.href !== originalUrl, { timeout: 3000 }).catch(() => {}),
        this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}),
        this.page.waitForTimeout(this.config.waitForContentMs),
      ]);
    } catch {
      // Timeout is acceptable - content might load dynamically
    }
  }

  /**
   * Navigate back to original URL
   */
  private async navigateBack(originalUrl: string): Promise<void> {
    try {
      await this.page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await this.page.waitForTimeout(500);
    } catch (error: any) {
      console.error('[PaginationVerifier] Navigate back failed:', error.message);
    }
  }

  /**
   * Verify pagination with AI
   */
  private async verifyWithAI(
    beforeScreenshot: string,
    afterScreenshot: string,
    methodDescription: string
  ): Promise<PaginationVerificationResult | null> {
    if (!this.gemini.isEnabled) {
      console.log('[PaginationVerifier] AI not enabled, skipping verification');
      return null;
    }

    const result = await this.gemini.verifyPaginationWorked(
      beforeScreenshot,
      afterScreenshot,
      methodDescription
    );

    if (result.success && result.data) {
      return result.data;
    }

    console.error('[PaginationVerifier] AI verification failed:', result.error);
    return null;
  }

  /**
   * Calculate overall confidence score for infinite scroll
   * CRITICAL: For infinite scroll, product count MUST increase - no exceptions
   */
  private calculateConfidence(params: {
    aiVerification: PaginationVerificationResult | null;
    productDelta: number;
    urlChanged: boolean;
    selector?: string;
  }): number {
    // CRITICAL: For infinite scroll (no selector), product count MUST increase
    // If delta is 0 or negative, infinite scroll did NOT work - regardless of AI opinion
    if (!params.selector && params.productDelta <= 0) {
      console.log(`[PaginationVerifier] Infinite scroll REJECTED: product delta is ${params.productDelta} (must be > 0)`);
      return 0.1; // Very low confidence - did not work
    }

    // If AI verification says it worked AND we have evidence
    if (params.aiVerification?.verified) {
      // For infinite scroll: product delta is required
      if (!params.selector) {
        // Must have product delta for infinite scroll
        if (params.productDelta > 0) {
          // Good: AI verified + products increased
          let score = 0.6 + (0.3 * Math.min(params.productDelta / 20, 1));
          score += 0.1 * params.aiVerification.confidence;
          return Math.min(score, 1);
        } else {
          // AI is wrong - no new products loaded
          console.log('[PaginationVerifier] AI verified but product delta is 0 - rejecting');
          return 0.1;
        }
      }

      // For button clicks: trust AI more since URL might change
      let score = params.aiVerification.confidence * 0.6;

      if (params.productDelta > 0) {
        score += 0.2 * Math.min(params.productDelta / 20, 1);
      } else if (params.urlChanged) {
        // URL changed - might be a page navigation
        score += 0.15;
      }

      score += 0.1 * this.calculateSelectorStability(params.selector);
      return Math.min(score, 1);
    }

    // If AI said not verified, very low confidence
    if (params.aiVerification && !params.aiVerification.verified) {
      return 0.1;
    }

    // No AI verification available - use heuristics
    let score = 0.2;

    if (params.productDelta > 0) {
      score += 0.3 * Math.min(params.productDelta / 20, 1);
    }

    return Math.min(score, 0.5);
  }

  /**
   * Calculate selector stability score
   */
  private calculateSelectorStability(selector?: string): number {
    if (!selector) return 0.5; // Scroll has no selector, neutral score

    // Highest stability: ID or data attributes
    if (selector.includes('#') || selector.includes('[data-')) return 1.0;

    // High stability: aria-label or rel="next"
    if (selector.includes('[aria-label') || selector.includes('[rel="next"]')) return 0.9;

    // Medium stability: class-based without nth-child
    if (selector.match(/\.[a-z-]+/i) && !selector.includes(':nth')) return 0.7;

    // Low stability: nth-child selectors
    if (selector.includes(':nth-child') || selector.includes(':nth-of-type')) return 0.4;

    return 0.5;
  }
}
