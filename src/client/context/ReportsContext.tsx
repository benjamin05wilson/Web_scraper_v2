import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type {
  Product,
  ProductStats,
  ProductFilters,
  ProductsResponse,
  DomainSummary,
} from '../../shared/types';
import { getDateRange } from '../utils/dateUtils';
import { generateCSV, downloadCSV } from '../utils/csvUtils';

interface ReportsContextValue {
  products: Product[];
  stats: ProductStats | null;
  domainSummaries: DomainSummary[];
  filters: ProductFilters;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
  loading: boolean;
  error: string | null;
  setFilters: (filters: Partial<ProductFilters>) => void;
  loadProducts: () => Promise<void>;
  loadStats: () => Promise<void>;
  exportCSV: () => void;
  clearData: (options?: { country?: string; domain?: string }) => Promise<void>;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

const ReportsContext = createContext<ReportsContextValue | null>(null);

const API_BASE = 'http://localhost:3002';
const DEFAULT_PAGE_SIZE = 50;

interface ReportsProviderProps {
  children: ReactNode;
}

export function ReportsProvider({ children }: ReportsProviderProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<ProductStats | null>(null);
  const [domainSummaries, setDomainSummaries] = useState<DomainSummary[]>([]);
  const [filters, setFiltersState] = useState<ProductFilters>({
    dateRange: 'all',
  });
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/products/summary`);
      if (!response.ok) {
        throw new Error(`Failed to load stats: ${response.statusText}`);
      }
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('page', String(pagination.page));
      params.set('pageSize', String(pagination.pageSize));

      if (filters.country) params.set('country', filters.country);
      if (filters.domain) params.set('domain', filters.domain);
      if (filters.category) params.set('category', filters.category);
      if (filters.search) params.set('search', filters.search);

      // Add date range
      const dateRange = getDateRange(filters.dateRange);
      if (dateRange.start) {
        params.set('startDate', dateRange.start.toISOString());
      }
      params.set('endDate', dateRange.end.toISOString());

      const response = await fetch(`${API_BASE}/api/products?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to load products: ${response.statusText}`);
      }

      const data: ProductsResponse = await response.json();
      setProducts(data.products);
      setPagination(prev => ({
        ...prev,
        total: data.total,
        hasMore: data.hasMore,
      }));

      // Calculate domain summaries from products
      const summaries = calculateDomainSummaries(data.products);
      setDomainSummaries(summaries);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load products';
      setError(message);
      console.error('Failed to load products:', err);
    } finally {
      setLoading(false);
    }
  }, [filters, pagination.page, pagination.pageSize]);

  const setFilters = useCallback((newFilters: Partial<ProductFilters>) => {
    setFiltersState(prev => ({ ...prev, ...newFilters }));
    setPagination(prev => ({ ...prev, page: 1 })); // Reset to first page
  }, []);

  const setPage = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, page }));
  }, []);

  const setPageSize = useCallback((pageSize: number) => {
    setPagination(prev => ({ ...prev, pageSize, page: 1 }));
  }, []);

  const exportCSV = useCallback(() => {
    if (products.length === 0) return;

    const headers = [
      'item_name',
      'brand',
      'price',
      'currency',
      'domain',
      'category',
      'country',
      'product_url',
      'scraped_at',
    ];

    const csvContent = generateCSV(products, headers);
    const filename = `products_export_${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(csvContent, filename);
  }, [products]);

  const clearData = useCallback(async (options?: { country?: string; domain?: string }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/products/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });

      if (!response.ok) {
        throw new Error(`Failed to clear data: ${response.statusText}`);
      }

      // Refresh data
      await loadProducts();
      await loadStats();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear data';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [loadProducts, loadStats]);

  const value: ReportsContextValue = {
    products,
    stats,
    domainSummaries,
    filters,
    pagination,
    loading,
    error,
    setFilters,
    loadProducts,
    loadStats,
    exportCSV,
    clearData,
    setPage,
    setPageSize,
  };

  return (
    <ReportsContext.Provider value={value}>
      {children}
    </ReportsContext.Provider>
  );
}

export function useReportsContext(): ReportsContextValue {
  const context = useContext(ReportsContext);
  if (!context) {
    throw new Error('useReportsContext must be used within a ReportsProvider');
  }
  return context;
}

// Helper function to calculate domain summaries
function calculateDomainSummaries(products: Product[]): DomainSummary[] {
  const domainMap = new Map<string, {
    products: Product[];
    countries: Set<string>;
  }>();

  for (const product of products) {
    const domain = product.domain || 'Unknown';
    if (!domainMap.has(domain)) {
      domainMap.set(domain, { products: [], countries: new Set() });
    }
    const entry = domainMap.get(domain)!;
    entry.products.push(product);
    if (product.country) {
      entry.countries.add(product.country);
    }
  }

  const summaries: DomainSummary[] = [];
  for (const [domain, data] of domainMap) {
    const prices = data.products
      .map(p => p.price)
      .filter((p): p is number => p !== undefined && p !== null);

    summaries.push({
      domain,
      productCount: data.products.length,
      avgPrice: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
      minPrice: prices.length > 0 ? Math.min(...prices) : 0,
      maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
      countries: Array.from(data.countries),
    });
  }

  return summaries.sort((a, b) => b.productCount - a.productCount);
}
