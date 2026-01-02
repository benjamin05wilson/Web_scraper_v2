// ============================================================================
// POPUP DETECTION PANEL - For recording popup dismissal actions
// ============================================================================

import type { DismissAction } from '../../hooks/useAutomatedBuilderFlow';

interface PopupDetectionPanelProps {
  isRecording: boolean;
  dismissActions: DismissAction[];
  onFinishRecording: () => void;
}

export function PopupDetectionPanel({
  isRecording,
  dismissActions,
  onFinishRecording,
}: PopupDetectionPanelProps) {
  return (
    <div className="step-card">
      <h2 className="step-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </svg>
          Close Popups
        </span>
        {isRecording && (
          <span
            style={{
              background: '#ff9800',
              color: 'white',
              padding: '4px 10px',
              borderRadius: '12px',
              fontSize: '0.7em',
              fontWeight: 600,
              marginLeft: 'auto',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          >
            RECORDING
          </span>
        )}
      </h2>

      {isRecording ? (
        <>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '15px', lineHeight: 1.6 }}>
            Click on any popups, cookie banners, or modals in the browser to close them.
            Each click will be recorded.
          </p>

          {dismissActions.length > 0 && (
            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '12px',
                marginBottom: '15px',
              }}
            >
              <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Recorded actions:
              </div>
              {dismissActions.map((action, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 0',
                    borderBottom: index < dismissActions.length - 1 ? '1px solid var(--border-color)' : 'none',
                  }}
                >
                  <span
                    style={{
                      background: 'var(--accent-success)',
                      color: 'white',
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.75em',
                      fontWeight: 600,
                    }}
                  >
                    {index + 1}
                  </span>
                  <code
                    style={{
                      fontSize: '0.8em',
                      color: 'var(--accent-primary)',
                      background: 'var(--bg-primary)',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '250px',
                    }}
                  >
                    {action.text || action.selector}
                  </code>
                </div>
              ))}
            </div>
          )}

          <button
            className="btn-large"
            onClick={onFinishRecording}
            style={{
              width: '100%',
              background: 'var(--accent-success)',
              borderColor: 'var(--accent-success)',
            }}
          >
            Done - All Popups Closed
          </button>
        </>
      ) : (
        <p style={{ color: 'var(--text-tertiary)', margin: 0 }}>
          Waiting for popup confirmation...
        </p>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
