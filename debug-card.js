import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://www.marksandspencer.com/l/women/knitwear/cardigans');
  await page.waitForTimeout(3000);

  // Get the first product card and examine its structure
  const cardHtml = await page.evaluate(() => {
    const card = document.querySelector('a.product-card_cardWrapper__GVSTY[href]');
    if (!card) return 'No card found';

    // Try different price selectors
    const priceSelectors = [
      'span:nth-of-type(3)',
      'span.price_singlePrice__hTG4o',
      '[class*="price"]',
      '[class*="Price"]',
      'span[class*="price"]',
    ];

    const results = priceSelectors.map(sel => {
      const el = card.querySelector(sel);
      return {
        selector: sel,
        found: !!el,
        text: el ? el.textContent?.trim() : null
      };
    });

    // Also get HTML structure
    return JSON.stringify({
      priceTests: results,
      cardHtml: card.innerHTML.substring(0, 1000)
    }, null, 2);
  });

  console.log(cardHtml);
  await browser.close();
})();
