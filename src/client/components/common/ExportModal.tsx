// ============================================================================
// EXPORT MODAL - Select export format and download data
// ============================================================================

import React, { useState } from 'react';
import type { ScrapedItem, ExportFormat } from '../../../shared/types';
import { exportToJSON } from '../../utils/export/exportJSON';
import { exportToCSV } from '../../utils/export/exportCSV';
import { exportToExcel } from '../../utils/export/exportExcel';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: ScrapedItem[];
  defaultFilename?: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  items,
  defaultFilename = 'scrape-results',
}) => {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('json');
  const [filename, setFilename] = useState(defaultFilename);

  if (!isOpen) return null;

  const handleExport = () => {
    const name = filename.trim() || defaultFilename;

    switch (selectedFormat) {
      case 'json':
        exportToJSON(items, { filename: name, pretty: true });
        break;
      case 'csv':
        exportToCSV(items, { filename: name });
        break;
      case 'xlsx':
        exportToExcel(items, { filename: name });
        break;
    }

    onClose();
  };

  const formats: { value: ExportFormat; title: string; description: string; icon: string }[] = [
    {
      value: 'json',
      title: 'JSON',
      description: 'JavaScript Object Notation - Best for developers',
      icon: '{ }',
    },
    {
      value: 'csv',
      title: 'CSV',
      description: 'Comma-Separated Values - Compatible with Excel, Google Sheets',
      icon: ',',
    },
    {
      value: 'xlsx',
      title: 'Excel',
      description: 'Native Excel format with formatting',
      icon: 'XL',
    },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Export Data</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Filename</label>
            <input
              type="text"
              className="form-input"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="Enter filename"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Format</label>
            <div className="export-options">
              {formats.map((format) => (
                <div
                  key={format.value}
                  className={`export-option ${selectedFormat === format.value ? 'selected' : ''}`}
                  onClick={() => setSelectedFormat(format.value)}
                >
                  <div className="export-option-icon">{format.icon}</div>
                  <div className="export-option-info">
                    <div className="export-option-title">{format.title}</div>
                    <div className="export-option-description">{format.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            {items.length} item{items.length !== 1 ? 's' : ''} will be exported
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={items.length === 0}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
};
