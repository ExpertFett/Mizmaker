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
  return `${ns}${latD}\u00B0${latM}' ${ew}${lonD}\u00B0${lonM}'`;
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
  if (!wp.speed_ms || wp.speed_ms <= 0) return '\u00A0';
  const resolved = resolveSpeedMode(wp, mode, machThreshold);
  if (!wx) return `${Math.round(msToKnots(wp.speed_ms))}`;
  const hdg = wp.leg_bearing_deg || 0;
  const val = convertSpeed(wp.speed_ms, wp.altitude_m, hdg, wx, resolved);
  if (resolved === 'mach') return `M${val.toFixed(2)}`;
  return `${Math.round(val)}`;
}

function fmtDist(nm?: number): string {
  if (nm == null || nm <= 0) return '\u00A0';
  return nm.toFixed(1);
}

function fmtEte(seconds?: number): string {
  if (seconds == null || seconds <= 0) return '\u00A0';
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
  if (deg == null) return '\u00A0';
  return `${Math.round(deg).toString().padStart(3, '0')}\u00B0`;
}

function fmtWind(wx: Weather): string {
  const w = wx.wind.atGround;
  const meteoDir = (w.dir + 180) % 360;
  const kts = Math.round(msToKnots(w.speed));
  return `${Math.round(meteoDir).toString().padStart(3, '0')}\u00B0/${kts}kts`;
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
            const prevEta = idx > 0 ? wps[idx - 1]?.cumulative_eta : undefined;
            const legEta = idx > 0 && wp.cumulative_eta != null && prevEta != null
              ? wp.cumulative_eta - prevEta
              : 0;
            const isWp0 = wp.waypoint_number === 0;
            return (
              <tr key={wp.waypoint_number}>
                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold', color: ACCENT }}>
                  {wp.waypoint_number}
                </td>
                <td style={{ ...tdStyle, fontSize: 17 }}>
                  {(wp.waypoint_name || '\u00A0').substring(0, 6)}
                </td>
                <td style={{ ...tdStyle, fontSize: coordFormat === 'mgrs' ? 16 : 14, textAlign: 'left' }}>
                  {fmtCoord(wp.lat, wp.lon)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontSize: 17 }}>
                  {fmtAlt(wp.altitude_m, wp.altitude_type)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {isWp0 ? '\u00A0' : fmtSpeed(wp, speedRef, weather, machThreshold)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center', color: TEXT_MUTED }}>
                  {isWp0 ? '\u00A0' : fmtBrg(wp.leg_bearing_deg)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {isWp0 ? '\u00A0' : fmtDist(wp.leg_distance_nm)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {isWp0 ? '\u00A0' : fmtEte(legEta)}
                </td>
              </tr>
            );
          })}
          {/* Totals */}
          <tr>
            <td colSpan={5} style={{ ...tdStyle, fontWeight: 'bold', backgroundColor: '#333' }}>
              TOTAL
            </td>
            <td style={{ ...tdStyle, textAlign: 'center', backgroundColor: '#333', color: TEXT_MUTED }}>{'\u00A0'}</td>
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
                <td style={tdStyle}>{weather.qnh_inhg.toFixed(2)} inHg / {weather.qnh_hpa.toFixed(0)} hPa</td>
              </tr>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 'bold' }}>Temperature</td>
                <td style={tdStyle}>{Math.round(weather.temperature_c)}\u00B0C</td>
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

      {/* Notes box — flex-grow fills remaining space */}
      <div style={{
        backgroundColor: BG_NOTES,
        border: `1px solid ${BORDER}`,
        marginTop: 12,
        flexGrow: 1,
        padding: '6px 8px',
      }}>
        <div style={{ fontSize: 17, color: TEXT_MUTED, fontWeight: 'bold' }}>NOTES</div>
      </div>

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
