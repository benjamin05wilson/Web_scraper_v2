// ============================================================================
// SETTINGS PAGE - App configuration
// ============================================================================

import React, { useState, useEffect } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useScraperContext } from '../../context/ScraperContext';
import { useToast } from '../../context/ToastContext';
import { ConfirmModal } from '../../components/common';
import type { ExportFormat, ThemeMode } from '../../../shared/types';

const STORAGE_KEY = 'web-scraper-settings';

interface AppSettings {
  defaultExportFormat: ExportFormat;
  maxPages: number;
  delayBetweenPages: number;
  autoSaveResults: boolean;
  includeMetadata: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultExportFormat: 'json',
  maxPages: 10,
  delayBetweenPages: 1000,
  autoSaveResults: true,
  includeMetadata: true,
};

export const Settings: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { savedScrapers, savedResults, clearAllResults, clearAllData, exportBackup, importBackup, totalScrapedItems } = useScraperContext();
  const { showToast } = useToast();

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'clearResults' | 'clearAll' | null>(null);

  // Load settings
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const loadedSettings = JSON.parse(stored);
        setSettings({ ...DEFAULT_SETTINGS, ...loadedSettings });
      }
    } catch (e) {
      console.error('[Settings] Failed to load settings:', e);
    }
  }, []);

  // Save settings
  const updateSettings = (updates: Partial<AppSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
      showToast('Settings saved', 'success');
    } catch (e) {
      console.error('[Settings] Failed to save settings:', e);
      showToast('Failed to save settings', 'error');
    }
  };

  const handleClearResults = () => {
    clearAllResults();
    setConfirmAction(null);
    showToast('All results cleared', 'success');
  };

  const handleClearAllData = () => {
    clearAllData();
    setConfirmAction(null);
    showToast('All data cleared', 'success');
  };

  const handleExportBackup = () => {
    const backupData = exportBackup();
    const blob = new Blob([backupData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `web-scraper-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Backup downloaded', 'success');
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target?.result as string;
      if (importBackup(data)) {
        showToast('Backup imported successfully', 'success');
      } else {
        showToast('Failed to import backup - invalid file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ];

  const exportOptions: { value: ExportFormat; label: string }[] = [
    { value: 'json', label: 'JSON' },
    { value: 'csv', label: 'CSV' },
    { value: 'xlsx', label: 'Excel' },
  ];

  const shortcuts = [
    { key: 'Ctrl + N', description: 'Create new scraper' },
    { key: 'Ctrl + S', description: 'Save current scraper' },
    { key: 'Ctrl + E', description: 'Export results' },
    { key: 'Escape', description: 'Cancel selection / Close modal' },
    { key: 'Enter', description: 'Confirm action' },
    { key: '?', description: 'Show this help' },
  ];

  // Calculate storage size
  const calculateStorageSize = () => {
    try {
      const scrapersData = localStorage.getItem('web-scraper-scrapers') || '';
      const resultsData = localStorage.getItem('web-scraper-results') || '';
      const activitiesData = localStorage.getItem('web-scraper-activities') || '';
      const settingsData = localStorage.getItem(STORAGE_KEY) || '';
      const totalBytes = scrapersData.length + resultsData.length + activitiesData.length + settingsData.length;
      if (totalBytes < 1024) return `${totalBytes} B`;
      if (totalBytes < 1024 * 1024) return `${(totalBytes / 1024).toFixed(1)} KB`;
      return `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
    } catch {
      return 'Unknown';
    }
  };

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

        {/* Data & Export */}
        <div className="settings-section">
          <div className="settings-section-title">Data & Export</div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Default Export Format</div>
              <div className="settings-item-description">Pre-selected format when exporting data</div>
            </div>
            <select
              className="form-select"
              value={settings.defaultExportFormat}
              onChange={(e) => updateSettings({ defaultExportFormat: e.target.value as ExportFormat })}
              style={{ width: 140 }}
            >
              {exportOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Include Metadata</div>
              <div className="settings-item-description">Add timestamps and scraper info to exports</div>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.includeMetadata}
                onChange={(e) => updateSettings({ includeMetadata: e.target.checked })}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Download Backup</div>
              <div className="settings-item-description">Export all scrapers and results as JSON</div>
            </div>
            <button className="btn" onClick={handleExportBackup}>
              Download Backup
            </button>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Import Backup</div>
              <div className="settings-item-description">Restore scrapers and results from backup</div>
            </div>
            <label className="btn" style={{ cursor: 'pointer' }}>
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                style={{ display: 'none' }}
              />
              Choose File
            </label>
          </div>
        </div>

        {/* Scraping Defaults */}
        <div className="settings-section">
          <div className="settings-section-title">Scraping Defaults</div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Max Pages</div>
              <div className="settings-item-description">Default maximum pages to scrape (0 = unlimited)</div>
            </div>
            <input
              type="number"
              className="form-input"
              value={settings.maxPages}
              onChange={(e) => updateSettings({ maxPages: Math.max(0, parseInt(e.target.value) || 0) })}
              min={0}
              max={1000}
              style={{ width: 80 }}
            />
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Delay Between Pages</div>
              <div className="settings-item-description">Milliseconds to wait between page loads</div>
            </div>
            <input
              type="number"
              className="form-input"
              value={settings.delayBetweenPages}
              onChange={(e) => updateSettings({ delayBetweenPages: Math.max(0, parseInt(e.target.value) || 0) })}
              min={0}
              max={10000}
              step={100}
              style={{ width: 100 }}
            />
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Auto-save Results</div>
              <div className="settings-item-description">Automatically save results after scraping</div>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={settings.autoSaveResults}
                onChange={(e) => updateSettings({ autoSaveResults: e.target.checked })}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>

        {/* Data Management */}
        <div className="settings-section">
          <div className="settings-section-title">Data Management</div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Storage Used</div>
              <div className="settings-item-description">
                {savedScrapers.length} scrapers, {savedResults.length} results, {totalScrapedItems.toLocaleString()} items
              </div>
            </div>
            <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{calculateStorageSize()}</span>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="settings-section danger-zone">
          <div className="settings-section-title" style={{ color: 'var(--danger)' }}>Danger Zone</div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Clear Results</div>
              <div className="settings-item-description">Delete all scraped results (keeps scrapers)</div>
            </div>
            <button className="btn btn-danger" onClick={() => setConfirmAction('clearResults')}>
              Clear Results
            </button>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Clear All Data</div>
              <div className="settings-item-description">Delete all scrapers, results, and settings</div>
            </div>
            <button className="btn btn-danger" onClick={() => setConfirmAction('clearAll')}>
              Clear All Data
            </button>
          </div>
        </div>

        {/* About */}
        <div className="settings-section">
          <div className="settings-section-title">About</div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Web Scraper</div>
              <div className="settings-item-description">
                Version 2.0.0 - Visual web scraping tool
              </div>
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Keyboard Shortcuts</div>
              <div className="settings-item-description">View available keyboard shortcuts</div>
            </div>
            <button className="btn" onClick={() => setShowShortcuts(true)}>
              View Shortcuts
            </button>
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

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div className="modal-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">Keyboard Shortcuts</h3>
              <button className="modal-close" onClick={() => setShowShortcuts(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="shortcuts-list">
                {shortcuts.map((shortcut, index) => (
                  <div key={index} className="shortcut-item">
                    <kbd className="shortcut-key">{shortcut.key}</kbd>
                    <span className="shortcut-desc">{shortcut.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Clear Results */}
      <ConfirmModal
        isOpen={confirmAction === 'clearResults'}
        title="Clear All Results?"
        message={`This will permanently delete ${savedResults.length} results and ${totalScrapedItems.toLocaleString()} items. Your scrapers will be kept. This cannot be undone.`}
        confirmLabel="Clear Results"
        onConfirm={handleClearResults}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Confirm Clear All */}
      <ConfirmModal
        isOpen={confirmAction === 'clearAll'}
        title="Clear All Data?"
        message={`This will permanently delete ${savedScrapers.length} scrapers, ${savedResults.length} results, and all settings. This cannot be undone.`}
        confirmLabel="Clear Everything"
        onConfirm={handleClearAllData}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};
