import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  console.log('Navigating to beliani...');
  await page.goto('https://www.beliani.de/textiles/duvet-covers/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Check for cookie popup
  console.log('\n=== Checking for cookie popup ===');
  const cookiePopup = await page.evaluate(() => {
    const overlays = document.querySelectorAll('[class*="cookie"], [class*="consent"], [class*="popup"], [class*="modal"]');
    return Array.from(overlays).map(el => ({
      tag: el.tagName,
      class: el.className,
      visible: el.offsetWidth > 0 && el.offsetHeight > 0,
      text: el.textContent?.substring(0, 100)
    }));
  });
  console.log('Overlays found:', JSON.stringify(cookiePopup, null, 2));

  // Try to find and click any blocking overlay
  const clicked = await page.evaluate(() => {
    // Look for any clickable area that might dismiss a popup
    const clickTargets = document.querySelectorAll('button, [role="button"], .close, [class*="close"], [class*="dismiss"]');
    for (const el of clickTargets) {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        const text = el.textContent?.toLowerCase() || '';
        if (text.includes('accept') || text.includes('agree') || text.includes('ok') || text.includes('close')) {
          el.click();
          return el.textContent?.substring(0, 50);
        }
      }
    }
    return null;
  });
  if (clicked) console.log('Clicked:', clicked);
  await page.waitForTimeout(1000);

  // Scroll to load content
  console.log('\n=== Scrolling to load content ===');
  await page.evaluate(() => window.scrollBy(0, 2000));
  await page.waitForTimeout(2000);

  // Check item container
  console.log('\n=== Checking item container ===');
  const containerSelector = 'div.product-teaser.default_white_image';
  const containers = await page.$$(containerSelector);
  console.log(`Found ${containers.length} containers with selector: ${containerSelector}`);

  // Check alternative selectors
  const altSelectors = [
    'div.product-teaser',
    '[class*="product"]',
    '[class*="item"]',
    '.itemBox',
    'article'
  ];
  for (const sel of altSelectors) {
    const count = await page.$$(sel);
    console.log(`  ${sel}: ${count.length} elements`);
  }

  // Check title selector
  console.log('\n=== Checking selectors ===');
  const titleSel = 'span.title-line';
  const titles = await page.$$(titleSel);
  console.log(`Title (${titleSel}): ${titles.length} elements`);
  if (titles.length > 0) {
    const firstTitle = await titles[0].textContent();
    console.log(`  First title: "${firstTitle?.trim()}"`);
  }

  // Check price selector
  const priceSel = 'div.price-box-price-text > a > span';
  const prices = await page.$$(priceSel);
  console.log(`Price (${priceSel}): ${prices.length} elements`);
  if (prices.length > 0) {
    const firstPrice = await prices[0].textContent();
    console.log(`  First price: "${firstPrice?.trim()}"`);
  }

  // Check image selector
  const imgSel = 'img.white_image.cover_image';
  const images = await page.$$(imgSel);
  console.log(`Image (${imgSel}): ${images.length} elements`);

  // Check URL selector
  const urlSel = 'a.itemBox.loaded';
  const urls = await page.$$(urlSel);
  console.log(`URL (${urlSel}): ${urls.length} elements`);

  // Get page HTML snippet to understand structure
  console.log('\n=== First product card HTML ===');
  const firstProductHtml = await page.evaluate(() => {
    const product = document.querySelector('[class*="product"]');
    if (product) {
      return product.outerHTML.substring(0, 2000);
    }
    return 'No product found';
  });
  console.log(firstProductHtml);

  await browser.close();
})();
