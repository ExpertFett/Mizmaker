import type { RefObject } from 'react';
import { useDraggable } from './useDraggable';

export function CoordinateDisplay({
  coordRef,
}: {
  coordRef: RefObject<HTMLDivElement | null>;
}) {
  const { containerRef, handleProps } = useDraggable('coordinateDisplay');

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        background: 'rgba(10, 20, 35, 0.9)',
        borderRadius: 4,
        zIndex: 100,
        minWidth: 260,
        overflow: 'hidden',
      }}
    >
      {/* Drag handle */}
      <div {...handleProps} style={{
        ...handleProps.style,
        padding: '3px 12px 1px',
        background: 'rgba(20, 40, 70, 0.4)',
        borderBottom: '1px solid rgba(26, 42, 58, 0.5)',
        fontSize: 9, color: '#4a5258', textAlign: 'center', letterSpacing: 2,
        userSelect: 'none',
      }}>⠿</div>
      <div
        ref={coordRef}
        style={{
          color: '#1a1f25',
          padding: '4px 12px 6px',
          fontSize: 12,
          fontFamily: "'B612 Mono', monospace",
          pointerEvents: 'none',
          lineHeight: 1.6,
        }}
      />
    </div>
  );
}
