// Domain extraction utilities

export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove www. prefix for consistent matching
    return urlObj.hostname.replace(/^www\./i, '');
  } catch {
    // Try to extract from malformed URL
    const match = url.match(/^(?:https?:\/\/)?([^\/]+)/i);
    const hostname = match ? match[1] : url;
    return hostname.replace(/^www\./i, '');
  }
}

export function extractBaseDomain(url: string): string {
  const hostname = extractDomain(url);
  // Remove www. prefix
  const withoutWww = hostname.replace(/^www\./i, '');
  // Get the last two parts (domain.tld)
  const parts = withoutWww.split('.');
  if (parts.length >= 2) {
    // Handle special cases like .co.uk, .com.au
    const commonSlds = ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'];
    if (parts.length >= 3 && commonSlds.includes(parts[parts.length - 2])) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }
  return withoutWww;
}

export function extractDomainWithRegion(url: string): string {
  const domain = extractBaseDomain(url);
  // Extract region from TLD if present (e.g., .uk, .de, .fr)
  const parts = domain.split('.');
  const tld = parts[parts.length - 1];

  // Common country TLDs
  const countryTlds: Record<string, string> = {
    uk: 'UK',
    de: 'Germany',
    fr: 'France',
    es: 'Spain',
    it: 'Italy',
    nl: 'Netherlands',
    be: 'Belgium',
    au: 'Australia',
    ca: 'Canada',
    jp: 'Japan',
    cn: 'China',
    kr: 'Korea',
    in: 'India',
    br: 'Brazil',
    mx: 'Mexico',
  };

  if (countryTlds[tld]) {
    return `${domain} (${countryTlds[tld]})`;
  }
  return domain;
}

export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove trailing slash
    let normalized = urlObj.origin + urlObj.pathname.replace(/\/$/, '');
    // Add query string if present
    if (urlObj.search) {
      normalized += urlObj.search;
    }
    return normalized;
  } catch {
    return url;
  }
}

export function getPathFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname + urlObj.search;
  } catch {
    return url;
  }
}
