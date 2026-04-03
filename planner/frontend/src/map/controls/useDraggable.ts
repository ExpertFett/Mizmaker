import { useRef, useCallback, useEffect, useState } from 'react';

/**
 * Hook that makes any absolutely-positioned element draggable by its header/handle area.
 * Panels snap (dock) to screen edges when dragged within SNAP_DISTANCE pixels.
 *
 * Usage:
 *   const { containerRef, handleProps, docked } = useDraggable();
 *   <div ref={containerRef} style={{ position: 'absolute', ... }}>
 *     <div {...handleProps} style={{ cursor: 'grab' }}>Drag here</div>
 *     ...
 *   </div>
 */

const SNAP_DISTANCE = 40; // px from edge to trigger snap

export type DockEdge = 'top' | 'right' | 'bottom' | 'left' | null;

export function useDraggable() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const [docked, setDocked] = useState<DockEdge>(null);
  const [, forceRender] = useState(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left mouse button
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;

    // Get current position BEFORE changing any styles
    const rect = el.getBoundingClientRect();
    const parentRect = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const curLeft = rect.left - parentRect.left;
    const curTop = rect.top - parentRect.top;

    // Calculate offset from mouse to element top-left (relative to parent)
    offset.current = {
      x: e.clientX - curLeft,
      y: e.clientY - curTop,
    };

    // Pin to left/top FIRST, then clear right/bottom so it doesn't jump
    el.style.left = `${curLeft}px`;
    el.style.top = `${curTop}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';

    dragging.current = true;
    setDocked(null);

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
    setDocked(null);
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
      if (!dragging.current || !containerRef.current) return;
      dragging.current = false;

      // Check if near an edge — snap/dock
      const el = containerRef.current;
      const parentRect = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const rect = el.getBoundingClientRect();
      const relLeft = rect.left - parentRect.left;
      const relTop = rect.top - parentRect.top;
      const relRight = parentRect.width - (relLeft + rect.width);
      const relBottom = parentRect.height - (relTop + rect.height);

      // Find closest edge within snap distance
      const edges: { edge: DockEdge; dist: number }[] = [
        { edge: 'left', dist: relLeft },
        { edge: 'right', dist: relRight },
        { edge: 'top', dist: relTop },
        { edge: 'bottom', dist: relBottom },
      ];
      const closest = edges.reduce((a, b) => (a.dist < b.dist ? a : b));

      if (closest.dist <= SNAP_DISTANCE) {
        // Snap to edge
        if (closest.edge === 'left') {
          el.style.left = '0px';
        } else if (closest.edge === 'right') {
          el.style.left = `${parentRect.width - rect.width}px`;
        } else if (closest.edge === 'top') {
          el.style.top = '0px';
        } else if (closest.edge === 'bottom') {
          el.style.top = `${parentRect.height - rect.height}px`;
        }
        setDocked(closest.edge);
      } else {
        setDocked(null);
      }

      forceRender((n) => n + 1);
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
    docked,
    handleProps: {
      onMouseDown,
      style: { cursor: 'grab' } as React.CSSProperties,
    },
  };
}
