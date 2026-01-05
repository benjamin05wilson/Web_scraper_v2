import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.beliani.de/textiles/duvet-covers/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Find buttons in cookie popup
  const buttons = await page.evaluate(() => {
    const popup = document.querySelector('.cookies_popup');
    if (popup === null) return 'No popup';
    const btns = popup.querySelectorAll('button, a, [role="button"], span[onclick], div[onclick]');
    return Array.from(btns).map(b => ({
      tag: b.tagName,
      class: b.className,
      text: b.textContent?.trim().substring(0, 80),
      visible: b.offsetWidth > 0,
      onclick: b.getAttribute('onclick')?.substring(0, 50)
    }));
  });
  console.log('Buttons in cookie popup:', JSON.stringify(buttons, null, 2));

  // Get the full popup HTML
  const popupHtml = await page.evaluate(() => {
    const popup = document.querySelector('.cookies_popup');
    return popup ? popup.innerHTML.substring(0, 3000) : 'No popup';
  });
  console.log('\nPopup HTML:\n', popupHtml);

  await browser.close();
})();
