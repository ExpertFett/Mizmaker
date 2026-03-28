import type { RefObject } from 'react';

export function CoordinateDisplay({
  coordRef,
}: {
  coordRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={coordRef}
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        background: 'rgba(10, 20, 35, 0.9)',
        color: '#8fa8c0',
        padding: '6px 12px',
        borderRadius: 4,
        fontSize: 11,
        fontFamily: 'monospace',
        zIndex: 100,
        pointerEvents: 'none',
        lineHeight: 1.6,
        minWidth: 260,
      }}
    />
  );
}
