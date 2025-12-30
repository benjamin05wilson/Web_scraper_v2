import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useBrowserSession } from '../../hooks/useBrowserSession';
import { ExtractedContentLabeler } from './ExtractedContentLabeler';
import { DismissPanel } from './DismissPanel';
import { SelectedDataSummary } from './SelectedDataSummary';
import { PaginationConfig } from './PaginationConfig';
import { createLogEntry, LogEntry } from './ActivityLog';
import { PriceFormatModal } from './PriceFormatModal';
import { CountrySelect } from '../common/CountrySelect';
import { StatusIndicator } from '../common/StatusIndicator';

type FieldType = 'Title' | 'Price' | 'URL' | 'NextPage' | 'Image';
type LabelerFieldType = FieldType | 'Skip';

interface LabeledItem {
  field: LabelerFieldType;
  item: ExtractedItem;
}

interface SelectedItem {
  text?: string;
  href?: string;
  src?: string;
  selector?: string;
  selection_id?: string;
  tagName?: string;
}

interface SelectedData {
  Title: SelectedItem[];
  Price: SelectedItem[];
  URL: SelectedItem[];
  NextPage: SelectedItem[];
  Image: SelectedItem[];
}

interface ExtractedItem {
  type: 'text' | 'link' | 'image';
  value: string;
  selector: string;
  displayText: string;
  tagName?: string;
}

interface DismissAction {
  selector: string;
  text?: string;
  isLanguageRelated?: boolean;
  x?: number;
  y?: number;
}

interface PaginationPattern {
  type: 'url_pattern' | 'next_page' | 'infinite_scroll';
  pattern: string;
  start_page?: number;
}

interface PriceFormat {
  multiplier: number;
  remove_decimals: boolean;
}

// Get the WebSocket URL - use proxy path
const WS_URL = `ws://${window.location.host}/ws`;

export function BuilderPage() {
  // WebSocket connection
  const { connected, send, subscribe } = useWebSocket({
    url: WS_URL,
    onOpen: () => addLog('Connected to server', 'success'),
    onClose: () => addLog('Disconnected from server'),
    onError: () => addLog('Connection error', 'error'),
  });

  // Browser session
  const session = useBrowserSession({ send, subscribe, connected });

  // Destructure stable references from session to avoid infinite loops in effects
  const {
    extractedContent,
    selectedElement,
    extractContainerContent,
    sessionStatus,
    selectionMode,
    sessionId,
    toggleSelectionMode,
    autoDetectProduct,
    isAutoDetecting,
  } = session;

  // URL and browser state
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'active' | 'loading' | 'error'>('idle');
  const [statusText, setStatusText] = useState('Ready to start');

  // Frame state for browser view
  const [frameData, setFrameData] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Mode state
  const [modeBadge, setModeBadge] = useState<'Browse' | 'SELECTING' | 'DISMISS'>('Browse');

  // Container extraction state - for card-based labeling
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([]);
  const [containerSelector, setContainerSelector] = useState<string>('');
  const [showLabeler, setShowLabeler] = useState(false);
  const lastExtractedSelectorRef = useRef<string>('');

  // Selection state
  const [selectedData, setSelectedData] = useState<SelectedData>({
    Title: [],
    Price: [],
    URL: [],
    NextPage: [],
    Image: [],
  });
  const [dismissActions, setDismissActions] = useState<DismissAction[]>([]);
  const [dismissMode, setDismissMode] = useState(false);
  const [paginationPattern, setPaginationPattern] = useState<PaginationPattern | null>(null);

  // Form state
  const [country, setCountry] = useState('');
  const [competitorType, setCompetitorType] = useState<'local' | 'global'>('local');
  const [suggestedConfigName, setSuggestedConfigName] = useState('');

  // Read URL query params (from batch page "Build" button)
  const [searchParams] = useSearchParams();

  // Activity log (logEntries used by setLogEntries, kept for future activity display)
  const [, setLogEntries] = useState<LogEntry[]>([]);

  // Price format modal
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [samplePrice, setSamplePrice] = useState('');
  const [pendingSave, setPendingSave] = useState<{ filename: string } | null>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogEntries((prev) => [...prev, createLogEntry(message, type)]);
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
  }, []);

  // Initialize URL, country, and suggested name from query params on mount
  useEffect(() => {
    const urlParam = searchParams.get('url');
    const countryParam = searchParams.get('country');
    const nameParam = searchParams.get('name');
    if (urlParam && !url) {
      setUrl(urlParam);
      addLog(`Pre-filled URL from batch: ${urlParam}`, 'info');
    }
    if (countryParam && !country) {
      setCountry(countryParam);
      addLog(`Pre-filled country: ${countryParam}`, 'info');
    }
    if (nameParam && !suggestedConfigName) {
      setSuggestedConfigName(nameParam);
      addLog(`Suggested config name: ${nameParam}`, 'info');
    }
  }, [searchParams, addLog]); // Only run on mount/param change

  // Subscribe to binary frames
  useEffect(() => {
    const unsubscribe = subscribe('binary' as any, (msg) => {
      if (msg.payload instanceof Blob) {
        const blobUrl = URL.createObjectURL(msg.payload);
        setFrameData(blobUrl);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  // Cleanup old blob URLs
  useEffect(() => {
    return () => {
      if (frameData) {
        URL.revokeObjectURL(frameData);
      }
    };
  }, [frameData]);

  // Listen for extracted content from session
  // Max items threshold - if more than this, likely selected the grid not a single product
  // Increased from 15 to 30 to accommodate modern sites with complex product cards
  const MAX_EXTRACTED_ITEMS = 50;

  useEffect(() => {
    // Process when extractedContent changes and has items
    if (extractedContent && extractedContent.length > 0) {
      console.log('[BuilderPage] Extracted content received:', extractedContent.length, 'items');
      console.log('[BuilderPage] Item types:', extractedContent.map(i => `${i.type}:${i.value?.substring(0, 50)}`));

      // Check if too many items (likely selected the grid instead of a product)
      if (extractedContent.length > MAX_EXTRACTED_ITEMS) {
        addLog(
          `Too many items (${extractedContent.length}) - likely selected the product grid. Try clicking directly on a single product card.`,
          'error'
        );
        // Clear the selector ref so user can try again
        lastExtractedSelectorRef.current = '';
        return;
      }

      // Filter out very short text items (likely just labels or icons)
      const filteredContent = (extractedContent as ExtractedItem[]).filter((item) => {
        // Keep all links and images
        if (item.type === 'link' || item.type === 'image') return true;
        // For text, filter out very short items (less than 2 chars) unless they look like prices
        if (item.type === 'text') {
          const value = item.value?.trim() || '';
          // Keep if it looks like a price (has currency symbol or numbers with decimal)
          if (/[$£€¥₹]|^\d+[.,]\d{2}$|^\d+$/.test(value)) return true;
          // Keep if at least 2 characters
          return value.length >= 2;
        }
        return true;
      });

      setExtractedItems(filteredContent);
      setShowLabeler(true);
      addLog(`Extracted ${filteredContent.length} items from container`, 'success');
    }
  }, [extractedContent, addLog]);

  // Update status based on session
  useEffect(() => {
    if (sessionStatus === 'ready' || sessionStatus === 'streaming') {
      setStatus('active');
      setStatusText('Browser ready');
    } else if (sessionStatus === 'connecting') {
      setStatus('loading');
      setStatusText('Opening browser...');
    } else if (sessionStatus === 'disconnected') {
      setStatus('idle');
      setStatusText('Ready to start');
    }
  }, [sessionStatus]);

  // Update mode badge
  useEffect(() => {
    if (dismissMode) {
      setModeBadge('DISMISS');
    } else if (selectionMode) {
      setModeBadge('SELECTING');
    } else {
      setModeBadge('Browse');
    }
  }, [selectionMode, dismissMode]);

  // Open browser
  const handleOpenBrowser = useCallback(() => {
    if (!url) {
      addLog('Please enter a URL first', 'error');
      return;
    }

    if (!connected) {
      addLog('Not connected to server', 'error');
      return;
    }

    const availableWidth = window.innerWidth - 400;
    const availableHeight = window.innerHeight - 200;
    const viewportWidth = Math.max(1280, Math.min(availableWidth, 1920));
    const viewportHeight = Math.max(720, Math.min(availableHeight, 1080));

    addLog('Opening browser...');
    session.createSession({
      url,
      viewport: { width: viewportWidth, height: viewportHeight },
    });

    setTimeout(() => {
      if (sessionId) {
        send('webrtc:offer', {}, sessionId);
      }
    }, 1000);
  }, [url, connected, session, send, addLog]);

  // Close browser
  const handleCloseBrowser = useCallback(() => {
    session.destroySession();
    setFrameData(null);
    setDismissMode(false);
    setModeBadge('Browse');
    setSelectedData({ Title: [], Price: [], URL: [], NextPage: [], Image: [] });
    setDismissActions([]);
    setExtractedItems([]);
    setContainerSelector('');
    setShowLabeler(false);
    setStatus('idle');
    setStatusText('Ready to start');
    addLog('Browser closed. Selections cleared.');
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

  // Handle scroll on browser frame - use native event listener for passive: false
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

  // Toggle selection mode
  const handleToggleSelectionMode = useCallback(() => {
    if (dismissMode) {
      setDismissMode(false);
    }
    toggleSelectionMode();
    addLog(selectionMode ? 'Browse mode' : 'Selection ON - click a product card');
  }, [toggleSelectionMode, selectionMode, dismissMode, addLog]);

  // Toggle dismiss mode
  const handleToggleDismissMode = useCallback(() => {
    const newMode = !dismissMode;
    setDismissMode(newMode);

    if (newMode && selectionMode) {
      toggleSelectionMode();
    }

    addLog(newMode ? 'Record mode ON - click popups or language selectors' : 'Record mode OFF');
  }, [dismissMode, selectionMode, toggleSelectionMode, addLog]);

  // Handle selected element - extract container content
  // Triggers on selection mode click OR auto-detect
  useEffect(() => {
    if (selectedElement) {
      // Use combinedCss if available (for Zara split layout), otherwise use css
      const element = selectedElement as any;
      const selector = element.combinedCss || element.css;

      // Only extract if we haven't already extracted for this selector
      if (selector && selector !== lastExtractedSelectorRef.current) {
        lastExtractedSelectorRef.current = selector;
        addLog(`Extracting content from: ${selector}`);
        setContainerSelector(selector);

        // Small delay to ensure WebSocket subscriptions are fully set up
        // This fixes race condition on initial page load where extraction
        // response arrives before container:content subscription is ready
        const timeoutId = setTimeout(() => {
          extractContainerContent(selector);
        }, 100);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [selectedElement, extractContainerContent, addLog]);

  // Handle labels from the ExtractedContentLabeler
  const handleSaveLabels = useCallback(
    (labels: LabeledItem[], _container: string) => {
      // Filter out 'Skip' items and process the rest
      const validLabels = labels.filter((l): l is LabeledItem & { field: FieldType } => l.field !== 'Skip');

      validLabels.forEach(({ field, item }) => {
        const selectedItem: SelectedItem = {
          text: item.type === 'text' ? item.value : undefined,
          href: item.type === 'link' ? item.value : undefined,
          src: item.type === 'image' ? item.value : undefined,
          selector: item.selector,
          tagName: item.tagName,
        };

        setSelectedData((prev) => ({
          ...prev,
          [field]: [...prev[field], selectedItem],
        }));

        addLog(`[${field}] ${item.displayText}`, 'selected');
      });

      setShowLabeler(false);
      setExtractedItems([]);
      lastExtractedSelectorRef.current = '';
      addLog(`Applied ${validLabels.length} labels from container`);
    },
    [addLog]
  );

  // Cancel labeling
  const handleCancelLabeling = useCallback(() => {
    setShowLabeler(false);
    setExtractedItems([]);
    lastExtractedSelectorRef.current = '';
    addLog('Labeling cancelled');
  }, [addLog]);

  // Auto-detect product
  const handleAutoDetect = useCallback(() => {
    if (!sessionId) return;
    addLog('Auto-detecting product card...');
    autoDetectProduct();
  }, [sessionId, autoDetectProduct, addLog]);

  // Remove selection
  const handleRemoveSelection = useCallback(
    (field: keyof SelectedData, index: number) => {
      setSelectedData((prev) => {
        const newData = { ...prev };
        newData[field] = [...prev[field]];
        newData[field].splice(index, 1);
        return newData;
      });

      addLog(`Removed [${field}] selection`);
    },
    [addLog]
  );

  // Clear all selections
  const handleClearSelections = useCallback(() => {
    setSelectedData({ Title: [], Price: [], URL: [], NextPage: [], Image: [] });
    setDismissActions([]);
    setPaginationPattern(null);
    setExtractedItems([]);
    setShowLabeler(false);
    clearLog();
    addLog('All selections cleared');
  }, [addLog, clearLog]);

  // Train and save config
  const handleTrainAndSave = useCallback(async () => {
    const totalSelections = Object.values(selectedData).reduce((sum, arr) => sum + arr.length, 0);
    if (totalSelections === 0) {
      addLog('Please select some elements first', 'error');
      return;
    }

    // Use suggested name from batch page, or prompt for one
    const defaultName = suggestedConfigName || 'my-config';
    const filename = prompt('Config name:', defaultName);
    if (!filename) return;

    addLog('-------------------------------');
    addLog(`SAVING CONFIG: ${filename}`, 'success');
    setStatus('loading');
    setStatusText('Training...');

    try {
      const trainResponse = await fetch('/api/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          wanted_dict: selectedData,
        }),
      });

      if (!trainResponse.ok) {
        throw new Error('Training failed');
      }

      const trainData = await trainResponse.json();
      addLog('Training complete', 'success');

      if (trainData?.results) {
        for (const [field, items] of Object.entries(trainData.results)) {
          if (Array.isArray(items) && items.length > 0) {
            addLog(`  - ${field}: ${items.length} matches found`);
          }
        }
      }

      const priceResults = trainData?.results?.Price || [];
      if (priceResults.length > 0) {
        setSamplePrice(priceResults[0]);
        setPendingSave({ filename });
        setPriceModalOpen(true);
        return;
      }

      await completeSave(filename, null);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      addLog(`Error: ${error}`, 'error');
      setStatus('error');
      setStatusText('Error');
    }
  }, [url, selectedData, addLog, suggestedConfigName]);

  // Complete save after price format confirmation
  const completeSave = useCallback(
    async (filename: string, priceFormat: PriceFormat | null) => {
      try {
        // Convert selectedData to selectors format expected by the scraper
        // selectedData has: { Title: SelectedItem[], Price: SelectedItem[], URL: SelectedItem[], ... }
        // We need: { Title: string[], Price: string[], URL: string[], ... } (CSS selectors)
        const selectors: Record<string, string[]> = {};

        for (const [field, items] of Object.entries(selectedData)) {
          if (items.length > 0) {
            // Extract the CSS selector from each item
            const cssSelectors = items
              .map((item: SelectedItem) => item.selector)
              .filter((s: string | undefined): s is string => !!s);

            if (cssSelectors.length > 0) {
              selectors[field] = cssSelectors;
            }
          }
        }

        const saveBody: Record<string, unknown> = {
          file_path: filename.endsWith('.json') ? filename : filename + '.json',
          competitor_type: competitorType,
          country,
          url, // Save the base URL
          selectors, // Save the selectors!
        };

        // Also save the container selector if we have one
        if (containerSelector) {
          saveBody.itemContainer = containerSelector;
        }

        if (dismissActions.length > 0) {
          saveBody.dismiss_actions = dismissActions;
        }
        if (priceFormat) {
          saveBody.price_format = priceFormat;
        }
        if (paginationPattern) {
          saveBody.pagination = paginationPattern;
          addLog(`Pagination pattern: ${paginationPattern.pattern}`);
        }

        const saveResponse = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saveBody),
        });

        if (!saveResponse.ok) {
          throw new Error('Save failed');
        }

        addLog(`Config saved to: configs/${filename}.json`, 'success');
        addLog('-------------------------------');
        setStatus('active');
        setStatusText('Config saved!');
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Unknown error';
        addLog(`Error: ${error}`, 'error');
        setStatus('error');
        setStatusText('Error');
      }
    },
    [competitorType, country, dismissActions, paginationPattern, addLog, selectedData, url, containerSelector]
  );

  const handlePriceFormatConfirm = useCallback(
    (priceFormat: PriceFormat | null) => {
      if (pendingSave) {
        completeSave(pendingSave.filename, priceFormat);
      }
      setPendingSave(null);
    },
    [pendingSave, completeSave]
  );

  const isBrowserOpen = sessionId !== null;

  return (
    <>
      <div className="hero">
        <span className="hero-badge">Config Builder</span>
        <h1>Build Scraper</h1>
        <p className="hero-subtitle">Click a product card, then label its contents to create scraping configs</p>
      </div>

      <div style={{ padding: '0 20px', maxWidth: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '20px', marginBottom: '30px', alignItems: 'start' }}>
          {/* Left Panel: Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* URL Input */}
            <div className="step-card">
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
                <button
                  className="btn-large"
                  onClick={handleOpenBrowser}
                  style={{ flex: 1, display: isBrowserOpen ? 'none' : 'block' }}
                  disabled={!connected}
                >
                  {connected ? 'Open Browser' : 'Connecting...'}
                </button>
                <button
                  className="btn secondary"
                  onClick={handleCloseBrowser}
                  style={{ display: isBrowserOpen ? 'block' : 'none' }}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Dismiss Panel */}
            <DismissPanel
              dismissMode={dismissMode}
              onToggleDismissMode={handleToggleDismissMode}
              dismissActions={dismissActions}
              disabled={!isBrowserOpen}
            />

            {/* Selection Mode */}
            <div className="step-card">
              <h2 className="step-title">Select Product Card</h2>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <button
                  className="btn-large"
                  onClick={handleToggleSelectionMode}
                  disabled={!isBrowserOpen}
                  style={{
                    flex: 1,
                    background: selectionMode ? 'var(--accent-danger)' : 'var(--accent-success)',
                    borderColor: selectionMode ? 'var(--accent-danger)' : 'var(--accent-success)',
                  }}
                >
                  {selectionMode ? 'STOP SELECTING' : 'START SELECTING'}
                </button>
                <button
                  className="btn secondary"
                  onClick={handleAutoDetect}
                  disabled={!isBrowserOpen || isAutoDetecting}
                  style={{ padding: '12px 16px' }}
                  title="Auto-detect first product"
                >
                  {isAutoDetecting ? '...' : 'Auto'}
                </button>
              </div>
              <p style={{ fontSize: '0.85em', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                Click on a <strong>product card</strong> in the browser. All text, links, and images will be extracted for you to label.
              </p>
            </div>

            {/* Extracted Content Labeler - shows when container is selected */}
            {showLabeler && extractedItems.length > 0 && (
              <ExtractedContentLabeler
                items={extractedItems}
                containerSelector={containerSelector}
                onSaveLabels={handleSaveLabels}
                onCancel={handleCancelLabeling}
              />
            )}

            {/* Selected Data Summary */}
            <SelectedDataSummary
              data={selectedData}
              onRemove={handleRemoveSelection}
            />

            {/* Pagination Config */}
            <PaginationConfig baseUrl={url} pattern={paginationPattern} onPatternDetected={setPaginationPattern} />

            {/* Country Selection */}
            <div className="step-card">
              <h2 className="step-title">Country</h2>
              <CountrySelect value={country} onChange={setCountry} />
            </div>

            {/* Competitor Type */}
            <div className="step-card">
              <h2 className="step-title">Competitor Type</h2>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                    padding: '12px 15px',
                    background: 'var(--bg-secondary)',
                    border: `1px solid ${competitorType === 'local' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    flex: 1,
                  }}
                >
                  <input
                    type="radio"
                    name="competitor-type"
                    value="local"
                    checked={competitorType === 'local'}
                    onChange={() => setCompetitorType('local')}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.9em' }}>Local</span>
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                    padding: '12px 15px',
                    background: 'var(--bg-secondary)',
                    border: `1px solid ${competitorType === 'global' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    flex: 1,
                  }}
                >
                  <input
                    type="radio"
                    name="competitor-type"
                    value="global"
                    checked={competitorType === 'global'}
                    onChange={() => setCompetitorType('global')}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.9em' }}>Global</span>
                </label>
              </div>
            </div>

            {/* Save Actions */}
            <div className="step-card">
              <h2 className="step-title">Save Config</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button className="btn-large" onClick={handleTrainAndSave}>
                  Train and Save Config
                </button>
                <button className="btn secondary" onClick={handleClearSelections}>
                  Clear All
                </button>
              </div>
              <div className="status-strip" style={{ marginTop: '15px' }}>
                <StatusIndicator status={status} />
                <span className="status-label">{statusText}</span>
              </div>
            </div>
          </div>

          {/* Right Panel: Browser - sticky */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              position: 'sticky',
              top: '80px',
              maxHeight: 'calc(100vh - 100px)',
              overflowY: 'auto',
            }}
          >
            {/* Browser Container */}
            <div
              style={{
                background: '#1a1a1a',
                border: '1px solid var(--border-color)',
                minHeight: '450px',
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
                  value={session.currentUrl}
                />
                <span
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.7em',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    background:
                      modeBadge === 'SELECTING'
                        ? 'var(--accent-success)'
                        : modeBadge === 'DISMISS'
                        ? '#ff9800'
                        : 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    color: modeBadge === 'Browse' ? 'var(--text-secondary)' : 'white',
                  }}
                >
                  {modeBadge}
                </span>
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
                      cursor: selectionMode ? 'crosshair' : 'pointer',
                      objectFit: 'contain',
                    }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                    <h3 style={{ marginBottom: '15px', color: 'var(--text-primary)' }}>Config Builder</h3>
                    <p style={{ marginBottom: '20px' }}>Click "Open Browser" to load a page</p>
                    <p style={{ fontSize: '0.85em', opacity: 0.7 }}>
                      Then click a product card to extract and label its content
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Price Format Modal */}
      <PriceFormatModal
        isOpen={priceModalOpen}
        onClose={() => setPriceModalOpen(false)}
        samplePrice={samplePrice}
        onConfirm={handlePriceFormatConfirm}
      />
    </>
  );
}
