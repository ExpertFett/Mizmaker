/**
 * Route Detail Card — per-flight kneeboard card with map inset.
 *
 * Shows an OL map snapshot of the route with waypoint markers,
 * leg distances, threat rings, plus a summary table below.
 *
 * Follows the DCS Kneeboard Style Guide:
 * - 600x850px, #1a1a1a bg, Arial, 17-25px fonts
 * - Orange section headers, flex-grow notes box
 */

import { metersToFeet } from '../utils/conversions';
import type { MissionGroup, ThreatRing } from '../types/mission';
import { getAircraftType } from '../utils/groups';

interface RouteDetailCardProps {
  group: MissionGroup;
  mapImageUrl: string;  // data URL from captureRoute
  threats?: ThreatRing[];
}

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

const tdStyle: React.CSSProperties = {
  padding: '3px 6px',
  border: `1px solid ${BORDER}`,
  color: TEXT,
  fontSize: 19,
};

export function RouteDetailCard({ group, mapImageUrl, threats = [] }: RouteDetailCardProps) {
  const wps = group.waypoints;
  const airframe = getAircraftType(group);
  const totalDist = wps.reduce((sum, wp) => sum + (wp.leg_distance_nm || 0), 0);
  const totalEta = wps.length > 0 ? (wps[wps.length - 1].cumulative_eta || 0) : 0;

  // Min/max altitude
  const alts = wps.filter((w) => w.altitude_m > 0).map((w) => Math.round(metersToFeet(w.altitude_m)));
  const minAlt = alts.length > 0 ? Math.min(...alts) : 0;
  const maxAlt = alts.length > 0 ? Math.max(...alts) : 0;

  // Nearby threats
  const nearbyThreats = threats.filter((t) => {
    if (t.lat == null || t.lon == null) return false;
    const tLat = t.lat, tLon = t.lon;
    return wps.some((w) => {
      if (!w.lat || !w.lon) return false;
      const dLat = (tLat - w.lat) * 110540;
      const dLon = (tLon - w.lon) * 111320 * Math.cos(w.lat * Math.PI / 180);
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      return dist < t.range * 2;
    });
  });

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
        <div style={{ fontSize: 25, fontWeight: 'bold', color: TEXT_BRIGHT, letterSpacing: 1 }}>
          ROUTE DETAIL — {group.groupName.toUpperCase()}
        </div>
        <div style={{ fontSize: 17, color: TEXT_MUTED, marginTop: 4 }}>
          {airframe} | {wps.length} WP | {totalDist.toFixed(1)} nm | ETE {fmtEte(totalEta)}
        </div>
      </div>

      {/* Map inset */}
      <div style={{
        border: `1px solid ${BORDER_MED}`,
        backgroundColor: '#111',
        overflow: 'hidden',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <img
          src={mapImageUrl}
          alt="Route map"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>

      {/* Route summary */}
      <div style={{
        fontSize: 21,
        fontWeight: 'bold',
        color: ACCENT,
        borderBottom: `1px solid ${BORDER_MED}`,
        paddingBottom: 2,
        margin: '0 0 4px 0',
      }}>
        ROUTE SUMMARY
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
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>Total Distance</td>
            <td style={tdStyle}>{totalDist.toFixed(1)} nm</td>
          </tr>
          <tr>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>Total ETE</td>
            <td style={tdStyle}>{fmtEte(totalEta)}</td>
          </tr>
          <tr>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>Altitude Range</td>
            <td style={tdStyle}>{minAlt > 0 ? `${minAlt.toLocaleString()} - ${maxAlt.toLocaleString()} ft` : 'N/A'}</td>
          </tr>
          <tr>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>Waypoints</td>
            <td style={tdStyle}>{wps.map((w) => w.waypoint_name || `WP${w.waypoint_number}`).join(' → ')}</td>
          </tr>
          {nearbyThreats.length > 0 && (
            <tr>
              <td style={{ ...tdStyle, fontWeight: 'bold', color: '#ff6666' }}>Threats</td>
              <td style={{ ...tdStyle, color: '#ff6666' }}>
                {nearbyThreats.map((t) => `${t.name} (${Math.round(t.range / 1852)}nm)`).join(', ')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Notes box */}
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
      <div style={{ fontSize: 14, color: TEXT_MUTED, textAlign: 'right', marginTop: 6 }}>
        DCS Mission Planner | VMFA-224(AW)
      </div>
    </div>
  );
}
