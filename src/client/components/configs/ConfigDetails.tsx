import type { Config } from '../../../shared/types';
import { formatDateTime } from '../../utils/dateUtils';

interface ConfigDetailsProps {
  config: Config;
  onEdit: () => void;
  onDelete: () => void;
}

export function ConfigDetails({ config, onEdit, onDelete }: ConfigDetailsProps) {
  const selectors = config.selectors || {};
  const pagination = config.pagination;

  return (
    <>
      <div className="detail-header">
        <div>
          <h2 className="detail-title">{config.name}</h2>
          {config.url && (
            <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginTop: '8px' }}>
              {config.url}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn secondary" onClick={onEdit}>
            Edit
          </button>
          <button className="btn btn-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      {/* Selectors Section */}
      <div className="detail-section">
        <h4 className="detail-section-title">Selectors</h4>

        {Object.entries(selectors).map(([key, value]) => {
          if (!value) return null;
          const displayValue = Array.isArray(value) ? value.join('\n') : value;

          return (
            <div key={key} className="selector-card">
              <div style={{ marginBottom: '8px' }}>
                <span className="config-tag">{key}</span>
              </div>
              <code style={{ whiteSpace: 'pre-wrap' }}>{displayValue}</code>
            </div>
          );
        })}

        {Object.keys(selectors).filter(k => selectors[k as keyof typeof selectors]).length === 0 && (
          <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            No selectors defined
          </p>
        )}
      </div>

      {/* Pagination Section */}
      {pagination && (
        <div className="detail-section">
          <h4 className="detail-section-title">Pagination</h4>
          <div className="pagination-card">
            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Type</span>
                <span style={{ fontWeight: 600 }}>
                  {pagination.type?.replace('_', ' ') || 'None'}
                </span>
              </div>

              {pagination.pattern && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Pattern</span>
                  <code>{pagination.pattern}</code>
                </div>
              )}

              {pagination.selector && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Selector</span>
                  <code>{pagination.selector}</code>
                </div>
              )}

              {pagination.max_pages && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Max Pages</span>
                  <span style={{ fontWeight: 600 }}>{pagination.max_pages}</span>
                </div>
              )}

              {pagination.start_page !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Start Page</span>
                  <span style={{ fontWeight: 600 }}>{pagination.start_page}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Metadata Section */}
      <div className="detail-section">
        <h4 className="detail-section-title">Metadata</h4>
        <div style={{ display: 'grid', gap: '10px' }}>
          {config.country && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Country</span>
              <span style={{ fontWeight: 600 }}>{config.country}</span>
            </div>
          )}

          {config.competitor_type && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Competitor Type</span>
              <span style={{ fontWeight: 600 }}>{config.competitor_type}</span>
            </div>
          )}

          {config.created_at && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Created</span>
              <span>{formatDateTime(config.created_at)}</span>
            </div>
          )}

          {config.updated_at && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Updated</span>
              <span>{formatDateTime(config.updated_at)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Alignment Section (if present) */}
      {config.alignment && (
        <div className="detail-section">
          <h4 className="detail-section-title">Alignment</h4>
          <div className="pagination-card">
            <div style={{ display: 'grid', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Status</span>
                <span style={{
                  fontWeight: 600,
                  color: config.alignment.matched ? 'var(--accent-success)' : 'var(--accent-warning)',
                }}>
                  {config.alignment.matched ? 'Matched' : 'Not Matched'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Method</span>
                <span style={{ fontWeight: 600 }}>{config.alignment.method}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Count</span>
                <span style={{ fontWeight: 600 }}>{config.alignment.count}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
