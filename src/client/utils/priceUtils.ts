// Price formatting utilities

export function formatPrice(price: number, currency?: string): string {
  const currencyCode = currency || 'USD';

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).format(price);
  } catch {
    // Fallback for unknown currencies
    return `${currencyCode} ${price.toFixed(2)}`;
  }
}

export function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;

  // Remove currency symbols and whitespace
  let cleaned = priceStr
    .replace(/[^\d.,\-]/g, '')
    .trim();

  if (!cleaned) return null;

  // Handle different number formats
  // Check if it uses comma as decimal separator (European style: 1.234,56)
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot) {
    // European format: replace dots (thousands) and comma (decimal)
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // US format: just remove commas (thousands)
    cleaned = cleaned.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // Only commas present - could be either
    // If there are 3 digits after comma, it's likely thousands separator
    const afterComma = cleaned.split(',')[1];
    if (afterComma && afterComma.length === 3) {
      cleaned = cleaned.replace(/,/g, '');
    } else {
      cleaned = cleaned.replace(',', '.');
    }
  }

  const value = parseFloat(cleaned);
  return isNaN(value) ? null : value;
}

export function extractCurrency(priceStr: string): string | null {
  if (!priceStr) return null;

  // Common currency symbols to codes
  const symbolMap: Record<string, string> = {
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',
    '₹': 'INR',
    '₽': 'RUB',
    '₩': 'KRW',
    'R$': 'BRL',
    'C$': 'CAD',
    'A$': 'AUD',
    'kr': 'SEK',
    'zł': 'PLN',
    '₺': 'TRY',
  };

  for (const [symbol, code] of Object.entries(symbolMap)) {
    if (priceStr.includes(symbol)) {
      return code;
    }
  }

  // Check for currency codes in the string
  const codeMatch = priceStr.match(/\b(USD|EUR|GBP|JPY|INR|CAD|AUD|CHF|CNY|HKD|SGD)\b/i);
  if (codeMatch) {
    return codeMatch[1].toUpperCase();
  }

  return null;
}

export function comparePrices(price1: number, price2: number): {
  difference: number;
  percentChange: number;
  isHigher: boolean;
  isLower: boolean;
} {
  const difference = price1 - price2;
  const percentChange = price2 !== 0 ? ((price1 - price2) / price2) * 100 : 0;

  return {
    difference,
    percentChange,
    isHigher: difference > 0,
    isLower: difference < 0,
  };
}

export function formatPercentChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
}

export function isValidPriceFormat(priceStr: string): boolean {
  const price = parsePrice(priceStr);
  return price !== null && price >= 0;
}
