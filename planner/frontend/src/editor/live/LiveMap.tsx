/**
 * LiveMap — tactical display + control for the Live terminal.
 * Plots decoded Olympus units (OpenLayers, CartoDB dark base) colored by side,
 * auto-refreshing. Admins can: click a unit to inspect/smoke/delete, arm "Move"
 * then click the map to reposition (setPath), and Spawn mode → pick a unit type
 * from the server's database → click the map to spawn it.
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
import { Style, Circle as CircleStyle, Fill, Stroke } from 'ol/style';
import { boundingExtent } from 'ol/extent';
import 'ol/ol.css';
import {
  getTelemetry, sendCommand, getUnitDatabase,
  type GroupSummary, type ServerProfile, type UnitCategory, type UnitDbEntry,
} from '../../api/groups';

const SIDE_COLOR: Record<number, string> = { 0: '#bbbbbb', 1: '#e0554f', 2: '#5a9fd4' };
const CAT_CMD: Record<UnitCategory, string> = {
  groundunit: 'spawnGroundUnits', aircraft: 'spawnAircrafts',
  helicopter: 'spawnHelicopters', navyunit: 'spawnNavyUnits',
};
const CATEGORIES: { id: UnitCategory; label: string }[] = [
  { id: 'groundunit', label: 'Ground' }, { id: 'aircraft', label: 'Aircraft' },
  { id: 'helicopter', label: 'Helicopter' }, { id: 'navyunit', label: 'Navy' },
];

function styleForUnit(coalition: number | undefined): Style {
  const color = SIDE_COLOR[coalition ?? -1] ?? '#bbbbbb';
  return new Style({
    image: new CircleStyle({ radius: 4.5, fill: new Fill({ color }), stroke: new Stroke({ color: 'rgba(0,0,0,0.6)', width: 1 }) }),
  });
}

interface UnitT {
  olympusID?: number; name?: string; unitName?: string; category?: string;
  coalition?: number; alive?: number; position?: { lat: number; lng: number; alt?: number };
}

export function LiveMap({ group, profile }: { group: GroupSummary; profile: ServerProfile }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const srcRef = useRef<VectorSource | null>(null);
  const fittedRef = useRef(false);
  // Persistent unit store (merge across polls so units don't blink out on a
  // delta frame / decode hiccup). Removed when explicitly dead or absent ~3 polls.
  const unitsRef = useRef<Record<string, { u: UnitT; miss: number }>>({});
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
        const src = srcRef.current; src.clear();
        let red = 0, blue = 0, other = 0, plotted = 0; const pts: number[][] = [];
        for (const { u } of Object.values(store)) {
          const p = u.position;
          if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
          plotted++;
          if (u.coalition === 1) red++; else if (u.coalition === 2) blue++; else other++;
          const coord = fromLonLat([p.lng, p.lat]); pts.push(coord);
          const ft = new Feature({ geometry: new Point(coord) });
          ft.set('unit', u); ft.setStyle(styleForUnit(u.coalition)); src.addFeature(ft);
        }
        setCounts({ red, blue, other });
        setDbg(`feed ${units.length} · plotted ${plotted}`);
        if (!fittedRef.current && pts.length && mapRef.current) {
          mapRef.current.getView().fit(boundingExtent(pts), { padding: [40, 40, 40, 40], maxZoom: 11 });
          fittedRef.current = true;
        }
      } catch (e) { if (!cancelled) setErr(e instanceof Error ? e.message : 'failed'); }
    };
    poll(); const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [group.id, profile.id]);

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

  return (
    <div style={{ position: 'relative', height: 'clamp(440px, calc(100vh - 200px), 1040px)', border: '1px solid #3a3a3a', borderRadius: 6, overflow: 'hidden' }}>
      <div ref={elRef} style={{ position: 'absolute', inset: 0, cursor: armedActive ? 'crosshair' : 'default' }} />

      {/* Legend + mode toolbar */}
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={panel}>
          <span style={{ color: '#e0554f' }}>● RED {counts.red}</span>{'   '}
          <span style={{ color: '#5a9fd4' }}>● BLUE {counts.blue}</span>{counts.other ? `   ● ${counts.other}` : ''}
          {dbg && <span style={{ color: '#888', marginLeft: 8 }}>({dbg})</span>}
          {err && <span style={{ color: '#d95050', marginLeft: 8 }}>✗ {err}</span>}
        </div>
        {isAdmin && (
          <div style={{ ...panel, display: 'flex', gap: 6 }}>
            {(['select', 'spawn'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setSpawnType(null); setArmed(null); }}
                      style={{ ...mbtn, ...(mode === m ? mbtnOn : {}) }}>{m === 'select' ? 'Select' : 'Spawn'}</button>
            ))}
          </div>
        )}
      </div>

      {/* Arm banner */}
      {(armed || (mode === 'spawn' && spawnType)) && (
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', ...panel, color: '#9cd0ff' }}>
          {armed
            ? (armed.kind === 'move' ? 'Click the map to MOVE the unit'
              : armed.kind === 'attack' ? 'Click a TARGET unit to ATTACK'
              : armed.kind === 'fireAtArea' ? 'Click the map: FIRE AT AREA'
              : 'Click the map: BOMB POINT')
            : `Click the map to SPAWN ${spawnType}`}
          <button onClick={() => { setArmed(null); setSpawnType(null); }} style={{ ...mbtn, marginLeft: 10, padding: '1px 8px' }}>cancel</button>
          {cmdMsg && <span style={{ marginLeft: 10, color: cmdMsg.startsWith('✗') ? '#d95050' : '#3fb950' }}>{cmdMsg}</span>}
        </div>
      )}

      {/* Spawn picker */}
      {isAdmin && mode === 'spawn' && (
        <div style={{ position: 'absolute', top: 8, right: 8, width: 270, ...panel, maxHeight: '88%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <select value={spawnCat} onChange={(e) => setSpawnCat(e.target.value as UnitCategory)} style={inp}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            {(['blue', 'red'] as const).map((s) => (
              <button key={s} onClick={() => setSpawnCoalition(s)}
                      style={{ ...mbtn, ...(spawnCoalition === s ? { borderColor: s === 'red' ? '#e0554f' : '#5a9fd4', color: s === 'red' ? '#e0554f' : '#5a9fd4' } : {}) }}>{s.toUpperCase()}</button>
            ))}
          </div>
          {(spawnCat === 'aircraft' || spawnCat === 'helicopter') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 12, color: '#aaa' }}>
              <span>Air start alt (ft):</span>
              <input value={spawnAltFt} onChange={(e) => setSpawnAltFt(e.target.value.replace(/[^0-9]/g, ''))}
                     style={{ ...inp, width: 80 }} />
            </div>
          )}
          <input placeholder="Search unit type…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inp, width: 'auto', marginBottom: 6 }} />
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 80 }}>
            {db.loading && <div style={{ color: '#aaa', fontSize: 12 }}>Loading database…</div>}
            {db.err && <div style={{ color: '#d95050', fontSize: 12 }}>✗ {db.err}</div>}
            {typeList.map(([k, v]) => (
              <div key={k} onClick={() => setSpawnType(k)}
                   style={{ padding: '4px 6px', fontSize: 12, cursor: 'pointer', borderRadius: 3,
                            background: spawnType === k ? 'rgba(74,143,212,0.25)' : 'transparent',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {v.label || k} <span style={{ color: '#777' }}>· {v.type || v.category}</span>
              </div>
            ))}
            {db.entries && typeList.length === 0 && !db.loading && <div style={{ color: '#777', fontSize: 12 }}>No matches.</div>}
          </div>
          {spawnType && <div style={{ marginTop: 6, fontSize: 11, color: '#9cd0ff' }}>Selected: {spawnType} — click the map.</div>}
        </div>
      )}

      {/* Selected unit card (select mode) */}
      {selected && mode === 'select' && (
        <div style={{ position: 'absolute', top: 8, right: 8, width: 252, maxHeight: '92%', overflowY: 'auto', ...panel, border: '1px solid #4a8fd4' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.unitName || selected.name || '—'}</strong>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
          <div style={{ color: '#aaa', fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
            <div>Type: {selected.name || '—'}</div>
            <div>Side: <span style={{ color: SIDE_COLOR[selected.coalition ?? -1] ?? '#bbb' }}>{sideLabel(selected.coalition)}</span> · {selected.category || ''}</div>
            <div>Pos: {selected.position ? `${selected.position.lat.toFixed(3)}, ${selected.position.lng.toFixed(3)}` : '—'}</div>
          </div>
          {isAdmin && selected.olympusID != null && (
            <div style={{ marginTop: 8 }}>
              {/* Tasking — arms a map/target click */}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button style={cardBtn} onClick={() => setArmed({ kind: 'move', id: selected.olympusID! })}>📍 Move</button>
                <button style={cardBtn} onClick={() => setArmed({ kind: 'attack', id: selected.olympusID! })}>🎯 Attack</button>
                <button style={cardBtn} onClick={() => setArmed({ kind: 'fireAtArea', id: selected.olympusID! })}>🔥 Fire</button>
                <button style={cardBtn} onClick={() => setArmed({ kind: 'bombPoint', id: selected.olympusID! })}>💣 Bomb</button>
              </div>
              {/* Behaviour */}
              <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                <select style={{ ...inp, flex: 1 }} value="" onChange={(e) => { const i = Number(e.target.value); if (i) runCmd('setROE', { ID: selected.olympusID, ROE: i }, 'ROE'); }}>
                  <option value="">ROE…</option><option value="1">Free</option><option value="2">Designated</option><option value="3">Return fire</option><option value="4">Hold</option>
                </select>
                <select style={{ ...inp, flex: 1 }} value="" onChange={(e) => { const v = e.target.value; if (v !== '') runCmd('setReactionToThreat', { ID: selected.olympusID, reactionToThreat: Number(v) }, 'Reaction'); }}>
                  <option value="">React…</option><option value="0">None</option><option value="1">Manoeuvre</option><option value="2">Passive</option><option value="3">Evade</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                <button style={cardBtn} onClick={() => runCmd('setOnOff', { ID: selected.olympusID, onOff: true }, 'On')}>On</button>
                <button style={cardBtn} onClick={() => runCmd('setOnOff', { ID: selected.olympusID, onOff: false }, 'Off')}>Off</button>
                <button style={cardBtn} onClick={() => runCmd('setFollowRoads', { ID: selected.olympusID, followRoads: true }, 'Roads on')}>Roads</button>
              </div>
              <div style={{ display: 'flex', gap: 5, marginTop: 5, alignItems: 'center' }}>
                <input placeholder="alt ft" value={ctlAlt} onChange={(e) => setCtlAlt(e.target.value.replace(/[^0-9]/g, ''))} style={{ ...inp, width: 54 }} />
                <button style={cardBtn} disabled={!ctlAlt} onClick={() => runCmd('setAltitude', { ID: selected.olympusID, altitude: Math.round(Number(ctlAlt) * 0.3048) }, 'Set alt')}>alt</button>
                <input placeholder="spd kt" value={ctlSpd} onChange={(e) => setCtlSpd(e.target.value.replace(/[^0-9]/g, ''))} style={{ ...inp, width: 54 }} />
                <button style={cardBtn} disabled={!ctlSpd} onClick={() => runCmd('setSpeed', { ID: selected.olympusID, speed: Math.round(Number(ctlSpd) * 0.514444) }, 'Set spd')}>spd</button>
              </div>
              {/* Mark / remove */}
              <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                {selected.position && (
                  <button style={cardBtn} onClick={() => runCmd('smoke', { color: 'green', location: { lat: selected.position!.lat, lng: selected.position!.lng } }, 'Smoke')}>💨 Smoke</button>
                )}
                <button style={{ ...cardBtn, color: '#d95050', borderColor: '#5a2a2a' }}
                        onClick={() => { if (window.confirm(`Delete "${selected.unitName || selected.name}" from the LIVE mission?`)) runCmd('deleteUnit', { ID: selected.olympusID, explosion: false, explosionType: '', immediate: true }, 'Delete', true); }}>✕ Delete</button>
              </div>
            </div>
          )}
          {cmdMsg && <div style={{ marginTop: 6, fontSize: 12, color: cmdMsg.startsWith('✗') ? '#d95050' : '#3fb950' }}>{cmdMsg}</div>}
        </div>
      )}
    </div>
  );
}

const panel: React.CSSProperties = { background: 'rgba(20,20,20,0.88)', border: '1px solid #3a3a3a', borderRadius: 5, padding: '8px 10px', fontSize: 12, color: '#e0e0e0' };
const mbtn: React.CSSProperties = { background: '#2a2a2a', border: '1px solid #4a4a4a', borderRadius: 3, color: '#e0e0e0', padding: '3px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const mbtnOn: React.CSSProperties = { background: 'rgba(74,143,212,0.2)', borderColor: '#4a8fd4', color: '#9cd0ff' };
const inp: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #4a4a4a', color: '#e0e0e0', padding: '4px 6px', fontSize: 12, fontFamily: 'inherit', borderRadius: 3 };
const cardBtn: React.CSSProperties = { background: '#2a2a2a', border: '1px solid #4a4a4a', borderRadius: 3, color: '#e0e0e0', padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
