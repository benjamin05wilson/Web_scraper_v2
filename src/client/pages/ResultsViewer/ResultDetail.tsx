// ============================================================================
// RESULT DETAIL PAGE - View single scrape result
// ============================================================================

import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useScraperContext } from '../../context/ScraperContext';
import { ExportModal } from '../../components/common/ExportModal';

export const ResultDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getResultById, deleteResult } = useScraperContext();
  const [showExportModal, setShowExportModal] = useState(false);

  const result = id ? getResultById(id) : null;

  if (!result) {
    return (
      <div className="page-container" style={{ flex: 1, background: 'var(--bg-primary)' }}>
        <div className="page-content">
          <div className="empty-state">
            <div className="empty-state-title">Result not found</div>
            <div className="empty-state-text">
              This result may have been deleted.
            </div>
            <Link to="/results" className="btn btn-primary">Back to Results</Link>
          </div>
        </div>
      </div>
    );
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const handleDelete = () => {
    if (confirm('Delete this result? This cannot be undone.')) {
      deleteResult(result.id);
      navigate('/results');
    }
  };

  // Get all unique keys from items
  const columns = result.result.items.length > 0
    ? Object.keys(result.result.items[0])
    : [];

  return (
    <div className="page-container" style={{ flex: 1, background: 'var(--bg-primary)' }}>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link to="/results" className="btn btn-icon" aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <div>
            <h1 className="page-title">{result.scraperName}</h1>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              {formatDate(result.createdAt)} | {result.result.items.length} items | {result.result.pagesScraped} page(s)
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
          <button className="btn btn-primary" onClick={() => setShowExportModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* Meta info */}
        <div className="dashboard-stats" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-label">URL</div>
            <div style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--text-primary)' }}>
              {result.url}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Duration</div>
            <div className="stat-value">{(result.result.duration / 1000).toFixed(2)}s</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Status</div>
            <div className="stat-value" style={{ color: result.result.success ? 'var(--accent-success)' : 'var(--accent-error)' }}>
              {result.result.success ? 'Success' : 'Failed'}
            </div>
          </div>
        </div>

        {/* Errors */}
        {result.result.errors && result.result.errors.length > 0 && (
          <div style={{ marginBottom: 24, padding: 16, background: 'rgba(255, 68, 68, 0.1)', border: '1px solid var(--accent-error)', borderRadius: 'var(--border-radius)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--accent-error)' }}>Errors</div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {result.result.errors.map((error, i) => (
                <li key={i} style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Data table */}
        {result.result.items.length > 0 ? (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  {columns.map(col => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.result.items.map((item, index) => (
                  <tr key={index}>
                    <td style={{ color: 'var(--text-muted)' }}>{index + 1}</td>
                    {columns.map(col => (
                      <td key={col} style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item[col] ?? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-title">No data</div>
            <div className="empty-state-text">This scrape didn't return any items.</div>
          </div>
        )}
      </div>

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        items={result.result.items}
        defaultFilename={`${result.scraperName}-${result.id}`}
      />
    </div>
  );
};
