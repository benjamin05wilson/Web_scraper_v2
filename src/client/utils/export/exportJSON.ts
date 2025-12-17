// ============================================================================
// JSON EXPORT UTILITY
// ============================================================================

import type { ScrapedItem } from '../../../shared/types';

interface JSONExportOptions {
  filename: string;
  pretty?: boolean;
}

export function exportToJSON(items: ScrapedItem[], options: JSONExportOptions): void {
  const { filename, pretty = true } = options;

  const jsonStr = pretty
    ? JSON.stringify(items, null, 2)
    : JSON.stringify(items);

  const blob = new Blob([jsonStr], { type: 'application/json' });
  downloadBlob(blob, `${filename}.json`);
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
