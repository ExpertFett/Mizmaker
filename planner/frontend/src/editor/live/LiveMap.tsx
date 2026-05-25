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
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Style, Circle as CircleStyle, RegularShape, Fill, Stroke } from 'ol/style';
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

export function LiveMap({ group, profile }: { group: GroupSummary; profile: ServerProfile }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const coordRef = useRef<HTMLSpanElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const srcRef = useRef<VectorSource | null>(null);
  const fittedRef = useRef(false);
  // Persistent unit store (merge across polls so units don't blink out on a
  // delta frame / decode hiccup). Removed when explicitly dead or absent ~3 polls.
  const unitsRef = useRef<Record<string, { u: UnitT; miss: number }>>({});
  const feedLenRef = useRef(0);                  // last poll's raw feed length (for dbg)
  const renderRef = useRef<() => void>(() => {});  // rebuild features from store (filters applied)
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
  const [protectMode, setProtectMode] = useState<boolean>(() => {
    try { return localStorage.getItem('dcsopt.live.protect') !== '0'; } catch { return true; }
  });
  const [showLockHelp, setShowLockHelp] = useState(false);
  const toggleProtect = () => setProtectMode((p) => {
    const n = !p; try { localStorage.setItem('dcsopt.live.protect', n ? '1' : '0'); } catch { /* ignore */ }
    return n;
  });
  const selProtected = !!selected && protectMode && selected.controlled === 0 && selected.human !== 1;
  // Gate a command on the selected unit behind a confirm if it's protected.
  const guard = (run: () => void) => {
    if (selProtected && !window.confirm(`"${selected!.unitName || selected!.name || 'This unit'}" is a protected Mission Editor unit.\n\nCommanding it unlocks it and abandons its scripted mission. Continue?`)) return;
    run();
  };

  // Map-layer visibility filters (persisted per-browser).
  const [showHuman, setShowHuman] = useState<boolean>(() => { try { return localStorage.getItem('dcsopt.live.human') !== '0'; } catch { return true; } });
  const [showOlympus, setShowOlympus] = useState<boolean>(() => { try { return localStorage.getItem('dcsopt.live.olympus') !== '0'; } catch { return true; } });
  const [showDcs, setShowDcs] = useState<boolean>(() => { try { return localStorage.getItem('dcsopt.live.dcs') !== '0'; } catch { return true; } });
  const [showRed, setShowRed] = useState<boolean>(() => { try { return localStorage.getItem('dcsopt.live.red') !== '0'; } catch { return true; } });
  const [showBlue, setShowBlue] = useState<boolean>(() => { try { return localStorage.getItem('dcsopt.live.blue') !== '0'; } catch { return true; } });
  const [showNeutral, setShowNeutral] = useState<boolean>(() => { try { return localStorage.getItem('dcsopt.live.neutral') !== '0'; } catch { return true; } });
  const toggleHuman = () => setShowHuman((v) => { const n = !v; try { localStorage.setItem('dcsopt.live.human', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const toggleOlympus = () => setShowOlympus((v) => { const n = !v; try { localStorage.setItem('dcsopt.live.olympus', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const toggleDcs = () => setShowDcs((v) => { const n = !v; try { localStorage.setItem('dcsopt.live.dcs', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const toggleRed = () => setShowRed((v) => { const n = !v; try { localStorage.setItem('dcsopt.live.red', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const toggleBlue = () => setShowBlue((v) => { const n = !v; try { localStorage.setItem('dcsopt.live.blue', n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const toggleNeutral = () => setShowNeutral((v) => { const n = !v; try { localStorage.setItem('dcsopt.live.neutral', n ? '1' : '0'); } catch { /* ignore */ } return n; });

  // Rebuild the vector layer from the persistent unit store, applying the
  // human / Olympus visibility filters + counts. Reassigned each render so it
  // captures current filter state; called after every poll and on each toggle.
  renderRef.current = () => {
    const src = srcRef.current; if (!src) return;
    src.clear();
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
      plotted++;
      if (u.coalition === 1) red++; else if (u.coalition === 2) blue++; else other++;
      const coord = fromLonLat([p.lng, p.lat]); pts.push(coord);
      const ft = new Feature({ geometry: new Point(coord) });
      ft.set('unit', u); ft.setStyle(styleForUnit(u.coalition, u.category)); src.addFeature(ft);
    }
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

  // Latest interaction state for the (once-registered) OL click handler.
  const ctrl = useRef<any>({});
  ctrl.current = {
    mode, spawnType, spawnCoalition, spawnCat, armed,
    onSelect: (u: UnitT | null) => setSelected(u),
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
    const map = new Map({
      target: elRef.current,
      controls: [],  // hide default OL zoom/attribution; we float our own chrome
      layers: [
        new TileLayer({ source: new XYZ({ url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attributions: '© OpenStreetMap, © CARTO' }) }),
        new VectorLayer({ source: src }),
      ],
      view: new View({ center: fromLonLat([35, 43]), zoom: 6 }),
    });
    map.on('singleclick', (e) => {
      const c = ctrl.current;
      const ll = toLonLat(e.coordinate);
      const lng = ll[0], lat = ll[1];
      const f = map.forEachFeatureAtPixel(e.pixel, (ft) => ft, { hitTolerance: 6 });
      const target = f ? (f.get('unit') as UnitT) : null;
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
  useEffect(() => { renderRef.current(); }, [showHuman, showOlympus, showDcs, showRed, showBlue, showNeutral]);

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

  const armedActive = armed != null || (mode === 'spawn' && !!spawnType);
  const selSide = selected ? (SIDE_COLOR[selected.coalition ?? -1] ?? C.neutral) : C.neutral;

  return (
    <div style={{ position: 'relative', height: 'clamp(440px, calc(100vh - 200px), 1040px)', border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.bgSolid, fontFamily: 'inherit' }}>
      <div ref={elRef} style={{ position: 'absolute', inset: 0, cursor: armedActive ? 'crosshair' : 'default' }} />

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

        {/* Layer visibility filters */}
        <IconToggle icon="👤" active={showHuman} onClick={toggleHuman}
          helpTitle="Hide / show human units"
          helpBody={<>Toggles map visibility of player-piloted (human) units. Currently <b style={{ color: showHuman ? C.green : C.red }}>{showHuman ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
        <IconToggle icon="🛰" active={showOlympus} onClick={toggleOlympus}
          helpTitle="Hide / show Olympus units"
          helpBody={<>Toggles map visibility of Olympus-controlled units — those spawned or commanded through this terminal. Currently <b style={{ color: showOlympus ? C.green : C.red }}>{showOlympus ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
        <IconToggle icon="🤖" active={showDcs} onClick={toggleDcs}
          helpTitle="Hide / show DCS units"
          helpBody={<>Toggles map visibility of DCS-controlled units — Mission Editor AI not (yet) under Olympus control. Currently <b style={{ color: showDcs ? C.green : C.red }}>{showDcs ? 'SHOWING' : 'HIDDEN'}</b>.</>} />

        <span style={{ width: 1, height: 22, background: C.border }} />

        {/* Coalition filters */}
        <IconToggle icon="●" accent={C.red} active={showRed} onClick={toggleRed}
          helpTitle="Hide / show RED units"
          helpBody={<>Toggles map visibility of red-coalition units. Currently <b style={{ color: showRed ? C.green : C.red }}>{showRed ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
        <IconToggle icon="●" accent={C.blue} active={showBlue} onClick={toggleBlue}
          helpTitle="Hide / show BLUE units"
          helpBody={<>Toggles map visibility of blue-coalition units. Currently <b style={{ color: showBlue ? C.green : C.red }}>{showBlue ? 'SHOWING' : 'HIDDEN'}</b>.</>} />
        <IconToggle icon="●" accent={C.neutral} active={showNeutral} onClick={toggleNeutral}
          helpTitle="Hide / show NEUTRAL units"
          helpBody={<>Toggles map visibility of neutral / unaligned units. Currently <b style={{ color: showNeutral ? C.green : C.red }}>{showNeutral ? 'SHOWING' : 'HIDDEN'}</b>.</>} />

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
        <div style={{ position: 'absolute', top: 56, left: 12, bottom: 44, width: 280, zIndex: 3, display: 'flex', flexDirection: 'column', ...glass }}>
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
const seg: React.CSSProperties = { background: 'transparent', border: 'none', color: C.textDim, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const segOn: React.CSSProperties = { background: C.accentDim, color: '#cfe6ff' };
const mbtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '3px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const inp: React.CSSProperties = { background: 'rgba(0,0,0,0.35)', border: `1px solid ${C.border}`, color: C.text, padding: '5px 7px', fontSize: 12, fontFamily: 'inherit', borderRadius: 4, outline: 'none' };
const cardBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '5px 9px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
