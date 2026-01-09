// ============================================================================
// AUTOMATED BUILDER OVERLAY - Confirmation overlays for automated workflow
// ============================================================================

import { useEffect, useCallback } from 'react';
import type { ElementSelector } from '../../../shared/types';
import type {
  OverlayType,
  DemoProgressState,
  DemoPaginationResult,
} from '../../hooks/useAutomatedBuilderFlow';

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

  // Pagination demo props
  demoProgress?: DemoProgressState;
  demoResult?: DemoPaginationResult | null;
  onRetryDemo?: () => void;
  onSkipPagination?: () => void;

  // Captcha-specific
  captchaType?: string;
}

export function AutomatedBuilderOverlay({
  type,
  isVisible,
  onConfirm,
  dismissCount = 0,
  detectedProduct,
  productConfidence = 0,
  productScreenshot,
  demoProgress,
  demoResult,
  onRetryDemo,
  onSkipPagination,
  captchaType = 'none',
}: AutomatedBuilderOverlayProps) {
  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isVisible) return;

      // Skip pagination (S key) - works in demo and success modes
      if (e.key === 's' || e.key === 'S') {
        if ((type === 'pagination_demo' || type === 'pagination_demo_success') && onSkipPagination) {
          e.preventDefault();
          onSkipPagination();
        }
        return;
      }

      // During demo mode, only allow skip - user interaction happens in browser view
      if (type === 'pagination_demo') return;

      // During popup_closing, no keyboard shortcuts - just wait
      if (type === 'popup_closing' || type === 'captcha') return;

      // Demo success mode keyboard shortcuts
      if (type === 'pagination_demo_success') {
        if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          onConfirm(true); // Confirm the demo result
        } else if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          onRetryDemo?.(); // Retry demo
        }
        return;
      }

      // Standard confirm/reject for other overlays
      if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        onConfirm(true);
      } else if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        onConfirm(false);
      }
    },
    [isVisible, type, onConfirm, onRetryDemo, onSkipPagination]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isVisible || !type) return null;

  const renderContent = () => {
    switch (type) {
      case 'captcha':
        return (
          <>
            <div className="overlay-icon" style={{ color: 'var(--accent-warning)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <circle cx="12" cy="16" r="1" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h2 className="overlay-title">CAPTCHA Detected</h2>
            <p className="overlay-description">
              This site requires human verification. Please solve the CAPTCHA in the browser view.
            </p>
            <div className="captcha-status">
              <div className="captcha-type">
                Challenge type: <strong>{captchaType}</strong>
              </div>
              <div className="captcha-polling">
                <div className="captcha-spinner" />
                <span>Waiting for you to solve the CAPTCHA...</span>
              </div>
            </div>
            <p className="overlay-hint">
              The flow will automatically continue once the CAPTCHA is solved.
              (Timeout: 2 minutes)
            </p>
          </>
        );

      case 'popup_closing':
        return (
          <>
            <div className="overlay-icon" style={{ color: 'var(--accent-primary)' }}>
              <div className="spinner" style={{ width: '48px', height: '48px', borderWidth: '3px' }}></div>
            </div>
            <h2 className="overlay-title">Preparing Page</h2>
            <p className="overlay-description">
              Closing popups and cookie banners automatically...
            </p>
            <p className="overlay-hint" style={{ marginTop: '10px', opacity: 0.7 }}>
              Please wait while the page is being prepared for scraping.
            </p>
          </>
        );

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

      case 'pagination_demo':
        return (
          <>
            <div className="overlay-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </div>
            <h2 className="overlay-title">Demonstrate Pagination</h2>
            <p className="overlay-description">
              Show us how to load more products:
            </p>

            <div className="demo-instructions">
              <div className="demo-instruction">
                <span className="demo-icon">↕️</span>
                <span><strong>Scroll down</strong> until more products appear</span>
              </div>
              <div className="demo-instruction-or">OR</div>
              <div className="demo-instruction">
                <span className="demo-icon">👆</span>
                <span><strong>Click</strong> the "Next" or "Load More" button</span>
              </div>
            </div>

            {/* Live progress indicator */}
            <div className="demo-status">
              <div className="demo-product-count">
                Products: <strong>{demoProgress?.productCount || 0}</strong>
                {(demoProgress?.productDelta ?? 0) > 0 && (
                  <span className="demo-delta-badge">+{demoProgress?.productDelta} new!</span>
                )}
              </div>

              {/* Show detected method */}
              {(demoProgress?.accumulatedScroll ?? 0) > 0 && (
                <p className="demo-method-hint">
                  Scroll detected: {Math.abs(demoProgress?.accumulatedScroll || 0)}px
                </p>
              )}
              {demoProgress?.lastClickedSelector && (
                <p className="demo-method-hint">
                  Click detected: {demoProgress.lastClickedText && (
                    <strong>"{demoProgress.lastClickedText}"</strong>
                  )} <code>{demoProgress.lastClickedSelector}</code>
                </p>
              )}

              {/* Auto-completing indicator */}
              {demoProgress?.shouldAutoComplete && (
                <p className="demo-auto-complete">
                  ✓ New products detected! Auto-completing...
                </p>
              )}

              {/* Wrong navigation warning */}
              {demoProgress?.wrongNavWarning && (
                <p className="demo-wrong-nav-warning">
                  ⚠️ That navigated away from the page. We went back automatically.
                  Try clicking a different element.
                </p>
              )}
            </div>

            <div className="overlay-actions">
              {onSkipPagination && (
                <button
                  className="overlay-btn overlay-btn-skip"
                  onClick={onSkipPagination}
                >
                  Skip Pagination
                  <span className="overlay-key-hint">S</span>
                </button>
              )}
            </div>

            <p className="overlay-hint">
              The system will auto-complete when new products are detected.
            </p>
          </>
        );

      case 'pagination_demo_success':
        const methodName = demoResult?.method === 'scroll' ? 'Infinite Scroll' : 'Click Button';
        return (
          <>
            <div className="overlay-icon" style={{ color: 'var(--accent-success)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h2 className="overlay-title">Pagination Method Captured!</h2>

            {demoResult && (
              <div className="demo-result-details">
                <div className="demo-result-row">
                  <span className="demo-result-label">Method:</span>
                  <span className="demo-result-value demo-method-badge">{methodName}</span>
                </div>

                {demoResult.method === 'scroll' && demoResult.scrollDistance && (
                  <div className="demo-result-row">
                    <span className="demo-result-label">Scroll Distance:</span>
                    <span className="demo-result-value">{demoResult.scrollDistance}px</span>
                  </div>
                )}

                {demoResult.method === 'click' && demoResult.clickSelector && (
                  <div className="demo-result-row">
                    <span className="demo-result-label">Button:</span>
                    <span className="demo-result-value">
                      {demoResult.clickText && <strong>"{demoResult.clickText}"</strong>}
                      {' '}<code className="demo-selector">{demoResult.clickSelector}</code>
                    </span>
                  </div>
                )}

                <div className="demo-result-row demo-result-products">
                  <span className="demo-result-label">Products:</span>
                  <span className="demo-result-value">
                    {demoResult.beforeProductCount} → {demoResult.afterProductCount}
                    <span className="demo-delta-badge">+{demoResult.productDelta}</span>
                  </span>
                </div>
              </div>
            )}
          </>
        );

      default:
        return null;
    }
  };

  // Demo mode, captcha mode, and popup_closing have no actions - user can't interact during these
  const showActions = type !== 'pagination_demo' && type !== 'captcha' && type !== 'popup_closing';

  // Render action buttons based on overlay type
  const renderActions = () => {
    if (type === 'pagination_demo_success') {
      return (
        <div className="overlay-actions overlay-actions-demo">
          {onRetryDemo && (
            <button
              className="overlay-btn overlay-btn-retry"
              onClick={onRetryDemo}
            >
              Try Again
              <span className="overlay-key-hint">R</span>
            </button>
          )}
          {onSkipPagination && (
            <button
              className="overlay-btn overlay-btn-skip"
              onClick={onSkipPagination}
            >
              Skip
              <span className="overlay-key-hint">S</span>
            </button>
          )}
          <button
            className="overlay-btn overlay-btn-yes"
            onClick={() => onConfirm(true)}
          >
            Use This
            <span className="overlay-key-hint">Y / Enter</span>
          </button>
        </div>
      );
    }

    return (
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
    );
  };

  // Demo mode and captcha mode use a side panel that doesn't block the browser view
  const isDemoMode = type === 'pagination_demo';
  const isCaptchaMode = type === 'captcha';
  const useSidePanel = isDemoMode || isCaptchaMode;

  return (
    <div className={`automated-overlay-backdrop ${useSidePanel ? 'demo-mode' : ''}`}>
      <div className={`automated-overlay-card ${type === 'pagination_demo_success' ? 'overlay-card-wide' : ''} ${useSidePanel ? 'demo-mode-card' : ''} ${isCaptchaMode ? 'captcha-mode-card' : ''}`}>
        {renderContent()}

        {showActions && renderActions()}
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

        /* Demo mode: position overlay on the left, don't block browser view */
        .automated-overlay-backdrop.demo-mode {
          background: transparent;
          backdrop-filter: none;
          pointer-events: none;
          align-items: flex-start;
          justify-content: flex-start;
          padding: 20px;
        }

        .automated-overlay-card.demo-mode-card {
          pointer-events: auto;
          max-width: 380px;
          padding: 24px;
          margin-top: 60px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
          border: 2px solid var(--accent-primary);
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

        /* Wide card for verification */
        .overlay-card-wide {
          max-width: 600px;
        }

        /* Pagination testing progress */
        .overlay-test-progress {
          margin: 16px 0;
        }

        .overlay-method-name {
          font-size: 1.2em;
          font-weight: 600;
          color: var(--accent-primary);
          margin: 8px 0 16px;
        }

        .overlay-progress-bar {
          height: 6px;
          background: var(--bg-tertiary);
          border-radius: 3px;
          overflow: hidden;
        }

        .overlay-progress-fill {
          height: 100%;
          background: var(--accent-primary);
          transition: width 0.3s ease;
        }

        /* Verification content */
        .overlay-verification-content {
          margin: 16px 0;
        }

        .overlay-method-header {
          display: flex;
          justify-content: center;
          gap: 12px;
          margin-bottom: 16px;
        }

        .overlay-method-badge {
          display: inline-block;
          padding: 6px 12px;
          background: var(--accent-primary);
          color: white;
          border-radius: 16px;
          font-size: 0.9em;
          font-weight: 500;
        }

        .overlay-confidence-badge {
          display: inline-block;
          padding: 6px 12px;
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          border-radius: 16px;
          font-size: 0.9em;
        }

        .overlay-slider-container {
          margin: 16px 0;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid var(--border-color);
        }

        .overlay-product-delta {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin: 16px 0;
          font-size: 1em;
        }

        .delta-before {
          color: var(--text-secondary);
        }

        .delta-arrow {
          color: var(--accent-primary);
          font-weight: bold;
        }

        .delta-after {
          color: var(--text-primary);
          font-weight: 500;
        }

        .delta-gain {
          color: var(--accent-success);
          margin-left: 4px;
        }

        .overlay-reasoning {
          font-size: 0.9em;
          color: var(--text-secondary);
          background: var(--bg-secondary);
          padding: 12px 16px;
          border-radius: 8px;
          margin: 0;
          line-height: 1.5;
          text-align: left;
        }

        /* Demo overlay styles */
        .demo-instructions {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 16px;
          margin: 16px 0;
          text-align: left;
        }

        .demo-instruction {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
        }

        .demo-icon {
          font-size: 1.5em;
          width: 40px;
          text-align: center;
        }

        .demo-instruction-or {
          text-align: center;
          color: var(--text-tertiary);
          font-size: 0.9em;
          padding: 4px 0;
        }

        .demo-status {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 16px;
          margin: 16px 0;
        }

        .demo-product-count {
          font-size: 1.2em;
          color: var(--text-primary);
          margin-bottom: 8px;
        }

        .demo-delta-badge {
          display: inline-block;
          background: var(--accent-success);
          color: white;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 0.8em;
          margin-left: 8px;
          font-weight: 600;
        }

        .demo-method-hint {
          font-size: 0.9em;
          color: var(--text-secondary);
          margin: 8px 0;
        }

        .demo-method-hint code {
          background: var(--bg-primary);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.85em;
          color: var(--accent-primary);
        }

        .demo-auto-complete {
          color: var(--accent-success);
          font-weight: 500;
          margin: 8px 0;
        }

        .demo-wrong-nav-warning {
          color: var(--accent-warning);
          background: rgba(255, 193, 7, 0.1);
          padding: 10px 12px;
          border-radius: 6px;
          margin: 8px 0;
          font-size: 0.9em;
        }

        /* Demo success styles */
        .demo-result-details {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 16px 20px;
          margin: 16px 0;
          text-align: left;
        }

        .demo-result-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid var(--border-color);
        }

        .demo-result-row:last-child {
          border-bottom: none;
        }

        .demo-result-label {
          color: var(--text-secondary);
          font-size: 0.9em;
        }

        .demo-result-value {
          color: var(--text-primary);
          font-weight: 500;
        }

        .demo-method-badge {
          background: var(--accent-primary);
          color: white;
          padding: 4px 12px;
          border-radius: 12px;
        }

        .demo-selector {
          background: var(--bg-primary);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.85em;
          color: var(--accent-primary);
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .demo-result-products {
          margin-top: 8px;
          padding-top: 12px;
        }

        /* Demo action buttons */
        .overlay-actions-demo {
          flex-wrap: wrap;
          gap: 12px;
        }

        .overlay-btn-retry {
          background: var(--bg-tertiary);
          color: var(--text-primary);
          border: 1px solid var(--border-color);
        }

        .overlay-btn-retry:hover {
          background: var(--accent-primary);
          color: white;
          border-color: var(--accent-primary);
        }

        .overlay-btn-skip {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border-color);
          min-width: auto;
          padding: 14px 20px;
        }

        .overlay-btn-skip:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        /* Captcha overlay styles */
        .captcha-mode-card {
          border-color: var(--accent-warning) !important;
        }

        .captcha-status {
          background: var(--bg-secondary);
          border: 1px solid var(--accent-warning);
          border-radius: 8px;
          padding: 16px;
          margin: 16px 0;
        }

        .captcha-type {
          color: var(--text-secondary);
          margin-bottom: 12px;
        }

        .captcha-polling {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--accent-primary);
        }

        .captcha-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid var(--accent-primary);
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
