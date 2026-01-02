export type WSMessageType = 'session:create' | 'session:created' | 'session:destroy' | 'session:error' | 'navigate' | 'navigate:complete' | 'input:mouse' | 'input:keyboard' | 'input:scroll' | 'dom:hover' | 'dom:highlight' | 'dom:select' | 'dom:selected' | 'dom:autoDetect' | 'dom:autoDetectResult' | 'dom:lowConfidence' | 'selector:test' | 'selector:result' | 'selector:findPattern' | 'selector:pattern' | 'selector:highlightAll' | 'selector:highlighted' | 'selector:clearHighlight' | 'recorder:start' | 'recorder:stop' | 'recorder:action' | 'scrape:configure' | 'scrape:execute' | 'scrape:result' | 'scrape:error' | 'webrtc:offer' | 'webrtc:answer' | 'webrtc:ice' | 'url:hover' | 'url:captured' | 'url:history' | 'container:extract' | 'container:content' | 'pagination:detect' | 'pagination:candidates' | 'scrollTest:start' | 'scrollTest:update' | 'scrollTest:complete' | 'scrollTest:result';
export interface WSMessage<T = unknown> {
    type: WSMessageType;
    sessionId?: string;
    payload: T;
    timestamp: number;
}
export interface SessionConfig {
    url: string;
    viewport: {
        width: number;
        height: number;
    };
    userAgent?: string;
    proxy?: string;
}
export interface Session {
    id: string;
    config: SessionConfig;
    status: 'initializing' | 'ready' | 'streaming' | 'scraping' | 'error';
    createdAt: number;
}
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
export interface ElementSelector {
    css: string;
    cssGeneric?: string;
    cssGenericCount?: number;
    cssSpecific?: string;
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
    confidence?: number;
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
export type SelectorRole = 'title' | 'price' | 'originalPrice' | 'salePrice' | 'url' | 'nextPage' | 'image' | 'custom';
export interface AssignedSelector {
    role: SelectorRole;
    selector: ElementSelector;
    customName?: string;
    extractionType: 'text' | 'attribute' | 'href' | 'src' | 'innerHTML';
    attributeName?: string;
    priority?: number;
}
export type RecorderActionType = 'click' | 'type' | 'scroll' | 'select' | 'wait';
export interface RecorderAction {
    id: string;
    type: RecorderActionType;
    selector: string;
    value?: string;
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
/** Scroll strategy for lazy loading */
export type ScrollStrategy = 'adaptive' | 'rapid' | 'fixed';
export interface AdvancedScraperConfig {
    /** Scroll strategy: 'adaptive' (wait for DOM stability), 'rapid' (fast incremental), 'fixed' (fixed delay) */
    scrollStrategy?: ScrollStrategy;
    /** Scroll delay in ms (used for 'fixed' strategy, default: 800) */
    scrollDelay?: number;
    /** Maximum scroll iterations before giving up */
    maxScrollIterations?: number;
    /** Custom loading indicator selectors to wait for */
    loadingIndicators?: string[];
    /** Number of retries for retriable errors (network, timeout) */
    retryCount?: number;
    /** Delay between retries in ms */
    retryDelay?: number;
    /** Time to wait for DOM stability in ms (for 'adaptive' strategy) */
    stabilityTimeout?: number;
    /** Scroll step size in pixels for 'rapid' mode (default: 500) */
    rapidScrollStep?: number;
    /** Delay between rapid scroll steps in ms (default: 100) */
    rapidScrollDelay?: number;
}
export interface ScraperConfig {
    name: string;
    startUrl: string;
    selectors: AssignedSelector[];
    preActions?: RecorderSequence;
    pagination?: {
        enabled: boolean;
        selector: string;
        maxPages: number;
        waitAfterClick?: number;
    };
    itemContainer?: string;
    autoScroll?: boolean;
    targetProducts?: number;
    advanced?: AdvancedScraperConfig;
}
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
export interface ChromeLaunchConfig {
    executablePath?: string;
    headless: false;
    args: string[];
    ignoreDefaultArgs?: string[];
    env?: Record<string, string>;
}
export interface GPUConfig {
    useAngle: 'd3d11' | 'd3d9' | 'gl' | 'swiftshader';
    enableGPUAcceleration: boolean;
    enableHardwareOverlays: boolean;
    forceDeviceScaleFactor?: number;
}
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
export type ThemeMode = 'light' | 'dark' | 'system';
export type ExportFormat = 'json' | 'csv' | 'xlsx';
export interface AppSettings {
    theme: ThemeMode;
    sidebarWidth: number;
    defaultExportFormat: ExportFormat;
}
export type ExtendedSelectorRole = 'title' | 'price' | 'originalPrice' | 'salePrice' | 'url' | 'nextPage' | 'image' | 'description' | 'rating' | 'sku' | 'availability' | 'category' | 'custom';
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
        type: 'infinite_scroll' | 'url_pattern' | 'next_page' | 'hybrid';
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
    /** Lazy loading / scroll configuration */
    lazyLoad?: LazyLoadConfig;
    /** Target total items across all pages (0 = unlimited) */
    targetItems?: number;
    /** Item container selector for counting items */
    itemContainer?: string;
}
export interface Schedule {
    id: number;
    name: string;
    type: 'scraper' | 'batch';
    config?: string;
    csv_path?: string;
    schedule: string;
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
    results?: unknown[];
    retryCount?: number;
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
    sessionId?: string;
    currentUrl?: string;
    currentJob?: BatchJob;
    frameData?: string;
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
export interface NextUrlEntry {
    key: string;
    url: string;
    division: string;
    category: string;
    country: string;
}
export type NextScrapeStatus = 'pending' | 'running' | 'completed' | 'error';
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
export type ActivityType = 'scrape' | 'create' | 'update' | 'delete' | 'export' | 'import' | 'schedule';
export interface Activity {
    id: string;
    type: ActivityType;
    description: string;
    details?: Record<string, unknown>;
    timestamp: number;
}
export interface DomainSummary {
    domain: string;
    productCount: number;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    countries: string[];
}
/** Pagination candidate found during auto-detection */
export interface PaginationCandidate {
    selector: string;
    type: 'next_button' | 'numbered' | 'load_more';
    text?: string;
    confidence: number;
    boundingBox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    attributes?: {
        href?: string;
        ariaLabel?: string;
        className?: string;
    };
}
/** Payload for pagination:candidates response */
export interface PaginationCandidatesPayload {
    candidates: PaginationCandidate[];
    detectedType: 'url_pattern' | 'next_page' | 'infinite_scroll' | 'hybrid' | null;
}
/** Scroll test update sent during active scroll test */
export interface ScrollTestUpdate {
    initialCount: number;
    currentCount: number;
    scrollPosition: number;
    itemsLoaded: number[];
}
/** Results from completed scroll test with recommendations */
export interface ScrollTestResult {
    initialItemCount: number;
    finalItemCount: number;
    itemsLoadedPerScroll: number[];
    totalScrollDistance: number;
    scrollIterations: number;
    avgLoadDelay: number;
    recommendedStrategy: ScrollStrategy;
    recommendedDelay: number;
    recommendedMaxIterations: number;
    loadingIndicatorsFound: string[];
}
/** Lazy loading configuration for saved configs */
export interface LazyLoadConfig {
    scrollStrategy?: ScrollStrategy;
    scrollDelay?: number;
    maxScrollIterations?: number;
    stabilityTimeout?: number;
    rapidScrollStep?: number;
    rapidScrollDelay?: number;
    loadingIndicators?: string[];
}
//# sourceMappingURL=types.d.ts.map