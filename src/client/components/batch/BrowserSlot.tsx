import type { BrowserSlot as BrowserSlotType } from '../../../shared/types';

interface BrowserSlotProps {
  slot: BrowserSlotType;
  onClick: () => void;
}

export function BrowserSlot({ slot, onClick }: BrowserSlotProps) {
  const statusColors: Record<string, string> = {
    idle: 'var(--text-secondary)',
    loading: 'var(--accent-warning)',
    scraping: 'var(--accent-success)',
    running: 'var(--accent-success)',
    captcha: 'var(--accent-warning)',
    error: 'var(--accent-danger)',
  };

  const statusLabels: Record<string, string> = {
    idle: 'Idle',
    loading: 'Loading...',
    scraping: 'Scraping',
    running: 'Running',
    captcha: 'CAPTCHA',
    error: 'Error',
  };

  const isCaptchaMode = slot.status === 'captcha';

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-card)',
        border: isCaptchaMode ? '2px solid var(--accent-warning)' : '1px solid var(--border-color)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        boxShadow: isCaptchaMode ? '0 0 10px rgba(255, 165, 0, 0.4)' : 'none',
        position: 'relative',
      }}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = isCaptchaMode ? 'var(--accent-warning)' : 'var(--accent-color)')}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = isCaptchaMode ? 'var(--accent-warning)' : 'var(--border-color)')}
    >
      {/* Slot Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-secondary)',
        }}
      >
        <span style={{ fontSize: '0.75em', fontWeight: 600 }}>Tab {slot.id + 1}</span>
        <span
          style={{
            fontSize: '0.7em',
            padding: '2px 6px',
            background: 'var(--bg-primary)',
            color: statusColors[slot.status],
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {statusLabels[slot.status]}
        </span>
      </div>

      {/* Frame Display */}
      <div
        style={{
          height: '120px',
          background: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {slot.frameData ? (
          <img
            src={slot.frameData}
            alt={`Tab ${slot.id + 1} preview`}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75em' }}>
            {slot.status === 'idle' ? 'Waiting...' : 'Loading...'}
          </span>
        )}

        {/* Captcha overlay indicator */}
        {isCaptchaMode && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'rgba(255, 165, 0, 0.9)',
              color: 'white',
              padding: '6px 8px',
              fontSize: '0.7em',
              fontWeight: 600,
              textAlign: 'center',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Click to solve CAPTCHA
          </div>
        )}
      </div>

      {/* Current Job Info */}
      {slot.currentJob && (
        <div style={{ padding: '8px 12px', fontSize: '0.75em', color: 'var(--text-secondary)' }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {slot.currentJob.domain}
          </div>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.7 }}>
            {slot.currentJob.category}
          </div>
        </div>
      )}
    </div>
  );
}
