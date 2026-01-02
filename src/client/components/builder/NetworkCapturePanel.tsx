import React, { useState, useEffect, useCallback } from 'react';
import type { DetectedApiPattern, InterceptedProduct } from '../../../shared/types';

interface NetworkCapturePanelProps {
  sessionId: string | null;
  send: (type: string, payload?: any, sessionId?: string) => void;
  subscribe: (type: string, handler: (msg: any) => void) => () => void;
  onPatternSelect: (pattern: DetectedApiPattern) => void;
  onProductsCaptured: (products: InterceptedProduct[]) => void;
}

export function NetworkCapturePanel({
  sessionId,
  send,
  subscribe,
  onPatternSelect,
  onProductsCaptured,
}: NetworkCapturePanelProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [detectedPatterns, setDetectedPatterns] = useState<DetectedApiPattern[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [selectedPattern, setSelectedPattern] = useState<DetectedApiPattern | null>(null);

  // Subscribe to network events
  useEffect(() => {
    const unsubscribeCapture = subscribe('network:startCapture', (msg) => {
      if (msg.payload?.success) {
        setIsCapturing(true);
        console.log('[NetworkCapturePanel] Capture started');
      }
    });

    const unsubscribeStop = subscribe('network:stopCapture', (msg) => {
      setIsCapturing(false);
      if (msg.payload?.productCount !== undefined) {
        setProductCount(msg.payload.productCount);
      }
      console.log('[NetworkCapturePanel] Capture stopped');
    });

    const unsubscribePatterns = subscribe('network:patternDetected', (msg) => {
      if (msg.payload?.patterns) {
        setDetectedPatterns(msg.payload.patterns);
        console.log('[NetworkCapturePanel] Patterns detected:', msg.payload.patterns.length);
      }
    });

    const unsubscribeProducts = subscribe('network:products', (msg) => {
      if (msg.payload?.products) {
        onProductsCaptured(msg.payload.products);
        setProductCount(msg.payload.products.length);
      }
    });

    const unsubscribeProduct = subscribe('network:productCaptured', (msg) => {
      if (msg.payload?.totalCount !== undefined) {
        setProductCount(msg.payload.totalCount);
      }
    });

    return () => {
      unsubscribeCapture();
      unsubscribeStop();
      unsubscribePatterns();
      unsubscribeProducts();
      unsubscribeProduct();
    };
  }, [subscribe, onProductsCaptured]);

  const handleStartCapture = useCallback(() => {
    if (!sessionId) return;
    send('network:startCapture', { autoDetect: true }, sessionId);
  }, [sessionId, send]);

  const handleStopCapture = useCallback(() => {
    if (!sessionId) return;
    send('network:stopCapture', {}, sessionId);
  }, [sessionId, send]);

  const handleGetProducts = useCallback(() => {
    if (!sessionId) return;
    send('network:getProducts', {}, sessionId);
  }, [sessionId, send]);

  const handlePatternClick = useCallback((pattern: DetectedApiPattern) => {
    setSelectedPattern(pattern);
    onPatternSelect(pattern);
  }, [onPatternSelect]);

  return (
    <div className="step-card">
      <h2 className="step-title">
        Network Capture
        <span style={{
          fontSize: '0.7em',
          marginLeft: '10px',
          padding: '2px 8px',
          background: 'var(--accent-secondary)',
          borderRadius: '4px',
          color: 'white',
        }}>
          BETA
        </span>
      </h2>

      <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '15px' }}>
        Capture product data from network requests instead of DOM scraping.
        Useful for sites with virtual scroll or lazy-loaded content.
      </p>

      {/* Capture Controls */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        {!isCapturing ? (
          <button
            className="btn"
            onClick={handleStartCapture}
            disabled={!sessionId}
            style={{ flex: 1 }}
          >
            Start Capture
          </button>
        ) : (
          <button
            className="btn secondary"
            onClick={handleStopCapture}
            style={{ flex: 1 }}
          >
            Stop Capture
          </button>
        )}

        <button
          className="btn secondary"
          onClick={handleGetProducts}
          disabled={!sessionId || productCount === 0}
        >
          Get Products ({productCount})
        </button>
      </div>

      {/* Status */}
      {isCapturing && (
        <div style={{
          padding: '10px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--accent-primary)',
          borderRadius: '4px',
          marginBottom: '15px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <div style={{
            width: '10px',
            height: '10px',
            background: 'var(--accent-success)',
            borderRadius: '50%',
            animation: 'pulse 1.5s infinite',
          }} />
          <span style={{ fontSize: '0.9em' }}>
            Capturing network requests... Scroll the page to trigger product loads.
          </span>
        </div>
      )}

      {/* Detected Patterns */}
      {detectedPatterns.length > 0 && (
        <div style={{ marginTop: '10px' }}>
          <h3 style={{ fontSize: '0.9em', marginBottom: '10px', color: 'var(--text-primary)' }}>
            Detected API Patterns ({detectedPatterns.length})
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {detectedPatterns.map((pattern, index) => (
              <div
                key={index}
                onClick={() => handlePatternClick(pattern)}
                style={{
                  padding: '12px',
                  background: selectedPattern === pattern ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                  border: `1px solid ${selectedPattern === pattern ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}>
                  <code style={{
                    fontSize: '0.85em',
                    color: selectedPattern === pattern ? 'white' : 'var(--text-primary)',
                  }}>
                    {pattern.pattern}
                  </code>
                  <span style={{
                    fontSize: '0.75em',
                    padding: '2px 6px',
                    background: 'var(--accent-secondary)',
                    borderRadius: '3px',
                    color: 'white',
                  }}>
                    {Math.round(pattern.confidence)}% confidence
                  </span>
                </div>

                {/* Field mappings preview */}
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  marginTop: '6px',
                }}>
                  {pattern.suggestedMappings.title && (
                    <span style={mappingBadgeStyle}>title: {pattern.suggestedMappings.title}</span>
                  )}
                  {pattern.suggestedMappings.price && (
                    <span style={mappingBadgeStyle}>price: {pattern.suggestedMappings.price}</span>
                  )}
                  {pattern.suggestedMappings.url && (
                    <span style={mappingBadgeStyle}>url: {pattern.suggestedMappings.url}</span>
                  )}
                  {pattern.suggestedMappings.image && (
                    <span style={mappingBadgeStyle}>image: {pattern.suggestedMappings.image}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Pattern Details */}
      {selectedPattern && (
        <div style={{
          marginTop: '15px',
          padding: '12px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
        }}>
          <h4 style={{ fontSize: '0.85em', marginBottom: '10px', color: 'var(--text-primary)' }}>
            Selected Pattern Configuration
          </h4>

          <pre style={{
            fontSize: '0.75em',
            background: 'var(--bg-primary)',
            padding: '10px',
            borderRadius: '4px',
            overflow: 'auto',
            maxHeight: '200px',
          }}>
            {JSON.stringify({
              urlPatterns: [selectedPattern.pattern],
              fieldMappings: selectedPattern.suggestedMappings,
            }, null, 2)}
          </pre>
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

const mappingBadgeStyle: React.CSSProperties = {
  fontSize: '0.7em',
  padding: '2px 6px',
  background: 'var(--bg-primary)',
  borderRadius: '3px',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-color)',
};
