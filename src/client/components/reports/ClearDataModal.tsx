import { useState } from 'react';
import { Modal } from '../common/Modal';

interface ClearDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (country: string | null, beforeDate: string | null) => Promise<void>;
  countries: string[];
}

export function ClearDataModal({ isOpen, onClose, onConfirm, countries }: ClearDataModalProps) {
  const [country, setCountry] = useState('');
  const [beforeDate, setBeforeDate] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(country || null, beforeDate || null);
      setCountry('');
      setBeforeDate('');
      onClose();
    } catch (err) {
      console.error('Failed to clear data:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Clear Product Data"
      footer={
        <>
          <button className="btn secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={handleConfirm} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Clear Data'}
          </button>
        </>
      }
    >
      <p style={{ marginBottom: '10px' }}>Are you sure you want to clear product data?</p>

      <div className="form-group" style={{ marginBottom: '15px' }}>
        <label className="form-label">Clear products from:</label>
        <select
          className="form-select"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          <option value="">All Countries</option>
          {countries.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Clear products scraped before:</label>
        <input
          type="date"
          className="form-input"
          value={beforeDate}
          onChange={(e) => setBeforeDate(e.target.value)}
        />
      </div>

      <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginTop: '15px' }}>
        Leave fields empty to clear all data. This action cannot be undone.
      </p>
    </Modal>
  );
}
