import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useBrowserSession } from '../../hooks/useBrowserSession';
import { useAutomatedBuilderFlow, ConfirmedField } from '../../hooks/useAutomatedBuilderFlow';
// ExtractedContentLabeler removed - using wizard-based flow instead
import { PopupDetectionPanel } from './PopupDetectionPanel';
import { AutomatedBuilderOverlay } from './AutomatedBuilderOverlay';
import { SelectedDataSummary } from './SelectedDataSummary';
import { PaginationDetector } from './PaginationDetector';
import { createLogEntry, LogEntry } from './ActivityLog';
import { PriceFormatModal } from './PriceFormatModal';
import { CountrySelect } from '../common/CountrySelect';
import { StatusIndicator } from '../common/StatusIndicator';
import { FieldConfirmationWizard, WizardStep } from './FieldConfirmationWizard';
import type { WSMessageType, NetworkExtractionConfig } from '../../../shared/types';

interface SelectedItem {
  text?: string;
  href?: string;
  src?: string;
  selector?: string;
  selection_id?: string;
  tagName?: string;
}

interface ProductSelectors {
  Title: SelectedItem[];
  Price: SelectedItem[];
  URL: SelectedItem[];
  Image: SelectedItem[];
}

interface SelectedData {
  saleProduct: ProductSelectors;
  nonSaleProduct: ProductSelectors;
  NextPage: SelectedItem[];  // Shared - pagination is the same for all products
}

interface ExtractedItem {
  type: 'text' | 'link' | 'image';
  value: string;
  selector: string;
  displayText: string;
  tagName?: string;
}

interface PriceFormat {
  multiplier: number;
  remove_decimals: boolean;
}

// Get the WebSocket URL - use wss:// for HTTPS, ws:// for HTTP
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

export function BuilderPage() {
  // WebSocket connection
  const { connected, send, subscribe } = useWebSocket({
    url: WS_URL,
    onOpen: () => addLog('Connected to server', 'success'),
    onClose: () => addLog('Disconnected from server'),
    onError: () => addLog('Connection error', 'error'),
  });

  // Browser session
  const session = useBrowserSession({ send, subscribe, connected });

  // Destructure stable references from session to avoid infinite loops in effects
  const {
    extractedContent,
    selectedElement,
    extractContainerContent,
    sessionStatus,
    selectionMode,
    sessionId,
    toggleSelectionMode,
    autoDetectProduct,
    isAutoDetecting,
  } = session;

  // Automated builder flow state machine
  const flow = useAutomatedBuilderFlow({
    sessionId,
    sessionStatus,
    send,
    subscribe,
    connected,
    autoDetectProduct,
    isAutoDetecting,
    selectedElement,
  });

  // URL and browser state
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'active' | 'loading' | 'error'>('idle');
  const [statusText, setStatusText] = useState('Ready to start');
  // Real Chrome mode is now always enabled - no user toggle needed

  // Frame state for browser view
  const [frameData, setFrameData] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const browserContainerRef = useRef<HTMLDivElement>(null);

  // Mode state
  const [modeBadge, setModeBadge] = useState<'Browse' | 'SELECTING' | 'DISMISS'>('Browse');

  // Container selector state
  const [containerSelector, setContainerSelector] = useState<string>('');
  const lastExtractedSelectorRef = useRef<string>('');

  // Selection state - separate sections for sale and non-sale products
  const [selectedData, setSelectedData] = useState<SelectedData>({
    saleProduct: {
      Title: [],
      Price: [],
      URL: [],
      Image: [],
    },
    nonSaleProduct: {
      Title: [],
      Price: [],
      URL: [],
      Image: [],
    },
    NextPage: [],
  });
  const [dismissMode, setDismissMode] = useState(false);

  // Form state
  const [country, setCountry] = useState('');
  const [competitorType, setCompetitorType] = useState<'local' | 'global'>('local');
  const [suggestedConfigName, setSuggestedConfigName] = useState('');


  // Read URL query params (from batch page "Build" button)
  const [searchParams] = useSearchParams();

  // Activity log (logEntries used by setLogEntries, kept for future activity display)
  const [, setLogEntries] = useState<LogEntry[]>([]);

  // Price format modal
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [samplePrice, setSamplePrice] = useState('');
  const [pendingSave, setPendingSave] = useState<{ filename: string } | null>(null);

  // Network capture state (for virtual scroll / XHR-based sites)
  const [networkExtractionConfig] = useState<NetworkExtractionConfig | null>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogEntries((prev) => [...prev, createLogEntry(message, type)]);
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
  }, []);

  // Initialize URL, country, and suggested name from query params on mount
  useEffect(() => {
    const urlParam = searchParams.get('url');
    const countryParam = searchParams.get('country');
    const nameParam = searchParams.get('name');
    if (urlParam && !url) {
      setUrl(urlParam);
      addLog(`Pre-filled URL from batch: ${urlParam}`, 'info');
    }
    if (countryParam && !country) {
      setCountry(countryParam);
      addLog(`Pre-filled country: ${countryParam}`, 'info');
    }
    if (nameParam && !suggestedConfigName) {
      setSuggestedConfigName(nameParam);
      addLog(`Suggested config name: ${nameParam}`, 'info');
    }
  }, [searchParams, addLog]); // Only run on mount/param change

  // Subscribe to binary frames
  useEffect(() => {
    const unsubscribe = subscribe('binary' as any, (msg) => {
      if (msg.payload instanceof Blob) {
        const blobUrl = URL.createObjectURL(msg.payload);
        setFrameData(blobUrl);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  // Cleanup old blob URLs
  useEffect(() => {
    return () => {
      if (frameData) {
        URL.revokeObjectURL(frameData);
      }
    };
  }, [frameData]);

  // Listen for extracted content from session
  // Max items threshold - if more than this, likely selected the grid not a single product
  // Increased from 15 to 30 to accommodate modern sites with complex product cards
  const MAX_EXTRACTED_ITEMS = 50;

  useEffect(() => {
    // Process when extractedContent changes and has items
    // This is used by the wizard flow now - just log for debugging
    if (extractedContent && extractedContent.length > 0) {
      console.log('[BuilderPage] Extracted content received:', extractedContent.length, 'items');
      console.log('[BuilderPage] Item types:', extractedContent.map(i => `${i.type}:${i.value?.substring(0, 50)}`));

      // Check if too many items (likely selected the grid instead of a product)
      if (extractedContent.length > MAX_EXTRACTED_ITEMS) {
        addLog(
          `Too many items (${extractedContent.length}) - likely selected the product grid. Try clicking directly on a single product card.`,
          'error'
        );
        // Clear the selector ref so user can try again
        lastExtractedSelectorRef.current = '';
        return;
      }

      addLog(`Extracted ${extractedContent.length} items from container`, 'success');
    }
  }, [extractedContent, addLog]);

  // Update status based on session
  useEffect(() => {
    if (sessionStatus === 'ready' || sessionStatus === 'streaming') {
      setStatus('active');
      setStatusText('Browser ready');
    } else if (sessionStatus === 'connecting') {
      setStatus('loading');
      setStatusText('Opening browser...');
    } else if (sessionStatus === 'disconnected') {
      setStatus('idle');
      setStatusText('Ready to start');
    }
  }, [sessionStatus]);

  // Update mode badge based on flow state
  useEffect(() => {
    if (flow.state === 'POPUP_RECORDING' || dismissMode) {
      setModeBadge('DISMISS');
    } else if (flow.state === 'MANUAL_PRODUCT_SELECT' || selectionMode) {
      setModeBadge('SELECTING');
    } else {
      setModeBadge('Browse');
    }
  }, [flow.state, selectionMode, dismissMode]);

  // Sync dismiss mode with flow state
  useEffect(() => {
    if (flow.state === 'POPUP_RECORDING') {
      setDismissMode(true);
    } else if (dismissMode && flow.state !== 'POPUP_DETECTION') {
      // Turn off dismiss mode when leaving popup-related states
      setDismissMode(false);
    }
  }, [flow.state, dismissMode]);

  // Enable selection mode when in manual product select state
  useEffect(() => {
    if (flow.state === 'MANUAL_PRODUCT_SELECT' && !selectionMode) {
      toggleSelectionMode();
    }
  }, [flow.state, selectionMode, toggleSelectionMode]);

  // Open browser
  const handleOpenBrowser = useCallback(() => {
    if (!url) {
      addLog('Please enter a URL first', 'error');
      return;
    }

    if (!connected) {
      addLog('Not connected to server', 'error');
      return;
    }

    // Calculate viewport based on the browser view container size
    let viewportWidth = 1280;
    let viewportHeight = 720;
    if (browserContainerRef.current) {
      const rect = browserContainerRef.current.getBoundingClientRect();
      viewportWidth = Math.round(rect.width) || 1280;
      viewportHeight = Math.round(rect.height) || 720;
    }

    addLog('Connecting to Real Chrome...');
    flow.startBrowser();
    session.createSession({
      url,
      viewport: { width: viewportWidth, height: viewportHeight },
      useRealChrome: true, // Always use Real Chrome
    });

    setTimeout(() => {
      if (sessionId) {
        send('webrtc:offer', {}, sessionId);
      }
    }, 1000);
  }, [url, connected, session, send, addLog, flow, sessionId]);

  // Close browser
  const handleCloseBrowser = useCallback(() => {
    session.destroySession();
    flow.reset();
    setFrameData(null);
    setDismissMode(false);
    setModeBadge('Browse');
    setSelectedData({
      saleProduct: { Title: [], Price: [], URL: [], Image: [] },
      nonSaleProduct: { Title: [], Price: [], URL: [], Image: [] },
      NextPage: [],
    });
    setExtractedItems([]);
    setContainerSelector('');
    setShowLabeler(false);
    setStatus('idle');
    setStatusText('Ready to start');
    addLog('Browser closed. Selections cleared.');
  }, [session, addLog, flow]);

  // Request video stream when session is ready
  useEffect(() => {
    if (sessionId && sessionStatus === 'ready') {
      send('webrtc:offer', {}, sessionId);
    }
  }, [sessionId, sessionStatus, send]);

  // Handle click on browser frame
  const handleFrameClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (!imgRef.current || !sessionId) return;

      const rect = imgRef.current.getBoundingClientRect();
      const scaleX = imgRef.current.naturalWidth / rect.width;
      const scaleY = imgRef.current.naturalHeight / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      send('input:mouse', { type: 'click', x, y, button: 'left' }, sessionId);

      // Record dismiss action if in popup recording mode
      if (flow.state === 'POPUP_RECORDING') {
        // The click will be recorded by the server's InteractionRecorder
        // We also track it locally in the flow state
        flow.addDismissAction({
          selector: `click at (${x}, ${y})`,
          x,
          y,
        });
      }
    },
    [sessionId, send, flow]
  );

  // Handle scroll on browser frame - use native event listener for passive: false
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!sessionId) return;

      const rect = img.getBoundingClientRect();
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      send('input:scroll', { x, y, deltaX: e.deltaX, deltaY: e.deltaY }, sessionId);
    };

    img.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      img.removeEventListener('wheel', handleWheel);
    };
  }, [sessionId, send, frameData]);

  // Start pagination demo when entering demo mode
  useEffect(() => {
    if (flow.state === 'PAGINATION_DEMO' && sessionId && containerSelector) {
      console.log('[BuilderPage] Starting pagination demo with itemSelector:', containerSelector);
      send('pagination:startDemo', { itemSelector: containerSelector }, sessionId);
    }
  }, [flow.state, sessionId, containerSelector, send]);

  // Forward scroll events to server during demo mode
  useEffect(() => {
    if (flow.state !== 'PAGINATION_DEMO') return;
    const img = imgRef.current;
    if (!img || !sessionId) return;

    const handleDemoScroll = (e: WheelEvent) => {
      // Don't prevent default or stop propagation - let the normal scroll handler work too
      // Just forward the scroll to the demo handler
      send('pagination:demoScroll', { deltaY: e.deltaY }, sessionId);
    };

    img.addEventListener('wheel', handleDemoScroll, { passive: true });

    return () => {
      img.removeEventListener('wheel', handleDemoScroll);
    };
  }, [flow.state, sessionId, send]);

  // Forward click events to server during demo mode
  useEffect(() => {
    if (flow.state !== 'PAGINATION_DEMO') return;
    const img = imgRef.current;
    if (!img || !sessionId) return;

    const handleDemoClick = (e: MouseEvent) => {
      // Prevent regular click handler from also firing
      e.stopPropagation();
      e.preventDefault();

      const rect = img.getBoundingClientRect();
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      console.log(`[BuilderPage] Demo click at (${x}, ${y}), scale: ${scaleX.toFixed(2)}x${scaleY.toFixed(2)}`);
      send('pagination:demoClick', { x, y }, sessionId);
    };

    img.addEventListener('click', handleDemoClick);

    return () => {
      img.removeEventListener('click', handleDemoClick);
    };
  }, [flow.state, sessionId, send]);

  // Handle selected element - extract container content
  // Triggers on selection mode click OR auto-detect
  useEffect(() => {
    if (selectedElement) {
      // Use combinedCss if available (for Zara split layout), otherwise use css
      const element = selectedElement as any;
      const selector = element.combinedCss || element.css;

      // Only extract if we haven't already extracted for this selector
      if (selector && selector !== lastExtractedSelectorRef.current) {
        lastExtractedSelectorRef.current = selector;
        addLog(`Extracting content from: ${selector}`);
        setContainerSelector(selector);

        // Small delay to ensure WebSocket subscriptions are fully set up
        // This fixes race condition on initial page load where extraction
        // response arrives before container:content subscription is ready
        const timeoutId = setTimeout(() => {
          extractContainerContent(selector);
        }, 100);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [selectedElement, extractContainerContent, addLog]);

  // Remove selection - handles both saleProduct and nonSaleProduct sections
  const handleRemoveSelection = useCallback(
    (productType: 'saleProduct' | 'nonSaleProduct' | null, field: string, index: number) => {
      setSelectedData((prev) => {
        if (productType === 'saleProduct' || productType === 'nonSaleProduct') {
          // Remove from specific product type section
          const section = prev[productType];
          const fieldKey = field as keyof ProductSelectors;
          if (section && section[fieldKey]) {
            const newSection = { ...section };
            newSection[fieldKey] = [...section[fieldKey]];
            newSection[fieldKey].splice(index, 1);
            return { ...prev, [productType]: newSection };
          }
        } else if (field === 'NextPage') {
          // Handle NextPage (shared)
          const newNextPage = [...prev.NextPage];
          newNextPage.splice(index, 1);
          return { ...prev, NextPage: newNextPage };
        }
        return prev;
      });

      const label = productType ? `${productType === 'saleProduct' ? 'Sale' : 'Non-Sale'}: ${field}` : field;
      addLog(`Removed [${label}] selection`);
    },
    [addLog]
  );

  // Clear all selections
  const handleClearSelections = useCallback(() => {
    setSelectedData({
      saleProduct: { Title: [], Price: [], URL: [], Image: [] },
      nonSaleProduct: { Title: [], Price: [], URL: [], Image: [] },
      NextPage: [],
    });
    flow.reset();
    setExtractedItems([]);
    setShowLabeler(false);
    clearLog();
    addLog('All selections cleared');
  }, [addLog, clearLog, flow]);

  // Train and save config
  const handleTrainAndSave = useCallback(async () => {
    const totalSelections = Object.values(selectedData).reduce((sum, arr) => sum + arr.length, 0);
    if (totalSelections === 0) {
      addLog('Please select some elements first', 'error');
      return;
    }

    // Use suggested name from batch page, or prompt for one
    const defaultName = suggestedConfigName || 'my-config';
    const filename = prompt('Config name:', defaultName);
    if (!filename) return;

    flow.startSaving();
    addLog('-------------------------------');
    addLog(`SAVING CONFIG: ${filename}`, 'success');
    setStatus('loading');
    setStatusText('Training...');

    try {
      const trainResponse = await fetch('/api/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          wanted_dict: selectedData,
        }),
      });

      if (!trainResponse.ok) {
        throw new Error('Training failed');
      }

      const trainData = await trainResponse.json();
      addLog('Training complete', 'success');

      if (trainData?.results) {
        for (const [field, items] of Object.entries(trainData.results)) {
          if (Array.isArray(items) && items.length > 0) {
            addLog(`  - ${field}: ${items.length} matches found`);
          }
        }
      }

      const priceResults = trainData?.results?.Price || [];
      if (priceResults.length > 0) {
        setSamplePrice(priceResults[0]);
        setPendingSave({ filename });
        setPriceModalOpen(true);
        return;
      }

      await completeSave(filename, null);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      addLog(`Error: ${error}`, 'error');
      setStatus('error');
      setStatusText('Error');
    }
  }, [url, selectedData, addLog, suggestedConfigName, flow]);

  // Complete save after price format confirmation
  const completeSave = useCallback(
    async (filename: string, priceFormat: PriceFormat | null) => {
      try {
        // Convert selectedData to new selectors format with saleProduct and nonSaleProduct sections
        // selectedData has: { saleProduct: {...}, nonSaleProduct: {...}, NextPage: [...] }
        // We need: { saleProduct: { Title: string[], ... }, nonSaleProduct: { Title: string[], ... } }
        const selectors: {
          saleProduct: Record<string, string[]>;
          nonSaleProduct: Record<string, string[]>;
        } = {
          saleProduct: {},
          nonSaleProduct: {},
        };

        // Helper function to extract CSS selectors from items
        const extractSelectors = (items: SelectedItem[]): string[] => {
          return items
            .map((item) => item.selector)
            .filter((s): s is string => !!s);
        };

        // Process saleProduct selectors
        for (const [field, items] of Object.entries(selectedData.saleProduct)) {
          if (items.length > 0) {
            const cssSelectors = extractSelectors(items);
            if (cssSelectors.length > 0) {
              selectors.saleProduct[field] = cssSelectors;
            }
          }
        }

        // Process nonSaleProduct selectors
        for (const [field, items] of Object.entries(selectedData.nonSaleProduct)) {
          if (items.length > 0) {
            const cssSelectors = extractSelectors(items);
            if (cssSelectors.length > 0) {
              selectors.nonSaleProduct[field] = cssSelectors;
            }
          }
        }

        const saveBody: Record<string, unknown> = {
          file_path: filename.endsWith('.json') ? filename : filename + '.json',
          competitor_type: competitorType,
          country,
          url, // Save the base URL
          selectors, // Save the selectors with saleProduct/nonSaleProduct structure!
        };

        // Also save the container selector if we have one
        if (containerSelector) {
          saveBody.itemContainer = containerSelector;
        }

        // Use dismiss actions from flow state
        if (flow.dismissActions.length > 0) {
          saveBody.dismiss_actions = flow.dismissActions;
        }
        if (priceFormat) {
          saveBody.price_format = priceFormat;
        }
        // Use pagination pattern from flow state
        if (flow.detectedPagination) {
          saveBody.pagination = flow.detectedPagination;
          addLog(`Pagination: ${flow.detectedPagination.type} - ${flow.detectedPagination.pattern || flow.detectedPagination.selector || 'infinite scroll'}`);
        }

        // Include network extraction config if configured
        if (networkExtractionConfig) {
          saveBody.networkExtraction = networkExtractionConfig;
          addLog(`Network extraction: ${networkExtractionConfig.urlPatterns.join(', ')}`);
        }

        const saveResponse = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saveBody),
        });

        if (!saveResponse.ok) {
          throw new Error('Save failed');
        }

        addLog(`Config saved to: configs/${filename}.json`, 'success');
        addLog('-------------------------------');
        setStatus('active');
        setStatusText('Config saved!');
        flow.completeSave();
      } catch (e) {
        const error = e instanceof Error ? e.message : 'Unknown error';
        addLog(`Error: ${error}`, 'error');
        setStatus('error');
        setStatusText('Error');
      }
    },
    [competitorType, country, addLog, selectedData, url, containerSelector, flow, networkExtractionConfig]
  );

  const handlePriceFormatConfirm = useCallback(
    (priceFormat: PriceFormat | null) => {
      if (pendingSave) {
        completeSave(pendingSave.filename, priceFormat);
      }
      setPendingSave(null);
    },
    [pendingSave, completeSave]
  );

  // Handle overlay confirmations
  const handleOverlayConfirm = useCallback((confirmed: boolean) => {
    switch (flow.overlayType) {
      case 'popup':
        flow.handlePopupConfirm(confirmed);
        break;
      case 'product':
        flow.handleProductConfirm(confirmed);
        break;
      case 'pagination_demo_success':
        flow.handleDemoConfirm(confirmed);
        break;
    }
  }, [flow]);

  const isBrowserOpen = sessionId !== null;

  // Handle SALE wizard completion - store in saleProduct section
  const handleWizardComplete = useCallback(
    (fields: ConfirmedField[]) => {
      // Convert confirmed fields to saleProduct section
      fields.forEach((field) => {
        if (!field.confirmed) return;

        const selectedItem: SelectedItem = {
          text: field.field !== 'URL' && field.field !== 'Image' ? field.value : undefined,
          href: field.field === 'URL' ? field.value : undefined,
          src: field.field === 'Image' ? field.value : undefined,
          selector: field.selector,
        };

        // Map "Sale Price" → "Price" for saleProduct section
        const fieldName = field.field === 'Sale Price' ? 'Price' : field.field;

        // Store in saleProduct section
        if (fieldName === 'Title' || fieldName === 'Price' || fieldName === 'URL' || fieldName === 'Image') {
          setSelectedData((prev) => ({
            ...prev,
            saleProduct: {
              ...prev.saleProduct,
              [fieldName]: [...prev.saleProduct[fieldName as keyof ProductSelectors], selectedItem],
            },
          }));
        }

        addLog(`[Sale: ${fieldName}] ${field.value.substring(0, 50)}${field.value.length > 50 ? '...' : ''}`, 'selected');
      });

      // Auto-detected fields (like RRP) are ignored for sale products
      // We only care about the sale price for sale products

      // Store the container selector for pagination demo
      if (flow.detectedProduct?.css) {
        setContainerSelector(flow.detectedProduct.css);
      }

      // Proceed with wizard completion
      flow.handleWizardComplete(fields);
    },
    [addLog, flow]
  );

  // Handle NON-SALE wizard completion - store in nonSaleProduct section
  const handleNonSaleWizardComplete = useCallback(
    (fields: ConfirmedField[]) => {
      // Convert confirmed fields to nonSaleProduct section
      fields.forEach((field) => {
        if (!field.confirmed) return;

        const selectedItem: SelectedItem = {
          text: field.field !== 'URL' && field.field !== 'Image' ? field.value : undefined,
          href: field.field === 'URL' ? field.value : undefined,
          src: field.field === 'Image' ? field.value : undefined,
          selector: field.selector,
        };

        // Map "RRP" → "Price" for nonSaleProduct section
        const fieldName = field.field === 'RRP' ? 'Price' : field.field;

        // Store in nonSaleProduct section
        if (fieldName === 'Title' || fieldName === 'Price' || fieldName === 'URL' || fieldName === 'Image') {
          setSelectedData((prev) => ({
            ...prev,
            nonSaleProduct: {
              ...prev.nonSaleProduct,
              [fieldName]: [...prev.nonSaleProduct[fieldName as keyof ProductSelectors], selectedItem],
            },
          }));
        }

        addLog(`[Non-Sale: ${fieldName}] ${field.value.substring(0, 50)}${field.value.length > 50 ? '...' : ''}`, 'selected');
      });

      // Proceed with flow handler
      flow.handleNonSaleWizardComplete(fields);
    },
    [addLog, flow]
  );

  // Handle wizard pick different - switch to manual labeling for specific field
  const handleWizardPickDifferent = useCallback(
    (field: 'Title' | 'RRP' | 'Sale Price' | 'URL' | 'Image') => {
      addLog(`Switching to manual labeling for: ${field}`);
      // Trigger content extraction for manual labeling
      if (flow.detectedProduct?.css && flow.detectedProduct.css !== lastExtractedSelectorRef.current) {
        lastExtractedSelectorRef.current = flow.detectedProduct.css;
        setContainerSelector(flow.detectedProduct.css);
        extractContainerContent(flow.detectedProduct.css);
      }
      flow.handleWizardPickDifferent(field);
    },
    [addLog, flow, extractContainerContent]
  );

  // Determine which panels to show based on flow state
  const showPopupPanel = flow.state === 'POPUP_RECORDING';
  const showProductSelection = ['MANUAL_PRODUCT_SELECT', 'PRODUCT_CONFIRMATION', 'AUTO_DETECTING_PRODUCT'].includes(flow.state);
  const showFieldWizard = flow.state === 'FIELD_CONFIRMATION' && flow.wizardSteps.length > 0;
  // NEW: Show non-sale wizard for both immediate (before pagination) and post-pagination states
  const showNonSaleFieldWizard = (
    flow.state === 'NON_SALE_FIELD_CONFIRMATION' ||
    flow.state === 'NON_SALE_WIZARD_IMMEDIATE'
  ) && flow.nonSaleWizardSteps.length > 0;
  const showGeneratingWizard = flow.state === 'GENERATING_WIZARD' || flow.state === 'GENERATING_NON_SALE_WIZARD';
  // Only show full pagination panel for manual configuration
  const showPaginationPanel = flow.state === 'PAGINATION_MANUAL';
  const showFinalConfig = ['FINAL_CONFIG', 'SAVING', 'COMPLETE'].includes(flow.state);

  return (
    <>
      <div className="hero">
        <span className="hero-badge">Config Builder</span>
        <h1>Build Scraper</h1>
        <p className="hero-subtitle">
          {flow.state === 'IDLE' ? 'Enter a URL and click Open Browser to start' : `Step ${flow.currentStepNumber}: ${flow.currentStepTitle}`}
        </p>
      </div>

      {/* Automated Builder Overlay */}
      <AutomatedBuilderOverlay
        type={flow.overlayType}
        isVisible={flow.showOverlay}
        onConfirm={handleOverlayConfirm}
        dismissCount={flow.dismissActions.length}
        detectedProduct={flow.detectedProduct}
        productConfidence={flow.productConfidence}
        productScreenshot={flow.productScreenshot}
        demoProgress={flow.demoProgress}
        demoResult={flow.demoResult}
        onRetryDemo={flow.retryDemo}
        onSkipPagination={flow.skipPagination}
        captchaType={flow.captchaType}
      />

      {/* Field Confirmation Wizard (Sale Products - before pagination) */}
      {showFieldWizard && (
        <FieldConfirmationWizard
          steps={flow.wizardSteps as WizardStep[]}
          onComplete={handleWizardComplete}
          onCancel={flow.handleWizardCancel}
          onPickDifferent={handleWizardPickDifferent}
        />
      )}

      {/* Non-Sale Field Confirmation Wizard (before or after pagination) */}
      {showNonSaleFieldWizard && (
        <FieldConfirmationWizard
          steps={flow.nonSaleWizardSteps as WizardStep[]}
          onComplete={handleNonSaleWizardComplete}
          onCancel={flow.handleNonSaleWizardSkip}
          onPickDifferent={handleWizardPickDifferent}
        />
      )}

      <div style={{ padding: '0 20px', maxWidth: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '20px', marginBottom: '30px', alignItems: 'start' }}>
          {/* Left Panel: Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* URL Input */}
            <div className="step-card">
              <h2 className="step-title">Target URL</h2>
              <div className="form-group" style={{ marginBottom: '15px' }}>
                <input
                  type="text"
                  className="form-input url-input"
                  placeholder="https://example.com/products"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={isBrowserOpen}
                />
              </div>
              {/* Browser mode indicator */}
              {!isBrowserOpen && (
                <div style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--accent-success)',
                  padding: '10px 12px',
                  fontSize: '12px',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: 'var(--accent-success)',
                    display: 'inline-block',
                  }} />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--accent-success)' }}>Real Chrome Mode</strong> - Uses your actual Chrome browser for best compatibility with Zalora, protected sites, etc.
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="btn-large"
                  onClick={handleOpenBrowser}
                  style={{ flex: 1, display: isBrowserOpen ? 'none' : 'block' }}
                  disabled={!connected}
                >
                  {connected ? 'Open Browser' : 'Connecting...'}
                </button>
                <button
                  className="btn secondary"
                  onClick={handleCloseBrowser}
                  style={{ display: isBrowserOpen ? 'block' : 'none' }}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Popup Detection Panel - shows during popup recording */}
            {showPopupPanel && (
              <PopupDetectionPanel
                isRecording={flow.state === 'POPUP_RECORDING'}
                dismissActions={flow.dismissActions}
                onFinishRecording={flow.finishDismissRecording}
              />
            )}

            {/* Product Selection Status - shows during product detection */}
            {showProductSelection && (
              <div className="step-card">
                <h2 className="step-title">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M3 9h18M9 21V9" />
                    </svg>
                    Product Card
                  </span>
                </h2>
                {flow.state === 'AUTO_DETECTING_PRODUCT' && (
                  <p style={{ color: 'var(--text-secondary)' }}>
                    Detecting product card automatically...
                  </p>
                )}
                {flow.state === 'MANUAL_PRODUCT_SELECT' && (
                  <p style={{ color: 'var(--text-secondary)' }}>
                    Click on a product card in the browser to select it.
                  </p>
                )}
              </div>
            )}

            {/* Generating Wizard Status - shows while preparing wizard steps */}
            {showGeneratingWizard && (
              <div className="step-card">
                <h2 className="step-title">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeDashoffset="10" />
                    </svg>
                    Preparing Field Wizard
                  </span>
                </h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Analyzing product cards and preparing visual confirmation...
                </p>
              </div>
            )}

            {/* Selected Data Summary */}
            <SelectedDataSummary
              data={selectedData}
              onRemove={handleRemoveSelection}
            />

            {/* Pagination Detection - shows after labeling */}
            {showPaginationPanel && (
              <PaginationDetector
                baseUrl={url}
                sessionId={sessionId}
                send={send as (type: WSMessageType, payload: unknown, sessionId?: string) => void}
                subscribe={subscribe}
                pattern={flow.detectedPagination}
                onPatternDetected={(pattern) => {
                  if (pattern) {
                    flow.setPaginationManual(pattern);
                  }
                }}
              />
            )}

            {/* Country Selection - shows in final config */}
            {showFinalConfig && (
              <div className="step-card">
                <h2 className="step-title">Country</h2>
                <CountrySelect value={country} onChange={setCountry} />
              </div>
            )}

            {/* Competitor Type - shows in final config */}
            {showFinalConfig && (
              <div className="step-card">
                <h2 className="step-title">Competitor Type</h2>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      padding: '12px 15px',
                      background: 'var(--bg-secondary)',
                      border: `1px solid ${competitorType === 'local' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="competitor-type"
                      value="local"
                      checked={competitorType === 'local'}
                      onChange={() => setCompetitorType('local')}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.9em' }}>Local</span>
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      padding: '12px 15px',
                      background: 'var(--bg-secondary)',
                      border: `1px solid ${competitorType === 'global' ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="competitor-type"
                      value="global"
                      checked={competitorType === 'global'}
                      onChange={() => setCompetitorType('global')}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.9em' }}>Global</span>
                  </label>
                </div>
              </div>
            )}

            {/* Save Actions - shows in final config */}
            {showFinalConfig && (
              <div className="step-card">
                <h2 className="step-title">Save Config</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button className="btn-large" onClick={handleTrainAndSave}>
                    Train and Save Config
                  </button>
                  <button className="btn secondary" onClick={handleClearSelections}>
                    Clear All
                  </button>
                </div>
                <div className="status-strip" style={{ marginTop: '15px' }}>
                  <StatusIndicator status={status} />
                  <span className="status-label">{statusText}</span>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel: Browser - sticky */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              position: 'sticky',
              top: '80px',
              maxHeight: 'calc(100vh - 100px)',
              overflowY: 'auto',
            }}
          >
            {/* Browser Container */}
            <div
              style={{
                background: '#1a1a1a',
                border: '1px solid var(--border-color)',
                minHeight: '600px',
                height: 'calc(100vh - 180px)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Browser Toolbar */}
              <div
                style={{
                  background: 'var(--bg-card)',
                  borderBottom: '1px solid var(--border-color)',
                  padding: '12px 15px',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', gap: '6px' }}>
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f57' }} />
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }} />
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#28ca41' }} />
                </div>
                <input
                  type="text"
                  className="form-input"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                  }}
                  readOnly
                  placeholder="Browser URL will appear here..."
                  value={session.currentUrl}
                />
                <span
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.7em',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    background:
                      modeBadge === 'SELECTING'
                        ? 'var(--accent-success)'
                        : modeBadge === 'DISMISS'
                        ? '#ff9800'
                        : 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    color: modeBadge === 'Browse' ? 'var(--text-secondary)' : 'white',
                  }}
                >
                  {modeBadge}
                </span>
              </div>

              {/* Browser View */}
              <div
                ref={browserContainerRef}
                style={{
                  flex: 1,
                  position: 'relative',
                  display: 'flex',
                  overflow: 'hidden',
                }}
              >
                {frameData ? (
                  <img
                    ref={imgRef}
                    src={frameData}
                    alt="Remote Browser"
                    onClick={handleFrameClick}
                    style={{
                      width: '100%',
                      height: '100%',
                      cursor: selectionMode || flow.state === 'POPUP_RECORDING' ? 'crosshair' : 'pointer',
                      objectFit: 'fill',
                    }}
                  />
                ) : (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%',
                    color: 'var(--text-secondary)',
                  }}>
                    {sessionStatus === 'connecting' ? (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '20px',
                        padding: '40px',
                        background: 'rgba(0,0,0,0.3)',
                        borderRadius: '12px',
                        backdropFilter: 'blur(10px)',
                      }}>
                        <div style={{
                          width: '80px',
                          height: '80px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          animation: 'pulse 2s ease-in-out infinite',
                        }}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="2" y1="12" x2="22" y2="12" />
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                          </svg>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <h3 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)', fontSize: '1.3em' }}>
                            Starting Browser
                          </h3>
                          <p style={{ margin: '0 0 16px 0', opacity: 0.8, fontSize: '0.95em' }}>
                            Launching Chromium in Docker...
                          </p>
                        </div>
                        <div style={{
                          width: '200px',
                          height: '4px',
                          background: 'rgba(255,255,255,0.1)',
                          borderRadius: '2px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%',
                            background: 'var(--accent-primary)',
                            borderRadius: '2px',
                            animation: 'loading-bar 2s ease-in-out infinite',
                          }} />
                        </div>
                        <p style={{ margin: 0, opacity: 0.6, fontSize: '0.8em' }}>
                          This may take 5-10 seconds on first load
                        </p>
                      </div>
                    ) : (
                      <>
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '20px', opacity: 0.5 }}>
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <path d="M3 9h18M9 21V9" />
                        </svg>
                        <h3 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)', fontSize: '1.2em' }}>No Browser Open</h3>
                        <p style={{ margin: '0 0 8px 0', opacity: 0.7 }}>Enter a URL and click "Open Browser" to start</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Price Format Modal */}
      <PriceFormatModal
        isOpen={priceModalOpen}
        onClose={() => setPriceModalOpen(false)}
        samplePrice={samplePrice}
        onConfirm={handlePriceFormatConfirm}
      />
    </>
  );
}
