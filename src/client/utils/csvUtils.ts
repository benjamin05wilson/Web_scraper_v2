// CSV parsing utilities

export interface CSVParseResult<T = Record<string, string>> {
  headers: string[];
  rows: T[];
  errors: string[];
}

export function parseCSV<T = Record<string, string>>(text: string): CSVParseResult<T> {
  const errors: string[] = [];
  const lines = text.trim().split(/\r?\n/);

  if (lines.length === 0) {
    return { headers: [], rows: [], errors: ['Empty CSV file'] };
  }

  // Parse header row
  const headers = parseCSVLine(lines[0]);

  if (headers.length === 0) {
    return { headers: [], rows: [], errors: ['No headers found in CSV'] };
  }

  // Parse data rows
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    if (values.length !== headers.length) {
      errors.push(`Row ${i + 1}: Expected ${headers.length} columns, got ${values.length}`);
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index];
    });
    rows.push(row as T);
  }

  return { headers, rows, errors };
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  values.push(current.trim());
  return values;
}

export function generateCSV(data: Record<string, unknown>[], headers?: string[]): string {
  if (data.length === 0) return '';

  const csvHeaders = headers || Object.keys(data[0]);
  const lines: string[] = [csvHeaders.join(',')];

  for (const row of data) {
    const values = csvHeaders.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      const str = String(value);
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

export function downloadCSV(content: string | Record<string, unknown>[], filename: string): void {
  // If passed an array, convert to CSV string first
  const csvContent = Array.isArray(content) ? generateCSV(content) : content;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Batch CSV template
export const BATCH_CSV_TEMPLATE = `Country,Division,Category,Next URL,Source URL
United States,Apparel,Dresses,https://example.com/dresses,https://example.com/dresses
United Kingdom,Footwear,Sneakers,https://example.co.uk/sneakers,https://example.co.uk/sneakers`;

export interface BatchCSVRow {
  Country: string;
  Division: string;
  Category: string;
  'Next URL': string;
  'Source URL': string;
}

export function parseBatchCSV(text: string): CSVParseResult<BatchCSVRow> {
  return parseCSV<BatchCSVRow>(text);
}
