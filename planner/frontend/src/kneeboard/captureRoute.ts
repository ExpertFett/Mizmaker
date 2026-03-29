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
import { fromLonLat } from 'ol/proj';
import { boundingExtent } from 'ol/extent';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import type { MissionGroup } from '../types/mission';

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
