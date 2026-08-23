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

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, notesBox, TEXT, DIM, ACCENT, ROW_ALT, footerStyle, MissionDateLine } from './cardStyles';
import type { Airbase, MissionGroup, MissionOverviewData } from '../types/mission';
import { formatCoord, type CoordFormat } from './coords';
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
  /** Coordinate display format from the Kneeboard tab. (v0.9.76) */
  coordFormat?: CoordFormat;
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

export function AirbaseRefCard({ airbases, theater, overview, groups, notes, coalition = 'blue', coordFormat = 'mgrs' }: AirbaseRefCardProps) {
  // Filter to route-relevant airfields when groups are available.
  // Otherwise fall back to the full list (the card was used this way
  // before the filter existed; keep that path for back-compat).
  const ROUTE_PROXIMITY_NM = 25;
  // Rows to fill the card body with before the notes box takes over. Sized
  // to the space between the header and the quarter-card notes cap.
  const MIN_ROWS = 14;

  type AbWithRole = Airbase & { _role?: 'HOME' | 'RTB' | 'DIVERT' | 'ENEMY' };

  /** Ownership comes from the .miz warehouses overlay. A red-held field is a
   *  reference, never a divert — the card used to offer Severomorsk and
   *  Olenya to a NATO package as though they were options. */
  const isEnemy = (ab: Airbase) =>
    ab.coalition !== 'neutral' && ab.coalition !== coalition;

  // Theater data carries a bare ICAO-keyed stub beside many real records
  // ("Kirkenes" and "Kirkenes (ENKR)"). The stub has no runway and no ATC, so
  // it printed as a second row of dashes for a field already listed. It is
  // also not a usable reference: without a runway a jet cannot go there.
  const usable = airbases.filter((ab) => (ab.runways?.length ?? 0) > 0);
  const pool = usable.length > 0 ? usable : airbases;

  let filtered: AbWithRole[];
  if (groups && groups.length > 0) {
    const playerFlights = groups.filter(isPlayerGroup);
    const homeKeys = new Set<string>();
    const rtbKeys = new Set<string>();
    const nearKeys = new Set<string>();

    const matchAirbase = (lat: number, lon: number, threshold: number): Airbase | null => {
      let best: Airbase | null = null;
      let bestD = Infinity;
      for (const ab of pool) {
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
        for (const ab of pool) {
          if (ab.lat == null || ab.lon == null) continue;
          if (distNm(wp.lat, wp.lon, ab.lat, ab.lon) < ROUTE_PROXIMITY_NM) {
            nearKeys.add(ab.name);
          }
        }
      }
    }

    filtered = pool
      .filter((ab) => homeKeys.has(ab.name) || rtbKeys.has(ab.name) || nearKeys.has(ab.name))
      .map((ab) => ({
        ...ab,
        _role: homeKeys.has(ab.name) ? 'HOME'
             : rtbKeys.has(ab.name)  ? 'RTB'
             : isEnemy(ab)           ? 'ENEMY'
             : 'DIVERT',
      } as AbWithRole));

    // A tight route only touches a handful of fields — Kola M4 matched four,
    // leaving five sixths of the card as an empty notes box. Top the list up
    // with the nearest other fields, marked DIVERT so it stays honest about
    // which ones the route actually passes.
    if (filtered.length < MIN_ROWS) {
      const listed = new Set(filtered.map((ab) => ab.name));
      const anchor = playerFlights[0]?.waypoints?.[0];
      const extras = pool
        .filter((ab) => !listed.has(ab.name) && ab.lat != null && ab.lon != null)
        .map((ab) => ({
          ab,
          d: anchor?.lat != null && anchor.lon != null
            ? distNm(anchor.lat, anchor.lon, ab.lat!, ab.lon!) : 0,
        }))
        // Usable fields before enemy ones, then by distance — a divert list
        // that leads with hostile airfields buries the useful rows.
        .sort((x, y) => (Number(isEnemy(x.ab)) - Number(isEnemy(y.ab))) || (x.d - y.d))
        .slice(0, MIN_ROWS - filtered.length)
        .map(({ ab }) => ({ ...ab, _role: isEnemy(ab) ? 'ENEMY' : 'DIVERT' } as AbWithRole));
      filtered = [...filtered, ...extras];
    }
  } else {
    filtered = pool;
  }

  const sorted = [...filtered].sort((a, b) => {
    // Roles first: HOME → RTB → NEAR; alphabetical within each
    const rank = (r?: string) => r === 'HOME' ? 0 : r === 'RTB' ? 1 : r === 'DIVERT' ? 2 : 3;
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
                  : role === 'ENEMY' ? '#e06666'
                  : DIM;

  // Pick the single best ATC channel to surface in the table row —
  // UHF takes priority because that's what most fast-jet pilots tune
  // first. Falls back through VHF-high (civ), VHF-low (mil low), HF.
  // Full list is shown in the per-airfield detail block below the
  // table when not collapsed. (v1.19.28)
  const primaryAtc = (atc?: Airbase['atc_radio']): string => {
    if (!atc) return '—';
    if (atc.uhf_mhz) return `${atc.uhf_mhz.toFixed(3)} UHF`;
    if (atc.vhf_high_mhz) return `${atc.vhf_high_mhz.toFixed(3)} VHF`;
    if (atc.vhf_low_mhz) return `${atc.vhf_low_mhz.toFixed(3)} VHF`;
    if (atc.hf_mhz) return `${atc.hf_mhz.toFixed(3)} HF`;
    return '—';
  };

  // Compact runway summary: "22 / 04" with the LOWER-numbered end first
  // and headings concatenated when both ends are known. Multiple
  // runways collapse to "22/04 · 16/34" so a row stays one line.
  const primaryRunways = (rws?: Airbase['runways']): string => {
    if (!rws || rws.length === 0) return '—';
    return rws.map((rw) => rw.ends.join('/')).join(' · ');
  };

  const renderRow = (ab: AbWithRole, i: number) => (
    <tr key={ab.name + i} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
      <td style={{ ...cell, fontWeight: 500, padding: '5px 8px' }}>{ab.name}</td>
      <td style={{
        ...cell, textAlign: 'center', padding: '5px 8px',
        color: roleColor(ab._role), fontSize: 13, fontWeight: 600,
      }}>
        {ab._role || '—'}
      </td>
      <td style={{ ...cell, textAlign: 'center', color: DIM, padding: '5px 8px',
        fontSize: coordFormat === 'mgrs' ? 17 : 13 }}>
        {formatCoord(ab.lat, ab.lon, coordFormat, 3)}
      </td>
      <td style={{ ...cell, textAlign: 'center', color: DIM, padding: '5px 8px', fontSize: 13 }}>
        {primaryRunways(ab.runways)}
      </td>
      <td style={{ ...cell, textAlign: 'center', color: DIM, padding: '5px 8px',
        fontSize: 13, fontFamily: "'B612 Mono', monospace" }}>
        {primaryAtc(ab.atc_radio)}
      </td>
    </tr>
  );

  const renderTable = (rows: AbWithRole[]) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', flexShrink: 0 }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left', padding: '6px 8px' }}>AIRFIELD</th>
          <th style={{ ...th, width: 50, padding: '6px 6px' }}>ROLE</th>
          <th style={{ ...th, width: useTwoColumns ? 100 : 130, padding: '6px 6px' }}>{coordFormat === 'mgrs' ? 'MGRS' : 'LAT/LON'}</th>
          <th style={{ ...th, width: useTwoColumns ? 80 : 100, padding: '6px 6px' }}>RWY</th>
          <th style={{ ...th, width: useTwoColumns ? 95 : 115, padding: '6px 6px' }}>ATC</th>
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

      <div style={footerStyle}>Generated by DCS:OPT | VMFA-224(AW)</div>
    </div>
  );
}
