// ============================================================================
// PRICE PARSER UTILITY
// ============================================================================
// Extracts and parses prices from text with support for multiple currencies
// and formats (comma/dot as decimal separator, currency symbols, etc.)

/**
 * Supported currency symbols and codes
 */
const CURRENCY_SYMBOLS = ['£', '$', '€', '¥', '₹', 'MAD', 'USD', 'EUR', 'GBP', 'JPY', 'INR'];

/**
 * Regex pattern for matching prices in various formats
 * Matches: £25.45, $99.99, €19,99, 25.45 MAD, 1,234.56, etc.
 */
const PRICE_REGEX = /[£$€¥₹]?\s*\d{1,3}(?:[,.]\d{3})*(?:[,.]\d{1,2})?(?:\s*(?:MAD|USD|EUR|GBP))?|\d{1,3}(?:[,.]\d{3})*(?:[,.]\d{1,2})?\s*[£$€¥₹]?(?:\s*(?:MAD|USD|EUR|GBP))?/gi;

/**
 * Parsed price with original string and numeric value
 */
export interface ParsedPrice {
  /** Original text as found in the DOM */
  original: string;
  /** Numeric value (NaN if parsing failed) */
  value: number;
  /** Detected currency symbol/code (if any) */
  currency?: string;
}

/**
 * Parse a price string into a numeric value
 * Handles various formats:
 * - £25.99 → 25.99
 * - €19,99 → 19.99 (European format)
 * - $1,234.56 → 1234.56
 * - 25.45 MAD → 25.45
 *
 * @param priceStr - The price string to parse
 * @returns Numeric value, or NaN if parsing fails
 */
export function parsePrice(priceStr: string | null | undefined): number {
  if (!priceStr) return NaN;

  // Remove currency symbols and whitespace
  let cleaned = priceStr
    .replace(/[£$€¥₹]/g, '')
    .replace(/\s*(MAD|USD|EUR|GBP|JPY|INR)\s*/gi, '')
    .trim();

  // Handle comma as decimal separator (European format)
  // If there's only one comma and it's followed by 1-2 digits at the end, treat as decimal
  const commaMatch = cleaned.match(/,(\d{1,2})$/);
  if (commaMatch) {
    cleaned = cleaned.replace(/,(\d{1,2})$/, '.$1');
  }

  // Remove remaining commas (thousands separators)
  cleaned = cleaned.replace(/,/g, '');

  // Handle multiple dots (keep only the last one as decimal)
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
  }

  return parseFloat(cleaned);
}

/**
 * Detect currency from a price string
 */
export function detectCurrency(priceStr: string): string | undefined {
  for (const symbol of CURRENCY_SYMBOLS) {
    if (priceStr.includes(symbol)) {
      return symbol;
    }
  }
  return undefined;
}

/**
 * Extract all prices from a text string
 *
 * @param text - Text containing one or more prices
 * @returns Array of parsed prices with original strings and values
 */
export function extractAllPrices(text: string | null | undefined): ParsedPrice[] {
  if (!text) return [];

  const matches = text.match(PRICE_REGEX);
  if (!matches || matches.length === 0) return [];

  return matches
    .map((match) => {
      const trimmed = match.trim();
      const value = parsePrice(trimmed);
      const currency = detectCurrency(trimmed);
      return { original: trimmed, value, currency };
    })
    .filter((p) => !isNaN(p.value) && p.value > 0);
}

/**
 * Extract the lowest price from text containing multiple prices
 * Useful for getting the current/sale price when both original and sale are shown
 *
 * @param text - Text containing prices (e.g., "Was £50 Now £35")
 * @returns The lowest price string, or the trimmed original text if no price found
 */
export function extractLowestPrice(text: string | null | undefined): string {
  if (!text) return '';

  const prices = extractAllPrices(text);

  if (prices.length === 0) {
    return text.trim();
  }

  // Sort by value ascending and return the lowest
  prices.sort((a, b) => a.value - b.value);
  return prices[0].original;
}

/**
 * Extract the highest price from text containing multiple prices
 * Useful for getting the original price when both original and sale are shown
 *
 * @param text - Text containing prices
 * @returns The highest price string, or the trimmed original text if no price found
 */
export function extractHighestPrice(text: string | null | undefined): string {
  if (!text) return '';

  const prices = extractAllPrices(text);

  if (prices.length === 0) {
    return text.trim();
  }

  // Sort by value descending and return the highest
  prices.sort((a, b) => b.value - a.value);
  return prices[0].original;
}

/**
 * Check if a text contains multiple prices (indicating a sale/discount)
 */
export function hasMultiplePrices(text: string | null | undefined): boolean {
  if (!text) return false;
  const prices = extractAllPrices(text);
  return prices.length > 1;
}

/**
 * Extract original and sale price from text
 * Returns { original, sale } where original >= sale
 *
 * @param text - Text containing prices
 * @returns Object with original and sale prices, or null if not found
 */
export function extractPricePair(text: string | null | undefined): {
  original: string;
  sale: string;
  originalValue: number;
  saleValue: number;
} | null {
  if (!text) return null;

  const prices = extractAllPrices(text);

  if (prices.length < 2) return null;

  // Sort by value descending
  prices.sort((a, b) => b.value - a.value);

  return {
    original: prices[0].original,
    sale: prices[prices.length - 1].original,
    originalValue: prices[0].value,
    saleValue: prices[prices.length - 1].value,
  };
}

/**
 * Format a price value with currency symbol
 */
export function formatPrice(value: number, currency: string = '£'): string {
  if (isNaN(value)) return '';

  const formatted = value.toFixed(2);

  // Put currency before or after based on convention
  const suffixCurrencies = ['MAD'];
  if (suffixCurrencies.includes(currency)) {
    return `${formatted} ${currency}`;
  }

  return `${currency}${formatted}`;
}

/**
 * Browser-compatible version of price parsing for injection into page
 * Returns a self-contained function string that can be evaluated in browser context
 */
export function getBrowserPriceParserScript(): string {
  return `
    (function() {
      function parsePrice(priceStr) {
        if (!priceStr) return NaN;
        var cleaned = priceStr
          .replace(/[£$€¥₹]/g, '')
          .replace(/\\s*(MAD|USD|EUR|GBP|JPY|INR)\\s*/gi, '')
          .trim();
        var commaMatch = cleaned.match(/,(\\d{1,2})$/);
        if (commaMatch) {
          cleaned = cleaned.replace(/,(\\d{1,2})$/, '.$1');
        }
        cleaned = cleaned.replace(/,/g, '');
        var parts = cleaned.split('.');
        if (parts.length > 2) {
          cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
        }
        return parseFloat(cleaned);
      }

      function extractAllPrices(text) {
        if (!text) return [];
        var priceRegex = /[£$€¥₹]?\\s*\\d{1,3}(?:[,.]\\d{3})*(?:[,.]\\d{1,2})?(?:\\s*(?:MAD|USD|EUR|GBP))?|\\d{1,3}(?:[,.]\\d{3})*(?:[,.]\\d{1,2})?\\s*[£$€¥₹]?(?:\\s*(?:MAD|USD|EUR|GBP))?/gi;
        var matches = text.match(priceRegex);
        if (!matches || matches.length === 0) return [];
        return matches
          .map(function(m) {
            var trimmed = m.trim();
            return { original: trimmed, value: parsePrice(trimmed) };
          })
          .filter(function(p) { return !isNaN(p.value) && p.value > 0; });
      }

      function extractLowestPrice(text) {
        if (!text) return '';
        var prices = extractAllPrices(text);
        if (prices.length === 0) return text.trim();
        prices.sort(function(a, b) { return a.value - b.value; });
        return prices[0].original;
      }

      return {
        parsePrice: parsePrice,
        extractAllPrices: extractAllPrices,
        extractLowestPrice: extractLowestPrice
      };
    })()
  `;
}
