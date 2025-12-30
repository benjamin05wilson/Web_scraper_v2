import React, { useState, useCallback } from 'react';
import { useProducts } from '../../hooks/useProducts';
import { StatsCards } from './StatsCards';
import { ReportsToolbar } from './ReportsToolbar';
import { ProductsTable, Pagination } from './ProductsTable';
import { DomainSummary } from './DomainSummary';
import { ProductDetailModal } from './ProductDetailModal';
import { ClearDataModal } from './ClearDataModal';
import type { Product, ProductFilters } from '../../../shared/types';
import { getDateRange } from '../../utils/dateUtils';

export function ReportsPage() {
  const {
    products,
    stats,
    loading,
    error,
    filters,
    setFilters,
    pagination,
    setPage,
    loadProducts,
    loadStats,
    clearProducts,
    exportProducts,
  } = useProducts();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  const handleFiltersChange = useCallback((newFilters: ProductFilters) => {
    setFilters(newFilters);
    setPage(1);
  }, [setFilters, setPage]);

  const handleRefresh = useCallback(() => {
    loadStats();
    loadProducts();
  }, [loadStats, loadProducts]);

  const handleExport = useCallback(() => {
    const { start_date, end_date } = getDateRange(filters.dateRange || 'week');
    exportProducts({
      ...filters,
      start_date: start_date?.toISOString() || undefined,
      end_date: end_date?.toISOString() || undefined,
    });
  }, [exportProducts, filters]);

  const handleViewDetails = useCallback((product: Product) => {
    setSelectedProduct(product);
    setIsDetailModalOpen(true);
  }, []);

  const handleClearData = useCallback(async (country: string | null, beforeDate: string | null) => {
    await clearProducts(country || undefined, beforeDate ? new Date(beforeDate).toISOString() : undefined);
    handleRefresh();
  }, [clearProducts, handleRefresh]);

  return (
    <>
      {/* Hero Header */}
      <div className="hero">
        <span className="hero-badge">Product Database</span>
        <h1>Reports</h1>
        <p className="hero-subtitle">
          View and analyze scraped product data with country and date filters
        </p>
      </div>

      <div className="container">
        {/* Stats Overview */}
        <StatsCards stats={stats} loading={loading} />

        {/* Filters and Actions */}
        <ReportsToolbar
          filters={filters}
          onFiltersChange={handleFiltersChange}
          countries={stats?.countries || []}
          domains={stats?.domains || []}
          categories={stats?.categories || []}
          onRefresh={handleRefresh}
          onExport={handleExport}
          onClearData={() => setIsClearModalOpen(true)}
          loading={loading}
        />

        {/* Products Table */}
        <ProductsTable
          products={products}
          loading={loading}
          onViewDetails={handleViewDetails}
        />

        {/* Pagination */}
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={setPage}
          loading={loading}
        />

        {/* Summary by Domain */}
        <DomainSummary products={products} />
      </div>

      {/* Product Detail Modal */}
      <ProductDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        product={selectedProduct}
      />

      {/* Clear Data Modal */}
      <ClearDataModal
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        onConfirm={handleClearData}
        countries={stats?.countries || []}
      />
    </>
  );
}
