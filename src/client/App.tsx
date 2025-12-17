// ============================================================================
// MAIN APP - Orchestrates all components
// ============================================================================

import React, { useCallback, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useBrowserSession } from './hooks/useBrowserSession';
import { BrowserView } from './components/BrowserView';
import { Sidebar } from './components/Sidebar';
import { NavBar } from './components/NavBar';
import type { MouseEvent as AppMouseEvent, SessionConfig } from '../shared/types';

const WS_URL = `ws://${window.location.hostname}:3002/ws`;

export const App: React.FC = () => {
  // WebSocket connection
  const { connected, connecting, send, subscribe } = useWebSocket({
    url: WS_URL,
    onOpen: () => console.log('[App] WebSocket connected'),
    onClose: () => console.log('[App] WebSocket disconnected'),
    onError: (e) => console.error('[App] WebSocket error:', e),
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
  } = useBrowserSession({ send, subscribe, connected });

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
        viewport: { width: 1280, height: 720 },
      };
      createSession(config);
    },
    [createSession]
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

  // Update status based on connection
  const displayStatus = !connected
    ? 'disconnected'
    : connecting
    ? 'connecting'
    : sessionStatus;

  return (
    <div className="app-container">
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
      />

      {/* Main content area */}
      <div className="main-content">
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
              ⏺ Recording ({recordedActions.length} actions)
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
