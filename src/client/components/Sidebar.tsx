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
  ExtractedContentItem,
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
  assignSelector: (role: SelectorRole, element: ElementSelector, extractionType?: string, priority?: number) => void;
  removeSelector: (role: SelectorRole, priority?: number) => void;
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

  // Container selector (for save/load)
  itemContainerSelector?: string;
  onContainerSelectorChange?: (selector: string) => void;

  // Container extraction (from server)
  extractContainerContent?: (selector: string) => void;
  extractedContent?: ExtractedContentItem[];
}

const SELECTOR_ROLES: { role: SelectorRole; label: string; extractionType: string }[] = [
  { role: 'title', label: 'Title', extractionType: 'text' },
  { role: 'originalPrice', label: 'Original Price', extractionType: 'text' },
  { role: 'salePrice', label: 'Sale Price', extractionType: 'text' },
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
  itemContainerSelector: externalContainerSelector,
  onContainerSelectorChange,
  extractContainerContent,
  extractedContent,
}) => {
  const [expandedPanels, setExpandedPanels] = useState({
    selectors: true,
    recorder: true,
    results: true,
  });
  const [testSelectorInput, setTestSelectorInput] = useState('');
  const [internalContainerSelector, setInternalContainerSelector] = useState('');
  const [maxPages, setMaxPages] = useState(1);

  // Use external container selector if provided, otherwise use internal state
  const itemContainerSelector = externalContainerSelector ?? internalContainerSelector;
  const setItemContainerSelector = onContainerSelectorChange ?? setInternalContainerSelector;
  const [internalScraperName, setInternalScraperName] = useState('My Scraper');

  // Wizard state for guided selection
  type WizardStep = 'container' | 'labeling' | 'complete';
  const [wizardStep, setWizardStep] = useState<WizardStep>('container');
  const [containerElement, setContainerElement] = useState<ElementSelector | null>(null);
  // Map of itemValue -> { role, priority } - allows multiple items per role with priorities
  const [labeledItems, setLabeledItems] = useState<Map<string, { role: SelectorRole; priority: number }>>(new Map());

  // Use external scraper name if provided, otherwise use internal state
  const scraperName = externalScraperName ?? internalScraperName;
  const setScraperName = onScraperNameChange ?? setInternalScraperName;

  // Use server-extracted content (from props)
  const extractedItems = extractedContent || [];

  // Reset wizard
  const resetWizard = useCallback(() => {
    setWizardStep('container');
    setContainerElement(null);
    setLabeledItems(new Map<string, { role: SelectorRole; priority: number }>());
    setItemContainerSelector('');
    clearSelectedElements();
    clearPatternHighlight();
  }, [clearSelectedElements, clearPatternHighlight]);

  // Set container element and request server extraction
  const setContainer = useCallback(() => {
    if (!selectedElement) return;
    setContainerElement(selectedElement);

    // Use the cssGeneric or css as the container selector
    const containerCss = selectedElement.cssGeneric || selectedElement.css;
    setItemContainerSelector(containerCss);

    // Request content extraction from server
    if (extractContainerContent) {
      extractContainerContent(containerCss);
    }

    setWizardStep('labeling');
  }, [selectedElement, extractContainerContent]);

  // Get count of items with a specific role (for fallback numbering)
  const getRoleCount = useCallback((role: SelectorRole) => {
    let count = 0;
    for (const [, item] of labeledItems) {
      if (item.role === role) count++;
    }
    return count;
  }, [labeledItems]);

  // Label an extracted item - allows multiple items per role as fallbacks
  const labelItem = useCallback((itemValue: string, role: SelectorRole | null) => {
    setLabeledItems(prev => {
      const newMap = new Map(prev);
      if (role === null) {
        // Remove label
        newMap.delete(itemValue);
      } else {
        // Check if this item already has this role - if so, remove it
        const existing = newMap.get(itemValue);
        if (existing && existing.role === role) {
          newMap.delete(itemValue);
        } else {
          // Add with next priority number for this role
          let maxPriority = 0;
          for (const [, item] of newMap) {
            if (item.role === role && item.priority >= maxPriority) {
              maxPriority = item.priority + 1;
            }
          }
          newMap.set(itemValue, { role, priority: maxPriority });
        }
      }
      return newMap;
    });
  }, []);

  // Complete wizard and assign selectors from labeled items
  const completeWizard = useCallback(() => {
    console.log('[Wizard] Completing with labeled items:', Array.from(labeledItems.entries()));

    // For each labeled item, create a selector with its priority
    for (const [itemValue, { role, priority }] of labeledItems) {
      const item = extractedItems.find(e => e.value === itemValue);
      if (!item) continue;

      // Determine extraction type based on item type
      let extractionType = 'text';
      let selector = item.selector;

      if (item.type === 'link') {
        extractionType = 'href';
        selector = 'a';
      } else if (item.type === 'image') {
        extractionType = 'src';
        selector = 'img';
      }

      // Create a selector element
      const selectorElement: ElementSelector = {
        tagName: item.type === 'link' ? 'A' : item.type === 'image' ? 'IMG' : 'SPAN',
        css: selector,
        xpath: '',
        text: item.type === 'text' ? item.value : undefined,
        attributes: {},
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
      };

      assignSelector(role, selectorElement, extractionType, priority);
    }

    setWizardStep('complete');
  }, [labeledItems, extractedItems, assignSelector]);

  const togglePanel = useCallback((panel: keyof typeof expandedPanels) => {
    setExpandedPanels((prev) => ({ ...prev, [panel]: !prev[panel] }));
  }, []);

  // Get all assigned selectors for a role (sorted by priority)
  const getAssignedAll = useCallback(
    (role: SelectorRole) => assignedSelectors
      .filter((s) => s.role === role)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    [assignedSelectors]
  );

  // Get primary assigned selector for a role (lowest priority)
  const getAssigned = useCallback(
    (role: SelectorRole) => {
      const all = getAssignedAll(role);
      return all.length > 0 ? all[0] : undefined;
    },
    [getAssignedAll]
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
                {wizardStep === 'container' && 'Step 1: Select Product Card'}
                {wizardStep === 'labeling' && 'Step 2: Label Fields'}
                {wizardStep === 'complete' && 'Selection Complete'}
              </span>
              {(containerElement || labeledItems.size > 0) && wizardStep !== 'complete' && (
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
                  background: wizardStep === 'container' ? 'var(--accent-primary)' : 'var(--accent-success)'
                }} />
                <div style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: wizardStep === 'labeling' ? 'var(--accent-primary)' : wizardStep === 'complete' ? 'var(--accent-success)' : 'var(--bg-tertiary)'
                }} />
              </div>

              {/* Instructions based on step */}
              {wizardStep === 'container' && (
                <div style={{
                  padding: 8,
                  background: 'rgba(138, 43, 226, 0.1)',
                  borderRadius: 4,
                  border: '1px solid #8a2be2',
                  marginBottom: 12
                }}>
                  <p style={{ fontSize: 11, color: 'var(--text-primary)', margin: 0 }}>
                    <strong>Step 1:</strong> Click on the <strong>entire product card</strong>.
                    This is the box containing one product's info (title, price, image, etc.)
                  </p>
                </div>
              )}

              {wizardStep === 'labeling' && (
                <div style={{
                  padding: 8,
                  background: 'rgba(0, 153, 255, 0.1)',
                  borderRadius: 4,
                  border: '1px solid var(--accent-primary)',
                  marginBottom: 12
                }}>
                  <p style={{ fontSize: 11, color: 'var(--text-primary)', margin: 0 }}>
                    <strong>Step 2:</strong> Label each field below. Click on a field to identify what it is (title, price, etc.)
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
                    <strong>Done!</strong> Selectors have been assigned. You can now run the scraper.
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

              {/* Container step - show selected element and confirm button */}
              {wizardStep === 'container' && selectedElement && (
                <div style={{
                  padding: 8,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 4,
                  marginBottom: 12
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Selected container:
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                    &lt;{selectedElement.tagName.toLowerCase()}&gt;
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {selectedElement.cssGeneric || selectedElement.css}
                  </div>
                  <button
                    className="btn btn-success"
                    onClick={setContainer}
                    style={{ width: '100%' }}
                  >
                    Extract Fields From This Card
                  </button>
                </div>
              )}

              {/* Container step - no selection yet */}
              {wizardStep === 'container' && !selectedElement && (
                <div style={{
                  padding: 12,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 4,
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--text-secondary)'
                }}>
                  Click on a product card in the browser
                </div>
              )}

              {/* Labeling step - show extracted content */}
              {wizardStep === 'labeling' && (
                <>
                  {/* Container info */}
                  <div style={{
                    padding: '6px 8px',
                    background: 'rgba(138, 43, 226, 0.1)',
                    borderRadius: 4,
                    marginBottom: 12,
                    fontSize: 10,
                    border: '1px solid #8a2be2'
                  }}>
                    <span style={{ color: '#8a2be2', fontWeight: 600 }}>Container:</span>{' '}
                    <span style={{ fontFamily: 'monospace' }}>{itemContainerSelector}</span>
                  </div>

                  {/* Extracted items list */}
                  {extractedItems.length > 0 ? (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        Click labels to assign fields. Assign the same label multiple times for fallbacks (first = primary, others = fallback if null):
                      </div>
                      {extractedItems.map((item, idx) => {
                        const assigned = labeledItems.get(item.value);
                        const assignedRole = assigned?.role;
                        const assignedPriority = assigned?.priority ?? -1;
                        return (
                          <div key={idx} style={{
                            padding: 8,
                            background: assignedRole ? 'rgba(0, 204, 102, 0.1)' : 'var(--bg-tertiary)',
                            borderRadius: 4,
                            marginBottom: 8,
                            border: assignedRole ? '1px solid var(--accent-success)' : '1px solid var(--border-color)'
                          }}>
                            {/* Item type indicator */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <span style={{
                                padding: '2px 6px',
                                borderRadius: 3,
                                fontSize: 9,
                                fontWeight: 600,
                                background: item.type === 'text' ? 'var(--accent-primary)' :
                                           item.type === 'link' ? 'var(--accent-warning)' : 'var(--accent-success)',
                                color: 'white'
                              }}>
                                {item.type.toUpperCase()}
                              </span>
                              {assignedRole && (
                                <span style={{
                                  padding: '2px 6px',
                                  borderRadius: 3,
                                  fontSize: 9,
                                  fontWeight: 600,
                                  background: 'var(--accent-success)',
                                  color: 'white'
                                }}>
                                  = {assignedRole.toUpperCase()}{assignedPriority > 0 ? ` (fallback ${assignedPriority})` : ''}
                                </span>
                              )}
                            </div>

                            {/* Item value */}
                            <div style={{
                              fontSize: 12,
                              marginBottom: 8,
                              padding: 6,
                              background: 'var(--bg-secondary)',
                              borderRadius: 3,
                              fontFamily: item.type !== 'text' ? 'monospace' : 'inherit',
                              wordBreak: 'break-all',
                              maxHeight: 60,
                              overflow: 'auto'
                            }}>
                              {item.displayText}
                            </div>

                            {/* Label buttons */}
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {SELECTOR_ROLES.filter(r => r.role !== 'nextPage').map(({ role, label }) => {
                                const isThisRole = assignedRole === role;
                                // Count how many items have this role (for showing fallback count)
                                const roleCount = getRoleCount(role);
                                return (
                                  <button
                                    key={role}
                                    className={`btn ${isThisRole ? 'btn-success' : 'btn-primary'}`}
                                    onClick={() => labelItem(item.value, isThisRole ? null : role)}
                                    style={{
                                      padding: '3px 8px',
                                      fontSize: 10,
                                    }}
                                    title={isThisRole ? 'Click to remove' : roleCount > 0 ? `Add as ${label} fallback #${roleCount + 1}` : `Mark as ${label}`}
                                  >
                                    {isThisRole ? '✓ ' : ''}{label}{!isThisRole && roleCount > 0 ? ` +${roleCount}` : ''}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{
                      padding: 12,
                      background: 'var(--bg-tertiary)',
                      borderRadius: 4,
                      textAlign: 'center',
                      fontSize: 12,
                      color: 'var(--text-secondary)'
                    }}>
                      No content extracted from container. Try selecting a different card.
                    </div>
                  )}

                  {/* Complete button */}
                  {labeledItems.size > 0 && (
                    <button
                      className="btn btn-success"
                      onClick={completeWizard}
                      style={{ width: '100%' }}
                    >
                      Apply {labeledItems.size} Label{labeledItems.size > 1 ? 's' : ''} & Continue
                    </button>
                  )}

                  {labeledItems.size === 0 && extractedItems.length > 0 && (
                    <div style={{
                      padding: 8,
                      background: 'var(--bg-tertiary)',
                      borderRadius: 4,
                      textAlign: 'center',
                      fontSize: 11,
                      color: 'var(--text-secondary)'
                    }}>
                      Label at least one field to continue
                    </div>
                  )}
                </>
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
                const allAssigned = getAssignedAll(role);
                return (
                  <div key={role} className={`selector-item ${allAssigned.length > 0 ? 'assigned' : ''}`}>
                    <div className="selector-label">
                      {label}
                      {allAssigned.length > 1 && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                          ({allAssigned.length} with fallbacks)
                        </span>
                      )}
                    </div>
                    {allAssigned.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                        {allAssigned.map((assigned, idx) => (
                          <div key={idx} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '4px 6px',
                            background: idx === 0 ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                            borderRadius: 3,
                            border: idx === 0 ? '1px solid var(--accent-success)' : '1px dashed var(--border-color)'
                          }}>
                            <span style={{
                              fontSize: 9,
                              color: idx === 0 ? 'var(--accent-success)' : 'var(--text-muted)',
                              fontWeight: 600,
                              minWidth: 50
                            }}>
                              {idx === 0 ? 'PRIMARY' : `FB #${idx}`}
                            </span>
                            <div className="selector-value" style={{ flex: 1, margin: 0 }}>
                              {assigned.selector.css}
                            </div>
                            <button
                              className="btn btn-danger"
                              onClick={() => removeSelector(role, assigned.priority)}
                              style={{ padding: '2px 6px', fontSize: 10 }}
                              title={`Remove ${idx === 0 ? 'primary' : `fallback #${idx}`}`}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
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
                <label className="form-label">
                  Item Container <span style={{ color: 'var(--accent-error)' }}>*</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Select in wizard or enter CSS selector"
                  value={itemContainerSelector}
                  onChange={(e) => setItemContainerSelector(e.target.value)}
                  style={{
                    borderColor: itemContainerSelector ? 'var(--accent-success)' : 'var(--accent-warning)',
                  }}
                />
                {!itemContainerSelector && (
                  <div style={{ fontSize: 10, color: 'var(--accent-warning)', marginTop: 4 }}>
                    Required: Use the wizard above to select a product card
                  </div>
                )}
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
            disabled={assignedSelectors.length === 0 || !itemContainerSelector || isScrapingRunning}
            style={{ flex: onSaveScraper ? 1 : undefined, width: onSaveScraper ? undefined : '100%', padding: '12px 16px', fontSize: 14 }}
            title={!itemContainerSelector ? 'Please select an item container first' : assignedSelectors.length === 0 ? 'Please assign at least one selector' : ''}
          >
            {isScrapingRunning ? (
              <>
                <div className="loading-spinner" style={{ width: 16, height: 16 }} />
                Scraping...
              </>
            ) : !itemContainerSelector ? (
              'Select Container First'
            ) : (
              'Execute Scrape'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
