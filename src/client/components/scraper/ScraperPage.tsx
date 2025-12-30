import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ConfigSelect } from '../common/ConfigSelect';
import { StatusIndicator } from '../common/StatusIndicator';
import { useConfigsContext } from '../../context/ConfigsContext';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useBrowserSession } from '../../hooks/useBrowserSession';

interface ScrapedProduct {
  item_name?: string;
  price?: number;
  price_raw?: string;
  product_url?: string;
  image_url?: string;
  [key: string]: any;
}

// Get the WebSocket URL - use proxy path (same as BuilderPage)
const WS_URL = `ws://${window.location.host}/ws`;

export function ScraperPage() {
  // Simple console logging
  const addLog = useCallback((message: string, _type?: string) => {
    console.log(`[Scraper] ${message}`);
  }, []);

  // WebSocket connection - same pattern as BuilderPage
  const { send, subscribe, connected } = useWebSocket({
    url: WS_URL,
    onOpen: () => addLog('Connected to server', 'success'),
    onClose: () => addLog('Disconnected from server'),
    onError: () => addLog('Connection error', 'error'),
  });

  // Browser session - same pattern as BuilderPage
  const session = useBrowserSession({ send, subscribe, connected });

  // Destructure stable references from session
  const { sessionId, sessionStatus, currentUrl, scrapeResult, isScrapingRunning } = session;

  // URL and browser state
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'active' | 'loading' | 'error'>('idle');
  const [statusText, setStatusText] = useState('Ready');

  // Frame state for browser view
  const [frameData, setFrameData] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Config state from context
  const { configs, loading: configsLoading, loadConfigs } = useConfigsContext();
  const [selectedConfig, setSelectedConfig] = useState('');
  const [targetProducts, setTargetProducts] = useState(100);

  // Results
  const [results, setResults] = useState<ScrapedProduct[]>([]);

  // Load configs on mount
  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  // Subscribe to binary frames
  useEffect(() => {
    const unsubscribe = subscribe('binary' as any, (msg: any) => {
      if (msg.payload instanceof Blob) {
        const blobUrl = URL.createObjectURL(msg.payload);
        setFrameData((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return blobUrl;
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  // Update status based on session
  useEffect(() => {
    if (sessionStatus === 'ready' || sessionStatus === 'streaming') {
      setStatus('active');
      setStatusText('Browser ready');
    } else if (sessionStatus === 'connecting') {
      setStatus('loading');
      setStatusText('Opening browser...');
    } else if (sessionStatus === 'scraping') {
      setStatus('loading');
      setStatusText('Scraping...');
    } else if (sessionStatus === 'disconnected') {
      setStatus('idle');
      setStatusText('Ready');
    }
  }, [sessionStatus]);

  // Handle scrape results
  useEffect(() => {
    if (scrapeResult) {
      if (scrapeResult.success) {
        // Note: ScrapeResult uses 'items' not 'products'
        const items = scrapeResult.items || [];
        setResults(items);
        addLog(`Scrape complete: ${items.length} products`, 'success');

        // Save products to BigQuery
        if (items.length > 0) {
          saveProductsToBigQuery(items);
        }
      } else {
        addLog(`Scrape failed: ${scrapeResult.errors?.[0] || 'Unknown error'}`, 'error');
      }
    }
  }, [scrapeResult, addLog]);

  // Open browser - same pattern as BuilderPage
  const handleOpenBrowser = useCallback(() => {
    if (!url) {
      addLog('Please enter a URL first', 'error');
      return;
    }

    if (!connected) {
      addLog('Not connected to server', 'error');
      return;
    }

    addLog('Opening browser...');
    session.createSession({
      url,
      viewport: { width: 1280, height: 720 },
    });
  }, [url, connected, session, addLog]);

  // Close browser
  const handleCloseBrowser = useCallback(() => {
    session.destroySession();
    setFrameData(null);
    setResults([]);
    setStatus('idle');
    setStatusText('Ready');
    addLog('Browser closed');
  }, [session, addLog]);

  // Request video stream when session is ready
  useEffect(() => {
    if (sessionId && sessionStatus === 'ready') {
      send('webrtc:offer', {}, sessionId);
    }
  }, [sessionId, sessionStatus, send]);

  // Handle click on browser frame
  const handleFrameClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (!imgRef.current || !sessionId) return;

      const rect = imgRef.current.getBoundingClientRect();
      const scaleX = imgRef.current.naturalWidth / rect.width;
      const scaleY = imgRef.current.naturalHeight / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      send('input:mouse', { type: 'click', x, y, button: 'left' }, sessionId);
    },
    [sessionId, send]
  );

  // Handle scroll on browser frame
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!sessionId) return;

      const rect = img.getBoundingClientRect();
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      send('input:scroll', { x, y, deltaX: e.deltaX, deltaY: e.deltaY }, sessionId);
    };

    img.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      img.removeEventListener('wheel', handleWheel);
    };
  }, [sessionId, send, frameData]);

  // Save products to BigQuery
  const saveProductsToBigQuery = async (products: ScrapedProduct[]) => {
    try {
      const response = await fetch('http://localhost:3002/api/products/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products,
          scrape_type: 'single',
        }),
      });

      const result = await response.json();
      if (result.success) {
        addLog(`Saved ${result.count} products to BigQuery`, 'success');
      }
    } catch (error) {
      console.warn('Error saving products to BigQuery:', error);
    }
  };

  // Start scraping
  const handleStartScrape = useCallback(() => {
    if (!selectedConfig) {
      addLog('Please select a configuration first', 'error');
      return;
    }

    if (!sessionId) {
      addLog('Please open the browser first', 'error');
      return;
    }

    addLog('Starting scrape...');

    // Set the scraper config and execute
    // Use currentUrl if available and non-empty, otherwise fall back to input url
    const scrapeUrl = (currentUrl && currentUrl.length > 0) ? currentUrl : url;
    session.setScraperConfig({
      name: selectedConfig,
      startUrl: scrapeUrl,
      selectors: [], // Will be loaded from saved config on server
    } as any); // Cast because we're sending minimal config - server loads full config from disk

    // Execute the scrape
    setTimeout(() => {
      session.executeScrape();
    }, 100);
  }, [selectedConfig, sessionId, session, currentUrl, url, targetProducts, addLog]);

  const isBrowserOpen = sessionId !== null;

  // Download as JSON
  const handleDownloadJSON = useCallback(() => {
    if (results.length === 0) return;

    const dataStr = JSON.stringify(results, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scrape-results-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog('Downloaded results as JSON', 'success');
  }, [results, addLog]);

  // Download as CSV/Excel
  const handleDownloadExcel = useCallback(() => {
    if (results.length === 0) return;

    // Get all unique keys from results
    const allKeys = new Set<string>();
    results.forEach((item) => {
      Object.keys(item).forEach((key) => allKeys.add(key));
    });
    const headers = Array.from(allKeys);

    // Build CSV content
    const csvRows: string[] = [];

    // Header row
    csvRows.push(headers.map((h) => `"${h}"`).join(','));

    // Data rows
    results.forEach((item) => {
      const row = headers.map((header) => {
        const value = item[header];
        if (value === null || value === undefined) return '""';
        // Escape quotes and wrap in quotes
        const strValue = String(value).replace(/"/g, '""');
        return `"${strValue}"`;
      });
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scrape-results-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addLog('Downloaded results as CSV', 'success');
  }, [results, addLog]);

  return (
    <>
      <div className="hero">
        <span className="hero-badge">Run Scraper</span>
        <h1>Scrape Data</h1>
        <p className="hero-subtitle">Enter a URL, select a config, and watch the scraper in action</p>
      </div>

      <div style={{ padding: '0 20px', maxWidth: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px', marginBottom: '30px' }}>
          {/* Left Panel: Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* URL Input */}
            <div className="step-card">
              <div className="step-number">01</div>
              <h2 className="step-title">Target URL</h2>
              <div className="form-group" style={{ marginBottom: '15px' }}>
                <input
                  type="text"
                  className="form-input url-input"
                  placeholder="https://example.com/products"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={isBrowserOpen}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {!isBrowserOpen ? (
                  <button className="btn-large" onClick={handleOpenBrowser} style={{ flex: 1 }}>
                    Open Browser
                  </button>
                ) : (
                  <button className="btn-large secondary" onClick={handleCloseBrowser} style={{ flex: 1 }}>
                    Close Browser
                  </button>
                )}
              </div>
            </div>

            {/* Config Selection */}
            <div className="step-card">
              <div className="step-number">02</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h2 className="step-title" style={{ margin: 0 }}>Configuration</h2>
              </div>
              <div className="form-group">
                <label className="form-label">Saved Config</label>
                <ConfigSelect
                  configs={configs}
                  loading={configsLoading}
                  value={selectedConfig}
                  onChange={setSelectedConfig}
                  placeholder="Select a config..."
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Products to Scrape</label>
                <input
                  type="number"
                  className="form-input"
                  value={targetProducts}
                  onChange={(e) => setTargetProducts(parseInt(e.target.value) || 100)}
                  min={1}
                  max={1000}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="step-card">
              <div className="step-number">03</div>
              <h2 className="step-title">Actions</h2>
              <button
                className="btn-large"
                onClick={handleStartScrape}
                disabled={!isBrowserOpen || !selectedConfig || isScrapingRunning}
                style={{
                  background: 'var(--accent-success)',
                  borderColor: 'var(--accent-success)',
                  width: '100%',
                }}
              >
                {isScrapingRunning ? 'Scraping...' : 'Start Scraping'}
              </button>
              <div className="status-strip" style={{ marginTop: '15px' }}>
                <StatusIndicator status={status} />
                <span className="status-label">{statusText}</span>
              </div>
            </div>
          </div>

          {/* Right Panel: Browser - sticky and full height */}
          <div
            style={{
              position: 'sticky',
              top: '80px',
              height: 'calc(100vh - 100px)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Browser Container */}
            <div
              style={{
                background: '#1a1a1a',
                border: '1px solid var(--border-color)',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Browser Toolbar */}
              <div
                style={{
                  background: 'var(--bg-card)',
                  borderBottom: '1px solid var(--border-color)',
                  padding: '12px 15px',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', gap: '6px' }}>
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f57' }} />
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }} />
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#28ca41' }} />
                </div>
                <input
                  type="text"
                  className="form-input"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                  }}
                  readOnly
                  placeholder="Browser URL will appear here..."
                  value={currentUrl}
                />
              </div>

              {/* Browser View */}
              <div
                style={{
                  flex: 1,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {frameData ? (
                  <img
                    ref={imgRef}
                    src={frameData}
                    alt="Remote Browser"
                    onClick={handleFrameClick}
                    style={{
                      width: '100%',
                      height: 'auto',
                      cursor: 'pointer',
                      objectFit: 'contain',
                    }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                    {sessionStatus === 'connecting' ? (
                      <>
                        <span className="spinner" style={{ width: '50px', height: '50px', marginBottom: '20px' }} />
                        <p>Loading browser...</p>
                      </>
                    ) : (
                      <>
                        <h3 style={{ marginBottom: '15px', color: 'var(--text-primary)' }}>Scraper</h3>
                        <p style={{ marginBottom: '20px' }}>Click "Open Browser" to load a page</p>
                        <p style={{ fontSize: '0.85em', opacity: 0.7 }}>
                          Then select a config and start scraping
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Results Section */}
        {results.length > 0 && (
          <div className="step-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2 className="step-title" style={{ margin: 0 }}>Results Preview ({results.length} products)</h2>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="btn secondary"
                  onClick={handleDownloadJSON}
                  style={{ padding: '8px 16px', fontSize: '0.85em' }}
                >
                  Download JSON
                </button>
                <button
                  className="btn"
                  onClick={handleDownloadExcel}
                  style={{ padding: '8px 16px', fontSize: '0.85em' }}
                >
                  Download CSV
                </button>
              </div>
            </div>
            <div className="reports-table-container">
              <table className="reports-table">
                <thead>
                  <tr>
                    <th>Product Name</th>
                    <th>Price</th>
                    <th>URL</th>
                    <th>Image</th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 10).map((product, index) => (
                    <tr key={index}>
                      <td>{product.title || product.Title || product.item_name || '-'}</td>
                      <td>{product.price || product.Price || product.originalPrice || product.price_raw || '-'}</td>
                      <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {product.url || product.URL || product.product_url ? (
                          <a href={product.url || product.URL || product.product_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)' }}>
                            Link
                          </a>
                        ) : '-'}
                      </td>
                      <td>
                        {(product.image || product.Image || product.image_url) ? (
                          <img
                            src={product.image || product.Image || product.image_url}
                            alt=""
                            style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }}
                          />
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {results.length > 10 && (
              <p style={{ marginTop: '15px', color: 'var(--text-secondary)', fontSize: '0.85em' }}>
                Showing first 10 of {results.length} products
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
