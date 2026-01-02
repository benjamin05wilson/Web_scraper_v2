import { describe, test, expect } from 'vitest';
import {
  parsePrice,
  extractAllPrices,
  extractLowestPrice,
  extractHighestPrice,
  hasMultiplePrices,
  extractPricePair,
  detectCurrency,
  formatPrice,
} from '../utils/PriceParser.js';

describe('PriceParser', () => {
  describe('parsePrice', () => {
    test('parses GBP prices', () => {
      expect(parsePrice('£25.99')).toBe(25.99);
      expect(parsePrice('£1.00')).toBe(1);
      expect(parsePrice('£0.99')).toBe(0.99);
    });

    test('parses USD prices', () => {
      expect(parsePrice('$99.99')).toBe(99.99);
      expect(parsePrice('$1,234.56')).toBe(1234.56);
    });

    test('parses EUR prices with comma decimal', () => {
      expect(parsePrice('€19,99')).toBe(19.99);
      expect(parsePrice('€1.234,56')).toBe(1234.56);
    });

    test('parses prices with currency suffix', () => {
      expect(parsePrice('25.45 MAD')).toBe(25.45);
      expect(parsePrice('99.99 USD')).toBe(99.99);
    });

    test('parses prices with thousands separators', () => {
      expect(parsePrice('£1,234.56')).toBe(1234.56);
      expect(parsePrice('$10,000.00')).toBe(10000);
      expect(parsePrice('€1.234.567,89')).toBe(1234567.89);
    });

    test('parses prices without currency symbols', () => {
      expect(parsePrice('25.99')).toBe(25.99);
      expect(parsePrice('100')).toBe(100);
    });

    test('handles whitespace', () => {
      expect(parsePrice('  £25.99  ')).toBe(25.99);
      expect(parsePrice('£ 25.99')).toBe(25.99);
    });

    test('returns NaN for invalid input', () => {
      expect(parsePrice('')).toBeNaN();
      expect(parsePrice(null)).toBeNaN();
      expect(parsePrice(undefined)).toBeNaN();
      expect(parsePrice('abc')).toBeNaN();
    });

    test('handles edge cases', () => {
      expect(parsePrice('£0')).toBe(0);
      expect(parsePrice('£.99')).toBe(0.99);
    });
  });

  describe('detectCurrency', () => {
    test('detects currency symbols', () => {
      expect(detectCurrency('£25.99')).toBe('£');
      expect(detectCurrency('$99.99')).toBe('$');
      expect(detectCurrency('€19,99')).toBe('€');
      expect(detectCurrency('¥1000')).toBe('¥');
      expect(detectCurrency('₹500')).toBe('₹');
    });

    test('detects currency codes', () => {
      expect(detectCurrency('25.45 MAD')).toBe('MAD');
      expect(detectCurrency('99.99 USD')).toBe('USD');
      expect(detectCurrency('50 EUR')).toBe('EUR');
    });

    test('returns undefined for no currency', () => {
      expect(detectCurrency('25.99')).toBeUndefined();
    });
  });

  describe('extractAllPrices', () => {
    test('extracts single price', () => {
      const prices = extractAllPrices('Price: £25.99');
      expect(prices).toHaveLength(1);
      expect(prices[0].original).toBe('£25.99');
      expect(prices[0].value).toBe(25.99);
    });

    test('extracts multiple prices', () => {
      const prices = extractAllPrices('Was £50.00 Now £35.00');
      expect(prices).toHaveLength(2);
      expect(prices.map(p => p.value)).toContain(50);
      expect(prices.map(p => p.value)).toContain(35);
    });

    test('handles mixed formats', () => {
      const prices = extractAllPrices('US: $99.99, EU: €89,99');
      expect(prices).toHaveLength(2);
    });

    test('filters out zero and negative values', () => {
      const prices = extractAllPrices('£0.00 or £25.99');
      expect(prices).toHaveLength(1);
      expect(prices[0].value).toBe(25.99);
    });

    test('returns empty array for no prices', () => {
      expect(extractAllPrices('No price here')).toHaveLength(0);
      expect(extractAllPrices('')).toHaveLength(0);
      expect(extractAllPrices(null)).toHaveLength(0);
    });
  });

  describe('extractLowestPrice', () => {
    test('returns lowest from multiple prices', () => {
      expect(extractLowestPrice('Was £50 Now £35')).toBe('£35');
      expect(extractLowestPrice('$100 - $75 - $50')).toBe('$50');
    });

    test('returns single price', () => {
      expect(extractLowestPrice('£25.99')).toBe('£25.99');
    });

    test('returns trimmed text if no price found', () => {
      expect(extractLowestPrice('  No price  ')).toBe('No price');
    });

    test('handles empty/null input', () => {
      expect(extractLowestPrice('')).toBe('');
      expect(extractLowestPrice(null)).toBe('');
    });
  });

  describe('extractHighestPrice', () => {
    test('returns highest from multiple prices', () => {
      expect(extractHighestPrice('Was £50 Now £35')).toBe('£50');
      expect(extractHighestPrice('$100 - $75 - $50')).toBe('$100');
    });

    test('returns single price', () => {
      expect(extractHighestPrice('£25.99')).toBe('£25.99');
    });
  });

  describe('hasMultiplePrices', () => {
    test('returns true for multiple prices', () => {
      expect(hasMultiplePrices('Was £50 Now £35')).toBe(true);
      expect(hasMultiplePrices('$100 - $75')).toBe(true);
    });

    test('returns false for single price', () => {
      expect(hasMultiplePrices('£25.99')).toBe(false);
    });

    test('returns false for no prices', () => {
      expect(hasMultiplePrices('No price')).toBe(false);
      expect(hasMultiplePrices(null)).toBe(false);
    });
  });

  describe('extractPricePair', () => {
    test('extracts original and sale price', () => {
      const pair = extractPricePair('Was £50 Now £35');
      expect(pair).not.toBeNull();
      expect(pair!.original).toBe('£50');
      expect(pair!.sale).toBe('£35');
      expect(pair!.originalValue).toBe(50);
      expect(pair!.saleValue).toBe(35);
    });

    test('returns null for single price', () => {
      expect(extractPricePair('£25.99')).toBeNull();
    });

    test('returns null for no prices', () => {
      expect(extractPricePair('No price')).toBeNull();
      expect(extractPricePair(null)).toBeNull();
    });
  });

  describe('formatPrice', () => {
    test('formats with default currency', () => {
      expect(formatPrice(25.99)).toBe('£25.99');
      expect(formatPrice(100)).toBe('£100.00');
    });

    test('formats with specified currency', () => {
      expect(formatPrice(25.99, '$')).toBe('$25.99');
      expect(formatPrice(25.99, '€')).toBe('€25.99');
    });

    test('formats with suffix currency', () => {
      expect(formatPrice(25.99, 'MAD')).toBe('25.99 MAD');
    });

    test('returns empty string for NaN', () => {
      expect(formatPrice(NaN)).toBe('');
    });
  });
});
