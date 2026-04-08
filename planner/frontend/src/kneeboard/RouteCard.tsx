/**
 * Route Card — per-flight kneeboard card.
 *
 * Shows waypoints with coords, altitude, speed, distance, ETE, bearings.
 * Weather summary at bottom. Notes area fills remaining space.
 *
 * Follows the DCS Kneeboard Style Guide:
 * - 600×850px, #1a1a1a background, Arial font
 * - 19-25px font sizes for readability in the cockpit
 * - Orange (#ffa500) section headers
 * - Flexbox layout with flex-grow notes box
 */

import { forward as toMGRS } from 'mgrs';
import { metersToFeet, msToKnots } from '../utils/conversions';
import { convertSpeed, type Weather, type SpeedMode } from '../utils/atmosphere';
import type { Waypoint, MissionGroup } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { TileMap, createProjection } from './TileMap';

export type KneeboardSpeedRef = SpeedMode | 'auto';

interface RouteCardProps {
  group: MissionGroup;
  weather?: Weather | null;
  coordFormat?: 'mgrs' | 'latlon';
  speedRef?: KneeboardSpeedRef;
  machThreshold?: number;
}

// -- Style Guide Constants --
const W = 600;
const H = 850;
const FONT = "'Arial', sans-serif";
const BG = '#1a1a1a';
const BG_NOTES = '#4a4a4a';
const BORDER = '#444';
const BORDER_MED = '#555';
const BORDER_LIGHT = '#666';
const TEXT = '#e0e0e0';
const TEXT_BRIGHT = '#fff';
const TEXT_MUTED = '#ccc';
const ACCENT = '#ffa500';

// -- Formatters --

function fmtMgrs(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return 'N/A';
  try { return toMGRS([lon, lat], 4); } catch { return 'N/A'; }
}

function fmtLatLon(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return 'N/A';
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
  const suffix = alt_type === 'RADIO' ? ' AGL' : '';
  return `${ft.toLocaleString()}${suffix}`;
}

function resolveSpeedMode(wp: Waypoint, mode: KneeboardSpeedRef, machThreshold: number): SpeedMode {
  if (mode !== 'auto') return mode;
  return metersToFeet(wp.altitude_m) >= machThreshold ? 'mach' : 'cas';
}

function fmtSpeed(wp: Waypoint, mode: KneeboardSpeedRef, wx?: Weather | null, machThreshold: number = 18000): string {
  if (!wp.speed_ms || wp.speed_ms <= 0) return '-';
  const resolved = resolveSpeedMode(wp, mode, machThreshold);
  if (!wx) return `${Math.round(msToKnots(wp.speed_ms))}`;
  const hdg = wp.leg_bearing_deg || 0;
  const val = convertSpeed(wp.speed_ms, wp.altitude_m, hdg, wx, resolved);
  if (resolved === 'mach') return `M${val.toFixed(2)}`;
  return `${Math.round(val)}`;
}

function fmtDist(nm?: number): string {
  if (nm == null || nm <= 0) return '-';
  return nm.toFixed(1);
}

function fmtEte(seconds?: number): string {
  if (seconds == null || seconds <= 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${rm.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtBrg(deg?: number): string {
  if (deg == null) return '-';
  return `${Math.round(deg).toString().padStart(3, '0')}°`;
}

function fmtWind(wx: Weather): string {
  const w = wx.wind.atGround;
  const meteoDir = (w.dir + 180) % 360;
  const kts = Math.round(msToKnots(w.speed));
  return `${Math.round(meteoDir).toString().padStart(3, '0')}° / ${kts} kts`;
}

function speedColLabel(mode: KneeboardSpeedRef): string {
  if (mode === 'auto') return 'SPD';
  switch (mode) {
    case 'gs': return 'GS';
    case 'cas': return 'CAS';
    case 'tas': return 'TAS';
    case 'mach': return 'MCH';
  }
}

// -- Shared cell styles --

const thStyle: React.CSSProperties = {
  backgroundColor: '#333',
  color: TEXT_MUTED,
  padding: '4px 6px',
  textAlign: 'center',
  border: `1px solid ${BORDER_MED}`,
  fontWeight: 'bold',
  fontSize: 17,
};

const tdStyle: React.CSSProperties = {
  padding: '3px 6px',
  border: `1px solid ${BORDER}`,
  color: TEXT,
  fontSize: 19,
};

// -- Component --

export function RouteCard({ group, weather, coordFormat = 'mgrs', speedRef = 'auto', machThreshold = 18000 }: RouteCardProps) {
  const wps = group.waypoints;
  const airframe = getAircraftType(group);
  const fmtCoord = coordFormat === 'mgrs' ? fmtMgrs : fmtLatLon;

  const totalDist = wps.reduce((sum, wp) => sum + (wp.leg_distance_nm || 0), 0);
  const totalEta = wps.length > 0 ? (wps[wps.length - 1].cumulative_eta || 0) : 0;

  return (
    <div style={{
      width: W,
      height: H,
      backgroundColor: BG,
      border: `1px solid ${BORDER}`,
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: FONT,
      color: TEXT,
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        borderBottom: `2px solid ${BORDER_LIGHT}`,
        paddingBottom: 6,
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 25,
          fontWeight: 'bold',
          color: TEXT_BRIGHT,
          letterSpacing: 1,
          margin: 0,
        }}>
          ROUTE CARD — {group.groupName.toUpperCase()}
        </div>
        <div style={{ fontSize: 17, color: TEXT_MUTED, marginTop: 4 }}>
          {airframe} | {wps.length} WP | {totalDist.toFixed(1)} nm | ETE {fmtEte(totalEta)}
        </div>
      </div>

      {/* Section: Waypoints */}
      <div style={{
        fontSize: 21,
        fontWeight: 'bold',
        color: ACCENT,
        borderBottom: `1px solid ${BORDER_MED}`,
        paddingBottom: 2,
        margin: '0 0 4px 0',
      }}>
        WAYPOINTS
      </div>

      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        marginBottom: 10,
        fontSize: 19,
        tableLayout: 'fixed',
      }}>
        <colgroup>
          <col style={{ width: '6%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '26%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '11%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={thStyle}>WP</th>
            <th style={thStyle}>NAME</th>
            <th style={{ ...thStyle, textAlign: 'left' }}>COORD</th>
            <th style={thStyle}>ALT</th>
            <th style={thStyle}>{speedColLabel(speedRef)}</th>
            <th style={thStyle}>HDG</th>
            <th style={thStyle}>DIST</th>
            <th style={thStyle}>ETE</th>
          </tr>
        </thead>
        <tbody>
          {wps.map((wp, idx) => {
            const legEta = idx > 0 && wp.cumulative_eta && wps[idx - 1]?.cumulative_eta
              ? wp.cumulative_eta - wps[idx - 1]!.cumulative_eta!
              : 0;
            const isWp0 = wp.waypoint_number === 0;
            return (
              <tr key={wp.waypoint_number}>
                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold', color: ACCENT }}>
                  {wp.waypoint_number}
                </td>
                <td style={{ ...tdStyle, fontSize: 17 }}>
                  {(wp.waypoint_name || '-').substring(0, 6)}
                </td>
                <td style={{ ...tdStyle, fontSize: coordFormat === 'mgrs' ? 16 : 14, textAlign: 'left' }}>
                  {fmtCoord(wp.lat, wp.lon)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontSize: 17 }}>
                  {fmtAlt(wp.altitude_m, wp.altitude_type)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {isWp0 ? '-' : fmtSpeed(wp, speedRef, weather, machThreshold)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center', color: TEXT_MUTED }}>
                  {isWp0 ? '-' : fmtBrg(wp.leg_bearing_deg)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {isWp0 ? '-' : fmtDist(wp.leg_distance_nm)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {isWp0 ? '-' : fmtEte(legEta)}
                </td>
              </tr>
            );
          })}
          {/* Totals */}
          <tr>
            <td colSpan={5} style={{ ...tdStyle, fontWeight: 'bold', backgroundColor: '#333' }}>
              TOTAL
            </td>
            <td style={{ ...tdStyle, textAlign: 'center', backgroundColor: '#333', color: TEXT_MUTED }}>-</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', backgroundColor: '#333' }}>
              {totalDist.toFixed(1)}
            </td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', backgroundColor: '#333' }}>
              {fmtEte(totalEta)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Section: Weather */}
      {weather && (
        <>
          <div style={{
            fontSize: 21,
            fontWeight: 'bold',
            color: ACCENT,
            borderBottom: `1px solid ${BORDER_MED}`,
            paddingBottom: 2,
            margin: '12px 0 4px 0',
          }}>
            WEATHER
          </div>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginBottom: 10,
            fontSize: 19,
            tableLayout: 'fixed',
          }}>
            <colgroup>
              <col style={{ width: '35%' }} />
              <col style={{ width: '65%' }} />
            </colgroup>
            <tbody>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 'bold' }}>QNH</td>
                <td style={tdStyle}>{weather.qnh_inhg.toFixed(2)} inHg</td>
              </tr>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 'bold' }}>Temperature</td>
                <td style={tdStyle}>{Math.round(weather.temperature_c)}°C</td>
              </tr>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 'bold' }}>Surface Wind</td>
                <td style={tdStyle}>{fmtWind(weather)}</td>
              </tr>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 'bold' }}>Clouds</td>
                <td style={tdStyle}>{Math.round(metersToFeet(weather.clouds_base_m)).toLocaleString()} ft</td>
              </tr>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 'bold' }}>Visibility</td>
                <td style={tdStyle}>{Math.round(weather.visibility_m / 1000)} km</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/* Route Map */}
      <RouteMap waypoints={wps} />

      {/* Footer */}
      <div style={{
        fontSize: 14,
        color: TEXT_MUTED,
        textAlign: 'right',
        marginTop: 6,
      }}>
        DCS Mission Planner | VMFA-224(AW)
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Route Map — tile-backed map with waypoint overlay                    */
/* ------------------------------------------------------------------ */

function RouteMap({ waypoints }: { waypoints: Waypoint[] }) {
  const wps = waypoints.filter((w) => w.lat != null && w.lon != null);
  if (wps.length < 2) return null;

  const MAP_W = 568;
  const MAP_H = 200;

  const lats = wps.map((w) => w.lat!);
  const lons = wps.map((w) => w.lon!);

  // Add 10% padding to bounds
  const rawMinLat = Math.min(...lats);
  const rawMaxLat = Math.max(...lats);
  const rawMinLon = Math.min(...lons);
  const rawMaxLon = Math.max(...lons);
  const padLat = (rawMaxLat - rawMinLat) * 0.1 || 0.01;
  const padLon = (rawMaxLon - rawMinLon) * 0.1 || 0.01;
  const minLat = rawMinLat - padLat;
  const maxLat = rawMaxLat + padLat;
  const minLon = rawMinLon - padLon;
  const maxLon = rawMaxLon + padLon;

  const proj = createProjection(minLat, maxLat, minLon, maxLon, MAP_W, MAP_H);

  const points = wps.map((w) => proj.project(w.lat!, w.lon!));
  const polyline = points.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <div style={{ padding: '4px 16px 0', borderTop: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 9, color: ACCENT, fontWeight: 600, marginBottom: 2, letterSpacing: 1 }}>ROUTE</div>
      <TileMap width={MAP_W} height={MAP_H} minLat={minLat} maxLat={maxLat} minLon={minLon} maxLon={maxLon}>
        <svg width={MAP_W} height={MAP_H} style={{ display: 'block' }}>
          {/* Route line with glow */}
          <polyline points={polyline} fill="none" stroke="rgba(74, 143, 212, 0.3)" strokeWidth={5} strokeLinejoin="round" />
          <polyline points={polyline} fill="none" stroke="#4a8fd4" strokeWidth={2} strokeLinejoin="round" />

          {/* Leg distance labels */}
          {points.map(([x, y], i) => {
            if (i === 0) return null;
            const [px, py] = points[i - 1];
            const mx = (px + x) / 2;
            const my = (py + y) / 2;
            const dist = wps[i].leg_distance_nm;
            if (!dist || dist < 0.5) return null;
            const angle = Math.atan2(y - py, x - px) * 180 / Math.PI;
            const offX = Math.sin(angle * Math.PI / 180) * 10;
            const offY = -Math.cos(angle * Math.PI / 180) * 10;
            return (
              <g key={`dist${i}`}>
                <polygon points={`${mx - 4},-3 ${mx + 4},0 ${mx - 4},3`} fill="#4a8fd4" opacity={0.6}
                  transform={`translate(${mx},${my}) rotate(${angle}) translate(${-mx},${-my})`} />
                <text x={mx + offX} y={my + offY} textAnchor="middle" fontSize={7}
                  fill="#7ab8e8" fontFamily={FONT}
                  stroke="#060d14" strokeWidth={2} paintOrder="stroke">
                  {dist.toFixed(0)}nm
                </text>
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
                <circle cx={x} cy={y} r={r + 1.5} fill="rgba(6, 13, 20, 0.6)" />
                <circle cx={x} cy={y} r={r} fill={color} stroke="#0a1520" strokeWidth={1.5} />
                <text x={x + (isFirst || isLast ? 8 : 0)} y={y - r - 4}
                  textAnchor={isFirst || isLast ? 'start' : 'middle'} fontSize={8} fontFamily={FONT}
                  fill={isFirst || isLast ? color : '#ccdae8'}
                  fontWeight={isFirst || isLast ? 700 : 500}
                  stroke="#060d14" strokeWidth={2} paintOrder="stroke">
                  {isFirst ? 'DEP' : isLast ? 'ARR' : `${wp.waypoint_number}`}
                </text>
              </g>
            );
          })}

          {/* Scale bar */}
          {(() => {
            const nmInMeters = 1852;
            const testNm = [1, 2, 5, 10, 20, 50, 100, 200];
            let barNm = 5;
            let barPx = 0;
            for (const nm of testNm) {
              barPx = proj.metersToPixels(nm * nmInMeters);
              if (barPx >= 40 && barPx <= 120) { barNm = nm; break; }
            }
            if (barPx <= 0) return null;
            return (
              <g>
                <rect x={MAP_W - 20 - barPx} y={MAP_H - 22} width={barPx + 8} height={14}
                  fill="rgba(6, 13, 20, 0.85)" rx={2} />
                <line x1={MAP_W - 16 - barPx} y1={MAP_H - 12} x2={MAP_W - 16} y2={MAP_H - 12}
                  stroke={DIM} strokeWidth={1} />
                <line x1={MAP_W - 16 - barPx} y1={MAP_H - 15} x2={MAP_W - 16 - barPx} y2={MAP_H - 9}
                  stroke={DIM} strokeWidth={1} />
                <line x1={MAP_W - 16} y1={MAP_H - 15} x2={MAP_W - 16} y2={MAP_H - 9}
                  stroke={DIM} strokeWidth={1} />
                <text x={MAP_W - 16 - barPx / 2} y={MAP_H - 16}
                  textAnchor="middle" fontSize={7} fill={DIM} fontFamily={FONT}>
                  {barNm} nm
                </text>
              </g>
            );
          })()}
        </svg>
      </TileMap>
    </div>
  );
}
