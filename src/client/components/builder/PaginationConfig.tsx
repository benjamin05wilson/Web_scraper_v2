import { useState, useCallback } from 'react';

interface PaginationPattern {
  type: 'url_pattern' | 'next_page' | 'infinite_scroll';
  pattern: string;
  start_page?: number;
}

interface PaginationConfigProps {
  baseUrl: string;
  pattern: PaginationPattern | null;
  onPatternDetected: (pattern: PaginationPattern | null) => void;
}

export function PaginationConfig({ baseUrl, pattern, onPatternDetected }: PaginationConfigProps) {
  const [page2Url, setPage2Url] = useState('');
  const [error, setError] = useState<string | null>(null);

  const detectPattern = useCallback(() => {
    setError(null);

    if (!baseUrl) {
      setError('Please enter a target URL first');
      return;
    }

    if (!page2Url) {
      setError('Please enter a page 2 URL');
      return;
    }

    try {
      const url1 = new URL(baseUrl);
      const url2 = new URL(page2Url);

      const params1 = new URLSearchParams(url1.search);
      const params2 = new URLSearchParams(url2.search);

      let detectedPattern: string | null = null;
      const hash2 = url2.hash || '';

      // Check query parameters for page number
      for (const [key, value] of params2.entries()) {
        const val1 = params1.get(key);
        if (value === '2' && (val1 === '1' || val1 === null || val1 === '')) {
          detectedPattern = `?${key}={page}${hash2}`;
          break;
        }
        // Check for offset-style pagination
        const num2 = parseInt(value);
        const num1 = parseInt(val1 || '0');
        if (!isNaN(num2) && !isNaN(num1) && num2 > num1 && num1 >= 0) {
          detectedPattern = `?${key}={page}${hash2}`;
          break;
        }
      }

      // Check path-based pagination
      if (!detectedPattern) {
        const path1 = url1.pathname;
        const path2 = url2.pathname;

        const pageMatch = path2.match(/\/page[\/\-_]?(\d+)/i);
        if (pageMatch && pageMatch[1] === '2') {
          const separator = path2.match(/\/page([\/\-_]?)\d+/i)?.[1] || '/';
          detectedPattern = `/page${separator}{page}${hash2}`;
        }

        if (!detectedPattern) {
          const endMatch2 = path2.match(/\/(\d+)\/?$/);
          const endMatch1 = path1.match(/\/(\d+)\/?$/);
          if (endMatch2 && endMatch2[1] === '2') {
            if (!endMatch1 || endMatch1[1] === '1') {
              detectedPattern = `/{page}${hash2}`;
            }
          }
        }
      }

      if (detectedPattern) {
        onPatternDetected({
          type: 'url_pattern',
          pattern: detectedPattern,
          start_page: 1,
        });
      } else {
        setError('Could not detect pattern. URLs may be too different.');
        onPatternDetected(null);
      }
    } catch {
      setError('Invalid URL format');
    }
  }, [baseUrl, page2Url, onPatternDetected]);

  return (
    <div className="step-card">
      <h2 className="step-title">Pagination (Optional)</h2>

      <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '15px', lineHeight: 1.6 }}>
        Paste a page 2 URL to auto-detect the pagination pattern, or leave empty for infinite scroll.
      </p>

      <div className="form-group" style={{ marginBottom: '10px' }}>
        <input
          type="text"
          className="form-input"
          value={page2Url}
          onChange={(e) => setPage2Url(e.target.value)}
          placeholder="https://example.com/products?page=2"
        />
      </div>

      <button className="btn secondary" style={{ width: '100%' }} onClick={detectPattern}>
        Detect Pattern
      </button>

      {error && (
        <div style={{ marginTop: '15px', fontSize: '0.85em', color: 'var(--accent-danger)' }}>
          {error}
        </div>
      )}

      {pattern && (
        <div style={{ marginTop: '15px', fontSize: '0.85em' }}>
          <div style={{ padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Detected Pattern: </span>
            <span style={{ fontWeight: 700, color: 'var(--accent-success)' }}>{pattern.pattern}</span>
          </div>
        </div>
      )}
    </div>
  );
}
