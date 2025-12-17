// ============================================================================
// NAVIGATION BAR - URL input and session controls
// ============================================================================

import React, { useState, useCallback } from 'react';

interface NavBarProps {
  currentUrl: string;
  sessionStatus: 'disconnected' | 'connecting' | 'ready' | 'streaming' | 'scraping';
  onNavigate: (url: string) => void;
  onCreateSession: (url: string) => void;
  onDestroySession: () => void;
  sessionId: string | null;
}

export const NavBar: React.FC<NavBarProps> = ({
  currentUrl,
  sessionStatus,
  onNavigate,
  onCreateSession,
  onDestroySession,
  sessionId,
}) => {
  const [urlInput, setUrlInput] = useState(currentUrl || 'https://');

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
    <div className="nav-bar">
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

      {/* Status indicator */}
      <div className="status-indicator">
        <div
          className={`status-dot ${sessionStatus === 'connecting' ? 'connecting' : ''}`}
          style={{ background: getStatusColor() }}
        />
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{getStatusText()}</span>
      </div>
    </div>
  );
};
