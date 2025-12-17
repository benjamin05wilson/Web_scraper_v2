// ============================================================================
// SCRAPER BUILDER PAGE - Main scraping interface
// ============================================================================

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useBrowserSession } from '../../hooks/useBrowserSession';
import { BrowserView } from '../../components/BrowserView';
import { Sidebar } from '../../components/Sidebar';
import { NavBar } from '../../components/NavBar';
import { useScraperContext } from '../../context/ScraperContext';
import { useToast } from '../../context/ToastContext';
import type { MouseEvent as AppMouseEvent, SessionConfig } from '../../../shared/types';

const WS_URL = `ws://${window.location.hostname}:3002/ws`;

// Layout constants
const SIDEBAR_WIDTH = 320;
const NAVBAR_HEIGHT = 60;
const STATUSBAR_HEIGHT = 32;
const APP_NAV_HEIGHT = 48;

export const ScraperBuilder: React.FC = () => {
  const { id: scraperId } = useParams<{ id?: string }>();
  const { getScraperById, saveScraper, updateScraper, saveResult } = useScraperContext();
  const { showToast } = useToast();

  const mainContentRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [scraperName, setScraperName] = useState('My Scraper');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Calculate viewport based on available screen space
  useEffect(() => {
    const calculateViewport = () => {
      // Available width = window width - sidebar
      const availableWidth = window.innerWidth - SIDEBAR_WIDTH;
      // Available height = window height - navbar - statusbar - app nav
      const availableHeight = window.innerHeight - NAVBAR_HEIGHT - STATUSBAR_HEIGHT - APP_NAV_HEIGHT;

      // Use the available space, with some padding
      const width = Math.max(800, Math.floor(availableWidth - 20));
      const height = Math.max(600, Math.floor(availableHeight - 20));

      setViewport({ width, height });
    };

    // Calculate on mount
    calculateViewport();

    // Recalculate on resize
    window.addEventListener('resize', calculateViewport);
    return () => window.removeEventListener('resize', calculateViewport);
  }, []);

  // WebSocket connection
  const { connected, connecting, send, subscribe } = useWebSocket({
    url: WS_URL,
    onOpen: () => console.log('[ScraperBuilder] WebSocket connected'),
    onClose: () => console.log('[ScraperBuilder] WebSocket disconnected'),
    onError: (e) => console.error('[ScraperBuilder] WebSocket error:', e),
  });

  // Browser session management
  const {
    sessionId,
    sessionStatus,
    createSession,
    destroySession,
    currentUrl,
    navigate,
    selectionMode,
    toggleSelectionMode,
    hoveredElement,
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
    loadSelectors,
    testSelector,
    selectorTestResult,
    isRecording,
    recordedActions,
    startRecording,
    stopRecording,
    loadRecordedActions,
    setScraperConfig,
    executeScrape,
    scrapeResult,
    isScrapingRunning,
  } = useBrowserSession({ send, subscribe, connected });

  // Load scraper config if editing existing
  useEffect(() => {
    if (scraperId) {
      const scraper = getScraperById(scraperId);
      if (scraper) {
        setScraperName(scraper.name);
        // Load selectors from saved config
        if (scraper.config.selectors && scraper.config.selectors.length > 0) {
          loadSelectors(scraper.config.selectors);
        }
        // Load pre-actions if they exist
        if (scraper.config.preActions && scraper.config.preActions.actions.length > 0) {
          loadRecordedActions(scraper.config.preActions.actions);
        }
      }
    }
  }, [scraperId, getScraperById, loadSelectors, loadRecordedActions]);

  // Start streaming when session is created
  useEffect(() => {
    if (sessionId && sessionStatus === 'ready') {
      // Request video stream
      send('webrtc:offer', {}, sessionId);
    }
  }, [sessionId, sessionStatus, send]);

  // Handle session creation
  const handleCreateSession = useCallback(
    (url: string) => {
      const config: SessionConfig = {
        url,
        viewport,
      };
      createSession(config);
    },
    [createSession, viewport]
  );

  // Handle mouse events
  const handleMouseEvent = useCallback(
    (event: AppMouseEvent) => {
      if (!sessionId) return;
      send('input:mouse', event, sessionId);
    },
    [sessionId, send]
  );

  // Handle keyboard events
  const handleKeyEvent = useCallback(
    (event: { type: 'keydown' | 'keyup'; key: string; code: string; modifiers?: any }) => {
      if (!sessionId) return;
      send('input:keyboard', event, sessionId);
    },
    [sessionId, send]
  );

  // Handle scroll events
  const handleScroll = useCallback(
    (event: { deltaX: number; deltaY: number; x: number; y: number }) => {
      if (!sessionId) return;
      send('input:scroll', event, sessionId);
    },
    [sessionId, send]
  );

  // Track unsaved changes
  useEffect(() => {
    if (lastSavedAt !== null) {
      setHasUnsavedChanges(true);
    }
  }, [scraperName, assignedSelectors, recordedActions, currentUrl]);

  // Handle saving scraper
  const handleSaveScraper = useCallback(() => {
    const config = {
      name: scraperName,
      startUrl: currentUrl || '',
      selectors: assignedSelectors,
      preActions: recordedActions.length > 0 ? {
        id: `seq-${Date.now()}`,
        name: 'Pre-actions',
        actions: recordedActions,
        createdAt: Date.now(),
      } : undefined,
    };

    if (scraperId) {
      updateScraper(scraperId, { name: scraperName, config });
      showToast(`Scraper "${scraperName}" updated`, 'success');
    } else {
      saveScraper(scraperName, config);
      showToast(`Scraper "${scraperName}" saved`, 'success');
    }

    setHasUnsavedChanges(false);
    setLastSavedAt(Date.now());
  }, [scraperName, currentUrl, assignedSelectors, recordedActions, scraperId, saveScraper, updateScraper, showToast]);

  // Handle scrape result - save to context
  useEffect(() => {
    if (scrapeResult && scrapeResult.success && currentUrl) {
      // Auto-save result if we have a scraper ID
      if (scraperId) {
        saveResult(scraperId, scraperName, currentUrl, scrapeResult);
      }
    }
  }, [scrapeResult, scraperId, scraperName, currentUrl, saveResult]);

  // Update status based on connection
  const displayStatus = !connected
    ? 'disconnected'
    : connecting
    ? 'connecting'
    : sessionStatus;

  return (
    <div className="app-container" style={{ flex: 1 }}>
      {/* Sidebar - Scraper configuration */}
      <Sidebar
        selectionMode={selectionMode}
        toggleSelectionMode={toggleSelectionMode}
        selectedElement={selectedElement}
        selectedElements={selectedElements}
        addSelectedElement={addSelectedElement}
        clearSelectedElements={clearSelectedElements}
        detectedPattern={detectedPattern}
        highlightPattern={highlightPattern}
        clearPatternHighlight={clearPatternHighlight}
        assignedSelectors={assignedSelectors}
        assignSelector={assignSelector}
        removeSelector={removeSelector}
        testSelector={testSelector}
        selectorTestResult={selectorTestResult}
        isRecording={isRecording}
        recordedActions={recordedActions}
        startRecording={startRecording}
        stopRecording={stopRecording}
        setScraperConfig={setScraperConfig}
        executeScrape={executeScrape}
        scrapeResult={scrapeResult}
        isScrapingRunning={isScrapingRunning}
        currentUrl={currentUrl}
        scraperName={scraperName}
        onScraperNameChange={setScraperName}
        onSaveScraper={handleSaveScraper}
        hasUnsavedChanges={hasUnsavedChanges}
        lastSavedAt={lastSavedAt}
      />

      {/* Main content area */}
      <div className="main-content" ref={mainContentRef}>
        {/* Navigation bar */}
        <NavBar
          currentUrl={currentUrl}
          sessionStatus={displayStatus}
          onNavigate={navigate}
          onCreateSession={handleCreateSession}
          onDestroySession={destroySession}
          sessionId={sessionId}
        />

        {/* Browser view */}
        <BrowserView
          sessionId={sessionId}
          onMouseEvent={handleMouseEvent}
          onKeyEvent={handleKeyEvent}
          onScroll={handleScroll}
          hoveredElement={hoveredElement}
          selectionMode={selectionMode}
          subscribe={subscribe}
          viewport={viewport}
        />

        {/* Status bar */}
        <div className="status-bar">
          <div className="status-indicator">
            <div
              className={`status-dot ${
                !connected ? 'disconnected' : connecting ? 'connecting' : ''
              }`}
            />
            <span>
              {!connected
                ? 'Disconnected'
                : connecting
                ? 'Connecting...'
                : sessionId
                ? `Session: ${sessionId.substring(0, 8)}...`
                : 'No session'}
            </span>
          </div>

          {selectionMode && (
            <span style={{ color: 'var(--accent-primary)' }}>Selection Mode Active</span>
          )}

          {isRecording && (
            <span style={{ color: 'var(--accent-warning)' }}>
              Recording ({recordedActions.length} actions)
            </span>
          )}

          {isScrapingRunning && (
            <span style={{ color: 'var(--accent-success)' }}>Scraping in progress...</span>
          )}

          <div style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
            {currentUrl && new URL(currentUrl).hostname}
          </div>
        </div>
      </div>
    </div>
  );
};
