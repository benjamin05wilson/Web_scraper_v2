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

  // Auto-detect product
  autoDetectProduct?: () => void;
  isAutoDetecting?: boolean;
  sessionId?: string | null;
}

// Simple, friendly labels for each data type we can grab
const SELECTOR_ROLES: { role: SelectorRole; label: string; emoji: string; extractionType: string }[] = [
  { role: 'title', label: 'Name', emoji: '📝', extractionType: 'text' },
  { role: 'originalPrice', label: 'Old Price', emoji: '💰', extractionType: 'text' },
  { role: 'salePrice', label: 'Sale Price', emoji: '🏷️', extractionType: 'text' },
  { role: 'url', label: 'Link', emoji: '🔗', extractionType: 'href' },
  { role: 'image', label: 'Picture', emoji: '🖼️', extractionType: 'src' },
  { role: 'nextPage', label: 'Next Page', emoji: '➡️', extractionType: 'text' },
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
  autoDetectProduct,
  isAutoDetecting,
  sessionId,
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

    // Use combinedCss (for Zara split layout), cssGeneric, or css as the container selector
    // combinedCss contains both selectors comma-separated for sites like Zara
    const containerCss = (selectedElement as any).combinedCss || selectedElement.cssGeneric || selectedElement.css;
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
      {/* Header - Super Simple */}
      <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🤖 Data Grabber</h1>
          {lastSavedAt !== null && lastSavedAt !== undefined ? (
            <span className={`save-indicator ${hasUnsavedChanges ? 'unsaved' : 'saved'}`}>
              {hasUnsavedChanges ? '⚠️ Not Saved' : `✅ Saved`}
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${selectionMode ? 'btn-success' : 'btn-primary'}`}
            onClick={toggleSelectionMode}
            style={{
              flex: 1,
              padding: '14px 16px',
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 8
            }}
          >
            {selectionMode ? '✅ Picking Mode ON' : '👆 Start Picking'}
          </button>
        </div>
        {!selectionMode && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 10, marginBottom: 0, textAlign: 'center' }}>
            Click the button above to start!
          </p>
        )}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Pre-Actions Recorder Panel - Simplified */}
        <div className={`panel ${expandedPanels.recorder ? '' : 'panel-collapsed'}`}>
          <div className="panel-header" onClick={() => togglePanel('recorder')}>
            <span className="panel-title">
              🎬 Record Clicks {recordedActions.length > 0 && `(${recordedActions.length})`}
            </span>
            <span>{expandedPanels.recorder ? '−' : '+'}</span>
          </div>
          <div className="panel-content">
            <div style={{
              padding: 12,
              background: 'rgba(255, 193, 7, 0.1)',
              borderRadius: 8,
              border: '1px solid var(--accent-warning)',
              marginBottom: 12
            }}>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>
                <strong>What's this?</strong> If you need to click "Accept Cookies" or close a popup before grabbing data, record those clicks here first!
              </p>
            </div>
            <div style={{ marginBottom: 12 }}>
              {isRecording ? (
                <button
                  className="btn btn-danger"
                  onClick={stopRecording}
                  style={{ width: '100%', padding: '12px 16px', fontSize: 15, fontWeight: 600, borderRadius: 8 }}
                >
                  ⏹️ Stop Recording
                </button>
              ) : (
                <button
                  className="btn btn-warning"
                  onClick={() => startRecording('Pre-actions')}
                  style={{ width: '100%', padding: '12px 16px', fontSize: 15, fontWeight: 600, borderRadius: 8 }}
                >
                  🔴 Record My Clicks
                </button>
              )}
            </div>

            {recordedActions.length > 0 && (
              <div className="action-list">
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  ✅ {recordedActions.length} click{recordedActions.length > 1 ? 's' : ''} recorded:
                </p>
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

        {/* Element Selection Wizard - Super Simple */}
        {selectionMode && (
          <div className="panel" style={{ border: '2px solid var(--accent-primary)' }}>
            <div className="panel-header" style={{ background: 'var(--accent-primary)', color: 'white' }}>
              <span className="panel-title" style={{ color: 'white', fontSize: 16 }}>
                {wizardStep === 'container' && '👆 Step 1: Pick a Product'}
                {wizardStep === 'labeling' && '🏷️ Step 2: Label the Info'}
                {wizardStep === 'complete' && '🎉 All Done!'}
              </span>
              {(containerElement || labeledItems.size > 0) && wizardStep !== 'complete' && (
                <button
                  className="btn btn-danger"
                  onClick={resetWizard}
                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6 }}
                >
                  Start Over
                </button>
              )}
            </div>
            <div className="panel-content">
              {/* Step indicator - bigger and clearer */}
              <div style={{
                display: 'flex',
                gap: 8,
                marginBottom: 16,
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                  background: wizardStep === 'container' ? 'var(--accent-primary)' : 'var(--accent-success)',
                  color: 'white'
                }}>
                  {wizardStep === 'container' ? '1' : '✓'}
                </div>
                <div style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  background: wizardStep === 'labeling' || wizardStep === 'complete' ? 'var(--accent-success)' : 'var(--bg-tertiary)'
                }} />
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                  background: wizardStep === 'labeling' ? 'var(--accent-primary)' : wizardStep === 'complete' ? 'var(--accent-success)' : 'var(--bg-tertiary)',
                  color: wizardStep === 'container' ? 'var(--text-muted)' : 'white'
                }}>
                  {wizardStep === 'complete' ? '✓' : '2'}
                </div>
              </div>

              {/* Instructions based on step - BIG and CLEAR */}
              {wizardStep === 'container' && (
                <div style={{
                  padding: 16,
                  background: 'linear-gradient(135deg, rgba(138, 43, 226, 0.15), rgba(0, 153, 255, 0.15))',
                  borderRadius: 12,
                  border: '2px dashed #8a2be2',
                  marginBottom: 16,
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>👆</div>
                  <p style={{ fontSize: 15, color: 'var(--text-primary)', margin: 0, fontWeight: 600 }}>
                    Click on ONE product in the browser
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0 0 0' }}>
                    Pick any product box - the thing with a name, price, and picture
                  </p>
                </div>
              )}

              {wizardStep === 'labeling' && (
                <div style={{
                  padding: 16,
                  background: 'linear-gradient(135deg, rgba(0, 153, 255, 0.15), rgba(0, 204, 102, 0.15))',
                  borderRadius: 12,
                  border: '2px solid var(--accent-primary)',
                  marginBottom: 16,
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🏷️</div>
                  <p style={{ fontSize: 15, color: 'var(--text-primary)', margin: 0, fontWeight: 600 }}>
                    Tell us what each thing is!
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0 0 0' }}>
                    Look at each piece of info below and click the right label
                  </p>
                </div>
              )}

              {wizardStep === 'complete' && (
                <div style={{
                  padding: 20,
                  background: 'linear-gradient(135deg, rgba(0, 204, 102, 0.2), rgba(0, 153, 255, 0.1))',
                  borderRadius: 12,
                  border: '2px solid var(--accent-success)',
                  marginBottom: 16,
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
                  <p style={{ fontSize: 18, color: 'var(--accent-success)', margin: 0, fontWeight: 700 }}>
                    Great job!
                  </p>
                  <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '8px 0 16px 0' }}>
                    Now scroll down and click the big green button to grab all the data!
                  </p>
                  <button
                    className="btn"
                    onClick={resetWizard}
                    style={{ width: '100%', padding: '10px 16px', fontSize: 14, borderRadius: 8 }}
                  >
                    🔄 Pick Different Products
                  </button>
                </div>
              )}

              {/* Container step - show selected element and confirm button */}
              {wizardStep === 'container' && selectedElement && (
                <div style={{
                  padding: 16,
                  background: 'rgba(0, 204, 102, 0.1)',
                  borderRadius: 12,
                  border: '2px solid var(--accent-success)',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>✅</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-success)', marginBottom: 12 }}>
                    You picked something!
                  </div>
                  <button
                    className="btn btn-success"
                    onClick={setContainer}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      fontSize: 16,
                      fontWeight: 600,
                      borderRadius: 8
                    }}
                  >
                    ✨ Yes! Use This One
                  </button>
                </div>
              )}

              {/* Container step - no selection yet */}
              {wizardStep === 'container' && !selectedElement && (
                <div style={{
                  padding: 20,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 12,
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.5 }}>⏳</div>
                  <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, marginBottom: 16 }}>
                    Waiting for you to click on a product...
                  </p>
                  {sessionId && autoDetectProduct && (
                    <button
                      className="btn btn-primary"
                      onClick={autoDetectProduct}
                      disabled={isAutoDetecting}
                      style={{
                        padding: '12px 20px',
                        fontSize: 14,
                        fontWeight: 600,
                        borderRadius: 8
                      }}
                    >
                      {isAutoDetecting ? (
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <div className="loading-spinner" style={{ width: 16, height: 16 }} />
                          Finding...
                        </span>
                      ) : (
                        '🔍 Auto-Find a Product'
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Labeling step - show extracted content - SIMPLIFIED */}
              {wizardStep === 'labeling' && (
                <>
                  {/* Extracted items list - Made Simple */}
                  {extractedItems.length > 0 ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                        marginBottom: 12,
                        textAlign: 'center',
                        padding: '8px 12px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 8
                      }}>
                        👇 We found {extractedItems.length} pieces of info. What is each one?
                      </div>
                      {extractedItems.map((item, idx) => {
                        const assigned = labeledItems.get(item.value);
                        const assignedRole = assigned?.role;
                        const assignedRoleInfo = SELECTOR_ROLES.find(r => r.role === assignedRole);
                        return (
                          <div key={idx} style={{
                            padding: 12,
                            background: assignedRole ? 'rgba(0, 204, 102, 0.15)' : 'var(--bg-tertiary)',
                            borderRadius: 10,
                            marginBottom: 10,
                            border: assignedRole ? '2px solid var(--accent-success)' : '2px solid var(--border-color)'
                          }}>
                            {/* What type of thing is this - simplified */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <span style={{ fontSize: 18 }}>
                                {item.type === 'text' ? '📝' : item.type === 'link' ? '🔗' : '🖼️'}
                              </span>
                              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                {item.type === 'text' ? 'Text' : item.type === 'link' ? 'Link' : 'Picture'}
                              </span>
                              {assignedRole && (
                                <span style={{
                                  marginLeft: 'auto',
                                  padding: '4px 10px',
                                  borderRadius: 20,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: 'var(--accent-success)',
                                  color: 'white'
                                }}>
                                  {assignedRoleInfo?.emoji} {assignedRoleInfo?.label}
                                </span>
                              )}
                            </div>

                            {/* Item value - what it actually says */}
                            <div style={{
                              fontSize: 14,
                              marginBottom: 10,
                              padding: 10,
                              background: 'var(--bg-secondary)',
                              borderRadius: 8,
                              wordBreak: 'break-all',
                              maxHeight: 70,
                              overflow: 'auto',
                              border: '1px solid var(--border-color)'
                            }}>
                              {item.displayText || '(empty)'}
                            </div>

                            {/* Label buttons - BIGGER */}
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {SELECTOR_ROLES.filter(r => r.role !== 'nextPage').map(({ role, label, emoji }) => {
                                const isThisRole = assignedRole === role;
                                return (
                                  <button
                                    key={role}
                                    className={`btn ${isThisRole ? 'btn-success' : ''}`}
                                    onClick={() => labelItem(item.value, isThisRole ? null : role)}
                                    style={{
                                      padding: '8px 12px',
                                      fontSize: 13,
                                      borderRadius: 8,
                                      fontWeight: isThisRole ? 600 : 400
                                    }}
                                  >
                                    {emoji} {label}
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
                      padding: 20,
                      background: 'var(--bg-tertiary)',
                      borderRadius: 12,
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🤔</div>
                      <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>
                        Hmm, we couldn't find any info in that. Try clicking on a different product!
                      </p>
                      <button
                        className="btn"
                        onClick={resetWizard}
                        style={{ marginTop: 12, padding: '10px 16px', fontSize: 14, borderRadius: 8 }}
                      >
                        🔄 Try Again
                      </button>
                    </div>
                  )}

                  {/* Complete button - BIG AND CLEAR */}
                  {labeledItems.size > 0 && (
                    <button
                      className="btn btn-success"
                      onClick={completeWizard}
                      style={{
                        width: '100%',
                        padding: '16px 20px',
                        fontSize: 17,
                        fontWeight: 700,
                        borderRadius: 10
                      }}
                    >
                      ✅ Done! I Labeled {labeledItems.size} Thing{labeledItems.size > 1 ? 's' : ''}
                    </button>
                  )}

                  {labeledItems.size === 0 && extractedItems.length > 0 && (
                    <div style={{
                      padding: 12,
                      background: 'rgba(255, 193, 7, 0.15)',
                      borderRadius: 10,
                      textAlign: 'center',
                      border: '2px dashed var(--accent-warning)'
                    }}>
                      <span style={{ fontSize: 18 }}>☝️</span>
                      <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: '8px 0 0 0' }}>
                        Click the buttons above to tell us what each thing is!
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* What We're Grabbing - Simplified Selectors Panel */}
        <div className={`panel ${expandedPanels.selectors ? '' : 'panel-collapsed'}`}>
          <div className="panel-header" onClick={() => togglePanel('selectors')}>
            <span className="panel-title">📋 What We're Grabbing ({assignedSelectors.length})</span>
            <span>{expandedPanels.selectors ? '−' : '+'}</span>
          </div>
          <div className="panel-content">
            {assignedSelectors.length === 0 ? (
              <div style={{
                padding: 20,
                background: 'var(--bg-tertiary)',
                borderRadius: 12,
                textAlign: 'center'
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>
                  Nothing yet! Use the wizard above to pick what data to grab.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {SELECTOR_ROLES.map(({ role, label, emoji }) => {
                  const allAssigned = getAssignedAll(role);
                  if (allAssigned.length === 0) return null;
                  return (
                    <div key={role} style={{
                      padding: 12,
                      background: 'rgba(0, 204, 102, 0.1)',
                      borderRadius: 10,
                      border: '2px solid var(--accent-success)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 20 }}>{emoji}</span>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
                        <span style={{
                          marginLeft: 'auto',
                          fontSize: 12,
                          color: 'var(--accent-success)'
                        }}>
                          ✓ Set up
                        </span>
                      </div>
                      {allAssigned.map((assigned, idx) => (
                        <div key={idx} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 8px',
                          background: 'var(--bg-secondary)',
                          borderRadius: 6,
                          marginTop: 6,
                          fontSize: 12
                        }}>
                          <span style={{ flex: 1, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {assigned.selector.css}
                          </span>
                          <button
                            className="btn btn-danger"
                            onClick={() => removeSelector(role, assigned.priority)}
                            style={{ padding: '4px 8px', fontSize: 11, borderRadius: 6 }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Show what's not set up yet */}
            {assignedSelectors.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Not grabbing yet (optional):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {SELECTOR_ROLES.filter(r => getAssignedAll(r.role).length === 0).map(({ role, label, emoji }) => (
                    <span key={role} style={{
                      padding: '4px 10px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 20,
                      fontSize: 12,
                      color: 'var(--text-muted)'
                    }}>
                      {emoji} {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pagination Settings - Simplified */}
        {getAssigned('nextPage') && (
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">📄 How Many Pages?</span>
            </div>
            <div className="panel-content">
              <div style={{
                padding: 12,
                background: 'rgba(0, 153, 255, 0.1)',
                borderRadius: 10,
                border: '1px solid var(--accent-primary)',
                marginBottom: 12
              }}>
                <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>
                  🎉 You set up a "Next Page" button! How many pages should we grab?
                </p>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 14 }}>Number of pages to grab:</label>
                <input
                  type="number"
                  className="form-input"
                  min={1}
                  max={100}
                  value={maxPages}
                  onChange={(e) => setMaxPages(parseInt(e.target.value) || 1)}
                  style={{ fontSize: 16, padding: '12px', textAlign: 'center' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Results Panel - Simplified */}
        {scrapeResult && (
          <div className={`panel ${expandedPanels.results ? '' : 'panel-collapsed'}`} style={{ border: '2px solid var(--accent-success)' }}>
            <div className="panel-header" onClick={() => togglePanel('results')} style={{ background: 'var(--accent-success)' }}>
              <span className="panel-title" style={{ color: 'white', fontSize: 16 }}>
                🎉 We Got {scrapeResult.items.length} Items!
              </span>
              <span style={{ color: 'white' }}>{expandedPanels.results ? '−' : '+'}</span>
            </div>
            <div className="panel-content">
              {scrapeResult.success ? (
                <div style={{
                  padding: 12,
                  background: 'rgba(0, 204, 102, 0.1)',
                  borderRadius: 10,
                  marginBottom: 12,
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>✅</div>
                  <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>
                    Got <strong>{scrapeResult.items.length}</strong> products from <strong>{scrapeResult.pagesScraped}</strong> page{scrapeResult.pagesScraped > 1 ? 's' : ''}!
                  </p>
                </div>
              ) : (
                <div style={{
                  padding: 12,
                  background: 'rgba(255, 68, 68, 0.1)',
                  borderRadius: 10,
                  marginBottom: 12,
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>😕</div>
                  <p style={{ fontSize: 14, color: 'var(--accent-error)', margin: 0 }}>
                    Something went wrong: {scrapeResult.errors?.join(', ')}
                  </p>
                </div>
              )}

              {scrapeResult.items.length > 0 && (
                <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Here's a preview (first {Math.min(5, scrapeResult.items.length)}):
                  </p>
                  {scrapeResult.items.slice(0, 5).map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 10,
                        background: 'var(--bg-tertiary)',
                        borderRadius: 8,
                        marginBottom: 8,
                        fontSize: 13,
                      }}
                    >
                      {Object.entries(item).map(([key, value]) => {
                        const roleInfo = SELECTOR_ROLES.find(r => r.role === key);
                        return (
                          <div key={key} style={{ marginBottom: 4, display: 'flex', gap: 6 }}>
                            <span style={{ color: 'var(--text-muted)', minWidth: 80 }}>
                              {roleInfo?.emoji} {roleInfo?.label || key}:
                            </span>
                            <span style={{ color: value ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                              {value || '(empty)'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {scrapeResult.items.length > 5 && (
                    <div style={{ textAlign: 'center', padding: 8, color: 'var(--text-muted)', fontSize: 13 }}>
                      ...and {scrapeResult.items.length - 5} more products!
                    </div>
                  )}
                </div>
              )}

              <button
                className="btn btn-primary"
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
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 10
                }}
              >
                💾 Download My Data
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Execute Section - Big and Clear */}
      <div style={{
        padding: 20,
        borderTop: '2px solid var(--border-color)',
        background: 'var(--bg-secondary)'
      }}>
        {/* Name input - simplified */}
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label" style={{ fontSize: 14, fontWeight: 600 }}>
            📝 Name your grabber:
          </label>
          <input
            type="text"
            className="form-input"
            value={scraperName}
            onChange={(e) => setScraperName(e.target.value)}
            placeholder="My Data Grabber"
            style={{
              fontSize: 15,
              padding: '12px 14px',
              borderRadius: 10
            }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
          {/* Main action button - THE BIG ONE */}
          <button
            className="btn btn-success"
            onClick={handleExecuteScrape}
            disabled={assignedSelectors.length === 0 || !itemContainerSelector || isScrapingRunning}
            style={{
              width: '100%',
              padding: '18px 20px',
              fontSize: 18,
              fontWeight: 700,
              borderRadius: 12,
              opacity: (assignedSelectors.length === 0 || !itemContainerSelector) ? 0.5 : 1
            }}
          >
            {isScrapingRunning ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                Grabbing Data...
              </span>
            ) : !itemContainerSelector ? (
              '👆 First, pick a product above'
            ) : assignedSelectors.length === 0 ? (
              '🏷️ First, label some info above'
            ) : (
              '🚀 Grab All The Data!'
            )}
          </button>

          {/* Save button - secondary */}
          {onSaveScraper && (
            <button
              className="btn"
              onClick={onSaveScraper}
              style={{
                width: '100%',
                padding: '12px 16px',
                fontSize: 14,
                borderRadius: 10
              }}
            >
              💾 Save For Later
            </button>
          )}
        </div>

        {/* Help text when not ready */}
        {(assignedSelectors.length === 0 || !itemContainerSelector) && (
          <div style={{
            marginTop: 12,
            padding: 12,
            background: 'rgba(255, 193, 7, 0.1)',
            borderRadius: 10,
            textAlign: 'center',
            border: '1px dashed var(--accent-warning)'
          }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              {!itemContainerSelector
                ? '👆 Click "Start Picking" and click on a product to get started!'
                : '🏷️ Almost there! Label at least one piece of info (like the name or price).'
              }
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
