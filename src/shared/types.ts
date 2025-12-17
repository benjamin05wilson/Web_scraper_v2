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
  | 'webrtc:ice';

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
  xpath: string;
  text?: string;
  attributes: Record<string, string>;
  tagName: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
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

// Selector Assignment Types
export type SelectorRole = 'title' | 'price' | 'url' | 'nextPage' | 'image' | 'custom';

export interface AssignedSelector {
  role: SelectorRole;
  selector: ElementSelector;
  customName?: string;
  extractionType: 'text' | 'attribute' | 'href' | 'src' | 'innerHTML';
  attributeName?: string;
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
  | 'url'
  | 'nextPage'
  | 'image'
  | 'description'
  | 'rating'
  | 'sku'
  | 'availability'
  | 'category'
  | 'custom';
