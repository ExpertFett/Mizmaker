/**
 * Shared registry of draggable panel positions so panels can snap/dock to each other.
 * Each panel registers its DOM element; during drag-end we query siblings for snap targets.
 */

const panels = new Map<string, HTMLElement>();

export function registerPanel(id: string, el: HTMLElement) {
  panels.set(id, el);
}

export function unregisterPanel(id: string) {
  panels.delete(id);
}

export interface SnapResult {
  x: number | null; // snapped left position, or null if no snap on this axis
  y: number | null;
}

/**
 * Given the dragged panel's rect (relative to parent) and a snap distance,
 * check all sibling panels for edge-to-edge proximity and return snap offsets.
 */
export function snapToSiblings(
  selfId: string,
  selfRect: DOMRect,
  parentRect: DOMRect,
  snapDist: number,
): SnapResult {
  let snapX: number | null = null;
  let snapY: number | null = null;
  let bestDx = snapDist + 1;
  let bestDy = snapDist + 1;

  for (const [id, el] of panels) {
    if (id === selfId) continue;
    if (!el.offsetParent) continue;

    const sib = el.getBoundingClientRect();

    // Only consider snapping if the panels overlap on the perpendicular axis
    const overlapY = selfRect.bottom > sib.top && selfRect.top < sib.bottom;
    const overlapX = selfRect.right > sib.left && selfRect.left < sib.right;

    if (overlapY) {
      // Snap self's right edge to sibling's left edge
      const d1 = Math.abs(selfRect.right - sib.left);
      if (d1 < bestDx && d1 <= snapDist) {
        bestDx = d1;
        snapX = sib.left - selfRect.width - parentRect.left;
      }
      // Snap self's left edge to sibling's right edge
      const d2 = Math.abs(selfRect.left - sib.right);
      if (d2 < bestDx && d2 <= snapDist) {
        bestDx = d2;
        snapX = sib.right - parentRect.left;
      }
    }

    if (overlapX) {
      // Snap self's bottom edge to sibling's top edge
      const d3 = Math.abs(selfRect.bottom - sib.top);
      if (d3 < bestDy && d3 <= snapDist) {
        bestDy = d3;
        snapY = sib.top - selfRect.height - parentRect.top;
      }
      // Snap self's top edge to sibling's bottom edge
      const d4 = Math.abs(selfRect.top - sib.bottom);
      if (d4 < bestDy && d4 <= snapDist) {
        bestDy = d4;
        snapY = sib.bottom - parentRect.top;
      }
    }
  }

  return { x: snapX, y: snapY };
}
