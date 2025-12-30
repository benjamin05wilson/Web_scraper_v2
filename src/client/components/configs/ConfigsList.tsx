import React from 'react';
import type { Config } from '../../../shared/types';

interface ConfigsListProps {
  configs: Config[];
  selectedName: string | null;
  onSelect: (name: string | null) => void;
  loading?: boolean;
}

export function ConfigsList({
  configs,
  selectedName,
  onSelect,
  loading = false,
}: ConfigsListProps) {
  if (loading) {
    return (
      <div className="config-list">
        <div className="loading">
          <span className="spinner" style={{ marginRight: '10px' }} />
          Loading configurations...
        </div>
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <div className="config-list">
        <div className="config-empty-state">
          No configurations found. Create a new config using the Builder page.
        </div>
      </div>
    );
  }

  return (
    <div className="config-list">
      {configs.map(config => (
        <div
          key={config.name}
          className={`config-item${selectedName === config.name ? ' selected' : ''}`}
          onClick={() => onSelect(config.name)}
        >
          <div className="config-item-name">{config.name}</div>
          {config.url && (
            <div className="config-item-url">
              {extractDisplayUrl(config.url)}
            </div>
          )}
          <div style={{ marginTop: '8px' }}>
            {config.pagination?.type && (
              <span className="config-tag pagination">
                {config.pagination.type.replace('_', ' ')}
              </span>
            )}
            {config.country && (
              <span className="config-tag">{config.country}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function extractDisplayUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname : '');
  } catch {
    return url;
  }
}
