// ============================================================================
// CSV EXPORT UTILITY
// ============================================================================

import type { ScrapedItem } from '../../../shared/types';

interface CSVExportOptions {
  filename: string;
  delimiter?: ',' | ';' | '\t';
  includeHeaders?: boolean;
}

export function exportToCSV(items: ScrapedItem[], options: CSVExportOptions): void {
  const { filename, delimiter = ',', includeHeaders = true } = options;

  if (items.length === 0) {
    console.warn('[exportCSV] No items to export');
    return;
  }

  // Get all unique keys from all items
  const allKeys = new Set<string>();
  items.forEach(item => {
    Object.keys(item).forEach(key => allKeys.add(key));
  });
  const headers = Array.from(allKeys);

  // Build CSV content
  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(headers.map(h => escapeCSVValue(h, delimiter)).join(delimiter));
  }

  items.forEach(item => {
    const values = headers.map(header => {
      const value = item[header];
      return escapeCSVValue(value ?? '', delimiter);
    });
    lines.push(values.join(delimiter));
  });

  const csvContent = lines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);
}

function escapeCSVValue(value: string | null, delimiter: string): string {
  if (value === null) return '';
  const str = String(value);

  // Check if value needs quoting
  const needsQuoting = str.includes(delimiter) ||
                       str.includes('"') ||
                       str.includes('\n') ||
                       str.includes('\r');

  if (needsQuoting) {
    // Escape quotes by doubling them
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return str;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
