// ============================================================================
// IMAGE SLIDER COMPARISON COMPONENT
// ============================================================================
// Draggable slider to compare before/after screenshots for pagination verification

import { useState, useRef, useCallback } from 'react';

interface ImageSliderComparisonProps {
  beforeImage: string;
  afterImage: string;
  beforeLabel?: string;
  afterLabel?: string;
  height?: number;
}

export function ImageSliderComparison({
  beforeImage,
  afterImage,
  beforeLabel = 'Before',
  afterLabel = 'After',
  height = 300,
}: ImageSliderComparisonProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    handleMove(e.clientX);
  }, [handleMove]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    handleMove(e.clientX);
  }, [isDragging, handleMove]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
    handleMove(e.touches[0].clientX);
  }, [handleMove]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    handleMove(e.touches[0].clientX);
  }, [isDragging, handleMove]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div
      ref={containerRef}
      className="image-slider-comparison"
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        overflow: 'hidden',
        borderRadius: '8px',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* After image (background) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
        }}
      >
        <img
          src={`data:image/png;base64,${afterImage}`}
          alt={afterLabel}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          draggable={false}
        />
        <span
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          {afterLabel}
        </span>
      </div>

      {/* Before image (clipped by slider) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${sliderPosition}%`,
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <img
          src={`data:image/png;base64,${beforeImage}`}
          alt={beforeLabel}
          style={{
            width: `${100 / (sliderPosition / 100)}%`,
            height: '100%',
            objectFit: 'cover',
          }}
          draggable={false}
        />
        <span
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          {beforeLabel}
        </span>
      </div>

      {/* Slider handle */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: `${sliderPosition}%`,
          transform: 'translateX(-50%)',
          width: '4px',
          height: '100%',
          background: 'white',
          boxShadow: '0 0 8px rgba(0, 0, 0, 0.5)',
          cursor: 'ew-resize',
        }}
      >
        {/* Handle grip */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '32px',
            height: '32px',
            background: 'white',
            borderRadius: '50%',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: '#666' }}
          >
            <polyline points="15 18 9 12 15 6" />
            <polyline points="9 18 15 12 9 6" transform="translate(6, 0)" />
          </svg>
        </div>
      </div>

      {/* Instructions */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '4px 12px',
          borderRadius: '4px',
          fontSize: '11px',
          opacity: 0.8,
        }}
      >
        Drag to compare
      </div>
    </div>
  );
}
