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

import { useCallback, useEffect, useRef, useState } from 'react';
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
  getTelemetry, sendCommand, getUnitDatabase, can, ROLE_LABEL,
  type GroupSummary, type ServerProfile, type UnitCategory, type UnitDbEntry,
} from '../../api/groups';
import { SpawnPanel } from './SpawnPanel';
import { IadsPanel, type IadsArea } from './IadsPanel';

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
  ROE?: number; reactionToThreat?: number; alarmState?: number; emissionsCountermeasures?: number;
  desiredAltitudeType?: number; desiredSpeedType?: number;  // 1=AGL/1=GS ; 0=ASL/0=CAS
  position?: { lat: number; lng: number; alt?: number };
}

// Highlight ring drawn around each selected unit.
const SEL_STYLE = new Style({ image: new CircleStyle({ radius: 11, stroke: new Stroke({ color: '#ffd24a', width: 2 }), fill: undefined }) });

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

// IADS generator area: dashed accent circle + centre dot.
function iadsFeatureStyle(feature: Feature): Style {
  const geom = feature.getGeometry();
  if (geom && geom.getType() === 'Point') return new Style({
    image: new CircleStyle({ radius: 4, fill: new Fill({ color: C.accent }), stroke: new Stroke({ color: '#0b0f16', width: 1 }) }),
  });
  return new Style({ stroke: new Stroke({ color: C.accent, width: 1.6, lineDash: [8, 5] }), fill: new Fill({ color: 'rgba(74,158,255,0.07)' }) });
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
  const iadsSrcRef = useRef<VectorSource | null>(null);    // IADS generator area circle
  const selSrcRef = useRef<VectorSource | null>(null);     // selection highlight rings
  const fittedRef = useRef(false);
  // Persistent unit store (merge across polls so units don't blink out on a
  // delta frame / decode hiccup). Removed when explicitly dead or absent ~3 polls.
  const unitsRef = useRef<Record<string, { u: UnitT; miss: number }>>({});
  const feedLenRef = useRef(0);                  // last poll's raw feed length (for dbg)
  const renderRef = useRef<() => void>(() => {});  // rebuild features from store (filters applied)
  const samNamesRef = useRef<Set<string>>(new Set());  // ground unit type-names classified as SAM/air-defense
  const canSpawn = can(group.role, 'spawn');
  const canCommand = can(group.role, 'command');
  const canDelete = can(group.role, 'delete');
  const canEffects = can(group.role, 'effects');
  const canControl = canSpawn || canCommand || canDelete || canEffects;

  const [counts, setCounts] = useState({ red: 0, blue: 0, other: 0 });
  const [dbg, setDbg] = useState('');
  const [dbgOpen, setDbgOpen] = useState(false);  // click the feed counter to inspect decoded units
  const [err, setErr] = useState('');
  // Multi-unit selection (batch). Set of olympusIDs; primary = first, for detail.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const selIdsRef = useRef<Set<number>>(selectedIds);
  selIdsRef.current = selectedIds;  // latest, for the OL click/box handlers
  const [cmdMsg, setCmdMsg] = useState('');
  // Armed map action: next map click applies it to the WHOLE selection.
  const [armed, setArmed] = useState<{ kind: 'move' | 'attack' | 'fireAtArea' | 'bombPoint' } | null>(null);
  const [ctlAlt, setCtlAlt] = useState(20000);  // ft (altitude slider)
  const [ctlSpd, setCtlSpd] = useState(300);     // kt (speed slider)

  // Protected (Mission Editor) units: Olympus marks a unit `controlled:0` until
  // it's first commanded, after which it flips to 1 ("becomes an Olympus unit").
  // When protection is ON (default), commanding such a unit asks for confirmation.
  const [protectMode, toggleProtect] = usePersistedToggle('dcsopt.live.protect');
  const [showLockHelp, setShowLockHelp] = useState(false);

  // Selection derived from the live unit store (refreshes each poll).
  const selUnits = Array.from(selectedIds).map((id) => unitsRef.current[String(id)]?.u).filter(Boolean) as UnitT[];
  const selected = selUnits[0] ?? null;          // primary (drives the detail card + highlights)
  const selCount = selectedIds.size;
  const anyProtected = protectMode && selUnits.some((u) => u.controlled === 0 && u.human !== 1);

  // Send a command to EVERY selected unit (one Olympus call each), with a single
  // protected-units confirm and one summary result.
  const cmdSel = (command: string, paramsFor: (id: number) => Record<string, unknown>, label: string) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (anyProtected && !window.confirm(`Selection includes protected Mission Editor unit(s).\n\nCommanding unlocks them and abandons their scripted mission. Continue?`)) return;
    setCmdMsg(`${label}…`);
    Promise.all(ids.map((id) => sendCommand(group.id, profile.id, command, paramsFor(id)).then((r) => r.ok).catch(() => false)))
      .then((oks) => {
        const ok = oks.filter(Boolean).length, n = oks.length;
        setCmdMsg(ok < n ? `✗ ${label}: ${ok}/${n} ok` : `✓ ${label}${n > 1 ? ` ×${n}` : ''} sent`);
      });
  };

  // Selection tool (filter-based batch select). Criteria default to "everything".
  const [selToolOpen, setSelToolOpen] = useState(false);
  const [selFilter, setSelFilter] = useState<Record<string, boolean>>({
    human: true, olympus: true, dcs: true,
    aircraft: true, helicopter: true, sam: true, ground: true, navy: true,
    blue: true, red: true, neutral: true,
  });
  const [selSearch, setSelSearch] = useState('');
  const toggleSelFilter = (k: string) => setSelFilter((f) => ({ ...f, [k]: !f[k] }));
  // Select every unit matching the current criteria.
  const runSelectByFilter = () => {
    const q = selSearch.trim().toLowerCase();
    const ids = new Set<number>();
    for (const { u } of Object.values(unitsRef.current)) {
      if (u.olympusID == null) continue;
      const ctl = u.human === 1 ? 'human' : u.controlled === 1 ? 'olympus' : 'dcs';
      if (!selFilter[ctl]) continue;
      const coal = u.coalition === 1 ? 'red' : u.coalition === 2 ? 'blue' : 'neutral';
      if (!selFilter[coal]) continue;
      const cat = (u.category || '').toLowerCase();
      const isGround = cat.includes('ground');
      const type = cat.includes('aircraft') ? 'aircraft' : cat.includes('helicopter') ? 'helicopter'
        : cat.includes('navy') ? 'navy' : isGround && samNamesRef.current.has(u.name || '') ? 'sam'
        : isGround ? 'ground' : '';
      if (type && !selFilter[type]) continue;
      if (q && !((u.name || '').toLowerCase().includes(q) || (u.unitName || '').toLowerCase().includes(q))) continue;
      ids.add(u.olympusID);
    }
    setSelectedIds(ids);
    setCmdMsg(`Selected ${ids.size} unit${ids.size === 1 ? '' : 's'}`);
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
    const selSrc = selSrcRef.current; selSrc?.clear();
    const selSet = selIdsRef.current;
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
      if (selSrc && u.olympusID != null && selSet.has(u.olympusID)) selSrc.addFeature(new Feature({ geometry: new Point(coord) }));
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

  // Spawn mode — the rich picker/config lives in <SpawnPanel>, which reports a
  // "place function" up here so a map click spawns the configured unit/effect.
  const [mode, setMode] = useState<'select' | 'spawn' | 'iads'>('select');
  // IADS generator drawn area (centre set by map click in 'iads' mode).
  const [iadsArea, setIadsArea] = useState<IadsArea | null>(null);
  const placeFnRef = useRef<((lat: number, lng: number) => void) | null>(null);
  const [placeLabel, setPlaceLabel] = useState('');
  const handlePlace = useCallback((fn: ((lat: number, lng: number) => void) | null, label: string) => {
    placeFnRef.current = fn; setPlaceLabel(fn ? label : '');
  }, []);

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
    mode, armed, tool,
    // Plain click = select that one (or clear). Shift-click = toggle in/out.
    onClickSelect: (u: UnitT | null, shift: boolean) => {
      const id = u?.olympusID;
      setSelectedIds((prev) => {
        if (id == null) return shift ? prev : new Set<number>();
        const next = new Set(prev);
        if (shift) { next.has(id) ? next.delete(id) : next.add(id); } else { next.clear(); next.add(id); }
        return next;
      });
    },
    onMeasure: (lat: number, lng: number) => setMeasurePts((prev) => [...prev, [lng, lat]]),
    onArmed: (lat: number, lng: number, target: UnitT | null) => {
      const a = armed;
      if (!a) return;
      if (a.kind === 'move') cmdSel('setPath', (id) => ({ ID: id, path: [{ lat, lng }] }), 'Move');
      else if (a.kind === 'fireAtArea') cmdSel('fireAtArea', (id) => ({ ID: id, location: { lat, lng } }), 'Fire at area');
      else if (a.kind === 'bombPoint') cmdSel('bombPoint', (id) => ({ ID: id, location: { lat, lng } }), 'Bomb point');
      else if (a.kind === 'attack') {
        if (target?.olympusID == null) { setCmdMsg('✗ click a target unit'); return; }  // stay armed
        cmdSel('attackUnit', (id) => ({ ID: id, targetID: target.olympusID }), 'Attack');
      }
      setArmed(null);
    },
    place: (lat: number, lng: number) => placeFnRef.current?.(lat, lng),
    onIads: (lat: number, lng: number) => setIadsArea((prev) => ({ lat, lng, radiusNm: prev?.radiusNm ?? 30 })),
  };

  // Draw the IADS generator area circle (lat-corrected so the projected radius
  // matches the real ground radius used to distribute sites).
  useEffect(() => {
    const src = iadsSrcRef.current; if (!src) return;
    src.clear();
    if (!iadsArea) return;
    const center = fromLonLat([iadsArea.lng, iadsArea.lat]);
    const projR = (iadsArea.radiusNm * 1852) / Math.cos((iadsArea.lat * Math.PI) / 180);
    src.addFeature(new Feature({ geometry: new CircleGeom(center, projR) }));
    src.addFeature(new Feature({ geometry: new Point(center) }));
  }, [iadsArea]);

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
    const iadsSrc = new VectorSource();
    iadsSrcRef.current = iadsSrc;
    const iadsLayer = new VectorLayer({ source: iadsSrc, style: (f) => iadsFeatureStyle(f as Feature) });
    const selSrc = new VectorSource();
    selSrcRef.current = selSrc;
    const selLayer = new VectorLayer({ source: selSrc, style: SEL_STYLE });
    abLayerRef.current = abLayer;
    const map = new OlMap({
      target: elRef.current,
      controls: [],  // hide default OL zoom/attribution; we float our own chrome
      layers: [
        new TileLayer({ source: new XYZ({ url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attributions: '© OpenStreetMap, © CARTO' }) }),
        abLayer,        // airbases under units
        ringLayer,      // threat rings under units
        iadsLayer,      // IADS generator area circle (under markers)
        selLayer,       // selection highlight rings (under markers)
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
      if (c.mode === 'iads') { c.onIads(lat, lng); return; }        // IADS mode: click sets area centre
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
      if (c.mode === 'spawn' && placeFnRef.current) { c.place(lat, lng); return; }
      c.onClickSelect(target, !!(e.originalEvent as MouseEvent)?.shiftKey);
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
  useEffect(() => { renderRef.current(); }, [showHuman, showOlympus, showDcs, showRed, showBlue, showNeutral, showAircraft, showHelicopter, showSam, showGround, showNavy, showDead, showEng, showAcq, selectedIds]);

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

  const sideLabel = (c?: number) => (c === 1 ? 'RED' : c === 2 ? 'BLUE' : 'NEU');

  const armedActive = armed != null || (mode === 'spawn' && placeLabel !== '') || tool === 'measure' || mode === 'iads';
  const selSide = selected ? (SIDE_COLOR[selected.coalition ?? -1] ?? C.neutral) : C.neutral;
  // Live copy of the selected unit (refreshed each poll) for current-state highlights.
  const sUnit = selected ? (unitsRef.current[String(selected.olympusID)]?.u ?? selected) : null;

  return (
    <div style={{ position: 'relative', height: 'clamp(440px, calc(100vh - 200px), 1040px)', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.bgSolid, fontFamily: 'inherit' }}>
      <div ref={elRef} style={{ position: 'absolute', inset: 0, cursor: armedActive ? 'crosshair' : 'default' }} />

      {/* ── Map tools rail (left edge) ───────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 56, left: 12, zIndex: 4, display: 'flex', flexDirection: 'column', gap: 5, padding: 5, ...glass }}>
        <button onClick={() => zoomBy(1)} title="Zoom in" style={toolBtn}>＋</button>
        <button onClick={() => zoomBy(-1)} title="Zoom out" style={toolBtn}>－</button>
        <span style={{ height: 1, background: C.border, margin: '1px 2px' }} />
        <button onClick={() => setTool('select')} title="Pointer — click a unit (shift-click to multi-select)" style={{ ...toolBtn, ...(tool === 'select' ? toolOn : {}) }}>⊹</button>
        {canControl && (
          <button onClick={() => setSelToolOpen((o) => !o)} title="Selection tool — batch-select by type / coalition / control" style={{ ...toolBtn, ...(selToolOpen ? toolOn : {}) }}>▦</button>
        )}
        <button onClick={() => { setTool('measure'); setArmed(null); }} title="Measure tool (range / bearing)" style={{ ...toolBtn, ...(tool === 'measure' ? toolOn : {}) }}>📏</button>
        <button onClick={() => setMeasurePts([])} title="Clear measurements" disabled={measurePts.length === 0}
                style={{ ...toolBtn, opacity: measurePts.length === 0 ? 0.4 : 1 }}>🧽</button>
        <span style={{ height: 1, background: C.border, margin: '1px 2px' }} />
        <button onClick={() => setDbgOpen((o) => !o)} title="Inspect decoded units (debug)"
                style={{ ...toolBtn, ...(dbgOpen ? toolOn : {}) }}>🐛</button>
      </div>

      {/* ── Selection tool (filter-based batch select) ───────────────────── */}
      {canControl && selToolOpen && (
        <div style={{ position: 'absolute', top: 56, left: 56, bottom: 44, width: 262, zIndex: 4, display: 'flex', flexDirection: 'column', ...glass }}>
          <div style={{ ...panelHead, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>SELECTION TOOL</span>
            <span onClick={() => setSelToolOpen(false)} style={{ cursor: 'pointer', color: C.textDim }}>×</span>
          </div>
          <div style={{ overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>Pick criteria, then <b>Select units</b> to grab every match. On the map, shift-click adds/removes one unit.</div>
            <div>
              <SectionLabel>Control mode</SectionLabel>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {(['human', 'olympus', 'dcs'] as const).map((k) => <Chip key={k} on={selFilter[k]} onClick={() => toggleSelFilter(k)}>{k === 'dcs' ? 'DCS' : k[0].toUpperCase() + k.slice(1)}</Chip>)}
              </div>
            </div>
            <div>
              <SectionLabel>Type</SectionLabel>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {([['aircraft', 'Aircraft'], ['helicopter', 'Heli'], ['sam', 'SAM'], ['ground', 'Ground'], ['navy', 'Navy']] as const).map(([k, l]) => <Chip key={k} on={selFilter[k]} onClick={() => toggleSelFilter(k)}>{l}</Chip>)}
              </div>
            </div>
            <div>
              <SectionLabel>Coalition</SectionLabel>
              <div style={{ display: 'flex', gap: 5 }}>
                {([['blue', 'Blue', C.blue], ['neutral', 'Neutral', C.neutral], ['red', 'Red', C.red]] as const).map(([k, l, c]) => <Chip key={k} on={selFilter[k]} accent={c} onClick={() => toggleSelFilter(k)}>{l}</Chip>)}
              </div>
            </div>
            <input placeholder="Search name…" value={selSearch} onChange={(e) => setSelSearch(e.target.value)}
                   style={{ background: 'rgba(0,0,0,0.35)', border: `1px solid ${C.border}`, color: C.text, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit', borderRadius: 4, outline: 'none' }} />
            <button onClick={runSelectByFilter} style={{ ...mbtn, background: C.accentDim, borderColor: C.accent, color: '#cfe6ff', padding: '8px', fontWeight: 700 }}>Select units</button>
            {selCount > 0 && <button onClick={() => setSelectedIds(new Set())} style={{ ...mbtn, padding: '6px' }}>Clear selection ({selCount})</button>}
          </div>
        </div>
      )}

      {/* ── Top command / status bar ─────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44, display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', zIndex: 3, background: 'linear-gradient(180deg, rgba(9,13,20,0.96), rgba(9,13,20,0.72))', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: err ? C.red : C.green, boxShadow: `0 0 8px ${err ? C.red : C.green}` }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: C.text }}>LIVE TACTICAL</span>
        </div>

        {canSpawn && (
          <div style={{ display: 'flex', gap: 0, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
            {(['select', 'spawn', 'iads'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setArmed(null); setTool('select'); if (m !== 'spawn') handlePlace(null, ''); }}
                      style={{ ...seg, ...(mode === m ? segOn : {}) }}>{m === 'select' ? '⊹ Control' : m === 'spawn' ? '✛ Spawn' : '◎ IADS'}</button>
            ))}
          </div>
        )}

        {/* Lock/unlock protected (Mission Editor) units */}
        {canCommand && (
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
          {dbg && <span onClick={() => setDbgOpen((o) => !o)} title="Click: inspect decoded units"
                        style={{ color: dbgOpen ? C.accent : C.textDim, fontSize: 11, cursor: 'pointer', textDecoration: 'underline dotted' }}>{dbg}</span>}
          {err && <span style={{ color: C.red }}>✗ {err}</span>}
        </div>
      </div>

      {/* Decoded-feed inspector (click the feed counter). Shows what the browser
          actually received — newest olympusID first — to diagnose missing units. */}
      {dbgOpen && (
        <div style={{ position: 'absolute', top: 50, right: 12, width: 320, maxHeight: 'calc(100% - 90px)', zIndex: 6, display: 'flex', flexDirection: 'column', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
          <div style={{ padding: '7px 10px', fontSize: 11, fontWeight: 700, borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
            <span>DECODED FEED ({dbg})</span>
            <span onClick={() => setDbgOpen(false)} style={{ cursor: 'pointer', color: C.textDim }}>×</span>
          </div>
          {(() => {
            const off = [
              !showHuman && 'human', !showOlympus && 'OLYMPUS', !showDcs && 'dcs',
              !showRed && 'red', !showBlue && 'blue', !showNeutral && 'neutral',
              !showAircraft && 'aircraft', !showHelicopter && 'heli', !showSam && 'sam',
              !showGround && 'ground', !showNavy && 'navy', !showDead && 'dead',
            ].filter(Boolean) as string[];
            return (
              <div style={{ padding: '6px 10px', fontSize: 10, borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                {off.length
                  ? <span style={{ color: C.red }}>Hidden by filter: {off.join(', ')}</span>
                  : <span style={{ color: C.green }}>All filters ON</span>}
                {off.length > 0 && (
                  <button onClick={() => {
                    if (!showHuman) toggleHuman(); if (!showOlympus) toggleOlympus(); if (!showDcs) toggleDcs();
                    if (!showRed) toggleRed(); if (!showBlue) toggleBlue(); if (!showNeutral) toggleNeutral();
                    if (!showAircraft) toggleAircraft(); if (!showHelicopter) toggleHelicopter(); if (!showSam) toggleSam();
                    if (!showGround) toggleGround(); if (!showNavy) toggleNavy(); if (!showDead) toggleDead();
                  }} style={{ ...mbtn, padding: '2px 8px', flexShrink: 0 }}>Show all</button>
                )}
              </div>
            );
          })()}
          <div style={{ overflowY: 'auto', fontSize: 11, fontFamily: 'monospace' }}>
            {Object.values(unitsRef.current)
              .map((x) => x.u)
              .sort((a, b) => (b.olympusID ?? 0) - (a.olympusID ?? 0))
              .slice(0, 60)
              .map((u) => {
                const pos = u.position && typeof u.position.lat === 'number';
                return (
                  <div key={u.olympusID ?? Math.random()} style={{ display: 'flex', gap: 6, padding: '2px 10px', borderBottom: '1px solid rgba(255,255,255,0.03)', color: pos ? C.text : C.red }}>
                    <span style={{ width: 70, color: C.textDim }}>{u.olympusID}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || '—'}</span>
                    <span style={{ color: u.coalition === 1 ? C.red : u.coalition === 2 ? C.blue : C.neutral }}>{u.coalition === 1 ? 'R' : u.coalition === 2 ? 'B' : 'N'}</span>
                    <span title="controlled" style={{ color: C.textDim }}>{u.controlled === 1 ? 'oly' : 'dcs'}</span>
                    <span style={{ width: 30, textAlign: 'right' }}>{pos ? 'pos' : 'NOPOS'}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Left dock: Spawn panel (Olympus-style browse + config) ───────── */}
      {canSpawn && mode === 'spawn' && (
        <SpawnPanel group={group} profile={profile}
                    onClose={() => { setMode('select'); handlePlace(null, ''); }}
                    onPlace={handlePlace} />
      )}

      {/* ── Left dock: IADS generator (draw an area → spawn an air-defence net) */}
      {canSpawn && mode === 'iads' && (
        <IadsPanel group={group} profile={profile} area={iadsArea}
                   onRadius={(nm) => setIadsArea((prev) => (prev ? { ...prev, radiusNm: nm } : prev))}
                   onClear={() => setIadsArea(null)}
                   onClose={() => { setMode('select'); setIadsArea(null); }} />
      )}

      {/* ── Right dock: selected unit control ────────────────────────────── */}
      {selCount > 0 && mode === 'select' && (
        <div style={{ position: 'absolute', top: 56, right: 12, width: 268, maxHeight: 'calc(100% - 110px)', display: 'flex', flexDirection: 'column', zIndex: 3, ...glass, borderColor: selSide }}>
          <div style={{ ...panelHead, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, borderBottom: `1px solid ${C.border}`, borderTop: `2px solid ${selSide}` }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
              {anyProtected && <span title="Selection includes protected Mission Editor unit(s)" style={{ color: C.red }}>🔒</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selCount === 1 ? (selected?.unitName || selected?.name || '—') : `${selCount} units selected`}
              </span>
            </span>
            <button onClick={() => setSelectedIds(new Set())} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ overflowY: 'auto', padding: 10 }}>
            {selCount === 1 && selected && (
              <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.7 }}>
                <div>Type&nbsp; <span style={{ color: C.text }}>{selected.name || '—'}</span></div>
                <div>Side&nbsp;&nbsp; <span style={{ color: selSide, fontWeight: 600 }}>{sideLabel(selected.coalition)}</span> · {selected.category || ''}</div>
                <div>Pos&nbsp;&nbsp;&nbsp; <span style={{ color: C.text }}>{selected.position ? `${selected.position.lat.toFixed(3)}, ${selected.position.lng.toFixed(3)}` : '—'}</span></div>
              </div>
            )}
            {selCount > 1 && <div style={{ color: C.textDim, fontSize: 12 }}>Commands below apply to all {selCount} selected units.</div>}
            {canControl && selCount > 0 && (
              <div style={{ marginTop: 10 }}>
                {canCommand && <>
                <SectionLabel>Tasking{selCount > 1 ? ` (×${selCount})` : ''}</SectionLabel>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <button style={cardBtn} onClick={() => setArmed({ kind: 'move' })}>📍 Move</button>
                  <button style={cardBtn} onClick={() => setArmed({ kind: 'attack' })}>🎯 Attack</button>
                  <button style={cardBtn} onClick={() => setArmed({ kind: 'fireAtArea' })}>🔥 Fire</button>
                  <button style={cardBtn} onClick={() => setArmed({ kind: 'bombPoint' })}>💣 Bomb</button>
                </div>

                <SectionLabel>Altitude</SectionLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: C.accent, fontWeight: 700, fontSize: 13, width: 64, fontVariantNumeric: 'tabular-nums' }}>{ctlAlt.toLocaleString()} ft</span>
                  <input type="range" min={0} max={45000} step={500} value={ctlAlt} onChange={(e) => setCtlAlt(Number(e.target.value))}
                         onMouseUp={() => cmdSel('setAltitude', (id) => ({ ID: id, altitude: Math.round(ctlAlt * 0.3048) }), 'Set alt')} style={{ flex: 1 }} />
                  {(['ASL', 'AGL'] as const).map((t) => (
                    <button key={t} onClick={() => cmdSel('setAltitudeType', (id) => ({ ID: id, altitudeType: t }), t)}
                            style={{ ...segBtn, ...((sUnit?.desiredAltitudeType === 1 ? 'AGL' : 'ASL') === t ? segBtnOn : {}) }}>{t}</button>
                  ))}
                </div>

                <SectionLabel>Speed</SectionLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: C.accent, fontWeight: 700, fontSize: 13, width: 64, fontVariantNumeric: 'tabular-nums' }}>{ctlSpd} kt</span>
                  <input type="range" min={0} max={600} step={10} value={ctlSpd} onChange={(e) => setCtlSpd(Number(e.target.value))}
                         onMouseUp={() => cmdSel('setSpeed', (id) => ({ ID: id, speed: Math.round(ctlSpd * 0.514444) }), 'Set spd')} style={{ flex: 1 }} />
                  {(['CAS', 'GS'] as const).map((t) => (
                    <button key={t} onClick={() => cmdSel('setSpeedType', (id) => ({ ID: id, speedType: t }), t)}
                            style={{ ...segBtn, ...((sUnit?.desiredSpeedType === 1 ? 'GS' : 'CAS') === t ? segBtnOn : {}) }}>{t}</button>
                  ))}
                </div>

                <SectionLabel>ROE</SectionLabel>
                <Seg options={['Free', 'Desig', 'Return', 'Hold']} active={selCount === 1 ? (sUnit?.ROE ?? 0) - 1 : undefined}
                     onPick={(i) => cmdSel('setROE', (id) => ({ ID: id, ROE: i + 1 }), 'ROE')} />
                <SectionLabel>Alarm state</SectionLabel>
                <Seg options={['Auto', 'Green', 'Red']} active={selCount === 1 ? sUnit?.alarmState : undefined}
                     onPick={(i) => cmdSel('setAlarmState', (id) => ({ ID: id, alarmState: i }), 'Alarm state')} />
                <SectionLabel>Threat reaction</SectionLabel>
                <Seg options={['None', 'Manvr', 'Passive', 'Evade']} active={selCount === 1 ? sUnit?.reactionToThreat : undefined}
                     onPick={(i) => cmdSel('setReactionToThreat', (id) => ({ ID: id, reactionToThreat: i }), 'Reaction')} />
                <SectionLabel>Radar / ECM</SectionLabel>
                <Seg options={['Silent', 'Attack', 'Defend', 'Free']} active={selCount === 1 ? sUnit?.emissionsCountermeasures : undefined}
                     onPick={(i) => cmdSel('setEmissionsCountermeasures', (id) => ({ ID: id, emissionsCountermeasures: i }), 'Radar/ECM')} />
                <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
                  <button style={cardBtn} onClick={() => cmdSel('setOnOff', (id) => ({ ID: id, onOff: true }), 'On')}>On</button>
                  <button style={cardBtn} onClick={() => cmdSel('setOnOff', (id) => ({ ID: id, onOff: false }), 'Off')}>Off</button>
                  <button style={cardBtn} onClick={() => cmdSel('setFollowRoads', (id) => ({ ID: id, followRoads: true }), 'Roads')}>Roads</button>
                </div>
                </>}

                {(canEffects || canDelete) && <SectionLabel>Mark / Remove</SectionLabel>}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {canEffects && (
                    <button style={cardBtn} onClick={() => cmdSel('smoke', (id) => {
                      const pos = unitsRef.current[String(id)]?.u?.position;
                      return { color: 'green', location: { lat: pos?.lat ?? 0, lng: pos?.lng ?? 0 } };
                    }, 'Smoke')}>💨 Smoke</button>
                  )}
                  {canDelete && (
                    <button style={{ ...cardBtn, color: C.red, borderColor: '#5a2a2a' }}
                            onClick={() => { if (window.confirm(`Delete ${selCount === 1 ? `"${selected?.unitName || selected?.name}"` : `${selCount} units`} from the LIVE mission?`)) cmdSel('deleteUnit', (id) => ({ ID: id, explosion: false, explosionType: '', immediate: true }), 'Delete'); }}>✕ Delete</button>
                  )}
                </div>
              </div>
            )}
            {cmdMsg && <div style={{ marginTop: 8, fontSize: 12, color: cmdMsg.startsWith('✗') ? C.red : C.green }}>{cmdMsg}</div>}
          </div>
        </div>
      )}

      {/* ── Armed-action banner ──────────────────────────────────────────── */}
      {armed && (
        <div style={{ position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)', zIndex: 4, display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 6, background: 'rgba(9,13,20,0.95)', border: `1px solid ${C.accent}`, color: '#cfe6ff', fontSize: 12, boxShadow: `0 0 16px rgba(74,158,255,0.25)` }}>
          <span style={{ fontWeight: 600 }}>
            {(armed.kind === 'move' ? '📍 Click the map to MOVE'
              : armed.kind === 'attack' ? '🎯 Click a TARGET unit'
              : armed.kind === 'fireAtArea' ? '🔥 Click the map: FIRE AT AREA'
              : '💣 Click the map: BOMB POINT') + (selCount > 1 ? ` (${selCount} units)` : '')}
          </span>
          <button onClick={() => setArmed(null)} style={{ ...mbtn, padding: '2px 9px' }}>cancel</button>
          {cmdMsg && <span style={{ color: cmdMsg.startsWith('✗') ? C.red : C.green }}>{cmdMsg}</span>}
        </div>
      )}

      {/* ── Bottom status bar ────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 26, display: 'flex', alignItems: 'center', gap: 16, padding: '0 12px', zIndex: 2, background: 'linear-gradient(0deg, rgba(9,13,20,0.96), rgba(9,13,20,0.55))', borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.textDim, fontVariantNumeric: 'tabular-nums' }}>
        <span ref={coordRef}>—</span>
        <div style={{ flex: 1 }} />
        <span>{ROLE_LABEL[group.role] || group.role}</span>
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
// Toggle chip for the Selection tool criteria.
function Chip({ on, accent, onClick, children }: { on: boolean; accent?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
            style={{ border: `1px solid ${on ? (accent || C.accent) : C.border}`, background: on ? (accent ? `${accent}22` : C.accentDim) : 'transparent', color: on ? (accent || '#cfe6ff') : C.textDim, borderRadius: 12, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
      {children}
    </button>
  );
}
// Segmented button row — tap to send a command; highlights the unit's current value.
function Seg({ options, active, onPick }: { options: string[]; active?: number; onPick: (i: number) => void }) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' }}>
      {options.map((o, i) => (
        <button key={i} onClick={() => onPick(i)} style={{ flex: 1, ...segBtn, ...(active === i ? segBtnOn : {}), borderLeft: i ? `1px solid ${C.border}` : 'none' }}>{o}</button>
      ))}
    </div>
  );
}

const glass: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, boxShadow: '0 6px 20px rgba(0,0,0,0.45)', overflow: 'hidden' };
const panelHead: React.CSSProperties = { padding: '8px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text, background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${C.border}` };
const fGroup: React.CSSProperties = { display: 'flex', gap: 5 };
const toolBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 5, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.04)', color: C.text, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', lineHeight: 1 };
const toolOn: React.CSSProperties = { borderColor: C.accent, background: C.accentDim, color: '#cfe6ff' };
const seg: React.CSSProperties = { background: 'transparent', border: 'none', color: C.textDim, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const segOn: React.CSSProperties = { background: C.accentDim, color: '#cfe6ff' };
const mbtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '3px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const cardBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '5px 9px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const segBtn: React.CSSProperties = { background: 'transparent', border: 'none', color: C.textDim, padding: '4px 6px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' };
const segBtnOn: React.CSSProperties = { background: C.accentDim, color: '#cfe6ff', fontWeight: 700 };
