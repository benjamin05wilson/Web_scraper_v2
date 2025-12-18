export type WSMessageType = 'session:create' | 'session:created' | 'session:destroy' | 'session:error' | 'navigate' | 'navigate:complete' | 'input:mouse' | 'input:keyboard' | 'input:scroll' | 'dom:hover' | 'dom:highlight' | 'dom:select' | 'dom:selected' | 'selector:test' | 'selector:result' | 'selector:findPattern' | 'selector:pattern' | 'selector:highlightAll' | 'selector:highlighted' | 'selector:clearHighlight' | 'recorder:start' | 'recorder:stop' | 'recorder:action' | 'scrape:configure' | 'scrape:execute' | 'scrape:result' | 'scrape:error' | 'webrtc:offer' | 'webrtc:answer' | 'webrtc:ice' | 'url:hover' | 'url:captured' | 'url:history' | 'container:extract' | 'container:content';
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
//# sourceMappingURL=types.d.ts.map