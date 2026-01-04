import { useState, useEffect, FormEvent } from 'react';
import { Modal } from '../common/Modal';
import { ConfigSelect } from '../common/ConfigSelect';
import { CronBuilder } from './CronBuilder';
import { CRON_PRESETS } from '../../utils/cronUtils';
import type { Schedule, Config } from '../../../shared/types';

interface CreateScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<Schedule, 'id' | 'created_at' | 'last_run'>) => Promise<void>;
}

export function CreateScheduleModal({ isOpen, onClose, onSave }: CreateScheduleModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'scraper' | 'batch'>('scraper');
  const [config, setConfig] = useState('');
  const [csvPath, setCsvPath] = useState('');
  const [cron, setCron] = useState<string>(CRON_PRESETS.daily);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);

  // Load configs when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setType('scraper');
      setConfig('');
      setCsvPath('');
      setCron(CRON_PRESETS.daily);
      setError(null);

      // Fetch available configs
      setLoadingConfigs(true);
      fetch('/api/configs')
        .then(res => res.json())
        .then(data => setConfigs(data.configs || []))
        .catch(() => setConfigs([]))
        .finally(() => setLoadingConfigs(false));
    }
  }, [isOpen]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please enter a schedule name');
      return;
    }

    if (type === 'scraper' && !config) {
      setError('Please select a configuration');
      return;
    }

    if (type === 'batch' && !csvPath.trim()) {
      setError('Please enter a CSV file path');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        type,
        config: type === 'scraper' ? config : undefined,
        csv_path: type === 'batch' ? csvPath.trim() : undefined,
        schedule: cron,
        enabled: true,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Schedule"
      size="large"
      footer={
        <>
          <button className="btn secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn" onClick={handleSubmit} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Create Schedule'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="error-message" style={{ marginBottom: '20px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Schedule Name</label>
          <input
            type="text"
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Daily Product Scrape"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Task Type</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                padding: '15px 20px',
                background: 'var(--bg-secondary)',
                border: `1px solid ${type === 'scraper' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                flex: 1,
              }}
            >
              <input
                type="radio"
                name="scheduleType"
                value="scraper"
                checked={type === 'scraper'}
                onChange={() => setType('scraper')}
                style={{ cursor: 'pointer' }}
              />
              <div>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>Single Scrape</span>
                <small style={{ color: 'var(--text-secondary)', fontSize: '0.85em' }}>Run one URL with a config</small>
              </div>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                padding: '15px 20px',
                background: 'var(--bg-secondary)',
                border: `1px solid ${type === 'batch' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                flex: 1,
              }}
            >
              <input
                type="radio"
                name="scheduleType"
                value="batch"
                checked={type === 'batch'}
                onChange={() => setType('batch')}
                style={{ cursor: 'pointer' }}
              />
              <div>
                <span style={{ fontWeight: 600, display: 'block', marginBottom: '4px' }}>Batch Scrape</span>
                <small style={{ color: 'var(--text-secondary)', fontSize: '0.85em' }}>Process CSV file with URLs</small>
              </div>
            </label>
          </div>
        </div>

        {type === 'scraper' && (
          <div className="form-group">
            <label className="form-label">Configuration</label>
            <ConfigSelect
              configs={configs}
              value={config}
              onChange={setConfig}
              placeholder="Select a config..."
              loading={loadingConfigs}
            />
          </div>
        )}

        {type === 'batch' && (
          <div className="form-group">
            <label className="form-label">CSV File Path</label>
            <input
              type="text"
              className="form-input"
              value={csvPath}
              onChange={(e) => setCsvPath(e.target.value)}
              placeholder="e.g., C:\data\urls.csv"
            />
            <small style={{ display: 'block', marginTop: '8px', fontSize: '0.85em', color: 'var(--text-secondary)' }}>
              Full path to the CSV file containing URLs to scrape
            </small>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Schedule</label>
          <CronBuilder value={cron} onChange={setCron} />
        </div>
      </form>
    </Modal>
  );
}
