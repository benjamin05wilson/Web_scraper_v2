import { useState, useCallback, useEffect } from 'react';
import type { PaginationCandidate, WSMessageType } from '../../../shared/types';

interface OffsetConfig {
  key: string;
  start: number;
  increment: number;
}

interface PaginationPattern {
  type: 'url_pattern' | 'next_page' | 'infinite_scroll';
  pattern?: string;
  selector?: string;
  start_page?: number;
  max_pages?: number;
  offset?: OffsetConfig; // For URL-based offset pagination
}

interface PaginationDetectorProps {
  baseUrl: string;
  pattern: PaginationPattern | null;
  onPatternDetected: (pattern: PaginationPattern | null) => void;
  sessionId: string | null;
  send: <T>(type: WSMessageType, payload: T, sessionId?: string) => void;
  subscribe: (type: WSMessageType | WSMessageType[], callback: (msg: { payload: unknown }) => void) => () => void;
}

type DetectionMode = 'auto' | 'url' | 'manual';

export function PaginationDetector({
  baseUrl,
  pattern,
  onPatternDetected,
  sessionId,
  send,
  subscribe,
}: PaginationDetectorProps) {
  const [mode, setMode] = useState<DetectionMode>('auto');
  const [isDetecting, setIsDetecting] = useState(false);
  const [candidates, setCandidates] = useState<PaginationCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [page2Url, setPage2Url] = useState('');
  const [manualSelector, setManualSelector] = useState('');
  const [maxPages, setMaxPages] = useState(10);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to pagination:candidates
  useEffect(() => {
    const unsubscribe = subscribe('pagination:candidates', (msg) => {
      const payload = msg.payload as { candidates: PaginationCandidate[]; error?: string };
      setCandidates(payload.candidates || []);
      setIsDetecting(false);
      if (payload.error) {
        setError(payload.error);
      }
    });

    return unsubscribe;
  }, [subscribe]);

  // Auto-detect pagination candidates
  const handleAutoDetect = useCallback(() => {
    if (!sessionId) {
      setError('No browser session active');
      return;
    }

    setError(null);
    setIsDetecting(true);
    setCandidates([]);
    send('pagination:detect', {}, sessionId);
  }, [sessionId, send]);

  // Select a candidate
  const handleSelectCandidate = useCallback(
    (candidate: PaginationCandidate) => {
      setSelectedCandidate(candidate.selector);
      onPatternDetected({
        type: candidate.type === 'load_more' ? 'infinite_scroll' : 'next_page',
        selector: candidate.selector,
        max_pages: maxPages,
      });
    },
    [onPatternDetected, maxPages]
  );

  // URL pattern detection - smart offset detection
  const detectUrlPattern = useCallback(() => {
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
      let offsetConfig: OffsetConfig | undefined;
      const hash2 = url2.hash || '';

      // Smart offset detection: find ANY numeric parameter that changed
      for (const [key, value] of params2.entries()) {
        const val1 = params1.get(key);
        const num1 = parseInt(val1 || '0', 10);
        const num2 = parseInt(value, 10);

        // Check if this parameter changed numerically
        if (!isNaN(num1) && !isNaN(num2) && num1 !== num2) {
          const increment = num2 - num1;

          // Determine if it's page-style (1→2) or offset-style (0→24)
          const isPageStyle = (num1 === 1 && num2 === 2) ||
                              (num1 === 0 && num2 === 1) ||
                              (Math.abs(increment) === 1);

          if (isPageStyle) {
            // Simple page number: ?page={page}
            detectedPattern = `?${key}={page}${hash2}`;
          } else {
            // Offset style: store the increment for calculation
            detectedPattern = `?${key}={offset}${hash2}`;
            offsetConfig = {
              key,
              start: num1,
              increment: Math.abs(increment)
            };
            console.log(`[PaginationDetector] Detected offset: ${key}=${num1} → ${num2} (increment: ${Math.abs(increment)})`);
          }
          break;
        }
      }

      // Check path-based pagination
      if (!detectedPattern) {
        const path1 = url1.pathname;
        const path2 = url2.pathname;

        const pageMatch1 = path1.match(/\/page[\/\-_]?(\d+)/i);
        const pageMatch2 = path2.match(/\/page[\/\-_]?(\d+)/i);

        if (pageMatch2) {
          const num1 = pageMatch1 ? parseInt(pageMatch1[1], 10) : 0;
          const num2 = parseInt(pageMatch2[1], 10);
          if (num1 !== num2) {
            const separator = path2.match(/\/page([\/\-_]?)\d+/i)?.[1] || '/';
            detectedPattern = `/page${separator}{page}${hash2}`;
          }
        }

        if (!detectedPattern) {
          const endMatch2 = path2.match(/\/(\d+)\/?$/);
          const endMatch1 = path1.match(/\/(\d+)\/?$/);
          if (endMatch2) {
            const num1 = endMatch1 ? parseInt(endMatch1[1], 10) : 0;
            const num2 = parseInt(endMatch2[1], 10);
            if (num1 !== num2) {
              detectedPattern = `/{page}${hash2}`;
            }
          }
        }
      }

      if (detectedPattern) {
        const result: PaginationPattern = {
          type: 'url_pattern',
          pattern: detectedPattern,
          start_page: offsetConfig ? undefined : 1,
          max_pages: maxPages,
        };
        if (offsetConfig) {
          result.offset = offsetConfig;
        }
        onPatternDetected(result);
      } else {
        setError('Could not detect pattern. URLs may be too different.');
        onPatternDetected(null);
      }
    } catch {
      setError('Invalid URL format');
    }
  }, [baseUrl, page2Url, onPatternDetected, maxPages]);

  // Manual selector
  const handleManualSelector = useCallback(() => {
    if (!manualSelector.trim()) {
      setError('Please enter a CSS selector');
      return;
    }

    setError(null);
    onPatternDetected({
      type: 'next_page',
      selector: manualSelector.trim(),
      max_pages: maxPages,
    });
  }, [manualSelector, onPatternDetected, maxPages]);

  // Clear selection
  const handleClear = useCallback(() => {
    setSelectedCandidate(null);
    setCandidates([]);
    setPage2Url('');
    setManualSelector('');
    setError(null);
    onPatternDetected(null);
  }, [onPatternDetected]);

  const tabStyle = (active: boolean) => ({
    flex: 1,
    padding: '8px 12px',
    border: 'none',
    background: active ? 'var(--accent-primary)' : 'var(--bg-secondary)',
    color: active ? 'white' : 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: '0.85em',
    fontWeight: active ? 600 : 400,
    transition: 'all 0.2s',
  });

  return (
    <div className="step-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2 className="step-title" style={{ margin: 0 }}>Pagination</h2>
        {pattern && (
          <button
            onClick={handleClear}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.8em',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: '1px', marginBottom: '15px', borderRadius: '6px', overflow: 'hidden' }}>
        <button style={tabStyle(mode === 'auto')} onClick={() => setMode('auto')}>
          Auto-Detect
        </button>
        <button style={tabStyle(mode === 'url')} onClick={() => setMode('url')}>
          URL Pattern
        </button>
        <button style={tabStyle(mode === 'manual')} onClick={() => setMode('manual')}>
          Manual
        </button>
      </div>

      {/* Auto-Detect Mode */}
      {mode === 'auto' && (
        <>
          <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '15px', lineHeight: 1.6 }}>
            Automatically detect pagination elements on the page.
          </p>

          <button
            className="btn secondary"
            style={{ width: '100%' }}
            onClick={handleAutoDetect}
            disabled={isDetecting || !sessionId}
          >
            {isDetecting ? 'Detecting...' : 'Detect Pagination'}
          </button>

          {candidates.length > 0 && (
            <div style={{ marginTop: '15px' }}>
              <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                Found {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {candidates.map((candidate, index) => (
                  <div
                    key={index}
                    onClick={() => handleSelectCandidate(candidate)}
                    style={{
                      padding: '10px 12px',
                      background:
                        selectedCandidate === candidate.selector ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span
                      style={{
                        padding: '2px 8px',
                        background: selectedCandidate === candidate.selector ? 'rgba(255,255,255,0.2)' : 'var(--bg-primary)',
                        borderRadius: '4px',
                        fontSize: '0.75em',
                        fontWeight: 600,
                        color: selectedCandidate === candidate.selector ? 'white' : 'var(--text-secondary)',
                        textTransform: 'uppercase',
                      }}
                    >
                      {candidate.type.replace('_', ' ')}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '0.85em',
                        color: selectedCandidate === candidate.selector ? 'white' : 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {candidate.text || candidate.selector}
                    </span>
                    <span
                      style={{
                        fontSize: '0.75em',
                        color: selectedCandidate === candidate.selector ? 'rgba(255,255,255,0.7)' : 'var(--text-secondary)',
                      }}
                    >
                      {Math.round(candidate.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* URL Pattern Mode */}
      {mode === 'url' && (
        <>
          <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '15px', lineHeight: 1.6 }}>
            Paste a page 2 URL to detect the pagination pattern.
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

          <button className="btn secondary" style={{ width: '100%' }} onClick={detectUrlPattern}>
            Detect Pattern
          </button>
        </>
      )}

      {/* Manual Mode */}
      {mode === 'manual' && (
        <>
          <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '15px', lineHeight: 1.6 }}>
            Enter a CSS selector for the next page button.
          </p>

          <div className="form-group" style={{ marginBottom: '10px' }}>
            <input
              type="text"
              className="form-input"
              value={manualSelector}
              onChange={(e) => setManualSelector(e.target.value)}
              placeholder="a.next-page, button.load-more"
            />
          </div>

          <button className="btn secondary" style={{ width: '100%' }} onClick={handleManualSelector}>
            Use Selector
          </button>
        </>
      )}

      {/* Max Pages Setting */}
      <div style={{ marginTop: '15px' }}>
        <label style={{ fontSize: '0.85em', color: 'var(--text-secondary)', display: 'block', marginBottom: '5px' }}>
          Max Pages
        </label>
        <input
          type="number"
          className="form-input"
          value={maxPages}
          onChange={(e) => setMaxPages(parseInt(e.target.value) || 10)}
          min={1}
          max={100}
          style={{ width: '100px' }}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginTop: '15px', fontSize: '0.85em', color: 'var(--accent-danger)' }}>{error}</div>
      )}

      {/* Result */}
      {pattern && (
        <div style={{ marginTop: '15px', fontSize: '0.85em' }}>
          <div
            style={{ padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px' }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>
              {pattern.type === 'url_pattern' ? 'Pattern' : 'Selector'}:{' '}
            </span>
            <span style={{ fontWeight: 700, color: 'var(--accent-success)' }}>
              {pattern.pattern || pattern.selector}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
