import React, { useEffect, useRef, useCallback } from 'react';
import { Modal } from '../common/Modal';
import type { BrowserSlot } from '../../../shared/types';

interface ExpandedBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  slot: BrowserSlot | null;
  onInput: (type: string, data: unknown) => void;
}

export function ExpandedBrowserModal({ isOpen, onClose, slot, onInput }: ExpandedBrowserModalProps) {
  const imgRef = useRef<HTMLImageElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (!imgRef.current) return;

      const rect = imgRef.current.getBoundingClientRect();
      const scaleX = imgRef.current.naturalWidth / rect.width;
      const scaleY = imgRef.current.naturalHeight / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      onInput('click', { x: Math.round(x), y: Math.round(y) });
    },
    [onInput]
  );

  const handleScroll = useCallback(
    (e: React.WheelEvent<HTMLImageElement>) => {
      e.preventDefault();
      onInput('scroll', { deltaY: e.deltaY });
    },
    [onInput]
  );

  if (!slot) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Tab ${slot.id + 1} - ${slot.currentJob?.domain || 'Idle'}`} size="large">
      <div
        style={{
          background: '#1a1a1a',
          minHeight: '400px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {slot.frameData ? (
          <img
            ref={imgRef}
            src={slot.frameData}
            alt={`Tab ${slot.id + 1}`}
            onClick={handleClick}
            onWheel={handleScroll}
            style={{
              maxWidth: '100%',
              maxHeight: '70vh',
              cursor: 'pointer',
              objectFit: 'contain',
            }}
          />
        ) : (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px' }}>
            <p>No browser frame available</p>
            <p style={{ fontSize: '0.85em', opacity: 0.7 }}>
              {slot.status === 'idle' ? 'Waiting to start...' : 'Loading...'}
            </p>
          </div>
        )}
      </div>

      {slot.currentJob && (
        <div style={{ marginTop: '20px', padding: '15px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85em' }}>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Domain: </span>
              <span>{slot.currentJob.domain}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Category: </span>
              <span>{slot.currentJob.category}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Country: </span>
              <span>{slot.currentJob.country}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Status: </span>
              <span>{slot.status}</span>
            </div>
          </div>
          {slot.currentUrl && (
            <div style={{ marginTop: '10px', fontSize: '0.8em', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
              URL: {slot.currentUrl}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
