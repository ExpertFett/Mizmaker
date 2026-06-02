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
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import CircleGeom from 'ol/geom/Circle';
import PolygonGeom from 'ol/geom/Polygon';
import LineString from 'ol/geom/LineString';
import { fromLonLat, toLonLat } from 'ol/proj';
import { getDistance } from 'ol/sphere';
import { Style, Circle as CircleStyle, RegularShape, Fill, Stroke, Text } from 'ol/style';
import { boundingExtent } from 'ol/extent';
import Draw from 'ol/interaction/Draw';
import 'ol/ol.css';
import {
  getTelemetry, sendCommand, getUnitDatabase, can, ROLE_LABEL,
  type GroupSummary, type ServerProfile, type UnitCategory, type UnitDbEntry,
} from '../../api/groups';
import { SpawnPanel } from './SpawnPanel';
import { IadsPanel } from './IadsPanel';
import type { IadsArea } from './iadsRecipes';
import { computeBra, formatBra, metresToFeet, type LL } from './braCalc';
import { buildPictureCall, formatPictureCall, type PictureTrack } from './pictureCall';
import { SrsDirectory } from './SrsDirectory';
import { CommsLog } from './CommsLog';
import { bullseyeBR, formatBullseye } from './bullseye';
import { BrevityCard } from './BrevityCard';
import { NineLineBuilder } from './NineLineBuilder';
import { TriggersPanel } from './TriggersPanel';
import { postComms } from '../../api/groups';
import { useMissionStore } from '../../store/missionStore';
import { useAiStore, getActiveAiCreds } from '../../ai/aiStore';
import { identifyAirfieldFromImage } from './chartAiIdentify';

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

// Olympus heading/track arrive in radians (0 = north, clockwise). Guard against
// a feed that sends degrees (would be a huge "radian" value) by converting.
function headingRad(u: UnitT): number {
  let h = typeof u.heading === 'number' ? u.heading
    : typeof u.track === 'number' ? u.track : NaN;
  if (!isFinite(h)) return 0;
  if (Math.abs(h) > Math.PI * 2 + 0.5) h = (h * Math.PI) / 180;  // looks like degrees
  return h;
}

// Category-shaped, coalition-colored marker, rotated to the unit's heading
// (air = a triangle that points where it's flying). Dead units render dimmed +
// hollow. Labels: 0=off, 1=basic (callsign/name), 2=rich GCI block (callsign
// on top, ALT thousands + 3-digit HDG, then SPD knots). Styles are cheap and
// built per-unit (heading is continuous, so caching doesn't help).
function styleForUnit(u: UnitT, labelsMode: LabelsMode = 0, bullseye?: { lat: number; lng: number } | null): Style {
  const cat = (u.category || '').toLowerCase();
  const bucket = cat.includes('heli') ? 'air'
    : cat.includes('air') || cat.includes('plane') ? 'air'
    : cat.includes('navy') || cat.includes('ship') ? 'navy'
    : cat.includes('ground') ? 'ground' : 'dot';
  const side = u.coalition ?? -1;
  const dead = u.alive === 0;
  const color = dead ? '#6b7280' : (SIDE_COLOR[side] ?? C.neutral);
  const fill = new Fill({ color: dead ? 'rgba(107,114,128,0.35)' : color });
  const stroke = new Stroke({ color: dead ? 'rgba(107,114,128,0.9)' : 'rgba(0,0,0,0.65)', width: dead ? 1 : 1.25 });
  const rot = headingRad(u);
  // 2525-faithful symbology (Phase 5): hostile = chevron, friendly = circle,
  // neutral / unknown = square. All air markers still rotated to heading; the
  // rotation drives a vector readout for the eye even at low zoom.
  //   side 1 (red/hostile)   → top-only chevron (inverted-V pointing along heading)
  //   side 2 (blue/friendly) → circle (LotATC convention: friend = round)
  //   else                   → square (neutral)
  // Ground + navy keep distinct shapes (square / diamond) so the controller
  // still tells them apart from the air picture.
  let image;
  if (bucket === 'air') {
    if (side === 1) {
      // Hostile chevron — pointy 3-sided shape, oriented to heading.
      image = new RegularShape({ points: 3, radius: 9, radius2: 4, fill, stroke, rotation: rot });
    } else if (side === 2) {
      // Friendly half-moon — circle with a thin heading tick added below via
      // a second Style image is too heavy in OL; use a solid circle with a
      // stroke ring instead, and rely on the GCI label rich mode for heading.
      image = new CircleStyle({ radius: 6.5, fill, stroke: new Stroke({ color: dead ? 'rgba(107,114,128,0.9)' : color, width: 2 }) });
    } else {
      // Neutral / unknown air — square, rotated to heading.
      image = new RegularShape({ points: 4, radius: 6, angle: Math.PI / 4, fill, stroke, rotation: rot });
    }
  }
  else if (bucket === 'navy') image = new RegularShape({ points: 4, radius: 6.5, fill, stroke, rotation: rot });
  else if (bucket === 'ground') image = new RegularShape({ points: 4, radius: 5.5, angle: Math.PI / 4, fill, stroke, rotation: rot });
  else image = new CircleStyle({ radius: 4.5, fill, stroke });
  const style = new Style({ image });
  if (labelsMode === 1) {
    const label = u.unitName || u.name || '';
    if (label) style.setText(new Text({
      text: label, font: '10px sans-serif', offsetY: 15,
      fill: new Fill({ color: dead ? '#8a93a0' : '#cfe0f0' }),
      stroke: new Stroke({ color: 'rgba(8,12,18,0.9)', width: 2.5 }),
    }));
  } else if (labelsMode === 2) {
    // GCI block: line 1 callsign, line 2 alt(thousands) + 3-digit heading, line 3 knots.
    const callsign = u.unitName || u.name || '';
    const altKft = u.position?.alt != null && Number.isFinite(u.position.alt)
      ? `${Math.round((u.position.alt * 3.28084) / 1000)}` : '—';
    const hdgRad = u.track != null ? u.track : u.heading;
    const hdgDeg = hdgRad != null && Number.isFinite(hdgRad)
      ? String(Math.round((hdgRad * 180 / Math.PI + 360) % 360)).padStart(3, '0')
      : '—';
    const knots = u.speed != null && Number.isFinite(u.speed)
      ? `${Math.round(u.speed * 1.94384)}` : '—';
    let beLine = '';
    if (bullseye && u.position) {
      const be = bullseyeBR(bullseye, { lat: u.position.lat, lng: u.position.lng });
      beLine = formatBullseye(be, { tag: 'BE' });
    }
    const lines = [
      callsign,
      `${altKft}K · ${hdgDeg}°`,
      `${knots} kt`,
      beLine,
    ].filter((s) => s && !s.startsWith(' ')).join('\n');
    if (lines) style.setText(new Text({
      text: lines, font: 'bold 10px sans-serif', offsetY: 22, textAlign: 'center',
      fill: new Fill({ color: dead ? '#8a93a0' : '#e7f0fb' }),
      stroke: new Stroke({ color: 'rgba(8,12,18,0.95)', width: 3 }),
    }));
  }
  return style;
}

interface UnitT {
  olympusID?: number; name?: string; unitName?: string; category?: string;
  coalition?: number; alive?: number; controlled?: number; human?: number;
  ROE?: number; reactionToThreat?: number; alarmState?: number; emissionsCountermeasures?: number;
  desiredAltitudeType?: number; desiredSpeedType?: number;  // 1=AGL/1=GS ; 0=ASL/0=CAS
  heading?: number; track?: number;  // radians (0=N, CW) — for the heading arrow
  speed?: number;  // m/s — shipped by the decoder for moving units
  position?: { lat: number; lng: number; alt?: number };
}

// 0 = off, 1 = basic (unit name), 2 = rich (CALLSIGN / ALT·HDG / SPD)
type LabelsMode = 0 | 1 | 2;

// Highlight ring drawn around each selected unit.
const SEL_STYLE = new Style({ image: new CircleStyle({ radius: 11, stroke: new Stroke({ color: '#ffd24a', width: 2 }), fill: undefined }) });

// Style for a cluster of N ground units: count badge colored by majority side.
function clusterStyle(features: Feature[], labelsMode: LabelsMode = 0, bullseye?: { lat: number; lng: number } | null): Style {
  if (features.length === 1) { const u = features[0].get('unit') as UnitT | undefined; return styleForUnit(u || {}, labelsMode, bullseye); }
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

// BRA-tool feature styling: solid yellow line from anchor → target, both
// endpoints marked with a 2-px dot, and a labelled chip floating at the
// midpoint (BRA bearing/range/altitude). The anchor dot is hollow so it
// reads as a "pinned" point distinct from the target.
function braFeatureStyle(feature: Feature): Style {
  const role = feature.get('_role') as 'anchor' | 'target' | 'line' | 'label' | undefined;
  const label = feature.get('_label') as string | undefined;
  if (role === 'label' && label) return new Style({
    text: new Text({ text: label, font: 'bold 12px sans-serif', offsetY: -14,
      fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: 'rgba(0,0,0,0.9)', width: 3 }),
      backgroundFill: new Fill({ color: 'rgba(9,13,20,0.92)' }),
      backgroundStroke: new Stroke({ color: '#ffd24a', width: 1 }), padding: [3, 6, 2, 6] }),
  });
  if (role === 'anchor') return new Style({
    image: new CircleStyle({ radius: 5, fill: new Fill({ color: 'rgba(255,210,74,0.15)' }), stroke: new Stroke({ color: '#ffd24a', width: 2 }) }),
  });
  if (role === 'target') return new Style({
    image: new CircleStyle({ radius: 4, fill: new Fill({ color: '#ffd24a' }), stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 1 }) }),
  });
  // line
  return new Style({ stroke: new Stroke({ color: '#ffd24a', width: 1.8 }) });
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
  const hoverRef = useRef<HTMLDivElement | null>(null);  // Phase 6 — track-hover info chip
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
  const historySrcRef = useRef<VectorSource | null>(null); // GCI track-history trails
  // Per-unit position breadcrumbs for the track-history overlay. Keyed by
  // olympusID (or unitName/name fallback). Pushed each poll, pruned to the
  // active trailSec window each render.
  const historyRef = useRef<Map<string, Array<{ lat: number; lng: number; t: number }>>>(new Map());
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
  // 3-state labels (off / basic / rich). Migrates the legacy boolean key on
  // first read: '0' → off, '1' → basic. Cycle order: off → basic → rich → off.
  const [labelsMode, setLabelsMode] = useState<LabelsMode>(() => {
    try {
      const v = localStorage.getItem('dcsopt.live.labelsMode');
      if (v === '0' || v === '1' || v === '2') return Number(v) as LabelsMode;
      // Migrate legacy 'dcsopt.live.labels' boolean → basic if it was on (the default).
      const legacy = localStorage.getItem('dcsopt.live.labels');
      return legacy === '0' ? 0 : 1;
    } catch { return 1; }
  });
  const cycleLabels = () => setLabelsMode((p) => {
    const next = ((p + 1) % 3) as LabelsMode;
    try { localStorage.setItem('dcsopt.live.labelsMode', String(next)); } catch { /* ignore */ }
    return next;
  });
  const labelsModeRef = useRef<LabelsMode>(labelsMode);
  labelsModeRef.current = labelsMode;  // read by the (once-registered) cluster layer style
  // Legacy alias so the existing dep arrays don't all have to be renamed.
  const showLabels = labelsMode;

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
        // Apply friend/foe override before styling so labels show the DM's
        // chosen tag. The unit object isn't mutated — we shallow-clone.
        const labeled = u.olympusID != null && unitLabels[u.olympusID]
          ? { ...u, unitName: unitLabels[u.olympusID] } : u;
        ft.setStyle(styleForUnit(labeled, showLabels, bullseyePin ? { lat: bullseyePin.lat, lng: bullseyePin.lng } : null)); src.addFeature(ft);
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
  // IADS generator drawn area. Circle: centre + radius. Polygon: vertex list.
  // Clicks in 'iads' mode set the centre (circle) or append a vertex (polygon).
  const [iadsShape, setIadsShape] = useState<'circle' | 'polygon' | 'freehand'>('circle');
  const [iadsCircle, setIadsCircle] = useState<{ lat: number; lng: number; radiusNm: number } | null>(null);
  const [iadsPoly, setIadsPoly] = useState<{ lat: number; lng: number }[]>([]);
  // Unified area for the panel/generator (null until something is drawn).
  const iadsArea: IadsArea | null = iadsShape === 'circle'
    ? (iadsCircle ? { shape: 'circle', ...iadsCircle } : null)
    : (iadsPoly.length > 0 ? { shape: 'polygon', verts: iadsPoly } : null);
  const clearIads = () => { setIadsCircle(null); setIadsPoly([]); };
  const placeFnRef = useRef<((lat: number, lng: number) => void) | null>(null);
  const [placeLabel, setPlaceLabel] = useState('');
  const handlePlace = useCallback((fn: ((lat: number, lng: number) => void) | null, label: string) => {
    placeFnRef.current = fn; setPlaceLabel(fn ? label : '');
  }, []);

  // Map tools (zoom / select / measure / bra / erase). Tool 'measure' makes
  // clicks drop range+bearing points; 'select' is normal unit selection;
  // 'bra' is the GCI Bearing/Range/Altitude tool — 1st click sets the anchor,
  // 2nd sets the target, 3rd resets to a new anchor.
  const [tool, setTool] = useState<'select' | 'measure' | 'bra' | 'gci' | 'be' | 'marker' | 'draw' | 'airfield'>('select');
  // Drawing tool sub-mode + drawing state. Phase 7. Three primitives —
  // straight line, arrow (line + arrowhead at the second point), freehand
  // polyline — all using OL's built-in Draw interaction. Persisted across
  // reloads (`dcsopt.live.drawings`) so the DM's scribble survives a tab
  // refresh.
  type DrawKind = 'line' | 'arrow' | 'freehand';
  const [drawKind, setDrawKind] = useState<DrawKind>(() => (localStorage.getItem('dcsopt.live.drawKind') as DrawKind) || 'line');
  useEffect(() => { try { localStorage.setItem('dcsopt.live.drawKind', drawKind); } catch { /* ignore */ } }, [drawKind]);
  const [drawColor, setDrawColor] = useState<string>(() => localStorage.getItem('dcsopt.live.drawColor') || '#ffd24a');
  useEffect(() => { try { localStorage.setItem('dcsopt.live.drawColor', drawColor); } catch { /* ignore */ } }, [drawColor]);
  // Stroke thickness in CSS px. Persisted; new drawings inherit. Existing
  // drawings keep whatever width they were drawn at — width is stored on
  // each DrawnFeature so the prompt slider doesn't restyle history.
  const [drawWidth, setDrawWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('dcsopt.live.drawWidth') ?? '2');
    return Number.isFinite(v) && v >= 1 && v <= 8 ? v : 2;
  });
  useEffect(() => { try { localStorage.setItem('dcsopt.live.drawWidth', String(drawWidth)); } catch { /* ignore */ } }, [drawWidth]);
  // Drawing info-label mode (Phase 7b → reworked v1.19.6). Labels no longer
  // sit on every drawing permanently. Instead:
  //   - LIVE: while you're laying a line/arrow, a floating chip near the
  //     cursor shows the running BRA / BE from start to current endpoint
  //   - REVEAL: clicking a finished drawing in 'select' mode renders its
  //     label until you click elsewhere
  // The toggle picks which call format (BRA bearing/range or BE bullseye-
  // relative) for both modes.
  type DrawInfoMode = 'bra' | 'bullseye' | 'off';
  const [drawInfoMode, setDrawInfoMode] = useState<DrawInfoMode>(() => (localStorage.getItem('dcsopt.live.drawInfoMode') as DrawInfoMode) || 'bra');
  useEffect(() => { try { localStorage.setItem('dcsopt.live.drawInfoMode', drawInfoMode); } catch { /* ignore */ } }, [drawInfoMode]);
  const drawInfoModeRef = useRef(drawInfoMode);
  drawInfoModeRef.current = drawInfoMode;
  // Click-to-reveal: the drawing currently selected for showing its BRA label.
  // Null when nothing's selected. Cleared by clicking empty space in 'select'.
  const [selectedDrawingId, setSelectedDrawingId] = useState<number | null>(null);
  // Floating chip for the live readout while drawing — written direct to DOM.
  const liveDrawInfoRef = useRef<HTMLDivElement | null>(null);
  type DrawnFeature = { id: number; kind: DrawKind; color: string; width?: number; coords: [number, number][] };  // [lng,lat]
  const [drawings, setDrawings] = useState<DrawnFeature[]>(() => {
    try { const raw = JSON.parse(localStorage.getItem('dcsopt.live.drawings') || '[]'); return Array.isArray(raw) ? raw as DrawnFeature[] : []; }
    catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('dcsopt.live.drawings', JSON.stringify(drawings)); } catch { /* ignore */ } }, [drawings]);
  const drawSrcRef = useRef<VectorSource | null>(null);
  const drawIdRef = useRef<number>(1);
  useEffect(() => {
    if (drawings.length > 0) drawIdRef.current = Math.max(drawIdRef.current, ...drawings.map((d) => d.id || 0)) + 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Friend/foe label override — per-unit rename keyed by olympusID. Persisted
  // (`dcsopt.live.unitLabels`). Used in styleForUnit, hover chip, and the
  // picture-call panel so the DM can refer to a track as "BOGEY-1" instead of
  // its game callsign.
  const [unitLabels, setUnitLabels] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem('dcsopt.live.unitLabels') || '{}'); }
    catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem('dcsopt.live.unitLabels', JSON.stringify(unitLabels)); } catch { /* ignore */ } }, [unitLabels]);
  const unitLabelsRef = useRef<Record<number, string>>(unitLabels);
  unitLabelsRef.current = unitLabels;
  // Context menu — opens on right-click of a unit. Position in screen px;
  // null = closed.
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; unit: UnitT } | null>(null);

  // Chart / plate overlays (Phase 8). DM uploads a PNG/JPG (an approach
  // plate, sector map, kill-box graphic) and pins it to the map at a chosen
  // centre + size (width/height in NM). Renders via OL ImageLayer + Static
  // source; opacity is per-overlay. Persisted to localStorage; image data
  // URLs can be large so the panel shows a size estimate + warns at 4 MB.
  type ChartOverlay = {
    id: number; label: string; dataUrl: string;
    centerLat: number; centerLng: number;
    widthNm: number; heightNm: number;
    /** naturalH / naturalW from the source image — used to preserve aspect
     *  ratio when the user drags the W or H slider. Optional for charts
     *  saved before this field existed; falls back to current heightNm/widthNm. */
    aspectRatio?: number;
    /** When true (default), editing W or H also adjusts the other dimension
     *  so the image keeps its natural proportions. v1.19.5. */
    aspectLocked?: boolean;
    opacity: number;  // 0..1
    visible: boolean;
  };
  const [charts, setCharts] = useState<ChartOverlay[]>(() => {
    try { const raw = JSON.parse(localStorage.getItem('dcsopt.live.charts') || '[]'); return Array.isArray(raw) ? raw as ChartOverlay[] : []; }
    catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem('dcsopt.live.charts', JSON.stringify(charts)); }
    catch (e) {
      // QuotaExceeded — surface a warning, don't crash.
      setCmdMsg(`✗ Chart save: storage full (${e instanceof Error ? e.message : 'quota'})`);
    }
  }, [charts]);
  const chartIdRef = useRef<number>(1);
  useEffect(() => {
    if (charts.length > 0) chartIdRef.current = Math.max(chartIdRef.current, ...charts.map((c) => c.id || 0)) + 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ImageLayer instances are mutated outside React (add / remove from the OL
  // map). Track them by chart id so updates can target the specific layer.
  const chartLayersRef = useRef<Map<number, ImageLayer<ImageStatic>>>(new Map());
  const [chartsPanelOpen, setChartsPanelOpen] = useState(false);
  // AI helper for chart placement is defined further down (after airfieldList).
  // Cursor-driven chart placement (Phase 8b). When the panel hands us a
  // pending payload, we show a ghost preview that follows the cursor; the
  // next map click commits placement, Esc / right-click cancels.
  type PendingChart = {
    label: string; dataUrl: string;
    widthNm: number; heightNm: number; opacity: number;
    // Ghost size in screen pixels — set to the preview's natural pixel size
    // so the user sees the image at the size it'll occupy at the current zoom.
    pxW: number; pxH: number;
  };
  const [pendingChartPlacement, setPendingChartPlacement] = useState<PendingChart | null>(null);
  const pendingChartRef = useRef<PendingChart | null>(null);
  pendingChartRef.current = pendingChartPlacement;
  const pendingChartGhostRef = useRef<HTMLDivElement | null>(null);

  // Airfield search panel — toggle + live filter that highlights matching
  // airbases. Phase 7. The abSrc layer always renders; the search panel just
  // controls a separate "highlight" overlay.
  const [airfieldSearchOpen, setAirfieldSearchOpen] = useState(false);
  const [airfieldQuery, setAirfieldQuery] = useState('');
  const [airfieldList, setAirfieldList] = useState<Array<{ name: string; lat: number; lng: number; coalition: unknown; unitId?: number }>>([]);
  const airfieldHighlightRef = useRef<VectorSource | null>(null);
  // AI airfield identification for chart placement. Reads the active BYOK
  // creds — Anthropic or Gemini — and calls the vision identifier helper.
  // Available when there's a key configured AND we have airfield candidates.
  const aiCreds = useAiStore((s) => getActiveAiCreds(s));
  const chartAiAvailable = !!aiCreds.key && airfieldList.length > 0;
  const chartAiIdentify = useCallback(async (dataUrl: string) => {
    if (!aiCreds.key) return { match: null as string | null, reason: 'No AI key configured.' };
    const r = await identifyAirfieldFromImage({
      provider: aiCreds.provider, apiKey: aiCreds.key, model: aiCreds.model,
      dataUrl, candidates: airfieldList,
    });
    return { match: r.match, reason: r.reason };
  }, [aiCreds.provider, aiCreds.key, aiCreds.model, airfieldList]);
  const [measurePts, setMeasurePts] = useState<number[][]>([]);  // [lon,lat] vertices
  // Track-history trail window in seconds. 0 = off. Persisted across reloads.
  const [trailSec, setTrailSec] = useState<0 | 30 | 60 | 120>(() => {
    try { const v = Number(localStorage.getItem('dcsopt.live.trailSec') ?? '0'); return ([0, 30, 60, 120] as const).includes(v as 0 | 30 | 60 | 120) ? (v as 0 | 30 | 60 | 120) : 0; }
    catch { return 0; }
  });
  const cycleTrailSec = () => setTrailSec((p) => {
    const next = p === 0 ? 30 : p === 30 ? 60 : p === 60 ? 120 : 0;
    try { localStorage.setItem('dcsopt.live.trailSec', String(next)); } catch { /* ignore */ }
    return next;
  });
  const trailSecRef = useRef(trailSec);
  trailSecRef.current = trailSec;
  // GCI range rings — controller-placed circles with adjustable radius (NM).
  // The default-radius slider value is used at drop time. Persisted across
  // page reloads + mission re-uploads (Phase 6) so the DM doesn't lose the
  // station-circle layout mid-session.
  type GciRing = { id: number; lat: number; lng: number; nm: number };
  const [gciRings, setGciRings] = useState<GciRing[]>(() => {
    try { const raw = JSON.parse(localStorage.getItem('dcsopt.live.gciRings') || '[]'); return Array.isArray(raw) ? raw as GciRing[] : []; }
    catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('dcsopt.live.gciRings', JSON.stringify(gciRings)); } catch { /* ignore */ } }, [gciRings]);
  const [gciDefaultNm, setGciDefaultNm] = useState<number>(() => {
    const v = Number(localStorage.getItem('dcsopt.live.gciDefaultNm') ?? '30');
    return Number.isFinite(v) && v > 0 ? v : 30;
  });
  useEffect(() => { try { localStorage.setItem('dcsopt.live.gciDefaultNm', String(gciDefaultNm)); } catch { /* ignore */ } }, [gciDefaultNm]);
  const gciSrcRef = useRef<VectorSource | null>(null);
  const gciIdRef = useRef<number>(1);
  // Initialise the id counter to one past the highest persisted id so new
  // rings don't collide with restored ones (otherwise React's key dedup
  // would treat the new ring as a re-render of an old one).
  useEffect(() => {
    if (gciRings.length > 0) gciIdRef.current = Math.max(gciIdRef.current, ...gciRings.map((r) => r.id || 0)) + 1;
  // Run once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Bullseye (Phase 5). Auto-loads from missionStore when present; the DM can
  // override by activating the 🎯 BE tool and clicking. **Manual** placements
  // persist across reloads (Phase 6) — the controller's hand-placed BE is
  // valuable enough to survive a tab refresh.
  type BullseyePin = { lat: number; lng: number; source: 'mission' | 'manual' };
  const missionBullseye = useMissionStore((s) => s.overview?.bullseye?.blue);
  const [bullseyePin, setBullseyePin] = useState<BullseyePin | null>(() => {
    try {
      const raw = localStorage.getItem('dcsopt.live.bullseyeManual');
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p?.lat === 'number' && typeof p?.lng === 'number') {
        return { lat: p.lat, lng: p.lng, source: 'manual' };
      }
    } catch { /* ignore */ }
    return null;
  });
  // Mirror manual placements into localStorage; null + mission-source clears the slot.
  useEffect(() => {
    try {
      if (bullseyePin?.source === 'manual') {
        localStorage.setItem('dcsopt.live.bullseyeManual', JSON.stringify({ lat: bullseyePin.lat, lng: bullseyePin.lng }));
      } else {
        localStorage.removeItem('dcsopt.live.bullseyeManual');
      }
    } catch { /* ignore */ }
  }, [bullseyePin]);
  // Initial seed from mission. Re-seeds whenever the mission's BE changes
  // (new .miz upload) — but only when the DM hasn't manually overridden.
  useEffect(() => {
    if (missionBullseye?.lat != null && missionBullseye?.lon != null) {
      setBullseyePin((prev) => prev?.source === 'manual' ? prev : { lat: missionBullseye.lat!, lng: missionBullseye.lon!, source: 'mission' });
    }
  }, [missionBullseye?.lat, missionBullseye?.lon]);
  const bullseyeSrcRef = useRef<VectorSource | null>(null);
  // Ref so the once-registered cluster style sees the current bullseye each render.
  const bullseyeRef = useRef<{ lat: number; lng: number } | null>(null);
  bullseyeRef.current = bullseyePin ? { lat: bullseyePin.lat, lng: bullseyePin.lng } : null;

  // Named markers — colored labeled pins the DM drops anywhere (anchors,
  // station points, target reference points). Persisted across reloads
  // (Phase 6) — the DM's scope layout survives a tab refresh.
  type MapMarker = { id: number; lat: number; lng: number; label: string; color: string };
  const [markers, setMarkers] = useState<MapMarker[]>(() => {
    try { const raw = JSON.parse(localStorage.getItem('dcsopt.live.markers') || '[]'); return Array.isArray(raw) ? raw as MapMarker[] : []; }
    catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('dcsopt.live.markers', JSON.stringify(markers)); } catch { /* ignore */ } }, [markers]);
  const [markerLabel, setMarkerLabel] = useState<string>(() => localStorage.getItem('dcsopt.live.markerLabel') || 'STN1');
  useEffect(() => { try { localStorage.setItem('dcsopt.live.markerLabel', markerLabel); } catch { /* ignore */ } }, [markerLabel]);
  const [markerColor, setMarkerColor] = useState<string>(() => localStorage.getItem('dcsopt.live.markerColor') || '#ffd24a');
  useEffect(() => { try { localStorage.setItem('dcsopt.live.markerColor', markerColor); } catch { /* ignore */ } }, [markerColor]);
  const markerSrcRef = useRef<VectorSource | null>(null);
  const markerIdRef = useRef<number>(1);
  useEffect(() => {
    if (markers.length > 0) markerIdRef.current = Math.max(markerIdRef.current, ...markers.map((m) => m.id || 0)) + 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Picture-call panel — open by default if the user has ever opened it before
  // (persisted) so DMs who use it always see it.
  const [pictureOpen, setPictureOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('dcsopt.live.pictureOpen') === '1'; } catch { return false; }
  });
  const togglePicture = () => setPictureOpen((p) => {
    const next = !p;
    try { localStorage.setItem('dcsopt.live.pictureOpen', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  // Picture-call format mode (Phase 5). Defaults to bullseye when one is set,
  // BRAA otherwise. Persisted so DMs who prefer BRAA keep it across sessions.
  const [pictureMode, setPictureMode] = useState<'braa' | 'bullseye'>(() => {
    try { return (localStorage.getItem('dcsopt.live.pictureMode') as 'braa' | 'bullseye') || 'bullseye'; }
    catch { return 'bullseye'; }
  });
  useEffect(() => { try { localStorage.setItem('dcsopt.live.pictureMode', pictureMode); } catch { /* ignore */ } }, [pictureMode]);
  const [srsOpen, setSrsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('dcsopt.live.srsOpen') === '1'; } catch { return false; }
  });
  const toggleSrs = () => setSrsOpen((p) => {
    const next = !p;
    try { localStorage.setItem('dcsopt.live.srsOpen', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  const [commsOpen, setCommsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('dcsopt.live.commsOpen') === '1'; } catch { return false; }
  });
  const toggleComms = () => setCommsOpen((p) => {
    const next = !p;
    try { localStorage.setItem('dcsopt.live.commsOpen', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  const [brevityOpen, setBrevityOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('dcsopt.live.brevityOpen') === '1'; } catch { return false; }
  });
  const toggleBrevity = () => setBrevityOpen((p) => {
    const next = !p;
    try { localStorage.setItem('dcsopt.live.brevityOpen', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  const [nineLineOpen, setNineLineOpen] = useState(false);  // not persisted — modal-style use
  const [triggersOpen, setTriggersOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('dcsopt.live.triggersOpen') === '1'; } catch { return false; }
  });
  const toggleTriggers = () => setTriggersOpen((p) => {
    const next = !p;
    try { localStorage.setItem('dcsopt.live.triggersOpen', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  // BRA tool state. Anchor + target are independent lat/lng+optional-alt points.
  // When both are present, the line + chip render and the persistent readout
  // updates. `_unitId` lets us re-resolve a clicked unit each render so live
  // altitude/track stay current as the unit moves.
  type BraPoint = { lat: number; lng: number; altFt?: number; trackDeg?: number; unitId?: number; label?: string };
  const [braAnchor, setBraAnchor] = useState<BraPoint | null>(null);
  const [braTarget, setBraTarget] = useState<BraPoint | null>(null);
  const braSrcRef = useRef<VectorSource | null>(null);
  // Refresh BRA endpoints from live unit telemetry each poll so the call
  // stays current as the bandit moves. Cleared by the tool's clear button.
  const refreshBraFromUnits = useCallback(() => {
    setBraAnchor((p) => {
      if (!p?.unitId) return p;
      const u = unitsRef.current[String(p.unitId)]?.u;
      if (!u?.position) return p;
      const trackDeg = u.track != null ? (u.track * 180 / Math.PI + 360) % 360 : u.heading != null ? (u.heading * 180 / Math.PI + 360) % 360 : undefined;
      return { ...p, lat: u.position.lat, lng: u.position.lng, altFt: metresToFeet(u.position.alt), trackDeg };
    });
    setBraTarget((p) => {
      if (!p?.unitId) return p;
      const u = unitsRef.current[String(p.unitId)]?.u;
      if (!u?.position) return p;
      const trackDeg = u.track != null ? (u.track * 180 / Math.PI + 360) % 360 : u.heading != null ? (u.heading * 180 / Math.PI + 360) % 360 : undefined;
      return { ...p, lat: u.position.lat, lng: u.position.lng, altFt: metresToFeet(u.position.alt), trackDeg };
    });
  }, []);
  // Computed call for the persistent readout + the floating chip on the map.
  const braCall = braAnchor && braTarget
    ? computeBra({ lat: braAnchor.lat, lng: braAnchor.lng }, { lat: braTarget.lat, lng: braTarget.lng, altFt: braTarget.altFt })
    : null;

  // Rebuild the track-history layer from the current ring buffers. One
  // LineString per unit for the PAST (breadcrumbs) and a second forward-
  // projected line for the FUTURE (extrapolation) — coupled to the same
  // trail window so the controller sees a single "where it's been + where
  // it's going" stripe through every moving track. Forward leg uses
  // current track + speed, straight-line at constant velocity (no
  // turn-radius modelling — these are vectoring aids, not predictions).
  const rebuildHistoryLayer = useCallback(() => {
    const src = historySrcRef.current; if (!src) return;
    src.clear();
    const winSec = trailSecRef.current;
    if (winSec === 0) return;
    const hist = historyRef.current;
    const store = unitsRef.current as Record<string, { u: UnitT; miss: number }>;
    for (const [key, arr] of hist) {
      const u = store[key]?.u;
      const coalition = u?.coalition;
      const color = SIDE_COLOR[coalition ?? -1] ?? C.neutral;
      // Past breadcrumb polyline.
      if (arr.length >= 2) {
        const coords = arr.map((p) => fromLonLat([p.lng, p.lat]));
        const f = new Feature({ geometry: new LineString(coords) });
        f.setStyle(new Style({ stroke: new Stroke({ color: hexA(color, 0.7), width: 1.4 }) }));
        src.addFeature(f);
      }
      // Forward extrapolation — only when the unit has a usable track + speed
      // and is alive. Distance covered in `winSec` at current speed (m/s).
      if (!u || u.alive === 0 || !u.position) continue;
      const spdMs = (typeof u.speed === 'number' && Number.isFinite(u.speed)) ? u.speed : 0;
      if (spdMs < 5) continue;  // hide noisy near-stationary "vectors"
      const trkRad = (typeof u.track === 'number') ? u.track
        : (typeof u.heading === 'number') ? u.heading : null;
      if (trkRad == null) continue;
      const distM = spdMs * winSec;
      // Spherical forward step from current position along track bearing.
      const R = 6371000;
      const phi1 = u.position.lat * Math.PI / 180;
      const lam1 = u.position.lng * Math.PI / 180;
      const d = distM / R;
      const phi2 = Math.asin(Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(trkRad));
      const lam2 = lam1 + Math.atan2(Math.sin(trkRad) * Math.sin(d) * Math.cos(phi1), Math.cos(d) - Math.sin(phi1) * Math.sin(phi2));
      const fwdLat = phi2 * 180 / Math.PI;
      const fwdLng = ((lam2 * 180 / Math.PI) + 540) % 360 - 180;
      const fwdLine = new Feature({ geometry: new LineString([
        fromLonLat([u.position.lng, u.position.lat]),
        fromLonLat([fwdLng, fwdLat]),
      ]) });
      fwdLine.setStyle(new Style({ stroke: new Stroke({ color: hexA(color, 0.55), width: 1.2, lineDash: [4, 4] }) }));
      src.addFeature(fwdLine);
      // Terminal tick — small perpendicular at the end of the leader line.
      const tick = new Feature({ geometry: new Point(fromLonLat([fwdLng, fwdLat])) });
      tick.setStyle(new Style({ image: new CircleStyle({ radius: 2.5, fill: new Fill({ color: hexA(color, 0.8) }), stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 1 }) }) }));
      src.addFeature(tick);
    }
  }, []);
  // Refresh trails when the window changes (clears stale segments outside the new window).
  useEffect(() => { rebuildHistoryLayer(); }, [trailSec, rebuildHistoryLayer]);

  // Rebuild the GCI rings layer when the ring list changes. Same lat-corrected
  // projected-radius pattern as `ringFeature`. Each ring shows a centre dot,
  // the ring outline, and a small radius label.
  useEffect(() => {
    const src = gciSrcRef.current; if (!src) return;
    src.clear();
    for (const r of gciRings) {
      const center = fromLonLat([r.lng, r.lat]);
      const projR = (r.nm * 1852) / Math.max(0.15, Math.cos(r.lat * Math.PI / 180));
      const ring = new Feature({ geometry: new CircleGeom(center, projR) });
      ring.setStyle(new Style({
        stroke: new Stroke({ color: '#9ad0ff', width: 1.4, lineDash: [4, 4] }),
        fill: new Fill({ color: 'rgba(154,208,255,0.04)' }),
      }));
      src.addFeature(ring);
      const dot = new Feature({ geometry: new Point(center) });
      dot.setStyle(new Style({ image: new CircleStyle({ radius: 3, fill: new Fill({ color: '#9ad0ff' }), stroke: new Stroke({ color: 'rgba(0,0,0,0.7)', width: 1 }) }) }));
      src.addFeature(dot);
      const lbl = new Feature({ geometry: new Point(center) });
      lbl.setStyle(new Style({ text: new Text({
        text: `${r.nm} NM`, font: 'bold 10px sans-serif', offsetY: -10,
        fill: new Fill({ color: '#9ad0ff' }), stroke: new Stroke({ color: 'rgba(0,0,0,0.8)', width: 3 }),
      }) }));
      src.addFeature(lbl);
    }
  }, [gciRings]);

  // Bullseye overlay — concentric rings at 30/60/90/120 NM, a small cross,
  // a "BE" label, and an indicator chip showing the source (mission/manual).
  // Same lat-corrected projected radius as GCI rings + threat rings.
  useEffect(() => {
    const src = bullseyeSrcRef.current; if (!src) return;
    src.clear();
    if (!bullseyePin) return;
    const center = fromLonLat([bullseyePin.lng, bullseyePin.lat]);
    const cosLat = Math.max(0.15, Math.cos(bullseyePin.lat * Math.PI / 180));
    const RING_NM = [30, 60, 90, 120];
    for (const nm of RING_NM) {
      const projR = (nm * 1852) / cosLat;
      const ring = new Feature({ geometry: new CircleGeom(center, projR) });
      ring.setStyle(new Style({
        stroke: new Stroke({ color: '#f0b840', width: 1, lineDash: [3, 5] }),
      }));
      src.addFeature(ring);
      // Range label on the right side of each ring.
      const labelOffset = projR;
      const labelPt = new Feature({ geometry: new Point([center[0] + labelOffset, center[1]]) });
      labelPt.setStyle(new Style({ text: new Text({
        text: `${nm}`, font: '9px sans-serif', textAlign: 'left', offsetX: 4,
        fill: new Fill({ color: '#f0b840' }), stroke: new Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
      }) }));
      src.addFeature(labelPt);
    }
    // Central cross + "BE" label.
    const crossH = new Feature({ geometry: new LineString([
      [center[0] - 14, center[1]], [center[0] + 14, center[1]],
    ]) });
    crossH.setStyle(new Style({ stroke: new Stroke({ color: '#f0b840', width: 1.4 }) }));
    src.addFeature(crossH);
    const crossV = new Feature({ geometry: new LineString([
      [center[0], center[1] - 14], [center[0], center[1] + 14],
    ]) });
    crossV.setStyle(new Style({ stroke: new Stroke({ color: '#f0b840', width: 1.4 }) }));
    src.addFeature(crossV);
    const dot = new Feature({ geometry: new Point(center) });
    dot.setStyle(new Style({ image: new CircleStyle({ radius: 3, fill: new Fill({ color: '#f0b840' }), stroke: new Stroke({ color: '#000', width: 1 }) }) }));
    src.addFeature(dot);
    const lbl = new Feature({ geometry: new Point(center) });
    lbl.setStyle(new Style({ text: new Text({
      text: 'BE', font: 'bold 11px sans-serif', offsetX: 0, offsetY: 22, textAlign: 'center',
      fill: new Fill({ color: '#f0b840' }), stroke: new Stroke({ color: 'rgba(0,0,0,0.9)', width: 3 }),
    }) }));
    src.addFeature(lbl);
  }, [bullseyePin]);

  // Named map markers — coloured pin + label per entry.
  useEffect(() => {
    const src = markerSrcRef.current; if (!src) return;
    src.clear();
    for (const m of markers) {
      const p = fromLonLat([m.lng, m.lat]);
      const pin = new Feature({ geometry: new Point(p) });
      pin.setStyle(new Style({
        image: new RegularShape({ points: 3, radius: 7, angle: Math.PI, fill: new Fill({ color: m.color }), stroke: new Stroke({ color: 'rgba(0,0,0,0.8)', width: 1.2 }) }),
        text: new Text({ text: m.label, font: 'bold 11px sans-serif', offsetY: -14,
          fill: new Fill({ color: m.color }), stroke: new Stroke({ color: 'rgba(0,0,0,0.9)', width: 3 }) }),
      }));
      src.addFeature(pin);
    }
  }, [markers]);

  // Free drawings — render the persisted list. Each kind gets its own style:
  // line = solid stroke; arrow = solid stroke + filled triangle at the tip;
  // freehand = the same stroke (drawn as a polyline). Phase 7. Line + arrow
  // drawings also get a BRA / BE label at their midpoint when info mode is on.
  useEffect(() => {
    const src = drawSrcRef.current; if (!src) return;
    src.clear();
    for (const d of drawings) {
      if (!d.coords || d.coords.length < 2) continue;
      const proj = d.coords.map((c) => fromLonLat(c));
      const line = new Feature({ geometry: new LineString(proj) });
      // Tag so the singleclick hit-test can resolve clicks on the line to
      // its parent drawing for the reveal-on-click flow.
      line.set('_drawingId', d.id);
      // Base width = stored value (defaults to 2 for pre-v1.19.7 drawings).
      // Selected drawing strokes +1 px so the reveal click reads as selected.
      const baseW = d.width ?? 2;
      const renderW = d.id === selectedDrawingId ? baseW + 1 : baseW;
      line.setStyle(new Style({ stroke: new Stroke({ color: d.color, width: renderW }) }));
      src.addFeature(line);
      if (d.kind === 'arrow') {
        // Arrowhead at the last point, pointing along the last segment.
        const n = proj.length;
        const [ax, ay] = proj[n - 2], [bx, by] = proj[n - 1];
        const ang = Math.atan2(by - ay, bx - ax);
        const head = new Feature({ geometry: new Point([bx, by]) });
        head.setStyle(new Style({
          image: new RegularShape({
            points: 3, radius: 9, fill: new Fill({ color: d.color }),
            stroke: new Stroke({ color: 'rgba(0,0,0,0.6)', width: 1 }),
            rotation: -ang + Math.PI / 2,
          }),
        }));
        src.addFeature(head);
      }
      // Reveal-on-click label (v1.19.6): only show the BRA/BE chip for the
      // drawing the user has clicked. Freehand still gets nothing — a curved
      // path's "start→end bearing" reads as misleading.
      const showLabel =
        d.id === selectedDrawingId &&
        drawInfoMode !== 'off' &&
        (d.kind === 'line' || d.kind === 'arrow');
      if (showLabel) {
        const startLL = d.coords[0];
        const endLL = d.coords[d.coords.length - 1];
        const start: LL = { lat: startLL[1], lng: startLL[0] };
        const end: LL = { lat: endLL[1], lng: endLL[0] };
        let label: string;
        if (drawInfoMode === 'bullseye' && bullseyePin) {
          const be = bullseyeBR({ lat: bullseyePin.lat, lng: bullseyePin.lng }, end);
          label = formatBullseye(be, { tag: 'BE' });
        } else {
          const br = computeBra(start, end);
          label = formatBra(br, { decorate: false });
        }
        const midProj = proj[Math.floor(proj.length / 2)];
        const lbl = new Feature({ geometry: new Point(midProj) });
        lbl.setStyle(new Style({ text: new Text({
          text: label, font: 'bold 11px sans-serif', offsetY: -10,
          fill: new Fill({ color: d.color }),
          stroke: new Stroke({ color: 'rgba(0,0,0,0.95)', width: 3 }),
          backgroundFill: new Fill({ color: 'rgba(9,13,20,0.85)' }),
          backgroundStroke: new Stroke({ color: d.color, width: 1 }),
          padding: [3, 6, 2, 6],
        }) }));
        src.addFeature(lbl);
      }
    }
  }, [drawings, drawInfoMode, bullseyePin, selectedDrawingId]);

  // ESC cancels a pending chart placement.
  useEffect(() => {
    if (!pendingChartPlacement) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingChartPlacement(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingChartPlacement]);

  // Reconcile the chart-overlay layer collection with the React state. Each
  // chart maps to one OL ImageLayer; when a chart's extent / opacity /
  // visibility changes we update the existing layer in place rather than
  // tearing it down (avoids a load-flicker each time the panel changes).
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const live = chartLayersRef.current;
    const currentIds = new Set(charts.map((c) => c.id));
    // Remove any layers for charts no longer in state.
    for (const [id, layer] of live) {
      if (!currentIds.has(id)) { map.removeLayer(layer); live.delete(id); }
    }
    // Project lat/lng + size in NM into the EPSG:3857 extent OL needs.
    // Web Mercator scales BOTH horizontal AND vertical distance by 1/cos(lat)
    // at small extents — earlier code lat-corrected only width, which squashed
    // images vertically at higher latitudes. Fixed v1.19.8.
    for (const c of charts) {
      const center = fromLonLat([c.centerLng, c.centerLat]);
      const cosLat = Math.max(0.15, Math.cos(c.centerLat * Math.PI / 180));
      const halfW = (c.widthNm * 1852) / cosLat / 2;
      const halfH = (c.heightNm * 1852) / cosLat / 2;
      const extent: [number, number, number, number] = [
        center[0] - halfW, center[1] - halfH,
        center[0] + halfW, center[1] + halfH,
      ];
      const existing = live.get(c.id);
      if (existing) {
        existing.setOpacity(c.opacity);
        existing.setVisible(c.visible);
        // ImageStatic doesn't support extent updates — replace its source when
        // extent changes. Cheap (the data URL is already decoded).
        const src = existing.getSource();
        const cur = src?.getImageExtent?.();
        if (!cur || cur[0] !== extent[0] || cur[1] !== extent[1] || cur[2] !== extent[2] || cur[3] !== extent[3]) {
          existing.setSource(new ImageStatic({ url: c.dataUrl, imageExtent: extent, projection: 'EPSG:3857' }));
        }
      } else {
        const layer = new ImageLayer({
          source: new ImageStatic({ url: c.dataUrl, imageExtent: extent, projection: 'EPSG:3857' }),
          opacity: c.opacity, visible: c.visible,
        });
        // Insert ABOVE the basemap (index 1) so chart overlays sit between
        // the basemap tiles and the tactical vector stack.
        map.getLayers().insertAt(1, layer);
        live.set(c.id, layer);
      }
    }
  }, [charts]);

  // OL Draw interaction — active only when tool === 'draw'. drawKind chooses
  // line / arrow (both straight 2-point linestrings) / freehand (open path).
  // While the geometry is being placed we run a live BRA / BE readout into
  // the floating drawing chip (v1.19.6).
  useEffect(() => {
    const map = mapRef.current; const src = drawSrcRef.current;
    if (!map || !src) return;
    if (tool !== 'draw') return;
    const isFree = drawKind === 'freehand';
    const draw = new Draw({
      source: new VectorSource(),  // throw-away — we read coords on drawend
      type: 'LineString',
      freehand: isFree,
      maxPoints: isFree ? undefined : 2,
    });

    let geomListenerOff: (() => void) | null = null;
    const updateLiveChip = (geom: any) => {
      const chip = liveDrawInfoRef.current;
      if (!chip) return;
      const mode = drawInfoModeRef.current;
      if (mode === 'off') { chip.style.display = 'none'; return; }
      const coords = geom?.getCoordinates?.() as number[][] | undefined;
      if (!coords || coords.length < 2) { chip.style.display = 'none'; return; }
      const a = coords[0], b = coords[coords.length - 1];
      const aLL = toLonLat(a), bLL = toLonLat(b);
      const start: LL = { lat: aLL[1], lng: aLL[0] };
      const end: LL = { lat: bLL[1], lng: bLL[0] };
      let text: string;
      if (mode === 'bullseye' && bullseyeRef.current) {
        const be = bullseyeBR(bullseyeRef.current, end);
        text = formatBullseye(be, { tag: 'BE' });
      } else {
        const br = computeBra(start, end);
        text = formatBra(br, { decorate: false });
      }
      chip.textContent = text;
      chip.style.display = 'block';
      // Position next to the cursor — the OL pixel for the geometry's
      // current end-vertex is the freshest cursor approximation.
      const px = map.getPixelFromCoordinate(b);
      if (px) {
        chip.style.left = `${px[0] + 12}px`;
        chip.style.top = `${px[1] - 18}px`;
      }
    };

    draw.on('drawstart', (e: any) => {
      const feature = e.feature;
      if (!feature) return;
      const geom = feature.getGeometry();
      const handler = () => updateLiveChip(geom);
      handler();
      geom.on('change', handler);
      geomListenerOff = () => geom.un('change', handler);
    });

    draw.on('drawend', (e: any) => {
      if (geomListenerOff) { geomListenerOff(); geomListenerOff = null; }
      if (liveDrawInfoRef.current) liveDrawInfoRef.current.style.display = 'none';
      const geom = e.feature?.getGeometry?.();
      if (!geom) return;
      const ring = geom.getCoordinates() as number[][];
      const verts: [number, number][] = ring.map((c) => {
        const ll = toLonLat(c);
        return [ll[0], ll[1]] as [number, number];
      });
      if (verts.length < 2) return;
      setDrawings((prev) => [...prev, { id: drawIdRef.current++, kind: drawKind, color: drawColor, width: drawWidth, coords: verts }]);
    });
    map.addInteraction(draw);
    return () => {
      if (geomListenerOff) geomListenerOff();
      if (liveDrawInfoRef.current) liveDrawInfoRef.current.style.display = 'none';
      map.removeInteraction(draw);
    };
  }, [tool, drawKind, drawColor, drawWidth]);

  // Airfield search — the airbase poll loop above populates airfieldList
  // inline now (no need for a separate refresh effect). Highlight overlay
  // tracks the query.
  useEffect(() => {
    const src = airfieldHighlightRef.current; if (!src) return;
    src.clear();
    if (!airfieldQuery.trim()) return;
    const q = airfieldQuery.trim().toLowerCase();
    for (const a of airfieldList) {
      if (!a.name.toLowerCase().includes(q)) continue;
      const c = fromLonLat([a.lng, a.lat]);
      const ring = new Feature({ geometry: new CircleGeom(c, 600) });
      ring.setStyle(new Style({ stroke: new Stroke({ color: '#ffd24a', width: 2 }), fill: new Fill({ color: 'rgba(255,210,74,0.10)' }) }));
      src.addFeature(ring);
    }
  }, [airfieldQuery, airfieldList]);
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
    onBra: (lat: number, lng: number, target: UnitT | null) => {
      // Build a BRA point. If the click hit a live unit, capture its altitude
      // (metres → feet) and heading/track (rad → deg) so the call uses real
      // telemetry. Otherwise just the surface position is used.
      const buildPt = (): BraPoint => {
        if (target?.position) {
          const trackDeg = target.track != null ? (target.track * 180 / Math.PI + 360) % 360
            : target.heading != null ? (target.heading * 180 / Math.PI + 360) % 360 : undefined;
          return {
            lat: target.position.lat,
            lng: target.position.lng,
            altFt: metresToFeet(target.position.alt),
            trackDeg,
            unitId: target.olympusID,
            label: target.unitName || target.name,
          };
        }
        return { lat, lng };
      };
      const pt = buildPt();
      // 3-state cycle: nothing set → set anchor. Anchor set, no target → set target.
      // Both set → start over (new anchor, clear target).
      if (!braAnchor) { setBraAnchor(pt); setBraTarget(null); return; }
      if (!braTarget) { setBraTarget(pt); return; }
      setBraAnchor(pt); setBraTarget(null);
    },
    onGci: (lat: number, lng: number) => {
      setGciRings((prev) => [...prev, { id: gciIdRef.current++, lat, lng, nm: gciDefaultNm }]);
    },
    onBullseye: (lat: number, lng: number) => {
      setBullseyePin({ lat, lng, source: 'manual' });
    },
    onMarker: (lat: number, lng: number) => {
      const label = (markerLabel || `M${markerIdRef.current}`).trim();
      setMarkers((prev) => [...prev, { id: markerIdRef.current++, lat, lng, label, color: markerColor }]);
    },
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
    onIads: (lat: number, lng: number) => {
      if (iadsShape === 'circle') setIadsCircle((prev) => ({ lat, lng, radiusNm: prev?.radiusNm ?? 30 }));
      else if (iadsShape === 'polygon') setIadsPoly((prev) => [...prev, { lat, lng }]);
      // 'freehand': OL Draw interaction handles drag-to-draw; clicks do nothing.
    },
  };

  // Rebuild the BRA layer (anchor dot + target dot + connecting line + chip)
  // every time either endpoint moves. Empty when neither is set.
  useEffect(() => {
    const src = braSrcRef.current; if (!src) return;
    src.clear();
    if (!braAnchor && !braTarget) return;
    if (braAnchor) {
      const af = new Feature({ geometry: new Point(fromLonLat([braAnchor.lng, braAnchor.lat])) });
      af.set('_role', 'anchor'); src.addFeature(af);
    }
    if (braTarget) {
      const tf = new Feature({ geometry: new Point(fromLonLat([braTarget.lng, braTarget.lat])) });
      tf.set('_role', 'target'); src.addFeature(tf);
    }
    if (braAnchor && braTarget && braCall) {
      const a = fromLonLat([braAnchor.lng, braAnchor.lat]);
      const b = fromLonLat([braTarget.lng, braTarget.lat]);
      const lf = new Feature({ geometry: new LineString([a, b]) });
      lf.set('_role', 'line'); src.addFeature(lf);
      const labelPt = new Feature({ geometry: new Point([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) });
      labelPt.set('_role', 'label');
      labelPt.set('_label', formatBra(braCall));
      src.addFeature(labelPt);
    }
  }, [braAnchor, braTarget, braCall]);

  // Freehand polygon: while in iads + freehand mode, attach OL's built-in Draw
  // interaction (type:'Polygon', freehand:true) — drag-to-draw a continuous path.
  // On finish, convert the projected ring to lat/lng verts and store in iadsPoly
  // so the existing render + generator pipeline takes over unchanged.
  useEffect(() => {
    const map = mapRef.current; const src = iadsSrcRef.current;
    if (!map || !src) return;
    if (mode !== 'iads' || iadsShape !== 'freehand') return;
    const draw = new Draw({ source: src, type: 'Polygon', freehand: true });
    draw.on('drawend', (e: any) => {
      const geom = e.feature?.getGeometry?.();
      if (!geom) return;
      const ring = geom.getCoordinates()[0] as number[][];
      const verts: { lat: number; lng: number }[] = ring.map((c) => {
        const ll = toLonLat(c);
        return { lat: ll[1], lng: ll[0] };
      });
      // OL's Polygon ring repeats its first point at the end — drop the dup.
      if (verts.length > 1) {
        const a = verts[0], b = verts[verts.length - 1];
        if (Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9) verts.pop();
      }
      setIadsPoly(verts);
      // Remove the draw so the next mode/shape change doesn't stack interactions.
      map.removeInteraction(draw);
    });
    map.addInteraction(draw);
    return () => { map.removeInteraction(draw); };
  }, [mode, iadsShape]);

  // Draw the IADS generator area overlay. Circle radius is lat-corrected so the
  // projected circle matches the real ground radius used to distribute sites.
  useEffect(() => {
    const src = iadsSrcRef.current; if (!src) return;
    src.clear();
    if (iadsShape === 'circle' && iadsCircle) {
      const center = fromLonLat([iadsCircle.lng, iadsCircle.lat]);
      const projR = (iadsCircle.radiusNm * 1852) / Math.cos((iadsCircle.lat * Math.PI) / 180);
      src.addFeature(new Feature({ geometry: new CircleGeom(center, projR) }));
      src.addFeature(new Feature({ geometry: new Point(center) }));
    } else if (iadsShape === 'polygon' && iadsPoly.length > 0) {
      const ring = iadsPoly.map((v) => fromLonLat([v.lng, v.lat]));
      if (ring.length >= 3) src.addFeature(new Feature({ geometry: new PolygonGeom([[...ring, ring[0]]]) }));
      else if (ring.length === 2) src.addFeature(new Feature({ geometry: new LineString(ring) }));
      ring.forEach((c) => src.addFeature(new Feature({ geometry: new Point(c) })));
    }
  }, [iadsShape, iadsCircle, iadsPoly]);

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
    const clusterLayer = new VectorLayer({ source: clusterSrc, style: (f) => clusterStyle(f.get('features') as Feature[], labelsModeRef.current, bullseyeRef.current) });
    const measureSrc = new VectorSource();
    measureSrcRef.current = measureSrc;
    const measureLayer = new VectorLayer({ source: measureSrc, style: (f) => measureFeatureStyle(f as Feature) });
    const braSrc = new VectorSource();
    braSrcRef.current = braSrc;
    const braLayer = new VectorLayer({ source: braSrc, style: (f) => braFeatureStyle(f as Feature) });
    const iadsSrc = new VectorSource();
    iadsSrcRef.current = iadsSrc;
    const iadsLayer = new VectorLayer({ source: iadsSrc, style: (f) => iadsFeatureStyle(f as Feature) });
    const gciSrc = new VectorSource();
    gciSrcRef.current = gciSrc;
    // GCI rings carry their own per-feature style (we tint each ring by index).
    const gciLayer = new VectorLayer({ source: gciSrc });
    const bullseyeSrc = new VectorSource();
    bullseyeSrcRef.current = bullseyeSrc;
    // Bullseye carries its own per-feature style (concentric rings + cross + label).
    const bullseyeLayer = new VectorLayer({ source: bullseyeSrc });
    const markerSrc = new VectorSource();
    markerSrcRef.current = markerSrc;
    const markerLayer = new VectorLayer({ source: markerSrc });
    const drawSrc = new VectorSource();
    drawSrcRef.current = drawSrc;
    // Drawing layer carries per-feature styles (line / arrow / freehand all
    // use a thin stroke; arrow gets an arrowhead style on the last segment).
    const drawLayer = new VectorLayer({ source: drawSrc });
    const airfieldHighlight = new VectorSource();
    airfieldHighlightRef.current = airfieldHighlight;
    const airfieldHighlightLayer = new VectorLayer({ source: airfieldHighlight });
    const selSrc = new VectorSource();
    selSrcRef.current = selSrc;
    const selLayer = new VectorLayer({ source: selSrc, style: SEL_STYLE });
    const historySrc = new VectorSource();
    historySrcRef.current = historySrc;
    // Each history feature carries its own coalition-tinted style (set when
    // we rebuild the layer) — no shared style function needed.
    const historyLayer = new VectorLayer({ source: historySrc });
    abLayerRef.current = abLayer;
    const map = new OlMap({
      target: elRef.current,
      controls: [],  // hide default OL zoom/attribution; we float our own chrome
      layers: [
        new TileLayer({ source: new XYZ({ url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attributions: '© OpenStreetMap, © CARTO' }) }),
        abLayer,        // airbases under units
        ringLayer,      // threat rings under units
        iadsLayer,      // IADS generator area circle (under markers)
        gciLayer,       // GCI/ATC range rings (under markers)
        bullseyeLayer,  // bullseye reference (under markers, over rings)
        markerLayer,    // named map markers (above bullseye, under units)
        drawLayer,      // free drawings (lines / arrows / freehand)
        airfieldHighlightLayer,  // airfield search highlight rings
        selLayer,       // selection highlight rings (under markers)
        historyLayer,   // GCI track-history trails (under markers, above rings)
        clusterLayer,   // ground units (clustered)
        unitsLayer,     // air/navy units on top
        measureLayer,   // measure tool overlay
        braLayer,       // BRA tool overlay (topmost)
      ],
      view: new View({ center: fromLonLat([35, 43]), zoom: 6 }),
    });
    map.on('singleclick', (e) => {
      const c = ctrl.current;
      const ll = toLonLat(e.coordinate);
      const lng = ll[0], lat = ll[1];
      // Cursor-driven chart placement runs first — drops the pending chart
      // at the click position and clears the placement state.
      const pending = pendingChartRef.current;
      if (pending) {
        setCharts((p) => [...p, {
          id: chartIdRef.current++,
          label: pending.label, dataUrl: pending.dataUrl,
          centerLat: lat, centerLng: lng,
          widthNm: pending.widthNm, heightNm: pending.heightNm,
          opacity: pending.opacity, visible: true,
        }]);
        setPendingChartPlacement(null);
        return;
      }
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
      if (c.tool === 'bra') { c.onBra(lat, lng, target); return; }  // BRA uses hit-test (unit alt/track)
      if (c.tool === 'gci') { c.onGci(lat, lng); return; }
      if (c.tool === 'be')  { c.onBullseye(lat, lng); return; }
      if (c.tool === 'marker') { c.onMarker(lat, lng); return; }
      // In select mode, hit-test the drawing layer so the user can reveal
      // BRA/BE on a finished drawing by clicking it. (v1.19.6)
      if (c.tool === 'select') {
        const drawHit = map.forEachFeatureAtPixel(e.pixel, (ft) => ft, {
          hitTolerance: 8, layerFilter: (l) => l === drawLayer,
        });
        if (drawHit && !target) {
          // The drawing layer carries multiple feature types (line, label,
          // arrowhead). We marked the line feature with `_drawingId` so the
          // hit-test resolves to the parent drawing.
          const did = drawHit.get('_drawingId') as number | undefined;
          if (did != null) {
            setSelectedDrawingId((prev) => prev === did ? null : did);
            return;
          }
        } else if (!drawHit && !target) {
          // Empty space click clears the selected drawing too.
          setSelectedDrawingId(null);
        }
      }
      if (c.armed) { c.onArmed(lat, lng, target); return; }
      if (c.mode === 'spawn' && placeFnRef.current) { c.place(lat, lng); return; }
      c.onClickSelect(target, !!(e.originalEvent as MouseEvent)?.shiftKey);
    });
    // Live cursor coordinate readout + track-hover info chip (Phase 6).
    // Direct DOM writes — pointermove fires fast, React state would churn.
    map.on('pointermove', (e) => {
      if (e.dragging) { if (hoverRef.current) hoverRef.current.style.display = 'none'; return; }
      const ll = toLonLat(e.coordinate);
      const lat = ll[1], lng = ll[0];
      if (coordRef.current) {
        const ns = lat >= 0 ? 'N' : 'S', ew = lng >= 0 ? 'E' : 'W';
        coordRef.current.textContent = `${ns} ${Math.abs(lat).toFixed(4)}°   ${ew} ${Math.abs(lng).toFixed(4)}°`;
      }
      // Chart-placement ghost — follow the cursor so the user sees where
      // the image will drop. Position is screen-relative to the map element.
      const ghost = pendingChartGhostRef.current;
      const pending = pendingChartRef.current;
      if (ghost && pending) {
        const targetEl = map.getTargetElement() as HTMLElement | null;
        const rect = targetEl?.getBoundingClientRect();
        const me = e.originalEvent as MouseEvent;
        if (rect) {
          ghost.style.display = 'block';
          ghost.style.left = `${me.clientX - rect.left - pending.pxW / 2}px`;
          ghost.style.top = `${me.clientY - rect.top - pending.pxH / 2}px`;
          ghost.style.width = `${pending.pxW}px`;
          ghost.style.height = `${pending.pxH}px`;
        }
      } else if (ghost) {
        ghost.style.display = 'none';
      }
      // Hit-test for hover — same layer filter as the click handler.
      const f = map.forEachFeatureAtPixel(e.pixel, (ft) => ft, {
        hitTolerance: 6,
        layerFilter: (l) => l === unitsLayer || l === clusterLayer,
      });
      let hover: UnitT | null = null;
      if (f) {
        const clustered = f.get('features') as Feature[] | undefined;
        if (Array.isArray(clustered)) {
          hover = clustered.length === 1 ? (clustered[0]?.get('unit') as UnitT) ?? null : null;
        } else {
          hover = (f.get('unit') as UnitT) ?? null;
        }
      }
      const chip = hoverRef.current;
      if (!chip) return;
      if (!hover || !hover.position) { chip.style.display = 'none'; return; }
      // Build the chip text block: callsign · alt · hdg · spd · BE · BRA-from-anchor.
      const ov = hover.olympusID != null ? unitLabelsRef.current[hover.olympusID] : undefined;
      const callsign = ov || hover.unitName || hover.name || '—';
      const cat = String(hover.category || '').toLowerCase();
      const altFt = hover.position.alt != null ? hover.position.alt * 3.28084 : null;
      const altStr = altFt != null ? `${Math.round(altFt / 1000)}K` : '—';
      const hdgRad = hover.track ?? hover.heading;
      const hdgStr = hdgRad != null ? String(Math.round(((hdgRad * 180) / Math.PI + 360) % 360)).padStart(3, '0') : '—';
      const spdStr = typeof hover.speed === 'number' && Number.isFinite(hover.speed)
        ? `${Math.round(hover.speed * 1.94384)} kt` : '—';
      const lines: string[] = [`${callsign}  (${cat || '?'})`];
      lines.push(`ALT ${altStr} · HDG ${hdgStr}° · ${spdStr}`);
      const be = bullseyeRef.current;
      if (be) {
        const br = bullseyeBR(be, { lat: hover.position.lat, lng: hover.position.lng });
        lines.push(formatBullseye(br, { tag: 'BE' }));
      }
      chip.textContent = lines.join('\n');
      chip.style.display = 'block';
      // Position chip 14 px right + 14 px below cursor, clamped to map container.
      const target = map.getTargetElement() as HTMLElement | null;
      const rect = target?.getBoundingClientRect();
      const me = e.originalEvent as MouseEvent;
      if (rect) {
        chip.style.left = `${me.clientX - rect.left + 14}px`;
        chip.style.top = `${me.clientY - rect.top + 14}px`;
      }
    });
    mapRef.current = map;
    // Right-click → track context menu (Phase 7). Hit-test the unit/cluster
    // layer at the cursor; if a single unit is under it, open the rename UI.
    // Right-click also cancels a pending chart placement.
    const ctxTarget = map.getTargetElement() as HTMLElement | null;
    const onContext = (e: MouseEvent) => {
      if (pendingChartRef.current) {
        e.preventDefault();
        setPendingChartPlacement(null);
        return;
      }
      if (!ctxTarget) return;
      const rect = ctxTarget.getBoundingClientRect();
      const px: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
      const f = map.forEachFeatureAtPixel(px, (ft) => ft, {
        hitTolerance: 8,
        layerFilter: (l) => l === unitsLayer || l === clusterLayer,
      });
      let u: UnitT | null = null;
      if (f) {
        const clustered = f.get('features') as Feature[] | undefined;
        u = Array.isArray(clustered) ? (clustered.length === 1 ? (clustered[0]?.get('unit') as UnitT) : null) : (f.get('unit') as UnitT) ?? null;
      }
      if (u) {
        e.preventDefault();
        setTrackMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, unit: u });
      } else {
        setTrackMenu(null);
      }
    };
    ctxTarget?.addEventListener('contextmenu', onContext);
    const onResize = () => map.updateSize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      ctxTarget?.removeEventListener('contextmenu', onContext);
      map.setTarget(undefined); mapRef.current = null;
    };
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
        // Push live positions into the per-unit history ring buffer. Only
        // moving (air/heli/navy) units get trails; static ground noise would
        // just clutter the scope.
        const tNow = Date.now();
        const winMs = (trailSecRef.current || 0) * 1000;
        if (winMs > 0) {
          const hist = historyRef.current;
          for (const u of units) {
            const cat = String(u.category || '').toLowerCase();
            if (cat !== 'aircraft' && cat !== 'helicopter' && cat !== 'navyunit' && cat !== 'navy') continue;
            if (!u.position) continue;
            const key = u.olympusID != null ? String(u.olympusID) : (u.unitName || u.name || '');
            if (!key) continue;
            const arr = hist.get(key) ?? [];
            arr.push({ lat: u.position.lat, lng: u.position.lng, t: tNow });
            // Prune anything older than the window.
            while (arr.length && tNow - arr[0].t > winMs) arr.shift();
            hist.set(key, arr);
          }
          // Drop trails for units the feed has forgotten.
          for (const key of Array.from(hist.keys())) {
            if (!units.some((u) => (u.olympusID != null ? String(u.olympusID) : (u.unitName || u.name || '')) === key)) {
              hist.delete(key);
            }
          }
          rebuildHistoryLayer();
        } else if (historyRef.current.size) {
          historyRef.current.clear();
          rebuildHistoryLayer();
        }
        renderRef.current();  // rebuild features + counts (applies visibility filters)
        refreshBraFromUnits();  // keep BRA endpoints anchored to live units (alt/track move)
      } catch (e) { if (!cancelled) setErr(e instanceof Error ? e.message : 'failed'); }
    };
    poll(); const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [group.id, profile.id]);

  // Re-render instantly when a visibility filter toggles (don't wait for poll).
  useEffect(() => { renderRef.current(); }, [showHuman, showOlympus, showDcs, showRed, showBlue, showNeutral, showAircraft, showHelicopter, showSam, showGround, showNavy, showDead, showEng, showAcq, showLabels, selectedIds, bullseyePin, unitLabels]);

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
        // Build the airfield-search list inline from the same data we use
        // to draw markers. The old approach (reading style text) returned
        // nothing — OL's Style.getText() doesn't expose the resolved
        // string back through forEachFeature. (Bug fix v1.19.4.)
        const list: Array<{ name: string; lat: number; lng: number; coalition: unknown; unitId?: number }> = [];
        for (const a of Object.values(obj)) {
          const lat = Number(a?.latitude), lng = Number(a?.longitude);
          if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) continue;
          const name = a.callsign && a.callsign !== '' ? a.callsign : `carrier-${a.unitId ?? ''}`;
          const ft = new Feature({ geometry: new Point(fromLonLat([lng, lat])) });
          ft.setStyle(airbaseStyle(a.coalition, name));
          src.addFeature(ft);
          list.push({ name, lat, lng, coalition: a.coalition, unitId: a.unitId });
        }
        setAirfieldList(list);
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

  const armedActive = armed != null || (mode === 'spawn' && placeLabel !== '') || tool === 'measure' || tool === 'bra' || tool === 'gci' || tool === 'be' || tool === 'marker' || tool === 'draw' || mode === 'iads';
  const selSide = selected ? (SIDE_COLOR[selected.coalition ?? -1] ?? C.neutral) : C.neutral;
  // Live copy of the selected unit (refreshed each poll) for current-state highlights.
  const sUnit = selected ? (unitsRef.current[String(selected.olympusID)]?.u ?? selected) : null;
  // Picture call (auto bogey-dope). Anchor priority:
  //   1. BRA tool's anchor (if set)
  //   2. First friendly unit in the current selection (own-ship / GCI)
  //   3. First friendly unit in the live store (fallback)
  // Picture pulls every airborne hostile (aircraft / heli) from the live store.
  const pictureCall = (() => {
    let anchor: { lat: number; lng: number } | null = null;
    let anchorLabel = '';
    if (braAnchor) { anchor = { lat: braAnchor.lat, lng: braAnchor.lng }; anchorLabel = braAnchor.label || 'BRA anchor'; }
    else {
      const firstFriendly = selUnits.find((u) => u.coalition === 2 && u.position) ?? null;
      if (firstFriendly?.position) {
        anchor = { lat: firstFriendly.position.lat, lng: firstFriendly.position.lng };
        anchorLabel = firstFriendly.unitName || firstFriendly.name || 'selection';
      } else {
        // Fallback: first friendly in the store with a position.
        const store = unitsRef.current as Record<string, { u: UnitT; miss: number }>;
        for (const k of Object.keys(store)) {
          const u = store[k].u;
          if (u.coalition === 2 && u.alive !== 0 && u.position) {
            anchor = { lat: u.position.lat, lng: u.position.lng };
            anchorLabel = u.unitName || u.name || 'friendly';
            break;
          }
        }
      }
    }
    if (!anchor) return { call: null as ReturnType<typeof buildPictureCall>, anchorLabel: '' };
    const store = unitsRef.current as Record<string, { u: UnitT; miss: number }>;
    const tracks: PictureTrack[] = [];
    for (const k of Object.keys(store)) {
      const u = store[k].u;
      if (u.coalition !== 1) continue;          // hostiles only
      if (u.alive === 0) continue;
      if (!u.position) continue;
      const cat = String(u.category || '').toLowerCase();
      if (cat !== 'aircraft' && cat !== 'helicopter') continue;  // air picture only
      const trackRad = u.track ?? u.heading;
      const trackDeg = trackRad != null ? (trackRad * 180 / Math.PI + 360) % 360 : null;
      tracks.push({
        id: u.olympusID ?? k,
        lat: u.position.lat, lng: u.position.lng,
        altFt: metresToFeet(u.position.alt),
        trackDeg, coalition: u.coalition,
      });
    }
    return { call: buildPictureCall(anchor, tracks, bullseyePin ? { lat: bullseyePin.lat, lng: bullseyePin.lng } : undefined), anchorLabel };
  })();

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
        <button onClick={() => { setTool(tool === 'measure' ? 'select' : 'measure'); setArmed(null); }} title="Measure tool (range / bearing) — click again to exit" style={{ ...toolBtn, ...(tool === 'measure' ? toolOn : {}) }}>📏</button>
        <button onClick={() => setMeasurePts([])} title="Clear measurements" disabled={measurePts.length === 0}
                style={{ ...toolBtn, opacity: measurePts.length === 0 ? 0.4 : 1 }}>🧽</button>
        <button onClick={() => { setTool(tool === 'bra' ? 'select' : 'bra'); setArmed(null); }}
                title="BRA tool — click anchor then target for a controller-style bearing/range/altitude call (click a live unit to capture its altitude + track). Click the tool again to exit."
                style={{ ...toolBtn, ...(tool === 'bra' ? toolOn : {}) }}>📐</button>
        <button onClick={() => { setBraAnchor(null); setBraTarget(null); }}
                title="Clear BRA call"
                disabled={!braAnchor && !braTarget}
                style={{ ...toolBtn, opacity: (!braAnchor && !braTarget) ? 0.4 : 1 }}>✕</button>
        <button onClick={() => { setTool(tool === 'gci' ? 'select' : 'gci'); setArmed(null); }}
                title={`GCI range rings — click the map to drop a ${gciDefaultNm} NM ring. Click the tool again to exit.`}
                style={{ ...toolBtn, ...(tool === 'gci' ? toolOn : {}) }}>◎</button>
        <button onClick={() => setGciRings([])} title="Clear all GCI rings"
                disabled={gciRings.length === 0}
                style={{ ...toolBtn, opacity: gciRings.length === 0 ? 0.4 : 1 }}>🧹</button>
        <button onClick={() => { setTool(tool === 'be' ? 'select' : 'be'); setArmed(null); }}
                title={`Bullseye — click the map to (re)set the bullseye reference${missionBullseye?.lat != null ? ' (mission has a bullseye seeded)' : ''}. Click the tool again to exit.`}
                style={{ ...toolBtn, ...(tool === 'be' ? toolOn : {}), position: 'relative' }}>
          🎯
          {bullseyePin?.source === 'manual' && (
            <span style={{ position: 'absolute', bottom: -1, right: -1, fontSize: 8, lineHeight: 1, padding: '1px 2px', background: C.bgSolid, color: '#f0b840', border: `1px solid #f0b840`, borderRadius: 2 }}>M</span>
          )}
        </button>
        <button onClick={() => {
          // Reset to mission bullseye, or clear when no mission BE exists.
          if (missionBullseye?.lat != null && missionBullseye?.lon != null) {
            setBullseyePin({ lat: missionBullseye.lat, lng: missionBullseye.lon, source: 'mission' });
          } else {
            setBullseyePin(null);
          }
        }}
                title="Reset bullseye to mission default (or clear)"
                disabled={bullseyePin == null}
                style={{ ...toolBtn, opacity: bullseyePin == null ? 0.4 : 1 }}>↺</button>
        <button onClick={() => { setTool(tool === 'marker' ? 'select' : 'marker'); setArmed(null); }}
                title="Drop a named marker pin (label/colour set in the floating panel). Click the tool again to exit."
                style={{ ...toolBtn, ...(tool === 'marker' ? toolOn : {}) }}>📌</button>
        <button onClick={() => setMarkers([])} title="Clear all markers"
                disabled={markers.length === 0}
                style={{ ...toolBtn, opacity: markers.length === 0 ? 0.4 : 1 }}>🗑</button>
        <button onClick={() => { setTool(tool === 'draw' ? 'select' : 'draw'); setArmed(null); }}
                title={`Draw on the scope (${drawKind}). Click the prompt panel to swap line / arrow / freehand. Click the tool again to exit.`}
                style={{ ...toolBtn, ...(tool === 'draw' ? toolOn : {}) }}>🖊</button>
        <button onClick={() => setDrawings([])}
                title="Clear all drawings"
                disabled={drawings.length === 0}
                style={{ ...toolBtn, opacity: drawings.length === 0 ? 0.4 : 1 }}>🩹</button>
        <button onClick={() => setAirfieldSearchOpen((o) => !o)}
                title="Search airfields — filter visible field markers and highlight matches"
                style={{ ...toolBtn, ...(airfieldSearchOpen ? toolOn : {}) }}>🔍</button>
        <button onClick={() => setChartsPanelOpen((o) => !o)}
                title="Chart overlays — upload approach plates / kill boxes / sector maps and pin them to the map"
                style={{ ...toolBtn, ...(chartsPanelOpen ? toolOn : {}), position: 'relative' }}>
          🗺
          {charts.length > 0 && (
            <span style={{ position: 'absolute', bottom: -1, right: -1, fontSize: 8, lineHeight: 1, padding: '1px 2px', background: C.bgSolid, color: C.text, border: `1px solid ${C.border}`, borderRadius: 2 }}>{charts.length}</span>
          )}
        </button>
        <button onClick={cycleTrailSec}
                title={`Track history trails: ${trailSec === 0 ? 'OFF' : `${trailSec}s window`} — click to cycle off → 30s → 60s → 120s`}
                style={{ ...toolBtn, ...(trailSec > 0 ? toolOn : {}), position: 'relative' }}>
          🛤
          {trailSec > 0 && (
            <span style={{ position: 'absolute', bottom: -1, right: -1, fontSize: 8, lineHeight: 1, padding: '1px 2px', background: C.bgSolid, color: C.text, border: `1px solid ${C.border}`, borderRadius: 2 }}>{trailSec}</span>
          )}
        </button>
        <button onClick={cycleLabels}
                title={`Labels: ${labelsMode === 0 ? 'OFF' : labelsMode === 1 ? 'BASIC (callsign)' : 'RICH (callsign · ALT · HDG · SPD)'} — click to cycle`}
                style={{ ...toolBtn, ...(labelsMode > 0 ? toolOn : {}), position: 'relative' }}>
          🏷
          {labelsMode === 2 && (
            <span style={{ position: 'absolute', bottom: -1, right: -1, fontSize: 8, lineHeight: 1, padding: '1px 2px', background: C.bgSolid, color: '#ffd24a', border: `1px solid #ffd24a`, borderRadius: 2 }}>+</span>
          )}
        </button>
        <span style={{ height: 1, background: C.border, margin: '1px 2px' }} />
        <button onClick={toggleSrs}
                title="SRS frequency directory — every flight's radio freq + TACAN, with copy buttons"
                style={{ ...toolBtn, ...(srsOpen ? toolOn : {}) }}>📻</button>
        <button onClick={toggleComms}
                title="Controller text comms — typed broadcast lane (canCommand-only composer)"
                style={{ ...toolBtn, ...(commsOpen ? toolOn : {}) }}>💬</button>
        <button onClick={toggleBrevity}
                title="Brevity quick-reference (NATO / USN GCI vocabulary)"
                style={{ ...toolBtn, ...(brevityOpen ? toolOn : {}) }}>📖</button>
        {canCommand && (
          <button onClick={() => setNineLineOpen(true)}
                  title="CAS 9-line builder — fill the form, send as a comms broadcast"
                  style={{ ...toolBtn }}>📋</button>
        )}
        <button onClick={toggleTriggers}
                title="Mission triggers — fire any DM-tagged trigger from the scope (replaces the F10 menu)"
                style={{ ...toolBtn, ...(triggersOpen ? toolOn : {}) }}>🎬</button>
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
        <IadsPanel group={group} profile={profile} area={iadsArea} shape={iadsShape}
                   onShape={(s) => { setIadsShape(s); clearIads(); }}
                   onRadius={(nm) => setIadsCircle((prev) => (prev ? { ...prev, radiusNm: nm } : prev))}
                   onUndoVertex={() => setIadsPoly((prev) => prev.slice(0, -1))}
                   onClear={clearIads}
                   onClose={() => { setMode('select'); clearIads(); }} />
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

      {/* ── GCI ring tool prompt + radius slider ─────────────────────────── */}
      {tool === 'gci' && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 4, padding: '8px 12px', borderRadius: 6, background: 'rgba(9,13,20,0.95)', border: `1px solid #9ad0ff`, color: '#9ad0ff', fontSize: 12, fontWeight: 600, letterSpacing: 0.5, boxShadow: '0 0 14px rgba(154,208,255,0.25)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>◎ Click to drop a {gciDefaultNm} NM ring</span>
          <input type="range" min={5} max={150} step={5} value={gciDefaultNm}
                 onChange={(e) => setGciDefaultNm(Number(e.target.value))}
                 style={{ width: 140 }} />
          {gciRings.length > 0 && <span style={{ color: C.textDim, fontWeight: 400 }}>{gciRings.length} ring{gciRings.length === 1 ? '' : 's'}</span>}
        </div>
      )}

      {/* ── Bullseye tool prompt ─────────────────────────────────────────── */}
      {tool === 'be' && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 4, padding: '6px 12px', borderRadius: 6, background: 'rgba(9,13,20,0.95)', border: `1px solid #f0b840`, color: '#f0b840', fontSize: 12, fontWeight: 600, letterSpacing: 0.5, boxShadow: '0 0 14px rgba(240,184,64,0.25)' }}>
          🎯 Click the map to drop the bullseye reference
        </div>
      )}

      {/* ── Drawing tool prompt + kind/colour/info-mode controls ─────────── */}
      {tool === 'draw' && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 4, padding: '7px 12px', borderRadius: 6, background: 'rgba(9,13,20,0.95)', border: `1px solid ${drawColor}`, color: drawColor, fontSize: 12, fontWeight: 600, letterSpacing: 0.5, boxShadow: `0 0 14px ${drawColor}40`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>🖊 {drawKind === 'line' ? 'Click two points' : drawKind === 'arrow' ? 'Click start → end' : 'Click + drag to draw'}</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {(['line', 'arrow', 'freehand'] as const).map((k) => (
              <button key={k} onClick={() => setDrawKind(k)}
                      style={{ padding: '3px 7px', fontSize: 10, letterSpacing: 0.5, fontWeight: 700, border: `1px solid ${drawKind === k ? drawColor : C.border}`, borderRadius: 3, cursor: 'pointer', background: drawKind === k ? `${drawColor}22` : 'transparent', color: drawKind === k ? drawColor : C.textDim }}>
                {k.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {(['#ffd24a', '#5a9fd4', '#e0554f', '#3fb950', '#c090d0', '#bbbbbb'] as const).map((c) => (
              <button key={c} onClick={() => setDrawColor(c)}
                      title={c}
                      style={{ width: 16, height: 16, padding: 0, background: c, border: drawColor === c ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)', borderRadius: 2, cursor: 'pointer' }} />
            ))}
          </div>
          {/* Stroke width selector — visual sample of each thickness as a
              short horizontal bar so the user picks by feel, not by number. */}
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map((w) => (
              <button key={w} onClick={() => setDrawWidth(w)}
                      title={`Stroke width ${w} px`}
                      style={{ height: 18, width: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${drawWidth === w ? drawColor : C.border}`, borderRadius: 3, cursor: 'pointer', background: drawWidth === w ? `${drawColor}22` : 'transparent' }}>
                <div style={{ width: 14, height: w, background: drawColor, borderRadius: w / 2 }} />
              </button>
            ))}
          </div>
          {/* BRA / Bullseye info-label toggle */}
          <div style={{ display: 'flex', gap: 3 }}>
            {(['bra', 'bullseye', 'off'] as const).map((m) => {
              const enabled = m !== 'bullseye' || !!bullseyePin;
              return (
                <button key={m}
                        onClick={() => enabled && setDrawInfoMode(m)}
                        disabled={!enabled}
                        title={m === 'bullseye' && !enabled ? 'Set a bullseye to enable BE labels' : ''}
                        style={{ padding: '3px 7px', fontSize: 10, letterSpacing: 0.5, fontWeight: 700, border: `1px solid ${drawInfoMode === m ? drawColor : C.border}`, borderRadius: 3, cursor: enabled ? 'pointer' : 'not-allowed', background: drawInfoMode === m ? `${drawColor}22` : 'transparent', color: !enabled ? C.textDim : drawInfoMode === m ? drawColor : C.textDim, opacity: enabled ? 1 : 0.5 }}>
                  {m === 'bra' ? 'BRA' : m === 'bullseye' ? 'BE' : 'OFF'}
                </button>
              );
            })}
          </div>
          <span style={{ color: C.textDim, fontWeight: 400, fontSize: 10 }}>{drawings.length} on map</span>
        </div>
      )}

      {/* ── Airfield search panel (left, below the tool rail) ────────────── */}
      {airfieldSearchOpen && (
        <div style={{ position: 'absolute', top: 56, left: 56, width: 280, zIndex: 4, background: 'rgba(9,13,20,0.96)', border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: C.accentDim, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text }}>
            <span>🔍 AIRFIELDS</span>
            <span onClick={() => setAirfieldSearchOpen(false)} style={{ cursor: 'pointer', color: C.textDim, fontWeight: 400 }}>×</span>
          </div>
          <div style={{ padding: 8 }}>
            <input value={airfieldQuery} onChange={(e) => setAirfieldQuery(e.target.value)}
                   placeholder={`Filter ${airfieldList.length} fields…`}
                   style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`, color: C.text, padding: '5px 8px', fontSize: 12, borderRadius: 3, outline: 'none', fontFamily: 'inherit' }} />
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', borderTop: `1px solid ${C.border}` }}>
            {airfieldList
              .filter((a) => !airfieldQuery.trim() || a.name.toLowerCase().includes(airfieldQuery.trim().toLowerCase()))
              .slice(0, 80)
              .map((a, i) => (
                <div key={i}
                     onClick={() => {
                       const v = mapRef.current?.getView();
                       if (v) v.animate({ center: fromLonLat([a.lng, a.lat]), zoom: 11, duration: 350 });
                     }}
                     style={{ padding: '5px 10px', fontSize: 12, color: C.text, cursor: 'pointer', borderTop: i > 0 ? `1px solid rgba(36,51,73,0.5)` : 'none' }}>
                  {a.name}
                  <span style={{ color: C.textDim, marginLeft: 6, fontSize: 10 }}>
                    {a.lat.toFixed(3)}, {a.lng.toFixed(3)}
                  </span>
                </div>
              ))}
            {airfieldList.length === 0 && (
              <div style={{ padding: 12, fontSize: 11, color: C.textDim, textAlign: 'center' }}>
                Waiting for the airbase feed…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Chart overlays panel (Phase 8) — left dock below airfield search */}
      {chartsPanelOpen && (
        <ChartsPanel
          charts={charts}
          airfields={airfieldList}
          onStartPlacement={(payload) => setPendingChartPlacement(payload)}
          onAdd={(c) => setCharts((p) => [...p, { ...c, id: chartIdRef.current++ }])}
          onUpdate={(id, patch) => setCharts((p) => p.map((c) => c.id === id ? { ...c, ...patch } : c))}
          onRemove={(id) => setCharts((p) => p.filter((c) => c.id !== id))}
          onClose={() => setChartsPanelOpen(false)}
          aiAvailable={chartAiAvailable}
          aiIdentify={chartAiIdentify}
        />
      )}

      {/* ── Cursor-driven chart placement (follow-pointer ghost) ──────────── */}
      {pendingChartPlacement && (
        <div
          ref={pendingChartGhostRef}
          style={{
            position: 'absolute',
            display: 'none',  // populated by the pointermove handler
            zIndex: 50, pointerEvents: 'none',
            border: '2px dashed #ffd24a',
            background: 'rgba(0,0,0,0.25)',
            boxShadow: '0 0 14px rgba(255,210,74,0.35)',
          }}>
          <img src={pendingChartPlacement.dataUrl} alt=""
               style={{ width: '100%', height: '100%', opacity: 0.7, objectFit: 'contain' }} />
        </div>
      )}
      {pendingChartPlacement && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 51, padding: '6px 12px', borderRadius: 6, background: 'rgba(9,13,20,0.95)', border: '1px solid #ffd24a', color: '#ffd24a', fontSize: 12, fontWeight: 600, letterSpacing: 0.5, boxShadow: '0 0 14px rgba(255,210,74,0.25)' }}>
          🗺 Click to drop "{pendingChartPlacement.label}" · Esc / right-click to cancel
        </div>
      )}

      {/* ── Right-click track context menu (rename / clear override) ──────── */}
      {trackMenu && (
        <div style={{ position: 'absolute', left: trackMenu.x, top: trackMenu.y, zIndex: 10, minWidth: 220, background: 'rgba(9,13,20,0.98)', border: `1px solid ${C.border}`, borderRadius: 5, boxShadow: '0 4px 14px rgba(0,0,0,0.6)', padding: 8 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6, letterSpacing: 0.5 }}>
            Track: <span style={{ color: C.text, fontWeight: 600 }}>{(trackMenu.unit.olympusID != null && unitLabels[trackMenu.unit.olympusID]) || trackMenu.unit.unitName || trackMenu.unit.name || '—'}</span>
          </div>
          {trackMenu.unit.olympusID != null && (
            <>
              <input
                autoFocus
                defaultValue={unitLabels[trackMenu.unit.olympusID] || trackMenu.unit.unitName || trackMenu.unit.name || ''}
                placeholder="Override label (e.g. BANDIT-1)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = (e.target as HTMLInputElement).value.trim();
                    const id = trackMenu.unit.olympusID!;
                    setUnitLabels((p) => {
                      const n = { ...p };
                      if (v) n[id] = v;
                      else delete n[id];
                      return n;
                    });
                    setTrackMenu(null);
                  } else if (e.key === 'Escape') {
                    setTrackMenu(null);
                  }
                }}
                style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`, color: C.text, padding: '5px 7px', fontSize: 12, borderRadius: 3, outline: 'none', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button onClick={() => {
                  const id = trackMenu.unit.olympusID!;
                  setUnitLabels((p) => { const n = { ...p }; delete n[id]; return n; });
                  setTrackMenu(null);
                }}
                        style={{ flex: 1, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, padding: '4px 8px', fontSize: 11, borderRadius: 3, cursor: 'pointer' }}>
                  Reset
                </button>
                <button onClick={() => setTrackMenu(null)}
                        style={{ flex: 1, background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '4px 8px', fontSize: 11, borderRadius: 3, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
              <div style={{ fontSize: 10, color: C.textDim, marginTop: 6, lineHeight: 1.45 }}>
                Enter to save. Persists across reloads, scoped to this Olympus ID.
              </div>
            </>
          )}
          {trackMenu.unit.olympusID == null && (
            <div style={{ fontSize: 11, color: C.textDim }}>This track has no stable ID — can't be renamed.</div>
          )}
        </div>
      )}

      {/* ── Marker tool prompt + label/colour controls ───────────────────── */}
      {tool === 'marker' && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 4, padding: '7px 12px', borderRadius: 6, background: 'rgba(9,13,20,0.95)', border: `1px solid ${markerColor}`, color: markerColor, fontSize: 12, fontWeight: 600, letterSpacing: 0.5, boxShadow: `0 0 14px ${markerColor}40`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>📌 Drop marker:</span>
          <input value={markerLabel}
                 onChange={(e) => setMarkerLabel(e.target.value.slice(0, 8).toUpperCase())}
                 placeholder="LABEL"
                 style={{ width: 90, background: 'rgba(0,0,0,0.4)', border: `1px solid ${markerColor}66`, color: markerColor, padding: '3px 6px', fontSize: 11, fontFamily: 'inherit', borderRadius: 3, outline: 'none', textAlign: 'center', letterSpacing: 1 }} />
          <div style={{ display: 'flex', gap: 3 }}>
            {(['#ffd24a', '#5a9fd4', '#e0554f', '#3fb950', '#c090d0', '#bbbbbb'] as const).map((c) => (
              <button key={c} onClick={() => setMarkerColor(c)}
                      title={c}
                      style={{ width: 16, height: 16, padding: 0, background: c, border: markerColor === c ? '2px solid #fff' : '1px solid rgba(0,0,0,0.5)', borderRadius: 2, cursor: 'pointer' }} />
            ))}
          </div>
          <span style={{ color: C.textDim, fontWeight: 400, fontSize: 10 }}>{markers.length} placed</span>
        </div>
      )}

      {/* ── BRA tool prompt (top-centre, only while BRA is the active tool) ── */}
      {tool === 'bra' && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 4, padding: '6px 12px', borderRadius: 6, background: 'rgba(9,13,20,0.95)', border: `1px solid #ffd24a`, color: '#ffd24a', fontSize: 12, fontWeight: 600, letterSpacing: 0.5, boxShadow: '0 0 14px rgba(255,210,74,0.25)', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span>
            {!braAnchor ? '📐 Click an ANCHOR (own-ship, GCI station, or a friendly track)'
              : !braTarget ? '📐 Click a TARGET (clicking a live unit captures alt + track)'
              : '📐 Click again to start over'}
          </span>
          {!braAnchor && bullseyePin && (
            <button onClick={() => setBraAnchor({ lat: bullseyePin.lat, lng: bullseyePin.lng, label: 'Bullseye' })}
                    title="Use the bullseye as the BRA anchor"
                    style={{ background: 'transparent', border: '1px solid #ffd24a', color: '#ffd24a', padding: '2px 7px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, borderRadius: 3, cursor: 'pointer' }}>
              FROM BE
            </button>
          )}
        </div>
      )}

      {/* ── SRS directory (left side, below the tool rail) ───────────────── */}
      {srsOpen && (
        <div style={{ position: 'absolute', top: 56, left: 56, width: 320, maxHeight: 'calc(100% - 90px)', zIndex: 4, display: 'flex', flexDirection: 'column' }}>
          <SrsDirectory groupId={group.id} onClose={toggleSrs} />
        </div>
      )}

      {/* ── Comms log drawer (bottom-left, above the status bar) ─────────── */}
      {commsOpen && (
        <div style={{ position: 'absolute', bottom: 36, left: 56, width: 360, height: 320, zIndex: 4, display: 'flex' }}>
          <CommsLog group={group} onClose={toggleComms} />
        </div>
      )}

      {/* ── Brevity card (right side, opposite of unit-control) ──────────── */}
      {brevityOpen && (
        <div style={{ position: 'absolute', top: 56, right: 12, width: 360, maxHeight: 'calc(100% - 90px)', zIndex: 5, display: 'flex', flexDirection: 'column' }}>
          <BrevityCard onClose={toggleBrevity} />
        </div>
      )}

      {/* ── Triggers panel — DM fire control (Phase 9) ───────────────────── */}
      {triggersOpen && (
        <div style={{ position: 'absolute', top: 56, right: brevityOpen ? 380 : 12, width: 360, maxHeight: 'calc(100% - 90px)', zIndex: 5, display: 'flex', flexDirection: 'column' }}>
          <TriggersPanel group={group} profile={profile} onClose={toggleTriggers} />
        </div>
      )}

      {/* ── 9-line builder (centered modal-style) ────────────────────────── */}
      {nineLineOpen && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', width: 460, maxHeight: 'calc(100% - 90px)', zIndex: 6, display: 'flex', flexDirection: 'column' }}>
          <NineLineBuilder
            onClose={() => setNineLineOpen(false)}
            onSubmit={(text) => {
              postComms(group.id, text)
                .then(() => { setCmdMsg('✓ 9-line broadcast'); setNineLineOpen(false); })
                .catch((e: unknown) => setCmdMsg(`✗ ${e instanceof Error ? e.message : 'send failed'}`));
            }}
          />
        </div>
      )}

      {/* ── Picture-call panel (bottom-right; auto bogey-dope) ───────────── */}
      {!pictureOpen ? (
        <button onClick={togglePicture}
                title="Open the PICTURE call (auto bogey-dope summary)"
                style={{ position: 'absolute', bottom: 36, right: 12, zIndex: 4, padding: '6px 10px', borderRadius: 6, background: 'rgba(9,13,20,0.95)', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>
          📡 PICTURE{pictureCall.call ? ` · ${pictureCall.call.totalBandits}` : ''}
        </button>
      ) : (
        <div style={{ position: 'absolute', bottom: 36, right: 12, width: 280, zIndex: 4, background: 'rgba(9,13,20,0.96)', border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'rgba(74,158,255,0.10)', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text }}>
            <span>📡 PICTURE</span>
            <span onClick={togglePicture} style={{ cursor: 'pointer', color: C.textDim, fontWeight: 400 }}>×</span>
          </div>
          <div style={{ padding: 10, fontSize: 12, color: C.text, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {!pictureCall.call ? (
              <div style={{ color: C.textDim, fontSize: 11, lineHeight: 1.5 }}>
                No bandits in the air picture, or no friendly anchor.{' '}
                <span style={{ color: C.textDim }}>Set an anchor with 📐 BRA, or select a friendly track.</span>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 10, color: C.textDim, letterSpacing: 0.5 }}>
                  ANCHOR: <span style={{ color: C.text }}>{pictureCall.anchorLabel}</span>
                  <span style={{ float: 'right' }}>{pictureCall.call.totalBandits} contact{pictureCall.call.totalBandits === 1 ? '' : 's'}</span>
                </div>
                {/* Mode toggle — BRAA vs BE relative. BE only enabled when a bullseye is set. */}
                <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                  {(['braa', 'bullseye'] as const).map((m) => {
                    const enabled = m === 'braa' || !!pictureCall.call?.bandsBE;
                    const on = pictureMode === m;
                    return (
                      <button key={m}
                              onClick={() => enabled && setPictureMode(m)}
                              disabled={!enabled}
                              title={m === 'bullseye' && !enabled ? 'Set a bullseye to enable bullseye-relative calls' : ''}
                              style={{ flex: 1, padding: '3px 4px', fontSize: 10, letterSpacing: 0.5, fontWeight: 700, border: `1px solid ${on ? '#ffd24a' : C.border}`, borderRadius: 3, cursor: enabled ? 'pointer' : 'not-allowed', background: on ? 'rgba(255,210,74,0.12)' : 'transparent', color: !enabled ? C.textDim : on ? '#ffd24a' : C.textDim, opacity: enabled ? 1 : 0.5 }}>
                        {m === 'braa' ? 'BRAA' : 'BULLSEYE'}
                      </button>
                    );
                  })}
                </div>
                {(pictureMode === 'bullseye' && pictureCall.call.bandsBE ? pictureCall.call.bandsBE : pictureCall.call.bands).map((b) => (
                  <div key={b.band} style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '3px 0', borderTop: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 10, letterSpacing: 1, color: C.textDim, width: 36 }}>{b.band.toUpperCase()}</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#ffd24a', flex: 1 }}>{b.line}</span>
                  </div>
                ))}
                <button onClick={() => {
                  if (pictureCall.call) {
                    const text = formatPictureCall(pictureCall.call, { mode: pictureMode });
                    try { navigator.clipboard?.writeText(text); setCmdMsg('✓ Picture copied'); } catch { /* ignore */ }
                  }
                }}
                        style={{ ...mbtn, marginTop: 4, padding: '5px 8px', fontSize: 10, letterSpacing: 1 }}>
                  Copy to clipboard
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Track hover chip (positioned by the OL pointermove handler) ──── */}
      <div ref={hoverRef}
           style={{ position: 'absolute', display: 'none', zIndex: 5, padding: '5px 8px', fontSize: 11, lineHeight: 1.4, color: C.text, background: 'rgba(9,13,20,0.95)', border: `1px solid ${C.border}`, borderRadius: 4, whiteSpace: 'pre', fontFamily: 'ui-monospace, monospace', pointerEvents: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }} />

      {/* ── Live drawing readout (BRA/BE while laying a line/arrow) ──────── */}
      <div ref={liveDrawInfoRef}
           style={{ position: 'absolute', display: 'none', zIndex: 6, padding: '3px 7px', fontSize: 11, color: drawColor, background: 'rgba(9,13,20,0.92)', border: `1px solid ${drawColor}`, borderRadius: 3, fontFamily: 'ui-monospace, monospace', fontWeight: 700, pointerEvents: 'none', boxShadow: `0 0 10px ${drawColor}40` }} />

      {/* ── Bottom status bar ────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 26, display: 'flex', alignItems: 'center', gap: 16, padding: '0 12px', zIndex: 2, background: 'linear-gradient(0deg, rgba(9,13,20,0.96), rgba(9,13,20,0.55))', borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.textDim, fontVariantNumeric: 'tabular-nums' }}>
        <span ref={coordRef}>—</span>
        {bullseyePin && (
          <span title={`Bullseye (${bullseyePin.source})`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#f0b840', fontWeight: 600 }}>
            <span style={{ opacity: 0.75 }}>🎯</span>
            <span>BE {bullseyePin.lat.toFixed(3)}, {bullseyePin.lng.toFixed(3)}</span>
            {bullseyePin.source === 'manual' && <span style={{ color: C.textDim, fontWeight: 400, fontSize: 10 }}>(manual)</span>}
          </span>
        )}
        {braCall && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ffd24a', fontWeight: 600 }}>
            <span style={{ opacity: 0.75 }}>📐</span>
            <span>{formatBra(braCall)}</span>
            {braAnchor?.label && <span style={{ color: C.textDim, fontWeight: 400 }}>from {braAnchor.label}</span>}
            {braTarget?.label && <span style={{ color: C.textDim, fontWeight: 400 }}>→ {braTarget.label}</span>}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span>{ROLE_LABEL[group.role] || group.role}</span>
        <span>{profile.name}</span>
      </div>
    </div>
  );
}

// Small NATO-ish coalition glyph for the status counts (▲ matches air markers).
// Chart-overlay manager (Phase 8). Upload + size + position + opacity.
// Image data is read via FileReader → data URL so it survives the React
// state lifecycle without a backend round-trip. Persistence is via
// localStorage; the LiveMap parent owns the actual array.
function ChartsPanel({ charts, airfields, onStartPlacement, onAdd, onUpdate, onRemove, onClose, aiAvailable, aiIdentify }: {
  charts: Array<{ id: number; label: string; dataUrl: string; centerLat: number; centerLng: number; widthNm: number; heightNm: number; aspectRatio?: number; aspectLocked?: boolean; opacity: number; visible: boolean }>;
  airfields: Array<{ name: string; lat: number; lng: number }>;
  onStartPlacement: (p: { label: string; dataUrl: string; widthNm: number; heightNm: number; aspectRatio?: number; aspectLocked?: boolean; opacity: number; pxW: number; pxH: number }) => void;
  onAdd: (c: { label: string; dataUrl: string; centerLat: number; centerLng: number; widthNm: number; heightNm: number; aspectRatio?: number; aspectLocked?: boolean; opacity: number; visible: boolean }) => void;
  onUpdate: (id: number, patch: Partial<{ label: string; centerLat: number; centerLng: number; widthNm: number; heightNm: number; aspectRatio: number; aspectLocked: boolean; opacity: number; visible: boolean }>) => void;
  onRemove: (id: number) => void;
  onClose: () => void;
  /** True when the user has a BYOK key configured (either provider). */
  aiAvailable: boolean;
  /** Caller resolves the active AI provider/key/model and runs the
   *  identification; on confident match, returns the candidate name (which
   *  this panel uses to auto-fill the SNAP dropdown). */
  aiIdentify: (dataUrl: string) => Promise<{ match: string | null; reason?: string }>;
}) {
  const [pendingFile, setPendingFile] = useState<{ name: string; dataUrl: string; naturalW: number; naturalH: number } | null>(null);
  const [pendingLabel, setPendingLabel] = useState('');
  // Pre-placement controls — let the user pick size + opacity BEFORE
  // committing, so the cursor ghost and the final overlay match.
  const [pendingWidthNm, setPendingWidthNm] = useState(20);
  const [pendingHeightNm, setPendingHeightNm] = useState(20);
  const [pendingOpacity, setPendingOpacity] = useState(0.7);
  const [autoAirfield, setAutoAirfield] = useState('');  // dropdown choice
  const onUpload = (file: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Image larger than 5 MB — localStorage will reject it. Compress first.');
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = String(r.result || '');
      const base = file.name.replace(/\.[^.]+$/, '');
      // Read natural pixel size so the follow-cursor ghost looks honest.
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 200;
        const h = img.naturalHeight || 200;
        // Default height NM to match the image's aspect ratio at 20 NM wide.
        const aspect = h / w;
        setPendingFile({ name: base, dataUrl, naturalW: w, naturalH: h });
        setPendingLabel(base);
        setPendingWidthNm(20);
        setPendingHeightNm(Math.max(1, Math.round(20 * aspect)));
      };
      img.src = dataUrl;
    };
    r.readAsDataURL(file);
  };
  const startCursorPlacement = () => {
    if (!pendingFile) return;
    // Ghost size in screen pixels — keep aspect, cap at 240 px for a sane
    // viewport footprint while the user picks a spot.
    const cap = 240;
    const aspect = pendingFile.naturalH / pendingFile.naturalW;
    const pxW = Math.min(cap, pendingFile.naturalW);
    const pxH = Math.round(pxW * aspect);
    onStartPlacement({
      label: pendingLabel || pendingFile.name || 'Chart',
      dataUrl: pendingFile.dataUrl,
      widthNm: pendingWidthNm, heightNm: pendingHeightNm,
      aspectRatio: aspect, aspectLocked: true,
      opacity: pendingOpacity, pxW, pxH,
    });
    setPendingFile(null); setPendingLabel('');
  };
  const placeOnAirfield = () => {
    if (!pendingFile || !autoAirfield) return;
    const a = airfields.find((x) => x.name === autoAirfield);
    if (!a) return;
    const aspect = pendingFile.naturalH / pendingFile.naturalW;
    onAdd({
      label: pendingLabel || pendingFile.name || 'Chart',
      dataUrl: pendingFile.dataUrl,
      centerLat: a.lat, centerLng: a.lng,
      widthNm: pendingWidthNm, heightNm: pendingHeightNm,
      aspectRatio: aspect, aspectLocked: true,
      opacity: pendingOpacity, visible: true,
    });
    setPendingFile(null); setPendingLabel(''); setAutoAirfield('');
  };
  // AI identify (BYOK). Disabled when no key configured OR no candidates yet.
  const [aiIdentifying, setAiIdentifying] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const onAiIdentify = async () => {
    if (!pendingFile) return;
    setAiIdentifying(true); setAiMessage(null);
    try {
      const res = await aiIdentify(pendingFile.dataUrl);
      if (res.match) {
        setAutoAirfield(res.match);
        setAiMessage({ ok: true, text: `✓ Matched: ${res.match}${res.reason ? ` — ${res.reason}` : ''}` });
      } else {
        setAiMessage({ ok: false, text: `No confident match. ${res.reason || ''}`.trim() });
      }
    } catch (e) {
      setAiMessage({ ok: false, text: e instanceof Error ? e.message : 'AI call failed' });
    } finally {
      setAiIdentifying(false);
    }
  };

  // Per-row W/H edits no longer have manual inputs — the single SIZE slider
  // handles both via the aspect ratio. Stretch mode (aspectLocked === false)
  // is preserved on the data model for forward compatibility but isn't UI-
  // exposed today; legacy charts saved with it still render unstretched
  // when the slider is dragged.
  return (
    <div style={{ position: 'absolute', top: 56, left: 56, width: 320, maxHeight: 'calc(100% - 90px)', zIndex: 4, background: 'rgba(9,13,20,0.96)', border: '1px solid #243349', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'rgba(74,158,255,0.18)', borderBottom: '1px solid #243349', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#dce6f2' }}>
        <span>🗺 CHART OVERLAYS</span>
        <span onClick={onClose} style={{ cursor: 'pointer', color: '#8aa0ba', fontWeight: 400 }}>×</span>
      </div>
      <div style={{ padding: 10, borderBottom: '1px solid #243349', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 10, color: '#8aa0ba', letterSpacing: 1 }}>UPLOAD (PNG / JPG, ≤ 5 MB)</label>
        <input type="file" accept="image/png,image/jpeg,image/webp"
               onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
               style={{ fontSize: 11, color: '#dce6f2' }} />
        {pendingFile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: '1px solid #3a6ea5', borderRadius: 4, background: 'rgba(74,158,255,0.06)' }}>
            <img src={pendingFile.dataUrl} alt="preview" style={{ maxWidth: '100%', maxHeight: 80, objectFit: 'contain', background: 'rgba(0,0,0,0.4)' }} />
            <input value={pendingLabel} onChange={(e) => setPendingLabel(e.target.value)}
                   placeholder="Label (e.g. Senaki TACAN approach)"
                   style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid #243349', color: '#dce6f2', padding: '4px 7px', fontSize: 11, borderRadius: 3, outline: 'none', fontFamily: 'inherit' }} />
            {/* Single SIZE slider (v1.19.8) — width in NM. Height is always
                derived from the image's natural aspect ratio so plates can
                never get squashed. Log-scale slider covers 1–200 NM with
                useful resolution at both ends (small plates → big sector
                graphics). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: '#8aa0ba', width: 36, letterSpacing: 0.5 }}>SIZE</span>
              <input type="range" min={0} max={100} step={1}
                     value={Math.round(Math.log10(Math.max(1, pendingWidthNm)) / Math.log10(200) * 100)}
                     onChange={(e) => {
                       // log scale: 0 → 1 NM, 100 → 200 NM
                       const t = Number(e.target.value) / 100;
                       const w = Math.max(1, Math.round(Math.pow(10, t * Math.log10(200))));
                       setPendingWidthNm(w);
                       if (pendingFile) {
                         const aspect = pendingFile.naturalH / pendingFile.naturalW;
                         if (Number.isFinite(aspect) && aspect > 0) setPendingHeightNm(Math.max(1, Math.round(w * aspect)));
                       }
                     }}
                     style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: '#ffd24a', fontFamily: 'ui-monospace, monospace', minWidth: 80, textAlign: 'right' }}>
                {pendingWidthNm}×{pendingHeightNm} NM
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: '#8aa0ba', width: 36 }}>OPACITY</span>
              <input type="range" min={0.1} max={1} step={0.05} value={pendingOpacity}
                     onChange={(e) => setPendingOpacity(Number(e.target.value))}
                     style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: '#dce6f2', width: 26, textAlign: 'right' }}>{Math.round(pendingOpacity * 100)}%</span>
            </div>
            {/* Placement method 1 — cursor-driven */}
            <button onClick={startCursorPlacement}
                    style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#cfe6ff', background: 'rgba(74,158,255,0.18)', border: '1px solid #4a9eff', borderRadius: 3, cursor: 'pointer' }}>
              📍 PLACE WITH CURSOR
            </button>
            {/* Placement method 2 — snap to a known airfield */}
            {airfields.length > 0 && (
              <div style={{ display: 'flex', gap: 4 }}>
                <select value={autoAirfield} onChange={(e) => setAutoAirfield(e.target.value)}
                        style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid #243349', color: '#dce6f2', padding: '4px 7px', fontSize: 11, borderRadius: 3, outline: 'none' }}>
                  <option value="">Pick an airfield…</option>
                  {airfields.slice().sort((a, b) => a.name.localeCompare(b.name)).map((a) => (
                    <option key={a.name + a.lat} value={a.name}>{a.name}</option>
                  ))}
                </select>
                <button onClick={placeOnAirfield} disabled={!autoAirfield}
                        style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, color: autoAirfield ? '#cfe6ff' : '#8aa0ba', background: autoAirfield ? 'rgba(74,158,255,0.18)' : 'transparent', border: `1px solid ${autoAirfield ? '#4a9eff' : '#243349'}`, borderRadius: 3, cursor: autoAirfield ? 'pointer' : 'not-allowed' }}>
                  🛬 SNAP
                </button>
              </div>
            )}
            {/* AI auto-identify — reads the chart's own labels (ICAO, runway,
                city) and picks the matching candidate. Only enabled when a
                BYOK key is configured AND we have candidates to pick from. */}
            {airfields.length > 0 && (
              <button onClick={() => onAiIdentify?.()}
                      disabled={!aiAvailable || aiIdentifying}
                      title={aiAvailable
                        ? 'AI reads the chart\'s ICAO / city / runway labels and picks the best match.'
                        : 'Set an Anthropic or Gemini API key in Tools → AI Settings to enable AI identification.'}
                      style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: aiAvailable ? '#c090d0' : '#8aa0ba', background: aiAvailable ? 'rgba(192,144,208,0.10)' : 'transparent', border: `1px solid ${aiAvailable ? '#c090d0' : '#243349'}`, borderRadius: 3, cursor: aiAvailable && !aiIdentifying ? 'pointer' : 'not-allowed' }}>
                {aiIdentifying ? '🤖 Identifying…' : '🤖 AI IDENTIFY AIRFIELD'}
              </button>
            )}
            {aiMessage && (
              <div style={{ fontSize: 10, color: aiMessage.ok ? '#3fb950' : '#e0554f', padding: '2px 0', lineHeight: 1.4 }}>
                {aiMessage.text}
              </div>
            )}
            <button onClick={() => { setPendingFile(null); setPendingLabel(''); }}
                    style={{ background: 'transparent', border: '1px solid #243349', color: '#8aa0ba', padding: '5px 10px', fontSize: 11, borderRadius: 3, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {charts.length === 0 ? (
          <div style={{ padding: 14, fontSize: 11, color: '#8aa0ba', textAlign: 'center', lineHeight: 1.5 }}>
            No overlays yet. Upload a chart, plate, or sector graphic and pin it.
          </div>
        ) : charts.map((c) => (
          <div key={c.id} style={{ borderTop: '1px solid #243349', padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <input type="checkbox" checked={c.visible} onChange={(e) => onUpdate(c.id, { visible: e.target.checked })} />
              <input value={c.label} onChange={(e) => onUpdate(c.id, { label: e.target.value })}
                     style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid #243349', color: '#dce6f2', padding: '3px 6px', fontSize: 11, borderRadius: 3, outline: 'none', fontFamily: 'inherit' }} />
              <button onClick={() => onRemove(c.id)}
                      style={{ background: 'transparent', border: '1px solid #5a3a3a', color: '#e0554f', padding: '3px 6px', fontSize: 11, borderRadius: 3, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <NumberRow label="Lat" v={c.centerLat} step={0.001} onChange={(n) => onUpdate(c.id, { centerLat: n })} />
              <NumberRow label="Lng" v={c.centerLng} step={0.001} onChange={(n) => onUpdate(c.id, { centerLng: n })} />
            </div>
            {/* SIZE slider — single control, height always derived from the
                image's natural aspect ratio. Log scale 1–200 NM. v1.19.8. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: '#8aa0ba', width: 36, letterSpacing: 0.5 }}>SIZE</span>
              <input type="range" min={0} max={100} step={1}
                     value={Math.round(Math.log10(Math.max(1, c.widthNm)) / Math.log10(200) * 100)}
                     onChange={(e) => {
                       const t = Number(e.target.value) / 100;
                       const w = Math.max(1, Math.round(Math.pow(10, t * Math.log10(200))));
                       const aspect = c.aspectRatio ?? (c.heightNm / Math.max(0.0001, c.widthNm));
                       const h = Number.isFinite(aspect) && aspect > 0 ? Math.max(1, Math.round(w * aspect)) : c.heightNm;
                       onUpdate(c.id, { widthNm: w, heightNm: h });
                     }}
                     style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: '#ffd24a', fontFamily: 'ui-monospace, monospace', width: 76, textAlign: 'right' }}>
                {c.widthNm}×{c.heightNm} NM
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: '#8aa0ba', width: 36 }}>OPACITY</span>
              <input type="range" min={0.1} max={1} step={0.05} value={c.opacity}
                     onChange={(e) => onUpdate(c.id, { opacity: Number(e.target.value) })}
                     style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: '#dce6f2', width: 26, textAlign: 'right' }}>{Math.round(c.opacity * 100)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NumberRow({ label, v, step, onChange }: { label: string; v: number; step: number; onChange: (n: number) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 10, color: '#8aa0ba', width: 36 }}>{label}</span>
      <input type="number" value={v} step={step}
             onChange={(e) => onChange(Number(e.target.value))}
             style={{ flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.4)', border: '1px solid #243349', color: '#dce6f2', padding: '2px 5px', fontSize: 11, borderRadius: 3, outline: 'none', fontFamily: 'ui-monospace, monospace' }} />
    </label>
  );
}

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
