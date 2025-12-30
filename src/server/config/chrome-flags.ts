// ============================================================================
// WINDOWS-OPTIMIZED CHROME LAUNCH FLAGS
// ============================================================================
// These flags are critical for achieving sub-frame latency and GPU acceleration

export const CHROME_FLAGS_WINDOWS = [
  // =========================================================================
  // GPU ACCELERATION (CRITICAL FOR LOW LATENCY)
  // =========================================================================
  '--enable-gpu',
  '--enable-gpu-rasterization',
  '--enable-zero-copy',
  '--enable-hardware-overlays',
  '--enable-native-gpu-memory-buffers',

  // Use D3D11 ANGLE backend for best Windows performance
  '--use-angle=d3d11',
  '--use-gl=angle',

  // Enable VP9/AV1 hardware encoding if available
  '--enable-features=VaapiVideoDecoder,VaapiVideoEncoder',

  // Force GPU compositing
  '--force-gpu-rasterization',
  '--enable-accelerated-video-decode',
  '--enable-accelerated-video-encode',
  '--enable-accelerated-2d-canvas',

  // =========================================================================
  // WEBRTC OPTIMIZATIONS
  // =========================================================================
  // Enable hardware-accelerated video capture
  '--enable-features=WebRtcHideLocalIpsWithMdns',
  '--disable-features=WebRtcHideLocalIpsWithMdns',

  // Use hardware encoding for screen capture
  '--enable-features=ScreenCaptureKitMac,DesktopCaptureMacV2',

  // Reduce capture latency
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',

  // =========================================================================
  // PERFORMANCE OPTIMIZATIONS
  // =========================================================================
  // Disable throttling for consistent performance (CRITICAL for background capture)
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-networking',

  // CRITICAL: Force rendering even when window is hidden/minimized/occluded
  '--disable-features=CalculateNativeWinOcclusion',
  '--force-presentation-receiver-for-testing',

  // Memory optimizations
  '--js-flags=--max-old-space-size=4096',
  '--max-active-webgl-contexts=16',

  // Process optimizations
  '--renderer-process-limit=4',
  '--enable-low-end-device-mode=false',

  // =========================================================================
  // ANTI-DETECTION (for scraping)
  // =========================================================================
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',

  // =========================================================================
  // SECURITY RELAXATION (for local scraping)
  // =========================================================================
  '--disable-web-security',
  '--disable-site-isolation-trials',
  '--allow-running-insecure-content',
  '--ignore-certificate-errors',

  // =========================================================================
  // EXTENSIONS & REMOTE DEBUGGING
  // =========================================================================
  '--remote-debugging-port=0', // Let Chrome pick a port
  '--enable-features=NetworkService,NetworkServiceInProcess',

  // =========================================================================
  // AUDIO (disable for scraping performance)
  // =========================================================================
  '--mute-audio',

  // =========================================================================
  // WINDOW CONFIGURATION
  // =========================================================================
  '--window-position=0,0',
  '--start-maximized',
  '--no-first-run',
  '--no-default-browser-check',
  '--password-store=basic',
  '--use-mock-keychain',
];

// Flags to ignore from Playwright's defaults
export const IGNORED_DEFAULT_ARGS = [
  '--enable-automation',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-component-update',
  '--disable-hang-monitor',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-sync',
  '--metrics-recording-only',
  '--safebrowsing-disable-auto-update',
];

// Environment variables for Windows GPU
export const CHROME_ENV_WINDOWS: Record<string, string> = {
  // Force NVIDIA GPU if available
  '__NV_PRIME_RENDER_OFFLOAD': '1',
  '__GLX_VENDOR_LIBRARY_NAME': 'nvidia',

  // ANGLE optimizations
  'ANGLE_DEFAULT_PLATFORM': 'd3d11',

  // V8 optimizations
  'V8_FLAGS': '--max-old-space-size=4096 --optimize-for-size',
};

// Tab Capture extension configuration
export const TAB_CAPTURE_CONFIG = {
  // Maximum framerate for capture
  maxFrameRate: 60,

  // Minimum framerate (prevents dropping too low)
  minFrameRate: 30,

  // Capture resolution
  maxWidth: 1920,
  maxHeight: 1080,

  // Use hardware acceleration for capture
  useHardwareAcceleration: true,
};

// WebRTC encoding configuration for Windows
export const WEBRTC_ENCODING_CONFIG = {
  // Codec preferences (H264 has best Windows hardware support)
  preferredCodecs: ['video/H264', 'video/VP9', 'video/VP8'],

  // Bitrate settings
  video: {
    maxBitrate: 8_000_000, // 8 Mbps
    minBitrate: 2_000_000, // 2 Mbps
    startBitrate: 4_000_000, // 4 Mbps
  },

  // Low-latency encoding parameters
  encoderConfig: {
    // Use hardware encoder
    hardwareAcceleration: 'prefer-hardware' as const,

    // Low-latency mode
    latencyMode: 'realtime' as const,

    // GOP size (lower = less latency but more bandwidth)
    keyFrameInterval: 30,

    // B-frames (disable for lowest latency)
    bFrames: 0,
  },
};
