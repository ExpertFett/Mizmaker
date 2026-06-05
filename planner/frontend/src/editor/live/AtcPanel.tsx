/**
 * AtcPanel — Live-mode controller surface, modelled on the LotATC
 * "airport view" / approach plate window.
 *
 * What it does:
 *   1. Picks an airbase (filtered list of every theater airfield that
 *      has lat/lon in the missionStore).
 *   2. Shows the LotATC-equivalent detail card — name, coalition,
 *      coords, elevation (best-effort via /api/elevation), each of the
 *      four ATC radio bands (UHF / VHF-high / VHF-low / HF), each
 *      runway end with its magnetic heading.
 *   3. Per-runway "Active approach" toggle → opens a Precision
 *      Approach Radar (PAR) scope.
 *
 * PAR scope math:
 *   - For runway end with heading θ, the inbound approach axis bears
 *     θ from the threshold (the pilot is flying inbound on heading θ).
 *   - The aircraft's GREAT-CIRCLE bearing from the threshold is the
 *     reciprocal: (bearing_runway_to_aircraft) ≈ (θ+180)°. So the
 *     azimuth deviation (left/right of centerline, in degrees) is the
 *     normalised diff between that reciprocal and θ+180.
 *   - The ideal glideslope at distance r from the threshold is
 *     h_ideal(r) = r * tan(3°). Aircraft altitude AGL minus h_ideal is
 *     the glideslope deviation in feet.
 *
 * The two scopes are drawn stacked: top = glideslope (vertical), bottom
 * = azimuth (horizontal). Both show a centerline + a moving aircraft
 * dot. Range goes left→right with the threshold at the right edge so
 * the aircraft "approaches" toward the right side as in a real PAR.
 *
 * Hook-up: pulls airbases + selected unit from missionStore + the
 * parent Live state. The selected unit's position is the live aircraft
 * we're talking-in. (v1.19.29)
 */

import { useEffect, useMemo, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import type { Airbase } from '../../types/mission';

// Olympus-style palette — kept local to the panel so it doesn't need
// to import the LiveMap color block.
const C = {
  bg: 'rgba(9,13,20,0.96)',
  border: '#243349',
  borderHi: '#4a8fd4',
  text: '#e0e0e0',
  textDim: '#7d8a9a',
  accent: '#4a8fd4',
  accentDim: 'rgba(74,143,212,0.12)',
  red: '#e0554f',
  green: '#3fb950',
  amber: '#ffb24a',
};

const panelHead: React.CSSProperties = {
  padding: '7px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1,
  color: C.text, background: C.accentDim, borderBottom: `1px solid ${C.border}`,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};
const sectionLabel: React.CSSProperties = {
  fontSize: 9, letterSpacing: 1.2, color: C.textDim, textTransform: 'uppercase',
  padding: '8px 10px 3px',
};

const GLIDESLOPE_DEG = 3.0;
const PAR_RANGE_NM = 10;   // shown on each scope
const FT_PER_NM = 6076.115;

// Great-circle distance / bearing helpers — used by the PAR math.
function distNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const la1 = (lat1 * Math.PI) / 180, lo1 = (lon1 * Math.PI) / 180;
  const la2 = (lat2 * Math.PI) / 180, lo2 = (lon2 * Math.PI) / 180;
  const a = Math.sin((la2 - la1) / 2) ** 2
          + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const la1 = (lat1 * Math.PI) / 180, la2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  let b = (Math.atan2(y, x) * 180) / Math.PI;
  return (b + 360) % 360;
}
function normaliseDeg(d: number): number {
  let r = ((d + 180) % 360 + 360) % 360 - 180;
  if (r < -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}

type RunwayEnd = { name: string; heading: number };

export interface AtcPanelTrackedUnit {
  unitName?: string;
  name?: string;
  position?: { lat: number; lng: number; alt?: number };
}

interface AtcPanelProps {
  /** The aircraft we're "talking in" — usually the unit the controller
   *  has selected on the Live scope. Position drives the PAR scope. */
  trackedUnit: AtcPanelTrackedUnit | null;
  /** Close handler from the parent LiveMap. */
  onClose: () => void;
  /** When set, the panel jumps to this airbase (used when the parent
   *  knows the click came from a specific airfield marker). Changes
   *  later still let the user pick a different field manually. */
  focusName?: string;
}

export function AtcPanel({ trackedUnit, onClose, focusName }: AtcPanelProps) {
  const airbases = useMissionStore((s) => s.airbases);

  const [selectedName, setSelectedName] = useState<string>('');

  // External focus — when the parent sends a `focusName`, snap to it.
  // We watch the prop directly so a re-click on the same airbase still
  // re-focuses (e.g. user moved off and clicked back). (v1.19.32)
  useEffect(() => {
    if (focusName) setSelectedName(focusName);
  }, [focusName]);
  const [activeEnd, setActiveEnd] = useState<string>('');  // e.g. "22"
  const [filter, setFilter] = useState('');
  const [elevationFt, setElevationFt] = useState<number | null>(null);

  // Sort + filter airbases — keep entries that have lat/lon so the panel
  // never offers a no-position field.
  const filteredAirbases = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return airbases
      .filter((a) => a.lat != null && a.lon != null)
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [airbases, filter]);

  // Resolve the selected airbase by name. Default to the first one
  // available so the panel always shows SOMETHING.
  const selected: Airbase | null = useMemo(() => {
    if (!filteredAirbases.length) return null;
    return filteredAirbases.find((a) => a.name === selectedName) ?? filteredAirbases[0];
  }, [filteredAirbases, selectedName]);

  // Fetch elevation when the selected airbase changes. /api/elevation/{lat}/{lon}
  // returns the SRTM-backed terrain altitude in metres. Best-effort —
  // failure is silent (we just show "—").
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

  // Reset active runway end when the airbase changes — old end name may
  // not exist on the new field.
  useEffect(() => { setActiveEnd(''); }, [selected?.name]);

  if (!selected) {
    return (
      <div style={dock}>
        <div style={panelHead}>
          <span>🛬 ATC — no airbase data</span>
          <span onClick={onClose} style={closeBtn}>×</span>
        </div>
        <div style={{ padding: '14px 12px', fontSize: 12, color: C.textDim }}>
          No airbase records for this mission. Upload a .miz from a
          theater pydcs covers (Caucasus / Nevada / Persian Gulf /
          Syria / Marianas / Normandy / Channel / Falklands) to populate
          this panel.
        </div>
      </div>
    );
  }

  // Flatten runway list into runway ends (PAR is per END, not per runway).
  const runwayEnds: RunwayEnd[] = [];
  for (const rw of selected.runways ?? []) {
    rw.ends.forEach((name, i) => {
      if (rw.headings[i] != null) {
        runwayEnds.push({ name, heading: rw.headings[i] });
      }
    });
  }

  const activeRwy = runwayEnds.find((rw) => rw.name === activeEnd) ?? null;

  // Compute PAR deviations when we have a tracked unit + active runway.
  let par: {
    rangeNm: number;
    azimuthDeg: number;          // +right of centerline (looking inbound)
    glideslopeFt: number;        // +above ideal
    aircraftAltFt: number;
    idealAltFt: number;
  } | null = null;
  if (activeRwy && trackedUnit?.position && selected.lat != null && selected.lon != null) {
    const pos = trackedUnit.position;
    const range = distNm(selected.lat, selected.lon, pos.lat, pos.lng);
    const bearingFromThreshold = bearingDeg(selected.lat, selected.lon, pos.lat, pos.lng);
    // The aircraft is on the approach when its position is roughly on
    // the reciprocal of the inbound runway heading.
    const reciprocal = (activeRwy.heading + 180) % 360;
    const azimuthDeg = normaliseDeg(bearingFromThreshold - reciprocal);
    const altM = pos.alt ?? 0;
    const aircraftAltFt = altM * 3.28084;
    const fieldElevFt = elevationFt ?? 0;
    const aglFt = aircraftAltFt - fieldElevFt;
    const idealAltFt = range * FT_PER_NM * Math.tan((GLIDESLOPE_DEG * Math.PI) / 180);
    par = {
      rangeNm: range,
      azimuthDeg,
      glideslopeFt: aglFt - idealAltFt,
      aircraftAltFt,
      idealAltFt: idealAltFt + fieldElevFt,
    };
  }

  return (
    <div style={dock}>
      <div style={panelHead}>
        <span>🛬 ATC — {selected.name.toUpperCase()}</span>
        <span onClick={onClose} style={closeBtn}>×</span>
      </div>

      {/* Airbase picker */}
      <div style={{ padding: 8, borderBottom: `1px solid ${C.border}` }}>
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
               placeholder={`Filter ${airbases.length} fields…`}
               style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`,
                        color: C.text, padding: '5px 8px', fontSize: 12, borderRadius: 3,
                        outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        <select value={selected.name} onChange={(e) => setSelectedName(e.target.value)}
                style={{ width: '100%', marginTop: 6, background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`,
                         color: C.text, padding: '5px 8px', fontSize: 12, borderRadius: 3,
                         outline: 'none', fontFamily: 'inherit' }}>
          {filteredAirbases.map((a) => (
            <option key={a.name} value={a.name}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Field info */}
      <div style={sectionLabel}>FIELD</div>
      <div style={{ padding: '2px 10px 8px', fontSize: 12, color: C.text, lineHeight: 1.6 }}>
        <KV k="ID"        v={selected.id != null ? `#${selected.id}` : '—'} />
        <KV k="Coalition" v={(selected.coalition || 'neutral').toUpperCase()}
            color={selected.coalition === 'blue' ? C.accent
                 : selected.coalition === 'red'  ? C.red : C.textDim} />
        <KV k="Position"  v={selected.lat != null && selected.lon != null
                              ? `${selected.lat.toFixed(4)}, ${selected.lon.toFixed(4)}` : '—'} />
        <KV k="Elevation" v={elevationFt != null ? `${elevationFt} ft` : '—'} />
      </div>

      {/* Radios — show all four ATC bands. */}
      <div style={sectionLabel}>ATC RADIO</div>
      <div style={{ padding: '2px 10px 8px', fontSize: 12, color: C.text, lineHeight: 1.6, fontFamily: "'B612 Mono', monospace" }}>
        <KV k="UHF"      v={fmtFreq(selected.atc_radio?.uhf_mhz)} />
        <KV k="VHF-high" v={fmtFreq(selected.atc_radio?.vhf_high_mhz)} />
        <KV k="VHF-low"  v={fmtFreq(selected.atc_radio?.vhf_low_mhz)} />
        <KV k="HF"       v={fmtFreq(selected.atc_radio?.hf_mhz)} />
      </div>

      {/* Runways with per-end approach buttons */}
      <div style={sectionLabel}>RUNWAYS</div>
      <div style={{ padding: '2px 10px 10px', fontSize: 12 }}>
        {runwayEnds.length === 0 && (
          <div style={{ color: C.textDim, fontStyle: 'italic' }}>
            No runway data for this field.
          </div>
        )}
        {runwayEnds.map((rw, i) => {
          const isActive = rw.name === activeEnd;
          return (
            <button key={i}
                    onClick={() => setActiveEnd(isActive ? '' : rw.name)}
                    title={`Approach axis ${rw.heading}° magnetic`}
                    style={{
                      display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                      padding: '5px 8px', marginTop: 4, borderRadius: 4,
                      background: isActive ? 'rgba(63,185,80,0.14)' : 'rgba(0,0,0,0.32)',
                      border: `1px solid ${isActive ? C.green : C.border}`,
                      color: isActive ? C.green : C.text,
                      cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                    }}>
              <span style={{ fontWeight: 700 }}>
                {isActive ? '⤳ APPROACH' : 'TAKE APPROACH'}&nbsp;{rw.name}
              </span>
              <span style={{ color: C.textDim, fontFamily: "'B612 Mono', monospace" }}>
                {String(rw.heading).padStart(3, '0')}°
              </span>
            </button>
          );
        })}
      </div>

      {/* Airport view — runway schematic from the runway list. Shown
          whenever the selected field has at least one runway with a
          heading. Highlights the active end in green when an approach
          is armed. (v1.19.33) */}
      {runwayEnds.length > 0 && (
        <>
          <div style={sectionLabel}>AIRPORT VIEW</div>
          <AirportSchematic
            airbaseName={selected.name}
            runwayEnds={runwayEnds}
            activeEnd={activeEnd}
          />
        </>
      )}

      {/* PAR scope — only when an approach is active */}
      {activeRwy && (
        <>
          <div style={sectionLabel}>PAR SCOPE · RWY {activeRwy.name}</div>
          <ParScope
            airbaseName={selected.name}
            runwayHeading={activeRwy.heading}
            par={par}
            trackedName={trackedUnit?.unitName || trackedUnit?.name}
          />
        </>
      )}
    </div>
  );
}

// ── Airport schematic ───────────────────────────────────────────────────
//
// Top-down runway diagram drawn from the runway-end list. Each end's
// label is positioned where a pilot landing on that runway would
// touch down (i.e. at the opposite side of the field from the
// heading vector). North is up. Active end (when an approach is
// armed in the panel) is highlighted green. (v1.19.33)
//
// Coordinate math: the end labeled "X" with magnetic heading h sits
// at the bearing (h + 180°) from center, so on a north-up canvas:
//   endX = cx - sin(h°) * L/2
//   endY = cy + cos(h°) * L/2
// The opposite end (the take-off side / threshold for the other
// direction) is just the reciprocal — we draw a single line between
// the two ends per runway.

function AirportSchematic({ airbaseName, runwayEnds, activeEnd }: {
  airbaseName: string;
  runwayEnds: { name: string; heading: number }[];
  activeEnd: string;
}) {
  // Pair the ends into runways. ends with reciprocal heading (±180°
  // within 5°) belong to the same physical runway and share a line.
  type RunwayPair = { a: { name: string; heading: number }; b?: { name: string; heading: number } };
  const used = new Set<number>();
  const pairs: RunwayPair[] = [];
  for (let i = 0; i < runwayEnds.length; i++) {
    if (used.has(i)) continue;
    const a = runwayEnds[i];
    used.add(i);
    let mate: { name: string; heading: number } | undefined;
    for (let j = i + 1; j < runwayEnds.length; j++) {
      if (used.has(j)) continue;
      const b = runwayEnds[j];
      const diff = Math.abs(((a.heading - b.heading + 540) % 360) - 180);
      if (diff <= 5) { mate = b; used.add(j); break; }
    }
    pairs.push({ a, b: mate });
  }

  const W = 280, H = 200, MARGIN = 24;
  const cx = W / 2, cy = H / 2;
  const RUNWAY_LEN = Math.min(W, H) - MARGIN * 2;
  const HALF = RUNWAY_LEN / 2;
  const RUNWAY_WIDTH = 10;

  // For each end's heading h, the END POSITION (touchdown for a pilot
  // landing on that end) is at bearing (h+180°) from center.
  const endPos = (h: number) => ({
    x: cx - Math.sin((h * Math.PI) / 180) * HALF,
    y: cy + Math.cos((h * Math.PI) / 180) * HALF,
  });

  return (
    <div style={{ padding: '0 10px 10px' }}>
      <svg width={W} height={H} style={{ display: 'block', background: 'rgba(0,0,0,0.45)', border: `1px solid ${C.border}`, borderRadius: 4 }}>
        {/* North arrow + compass rose */}
        <g opacity={0.6}>
          <line x1={W - 18} y1={6} x2={W - 18} y2={20} stroke={C.textDim} strokeWidth={1.2} />
          <polygon points={`${W - 18},2 ${W - 22},9 ${W - 14},9`} fill={C.textDim} />
          <text x={W - 18} y={30} fontSize={9} textAnchor="middle" fill={C.textDim} fontFamily="'B612 Mono', monospace">N</text>
        </g>

        {/* Airbase name as caption */}
        <text x={MARGIN} y={H - 8} fontSize={9} fill={C.textDim} fontFamily="'B612 Mono', monospace">
          {airbaseName.toUpperCase()}
        </text>
        <text x={W - MARGIN} y={H - 8} fontSize={9} fill={C.textDim} textAnchor="end" fontFamily="'B612 Mono', monospace">
          TOP-DOWN · N↑
        </text>

        {/* Runways */}
        {pairs.map((pair, i) => {
          const e1 = endPos(pair.a.heading);
          const e2 = pair.b ? endPos(pair.b.heading)
                            : { x: 2 * cx - e1.x, y: 2 * cy - e1.y };
          // Perpendicular offset for the runway "stripe" — rotate the
          // direction vector 90°.
          const dx = e2.x - e1.x, dy = e2.y - e1.y;
          const len = Math.hypot(dx, dy) || 1;
          const px = (-dy / len) * (RUNWAY_WIDTH / 2);
          const py = (dx / len) * (RUNWAY_WIDTH / 2);
          // Asphalt rectangle as a closed polygon.
          const poly = `${e1.x + px},${e1.y + py} ${e1.x - px},${e1.y - py} ${e2.x - px},${e2.y - py} ${e2.x + px},${e2.y + py}`;
          // Centerline.
          return (
            <g key={i}>
              <polygon points={poly} fill="#3a3a3a" stroke="#1a1a1a" strokeWidth={0.5} />
              <line x1={e1.x} y1={e1.y} x2={e2.x} y2={e2.y}
                    stroke="#e0e0e0" strokeWidth={0.8} strokeDasharray="3 3" opacity={0.7} />
              {/* End A label */}
              <EndLabel end={pair.a} pos={e1} activeEnd={activeEnd} />
              {pair.b && <EndLabel end={pair.b} pos={e2} activeEnd={activeEnd} />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EndLabel({ end, pos, activeEnd }: {
  end: { name: string; heading: number };
  pos: { x: number; y: number };
  activeEnd: string;
}) {
  const isActive = end.name === activeEnd;
  return (
    <g>
      <circle cx={pos.x} cy={pos.y} r={9}
              fill={isActive ? 'rgba(63,185,80,0.22)' : 'rgba(0,0,0,0.5)'}
              stroke={isActive ? C.green : '#cfe6ff'} strokeWidth={1.2} />
      <text x={pos.x} y={pos.y + 3.5} fontSize={10} fontWeight={700}
            textAnchor="middle" fill={isActive ? C.green : '#cfe6ff'}
            fontFamily="'B612 Mono', monospace">{end.name}</text>
    </g>
  );
}

// ── PAR scope rendering ──────────────────────────────────────────────────

function ParScope({ airbaseName, runwayHeading, par, trackedName }: {
  airbaseName: string;
  runwayHeading: number;
  par: {
    rangeNm: number;
    azimuthDeg: number;
    glideslopeFt: number;
    aircraftAltFt: number;
    idealAltFt: number;
  } | null;
  trackedName?: string;
}) {
  // Scope dimensions — each scope is range-by-deviation.
  const W = 280;
  const GS_H = 80, AZ_H = 80;
  const MARGIN = 14;

  // Range axis: 10 NM total, threshold at right.
  const rangePx = (nm: number) => W - MARGIN - ((nm / PAR_RANGE_NM) * (W - 2 * MARGIN));

  // Glideslope scale: ±400 ft band shown vertically (cockpit's PAR has
  // ~±300 ft full-scale; we widen slightly for visual headroom).
  const GS_FT_FULL = 400;
  const gsPx = (devFt: number) => GS_H / 2 - (Math.max(-GS_FT_FULL, Math.min(GS_FT_FULL, devFt)) / GS_FT_FULL) * (GS_H / 2 - 4);
  // Azimuth scale: ±3° band (LotATC PAR ~±2-4°).
  const AZ_DEG_FULL = 3;
  const azPx = (devDeg: number) => AZ_H / 2 + (Math.max(-AZ_DEG_FULL, Math.min(AZ_DEG_FULL, devDeg)) / AZ_DEG_FULL) * (AZ_H / 2 - 4);

  const hasTrack = par != null && par.rangeNm <= PAR_RANGE_NM;

  return (
    <div style={{ padding: '0 10px 10px' }}>
      {/* Status line */}
      <div style={{ fontSize: 10, color: '#cfeff5', marginBottom: 4, fontFamily: "'B612 Mono', monospace" }}>
        APP HDG {String(runwayHeading).padStart(3, '0')}°&nbsp;·&nbsp;
        {trackedName ? <>TGT <b style={{ color: '#e0e0e0' }}>{trackedName}</b></>
                     : <span style={{ color: C.amber }}>NO TARGET — select an aircraft on the scope</span>}
      </div>

      {/* Glideslope scope (top) */}
      <ParScopeBlock title="GLIDESLOPE" labelTop="HIGH" labelBot="LOW" height={GS_H}>
        {/* Centerline + ideal slope ramp */}
        <line x1={MARGIN} y1={GS_H / 2} x2={W - MARGIN} y2={GS_H / 2}
              stroke="#3fb950" strokeWidth={1} strokeDasharray="4 4" />
        {hasTrack && par && (
          <>
            <circle cx={rangePx(par.rangeNm)} cy={gsPx(par.glideslopeFt)}
                    r={5} fill="#ffd24a" stroke="#000" strokeWidth={1.5} />
            <text x={rangePx(par.rangeNm) + 8} y={gsPx(par.glideslopeFt) + 4}
                  fontSize={10} fontFamily="'B612 Mono', monospace" fill="#ffd24a">
              {par.glideslopeFt > 0 ? '+' : ''}{Math.round(par.glideslopeFt)}ft
            </text>
          </>
        )}
      </ParScopeBlock>

      {/* Azimuth scope (bottom) */}
      <ParScopeBlock title="AZIMUTH" labelTop="RIGHT" labelBot="LEFT" height={AZ_H}>
        <line x1={MARGIN} y1={AZ_H / 2} x2={W - MARGIN} y2={AZ_H / 2}
              stroke="#3fb950" strokeWidth={1} strokeDasharray="4 4" />
        {hasTrack && par && (
          <>
            <circle cx={rangePx(par.rangeNm)} cy={azPx(par.azimuthDeg)}
                    r={5} fill="#ffd24a" stroke="#000" strokeWidth={1.5} />
            <text x={rangePx(par.rangeNm) + 8} y={azPx(par.azimuthDeg) + 4}
                  fontSize={10} fontFamily="'B612 Mono', monospace" fill="#ffd24a">
              {par.azimuthDeg > 0 ? '+' : ''}{par.azimuthDeg.toFixed(1)}°
            </text>
          </>
        )}
      </ParScopeBlock>

      {/* Readout */}
      {par && (
        <div style={{ marginTop: 6, padding: '5px 8px', background: 'rgba(0,0,0,0.32)', border: `1px solid ${C.border}`, borderRadius: 4, fontFamily: "'B612 Mono', monospace", fontSize: 11, color: C.text, lineHeight: 1.5 }}>
          <KV k="Range"    v={`${par.rangeNm.toFixed(1)} NM`} />
          <KV k="Alt"      v={`${Math.round(par.aircraftAltFt)} ft (ideal ${Math.round(par.idealAltFt)})`} />
          <KV k="Glide"    v={`${par.glideslopeFt > 0 ? '+' : ''}${Math.round(par.glideslopeFt)} ft`}
              color={Math.abs(par.glideslopeFt) > 100 ? C.amber : C.green} />
          <KV k="Az"       v={`${par.azimuthDeg > 0 ? '+' : ''}${par.azimuthDeg.toFixed(2)}°`}
              color={Math.abs(par.azimuthDeg) > 1 ? C.amber : C.green} />
        </div>
      )}
      <div style={{ marginTop: 4, fontSize: 9, color: C.textDim, lineHeight: 1.4 }}>
        Glideslope reference {GLIDESLOPE_DEG}° from {airbaseName}'s threshold.
        Scale: ±{GS_FT_FULL} ft glideslope / ±{AZ_DEG_FULL}° azimuth full-deflection.
      </div>
    </div>
  );
}

function ParScopeBlock({ title, labelTop, labelBot, height, children }: {
  title: string; labelTop: string; labelBot: string; height: number; children: React.ReactNode;
}) {
  const W = 280;
  return (
    <div style={{ position: 'relative', marginTop: 6 }}>
      <div style={{ fontSize: 9, color: '#cfeff5', letterSpacing: 1, fontWeight: 700, marginBottom: 2 }}>{title}</div>
      <svg width={W} height={height} style={{ display: 'block', background: 'rgba(0,0,0,0.45)', border: `1px solid ${C.border}`, borderRadius: 4 }}>
        {/* Frame text labels */}
        <text x={W - 4} y={11} fontSize={8} textAnchor="end" fill={C.textDim} fontFamily="'B612 Mono', monospace">{labelTop}</text>
        <text x={W - 4} y={height - 3} fontSize={8} textAnchor="end" fill={C.textDim} fontFamily="'B612 Mono', monospace">{labelBot}</text>
        <text x={4} y={height / 2 + 3} fontSize={8} fill={C.textDim} fontFamily="'B612 Mono', monospace">0NM</text>
        <text x={W - 4} y={height / 2 + 3} fontSize={8} fill={C.textDim} fontFamily="'B612 Mono', monospace" textAnchor="end">{PAR_RANGE_NM}NM</text>
        {children}
      </svg>
    </div>
  );
}

// ── Small UI atoms ───────────────────────────────────────────────────────

function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: C.textDim }}>{k}</span>
      <span style={{ color: color || C.text, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

function fmtFreq(mhz?: number): string {
  if (mhz == null || Number.isNaN(mhz)) return '—';
  return `${mhz.toFixed(3)} MHz`;
}

const dock: React.CSSProperties = {
  position: 'absolute',
  top: 12, left: 12,
  width: 304,
  maxHeight: 'calc(100% - 60px)',
  overflowY: 'auto',
  zIndex: 5,
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
  color: C.text,
  fontFamily: 'inherit',
};

const closeBtn: React.CSSProperties = {
  cursor: 'pointer', color: C.textDim, fontWeight: 400, fontSize: 14,
};
