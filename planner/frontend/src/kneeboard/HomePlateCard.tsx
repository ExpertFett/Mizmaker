/**
 * Home Plate / Divert Card — per-flight kneeboard card.
 *
 * Shows the departure/recovery airfield and nearest divert options with
 * TACAN, frequency, coordinates. Runway/ILS/elevation data comes from
 * the SOP if active, otherwise fields are left blank for the pilot to fill.
 */

import { forward as toMGRS } from 'mgrs';
import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  cell, th, TEXT_MUTED, DIM, ROW_ALT,
  footerStyle, notesBox, MissionDateLine,
} from './cardStyles';
import type { MissionGroup, Airbase, MissionOverviewData } from '../types/mission';
import { getAircraftType } from '../utils/groups';

interface HomePlateCardProps {
  group: MissionGroup;
  airbases: Airbase[];
  overview?: MissionOverviewData;
}

function fmtCoord(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return '—';
  try { return toMGRS([lon, lat], 3); } catch { return '—'; }
}

// fmtLatLon helper removed — card formats coords via MGRS only (fmtCoord).

/** Haversine distance in nm */
function distNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const R = 3440.065; // earth radius in nm
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bearing from p1 to p2 */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function HomePlateCard({ group, airbases, overview }: HomePlateCardProps) {
  const airframe = getAircraftType(group);

  // Home plate = first waypoint (parking/departure)
  const wp0 = group.waypoints[0];
  const homeLat = wp0?.lat;
  const homeLon = wp0?.lon;

  // Find the nearest airbases to home position, sorted by distance
  const ranked = airbases
    .filter((a) => a.lat != null && a.lon != null)
    .map((a) => {
      const dist = (homeLat != null && homeLon != null)
        ? distNm(homeLat, homeLon, a.lat!, a.lon!)
        : 9999;
      const brg = (homeLat != null && homeLon != null)
        ? bearing(homeLat, homeLon, a.lat!, a.lon!)
        : 0;
      return { ...a, dist, brg };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8); // top 8 nearest

  // Mark the closest as "HOME PLATE" (within 5nm of departure)
  const home = ranked.length > 0 && ranked[0].dist < 5 ? ranked[0] : null;
  const diverts = home ? ranked.slice(1) : ranked;

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>HOME PLATE / DIVERT</div>
        <div style={subtitleStyle}>
          {airframe} | {group.groupName} | {airbases.length} fields in theater
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Home Plate */}
      <div style={sectionTitle}>HOME PLATE</div>
      {home ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>FIELD</th>
              <th style={{ ...th, width: 120 }}>COORD</th>
              <th style={{ ...th, width: 60 }}>TCN</th>
              <th style={{ ...th, width: 90 }}>V/UHF</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...cell, fontWeight: 600 }}>{home.name}</td>
              <td style={{ ...cell, fontFamily: "'B612 Mono', monospace", fontSize: 15, textAlign: 'center' }}>
                {fmtCoord(home.lat, home.lon)}
              </td>
              <td style={{ ...cell, textAlign: 'center', color: DIM }}>—</td>
              <td style={{ ...cell, textAlign: 'center', color: DIM }}>—</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 13, color: DIM, padding: '6px 0 10px' }}>
          No departure airbase identified. Place first waypoint at an airfield.
        </div>
      )}

      {/* Divert options */}
      <div style={sectionTitle}>DIVERT OPTIONS ({diverts.length})</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', flexShrink: 0 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>FIELD</th>
            <th style={{ ...th, width: 50 }}>BRG</th>
            <th style={{ ...th, width: 50 }}>DIST</th>
            <th style={{ ...th, width: 110 }}>MGRS</th>
            <th style={{ ...th, width: 60 }}>TCN</th>
          </tr>
        </thead>
        <tbody>
          {diverts.map((a, i) => (
            <tr key={a.name} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
              <td style={{ ...cell, fontWeight: 600 }}>{a.name}</td>
              <td style={{ ...cell, textAlign: 'center', fontFamily: "'B612 Mono', monospace" }}>
                {Math.round(a.brg).toString().padStart(3, '0')}°
              </td>
              <td style={{ ...cell, textAlign: 'center', fontFamily: "'B612 Mono', monospace" }}>
                {a.dist < 1 ? '<1' : Math.round(a.dist)} nm
              </td>
              <td style={{ ...cell, fontFamily: "'B612 Mono', monospace", fontSize: 15, textAlign: 'center' }}>
                {fmtCoord(a.lat, a.lon)}
              </td>
              <td style={{ ...cell, textAlign: 'center', color: DIM }}>—</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Notes area for pilot to write runway/ILS etc. */}
      <div style={{ padding: '8px 0 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 15, color: TEXT_MUTED, marginBottom: 2 }}>
          RWY / ILS / ELEV — fill from SOP or mission brief
        </div>
        <div style={notesBox} />
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}
