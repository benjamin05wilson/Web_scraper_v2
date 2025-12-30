import React from 'react';

interface DismissAction {
  selector: string;
  text?: string;
  isLanguageRelated?: boolean;
  x?: number;
  y?: number;
}

interface DismissPanelProps {
  dismissMode: boolean;
  onToggleDismissMode: () => void;
  dismissActions: DismissAction[];
  disabled?: boolean;
}

export function DismissPanel({
  dismissMode,
  onToggleDismissMode,
  dismissActions,
  disabled = false,
}: DismissPanelProps) {
  return (
    <div className="step-card">
      <h2 className="step-title">Dismiss Popups</h2>

      <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '15px', lineHeight: 1.6 }}>
        Click cookie banners, popups, or overlays to dismiss them. These clicks will be recorded and replayed before scraping.
      </p>

      <button
        className="btn-large"
        onClick={onToggleDismissMode}
        disabled={disabled}
        style={{
          width: '100%',
          background: dismissMode ? 'var(--accent-danger)' : '#ff9800',
          borderColor: dismissMode ? 'var(--accent-danger)' : '#ff9800',
          color: dismissMode ? 'white' : '#000',
        }}
      >
        {dismissMode ? 'STOP RECORDING' : 'RECORD CLICKS'}
      </button>

      <div style={{ marginTop: '15px', fontSize: '0.85em', color: 'var(--text-secondary)' }}>
        <span>{dismissActions.length}</span> dismiss action(s) recorded
      </div>
    </div>
  );
}
