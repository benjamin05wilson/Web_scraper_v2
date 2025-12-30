import React, { useRef, useEffect } from 'react';

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'selected';
}

interface ActivityLogProps {
  entries: LogEntry[];
  onClear: () => void;
}

const TYPE_COLORS: Record<LogEntry['type'], string> = {
  info: 'var(--text-secondary)',
  success: 'var(--accent-success)',
  error: '#ff6b6b',
  selected: '#4ecdc4',
};

export function ActivityLog({ entries, onClear }: ActivityLogProps) {
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          padding: '12px 15px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: '0.75em',
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            fontWeight: 700,
            color: 'var(--text-secondary)',
          }}
        >
          Selection Log
        </span>
        <button
          onClick={onClear}
          style={{
            padding: '4px 12px',
            fontSize: '0.75em',
            background: 'transparent',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Clear
        </button>
      </div>

      <div
        ref={logRef}
        style={{
          height: '150px',
          overflowY: 'auto',
          padding: '15px',
          fontFamily: 'monospace',
          fontSize: '0.85em',
          background: 'var(--bg-primary)',
        }}
      >
        {entries.length === 0 ? (
          <div className="log-entry" style={{ color: 'var(--text-secondary)', padding: '4px 0' }}>
            Ready. Open a browser to start selecting elements.
          </div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={index}
              className="log-entry"
              style={{
                padding: '4px 0',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
              }}
            >
              <span style={{ color: 'var(--text-secondary)', opacity: 0.6, minWidth: '65px' }}>
                {entry.timestamp}
              </span>
              <span style={{ color: TYPE_COLORS[entry.type], flex: 1 }}>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function createLogEntry(message: string, type: LogEntry['type'] = 'info'): LogEntry {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  return { timestamp, message, type };
}
