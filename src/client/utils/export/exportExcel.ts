// ============================================================================
// EXCEL EXPORT UTILITY
// ============================================================================

import * as XLSX from 'xlsx-js-style';
import type { ScrapedItem } from '../../../shared/types';

interface ExcelExportOptions {
  filename: string;
  sheetName?: string;
}

export function exportToExcel(items: ScrapedItem[], options: ExcelExportOptions): void {
  const { filename, sheetName = 'Data' } = options;

  if (items.length === 0) {
    console.warn('[exportExcel] No items to export');
    return;
  }

  // Get all unique keys from all items
  const allKeys = new Set<string>();
  items.forEach(item => {
    Object.keys(item).forEach(key => allKeys.add(key));
  });
  const headers = Array.from(allKeys);

  // Create worksheet data
  const wsData: (string | null)[][] = [];

  // Add headers
  wsData.push(headers);

  // Add data rows
  items.forEach(item => {
    const row = headers.map(header => item[header] ?? null);
    wsData.push(row);
  });

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Set column widths based on content
  const colWidths = headers.map((header) => {
    let maxWidth = header.length;
    items.forEach(item => {
      const value = item[header];
      if (value) {
        maxWidth = Math.max(maxWidth, String(value).length);
      }
    });
    return { wch: Math.min(maxWidth + 2, 50) }; // Cap at 50 chars
  });
  ws['!cols'] = colWidths;

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Save file
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
