/**
 * Off-screen OpenLayers map renderer for kneeboard route snapshots.
 *
 * Creates a temporary map, draws the route with waypoint markers and labels,
 * renders to canvas, and returns a data URL. Cleans up after itself.
 */

import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import CircleGeom from 'ol/geom/Circle';
import { fromLonLat } from 'ol/proj';
import { boundingExtent } from 'ol/extent';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import type { MissionGroup, ThreatRing } from '../types/mission';

const ROUTE_COLOR = '#4a8fd4';
const WP_COLOR = '#ffa500';
const LABEL_COLOR = '#fff';

interface CaptureOptions {
  width?: number;
  height?: number;
  padding?: number;
}

export async function captureRouteImage(
  group: MissionGroup,
  options: CaptureOptions = {},
): Promise<string> {
  const { width = 560, height = 400, padding = 40 } = options;

  const wps = group.waypoints.filter((w) => w.lat != null && w.lon != null);
  if (wps.length === 0) throw new Error('No waypoints with coordinates');

  // Create container
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  document.body.appendChild(container);

  // Route line
  const routeCoords = wps.map((w) => fromLonLat([w.lon!, w.lat!]));
  const routeFeature = new Feature(new LineString(routeCoords));
  routeFeature.setStyle(new Style({
    stroke: new Stroke({ color: ROUTE_COLOR, width: 3 }),
  }));

  // Waypoint dots + labels
  const wpFeatures = wps.map((w) => {
    const f = new Feature(new Point(fromLonLat([w.lon!, w.lat!])));
    f.setStyle(new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: w.waypoint_number === 0 ? '#3fb950' : WP_COLOR }),
        stroke: new Stroke({ color: '#000', width: 1 }),
      }),
      text: new Text({
        text: `${w.waypoint_number}${w.waypoint_name ? ' ' + w.waypoint_name : ''}`,
        font: 'bold 13px Arial',
        fill: new Fill({ color: LABEL_COLOR }),
        stroke: new Stroke({ color: '#000', width: 3 }),
        offsetY: -16,
        textAlign: 'center',
      }),
    }));
    return f;
  });

  // Leg distance labels on route midpoints
  const legLabels: Feature[] = [];
  for (let i = 1; i < wps.length; i++) {
    const prev = wps[i - 1];
    const curr = wps[i];
    if (!prev.lat || !prev.lon || !curr.lat || !curr.lon) continue;
    const midLat = (prev.lat + curr.lat) / 2;
    const midLon = (prev.lon + curr.lon) / 2;
    const dist = curr.leg_distance_nm;
    const brg = curr.leg_bearing_deg;
    if (dist == null) continue;

    const label = new Feature(new Point(fromLonLat([midLon, midLat])));
    label.setStyle(new Style({
      text: new Text({
        text: `${dist.toFixed(1)}nm ${brg != null ? Math.round(brg) + '°' : ''}`,
        font: '11px Arial',
        fill: new Fill({ color: '#ccc' }),
        stroke: new Stroke({ color: '#000', width: 2 }),
        offsetY: 12,
      }),
    }));
    legLabels.push(label);
  }

  const vectorSource = new VectorSource({
    features: [routeFeature, ...wpFeatures, ...legLabels],
  });

  const vectorLayer = new VectorLayer({ source: vectorSource });

  // Dark base tile layer
  const baseLayer = new TileLayer({
    source: new XYZ({
      url: 'https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attributions: '',
      crossOrigin: 'anonymous',
    }),
  });

  // Compute extent
  const lonLats = wps.map((w) => fromLonLat([w.lon!, w.lat!]));
  const extent = boundingExtent(lonLats);

  const map = new Map({
    target: container,
    layers: [baseLayer, vectorLayer],
    view: new View({ maxZoom: 14, minZoom: 3 }),
    controls: [],
    interactions: [],
  });

  map.getView().fit(extent, { padding: [padding, padding, padding, padding], maxZoom: 12 });

  // Wait for tiles to load via rendercomplete event
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 5000); // max 5s
    map.once('rendercomplete', () => {
      clearTimeout(timeout);
      resolve();
    });
    map.renderSync();
  });

  // Capture canvas
  const mapCanvas = container.querySelector('canvas');
  if (!mapCanvas) {
    map.dispose();
    document.body.removeChild(container);
    throw new Error('No canvas found');
  }

  const dataUrl = mapCanvas.toDataURL('image/png');

  // Cleanup
  map.dispose();
  document.body.removeChild(container);

  return dataUrl;
}

/**
 * Overview map for the wing brief: ALL player flight tracks (one color each)
 * + enemy threat rings on a single image. Returns a PNG data URL. Same
 * off-screen render + cleanup pattern as captureRouteImage.
 */
const OVERVIEW_PALETTE = ['#4a9eff', '#3fb950', '#e8833a', '#c090d0', '#5ad0c0', '#d29922', '#f06292'];

export async function captureOverviewImage(
  groups: MissionGroup[],
  threats: ThreatRing[],
  options: CaptureOptions = {},
): Promise<string> {
  const { width = 760, height = 520, padding = 56 } = options;

  const features: Feature[] = [];
  const extentPts: number[][] = [];
  let ci = 0;

  // Flight tracks
  for (const g of groups) {
    const wps = (g.waypoints || []).filter((w) => w.lat != null && w.lon != null);
    if (wps.length < 1) continue;
    const color = OVERVIEW_PALETTE[ci % OVERVIEW_PALETTE.length]; ci++;
    const coords = wps.map((w) => fromLonLat([w.lon!, w.lat!]));
    coords.forEach((c) => extentPts.push(c));
    if (coords.length >= 2) {
      const line = new Feature(new LineString(coords));
      line.setStyle(new Style({ stroke: new Stroke({ color, width: 3 }) }));
      features.push(line);
    }
    // Start dot + flight label
    const f0 = new Feature(new Point(coords[0]));
    f0.setStyle(new Style({
      image: new CircleStyle({ radius: 5, fill: new Fill({ color }), stroke: new Stroke({ color: '#000', width: 1 }) }),
      text: new Text({
        text: g.groupName || '', font: 'bold 12px Arial',
        fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#000', width: 3 }), offsetY: -12,
      }),
    }));
    features.push(f0);
    for (let i = 1; i < coords.length; i++) {
      const f = new Feature(new Point(coords[i]));
      f.setStyle(new Style({ image: new CircleStyle({ radius: 3, fill: new Fill({ color }), stroke: new Stroke({ color: '#000', width: 1 }) }) }));
      features.push(f);
    }
  }

  // Threat rings (Web-Mercator scales distance by 1/cos(lat), so a ground
  // radius R needs R/cos(lat) projected to render true-to-scale).
  for (const t of threats || []) {
    if (t.lat == null || t.lon == null || !t.range) continue;
    const center = fromLonLat([t.lon, t.lat]);
    const r = t.range / Math.max(0.15, Math.cos((t.lat * Math.PI) / 180));
    const col = t.coalition === 'blue' ? '#4a8fd4' : t.coalition === 'neutral' ? '#d29922' : '#d95050';
    const ring = new Feature(new CircleGeom(center, r));
    ring.setStyle(new Style({
      stroke: new Stroke({ color: col, width: 1.3, lineDash: [5, 4] }),
      fill: new Fill({ color: col + '1a' }),
    }));
    features.push(ring);
    extentPts.push([center[0] - r, center[1] - r], [center[0] + r, center[1] + r]);
  }

  if (extentPts.length === 0) throw new Error('No routes or threats to map');

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  document.body.appendChild(container);

  const vectorLayer = new VectorLayer({ source: new VectorSource({ features }) });
  const baseLayer = new TileLayer({
    source: new XYZ({
      url: 'https://{a-c}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attributions: '', crossOrigin: 'anonymous',
    }),
  });
  const map = new Map({
    target: container,
    layers: [baseLayer, vectorLayer],
    view: new View({ maxZoom: 14, minZoom: 3 }),
    controls: [], interactions: [],
  });
  map.getView().fit(boundingExtent(extentPts), { padding: [padding, padding, padding, padding], maxZoom: 11 });

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 5000);
    map.once('rendercomplete', () => { clearTimeout(timeout); resolve(); });
    map.renderSync();
  });

  const mapCanvas = container.querySelector('canvas');
  if (!mapCanvas) { map.dispose(); document.body.removeChild(container); throw new Error('No canvas found'); }
  const dataUrl = mapCanvas.toDataURL('image/png');
  map.dispose();
  document.body.removeChild(container);
  return dataUrl;
}
