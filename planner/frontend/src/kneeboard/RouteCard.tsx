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

interface RouteCardProps {
  group: MissionGroup;
  weather?: Weather | null;
  coordFormat?: 'mgrs' | 'latlon';
  speedRef?: SpeedMode;
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

function fmtSpeed(wp: Waypoint, mode: SpeedMode, wx?: Weather | null): string {
  if (!wp.speed_ms || wp.speed_ms <= 0) return '—';
  if (!wx) return `${Math.round(msToKnots(wp.speed_ms))}`;
  const hdg = wp.leg_bearing_deg || 0;
  const val = convertSpeed(wp.speed_ms, wp.altitude_m, hdg, wx, mode);
  if (mode === 'mach') return `M${val.toFixed(2)}`;
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

export function RouteCard({ group, weather, coordFormat = 'mgrs', speedRef = 'cas' }: RouteCardProps) {
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
            <th style={th}>{speedLabel(speedRef)}</th>
            <th style={th}>HDG</th>
            <th style={th}>DIST</th>
            <th style={th}>ETE</th>
          </tr>
        </thead>
        <tbody>
          {wps.map((wp, idx) => {
            const legEta = idx > 0 && wp.cumulative_eta && wps[idx - 1].cumulative_eta
              ? wp.cumulative_eta - wps[idx - 1].cumulative_eta
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
                  {wp.waypoint_number === 0 ? '—' : fmtSpeed(wp, speedRef, weather)}
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

      {/* Notes area — fills remaining space */}
      <div style={{
        padding: '8px 16px',
        flex: 1,
      }}>
        <div style={{ fontSize: 10, color: DIM, marginBottom: 4 }}>NOTES:</div>
        <div style={{
          borderBottom: `1px solid ${BORDER}`,
          height: 16,
          marginBottom: 4,
        }} />
        <div style={{
          borderBottom: `1px solid ${BORDER}`,
          height: 16,
          marginBottom: 4,
        }} />
        <div style={{
          borderBottom: `1px solid ${BORDER}`,
          height: 16,
          marginBottom: 4,
        }} />
        <div style={{
          borderBottom: `1px solid ${BORDER}`,
          height: 16,
          marginBottom: 4,
        }} />
        <div style={{
          borderBottom: `1px solid ${BORDER}`,
          height: 16,
        }} />
      </div>

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
