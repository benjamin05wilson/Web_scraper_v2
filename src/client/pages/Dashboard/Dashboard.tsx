// ============================================================================
// DASHBOARD PAGE - Overview and scraper management
// ============================================================================

import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useScraperContext, type Activity } from '../../context/ScraperContext';
import { useToast } from '../../context/ToastContext';
import { SearchInput, ConfirmModal, EmptyState } from '../../components/common';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    savedScrapers,
    savedResults,
    templates,
    activities,
    deleteScraper,
    duplicateScraper,
    saveAsTemplate,
    useTemplate,
    totalScrapedItems,
    lastRunDate,
    importBackup,
  } = useScraperContext();

  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  // Filter scrapers by search query
  const filteredScrapers = useMemo(() => {
    if (!searchQuery) return savedScrapers;
    const query = searchQuery.toLowerCase();
    return savedScrapers.filter(s => s.name.toLowerCase().includes(query));
  }, [savedScrapers, searchQuery]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getRelativeTime = (date: Date | number | null) => {
    if (!date) return 'Never';
    const timestamp = typeof date === 'number' ? date : date.getTime();
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const handleDeleteScraper = () => {
    if (confirmDelete) {
      deleteScraper(confirmDelete.id);
      setConfirmDelete(null);
      showToast(`Scraper "${confirmDelete.name}" deleted`, 'success');
    }
  };

  const handleDuplicate = (id: string) => {
    const newScraper = duplicateScraper(id);
    if (newScraper) {
      showToast(`Created "${newScraper.name}"`, 'success');
    }
  };

  const handleSaveAsTemplate = (id: string, name: string) => {
    saveAsTemplate(id);
    showToast(`Created template from "${name}"`, 'success');
  };

  const handleUseTemplate = (id: string) => {
    const newScraper = useTemplate(id);
    if (newScraper) {
      showToast(`Created scraper from template`, 'success');
      navigate(`/scraper/${newScraper.id}`);
    }
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
    e.target.value = ''; // Reset input
  };

  const getActivityIcon = (type: Activity['type']) => {
    switch (type) {
      case 'scrape': return '\u{1F50D}';
      case 'create': return '\u2795';
      case 'export': return '\u{1F4E5}';
      case 'delete': return '\u{1F5D1}';
      default: return '\u2022';
    }
  };

  const getResultCount = (scraperId: string) => {
    return savedResults.filter(r => r.scraperId === scraperId).reduce((sum, r) => sum + r.result.items.length, 0);
  };

  return (
    <div className="page-container" style={{ flex: 1, background: 'var(--bg-primary)' }}>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <Link to="/scraper" className="btn btn-primary">
          + New Scraper
        </Link>
      </div>

      <div className="page-content">
        {/* Stats */}
        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-label">Saved Scrapers</div>
            <div className="stat-value">{savedScrapers.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Results</div>
            <div className="stat-value">{savedResults.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Items Scraped</div>
            <div className="stat-value">{totalScrapedItems.toLocaleString()}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Last Run</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{getRelativeTime(lastRunDate)}</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="quick-actions">
          <Link to="/scraper" className="quick-action-card">
            <span className="quick-action-icon">+</span>
            <span className="quick-action-label">New Scraper</span>
          </Link>
          <label className="quick-action-card" style={{ cursor: 'pointer' }}>
            <input
              type="file"
              accept=".json"
              onChange={handleImportBackup}
              style={{ display: 'none' }}
            />
            <span className="quick-action-icon">{'\u{1F4E5}'}</span>
            <span className="quick-action-label">Import Backup</span>
          </label>
          <Link to="/results" className="quick-action-card">
            <span className="quick-action-icon">{'\u{1F4CA}'}</span>
            <span className="quick-action-label">View Results</span>
          </Link>
          <Link to="/settings" className="quick-action-card">
            <span className="quick-action-icon">{'\u2699'}</span>
            <span className="quick-action-label">Settings</span>
          </Link>
        </div>

        {/* Templates Section */}
        {templates.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
              My Templates
            </h2>
            <div className="scraper-list">
              {templates.map((template) => (
                <div key={template.id} className="scraper-card">
                  <div className="scraper-card-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="scraper-card-name">{template.name}</span>
                      <span className="template-badge">TEMPLATE</span>
                    </div>
                    <div className="scraper-card-meta">
                      {template.config.selectors?.length || 0} selectors
                    </div>
                  </div>
                  <div className="scraper-card-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => handleUseTemplate(template.id)}
                    >
                      Use Template
                    </button>
                    <button
                      className="btn"
                      onClick={() => navigate(`/scraper/${template.id}`)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => setConfirmDelete({ id: template.id, name: template.name })}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scrapers List */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
              Saved Scrapers
            </h2>
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search scrapers..."
            />
          </div>

          {savedScrapers.length === 0 ? (
            <EmptyState
              icon={'\u{1F50D}'}
              title="No scrapers yet"
              description="Create your first scraper to start extracting data from websites."
              action={{ label: 'Create Scraper', onClick: () => navigate('/scraper') }}
            />
          ) : filteredScrapers.length === 0 ? (
            <EmptyState
              icon={'\u{1F50D}'}
              title="No matches found"
              description={`No scrapers match "${searchQuery}"`}
            />
          ) : (
            <div className="scraper-list">
              {filteredScrapers.map((scraper) => (
                <div key={scraper.id} className="scraper-card">
                  <div className="scraper-card-info">
                    <div className="scraper-card-name">{scraper.name}</div>
                    <div className="scraper-card-meta">
                      {scraper.config.selectors?.length || 0} selectors
                      {scraper.lastRunAt && ` | ${getResultCount(scraper.id)} items`}
                      {scraper.lastRunAt && ` | Last run: ${getRelativeTime(scraper.lastRunAt)}`}
                    </div>
                  </div>
                  <div className="scraper-card-actions">
                    <button
                      className="btn"
                      onClick={() => navigate(`/scraper/${scraper.id}`)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => navigate(`/scraper/${scraper.id}`)}
                    >
                      Run
                    </button>
                    <button
                      className="btn"
                      onClick={() => handleDuplicate(scraper.id)}
                      title="Duplicate scraper"
                    >
                      {'\u{1F4CB}'}
                    </button>
                    <button
                      className="btn"
                      onClick={() => handleSaveAsTemplate(scraper.id, scraper.name)}
                      title="Save as template"
                    >
                      {'\u{1F4BE}'}
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => setConfirmDelete({ id: scraper.id, name: scraper.name })}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Timeline */}
        {activities.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
              Recent Activity
            </h2>
            <div className="activity-timeline" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--border-radius)', padding: 16 }}>
              {activities.slice(-10).reverse().map((activity) => (
                <div key={activity.id} className="activity-item">
                  <div className={`activity-icon ${activity.type}`}>
                    {getActivityIcon(activity.type)}
                  </div>
                  <div className="activity-content">
                    <div className="activity-text">{activity.message}</div>
                    <div className="activity-time">{getRelativeTime(activity.timestamp)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Results */}
        {savedResults.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
                Recent Results
              </h2>
              <Link to="/results" className="btn">View All</Link>
            </div>

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Scraper</th>
                    <th>Items</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {savedResults.slice(-5).reverse().map((result) => (
                    <tr key={result.id}>
                      <td>{result.scraperName}</td>
                      <td>{result.result.items.length}</td>
                      <td>{formatDate(result.createdAt)}</td>
                      <td>
                        <Link to={`/results/${result.id}`} className="btn" style={{ padding: '4px 8px', fontSize: 12 }}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={!!confirmDelete}
        title="Delete Scraper?"
        message={`Are you sure you want to delete "${confirmDelete?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteScraper}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};
