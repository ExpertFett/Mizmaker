/**
 * Route Card — per-flight kneeboard card.
 *
 * Shows waypoints with coords, altitude, speed, distance, ETE, bearings.
 * Weather summary at bottom. Notes area.
 *
 * Rendered as a pure 600×850 component for canvas export.
 * All styles are inline — no external CSS dependencies.
 */

import { forward as toMGRS } from 'mgrs';
import { metersToFeet, msToKnots } from '../utils/conversions';
import { convertSpeed, type Weather, type SpeedMode } from '../utils/atmosphere';
import type { Waypoint, MissionGroup } from '../types/mission';
import { getAircraftType } from '../utils/groups';

export type KneeboardSpeedRef = SpeedMode | 'auto';

interface RouteCardProps {
  group: MissionGroup;
  weather?: Weather | null;
  coordFormat?: 'mgrs' | 'latlon';
  speedRef?: KneeboardSpeedRef;
  machThreshold?: number; // ft — above this, show Mach; below, show CAS. Default 18000
}

const W = 600;
const H = 850;

const FONT = "'Consolas', 'Courier New', monospace";
const BG = '#0a1520';
const BORDER = '#1a3a5a';
const TEXT = '#ccdae8';
const DIM = '#5a7a8a';
const ACCENT = '#4a8fd4';
const ROW_ALT = 'rgba(74, 143, 212, 0.04)';

function fmtMgrs(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return '—';
  try { return toMGRS([lon, lat], 4); } catch { return '—'; }
}

function fmtLatLon(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const la = Math.abs(lat);
  const lo = Math.abs(lon);
  const latD = Math.floor(la);
  const latM = ((la - latD) * 60).toFixed(1);
  const lonD = Math.floor(lo);
  const lonM = ((lo - lonD) * 60).toFixed(1);
  return `${ns}${latD}°${latM}' ${ew}${lonD}°${lonM}'`;
}

function fmtAlt(alt_m: number, alt_type: string): string {
  const ft = Math.round(metersToFeet(alt_m));
  if (ft <= 0) return 'SFC';
  const suffix = alt_type === 'RADIO' ? 'AGL' : '';
  if (ft >= 1000) return `${(ft / 1000).toFixed(1)}k${suffix}`;
  return `${ft}${suffix}`;
}

function resolveSpeedMode(wp: Waypoint, mode: KneeboardSpeedRef, machThreshold: number): SpeedMode {
  if (mode !== 'auto') return mode;
  const altFt = metersToFeet(wp.altitude_m);
  return altFt >= machThreshold ? 'mach' : 'cas';
}

function fmtSpeed(wp: Waypoint, mode: KneeboardSpeedRef, wx?: Weather | null, machThreshold: number = 18000): string {
  if (!wp.speed_ms || wp.speed_ms <= 0) return '—';
  const resolved = resolveSpeedMode(wp, mode, machThreshold);
  if (!wx) return `${Math.round(msToKnots(wp.speed_ms))}`;
  const hdg = wp.leg_bearing_deg || 0;
  const val = convertSpeed(wp.speed_ms, wp.altitude_m, hdg, wx, resolved);
  if (resolved === 'mach') return `M${val.toFixed(2)}`;
  return `${Math.round(val)}`;
}

function fmtDist(nm?: number): string {
  if (nm == null || nm <= 0) return '—';
  return nm.toFixed(1);
}

function fmtEte(seconds?: number): string {
  if (seconds == null || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${rm.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtBrg(deg?: number): string {
  if (deg == null) return '—';
  return `${Math.round(deg).toString().padStart(3, '0')}°`;
}

function fmtWind(wx: Weather): string {
  const w = wx.wind.atGround;
  const meteoDir = (w.dir + 180) % 360; // DCS TO → meteorological FROM
  const kts = Math.round(msToKnots(w.speed));
  return `${Math.round(meteoDir).toString().padStart(3, '0')}°/${kts}kts`;
}

function speedLabel(mode: SpeedMode): string {
  switch (mode) {
    case 'gs': return 'GS';
    case 'cas': return 'CAS';
    case 'tas': return 'TAS';
    case 'mach': return 'MCH';
  }
}

export function RouteCard({ group, weather, coordFormat = 'mgrs', speedRef = 'auto', machThreshold = 18000 }: RouteCardProps) {
  const wps = group.waypoints;
  const airframe = getAircraftType(group);
  const fmtCoord = coordFormat === 'mgrs' ? fmtMgrs : fmtLatLon;

  const totalDist = wps.reduce((sum, wp) => sum + (wp.leg_distance_nm || 0), 0);
  const totalEta = wps.length > 0 ? (wps[wps.length - 1].cumulative_eta || 0) : 0;

  // Heading sequence
  const headings = wps
    .filter((wp) => wp.leg_bearing_deg != null && wp.waypoint_number > 0)
    .map((wp) => `${Math.round(wp.leg_bearing_deg!).toString().padStart(3, '0')}°`)
    .join(' → ');

  const cell: React.CSSProperties = {
    padding: '3px 4px',
    borderBottom: `1px solid ${BORDER}`,
    fontSize: 10,
    fontFamily: FONT,
    color: TEXT,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  };

  const th: React.CSSProperties = {
    ...cell,
    fontSize: 9,
    color: ACCENT,
    fontWeight: 600,
    textAlign: 'center',
    borderBottom: `2px solid ${BORDER}`,
    padding: '4px 4px',
  };

  return (
    <div style={{
      width: W,
      height: H,
      background: BG,
      fontFamily: FONT,
      color: TEXT,
      padding: 0,
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px 8px',
        borderBottom: `2px solid ${ACCENT}`,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: 1 }}>
          ROUTE CARD — {group.groupName.toUpperCase()}
        </div>
        <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>
          {airframe} | {wps.length} WP | {totalDist.toFixed(1)} nm | ETE {fmtEte(totalEta)}
        </div>
      </div>

      {/* Waypoint Table */}
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
      }}>
        <colgroup>
          <col style={{ width: 32 }} />
          <col style={{ width: 52 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 58 }} />
          <col style={{ width: 50 }} />
          <col style={{ width: 40 }} />
          <col style={{ width: 42 }} />
          <col style={{ width: 40 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>WP</th>
            <th style={th}>NAME</th>
            <th style={{ ...th, textAlign: 'left', paddingLeft: 6 }}>COORD</th>
            <th style={th}>ALT</th>
            <th style={th}>{speedRef === 'auto' ? 'SPD' : speedLabel(speedRef)}</th>
            <th style={th}>HDG</th>
            <th style={th}>DIST</th>
            <th style={th}>ETE</th>
          </tr>
        </thead>
        <tbody>
          {wps.map((wp, idx) => {
            const legEta = idx > 0 && wp.cumulative_eta && wps[idx - 1]?.cumulative_eta
              ? wp.cumulative_eta - wps[idx - 1]!.cumulative_eta!
              : 0;
            return (
              <tr key={wp.waypoint_number} style={{
                background: idx % 2 === 0 ? 'transparent' : ROW_ALT,
              }}>
                <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>
                  {wp.waypoint_number}
                </td>
                <td style={{ ...cell, fontSize: 9 }}>
                  {(wp.waypoint_name || '').substring(0, 7)}
                </td>
                <td style={{ ...cell, fontSize: 9, paddingLeft: 6, color: DIM }}>
                  {fmtCoord(wp.lat, wp.lon)}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontSize: 9 }}>
                  {fmtAlt(wp.altitude_m, wp.altitude_type)}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontSize: 9 }}>
                  {wp.waypoint_number === 0 ? '—' : fmtSpeed(wp, speedRef, weather, machThreshold)}
                </td>
                <td style={{ ...cell, textAlign: 'center', fontSize: 9, color: DIM }}>
                  {wp.waypoint_number === 0 ? '—' : fmtBrg(wp.leg_bearing_deg)}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontSize: 9 }}>
                  {wp.waypoint_number === 0 ? '—' : fmtDist(wp.leg_distance_nm)}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontSize: 9 }}>
                  {wp.waypoint_number === 0 ? '—' : fmtEte(legEta)}
                </td>
              </tr>
            );
          })}
          {/* Totals row */}
          <tr style={{ borderTop: `2px solid ${BORDER}` }}>
            <td colSpan={5} style={{ ...cell, fontWeight: 600, paddingLeft: 16, fontSize: 10 }}>
              TOTAL
            </td>
            <td style={{ ...cell, textAlign: 'center', fontSize: 9, color: DIM }}>—</td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 600, fontSize: 10 }}>
              {totalDist.toFixed(1)}
            </td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 600, fontSize: 10 }}>
              {fmtEte(totalEta)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Heading sequence */}
      {headings && (
        <div style={{ padding: '6px 16px', borderBottom: `1px solid ${BORDER}`, fontSize: 9, color: DIM }}>
          HDG: {headings}
        </div>
      )}

      {/* Weather summary */}
      {weather && (
        <div style={{
          padding: '8px 16px',
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 10,
          display: 'flex',
          gap: 16,
        }}>
          <div>
            <span style={{ color: DIM }}>QNH </span>
            <span style={{ color: TEXT }}>{weather.qnh_inhg.toFixed(2)}</span>
          </div>
          <div>
            <span style={{ color: DIM }}>TEMP </span>
            <span style={{ color: TEXT }}>{Math.round(weather.temperature_c)}°C</span>
          </div>
          <div>
            <span style={{ color: DIM }}>WIND </span>
            <span style={{ color: TEXT }}>{fmtWind(weather)}</span>
          </div>
          <div>
            <span style={{ color: DIM }}>CLD </span>
            <span style={{ color: TEXT }}>{Math.round(metersToFeet(weather.clouds_base_m)).toLocaleString()}ft</span>
          </div>
          <div>
            <span style={{ color: DIM }}>VIS </span>
            <span style={{ color: TEXT }}>{Math.round(weather.visibility_m / 1000)}km</span>
          </div>
        </div>
      )}

      {/* Route Map */}
      <RouteMap waypoints={wps} />

      {/* Footer */}
      <div style={{
        padding: '4px 16px',
        borderTop: `1px solid ${BORDER}`,
        fontSize: 8,
        color: DIM,
        textAlign: 'right',
      }}>
        Generated by DCS Mission Planner | VMFA-224(AW)
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Route Map — SVG mini-map of waypoint path                           */
/* ------------------------------------------------------------------ */

function RouteMap({ waypoints }: { waypoints: Waypoint[] }) {
  const wps = waypoints.filter((w) => w.lat != null && w.lon != null);
  if (wps.length < 2) return null;

  const MAP_W = 568; // 600 - 32 padding
  const MAP_H = 200;
  const PAD = 24;

  // Compute bounds
  const lats = wps.map((w) => w.lat!);
  const lons = wps.map((w) => w.lon!);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  // Apply aspect-ratio correction for latitude
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos(midLat * Math.PI / 180);

  const dLat = maxLat - minLat || 0.01;
  const dLon = (maxLon - minLon) * lonScale || 0.01;

  // Scale to fit with padding
  const scaleX = (MAP_W - PAD * 2) / dLon;
  const scaleY = (MAP_H - PAD * 2) / dLat;
  const scale = Math.min(scaleX, scaleY);

  const cx = MAP_W / 2;
  const cy = MAP_H / 2;
  const midLon = (minLon + maxLon) / 2;

  function project(lat: number, lon: number): [number, number] {
    const x = cx + (lon - midLon) * lonScale * scale;
    const y = cy - (lat - midLat) * scale; // Y inverted
    return [x, y];
  }

  // Build polyline points
  const points = wps.map((w) => project(w.lat!, w.lon!));
  const polyline = points.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <div style={{
      padding: '4px 16px 0', borderTop: `1px solid ${BORDER}`,
    }}>
      <div style={{ fontSize: 9, color: ACCENT, fontWeight: 600, marginBottom: 2, letterSpacing: 1 }}>
        ROUTE
      </div>
      <svg width={MAP_W} height={MAP_H} style={{ display: 'block' }}>
        {/* Background */}
        <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="#060d14" rx={4} />

        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f}>
            <line x1={MAP_W * f} y1={0} x2={MAP_W * f} y2={MAP_H}
              stroke="#1a2a3a" strokeWidth={0.5} />
            <line x1={0} y1={MAP_H * f} x2={MAP_W} y2={MAP_H * f}
              stroke="#1a2a3a" strokeWidth={0.5} />
          </g>
        ))}

        {/* Route line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="#4a8fd4"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Direction arrows on legs */}
        {points.map(([x, y], i) => {
          if (i === 0) return null;
          const [px, py] = points[i - 1];
          const mx = (px + x) / 2;
          const my = (py + y) / 2;
          const angle = Math.atan2(y - py, x - px) * 180 / Math.PI;
          return (
            <g key={`arr${i}`} transform={`translate(${mx},${my}) rotate(${angle})`}>
              <polygon points="-4,-3 4,0 -4,3" fill="#4a8fd4" opacity={0.7} />
            </g>
          );
        })}

        {/* Waypoint dots + labels */}
        {points.map(([x, y], i) => {
          const wp = wps[i];
          const isFirst = i === 0;
          const isLast = i === wps.length - 1;
          const r = isFirst || isLast ? 5 : 3.5;
          const color = isFirst ? '#3fb950' : isLast ? '#f85149' : '#4a8fd4';
          return (
            <g key={`wp${i}`}>
              <circle cx={x} cy={y} r={r} fill={color} stroke="#0a1520" strokeWidth={1.5} />
              <text
                x={x} y={y - r - 3}
                textAnchor="middle" fontSize={8} fontFamily={FONT}
                fill={isFirst || isLast ? color : DIM}
                fontWeight={isFirst || isLast ? 700 : 400}
              >
                {isFirst ? 'DEP' : isLast ? 'ARR' : `${wp.waypoint_number}`}
              </text>
            </g>
          );
        })}

        {/* Scale indicator */}
        {(() => {
          // Approximate nm for a reference bar
          const barPx = 60;
          const barNm = barPx / scale / 1852 * 111320; // rough
          const niceNm = barNm < 5 ? Math.round(barNm) : Math.round(barNm / 5) * 5;
          if (niceNm <= 0) return null;
          const actualPx = niceNm / barNm * barPx;
          return (
            <g>
              <line x1={MAP_W - 16 - actualPx} y1={MAP_H - 12} x2={MAP_W - 16} y2={MAP_H - 12}
                stroke={DIM} strokeWidth={1} />
              <line x1={MAP_W - 16 - actualPx} y1={MAP_H - 15} x2={MAP_W - 16 - actualPx} y2={MAP_H - 9}
                stroke={DIM} strokeWidth={1} />
              <line x1={MAP_W - 16} y1={MAP_H - 15} x2={MAP_W - 16} y2={MAP_H - 9}
                stroke={DIM} strokeWidth={1} />
              <text x={MAP_W - 16 - actualPx / 2} y={MAP_H - 16}
                textAnchor="middle" fontSize={7} fill={DIM} fontFamily={FONT}>
                {niceNm} nm
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
