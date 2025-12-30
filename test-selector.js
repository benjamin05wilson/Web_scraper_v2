// Test script to check if the selector works on Dunelm
// Run with: node test-selector.js

import { chromium } from 'playwright';

async function testSelector() {
  const url = 'https://www.dunelm.com/category/home-and-furniture/bedding/100-cotton-bedding';
  const containerSelector = 'article';

  console.log('='.repeat(60));
  console.log('Testing selector on Dunelm');
  console.log('='.repeat(60));
  console.log('URL:', url);
  console.log('Selector (escaped):', containerSelector);
  console.log('');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('Navigating to page...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // Wait for JS to render

    // Test 1: Try the escaped selector directly
    console.log('\n--- Test 1: Direct querySelector with escaped selector ---');
    const test1 = await page.evaluate((sel) => {
      try {
        const elements = document.querySelectorAll(sel);
        return { success: true, count: elements.length };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }, containerSelector);
    console.log('Result:', test1);

    // Test 2: Try unescaped selector (should fail)
    console.log('\n--- Test 2: Direct querySelector with unescaped selector ---');
    const unescapedSelector = 'div.@container/card.flex.flex-col';
    const test2 = await page.evaluate((sel) => {
      try {
        const elements = document.querySelectorAll(sel);
        return { success: true, count: elements.length };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }, unescapedSelector);
    console.log('Result:', test2);

    // Test 3: Find all divs and check their classes
    console.log('\n--- Test 3: Find divs with @container/card class ---');
    const test3 = await page.evaluate(() => {
      const divs = document.querySelectorAll('div');
      const matching = [];
      const classesWithAt = new Set();

      for (const div of divs) {
        for (const cls of div.classList) {
          if (cls.includes('@') || cls.includes('/')) {
            classesWithAt.add(cls);
          }
          if (cls === '@container/card') {
            matching.push({
              classes: Array.from(div.classList).slice(0, 5),
              hasFlexCol: div.classList.contains('flex-col')
            });
            if (matching.length >= 3) break;
          }
        }
        if (matching.length >= 3) break;
      }

      return {
        matchingDivs: matching.length,
        sampleMatches: matching,
        uniqueSpecialClasses: Array.from(classesWithAt).slice(0, 10)
      };
    });
    console.log('Divs with @container/card:', test3.matchingDivs);
    console.log('Special classes found:', test3.uniqueSpecialClasses);
    console.log('Sample matches:', JSON.stringify(test3.sampleMatches, null, 2));

    // Test 4: Class-based matching (what the scraper should do)
    console.log('\n--- Test 4: Class-based matching ---');
    const test4 = await page.evaluate(() => {
      const targetClasses = ['@container/card', 'flex', 'flex-col'];
      const divs = document.querySelectorAll('div');
      let matchCount = 0;

      for (const div of divs) {
        const hasAll = targetClasses.every(cls => div.classList.contains(cls));
        if (hasAll) matchCount++;
      }

      return { matchCount, targetClasses };
    });
    console.log('Containers matching all classes:', test4.matchCount);

    // Test 5: Simulate the exact extraction that DOMInspector does
    console.log('\n--- Test 5: Simulated extraction from article ---');
    const test5 = await page.evaluate(() => {
      const container = document.querySelector('article');
      if (!container) return { error: 'No article found' };

      const extracted = [];
      const seen = {};

      function addItem(item) {
        const key = item.type + ':' + item.value;
        if (!seen[key] && item.value.trim().length > 0) {
          seen[key] = true;
          extracted.push(item);
        }
      }

      // Extract all links (same as DOMInspector)
      const links = container.querySelectorAll('a[href]');
      console.log('Found links:', links.length);
      links.forEach(function(link) {
        const href = link.getAttribute('href');
        console.log('Link href:', href);
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          let fullUrl = href;
          try {
            fullUrl = new URL(href, window.location.href).href;
          } catch (e) {
            fullUrl = href;
          }

          addItem({
            type: 'link',
            value: fullUrl,
            selector: 'a',
            displayText: fullUrl.length > 60 ? fullUrl.substring(0, 60) + '...' : fullUrl,
            tagName: 'a'
          });
        }
      });

      // Extract text from h3, h4
      const h3 = container.querySelector('h3');
      const h4 = container.querySelector('h4');
      if (h3) {
        addItem({
          type: 'text',
          value: h3.textContent?.trim() || '',
          selector: 'h3',
          displayText: h3.textContent?.trim() || '',
          tagName: 'h3'
        });
      }
      if (h4) {
        addItem({
          type: 'text',
          value: h4.textContent?.trim() || '',
          selector: 'h4',
          displayText: h4.textContent?.trim() || '',
          tagName: 'h4'
        });
      }

      // Extract images
      const images = container.querySelectorAll('img[src]');
      images.forEach(function(img) {
        const src = img.getAttribute('src');
        if (src) {
          let fullUrl = src;
          try {
            fullUrl = new URL(src, window.location.href).href;
          } catch (e) {}
          addItem({
            type: 'image',
            value: fullUrl,
            selector: 'img',
            displayText: img.getAttribute('alt') || 'image',
            tagName: 'img'
          });
        }
      });

      return {
        totalExtracted: extracted.length,
        items: extracted
      };
    });
    console.log('Extracted items:', JSON.stringify(test5, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('Test complete. Browser will stay open for inspection.');
    console.log('Press Ctrl+C to close.');
    console.log('='.repeat(60));

    // Keep browser open for manual inspection
    await page.waitForTimeout(60000);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

testSelector().catch(console.error);
