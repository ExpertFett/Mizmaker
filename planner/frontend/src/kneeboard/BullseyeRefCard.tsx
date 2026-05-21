/**
 * Bullseye Reference Card — shared mission-wide kneeboard card.
 *
 * Redesigned 2026-04-25 from a flat 25-row table of every airfield + every
 * threat (which Fett described as "way too much info") to a focused
 * one-screen summary that answers the two questions a pilot actually
 * uses this card for:
 *
 *   1. WHERE is bullseye? (its absolute position — MGRS + LAT/LON)
 *   2. What's near it that I'd call out by BE bearing/range?
 *      (≤8 high-value points: home plates, primary diverts, top threats,
 *      closest enemy fields — NOT every airbase in the theater)
 *
 * The bullseye position itself comes from `overview.bullseye` which is
 * extracted by the backend's miz_parser.
 */

import { forward as toMGRS } from 'mgrs';
import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  cell, th, notesBox, BORDER_MED, TEXT, DIM, ACCENT, footerStyle, MissionDateLine,
} from './cardStyles';
import type { Airbase, MissionGroup, ThreatRing, MissionOverviewData } from '../types/mission';
import { metersToNm } from '../utils/conversions';

interface BullseyeRefCardProps {
  overview: MissionOverviewData;
  airbases: Airbase[];
  groups: MissionGroup[];
  threats: ThreatRing[];
  coalition: string;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
}

function fmtMGRS(lat?: number, lon?: number, precision = 4): string {
  if (lat == null || lon == null) return '—';
  try { return toMGRS([lon, lat], precision); } catch { return '—'; }
}

function fmtLatLon(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return '—';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const la = Math.abs(lat);
  const lo = Math.abs(lon);
  return `${ns}${Math.floor(la)}°${((la % 1) * 60).toFixed(1)}' ${ew}${Math.floor(lo)}°${((lo % 1) * 60).toFixed(1)}'`;
}

/**
 * Bearing + range from bullseye to a point. Returns the canonical
 * "BE 045/35" string format (true bearing, nautical miles).
 */
function fmtBE(beLat: number, beLon: number, lat: number, lon: number): string {
  const R_NM = 3440.065;
  const la1 = beLat * Math.PI / 180;
  const lo1 = beLon * Math.PI / 180;
  const la2 = lat * Math.PI / 180;
  const lo2 = lon * Math.PI / 180;
  const dl = lo2 - lo1;
  const a = Math.sin((la2 - la1) / 2) ** 2
          + Math.cos(la1) * Math.cos(la2) * Math.sin(dl / 2) ** 2;
  const distNm = 2 * R_NM * Math.asin(Math.sqrt(a));
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  const bearing = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  return `${Math.round(bearing).toString().padStart(3, '0')}/${Math.round(distNm)}`;
}

interface RefPoint {
  name: string;
  type: 'HOME' | 'DIVERT' | 'TGT FIELD' | 'THREAT';
  lat: number;
  lon: number;
  /** Distance from bullseye in nm — used to sort within type. */
  distNm: number;
  /** Optional: top-tier threat range (only set for threats). */
  threatRangeNm?: number;
}

export function BullseyeRefCard({ overview, airbases, groups, threats, coalition, notes }: BullseyeRefCardProps) {
  const theater = overview.theater;
  // overview.bullseye is `{blue: {x, y, lat, lon}, red: {...}}` from the
  // backend. Pick the friendly side's bullseye — that's what blue / red
  // pilots actually call out from.
  const beSide = coalition === 'blue' ? overview.bullseye?.blue
               : coalition === 'red'  ? overview.bullseye?.red
               : undefined;
  const beLat = beSide?.lat;
  const beLon = beSide?.lon;
  const haveBullseye = beLat != null && beLon != null;

  // Helper: distance in nm from bullseye to a point. Returns Infinity
  // when bullseye is unknown so the sort doesn't choke.
  const distFromBE = (lat: number, lon: number): number => {
    if (!haveBullseye) return Infinity;
    const R_NM = 3440.065;
    const la1 = beLat! * Math.PI / 180;
    const lo1 = beLon! * Math.PI / 180;
    const la2 = lat * Math.PI / 180;
    const lo2 = lon * Math.PI / 180;
    const dl = lo2 - lo1;
    const a = Math.sin((la2 - la1) / 2) ** 2
            + Math.cos(la1) * Math.cos(la2) * Math.sin(dl / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.sqrt(a));
  };

  // ---- Build the focused reference list -----------------------------
  const refs: RefPoint[] = [];

  // 1. Player home plates (waypoint 0 of each player flight). Dedup
  //    by lat/lon so two flights on the same field don't both show.
  const seenHome = new Set<string>();
  const playerGroups = groups.filter((g) =>
    g.coalition === coalition
    && g.units.some((u) => u.skill === 'Client' || u.skill === 'Player'),
  );
  for (const g of playerGroups) {
    const wp0 = g.waypoints.find((wp) => wp.waypoint_number === 0);
    if (wp0?.lat == null || wp0?.lon == null) continue;
    const key = `${wp0.lat.toFixed(2)},${wp0.lon.toFixed(2)}`;
    if (seenHome.has(key)) continue;
    seenHome.add(key);
    // Try to match to a named airbase; otherwise label by group name
    const nearest = airbases.find((ab) =>
      ab.lat != null && ab.lon != null
      && Math.abs(ab.lat - wp0.lat!) < 0.05 && Math.abs(ab.lon - wp0.lon!) < 0.05);
    refs.push({
      name: nearest?.name || `${g.groupName} HOME`,
      type: 'HOME',
      lat: wp0.lat,
      lon: wp0.lon,
      distNm: distFromBE(wp0.lat, wp0.lon),
    });
  }

  // 2. Top 2 friendly diverts (closest non-home blue airbases)
  const homeKeys = new Set(refs.map((r) => `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`));
  const friendlyDiverts = airbases
    .filter((ab) =>
      ab.lat != null && ab.lon != null
      && (ab.coalition === coalition || ab.coalition === 'neutral')
      && !homeKeys.has(`${ab.lat!.toFixed(2)},${ab.lon!.toFixed(2)}`))
    .map((ab) => ({
      name: ab.name,
      type: 'DIVERT' as const,
      lat: ab.lat!,
      lon: ab.lon!,
      distNm: distFromBE(ab.lat!, ab.lon!),
    }))
    .sort((a, b) => a.distNm - b.distNm)
    .slice(0, 2);
  refs.push(...friendlyDiverts);

  // 3. Top 2 enemy fields (closest opposing airbases — useful for
  //    striking / target identification calls)
  const enemyFields = airbases
    .filter((ab) =>
      ab.lat != null && ab.lon != null
      && ab.coalition && ab.coalition !== coalition && ab.coalition !== 'neutral')
    .map((ab) => ({
      name: ab.name,
      type: 'TGT FIELD' as const,
      lat: ab.lat!,
      lon: ab.lon!,
      distNm: distFromBE(ab.lat!, ab.lon!),
    }))
    .sort((a, b) => a.distNm - b.distNm)
    .slice(0, 2);
  refs.push(...enemyFields);

  // 4. Top 2 threats by engagement range (the ones pilots actually
  //    talk about by BE)
  const enemyThreats = threats
    .filter((t) => t.coalition !== coalition && t.lat != null && t.lon != null)
    .map((t) => ({
      name: t.name,
      type: 'THREAT' as const,
      lat: t.lat!,
      lon: t.lon!,
      distNm: distFromBE(t.lat!, t.lon!),
      threatRangeNm: metersToNm(t.range),
    }))
    .sort((a, b) => b.threatRangeNm - a.threatRangeNm)
    .slice(0, 2);
  refs.push(...enemyThreats);

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>BULLSEYE</div>
        <div style={subtitleStyle}>
          {theater} | {coalition.toUpperCase()} REFERENCE
        </div>
        <MissionDateLine date={overview.date} startTime={overview.start_time} />
      </div>

      {/* Bullseye position — large, centred, the actual answer to
          "where is BE?". This is what was missing in the old card. */}
      <div style={{
        textAlign: 'center', padding: '16px 12px',
        border: `1px solid ${BORDER_MED}`, marginBottom: 8,
        background: 'rgba(255, 165, 0, 0.04)',
      }}>
        <div style={{ fontSize: 13, color: DIM, letterSpacing: 1.5 }}>
          BULLSEYE POSITION
        </div>
        {haveBullseye ? (
          <>
            <div style={{ fontSize: 26, color: ACCENT, fontWeight: 700,
                          fontFamily: "'B612 Mono', 'Consolas', monospace",
                          marginTop: 4, letterSpacing: 1 }}>
              {fmtMGRS(beLat, beLon)}
            </div>
            <div style={{ fontSize: 16, color: DIM, marginTop: 2,
                          fontFamily: "'B612 Mono', 'Consolas', monospace" }}>
              {fmtLatLon(beLat, beLon)}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 16, color: DIM, marginTop: 6, fontStyle: 'italic' }}>
            No bullseye defined for {coalition} side in this mission.
          </div>
        )}
      </div>

      {/* Focused reference points — bearing/range FROM bullseye so
          pilots can call them out as 'BE 045/35' on the radio. */}
      <div style={sectionTitle}>KEY REFERENCES</div>
      {refs.length === 0 ? (
        <div style={{ padding: '20px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No reference points available.
        </div>
      ) : (
        <>
          {/* Column legend — replaces the cryptic 'FROM BE' header label
              with a one-line explanation pilots can read at a glance. */}
          <div style={{ padding: '4px 0 8px', fontSize: 13, color: DIM, fontStyle: 'italic' }}>
            Bearing/range column is bullseye-relative — read as
            "BE 045/35" = bearing 045° true, 35 nm from bullseye.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>LOCATION</th>
                <th style={{ ...th, width: 100 }}>TYPE</th>
                <th style={{ ...th, width: 130 }}>BRG / RNG (BE)</th>
                <th style={{ ...th, width: 150 }}>MGRS</th>
              </tr>
            </thead>
          <tbody>
            {refs.map((pt, i) => (
              <tr key={pt.name + i}>
                <td style={{ ...cell, fontWeight: 500 }}>
                  {pt.name}
                  {pt.threatRangeNm != null && (
                    <span style={{ fontSize: 13, color: DIM, marginLeft: 6 }}>
                      ({Math.round(pt.threatRangeNm)} nm WEZ)
                    </span>
                  )}
                </td>
                <td style={{ ...cell, textAlign: 'center', color: DIM,
                              fontFamily: "'B612 Mono', monospace", fontSize: 14 }}>
                  {pt.type}
                </td>
                <td style={{ ...cell, textAlign: 'center', fontWeight: 600,
                              color: ACCENT, fontFamily: "'B612 Mono', monospace" }}>
                  {haveBullseye
                    ? `BE ${fmtBE(beLat!, beLon!, pt.lat, pt.lon)}`
                    : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'center', color: DIM,
                              fontFamily: "'B612 Mono', monospace" }}>
                  {fmtMGRS(pt.lat, pt.lon)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}

      {/* Notes */}
      <div style={{ ...sectionTitle, marginTop: 12 }}>NOTES</div>
      <div style={notesBox}>
        {notes && notes.trim() ? (
          <div style={{
            fontSize: 17, color: TEXT,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
          }}>
            {notes.trim()}
          </div>
        ) : (
          [...Array(4)].map((_, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${BORDER_MED}`, height: 22, marginBottom: 2 }} />
          ))
        )}
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}
