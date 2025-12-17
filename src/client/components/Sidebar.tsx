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

  // Save functionality (optional - from ScraperBuilder page)
  scraperName?: string;
  onScraperNameChange?: (name: string) => void;
  onSaveScraper?: () => void;
  hasUnsavedChanges?: boolean;
  lastSavedAt?: number | null;
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
  selectedElements: _selectedElements,
  addSelectedElement: _addSelectedElement,
  clearSelectedElements,
  detectedPattern: _detectedPattern,
  highlightPattern: _highlightPattern,
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
  scraperName: externalScraperName,
  onScraperNameChange,
  onSaveScraper,
  hasUnsavedChanges,
  lastSavedAt,
}) => {
  const [expandedPanels, setExpandedPanels] = useState({
    selectors: true,
    recorder: true,
    results: true,
  });
  const [testSelectorInput, setTestSelectorInput] = useState('');
  const [itemContainerSelector, setItemContainerSelector] = useState('');
  const [maxPages, setMaxPages] = useState(1);
  const [internalScraperName, setInternalScraperName] = useState('My Scraper');

  // Wizard state for guided selection
  type WizardStep = 'product1' | 'product2' | 'complete';
  const [wizardStep, setWizardStep] = useState<WizardStep>('product1');
  const [product1Selections, setProduct1Selections] = useState<{ role: SelectorRole; element: ElementSelector; extractionType: string }[]>([]);
  const [product2Selections, setProduct2Selections] = useState<{ role: SelectorRole; element: ElementSelector; extractionType: string }[]>([]);

  // Use external scraper name if provided, otherwise use internal state
  const scraperName = externalScraperName ?? internalScraperName;
  const setScraperName = onScraperNameChange ?? setInternalScraperName;

  // Reset wizard
  const resetWizard = useCallback(() => {
    setWizardStep('product1');
    setProduct1Selections([]);
    setProduct2Selections([]);
    clearSelectedElements();
    clearPatternHighlight();
  }, [clearSelectedElements, clearPatternHighlight]);

  // Add selection for current product
  const addProductSelection = useCallback((role: SelectorRole, extractionType: string) => {
    if (!selectedElement) return;

    if (wizardStep === 'product1') {
      // Check if role already selected for product 1
      if (product1Selections.some(s => s.role === role)) {
        // Replace existing
        setProduct1Selections(prev => prev.map(s => s.role === role ? { role, element: selectedElement, extractionType } : s));
      } else {
        setProduct1Selections(prev => [...prev, { role, element: selectedElement, extractionType }]);
      }
    } else if (wizardStep === 'product2') {
      // Check if role already selected for product 2
      if (product2Selections.some(s => s.role === role)) {
        setProduct2Selections(prev => prev.map(s => s.role === role ? { role, element: selectedElement, extractionType } : s));
      } else {
        setProduct2Selections(prev => [...prev, { role, element: selectedElement, extractionType }]);
      }
    }
  }, [selectedElement, wizardStep, product1Selections, product2Selections]);

  // Move to next step
  const goToProduct2 = useCallback(() => {
    if (product1Selections.length >= 2) {
      setWizardStep('product2');
    }
  }, [product1Selections]);

  // Find common CSS selector pattern between two elements
  const findCommonSelector = useCallback((el1: ElementSelector, el2: ElementSelector): string | null => {
    // Priority 1: If both have cssGeneric and they match exactly, use that
    if (el1.cssGeneric && el2.cssGeneric && el1.cssGeneric === el2.cssGeneric) {
      return el1.cssGeneric;
    }

    // Priority 2: Use cssGeneric from either element if available
    // cssGeneric is specifically designed to match multiple similar elements
    if (el1.cssGeneric) {
      return el1.cssGeneric;
    }
    if (el2.cssGeneric) {
      return el2.cssGeneric;
    }

    // Priority 3: Try to find common class-based selector
    const classes1 = el1.attributes?.class?.split(' ').filter(Boolean) || [];
    const classes2 = el2.attributes?.class?.split(' ').filter(Boolean) || [];
    const commonClasses = classes1.filter(c => classes2.includes(c));

    if (commonClasses.length > 0 && el1.tagName === el2.tagName) {
      // Build a selector from common classes - filter out state classes
      const meaningfulClasses = commonClasses.filter(c =>
        !c.startsWith('is-') &&
        !c.startsWith('has-') &&
        !c.includes('active') &&
        !c.includes('hover') &&
        !c.includes('focus')
      );

      if (meaningfulClasses.length > 0) {
        const classSelector = meaningfulClasses.map(c => `.${c}`).join('');
        return `${el1.tagName.toLowerCase()}${classSelector}`;
      }
    }

    // Priority 4: Fallback to tag name only if same tag
    if (el1.tagName === el2.tagName) {
      return el1.tagName.toLowerCase();
    }

    return null;
  }, []);

  // Complete wizard and assign selectors
  const completeWizard = useCallback(() => {
    console.log('[Wizard] Completing wizard with selections:');
    console.log('[Wizard] Product 1:', product1Selections.map(s => ({ role: s.role, css: s.element.css, cssGeneric: s.element.cssGeneric })));
    console.log('[Wizard] Product 2:', product2Selections.map(s => ({ role: s.role, css: s.element.css, cssGeneric: s.element.cssGeneric })));

    // For each role selected in both products, find common pattern and assign
    product1Selections.forEach(p1Sel => {
      const p2Sel = product2Selections.find(s => s.role === p1Sel.role);
      if (p2Sel) {
        // Find common selector between the two elements
        const commonSelector = findCommonSelector(p1Sel.element, p2Sel.element);
        console.log(`[Wizard] Role ${p1Sel.role}: commonSelector = "${commonSelector}"`);

        if (commonSelector) {
          // Create element with the common pattern selector
          const patternElement: ElementSelector = {
            ...p1Sel.element,
            css: commonSelector,
          };
          assignSelector(p1Sel.role, patternElement, p1Sel.extractionType);
        } else {
          // Fallback: use the cssGeneric from first element if available
          console.log(`[Wizard] Role ${p1Sel.role}: No common selector, trying cssGeneric fallback`);
          if (p1Sel.element.cssGeneric) {
            const patternElement: ElementSelector = {
              ...p1Sel.element,
              css: p1Sel.element.cssGeneric,
            };
            assignSelector(p1Sel.role, patternElement, p1Sel.extractionType);
          } else {
            console.warn(`[Wizard] Role ${p1Sel.role}: No selector could be generated!`);
          }
        }
      }
    });

    setWizardStep('complete');
  }, [product1Selections, product2Selections, findCommonSelector, assignSelector]);

  const togglePanel = useCallback((panel: keyof typeof expandedPanels) => {
    setExpandedPanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  }, []);

  // Get assigned selector for a role
  const getAssigned = useCallback(
    (role: SelectorRole) => assignedSelectors.find((s) => s.role === role),
    [assignedSelectors]
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

  // Format relative time for last saved
  const getRelativeTime = (timestamp: number | null | undefined) => {
    if (!timestamp) return null;
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="sidebar">
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Scraper Builder</h1>
          {lastSavedAt !== null && lastSavedAt !== undefined ? (
            <span className={`save-indicator ${hasUnsavedChanges ? 'unsaved' : 'saved'}`}>
              {hasUnsavedChanges ? 'Unsaved' : `Saved ${getRelativeTime(lastSavedAt)}`}
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${selectionMode ? 'active' : ''}`}
            onClick={toggleSelectionMode}
            style={{ flex: 1 }}
          >
            {selectionMode ? '\u2713 Select Mode' : 'Select Mode'}
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

        {/* Element Selection Wizard */}
        {selectionMode && (
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">
                {wizardStep === 'product1' && 'Step 1: Select Product 1'}
                {wizardStep === 'product2' && 'Step 2: Select Product 2'}
                {wizardStep === 'complete' && 'Selection Complete'}
              </span>
              {(product1Selections.length > 0 || product2Selections.length > 0) && wizardStep !== 'complete' && (
                <button
                  className="btn btn-danger"
                  onClick={resetWizard}
                  style={{ padding: '2px 8px', fontSize: 10 }}
                >
                  Reset
                </button>
              )}
            </div>
            <div className="panel-content">
              {/* Step indicator */}
              <div style={{
                display: 'flex',
                gap: 4,
                marginBottom: 12
              }}>
                <div style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: wizardStep === 'product1' ? 'var(--accent-primary)' : 'var(--accent-success)'
                }} />
                <div style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: wizardStep === 'product2' ? 'var(--accent-primary)' : wizardStep === 'complete' ? 'var(--accent-success)' : 'var(--bg-tertiary)'
                }} />
              </div>

              {/* Instructions based on step */}
              {wizardStep === 'product1' && (
                <div style={{
                  padding: 8,
                  background: 'rgba(0, 153, 255, 0.1)',
                  borderRadius: 4,
                  border: '1px solid var(--accent-primary)',
                  marginBottom: 12
                }}>
                  <p style={{ fontSize: 11, color: 'var(--text-primary)', margin: 0 }}>
                    <strong>Step 1:</strong> Select elements from the <strong>first product</strong>.
                    Click on the title, price, image, or URL - then assign each one below.
                  </p>
                </div>
              )}

              {wizardStep === 'product2' && (
                <div style={{
                  padding: 8,
                  background: 'rgba(255, 170, 0, 0.1)',
                  borderRadius: 4,
                  border: '1px solid var(--accent-warning)',
                  marginBottom: 12
                }}>
                  <p style={{ fontSize: 11, color: 'var(--text-primary)', margin: 0 }}>
                    <strong>Step 2:</strong> Now select the <strong>same fields</strong> from a <strong>second product</strong>.
                    This helps detect the pattern across all products.
                  </p>
                </div>
              )}

              {wizardStep === 'complete' && (
                <div style={{
                  padding: 8,
                  background: 'rgba(0, 204, 102, 0.1)',
                  borderRadius: 4,
                  border: '1px solid var(--accent-success)',
                  marginBottom: 12
                }}>
                  <p style={{ fontSize: 11, color: 'var(--text-primary)', margin: 0 }}>
                    <strong>Done!</strong> Selectors have been assigned. You can now run the scraper
                    or add more selectors by starting over.
                  </p>
                  <button
                    className="btn"
                    onClick={resetWizard}
                    style={{ marginTop: 8, width: '100%' }}
                  >
                    Start New Selection
                  </button>
                </div>
              )}

              {/* Currently hovered element - assign buttons */}
              {selectedElement && wizardStep !== 'complete' && (
                <div style={{
                  padding: 8,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 4,
                  marginBottom: 12
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Currently selected:
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    "{selectedElement.text?.substring(0, 40) || selectedElement.tagName}"
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {SELECTOR_ROLES.filter(r => r.role !== 'nextPage').map(({ role, label, extractionType }) => {
                      const currentSelections = wizardStep === 'product1' ? product1Selections : product2Selections;
                      const isSelected = currentSelections.some(s => s.role === role);
                      // In product2, only show roles that were selected in product1
                      if (wizardStep === 'product2' && !product1Selections.some(s => s.role === role)) {
                        return null;
                      }
                      return (
                        <button
                          key={role}
                          className={`btn ${isSelected ? 'btn-success' : 'btn-primary'}`}
                          onClick={() => addProductSelection(role, extractionType)}
                          style={{ padding: '4px 8px', fontSize: 11 }}
                        >
                          {isSelected ? '✓ ' : ''}{label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Show selections for current step */}
              {wizardStep === 'product1' && product1Selections.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Product 1 selections:
                  </div>
                  {product1Selections.map((sel, idx) => (
                    <div key={idx} style={{
                      padding: '4px 8px',
                      background: 'rgba(0, 204, 102, 0.1)',
                      borderRadius: 4,
                      marginBottom: 4,
                      fontSize: 11,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      border: '1px solid var(--accent-success)'
                    }}>
                      <span style={{ color: 'var(--accent-success)', fontWeight: 600 }}>{sel.role}:</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sel.element.text?.substring(0, 30) || sel.element.css}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {wizardStep === 'product2' && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                      Product 1 (reference):
                    </div>
                    {product1Selections.map((sel, idx) => (
                      <div key={idx} style={{
                        padding: '4px 8px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 4,
                        marginBottom: 4,
                        fontSize: 10,
                        opacity: 0.7
                      }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{sel.role}:</span>{' '}
                        {sel.element.text?.substring(0, 25) || '...'}
                      </div>
                    ))}
                  </div>
                  {product2Selections.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                        Product 2 selections:
                      </div>
                      {product2Selections.map((sel, idx) => (
                        <div key={idx} style={{
                          padding: '4px 8px',
                          background: 'rgba(255, 170, 0, 0.1)',
                          borderRadius: 4,
                          marginBottom: 4,
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          border: '1px solid var(--accent-warning)'
                        }}>
                          <span style={{ color: 'var(--accent-warning)', fontWeight: 600 }}>{sel.role}:</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sel.element.text?.substring(0, 30) || sel.element.css}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Navigation buttons */}
              {wizardStep === 'product1' && product1Selections.length >= 2 && (
                <button
                  className="btn btn-warning"
                  onClick={goToProduct2}
                  style={{ width: '100%' }}
                >
                  Next: Select Product 2 →
                </button>
              )}

              {wizardStep === 'product1' && product1Selections.length < 2 && product1Selections.length > 0 && (
                <div style={{
                  padding: 8,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 4,
                  textAlign: 'center',
                  fontSize: 11,
                  color: 'var(--text-secondary)'
                }}>
                  Select at least {2 - product1Selections.length} more field{2 - product1Selections.length > 1 ? 's' : ''} (e.g., title and price)
                </div>
              )}

              {wizardStep === 'product2' && product2Selections.length >= product1Selections.length && (
                <button
                  className="btn btn-success"
                  onClick={completeWizard}
                  style={{ width: '100%' }}
                >
                  ✓ Confirm & Apply Selectors
                </button>
              )}

              {wizardStep === 'product2' && product2Selections.length < product1Selections.length && (
                <div style={{
                  padding: 8,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 4,
                  textAlign: 'center',
                  fontSize: 11,
                  color: 'var(--text-secondary)'
                }}>
                  Select {product1Selections.length - product2Selections.length} more field{product1Selections.length - product2Selections.length > 1 ? 's' : ''} to match Product 1
                </div>
              )}

              {/* No selection yet prompt */}
              {!selectedElement && wizardStep !== 'complete' && (
                <div style={{
                  padding: 12,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 4,
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--text-secondary)'
                }}>
                  Click on an element in the browser to select it
                </div>
              )}
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
        <div style={{ display: 'flex', gap: 8 }}>
          {onSaveScraper && (
            <button
              className="btn"
              onClick={onSaveScraper}
              style={{ flex: 1, padding: '12px 16px', fontSize: 14 }}
            >
              Save
            </button>
          )}
          <button
            className="btn btn-success"
            onClick={handleExecuteScrape}
            disabled={assignedSelectors.length === 0 || isScrapingRunning}
            style={{ flex: onSaveScraper ? 1 : undefined, width: onSaveScraper ? undefined : '100%', padding: '12px 16px', fontSize: 14 }}
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
    </div>
  );
};
