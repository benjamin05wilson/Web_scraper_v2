// ============================================================================
// SIDEBAR - Scraper Configuration UI
// ============================================================================

import React, { useState, useCallback } from 'react';
import type {
  ElementSelector,
  AssignedSelector,
  SelectorRole,
  RecorderAction,
  ScraperConfig,
  ScrapeResult,
} from '../../shared/types';

interface SidebarProps {
  // Selection
  selectionMode: boolean;
  toggleSelectionMode: () => void;
  selectedElement: ElementSelector | null;

  // Multi-select for pattern detection
  selectedElements: ElementSelector[];
  addSelectedElement: (element: ElementSelector) => void;
  clearSelectedElements: () => void;
  detectedPattern: { selector: string; count: number } | null;
  highlightPattern: (selector: string) => void;
  clearPatternHighlight: () => void;

  // Assigned selectors
  assignedSelectors: AssignedSelector[];
  assignSelector: (role: SelectorRole, element: ElementSelector, extractionType?: string) => void;
  removeSelector: (role: SelectorRole) => void;
  testSelector: (selector: string) => void;
  selectorTestResult: { valid: boolean; count: number; error?: string } | null;

  // Recording
  isRecording: boolean;
  recordedActions: RecorderAction[];
  startRecording: (name: string) => void;
  stopRecording: () => void;

  // Scraping
  setScraperConfig: (config: ScraperConfig) => void;
  executeScrape: () => void;
  scrapeResult: ScrapeResult | null;
  isScrapingRunning: boolean;
  currentUrl: string;
}

const SELECTOR_ROLES: { role: SelectorRole; label: string; extractionType: string }[] = [
  { role: 'title', label: 'Title', extractionType: 'text' },
  { role: 'price', label: 'Price', extractionType: 'text' },
  { role: 'url', label: 'URL', extractionType: 'href' },
  { role: 'image', label: 'Image', extractionType: 'src' },
  { role: 'nextPage', label: 'Next Page', extractionType: 'text' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  selectionMode,
  toggleSelectionMode,
  selectedElement,
  selectedElements,
  addSelectedElement,
  clearSelectedElements,
  detectedPattern,
  highlightPattern,
  clearPatternHighlight,
  assignedSelectors,
  assignSelector,
  removeSelector,
  testSelector,
  selectorTestResult,
  isRecording,
  recordedActions,
  startRecording,
  stopRecording,
  setScraperConfig,
  executeScrape,
  scrapeResult,
  isScrapingRunning,
  currentUrl,
}) => {
  const [expandedPanels, setExpandedPanels] = useState({
    selectors: true,
    recorder: true,
    results: true,
  });
  const [testSelectorInput, setTestSelectorInput] = useState('');
  const [itemContainerSelector, setItemContainerSelector] = useState('');
  const [maxPages, setMaxPages] = useState(1);
  const [scraperName, setScraperName] = useState('My Scraper');
  const [useGenericSelector, setUseGenericSelector] = useState(true); // Default to generic for scraping multiple items

  const togglePanel = useCallback((panel: keyof typeof expandedPanels) => {
    setExpandedPanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  }, []);

  // Get assigned selector for a role
  const getAssigned = useCallback(
    (role: SelectorRole) => assignedSelectors.find((s) => s.role === role),
    [assignedSelectors]
  );

  // Assign selected element to role
  const handleAssign = useCallback(
    (role: SelectorRole, extractionType: string) => {
      if (!selectedElement) return;

      // If generic selector is available and enabled, use it
      if (useGenericSelector && selectedElement.cssGeneric) {
        const genericElement = {
          ...selectedElement,
          css: selectedElement.cssGeneric, // Use generic selector as the main CSS
        };
        assignSelector(role, genericElement, extractionType);
      } else {
        assignSelector(role, selectedElement, extractionType);
      }
    },
    [selectedElement, assignSelector, useGenericSelector]
  );

  // Test selector
  const handleTestSelector = useCallback(() => {
    if (testSelectorInput.trim()) {
      testSelector(testSelectorInput.trim());
    }
  }, [testSelectorInput, testSelector]);

  // Build and execute scraper config
  const handleExecuteScrape = useCallback(() => {
    const nextPageSelector = getAssigned('nextPage');

    const config: ScraperConfig = {
      name: scraperName,
      startUrl: currentUrl,
      selectors: assignedSelectors,
      itemContainer: itemContainerSelector || undefined,
      pagination: nextPageSelector
        ? {
            enabled: true,
            selector: nextPageSelector.selector.css,
            maxPages,
          }
        : undefined,
      preActions: recordedActions.length > 0
        ? {
            id: 'pre-actions',
            name: 'Pre-actions',
            actions: recordedActions,
            createdAt: Date.now(),
          }
        : undefined,
    };

    setScraperConfig(config);
    executeScrape();
  }, [
    scraperName,
    currentUrl,
    assignedSelectors,
    itemContainerSelector,
    maxPages,
    recordedActions,
    getAssigned,
    setScraperConfig,
    executeScrape,
  ]);

  return (
    <div className="sidebar">
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Scraper Builder</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${selectionMode ? 'active' : ''}`}
            onClick={toggleSelectionMode}
            style={{ flex: 1 }}
          >
            {selectionMode ? '✓ Select Mode' : 'Select Mode'}
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Pre-Actions Recorder Panel - At Top */}
        <div className={`panel ${expandedPanels.recorder ? '' : 'panel-collapsed'}`}>
          <div className="panel-header" onClick={() => togglePanel('recorder')}>
            <span className="panel-title">
              Pre-Actions {recordedActions.length > 0 && `(${recordedActions.length})`}
            </span>
            <span>{expandedPanels.recorder ? '−' : '+'}</span>
          </div>
          <div className="panel-content">
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Record actions for dismissing popups, accepting cookies, etc.
            </p>
            <div style={{ marginBottom: 12 }}>
              {isRecording ? (
                <button className="btn btn-danger" onClick={stopRecording} style={{ width: '100%' }}>
                  ⏹ Stop Recording
                </button>
              ) : (
                <button
                  className="btn btn-warning"
                  onClick={() => startRecording('Pre-actions')}
                  style={{ width: '100%' }}
                >
                  ⏺ Start Recording
                </button>
              )}
            </div>

            {recordedActions.length > 0 && (
              <div className="action-list">
                {recordedActions.map((action, idx) => (
                  <div key={action.id} className="action-item">
                    <span style={{ color: 'var(--text-muted)', width: 20 }}>{idx + 1}.</span>
                    <span className="action-type">{action.type}</span>
                    <span className="action-description">{action.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Multi-Select Pattern Detection */}
        {selectionMode && (
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">
                Pattern Detection ({selectedElements.length} selected)
              </span>
              {selectedElements.length > 0 && (
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    clearSelectedElements();
                    clearPatternHighlight();
                  }}
                  style={{ padding: '2px 8px', fontSize: 10 }}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="panel-content">
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Click 2+ similar elements (e.g., product titles) to auto-detect a pattern that matches all of them.
              </p>

              {/* Add to selection button */}
              {selectedElement && (
                <button
                  className="btn btn-primary"
                  onClick={() => addSelectedElement(selectedElement)}
                  style={{ width: '100%', marginBottom: 8 }}
                >
                  + Add "{selectedElement.text?.substring(0, 30) || selectedElement.tagName}" to Selection
                </button>
              )}

              {/* Show selected elements */}
              {selectedElements.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {selectedElements.map((el, idx) => (
                    <div key={idx} style={{
                      padding: '4px 8px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 4,
                      marginBottom: 4,
                      fontSize: 11,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }}>
                      <span style={{ color: 'var(--accent-primary)' }}>{idx + 1}.</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {el.text?.substring(0, 40) || el.css}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Detected pattern */}
              {detectedPattern && (
                <div style={{
                  padding: 12,
                  background: 'rgba(0, 204, 102, 0.15)',
                  borderRadius: 4,
                  border: '2px solid var(--accent-success)'
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-success)', marginBottom: 8 }}>
                    ✓ Pattern Found! ({detectedPattern.count} elements)
                  </div>
                  <div className="selector-value" style={{ fontSize: 11, marginBottom: 8 }}>
                    {detectedPattern.selector}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {SELECTOR_ROLES.map(({ role, label, extractionType }) => (
                      <button
                        key={role}
                        className="btn btn-success"
                        onClick={() => {
                          // Create an element with the pattern selector
                          const patternElement: ElementSelector = {
                            css: detectedPattern.selector,
                            xpath: '',
                            tagName: selectedElements[0]?.tagName || 'div',
                            attributes: {},
                            boundingBox: { x: 0, y: 0, width: 0, height: 0 },
                          };
                          assignSelector(role, patternElement, extractionType);
                          clearSelectedElements();
                        }}
                        style={{ padding: '4px 8px', fontSize: 11 }}
                      >
                        Set as {label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn"
                    onClick={() => highlightPattern(detectedPattern.selector)}
                    style={{ width: '100%', marginTop: 8 }}
                  >
                    Re-highlight All Matches
                  </button>
                </div>
              )}

              {selectedElements.length >= 2 && !detectedPattern && (
                <div style={{
                  padding: 8,
                  background: 'rgba(255, 170, 0, 0.1)',
                  borderRadius: 4,
                  border: '1px solid var(--accent-warning)',
                  fontSize: 11,
                  color: 'var(--accent-warning)'
                }}>
                  No common pattern found. Try selecting more similar elements.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Selected Element (single select fallback) */}
        {selectedElement && !detectedPattern && (
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Selected Element</span>
            </div>
            <div className="panel-content">
              <div className="selector-item">
                <div className="selector-label">{selectedElement.tagName}</div>
                <div className="selector-value" style={{ fontSize: 11 }}>{selectedElement.css}</div>

                {/* Generic selector suggestion */}
                {selectedElement.cssGeneric && (
                  <div style={{
                    marginTop: 8,
                    padding: 8,
                    background: useGenericSelector ? 'rgba(0, 204, 102, 0.1)' : 'rgba(100, 100, 100, 0.1)',
                    borderRadius: 4,
                    border: `1px solid ${useGenericSelector ? 'var(--accent-success)' : 'var(--border-color)'}`
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ fontSize: 11, color: useGenericSelector ? 'var(--accent-success)' : 'var(--text-secondary)', fontWeight: 600 }}>
                        📋 Generic Selector ({selectedElement.cssGenericCount} items)
                      </div>
                      <button
                        className={`btn ${useGenericSelector ? 'active' : ''}`}
                        onClick={() => setUseGenericSelector(!useGenericSelector)}
                        style={{ padding: '2px 8px', fontSize: 10 }}
                      >
                        {useGenericSelector ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <div className="selector-value" style={{ fontSize: 11 }}>
                      {selectedElement.cssGeneric}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {useGenericSelector
                        ? '✓ Will scrape all similar elements'
                        : 'Toggle ON to scrape all similar elements'}
                    </div>
                  </div>
                )}

                {selectedElement.text && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                    Text: "{selectedElement.text.substring(0, 50)}{selectedElement.text.length > 50 ? '...' : ''}"
                  </div>
                )}

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                  {SELECTOR_ROLES.map(({ role, label, extractionType }) => (
                    <button
                      key={role}
                      className="btn"
                      onClick={() => handleAssign(role, extractionType)}
                      style={{ padding: '4px 8px', fontSize: 11 }}
                    >
                      Set as {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Assigned Selectors Panel */}
        <div className={`panel ${expandedPanels.selectors ? '' : 'panel-collapsed'}`}>
          <div className="panel-header" onClick={() => togglePanel('selectors')}>
            <span className="panel-title">Selectors ({assignedSelectors.length})</span>
            <span>{expandedPanels.selectors ? '−' : '+'}</span>
          </div>
          <div className="panel-content">
            <div className="selector-list">
              {SELECTOR_ROLES.map(({ role, label }) => {
                const assigned = getAssigned(role);
                return (
                  <div key={role} className={`selector-item ${assigned ? 'assigned' : ''}`}>
                    <div className="selector-label">{label}</div>
                    {assigned ? (
                      <>
                        <div className="selector-value">{assigned.selector.css}</div>
                        <button
                          className="btn btn-danger"
                          onClick={() => removeSelector(role)}
                          style={{ padding: '4px 8px', fontSize: 11, alignSelf: 'flex-start' }}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <div className="selector-value empty">Not assigned</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Item Container */}
            <div style={{ marginTop: 16 }}>
              <div className="form-group">
                <label className="form-label">Item Container (optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder=".product-card, .item, etc."
                  value={itemContainerSelector}
                  onChange={(e) => setItemContainerSelector(e.target.value)}
                />
              </div>
            </div>

            {/* Selector Tester */}
            <div style={{ marginTop: 16 }}>
              <div className="form-group">
                <label className="form-label">Test Selector</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="form-input"
                    style={{ flex: 1 }}
                    placeholder="CSS selector..."
                    value={testSelectorInput}
                    onChange={(e) => setTestSelectorInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleTestSelector()}
                  />
                  <button className="btn btn-primary" onClick={handleTestSelector}>
                    Test
                  </button>
                </div>
              </div>
              {selectorTestResult && (
                <div
                  style={{
                    padding: 8,
                    borderRadius: 4,
                    background: selectorTestResult.valid
                      ? 'rgba(0, 204, 102, 0.1)'
                      : 'rgba(255, 68, 68, 0.1)',
                    border: `1px solid ${selectorTestResult.valid ? 'var(--accent-success)' : 'var(--accent-error)'}`,
                    fontSize: 12,
                  }}
                >
                  {selectorTestResult.valid
                    ? `Found ${selectorTestResult.count} element(s)`
                    : selectorTestResult.error || 'Invalid selector'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pagination Settings */}
        {getAssigned('nextPage') && (
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Pagination</span>
            </div>
            <div className="panel-content">
              <div className="form-group">
                <label className="form-label">Max Pages</label>
                <input
                  type="number"
                  className="form-input"
                  min={1}
                  max={100}
                  value={maxPages}
                  onChange={(e) => setMaxPages(parseInt(e.target.value) || 1)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Results Panel */}
        {scrapeResult && (
          <div className={`panel ${expandedPanels.results ? '' : 'panel-collapsed'}`}>
            <div className="panel-header" onClick={() => togglePanel('results')}>
              <span className="panel-title">
                Results ({scrapeResult.items.length} items)
              </span>
              <span>{expandedPanels.results ? '−' : '+'}</span>
            </div>
            <div className="panel-content">
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                {scrapeResult.success ? (
                  <>
                    Scraped {scrapeResult.pagesScraped} page(s) in{' '}
                    {(scrapeResult.duration / 1000).toFixed(2)}s
                  </>
                ) : (
                  <span style={{ color: 'var(--accent-error)' }}>
                    Error: {scrapeResult.errors?.join(', ')}
                  </span>
                )}
              </div>

              {scrapeResult.items.length > 0 && (
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {scrapeResult.items.slice(0, 10).map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 8,
                        background: 'var(--bg-tertiary)',
                        borderRadius: 4,
                        marginBottom: 4,
                        fontSize: 12,
                      }}
                    >
                      {Object.entries(item).map(([key, value]) => (
                        <div key={key} style={{ marginBottom: 2 }}>
                          <strong style={{ color: 'var(--text-secondary)' }}>{key}:</strong>{' '}
                          {value || <em style={{ color: 'var(--text-muted)' }}>null</em>}
                        </div>
                      ))}
                    </div>
                  ))}
                  {scrapeResult.items.length > 10 && (
                    <div style={{ textAlign: 'center', padding: 8, color: 'var(--text-muted)' }}>
                      ...and {scrapeResult.items.length - 10} more
                    </div>
                  )}
                </div>
              )}

              <button
                className="btn"
                onClick={() => {
                  const dataStr = JSON.stringify(scrapeResult.items, null, 2);
                  const blob = new Blob([dataStr], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'scrape-results.json';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ width: '100%', marginTop: 12 }}
              >
                Export JSON
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Execute Button */}
      <div style={{ padding: 16, borderTop: '1px solid var(--border-color)' }}>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Scraper Name</label>
          <input
            type="text"
            className="form-input"
            value={scraperName}
            onChange={(e) => setScraperName(e.target.value)}
          />
        </div>
        <button
          className="btn btn-success"
          onClick={handleExecuteScrape}
          disabled={assignedSelectors.length === 0 || isScrapingRunning}
          style={{ width: '100%', padding: '12px 16px', fontSize: 14 }}
        >
          {isScrapingRunning ? (
            <>
              <div className="loading-spinner" style={{ width: 16, height: 16 }} />
              Scraping...
            </>
          ) : (
            'Execute Scrape'
          )}
        </button>
      </div>
    </div>
  );
};
