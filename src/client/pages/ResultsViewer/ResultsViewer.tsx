// ============================================================================
// RESULTS VIEWER PAGE - View and export scraped data
// ============================================================================

import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useScraperContext } from '../../context/ScraperContext';
import { useToast } from '../../context/ToastContext';
import { ExportModal } from '../../components/common/ExportModal';
import { SearchInput, Pagination, EmptyState, ConfirmModal } from '../../components/common';

type SortField = 'scraperName' | 'items' | 'pages' | 'duration' | 'createdAt';
type SortDirection = 'asc' | 'desc';

export const ResultsViewer: React.FC = () => {
  const { savedResults, deleteResult, deleteResults, clearAllResults } = useScraperContext();
  const { showToast } = useToast();

  const [showExportModal, setShowExportModal] = useState(false);
  const [filterScraper, setFilterScraper] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal state
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'single' | 'bulk' | 'all'; id?: string } | null>(null);

  // Get unique scraper names for filter
  const scraperNames = useMemo(() => {
    const names = new Set(savedResults.map(r => r.scraperName));
    return Array.from(names);
  }, [savedResults]);

  // Filter, search, and sort results
  const processedResults = useMemo(() => {
    let results = [...savedResults];

    // Filter by scraper
    if (filterScraper !== 'all') {
      results = results.filter(r => r.scraperName === filterScraper);
    }

    // Search by scraper name or URL
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      results = results.filter(r =>
        r.scraperName.toLowerCase().includes(query) ||
        r.url.toLowerCase().includes(query)
      );
    }

    // Sort
    results.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sortField) {
        case 'scraperName':
          aVal = a.scraperName.toLowerCase();
          bVal = b.scraperName.toLowerCase();
          break;
        case 'items':
          aVal = a.result.items.length;
          bVal = b.result.items.length;
          break;
        case 'pages':
          aVal = a.result.pagesScraped;
          bVal = b.result.pagesScraped;
          break;
        case 'duration':
          aVal = a.result.duration;
          bVal = b.result.duration;
          break;
        case 'createdAt':
        default:
          aVal = a.createdAt;
          bVal = b.createdAt;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return results;
  }, [savedResults, filterScraper, searchQuery, sortField, sortDirection]);

  // Paginated results
  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedResults.slice(start, start + pageSize);
  }, [processedResults, currentPage, pageSize]);

  const totalPages = Math.ceil(processedResults.length / pageSize);

  // Get all items for export
  const allItems = useMemo(() => {
    return processedResults.flatMap(r => r.result.items);
  }, [processedResults]);

  // Get selected items for export
  const selectedItems = useMemo(() => {
    return savedResults
      .filter(r => selectedIds.has(r.id))
      .flatMap(r => r.result.items);
  }, [savedResults, selectedIds]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return '\u2195'; // up-down arrows
    return sortDirection === 'asc' ? '\u2191' : '\u2193';
  };

  const handleSelectAll = () => {
    if (selectedIds.size === paginatedResults.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedResults.map(r => r.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteConfirm = () => {
    if (!confirmDelete) return;

    if (confirmDelete.type === 'single' && confirmDelete.id) {
      deleteResult(confirmDelete.id);
      showToast('Result deleted', 'success');
    } else if (confirmDelete.type === 'bulk') {
      deleteResults(Array.from(selectedIds));
      showToast(`${selectedIds.size} results deleted`, 'success');
      setSelectedIds(new Set());
    } else if (confirmDelete.type === 'all') {
      clearAllResults();
      showToast('All results cleared', 'success');
    }

    setConfirmDelete(null);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedIds(new Set()); // Clear selection on page change
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    setSelectedIds(new Set());
  };

  const isAllSelected = paginatedResults.length > 0 && selectedIds.size === paginatedResults.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < paginatedResults.length;

  return (
    <div className="page-container" style={{ flex: 1, background: 'var(--bg-primary)' }}>
      <div className="page-header">
        <h1 className="page-title">Results</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {savedResults.length > 0 && (
            <>
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search results..."
              />
              <select
                className="form-select"
                value={filterScraper}
                onChange={(e) => {
                  setFilterScraper(e.target.value);
                  setCurrentPage(1);
                }}
              >
                <option value="all">All Scrapers</option>
                {scraperNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button
                className="btn btn-danger"
                onClick={() => setConfirmDelete({ type: 'all' })}
              >
                Clear All
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setShowExportModal(true)}
                disabled={allItems.length === 0}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export All ({allItems.length})
              </button>
            </>
          )}
        </div>
      </div>

      <div className="page-content">
        {savedResults.length === 0 ? (
          <EmptyState
            icon={'\u{1F4C4}'}
            title="No results yet"
            description="Run a scraper to start collecting data. Results will appear here."
            action={{ label: 'Go to Scraper', onClick: () => window.location.href = '/scraper' }}
          />
        ) : processedResults.length === 0 ? (
          <EmptyState
            icon={'\u{1F50D}'}
            title="No matches found"
            description={`No results match your search "${searchQuery}"`}
          />
        ) : (
          <>
            {/* Bulk Actions Bar */}
            {selectedIds.size > 0 && (
              <div className="bulk-actions-bar">
                <span className="bulk-count">{selectedIds.size} selected</span>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowExportModal(true)}
                >
                  Export Selected ({selectedItems.length} items)
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setConfirmDelete({ type: 'bulk' })}
                >
                  Delete Selected
                </button>
                <button
                  className="btn"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear Selection
                </button>
              </div>
            )}

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isSomeSelected;
                        }}
                        onChange={handleSelectAll}
                        aria-label="Select all"
                      />
                    </th>
                    <th
                      className="sortable-header"
                      onClick={() => handleSort('scraperName')}
                    >
                      Scraper {getSortIcon('scraperName')}
                    </th>
                    <th>URL</th>
                    <th
                      className="sortable-header"
                      onClick={() => handleSort('items')}
                    >
                      Items {getSortIcon('items')}
                    </th>
                    <th
                      className="sortable-header"
                      onClick={() => handleSort('pages')}
                    >
                      Pages {getSortIcon('pages')}
                    </th>
                    <th
                      className="sortable-header"
                      onClick={() => handleSort('duration')}
                    >
                      Duration {getSortIcon('duration')}
                    </th>
                    <th
                      className="sortable-header"
                      onClick={() => handleSort('createdAt')}
                    >
                      Date {getSortIcon('createdAt')}
                    </th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedResults.map((result) => (
                    <tr
                      key={result.id}
                      className={selectedIds.has(result.id) ? 'selected' : ''}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(result.id)}
                          onChange={() => handleSelectOne(result.id)}
                          aria-label={`Select ${result.scraperName}`}
                        />
                      </td>
                      <td style={{ fontWeight: 500 }}>{result.scraperName}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent-primary)' }}
                        >
                          {result.url}
                        </a>
                      </td>
                      <td>{result.result.items.length}</td>
                      <td>{result.result.pagesScraped}</td>
                      <td>{(result.result.duration / 1000).toFixed(2)}s</td>
                      <td>{formatDate(result.createdAt)}</td>
                      <td>
                        <div className="data-table-actions">
                          <Link
                            to={`/results/${result.id}`}
                            className="btn"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                          >
                            View
                          </Link>
                          <button
                            className="btn btn-danger"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            onClick={() => setConfirmDelete({ type: 'single', id: result.id })}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={processedResults.length}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={[25, 50, 100]}
            />
          </>
        )}
      </div>

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        items={selectedIds.size > 0 ? selectedItems : allItems}
        defaultFilename={`scrape-results-${filterScraper === 'all' ? 'all' : filterScraper}`}
      />

      <ConfirmModal
        isOpen={!!confirmDelete}
        title={
          confirmDelete?.type === 'all'
            ? 'Clear All Results?'
            : confirmDelete?.type === 'bulk'
            ? `Delete ${selectedIds.size} Results?`
            : 'Delete Result?'
        }
        message={
          confirmDelete?.type === 'all'
            ? 'This will permanently delete all results. This cannot be undone.'
            : confirmDelete?.type === 'bulk'
            ? `This will permanently delete ${selectedIds.size} selected results. This cannot be undone.`
            : 'This will permanently delete this result. This cannot be undone.'
        }
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};
