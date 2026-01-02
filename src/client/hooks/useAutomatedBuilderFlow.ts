// ============================================================================
// AUTOMATED BUILDER FLOW HOOK - State machine for automated workflow
// ============================================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ElementSelector, PaginationCandidate, WSMessageType } from '../../shared/types';

// Workflow states
export type AutomatedBuilderState =
  | 'IDLE'
  | 'LAUNCHING_BROWSER'
  | 'POPUP_DETECTION'
  | 'POPUP_RECORDING'
  | 'AUTO_DETECTING_PRODUCT'
  | 'PRODUCT_CONFIRMATION'
  | 'MANUAL_PRODUCT_SELECT'
  | 'LABELING'
  | 'PAGINATION_DETECTING'  // New state: actively detecting pagination
  | 'PAGINATION_CONFIRMATION'
  | 'PAGINATION_MANUAL'
  | 'FINAL_CONFIG'
  | 'SAVING'
  | 'COMPLETE';

// Overlay types
export type OverlayType = 'popup' | 'product' | 'pagination' | 'pagination_detecting' | null;

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

  // State transitions
  transition: (event: BuilderEvent) => void;

  // Overlay handlers
  handlePopupConfirm: (allClosed: boolean) => void;
  handleProductConfirm: (correct: boolean) => void;
  handlePaginationConfirm: (correct: boolean) => void;

  // Action handlers
  startBrowser: () => void;
  addDismissAction: (action: DismissAction) => void;
  finishDismissRecording: () => void;
  selectPaginationCandidate: (candidate: PaginationCandidate) => void;
  setPaginationManual: (pattern: PaginationPattern) => void;
  proceedToFinalConfig: (itemSelector?: string) => void;
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
  | 'PAGINATION_DETECTED'
  | 'PAGINATION_YES'
  | 'PAGINATION_NO'
  | 'PAGINATION_CONFIGURED'
  | 'SAVE_CLICKED'
  | 'SAVE_SUCCESS'
  | 'RESET';

const STEP_TITLES: Record<AutomatedBuilderState, string> = {
  IDLE: 'Enter URL',
  LAUNCHING_BROWSER: 'Opening Browser',
  POPUP_DETECTION: 'Checking Popups',
  POPUP_RECORDING: 'Recording Popup Dismissals',
  PAGINATION_DETECTING: 'Detecting Pagination',
  PAGINATION_CONFIRMATION: 'Confirm Pagination',
  PAGINATION_MANUAL: 'Configure Pagination',
  AUTO_DETECTING_PRODUCT: 'Detecting Product Card',
  PRODUCT_CONFIRMATION: 'Confirm Product Card',
  MANUAL_PRODUCT_SELECT: 'Select Product Card',
  LABELING: 'Label Product Data',
  FINAL_CONFIG: 'Final Configuration',
  SAVING: 'Saving Config',
  COMPLETE: 'Complete',
};

const STEP_NUMBERS: Record<AutomatedBuilderState, number> = {
  IDLE: 1,
  LAUNCHING_BROWSER: 1,
  POPUP_DETECTION: 2,
  POPUP_RECORDING: 2,
  PAGINATION_DETECTING: 3,
  PAGINATION_CONFIRMATION: 3,
  PAGINATION_MANUAL: 3,
  AUTO_DETECTING_PRODUCT: 4,
  PRODUCT_CONFIRMATION: 4,
  MANUAL_PRODUCT_SELECT: 4,
  LABELING: 5,
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
    // connected is available if needed for future use
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

  // Track if we've started pagination detection
  const paginationStartedRef = useRef(false);
  // Track if labeling is complete (waiting for pagination)
  const labelingCompleteRef = useRef(false);

  // Timer ref for popup detection delay
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // State transition logic
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
          // After popups handled, go to pagination detection first
          if (event === 'POPUP_YES') return 'PAGINATION_DETECTING';
          if (event === 'POPUP_NO') return 'POPUP_RECORDING';
          break;
        case 'POPUP_RECORDING':
          if (event === 'DONE_RECORDING') return 'POPUP_DETECTION';
          break;
        case 'PAGINATION_DETECTING':
          if (event === 'PAGINATION_DETECTED') {
            return 'PAGINATION_CONFIRMATION';
          }
          break;
        case 'PAGINATION_CONFIRMATION':
          // After pagination confirmed, go to product detection
          if (event === 'PAGINATION_YES') return 'AUTO_DETECTING_PRODUCT';
          if (event === 'PAGINATION_NO') return 'PAGINATION_MANUAL';
          break;
        case 'PAGINATION_MANUAL':
          // After manual pagination config, go to product detection
          if (event === 'PAGINATION_CONFIGURED') return 'AUTO_DETECTING_PRODUCT';
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
          // After labeling, go directly to final config
          if (event === 'LABELS_APPLIED') return 'FINAL_CONFIG';
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
    // Trigger when session becomes ready (page loaded)
    if (state === 'LAUNCHING_BROWSER' && sessionStatus === 'ready' && sessionId) {
      // Wait 3 seconds for popups to naturally appear, then auto-close them
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
        // Store any dismiss actions that were recorded
        if (msg.payload.dismissActions && msg.payload.dismissActions.length > 0) {
          setDismissActions(msg.payload.dismissActions);
        }
      }

      // Always show the popup confirmation overlay so user can verify
      // They can click Yes if all popups are closed, or No to manually close more
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
      case 'PAGINATION_DETECTING':
        setOverlayType('pagination_detecting');
        setShowOverlay(true);
        break;
      case 'PAGINATION_CONFIRMATION':
        setOverlayType('pagination');
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
          // Even on failure, show confirmation (user can select manually)
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

  // Subscribe to pagination detection result
  useEffect(() => {
    const unsubscribe = subscribe('pagination:result', (msg) => {
      console.log('[AutomatedFlow] Pagination result received:', msg.payload);
      setIsPaginationDetecting(false);

      if (msg.payload.success) {
        const { candidates, method, pagination } = msg.payload;

        if (candidates && candidates.length > 0) {
          setPaginationCandidates(candidates);
        }

        // Use the smart detection result directly
        if (pagination) {
          console.log('[AutomatedFlow] Smart detection found method:', method);
          const paginationPattern: PaginationPattern = {
            type: pagination.type,
            selector: pagination.selector || undefined,
            scrollPositions: pagination.scrollPositions,
            productsPerPage: pagination.productsPerPage,
            max_pages: 10,
          };
          // Include offset config if detected (for URL-based offset pagination)
          if (pagination.offset) {
            paginationPattern.offset = {
              key: pagination.offset.key,
              start: pagination.offset.start,
              increment: pagination.offset.increment,
            };
            console.log(`[AutomatedFlow] Offset pattern detected: ${pagination.offset.key}=${pagination.offset.start} (increment: ${pagination.offset.increment})`);
          }
          setDetectedPagination(paginationPattern);
        } else {
          console.log('[AutomatedFlow] No pagination method found');
          setDetectedPagination(null);
        }
      }

      // Transition to pagination confirmation when detection is complete
      if (state === 'PAGINATION_DETECTING') {
        console.log('[AutomatedFlow] Detection complete, transitioning to confirmation');
        transition('PAGINATION_DETECTED');
      }
    });

    return unsubscribe;
  }, [subscribe, state, transition]);

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

  // Store item selector for pagination detection
  const itemSelectorRef = useRef<string | undefined>(undefined);

  // Auto-trigger pagination detection when entering PAGINATION_DETECTING state
  // Note: pagination now runs BEFORE product detection, so no item selector available yet
  useEffect(() => {
    if (state === 'PAGINATION_DETECTING' && !isPaginationDetecting && sessionId) {
      console.log('[AutomatedFlow] Starting pagination detection (before product card selection)');
      setIsPaginationDetecting(true);
      // No item selector yet since pagination runs before product detection
      send('pagination:autoStart', { itemSelector: undefined }, sessionId);
    }
  }, [state, isPaginationDetecting, sessionId, send]);

  // Called when labels are applied - now goes directly to final config
  const proceedToFinalConfig = useCallback((itemSelector?: string) => {
    console.log('[AutomatedFlow] Labels applied, proceeding to final config');
    itemSelectorRef.current = itemSelector;
    transition('LABELS_APPLIED');
  }, [transition]);

  // Pagination confirmation handlers
  const handlePaginationConfirm = useCallback(
    (correct: boolean) => {
      if (correct) {
        transition('PAGINATION_YES');
      } else {
        transition('PAGINATION_NO');
      }
    },
    [transition]
  );

  // Select a pagination candidate
  const selectPaginationCandidate = useCallback((candidate: PaginationCandidate) => {
    // Map PaginationCandidate type to PaginationPattern type
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
    paginationStartedRef.current = false;
    labelingCompleteRef.current = false;
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
    transition,
    handlePopupConfirm,
    handleProductConfirm,
    handlePaginationConfirm,
    startBrowser,
    addDismissAction,
    finishDismissRecording,
    selectPaginationCandidate,
    setPaginationManual,
    proceedToFinalConfig,
    startSaving,
    completeSave,
    reset,
    currentStepNumber: STEP_NUMBERS[state],
    currentStepTitle: STEP_TITLES[state],
  };
}
