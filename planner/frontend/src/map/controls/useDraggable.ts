import { useRef, useCallback, useEffect, useState } from 'react';
import { registerPanel, unregisterPanel, snapToSiblings } from './panelRegistry';

/**
 * Hook that makes any absolutely-positioned element draggable by its header/handle area.
 * Panels snap (dock) to screen edges AND to sibling panels when dragged within SNAP_DISTANCE.
 *
 * Usage:
 *   const { containerRef, handleProps, docked } = useDraggable('myPanel');
 *   <div ref={containerRef} style={{ position: 'absolute', ... }}>
 *     <div {...handleProps} style={{ cursor: 'grab' }}>Drag here</div>
 *     ...
 *   </div>
 */

const SNAP_DISTANCE = 40; // px from edge to trigger snap

export type DockEdge = 'top' | 'right' | 'bottom' | 'left' | null;

let panelCounter = 0;

export function useDraggable(panelId?: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const resizing = useRef(false);
  const resizeStart = useRef({ mx: 0, my: 0, w: 0, h: 0 });
  const offset = useRef({ x: 0, y: 0 });
  const [docked, setDocked] = useState<DockEdge>(null);
  const [, forceRender] = useState(0);
  const idRef = useRef(panelId ?? `panel-${++panelCounter}`);

  // Register/unregister with the shared panel registry
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    registerPanel(idRef.current, el);
    return () => unregisterPanel(idRef.current);
  }, []);

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

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const parentRect = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    // Pin top-left so the box grows toward bottom-right, not from center.
    el.style.left = `${rect.left - parentRect.left}px`;
    el.style.top = `${rect.top - parentRect.top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
    resizeStart.current = { mx: e.clientX, my: e.clientY, w: rect.width, h: rect.height };
    resizing.current = true;
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
      // Resize takes priority over drag.
      if (resizing.current && containerRef.current) {
        const el = containerRef.current;
        const parentRect = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        const rect = el.getBoundingClientRect();
        const relLeft = rect.left - parentRect.left;
        const relTop = rect.top - parentRect.top;
        let w = Math.max(240, resizeStart.current.w + (e.clientX - resizeStart.current.mx));
        let h = Math.max(160, resizeStart.current.h + (e.clientY - resizeStart.current.my));
        // Don't grow past the container's right/bottom edge (that just re-clips it).
        w = Math.min(w, parentRect.width - relLeft - 2);
        h = Math.min(h, parentRect.height - relTop - 2);
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.style.maxWidth = 'none';
        el.style.maxHeight = 'none';
        return;
      }
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
      if (resizing.current) {
        resizing.current = false;
        forceRender((n) => n + 1);
        return;
      }
      if (!dragging.current || !containerRef.current) return;
      dragging.current = false;

      const el = containerRef.current;
      const parentRect = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const rect = el.getBoundingClientRect();
      const relLeft = rect.left - parentRect.left;
      const relTop = rect.top - parentRect.top;
      const relRight = parentRect.width - (relLeft + rect.width);
      const relBottom = parentRect.height - (relTop + rect.height);

      let finalLeft = relLeft;
      let finalTop = relTop;

      // 1) Check sibling panel snapping first
      const sibSnap = snapToSiblings(
        idRef.current,
        rect,
        parentRect as DOMRect,
        SNAP_DISTANCE,
      );
      if (sibSnap.x !== null) finalLeft = sibSnap.x;
      if (sibSnap.y !== null) finalTop = sibSnap.y;

      // 2) Check screen edge snapping (only on axes not already snapped to a sibling)
      const edges: { edge: DockEdge; dist: number }[] = [
        { edge: 'left', dist: relLeft },
        { edge: 'right', dist: relRight },
        { edge: 'top', dist: relTop },
        { edge: 'bottom', dist: relBottom },
      ];
      const closest = edges.reduce((a, b) => (a.dist < b.dist ? a : b));

      if (closest.dist <= SNAP_DISTANCE) {
        if (sibSnap.x === null) {
          if (closest.edge === 'left') finalLeft = 0;
          else if (closest.edge === 'right') finalLeft = parentRect.width - rect.width;
        }
        if (sibSnap.y === null) {
          if (closest.edge === 'top') finalTop = 0;
          else if (closest.edge === 'bottom') finalTop = parentRect.height - rect.height;
        }
        setDocked(closest.edge);
      } else {
        setDocked(null);
      }

      // Clamp final position
      finalLeft = Math.max(0, Math.min(finalLeft, parentRect.width - rect.width));
      finalTop = Math.max(0, Math.min(finalTop, parentRect.height - rect.height));

      el.style.left = `${finalLeft}px`;
      el.style.top = `${finalTop}px`;

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
    /** Spread onto a <ResizeGrip /> (or any corner element) to make the panel
     *  resizable. Pairs with the bottom-right grip; size is held on the DOM
     *  element (like the drag position), so it lasts until the panel unmounts. */
    resizeHandleProps: {
      onMouseDown: onResizeMouseDown,
    },
  };
}
