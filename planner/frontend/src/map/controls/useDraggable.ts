import { useRef, useCallback, useEffect, useState } from 'react';

/**
 * Hook that makes any absolutely-positioned element draggable by its header/handle area.
 * Returns a ref to attach to the draggable container and a handleMouseDown for the drag handle.
 *
 * Usage:
 *   const { containerRef, handleProps } = useDraggable();
 *   <div ref={containerRef} style={{ position: 'absolute', ... }}>
 *     <div {...handleProps} style={{ cursor: 'grab' }}>Drag here</div>
 *     ...
 *   </div>
 */
export function useDraggable() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const [, forceRender] = useState(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left mouse button
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;

    // Get current position
    const rect = el.getBoundingClientRect();
    const parentRect = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };

    // Calculate offset from mouse to element top-left (relative to parent)
    offset.current = {
      x: e.clientX - (rect.left - parentRect.left),
      y: e.clientY - (rect.top - parentRect.top),
    };

    dragging.current = true;

    // Clear any CSS positioning that isn't left/top so we can position freely
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';

    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** Reset inline drag styles so the element returns to its CSS-defined position */
  const resetPosition = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = '';
    }
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const el = containerRef.current;
      const parentRect = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

      let newLeft = e.clientX - offset.current.x;
      let newTop = e.clientY - offset.current.y;

      // Clamp to parent bounds
      const maxLeft = parentRect.width - el.offsetWidth;
      const maxTop = parentRect.height - el.offsetHeight;
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
    };

    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        forceRender((n) => n + 1); // trigger re-render to sync React state
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return {
    containerRef,
    resetPosition,
    handleProps: {
      onMouseDown,
      style: { cursor: 'grab' } as React.CSSProperties,
    },
  };
}
