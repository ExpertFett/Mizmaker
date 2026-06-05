/**
 * AirfieldsTab — editor-mode airfield directory.
 *
 * The Live ATC panel (Discord-gated, needs a group) and the Kneeboard's
 * Airbase Reference card (PNG export only) made the rich airfield detail
 * hard to find while just planning a mission. This tab surfaces it
 * straight into the editor sidebar so the planner can pick an airfield,
 * read off the ATC freqs / runway headings / position, all without
 * leaving Editor mode.
 *
 * Data source: missionStore.airbases (populated on upload). Theaters
 * pydcs covers (Caucasus / Nevada / Persian Gulf / Syria / Marianas /
 * Normandy / Channel / Falklands) get the rich detail back-end-side in
 * v1.19.28 — id, atc_radio (UHF/VHF-high/VHF-low/HF), runways with
 * names + magnetic headings. Other theaters (Kola, Iraq, Sinai,
 * GermanyCW, SouthEastAsia, TopEndAustralia) still get name + coords;
 * we render "—" for the absent fields rather than hiding them.
 *
 * UX:
 *   1. Top: search box + coalition filter chip row.
 *   2. Two-column body: left = airfield list; right = selected detail.
 *   3. Detail card mirrors the LotATC airport-properties window the user
 *      showed us — FIELD / ATC RADIO / RUNWAYS / approach buttons.
 *   4. Elevation looked up best-effort via /api/elevation/{lat}/{lon}.
 *
 * v1.19.30
 */

import { useEffect, useMemo, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import type { Airbase } from '../../types/mission';
import { formatLatLon } from '../../utils/conversions';

type CoalitionFilter = 'all' | 'blue' | 'red' | 'neutral';

export function AirfieldsTab() {
  const airbases = useMissionStore((s) => s.airbases);
  const theater = useMissionStore((s) => s.theater);

  const [query, setQuery] = useState('');
  const [coa, setCoa] = useState<CoalitionFilter>('all');
  const [selectedName, setSelectedName] = useState<string>('');
  const [elevationFt, setElevationFt] = useState<number | null>(null);

  // Filter + sort the airbase list. Skip entries with no lat/lon so the
  // detail panel never picks something we can't render.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return airbases
      .filter((a) => a.lat != null && a.lon != null)
      .filter((a) => coa === 'all' || (a.coalition || 'neutral') === coa)
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [airbases, query, coa]);

  // Auto-select the first match if nothing's selected (or the current
  // selection got filtered out).
  const selected: Airbase | null = useMemo(() => {
    if (!filtered.length) return null;
    return filtered.find((a) => a.name === selectedName) ?? filtered[0];
  }, [filtered, selectedName]);

  // Best-effort elevation lookup via the existing /api/elevation route.
  // Fires whenever the selection moves. We don't gate the rest of the
  // card on this — the request is fast (single SRTM tile lookup) but
  // even when it fails we show every other field cleanly.
  useEffect(() => {
    setElevationFt(null);
    if (!selected || selected.lat == null || selected.lon == null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/elevation/${selected.lat}/${selected.lon}`);
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const m = typeof j?.elevation_m === 'number' ? j.elevation_m
                : typeof j?.elevation === 'number' ? j.elevation : null;
        if (m != null) setElevationFt(Math.round(m * 3.28084));
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  if (airbases.length === 0) {
    return (
      <div style={{ padding: 20, color: '#aaa', fontSize: 13 }}>
        No airbase data for this theater
        {theater ? <> (<b style={{ color: '#e0e0e0' }}>{theater}</b>)</> : null}.
        Either upload a different mission, or this theater isn't covered by our
        airbase databases yet (Kola, Sinai, GermanyCW, SE Asia,
        Top End Australia, Iraq).
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 14, height: '100%', maxHeight: 'calc(100vh - 220px)' }}>
      {/* ── Left: list ─────────────────────────────────────────────────── */}
      <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>Airfields</h2>
          <span style={{ fontSize: 11, color: '#888' }}>{filtered.length} / {airbases.length}</span>
        </div>
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${airbases.length} fields…`}
          style={{
            background: '#1a1a1a', border: '1px solid #3a3a3a', color: '#e0e0e0',
            borderRadius: 4, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit',
            outline: 'none', marginBottom: 8,
          }}
        />
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(['all', 'blue', 'red', 'neutral'] as const).map((c) => (
            <button key={c} onClick={() => setCoa(c)}
                    style={{
                      flex: 1, padding: '4px 6px', fontSize: 11, fontWeight: 600,
                      letterSpacing: 0.5, textTransform: 'uppercase',
                      border: `1px solid ${coa === c ? '#4a8fd4' : '#3a3a3a'}`,
                      background: coa === c ? 'rgba(74,143,212,0.15)' : 'transparent',
                      color: coa === c ? '#cfe6ff' : '#aaa',
                      cursor: 'pointer', borderRadius: 3, fontFamily: 'inherit',
                    }}>
              {c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #2a2a2a', borderRadius: 4 }}>
          {filtered.map((a) => {
            const isActive = selected?.name === a.name;
            return (
              <div key={a.name}
                   onClick={() => setSelectedName(a.name)}
                   style={{
                     padding: '6px 10px', fontSize: 13, cursor: 'pointer',
                     borderBottom: '1px solid #1f1f1f',
                     background: isActive ? 'rgba(74,143,212,0.12)' : 'transparent',
                     borderLeft: `3px solid ${isActive ? '#4a8fd4' : 'transparent'}`,
                     color: isActive ? '#e0e0e0' : '#cccccc',
                   }}>
                <div style={{ fontWeight: isActive ? 600 : 500 }}>{a.name}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 1, fontFamily: "'B612 Mono', monospace" }}>
                  {(a.coalition || 'neutral')[0].toUpperCase()}
                  {' · '}
                  {a.lat != null && a.lon != null
                    ? `${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}`
                    : 'no coord'}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: '#888', textAlign: 'center' }}>
              No airfields match this filter.
            </div>
          )}
        </div>
      </div>

      {/* ── Right: detail card ────────────────────────────────────────── */}
      {selected && (
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: 4 }}>
          <AirfieldDetail airbase={selected} elevationFt={elevationFt} />
        </div>
      )}
    </div>
  );
}

// ── Detail card ─────────────────────────────────────────────────────────

function AirfieldDetail({ airbase, elevationFt }: { airbase: Airbase; elevationFt: number | null }) {
  const coalitionColor = airbase.coalition === 'blue' ? '#4a8fd4'
                       : airbase.coalition === 'red'  ? '#e0554f'
                       : '#888';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 16px 24px' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, color: '#e0e0e0', fontWeight: 600 }}>{airbase.name}</h2>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          {airbase.id != null && <span style={{ marginRight: 12 }}>ID #{airbase.id}</span>}
          <span style={{ color: coalitionColor, fontWeight: 600, textTransform: 'uppercase' }}>
            {airbase.coalition || 'neutral'}
          </span>
        </div>
      </div>

      <Section title="Position">
        <Row k="Lat / Lon"
             v={airbase.lat != null && airbase.lon != null
                 ? formatLatLon(airbase.lat, airbase.lon)
                 : '—'} />
        <Row k="Elevation" v={elevationFt != null ? `${elevationFt} ft` : '—'} />
      </Section>

      <Section title="ATC Radio">
        <Row k="UHF"      v={fmtFreq(airbase.atc_radio?.uhf_mhz)} mono />
        <Row k="VHF-high" v={fmtFreq(airbase.atc_radio?.vhf_high_mhz)} mono />
        <Row k="VHF-low"  v={fmtFreq(airbase.atc_radio?.vhf_low_mhz)} mono />
        <Row k="HF"       v={fmtFreq(airbase.atc_radio?.hf_mhz)} mono />
        {!airbase.atc_radio && (
          <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic', marginTop: 4 }}>
            ATC radio data not available for this theater.
          </div>
        )}
      </Section>

      <Section title="Runways">
        {(!airbase.runways || airbase.runways.length === 0) && (
          <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>
            No runway data for this airfield.
          </div>
        )}
        {airbase.runways?.map((rw, i) => (
          <div key={i} style={{
            marginTop: i ? 8 : 4, padding: '8px 10px',
            background: 'rgba(74,143,212,0.05)', border: '1px solid #2a3a4a', borderRadius: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>Runway {rw.name}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {rw.ends.map((end, j) => (
                <div key={j} style={{ padding: '6px 8px', background: 'rgba(0,0,0,0.32)', border: '1px solid #2a2a2a', borderRadius: 3 }}>
                  <div style={{ fontSize: 11, color: '#888', letterSpacing: 0.4 }}>END</div>
                  <div style={{ fontSize: 17, color: '#cfe6ff', fontWeight: 700, fontFamily: "'B612 Mono', monospace" }}>{end}</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, fontFamily: "'B612 Mono', monospace" }}>
                    {rw.headings[j] != null ? `${String(rw.headings[j]).padStart(3, '0')}° M` : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <div style={{ fontSize: 10, color: '#666', lineHeight: 1.5 }}>
        Live PAR scope + per-runway ILS / TACAN frequencies live in the
        Live mode <b style={{ color: '#999' }}>🛬 ATC / approach</b>{' '}
        panel.
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#1d1d1d', border: '1px solid #3a3a3a', borderRadius: 6, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6, fontWeight: 700 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', borderBottom: '1px dashed #2a2a2a' }}>
      <span style={{ fontSize: 12, color: '#888' }}>{k}</span>
      <span style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500,
                     fontFamily: mono ? "'B612 Mono', monospace" : 'inherit' }}>{v}</span>
    </div>
  );
}

function fmtFreq(mhz?: number): string {
  if (mhz == null || Number.isNaN(mhz)) return '—';
  return `${mhz.toFixed(3)} MHz`;
}
