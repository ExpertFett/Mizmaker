/**
 * DCS terrain road/rail overlay — the actual road network from the DCS
 * terrain files, not OSM's idea of it.
 *
 * Data is extracted offline from each map's roads/<Name>.rn4 by
 * planner/tools/extract_terrain.py and committed as static gzipped JSON the
 * backend serves per theater. So what this layer draws is exactly what
 * exists in-sim: the roads ground columns can drive on and the rail lines
 * that exist in the 3D world — which OSM basemaps get wrong wherever ED
 * diverged from reality (and for how the sim actually routes).
 *
 * Loaded lazily: nothing is fetched until the layer is first toggled on.
 * One fetch per theater per page load; ~48k segments for Kola renders fine
 * as a single vector layer with a shared style function.
 */

import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import LineString from 'ol/geom/LineString';
import { fromLonLat } from 'ol/proj';
import { Style, Stroke } from 'ol/style';

interface TerrainRoadsData {
  theater: string;
  classes: string[];
  lines: [number, [number, number][]][];
}

type Kind = 'road' | 'track' | 'rail';

/** m/px above which the minor networks drop out so zoomed-out views stay
 *  legible. Rails and primary roads always draw. */
const TRACK_MAX_RESOLUTION = 120;

const STYLES: Record<Kind, Style[]> = {
  road: [new Style({
    stroke: new Stroke({ color: 'rgba(190, 175, 130, 0.75)', width: 1.2 }),
  })],
  track: [new Style({
    stroke: new Stroke({ color: 'rgba(150, 135, 100, 0.55)', width: 1, lineDash: [4, 4] }),
  })],
  rail: [
    new Style({ stroke: new Stroke({ color: 'rgba(230, 230, 235, 0.5)', width: 2.4 }) }),
    new Style({ stroke: new Stroke({ color: 'rgba(60, 60, 65, 0.9)', width: 1.4, lineDash: [7, 7] }) }),
  ],
};

function kindOf(className: string): Kind {
  // Class naming differs per map (Kola: primary/track/rail_main,
  // Iraq: asphalt_2l/dirt_2l/rail_2l) — match by substring.
  const n = className.toLowerCase();
  if (n.includes('rail') || n.includes('tram')) return 'rail';
  if (n.includes('track') || n.includes('dirt')) return 'track';
  return 'road';
}

export function createTerrainRoadsLayer(): VectorLayer {
  const layer = new VectorLayer({
    source: new VectorSource(),
    properties: { name: 'dcsRoads' },
    zIndex: 4, // under threats (10) and units
    visible: false,
    updateWhileInteracting: false,
    updateWhileAnimating: false,
    style: (feature, resolution) => {
      const kind = feature.get('kind') as Kind;
      if (kind === 'track' && resolution > TRACK_MAX_RESOLUTION) return undefined;
      return STYLES[kind];
    },
  });
  return layer;
}

/** Fetch + populate for a theater; no-op if that theater is already loaded.
 *  Missing data (unknown theater) marks the layer failed so we don't
 *  re-fetch on every toggle. */
export async function loadTerrainRoads(layer: VectorLayer, theater: string): Promise<void> {
  const loadedFor = layer.get('loadedTheater');
  if (loadedFor === theater || layer.get('loading')) return;
  layer.set('loading', true);
  try {
    const res = await fetch(`/api/terrain/${encodeURIComponent(theater)}/roads`);
    if (!res.ok) {
      layer.set('loadedTheater', theater); // remember the miss too
      return;
    }
    const data: TerrainRoadsData = await res.json();
    const source = layer.getSource()!;
    source.clear();
    const features: Feature[] = [];
    for (const [clsIdx, coords] of data.lines) {
      if (coords.length < 2) continue;
      const geom = new LineString(coords.map(([lat, lon]) => fromLonLat([lon, lat])));
      const f = new Feature({ geometry: geom });
      f.set('kind', kindOf(data.classes[clsIdx] ?? ''), true);
      features.push(f);
    }
    source.addFeatures(features);
    layer.set('loadedTheater', theater);
  } catch {
    // network hiccup — leave unloaded so the next toggle retries
  } finally {
    layer.set('loading', false);
  }
}
