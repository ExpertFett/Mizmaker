/**
 * DCS mission drawings layer — renders Lines, Polygons, TextBoxes from the .miz.
 * These are the drawings created with the DCS mission editor drawing tool.
 */

import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import Circle from 'ol/geom/Circle';
import { fromLonLat, getPointResolution } from 'ol/proj';
import { Style, Fill, Stroke, Text } from 'ol/style';

export interface MissionDrawing {
  type: string;        // "Line", "Polygon", "TextBox"
  name: string;
  layer: string;       // "Red", "Blue", "Neutral", "Common", "Author"
  color: string;       // CSS rgba()
  fillColor?: string;
  thickness: number;
  // TextBox
  text?: string;
  fontSize?: number;
  lat?: number;
  lon?: number;
  // Line / Polygon
  coords?: [number, number][];  // [lon, lat] pairs
  closed?: boolean;
  style?: string;
  // Polygon specific
  polygonMode?: string;
  radius?: number;     // for circle mode
}

const DASH_PATTERNS: Record<string, number[] | undefined> = {
  solid: undefined,
  dot: [2, 6],
  dash: [10, 6],
  dotdash: [10, 6, 2, 6],
};

export function createDrawingLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    properties: { name: 'drawings' },
    zIndex: 5,
  });
}

export function populateDrawingLayer(layer: VectorLayer, drawings: MissionDrawing[]): void {
  const source = layer.getSource()!;
  source.clear();

  for (const d of drawings) {
    if (d.type === 'TextBox' && d.lat != null && d.lon != null) {
      const feature = new Feature({
        geometry: new Point(fromLonLat([d.lon, d.lat])),
        drawing: d,
      });
      feature.setStyle(
        new Style({
          text: new Text({
            text: d.text || d.name,
            font: `${d.fontSize || 12}px sans-serif`,
            fill: new Fill({ color: d.color }),
            stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 2 }),
            backgroundFill: d.fillColor ? new Fill({ color: d.fillColor }) : undefined,
            padding: [2, 4, 2, 4],
          }),
        }),
      );
      source.addFeature(feature);
    }

    else if (d.type === 'Line' && d.coords && d.coords.length >= 2) {
      const olCoords = d.coords.map((c) => fromLonLat(c));
      if (d.closed) olCoords.push(olCoords[0]);

      const feature = new Feature({
        geometry: new LineString(olCoords),
        drawing: d,
      });
      feature.setStyle(
        new Style({
          stroke: new Stroke({
            color: d.color,
            width: Math.max(1, d.thickness / 2),
            lineDash: DASH_PATTERNS[d.style || 'solid'],
          }),
        }),
      );
      source.addFeature(feature);
    }

    else if (d.type === 'Polygon' && d.polygonMode === 'circle' && d.lat != null && d.lon != null && d.radius) {
      const center = fromLonLat([d.lon, d.lat]);
      const resolution = getPointResolution('EPSG:3857', 1, center);
      const feature = new Feature({
        geometry: new Circle(center, d.radius / resolution),
        drawing: d,
      });
      feature.setStyle(
        new Style({
          stroke: new Stroke({ color: d.color, width: Math.max(1, d.thickness / 2) }),
          fill: d.fillColor ? new Fill({ color: d.fillColor }) : undefined,
        }),
      );
      source.addFeature(feature);
    }

    else if (d.type === 'Polygon' && d.coords && d.coords.length >= 3) {
      const olCoords = d.coords.map((c) => fromLonLat(c));
      const feature = new Feature({
        geometry: new Polygon([olCoords]),
        drawing: d,
      });

      const styles: Style[] = [
        new Style({
          stroke: new Stroke({
            color: d.color,
            width: Math.max(1, d.thickness / 2),
          }),
          fill: d.fillColor ? new Fill({ color: d.fillColor }) : undefined,
        }),
      ];

      // Add label at centroid
      if (d.name) {
        styles.push(
          new Style({
            text: new Text({
              text: d.name,
              font: '11px sans-serif',
              fill: new Fill({ color: d.color }),
              stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 2 }),
            }),
          }),
        );
      }

      feature.setStyle(styles);
      source.addFeature(feature);
    }
  }
}
