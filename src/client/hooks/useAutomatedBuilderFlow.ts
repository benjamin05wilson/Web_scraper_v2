// ============================================================================
// AUTOMATED BUILDER FLOW HOOK - State machine for automated workflow
// ============================================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ElementSelector, PaginationCandidate, WSMessageType } from '../../shared/types';

// Workflow states - PRODUCTS FIRST, then PAGINATION
export type AutomatedBuilderState =
  | 'IDLE'
  | 'LAUNCHING_BROWSER'
  | 'CAPTCHA_CHECKING'    // Checking for captcha presence after navigation
  | 'CAPTCHA_WAITING'     // User solving captcha in browser
  | 'POPUP_DETECTION'
  | 'POPUP_RECORDING'
  | 'AUTO_DETECTING_PRODUCT'
  | 'PRODUCT_CONFIRMATION'
  | 'MANUAL_PRODUCT_SELECT'
  | 'GENERATING_WIZARD'       // Generating wizard steps for SALE products
  | 'FIELD_CONFIRMATION'      // User confirming each field in wizard (sale products)
  | 'LABELING'                // Fallback manual labeling (if wizard cancelled)
  | 'CHECKING_NON_SALE'       // NEW: Check if non-sale products exist on current page
  | 'NON_SALE_WIZARD_IMMEDIATE'   // NEW: Non-sale wizard shown BEFORE pagination (if non-sale exists now)
  | 'PAGINATION_DEMO'         // User demonstrating pagination (scroll or click)
  | 'PAGINATION_DEMO_SUCCESS' // Demo succeeded, show result for confirmation
  | 'PAGINATION_MANUAL'       // Manual fallback
  | 'GENERATING_NON_SALE_WIZARD'  // Generating wizard steps for NON-SALE products (after pagination)
  | 'NON_SALE_FIELD_CONFIRMATION' // User confirming fields for non-sale products
  | 'FINAL_CONFIG'
  | 'SAVING'
  | 'COMPLETE';

// Overlay types
export type OverlayType = 'captcha' | 'popup' | 'product' | 'field_wizard' | 'pagination_demo' | 'pagination_demo_success' | null;

// Wizard step type (matches FieldConfirmationWizard)
export interface WizardStep {
  field: 'Title' | 'RRP' | 'Sale Price' | 'URL' | 'Image';
  question: string;
  screenshot: string;
  extractedValue: string;
  selector: string;
  elementBounds: { x: number; y: number; width: number; height: number };
  cardType: 'withSale' | 'withoutSale';
}

// Confirmed field from wizard
export interface ConfirmedField {
  field: 'Title' | 'RRP' | 'Sale Price' | 'URL' | 'Image';
  selector: string;
  value: string;
  confirmed: boolean;
}

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
  clickText?: string;
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
  lastClickedText?: string;
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

  // Captcha data
  captchaType: string;

  // Wizard data (sale products)
  wizardSteps: WizardStep[];
  confirmedFields: ConfirmedField[];
  wizardError: string | null;

  // Non-sale wizard data
  nonSaleWizardSteps: WizardStep[];
  nonSaleConfirmedFields: ConfirmedField[];
  nonSaleWizardError: string | null;

  // NEW: Additional state data
  autoDetectedFields: Array<{ field: string; selector: string; value: string }>;
  productTypeCounts: { withSale: number; withoutSale: number };
  nonSaleCompletedBefore: boolean;

  // State transitions
  transition: (event: BuilderEvent) => void;

  // Overlay handlers
  handlePopupConfirm: (allClosed: boolean) => void;
  handleProductConfirm: (correct: boolean) => void;
  handleDemoConfirm: (confirmed: boolean) => void;

  // Wizard handlers (sale products)
  handleWizardComplete: (fields: ConfirmedField[]) => void;
  handleWizardCancel: () => void;
  handleWizardPickDifferent: (field: string) => void;

  // Non-sale wizard handlers
  handleNonSaleWizardComplete: (fields: ConfirmedField[]) => void;
  handleNonSaleWizardSkip: () => void;

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
  | 'CAPTCHA_DETECTED'    // Captcha found on page
  | 'CAPTCHA_NONE'        // No captcha present
  | 'CAPTCHA_SOLVED'      // User solved captcha
  | 'POPUP_YES'
  | 'POPUP_NO'
  | 'DONE_RECORDING'
  | 'PRODUCT_DETECTED'
  | 'PRODUCT_YES'
  | 'PRODUCT_NO'
  | 'MANUAL_SELECTED'
  | 'WIZARD_STEPS_READY'     // Wizard steps generated successfully
  | 'WIZARD_STEPS_FAILED'    // Failed to generate wizard steps
  | 'WIZARD_COMPLETED'       // User completed the wizard
  | 'WIZARD_CANCELLED'       // User cancelled the wizard
  | 'WIZARD_PICK_DIFFERENT'  // User wants to manually pick a field
  | 'LABELS_APPLIED'
  | 'NON_SALE_EXISTS'        // NEW: Non-sale products found on current page (before pagination)
  | 'NO_NON_SALE'            // NEW: No non-sale products on current page
  | 'IMMEDIATE_NON_SALE_READY'    // NEW: Immediate non-sale wizard steps generated
  | 'IMMEDIATE_NON_SALE_COMPLETED' // NEW: User completed immediate non-sale wizard
  | 'DEMO_STARTED'           // Demo mode activated
  | 'DEMO_SUCCESS'           // Demo completed with product increase
  | 'DEMO_FAILED'            // Demo completed but no product increase
  | 'DEMO_CONFIRMED'         // User confirmed demo result
  | 'DEMO_RETRY'             // User wants to retry demo
  | 'PAGINATION_CONFIGURED'  // Manual pagination configured
  | 'PAGINATION_SKIPPED'     // User skipped pagination
  | 'NON_SALE_WIZARD_READY'  // Non-sale wizard steps generated (after pagination)
  | 'NON_SALE_WIZARD_FAILED' // Failed to generate non-sale wizard steps
  | 'NON_SALE_WIZARD_COMPLETED' // User completed non-sale wizard
  | 'NON_SALE_WIZARD_SKIPPED'   // User skipped non-sale wizard
  | 'SAVE_CLICKED'
  | 'SAVE_SUCCESS'
  | 'RESET';

// New flow: Products FIRST, then check Non-Sale, then Pagination Demo
const STEP_TITLES: Record<AutomatedBuilderState, string> = {
  IDLE: 'Enter URL',
  LAUNCHING_BROWSER: 'Opening Browser',
  CAPTCHA_CHECKING: 'Checking for CAPTCHA',
  CAPTCHA_WAITING: 'Solve CAPTCHA',
  POPUP_DETECTION: 'Checking Popups',
  POPUP_RECORDING: 'Recording Popup Dismissals',
  AUTO_DETECTING_PRODUCT: 'Detecting Product Card',
  PRODUCT_CONFIRMATION: 'Confirm Product Card',
  MANUAL_PRODUCT_SELECT: 'Select Product Card',
  GENERATING_WIZARD: 'Preparing Sale Product Wizard',
  FIELD_CONFIRMATION: 'Confirm Sale Product Fields',
  LABELING: 'Label Product Data',
  CHECKING_NON_SALE: 'Checking for Non-Sale Products',           // NEW
  NON_SALE_WIZARD_IMMEDIATE: 'Confirm Non-Sale Product Fields',  // NEW
  PAGINATION_DEMO: 'Demonstrate Pagination',
  PAGINATION_DEMO_SUCCESS: 'Confirm Pagination Method',
  PAGINATION_MANUAL: 'Configure Pagination',
  GENERATING_NON_SALE_WIZARD: 'Preparing Non-Sale Wizard',
  NON_SALE_FIELD_CONFIRMATION: 'Confirm Non-Sale Product Fields',
  FINAL_CONFIG: 'Final Configuration',
  SAVING: 'Saving Config',
  COMPLETE: 'Complete',
};

// Step order: CAPTCHA -> Popups -> Products -> Sale Wizard -> Check Non-Sale -> Pagination Demo -> Config
const STEP_NUMBERS: Record<AutomatedBuilderState, number> = {
  IDLE: 1,
  LAUNCHING_BROWSER: 1,
  CAPTCHA_CHECKING: 2,
  CAPTCHA_WAITING: 2,
  POPUP_DETECTION: 3,
  POPUP_RECORDING: 3,
  AUTO_DETECTING_PRODUCT: 4,
  PRODUCT_CONFIRMATION: 4,
  MANUAL_PRODUCT_SELECT: 4,
  GENERATING_WIZARD: 5,
  FIELD_CONFIRMATION: 5,
  LABELING: 5,
  CHECKING_NON_SALE: 6,           // NEW
  NON_SALE_WIZARD_IMMEDIATE: 6,   // NEW - same step as checking
  PAGINATION_DEMO: 7,
  PAGINATION_DEMO_SUCCESS: 7,
  PAGINATION_MANUAL: 7,
  GENERATING_NON_SALE_WIZARD: 8,
  NON_SALE_FIELD_CONFIRMATION: 8,
  FINAL_CONFIG: 9,
  SAVING: 9,
  COMPLETE: 9,
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

  // Captcha state
  const [captchaType, setCaptchaType] = useState<string>('none');

  // Field confirmation wizard state (sale products)
  const [wizardSteps, setWizardSteps] = useState<WizardStep[]>([]);
  const [confirmedFields, setConfirmedFields] = useState<ConfirmedField[]>([]);
  const [wizardError, setWizardError] = useState<string | null>(null);

  // Non-sale wizard state (can be before OR after pagination)
  const [nonSaleWizardSteps, setNonSaleWizardSteps] = useState<WizardStep[]>([]);
  const [nonSaleConfirmedFields, setNonSaleConfirmedFields] = useState<ConfirmedField[]>([]);
  const [nonSaleWizardError, setNonSaleWizardError] = useState<string | null>(null);

  // NEW: Track if non-sale wizard was completed before pagination (to skip it after)
  const [nonSaleCompletedBefore, setNonSaleCompletedBefore] = useState(false);
  // NEW: Track product type counts from wizard step generation
  const [productTypeCounts, setProductTypeCounts] = useState<{ withSale: number; withoutSale: number }>({ withSale: 0, withoutSale: 0 });
  // NEW: Track auto-detected fields (like RRP for sale products)
  const [autoDetectedFields, setAutoDetectedFields] = useState<Array<{ field: string; selector: string; value: string }>>([]);

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
          if (event === 'SESSION_CREATED') return 'CAPTCHA_CHECKING';
          break;
        case 'CAPTCHA_CHECKING':
          if (event === 'CAPTCHA_NONE') return 'POPUP_DETECTION';
          if (event === 'CAPTCHA_DETECTED') return 'CAPTCHA_WAITING';
          break;
        case 'CAPTCHA_WAITING':
          if (event === 'CAPTCHA_SOLVED') return 'POPUP_DETECTION';
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
          // After product confirmation, go to wizard to confirm fields
          if (event === 'PRODUCT_YES') return 'GENERATING_WIZARD';
          if (event === 'PRODUCT_NO') return 'MANUAL_PRODUCT_SELECT';
          break;
        case 'MANUAL_PRODUCT_SELECT':
          // After manual selection, also go to wizard
          if (event === 'MANUAL_SELECTED') return 'GENERATING_WIZARD';
          break;
        case 'GENERATING_WIZARD':
          // Wizard steps are being generated
          if (event === 'WIZARD_STEPS_READY') return 'FIELD_CONFIRMATION';
          if (event === 'WIZARD_STEPS_FAILED') return 'LABELING'; // Fallback to manual labeling
          break;
        case 'FIELD_CONFIRMATION':
          // User is confirming fields in the wizard
          // NEW: After sale wizard, check for non-sale products BEFORE pagination
          if (event === 'WIZARD_COMPLETED') return 'CHECKING_NON_SALE';
          if (event === 'WIZARD_CANCELLED') return 'LABELING'; // Allow manual adjustment
          if (event === 'WIZARD_PICK_DIFFERENT') return 'LABELING'; // Manual pick for specific field
          break;
        case 'LABELING':
          // After labeling, check for non-sale products (same as wizard completed)
          if (event === 'LABELS_APPLIED') return 'CHECKING_NON_SALE';
          break;
        case 'CHECKING_NON_SALE':
          // NEW: Check if non-sale products exist on current page
          if (event === 'NON_SALE_EXISTS') return 'NON_SALE_WIZARD_IMMEDIATE'; // Show non-sale wizard NOW
          if (event === 'NO_NON_SALE') return 'PAGINATION_DEMO'; // No non-sale, go to pagination
          break;
        case 'NON_SALE_WIZARD_IMMEDIATE':
          // NEW: Non-sale wizard shown BEFORE pagination (full wizard: all fields)
          if (event === 'IMMEDIATE_NON_SALE_READY') return 'NON_SALE_WIZARD_IMMEDIATE'; // Stay to show wizard
          if (event === 'IMMEDIATE_NON_SALE_COMPLETED') return 'PAGINATION_DEMO'; // Go to pagination after non-sale
          if (event === 'NON_SALE_WIZARD_SKIPPED') return 'PAGINATION_DEMO'; // Skip to pagination
          break;
        case 'PAGINATION_DEMO':
          // Demo mode - user scrolls or clicks to show pagination
          if (event === 'DEMO_SUCCESS') return 'PAGINATION_DEMO_SUCCESS';
          if (event === 'DEMO_FAILED') return 'PAGINATION_DEMO'; // Stay in demo to retry
          if (event === 'PAGINATION_SKIPPED') return 'FINAL_CONFIG';
          break;
        case 'PAGINATION_DEMO_SUCCESS':
          // User saw demo result and can confirm or retry
          // After pagination confirmed, go to non-sale wizard
          if (event === 'DEMO_CONFIRMED') return 'GENERATING_NON_SALE_WIZARD';
          if (event === 'DEMO_RETRY') return 'PAGINATION_DEMO';
          if (event === 'PAGINATION_SKIPPED') return 'GENERATING_NON_SALE_WIZARD';
          break;
        case 'PAGINATION_MANUAL':
          if (event === 'PAGINATION_CONFIGURED') return 'GENERATING_NON_SALE_WIZARD';
          if (event === 'PAGINATION_SKIPPED') return 'GENERATING_NON_SALE_WIZARD';
          break;
        case 'GENERATING_NON_SALE_WIZARD':
          // Non-sale wizard steps are being generated
          if (event === 'NON_SALE_WIZARD_READY') return 'NON_SALE_FIELD_CONFIRMATION';
          if (event === 'NON_SALE_WIZARD_FAILED') return 'FINAL_CONFIG'; // Skip to final config if no non-sale products
          break;
        case 'NON_SALE_FIELD_CONFIRMATION':
          // User is confirming non-sale product fields
          if (event === 'NON_SALE_WIZARD_COMPLETED') return 'FINAL_CONFIG';
          if (event === 'NON_SALE_WIZARD_SKIPPED') return 'FINAL_CONFIG';
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

  // Auto-trigger captcha check when entering CAPTCHA_CHECKING state
  useEffect(() => {
    if (state === 'CAPTCHA_CHECKING' && sessionId) {
      console.log('[AutomatedFlow] Triggering captcha check...');
      send('captcha:check', {}, sessionId);
    }
  }, [state, sessionId, send]);

  // Start polling when entering CAPTCHA_WAITING state
  useEffect(() => {
    if (state === 'CAPTCHA_WAITING' && sessionId) {
      console.log('[AutomatedFlow] Starting captcha polling...');
      send('captcha:startPolling', { timeoutMs: 120000 }, sessionId);
    }
  }, [state, sessionId, send]);

  // Subscribe to captcha messages
  useEffect(() => {
    const unsubStatus = subscribe('captcha:status', (msg) => {
      console.log('[AutomatedFlow] Captcha status:', msg.payload);
      const { hasChallenge, challengeType, isRetry } = msg.payload as {
        hasChallenge: boolean;
        challengeType: string;
        isRetry?: boolean;
      };

      setCaptchaType(challengeType);

      // Handle retry - captcha appeared during navigation in another state
      if (isRetry && hasChallenge && state !== 'CAPTCHA_CHECKING' && state !== 'CAPTCHA_WAITING') {
        console.log('[AutomatedFlow] Captcha appeared during flow, interrupting...');
        setState('CAPTCHA_WAITING');
        return;
      }

      // Normal detection flow
      if (hasChallenge && challengeType !== 'none') {
        transition('CAPTCHA_DETECTED');
      } else {
        transition('CAPTCHA_NONE');
      }
    });

    const unsubSolved = subscribe('captcha:solved', (msg) => {
      console.log('[AutomatedFlow] Captcha solved:', msg.payload);
      transition('CAPTCHA_SOLVED');
    });

    const unsubTimeout = subscribe('captcha:timeout', (msg) => {
      console.log('[AutomatedFlow] Captcha timeout:', msg.payload);
      // Continue to popup detection even on timeout
      transition('CAPTCHA_SOLVED');
    });

    return () => {
      unsubStatus();
      unsubSolved();
      unsubTimeout();
    };
  }, [subscribe, transition, state]);

  // Show overlay based on state
  useEffect(() => {
    switch (state) {
      case 'CAPTCHA_CHECKING':
        // Quick check, no overlay needed
        setShowOverlay(false);
        setOverlayType(null);
        break;
      case 'CAPTCHA_WAITING':
        setOverlayType('captcha');
        setShowOverlay(true);
        break;
      case 'POPUP_DETECTION':
        setOverlayType('popup');
        setShowOverlay(true);
        break;
      case 'PRODUCT_CONFIRMATION':
        setOverlayType('product');
        setShowOverlay(true);
        break;
      case 'FIELD_CONFIRMATION':
      case 'NON_SALE_FIELD_CONFIRMATION':
      case 'NON_SALE_WIZARD_IMMEDIATE':
        // Wizard has its own overlay component (FieldConfirmationWizard)
        // Don't show AutomatedBuilderOverlay
        setOverlayType(null);
        setShowOverlay(false);
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

  // Auto-trigger wizard step generation when entering GENERATING_WIZARD state
  useEffect(() => {
    if (state === 'GENERATING_WIZARD' && sessionId && detectedProduct?.css) {
      console.log('[AutomatedFlow] Generating wizard steps for:', detectedProduct.css);
      setWizardError(null);
      send('builder:generateWizardSteps', { containerSelector: detectedProduct.css }, sessionId);
    }
  }, [state, sessionId, detectedProduct, send]);

  // Subscribe to wizard step generation result
  useEffect(() => {
    const unsubscribe = subscribe('builder:wizardSteps', (msg) => {
      console.log('[AutomatedFlow] Wizard steps result:', msg.payload);

      if (msg.payload.success && msg.payload.steps?.length > 0) {
        // Log each step's screenshot info for debugging
        msg.payload.steps.forEach((step: any, idx: number) => {
          console.log(`[AutomatedFlow] Step ${idx + 1} (${step.field}): screenshot length = ${step.screenshot?.length || 0}, value = "${step.extractedValue?.substring(0, 30)}..."`);
        });

        // Cast the steps to the correct type
        const steps: WizardStep[] = msg.payload.steps.map((step: any) => ({
          field: step.field as WizardStep['field'],
          question: step.question,
          screenshot: step.screenshot,
          extractedValue: step.extractedValue,
          selector: step.selector,
          elementBounds: step.elementBounds,
          cardType: step.cardType,
        }));
        setWizardSteps(steps);
        setConfirmedFields([]);

        // NEW: Save example counts for later non-sale check
        if (msg.payload.exampleCount) {
          console.log('[AutomatedFlow] Example counts:', msg.payload.exampleCount);
          setProductTypeCounts(msg.payload.exampleCount);
        }

        // NEW: Save auto-detected fields (e.g., RRP from sale products)
        if (msg.payload.autoDetectedFields?.length > 0) {
          console.log('[AutomatedFlow] Auto-detected fields:', msg.payload.autoDetectedFields);
          setAutoDetectedFields(msg.payload.autoDetectedFields);
        }

        transition('WIZARD_STEPS_READY');
      } else {
        console.log('[AutomatedFlow] Wizard steps failed, falling back to manual labeling');
        setWizardError(msg.payload.error || 'Failed to generate wizard steps');
        setWizardSteps([]);
        transition('WIZARD_STEPS_FAILED');
      }
    });

    return unsubscribe;
  }, [subscribe, transition]);

  // NEW: Handle CHECKING_NON_SALE state - check if non-sale products exist
  useEffect(() => {
    if (state === 'CHECKING_NON_SALE') {
      console.log('[AutomatedFlow] Checking for non-sale products:', productTypeCounts);
      if (productTypeCounts.withoutSale > 0) {
        console.log('[AutomatedFlow] Non-sale products exist, showing immediate wizard');
        transition('NON_SALE_EXISTS');
      } else {
        console.log('[AutomatedFlow] No non-sale products, proceeding to pagination');
        transition('NO_NON_SALE');
      }
    }
  }, [state, productTypeCounts, transition]);

  // NEW: Handle NON_SALE_WIZARD_IMMEDIATE state - generate wizard steps with immediateNonSale flag
  useEffect(() => {
    if (state === 'NON_SALE_WIZARD_IMMEDIATE' && sessionId && detectedProduct?.css && nonSaleWizardSteps.length === 0) {
      console.log('[AutomatedFlow] Generating IMMEDIATE non-sale wizard steps for:', detectedProduct.css);
      setNonSaleWizardError(null);
      // Send with phase='nonSale' and immediateNonSale=true for full wizard
      send('builder:generateWizardSteps', { containerSelector: detectedProduct.css, phase: 'nonSale', immediateNonSale: true }, sessionId);
    }
  }, [state, sessionId, detectedProduct, send, nonSaleWizardSteps.length]);

  // Auto-trigger NON-SALE wizard step generation when entering GENERATING_NON_SALE_WIZARD state
  useEffect(() => {
    if (state === 'GENERATING_NON_SALE_WIZARD' && sessionId && detectedProduct?.css) {
      // NEW: If non-sale was already completed before pagination, skip to final config
      if (nonSaleCompletedBefore) {
        console.log('[AutomatedFlow] Non-sale wizard already completed before pagination, skipping to final config');
        transition('NON_SALE_WIZARD_FAILED'); // This will go to FINAL_CONFIG
        return;
      }
      console.log('[AutomatedFlow] Generating NON-SALE wizard steps for:', detectedProduct.css);
      setNonSaleWizardError(null);
      // Send with phase='nonSale' and immediateNonSale=false (RRP only after pagination)
      send('builder:generateWizardSteps', { containerSelector: detectedProduct.css, phase: 'nonSale', immediateNonSale: false }, sessionId);
    }
  }, [state, sessionId, detectedProduct, send, nonSaleCompletedBefore, transition]);

  // Subscribe to non-sale wizard step generation result
  // This handles both immediate (before pagination) and post-pagination cases
  useEffect(() => {
    const unsubscribe = subscribe('builder:nonSaleWizardSteps', (msg) => {
      console.log('[AutomatedFlow] Non-sale wizard steps result:', msg.payload, 'current state:', state);

      if (msg.payload.success && msg.payload.steps?.length > 0) {
        // Log each step's screenshot info for debugging
        msg.payload.steps.forEach((step: any, idx: number) => {
          console.log(`[AutomatedFlow] Non-sale Step ${idx + 1} (${step.field}): screenshot length = ${step.screenshot?.length || 0}, value = "${step.extractedValue?.substring(0, 30)}..."`);
        });

        // Cast the steps to the correct type
        const steps: WizardStep[] = msg.payload.steps.map((step: any) => ({
          field: step.field as WizardStep['field'],
          question: step.question,
          screenshot: step.screenshot,
          extractedValue: step.extractedValue,
          selector: step.selector,
          elementBounds: step.elementBounds,
          cardType: step.cardType,
        }));
        setNonSaleWizardSteps(steps);
        setNonSaleConfirmedFields([]);

        // NEW: Different transitions based on current state
        if (state === 'NON_SALE_WIZARD_IMMEDIATE') {
          // Immediate wizard - steps are ready, stay in this state to show them
          transition('IMMEDIATE_NON_SALE_READY');
        } else {
          // Post-pagination wizard
          transition('NON_SALE_WIZARD_READY');
        }
      } else {
        console.log('[AutomatedFlow] Non-sale wizard steps failed or no non-sale products found');
        setNonSaleWizardError(msg.payload.error || 'No non-sale products found');
        setNonSaleWizardSteps([]);
        transition('NON_SALE_WIZARD_FAILED');
      }
    });

    return unsubscribe;
  }, [subscribe, transition, state]);

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
        lastClickedText: msg.payload.text ?? prev.lastClickedText,
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
        clickText: msg.payload.clickText,
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

  // Wizard completion handler - called when user finishes the wizard
  const handleWizardComplete = useCallback(
    (fields: ConfirmedField[]) => {
      console.log('[AutomatedFlow] Wizard completed with fields:', fields);
      setConfirmedFields(fields);

      // Store the item selector for pagination demo
      const itemSelector = detectedProduct?.css;
      if (itemSelector) {
        itemSelectorRef.current = itemSelector;
      }

      transition('WIZARD_COMPLETED');
    },
    [transition, detectedProduct]
  );

  // Wizard cancel handler - falls back to manual labeling
  const handleWizardCancel = useCallback(() => {
    console.log('[AutomatedFlow] Wizard cancelled, falling back to manual labeling');
    transition('WIZARD_CANCELLED');
  }, [transition]);

  // Wizard pick different handler - user wants to manually pick a specific field
  const handleWizardPickDifferent = useCallback(
    (field: string) => {
      console.log('[AutomatedFlow] User wants to pick different element for:', field);
      // Store which field the user wants to re-pick
      transition('WIZARD_PICK_DIFFERENT');
    },
    [transition]
  );

  // Non-sale wizard completion handler
  // This handles BOTH immediate (before pagination) and post-pagination wizards
  const handleNonSaleWizardComplete = useCallback(
    (fields: ConfirmedField[]) => {
      console.log('[AutomatedFlow] Non-sale wizard completed with fields:', fields, 'current state:', state);
      setNonSaleConfirmedFields(fields);

      // NEW: Check if this is the immediate wizard (before pagination)
      if (state === 'NON_SALE_WIZARD_IMMEDIATE') {
        console.log('[AutomatedFlow] Immediate non-sale wizard completed, marking as done');
        setNonSaleCompletedBefore(true);
        transition('IMMEDIATE_NON_SALE_COMPLETED');
      } else {
        transition('NON_SALE_WIZARD_COMPLETED');
      }
    },
    [transition, state]
  );

  // Non-sale wizard skip handler
  const handleNonSaleWizardSkip = useCallback(() => {
    console.log('[AutomatedFlow] Non-sale wizard skipped');
    transition('NON_SALE_WIZARD_SKIPPED');
  }, [transition]);

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
    setCaptchaType('none');
    // Reset wizard state (sale products)
    setWizardSteps([]);
    setConfirmedFields([]);
    setWizardError(null);
    // Reset non-sale wizard state
    setNonSaleWizardSteps([]);
    setNonSaleConfirmedFields([]);
    setNonSaleWizardError(null);
    // NEW: Reset new state tracking
    setNonSaleCompletedBefore(false);
    setProductTypeCounts({ withSale: 0, withoutSale: 0 });
    setAutoDetectedFields([]);
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
    // Captcha data
    captchaType,
    // Wizard data (sale products)
    wizardSteps,
    confirmedFields,
    wizardError,
    // Non-sale wizard data
    nonSaleWizardSteps,
    nonSaleConfirmedFields,
    nonSaleWizardError,
    // NEW: Additional state data
    autoDetectedFields,
    productTypeCounts,
    nonSaleCompletedBefore,
    transition,
    handlePopupConfirm,
    handleProductConfirm,
    handleDemoConfirm,
    // Wizard handlers (sale products)
    handleWizardComplete,
    handleWizardCancel,
    handleWizardPickDifferent,
    // Non-sale wizard handlers
    handleNonSaleWizardComplete,
    handleNonSaleWizardSkip,
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
