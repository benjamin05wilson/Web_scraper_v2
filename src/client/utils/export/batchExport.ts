// ============================================================================
// BATCH EXPORT UTILITY - ZIP with CSVs and Excel Analysis
// ============================================================================

import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import type { BatchJob } from '../../../shared/types';

// Result types for batch export
export interface CompetitorPricingResult extends Record<string, unknown> {
  'Item Name': string;
  'Brand': string;
  price: string;
  'Product URL': string;
  'Source URL': string;
  Category: string;
  Country: string;
  Domain: string;
  'Competitor Type': string;
  'Next URL': string;
  'Next Division': string;
  'Next Category': string;
}

export interface NextPricingResult extends Record<string, unknown> {
  'Next URL': string;
  'Next Division': string;
  'Next Category': string;
  Brand: string;
  PageURL: string;
  PageNum: number | string;
  Anchor: string;
  ProductTitle: string;
  ProductPrice: string;
  'Current Price': number | string;
  Currency: string;
}

interface PricingStats {
  mean: number;
  median: number;
  mode: number;
}

interface CategoryDomainData {
  prices: number[];
  competitorType: string;
}

interface PricingAnalysis {
  averages: Record<string, Record<string, PricingStats & { competitorType: string; count: number }>>;
  comparison: Record<string, {
    competitors: Record<string, { avgPrice: number; nextVsComp: number; competitorType: string; count: number }>;
    global: { avgPrice: number; count: number; nextVsComp: number };
    local: { avgPrice: number; count: number; nextVsComp: number };
    nextAvgPrice: number;
  }>;
  nextUrlByCategory: Record<string, { url: string; stats: PricingStats }>;
}

// Helper to extract domain from URL
export function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace('www.', '');
  } catch {
    return 'invalid-url';
  }
}

// Create RFC 4180 compliant CSV content
function createCsvContent<T extends Record<string, unknown>>(
  headers: string[],
  rows: T[],
  brandFromSourceUrl = false
): string {
  const csvRows: string[] = [];
  csvRows.push(headers.join(','));

  rows.forEach((row) => {
    const values = headers.map((header) => {
      let val: string;
      if (brandFromSourceUrl && header === 'Brand') {
        const sourceUrl = String(row['Source URL'] || '');
        val = getDomain(sourceUrl);
      } else {
        val = row[header] != null ? String(row[header]) : '';
      }
      val = val.replace(/"/g, '""');
      if (val.includes(',') || val.includes('\n') || val.includes('"')) {
        val = `"${val}"`;
      }
      return val;
    });
    csvRows.push(values.join(','));
  });

  return csvRows.join('\n');
}

// Calculate statistics (mean, median, mode)
function calcStats(prices: number[]): PricingStats {
  if (!prices || prices.length === 0) return { mean: 0, median: 0, mode: 0 };

  const sorted = [...prices].sort((a, b) => a - b);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

  // Mode - most frequent value
  const freq: Record<number, number> = {};
  let maxFreq = 0;
  let mode = sorted[0] || 0;
  prices.forEach((p) => {
    const rounded = Math.round(p * 100) / 100;
    freq[rounded] = (freq[rounded] || 0) + 1;
    if (freq[rounded] > maxFreq) {
      maxFreq = freq[rounded];
      mode = rounded;
    }
  });

  return {
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    mode: Math.round(mode * 100) / 100,
  };
}

// Generate pricing analysis data
export function generatePricingAnalysis(
  competitorResults: CompetitorPricingResult[],
  nextResults: NextPricingResult[]
): PricingAnalysis {
  const analysis: PricingAnalysis = {
    averages: {},
    comparison: {},
    nextUrlByCategory: {},
  };

  // Group competitor results by category and domain
  const byCategoryDomain: Record<string, Record<string, CategoryDomainData>> = {};
  competitorResults.forEach((row) => {
    const category = row.Category || 'Unknown';
    const domain = row.Domain || getDomain(row['Source URL'] || '');
    const competitorType = row['Competitor Type'] || 'local';
    const price = parseFloat(String(row.price || '0').replace(/[^0-9.]/g, '')) || 0;

    if (!byCategoryDomain[category]) {
      byCategoryDomain[category] = {};
    }
    if (!byCategoryDomain[category][domain]) {
      byCategoryDomain[category][domain] = {
        prices: [],
        competitorType: competitorType,
      };
    }
    if (price > 0) {
      byCategoryDomain[category][domain].prices.push(price);
    }
  });

  // Group Next results by category
  const nextByCategory: Record<string, { prices: number[]; nextUrl: string }> = {};
  nextResults.forEach((row) => {
    const category = row['Next Category'] || row['Next Division'] || 'Unknown';
    const price = parseFloat(String(row['Current Price'] || row.ProductPrice || '0').replace(/[^0-9.]/g, '')) || 0;
    const nextUrl = row['Next URL'] || row.PageURL || '';

    if (!nextByCategory[category]) {
      nextByCategory[category] = { prices: [], nextUrl: nextUrl };
    }
    if (!nextByCategory[category].nextUrl && nextUrl) {
      nextByCategory[category].nextUrl = nextUrl;
    }
    if (price > 0) {
      nextByCategory[category].prices.push(price);
    }
  });

  // Build averages and comparison sections
  Object.keys(byCategoryDomain).forEach((category) => {
    const domains = byCategoryDomain[category];
    const nextData = nextByCategory[category] || { prices: [], nextUrl: '' };
    const nextPrices = nextData.prices;
    const nextStats = calcStats(nextPrices);

    // Skip categories without valid Next pricing data
    if (nextPrices.length === 0 || nextStats.mean === 0) {
      return;
    }

    // Store the Next URL and stats for this category
    analysis.nextUrlByCategory[category] = {
      url: nextData.nextUrl || '',
      stats: nextStats,
    };

    // Build averages for this category
    analysis.averages[category] = {};
    Object.keys(domains).forEach((domain) => {
      const data = domains[domain];
      const stats = calcStats(data.prices);
      analysis.averages[category][domain] = {
        ...stats,
        competitorType: data.competitorType,
        count: data.prices.length,
      };
    });

    // Build comparison for this category
    analysis.comparison[category] = {
      competitors: {},
      global: { avgPrice: 0, count: 0, nextVsComp: 0 },
      local: { avgPrice: 0, count: 0, nextVsComp: 0 },
      nextAvgPrice: nextStats.mean,
    };

    let globalTotal = 0,
      globalCount = 0;
    let localTotal = 0,
      localCount = 0;

    Object.keys(domains).forEach((domain) => {
      const data = domains[domain];
      const stats = calcStats(data.prices);
      const avgPrice = stats.mean;

      // Calculate Next vs Competitor % (positive = Next is more expensive)
      const nextVsComp =
        avgPrice > 0 && nextStats.mean > 0
          ? Math.round(((nextStats.mean - avgPrice) / avgPrice) * 100) / 100
          : 0;

      analysis.comparison[category].competitors[domain] = {
        avgPrice: avgPrice,
        nextVsComp: nextVsComp,
        competitorType: data.competitorType,
        count: data.prices.length,
      };

      if (data.competitorType === 'global') {
        globalTotal += avgPrice * data.prices.length;
        globalCount += data.prices.length;
      } else {
        localTotal += avgPrice * data.prices.length;
        localCount += data.prices.length;
      }
    });

    // Calculate global/local aggregates
    if (globalCount > 0) {
      const globalAvg = globalTotal / globalCount;
      analysis.comparison[category].global = {
        avgPrice: Math.round(globalAvg * 100) / 100,
        count: globalCount,
        nextVsComp:
          nextStats.mean > 0 && globalAvg > 0
            ? Math.round(((nextStats.mean - globalAvg) / globalAvg) * 100) / 100
            : 0,
      };
    }
    if (localCount > 0) {
      const localAvg = localTotal / localCount;
      analysis.comparison[category].local = {
        avgPrice: Math.round(localAvg * 100) / 100,
        count: localCount,
        nextVsComp:
          nextStats.mean > 0 && localAvg > 0
            ? Math.round(((nextStats.mean - localAvg) / localAvg) * 100) / 100
            : 0,
      };
    }
  });

  return analysis;
}

// Create Excel workbook for pricing analysis
export function createPricingAnalysisExcel(analysis: PricingAnalysis): XLSX.WorkBook | null {
  // Get all unique domains across all categories
  const allDomains = new Set<string>();
  Object.values(analysis.comparison).forEach((catData) => {
    Object.keys(catData.competitors).forEach((domain) => allDomains.add(domain));
  });
  const domains = Array.from(allDomains).sort();
  const categories = Object.keys(analysis.averages).sort();

  if (domains.length === 0 || categories.length === 0) {
    return null;
  }

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Build ALL data for single sheet
  const allData: (string | number)[][] = [];
  const merges: XLSX.Range[] = [];
  let currentRow = 0;

  // Calculate max columns needed
  const avgNumCols = 2 + 3 + domains.length * 3 + 3;
  const diffNumCols = 2 + domains.length * 3 + 3;
  const compNumCols = 2 + domains.length * 2 + 4;
  const maxCols = Math.max(avgNumCols, diffNumCols, compNumCols);

  // === SECTION 1: AVERAGES ===
  allData.push(['AVERAGES']);
  currentRow++;

  // Header row 1 for Averages
  const avgHeader1: (string | number)[] = ['Next URL', 'Category', 'Next', '', ''];
  domains.forEach((domain) => {
    avgHeader1.push(domain, '', '');
  });
  avgHeader1.push('Average Mean', 'Average Median', 'Avg. Mode');
  allData.push(avgHeader1);

  // Add merges for Next and domain headers
  let col = 2;
  merges.push({ s: { r: currentRow, c: col }, e: { r: currentRow, c: col + 2 } });
  col += 3;
  domains.forEach(() => {
    merges.push({ s: { r: currentRow, c: col }, e: { r: currentRow, c: col + 2 } });
    col += 3;
  });
  currentRow++;

  // Header row 2: Sub-headers
  const avgHeader2: (string | number)[] = ['', '', 'Mean', 'Median', 'Mode'];
  domains.forEach(() => {
    avgHeader2.push('Mean', 'Median', 'Mode');
  });
  avgHeader2.push('', '', '');
  allData.push(avgHeader2);
  currentRow++;

  // Averages Data rows
  categories.forEach((category) => {
    const nextInfo = analysis.nextUrlByCategory[category] || { url: '', stats: { mean: 0, median: 0, mode: 0 } };
    const row: (string | number)[] = [
      nextInfo.url,
      category,
      nextInfo.stats?.mean || '',
      nextInfo.stats?.median || '',
      nextInfo.stats?.mode || '',
    ];
    let totalMean = 0,
      totalMedian = 0,
      totalMode = 0,
      count = 0;

    domains.forEach((domain) => {
      const data = analysis.averages[category]?.[domain];
      if (data) {
        row.push(data.mean, data.median, data.mode);
        totalMean += data.mean;
        totalMedian += data.median;
        totalMode += data.mode;
        count++;
      } else {
        row.push('', '', '');
      }
    });

    if (count > 0) {
      row.push(
        Math.round((totalMean / count) * 100) / 100,
        Math.round((totalMedian / count) * 100) / 100,
        Math.round((totalMode / count) * 100) / 100
      );
    } else {
      row.push('', '', '');
    }
    allData.push(row);
    currentRow++;
  });

  // Empty row between sections
  allData.push([]);
  currentRow++;

  // === SECTION 2: DIFFERENCES AS % ===
  allData.push(['DIFFERENCES AS %']);
  currentRow++;

  // Header row 1 for Differences
  const diffHeader1: (string | number)[] = ['Next URL', 'Category'];
  domains.forEach((domain) => {
    diffHeader1.push(domain, '', '');
  });
  diffHeader1.push('Average Mean', 'Average Median', 'Avg. Mode');
  allData.push(diffHeader1);

  // Add merges for domain headers
  col = 2;
  domains.forEach(() => {
    merges.push({ s: { r: currentRow, c: col }, e: { r: currentRow, c: col + 2 } });
    col += 3;
  });
  currentRow++;

  // Header row 2
  const diffHeader2: (string | number)[] = ['', ''];
  domains.forEach(() => {
    diffHeader2.push('Mean', 'Median', 'Mode');
  });
  diffHeader2.push('', '', '');
  allData.push(diffHeader2);
  currentRow++;

  // Differences Data rows
  categories.forEach((category) => {
    const nextInfo = analysis.nextUrlByCategory[category] || { url: '', stats: { mean: 0, median: 0, mode: 0 } };
    const row: (string | number)[] = [nextInfo.url, category];
    const catData = analysis.comparison[category];
    const nextAvg = catData?.nextAvgPrice || 0;

    let totalMeanDiff = 0,
      totalMedianDiff = 0,
      totalModeDiff = 0,
      count = 0;

    domains.forEach((domain) => {
      const avgData = analysis.averages[category]?.[domain];
      if (avgData && nextAvg > 0) {
        const meanDiff = avgData.mean > 0 ? (nextAvg - avgData.mean) / avgData.mean : 0;
        const medianDiff = avgData.median > 0 ? (nextAvg - avgData.median) / avgData.median : 0;
        const modeDiff = avgData.mode > 0 ? (nextAvg - avgData.mode) / avgData.mode : 0;

        row.push(meanDiff, medianDiff, modeDiff);
        totalMeanDiff += meanDiff;
        totalMedianDiff += medianDiff;
        totalModeDiff += modeDiff;
        count++;
      } else {
        row.push('', '', '');
      }
    });

    if (count > 0) {
      row.push(totalMeanDiff / count, totalMedianDiff / count, totalModeDiff / count);
    } else {
      row.push('', '', '');
    }
    allData.push(row);
    currentRow++;
  });

  // Empty row between sections
  allData.push([]);
  currentRow++;

  // === SECTION 3: COMPETITOR COMPARISON ===
  allData.push(['COMPETITOR COMPARISON']);
  currentRow++;

  // Header row 1 for Comparison
  const compHeader1: (string | number)[] = ['Next URL', 'Category'];
  domains.forEach((domain) => {
    compHeader1.push(domain, '');
  });
  compHeader1.push('Global', '', 'Local', '');
  allData.push(compHeader1);

  // Add merges for domain headers
  col = 2;
  domains.forEach(() => {
    merges.push({ s: { r: currentRow, c: col }, e: { r: currentRow, c: col + 1 } });
    col += 2;
  });
  merges.push({ s: { r: currentRow, c: col }, e: { r: currentRow, c: col + 1 } }); // Global
  merges.push({ s: { r: currentRow, c: col + 2 }, e: { r: currentRow, c: col + 3 } }); // Local
  currentRow++;

  // Header row 2
  const compHeader2: (string | number)[] = ['', ''];
  domains.forEach(() => {
    compHeader2.push('Average price', 'Next v Comp %');
  });
  compHeader2.push('Average price', 'Next v Comp %', 'Average price', 'Next v Comp %');
  allData.push(compHeader2);
  currentRow++;

  // Comparison Data rows
  categories.forEach((category) => {
    const nextInfo = analysis.nextUrlByCategory[category] || { url: '', stats: { mean: 0, median: 0, mode: 0 } };
    const catData = analysis.comparison[category];
    const row: (string | number)[] = [nextInfo.url, category];

    domains.forEach((domain) => {
      const compInfo = catData?.competitors[domain];
      if (compInfo) {
        row.push(compInfo.avgPrice, compInfo.nextVsComp);
      } else {
        row.push('', '');
      }
    });

    row.push(
      catData?.global?.avgPrice || '',
      catData?.global?.nextVsComp || '',
      catData?.local?.avgPrice || '',
      catData?.local?.nextVsComp || ''
    );
    allData.push(row);
    currentRow++;
  });

  // Create the worksheet
  const ws = XLSX.utils.aoa_to_sheet(allData);

  // Set column widths
  const colWidths: XLSX.ColInfo[] = [{ wch: 50 }, { wch: 15 }];
  for (let i = 2; i < maxCols; i++) {
    colWidths.push({ wch: 14 });
  }
  ws['!cols'] = colWidths;

  // Apply merges
  ws['!merges'] = merges;

  XLSX.utils.book_append_sheet(wb, ws, 'Pricing Analysis');

  return wb;
}

// Transform batch job results to competitor pricing format
export function transformToCompetitorPricing(
  jobs: BatchJob[],
  batchData: Array<{ country: string; division: string; category: string; nextUrl: string; sourceUrl: string }>
): CompetitorPricingResult[] {
  const results: CompetitorPricingResult[] = [];

  jobs.forEach((job) => {
    if (job.status !== 'completed' || !job.results) return;

    const jobMeta = batchData.find(
      (d) => d.sourceUrl === job.sourceUrl && d.country === job.country
    ) || {
      country: job.country,
      division: job.division,
      category: job.category,
      nextUrl: '',
      sourceUrl: job.sourceUrl,
    };

    (job.results as Array<Record<string, unknown>>).forEach((item) => {
      results.push({
        'Item Name': String(item.title || item['Item Name'] || ''),
        Brand: getDomain(job.sourceUrl),
        price: String(item.price || item.currentPrice || ''),
        'Product URL': String(item.url || item.href || item['Product URL'] || ''),
        'Source URL': job.sourceUrl,
        Category: job.category,
        Country: job.country,
        Domain: job.domain,
        'Competitor Type': 'local', // Default to local
        'Next URL': jobMeta.nextUrl || '',
        'Next Division': jobMeta.division || job.division,
        'Next Category': jobMeta.category || job.category,
      });
    });
  });

  return results;
}

// Main download function - creates ZIP with all CSVs and Excel files
export async function downloadBatchResults(
  batchResults: CompetitorPricingResult[],
  nextScrapeResults: NextPricingResult[],
  batchData: Array<{ country: string; division: string; category: string; nextUrl: string; sourceUrl: string }>
): Promise<void> {
  if (!batchResults.length && !nextScrapeResults.length) {
    console.warn('[Download] No results to download');
    return;
  }

  // Create output folder name with timestamp
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const zipFilename = `batch_output_${timestamp}.zip`;

  // Create a new JSZip instance
  const zip = new JSZip();
  let fileCount = 0;

  // === ORGANIZE BY COUNTRY ===
  const resultsByCountry: Record<string, {
    batch: CompetitorPricingResult[];
    next: NextPricingResult[];
  }> = {};

  // Group batchResults by country
  batchResults.forEach((row) => {
    const country = (row.Country || 'Unknown').trim() || 'Unknown';
    if (!resultsByCountry[country]) {
      resultsByCountry[country] = { batch: [], next: [] };
    }
    resultsByCountry[country].batch.push(row);
  });

  // Group nextScrapeResults by country
  nextScrapeResults.forEach((row) => {
    const nextUrl = row['Next URL'] || '';
    let country = 'Unknown';

    // Find matching job in batchData to get country
    const matchingJob = batchData.find(
      (job) => job.nextUrl === nextUrl || job.sourceUrl === nextUrl
    );
    if (matchingJob?.country) {
      country = matchingJob.country.trim() || 'Unknown';
    }

    if (!resultsByCountry[country]) {
      resultsByCountry[country] = { batch: [], next: [] };
    }
    resultsByCountry[country].next.push(row);
  });

  // Headers for each CSV type
  const batchHeaders = [
    'Item Name',
    'Brand',
    'price',
    'Product URL',
    'Source URL',
    'Category',
    'Country',
    'Domain',
    'Competitor Type',
    'Next URL',
    'Next Division',
    'Next Category',
  ];

  const nextHeaders = [
    'Next URL',
    'Next Division',
    'Next Category',
    'Brand',
    'PageURL',
    'PageNum',
    'Anchor',
    'ProductTitle',
    'ProductPrice',
    'Current Price',
    'Currency',
  ];

  const transformedHeaders = ['Brand', 'baseurl_ref', 'scrapeurl_base', 'title', 'price'];

  // Create country folders with CSVs
  const countries = Object.keys(resultsByCountry).sort();

  countries.forEach((country) => {
    const countryData = resultsByCountry[country];
    const safeCountryName = country.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Unknown';
    const folderPath = `${safeCountryName}/`;

    // Add competitor pricing CSV for this country
    if (countryData.batch.length > 0) {
      const csvContent = createCsvContent(batchHeaders, countryData.batch, true);
      zip.file(`${folderPath}competitor pricing.csv`, csvContent);
      fileCount++;
    }

    // Add next pricing CSV for this country
    if (countryData.next.length > 0) {
      const csvContent = createCsvContent(nextHeaders, countryData.next, false);
      zip.file(`${folderPath}next pricing.csv`, csvContent);
      fileCount++;
    }

    // Create transformed data for this country
    const transformedData: Record<string, unknown>[] = [];

    // Transform batchResults for this country
    countryData.batch.forEach((row) => {
      const priceValue = row.price || '';
      const sourceUrl = row['Source URL'] || '';
      const domain = getDomain(sourceUrl);

      transformedData.push({
        Brand: domain,
        baseurl_ref: row['Next URL'] || '',
        scrapeurl_base: sourceUrl,
        title: row['Item Name'] || '',
        price: priceValue,
      });
    });

    // Transform nextScrapeResults for this country (filter out rows with Current Price = 0)
    countryData.next.forEach((row) => {
      const currentPrice = row['Current Price'];
      if (currentPrice === 0 || currentPrice === '0' || currentPrice === '' || currentPrice == null) {
        return;
      }

      const priceValue = String(row['Current Price'] || row.ProductPrice || '');
      const nextUrl = row['Next URL'] || '';
      const domain = getDomain(nextUrl);

      transformedData.push({
        Brand: domain,
        baseurl_ref: nextUrl,
        scrapeurl_base: nextUrl,
        title: row.ProductTitle || '',
        price: priceValue,
      });
    });

    // Add combined data CSV for this country
    if (transformedData.length > 0) {
      const csvContent = createCsvContent(transformedHeaders, transformedData, false);
      zip.file(`${folderPath}combined data.csv`, csvContent);
      fileCount++;
    }
  });

  // Add combined "all countries" CSV at the root
  if (batchResults.length > 0) {
    const csvContent = createCsvContent(batchHeaders, batchResults, true);
    zip.file('_all_competitor pricing.csv', csvContent);
    fileCount++;
  }

  if (nextScrapeResults.length > 0) {
    const csvContent = createCsvContent(nextHeaders, nextScrapeResults, false);
    zip.file('_all_next pricing.csv', csvContent);
    fileCount++;
  }

  // Generate pricing analysis Excel
  if (batchResults.length > 0) {
    try {
      const analysis = generatePricingAnalysis(batchResults, nextScrapeResults);
      const wb = createPricingAnalysisExcel(analysis);
      if (wb) {
        const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        zip.file('_pricing_analysis.xlsx', xlsxData);
        fileCount++;

        // Also add per-country analysis
        countries.forEach((country) => {
          const countryData = resultsByCountry[country];
          if (countryData && countryData.batch.length > 0) {
            const safeCountryName = country.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Unknown';
            const countryAnalysis = generatePricingAnalysis(countryData.batch, countryData.next);
            const countryWb = createPricingAnalysisExcel(countryAnalysis);
            if (countryWb) {
              const countryXlsxData = XLSX.write(countryWb, { bookType: 'xlsx', type: 'array' });
              zip.file(`${safeCountryName}/pricing_analysis.xlsx`, countryXlsxData);
              fileCount++;
            }
          }
        });
      }
    } catch (e) {
      console.error('[Download] Error generating pricing analysis:', e);
    }
  }

  // Generate zip file and download
  try {
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);
    const zipLink = document.createElement('a');
    zipLink.setAttribute('href', zipUrl);
    zipLink.setAttribute('download', zipFilename);
    zipLink.style.display = 'none';
    document.body.appendChild(zipLink);
    zipLink.click();

    // Clean up
    setTimeout(() => {
      document.body.removeChild(zipLink);
      URL.revokeObjectURL(zipUrl);
    }, 100);

    console.log(`[Download] Downloaded zip file with ${fileCount} files`);
  } catch (error) {
    console.error('[Download] Error creating zip file:', error);
    throw error;
  }
}
