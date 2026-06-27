import type { CSSProperties, MouseEvent } from 'react';

/**
 * Bottom-right resize grip for draggable floating panels. Spread a
 * `useDraggable().resizeHandleProps` onto it:
 *
 *   const { containerRef, handleProps, resizeHandleProps } = useDraggable('myPanel');
 *   <div ref={containerRef} style={{ position: 'absolute', ... }}>
 *     <div {...handleProps}>title</div>
 *     ...content...
 *     <ResizeGrip {...resizeHandleProps} />
 *   </div>
 *
 * The panel container must be `position: absolute` (it is, for dragging).
 */
export function ResizeGrip({
  onMouseDown,
  style,
}: {
  onMouseDown: (e: MouseEvent) => void;
  style?: CSSProperties;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      title="Drag to resize"
      style={{
        position: 'absolute',
        right: 2,
        bottom: 2,
        width: 16,
        height: 16,
        cursor: 'nwse-resize',
        zIndex: 50,
        ...style,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
        <path d="M15 6 L6 15 M15 11 L11 15" stroke="#6a7a8a" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}
