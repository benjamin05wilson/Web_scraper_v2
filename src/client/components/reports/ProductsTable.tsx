import type { Product } from '../../../shared/types';
import { formatDateTime } from '../../utils/dateUtils';
import { formatPrice } from '../../utils/priceUtils';

interface ProductsTableProps {
  products: Product[];
  loading?: boolean;
  onViewDetails: (product: Product) => void;
}

export function ProductsTable({ products, loading, onViewDetails }: ProductsTableProps) {
  if (loading) {
    return (
      <div className="reports-table-container">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Brand</th>
              <th>Price</th>
              <th>Domain</th>
              <th>Category</th>
              <th>Country</th>
              <th>Scraped</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                <span className="spinner" style={{ width: '30px', height: '30px', margin: '0 auto 15px', display: 'block' }} />
                Loading products...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="reports-table-container">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Brand</th>
              <th>Price</th>
              <th>Domain</th>
              <th>Category</th>
              <th>Country</th>
              <th>Scraped</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                No products found matching your filters
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="reports-table-container">
      <table className="reports-table">
        <thead>
          <tr>
            <th>Product Name</th>
            <th>Brand</th>
            <th>Price</th>
            <th>Domain</th>
            <th>Category</th>
            <th>Country</th>
            <th>Scraped</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product, index) => {
            const name = product.item_name || '-';
            const truncatedName = name.length > 50 ? name.substring(0, 50) + '...' : name;

            return (
              <tr key={product.id || index}>
                <td title={name}>{truncatedName}</td>
                <td>{product.brand || '-'}</td>
                <td>{product.price ? formatPrice(product.price, product.currency) : '-'}</td>
                <td>{product.domain || '-'}</td>
                <td>{product.category || '-'}</td>
                <td>{product.country || '-'}</td>
                <td>{formatDateTime(product.scraped_at)}</td>
                <td>
                  <button
                    className="btn-icon"
                    onClick={() => onViewDetails(product)}
                    title="View Details"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
}

export function Pagination({ page, pageSize, total, onPageChange, loading }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize) || 1;

  const formatNumber = (num: number) => num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return (
    <div className="reports-pagination">
      <button
        className="btn secondary"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1 || loading}
      >
        Previous
      </button>
      <span style={{ padding: '0 20px', color: 'var(--text-secondary)' }}>
        Page {page} of {totalPages} ({formatNumber(total)} products)
      </span>
      <button
        className="btn secondary"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages || loading}
      >
        Next
      </button>
    </div>
  );
}
