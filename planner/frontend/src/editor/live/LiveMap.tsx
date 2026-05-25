/**
 * LiveMap — tactical display + control for the Live terminal.
 *
 * Styled to mirror the DCS Olympus web client: a full-bleed dark map with
 * floating glass panels — a top command/status bar, a left spawn dock, a
 * right unit-control panel, an armed-action banner, and a live cursor
 * coordinate readout along the bottom. Units render as NATO-ish, category-
 * shaped markers colored by coalition.
 *
 * Admin controls (unchanged wiring): click a unit to inspect/task/smoke/
 * delete; arm Move/Attack/Fire/Bomb then click the map/target; Spawn mode →
 * pick a type from the server's unit DB → click the map to spawn it.
 */

import { useEffect, useRef, useState } from 'react';
import OlMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Cluster from 'ol/source/Cluster';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import CircleGeom from 'ol/geom/Circle';
import LineString from 'ol/geom/LineString';
import { fromLonLat, toLonLat } from 'ol/proj';
import { getDistance } from 'ol/sphere';
import { Style, Circle as CircleStyle, RegularShape, Fill, Stroke, Text } from 'ol/style';
import { boundingExtent } from 'ol/extent';
import 'ol/ol.css';
import {
  getTelemetry, sendCommand, getUnitDatabase,
  type GroupSummary, type ServerProfile, type UnitCategory, type UnitDbEntry,
} from '../../api/groups';

// ── Olympus-style palette ──────────────────────────────────────────────────
const C = {
  bg: 'rgba(13,19,29,0.92)',
  bgSolid: '#0d131d',
  border: '#243349',
  borderHi: '#3a6ea5',
  accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.18)',
  text: '#dce6f2',
  textDim: '#8aa0ba',
  red: '#e0554f',
  blue: '#5a9fd4',
  neutral: '#bbbbbb',
  green: '#3fb950',
};
const SIDE_COLOR: Record<number, string> = { 0: C.neutral, 1: C.red, 2: C.blue };
const CAT_CMD: Record<UnitCategory, string> = {
  groundunit: 'spawnGroundUnits', aircraft: 'spawnAircrafts',
  helicopter: 'spawnHelicopters', navyunit: 'spawnNavyUnits',
};
const CATEGORIES: { id: UnitCategory; label: string }[] = [
  { id: 'groundunit', label: 'Ground' }, { id: 'aircraft', label: 'Aircraft' },
  { id: 'helicopter', label: 'Helicopter' }, { id: 'navyunit', label: 'Navy' },
];

// Category-shaped, coalition-colored markers (cached so polls don't re-alloc).
const _styleCache: Record<string, Style> = {};
function styleForUnit(coalition: number | undefined, category?: string): Style {
  const cat = (category || '').toLowerCase();
  const bucket = cat.includes('heli') ? 'air'
    : cat.includes('air') || cat.includes('plane') ? 'air'
    : cat.includes('navy') || cat.includes('ship') ? 'navy'
    : cat.includes('ground') ? 'ground' : 'dot';
  const side = coalition ?? -1;
  const key = `${side}|${bucket}`;
  if (_styleCache[key]) return _styleCache[key];
  const color = SIDE_COLOR[side] ?? C.neutral;
  const fill = new Fill({ color });
  const stroke = new Stroke({ color: 'rgba(0,0,0,0.65)', width: 1.25 });
  let image;
  if (bucket === 'air') image = new RegularShape({ points: 3, radius: 7, fill, stroke });        // triangle
  else if (bucket === 'navy') image = new RegularShape({ points: 4, radius: 6, angle: 0, fill, stroke }); // diamond
  else if (bucket === 'ground') image = new RegularShape({ points: 4, radius: 5.5, angle: Math.PI / 4, fill, stroke }); // square
  else image = new CircleStyle({ radius: 4.5, fill, stroke });
  return (_styleCache[key] = new Style({ image }));
}

interface UnitT {
  olympusID?: number; name?: string; unitName?: string; category?: string;
  coalition?: number; alive?: number; controlled?: number; human?: number;
  position?: { lat: number; lng: number; alt?: number };
}

// Style for a cluster of N ground units: count badge colored by majority side.
function clusterStyle(features: Feature[]): Style {
  if (features.length === 1) { const u = features[0].get('unit') as UnitT | undefined; return styleForUnit(u?.coalition, u?.category); }
  let red = 0, blue = 0;
  for (const f of features) { const c = (f.get('unit') as UnitT | undefined)?.coalition; if (c === 1) red++; else if (c === 2) blue++; }
  const side = red > blue ? 1 : blue > red ? 2 : 0;
  const color = SIDE_COLOR[side] ?? C.neutral;
  return new Style({
    image: new CircleStyle({ radius: 11, fill: new Fill({ color: hexA(color, 0.85) }), stroke: new Stroke({ color: 'rgba(0,0,0,0.6)', width: 1.5 }) }),
    text: new Text({ text: String(features.length), font: 'bold 11px sans-serif', fill: new Fill({ color: '#0b0f16' }) }),
  });
}

// Measure-tool feature styling: dashed line, white vertices, range/bearing labels.
function measureFeatureStyle(feature: Feature): Style {
  const label = feature.get('_label') as string | undefined;
  if (label) return new Style({
    text: new Text({ text: label, font: feature.get('_total') ? 'bold 12px sans-serif' : '11px sans-serif', offsetY: -12,
      fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
      backgroundFill: new Fill({ color: 'rgba(10,15,22,0.7)' }), padding: [2, 4, 1, 4] }),
  });
  if (feature.get('_vertex')) return new Style({
    image: new CircleStyle({ radius: 3.5, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 1 }) }),
  });
  return new Style({ stroke: new Stroke({ color: '#ffd24a', width: 2, lineDash: [6, 4] }) });
}

// Airbase coalition can be a number (0/1/2) or string ("neutral"/"red"/"blue").
function airbaseColor(c: unknown): string {
  if (typeof c === 'number') return SIDE_COLOR[c] ?? C.neutral;
  const s = String(c ?? '').toLowerCase();
  return s === 'red' ? C.red : s === 'blue' ? C.blue : C.neutral;
}
// Threat-range rings (engagement = weapons, acquisition = detection). Web-
// Mercator scales distance by 1/cos(lat), so a ground radius R metres needs a
// projected radius R/cos(lat) to render true-to-scale at the unit's latitude.
function ringFeature(lat: number, lng: number, rangeM: number, kind: 'eng' | 'acq', coalition?: number): Feature {
  const color = SIDE_COLOR[coalition ?? -1] ?? C.neutral;
  const radius = rangeM / Math.max(0.15, Math.cos(lat * Math.PI / 180));
  const ft = new Feature({ geometry: new CircleGeom(fromLonLat([lng, lat]), radius) });
  ft.setStyle(new Style(kind === 'eng'
    ? { stroke: new Stroke({ color, width: 1.4 }), fill: new Fill({ color: hexA(color, 0.06) }) }
    : { stroke: new Stroke({ color, width: 1, lineDash: [6, 6] }) }));
  return ft;
}
// Initial true bearing (deg) from lon/lat a to b.
function bearingDeg(a: number[], b: number[]): number {
  const f1 = a[1] * Math.PI / 180, f2 = b[1] * Math.PI / 180;
  const dl = (b[0] - a[0]) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Append "AA" alpha to a #rrggbb color.
function hexA(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex + a : hex;
}

// Airbase marker: hollow coalition-ringed square + the field name underneath.
function airbaseStyle(coalition: unknown, name: string): Style {
  const color = airbaseColor(coalition);
  return new Style({
    image: new RegularShape({ points: 4, radius: 7, angle: Math.PI / 4,
      fill: new Fill({ color: 'rgba(0,0,0,0.4)' }), stroke: new Stroke({ color, width: 2 }) }),
    text: new Text({ text: name, offsetY: 15, font: '11px sans-serif',
      fill: new Fill({ color: '#cfe0f0' }), stroke: new Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }) }),
  });
}

// GroundUnit blueprint types Olympus treats as SAM / air-defense (the rest are
// "ground"). Confirmed against a live Olympus unit database.
const SAM_TYPES = new Set(['SAM Site', 'SAM Site Parts', 'Radar (EWR)', 'AAA', 'AirDefence']);

// A boolean toggle persisted to localStorage (default ON unless stored '0').
function usePersistedToggle(key: string): [boolean, () => void] {
  const [v, setV] = useState<boolean>(() => { try { return localStorage.getItem(key) !== '0'; } catch { return true; } });
  const toggle = () => setV((p) => { const n = !p; try { localStorage.setItem(key, n ? '1' : '0'); } catch { /* ignore */ } return n; });
  return [v, toggle];
}

export function LiveMap({ group, profile }: { group: GroupSummary; profile: ServerProfile }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const coordRef = useRef<HTMLSpanElement | null>(null);
  const mapRef = useRef<OlMap | null>(null);
  const srcRef = useRef<VectorSource | null>(null);
  const abSrcRef = useRef<VectorSource | null>(null);   // airbase markers
  const abLayerRef = useRef<any>(null);                 // airbase layer (for show/hide)
  const ringSrcRef = useRef<VectorSource | null>(null); // engagement/acquisition rings
  const rangesRef = useRef<Map<string, { eng: number; acq: number }>>(new Map());  // unit type-name -> ranges (m)
  const groundSrcRef = useRef<VectorSource | null>(null);  // ground units (fed into the cluster)
  const clusterSrcRef = useRef<any>(null);                 // ol Cluster wrapping groundSrc
  const measureSrcRef = useRef<VectorSource | null>(null); // measure-tool line + labels
  const fittedRef = useRef(false);
  // Persistent unit store (merge across polls so units don't blink out on a
  // delta frame / decode hiccup). Removed when explicitly dead or absent ~3 polls.
  const unitsRef = useRef<Record<string, { u: UnitT; miss: number }>>({});
  const feedLenRef = useRef(0);                  // last poll's raw feed length (for dbg)
  const renderRef = useRef<() => void>(() => {});  // rebuild features from store (filters applied)
  const samNamesRef = useRef<Set<string>>(new Set());  // ground unit type-names classified as SAM/air-defense
  const isAdmin = group.role === 'admin';

  const [counts, setCounts] = useState({ red: 0, blue: 0, other: 0 });
  const [dbg, setDbg] = useState('');
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<UnitT | null>(null);
  const [cmdMsg, setCmdMsg] = useState('');
  // Armed map action: next map/unit click applies it to the unit `id`.
  const [armed, setArmed] = useState<{ kind: 'move' | 'attack' | 'fireAtArea' | 'bombPoint'; id: number } | null>(null);
  const [ctlAlt, setCtlAlt] = useState('');
  const [ctlSpd, setCtlSpd] = useState('');

  // Protected (Mission Editor) units: Olympus marks a unit `controlled:0` until
  // it's first commanded, after which it flips to 1 ("becomes an Olympus unit").
  // When protection is ON (default), commanding such a unit asks for confirmation
  // first; once commanded it unlocks. Persisted per-browser.
  const [protectMode, toggleProtect] = usePersistedToggle('dcsopt.live.protect');
  const [showLockHelp, setShowLockHelp] = useState(false);
  const selProtected = !!selected && protectMode && selected.controlled === 0 && selected.human !== 1;
  // Gate a command on the selected unit behind a confirm if it's protected.
  const guard = (run: () => void) => {
    if (selProtected && !window.confirm(`"${selected!.unitName || selected!.name || 'This unit'}" is a protected Mission Editor unit.\n\nCommanding it unlocks it and abandons its scripted mission. Continue?`)) return;
    run();
  };

  // Map-layer visibility filters (persisted per-browser).
  const [showHuman, toggleHuman] = usePersistedToggle('dcsopt.live.human');
  const [showOlympus, toggleOlympus] = usePersistedToggle('dcsopt.live.olympus');
  const [showDcs, toggleDcs] = usePersistedToggle('dcsopt.live.dcs');
  const [showRed, toggleRed] = usePersistedToggle('dcsopt.live.red');
  const [showBlue, toggleBlue] = usePersistedToggle('dcsopt.live.blue');
  const [showNeutral, toggleNeutral] = usePersistedToggle('dcsopt.live.neutral');
  const [showAircraft, toggleAircraft] = usePersistedToggle('dcsopt.live.aircraft');
  const [showHelicopter, toggleHelicopter] = usePersistedToggle('dcsopt.live.helicopter');
  const [showSam, toggleSam] = usePersistedToggle('dcsopt.live.sam');
  const [showGround, toggleGround] = usePersistedToggle('dcsopt.live.ground');
  const [showNavy, toggleNavy] = usePersistedToggle('dcsopt.live.navy');
  const [showAirbase, toggleAirbase] = usePersistedToggle('dcsopt.live.airbase');
  const [showDead, toggleDead] = usePersistedToggle('dcsopt.live.dead');
  const [showEng, toggleEng] = usePersistedToggle('dcsopt.live.engrings');
  const [showAcq, toggleAcq] = usePersistedToggle('dcsopt.live.acqrings');
  const [clusterGround, toggleCluster] = usePersistedToggle('dcsopt.live.cluster');

  // Rebuild the vector layer from the persistent unit store, applying the
  // human / Olympus visibility filters + counts. Reassigned each render so it
  // captures current filter state; called after every poll and on each toggle.
  renderRef.current = () => {
    const src = srcRef.current; if (!src) return;
    src.clear();
    const ringSrc = ringSrcRef.current; ringSrc?.clear();
    const groundSrc = groundSrcRef.current; groundSrc?.clear();
    let red = 0, blue = 0, other = 0, plotted = 0; const pts: number[][] = [];
    for (const { u } of Object.values(unitsRef.current)) {
      const p = u.position;
      if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
      if (!showHuman && u.human === 1) continue;
      if (!showOlympus && u.controlled === 1 && u.human !== 1) continue;
      if (!showDcs && u.controlled !== 1 && u.human !== 1) continue;
      if (!showRed && u.coalition === 1) continue;
      if (!showBlue && u.coalition === 2) continue;
      if (!showNeutral && u.coalition !== 1 && u.coalition !== 2) continue;
      const cat = (u.category || '').toLowerCase();
      const isGround = cat.includes('ground');
      const isSam = isGround && samNamesRef.current.has(u.name || '');
      if (!showAircraft && cat.includes('aircraft')) continue;
      if (!showHelicopter && cat.includes('helicopter')) continue;
      if (!showNavy && cat.includes('navy')) continue;
      if (!showSam && isSam) continue;
      if (!showGround && isGround && !isSam) continue;
      if (!showDead && u.alive === 0) continue;
      plotted++;
      if (u.coalition === 1) red++; else if (u.coalition === 2) blue++; else other++;
      const coord = fromLonLat([p.lng, p.lat]); pts.push(coord);
      const ft = new Feature({ geometry: new Point(coord) });
      ft.set('unit', u);
      if (isGround && groundSrc) {
        groundSrc.addFeature(ft);  // ground units are styled by the cluster layer
      } else {
        ft.setStyle(styleForUnit(u.coalition, u.category)); src.addFeature(ft);
      }
      // Threat rings (live units only) from the unit's blueprint ranges.
      if (ringSrc && u.alive !== 0 && (showEng || showAcq)) {
        const r = rangesRef.current.get(u.name || '');
        if (r) {
          if (showAcq && r.acq > 0) ringSrc.addFeature(ringFeature(p.lat, p.lng, r.acq, 'acq', u.coalition));
          if (showEng && r.eng > 0) ringSrc.addFeature(ringFeature(p.lat, p.lng, r.eng, 'eng', u.coalition));
        }
      }
    }
    clusterSrcRef.current?.refresh();  // re-cluster ground units after the rebuild
    setCounts({ red, blue, other });
    setDbg(`feed ${feedLenRef.current} · plotted ${plotted}`);
    if (!fittedRef.current && pts.length && mapRef.current) {
      mapRef.current.getView().fit(boundingExtent(pts), { padding: [60, 60, 60, 60], maxZoom: 11 });
      fittedRef.current = true;
    }
  };

  // Spawn state
  const [mode, setMode] = useState<'select' | 'spawn'>('select');
  const [spawnCat, setSpawnCat] = useState<UnitCategory>('groundunit');
  const [spawnCoalition, setSpawnCoalition] = useState<'red' | 'blue'>('blue');
  const [spawnType, setSpawnType] = useState<string | null>(null);
  const [spawnAltFt, setSpawnAltFt] = useState('20000');
  const [search, setSearch] = useState('');
  const [db, setDb] = useState<{ loading: boolean; entries?: Record<string, UnitDbEntry>; err?: string }>({ loading: false });
  const dbCache = useRef<Record<string, Record<string, UnitDbEntry>>>({});

  const runCmd = async (command: string, params: Record<string, unknown>, label: string, refresh = false) => {
    setCmdMsg(`${label}…`);
    try {
      const r = await sendCommand(group.id, profile.id, command, params);
      setCmdMsg(r.ok ? `✓ ${label} sent` : `✗ ${r.error}`);
      if (r.ok && refresh) setTimeout(() => { fittedRef.current = true; }, 0);
    } catch (e) { setCmdMsg(`✗ ${e instanceof Error ? e.message : 'failed'}`); }
  };

  // Map tools (zoom / select / measure / erase). Tool 'measure' makes clicks
  // drop range+bearing points; 'select' is normal unit selection.
  const [tool, setTool] = useState<'select' | 'measure'>('select');
  const [measurePts, setMeasurePts] = useState<number[][]>([]);  // [lon,lat] vertices
  const zoomBy = (d: number) => { const v = mapRef.current?.getView(); if (v) v.animate({ zoom: (v.getZoom() ?? 6) + d, duration: 180 }); };
  // Rebuild the measure line + per-segment range/bearing labels from the vertices.
  useEffect(() => {
    const src = measureSrcRef.current; if (!src) return;
    src.clear();
    if (measurePts.length === 0) return;
    const coords = measurePts.map((ll) => fromLonLat(ll));
    if (coords.length >= 2) src.addFeature(new Feature({ geometry: new LineString(coords) }));
    coords.forEach((c) => { const f = new Feature({ geometry: new Point(c) }); f.set('_vertex', true); src.addFeature(f); });
    let total = 0;
    for (let i = 1; i < measurePts.length; i++) {
      const m = getDistance(measurePts[i - 1], measurePts[i]); total += m;
      const brg = bearingDeg(measurePts[i - 1], measurePts[i]);
      const mid = [(coords[i - 1][0] + coords[i][0]) / 2, (coords[i - 1][1] + coords[i][1]) / 2];
      const lf = new Feature({ geometry: new Point(mid) });
      lf.set('_label', `${(m / 1852).toFixed(1)} NM  ${String(Math.round(brg)).padStart(3, '0')}°`);
      src.addFeature(lf);
    }
    if (measurePts.length > 2) {
      const tf = new Feature({ geometry: new Point(coords[coords.length - 1]) });
      tf.set('_label', `Σ ${(total / 1852).toFixed(1)} NM`); tf.set('_total', true);
      src.addFeature(tf);
    }
  }, [measurePts]);

  // Latest interaction state for the (once-registered) OL click handler.
  const ctrl = useRef<any>({});
  ctrl.current = {
    mode, spawnType, spawnCoalition, spawnCat, armed, tool,
    onSelect: (u: UnitT | null) => setSelected(u),
    onMeasure: (lat: number, lng: number) => setMeasurePts((prev) => [...prev, [lng, lat]]),
    onArmed: (lat: number, lng: number, target: UnitT | null) => {
      const a = armed;
      if (!a) return;
      if (a.kind === 'move') runCmd('setPath', { ID: a.id, path: [{ lat, lng }] }, 'Move', true);
      else if (a.kind === 'fireAtArea') runCmd('fireAtArea', { ID: a.id, location: { lat, lng } }, 'Fire at area');
      else if (a.kind === 'bombPoint') runCmd('bombPoint', { ID: a.id, location: { lat, lng } }, 'Bomb point');
      else if (a.kind === 'attack') {
        if (target?.olympusID == null) { setCmdMsg('✗ click a target unit'); return; }  // stay armed
        runCmd('attackUnit', { ID: a.id, targetID: target.olympusID }, 'Attack');
      }
      setArmed(null);
    },
    onSpawn: (type: string, lat: number, lng: number) => {
      const isAir = spawnCat === 'aircraft' || spawnCat === 'helicopter';
      const unit: Record<string, unknown> = { unitType: type, location: { lat, lng }, liveryID: '', skill: 'High' };
      if (isAir) {
        // Air start needs altitude (meters) + a loadout code from the blueprint.
        const ft = Number(spawnAltFt) || (spawnCat === 'aircraft' ? 20000 : 1000);
        unit.altitude = Math.round(ft * 0.3048);
        unit.loadout = db.entries?.[type]?.loadouts?.[0]?.code || '';
      }
      const params: Record<string, unknown> = {
        units: [unit], coalition: spawnCoalition, country: '', immediate: false, spawnPoints: 0,
      };
      if (isAir) params.airbaseName = '';
      runCmd(CAT_CMD[spawnCat], params, `Spawn ${type}`);
    },
  };

  // Create the map once.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const src = new VectorSource();
    srcRef.current = src;
    const abSrc = new VectorSource();
    abSrcRef.current = abSrc;
    const ringSrc = new VectorSource();
    ringSrcRef.current = ringSrc;
    const groundSrc = new VectorSource();
    groundSrcRef.current = groundSrc;
    const clusterSrc = new Cluster({ distance: 42, minDistance: 24, source: groundSrc });
    clusterSrcRef.current = clusterSrc;
    const unitsLayer = new VectorLayer({ source: src });
    const abLayer = new VectorLayer({ source: abSrc });
    const ringLayer = new VectorLayer({ source: ringSrc });
    const clusterLayer = new VectorLayer({ source: clusterSrc, style: (f) => clusterStyle(f.get('features') as Feature[]) });
    const measureSrc = new VectorSource();
    measureSrcRef.current = measureSrc;
    const measureLayer = new VectorLayer({ source: measureSrc, style: (f) => measureFeatureStyle(f as Feature) });
    abLayerRef.current = abLayer;
    const map = new OlMap({
      target: elRef.current,
      controls: [],  // hide default OL zoom/attribution; we float our own chrome
      layers: [
        new TileLayer({ source: new XYZ({ url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attributions: '© OpenStreetMap, © CARTO' }) }),
        abLayer,        // airbases under units
        ringLayer,      // threat rings under units
        clusterLayer,   // ground units (clustered)
        unitsLayer,     // air/navy units on top
        measureLayer,   // measure tool overlay (topmost)
      ],
      view: new View({ center: fromLonLat([35, 43]), zoom: 6 }),
    });
    map.on('singleclick', (e) => {
      const c = ctrl.current;
      const ll = toLonLat(e.coordinate);
      const lng = ll[0], lat = ll[1];
      if (c.tool === 'measure') { c.onMeasure(lat, lng); return; }  // measure tool owns clicks
      // Hit-test only the unit + cluster layers (not airbases/rings).
      const f = map.forEachFeatureAtPixel(e.pixel, (ft) => ft, { hitTolerance: 6, layerFilter: (l) => l === unitsLayer || l === clusterLayer });
      let target: UnitT | null = null;
      if (f) {
        const clustered = f.get('features') as Feature[] | undefined;
        if (Array.isArray(clustered)) {
          if (clustered.length > 1) {  // expand a multi-unit cluster instead of selecting
            map.getView().fit(boundingExtent(clustered.map((cf) => (cf.getGeometry() as Point).getCoordinates())), { padding: [90, 90, 90, 90], maxZoom: 13, duration: 250 });
            return;
          }
          target = (clustered[0]?.get('unit') as UnitT) ?? null;
        } else {
          target = (f.get('unit') as UnitT) ?? null;
        }
      }
      if (c.armed) { c.onArmed(lat, lng, target); return; }
      if (c.mode === 'spawn' && c.spawnType) { c.onSpawn(c.spawnType, lat, lng); return; }
      c.onSelect(target);
    });
    // Live cursor coordinate readout (write to DOM directly — no re-render).
    map.on('pointermove', (e) => {
      if (!coordRef.current || e.dragging) return;
      const ll = toLonLat(e.coordinate);
      const lat = ll[1], lng = ll[0];
      const ns = lat >= 0 ? 'N' : 'S', ew = lng >= 0 ? 'E' : 'W';
      coordRef.current.textContent = `${ns} ${Math.abs(lat).toFixed(4)}°   ${ew} ${Math.abs(lng).toFixed(4)}°`;
    });
    mapRef.current = map;
    const onResize = () => map.updateSize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); map.setTarget(undefined); mapRef.current = null; };
  }, []);

  // Poll units.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await getTelemetry(group.id, profile.id, 'units');
        if (cancelled || !srcRef.current) return;
        if (!r.ok) { setErr(r.error || 'feed error'); return; }
        setErr('');
        const units = (Array.isArray(r.data) ? r.data : []) as UnitT[];
        const store = unitsRef.current as Record<string, { u: UnitT; miss: number }>;
        const seen = new Set<string>();
        units.forEach((u, i) => {
          const key = u.olympusID != null ? String(u.olympusID) : (u.unitName || u.name || `i${i}`);
          seen.add(key);
          store[key] = { u: { ...(store[key]?.u || {}), ...u }, miss: 0 };  // merge
        });
        // Age out units absent this poll; drop after ~3 consecutive misses.
        for (const k of Object.keys(store)) {
          if (!seen.has(k)) { if (++store[k].miss >= 3) delete store[k]; }
        }
        feedLenRef.current = units.length;
        renderRef.current();  // rebuild features + counts (applies visibility filters)
      } catch (e) { if (!cancelled) setErr(e instanceof Error ? e.message : 'failed'); }
    };
    poll(); const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [group.id, profile.id]);

  // Re-render instantly when a visibility filter toggles (don't wait for poll).
  useEffect(() => { renderRef.current(); }, [showHuman, showOlympus, showDcs, showRed, showBlue, showNeutral, showAircraft, showHelicopter, showSam, showGround, showNavy, showDead, showEng, showAcq]);

  // Load the unit databases once: classify SAM/air-defense ground units (Olympus
  // splits GroundUnit into SAM vs other ground by blueprint type) and build the
  // engagement/acquisition range lookup (metres) used for threat rings.
  useEffect(() => {
    let cancelled = false;
    const cats: UnitCategory[] = ['groundunit', 'aircraft', 'helicopter', 'navyunit'];
    Promise.all(cats.map((c) => getUnitDatabase(group.id, profile.id, c).then((r) => ({ c, r })).catch(() => ({ c, r: null as any }))))
      .then((results) => {
        if (cancelled) return;
        const sam = new Set<string>();
        const ranges = new Map<string, { eng: number; acq: number }>();
        for (const { c, r } of results) {
          if (!r?.ok || !r.data) continue;
          for (const [k, v] of Object.entries(r.data) as [string, UnitDbEntry][]) {
            const eng = Number(v.engagementRange) || 0, acq = Number(v.acquisitionRange) || 0;
            if (eng > 0 || acq > 0) { ranges.set(k, { eng, acq }); if (v.name) ranges.set(v.name, { eng, acq }); }
            if (c === 'groundunit' && v.type && SAM_TYPES.has(v.type)) { sam.add(k); if (v.name) sam.add(v.name); }
          }
        }
        samNamesRef.current = sam;
        rangesRef.current = ranges;
        renderRef.current();  // re-classify + draw rings now that blueprints are known
      });
    return () => { cancelled = true; };
  }, [group.id, profile.id]);

  // Poll the airbases feed (separate JSON resource) and plot field markers.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await getTelemetry(group.id, profile.id, 'airbases');
        if (cancelled || !abSrcRef.current) return;
        if (!r.ok || !r.data) return;
        const obj = ((r.data as Record<string, unknown>).airbases || {}) as Record<string, any>;
        const src = abSrcRef.current; src.clear();
        for (const a of Object.values(obj)) {
          const lat = Number(a?.latitude), lng = Number(a?.longitude);
          if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) continue;
          const name = a.callsign && a.callsign !== '' ? a.callsign : `carrier-${a.unitId ?? ''}`;
          const ft = new Feature({ geometry: new Point(fromLonLat([lng, lat])) });
          ft.setStyle(airbaseStyle(a.coalition, name));
          src.addFeature(ft);
        }
      } catch { /* airbases unavailable — leave layer empty */ }
    };
    poll(); const id = setInterval(poll, 15000);  // airfields are mostly static
    return () => { cancelled = true; clearInterval(id); };
  }, [group.id, profile.id]);

  // Show/hide the airbase layer.
  useEffect(() => { abLayerRef.current?.setVisible(showAirbase); }, [showAirbase]);

  // Enable/disable ground-unit clustering by setting the cluster distance.
  useEffect(() => { clusterSrcRef.current?.setDistance(clusterGround ? 42 : 0); }, [clusterGround]);

  // Load the unit DB when spawn mode opens / category changes (cached).
  useEffect(() => {
    if (mode !== 'spawn') return;
    setSpawnAltFt(spawnCat === 'helicopter' ? '1000' : '20000');
    if (dbCache.current[spawnCat]) { setDb({ loading: false, entries: dbCache.current[spawnCat] }); return; }
    let cancelled = false;
    setDb({ loading: true }); setSpawnType(null);
    getUnitDatabase(group.id, profile.id, spawnCat).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) { dbCache.current[spawnCat] = r.data; setDb({ loading: false, entries: r.data }); }
      else setDb({ loading: false, err: r.error || 'failed to load database' });
    }).catch((e) => { if (!cancelled) setDb({ loading: false, err: e instanceof Error ? e.message : 'failed' }); });
    return () => { cancelled = true; };
  }, [mode, spawnCat, group.id, profile.id]);

  const sideLabel = (c?: number) => (c === 1 ? 'RED' : c === 2 ? 'BLUE' : 'NEU');
  const q = search.trim().toLowerCase();
  const typeList = db.entries
    ? Object.entries(db.entries)
        .filter(([k, v]) => !q || k.toLowerCase().includes(q) || (v.label || '').toLowerCase().includes(q))
        .slice(0, 80)
    : [];

  const armedActive = armed != null || (mode === 'spawn' && !!spawnType) || tool === 'measure';
  const selSide = selected ? (SIDE_COLOR[selected.coalition ?? -1] ?? C.neutral) : C.neutral;

  return (
    <div style={{ position: 'relative', height: 'clamp(440px, calc(100vh - 200px), 1040px)', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.bgSolid, fontFamily: 'inherit' }}>
      <div ref={elRef} style={{ position: 'absolute', inset: 0, cursor: armedActive ? 'crosshair' : 'default' }} />

      {/* ── Map tools rail (left edge) ───────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 56, left: 12, zIndex: 4, display: 'flex', flexDirection: 'column', gap: 5, padding: 5, ...glass }}>
        <button onClick={() => zoomBy(1)} title="Zoom in" style={toolBtn}>＋</button>
        <button onClick={() => zoomBy(-1)} title="Zoom out" style={toolBtn}>－</button>
        <span style={{ height: 1, background: C.border, margin: '1px 2px' }} />
        <button onClick={() => setTool('select')} title="Selection tool" style={{ ...toolBtn, ...(tool === 'select' ? toolOn : {}) }}>⊹</button>
        <button onClick={() => { setTool('measure'); setArmed(null); }} title="Measure tool (range / bearing)" style={{ ...toolBtn, ...(tool === 'measure' ? toolOn : {}) }}>📏</button>
        <button onClick={() => setMeasurePts([])} title="Clear measurements" disabled={measurePts.length === 0}
                style={{ ...toolBtn, opacity: measurePts.length === 0 ? 0.4 : 1 }}>🧽</button>
      </div>

      {/* ── Top command / status bar ─────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44, display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', zIndex: 3, background: 'linear-gradient(180deg, rgba(9,13,20,0.96), rgba(9,13,20,0.72))', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: err ? C.red : C.green, boxShadow: `0 0 8px ${err ? C.red : C.green}` }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: C.text }}>LIVE TACTICAL</span>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', gap: 0, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
            {(['select', 'spawn'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setSpawnType(null); setArmed(null); }}
                      style={{ ...seg, ...(mode === m ? segOn : {}) }}>{m === 'select' ? '⊹ Control' : '✛ Spawn'}</button>
            ))}
          </div>
        )}

        {/* Lock/unlock protected (Mission Editor) units */}
        {isAdmin && (
          <div style={{ position: 'relative' }} onMouseEnter={() => setShowLockHelp(true)} onMouseLeave={() => setShowLockHelp(false)}>
            <button onClick={toggleProtect} aria-label="Lock/unlock protected units"
                    style={{ width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                             border: `1px solid ${protectMode ? C.red : C.border}`,
                             background: protectMode ? 'rgba(224,85,79,0.2)' : 'rgba(255,255,255,0.04)',
                             color: protectMode ? C.red : C.textDim }}>
              {protectMode ? '🔒' : '🔓'}
            </button>
            {showLockHelp && (
              <div style={{ position: 'absolute', top: 38, left: 0, width: 308, zIndex: 6, padding: 12, ...glass, fontSize: 12, lineHeight: 1.55, color: C.textDim }}>
                <div style={{ color: C.text, fontWeight: 700, marginBottom: 6 }}>Lock / unlock protected units</div>
                Mission Editor units are protected from being commanded or deleted by default.
                Protection is <b style={{ color: protectMode ? C.red : C.green }}>{protectMode ? 'ON' : 'OFF'}</b> — {protectMode
                  ? 'commanding a protected unit asks for confirmation first.'
                  : 'protected units can be commanded with no prompt.'}
                <div style={{ marginTop: 6 }}>Once a unit is commanded it unlocks and becomes an Olympus unit, abandoning its scripted mission.</div>
              </div>
            )}
          </div>
        )}

        {/* Controller filters */}
        <div style={fGroup}>
          <IconToggle icon="👤" active={showHuman} onClick={toggleHuman}
            helpTitle="Hide / show human units"
            helpBody={<>Toggles map visibility of player-piloted (human) units. Currently <b style={{ color: showHuman ? C.green : C.red }}>{showHuman ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="🛰" active={showOlympus} onClick={toggleOlympus}
            helpTitle="Hide / show Olympus units"
            helpBody={<>Toggles map visibility of Olympus-controlled units — those spawned or commanded through this terminal. Currently <b style={{ color: showOlympus ? C.green : C.red }}>{showOlympus ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="🤖" active={showDcs} onClick={toggleDcs}
            helpTitle="Hide / show DCS units"
            helpBody={<>Toggles map visibility of DCS-controlled units — Mission Editor AI not (yet) under Olympus control. Currently <b style={{ color: showDcs ? C.green : C.red }}>{showDcs ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
        </div>

        <span style={{ width: 1, height: 22, background: C.border }} />

        {/* Coalition filters */}
        <div style={fGroup}>
          <IconToggle icon="●" accent={C.red} active={showRed} onClick={toggleRed}
            helpTitle="Hide / show RED units"
            helpBody={<>Toggles map visibility of red-coalition units. Currently <b style={{ color: showRed ? C.green : C.red }}>{showRed ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="●" accent={C.blue} active={showBlue} onClick={toggleBlue}
            helpTitle="Hide / show BLUE units"
            helpBody={<>Toggles map visibility of blue-coalition units. Currently <b style={{ color: showBlue ? C.green : C.red }}>{showBlue ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="●" accent={C.neutral} active={showNeutral} onClick={toggleNeutral}
            helpTitle="Hide / show NEUTRAL units"
            helpBody={<>Toggles map visibility of neutral / unaligned units. Currently <b style={{ color: showNeutral ? C.green : C.red }}>{showNeutral ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
        </div>

        <span style={{ width: 1, height: 22, background: C.border }} />

        {/* Type filters */}
        <div style={fGroup}>
          <IconToggle icon="✈" active={showAircraft} onClick={toggleAircraft}
            helpTitle="Hide / show aircraft"
            helpBody={<>Toggles map visibility of fixed-wing aircraft. Currently <b style={{ color: showAircraft ? C.green : C.red }}>{showAircraft ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="🚁" active={showHelicopter} onClick={toggleHelicopter}
            helpTitle="Hide / show helicopters"
            helpBody={<>Toggles map visibility of helicopters. Currently <b style={{ color: showHelicopter ? C.green : C.red }}>{showHelicopter ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="📡" active={showSam} onClick={toggleSam}
            helpTitle="Hide / show SAM units"
            helpBody={<>Toggles map visibility of SAM / air-defense ground units — SAM sites, launchers, radars, AAA and MANPADS. Currently <b style={{ color: showSam ? C.green : C.red }}>{showSam ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="🪖" active={showGround} onClick={toggleGround}
            helpTitle="Hide / show ground units"
            helpBody={<>Toggles map visibility of non-air-defense ground units — armor, vehicles, infantry, artillery. Currently <b style={{ color: showGround ? C.green : C.red }}>{showGround ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="🚢" active={showNavy} onClick={toggleNavy}
            helpTitle="Hide / show navy units"
            helpBody={<>Toggles map visibility of naval units / ships. Currently <b style={{ color: showNavy ? C.green : C.red }}>{showNavy ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="🛬" active={showAirbase} onClick={toggleAirbase}
            helpTitle="Hide / show airbases"
            helpBody={<>Toggles map markers for airbases and carriers (name + coalition ring). Currently <b style={{ color: showAirbase ? C.green : C.red }}>{showAirbase ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="💀" active={showDead} onClick={toggleDead}
            helpTitle="Hide / show dead units"
            helpBody={<>Toggles map visibility of destroyed / dead units. Currently <b style={{ color: showDead ? C.green : C.red }}>{showDead ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
        </div>

        <span style={{ width: 1, height: 22, background: C.border }} />

        {/* Overlay filters */}
        <div style={fGroup}>
          <IconToggle icon="◎" active={showEng} onClick={toggleEng}
            helpTitle="Hide / show engagement rings"
            helpBody={<>Weapons-engagement range rings around units that have them (SAMs, AAA, etc.), from the unit blueprint. Currently <b style={{ color: showEng ? C.green : C.red }}>{showEng ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="◌" active={showAcq} onClick={toggleAcq}
            helpTitle="Hide / show acquisition rings"
            helpBody={<>Detection / acquisition range rings (radar pickup) around units that have them. Currently <b style={{ color: showAcq ? C.green : C.red }}>{showAcq ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
          <IconToggle icon="❖" active={clusterGround} onClick={toggleCluster}
            helpTitle="Ground unit clustering"
            helpBody={<>Groups nearby ground units into a single counted marker when zoomed out, to declutter the map. Click a cluster to zoom in. Currently <b style={{ color: clusterGround ? C.green : C.red }}>{clusterGround ? 'ON' : 'OFF'}</b>.</>} />
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12 }}>
          <span style={{ color: C.red, display: 'flex', alignItems: 'center', gap: 5 }}><Glyph side={1} /> {counts.red}</span>
          <span style={{ color: C.blue, display: 'flex', alignItems: 'center', gap: 5 }}><Glyph side={2} /> {counts.blue}</span>
          {counts.other ? <span style={{ color: C.neutral, display: 'flex', alignItems: 'center', gap: 5 }}><Glyph side={0} /> {counts.other}</span> : null}
          {dbg && <span style={{ color: C.textDim, fontSize: 11 }}>{dbg}</span>}
          {err && <span style={{ color: C.red }}>✗ {err}</span>}
        </div>
      </div>

      {/* ── Left dock: Spawn ─────────────────────────────────────────────── */}
      {isAdmin && mode === 'spawn' && (
        <div style={{ position: 'absolute', top: 56, left: 56, bottom: 44, width: 280, zIndex: 3, display: 'flex', flexDirection: 'column', ...glass }}>
          <div style={panelHead}>SPAWN UNIT</div>
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={spawnCat} onChange={(e) => setSpawnCat(e.target.value as UnitCategory)} style={{ ...inp, flex: 1 }}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              {(['blue', 'red'] as const).map((s) => (
                <button key={s} onClick={() => setSpawnCoalition(s)}
                        style={{ ...mbtn, padding: '4px 10px', ...(spawnCoalition === s ? { borderColor: s === 'red' ? C.red : C.blue, color: s === 'red' ? C.red : C.blue, background: 'rgba(255,255,255,0.04)' } : {}) }}>{s.toUpperCase()}</button>
              ))}
            </div>
            {(spawnCat === 'aircraft' || spawnCat === 'helicopter') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textDim }}>
                <span>Air start alt (ft)</span>
                <input value={spawnAltFt} onChange={(e) => setSpawnAltFt(e.target.value.replace(/[^0-9]/g, ''))} style={{ ...inp, width: 78 }} />
              </div>
            )}
            <input placeholder="Search unit type…" value={search} onChange={(e) => setSearch(e.target.value)} style={inp} />
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 80, border: `1px solid ${C.border}`, borderRadius: 5, background: 'rgba(0,0,0,0.25)' }}>
              {db.loading && <div style={{ color: C.textDim, fontSize: 12, padding: 8 }}>Loading database…</div>}
              {db.err && <div style={{ color: C.red, fontSize: 12, padding: 8 }}>✗ {db.err}</div>}
              {typeList.map(([k, v]) => (
                <div key={k} onClick={() => setSpawnType(k)}
                     style={{ padding: '5px 8px', fontSize: 12, cursor: 'pointer',
                              background: spawnType === k ? C.accentDim : 'transparent',
                              color: spawnType === k ? '#cfe6ff' : C.text,
                              borderLeft: spawnType === k ? `2px solid ${C.accent}` : '2px solid transparent',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {v.label || k} <span style={{ color: C.textDim }}>· {v.type || v.category}</span>
                </div>
              ))}
              {db.entries && typeList.length === 0 && !db.loading && <div style={{ color: C.textDim, fontSize: 12, padding: 8 }}>No matches.</div>}
            </div>
            {spawnType && <div style={{ fontSize: 11, color: C.accent }}>Selected <b>{spawnType}</b> — click the map to place.</div>}
          </div>
        </div>
      )}

      {/* ── Right dock: selected unit control ────────────────────────────── */}
      {selected && mode === 'select' && (
        <div style={{ position: 'absolute', top: 56, right: 12, width: 268, maxHeight: 'calc(100% - 110px)', display: 'flex', flexDirection: 'column', zIndex: 3, ...glass, borderColor: selSide }}>
          <div style={{ ...panelHead, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, borderBottom: `1px solid ${C.border}`, borderTop: `2px solid ${selSide}` }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
              {selProtected && <span title="Protected Mission Editor unit" style={{ color: C.red }}>🔒</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.unitName || selected.name || '—'}</span>
            </span>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ overflowY: 'auto', padding: 10 }}>
            <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.7 }}>
              <div>Type&nbsp; <span style={{ color: C.text }}>{selected.name || '—'}</span></div>
              <div>Side&nbsp;&nbsp; <span style={{ color: selSide, fontWeight: 600 }}>{sideLabel(selected.coalition)}</span> · {selected.category || ''}</div>
              <div>Pos&nbsp;&nbsp;&nbsp; <span style={{ color: C.text }}>{selected.position ? `${selected.position.lat.toFixed(3)}, ${selected.position.lng.toFixed(3)}` : '—'}</span></div>
            </div>
            {isAdmin && selected.olympusID != null && (
              <div style={{ marginTop: 10 }}>
                <SectionLabel>Tasking</SectionLabel>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <button style={cardBtn} onClick={() => guard(() => setArmed({ kind: 'move', id: selected.olympusID! }))}>📍 Move</button>
                  <button style={cardBtn} onClick={() => guard(() => setArmed({ kind: 'attack', id: selected.olympusID! }))}>🎯 Attack</button>
                  <button style={cardBtn} onClick={() => guard(() => setArmed({ kind: 'fireAtArea', id: selected.olympusID! }))}>🔥 Fire</button>
                  <button style={cardBtn} onClick={() => guard(() => setArmed({ kind: 'bombPoint', id: selected.olympusID! }))}>💣 Bomb</button>
                </div>

                <SectionLabel>Behaviour</SectionLabel>
                <div style={{ display: 'flex', gap: 5 }}>
                  <select style={{ ...inp, flex: 1 }} value="" onChange={(e) => { const i = Number(e.target.value); if (i) guard(() => runCmd('setROE', { ID: selected.olympusID, ROE: i }, 'ROE')); }}>
                    <option value="">ROE…</option><option value="1">Free</option><option value="2">Designated</option><option value="3">Return fire</option><option value="4">Hold</option>
                  </select>
                  <select style={{ ...inp, flex: 1 }} value="" onChange={(e) => { const v = e.target.value; if (v !== '') guard(() => runCmd('setReactionToThreat', { ID: selected.olympusID, reactionToThreat: Number(v) }, 'Reaction')); }}>
                    <option value="">React…</option><option value="0">None</option><option value="1">Manoeuvre</option><option value="2">Passive</option><option value="3">Evade</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                  <button style={cardBtn} onClick={() => guard(() => runCmd('setOnOff', { ID: selected.olympusID, onOff: true }, 'On'))}>On</button>
                  <button style={cardBtn} onClick={() => guard(() => runCmd('setOnOff', { ID: selected.olympusID, onOff: false }, 'Off'))}>Off</button>
                  <button style={cardBtn} onClick={() => guard(() => runCmd('setFollowRoads', { ID: selected.olympusID, followRoads: true }, 'Roads on'))}>Roads</button>
                </div>

                <SectionLabel>Altitude / Speed</SectionLabel>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <input placeholder="alt ft" value={ctlAlt} onChange={(e) => setCtlAlt(e.target.value.replace(/[^0-9]/g, ''))} style={{ ...inp, width: 54 }} />
                  <button style={cardBtn} disabled={!ctlAlt} onClick={() => guard(() => runCmd('setAltitude', { ID: selected.olympusID, altitude: Math.round(Number(ctlAlt) * 0.3048) }, 'Set alt'))}>set</button>
                  <input placeholder="spd kt" value={ctlSpd} onChange={(e) => setCtlSpd(e.target.value.replace(/[^0-9]/g, ''))} style={{ ...inp, width: 54 }} />
                  <button style={cardBtn} disabled={!ctlSpd} onClick={() => guard(() => runCmd('setSpeed', { ID: selected.olympusID, speed: Math.round(Number(ctlSpd) * 0.514444) }, 'Set spd'))}>set</button>
                </div>

                <SectionLabel>Mark / Remove</SectionLabel>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {selected.position && (
                    <button style={cardBtn} onClick={() => runCmd('smoke', { color: 'green', location: { lat: selected.position!.lat, lng: selected.position!.lng } }, 'Smoke')}>💨 Smoke</button>
                  )}
                  <button style={{ ...cardBtn, color: C.red, borderColor: '#5a2a2a' }}
                          onClick={() => { if (window.confirm(`Delete "${selected.unitName || selected.name}" from the LIVE mission?`)) runCmd('deleteUnit', { ID: selected.olympusID, explosion: false, explosionType: '', immediate: true }, 'Delete', true); }}>✕ Delete</button>
                </div>
              </div>
            )}
            {cmdMsg && <div style={{ marginTop: 8, fontSize: 12, color: cmdMsg.startsWith('✗') ? C.red : C.green }}>{cmdMsg}</div>}
          </div>
        </div>
      )}

      {/* ── Armed-action banner ──────────────────────────────────────────── */}
      {(armed || (mode === 'spawn' && spawnType)) && (
        <div style={{ position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)', zIndex: 4, display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 6, background: 'rgba(9,13,20,0.95)', border: `1px solid ${C.accent}`, color: '#cfe6ff', fontSize: 12, boxShadow: `0 0 16px rgba(74,158,255,0.25)` }}>
          <span style={{ fontWeight: 600 }}>
            {armed
              ? (armed.kind === 'move' ? '📍 Click the map to MOVE'
                : armed.kind === 'attack' ? '🎯 Click a TARGET unit'
                : armed.kind === 'fireAtArea' ? '🔥 Click the map: FIRE AT AREA'
                : '💣 Click the map: BOMB POINT')
              : `✛ Click the map to SPAWN ${spawnType}`}
          </span>
          <button onClick={() => { setArmed(null); setSpawnType(null); }} style={{ ...mbtn, padding: '2px 9px' }}>cancel</button>
          {cmdMsg && <span style={{ color: cmdMsg.startsWith('✗') ? C.red : C.green }}>{cmdMsg}</span>}
        </div>
      )}

      {/* ── Bottom status bar ────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 26, display: 'flex', alignItems: 'center', gap: 16, padding: '0 12px', zIndex: 2, background: 'linear-gradient(0deg, rgba(9,13,20,0.96), rgba(9,13,20,0.55))', borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.textDim, fontVariantNumeric: 'tabular-nums' }}>
        <span ref={coordRef}>—</span>
        <div style={{ flex: 1 }} />
        <span>{isAdmin ? 'GM · full control' : 'observer'}</span>
        <span>{profile.name}</span>
      </div>
    </div>
  );
}

// Small NATO-ish coalition glyph for the status counts (▲ matches air markers).
function Glyph({ side }: { side: number }) {
  return <span style={{ color: SIDE_COLOR[side] ?? C.neutral, fontSize: 10 }}>◆</span>;
}

// Round top-bar toggle (visibility filters) with an Olympus-style hover-help.
// `accent` (optional) tints the active state to a coalition color.
function IconToggle({ icon, active, onClick, helpTitle, helpBody, accent }: {
  icon: string; active: boolean; onClick: () => void; helpTitle: string; helpBody: React.ReactNode; accent?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button onClick={onClick} aria-label={helpTitle}
              style={{ width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                       border: `1px solid ${active ? (accent || C.borderHi) : C.border}`,
                       background: active ? (accent ? `${accent}22` : C.accentDim) : 'rgba(255,255,255,0.04)',
                       color: active ? (accent || C.text) : C.textDim, opacity: active ? 1 : 0.5 }}>
        {icon}
      </button>
      {hover && (
        <div style={{ position: 'absolute', top: 38, left: 0, width: 300, zIndex: 6, padding: 12, ...glass, fontSize: 12, lineHeight: 1.55, color: C.textDim }}>
          <div style={{ color: C.text, fontWeight: 700, marginBottom: 6 }}>{helpTitle}</div>
          {helpBody}
        </div>
      )}
    </div>
  );
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, letterSpacing: 1, color: C.textDim, textTransform: 'uppercase', margin: '10px 0 5px' }}>{children}</div>;
}

const glass: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, boxShadow: '0 6px 20px rgba(0,0,0,0.45)', overflow: 'hidden' };
const panelHead: React.CSSProperties = { padding: '8px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text, background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${C.border}` };
const fGroup: React.CSSProperties = { display: 'flex', gap: 5 };
const toolBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 5, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.04)', color: C.text, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', lineHeight: 1 };
const toolOn: React.CSSProperties = { borderColor: C.accent, background: C.accentDim, color: '#cfe6ff' };
const seg: React.CSSProperties = { background: 'transparent', border: 'none', color: C.textDim, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const segOn: React.CSSProperties = { background: C.accentDim, color: '#cfe6ff' };
const mbtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '3px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const inp: React.CSSProperties = { background: 'rgba(0,0,0,0.35)', border: `1px solid ${C.border}`, color: C.text, padding: '5px 7px', fontSize: 12, fontFamily: 'inherit', borderRadius: 4, outline: 'none' };
const cardBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '5px 9px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
