/**
 * FloatingPanel — draggable + resizable + edge-snapping window wrapper for
 * the Live controller scope panels (SRS, Comms, Brevity, Triggers, 9-line).
 *
 * Why: pre-v1.19.48 each panel rendered at a hardcoded absolute coordinate.
 * As soon as you opened 3+ they overlapped because none could be moved.
 *
 * What you get:
 *   - 22px drag handle bar at the top — grab to move.
 *   - Bottom-right resize handle — grab to resize (min 240×160).
 *   - Snap to viewport edges within 20px of the edge.
 *   - Position + size persisted to localStorage per panel id.
 *   - "Reset" wipes the persisted state across all panels.
 *
 * The wrapped panel content keeps its own internal header / title / close
 * button — FloatingPanel only adds the chrome around it.
 */

import { useEffect, useRef, useState, useCallback, type ReactNode, type CSSProperties } from 'react';

const LS_PREFIX = 'dcsopt.live.floating.';
const SNAP_PX = 20;
const MIN_W = 240;
const MIN_H = 160;
// Reserve space at the top for the LiveMap's status bar and at the bottom
// for the coord/footer chip so panels can't get dragged behind them.
const RESERVED_TOP = 52;
const RESERVED_BOTTOM = 40;

interface Rect { x: number; y: number; w: number; h: number; }

interface FloatingPanelProps {
  /** Unique key for position persistence. Use a stable string per panel. */
  id: string;
  /** First-open position + size. Used until the user drags / resizes. */
  defaultRect: Rect;
  /** Stacking order. Higher = on top. Defaults to 5 (matches the legacy
   *  z-index for panels that already used the upper layer). */
  zIndex?: number;
  /** Children render inside the panel body, below the drag bar. */
  children: ReactNode;
}

function loadRect(id: string): Rect | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    if (!raw) return null;
    const r = JSON.parse(raw) as Rect;
    if (
      typeof r.x === 'number' && typeof r.y === 'number' &&
      typeof r.w === 'number' && typeof r.h === 'number'
    ) return r;
  } catch { /* ignore */ }
  return null;
}

function saveRect(id: string, r: Rect): void {
  try { localStorage.setItem(LS_PREFIX + id, JSON.stringify(r)); }
  catch { /* ignore */ }
}

/** Wipe every persisted panel position. Used by the "reset positions"
 *  button in LiveMap so a user who's dragged a panel offscreen can
 *  recover without DevTools. */
export function resetAllFloatingPositions(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

/** Clamp + edge-snap a rect to the container bounds. Snaps within
 *  SNAP_PX of any edge (top/right/bottom/left). */
function clampSnap(r: Rect, host: { w: number; h: number }): Rect {
  let { x, y, w, h } = r;
  // Clamp size to a sane min and to the host viewport.
  w = Math.max(MIN_W, Math.min(w, host.w - 8));
  h = Math.max(MIN_H, Math.min(h, host.h - RESERVED_TOP - RESERVED_BOTTOM));
  // Clamp position so the panel can't be dragged completely off.
  x = Math.max(0, Math.min(x, host.w - w));
  y = Math.max(RESERVED_TOP, Math.min(y, host.h - h - RESERVED_BOTTOM));
  // Snap to edges.
  if (x < SNAP_PX) x = 0;
  if (host.w - (x + w) < SNAP_PX) x = host.w - w;
  if (y - RESERVED_TOP < SNAP_PX) y = RESERVED_TOP;
  if (host.h - RESERVED_BOTTOM - (y + h) < SNAP_PX) y = host.h - RESERVED_BOTTOM - h;
  return { x, y, w, h };
}

export function FloatingPanel({ id, defaultRect, zIndex = 5, children }: FloatingPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track the host (offsetParent) size so clamping/snapping is honest about
  // the actual map area rather than the whole viewport.
  const hostSize = useCallback((): { w: number; h: number } => {
    const parent = containerRef.current?.offsetParent as HTMLElement | null;
    if (parent) return { w: parent.clientWidth, h: parent.clientHeight };
    return { w: window.innerWidth, h: window.innerHeight };
  }, []);

  const [rect, setRect] = useState<Rect>(() => {
    const stored = loadRect(id);
    return stored ?? defaultRect;
  });
  // Mode of the active pointer-down → tracks whether we're dragging or
  // resizing. null when idle.
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; startRect: Rect } | null>(null);

  // After every interaction, persist + clamp on next paint so a window
  // resize doesn't strand the panel offscreen.
  useEffect(() => { saveRect(id, rect); }, [id, rect]);

  // Re-clamp on window resize.
  useEffect(() => {
    const onResize = () => setRect((r) => clampSnap(r, hostSize()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [hostSize]);

  const onPointerDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    // Ignore right-click and middle-click.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...rect },
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    let next: Rect;
    if (d.mode === 'move') {
      next = { ...d.startRect, x: d.startRect.x + dx, y: d.startRect.y + dy };
    } else {
      next = {
        ...d.startRect,
        w: d.startRect.w + dx,
        h: d.startRect.h + dy,
      };
    }
    setRect(clampSnap(next, hostSize()));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  const wrapStyle: CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    zIndex,
    display: 'flex',
    flexDirection: 'column',
    // The wrapped panel uses overflow internally; we hide ours so a
    // resize handle that pokes outside doesn't leak shadows.
    overflow: 'hidden',
    borderRadius: 4,
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
  };

  const dragBarStyle: CSSProperties = {
    height: 18,
    cursor: 'move',
    background: 'rgba(20,28,40,0.95)',
    borderBottom: '1px solid #1a2434',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 9,
    letterSpacing: 2,
    color: '#566275',
    userSelect: 'none',
    touchAction: 'none',
  };

  const resizeHandleStyle: CSSProperties = {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    cursor: 'nwse-resize',
    // SVG-ish diagonal lines using border tricks.
    background: 'linear-gradient(135deg, transparent 50%, rgba(140,160,186,0.4) 50%, rgba(140,160,186,0.4) 60%, transparent 60%, transparent 70%, rgba(140,160,186,0.4) 70%, rgba(140,160,186,0.4) 80%, transparent 80%)',
    zIndex: 1,
    touchAction: 'none',
  };

  return (
    <div ref={containerRef} style={wrapStyle}
         onPointerMove={onPointerMove}
         onPointerUp={onPointerUp}
         onPointerCancel={onPointerUp}>
      <div style={dragBarStyle}
           onPointerDown={(e) => onPointerDown(e, 'move')}
           title="Drag to move">
        ⋮⋮⋮
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      <div style={resizeHandleStyle}
           onPointerDown={(e) => onPointerDown(e, 'resize')}
           title="Drag to resize" />
    </div>
  );
}
