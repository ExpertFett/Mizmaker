/**
 * DmpiMapPanel — embedded OpenLayers map for the DMPI tab.
 *
 * The DMPI tab used to be a table-only view; picking coordinates on a
 * map meant switching to the Map tab, picking, and the Map tab routed
 * the click back through dmpiStore. That round-trip cost the user
 * visual context of the OTHER DMPIs already placed. This panel lifts
 * the map up onto the DMPI tab so the planner sees the full target
 * picture while building the strike package.
 *
 * What it shows:
 *   - CARTO dark tile basemap (matches the kneeboard route maps so the
 *     planner sees a consistent palette).
 *   - One marker per defined DMPI (red diamond + number + name).
 *   - Threats (red rings) and airbases (gold dots) from missionStore so
 *     the planner can avoid SAM coverage when picking.
 *   - Bullseye marker from missionStore.overview.bullseye if present.
 *
 * What it does:
 *   - Click anywhere → if `pickingForId` is set in dmpiStore, capture
 *     the lat/lon and write it onto that DMPI. Same surface as the main
 *     map's pick-mode.
 *   - Fits view to: the DMPIs (if any with non-zero coords) → else the
 *     theater center → else a sane world fallback.
 *
 * Implementation notes:
 *   - We DON'T reuse MapContainer.tsx because that component owns a
 *     bunch of mission-editing surface (waypoint drag, threat draw,
 *     measure, weather panel) we don't want here. Lighter is better.
 *   - Inline styles match the rest of the editor tabs.
 *   (v1.19.23)
 */

import { useEffect, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { Feature } from 'ol';
import { Point, Circle as CircleGeom } from 'ol/geom';
import { fromLonLat, toLonLat } from 'ol/proj';
import { boundingExtent } from 'ol/extent';
import { Style, Circle as CircleStyle, RegularShape, Fill, Stroke, Text } from 'ol/style';
import { defaults as defaultControls } from 'ol/control';
import ScaleLine from 'ol/control/ScaleLine';
import 'ol/ol.css';

import { useDmpiStore } from '../../store/dmpiStore';
import { useMissionStore } from '../../store/missionStore';

// v1.19.58 — basemap options. Was hardcoded to CARTO dark to match the
// kneeboard route maps; Fett asked for "at least map options" so the
// planner can switch to a light or satellite view when picking DMPIs
// on a detailed background. Keys persisted to localStorage so the
// choice survives mission swaps.
const BASEMAPS: { id: BasemapId; label: string; url: string; attribution: string }[] = [
  { id: 'dark',  label: 'Dark',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    attribution: '© CARTO © OpenStreetMap' },
  { id: 'light', label: 'Light',
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: '© CARTO © OpenStreetMap' },
  { id: 'osm',   label: 'OSM',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors' },
  { id: 'sat',   label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri' },
];
type BasemapId = 'dark' | 'light' | 'osm' | 'sat';
const BASEMAP_LS_KEY = 'dcsopt.editor.dmpiBasemap';
function loadBasemap(): BasemapId {
  try {
    const v = localStorage.getItem(BASEMAP_LS_KEY);
    if (v === 'dark' || v === 'light' || v === 'osm' || v === 'sat') return v;
  } catch { /* ignore */ }
  return 'dark';
}

// (Legacy TILE_URL constant removed in v1.19.58 — basemap is now
// chosen at component mount via the BASEMAPS array + localStorage.)

// Theater centers — copied from MapContainer so we can position the
// view sensibly when there are no DMPIs yet.
const THEATER_CENTERS: Record<string, [number, number]> = {
  Caucasus: [43.5, 41.0],
  Syria: [37.0, 35.0],
  PersianGulf: [56.0, 26.0],
  Nevada: [-115.8, 36.2],
  SinaiMap: [33.0, 30.0],
  Normandy: [-0.6, 49.2],
  TheChannel: [2.3, 51.0],
  MarianaIslands: [145.0, 15.0],
  Falklands: [-59.0, -51.5],
  Kola: [33.0, 69.0],
  Afghanistan: [65.0, 34.0],
  Iraq: [44.0, 33.0],
  TopEndAustralia: [131.0, -12.5],
  SouthEastAsia: [106.0, 14.0],
  GermanyCW: [11.0, 51.0],
};

const DMPI_COLOR = '#d95050';
const THREAT_COLOR = '#e0554f';
const AIRBASE_COLOR = '#d29922';
const BULLSEYE_COLOR = '#f0b840';

function dmpiStyle(label: string, isPickTarget: boolean): Style[] {
  const ring = isPickTarget
    ? new Style({
        image: new CircleStyle({
          radius: 16,
          stroke: new Stroke({ color: '#4a8fd4', width: 2 }),
        }),
      })
    : null;
  return [
    ...(ring ? [ring] : []),
    new Style({
      // Red diamond — distinct from threats (rings) and airbases (dots).
      image: new RegularShape({
        radius: 9,
        points: 4,
        angle: Math.PI / 4,
        fill: new Fill({ color: DMPI_COLOR }),
        stroke: new Stroke({ color: '#000', width: 1.5 }),
      }),
      text: new Text({
        text: label,
        offsetY: -16,
        font: '600 11px B612, system-ui, sans-serif',
        fill: new Fill({ color: '#fff' }),
        stroke: new Stroke({ color: '#000', width: 3 }),
      }),
    }),
  ];
}

function bullseyeStyle(): Style[] {
  return [
    new Style({
      image: new CircleStyle({
        radius: 4,
        fill: new Fill({ color: BULLSEYE_COLOR }),
        stroke: new Stroke({ color: '#000', width: 1 }),
      }),
      text: new Text({
        text: 'BE',
        offsetY: -12,
        font: '600 10px B612, system-ui, sans-serif',
        fill: new Fill({ color: BULLSEYE_COLOR }),
        stroke: new Stroke({ color: '#000', width: 2.5 }),
      }),
    }),
  ];
}

function airbaseStyle(name: string): Style {
  return new Style({
    image: new CircleStyle({
      radius: 3,
      fill: new Fill({ color: AIRBASE_COLOR }),
      stroke: new Stroke({ color: '#000', width: 0.8 }),
    }),
    text: new Text({
      text: name,
      offsetY: -10,
      font: '500 9px B612, system-ui, sans-serif',
      fill: new Fill({ color: '#cccccc' }),
      stroke: new Stroke({ color: '#000', width: 2 }),
    }),
  });
}

function threatStyle(): Style {
  return new Style({
    stroke: new Stroke({ color: THREAT_COLOR, width: 1.3 }),
    fill: new Fill({ color: 'rgba(224, 85, 79, 0.07)' }),
  });
}

export function DmpiMapPanel({ height = 380 }: { height?: number }) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const dmpiSrcRef = useRef<VectorSource>(new VectorSource());
  const threatSrcRef = useRef<VectorSource>(new VectorSource());
  const airbaseSrcRef = useRef<VectorSource>(new VectorSource());
  const bullseyeSrcRef = useRef<VectorSource>(new VectorSource());
  // v1.19.58 — basemap state + persisted choice.
  const [basemap, setBasemap] = useState<BasemapId>(() => loadBasemap());
  useEffect(() => {
    try { localStorage.setItem(BASEMAP_LS_KEY, basemap); } catch { /* ignore */ }
    if (baseLayerRef.current) {
      const cfg = BASEMAPS.find((b) => b.id === basemap) ?? BASEMAPS[0];
      baseLayerRef.current.setSource(new XYZ({
        url: cfg.url,
        crossOrigin: 'anonymous',
        maxZoom: 19,
        attributions: cfg.attribution,
      }));
    }
  }, [basemap]);

  const dmpis = useDmpiStore((s) => s.dmpis);
  const pickingForId = useDmpiStore((s) => s.pickingForId);
  const finishPicking = useDmpiStore((s) => s.finishPicking);

  const theater = useMissionStore((s) => s.theater);
  const threats = useMissionStore((s) => s.threats);
  const airbases = useMissionStore((s) => s.airbases);
  const bullseyeBlue = useMissionStore((s) => s.overview?.bullseye?.blue);

  // Mount the map once.
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const initialCfg = BASEMAPS.find((b) => b.id === basemap) ?? BASEMAPS[0];
    const baseLayer = new TileLayer({
      source: new XYZ({
        url: initialCfg.url,
        crossOrigin: 'anonymous',
        maxZoom: 19,
        attributions: initialCfg.attribution,
      }),
    });
    baseLayerRef.current = baseLayer;
    const threatLayer = new VectorLayer({ source: threatSrcRef.current, style: threatStyle });
    const airbaseLayer = new VectorLayer({
      source: airbaseSrcRef.current,
      style: (f) => airbaseStyle(String(f.get('name') || '')),
    });
    const bullseyeLayer = new VectorLayer({ source: bullseyeSrcRef.current, style: bullseyeStyle });
    const dmpiLayer = new VectorLayer({
      source: dmpiSrcRef.current,
      style: (f) => dmpiStyle(String(f.get('label') || ''), !!f.get('isPickTarget')),
    });

    const initialCenter = (theater ? THEATER_CENTERS[theater] : undefined) ?? [0, 0];
    const map = new Map({
      target: mapElRef.current,
      layers: [baseLayer, threatLayer, airbaseLayer, bullseyeLayer, dmpiLayer],
      view: new View({
        center: fromLonLat(initialCenter),
        zoom: 6,
      }),
      controls: defaultControls({ attribution: false }).extend([new ScaleLine({ units: 'nautical' })]),
    });

    // Click handler — only writes coords when the dmpiStore is armed
    // for pick. Reading getState() each time so the latest pickingForId
    // is seen without re-subscribing the click handler.
    map.on('click', (e) => {
      const target = useDmpiStore.getState().pickingForId;
      if (!target) return;
      const [lon, lat] = toLonLat(e.coordinate);
      finishPicking(lat, lon);
    });

    mapRef.current = map;
    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, [theater, finishPicking]);

  // Repopulate DMPI markers whenever the list / pick target changes.
  useEffect(() => {
    const src = dmpiSrcRef.current;
    src.clear();
    const feats: Feature[] = [];
    dmpis.forEach((d, i) => {
      if (!d.lat || !d.lon) return; // skip blank rows
      const f = new Feature({ geometry: new Point(fromLonLat([d.lon, d.lat])) });
      const number = i + 1;
      const label = d.name ? `${number}. ${d.name}` : `DMPI ${number}`;
      f.set('label', label);
      f.set('isPickTarget', d.id === pickingForId);
      feats.push(f);
    });
    src.addFeatures(feats);

    // Auto-fit view to DMPIs (if any). Skip when picking — we don't want
    // to zoom-jump out from under the user mid-click.
    if (!pickingForId && feats.length && mapRef.current) {
      const coords = feats.map((f) => (f.getGeometry() as Point).getCoordinates());
      if (coords.length === 1) {
        mapRef.current.getView().animate({ center: coords[0], zoom: 9, duration: 400 });
      } else {
        mapRef.current.getView().fit(boundingExtent(coords), {
          padding: [50, 50, 50, 50], maxZoom: 11, duration: 400,
        });
      }
    }
  }, [dmpis, pickingForId]);

  // Threats — red rings at the SAM/AAA range.
  useEffect(() => {
    const src = threatSrcRef.current;
    src.clear();
    threats.forEach((t) => {
      if (typeof t.lat !== 'number' || typeof t.lon !== 'number' || !t.range) return;
      const center = fromLonLat([t.lon, t.lat]);
      // OL's Circle geometry takes a radius in projection units (meters
      // at the equator for EPSG:3857). At higher latitudes that
      // overshoots; for a visual reference it's close enough.
      src.addFeature(new Feature({ geometry: new CircleGeom(center, t.range) }));
    });
  }, [threats]);

  // Airbase dots.
  useEffect(() => {
    const src = airbaseSrcRef.current;
    src.clear();
    airbases.forEach((a) => {
      if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return;
      const f = new Feature({ geometry: new Point(fromLonLat([a.lon, a.lat])) });
      f.set('name', a.name);
      src.addFeature(f);
    });
  }, [airbases]);

  // Bullseye.
  useEffect(() => {
    const src = bullseyeSrcRef.current;
    src.clear();
    if (bullseyeBlue?.lat && bullseyeBlue?.lon) {
      src.addFeature(new Feature({ geometry: new Point(fromLonLat([bullseyeBlue.lon, bullseyeBlue.lat])) }));
    }
  }, [bullseyeBlue]);

  // Crosshair cursor when picking.
  useEffect(() => {
    if (!mapElRef.current) return;
    mapElRef.current.style.cursor = pickingForId ? 'crosshair' : '';
  }, [pickingForId]);

  // v1.19.58 — recenter on the active theater (or the world origin if
  // we don't recognize the theater). Same fit-extent logic used by the
  // editor's MapContainer.
  const resetView = () => {
    if (!mapRef.current) return;
    const view = mapRef.current.getView();
    const ctr = (theater ? THEATER_CENTERS[theater] : undefined) ?? [0, 0];
    view.setCenter(fromLonLat(ctr));
    view.setZoom(6);
  };

  return (
    <div style={{ position: 'relative', marginBottom: 12 }}>
      <div
        ref={mapElRef}
        style={{
          width: '100%',
          height,
          background: '#0d131d',
          border: `1px solid ${pickingForId ? '#4a8fd4' : '#3a3a3a'}`,
          borderRadius: 6,
        }}
      />
      {/* v1.19.58 — basemap toggle + reset view. Floating top-right
          over the map. Honoured-low z-index so it doesn't sit over
          OL's own attribution / scale-line. */}
      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 3,
        display: 'flex', gap: 4, padding: 3,
        background: 'rgba(13,19,29,0.92)',
        border: '1px solid #2a3340',
        borderRadius: 4,
        fontFamily: 'inherit',
      }}>
        {BASEMAPS.map((b) => (
          <button key={b.id}
                  onClick={() => setBasemap(b.id)}
                  title={`Basemap: ${b.label}`}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11, fontWeight: 600,
                    background: basemap === b.id ? 'rgba(74,158,255,0.15)' : 'transparent',
                    border: `1px solid ${basemap === b.id ? '#4a9eff66' : 'transparent'}`,
                    borderRadius: 3,
                    color: basemap === b.id ? '#9cd0ff' : '#aaa',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}>
            {b.label}
          </button>
        ))}
        <span style={{ width: 1, background: '#2a3340', margin: '2px 1px' }} />
        <button onClick={resetView}
                title="Recenter on the active theater + reset zoom"
                style={{
                  padding: '4px 10px',
                  fontSize: 11, fontWeight: 600,
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 3,
                  color: '#aaa',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
          ↺ Reset
        </button>
      </div>
    </div>
  );
}
