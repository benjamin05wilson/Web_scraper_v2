// ============================================================================
// CLOUDFLARE BYPASS - Detection and Manual Solve Support
// ============================================================================

import type { Page, BrowserContext, Cookie } from 'playwright';

export type ChallengeType = 'none' | 'turnstile' | 'captcha' | 'interstitial' | 'blocked';

export interface CloudflareStatus {
  hasChallenge: boolean;
  challengeType: ChallengeType;
  hasClearance: boolean;
  clearanceExpiry: Date | null;
}

export class CloudflareBypass {
  constructor(private page: Page) {}

  /**
   * Detect if Cloudflare challenge is present on page
   */
  async detectChallenge(): Promise<ChallengeType> {
    try {
      const result = await this.page.evaluate(() => {
        const pageTitle = document.title.toLowerCase();
        const bodyText = document.body?.innerText?.toLowerCase() || '';
        const html = document.documentElement.innerHTML.toLowerCase();

        // Cloudflare "Just a moment" interstitial
        if (
          pageTitle.includes('just a moment') ||
          pageTitle.includes('attention required') ||
          bodyText.includes('checking your browser') ||
          bodyText.includes('ray id') ||
          document.querySelector('#challenge-running, #challenge-form, .cf-browser-verification')
        ) {
          // Check for Turnstile specifically
          if (
            document.querySelector('iframe[src*="challenges.cloudflare.com"]') ||
            document.querySelector('[data-turnstile-widget]') ||
            html.includes('turnstile')
          ) {
            return 'turnstile';
          }
          return 'interstitial';
        }

        // Generic CAPTCHA detection
        const captchaElements = document.querySelectorAll(
          '.g-recaptcha, [data-sitekey], .h-captcha, #captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'
        );
        for (const el of captchaElements) {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (
            rect.width > 50 &&
            rect.height > 50 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          ) {
            return 'captcha';
          }
        }

        // PerimeterX / HUMAN "Press & Hold" detection
        const hasPressHoldButton = Array.from(document.querySelectorAll('button')).some(
          (btn) => btn.textContent?.toLowerCase().includes('press') && btn.textContent?.toLowerCase().includes('hold')
        );
        if (
          bodyText.includes('press & hold') ||
          bodyText.includes('press and hold') ||
          bodyText.includes('confirm you are a human') ||
          bodyText.includes('before we continue') ||
          document.querySelector('[class*="challenge"]') ||
          document.querySelector('[id*="px-captcha"]') ||
          hasPressHoldButton
        ) {
          return 'captcha';
        }

        // Access denied / bot blocked
        if (
          bodyText.includes('access denied') ||
          (bodyText.includes('blocked') && bodyText.includes('bot')) ||
          pageTitle.includes('access denied') ||
          pageTitle.includes('robot') ||
          pageTitle.includes('blocked')
        ) {
          return 'blocked';
        }

        return 'none';
      });

      return result as ChallengeType;
    } catch (error) {
      console.error('[CloudflareBypass] Error detecting challenge:', error);
      return 'none';
    }
  }

  /**
   * Check if page has passed Cloudflare (no challenge present)
   */
  async isChallengePassed(): Promise<boolean> {
    const challenge = await this.detectChallenge();
    return challenge === 'none';
  }

  /**
   * Wait for user to manually solve the challenge
   * Returns true if challenge passed, false if timeout
   */
  async waitForManualSolve(timeoutMs = 120000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 1000;

    console.log('[CloudflareBypass] Waiting for manual challenge solve...');

    while (Date.now() - startTime < timeoutMs) {
      const passed = await this.isChallengePassed();
      if (passed) {
        console.log('[CloudflareBypass] Challenge solved successfully!');
        return true;
      }

      // Check if page navigated (challenge completed)
      const url = this.page.url();
      if (!url.includes('challenge') && !url.includes('cdn-cgi')) {
        // Give page a moment to finish loading
        await this.page.waitForTimeout(500);
        const stillPassed = await this.isChallengePassed();
        if (stillPassed) {
          console.log('[CloudflareBypass] Challenge solved (page navigated)');
          return true;
        }
      }

      await this.page.waitForTimeout(pollInterval);
    }

    console.log('[CloudflareBypass] Timeout waiting for challenge solve');
    return false;
  }

  /**
   * Wait for Cloudflare to auto-pass (some challenges auto-complete)
   */
  async waitForAutoPass(timeoutMs = 15000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      const challenge = await this.detectChallenge();
      if (challenge === 'none') {
        console.log('[CloudflareBypass] Challenge auto-passed');
        return true;
      }

      // Only wait for interstitial auto-pass, not for manual captchas
      if (challenge !== 'interstitial') {
        return false;
      }

      await this.page.waitForTimeout(pollInterval);
    }

    return false;
  }

  /**
   * Extract Cloudflare clearance cookies from context
   */
  async extractClearanceCookies(): Promise<Cookie[]> {
    const cookies = await this.page.context().cookies();
    return cookies.filter(
      (c) =>
        c.name === 'cf_clearance' ||
        c.name === '__cf_bm' ||
        c.name.startsWith('cf_') ||
        c.name.startsWith('__cf')
    );
  }

  /**
   * Get clearance cookie expiry time
   */
  async getClearanceExpiry(): Promise<Date | null> {
    const cookies = await this.extractClearanceCookies();
    const clearance = cookies.find((c) => c.name === 'cf_clearance');

    if (clearance && clearance.expires) {
      return new Date(clearance.expires * 1000);
    }

    return null;
  }

  /**
   * Check if we have valid clearance cookie
   */
  async hasClearance(): Promise<boolean> {
    const cookies = await this.extractClearanceCookies();
    const now = Date.now() / 1000;

    return cookies.some(
      (c) => c.name === 'cf_clearance' && (!c.expires || c.expires > now)
    );
  }

  /**
   * Get full Cloudflare status
   */
  async getStatus(): Promise<CloudflareStatus> {
    const [challengeType, hasClearance, clearanceExpiry] = await Promise.all([
      this.detectChallenge(),
      this.hasClearance(),
      this.getClearanceExpiry(),
    ]);

    return {
      hasChallenge: challengeType !== 'none',
      challengeType,
      hasClearance,
      clearanceExpiry,
    };
  }
}

/**
 * Inject cookies into a browser context before navigation
 */
export async function injectClearanceCookies(
  context: BrowserContext,
  cookies: Cookie[]
): Promise<void> {
  if (cookies.length === 0) {
    console.log('[CloudflareBypass] No cookies to inject');
    return;
  }

  // Filter expired cookies
  const now = Date.now() / 1000;
  const validCookies = cookies.filter((c) => !c.expires || c.expires > now);

  if (validCookies.length === 0) {
    console.log('[CloudflareBypass] All cookies have expired');
    return;
  }

  await context.addCookies(validCookies);
  console.log(`[CloudflareBypass] Injected ${validCookies.length} cookies`);
}

/**
 * Check if a URL is likely to be Cloudflare protected
 */
export function isLikelyProtected(url: string): boolean {
  // Known protected domains (Cloudflare, PerimeterX, etc.)
  const knownProtected = [
    'dunnesstores.com',
    'zalora.com',
    // Add more as discovered
  ];

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return knownProtected.some((d) => hostname.includes(d));
  } catch {
    return false;
  }
}
