import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import type { Config } from '../../../shared/types';

interface EditConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: Config;
  onSave: (updates: Partial<Config>) => Promise<void>;
}

export function EditConfigModal({
  isOpen,
  onClose,
  config,
  onSave,
}: EditConfigModalProps) {
  const [formData, setFormData] = useState({
    Title: '',
    Price: '',
    URL: '',
    Image: '',
    OriginalPrice: '',
    paginationType: 'none',
    paginationPattern: '',
    paginationSelector: '',
    maxPages: 10,
    startPage: 1,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setFormData({
        Title: formatSelector(config.selectors?.Title),
        Price: formatSelector(config.selectors?.Price),
        URL: formatSelector(config.selectors?.URL),
        Image: formatSelector(config.selectors?.Image),
        OriginalPrice: formatSelector(config.selectors?.OriginalPrice),
        paginationType: config.pagination?.type || 'none',
        paginationPattern: config.pagination?.pattern || '',
        paginationSelector: config.pagination?.selector || '',
        maxPages: config.pagination?.max_pages || 10,
        startPage: config.pagination?.start_page || 1,
      });
    }
  }, [config]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const updates: Partial<Config> = {
        selectors: {
          Title: parseSelector(formData.Title),
          Price: parseSelector(formData.Price),
          URL: parseSelector(formData.URL),
          Image: parseSelector(formData.Image),
          OriginalPrice: parseSelector(formData.OriginalPrice),
        },
      };

      if (formData.paginationType !== 'none') {
        updates.pagination = {
          type: formData.paginationType as Config['pagination']['type'],
          pattern: formData.paginationPattern || undefined,
          selector: formData.paginationSelector || undefined,
          max_pages: formData.maxPages,
          start_page: formData.startPage,
        };
      }

      await onSave(updates);
      onClose();
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit: ${config.name}`}
      size="large"
      footer={
        <>
          <button className="btn secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn" onClick={handleSubmit} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save Changes'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <h4 style={{ marginBottom: '20px' }}>Selectors</h4>

        <div className="form-group">
          <label className="form-label">Title Selector</label>
          <textarea
            className="field-textarea"
            value={formData.Title}
            onChange={(e) => setFormData({ ...formData, Title: e.target.value })}
            placeholder="CSS selector for product title"
            rows={2}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Price Selector</label>
          <textarea
            className="field-textarea"
            value={formData.Price}
            onChange={(e) => setFormData({ ...formData, Price: e.target.value })}
            placeholder="CSS selector for product price"
            rows={2}
          />
        </div>

        <div className="form-group">
          <label className="form-label">URL Selector</label>
          <textarea
            className="field-textarea"
            value={formData.URL}
            onChange={(e) => setFormData({ ...formData, URL: e.target.value })}
            placeholder="CSS selector for product URL"
            rows={2}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Image Selector</label>
          <textarea
            className="field-textarea"
            value={formData.Image}
            onChange={(e) => setFormData({ ...formData, Image: e.target.value })}
            placeholder="CSS selector for product image"
            rows={2}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Original Price Selector</label>
          <textarea
            className="field-textarea"
            value={formData.OriginalPrice}
            onChange={(e) => setFormData({ ...formData, OriginalPrice: e.target.value })}
            placeholder="CSS selector for original/strikethrough price"
            rows={2}
          />
        </div>

        <h4 style={{ marginTop: '30px', marginBottom: '20px' }}>Pagination</h4>

        <div className="form-group">
          <label className="form-label">Pagination Type</label>
          <select
            className="form-select"
            value={formData.paginationType}
            onChange={(e) => setFormData({ ...formData, paginationType: e.target.value })}
          >
            <option value="none">None</option>
            <option value="url_pattern">URL Pattern</option>
            <option value="next_page">Next Page Button</option>
            <option value="infinite_scroll">Infinite Scroll</option>
          </select>
        </div>

        {formData.paginationType === 'url_pattern' && (
          <div className="form-group">
            <label className="form-label">URL Pattern</label>
            <input
              type="text"
              className="form-input"
              value={formData.paginationPattern}
              onChange={(e) => setFormData({ ...formData, paginationPattern: e.target.value })}
              placeholder="e.g., /page/{page} or ?page={page}"
            />
          </div>
        )}

        {formData.paginationType === 'next_page' && (
          <div className="form-group">
            <label className="form-label">Next Page Selector</label>
            <input
              type="text"
              className="form-input"
              value={formData.paginationSelector}
              onChange={(e) => setFormData({ ...formData, paginationSelector: e.target.value })}
              placeholder="CSS selector for next page button"
            />
          </div>
        )}

        {formData.paginationType !== 'none' && (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Max Pages</label>
              <input
                type="number"
                className="form-input"
                value={formData.maxPages}
                onChange={(e) => setFormData({ ...formData, maxPages: parseInt(e.target.value) || 10 })}
                min={1}
                max={100}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Start Page</label>
              <input
                type="number"
                className="form-input"
                value={formData.startPage}
                onChange={(e) => setFormData({ ...formData, startPage: parseInt(e.target.value) || 1 })}
                min={1}
              />
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

function formatSelector(value: string | string[] | undefined): string {
  if (!value) return '';
  if (Array.isArray(value)) return value.join('\n');
  return value;
}

function parseSelector(value: string): string | string[] | undefined {
  if (!value.trim()) return undefined;
  const lines = value.split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  if (lines.length === 1) return lines[0];
  return lines;
}
