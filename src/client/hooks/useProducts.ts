import { useEffect } from 'react';
import { useReportsContext } from '../context/ReportsContext';

export function useProducts(autoLoad = true) {
  const context = useReportsContext();

  useEffect(() => {
    if (autoLoad) {
      context.loadProducts();
      context.loadStats();
    }
  }, [autoLoad, context.loadProducts, context.loadStats]);

  return context;
}

export function useProductFilters() {
  const { filters, setFilters, stats } = useReportsContext();

  return {
    filters,
    setFilters,
    countries: stats?.countries || [],
    domains: stats?.domains || [],
    categories: stats?.categories || [],
  };
}

export function useProductPagination() {
  const { pagination, setPage, setPageSize, loading } = useReportsContext();

  return {
    ...pagination,
    setPage,
    setPageSize,
    loading,
  };
}
