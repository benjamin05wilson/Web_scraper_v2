import { ReactNode } from 'react';

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  onRowClick?: (item: T) => void;
  selectedKey?: string | number | null;
  emptyMessage?: string;
  loading?: boolean;
  className?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyField,
  onRowClick,
  selectedKey,
  emptyMessage = 'No data available',
  loading = false,
  className = '',
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className={`reports-table-container ${className}`}>
        <div className="loading">
          <span className="spinner" style={{ marginRight: '10px' }} />
          Loading...
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={`reports-table-container ${className}`}>
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <div className="empty-text">{emptyMessage}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`reports-table-container ${className}`}>
      <table className="reports-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={String(col.key)}
                style={{
                  width: col.width,
                  textAlign: col.align || 'left',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(item => {
            const key = String(item[keyField]);
            const isSelected = selectedKey !== undefined && key === String(selectedKey);

            return (
              <tr
                key={key}
                onClick={() => onRowClick?.(item)}
                style={{
                  cursor: onRowClick ? 'pointer' : undefined,
                  background: isSelected ? 'var(--bg-secondary)' : undefined,
                }}
              >
                {columns.map(col => (
                  <td
                    key={String(col.key)}
                    style={{ textAlign: col.align || 'left' }}
                  >
                    {col.render
                      ? col.render(item)
                      : String(item[col.key as keyof T] ?? '')}
                  </td>
                ))}
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
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  return (
    <div className="reports-pagination">
      <span style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>
        Showing {startItem}-{endItem} of {total}
      </span>

      <div className="pagination">
        <button
          className="btn secondary"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          style={{ padding: '8px 12px' }}
        >
          Previous
        </button>

        <span style={{ margin: '0 15px' }}>
          Page {page} of {totalPages}
        </span>

        <button
          className="btn secondary"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          style={{ padding: '8px 12px' }}
        >
          Next
        </button>
      </div>

      {onPageSizeChange && (
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{ marginLeft: '15px', padding: '8px 12px' }}
        >
          {pageSizeOptions.map(size => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
