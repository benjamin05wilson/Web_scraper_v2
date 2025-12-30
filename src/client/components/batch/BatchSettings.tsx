import { useState } from 'react';
import { Modal } from '../common/Modal';

interface BatchSettingsProps {
  targetProducts: number;
  fastMode: boolean;
  onTargetProductsChange: (value: number) => void;
  onFastModeChange: (enabled: boolean) => void;
}

export function BatchSettings({
  targetProducts,
  fastMode,
  onTargetProductsChange,
  onFastModeChange,
}: BatchSettingsProps) {
  const [showFastModeInfo, setShowFastModeInfo] = useState(false);

  return (
    <>
      <div className="card">
        <h2 style={{ fontSize: '1.25em', marginBottom: '20px' }}>3. Settings</h2>
        <div style={{ display: 'flex', gap: '30px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label
              style={{
                fontSize: '0.85em',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              Products per URL:
            </label>
            <input
              type="number"
              value={targetProducts}
              onChange={(e) => onTargetProductsChange(parseInt(e.target.value) || 100)}
              min={1}
              max={1000}
              style={{
                width: '80px',
                padding: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 15px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            <input
              type="checkbox"
              id="batch-fast-mode"
              checked={fastMode}
              onChange={(e) => onFastModeChange(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label
              htmlFor="batch-fast-mode"
              style={{ fontSize: '0.85em', color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}
            >
              Fast Mode
            </label>
            <button
              onClick={() => setShowFastModeInfo(true)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '0.75em',
                fontWeight: 'bold',
                padding: '2px 8px',
                marginLeft: '5px',
              }}
              title="What is Fast Mode?"
            >
              ?
            </button>
          </div>
        </div>
      </div>

      <Modal
        isOpen={showFastModeInfo}
        onClose={() => setShowFastModeInfo(false)}
        title="Fast Mode"
      >
        <div style={{ marginBottom: '20px' }}>
          <h4
            style={{
              margin: '0 0 10px 0',
              color: 'var(--accent-success)',
              fontSize: '0.9em',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            What it does:
          </h4>
          <ul
            style={{
              margin: 0,
              paddingLeft: '20px',
              color: 'var(--text-secondary)',
              fontSize: '0.9em',
              lineHeight: 1.8,
            }}
          >
            <li>
              <strong>Blocks images, CSS, fonts and media</strong> - Faster page loads
            </li>
            <li>
              <strong>Faster navigation</strong> - Uses "commit" instead of waiting for full load
            </li>
            <li>
              <strong>Shorter waits</strong> - 0.3-0.5s delays instead of 1-2s
            </li>
          </ul>
        </div>
        <div>
          <h4
            style={{
              margin: '0 0 10px 0',
              color: 'var(--accent-danger)',
              fontSize: '0.9em',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            Important:
          </h4>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.9em', lineHeight: 1.8 }}>
            <li style={{ color: 'var(--accent-danger)' }}>
              <strong>May miss products</strong> on slow-loading sites
            </li>
            <li style={{ color: 'var(--accent-danger)' }}>
              <strong>Images won't load</strong> in preview (data still extracted)
            </li>
            <li style={{ color: 'var(--text-secondary)' }}>Some sites may detect resource blocking</li>
          </ul>
        </div>
        <div
          style={{
            marginTop: '20px',
            padding: '15px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            fontSize: '0.85em',
          }}
        >
          <strong style={{ color: 'var(--accent-success)' }}>Use ON:</strong> High-volume scraping, fast sites
          <br />
          <strong style={{ color: 'var(--accent-danger)' }}>Use OFF:</strong> Sites with lazy-loading, heavy JS, or
          bot protection
        </div>
      </Modal>
    </>
  );
}
