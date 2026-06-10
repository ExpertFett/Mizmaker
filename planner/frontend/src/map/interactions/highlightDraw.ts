/**
 * Highlight draw interaction (v1.19.74) — freehand marker pen for
 * collaborative map annotation.
 *
 * Any session participant can highlight; the stroke saves to the
 * session's planner_drawings immediately on pen-up and broadcasts to
 * every connected client over the existing drawings_update SSE event.
 * No role gating — the whole point is that a wingman can flag what
 * the flight lead missed.
 *
 * Live preview while dragging uses an amber stand-in style; the final
 * stroke renders through plannerDrawingLayer's buildHighlight (marker-
 * pen body + author label).
 */

import { Draw } from 'ol/interaction';
import VectorSource from 'ol/source/Vector';
import { toLonLat } from 'ol/proj';
import { Style, Stroke } from 'ol/style';
import type Map from 'ol/Map';

interface HighlightCallbacks {
  onFinish: (coords: [number, number][]) => void;
}

/** Live-drag preview style — amber marker pen, slightly translucent
 *  so the user sees the stroke shape before pen-up commits it. */
const PREVIEW = new Style({
  stroke: new Stroke({
    color: 'rgba(255, 165, 0, 0.5)',
    width: 8,
    lineCap: 'round',
    lineJoin: 'round',
  }),
});

export function createHighlightDraw(
  _map: Map,
  callbacks: HighlightCallbacks,
): Draw {
  const draw = new Draw({
    source: new VectorSource(),
    type: 'LineString',
    freehand: true,
    style: PREVIEW,
  });

  draw.on('drawend', (e) => {
    const geom = e.feature.getGeometry() as unknown as { getCoordinates(): number[][] };
    const rawCoords = geom.getCoordinates();
    // Decimate long freehand strokes: at full pointer resolution a
    // single swipe can be 500+ points — wasteful over SSE and in the
    // .json session payload. Keep every 3rd point + always the last.
    // Visual difference at marker-pen width is nil.
    const step = rawCoords.length > 120 ? 3 : 1;
    const coords: [number, number][] = [];
    for (let i = 0; i < rawCoords.length; i += step) {
      coords.push(toLonLat(rawCoords[i]) as [number, number]);
    }
    const last = toLonLat(rawCoords[rawCoords.length - 1]) as [number, number];
    if (coords.length === 0 || coords[coords.length - 1][0] !== last[0] || coords[coords.length - 1][1] !== last[1]) {
      coords.push(last);
    }
    if (coords.length >= 2) callbacks.onFinish(coords);
  });

  return draw;
}

/**
 * Stable per-author highlight color. Hash the author name onto a
 * fixed palette so the same wingman is always the same color in a
 * session, and two different wingmen are (probably) different colors.
 * Palette avoids pure red/blue — those mean hostile/friendly on this
 * map, and a highlight is neither.
 */
const AUTHOR_PALETTE = [
  '#ffa500', // amber
  '#3fb950', // green
  '#a371f7', // violet
  '#f778ba', // pink
  '#56d4dd', // cyan
  '#e3b341', // gold
  '#ff7b72', // coral
  '#7ee787', // mint
];

export function highlightColorFor(author: string): string {
  let h = 0;
  for (let i = 0; i < author.length; i++) {
    h = ((h << 5) - h + author.charCodeAt(i)) | 0;
  }
  return AUTHOR_PALETTE[Math.abs(h) % AUTHOR_PALETTE.length];
}
