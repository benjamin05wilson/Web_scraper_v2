// ============================================================================
// AUTOMATED BUILDER FLOW HOOK - State machine for automated workflow
// ============================================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ElementSelector, PaginationCandidate, WSMessageType } from '../../shared/types';

// Workflow states - PRODUCTS FIRST, then PAGINATION
export type AutomatedBuilderState =
  | 'IDLE'
  | 'LAUNCHING_BROWSER'
  | 'POPUP_DETECTION'
  | 'POPUP_RECORDING'
  | 'AUTO_DETECTING_PRODUCT'
  | 'PRODUCT_CONFIRMATION'
  | 'MANUAL_PRODUCT_SELECT'
  | 'LABELING'
  | 'PAGINATION_DEMO'         // User demonstrating pagination (scroll or click)
  | 'PAGINATION_DEMO_SUCCESS' // Demo succeeded, show result for confirmation
  | 'PAGINATION_MANUAL'       // Manual fallback
  | 'FINAL_CONFIG'
  | 'SAVING'
  | 'COMPLETE';

// Overlay types
export type OverlayType = 'popup' | 'product' | 'pagination_demo' | 'pagination_demo_success' | null;

// Dismiss action for popup recording
export interface DismissAction {
  selector: string;
  text?: string;
  isLanguageRelated?: boolean;
  x?: number;
  y?: number;
}

// Offset pattern for URL-based pagination (e.g., ?o=0 → ?o=24 → ?o=48)
export interface OffsetConfig {
  key: string;         // e.g., 'o', 'offset', 'start'
  start: number;       // Starting value (usually 0)
  increment: number;   // How much to add per page (e.g., 24)
}

// Pagination pattern
export interface PaginationPattern {
  type: 'url_pattern' | 'next_page' | 'infinite_scroll';
  pattern?: string;
  selector?: string;
  start_page?: number;
  max_pages?: number;
  // For URL-based offset pagination (e.g., ?o=0 → ?o=24)
  offset?: OffsetConfig;
  // For infinite scroll - Y positions where new items loaded
  scrollPositions?: number[];
  // Products loaded per page/scroll iteration
  productsPerPage?: number;
}

// User-demonstrated pagination result
export interface DemoPaginationResult {
  method: 'scroll' | 'click';
  scrollDistance?: number;
  clickSelector?: string;
  clickCoordinates?: { x: number; y: number };
  beforeProductCount: number;
  afterProductCount: number;
  productDelta: number;
  verified: boolean;
}

// Demo progress state
export interface DemoProgressState {
  productCount: number;
  productDelta: number;
  accumulatedScroll: number;
  lastClickedSelector?: string;
  wrongNavWarning: boolean;
  shouldAutoComplete: boolean;
}

interface UseAutomatedBuilderFlowOptions {
  sessionId: string | null;
  sessionStatus: 'disconnected' | 'connecting' | 'ready' | 'streaming' | 'scraping';
  send: <T>(type: WSMessageType, payload: T, sessionId?: string) => void;
  subscribe: (type: WSMessageType | WSMessageType[], handler: (msg: any) => void) => () => void;
  connected: boolean;
  autoDetectProduct: () => void;
  isAutoDetecting: boolean;
  selectedElement: ElementSelector | null;
}

export interface UseAutomatedBuilderFlowReturn {
  // Current state
  state: AutomatedBuilderState;

  // Overlay control
  showOverlay: boolean;
  overlayType: OverlayType;

  // State-specific data
  dismissActions: DismissAction[];
  detectedProduct: ElementSelector | null;
  productConfidence: number;
  productScreenshot: string | null;
  detectedPagination: PaginationPattern | null;
  paginationCandidates: PaginationCandidate[];
  isPaginationDetecting: boolean;

  // Pagination demo data
  demoProgress: DemoProgressState;
  demoResult: DemoPaginationResult | null;

  // State transitions
  transition: (event: BuilderEvent) => void;

  // Overlay handlers
  handlePopupConfirm: (allClosed: boolean) => void;
  handleProductConfirm: (correct: boolean) => void;
  handleDemoConfirm: (confirmed: boolean) => void;

  // Action handlers
  startBrowser: () => void;
  addDismissAction: (action: DismissAction) => void;
  finishDismissRecording: () => void;
  selectPaginationCandidate: (candidate: PaginationCandidate) => void;
  setPaginationManual: (pattern: PaginationPattern) => void;
  proceedToPaginationDemo: (itemSelector: string) => void;
  retryDemo: () => void;
  skipPagination: () => void;
  startSaving: () => void;
  completeSave: () => void;
  reset: () => void;

  // Derived state
  currentStepNumber: number;
  currentStepTitle: string;
}

// Events that trigger state transitions
type BuilderEvent =
  | 'OPEN_BROWSER'
  | 'SESSION_CREATED'
  | 'POPUP_YES'
  | 'POPUP_NO'
  | 'DONE_RECORDING'
  | 'PRODUCT_DETECTED'
  | 'PRODUCT_YES'
  | 'PRODUCT_NO'
  | 'MANUAL_SELECTED'
  | 'LABELS_APPLIED'
  | 'DEMO_STARTED'           // Demo mode activated
  | 'DEMO_SUCCESS'           // Demo completed with product increase
  | 'DEMO_FAILED'            // Demo completed but no product increase
  | 'DEMO_CONFIRMED'         // User confirmed demo result
  | 'DEMO_RETRY'             // User wants to retry demo
  | 'PAGINATION_CONFIGURED'  // Manual pagination configured
  | 'PAGINATION_SKIPPED'     // User skipped pagination
  | 'SAVE_CLICKED'
  | 'SAVE_SUCCESS'
  | 'RESET';

// New flow: Products FIRST, then Pagination Demo
const STEP_TITLES: Record<AutomatedBuilderState, string> = {
  IDLE: 'Enter URL',
  LAUNCHING_BROWSER: 'Opening Browser',
  POPUP_DETECTION: 'Checking Popups',
  POPUP_RECORDING: 'Recording Popup Dismissals',
  AUTO_DETECTING_PRODUCT: 'Detecting Product Card',
  PRODUCT_CONFIRMATION: 'Confirm Product Card',
  MANUAL_PRODUCT_SELECT: 'Select Product Card',
  LABELING: 'Label Product Data',
  PAGINATION_DEMO: 'Demonstrate Pagination',
  PAGINATION_DEMO_SUCCESS: 'Confirm Pagination Method',
  PAGINATION_MANUAL: 'Configure Pagination',
  FINAL_CONFIG: 'Final Configuration',
  SAVING: 'Saving Config',
  COMPLETE: 'Complete',
};

// Step order: Popups -> Products -> Labeling -> Pagination Demo -> Config
const STEP_NUMBERS: Record<AutomatedBuilderState, number> = {
  IDLE: 1,
  LAUNCHING_BROWSER: 1,
  POPUP_DETECTION: 2,
  POPUP_RECORDING: 2,
  AUTO_DETECTING_PRODUCT: 3,
  PRODUCT_CONFIRMATION: 3,
  MANUAL_PRODUCT_SELECT: 3,
  LABELING: 4,
  PAGINATION_DEMO: 5,
  PAGINATION_DEMO_SUCCESS: 5,
  PAGINATION_MANUAL: 5,
  FINAL_CONFIG: 6,
  SAVING: 6,
  COMPLETE: 6,
};

export function useAutomatedBuilderFlow(
  options: UseAutomatedBuilderFlowOptions
): UseAutomatedBuilderFlowReturn {
  const {
    sessionId,
    sessionStatus,
    send,
    subscribe,
    autoDetectProduct,
    isAutoDetecting,
    selectedElement,
  } = options;

  // Core state
  const [state, setState] = useState<AutomatedBuilderState>('IDLE');
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayType, setOverlayType] = useState<OverlayType>(null);

  // Data state
  const [dismissActions, setDismissActions] = useState<DismissAction[]>([]);
  const [detectedProduct, setDetectedProduct] = useState<ElementSelector | null>(null);
  const [productConfidence, setProductConfidence] = useState(0);
  const [productScreenshot, setProductScreenshot] = useState<string | null>(null);
  const [detectedPagination, setDetectedPagination] = useState<PaginationPattern | null>(null);
  const [paginationCandidates, setPaginationCandidates] = useState<PaginationCandidate[]>([]);
  const [isPaginationDetecting, setIsPaginationDetecting] = useState(false);

  // Pagination demo state
  const [demoProgress, setDemoProgress] = useState<DemoProgressState>({
    productCount: 0,
    productDelta: 0,
    accumulatedScroll: 0,
    wrongNavWarning: false,
    shouldAutoComplete: false,
  });
  const [demoResult, setDemoResult] = useState<DemoPaginationResult | null>(null);

  // Store item selector for pagination demo
  const itemSelectorRef = useRef<string | undefined>(undefined);

  // Timer ref for popup detection delay
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // State transition logic - NEW FLOW: Products FIRST, then Pagination
  const transition = useCallback((event: BuilderEvent) => {
    setState((currentState) => {
      switch (currentState) {
        case 'IDLE':
          if (event === 'OPEN_BROWSER') return 'LAUNCHING_BROWSER';
          break;
        case 'LAUNCHING_BROWSER':
          if (event === 'SESSION_CREATED') return 'POPUP_DETECTION';
          break;
        case 'POPUP_DETECTION':
          // After popups, go to PRODUCT detection (not pagination!)
          if (event === 'POPUP_YES') return 'AUTO_DETECTING_PRODUCT';
          if (event === 'POPUP_NO') return 'POPUP_RECORDING';
          break;
        case 'POPUP_RECORDING':
          if (event === 'DONE_RECORDING') return 'POPUP_DETECTION';
          break;
        case 'AUTO_DETECTING_PRODUCT':
          if (event === 'PRODUCT_DETECTED') return 'PRODUCT_CONFIRMATION';
          break;
        case 'PRODUCT_CONFIRMATION':
          if (event === 'PRODUCT_YES') return 'LABELING';
          if (event === 'PRODUCT_NO') return 'MANUAL_PRODUCT_SELECT';
          break;
        case 'MANUAL_PRODUCT_SELECT':
          if (event === 'MANUAL_SELECTED') return 'LABELING';
          break;
        case 'LABELING':
          // After labeling, go to pagination demo (user demonstrates pagination)
          if (event === 'LABELS_APPLIED') return 'PAGINATION_DEMO';
          break;
        case 'PAGINATION_DEMO':
          // Demo mode - user scrolls or clicks to show pagination
          if (event === 'DEMO_SUCCESS') return 'PAGINATION_DEMO_SUCCESS';
          if (event === 'DEMO_FAILED') return 'PAGINATION_DEMO'; // Stay in demo to retry
          if (event === 'PAGINATION_SKIPPED') return 'FINAL_CONFIG';
          break;
        case 'PAGINATION_DEMO_SUCCESS':
          // User saw demo result and can confirm or retry
          if (event === 'DEMO_CONFIRMED') return 'FINAL_CONFIG';
          if (event === 'DEMO_RETRY') return 'PAGINATION_DEMO';
          if (event === 'PAGINATION_SKIPPED') return 'FINAL_CONFIG';
          break;
        case 'PAGINATION_MANUAL':
          if (event === 'PAGINATION_CONFIGURED') return 'FINAL_CONFIG';
          if (event === 'PAGINATION_SKIPPED') return 'FINAL_CONFIG';
          break;
        case 'FINAL_CONFIG':
          if (event === 'SAVE_CLICKED') return 'SAVING';
          break;
        case 'SAVING':
          if (event === 'SAVE_SUCCESS') return 'COMPLETE';
          break;
      }

      // Handle reset from any state
      if (event === 'RESET') return 'IDLE';

      return currentState;
    });
  }, []);

  // Watch for session status changes - auto-close popups when ready
  useEffect(() => {
    if (state === 'LAUNCHING_BROWSER' && sessionStatus === 'ready' && sessionId) {
      popupTimerRef.current = setTimeout(() => {
        console.log('[AutomatedFlow] Triggering popup auto-close...');
        send('popup:autoClose', {}, sessionId);
      }, 3000);
    }

    return () => {
      if (popupTimerRef.current) {
        clearTimeout(popupTimerRef.current);
      }
    };
  }, [state, sessionStatus, sessionId, send]);

  // Subscribe to popup:closed result
  useEffect(() => {
    const unsubscribe = subscribe('popup:closed', (msg) => {
      console.log('[AutomatedFlow] Popup close result:', msg.payload);

      if (msg.payload.success) {
        if (msg.payload.dismissActions && msg.payload.dismissActions.length > 0) {
          setDismissActions(msg.payload.dismissActions);
        }
      }

      transition('SESSION_CREATED');
    });

    return unsubscribe;
  }, [subscribe, transition]);

  // Show overlay based on state
  useEffect(() => {
    switch (state) {
      case 'POPUP_DETECTION':
        setOverlayType('popup');
        setShowOverlay(true);
        break;
      case 'PRODUCT_CONFIRMATION':
        setOverlayType('product');
        setShowOverlay(true);
        break;
      case 'PAGINATION_DEMO':
        setOverlayType('pagination_demo');
        setShowOverlay(true);
        break;
      case 'PAGINATION_DEMO_SUCCESS':
        setOverlayType('pagination_demo_success');
        setShowOverlay(true);
        break;
      default:
        setShowOverlay(false);
        setOverlayType(null);
    }
  }, [state]);

  // Auto-trigger product detection when entering that state
  useEffect(() => {
    if (state === 'AUTO_DETECTING_PRODUCT' && !isAutoDetecting) {
      autoDetectProduct();
    }
  }, [state, isAutoDetecting, autoDetectProduct]);

  // Subscribe to auto-detect result
  useEffect(() => {
    const unsubscribe = subscribe('dom:autoDetect', (msg) => {
      if (state === 'AUTO_DETECTING_PRODUCT') {
        if (msg.payload.success && msg.payload.element) {
          setDetectedProduct(msg.payload.element);
          setProductConfidence(msg.payload.confidence || 0);
          setProductScreenshot(msg.payload.screenshot || null);
        } else {
          setDetectedProduct(null);
          setProductConfidence(0);
          setProductScreenshot(null);
        }
        transition('PRODUCT_DETECTED');
      }
    });

    return unsubscribe;
  }, [subscribe, state, transition]);

  // Watch for manual product selection
  useEffect(() => {
    if (state === 'MANUAL_PRODUCT_SELECT' && selectedElement) {
      setDetectedProduct(selectedElement);
      transition('MANUAL_SELECTED');
    }
  }, [state, selectedElement, transition]);

  // Subscribe to pagination demo events
  useEffect(() => {
    // Demo started - server is ready for user input
    const unsubDemoStarted = subscribe('pagination:demoStarted', (msg) => {
      console.log('[AutomatedFlow] Pagination demo started:', msg.payload);
      setDemoProgress({
        productCount: msg.payload.productCount,
        productDelta: 0,
        accumulatedScroll: 0,
        wrongNavWarning: false,
        shouldAutoComplete: false,
      });
      setDemoResult(null);
    });

    // Demo progress - scroll or click happened
    const unsubDemoProgress = subscribe('pagination:demoProgress', (msg) => {
      console.log('[AutomatedFlow] Pagination demo progress:', msg.payload);
      setDemoProgress((prev) => ({
        ...prev,
        productCount: msg.payload.currentCount,
        productDelta: msg.payload.delta,
        accumulatedScroll: msg.payload.accumulatedScroll ?? prev.accumulatedScroll,
        lastClickedSelector: msg.payload.selector ?? prev.lastClickedSelector,
        wrongNavWarning: msg.payload.wrongNavigation ?? false,
        shouldAutoComplete: msg.payload.shouldAutoComplete ?? false,
      }));
    });

    // Wrong navigation warning
    const unsubWrongNav = subscribe('pagination:demoWrongNav', (msg) => {
      console.log('[AutomatedFlow] Wrong navigation detected:', msg.payload);
      setDemoProgress((prev) => ({
        ...prev,
        wrongNavWarning: true,
      }));
      // Clear warning after 3 seconds
      setTimeout(() => {
        setDemoProgress((prev) => ({ ...prev, wrongNavWarning: false }));
      }, 3000);
    });

    // Demo result (auto-complete or manual complete)
    const unsubDemoResult = subscribe('pagination:demoResult', (msg) => {
      console.log('[AutomatedFlow] Pagination demo result:', msg.payload);
      const result: DemoPaginationResult = {
        method: msg.payload.method,
        scrollDistance: msg.payload.scrollDistance,
        clickSelector: msg.payload.clickSelector,
        clickCoordinates: msg.payload.clickCoordinates,
        beforeProductCount: msg.payload.beforeProductCount,
        afterProductCount: msg.payload.afterProductCount,
        productDelta: msg.payload.productDelta,
        verified: msg.payload.verified,
      };
      setDemoResult(result);

      if (result.verified) {
        transition('DEMO_SUCCESS');
      } else {
        // Stay in demo mode for retry - don't transition
        console.log('[AutomatedFlow] Demo failed - no product increase detected');
      }
    });

    // Demo error
    const unsubDemoError = subscribe('pagination:demoError', (msg) => {
      console.error('[AutomatedFlow] Pagination demo error:', msg.payload);
    });

    return () => {
      unsubDemoStarted();
      unsubDemoProgress();
      unsubWrongNav();
      unsubDemoResult();
      unsubDemoError();
    };
  }, [subscribe, transition]);

  // Start browser
  const startBrowser = useCallback(() => {
    transition('OPEN_BROWSER');
  }, [transition]);

  // Popup confirmation handlers
  const handlePopupConfirm = useCallback(
    (allClosed: boolean) => {
      if (allClosed) {
        transition('POPUP_YES');
      } else {
        transition('POPUP_NO');
      }
    },
    [transition]
  );

  // Add dismiss action
  const addDismissAction = useCallback((action: DismissAction) => {
    setDismissActions((prev) => [...prev, action]);
  }, []);

  // Finish dismiss recording
  const finishDismissRecording = useCallback(() => {
    transition('DONE_RECORDING');
  }, [transition]);

  // Product confirmation handlers
  const handleProductConfirm = useCallback(
    (correct: boolean) => {
      if (correct) {
        transition('PRODUCT_YES');
      } else {
        transition('PRODUCT_NO');
      }
    },
    [transition]
  );

  // Called when labels are applied - triggers pagination demo
  const proceedToPaginationDemo = useCallback((itemSelector: string) => {
    console.log('[AutomatedFlow] Labels applied, proceeding to pagination demo with itemSelector:', itemSelector);
    itemSelectorRef.current = itemSelector;
    transition('LABELS_APPLIED');
  }, [transition]);

  // Handle demo confirmation (user confirms the demonstrated method)
  const handleDemoConfirm = useCallback(
    (confirmed: boolean) => {
      if (confirmed && demoResult) {
        // Convert demo result to PaginationPattern for saving
        setDetectedPagination({
          type: demoResult.method === 'scroll' ? 'infinite_scroll' : 'next_page',
          selector: demoResult.clickSelector,
          scrollPositions: demoResult.method === 'scroll' && demoResult.scrollDistance
            ? [demoResult.scrollDistance]
            : undefined,
          productsPerPage: demoResult.productDelta,
          max_pages: 10,
        });
        transition('DEMO_CONFIRMED');
      } else {
        // User wants to retry
        transition('DEMO_RETRY');
      }
    },
    [transition, demoResult]
  );

  // Retry the demo
  const retryDemo = useCallback(() => {
    setDemoResult(null);
    setDemoProgress({
      productCount: 0,
      productDelta: 0,
      accumulatedScroll: 0,
      wrongNavWarning: false,
      shouldAutoComplete: false,
    });
    transition('DEMO_RETRY');
  }, [transition]);

  // Skip pagination entirely
  const skipPagination = useCallback(() => {
    setDetectedPagination(null);
    transition('PAGINATION_SKIPPED');
  }, [transition]);

  // Select a pagination candidate (legacy support)
  const selectPaginationCandidate = useCallback((candidate: PaginationCandidate) => {
    let paginationType: 'url_pattern' | 'next_page' | 'infinite_scroll' = 'next_page';
    if (candidate.type === 'load_more') {
      paginationType = 'infinite_scroll';
    } else if (candidate.type === 'numbered' && candidate.attributes?.href) {
      paginationType = 'url_pattern';
    }
    setDetectedPagination({
      type: paginationType,
      selector: candidate.selector,
      pattern: candidate.attributes?.href,
      max_pages: 10,
    });
  }, []);

  // Set pagination manually
  const setPaginationManual = useCallback(
    (pattern: PaginationPattern) => {
      setDetectedPagination(pattern);
      transition('PAGINATION_CONFIGURED');
    },
    [transition]
  );

  // Start saving
  const startSaving = useCallback(() => {
    transition('SAVE_CLICKED');
  }, [transition]);

  // Complete save
  const completeSave = useCallback(() => {
    transition('SAVE_SUCCESS');
  }, [transition]);

  // Reset flow
  const reset = useCallback(() => {
    transition('RESET');
    setDismissActions([]);
    setDetectedProduct(null);
    setProductConfidence(0);
    setProductScreenshot(null);
    setDetectedPagination(null);
    setPaginationCandidates([]);
    setIsPaginationDetecting(false);
    setDemoProgress({
      productCount: 0,
      productDelta: 0,
      accumulatedScroll: 0,
      wrongNavWarning: false,
      shouldAutoComplete: false,
    });
    setDemoResult(null);
    itemSelectorRef.current = undefined;
  }, [transition]);

  return {
    state,
    showOverlay,
    overlayType,
    dismissActions,
    detectedProduct,
    productConfidence,
    productScreenshot,
    detectedPagination,
    paginationCandidates,
    isPaginationDetecting,
    // Pagination demo data
    demoProgress,
    demoResult,
    transition,
    handlePopupConfirm,
    handleProductConfirm,
    handleDemoConfirm,
    startBrowser,
    addDismissAction,
    finishDismissRecording,
    selectPaginationCandidate,
    setPaginationManual,
    proceedToPaginationDemo,
    retryDemo,
    skipPagination,
    startSaving,
    completeSave,
    reset,
    currentStepNumber: STEP_NUMBERS[state],
    currentStepTitle: STEP_TITLES[state],
  };
}
