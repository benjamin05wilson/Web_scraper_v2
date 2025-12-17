// ============================================================================
// DASHBOARD PAGE - Overview and scraper management
// ============================================================================

import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useScraperContext } from '../../context/ScraperContext';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const {
    savedScrapers,
    savedResults,
    deleteScraper,
    totalScrapedItems,
    lastRunDate,
  } = useScraperContext();

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getRelativeTime = (date: Date | null) => {
    if (!date) return 'Never';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const handleDeleteScraper = (id: string, name: string) => {
    if (confirm(`Delete scraper "${name}"? This cannot be undone.`)) {
      deleteScraper(id);
    }
  };

  return (
    <div className="page-container" style={{ flex: 1, background: 'var(--bg-primary)' }}>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <Link to="/scraper" className="btn btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Scraper
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
            <div className="stat-value">{totalScrapedItems}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Last Run</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{getRelativeTime(lastRunDate)}</div>
          </div>
        </div>

        {/* Scrapers List */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
            Saved Scrapers
          </h2>

          {savedScrapers.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              </div>
              <div className="empty-state-title">No scrapers yet</div>
              <div className="empty-state-text">
                Create your first scraper to start extracting data from websites.
              </div>
              <Link to="/scraper" className="btn btn-primary">Create Scraper</Link>
            </div>
          ) : (
            <div className="scraper-list">
              {savedScrapers.map((scraper) => (
                <div key={scraper.id} className="scraper-card">
                  <div className="scraper-card-info">
                    <div className="scraper-card-name">{scraper.name}</div>
                    <div className="scraper-card-meta">
                      {scraper.config.selectors?.length || 0} selectors
                      {scraper.lastRunAt && ` | Last run: ${formatDate(scraper.lastRunAt)}`}
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
                      className="btn btn-danger"
                      onClick={() => handleDeleteScraper(scraper.id, scraper.name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
    </div>
  );
};
