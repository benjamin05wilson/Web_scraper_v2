import React from 'react';
import type { ProductStats } from '../../../shared/types';

interface StatsCardsProps {
  stats: ProductStats | null;
  loading?: boolean;
}

function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function StatsCards({ stats, loading }: StatsCardsProps) {
  if (loading) {
    return (
      <div className="reports-stats-grid">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="stat-card">
            <div className="stat-label">Loading...</div>
            <div className="stat-value">-</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="reports-stats-grid">
      <div className="stat-card">
        <div className="stat-label">Total Products</div>
        <div className="stat-value">{stats ? formatNumber(stats.total_products) : '-'}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Countries</div>
        <div className="stat-value">{stats?.country_count ?? '-'}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Domains</div>
        <div className="stat-value">{stats?.domain_count ?? '-'}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Avg Price</div>
        <div className="stat-value">{stats?.avg_price ? stats.avg_price.toFixed(2) : '-'}</div>
      </div>
    </div>
  );
}
