// ============================================================================
// SHARED TYPES - Browser Scraper System
// ============================================================================

// WebSocket Message Types
export type WSMessageType =
  | 'session:create'
  | 'session:created'
  | 'session:destroy'
  | 'session:error'
  | 'navigate'
  | 'navigate:complete'
  | 'input:mouse'
  | 'input:keyboard'
  | 'input:scroll'
  | 'dom:hover'
  | 'dom:highlight'
  | 'dom:select'
  | 'dom:selected'
  | 'dom:autoDetect'
  | 'dom:autoDetectResult'
  | 'dom:lowConfidence'
  | 'selector:test'
  | 'selector:result'
  | 'selector:findPattern'
  | 'selector:pattern'
  | 'selector:highlightAll'
  | 'selector:highlighted'
  | 'selector:clearHighlight'
  | 'recorder:start'
  | 'recorder:stop'
  | 'recorder:action'
  | 'scrape:configure'
  | 'scrape:execute'
  | 'scrape:result'
  | 'scrape:error'
  | 'webrtc:offer'
  | 'webrtc:answer'
  | 'webrtc:ice'
  | 'url:hover'
  | 'url:captured'
  | 'url:history'
  | 'container:extract'
  | 'container:content';

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  sessionId?: string;
  payload: T;
  timestamp: number;
}

// Session Types
export interface SessionConfig {
  url: string;
  viewport: { width: number; height: number };
  userAgent?: string;
  proxy?: string;
}

export interface Session {
  id: string;
  config: SessionConfig;
  status: 'initializing' | 'ready' | 'streaming' | 'scraping' | 'error';
  createdAt: number;
}

// Input Event Types
export interface MouseEvent {
  type: 'move' | 'down' | 'up' | 'click' | 'dblclick' | 'contextmenu';
  x: number;
  y: number;
  button: 'left' | 'right' | 'middle';
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
}

export interface KeyboardEvent {
  type: 'keydown' | 'keyup' | 'keypress';
  key: string;
  code: string;
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
}

export interface ScrollEvent {
  deltaX: number;
  deltaY: number;
  x: number;
  y: number;
}

// DOM Selection Types
export interface ElementSelector {
  css: string;
  cssGeneric?: string; // Generic selector that matches multiple similar elements
  cssGenericCount?: number; // How many elements the generic selector matches
  cssSpecific?: string; // Specific selector for this exact element (from ML detection)
  xpath?: string;
  text?: string;
  attributes: Record<string, string>;
  tagName: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  // ML detection confidence (0-1)
  confidence?: number;
  // Whether manual verification is recommended
  fallbackRecommended?: boolean;
}

export interface DOMHighlight {
  selector: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  tagName: string;
  className?: string;
  id?: string;
}

// Container Content Extraction Types
export interface ExtractedContentItem {
  type: 'text' | 'link' | 'image';
  value: string;
  selector: string;
  displayText: string;
  tagName?: string;
}

export interface ContainerContentPayload {
  items: ExtractedContentItem[];
  containerSelector: string;
}

// Selector Assignment Types
export type SelectorRole = 'title' | 'price' | 'originalPrice' | 'salePrice' | 'url' | 'nextPage' | 'image' | 'custom';

export interface AssignedSelector {
  role: SelectorRole;
  selector: ElementSelector;
  customName?: string;
  extractionType: 'text' | 'attribute' | 'href' | 'src' | 'innerHTML';
  attributeName?: string;
  priority?: number; // For fallback ordering - lower number = higher priority (tried first)
}

// Recorder Types
export type RecorderActionType = 'click' | 'type' | 'scroll' | 'select' | 'wait';

export interface RecorderAction {
  id: string;
  type: RecorderActionType;
  selector: string;
  value?: string; // For type actions
  timestamp: number;
  description: string;
}

export interface RecorderSequence {
  id: string;
  name: string;
  description?: string;
  actions: RecorderAction[];
  createdAt: number;
}

// Scraper Configuration
export interface ScraperConfig {
  name: string;
  startUrl: string;
  selectors: AssignedSelector[];
  preActions?: RecorderSequence; // Actions to run before scraping (popups, cookies)
  pagination?: {
    enabled: boolean;
    selector: string;
    maxPages: number;
    waitAfterClick?: number;
  };
  itemContainer?: string; // Selector for repeating item containers
  autoScroll?: boolean; // Auto-scroll to load lazy content before scraping (default: true)
  targetProducts?: number; // Max products to scrape - stops when target reached (0 = unlimited)
}

// Scraper Results
export interface ScrapedItem {
  [key: string]: string | null;
}

export interface ScrapeResult {
  success: boolean;
  items: ScrapedItem[];
  pagesScraped: number;
  duration: number;
  errors?: string[];
}

// WebRTC Signaling
export interface RTCOfferPayload {
  sdp: string;
  type: 'offer';
}

export interface RTCAnswerPayload {
  sdp: string;
  type: 'answer';
}

export interface RTCIcePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

// CDP Event Types (subset we care about)
export interface CDPDOMNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName: string;
  nodeValue: string;
  attributes?: string[];
  childNodeCount?: number;
}

export interface CDPBoxModel {
  content: number[];
  padding: number[];
  border: number[];
  margin: number[];
  width: number;
  height: number;
}

// Chrome Launch Configuration
export interface ChromeLaunchConfig {
  executablePath?: string;
  headless: false; // Must be headed for Tab Capture
  args: string[];
  ignoreDefaultArgs?: string[];
  env?: Record<string, string>;
}

// Windows-specific GPU settings
export interface GPUConfig {
  useAngle: 'd3d11' | 'd3d9' | 'gl' | 'swiftshader';
  enableGPUAcceleration: boolean;
  enableHardwareOverlays: boolean;
  forceDeviceScaleFactor?: number;
}

// ============================================================================
// SAVED DATA TYPES - For localStorage persistence
// ============================================================================

export interface SavedScraper {
  id: string;
  name: string;
  config: ScraperConfig;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  isTemplate?: boolean;
}

export interface SavedScrapeResult {
  id: string;
  scraperId: string;
  scraperName: string;
  result: ScrapeResult;
  createdAt: number;
  url: string;
}

// App Settings
export type ThemeMode = 'light' | 'dark' | 'system';
export type ExportFormat = 'json' | 'csv' | 'xlsx';

export interface AppSettings {
  theme: ThemeMode;
  sidebarWidth: number;
  defaultExportFormat: ExportFormat;
}

// Extended selector roles
export type ExtendedSelectorRole =
  | 'title'
  | 'price'
  | 'originalPrice'
  | 'salePrice'
  | 'url'
  | 'nextPage'
  | 'image'
  | 'description'
  | 'rating'
  | 'sku'
  | 'availability'
  | 'category'
  | 'custom';

// URL Capture Types
export interface CapturedUrl {
  url: string;
  text?: string;
  title?: string;
  timestamp: number;
}

export interface UrlHoverPayload {
  url: string;
  text?: string;
  x: number;
  y: number;
}

// ============================================================================
// CONFIG TYPES - For /configs API (BigQuery storage)
// ============================================================================

export interface Config {
  name: string;
  url?: string;
  selectors: {
    Title?: string | string[];
    Price?: string | string[];
    URL?: string | string[];
    Image?: string | string[];
    OriginalPrice?: string | string[];
  };
  pagination?: {
    type: 'infinite_scroll' | 'url_pattern' | 'next_page';
    pattern?: string;
    selector?: string;
    start_page?: number;
    max_pages?: number;
  };
  alignment?: {
    matched: boolean;
    method: string;
    count: number;
  };
  country?: string;
  competitor_type?: 'local' | 'global';
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// SCHEDULE TYPES - For /schedules API
// ============================================================================

export interface Schedule {
  id: number;
  name: string;
  type: 'scraper' | 'batch';
  config?: string;
  csv_path?: string;
  schedule: string; // Cron expression
  enabled: boolean;
  last_run?: string;
  next_run?: string;
  created_at: string;
}

export interface CreateScheduleData {
  name: string;
  type: 'scraper' | 'batch';
  config?: string;
  csv_path?: string;
  schedule: string;
  enabled?: boolean;
}

// ============================================================================
// BATCH TYPES - For batch processing
// ============================================================================

export type BatchJobStatus = 'pending' | 'running' | 'completed' | 'error' | 'paused' | 'skipped';

export interface BatchJob {
  index: number;
  country: string;
  division: string;
  category: string;
  nextUrl: string;
  sourceUrl: string;
  domain: string;
  status: BatchJobStatus;
  progress: number;
  itemCount: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  results?: unknown[]; // Scraped items
  retryCount?: number; // Number of retry attempts (max 1)
}

export interface BatchCSVRow {
  Country: string;
  Division: string;
  Category: string;
  'Next URL': string;
  'Source URL': string;
}

export type BrowserSlotStatus = 'idle' | 'loading' | 'scraping' | 'captcha' | 'error' | 'cloudflare';

export interface BrowserSlot {
  id: number;
  status: BrowserSlotStatus;
  sessionId?: string; // Server session ID for this slot
  currentUrl?: string;
  currentJob?: BatchJob;
  frameData?: string; // Base64 JPEG frame
  lastUpdate?: number;
}

export interface BatchProgress {
  total: number;
  completed: number;
  errors: number;
  skipped: number;
  pending: number;
  running: number;
  itemsScraped: number;
}

// Next URL scraping types
export interface NextUrlEntry {
  key: string;
  url: string;
  division: string;
  category: string;
  country: string;
}

export type NextScrapeStatus = 'pending' | 'running' | 'completed' | 'error';

// ============================================================================
// PRODUCT TYPES - For /api/products API
// ============================================================================

export interface Product {
  id?: number;
  item_name: string;
  brand?: string;
  price?: number;
  price_raw?: string;
  original_price?: number;
  currency?: string;
  domain?: string;
  category?: string;
  country?: string;
  competitor_type?: string;
  product_url?: string;
  image_url?: string;
  source_url?: string;
  scraped_at: string;
}

export interface ProductStats {
  total_products: number;
  country_count: number;
  domain_count: number;
  category_count: number;
  avg_price?: number;
  countries: string[];
  domains: string[];
  categories: string[];
}

export type DateRangeFilter = 'today' | 'week' | 'month' | 'all';

export interface ProductFilters {
  country?: string;
  domain?: string;
  category?: string;
  dateRange: DateRangeFilter;
  search?: string;
}

export interface ProductsResponse {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// ACTIVITY TYPES - For activity timeline
// ============================================================================

export type ActivityType = 'scrape' | 'create' | 'update' | 'delete' | 'export' | 'import' | 'schedule';

export interface Activity {
  id: string;
  type: ActivityType;
  description: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

// ============================================================================
// DOMAIN SUMMARY TYPES - For reports page
// ============================================================================

export interface DomainSummary {
  domain: string;
  productCount: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  countries: string[];
}
