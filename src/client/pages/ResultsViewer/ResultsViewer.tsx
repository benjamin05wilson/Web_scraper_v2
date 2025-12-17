// ============================================================================
// RESULTS VIEWER PAGE - View and export scraped data
// ============================================================================

import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useScraperContext } from '../../context/ScraperContext';
import { ExportModal } from '../../components/common/ExportModal';

export const ResultsViewer: React.FC = () => {
  const { savedResults, deleteResult, clearAllResults } = useScraperContext();
  const [showExportModal, setShowExportModal] = useState(false);
  const [filterScraper, setFilterScraper] = useState<string>('all');

  // Get unique scraper names for filter
  const scraperNames = useMemo(() => {
    const names = new Set(savedResults.map(r => r.scraperName));
    return Array.from(names);
  }, [savedResults]);

  // Filter results
  const filteredResults = useMemo(() => {
    if (filterScraper === 'all') return savedResults;
    return savedResults.filter(r => r.scraperName === filterScraper);
  }, [savedResults, filterScraper]);

  // Get all items for export
  const allItems = useMemo(() => {
    return filteredResults.flatMap(r => r.result.items);
  }, [filteredResults]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleDeleteResult = (id: string) => {
    if (confirm('Delete this result? This cannot be undone.')) {
      deleteResult(id);
    }
  };

  const handleClearAll = () => {
    if (confirm('Delete ALL results? This cannot be undone.')) {
      clearAllResults();
    }
  };

  return (
    <div className="page-container" style={{ flex: 1, background: 'var(--bg-primary)' }}>
      <div className="page-header">
        <h1 className="page-title">Results</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {savedResults.length > 0 && (
            <>
              <select
                className="form-select"
                value={filterScraper}
                onChange={(e) => setFilterScraper(e.target.value)}
              >
                <option value="all">All Scrapers</option>
                {scraperNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button className="btn" onClick={handleClearAll}>
                Clear All
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setShowExportModal(true)}
                disabled={allItems.length === 0}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export All ({allItems.length})
              </button>
            </>
          )}
        </div>
      </div>

      <div className="page-content">
        {savedResults.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div className="empty-state-title">No results yet</div>
            <div className="empty-state-text">
              Run a scraper to start collecting data. Results will appear here.
            </div>
            <Link to="/scraper" className="btn btn-primary">Go to Scraper</Link>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Scraper</th>
                  <th>URL</th>
                  <th>Items</th>
                  <th>Pages</th>
                  <th>Duration</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((result) => (
                  <tr key={result.id}>
                    <td style={{ fontWeight: 500 }}>{result.scraperName}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {result.url}
                    </td>
                    <td>{result.result.items.length}</td>
                    <td>{result.result.pagesScraped}</td>
                    <td>{(result.result.duration / 1000).toFixed(2)}s</td>
                    <td>{formatDate(result.createdAt)}</td>
                    <td>
                      <div className="data-table-actions">
                        <Link
                          to={`/results/${result.id}`}
                          className="btn"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                        >
                          View
                        </Link>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          onClick={() => handleDeleteResult(result.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        items={allItems}
        defaultFilename={`scrape-results-${filterScraper === 'all' ? 'all' : filterScraper}`}
      />
    </div>
  );
};
