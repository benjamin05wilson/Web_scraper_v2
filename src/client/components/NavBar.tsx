// ============================================================================
// NAVIGATION BAR - URL input and session controls
// ============================================================================

import React, { useState, useCallback } from 'react';
import type { UrlHoverPayload, CapturedUrl } from '../../shared/types';

interface NavBarProps {
  currentUrl: string;
  sessionStatus: 'disconnected' | 'connecting' | 'ready' | 'streaming' | 'scraping';
  onNavigate: (url: string) => void;
  onCreateSession: (url: string) => void;
  onDestroySession: () => void;
  sessionId: string | null;
  hoveredUrl?: UrlHoverPayload | null;
  capturedUrls?: CapturedUrl[];
  onCaptureUrl?: (url: string, text?: string, title?: string) => void;
}

export const NavBar: React.FC<NavBarProps> = ({
  currentUrl,
  sessionStatus,
  onNavigate,
  onCreateSession,
  onDestroySession,
  sessionId,
  hoveredUrl,
  capturedUrls = [],
  onCaptureUrl,
}) => {
  const [urlInput, setUrlInput] = useState(currentUrl || 'https://');
  const [showCapturedUrls, setShowCapturedUrls] = useState(false);

  // Update input when currentUrl changes
  React.useEffect(() => {
    if (currentUrl) {
      setUrlInput(currentUrl);
    }
  }, [currentUrl]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      let url = urlInput.trim();
      if (!url) return;

      // Add protocol if missing
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
        setUrlInput(url);
      }

      if (sessionId) {
        // Navigate existing session
        onNavigate(url);
      } else {
        // Create new session
        onCreateSession(url);
      }
    },
    [urlInput, sessionId, onNavigate, onCreateSession]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Reset to current URL
        setUrlInput(currentUrl || 'https://');
      }
    },
    [currentUrl]
  );

  const getStatusColor = () => {
    switch (sessionStatus) {
      case 'ready':
      case 'streaming':
        return 'var(--accent-success)';
      case 'connecting':
        return 'var(--accent-warning)';
      case 'scraping':
        return 'var(--accent-primary)';
      default:
        return 'var(--accent-error)';
    }
  };

  const getStatusText = () => {
    switch (sessionStatus) {
      case 'ready':
        return 'Ready';
      case 'streaming':
        return 'Streaming';
      case 'connecting':
        return 'Connecting...';
      case 'scraping':
        return 'Scraping...';
      default:
        return 'Disconnected';
    }
  };

  return (
    <div className="nav-bar" style={{ position: 'relative' }}>
      {/* Back/Forward buttons */}
      <button
        className="btn btn-icon"
        onClick={() => {
          // Would need to implement browser history
        }}
        disabled={!sessionId}
        title="Back"
      >
        ←
      </button>
      <button
        className="btn btn-icon"
        onClick={() => {
          // Would need to implement browser history
        }}
        disabled={!sessionId}
        title="Forward"
      >
        →
      </button>
      <button
        className="btn btn-icon"
        onClick={() => sessionId && onNavigate(currentUrl)}
        disabled={!sessionId}
        title="Refresh"
      >
        ↻
      </button>

      {/* URL Input */}
      <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex', gap: 8 }}>
        <input
          type="text"
          className="url-input"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter URL..."
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary">
          {sessionId ? 'Go' : 'Start Session'}
        </button>
      </form>

      {/* Session controls */}
      {sessionId && (
        <button className="btn btn-danger" onClick={onDestroySession} title="End Session">
          End
        </button>
      )}

      {/* Captured URLs dropdown */}
      {capturedUrls.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button
            className="btn btn-icon"
            onClick={() => setShowCapturedUrls(!showCapturedUrls)}
            title={`${capturedUrls.length} captured URLs`}
            style={{ position: 'relative' }}
          >
            <span style={{ fontSize: 14 }}>&#128279;</span>
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                background: 'var(--accent-primary)',
                color: 'white',
                borderRadius: '50%',
                width: 16,
                height: 16,
                fontSize: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {capturedUrls.length}
            </span>
          </button>

          {showCapturedUrls && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                minWidth: 300,
                maxWidth: 500,
                maxHeight: 300,
                overflowY: 'auto',
                zIndex: 1000,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
            >
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', fontWeight: 500 }}>
                Captured URLs ({capturedUrls.length})
              </div>
              {capturedUrls.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onClick={() => {
                    onNavigate(item.url);
                    setShowCapturedUrls(false);
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.text || item.title || new URL(item.url).pathname}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.url}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status indicator */}
      <div className="status-indicator">
        <div
          className={`status-dot ${sessionStatus === 'connecting' ? 'connecting' : ''}`}
          style={{ background: getStatusColor() }}
        />
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{getStatusText()}</span>
      </div>

      {/* Hovered URL preview bar */}
      {hoveredUrl && (
        <div
          style={{
            position: 'absolute',
            bottom: -28,
            left: 0,
            right: 0,
            background: 'var(--bg-secondary)',
            borderTop: '1px solid var(--border-color)',
            padding: '4px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            zIndex: 100,
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>Link:</span>
          <span
            style={{
              color: 'var(--accent-primary)',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {hoveredUrl.url}
          </span>
          {onCaptureUrl && (
            <button
              className="btn btn-sm"
              onClick={() => onCaptureUrl(hoveredUrl.url, hoveredUrl.text)}
              style={{ padding: '2px 8px', fontSize: 11 }}
              title="Save this URL"
            >
              + Capture
            </button>
          )}
        </div>
      )}
    </div>
  );
};
