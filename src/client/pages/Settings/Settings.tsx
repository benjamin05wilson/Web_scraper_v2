// ============================================================================
// SETTINGS PAGE - App configuration
// ============================================================================

import React, { useState, useEffect } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useScraperContext } from '../../context/ScraperContext';
import type { ExportFormat, ThemeMode } from '../../../shared/types';

const STORAGE_KEY = 'web-scraper-settings';

export const Settings: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { savedScrapers, savedResults, clearAllResults } = useScraperContext();
  const [defaultExportFormat, setDefaultExportFormat] = useState<ExportFormat>('json');

  // Load settings
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.defaultExportFormat) {
          setDefaultExportFormat(settings.defaultExportFormat);
        }
      }
    } catch (e) {
      console.error('[Settings] Failed to load settings:', e);
    }
  }, []);

  // Save export format preference
  const handleExportFormatChange = (format: ExportFormat) => {
    setDefaultExportFormat(format);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const settings = stored ? JSON.parse(stored) : {};
      settings.defaultExportFormat = format;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('[Settings] Failed to save settings:', e);
    }
  };

  const handleClearResults = () => {
    if (confirm('Delete ALL scrape results? This cannot be undone.')) {
      clearAllResults();
    }
  };

  const handleClearAllData = () => {
    if (confirm('Delete ALL data including scrapers and results? This cannot be undone.')) {
      localStorage.removeItem('web-scraper-scrapers');
      localStorage.removeItem('web-scraper-results');
      window.location.reload();
    }
  };

  const themeOptions: { value: ThemeMode; label: string; description: string }[] = [
    { value: 'dark', label: 'Dark', description: 'Dark theme (default)' },
    { value: 'light', label: 'Light', description: 'Light theme' },
    { value: 'system', label: 'System', description: 'Follow system preference' },
  ];

  const exportOptions: { value: ExportFormat; label: string; description: string }[] = [
    { value: 'json', label: 'JSON', description: 'JavaScript Object Notation' },
    { value: 'csv', label: 'CSV', description: 'Comma-Separated Values' },
    { value: 'xlsx', label: 'Excel', description: 'Excel Spreadsheet (.xlsx)' },
  ];

  return (
    <div className="page-container" style={{ flex: 1, background: 'var(--bg-primary)' }}>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="page-content" style={{ maxWidth: 600 }}>
        {/* Appearance */}
        <div className="settings-section">
          <div className="settings-section-title">Appearance</div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Theme</div>
              <div className="settings-item-description">Choose your preferred color scheme</div>
            </div>
            <select
              className="form-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value as ThemeMode)}
              style={{ width: 140 }}
            >
              {themeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Export */}
        <div className="settings-section">
          <div className="settings-section-title">Export</div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Default Export Format</div>
              <div className="settings-item-description">Pre-selected format when exporting data</div>
            </div>
            <select
              className="form-select"
              value={defaultExportFormat}
              onChange={(e) => handleExportFormatChange(e.target.value as ExportFormat)}
              style={{ width: 140 }}
            >
              {exportOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Data Management */}
        <div className="settings-section">
          <div className="settings-section-title">Data Management</div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Storage Used</div>
              <div className="settings-item-description">
                {savedScrapers.length} scrapers, {savedResults.length} results
              </div>
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Clear Results</div>
              <div className="settings-item-description">Delete all scraped results (keeps scrapers)</div>
            </div>
            <button className="btn btn-danger" onClick={handleClearResults}>
              Clear Results
            </button>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Clear All Data</div>
              <div className="settings-item-description">Delete all scrapers and results</div>
            </div>
            <button className="btn btn-danger" onClick={handleClearAllData}>
              Clear All
            </button>
          </div>
        </div>

        {/* About */}
        <div className="settings-section">
          <div className="settings-section-title">About</div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Web Scraper v2</div>
              <div className="settings-item-description">
                Visual web scraping tool with browser automation
              </div>
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Technology</div>
              <div className="settings-item-description">
                Playwright, React, TypeScript, WebSocket
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
