import React from 'react';
import type { BrowserSlot as BrowserSlotType } from '../../../shared/types';

interface BrowserSlotProps {
  slot: BrowserSlotType;
  onClick: () => void;
}

export function BrowserSlot({ slot, onClick }: BrowserSlotProps) {
  const statusColors: Record<string, string> = {
    idle: 'var(--text-secondary)',
    loading: 'var(--accent-warning)',
    running: 'var(--accent-success)',
    error: 'var(--accent-danger)',
  };

  const statusLabels: Record<string, string> = {
    idle: 'Idle',
    loading: 'Loading...',
    running: 'Running',
    error: 'Error',
  };

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--accent-color)')}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)')}
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
