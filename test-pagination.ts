/**
 * Test script for AI pagination detection
 * Run with: npx tsx test-pagination.ts
 */

import { chromium } from 'playwright';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testPagination() {
  const url = 'https://www.otto.de/heimtextilien/bettwaesche/';

  console.log('='.repeat(80));
  console.log('AI PAGINATION TEST');
  console.log('='.repeat(80));
  console.log(`URL: ${url}`);
  console.log(`GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'Set (' + process.env.GEMINI_API_KEY.substring(0, 10) + '...)' : 'NOT SET'}`);
  console.log('='.repeat(80));

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  try {
    console.log('\n[1] Navigating to page...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('    Page loaded (DOM ready)');

    // Wait for dynamic content to load
    await page.waitForTimeout(5000);
    console.log('    Waited for dynamic content');

    // Handle cookie consent if present
    console.log('\n[2] Checking for cookie consent...');
    try {
      const cookieButton = await page.$('[class*="cookie"] button, [class*="consent"] button, #onetrust-accept-btn-handler');
      if (cookieButton && await cookieButton.isVisible()) {
        await cookieButton.click();
        console.log('    Cookie consent accepted');
        await page.waitForTimeout(1000);
      } else {
        console.log('    No cookie consent found');
      }
    } catch (e) {
      console.log('    Cookie handling error:', e);
    }

    // Import and test the PaginationDetector
    console.log('\n[3] Testing AI Pagination Detection...');

    // Dynamically import after env is loaded
    const { PaginationDetector } = await import('./src/server/scraper/PaginationDetector.js');
    const { getGeminiService } = await import('./src/server/ai/GeminiService.js');

    const gemini = getGeminiService();
    console.log(`    Gemini enabled: ${gemini.isEnabled}`);

    const detector = new PaginationDetector(page);

    // First, let's manually check what links are on the page
    console.log('\n[4] Analyzing page links...');
    const pageLinks = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href]');
      const paginationLinks: any[] = [];

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const text = link.textContent?.trim().substring(0, 30) || '';
        const rect = link.getBoundingClientRect();

        // Look for pagination patterns
        if (href.includes('page') || href.includes('p=') || href.includes('offset') ||
            href.includes('o=') || text.match(/^[0-9]+$/) || text === '>' || text === '→' ||
            text.toLowerCase().includes('next') || text.toLowerCase().includes('weiter')) {

          if (rect.width > 0 && rect.height > 0) {
            const classStr = typeof link.className === 'string' ? link.className : '';
            paginationLinks.push({
              href: href.substring(0, 100),
              text,
              classes: classStr.substring(0, 50),
              size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
              position: `(${Math.round(rect.left)}, ${Math.round(rect.top)})`
            });
          }
        }
      }

      return paginationLinks.slice(0, 20); // Limit to 20
    });

    console.log(`    Found ${pageLinks.length} potential pagination links:`);
    for (const link of pageLinks) {
      console.log(`    - "${link.text}" -> ${link.href}`);
      console.log(`      classes: ${link.classes}, size: ${link.size}, pos: ${link.position}`);
    }

    // Now run AI detection
    console.log('\n[5] Running AI-enhanced pagination detection...');
    const startTime = Date.now();

    const result = await detector.detectBestMethodWithAI();

    const elapsed = Date.now() - startTime;
    console.log(`\n[6] Detection Results (${elapsed}ms):`);
    console.log('    Method:', result.method);
    console.log('    Source:', result.source);

    if (result.pagination) {
      console.log('    Pagination:');
      console.log('      Selector:', result.pagination.selector);
      console.log('      Type:', result.pagination.type);
      console.log('      Products loaded:', result.pagination.productsLoaded);
      if (result.pagination.offset) {
        console.log('      Offset:', JSON.stringify(result.pagination.offset));
      }
    }

    if (result.scroll) {
      console.log('    Scroll:');
      console.log('      Products loaded:', result.scroll.productsLoaded);
    }

    console.log('    Candidates:', result.candidates.length);
    for (const c of result.candidates.slice(0, 5)) {
      console.log(`      - ${c.selector} (score: ${c.score}, type: ${c.type})`);
    }

    // If we got a selector, test clicking it
    if (result.pagination?.selector) {
      console.log('\n[7] Testing pagination click...');
      try {
        const element = await page.$(result.pagination.selector);
        if (element) {
          const isVisible = await element.isVisible();
          const box = await element.boundingBox();
          console.log(`    Element found: visible=${isVisible}, box=${JSON.stringify(box)}`);

          if (isVisible && box) {
            console.log('    Clicking element...');
            await element.click();
            await page.waitForTimeout(3000);
            console.log('    Click successful! New URL:', page.url());
          }
        } else {
          console.log('    Element not found with selector:', result.pagination.selector);
        }
      } catch (e) {
        console.log('    Click error:', e);
      }
    }

    console.log('\n[8] Test complete. Browser will stay open for inspection.');
    console.log('    Press Ctrl+C to close.');

    // Keep browser open
    await new Promise(() => {});

  } catch (error) {
    console.error('\nError:', error);
    await browser.close();
    process.exit(1);
  }
}

testPagination().catch(console.error);
