// ============================================================================
// AUTOMATED BUILDER OVERLAY - Confirmation overlays for automated workflow
// ============================================================================

import { useEffect, useCallback } from 'react';
import type { ElementSelector } from '../../../shared/types';
import type { OverlayType, PaginationPattern } from '../../hooks/useAutomatedBuilderFlow';

interface AutomatedBuilderOverlayProps {
  type: OverlayType;
  isVisible: boolean;
  onConfirm: (confirmed: boolean) => void;

  // Popup-specific
  dismissCount?: number;

  // Product-specific
  detectedProduct?: ElementSelector | null;
  productConfidence?: number;
  productScreenshot?: string | null;

  // Pagination-specific
  detectedPagination?: PaginationPattern | null;
}

export function AutomatedBuilderOverlay({
  type,
  isVisible,
  onConfirm,
  dismissCount = 0,
  detectedProduct,
  productConfidence = 0,
  productScreenshot,
  detectedPagination,
}: AutomatedBuilderOverlayProps) {
  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isVisible) return;
      // Don't handle keyboard during pagination detection
      if (type === 'pagination_detecting') return;

      if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        onConfirm(true);
      } else if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        onConfirm(false);
      }
    },
    [isVisible, type, onConfirm]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isVisible || !type) return null;

  const renderContent = () => {
    switch (type) {
      case 'popup':
        return (
          <>
            <div className="overlay-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9l6 6M15 9l-6 6" />
              </svg>
            </div>
            <h2 className="overlay-title">Have all popups been closed?</h2>
            <p className="overlay-description">
              If there are cookie banners, modals, or other popups still visible, click "No" to record closing them.
              {dismissCount > 0 && (
                <span className="overlay-badge">{dismissCount} popup(s) already recorded</span>
              )}
            </p>
          </>
        );

      case 'product':
        return (
          <>
            <div className="overlay-icon" style={{ color: detectedProduct ? 'var(--accent-success)' : 'var(--accent-warning)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
            </div>
            <h2 className="overlay-title">Is this the product card?</h2>
            {detectedProduct ? (
              <div className="overlay-detection-info">
                {productScreenshot ? (
                  <div className="overlay-screenshot">
                    <img
                      src={productScreenshot}
                      alt="Detected product card"
                      className="product-screenshot"
                    />
                  </div>
                ) : (
                  <div className="overlay-selector">
                    <span className="overlay-label">Detected:</span>
                    <code>Product card found</code>
                  </div>
                )}
                {productConfidence > 0 && (
                  <div className="overlay-confidence">
                    Confidence: {Math.round(productConfidence * 100)}%
                  </div>
                )}
              </div>
            ) : (
              <p className="overlay-description">
                No product card was automatically detected. Click "No" to select one manually.
              </p>
            )}
            <p className="overlay-hint">
              The product card should contain title, price, and image of a single product.
            </p>
          </>
        );

      case 'pagination_detecting':
        return (
          <>
            <div className="overlay-icon overlay-spinning">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            </div>
            <h2 className="overlay-title">Pagination Detection</h2>
            <p className="overlay-description">
              Scrolling through the page to detect how more products load...
            </p>
            <p className="overlay-hint" style={{ marginTop: '8px' }}>
              Please wait while we analyze the page structure.
            </p>
          </>
        );

      case 'pagination':
        const isInfiniteScroll = detectedPagination?.type === 'infinite_scroll';
        const isNextPage = detectedPagination?.type === 'next_page';
        const isUrlPattern = detectedPagination?.type === 'url_pattern';

        // Get user-friendly description
        const getPaginationDescription = () => {
          if (isInfiniteScroll) {
            return 'More products load automatically when you scroll down the page.';
          }
          if (isNextPage) {
            return 'Products are split across multiple pages. Click "Next" to see more products.';
          }
          if (isUrlPattern) {
            return 'Products are split across multiple pages with numbered page links.';
          }
          return '';
        };

        // Get icon based on type
        const getPaginationIcon = () => {
          if (isInfiniteScroll) {
            return (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            );
          }
          return (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
              <path d="M9 18l6-6-6-6" transform="translate(6, 0)" />
            </svg>
          );
        };

        // Get title based on type
        const getPaginationTitle = () => {
          if (isInfiniteScroll) return 'Infinite scroll detected!';
          if (isNextPage) return '"Next" button detected!';
          if (isUrlPattern) return 'Page numbers detected!';
          return 'No pagination detected';
        };

        return (
          <>
            <div className="overlay-icon" style={{ color: detectedPagination ? 'var(--accent-success)' : 'var(--text-secondary)' }}>
              {getPaginationIcon()}
            </div>
            <h2 className="overlay-title">{getPaginationTitle()}</h2>
            {detectedPagination ? (
              <div className="overlay-pagination-info">
                <p className="overlay-pagination-description">
                  {getPaginationDescription()}
                </p>
              </div>
            ) : (
              <p className="overlay-description">
                No pagination was detected. Click "No" to configure manually, or "Yes" if this page has all products.
              </p>
            )}
          </>
        );

      default:
        return null;
    }
  };

  // Don't show action buttons while detecting pagination
  const showActions = type !== 'pagination_detecting';

  return (
    <div className="automated-overlay-backdrop">
      <div className="automated-overlay-card">
        {renderContent()}

        {showActions && (
          <div className="overlay-actions">
            <button
              className="overlay-btn overlay-btn-no"
              onClick={() => onConfirm(false)}
            >
              No
              <span className="overlay-key-hint">N / Esc</span>
            </button>
            <button
              className="overlay-btn overlay-btn-yes"
              onClick={() => onConfirm(true)}
            >
              Yes
              <span className="overlay-key-hint">Y / Enter</span>
            </button>
          </div>
        )}
      </div>

      <style>{`
        .automated-overlay-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          backdrop-filter: blur(4px);
        }

        .automated-overlay-card {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 32px 40px;
          max-width: 480px;
          width: 90%;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }

        .overlay-icon {
          margin-bottom: 20px;
          color: var(--accent-primary);
        }

        .overlay-spinning {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .overlay-title {
          font-size: 1.5em;
          font-weight: 600;
          margin: 0 0 16px 0;
          color: var(--text-primary);
        }

        .overlay-description {
          color: var(--text-secondary);
          line-height: 1.6;
          margin: 0 0 16px 0;
        }

        .overlay-hint {
          font-size: 0.85em;
          color: var(--text-tertiary);
          margin: 0 0 24px 0;
        }

        .overlay-badge {
          display: inline-block;
          background: var(--accent-success);
          color: white;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 0.85em;
          margin-left: 8px;
        }

        .overlay-detection-info {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 16px;
          margin: 16px 0;
          text-align: left;
        }

        .overlay-selector {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 8px;
        }

        .overlay-selector:last-child {
          margin-bottom: 0;
        }

        .overlay-label {
          color: var(--text-secondary);
          font-size: 0.85em;
          min-width: 70px;
        }

        .overlay-selector code {
          background: var(--bg-primary);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.85em;
          color: var(--accent-primary);
          word-break: break-all;
          flex: 1;
        }

        .overlay-confidence {
          font-size: 0.85em;
          color: var(--text-secondary);
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid var(--border-color);
        }

        .overlay-screenshot {
          display: flex;
          justify-content: center;
          margin-bottom: 8px;
        }

        .product-screenshot {
          max-width: 100%;
          max-height: 200px;
          object-fit: contain;
          border-radius: 6px;
          border: 2px solid var(--accent-success);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .overlay-pagination-info {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 16px 20px;
          margin: 16px 0;
        }

        .overlay-pagination-description {
          color: var(--text-primary);
          font-size: 1em;
          line-height: 1.5;
          margin: 0;
          text-align: center;
        }

        .overlay-actions {
          display: flex;
          gap: 16px;
          justify-content: center;
          margin-top: 24px;
        }

        .overlay-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 14px 32px;
          border: none;
          border-radius: 8px;
          font-size: 1.1em;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          min-width: 120px;
        }

        .overlay-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .overlay-btn-yes {
          background: var(--accent-success);
          color: white;
        }

        .overlay-btn-yes:hover:not(:disabled) {
          background: #28a745;
          transform: translateY(-2px);
        }

        .overlay-btn-no {
          background: var(--bg-secondary);
          color: var(--text-primary);
          border: 1px solid var(--border-color);
        }

        .overlay-btn-no:hover {
          background: var(--bg-tertiary);
          transform: translateY(-2px);
        }

        .overlay-key-hint {
          font-size: 0.7em;
          font-weight: 400;
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}
