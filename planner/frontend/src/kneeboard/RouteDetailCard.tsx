/**
 * Route Detail Card — per-flight kneeboard card.
 * Shows route with threat proximity analysis and terrain notes.
 * (Text-based — map overlay version is a future enhancement.)
 */

import { forward as toMGRS } from 'mgrs';
import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, TEXT, DIM, ACCENT, ROW_ALT, WARN, footerStyle, notesBox, MissionDateLine } from './cardStyles';
import type { MissionGroup, ThreatRing, MissionOverviewData } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { metersToFeet, metersToNm } from '../utils/conversions';

interface RouteDetailCardProps {
  group: MissionGroup;
  threats: ThreatRing[];
  overview?: MissionOverviewData;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
}

function distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const R = 6371000;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function fmtCoord(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return '—';
  try { return toMGRS([lon, lat], 3); } catch { return '—'; }
}

export function RouteDetailCard({ group, threats, overview, notes }: RouteDetailCardProps) {
  const airframe = getAircraftType(group);
  const wps = group.waypoints;
  const enemyThreats = threats.filter((t) => t.coalition !== group.coalition);

  // For each waypoint, find nearest threat and check if within engagement zone
  const wpThreats = wps.map((wp) => {
    if (wp.lat == null || wp.lon == null) return { nearest: null, inRange: false, dist: 0 };
    let nearest: ThreatRing | null = null;
    let minDist = Infinity;
    for (const t of enemyThreats) {
      if (t.lat == null || t.lon == null) continue;
      const d = distance(wp.lat, wp.lon, t.lat, t.lon);
      if (d < minDist) { minDist = d; nearest = t; }
    }
    return { nearest, inRange: nearest ? minDist <= nearest.range : false, dist: minDist };
  });

  // Find legs where route passes near threats
  const threatWarnings: { leg: string; threat: string; dist: number; brg: number }[] = [];
  for (let i = 1; i < wps.length; i++) {
    const wp = wps[i];
    if (wp.lat == null || wp.lon == null) continue;
    for (const t of enemyThreats) {
      if (t.lat == null || t.lon == null) continue;
      const d = distance(wp.lat, wp.lon, t.lat, t.lon);
      if (d <= t.range * 1.5) { // Within 150% of threat range
        const brg = bearing(wp.lat, wp.lon, t.lat, t.lon);
        threatWarnings.push({
          leg: `WP${wps[i - 1].waypoint_number}→${wp.waypoint_number}`,
          threat: `${t.name} (${t.type.split(' ')[0]})`,
          dist: d,
          brg,
        });
      }
    }
  }
  // Deduplicate by threat name per leg
  const uniqueWarnings = threatWarnings.filter((w, i, arr) =>
    arr.findIndex((x) => x.leg === w.leg && x.threat === w.threat) === i,
  ).slice(0, 12);

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>ROUTE DETAIL — {group.groupName.toUpperCase()}</div>
        <div style={subtitleStyle}>
          {airframe} | {wps.length} waypoints | {enemyThreats.length} known threats
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Route summary with threat proximity */}
      <div style={sectionTitle}>ROUTE WAYPOINTS</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 28 }}>WP</th>
            <th style={{ ...th, textAlign: 'left', width: 60 }}>NAME</th>
            <th style={{ ...th, width: 100 }}>MGRS</th>
            <th style={{ ...th, width: 50 }}>ALT</th>
            <th style={{ ...th, width: 40 }}>HDG</th>
            <th style={{ ...th, width: 40 }}>DIST</th>
            <th style={{ ...th, textAlign: 'left' }}>NEAREST THREAT</th>
          </tr>
        </thead>
        <tbody>
          {wps.map((wp, i) => {
            const t = wpThreats[i];
            const threatDist = t.nearest ? metersToNm(t.dist) : null;
            return (
              <tr key={wp.waypoint_number} style={{
                background: t.inRange ? 'rgba(217, 80, 80, 0.1)' : i % 2 === 0 ? 'transparent' : ROW_ALT,
              }}>
                <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>{wp.waypoint_number}</td>
                <td style={{ ...cell }}>{(wp.waypoint_name || '').substring(0, 8)}</td>
                <td style={{ ...cell, textAlign: 'center', color: DIM }}>{fmtCoord(wp.lat, wp.lon)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {Math.round(metersToFeet(wp.altitude_m)).toLocaleString()}
                </td>
                <td style={{ ...cell, textAlign: 'center', color: DIM }}>
                  {wp.leg_bearing_deg != null ? `${Math.round(wp.leg_bearing_deg).toString().padStart(3, '0')}` : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {wp.leg_distance_nm ? wp.leg_distance_nm.toFixed(1) : '—'}
                </td>
                <td style={{
                  ...cell,
                  color: t.inRange ? '#d95050' : threatDist && threatDist < 30 ? WARN : DIM,
                }}>
                  {t.nearest
                    ? `${t.nearest.type.split(' ')[0]} ${threatDist!.toFixed(0)}nm${t.inRange ? ' ⚠ IN RANGE' : ''}`
                    : '—'
                  }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Threat warnings */}
      {uniqueWarnings.length > 0 && (
        <>
          <div style={{ ...sectionTitle, color: '#d95050' }}>THREAT WARNINGS</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 80 }}>LEG</th>
                <th style={{ ...th, textAlign: 'left' }}>THREAT</th>
                <th style={{ ...th, width: 60 }}>DIST</th>
                <th style={{ ...th, width: 50 }}>BRG</th>
              </tr>
            </thead>
            <tbody>
              {uniqueWarnings.map((w, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell, color: ACCENT }}>{w.leg}</td>
                  <td style={{ ...cell, color: WARN }}>{w.threat}</td>
                  <td style={{ ...cell, textAlign: 'right', color: TEXT }}>
                    {metersToNm(w.dist).toFixed(0)} nm
                  </td>
                  <td style={{ ...cell, textAlign: 'center', color: DIM }}>
                    {Math.round(w.brg).toString().padStart(3, '0')}°
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Threat inventory */}
      {enemyThreats.length > 0 && (
        <>
          <div style={sectionTitle}>THREAT INVENTORY</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>SYSTEM</th>
                <th style={{ ...th, width: 60 }}>RANGE</th>
                <th style={{ ...th, width: 100 }}>MGRS</th>
              </tr>
            </thead>
            <tbody>
              {enemyThreats.slice(0, 10).map((t, i) => (
                <tr key={t.name + i} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell }}>{t.name}</td>
                  <td style={{ ...cell, textAlign: 'right', color: WARN }}>
                    {metersToNm(t.range).toFixed(0)} nm
                  </td>
                  <td style={{ ...cell, textAlign: 'center', color: DIM }}>{fmtCoord(t.lat, t.lon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Notes */}
      <div style={{ ...sectionTitle, marginTop: 6 }}>NOTES</div>
      <div style={notesBox}>
        {notes && notes.trim() ? (
          <div style={{
            fontSize: 17, color: TEXT,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
          }}>
            {notes.trim()}
          </div>
        ) : (
          [...Array(3)].map((_, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${BORDER}`, height: 20, marginBottom: 4 }} />
          ))
        )}
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}
