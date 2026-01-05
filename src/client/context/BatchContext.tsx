import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type {
  BatchJob,
  BatchCSVRow,
  BrowserSlot,
  BatchProgress,
  Config,
  NextUrlEntry,
  NextScrapeStatus,
} from '../../shared/types';
import { parseBatchCSV } from '../utils/csvUtils';
import { extractDomain } from '../utils/domainUtils';
import type { NextPricingResult } from '../utils/export/batchExport';
import { downloadBatchResults, transformToCompetitorPricing } from '../utils/export/batchExport';
import { DomainScheduler } from '../utils/DomainScheduler';

// Batch processing constants - 5 browsers for parallel scraping
const DEFAULT_WARMUP_COUNT = 5; // Pre-warm exactly 5 browsers
const MAX_BROWSER_SLOTS = 5; // Maximum 5 browser slots (same as single scraper, just parallel)
const MIN_ITEMS_FOR_SUCCESS = 10; // Retry if fewer items than this
const MAX_RETRIES = 1; // Maximum retry attempts per job
// HTTP_CONCURRENCY is configured server-side in HttpScraperBridge

interface BatchContextValue {
  jobs: BatchJob[];
  browserSlots: BrowserSlot[];
  progress: BatchProgress;
  isRunning: boolean;
  isPaused: boolean;
  fastMode: boolean;
  targetProducts: number;
  configs: Map<string, Config>;
  missingConfigs: string[];
  // Next URL scraping state
  nextUrlsData: NextUrlEntry[];
  nextScrapeResults: NextPricingResult[];
  nextScrapeStatus: NextScrapeStatus;
  nextScrapeProgress: number;
  // Actions
  processCSV: (file: File) => Promise<void>;
  refreshConfigs: () => Promise<void>;
  startBatch: () => void;
  pauseResumeBatch: () => void;
  stopBatch: () => void;
  setFastMode: (enabled: boolean) => void;
  setTargetProducts: (count: number) => void;
  expandSlot: (slotId: number) => void;
  closeExpandedSlot: () => void;
  expandedSlotId: number | null;
  // Slot interaction
  sendSlotInput: (slotId: number, type: string, data: unknown) => void;
  // Next URL scraping
  startNextScraping: () => Promise<void>;
  // Download
  downloadResults: () => Promise<void>;
}

const BatchContext = createContext<BatchContextValue | null>(null);

// Use relative URLs - works in both dev (via proxy) and production
const API_BASE = '';

interface BatchProviderProps {
  children: ReactNode;
}

export function BatchProvider({ children }: BatchProviderProps) {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [browserSlots, setBrowserSlots] = useState<BrowserSlot[]>([]);
  const [progress, setProgress] = useState<BatchProgress>({
    total: 0,
    completed: 0,
    errors: 0,
    skipped: 0,
    pending: 0,
    running: 0,
    itemsScraped: 0,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [fastMode, setFastModeState] = useState(true); // Default to fast mode for batch
  const [targetProducts, setTargetProductsState] = useState(100);
  const [poolStats, setPoolStats] = useState<{ total: number; idle: number; busy: number } | null>(null);
  const [_httpScraperAvailable, _setHttpScraperAvailable] = useState(false); // Reserved for future HTTP-first implementation
  const [configs, setConfigs] = useState<Map<string, Config>>(new Map());
  const [missingConfigs, setMissingConfigs] = useState<string[]>([]);
  const [expandedSlotId, setExpandedSlotId] = useState<number | null>(null);

  // Next URL scraping state
  const [nextUrlsData, setNextUrlsData] = useState<NextUrlEntry[]>([]);
  const [nextScrapeResults, setNextScrapeResults] = useState<NextPricingResult[]>([]);
  const [nextScrapeStatus, setNextScrapeStatus] = useState<NextScrapeStatus>('pending');
  const [nextScrapeProgress, setNextScrapeProgress] = useState(0);

  const socketsRef = useRef<Map<number, WebSocket>>(new Map());
  const jobQueueRef = useRef<BatchJob[]>([]);
  const slotSessionsRef = useRef<Map<number, string>>(new Map()); // Track sessionIds by slot
  const slotJobsRef = useRef<Map<number, BatchJob>>(new Map()); // Track current job by slot (ref for immediate access)
  const isRunningRef = useRef(false); // Track running state for immediate access in callbacks
  const isPausedRef = useRef(false); // Track paused state for immediate access in callbacks
  const configsRef = useRef<Map<string, Config>>(new Map()); // Track configs for immediate access

  // New batch processing refs
  const domainSchedulerRef = useRef(new DomainScheduler());
  const batchWsRef = useRef<WebSocket | null>(null); // Single WebSocket for batch control
  const slotBrowserIdRef = useRef<Map<number, string>>(new Map()); // slot -> browserId mapping
  const httpScraperAvailableRef = useRef(false); // Track HTTP scraper availability (always false now)

  // Process uploaded CSV
  const processCSV = useCallback(async (file: File) => {
    const text = await file.text();
    const result = parseBatchCSV(text);

    if (result.errors.length > 0) {
      console.warn('CSV parsing errors:', result.errors);
    }

    // Convert CSV rows to BatchJob objects
    // Use Source URL for domain matching (the base site), Next URL is the page to scrape
    const newJobs: BatchJob[] = result.rows.map((row: BatchCSVRow, index: number) => ({
      index,
      country: row.Country,
      division: row.Division,
      category: row.Category,
      nextUrl: row['Next URL'],
      sourceUrl: row['Source URL'],
      domain: extractDomain(row['Source URL']),
      status: 'pending' as const,
      progress: 0,
      itemCount: 0,
    }));

    setJobs(newJobs);
    jobQueueRef.current = [...newJobs];

    // Initialize domain scheduler for grouped processing
    domainSchedulerRef.current.initialize(newJobs);

    // Update progress
    setProgress({
      total: newJobs.length,
      completed: 0,
      errors: 0,
      skipped: 0,
      pending: newJobs.length,
      running: 0,
      itemsScraped: 0,
    });

    // Extract unique Next URLs for separate scraping
    const nextUrlSet = new Set<string>();
    const nextUrls: NextUrlEntry[] = [];
    result.rows.forEach((row: BatchCSVRow) => {
      const nextUrl = row['Next URL'];
      if (nextUrl && !nextUrlSet.has(nextUrl)) {
        nextUrlSet.add(nextUrl);
        nextUrls.push({
          key: nextUrl,
          url: nextUrl,
          division: row.Division,
          category: row.Category,
          country: row.Country,
        });
      }
    });
    setNextUrlsData(nextUrls);
    setNextScrapeResults([]);
    setNextScrapeStatus('pending');
    setNextScrapeProgress(0);
    console.log(`[BatchContext] Extracted ${nextUrls.length} unique Next URLs`);

    // Check for missing configs - need to check domain+country combinations
    const domainCountryPairs = [...new Set(newJobs.map(j => `${j.domain}:${j.country}`))];
    const missingSet = await checkConfigs(domainCountryPairs, newJobs);

    // Auto-mark jobs as skipped if their config doesn't exist
    if (missingSet && missingSet.size > 0) {
      const skippedJobs = newJobs.filter(j => missingSet.has(`${j.domain}:${j.country}`));
      const skippedCount = skippedJobs.length;
      const pendingJobs = newJobs.filter(j => !missingSet.has(`${j.domain}:${j.country}`));

      setJobs(prev => prev.map(j => {
        const key = `${j.domain}:${j.country}`;
        if (missingSet.has(key)) {
          return { ...j, status: 'skipped' as const, error: `No config for domain: ${j.domain}` };
        }
        return j;
      }));
      setProgress(prev => ({
        ...prev,
        pending: prev.pending - skippedCount,
        skipped: prev.skipped + skippedCount,
      }));

      // Re-initialize scheduler with only pending jobs (exclude skipped)
      jobQueueRef.current = [...pendingJobs];
      domainSchedulerRef.current.initialize(pendingJobs);

      // Filter Next URLs - only exclude if ALL jobs referencing that Next URL are skipped
      // (keep a Next URL if at least one pending job uses it)
      const pendingNextUrls = new Set(pendingJobs.map(j => j.nextUrl));
      const filteredNextUrls = nextUrls.filter(n => pendingNextUrls.has(n.url));
      setNextUrlsData(filteredNextUrls);
      console.log(`[BatchContext] Filtered Next URLs: ${nextUrls.length} -> ${filteredNextUrls.length} (keeping only those with pending jobs)`);

      console.log(`[BatchContext] Auto-skipped ${skippedCount} jobs with missing configs`);
    }
  }, []);

  // Check which domain+country pairs have configs
  const checkConfigs = async (domainCountryPairs: string[], _jobs: BatchJob[]) => {
    try {
      // Try to load configs from both BigQuery and local sources
      const configMap = new Map<string, Config>();

      // First try BigQuery configs
      try {
        const bqResponse = await fetch(`${API_BASE}/api/configs?source=bigquery`);
        if (bqResponse.ok) {
          const bqData = await bqResponse.json();
          const bqConfigs: Config[] = bqData.configs || bqData || [];
          for (const config of bqConfigs) {
            if (config.url) {
              const configDomain = extractDomain(config.url);
              // Store by domain:country if country is set, otherwise just domain
              const key = config.country ? `${configDomain}:${config.country}` : configDomain;
              configMap.set(key, config);
              // Only store by domain as fallback if config has NO country set
              // (country-specific configs should NOT be used for other countries)
              if (!config.country && !configMap.has(configDomain)) {
                configMap.set(configDomain, config);
              }
            }
            if (config.name) {
              configMap.set(config.name, config);
            }
          }
        }
      } catch {
        console.log('BigQuery configs not available, using local only');
      }

      // Also load local configs
      const localResponse = await fetch(`${API_BASE}/api/configs`);
      if (localResponse.ok) {
        const localData = await localResponse.json();
        const localConfigs: Config[] = localData.configs || localData || [];
        console.log(`[BatchContext] Loaded ${localConfigs.length} configs from API`);
        for (const config of localConfigs) {
          if (config.url) {
            const configDomain = extractDomain(config.url);
            // Store by domain:country if country is set
            const key = config.country ? `${configDomain}:${config.country}` : configDomain;
            console.log(`[BatchContext] Config "${config.name}" -> key: ${key}, country: ${config.country || 'none'}`);
            if (!configMap.has(key)) {
              configMap.set(key, config);
            }
            // Only store by domain as fallback if config has NO country set
            // (country-specific configs should NOT be used for other countries)
            if (!config.country && !configMap.has(configDomain)) {
              configMap.set(configDomain, config);
            }
          }
          if (config.name && !configMap.has(config.name)) {
            configMap.set(config.name, config);
          }
        }
      }

      setConfigs(configMap);
      configsRef.current = configMap; // Also update ref for immediate access
      console.log(`[BatchContext] Config map keys:`, [...configMap.keys()]);
      console.log(`[BatchContext] Checking domain:country pairs:`, domainCountryPairs);

      // Find missing configs - check domain:country first, then fall back to domain only (if no country set)
      const missing = domainCountryPairs.filter(pair => {
        const [domain, country] = pair.split(':');
        // Check exact domain:country match first
        if (configMap.has(pair)) {
          console.log(`[BatchContext] "${pair}" -> exact match found`);
          return false;
        }
        // Fall back to domain-only match ONLY if that config has no country set
        // (a country-specific config should NOT be used for other countries)
        const domainConfig = configMap.get(domain);
        if (domainConfig && !domainConfig.country) {
          console.log(`[BatchContext] "${pair}" -> domain-only match found (generic config)`);
          return false;
        }
        // Try fuzzy match by name - but only if the matched config has no country or same country
        const domainBase = domain.split('.')[0].toLowerCase();
        const fuzzyMatch = [...configMap.values()].find(c =>
          c.name?.toLowerCase().includes(domainBase) && (!c.country || c.country === country)
        );
        if (fuzzyMatch) {
          console.log(`[BatchContext] "${pair}" -> fuzzy match found: ${fuzzyMatch.name}`);
          return false;
        }
        console.log(`[BatchContext] "${pair}" -> NO CONFIG FOUND`);
        return true;
      });
      setMissingConfigs(missing);

      console.log(`[BatchContext] Loaded ${configMap.size} configs, missing: ${missing.length}`);
      return new Set(missing);
    } catch (err) {
      console.error('Failed to check configs:', err);
      return new Set<string>();
    }
  };

  // Refresh configs - re-check configs for current jobs
  const refreshConfigs = useCallback(async () => {
    if (jobs.length === 0) return;
    const domainCountryPairs = [...new Set(jobs.map(j => `${j.domain}:${j.country}`))];
    console.log('[BatchContext] Refreshing configs for:', domainCountryPairs);
    await checkConfigs(domainCountryPairs, jobs);
  }, [jobs]);

  // Start batch processing with new pool-based system
  const startBatch = useCallback(() => {
    if (jobs.length === 0) return;

    // Clean up any existing connections first
    for (const [slotId, ws] of socketsRef.current.entries()) {
      const sessionId = slotSessionsRef.current.get(slotId);
      if (sessionId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'session:destroy', sessionId }));
      }
      ws.close();
    }
    socketsRef.current.clear();
    slotSessionsRef.current.clear();
    slotJobsRef.current.clear();
    slotBrowserIdRef.current.clear();

    // Close existing batch WebSocket
    if (batchWsRef.current) {
      batchWsRef.current.close();
      batchWsRef.current = null;
    }

    // Set refs BEFORE state (refs are synchronous, state is async)
    isRunningRef.current = true;
    isPausedRef.current = false;
    setIsRunning(true);
    setIsPaused(false);

    // Count already skipped jobs (missing configs)
    const alreadySkipped = jobs.filter(j => j.status === 'skipped');
    const skippedCount = alreadySkipped.length;
    const pendingJobs = jobs.filter(j => j.status !== 'skipped');

    // Reset progress - preserve skipped count
    setProgress({
      total: jobs.length,
      completed: 0,
      errors: 0,
      skipped: skippedCount,
      pending: pendingJobs.length,
      running: 0,
      itemsScraped: 0,
    });

    // Reset job statuses to pending, but keep skipped jobs as skipped
    setJobs(prev => prev.map(j => {
      if (j.status === 'skipped') {
        return j; // Keep skipped jobs unchanged
      }
      return { ...j, status: 'pending' as const, itemCount: 0, results: undefined, error: undefined };
    }));

    // Reset job queue and domain scheduler with only pending jobs (exclude skipped)
    const freshJobs = pendingJobs.map(j => ({ ...j, status: 'pending' as const }));
    jobQueueRef.current = [...freshJobs];
    domainSchedulerRef.current.initialize(freshJobs);
    console.log(`[BatchContext] Starting batch with ${jobQueueRef.current.length} jobs`);

    // Initialize batch WebSocket for pool-based processing
    initBatchConnection();
  }, [jobs]);

  // Initialize batch control WebSocket (new pool-based system)
  const initBatchConnection = () => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    batchWsRef.current = ws;

    ws.onopen = () => {
      console.log('[BatchContext] Batch WebSocket connected, starting pool...');

      // Extract unique domains from jobs for browser pre-navigation
      const uniqueDomains = [...new Set(jobs.map(j => j.domain).filter(Boolean))];
      console.log(`[BatchContext] Sending ${uniqueDomains.length} unique domains for browser warmup`);

      // Request browser pool warmup with domains for pre-navigation
      ws.send(JSON.stringify({
        type: 'batch:start',
        payload: {
          warmupCount: DEFAULT_WARMUP_COUNT,
          maxSlots: MAX_BROWSER_SLOTS,
          domains: uniqueDomains, // Send domains for browser pre-navigation
        },
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleBatchMessage(msg);
    };

    ws.onclose = () => {
      console.log('[BatchContext] Batch WebSocket disconnected');
      batchWsRef.current = null;
    };

    ws.onerror = (err) => {
      console.error('[BatchContext] Batch WebSocket error:', err);
    };
  };

  // Handle messages from batch control WebSocket
  const handleBatchMessage = (msg: { type: string; payload?: unknown }) => {
    const payload = msg.payload as Record<string, unknown> || {};

    switch (msg.type) {
      case 'batch:poolReady': {
        const {
          poolSize,
          configsCached = 0,
          warmupTimeMs = 0,
        } = payload as {
          poolSize: number;
          configsCached?: number;
          warmupTimeMs?: number;
        };
        console.log(`[BatchContext] Pool ready in ${warmupTimeMs}ms: ${poolSize} browsers, ${configsCached} configs cached`);
        setPoolStats({ total: poolSize, idle: poolSize, busy: 0 });
        _setHttpScraperAvailable(false); // Browser-only mode
        httpScraperAvailableRef.current = false;

        // Initialize browser slots display
        setBrowserSlots(
          Array.from({ length: poolSize }, (_, i) => ({
            id: i,
            status: 'idle',
          }))
        );

        // Start browser-only processing - request browsers for all slots
        console.log('[BatchContext] Starting browser-only batch processing...');
        const initialSlots = Math.min(poolSize, domainSchedulerRef.current.getRemainingCount());
        for (let i = 0; i < initialSlots; i++) {
          requestBrowserForSlot(i);
        }
        break;
      }

      case 'batch:browserAcquired': {
        const { slotId, browserId } = payload as { slotId: number; browserId: string };
        console.log(`[BatchContext] Slot ${slotId} acquired browser ${browserId.substring(0, 8)}`);
        slotBrowserIdRef.current.set(slotId, browserId);
        processJobWithBrowser(slotId, browserId);
        break;
      }

      case 'batch:browserUnavailable': {
        const { slotId } = payload as { slotId: number };
        console.log(`[BatchContext] No browser available for slot ${slotId}, will retry...`);
        // Retry after a short delay
        setTimeout(() => {
          if (isRunningRef.current && !isPausedRef.current) {
            requestBrowserForSlot(slotId);
          }
        }, 1000);
        break;
      }

      case 'batch:scrapeResult': {
        const { browserId, success, items, count, error } = payload as {
          browserId: string;
          success: boolean;
          items: unknown[];
          count: number;
          error?: string;
        };

        // Find which slot this browser belongs to
        let slotId = -1;
        for (const [sid, bid] of slotBrowserIdRef.current.entries()) {
          if (bid === browserId) {
            slotId = sid;
            break;
          }
        }

        if (slotId === -1) {
          console.warn(`[BatchContext] Unknown browser ${browserId}`);
          return;
        }

        const completedJob = slotJobsRef.current.get(slotId);
        if (completedJob) {
          handleJobComplete(slotId, browserId, completedJob, success, items as unknown[], count, error);
        }
        break;
      }

      case 'batch:poolStats': {
        const { pool } = payload as { pool: { total: number; idle: number; busy: number } };
        setPoolStats(pool);
        break;
      }

      case 'batch:stopped': {
        console.log('[BatchContext] Batch stopped');
        setPoolStats(null);
        break;
      }

      case 'batch:error': {
        const { error } = payload as { error: string };
        console.error('[BatchContext] Batch error:', error);
        break;
      }
    }
  };

  // Request a browser from the pool for a slot
  const requestBrowserForSlot = (slotId: number) => {
    if (!batchWsRef.current || batchWsRef.current.readyState !== WebSocket.OPEN) return;
    if (!isRunningRef.current || isPausedRef.current) return;

    // Get preferred domain from scheduler
    const nextJob = domainSchedulerRef.current.getNextJob(slotId);
    if (!nextJob) {
      console.log(`[BatchContext] No more jobs for slot ${slotId}`);
      checkBatchComplete();
      return;
    }

    // Put the job back temporarily (we'll get it again when browser is acquired)
    domainSchedulerRef.current.requeueJob(nextJob, true);

    setBrowserSlots(prev => prev.map(s =>
      s.id === slotId ? { ...s, status: 'loading' } : s
    ));

    batchWsRef.current.send(JSON.stringify({
      type: 'batch:acquireBrowser',
      payload: {
        slotId,
        preferredDomain: nextJob.domain,
      },
    }));
  };

  // Process a job using an acquired browser
  const processJobWithBrowser = (slotId: number, browserId: string) => {
    if (!batchWsRef.current || batchWsRef.current.readyState !== WebSocket.OPEN) return;
    if (!isRunningRef.current || isPausedRef.current) return;

    // Get next job from domain scheduler
    const job = domainSchedulerRef.current.getNextJob(slotId);
    if (!job) {
      // No more jobs, release browser
      batchWsRef.current.send(JSON.stringify({
        type: 'batch:releaseBrowser',
        payload: { browserId },
      }));
      slotBrowserIdRef.current.delete(slotId);
      checkBatchComplete();
      return;
    }

    // Track job assignment
    slotJobsRef.current.set(slotId, job);

    // Update job status
    setJobs(prev => prev.map(j =>
      j.index === job.index ? { ...j, status: 'running' as const, startedAt: Date.now() } : j
    ));

    setBrowserSlots(prev => prev.map(s =>
      s.id === slotId ? { ...s, status: 'scraping', currentJob: job, currentUrl: job.sourceUrl } : s
    ));

    // Update progress
    setProgress(prev => ({
      ...prev,
      pending: prev.pending - 1,
      running: prev.running + 1,
    }));

    // Find config for this job
    const configKey = `${job.domain}:${job.country}`;
    const config = configsRef.current.get(configKey) || configsRef.current.get(job.domain);

    if (!config) {
      console.log(`[BatchContext] No config for ${configKey} - skipping`);

      // Mark job as skipped (not error)
      setJobs(prev => prev.map(j =>
        j.index === job.index
          ? { ...j, status: 'skipped', error: `No config for domain: ${job.domain}`, completedAt: Date.now() }
          : j
      ));

      // Update progress - decrement running (was incremented before), increment skipped
      setProgress(prev => ({
        ...prev,
        running: prev.running - 1,
        skipped: prev.skipped + 1,
      }));

      // Mark completed in scheduler and clear slot
      domainSchedulerRef.current.markCompleted(slotId, true);
      slotJobsRef.current.delete(slotId);

      setBrowserSlots(prev => prev.map(s =>
        s.id === slotId ? { ...s, status: 'idle', currentJob: undefined } : s
      ));

      // Continue with next job
      processJobWithBrowser(slotId, browserId);
      return;
    }

    // Update queue depth for auto-scaler
    const remaining = domainSchedulerRef.current.getRemainingCount();
    batchWsRef.current.send(JSON.stringify({
      type: 'batch:updateQueueDepth',
      payload: { depth: remaining },
    }));

    // Execute browser scrape
    batchWsRef.current.send(JSON.stringify({
      type: 'batch:browserScrape',
      payload: {
        browserId,
        configName: config.name,
        url: job.sourceUrl,
        fastMode: true, // Always fast mode in batch
        targetProducts: targetProducts,
      },
    }));
  };

  // Handle job completion
  const handleJobComplete = (
    slotId: number,
    browserId: string,
    job: BatchJob,
    success: boolean,
    items: unknown[],
    count: number,
    error?: string
  ) => {
    const currentRetryCount = job.retryCount || 0;
    console.log(`[BatchContext] Job ${job.index} complete: ${count} items, success: ${success}`);

    // Check if we need to retry
    if (count < MIN_ITEMS_FOR_SUCCESS && currentRetryCount < MAX_RETRIES && !error) {
      console.log(`[BatchContext] Job ${job.index} needs retry (${count} < ${MIN_ITEMS_FOR_SUCCESS})`);

      // Re-queue for retry
      const retryJob = { ...job, retryCount: currentRetryCount + 1 };
      domainSchedulerRef.current.requeueJob(retryJob, true);

      slotJobsRef.current.delete(slotId);

      // Continue with next job
      setTimeout(() => processJobWithBrowser(slotId, browserId), 500);
      return;
    }

    // Mark job complete
    const finalStatus = success && count > 0 ? 'completed' : 'error';

    // Determine error message
    let errorMessage = error;
    if (!errorMessage && finalStatus === 'error') {
      if (count === 0) {
        errorMessage = 'No products found on page';
      } else if (!success) {
        errorMessage = 'Scrape failed';
      }
    }

    setJobs(prev => prev.map(j =>
      j.index === job.index ? {
        ...j,
        status: finalStatus as 'completed' | 'error',
        itemCount: count,
        results: items,
        error: errorMessage,
        completedAt: Date.now(),
      } : j
    ));

    // Update progress
    setProgress(prev => ({
      ...prev,
      running: prev.running - 1,
      completed: finalStatus === 'completed' ? prev.completed + 1 : prev.completed,
      errors: finalStatus === 'error' ? prev.errors + 1 : prev.errors,
      itemsScraped: prev.itemsScraped + count,
    }));

    // Mark completed in scheduler
    domainSchedulerRef.current.markCompleted(slotId, true);
    slotJobsRef.current.delete(slotId);

    setBrowserSlots(prev => prev.map(s =>
      s.id === slotId ? { ...s, status: 'idle', currentJob: undefined } : s
    ));

    // Continue with next job
    processJobWithBrowser(slotId, browserId);
  };

  // Check if batch is complete
  const checkBatchComplete = () => {
    const remaining = domainSchedulerRef.current.getRemainingCount();
    const runningJobs = slotJobsRef.current.size;

    if (remaining === 0 && runningJobs === 0) {
      console.log('[BatchContext] Batch complete!');
      isRunningRef.current = false;
      setIsRunning(false);

      // Stop the batch pool
      if (batchWsRef.current && batchWsRef.current.readyState === WebSocket.OPEN) {
        batchWsRef.current.send(JSON.stringify({ type: 'batch:stop' }));
      }
    }
  };

  // Legacy slot connection - kept for reference, now using pool-based system
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _initSlotConnection = (slotId: number) => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      console.log(`Slot ${slotId} connected, creating session...`);
      // Create a browser session for this slot
      ws.send(JSON.stringify({
        type: 'session:create',
        payload: {
          url: 'about:blank',
          viewport: { width: 1280, height: 720 },
        },
      }));
    };

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        // Binary frame data
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result as string;
          setBrowserSlots(prev => prev.map(s =>
            s.id === slotId ? { ...s, frameData: base64, lastUpdate: Date.now() } : s
          ));
        };
        reader.readAsDataURL(event.data);
      } else {
        // JSON message
        const msg = JSON.parse(event.data);
        handleSlotMessage(slotId, msg);
      }
    };

    ws.onclose = () => {
      console.log(`Slot ${slotId} disconnected`);
      socketsRef.current.delete(slotId);
    };

    ws.onerror = (err) => {
      console.error(`Slot ${slotId} error:`, err);
      setBrowserSlots(prev => prev.map(s =>
        s.id === slotId ? { ...s, status: 'error' } : s
      ));
    };

    socketsRef.current.set(slotId, ws);
  };

  const handleSlotMessage = (slotId: number, msg: { type: string; payload?: unknown; sessionId?: string }) => {
    switch (msg.type) {
      case 'session:created':
        // Session is ready, mark slot as idle and ready for jobs
        // sessionId is in payload for session:created, but also at top level for other messages
        const createdPayload = msg.payload as { sessionId?: string };
        const sessionId = createdPayload?.sessionId || msg.sessionId;
        console.log(`Slot ${slotId} session created:`, sessionId);

        // Store sessionId in ref for immediate access
        if (sessionId) {
          slotSessionsRef.current.set(slotId, sessionId);

          // Start screencast to receive frame previews
          const slotWs = socketsRef.current.get(slotId);
          if (slotWs?.readyState === WebSocket.OPEN) {
            console.log(`Slot ${slotId} starting screencast for session:`, sessionId);
            slotWs.send(JSON.stringify({
              type: 'webrtc:offer',
              sessionId,
              payload: {},
            }));
          }
        }

        setBrowserSlots(prev => prev.map(s =>
          s.id === slotId ? { ...s, status: 'idle', sessionId } : s
        ));
        // Try to process a job for this slot (use setTimeout to let state update)
        setTimeout(() => processNextJob(slotId), 0);
        break;

      case 'scrape:result':
        // Handle scrape completion - use ref to get the correct job (state may be stale)
        const result = msg.payload as { items?: unknown[]; error?: string; success?: boolean };
        const completedJob = slotJobsRef.current.get(slotId);
        if (completedJob) {
          const jobIndex = completedJob.index;
          const itemCount = result.items?.length || 0;
          const currentRetryCount = completedJob.retryCount || 0;
          console.log(`[BatchContext] Slot ${slotId} completed job ${jobIndex} (${completedJob.domain}) with ${itemCount} items (retry: ${currentRetryCount}/${MAX_RETRIES})`);

          // Check if we need to retry - less than MIN_ITEMS and haven't exceeded max retries
          if (itemCount < MIN_ITEMS_FOR_SUCCESS && currentRetryCount < MAX_RETRIES) {
            console.log(`[BatchContext] Job ${jobIndex} returned only ${itemCount} items (< ${MIN_ITEMS_FOR_SUCCESS}), queuing for retry`);

            // Clear the job from slot ref
            slotJobsRef.current.delete(slotId);

            // Create retry job with incremented retry count
            const retryJob: BatchJob = {
              ...completedJob,
              status: 'pending',
              retryCount: currentRetryCount + 1,
              itemCount: 0,
              results: undefined,
            };

            // Add to front of queue for immediate retry
            jobQueueRef.current.unshift(retryJob);

            // Update job status to show it's retrying
            flushSync(() => {
              setJobs(prev => prev.map(j =>
                j.index === jobIndex
                  ? { ...j, status: 'pending', retryCount: currentRetryCount + 1, error: `Retrying (${itemCount} items)` }
                  : j
              ));

              setProgress(prev => ({
                ...prev,
                running: prev.running - 1,
                pending: prev.pending + 1,
              }));
            });

            // Process next job (which will be the retry)
            setTimeout(() => processNextJob(slotId), 500); // Small delay before retry
          } else {
            // Clear the job from slot ref BEFORE processing next
            slotJobsRef.current.delete(slotId);

            // Update job state with results - use flushSync to force immediate UI update
            const updatedJob = {
              ...completedJob,
              status: 'completed' as const,
              itemCount,
              completedAt: Date.now(),
              results: result.items,
              error: itemCount < MIN_ITEMS_FOR_SUCCESS ? `Low results after ${currentRetryCount + 1} attempt(s)` : undefined,
            };

            // Use flushSync to force immediate synchronous render of these updates
            flushSync(() => {
              setJobs(prev => {
                const newJobs = prev.map(j =>
                  j.index === jobIndex ? updatedJob : j
                );
                console.log(`[BatchContext] Jobs state updated, job ${jobIndex} itemCount: ${itemCount}`);
                return newJobs;
              });

              setProgress(prev => {
                const newProgress = {
                  ...prev,
                  completed: prev.completed + 1,
                  running: prev.running - 1,
                  itemsScraped: prev.itemsScraped + itemCount,
                };
                console.log(`[BatchContext] Progress updated: ${newProgress.completed}/${newProgress.total}`);
                return newProgress;
              });
            });

            // Process next job after a micro-delay to let React render
            setTimeout(() => processNextJob(slotId), 0);
          }
        } else {
          console.warn(`[BatchContext] Slot ${slotId} received scrape:result but no job was tracked`);
        }
        break;

      case 'scrape:error':
        // Use ref to get the correct job (state may be stale)
        const failedJob = slotJobsRef.current.get(slotId);
        if (failedJob) {
          const errorJobIndex = failedJob.index;
          const errorMsg = (msg.payload as { error?: string })?.error || 'Unknown error';
          console.log(`[BatchContext] Slot ${slotId} error on job ${errorJobIndex} (${failedJob.domain}): ${errorMsg}`);

          // Clear the job from slot ref BEFORE processing next
          slotJobsRef.current.delete(slotId);

          // Use flushSync to force immediate synchronous render
          flushSync(() => {
            setJobs(prev => prev.map(j =>
              j.index === errorJobIndex
                ? { ...j, status: 'error', error: errorMsg, completedAt: Date.now() }
                : j
            ));

            setProgress(prev => ({
              ...prev,
              errors: prev.errors + 1,
              running: prev.running - 1,
            }));
          });

          setTimeout(() => processNextJob(slotId), 0);
        } else {
          console.warn(`[BatchContext] Slot ${slotId} received scrape:error but no job was tracked`);
        }
        break;

      case 'session:error':
        console.error(`Slot ${slotId} session error:`, msg.payload);
        setBrowserSlots(prev => prev.map(s =>
          s.id === slotId ? { ...s, status: 'error' } : s
        ));
        break;
    }
  };

  const processNextJobs = () => {
    // Process jobs for all active slots
    const slotCount = poolStats?.total || browserSlots.length || DEFAULT_WARMUP_COUNT;
    for (let i = 0; i < slotCount; i++) {
      processNextJob(i);
    }
  };

  const processNextJob = (slotId: number) => {
    // Use refs for immediate access (state may be stale in closures)
    if (isPausedRef.current || !isRunningRef.current) {
      console.log(`[BatchContext] processNextJob(${slotId}) skipped: isPaused=${isPausedRef.current}, isRunning=${isRunningRef.current}`);
      return;
    }

    // Check if slot has a ready session (use ref for immediate access)
    const sessionId = slotSessionsRef.current.get(slotId);
    if (!sessionId) {
      console.log(`Slot ${slotId} not ready (no session), skipping`);
      return;
    }

    const nextJob = jobQueueRef.current.shift();
    if (!nextJob) {
      // No more jobs for this slot
      console.log(`[BatchContext] Slot ${slotId} has no more jobs`);
      setBrowserSlots(prev => prev.map(s =>
        s.id === slotId ? { ...s, status: 'idle', currentJob: undefined } : s
      ));

      // Check if all slots are done (use ref to check active jobs)
      if (slotJobsRef.current.size === 0 && jobQueueRef.current.length === 0) {
        console.log(`[BatchContext] All jobs complete, stopping batch`);
        isRunningRef.current = false;
        setIsRunning(false);
      }
      return;
    }

    // Get the config for this domain+country - use ref for immediate access (state may be stale)
    const currentConfigs = configsRef.current;
    const domainCountryKey = `${nextJob.domain}:${nextJob.country}`;
    console.log(`[BatchContext] Looking for config for ${domainCountryKey}, available keys:`, [...currentConfigs.keys()]);

    let config = currentConfigs.get(domainCountryKey);
    if (config) {
      console.log(`Found config for ${domainCountryKey} via exact domain:country match: ${config.name}`);
    }
    if (!config) {
      // Try domain-only match ONLY if that config has no country set
      // (a country-specific config should NOT be used for other countries)
      const domainConfig = currentConfigs.get(nextJob.domain);
      if (domainConfig && !domainConfig.country) {
        config = domainConfig;
        console.log(`Found config for ${nextJob.domain} via domain-only match (generic): ${config.name}`);
      }
    }
    if (!config) {
      // Try to find by config name containing domain - but only if no country or same country
      const domainBase = nextJob.domain.replace(/^www\./i, '').split('.')[0];
      for (const [key, cfg] of currentConfigs.entries()) {
        if ((cfg.name?.toLowerCase().includes(domainBase.toLowerCase()) ||
            key.toLowerCase().includes(domainBase.toLowerCase())) &&
            (!cfg.country || cfg.country === nextJob.country)) {
          config = cfg;
          console.log(`Found config for ${nextJob.domain} via fuzzy match: ${cfg.name}`);
          break;
        }
      }
    }
    if (!config) {
      console.log(`No config found for domain: ${nextJob.domain} - skipping`);
      // Mark job as skipped and move on
      setJobs(prev => prev.map(j =>
        j.index === nextJob.index
          ? { ...j, status: 'skipped', error: `No config for domain: ${nextJob.domain}`, completedAt: Date.now() }
          : j
      ));
      setProgress(prev => ({
        ...prev,
        skipped: prev.skipped + 1,
        pending: prev.pending - 1,
      }));
      // Try next job
      processNextJob(slotId);
      return;
    }

    // Track this job in the slot ref BEFORE starting - this is the source of truth for result handling
    slotJobsRef.current.set(slotId, nextJob);
    console.log(`[BatchContext] Slot ${slotId} assigned job ${nextJob.index} (${nextJob.domain})`);

    // Update job status
    setJobs(prev => prev.map(j =>
      j.index === nextJob.index
        ? { ...j, status: 'running', startedAt: Date.now() }
        : j
    ));

    // Update slot
    setBrowserSlots(prev => prev.map(s =>
      s.id === slotId
        ? { ...s, status: 'loading', currentJob: nextJob, currentUrl: nextJob.sourceUrl }
        : s
    ));

    setProgress(prev => ({
      ...prev,
      running: prev.running + 1,
      pending: prev.pending - 1,
    }));

    // Send scrape command to slot - use config name so server loads it from disk
    const ws = socketsRef.current.get(slotId);
    if (ws?.readyState === WebSocket.OPEN) {
      console.log(`[BatchContext] Slot ${slotId} executing scrape for job ${nextJob.index}: ${nextJob.sourceUrl} with config: ${config.name}`);
      const message = {
        type: 'scrape:execute',
        sessionId, // Include sessionId so server knows which browser to use
        payload: {
          name: config.name, // Config name for server to load from disk
          url: nextJob.sourceUrl, // Use Source URL for scraping
          startUrl: nextJob.sourceUrl,
          fastMode,
          targetProducts,
        },
      };
      ws.send(JSON.stringify(message));
    }
  };

  const pauseResumeBatch = useCallback(() => {
    if (isPaused) {
      isPausedRef.current = false;
      setIsPaused(false);
      processNextJobs();
    } else {
      isPausedRef.current = true;
      setIsPaused(true);
    }
  }, [isPaused]);

  const stopBatch = useCallback(() => {
    isRunningRef.current = false;
    isPausedRef.current = false;
    setIsRunning(false);
    setIsPaused(false);

    // Stop batch pool via WebSocket
    if (batchWsRef.current && batchWsRef.current.readyState === WebSocket.OPEN) {
      batchWsRef.current.send(JSON.stringify({ type: 'batch:stop' }));
      batchWsRef.current.close();
    }
    batchWsRef.current = null;

    // Send session:destroy to each slot before closing (legacy cleanup)
    for (const [slotId, ws] of socketsRef.current.entries()) {
      const sessionId = slotSessionsRef.current.get(slotId);
      if (sessionId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'session:destroy',
          sessionId,
        }));
      }
      ws.close();
    }
    socketsRef.current.clear();
    slotSessionsRef.current.clear();
    slotJobsRef.current.clear();
    slotBrowserIdRef.current.clear();

    // Clear job queue and scheduler
    jobQueueRef.current = [];
    domainSchedulerRef.current.reset();

    // Reset slots
    setBrowserSlots([]);
    setPoolStats(null);
  }, []);

  const setFastMode = useCallback((enabled: boolean) => {
    setFastModeState(enabled);
  }, []);

  const setTargetProducts = useCallback((count: number) => {
    setTargetProductsState(count);
  }, []);

  const expandSlot = useCallback((slotId: number) => {
    setExpandedSlotId(slotId);
  }, []);

  const closeExpandedSlot = useCallback(() => {
    setExpandedSlotId(null);
  }, []);

  const sendSlotInput = useCallback((slotId: number, type: string, data: unknown) => {
    const ws = socketsRef.current.get(slotId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload: data }));
    }
  }, []);

  // Start Next URL scraping
  const startNextScraping = useCallback(async () => {
    if (nextUrlsData.length === 0) {
      console.log('[BatchContext] No Next URLs to scrape');
      return;
    }

    setNextScrapeStatus('running');
    setNextScrapeProgress(0);

    try {
      console.log(`[BatchContext] Starting Next URL scraping for ${nextUrlsData.length} URLs`);

      const response = await fetch(`${API_BASE}/api/batch/next-scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: nextUrlsData }),
      });

      const result = await response.json();

      if (result.success) {
        setNextScrapeResults(result.results || []);
        setNextScrapeStatus('completed');
        setNextScrapeProgress(100);
        console.log(`[BatchContext] Next URL scraping complete: ${result.count} products found`);
      } else {
        setNextScrapeStatus('error');
        console.error('[BatchContext] Next URL scraping failed:', result.error);
      }
    } catch (error) {
      console.error('[BatchContext] Next URL scraping error:', error);
      setNextScrapeStatus('error');
    }
  }, [nextUrlsData]);

  // Download results as ZIP
  const downloadResults = useCallback(async () => {
    const completedJobs = jobs.filter(j => j.status === 'completed');
    if (completedJobs.length === 0 && nextScrapeResults.length === 0) {
      console.warn('[BatchContext] No results to download');
      return;
    }

    // Transform jobs to competitor pricing format
    const batchData = jobs.map(j => ({
      country: j.country,
      division: j.division,
      category: j.category,
      nextUrl: j.nextUrl,
      sourceUrl: j.sourceUrl,
    }));

    const competitorResults = transformToCompetitorPricing(completedJobs, batchData);

    // Download ZIP
    await downloadBatchResults(competitorResults, nextScrapeResults, batchData);
  }, [jobs, nextScrapeResults]);

  const value: BatchContextValue = {
    jobs,
    browserSlots,
    progress,
    isRunning,
    isPaused,
    fastMode,
    targetProducts,
    configs,
    missingConfigs,
    nextUrlsData,
    nextScrapeResults,
    nextScrapeStatus,
    nextScrapeProgress,
    processCSV,
    refreshConfigs,
    startBatch,
    pauseResumeBatch,
    stopBatch,
    setFastMode,
    setTargetProducts,
    expandSlot,
    closeExpandedSlot,
    expandedSlotId,
    sendSlotInput,
    startNextScraping,
    downloadResults,
  };

  return (
    <BatchContext.Provider value={value}>
      {children}
    </BatchContext.Provider>
  );
}

export function useBatchContext(): BatchContextValue {
  const context = useContext(BatchContext);
  if (!context) {
    throw new Error('useBatchContext must be used within a BatchProvider');
  }
  return context;
}
