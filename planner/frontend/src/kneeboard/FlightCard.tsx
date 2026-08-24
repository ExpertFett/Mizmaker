/**
 * Flight Card — per-flight kneeboard card.
 *
 * v1.19.136 — absorbed the Route Card (Fett: "cards 1 and 2 could really be
 * compacted to 1 card and lose the notes"). One page now carries the route
 * table (capped rows), flight data, crew, stores, datalink, and TOLD; the
 * five-row weather table collapsed into the single METAR line, and the NOTES
 * box only renders when the planner actually typed notes.
 */

import { forward as toMGRS } from 'mgrs';
import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, TEXT, DIM, ACCENT, ROW_ALT, WARN, footerStyle, notesBox, MissionDateLine } from './cardStyles';
import type { MissionGroup, ClientUnit, DonorInfo, MissionOverviewData, Waypoint } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { assignFlightLaserCodes, DEFAULT_LASER_BASE } from '../sop/flightLaserCodes';
import { getAircraftPerf, computeJokerBingo } from './fuelModel';
import { DEFAULT_OPTIONS, type KneeboardOptions } from './options';
import { metersToFeet, msToKnots } from '../utils/conversions';
import { convertSpeed, type Weather, type SpeedMode } from '../utils/atmosphere';
import { generateMetar } from '../utils/metar';

export type KneeboardSpeedRef = SpeedMode | 'auto';

/** Route rows the page can hold alongside the flight data. More waypoints
 *  than this get a "+N more" row — the Route Detail / Strip Map cards carry
 *  the full route. */
const MAX_ROUTE_ROWS = 10;

interface FlightCardProps {
  group: MissionGroup;
  clientUnits: ClientUnit[];
  /** SOP laser ladder start, for the per-aircrew codes. */
  laserCodeBase?: number;
  /** Flight lead controls — fuel rules. */
  opts?: KneeboardOptions;
  overview?: MissionOverviewData;
  /** When set, highlight this pilot's row in the crew roster. */
  highlightUnitId?: number;
  /** Planner-typed notes — the box renders only when non-empty. (v1.19.136) */
  notes?: string;
  /** Per-flight fuel override (absolute lbs), shared with the Fuel Ladder
   *  card so both cards show the same numbers. (v1.19.109) */
  fuelOverride?: { start?: number; joker?: number; bingo?: number };
  /** Per-flight Flight-Data overrides — fill TACAN / ICLS / IFF codes on the
   *  card. (v1.19.109) */
  flightDataOverride?: { tacan?: string; icls?: string; iffM1?: string; iffM3?: string };
  /** Mission weather — drives the METAR line and CAS/TAS/Mach conversion. */
  weather?: Weather | null;
  coordFormat?: 'mgrs' | 'latlon';
  speedRef?: KneeboardSpeedRef;
  machThreshold?: number;
}

// ── Route-row formatters (compact) ─────────────────────────────────────────

function fmtCoordCell(fmt: 'mgrs' | 'latlon', lat?: number, lon?: number): string {
  if (lat == null || lon == null) return 'N/A';
  if (fmt === 'mgrs') {
    try { return toMGRS([lon, lat], 4); } catch { return 'N/A'; }
  }
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const la = Math.abs(lat), lo = Math.abs(lon);
  return `${ns}${Math.floor(la)}°${((la - Math.floor(la)) * 60).toFixed(1)}' `
       + `${ew}${Math.floor(lo)}°${((lo - Math.floor(lo)) * 60).toFixed(1)}'`;
}

function fmtAltCell(alt_m: number, alt_type: string): string {
  const ft = Math.round(metersToFeet(alt_m));
  if (ft <= 0) return 'SFC';
  return `${ft.toLocaleString()}${alt_type === 'RADIO' ? ' AGL' : ''}`;
}

function fmtSpeedCell(wp: Waypoint, mode: KneeboardSpeedRef, wx: Weather | null | undefined, machThreshold: number): string {
  if (!wp.speed_ms || wp.speed_ms <= 0) return '-';
  const resolved: SpeedMode = mode !== 'auto'
    ? mode
    : (metersToFeet(wp.altitude_m) >= machThreshold ? 'mach' : 'cas');
  if (!wx) return `${Math.round(msToKnots(wp.speed_ms))}`;
  const val = convertSpeed(wp.speed_ms, wp.altitude_m, wp.leg_bearing_deg || 0, wx, resolved);
  return resolved === 'mach' ? `M${val.toFixed(2)}` : `${Math.round(val)}`;
}

function fmtEteCell(seconds?: number): string {
  if (seconds == null || seconds <= 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${(m % 60).toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "SPRINGFIELD11 (03431)" — a datalink member with its L16 track number.
 *  Falls back to the bare name when the referenced unit carries no STN. */
function withStn(m: DonorInfo, units: ClientUnit[]): string {
  const stn = units.find((u) => u.unitId === m.missionUnitId)?.stnL16;
  return stn ? `${m.name} (${stn})` : m.name;
}

export function FlightCard({ group, clientUnits, overview, highlightUnitId, notes, fuelOverride, flightDataOverride, laserCodeBase, opts = DEFAULT_OPTIONS, weather, coordFormat = 'mgrs', speedRef = 'auto', machThreshold = 18000 }: FlightCardProps) {
  const airframe = getAircraftType(group);
  const flightUnits = clientUnits.filter((cu) => cu.groupName === group.groupName);

  // Route summary (absorbed Route Card, v1.19.136)
  const wps = group.waypoints || [];
  const routeRows = wps.slice(0, MAX_ROUTE_ROWS);
  const totalDist = wps.reduce((s, wp) => s + (wp.leg_distance_nm || 0), 0);
  const totalEta = wps.length > 0 ? (wps[wps.length - 1].cumulative_eta || 0) : 0;
  const rcell: React.CSSProperties = { ...cell, fontSize: 14, padding: '2px 6px' };
  const rth: React.CSSProperties = { ...th, fontSize: 12, padding: '2px 6px' };
  // Densest card in the set — shave the shared section-title spacing so
  // seven sections + footer stay inside the 850 px page.
  const sec: React.CSSProperties = { ...sectionTitle, fontSize: 18, margin: '0 0 2px 0', paddingBottom: 1 };
  const ccell: React.CSSProperties = { ...cell, fontSize: 16, padding: '2px 8px' };

  // Laser codes for the whole roster. Allocated across every client unit in
  // the mission so two flights are never briefed the same code.
  const laserCodes = assignFlightLaserCodes(clientUnits, laserCodeBase ?? DEFAULT_LASER_BASE);

  // Aggregate loadout across all pylons for first unit (representative)
  const rep = flightUnits[0];

  // Loadout fuel is KG in the .miz (or a 0–1 fraction of internal). Convert to
  // LBS to match the Fuel Ladder card + Loadout tab, and honour the per-flight
  // override so STORES / TOLD agree with the ladder. (v1.19.109)
  const perf = getAircraftPerf(group.units[0]?.type || '');
  const rawFuel = rep?.fuel ?? 0;
  const loadoutLbs = rawFuel <= 1 ? Math.round(rawFuel * perf.maxFuelLbs) : Math.round(rawFuel * 2.20462);
  const startFuelLbs = fuelOverride?.start ?? loadoutLbs;
  // Guard on `pylons`, not just on `rep`. A client unit whose payload carries
  // no pylons array (a mission missing payload.pylons, or loadouts not yet
  // populated) made this throw and took the WHOLE card down with it.
  const weaponSummary = rep?.pylons
    ? Object.values(
        rep.pylons.reduce((acc, p) => {
          const key = p.shortName || p.name;
          if (!acc[key]) acc[key] = { name: key, count: 0, cat: p.category };
          acc[key].count += 1;
          return acc;
        }, {} as Record<string, { name: string; count: number; cat: string }>),
      )
    : [];

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>FLIGHT CARD — {group.groupName.toUpperCase()}</div>
        <div style={subtitleStyle}>
          {airframe} | {flightUnits.length} aircraft | {group.task || 'N/A'} | {group.frequency.toFixed(3)} MHz {group.modulation === 0 ? 'AM' : 'FM'}
          {totalDist > 0 ? ` | ${totalDist.toFixed(0)} nm | ETE ${fmtEteCell(totalEta)}` : ''}
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Route — absorbed from the old Route Card. Weather rides as the METAR
          line instead of a five-row table. */}
      {routeRows.length > 1 && (
        <>
          <div style={sec}>ROUTE</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '6%' }} /><col style={{ width: '12%' }} />
              <col style={{ width: '27%' }} /><col style={{ width: '14%' }} />
              <col style={{ width: '11%' }} /><col style={{ width: '9%' }} />
              <col style={{ width: '10%' }} /><col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr>
                <th style={rth}>WP</th>
                <th style={{ ...rth, textAlign: 'left' }}>NAME</th>
                <th style={{ ...rth, textAlign: 'left' }}>COORD</th>
                <th style={rth}>ALT</th>
                <th style={rth}>SPD</th>
                <th style={rth}>HDG</th>
                <th style={rth}>DIST</th>
                <th style={rth}>ETE</th>
              </tr>
            </thead>
            <tbody>
              {routeRows.map((wp, idx) => {
                const legEta = idx > 0 && wp.cumulative_eta && routeRows[idx - 1]?.cumulative_eta
                  ? wp.cumulative_eta - routeRows[idx - 1]!.cumulative_eta!
                  : 0;
                const isWp0 = wp.waypoint_number === 0;
                return (
                  <tr key={wp.waypoint_number} style={{ background: idx % 2 === 0 ? 'transparent' : ROW_ALT }}>
                    <td style={{ ...rcell, textAlign: 'center', fontWeight: 700, color: ACCENT }}>{wp.waypoint_number}</td>
                    <td style={rcell}>{(wp.waypoint_name || '-').substring(0, 7)}</td>
                    <td style={{ ...rcell, fontSize: 13 }}>{fmtCoordCell(coordFormat, wp.lat, wp.lon)}</td>
                    <td style={{ ...rcell, textAlign: 'right' }}>{fmtAltCell(wp.altitude_m, wp.altitude_type)}</td>
                    <td style={{ ...rcell, textAlign: 'center' }}>{isWp0 ? '-' : fmtSpeedCell(wp, speedRef, weather, machThreshold)}</td>
                    <td style={{ ...rcell, textAlign: 'center', color: DIM }}>{isWp0 || wp.leg_bearing_deg == null ? '-' : `${Math.round(wp.leg_bearing_deg).toString().padStart(3, '0')}°`}</td>
                    <td style={{ ...rcell, textAlign: 'right' }}>{isWp0 || !wp.leg_distance_nm ? '-' : wp.leg_distance_nm.toFixed(1)}</td>
                    <td style={{ ...rcell, textAlign: 'right' }}>{isWp0 ? '-' : fmtEteCell(legEta)}</td>
                  </tr>
                );
              })}
              {wps.length > MAX_ROUTE_ROWS && (
                <tr>
                  <td colSpan={8} style={{ ...rcell, color: DIM }}>
                    +{wps.length - MAX_ROUTE_ROWS} more waypoints — full route on the Route Detail / Strip Map cards
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {weather && (
            <div style={{
              fontFamily: "'B612 Mono', monospace", fontSize: 13, color: DIM,
              padding: '2px 16px 3px', borderBottom: `1px solid ${BORDER}`,
            }}>
              {generateMetar(weather as never, overview?.date, overview?.start_time)}
            </div>
          )}
        </>
      )}

      {/* Flight-level NAV/COMMS data — TACAN + ICLS pulled from the .miz,
          IFF Mode codes left as edit placeholders (DCS doesn't expose IFF
          settings in the mission Lua; pilots set them in cockpit per SOP). */}
      <div style={sec}>FLIGHT DATA</div>
      <div style={{
        display: 'flex', gap: 0, flexShrink: 0,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        {(() => {
          const tacanStr = flightDataOverride?.tacan
            ? flightDataOverride.tacan
            : group.tacan
              ? `${group.tacan.channel}${group.tacan.band}` + (group.tacan.callsign ? ` (${group.tacan.callsign})` : '')
              : '—';
          const iclsStr = flightDataOverride?.icls
            ? flightDataOverride.icls
            : group.icls?.channel ? String(group.icls.channel) : '—';
          const items = [
            { label: 'TACAN',  value: tacanStr, color: (flightDataOverride?.tacan || group.tacan) ? TEXT : DIM },
            { label: 'ICLS',   value: iclsStr,  color: (flightDataOverride?.icls || group.icls) ? TEXT : DIM },
            // A dash, not "— EDIT —": the card is read in the cockpit, where an
            // instruction to the mission maker is noise. Unset reads as unset.
            { label: 'IFF M1', value: flightDataOverride?.iffM1 || '—', color: flightDataOverride?.iffM1 ? TEXT : DIM },
            { label: 'IFF M3', value: flightDataOverride?.iffM3 || '—', color: flightDataOverride?.iffM3 ? TEXT : DIM },
          ];
          return items.map(({ label, value, color }) => (
            <div key={label} style={{
              flex: 1, padding: '4px 6px',
              borderRight: `1px solid ${BORDER}`, textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: DIM, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 16, color, fontWeight: 600 }}>{value}</div>
            </div>
          ));
        })()}
      </div>

      {/* Crew roster */}
      <div style={sec}>CREW</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 30 }}>#</th>
            <th style={{ ...th, textAlign: 'left', width: 120 }}>CALLSIGN</th>
            <th style={{ ...th, width: 70 }}>STN L16</th>
            <th style={{ ...th, width: 60 }}>LASER</th>
            <th style={{ ...th, textAlign: 'left' }}>UNIT NAME</th>
          </tr>
        </thead>
        <tbody>
          {flightUnits.map((cu, i) => {
            const isHighlighted = highlightUnitId === cu.unitId;
            return (
            <tr key={cu.unitId} style={{
              background: isHighlighted ? 'rgba(74, 143, 212, 0.15)' : i % 2 === 0 ? 'transparent' : ROW_ALT,
              borderLeft: isHighlighted ? '3px solid #4a8fd4' : '3px solid transparent',
            }}>
              <td style={{ ...ccell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>{i + 1}</td>
              <td style={{ ...ccell, fontWeight: 600 }}>
                {cu.voiceCallsignLabel} {cu.voiceCallsignNumber}
              </td>
              <td style={{ ...ccell, textAlign: 'center', color: DIM }}>{cu.stnL16 || '—'}</td>
              {/* Every jet gets a code, not just the ones with something
                  laser-guided aboard — a clean jet may still be asked to
                  buddy-lase, and needs a briefed, deconflicted code to do it.
                  Loaded codes show bright, briefing assignments dim. */}
              <td style={{ ...ccell, textAlign: 'center',
                           color: cu.laserCode != null ? WARN : DIM }}>
                {laserCodes.get(cu.unitId) ?? '—'}
              </td>
              <td style={{ ...ccell, fontSize: 15, color: isHighlighted ? '#ccdae8' : DIM }}>{cu.name}</td>
            </tr>
            );
          })}
        </tbody>
      </table>

      {/* Stores summary */}
      {rep && (
        <>
          <div style={sec}>STORES</div>
          <div style={{ padding: '4px 16px', display: 'flex', gap: 24, flexWrap: 'wrap', borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 17 }}>
              <span style={{ color: DIM }}>FUEL </span>
              <span style={{ color: TEXT, fontWeight: 600 }}>{startFuelLbs.toLocaleString()} lbs</span>
            </div>
            <div style={{ fontSize: 17 }}>
              <span style={{ color: DIM }}>FL </span>
              <span style={{ color: TEXT }}>{rep.flare}</span>
            </div>
            <div style={{ fontSize: 17 }}>
              <span style={{ color: DIM }}>CH </span>
              <span style={{ color: TEXT }}>{rep.chaff}</span>
            </div>
            <div style={{ fontSize: 17 }}>
              <span style={{ color: DIM }}>GUN </span>
              <span style={{ color: TEXT }}>{rep.gun}</span>
            </div>
          </div>

          {/* Loadout */}
          <div style={sec}>LOADOUT</div>
          {/* One line per station used to be one ROW per station, which put a
              fully loaded Hornet 171px past the bottom of the card. The
              Station Loadout card carries the stores drawn on the airframe;
              this only needs to say what is where. */}
          {/* Flex-wrap rather than inline spans: each station is nowrap so a
              store name never splits across lines, and the row needs a break
              opportunity BETWEEN them or a nine-station Hornet runs off the
              right edge. */}
          <div style={{
            padding: '3px 16px', fontSize: 15, color: TEXT, lineHeight: 1.4,
            borderBottom: `1px solid ${BORDER}`,
            display: 'flex', flexWrap: 'wrap', columnGap: 10, rowGap: 1,
          }}>
            {(rep.pylons ?? []).filter((p) => p.name).map((p) => (
              <span key={p.number} style={{ whiteSpace: 'nowrap' }}>
                <span style={{ color: ACCENT, fontWeight: 600 }}>{p.number}</span>
                {' '}{p.shortName || p.name}
              </span>
            ))}
          </div>

          {/* Weapon totals */}
          {weaponSummary.length > 0 && (
            <div style={{ padding: '3px 16px', fontSize: 15, color: DIM, borderBottom: `1px solid ${BORDER}` }}>
              {weaponSummary.map((w) => `${w.count}x ${w.name}`).join(' | ')}
            </div>
          )}
        </>
      )}

      {/* TOLD — Takeoff & Landing Data. Renders BEFORE datalink: fuel
          numbers must never be the section that falls off the page bottom
          on a crowded card. (v1.19.136) */}
      {rep && (
        <>
          <div style={sec}>TOLD</div>
          <div style={{ display: 'flex', gap: 0, flexShrink: 0, borderBottom: `1px solid ${BORDER}` }}>
            {(() => {
              const fuel = startFuelLbs;
              const storesEst = 2000;
              // Per-type empty weight (was hardcoded to the Hornet's 25,640 lb,
              // so an F-14/F-16 flight showed a Hornet gross weight). P2.
              const emptyWt = perf.emptyLbs;
              const grossWt = emptyWt + fuel + storesEst;
              // Same floored numbers the Fuel Ladder shows.
              const { joker, bingo } = computeJokerBingo(fuel, fuelOverride, opts.fuel);
              const items = [
                { label: 'GROSS WT', value: `${Math.round(grossWt).toLocaleString()} lbs`, color: TEXT },
                { label: 'T/O FUEL', value: `${Math.round(fuel).toLocaleString()} lbs`, color: TEXT },
                { label: 'JOKER', value: `${joker.toLocaleString()} lbs`, color: WARN },
                { label: 'BINGO', value: `${bingo.toLocaleString()} lbs`, color: '#d95050' },
              ];
              return items.map(({ label, value, color }) => (
                <div key={label} style={{
                  flex: 1,
                  padding: '4px 6px',
                  borderRight: `1px solid ${BORDER}`,
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 11, color: DIM, fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 17, color, fontWeight: 700 }}>{value}</div>
                </div>
              ));
            })()}
          </div>
        </>
      )}

      {/* Datalink — compact: donors/team capped at three entries with a
          "+N" tail so a 4-ship's four long unit names can't wrap three deep
          and push content off the page. Each entry still carries its STN —
          the number the crew actually dials. */}
      {rep && rep.hasDatalinks && (rep.donors || rep.teamMembers) && (
        <>
          <div style={sec}>DATALINK</div>
          <div style={{ padding: '3px 16px', fontSize: 15, lineHeight: 1.4 }}>
            <span style={{ color: DIM }}>OWN STN </span>
            <span style={{ color: rep.stnL16 ? ACCENT : DIM, fontWeight: 600 }}>
              {rep.stnL16 || '—'}
            </span>
            {(rep.donors ?? []).length > 0 && (
              <>
                <span style={{ color: DIM }}>{'   DONORS '}</span>
                {(rep.donors ?? []).slice(0, 3).map((d) => withStn(d, clientUnits)).join(', ')}
                {(rep.donors ?? []).length > 3 ? ` +${(rep.donors ?? []).length - 3}` : ''}
              </>
            )}
            {(rep.teamMembers ?? []).length > 0 && (
              <>
                <span style={{ color: DIM }}>{'   TEAM '}</span>
                {(rep.teamMembers ?? []).slice(0, 3).map((t) => withStn(t, clientUnits)).join(', ')}
                {(rep.teamMembers ?? []).length > 3 ? ` +${(rep.teamMembers ?? []).length - 3}` : ''}
              </>
            )}
          </div>
        </>
      )}

      {/* Notes only when the planner typed some — no empty gray box eating
          the page. (v1.19.136) */}
      {notes && notes.trim() && (
        <div style={{ padding: '6px 0 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 17, color: DIM, marginBottom: 2, fontWeight: 600 }}>NOTES</div>
          <div style={notesBox}>
            <div style={{
              fontSize: 17, color: TEXT,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
            }}>
              {notes.trim()}
            </div>
          </div>
        </div>
      )}
      <div style={{ flex: 1 }} />

      <div style={footerStyle}>Generated by DCS:OPT | VMFA-224(AW)</div>
    </div>
  );
}
