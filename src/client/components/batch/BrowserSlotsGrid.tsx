import React from 'react';
import type { BrowserSlot as BrowserSlotType } from '../../../shared/types';
import { BrowserSlot } from './BrowserSlot';

interface BrowserSlotsGridProps {
  slots: BrowserSlotType[];
  onSlotClick: (slotId: number) => void;
  status: string;
}

export function BrowserSlotsGrid({ slots, onSlotClick, status }: BrowserSlotsGridProps) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ margin: 0, fontSize: '1.1em' }}>
          Live Tabs ({slots.length} Concurrent in 1 Browser)
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <span
            style={{
              fontSize: '0.75em',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            Click previews to interact
          </span>
          <span className="badge badge-realm">{status}</span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '15px',
        }}
      >
        {slots.map((slot) => (
          <BrowserSlot key={slot.id} slot={slot} onClick={() => onSlotClick(slot.id)} />
        ))}
      </div>
    </div>
  );
}
