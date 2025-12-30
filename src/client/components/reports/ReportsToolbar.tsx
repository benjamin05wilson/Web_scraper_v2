import React from 'react';
import type { ProductFilters } from '../../../shared/types';

interface ReportsToolbarProps {
  filters: ProductFilters;
  onFiltersChange: (filters: ProductFilters) => void;
  countries: string[];
  domains: string[];
  categories: string[];
  onRefresh: () => void;
  onExport: () => void;
  onClearData: () => void;
  loading?: boolean;
}

export function ReportsToolbar({
  filters,
  onFiltersChange,
  countries,
  domains,
  categories,
  onRefresh,
  onExport,
  onClearData,
  loading,
}: ReportsToolbarProps) {
  const handleChange = (key: keyof ProductFilters, value: string) => {
    onFiltersChange({ ...filters, [key]: value || undefined });
  };

  return (
    <div className="reports-toolbar">
      <div className="reports-filters">
        <div className="filter-group">
          <label className="form-label">Country</label>
          <select
            className="form-select"
            value={filters.country || ''}
            onChange={(e) => handleChange('country', e.target.value)}
          >
            <option value="">All Countries</option>
            {countries.map(country => (
              <option key={country} value={country}>{country}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="form-label">Domain</label>
          <select
            className="form-select"
            value={filters.domain || ''}
            onChange={(e) => handleChange('domain', e.target.value)}
          >
            <option value="">All Domains</option>
            {domains.map(domain => (
              <option key={domain} value={domain}>{domain}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="form-label">Category</label>
          <select
            className="form-select"
            value={filters.category || ''}
            onChange={(e) => handleChange('category', e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="form-label">Date Range</label>
          <select
            className="form-select"
            value={filters.dateRange || 'week'}
            onChange={(e) => handleChange('dateRange', e.target.value)}
          >
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>

      <div className="reports-actions">
        <button className="btn-refresh btn secondary" onClick={onRefresh} disabled={loading}>
          {loading ? <span className="spinner" /> : '↻ Refresh'}
        </button>
        <button className="btn secondary" onClick={onExport}>
          Export CSV
        </button>
        <button className="btn" onClick={onClearData}>
          Clear Data
        </button>
      </div>
    </div>
  );
}
