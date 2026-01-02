import { useState, useCallback, useEffect, useRef } from 'react';
import type { ScrollTestResult, ScrollTestUpdate, WSMessageType } from '../../../shared/types';

interface ScrollTestPanelProps {
  itemSelector: string;
  sessionId: string | null;
  send: <T>(type: WSMessageType, payload: T, sessionId?: string) => void;
  subscribe: (type: WSMessageType | WSMessageType[], callback: (msg: { payload: unknown }) => void) => () => void;
  onTestComplete: (result: ScrollTestResult) => void;
}

export function ScrollTestPanel({
  itemSelector,
  sessionId,
  send,
  subscribe,
  onTestComplete,
}: ScrollTestPanelProps) {
  const [isTestActive, setIsTestActive] = useState(false);
  const [testData, setTestData] = useState<ScrollTestUpdate | null>(null);
  const [result, setResult] = useState<ScrollTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Subscribe to scroll test events
  useEffect(() => {
    const unsubStart = subscribe('scrollTest:start', (msg) => {
      const payload = msg.payload as { started: boolean; error?: string };
      if (payload.started) {
        setIsTestActive(true);
        setError(null);
        // Start polling for updates
        updateIntervalRef.current = setInterval(() => {
          if (sessionId) {
            send('scrollTest:update', {}, sessionId);
          }
        }, 500);
      } else if (payload.error) {
        setError(payload.error);
      }
    });

    const unsubUpdate = subscribe('scrollTest:update', (msg) => {
      const payload = msg.payload as ScrollTestUpdate;
      setTestData(payload);
    });

    const unsubResult = subscribe('scrollTest:result', (msg) => {
      const payload = msg.payload as ScrollTestResult & { error?: string };
      if (payload.error) {
        setError(payload.error);
      } else {
        setResult(payload);
        onTestComplete(payload);
      }
      setIsTestActive(false);
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    });

    return () => {
      unsubStart();
      unsubUpdate();
      unsubResult();
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
    };
  }, [subscribe, sessionId, send, onTestComplete]);

  const handleStartTest = useCallback(() => {
    if (!sessionId) {
      setError('No browser session active');
      return;
    }

    if (!itemSelector) {
      setError('Please select a product first so we know what to count');
      return;
    }

    setError(null);
    setResult(null);
    setTestData(null);
    send('scrollTest:start', { itemSelector }, sessionId);
  }, [sessionId, itemSelector, send]);

  const handleFinishTest = useCallback(() => {
    if (!sessionId) return;
    send('scrollTest:complete', {}, sessionId);
  }, [sessionId, send]);

  const handleClearResult = useCallback(() => {
    setResult(null);
    setTestData(null);
  }, []);

  return (
    <div className="step-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2 className="step-title" style={{ margin: 0 }}>Lazy Loading Test</h2>
        {result && (
          <button
            onClick={handleClearResult}
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

      <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '15px', lineHeight: 1.6 }}>
        Scroll the page in the browser to see how content loads. We'll analyze the behavior and recommend optimal
        settings.
      </p>

      {!isTestActive && !result && (
        <button
          className="btn secondary"
          style={{ width: '100%' }}
          onClick={handleStartTest}
          disabled={!sessionId || !itemSelector}
        >
          Start Scroll Test
        </button>
      )}

      {isTestActive && (
        <>
          {/* Live stats during test */}
          <div
            style={{
              padding: '15px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              marginBottom: '15px',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  Initial Items
                </div>
                <div style={{ fontSize: '1.2em', fontWeight: 600 }}>{testData?.initialCount ?? '...'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  Current Items
                </div>
                <div style={{ fontSize: '1.2em', fontWeight: 600, color: 'var(--accent-success)' }}>
                  {testData?.currentCount ?? '...'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  Items Loaded
                </div>
                <div style={{ fontSize: '1.2em', fontWeight: 600, color: 'var(--accent-primary)' }}>
                  +{testData ? testData.currentCount - testData.initialCount : 0}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  Scroll Position
                </div>
                <div style={{ fontSize: '1.2em', fontWeight: 600 }}>
                  {testData?.scrollPosition ? `${Math.round(testData.scrollPosition)}px` : '...'}
                </div>
              </div>
            </div>

            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'var(--accent-success)',
                  animation: 'pulse 1s infinite',
                }}
              />
              <span style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>
                Scroll the page in the browser...
              </span>
            </div>
          </div>

          <button className="btn primary" style={{ width: '100%' }} onClick={handleFinishTest}>
            Finish Test
          </button>
        </>
      )}

      {result && (
        <div
          style={{
            padding: '15px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--accent-success)',
            borderRadius: '6px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--accent-success)">
              <path d="M8 0a8 8 0 1 0 8 8A8 8 0 0 0 8 0zm3.78 5.28-4.5 6a.75.75 0 0 1-1.18.03l-2.25-2.5a.75.75 0 1 1 1.11-1.01l1.62 1.8 3.95-5.27a.75.75 0 0 1 1.25.95z" />
            </svg>
            <span style={{ fontWeight: 600 }}>Test Complete</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '15px' }}>
            <div>
              <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)' }}>Items Loaded</div>
              <div style={{ fontWeight: 600 }}>
                {result.initialItemCount} → {result.finalItemCount}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)' }}>Scroll Iterations</div>
              <div style={{ fontWeight: 600 }}>{result.scrollIterations}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)' }}>Avg Load Delay</div>
              <div style={{ fontWeight: 600 }}>{result.avgLoadDelay}ms</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)' }}>Scroll Distance</div>
              <div style={{ fontWeight: 600 }}>{Math.round(result.totalScrollDistance)}px</div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
            <div style={{ fontSize: '0.85em', fontWeight: 600, marginBottom: '10px' }}>Recommended Settings</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <span
                style={{
                  padding: '4px 10px',
                  background: 'var(--accent-primary)',
                  color: 'white',
                  borderRadius: '4px',
                  fontSize: '0.8em',
                  fontWeight: 500,
                }}
              >
                {result.recommendedStrategy}
              </span>
              <span
                style={{
                  padding: '4px 10px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  fontSize: '0.8em',
                }}
              >
                {result.recommendedDelay}ms delay
              </span>
              <span
                style={{
                  padding: '4px 10px',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  fontSize: '0.8em',
                }}
              >
                {result.recommendedMaxIterations} max iterations
              </span>
            </div>

            {result.loadingIndicatorsFound.length > 0 && (
              <div style={{ marginTop: '10px', fontSize: '0.8em', color: 'var(--text-secondary)' }}>
                Loading indicators found: {result.loadingIndicatorsFound.join(', ')}
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: '15px', fontSize: '0.85em', color: 'var(--accent-danger)' }}>{error}</div>}

      {!itemSelector && (
        <div style={{ marginTop: '10px', fontSize: '0.8em', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
          Select a product first to enable scroll testing.
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
