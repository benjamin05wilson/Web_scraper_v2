// ============================================================================
// NEXT URL SCRAPER - HTTP-based scraping for Next (brand) product pages
// ============================================================================

import https from 'https';
import http from 'http';

// Product info tuple (matches old Python implementation)
export interface NextProductInfo {
  'Next URL': string;
  'Next Division': string;
  'Next Category': string;
  Brand: string;
  PageURL: string;
  PageNum: number;
  Anchor: string;
  ProductTitle: string;
  ProductPrice: string;
  'Current Price': number | string;
  Currency: string;
}

export interface NextUrlInput {
  key?: string;
  url?: string;
  sourceUrl?: string;
  'Source URL'?: string;
  nextUrl?: string;
  'Next URL'?: string;
  division?: string;
  Division?: string;
  category?: string;
  Category?: string;
}

// Scraping configuration
const PRODUCT_LIMIT_PER_URL = 100;
const TIMEOUT = 15000;
const MAX_CONCURRENT_REQUESTS = 5;

const HEADERS = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'content-type': 'text/plain;charset=UTF-8',
  origin: 'https://www.next.co.uk',
  referer: 'https://www.next.co.uk/',
  'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
};

const NO_RESULTS_HTML = '<div data-testid="plp-no-results-container"';
const BLOCKED_STATUS_CODES = [403, 429];

// Semaphore for concurrent request limiting
class Semaphore {
  private queue: (() => void)[] = [];
  private current = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}

const pageSemaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);

// Extract currency from price string
function extractCurrency(priceStr: string): string {
  if (!priceStr || priceStr.trim().toUpperCase() === 'N/A') {
    return 'N/A';
  }
  const match = priceStr.match(/([£$€])/);
  return match ? match[1] : 'N/A';
}

// Calculate current price from price string
function calculateCurrentPrice(priceStr: string): number | string {
  if (!priceStr || priceStr.trim().toUpperCase() === 'N/A') {
    return 'N/A';
  }

  let cleanStr = priceStr.trim();

  // Handle European vs US/UK number formats
  if (cleanStr.includes('.') && cleanStr.includes(',')) {
    if (cleanStr.lastIndexOf(',') > cleanStr.lastIndexOf('.')) {
      cleanStr = cleanStr.replace(/\./g, '').replace(',', '.');
    } else {
      cleanStr = cleanStr.replace(/,/g, '');
    }
  } else if (cleanStr.includes(',')) {
    if (/,(\d{1,2})\b/.test(cleanStr)) {
      const parts = cleanStr.split(',');
      cleanStr = parts.slice(0, -1).join('').replace(/,/g, '') + '.' + parts[parts.length - 1];
    } else {
      cleanStr = cleanStr.replace(/,/g, '');
    }
  }

  const numbers = cleanStr.match(/\d+\.?\d*/g);
  if (!numbers) {
    return 'N/A';
  }

  try {
    const floatNumbers = numbers.map((n) => parseFloat(n));
    if (floatNumbers.length > 1) {
      return floatNumbers.reduce((a, b) => a + b, 0) / floatNumbers.length;
    }
    return floatNumbers[0];
  } catch {
    return 'N/A';
  }
}

// Fetch page content
async function getPageContent(url: string): Promise<{ html: string | null; hash: string | null }> {
  await pageSemaphore.acquire();

  try {
    return await new Promise((resolve) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const req = client.request(
        url,
        {
          method: 'GET',
          headers: HEADERS,
          timeout: TIMEOUT,
          rejectUnauthorized: false,
        },
        (res) => {
          if (res.statusCode && BLOCKED_STATUS_CODES.includes(res.statusCode)) {
            console.log(`[BLOCKED:${res.statusCode}] URL: ${url}`);
            resolve({ html: null, hash: null });
            return;
          }

          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            // Simple hash using string length + first 100 chars
            const hash = `${data.length}_${data.substring(0, 100)}`;
            resolve({ html: data, hash });
          });
        }
      );

      req.on('error', (err) => {
        console.error(`[ERROR] URL ${url}: ${err.message}`);
        resolve({ html: null, hash: null });
      });

      req.on('timeout', () => {
        console.error(`[TIMEOUT] URL: ${url}`);
        req.destroy();
        resolve({ html: null, hash: null });
      });

      req.end();
    });
  } finally {
    pageSemaphore.release();
  }
}

// Parse product items from HTML (simple regex-based parsing)
function parseProductItems(html: string): Array<{ title: string; price: string }> {
  const products: Array<{ title: string; price: string }> = [];

  // Find product grid items
  const productRegex = /<div[^>]*data-testid="plp-product-grid-item"[^>]*>([\s\S]*?)(?=<div[^>]*data-testid="plp-product-grid-item"|$)/gi;
  let match;

  while ((match = productRegex.exec(html)) !== null) {
    const itemHtml = match[1];

    // Extract title
    const titleMatch = itemHtml.match(/<p[^>]*data-testid="product_summary_title"[^>]*>([^<]*)<\/p>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'N/A';

    // Extract price - look for was_price container first, then span inside
    let price = 'N/A';
    const priceContainerMatch = itemHtml.match(/<p[^>]*data-testid="product_summary_was_price"[^>]*>([\s\S]*?)<\/p>/i);
    if (priceContainerMatch) {
      const spanMatch = priceContainerMatch[1].match(/<span[^>]*>([^<]*)<\/span>/i);
      if (spanMatch) {
        price = spanMatch[1].trim().replace(/\u00a0/g, ' ');
      }
    }

    if (title !== 'N/A' || price !== 'N/A') {
      products.push({ title, price });
    }
  }

  return products;
}

// Process a single category page with pagination
async function processCategoryPage(inputData: {
  key: string;
  url: string;
  division: string;
  category: string;
}): Promise<NextProductInfo[]> {
  const { key, url, division, category } = inputData;
  const logKey = key || url;

  console.log(`\n--- [${logKey}] Processing URL: ${url} ---`);

  const localProductData: NextProductInfo[] = [];
  let pageNumber = 1;
  let firstPageHash: string | null = null;
  let stopPagination = false;

  while (localProductData.length < PRODUCT_LIMIT_PER_URL && !stopPagination) {
    const paginatedUrl = `${url}?p=${pageNumber}`;

    console.log(
      `[${logKey}] Requesting Page ${pageNumber} (Found ${localProductData.length}/${PRODUCT_LIMIT_PER_URL} products)...`
    );

    const { html, hash } = await getPageContent(paginatedUrl);

    if (!html || !hash) {
      console.log(`[${logKey}] Stopping pagination: block/error on page ${pageNumber}.`);
      stopPagination = true;
      continue;
    }

    if (html.includes(NO_RESULTS_HTML)) {
      console.log(`[${logKey}] No more results found. Stopping.`);
      stopPagination = true;
      continue;
    }

    if (pageNumber === 1) {
      firstPageHash = hash;
    } else if (firstPageHash && hash === firstPageHash) {
      console.log(`[${logKey}] Cycle detected on page ${pageNumber}. Stopping.`);
      stopPagination = true;
      continue;
    }

    const products = parseProductItems(html);

    if (products.length === 0 && pageNumber > 1) {
      console.log(`[${logKey}] No products found on page ${pageNumber}. Stopping.`);
      stopPagination = true;
      continue;
    }

    for (const product of products) {
      if (localProductData.length >= PRODUCT_LIMIT_PER_URL) {
        break;
      }

      const currency = extractCurrency(product.price);
      const currentPrice = calculateCurrentPrice(product.price);

      localProductData.push({
        'Next URL': key,
        'Next Division': division,
        'Next Category': category,
        Brand: 'Next',
        PageURL: paginatedUrl,
        PageNum: pageNumber,
        Anchor: '',
        ProductTitle: product.title,
        ProductPrice: product.price,
        'Current Price': currentPrice,
        Currency: currency,
      });
    }

    console.log(`[${logKey}] Page ${pageNumber}: Found ${products.length} products.`);
    pageNumber++;
  }

  if (localProductData.length >= PRODUCT_LIMIT_PER_URL) {
    console.log(`--- [${logKey}] Finished processing. Reached product limit (${localProductData.length} found). ---`);
  } else {
    console.log(`--- [${logKey}] Finished processing. No more products found (${localProductData.length} total). ---`);
  }

  return localProductData;
}

// Main function to scrape Next URLs from a list
export async function scrapeNextUrlsFromList(urlsData: NextUrlInput[]): Promise<NextProductInfo[]> {
  console.log(`\n${'='.repeat(20)}\n[START] Processing ${urlsData.length} URLs\n${'='.repeat(20)}`);

  // Normalize URLs data to match expected format
  const urlsToProcess: Array<{ key: string; url: string; division: string; category: string }> = [];

  for (const item of urlsData) {
    const url = item.url || item.sourceUrl || item['Source URL'] || '';
    const key = item.key || item.nextUrl || item['Next URL'] || 'N/A';
    const division = item.division || item.Division || 'N/A';
    const category = item.category || item.Category || 'N/A';

    if (url) {
      urlsToProcess.push({
        key: String(key).trim() || 'N/A',
        url: String(url).trim(),
        division: String(division).trim() || 'N/A',
        category: String(category).trim() || 'N/A',
      });
    }
  }

  if (urlsToProcess.length === 0) {
    console.log('No valid URLs to process.');
    return [];
  }

  const allProductData: NextProductInfo[] = [];

  // Process URLs sequentially to avoid overwhelming the server
  for (const itemData of urlsToProcess) {
    try {
      const results = await processCategoryPage(itemData);
      allProductData.push(...results);
      console.log(`Collected ${results.length} results from '${itemData.key}'.`);
    } catch (error) {
      console.error(`[TASK_ERROR] Processing '${itemData.key}' failed:`, error);
    }
  }

  console.log(`\n--- Scraping complete. Total products: ${allProductData.length} ---`);
  return allProductData;
}
