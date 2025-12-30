import React, { useEffect, useRef, useState, useCallback } from 'react';

interface BrowserViewProps {
  wsUrl: string | null;
  onFrame?: (blob: Blob) => void;
  onMessage?: (message: any) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

interface BrowserViewRef {
  send: (message: any) => void;
  click: (x: number, y: number) => void;
  scroll: (deltaY: number) => void;
}

export const BrowserView = React.forwardRef<BrowserViewRef, BrowserViewProps>(({
  wsUrl,
  onFrame,
  onMessage,
  onConnected,
  onDisconnected,
}, ref) => {
  const canvasRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const previousBlobUrlRef = useRef<string | null>(null);

  // Expose methods via ref
  React.useImperativeHandle(ref, () => ({
    send: (message: any) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(message));
      }
    },
    click: (x: number, y: number) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'click', x: Math.round(x), y: Math.round(y) }));
      }
    },
    scroll: (deltaY: number) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'scroll', deltaY }));
      }
    },
  }));

  // Connect to WebSocket
  useEffect(() => {
    if (!wsUrl) {
      setConnected(false);
      return;
    }

    setLoading(true);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Frame rendering with requestAnimationFrame
    let pendingBlobUrl: string | null = null;

    const renderFrame = () => {
      if (pendingBlobUrl && canvasRef.current) {
        if (previousBlobUrlRef.current) {
          URL.revokeObjectURL(previousBlobUrlRef.current);
        }
        previousBlobUrlRef.current = pendingBlobUrl;
        canvasRef.current.src = pendingBlobUrl;
        pendingBlobUrl = null;

        if (loading) {
          setLoading(false);
        }
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        requestAnimationFrame(renderFrame);
      }
    };

    ws.onopen = () => {
      console.log('[BrowserView] Connected');
      setConnected(true);
      onConnected?.();
      requestAnimationFrame(renderFrame);
    };

    ws.onmessage = (event) => {
      // Handle binary frames (JPEG)
      if (event.data instanceof Blob) {
        pendingBlobUrl = URL.createObjectURL(event.data);
        onFrame?.(event.data);
        return;
      }

      // Handle JSON messages
      try {
        const msg = JSON.parse(event.data);
        onMessage?.(msg);

        // Legacy base64 screenshot support
        if (msg.type === 'screenshot' && msg.data) {
          pendingBlobUrl = 'data:image/jpeg;base64,' + msg.data;
        }
      } catch (e) {
        console.error('[BrowserView] Failed to parse message:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('[BrowserView] Error:', error);
    };

    ws.onclose = () => {
      console.log('[BrowserView] Disconnected');
      setConnected(false);
      setLoading(false);
      onDisconnected?.();
    };

    return () => {
      ws.close();
      wsRef.current = null;
      if (previousBlobUrlRef.current) {
        URL.revokeObjectURL(previousBlobUrlRef.current);
        previousBlobUrlRef.current = null;
      }
    };
  }, [wsUrl, onConnected, onDisconnected, onFrame, onMessage, loading]);

  // Click handler
  const handleClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!canvasRef.current || !wsRef.current?.readyState) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.naturalWidth / rect.width;
    const scaleY = canvasRef.current.naturalHeight / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    wsRef.current.send(JSON.stringify({ type: 'click', x: Math.round(x), y: Math.round(y) }));
  }, []);

  // Scroll handler with debouncing
  const scrollTimeoutRef = useRef<number | null>(null);
  const accumulatedDeltaRef = useRef(0);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLImageElement>) => {
    e.preventDefault();
    if (!wsRef.current?.readyState) return;

    accumulatedDeltaRef.current += e.deltaY;

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Send immediately for first scroll
    if (!scrollTimeoutRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'scroll', deltaY: accumulatedDeltaRef.current }));
      accumulatedDeltaRef.current = 0;
    }

    // Batch subsequent scrolls
    scrollTimeoutRef.current = window.setTimeout(() => {
      if (accumulatedDeltaRef.current !== 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'scroll', deltaY: accumulatedDeltaRef.current }));
        accumulatedDeltaRef.current = 0;
      }
      scrollTimeoutRef.current = null;
    }, 16);
  }, []);

  if (!wsUrl) {
    return (
      <div className="browser-placeholder">
        <h3 style={{ marginBottom: '15px', color: 'var(--text-primary)' }}>Config Builder</h3>
        <p style={{ marginBottom: '20px' }}>Click "Open Browser" to load a page</p>
        <p style={{ fontSize: '0.85em', opacity: 0.7 }}>Then select elements to build your scraping config</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="browser-loading">
        <span className="spinner" style={{ width: '50px', height: '50px', marginBottom: '20px' }} />
        <p>Loading browser...</p>
      </div>
    );
  }

  return (
    <img
      ref={canvasRef}
      className="browser-canvas"
      alt="Remote Browser"
      onClick={handleClick}
      onWheel={handleWheel}
      style={{
        width: '100%',
        height: 'auto',
        cursor: 'crosshair',
        objectFit: 'contain',
        display: connected ? 'block' : 'none',
      }}
    />
  );
});

BrowserView.displayName = 'BrowserView';
