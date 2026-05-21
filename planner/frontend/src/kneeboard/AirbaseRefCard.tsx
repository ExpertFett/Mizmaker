/**
 * Airbase Reference Card — shared mission-wide kneeboard card.
 *
 * Filters the theater's full airfield list down to only those relevant
 * to the player flights' routes. Theaters like Kola have 36 airfields,
 * Sinai has 51 — listing all of them on a kneeboard is unusable noise.
 * Instead we keep:
 *   - Each player flight's home plate (waypoint 0)
 *   - Each player flight's recovery field (last waypoint)
 *   - Any airfield within ~25 nm of any waypoint along the route
 * That gives pilots the airfields they'd actually consider for divert,
 * not every dirt strip on the map.
 */

import { forward as toMGRS } from 'mgrs';
import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, notesBox, TEXT, DIM, ACCENT, ROW_ALT, footerStyle, MissionDateLine } from './cardStyles';
import type { Airbase, MissionGroup, MissionOverviewData } from '../types/mission';
import { isPlayerGroup } from '../utils/groups';

interface AirbaseRefCardProps {
  airbases: Airbase[];
  theater: string;
  overview?: MissionOverviewData;
  /** Player flights — used to filter airbases to route-relevant ones.
   *  When omitted, the card falls back to listing all airbases (legacy). */
  groups?: MissionGroup[];
  /** Friendly coalition for tagging home plates. Defaults to 'blue'. */
  coalition?: string;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
}

function fmtCoord(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return '—';
  try { return toMGRS([lon, lat], 3); } catch { return '—'; }
}

/** Great-circle distance in nm. */
function distNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const la1 = lat1 * Math.PI / 180, lo1 = lon1 * Math.PI / 180;
  const la2 = lat2 * Math.PI / 180, lo2 = lon2 * Math.PI / 180;
  const a = Math.sin((la2 - la1) / 2) ** 2
          + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function AirbaseRefCard({ airbases, theater, overview, groups, notes }: AirbaseRefCardProps) {
  // `coalition` prop is currently unused — the route filter keys off
  // player-flight waypoints regardless of side. Kept on the props
  // interface so callers don't break and so we can re-enable a side
  // filter later without an API change.
  // Filter to route-relevant airfields when groups are available.
  // Otherwise fall back to the full list (the card was used this way
  // before the filter existed; keep that path for back-compat).
  const ROUTE_PROXIMITY_NM = 25;

  type AbWithRole = Airbase & { _role?: 'HOME' | 'RTB' | 'NEAR' };

  let filtered: AbWithRole[];
  if (groups && groups.length > 0) {
    const playerFlights = groups.filter(isPlayerGroup);
    const homeKeys = new Set<string>();
    const rtbKeys = new Set<string>();
    const nearKeys = new Set<string>();

    const matchAirbase = (lat: number, lon: number, threshold: number): Airbase | null => {
      let best: Airbase | null = null;
      let bestD = Infinity;
      for (const ab of airbases) {
        if (ab.lat == null || ab.lon == null) continue;
        const d = distNm(lat, lon, ab.lat, ab.lon);
        if (d < threshold && d < bestD) { best = ab; bestD = d; }
      }
      return best;
    };

    for (const g of playerFlights) {
      const wps = g.waypoints || [];
      if (wps.length === 0) continue;
      const wp0 = wps[0], wpN = wps[wps.length - 1];
      // 5 nm match for home/RTB (tight — must actually be at the field)
      if (wp0.lat != null && wp0.lon != null) {
        const home = matchAirbase(wp0.lat, wp0.lon, 5);
        if (home) homeKeys.add(home.name);
      }
      if (wpN.lat != null && wpN.lon != null) {
        const rtb = matchAirbase(wpN.lat, wpN.lon, 5);
        if (rtb) rtbKeys.add(rtb.name);
      }
      // Wider radius for "near route" — any waypoint within X nm of an
      // airfield qualifies it as a divert candidate.
      for (const wp of wps) {
        if (wp.lat == null || wp.lon == null) continue;
        for (const ab of airbases) {
          if (ab.lat == null || ab.lon == null) continue;
          if (distNm(wp.lat, wp.lon, ab.lat, ab.lon) < ROUTE_PROXIMITY_NM) {
            nearKeys.add(ab.name);
          }
        }
      }
    }

    filtered = airbases
      .filter((ab) => homeKeys.has(ab.name) || rtbKeys.has(ab.name) || nearKeys.has(ab.name))
      .map((ab) => ({
        ...ab,
        _role: homeKeys.has(ab.name) ? 'HOME'
             : rtbKeys.has(ab.name)  ? 'RTB'
             : 'NEAR',
      } as AbWithRole));
  } else {
    filtered = airbases;
  }

  const sorted = [...filtered].sort((a, b) => {
    // Roles first: HOME → RTB → NEAR; alphabetical within each
    const rank = (r?: string) => r === 'HOME' ? 0 : r === 'RTB' ? 1 : 2;
    const ra = rank(a._role), rb = rank(b._role);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  // Reformatted to fix the "too cramped" feedback:
  // - Dropped the LAT/LON column.
  // - Two-column layout when the filtered list is still long.

  const useTwoColumns = sorted.length > 16;
  const half = Math.ceil(sorted.length / 2);
  const left = useTwoColumns ? sorted.slice(0, half) : sorted;
  const right = useTwoColumns ? sorted.slice(half) : [];

  // Role badge color — HOME = accent, RTB = blue, NEAR = dim
  const roleColor = (role?: string) => role === 'HOME' ? ACCENT
                  : role === 'RTB'  ? '#4a8fd4'
                  : DIM;

  const renderRow = (ab: AbWithRole, i: number) => (
    <tr key={ab.name + i} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
      <td style={{ ...cell, fontWeight: 500, padding: '5px 8px' }}>{ab.name}</td>
      <td style={{
        ...cell, textAlign: 'center', padding: '5px 8px',
        color: roleColor(ab._role), fontSize: 13, fontWeight: 600,
      }}>
        {ab._role || '—'}
      </td>
      <td style={{ ...cell, textAlign: 'center', color: DIM, padding: '5px 8px' }}>
        {fmtCoord(ab.lat, ab.lon)}
      </td>
    </tr>
  );

  const renderTable = (rows: AbWithRole[]) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', flexShrink: 0 }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left', padding: '6px 8px' }}>AIRFIELD</th>
          <th style={{ ...th, width: 60, padding: '6px 8px' }}>ROLE</th>
          <th style={{ ...th, width: useTwoColumns ? 110 : 140, padding: '6px 8px' }}>MGRS</th>
        </tr>
      </thead>
      <tbody>{rows.map(renderRow)}</tbody>
    </table>
  );

  // Subtitle: when filtered, show ratio so the user knows they're seeing
  // a curated list, not the full theater airfield list.
  const filteredCount = sorted.length;
  const fullCount = airbases.length;
  const isFiltered = groups && groups.length > 0 && filteredCount < fullCount;

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>AIRBASE REFERENCE</div>
        <div style={subtitleStyle}>
          {theater} | {filteredCount}{isFiltered ? ` of ${fullCount}` : ''}
          {' '}airfield{filteredCount !== 1 ? 's' : ''}
          {isFiltered ? ' (route-relevant)' : ''}
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} />}
      </div>

      {useTwoColumns ? (
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{renderTable(left)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>{renderTable(right)}</div>
        </div>
      ) : (
        renderTable(sorted)
      )}

      {sorted.length === 0 && (
        <div style={{ padding: '20px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No airbase data available for this theater.
        </div>
      )}

      {/* Notes */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, marginTop: 8 }}>
        <div style={sectionTitle}>NOTES</div>
        <div style={notesBox}>
          {notes && notes.trim() && (
            <div style={{
              fontSize: 17, color: TEXT,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
            }}>
              {notes.trim()}
            </div>
          )}
        </div>
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}
