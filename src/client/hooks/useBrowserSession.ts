// ============================================================================
// BROWSER SESSION HOOK - Manages browser session state
// ============================================================================

import { useState, useCallback, useEffect } from 'react';
import type {
  SessionConfig,
  ElementSelector,
  AssignedSelector,
  SelectorRole,
  RecorderAction,
  RecorderSequence,
  ScraperConfig,
  ScrapeResult,
} from '../../shared/types';

interface UseBrowserSessionOptions {
  send: <T>(type: any, payload: T, sessionId?: string) => void;
  subscribe: (type: any, handler: (msg: any) => void) => () => void;
  connected: boolean;
}

interface UseBrowserSessionReturn {
  // Session
  sessionId: string | null;
  sessionStatus: 'disconnected' | 'connecting' | 'ready' | 'streaming' | 'scraping';
  createSession: (config: SessionConfig) => void;
  destroySession: () => void;

  // Navigation
  currentUrl: string;
  navigate: (url: string) => void;

  // Selection Mode
  selectionMode: boolean;
  toggleSelectionMode: () => void;
  hoveredElement: ElementSelector | null;
  selectedElement: ElementSelector | null;

  // Multi-select for pattern detection
  selectedElements: ElementSelector[];
  addSelectedElement: (element: ElementSelector) => void;
  clearSelectedElements: () => void;
  detectedPattern: { selector: string; count: number } | null;
  highlightPattern: (selector: string) => void;
  clearPatternHighlight: () => void;

  // Assigned Selectors
  assignedSelectors: AssignedSelector[];
  assignSelector: (role: SelectorRole, element: ElementSelector, extractionType?: string) => void;
  removeSelector: (role: SelectorRole) => void;
  loadSelectors: (selectors: AssignedSelector[]) => void;
  testSelector: (selector: string) => void;
  selectorTestResult: { valid: boolean; count: number; error?: string } | null;

  // Recording
  isRecording: boolean;
  recordedActions: RecorderAction[];
  startRecording: (name: string) => void;
  stopRecording: () => void;
  loadRecordedActions: (actions: RecorderAction[]) => void;
  currentSequence: RecorderSequence | null;

  // Scraping
  scraperConfig: ScraperConfig | null;
  setScraperConfig: (config: ScraperConfig) => void;
  executeScrape: () => void;
  scrapeResult: ScrapeResult | null;
  isScrapingRunning: boolean;
}

export function useBrowserSession(options: UseBrowserSessionOptions): UseBrowserSessionReturn {
  const { send, subscribe, connected } = options;

  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<UseBrowserSessionReturn['sessionStatus']>('disconnected');
  const [currentUrl, setCurrentUrl] = useState('');

  // Selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [hoveredElement, setHoveredElement] = useState<ElementSelector | null>(null);
  const [selectedElement, setSelectedElement] = useState<ElementSelector | null>(null);
  const [selectedElements, setSelectedElements] = useState<ElementSelector[]>([]); // Multi-select
  const [detectedPattern, setDetectedPattern] = useState<{ selector: string; count: number } | null>(null);

  // Selector state
  const [assignedSelectors, setAssignedSelectors] = useState<AssignedSelector[]>([]);
  const [selectorTestResult, setSelectorTestResult] = useState<{
    valid: boolean;
    count: number;
    error?: string;
  } | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordedActions, setRecordedActions] = useState<RecorderAction[]>([]);
  const [currentSequence, setCurrentSequence] = useState<RecorderSequence | null>(null);

  // Scraping state
  const [scraperConfig, setScraperConfig] = useState<ScraperConfig | null>(null);
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [isScrapingRunning, setIsScrapingRunning] = useState(false);

  // Subscribe to WebSocket messages
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    // Session created
    unsubscribes.push(
      subscribe('session:created', (msg) => {
        setSessionId(msg.payload.sessionId);
        setCurrentUrl(msg.payload.url);
        setSessionStatus('ready');
        console.log('[Session] Created:', msg.payload.sessionId);
      })
    );

    // Navigation complete
    unsubscribes.push(
      subscribe('navigate:complete', (msg) => {
        setCurrentUrl(msg.payload.url);
      })
    );

    // DOM highlight (hover)
    unsubscribes.push(
      subscribe('dom:highlight', (msg) => {
        setHoveredElement(msg.payload.element);
      })
    );

    // DOM selected (click)
    unsubscribes.push(
      subscribe('dom:selected', (msg) => {
        setSelectedElement(msg.payload.element);
      })
    );

    // Selection mode toggled
    unsubscribes.push(
      subscribe('dom:select', (msg) => {
        setSelectionMode(msg.payload.enabled);
      })
    );

    // Selector test result
    unsubscribes.push(
      subscribe('selector:result', (msg) => {
        setSelectorTestResult(msg.payload);
      })
    );

    // Pattern detection result
    unsubscribes.push(
      subscribe('selector:pattern', (msg) => {
        if (msg.payload.selector) {
          setDetectedPattern({ selector: msg.payload.selector, count: msg.payload.count });
        } else {
          setDetectedPattern(null);
        }
      })
    );

    // Recording started
    unsubscribes.push(
      subscribe('recorder:start', (msg) => {
        setIsRecording(true);
        setCurrentSequence(msg.payload.sequence);
        setRecordedActions([]);
      })
    );

    // Recording stopped
    unsubscribes.push(
      subscribe('recorder:stop', (msg) => {
        setIsRecording(false);
        setCurrentSequence(msg.payload.sequence);
      })
    );

    // Recorded action
    unsubscribes.push(
      subscribe('recorder:action', (msg) => {
        setRecordedActions((prev) => [...prev, msg.payload.action]);
      })
    );

    // Scrape result
    unsubscribes.push(
      subscribe('scrape:result', (msg) => {
        setScrapeResult(msg.payload);
        setIsScrapingRunning(false);
        setSessionStatus('ready');
      })
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [subscribe]);

  // Create session
  const createSession = useCallback(
    (config: SessionConfig) => {
      if (!connected) return;
      setSessionStatus('connecting');
      send('session:create', config);
    },
    [connected, send]
  );

  // Destroy session
  const destroySession = useCallback(() => {
    if (!sessionId) return;
    send('session:destroy', {}, sessionId);
    setSessionId(null);
    setSessionStatus('disconnected');
    setAssignedSelectors([]);
    setRecordedActions([]);
    setScrapeResult(null);
  }, [sessionId, send]);

  // Navigate
  const navigate = useCallback(
    (url: string) => {
      if (!sessionId) return;
      send('navigate', { url }, sessionId);
    },
    [sessionId, send]
  );

  // Toggle selection mode
  const toggleSelectionMode = useCallback(() => {
    if (!sessionId) return;
    send('dom:select', {}, sessionId);
    // Clear multi-select when toggling
    setSelectedElements([]);
    setDetectedPattern(null);
  }, [sessionId, send]);

  // Add element to multi-select and find pattern
  const addSelectedElement = useCallback(
    (element: ElementSelector) => {
      setSelectedElements((prev) => {
        const newElements = [...prev, element];
        // When we have 2+ elements, find the common pattern
        if (newElements.length >= 2 && sessionId) {
          send('selector:findPattern', { elements: newElements }, sessionId);
        }
        return newElements;
      });
    },
    [sessionId, send]
  );

  // Clear multi-select
  const clearSelectedElements = useCallback(() => {
    setSelectedElements([]);
    setDetectedPattern(null);
    if (sessionId) {
      send('selector:clearHighlight', {}, sessionId);
    }
  }, [sessionId, send]);

  // Highlight all elements matching pattern
  const highlightPattern = useCallback(
    (selector: string) => {
      if (!sessionId) return;
      send('selector:highlightAll', { selector }, sessionId);
    },
    [sessionId, send]
  );

  // Clear pattern highlight
  const clearPatternHighlight = useCallback(() => {
    if (!sessionId) return;
    send('selector:clearHighlight', {}, sessionId);
  }, [sessionId, send]);

  // Assign selector
  const assignSelector = useCallback(
    (role: SelectorRole, element: ElementSelector, extractionType: string = 'text') => {
      setAssignedSelectors((prev) => {
        // Remove existing selector for this role
        const filtered = prev.filter((s) => s.role !== role);
        return [
          ...filtered,
          {
            role,
            selector: element,
            extractionType: extractionType as AssignedSelector['extractionType'],
          },
        ];
      });
      setSelectedElement(null);
    },
    []
  );

  // Remove selector
  const removeSelector = useCallback((role: SelectorRole) => {
    setAssignedSelectors((prev) => prev.filter((s) => s.role !== role));
  }, []);

  // Load selectors (for loading saved scraper config)
  const loadSelectors = useCallback((selectors: AssignedSelector[]) => {
    setAssignedSelectors(selectors);
  }, []);

  // Test selector
  const testSelector = useCallback(
    (selector: string) => {
      if (!sessionId) return;
      setSelectorTestResult(null);
      send('selector:test', { selector }, sessionId);
    },
    [sessionId, send]
  );

  // Start recording
  const startRecording = useCallback(
    (name: string) => {
      if (!sessionId) return;
      send('recorder:start', { name }, sessionId);
    },
    [sessionId, send]
  );

  // Stop recording
  const stopRecording = useCallback(() => {
    if (!sessionId) return;
    send('recorder:stop', {}, sessionId);
  }, [sessionId, send]);

  // Load recorded actions (for loading saved scraper config)
  const loadRecordedActions = useCallback((actions: RecorderAction[]) => {
    setRecordedActions(actions);
  }, []);

  // Execute scrape
  const executeScrape = useCallback(() => {
    if (!sessionId || !scraperConfig) return;
    setIsScrapingRunning(true);
    setSessionStatus('scraping');
    setScrapeResult(null);
    send('scrape:execute', scraperConfig, sessionId);
  }, [sessionId, scraperConfig, send]);

  return {
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
    currentSequence,

    scraperConfig,
    setScraperConfig,
    executeScrape,
    scrapeResult,
    isScrapingRunning,
  };
}
