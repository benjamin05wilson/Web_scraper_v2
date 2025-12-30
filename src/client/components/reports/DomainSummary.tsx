import React, { useMemo } from 'react';
import type { Product } from '../../../shared/types';

interface DomainSummaryProps {
  products: Product[];
}

interface DomainStats {
  count: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
}

export function DomainSummary({ products }: DomainSummaryProps) {
  const domainStats = useMemo(() => {
    const stats: Record<string, { count: number; prices: number[]; countries: Set<string> }> = {};

    products.forEach(product => {
      const domain = product.domain || 'Unknown';
      if (!stats[domain]) {
        stats[domain] = { count: 0, prices: [], countries: new Set() };
      }
      stats[domain].count++;
      if (product.price) {
        stats[domain].prices.push(product.price);
      }
      if (product.country) {
        stats[domain].countries.add(product.country);
      }
    });

    return Object.entries(stats)
      .slice(0, 6)
      .map(([domain, data]): [string, DomainStats] => {
        const avgPrice = data.prices.length > 0
          ? data.prices.reduce((a, b) => a + b, 0) / data.prices.length
          : 0;
        const minPrice = data.prices.length > 0 ? Math.min(...data.prices) : 0;
        const maxPrice = data.prices.length > 0 ? Math.max(...data.prices) : 0;

        return [domain, { count: data.count, avgPrice, minPrice, maxPrice }];
      });
  }, [products]);

  if (domainStats.length === 0) {
    return (
      <div className="reports-section">
        <h2 className="section-title">Price Summary by Domain</h2>
        <div className="config-performance-grid">
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No domain data available
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reports-section">
      <h2 className="section-title">Price Summary by Domain</h2>
      <div className="config-performance-grid">
        {domainStats.map(([domain, stats]) => (
          <div key={domain} className="performance-card">
            <div className="performance-header">
              <span className="performance-name">{domain}</span>
              <span className="performance-rate">{stats.count} products</span>
            </div>
            <div className="performance-stats">
              <div className="performance-stat">
                <span className="stat-label">Avg Price</span>
                <span className="stat-value">{stats.avgPrice.toFixed(2)}</span>
              </div>
              <div className="performance-stat">
                <span className="stat-label">Min</span>
                <span className="stat-value">{stats.minPrice.toFixed(2)}</span>
              </div>
              <div className="performance-stat">
                <span className="stat-label">Max</span>
                <span className="stat-value">{stats.maxPrice.toFixed(2)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
