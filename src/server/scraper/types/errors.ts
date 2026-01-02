// ============================================================================
// SCRAPER ERROR TYPES
// ============================================================================
// Categorized errors for better handling and retry logic

/**
 * Categories of scraping errors with different handling strategies
 */
export enum ScrapeErrorType {
  /** Network-related errors (connection, DNS, etc.) - retriable */
  NETWORK = 'network',
  /** Timeout errors (navigation, loading) - retriable */
  TIMEOUT = 'timeout',
  /** Selector errors (element not found, invalid selector) - not retriable */
  SELECTOR = 'selector',
  /** Extraction errors (data parsing, missing data) - partial recovery possible */
  EXTRACTION = 'extraction',
  /** Navigation errors (page load, redirect issues) - retriable */
  NAVIGATION = 'navigation',
  /** Configuration errors (invalid config) - not retriable */
  CONFIG = 'config',
  /** Unknown/unexpected errors */
  UNKNOWN = 'unknown',
}

/**
 * Structured error with metadata for handling decisions
 */
export interface ScrapeError {
  /** Error category */
  type: ScrapeErrorType;
  /** Human-readable error message */
  message: string;
  /** Whether this error type can be retried */
  retriable: boolean;
  /** Original error if wrapped */
  cause?: Error;
  /** Which selector caused the error (if applicable) */
  selector?: string;
  /** Which role was being extracted (if applicable) */
  role?: string;
  /** Page number where error occurred */
  pageNumber?: number;
  /** Timestamp when error occurred */
  timestamp: number;
}

/**
 * Per-item extraction error for partial result tracking
 */
export interface ItemExtractionError {
  /** Index of the item in the container list */
  itemIndex: number;
  /** Container selector that was being processed */
  containerSelector?: string;
  /** Which field failed to extract */
  field: string;
  /** Error details */
  error: string;
}

/**
 * Extended scrape result with detailed error tracking
 */
export interface EnhancedScrapeResult {
  success: boolean;
  items: Record<string, unknown>[];
  pagesScraped: number;
  duration: number;
  /** Global errors that affected the entire scrape */
  errors?: ScrapeError[];
  /** Per-item errors for partial failures */
  itemErrors?: ItemExtractionError[];
  /** Number of items that had extraction issues but still returned partial data */
  partialItems?: number;
  /** Whether the scrape was stopped early due to errors */
  stoppedEarly?: boolean;
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Delay between retries in ms */
  retryDelay: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Maximum delay cap in ms */
  maxDelay: number;
  /** Which error types to retry */
  retriableTypes: ScrapeErrorType[];
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 0, // Fail fast by default (existing behavior)
  retryDelay: 1000,
  backoffMultiplier: 2,
  maxDelay: 10000,
  retriableTypes: [
    ScrapeErrorType.NETWORK,
    ScrapeErrorType.TIMEOUT,
    ScrapeErrorType.NAVIGATION,
  ],
};

/**
 * Check if an error type is retriable based on config
 */
export function isRetriable(errorType: ScrapeErrorType, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
  return config.retriableTypes.includes(errorType);
}

/**
 * Calculate delay for retry attempt with exponential backoff
 */
export function calculateRetryDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const delay = config.retryDelay * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelay);
}

/**
 * Create a ScrapeError from an unknown error
 */
export function createScrapeError(
  error: unknown,
  type: ScrapeErrorType = ScrapeErrorType.UNKNOWN,
  context?: Partial<Omit<ScrapeError, 'type' | 'message' | 'retriable' | 'timestamp'>>
): ScrapeError {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  return {
    type,
    message,
    retriable: isRetriable(type),
    cause,
    timestamp: Date.now(),
    ...context,
  };
}

/**
 * Classify an error into a ScrapeErrorType based on its message/type
 */
export function classifyError(error: unknown): ScrapeErrorType {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // Network errors
  if (
    message.includes('net::') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('connection')
  ) {
    return ScrapeErrorType.NETWORK;
  }

  // Timeout errors
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('exceeded')
  ) {
    return ScrapeErrorType.TIMEOUT;
  }

  // Navigation errors
  if (
    message.includes('navigation') ||
    message.includes('navigate') ||
    message.includes('page.goto')
  ) {
    return ScrapeErrorType.NAVIGATION;
  }

  // Selector errors
  if (
    message.includes('selector') ||
    message.includes('queryselector') ||
    message.includes('element not found') ||
    message.includes('no element')
  ) {
    return ScrapeErrorType.SELECTOR;
  }

  // Extraction errors
  if (
    message.includes('extract') ||
    message.includes('parse') ||
    message.includes('no containers found')
  ) {
    return ScrapeErrorType.EXTRACTION;
  }

  // Config errors
  if (
    message.includes('config') ||
    message.includes('invalid') ||
    message.includes('no selectors')
  ) {
    return ScrapeErrorType.CONFIG;
  }

  return ScrapeErrorType.UNKNOWN;
}

/**
 * Create a ScrapeError with automatic classification
 */
export function wrapError(
  error: unknown,
  context?: Partial<Omit<ScrapeError, 'type' | 'message' | 'retriable' | 'timestamp'>>
): ScrapeError {
  const type = classifyError(error);
  return createScrapeError(error, type, context);
}
