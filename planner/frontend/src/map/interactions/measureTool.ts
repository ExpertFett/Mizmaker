/**
 * Measure tool — draw a line on the map and see distance/bearing per segment.
 */

import { Draw } from 'ol/interaction';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Style, Stroke, Fill, Circle as CircleStyle, Text } from 'ol/style';
import { toLonLat } from 'ol/proj';
import { LineString, Point } from 'ol/geom';
import Feature from 'ol/Feature';
import type Map from 'ol/Map';
import { haversineDistance, bearing } from '../../utils/navmath';
import { metersToNm } from '../../utils/conversions';

export function createMeasureTool(map: Map): { draw: Draw; layer: VectorLayer } {
  const source = new VectorSource();

  const layer = new VectorLayer({
    source,
    zIndex: 100,
    style: (feature) => {
      const geom = feature.getGeometry();
      if (!geom || geom.getType() !== 'LineString') return [];
      const coords = (geom as LineString).getCoordinates();
      if (coords.length < 2) return [];

      const styles: Style[] = [
        new Style({
          stroke: new Stroke({ color: '#ffcc00', width: 2, lineDash: [6, 4] }),
        }),
      ];

      // Labels at each segment midpoint
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
              font: 'bold 11px monospace',
              fill: new Fill({ color: '#ffcc00' }),
              stroke: new Stroke({ color: '#000', width: 3 }),
              offsetY: -12,
            }),
          }),
        );
      }

      // Total distance at end
      if (coords.length > 2) {
        const lastCoord = coords[coords.length - 1];
        styles.push(
          new Style({
            geometry: new Point(lastCoord),
            text: new Text({
              text: `Total: ${metersToNm(totalDist).toFixed(1)} nm`,
              font: 'bold 12px monospace',
              fill: new Fill({ color: '#fff' }),
              stroke: new Stroke({ color: '#000', width: 3 }),
              offsetY: 16,
            }),
          }),
        );
      }

      // Vertex dots
      for (const coord of coords) {
        styles.push(
          new Style({
            geometry: new Point(coord),
            image: new CircleStyle({
              radius: 4,
              fill: new Fill({ color: '#ffcc00' }),
              stroke: new Stroke({ color: '#000', width: 1 }),
            }),
          }),
        );
      }

      return styles;
    },
  });

  const drawStyle = new Style({
    stroke: new Stroke({ color: '#ffcc00', width: 2, lineDash: [6, 4] }),
    image: new CircleStyle({
      radius: 4,
      fill: new Fill({ color: '#ffcc00' }),
    }),
  });

  const draw = new Draw({
    source,
    type: 'LineString',
    style: drawStyle,
  });

  // Clear previous measurements when starting a new one
  draw.on('drawstart', () => {
    source.clear();
  });

  return { draw, layer };
}
