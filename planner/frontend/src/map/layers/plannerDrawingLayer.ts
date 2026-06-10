/**
 * Planner drawing layer — renders auto-generated overlays:
 * corridors, threat rings, reference lines, racetracks.
 */

import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import { LineString, Polygon, Circle as CircleGeom } from 'ol/geom';
import { fromLonLat, getPointResolution } from 'ol/proj';
import { Style, Fill, Stroke, Text } from 'ol/style';
import type { PlannerDrawing } from '../../types/mission';

const NM_TO_METERS = 1852;

export function createPlannerDrawingLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    properties: { name: 'plannerDrawings' },
    zIndex: 6,
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function labelStyle(name: string, color: string): Text {
  return new Text({
    text: name,
    font: '12px system-ui, sans-serif',
    fill: new Fill({ color }),
    stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 3 }),
    overflow: true,
    offsetY: -14,
  });
}

function offsetPolyline(coords: number[][], dist: number): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < coords.length; i++) {
    let nx = 0, ny = 0;
    if (i < coords.length - 1) {
      const dx = coords[i + 1][0] - coords[i][0];
      const dy = coords[i + 1][1] - coords[i][1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) { nx = -dy / len; ny = dx / len; }
    } else if (i > 0) {
      const dx = coords[i][0] - coords[i - 1][0];
      const dy = coords[i][1] - coords[i - 1][1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) { nx = -dy / len; ny = dx / len; }
    }
    result.push([coords[i][0] + nx * dist, coords[i][1] + ny * dist]);
  }
  return result;
}

function semiCircleArc(center: number[], radius: number, startAngle: number, steps = 16): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (Math.PI * i) / steps;
    pts.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return pts;
}

export function populatePlannerDrawingLayer(layer: VectorLayer, drawings: PlannerDrawing[]): void {
  const source = layer.getSource()!;
  source.clear();

  for (const d of drawings) {
    if (!d.visible || d.coords.length === 0) continue;
    const features = buildFeatures(d);
    for (const f of features) source.addFeature(f);
  }
}

function buildFeatures(d: PlannerDrawing): Feature[] {
  switch (d.type) {
    case 'corridor': return buildCorridor(d);
    case 'threatRing': return buildThreatRing(d);
    case 'referenceLine': return buildReferenceLine(d);
    case 'racetrack': return buildRacetrack(d);
    case 'highlight': return buildHighlight(d);
    default: return [];
  }
}

/**
 * v1.19.74 — collaborative highlight stroke. Renders like a marker
 * pen: thick semi-transparent core with a thin opaque centre line so
 * it stays legible over any basemap. The author's name renders at
 * the stroke midpoint so a flight lead can see WHO flagged it.
 */
function buildHighlight(d: PlannerDrawing): Feature[] {
  if (d.coords.length < 2) return [];
  const mapCoords = d.coords.map((c) => fromLonLat(c));
  const geometry = new LineString(mapCoords);

  const feature = new Feature({ geometry });
  feature.setStyle([
    // Wide translucent "marker pen" body
    new Style({
      stroke: new Stroke({ color: hexToRgba(d.color, 0.35), width: 10, lineCap: 'round', lineJoin: 'round' }),
    }),
    // Thin solid core + author label
    new Style({
      stroke: new Stroke({ color: hexToRgba(d.color, 0.9), width: 2, lineCap: 'round', lineJoin: 'round' }),
      text: d.author ? labelStyle(d.author, d.color) : undefined,
    }),
  ]);
  feature.setId(`planner-${d.id}`);
  return [feature];
}

function buildCorridor(d: PlannerDrawing): Feature[] {
  if (d.coords.length < 2) return [];
  const mapCoords = d.coords.map((c) => fromLonLat(c));
  const widthM = (d.widthNm ?? 5) * NM_TO_METERS;

  const mid = mapCoords[Math.floor(mapCoords.length / 2)];
  const res = getPointResolution('EPSG:3857', 1, mid);
  const halfW = (widthM / 2) / res;

  const left = offsetPolyline(mapCoords, halfW);
  const right = offsetPolyline(mapCoords, -halfW);
  const ring = [...left, ...right.reverse(), left[0]];

  const poly = new Feature({ geometry: new Polygon([ring]) });
  poly.setStyle(new Style({
    fill: new Fill({ color: hexToRgba(d.color, 0.1) }),
    stroke: new Stroke({ color: hexToRgba(d.color, 0.5), width: 1.5 }),
  }));
  poly.setId(`planner-${d.id}-fill`);

  const line = new Feature({ geometry: new LineString(mapCoords) });
  line.setStyle(new Style({
    stroke: new Stroke({ color: hexToRgba(d.color, 0.35), width: 1, lineDash: [6, 4] }),
    text: labelStyle(d.name, d.color),
  }));
  line.setId(`planner-${d.id}-line`);

  return [poly, line];
}

function buildThreatRing(d: PlannerDrawing): Feature[] {
  if (d.coords.length < 1) return [];
  const center = fromLonLat(d.coords[0]);
  const radiusM = (d.radiusNm ?? 20) * NM_TO_METERS;
  const res = getPointResolution('EPSG:3857', 1, center);
  const radiusProj = radiusM / res;

  const feature = new Feature({ geometry: new CircleGeom(center, radiusProj) });
  feature.setStyle(new Style({
    fill: new Fill({ color: hexToRgba(d.color, 0.06) }),
    stroke: new Stroke({ color: hexToRgba(d.color, 0.5), width: 1.5 }),
    text: labelStyle(d.name, d.color),
  }));
  feature.setId(`planner-${d.id}`);
  return [feature];
}

function buildReferenceLine(d: PlannerDrawing): Feature[] {
  if (d.coords.length < 2) return [];
  const mapCoords = d.coords.map((c) => fromLonLat(c));
  const dash = d.lineStyle === 'solid' ? undefined : [10, 6];

  const feature = new Feature({ geometry: new LineString(mapCoords) });
  feature.setStyle(new Style({
    stroke: new Stroke({ color: hexToRgba(d.color, 0.7), width: 2, lineDash: dash }),
    text: labelStyle(d.name, d.color),
  }));
  feature.setId(`planner-${d.id}`);
  return [feature];
}

function buildRacetrack(d: PlannerDrawing): Feature[] {
  if (d.coords.length < 2) return [];
  const p1 = fromLonLat(d.coords[0]);
  const p2 = fromLonLat(d.coords[1]);
  const widthM = (d.widthNm ?? 5) * NM_TO_METERS;

  const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const res = getPointResolution('EPSG:3857', 1, mid);
  const halfW = (widthM / 2) / res;

  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [];
  const nx = -dy / len;
  const ny = dx / len;

  const tl = [p1[0] + nx * halfW, p1[1] + ny * halfW];
  const tr = [p2[0] + nx * halfW, p2[1] + ny * halfW];
  const br = [p2[0] - nx * halfW, p2[1] - ny * halfW];
  const bl = [p1[0] - nx * halfW, p1[1] - ny * halfW];

  const angle2 = Math.atan2(ny, nx);
  const arc2 = semiCircleArc(p2, halfW, angle2 - Math.PI / 2, 16);
  const arc1 = semiCircleArc(p1, halfW, angle2 + Math.PI / 2, 16);

  const ring = [tl, tr, ...arc2, br, bl, ...arc1, tl];

  const poly = new Feature({ geometry: new Polygon([ring]) });
  poly.setStyle(new Style({
    fill: new Fill({ color: hexToRgba(d.color, 0.08) }),
    stroke: new Stroke({ color: hexToRgba(d.color, 0.5), width: 1.5 }),
  }));
  poly.setId(`planner-${d.id}-fill`);

  const line = new Feature({ geometry: new LineString([p1, p2]) });
  line.setStyle(new Style({
    stroke: new Stroke({ color: hexToRgba(d.color, 0.35), width: 1, lineDash: [6, 4] }),
    text: labelStyle(d.name, d.color),
  }));
  line.setId(`planner-${d.id}-line`);

  return [poly, line];
}
