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
  CapturedUrl,
  UrlHoverPayload,
  ExtractedContentItem,
  ContainerContentPayload,
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
  assignSelector: (role: SelectorRole, element: ElementSelector, extractionType?: string, priority?: number) => void;
  removeSelector: (role: SelectorRole, priority?: number) => void;
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

  // URL Capture
  hoveredUrl: UrlHoverPayload | null;
  capturedUrls: CapturedUrl[];
  captureUrl: (url: string, text?: string, title?: string) => void;
  clearCapturedUrls: () => void;

  // Container extraction
  extractContainerContent: (selector: string) => void;
  extractedContent: ExtractedContentItem[];

  // Auto-detect product
  autoDetectProduct: () => void;
  isAutoDetecting: boolean;
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

  // URL Capture state
  const [hoveredUrl, setHoveredUrl] = useState<UrlHoverPayload | null>(null);
  const [capturedUrls, setCapturedUrls] = useState<CapturedUrl[]>([]);

  // Container extraction state
  const [extractedContent, setExtractedContent] = useState<ExtractedContentItem[]>([]);

  // Auto-detect state
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);

  // Track if subscriptions are ready
  const [subscriptionsReady, setSubscriptionsReady] = useState(false);

  // Subscribe to WebSocket messages
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    // Session created
    unsubscribes.push(
      subscribe('session:created', (msg) => {
        setSessionId(msg.payload.sessionId);
        setCurrentUrl(msg.payload.url);
        setSessionStatus('ready');
        // Reset all state for fresh session
        setSelectedElement(null);
        setSelectedElements([]);
        setExtractedContent([]);
        setHoveredElement(null);
        setSelectionMode(false);
        setDetectedPattern(null);
        setAssignedSelectors([]);
        setRecordedActions([]);
        setScrapeResult(null);
        setSelectorTestResult(null);
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

    // URL hover
    unsubscribes.push(
      subscribe('url:hover', (msg) => {
        setHoveredUrl(msg.payload);
      })
    );

    // URL history update
    unsubscribes.push(
      subscribe('url:history', (msg) => {
        setCapturedUrls(msg.payload.urls || []);
      })
    );

    // Container content extraction result
    unsubscribes.push(
      subscribe('container:content', (msg) => {
        const payload = msg.payload as ContainerContentPayload;
        setExtractedContent(payload.items || []);
        console.log('[Session] Container content extracted:', payload.items?.length || 0, 'items');
      })
    );

    // Auto-detect result
    unsubscribes.push(
      subscribe('dom:autoDetect', (msg) => {
        setIsAutoDetecting(false);
        if (msg.payload.success) {
          console.log('[Session] Auto-detected product:', msg.payload.element?.css);
        } else {
          console.log('[Session] Auto-detect failed:', msg.payload.error);
        }
      })
    );

    // Mark subscriptions as ready
    setSubscriptionsReady(true);
    console.log('[Session] All subscriptions ready');

    return () => {
      setSubscriptionsReady(false);
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
    // Clear all state from previous session
    setAssignedSelectors([]);
    setRecordedActions([]);
    setScrapeResult(null);
    setSelectedElement(null);
    setSelectedElements([]);
    setExtractedContent([]);
    setHoveredElement(null);
    setSelectionMode(false);
    setDetectedPattern(null);
    setSelectorTestResult(null);
    setCurrentUrl('');
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

  // Assign selector - supports multiple selectors per role with priority (for fallbacks)
  const assignSelector = useCallback(
    (role: SelectorRole, element: ElementSelector, extractionType: string = 'text', priority: number = 0) => {
      setAssignedSelectors((prev) => {
        // Add new selector, keeping existing ones for other roles or same role with different priority
        return [
          ...prev,
          {
            role,
            selector: element,
            extractionType: extractionType as AssignedSelector['extractionType'],
            priority,
          },
        ];
      });
      setSelectedElement(null);
    },
    []
  );

  // Remove selector - if priority specified, remove only that one; otherwise remove all for role
  const removeSelector = useCallback((role: SelectorRole, priority?: number) => {
    setAssignedSelectors((prev) => {
      if (priority !== undefined) {
        // Remove specific priority for this role
        return prev.filter((s) => !(s.role === role && s.priority === priority));
      }
      // Remove all selectors for this role
      return prev.filter((s) => s.role !== role);
    });
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

  // Capture a URL (save to history)
  const captureUrl = useCallback(
    (url: string, text?: string, title?: string) => {
      if (!sessionId) return;
      send('url:captured', { url, text, title }, sessionId);
    },
    [sessionId, send]
  );

  // Clear captured URLs
  const clearCapturedUrls = useCallback(() => {
    setCapturedUrls([]);
  }, []);

  // Extract content from a container element
  const extractContainerContent = useCallback(
    (selector: string) => {
      if (!sessionId) return;
      if (!subscriptionsReady) {
        console.warn('[Session] Subscriptions not ready, delaying extraction...');
        // Retry after a short delay
        setTimeout(() => {
          setExtractedContent([]); // Clear previous
          send('container:extract', { selector }, sessionId);
        }, 200);
        return;
      }
      setExtractedContent([]); // Clear previous
      send('container:extract', { selector }, sessionId);
    },
    [sessionId, send, subscriptionsReady]
  );

  // Auto-detect first product on the page
  const autoDetectProduct = useCallback(() => {
    if (!sessionId) return;
    setIsAutoDetecting(true);
    send('dom:autoDetect', {}, sessionId);
  }, [sessionId, send]);

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

    hoveredUrl,
    capturedUrls,
    captureUrl,
    clearCapturedUrls,

    extractContainerContent,
    extractedContent,

    autoDetectProduct,
    isAutoDetecting,
  };
}
