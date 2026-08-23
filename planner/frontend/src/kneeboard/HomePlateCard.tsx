/**
 * Home Plate / Divert Card — per-flight kneeboard card.
 *
 * Shows the departure/recovery airfield and nearest divert options with
 * TACAN, frequency, coordinates. Runway/ILS/elevation data comes from
 * the SOP if active, otherwise fields are left blank for the pilot to fill.
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  cell, th, TEXT_MUTED, DIM, ROW_ALT,
  footerStyle, notesBox, MissionDateLine,
} from './cardStyles';
import type { MissionGroup, Airbase, MissionOverviewData } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { formatCoord, type CoordFormat } from './coords';

interface HomePlateCardProps {
  group: MissionGroup;
  airbases: Airbase[];
  /** Every group in the mission — used only to work out who holds each
   *  airfield, which the airbase records themselves do not say. */
  allGroups?: MissionGroup[];
  overview?: MissionOverviewData;
  /** Coordinate display format from the Kneeboard tab. (v0.9.76) */
  coordFormat?: CoordFormat;
}

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

/** "28/10" — both runway ends, from the theater's runway headings. */
function rwyLabel(a: { runways?: { name?: string; ends?: string[]; headings?: number[] }[] }): string {
  const rw = a.runways || [];
  if (!rw.length) return '—';
  const first = rw[0];
  // `ends` is pydcs's own naming and survives suffixed runways ("22L"); the
  // headings are only a fallback for records that omit it.
  // Pad to the two-digit form a pilot reads on the plate: pydcs hands back
  // "4" for runway 04. Suffixed ends ("22L") pass through untouched.
  if (first.ends && first.ends.length >= 2) {
    return first.ends.map((e) => (/^\d$/.test(e) ? `0${e}` : e)).join('/');
  }
  if (first.headings && first.headings.length >= 2) {
    return first.headings.map((h) => Math.round(h / 10).toString().padStart(2, '0')).join('/');
  }
  return first.name || '—';
}

/** Tower frequency. UHF is what a Hornet reaches for; VHF is the fallback. */
function twrLabel(a: { atc_radio?: { uhf_mhz?: number; vhf_high_mhz?: number } }): string {
  const r = a.atc_radio;
  if (!r) return '—';
  const f = r.uhf_mhz ?? r.vhf_high_mhz;
  return f != null ? f.toFixed(2) : '—';
}

/** Who holds each airfield, derived from who is based there.
 *
 *  DCS mission files leave `airbase.coalition` as "neutral" for every field —
 *  it is not where ownership is recorded — so a Kola strike package was being
 *  handed Severomorsk-1 and Kilpyavr as valid diverts. What does carry the
 *  answer is which coalition's groups start ON the field: a waypoint's
 *  `airdrome_id` matches `airbase.id`. Checked across Kola M4, no field came
 *  back contested, so first writer wins is good enough. */
function ownershipByAirfield(groups: MissionGroup[]): Map<number, string> {
  const owner = new Map<number, string>();
  for (const g of groups) {
    for (const w of g.waypoints || []) {
      if (w.airdrome_id == null) continue;
      if (!owner.has(w.airdrome_id)) owner.set(w.airdrome_id, g.coalition);
    }
  }
  return owner;
}

type FieldUse = 'yes' | 'no' | 'unknown';

/** Can this field actually service a jet?
 *
 *  DCS rearm/refuel needs a real airfield the coalition can use. Ownership is
 *  the other half of that test, but every field in the missions checked so far
 *  parses as `neutral` — usable by anyone — so the discriminator that carries
 *  real signal is whether there is a runway at all. Helipads and FARPs come
 *  through with none and cannot take fixed wing. */
function canService(
  a: Airbase,
  owner: Map<number, string>,
  side: string,
): FieldUse {
  if ((a.runways?.length ?? 0) === 0) return 'no';

  // The warehouses overlay is authoritative when present: it is where DCS
  // records who holds the field, and whether it has fuel and munitions.
  // Fall back to who is based there for missions that ship no warehouses.
  const held = a.coalition !== 'neutral' ? a.coalition
    : (a.id != null ? owner.get(a.id) : undefined);
  if (!held) return 'unknown';                       // nobody there — can't tell
  if (held !== side && held !== 'neutrals' && held !== 'neutral') return 'no';

  // Friendly field, but a field stripped of fuel cannot turn a jet around.
  if (a.supplies && !a.supplies.fuel) return 'no';
  return 'yes';
}

const USE_MARK: Record<FieldUse, { glyph: string; color: string }> = {
  yes: { glyph: '✔', color: '#7fd97f' },
  no: { glyph: '✖', color: '#e06666' },
  unknown: { glyph: '?', color: DIM },
};

export function HomePlateCard({ group, airbases, allGroups, overview, coordFormat = 'mgrs' }: HomePlateCardProps) {
  const airframe = getAircraftType(group);

  // Home plate = first waypoint (parking/departure)
  const wp0 = group.waypoints[0];
  const homeLat = wp0?.lat;
  const homeLon = wp0?.lon;

  // Theater data carries a second, bare record for many fields — an ICAO-keyed
  // stub with no runways and no ATC ("Koshka Yavr" AND "Koshka Yavr (XLMY)").
  // The stub's position does not agree with the real record (those two sit 37nm
  // apart on Kola), so the pair cannot be collapsed on name or coordinate. What
  // separates them reliably is that the stub has no runway data at all — and a
  // field with no known runway is not a divert for a jet regardless. Filter on
  // that, then collapse anything still co-located as a final guard.
  const owner = ownershipByAirfield(allGroups ?? [group]);
  const side = group.coalition;

  const withRunway = airbases.filter((a) => (a.runways?.length ?? 0) > 0);
  // Fall back to the raw list if a theater ships no runway data, so the card
  // degrades to its old behaviour instead of going blank.
  const usable = withRunway.length > 0 ? withRunway : airbases;

  const byField = new Map<string, Airbase>();
  for (const a of usable) {
    if (a.lat == null || a.lon == null) continue;
    const key = `${a.lat.toFixed(2)},${a.lon.toFixed(2)}`;
    const prev = byField.get(key);
    if (!prev || (prev.runways?.length ?? 0) < (a.runways?.length ?? 0)) byField.set(key, a);
  }

  // Find the nearest airbases to home position, sorted by distance
  const ranked = [...byField.values()]
    .map((a) => {
      const dist = (homeLat != null && homeLon != null)
        ? distNm(homeLat, homeLon, a.lat!, a.lon!)
        : 9999;
      const brg = (homeLat != null && homeLon != null)
        ? bearing(homeLat, homeLon, a.lat!, a.lon!)
        : 0;
      return { ...a, dist, brg };
    })
    // Nearest first, but an enemy field is a last resort no matter how close,
    // so it sorts below anything usable rather than crowding the list.
    .sort((a, b) => {
      const rank = (x: Airbase) => (canService(x, owner, side) === 'no' ? 1 : 0);
      return (rank(a) - rank(b)) || (a.dist - b.dist);
    })
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
              <th style={{ ...th, width: 130 }}>COORD</th>
              <th style={{ ...th, width: 70 }}>RWY</th>
              <th style={{ ...th, width: 80 }}>TWR</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...cell, fontWeight: 600 }}>{home.name}</td>
              <td style={{ ...cell, fontFamily: "'B612 Mono', monospace", fontSize: coordFormat === 'mgrs' ? 15 : 13, textAlign: 'center' }}>
                {formatCoord(home.lat, home.lon, coordFormat, 3)}
              </td>
              {/* Was two hardcoded dashes. The theater record for this field
                  carries both, so print them. */}
              <td style={{ ...cell, textAlign: 'center', fontFamily: "'B612 Mono', monospace", fontSize: 15 }}>
                {rwyLabel(home)}
              </td>
              <td style={{ ...cell, textAlign: 'center', fontFamily: "'B612 Mono', monospace", fontSize: 15 }}>
                {twrLabel(home)}
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 13, color: DIM, padding: '6px 0 10px' }}>
          No departure airbase identified. Place first waypoint at an airfield.
        </div>
      )}

      {/* Divert options */}
      <div style={sectionTitle}>
        DIVERT OPTIONS ({diverts.length}) — BRG/DIST FROM HOME PLATE
      </div>
      {/* tableLayout:'fixed' — with auto layout a long field name ("Luostari
          Pechenga (XLML)") forced the table 43px wider than the 600px card,
          pushing the SVC column off the printed page. */}
      <table style={{ width: '100%', borderCollapse: 'collapse', flexShrink: 0, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>FIELD</th>
            <th style={{ ...th, width: 50 }}>BRG</th>
            <th style={{ ...th, width: 50 }}>DIST</th>
            <th style={{ ...th, width: 92 }}>{coordFormat === 'mgrs' ? 'MGRS' : 'LAT/LON'}</th>
            <th style={{ ...th, width: 56 }}>RWY</th>
            <th style={{ ...th, width: 62 }}>TWR</th>
            <th style={{ ...th, width: 34 }} title="Runway present — can take fixed wing">SVC</th>
          </tr>
        </thead>
        <tbody>
          {diverts.map((a, i) => (
            <tr key={a.name} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
              <td style={{ ...cell, fontWeight: 600, overflow: 'hidden',
                           textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</td>
              <td style={{ ...cell, textAlign: 'center', fontFamily: "'B612 Mono', monospace" }}>
                {Math.round(a.brg).toString().padStart(3, '0')}°
              </td>
              <td style={{ ...cell, textAlign: 'center', fontFamily: "'B612 Mono', monospace" }}>
                {a.dist < 1 ? '<1' : Math.round(a.dist)} nm
              </td>
              <td style={{ ...cell, fontFamily: "'B612 Mono', monospace", fontSize: coordFormat === 'mgrs' ? 14 : 12, textAlign: 'center' }}>
                {formatCoord(a.lat, a.lon, coordFormat, 3)}
              </td>
              {/* Runway headings, tower and services come straight from the
                  theater airfield data. The card used to print a dead "—" here
                  and a strip telling the pilot to fill RWY/ILS in by hand from
                  the SOP — data the app already had. */}
              <td style={{ ...cell, textAlign: 'center', fontFamily: "'B612 Mono', monospace", fontSize: 14 }}>
                {rwyLabel(a)}
              </td>
              <td style={{ ...cell, textAlign: 'center', fontFamily: "'B612 Mono', monospace", fontSize: 14 }}>
                {twrLabel(a)}
              </td>
              <td style={{ ...cell, textAlign: 'center',
                           color: USE_MARK[canService(a, owner, side)].color, fontWeight: 700 }}>
                {USE_MARK[canService(a, owner, side)].glyph}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ padding: '8px 0 0', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ fontSize: 14, color: TEXT_MUTED, marginBottom: 2 }}>
          SVC: ✔ friendly field, fuel + rearm available · ✖ enemy-held or dry ·
          ? ownership not set in mission. TWR in MHz.
        </div>
        <div style={notesBox} />
      </div>

      <div style={footerStyle}>Generated by DCS:OPT | VMFA-224(AW)</div>
    </div>
  );
}
