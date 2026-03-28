/**
 * Measure tool — draw a line on the map to see distance/bearing per segment.
 * Labels show DURING drawing (not just after completion).
 */

import { Draw } from 'ol/interaction';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Style, Stroke, Fill, Circle as CircleStyle, Text } from 'ol/style';
import { toLonLat } from 'ol/proj';
import { Point } from 'ol/geom';
import type Map from 'ol/Map';
import type { Feature } from 'ol';

import { haversineDistance, bearing } from '../../utils/navmath';
import { metersToNm } from '../../utils/conversions';

/**
 * Build measure styles for a LineString geometry.
 * Used by both the Draw interaction (live) and the VectorLayer (completed).
 */
function buildMeasureStyles(feature: Feature | any): Style[] {
  const geom = feature.getGeometry?.() ?? feature.geometry;
  if (!geom) return [];

  let coords: number[][];
  try {
    if (typeof geom.getCoordinates === 'function') {
      coords = geom.getCoordinates();
    } else {
      return [];
    }
  } catch {
    return [];
  }

  if (!coords || coords.length < 1) return [];

  const styles: Style[] = [
    new Style({
      stroke: new Stroke({ color: '#ffcc00', width: 2.5, lineDash: [8, 5] }),
    }),
  ];

  // Vertex dots
  for (const coord of coords) {
    styles.push(
      new Style({
        geometry: new Point(coord),
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: '#ffcc00' }),
          stroke: new Stroke({ color: '#000', width: 1.5 }),
        }),
      }),
    );
  }

  if (coords.length < 2) return styles;

  // Segment labels
  let totalDist = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = toLonLat(coords[i - 1]);
    const [lon2, lat2] = toLonLat(coords[i]);
    const dist = haversineDistance(lat1, lon1, lat2, lon2);
    const brg = bearing(lat1, lon1, lat2, lon2);
    totalDist += dist;

    const midX = (coords[i - 1][0] + coords[i][0]) / 2;
    const midY = (coords[i - 1][1] + coords[i][1]) / 2;

    styles.push(
      new Style({
        geometry: new Point([midX, midY]),
        text: new Text({
          text: `${metersToNm(dist).toFixed(1)} nm / ${Math.round(brg)}\u00B0`,
          font: 'bold 13px monospace',
          fill: new Fill({ color: '#ffcc00' }),
          stroke: new Stroke({ color: '#000', width: 3 }),
          offsetY: -14,
        }),
      }),
    );
  }

  // Total at last vertex
  const lastCoord = coords[coords.length - 1];
  styles.push(
    new Style({
      geometry: new Point(lastCoord),
      text: new Text({
        text: `Total: ${metersToNm(totalDist).toFixed(1)} nm`,
        font: 'bold 14px monospace',
        fill: new Fill({ color: '#fff' }),
        stroke: new Stroke({ color: '#000', width: 3 }),
        offsetY: 20,
      }),
    }),
  );

  return styles;
}

export function createMeasureTool(_map: Map): { draw: Draw; layer: VectorLayer; clear: () => void } {
  const source = new VectorSource();

  const layer = new VectorLayer({
    source,
    zIndex: 100,
    style: (feature) => buildMeasureStyles(feature),
  });

  const draw = new Draw({
    source,
    type: 'LineString',
    // Use the SAME style function for the in-progress sketch — labels show while drawing
    style: (feature) => buildMeasureStyles(feature),
  });

  draw.on('drawstart', () => {
    source.clear();
  });

  // Esc key to cancel current drawing
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      draw.abortDrawing();
      source.clear();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  const clear = () => {
    source.clear();
    draw.abortDrawing();
  };

  // Return cleanup info — caller should remove listener when measure mode ends
  const origDispose = draw.dispose.bind(draw);
  draw.dispose = () => {
    document.removeEventListener('keydown', onKeyDown);
    origDispose();
  };

  return { draw, layer, clear };
}
