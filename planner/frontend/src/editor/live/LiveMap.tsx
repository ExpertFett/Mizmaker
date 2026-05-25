/**
 * LiveMap — tactical display for the Live terminal. Plots the decoded Olympus
 * units on an OpenLayers map (CartoDB dark base, no API key), colored by side,
 * auto-refreshing. Click a unit to inspect it + (admin) drop smoke / delete.
 *
 * Reuses the app's existing OpenLayers dependency so it matches the editor map.
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
import { fromLonLat } from 'ol/proj';
import { Style, Circle as CircleStyle, Fill, Stroke } from 'ol/style';
import { boundingExtent } from 'ol/extent';
import 'ol/ol.css';
import { getTelemetry, sendCommand, type GroupSummary, type ServerProfile } from '../../api/groups';

const SIDE_COLOR: Record<number, string> = { 0: '#bbbbbb', 1: '#e0554f', 2: '#5a9fd4' };

function styleForUnit(coalition: number | undefined): Style {
  const color = SIDE_COLOR[coalition ?? -1] ?? '#bbbbbb';
  return new Style({
    image: new CircleStyle({
      radius: 4.5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: 'rgba(0,0,0,0.6)', width: 1 }),
    }),
  });
}

interface UnitT {
  olympusID?: number; name?: string; unitName?: string; category?: string;
  coalition?: number; position?: { lat: number; lng: number; alt?: number };
}

export function LiveMap({ group, profile }: { group: GroupSummary; profile: ServerProfile }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const srcRef = useRef<VectorSource | null>(null);
  const fittedRef = useRef(false);
  const isAdmin = group.role === 'admin';

  const [counts, setCounts] = useState({ red: 0, blue: 0, other: 0 });
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<UnitT | null>(null);
  const [cmdMsg, setCmdMsg] = useState('');

  // Create the map once.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const src = new VectorSource();
    srcRef.current = src;
    const map = new Map({
      target: elRef.current,
      layers: [
        new TileLayer({
          source: new XYZ({
            url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            attributions: '© OpenStreetMap, © CARTO',
          }),
        }),
        new VectorLayer({ source: src }),
      ],
      view: new View({ center: fromLonLat([35, 43]), zoom: 6 }),
    });
    map.on('singleclick', (e) => {
      const f = map.forEachFeatureAtPixel(e.pixel, (ft) => ft, { hitTolerance: 6 });
      setSelected(f ? (f.get('unit') as UnitT) : null);
    });
    mapRef.current = map;
    return () => { map.setTarget(undefined); mapRef.current = null; };
  }, []);

  // Poll units and refresh the markers.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await getTelemetry(group.id, profile.id, 'units');
        if (cancelled || !srcRef.current) return;
        if (!r.ok) { setErr(r.error || 'feed error'); return; }
        setErr('');
        const units = (Array.isArray(r.data) ? r.data : []) as UnitT[];
        const src = srcRef.current;
        src.clear();
        let red = 0, blue = 0, other = 0;
        const pts: number[][] = [];
        for (const u of units) {
          const p = u.position;
          if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
          if (u.coalition === 1) red++; else if (u.coalition === 2) blue++; else other++;
          const coord = fromLonLat([p.lng, p.lat]);
          pts.push(coord);
          const ft = new Feature({ geometry: new Point(coord) });
          ft.set('unit', u);
          ft.setStyle(styleForUnit(u.coalition));
          src.addFeature(ft);
        }
        setCounts({ red, blue, other });
        if (!fittedRef.current && pts.length && mapRef.current) {
          mapRef.current.getView().fit(boundingExtent(pts), { padding: [40, 40, 40, 40], maxZoom: 11 });
          fittedRef.current = true;
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'failed');
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [group.id, profile.id]);

  const runCmd = async (command: string, params: Record<string, unknown>, label: string) => {
    setCmdMsg(`${label}…`);
    try {
      const r = await sendCommand(group.id, profile.id, command, params);
      setCmdMsg(r.ok ? `✓ ${label} sent` : `✗ ${r.error}`);
    } catch (e) { setCmdMsg(`✗ ${e instanceof Error ? e.message : 'failed'}`); }
  };

  const sideLabel = (c?: number) => (c === 1 ? 'RED' : c === 2 ? 'BLUE' : 'NEU');

  return (
    <div style={{ position: 'relative', height: 'min(70vh, 560px)', border: '1px solid #3a3a3a', borderRadius: 6, overflow: 'hidden' }}>
      <div ref={elRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Legend */}
      <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(20,20,20,0.8)', border: '1px solid #3a3a3a', borderRadius: 4, padding: '6px 10px', fontSize: 12, color: '#e0e0e0' }}>
        <span style={{ color: '#e0554f' }}>● RED {counts.red}</span>{'   '}
        <span style={{ color: '#5a9fd4' }}>● BLUE {counts.blue}</span>{counts.other ? `   ● ${counts.other}` : ''}
        {err && <span style={{ color: '#d95050', marginLeft: 8 }}>✗ {err}</span>}
      </div>

      {/* Selected unit card */}
      {selected && (
        <div style={{ position: 'absolute', top: 8, right: 8, width: 240, background: 'rgba(20,20,20,0.92)', border: '1px solid #4a8fd4', borderRadius: 6, padding: '10px 12px', color: '#e0e0e0', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.unitName || selected.name || '—'}</strong>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
          <div style={{ color: '#aaa', fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
            <div>Type: {selected.name || '—'}</div>
            <div>Side: <span style={{ color: SIDE_COLOR[selected.coalition ?? -1] ?? '#bbb' }}>{sideLabel(selected.coalition)}</span> · {selected.category || ''}</div>
            <div>Pos: {selected.position ? `${selected.position.lat.toFixed(3)}, ${selected.position.lng.toFixed(3)}` : '—'}</div>
          </div>
          {isAdmin && selected.position && selected.olympusID != null && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button style={cardBtn} title="Drop green smoke here"
                      onClick={() => runCmd('smoke', { color: 'green', location: { lat: selected.position!.lat, lng: selected.position!.lng } }, 'Smoke')}>💨 Smoke</button>
              <button style={{ ...cardBtn, color: '#d95050', borderColor: '#5a2a2a' }} title="Delete from live mission"
                      onClick={() => { if (window.confirm(`Delete "${selected.unitName || selected.name}" from the LIVE mission?`)) runCmd('deleteUnit', { ID: selected.olympusID, explosion: false, explosionType: '', immediate: true }, 'Delete'); }}>✕ Delete</button>
            </div>
          )}
          {cmdMsg && <div style={{ marginTop: 6, fontSize: 12, color: cmdMsg.startsWith('✗') ? '#d95050' : '#3fb950' }}>{cmdMsg}</div>}
        </div>
      )}
    </div>
  );
}

const cardBtn: React.CSSProperties = {
  flex: 1, background: '#2a2a2a', border: '1px solid #4a4a4a', borderRadius: 3,
  color: '#e0e0e0', padding: '4px 6px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
};
