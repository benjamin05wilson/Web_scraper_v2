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

  await page.goto('https://www.myer.com.au/c/home/bedding/quilt-covers', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Scroll to trigger lazy loading
  await page.evaluate(() => window.scrollBy(0, 500));

  const result = await page.evaluate(() => {
    // Find the product card container by going up from the product link
    const productLink = document.querySelector('a[data-automation="product-detail-link"]');
    if (!productLink) return { error: 'No product link found' };

    // Go up to find the card container
    let container = productLink.parentElement;
    while (container && !container.querySelector('.product-price')) {
      container = container.parentElement;
    }

    if (!container) return { error: 'No container with price found' };

    // Get the full card HTML
    return {
      containerTag: container.tagName,
      containerClasses: container.className,
      containerHtml: container.outerHTML.substring(0, 4000),
      title: container.querySelector('[data-automation="product-name"]')?.textContent?.trim(),
      price: container.querySelector('.product-price')?.textContent?.trim(),
      discountedPrice: container.querySelector('.discounted-price')?.textContent?.trim(),
      image: container.querySelector('img[data-automation="product-image"]')?.src,
      link: container.querySelector('a[data-automation="product-detail-link"]')?.href
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
