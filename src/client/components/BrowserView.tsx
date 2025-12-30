// ============================================================================
// BROWSER VIEW - GPU-accelerated video display with overlay
// ============================================================================

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { ElementSelector, MouseEvent as AppMouseEvent } from '../../shared/types';

interface BrowserViewProps {
  sessionId: string | null;
  onMouseEvent: (event: AppMouseEvent) => void;
  onKeyEvent: (event: { type: 'keydown' | 'keyup'; key: string; code: string; modifiers?: any }) => void;
  onScroll: (event: { deltaX: number; deltaY: number; x: number; y: number }) => void;
  hoveredElement: ElementSelector | null;
  selectionMode: boolean;
  subscribe: (type: any, handler: (msg: any) => void) => () => void;
  viewport: { width: number; height: number };
}

export const BrowserView: React.FC<BrowserViewProps> = ({
  sessionId,
  onMouseEvent,
  onKeyEvent,
  onScroll,
  hoveredElement,
  selectionMode,
  subscribe,
  viewport,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Use viewport prop as the source of truth for dimensions
  const [dimensions, setDimensions] = useState(viewport);

  // Update dimensions when viewport changes
  useEffect(() => {
    setDimensions(viewport);
  }, [viewport]);

  // Initialize canvas context
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true, // Reduce latency
    });

    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctxRef.current = ctx;
    }
  }, []);

  // Subscribe to video frames
  useEffect(() => {
    if (!sessionId) return;

    // Subscribe to binary frames (JPEG from screencast)
    // Binary frames are handled under the 'binary' type in useWebSocket
    const unsubscribe = subscribe('binary' as any, (msg) => {
      if (msg.payload instanceof Blob) {
        const blob = msg.payload;
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
          const ctx = ctxRef.current;
          const canvas = canvasRef.current;
          if (!ctx || !canvas) return;

          // Update canvas dimensions if needed
          if (canvas.width !== img.width || canvas.height !== img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
            setDimensions({ width: img.width, height: img.height });
          }

          // Draw frame
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
        };

        img.src = url;
      }
    });

    return unsubscribe;
  }, [sessionId, subscribe]);

  // Calculate mouse position relative to browser viewport
  // Now canvas maintains its native size with max-width/max-height constraints
  const getRelativePosition = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();

      // Canvas now maintains aspect ratio via CSS
      // rect.width/height = displayed size, dimensions = internal canvas size
      const scaleX = dimensions.width / rect.width;
      const scaleY = dimensions.height / rect.height;

      // Calculate position relative to canvas
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;

      // Scale to internal canvas coordinates
      const x = relX * scaleX;
      const y = relY * scaleY;

      // Clamp to valid range
      return {
        x: Math.max(0, Math.min(dimensions.width, x)),
        y: Math.max(0, Math.min(dimensions.height, y)),
      };
    },
    [dimensions]
  );

  // Mouse event handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = getRelativePosition(e);
      onMouseEvent({
        type: 'move',
        x: pos.x,
        y: pos.y,
        button: 'left',
      });
    },
    [getRelativePosition, onMouseEvent]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const pos = getRelativePosition(e);
      const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';

      onMouseEvent({
        type: 'down',
        x: pos.x,
        y: pos.y,
        button,
        modifiers: {
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
        },
      });
    },
    [getRelativePosition, onMouseEvent]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const pos = getRelativePosition(e);
      const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';

      onMouseEvent({
        type: 'up',
        x: pos.x,
        y: pos.y,
        button,
        modifiers: {
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
        },
      });
    },
    [getRelativePosition, onMouseEvent]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = getRelativePosition(e);

      onMouseEvent({
        type: 'click',
        x: pos.x,
        y: pos.y,
        button: 'left',
        modifiers: {
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
        },
      });
    },
    [getRelativePosition, onMouseEvent]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = getRelativePosition(e);

      onMouseEvent({
        type: 'dblclick',
        x: pos.x,
        y: pos.y,
        button: 'left',
      });
    },
    [getRelativePosition, onMouseEvent]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const pos = getRelativePosition(e);

      onMouseEvent({
        type: 'contextmenu',
        x: pos.x,
        y: pos.y,
        button: 'right',
      });
    },
    [getRelativePosition, onMouseEvent]
  );

  // Wheel handler
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const pos = getRelativePosition(e);

      onScroll({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        x: pos.x,
        y: pos.y,
      });
    },
    [getRelativePosition, onScroll]
  );

  // Keyboard handlers
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      e.preventDefault();

      onKeyEvent({
        type: 'keydown',
        key: e.key,
        code: e.code,
        modifiers: {
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
        },
      });
    },
    [onKeyEvent]
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      e.preventDefault();

      onKeyEvent({
        type: 'keyup',
        key: e.key,
        code: e.code,
        modifiers: {
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
        },
      });
    },
    [onKeyEvent]
  );

  // Calculate overlay position from element bounding box
  const getOverlayStyle = useCallback((): React.CSSProperties | null => {
    if (!hoveredElement || !canvasRef.current) return null;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / dimensions.width;
    const scaleY = rect.height / dimensions.height;

    const { boundingBox } = hoveredElement;

    return {
      left: boundingBox.x * scaleX,
      top: boundingBox.y * scaleY,
      width: boundingBox.width * scaleX,
      height: boundingBox.height * scaleY,
    };
  }, [hoveredElement, dimensions]);

  const overlayStyle = getOverlayStyle();

  return (
    <div
      ref={containerRef}
      className="browser-container"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      style={{ cursor: selectionMode ? 'crosshair' : 'default' }}
    >
      {/* Main canvas for video frames */}
      <canvas
        ref={canvasRef}
        className="browser-canvas"
        width={dimensions.width}
        height={dimensions.height}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
      />

      {/* Element highlight overlay - only for hover (selected elements are highlighted in-browser) */}
      <div className="overlay-container">
        {selectionMode && hoveredElement && overlayStyle && (
          <div className="element-highlight" style={overlayStyle}>
            <div className="element-highlight-info">
              {hoveredElement.tagName}
              {hoveredElement.css && (
                <span style={{ opacity: 0.7, marginLeft: 8 }}>
                  {hoveredElement.css.substring(0, 40)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* No session overlay */}
      {!sessionId && (
        <div className="loading-overlay">
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 16 }}>No Active Session</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              Enter a URL and click "Start Session" to begin
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
