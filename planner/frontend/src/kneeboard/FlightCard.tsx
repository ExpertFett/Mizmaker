/**
 * Flight Card — per-flight kneeboard card.
 * Shows callsigns, loadout summary, fuel/flare/chaff, datalink donors+team.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, TEXT, DIM, ACCENT, ROW_ALT, WARN, footerStyle, notesBox, MissionDateLine } from './cardStyles';
import type { MissionGroup, ClientUnit, DonorInfo, MissionOverviewData } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { assignFlightLaserCodes, DEFAULT_LASER_BASE } from '../sop/flightLaserCodes';
import { getAircraftPerf, computeJokerBingo } from './fuelModel';
import { DEFAULT_OPTIONS, type KneeboardOptions } from './options';

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
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
  /** Per-flight fuel override (absolute lbs), shared with the Fuel Ladder
   *  card so both cards show the same numbers. (v1.19.109) */
  fuelOverride?: { start?: number; joker?: number; bingo?: number };
  /** Per-flight Flight-Data overrides — fill TACAN / ICLS / IFF codes on the
   *  card. (v1.19.109) */
  flightDataOverride?: { tacan?: string; icls?: string; iffM1?: string; iffM3?: string };
}

/** "SPRINGFIELD11 (03431)" — a datalink member with its L16 track number.
 *  Falls back to the bare name when the referenced unit carries no STN. */
function withStn(m: DonorInfo, units: ClientUnit[]): string {
  const stn = units.find((u) => u.unitId === m.missionUnitId)?.stnL16;
  return stn ? `${m.name} (${stn})` : m.name;
}

export function FlightCard({ group, clientUnits, overview, highlightUnitId, notes, fuelOverride, flightDataOverride, laserCodeBase, opts = DEFAULT_OPTIONS }: FlightCardProps) {
  const airframe = getAircraftType(group);
  const flightUnits = clientUnits.filter((cu) => cu.groupName === group.groupName);

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
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Flight-level NAV/COMMS data — TACAN + ICLS pulled from the .miz,
          IFF Mode codes left as edit placeholders (DCS doesn't expose IFF
          settings in the mission Lua; pilots set them in cockpit per SOP). */}
      <div style={sectionTitle}>FLIGHT DATA</div>
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
      <div style={sectionTitle}>CREW</div>
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
              <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>{i + 1}</td>
              <td style={{ ...cell, fontWeight: 600 }}>
                {cu.voiceCallsignLabel} {cu.voiceCallsignNumber}
              </td>
              <td style={{ ...cell, textAlign: 'center', color: DIM }}>{cu.stnL16 || '—'}</td>
              {/* Every jet gets a code, not just the ones with something
                  laser-guided aboard — a clean jet may still be asked to
                  buddy-lase, and needs a briefed, deconflicted code to do it.
                  Loaded codes show bright, briefing assignments dim. */}
              <td style={{ ...cell, textAlign: 'center',
                           color: cu.laserCode != null ? WARN : DIM }}>
                {laserCodes.get(cu.unitId) ?? '—'}
              </td>
              <td style={{ ...cell, fontSize: 17, color: isHighlighted ? '#ccdae8' : DIM }}>{cu.name}</td>
            </tr>
            );
          })}
        </tbody>
      </table>

      {/* Stores summary */}
      {rep && (
        <>
          <div style={sectionTitle}>STORES</div>
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
          <div style={sectionTitle}>LOADOUT</div>
          {/* One line per station used to be one ROW per station, which put a
              fully loaded Hornet 171px past the bottom of the card. The
              Station Loadout card carries the stores drawn on the airframe;
              this only needs to say what is where. */}
          {/* Flex-wrap rather than inline spans: each station is nowrap so a
              store name never splits across lines, and the row needs a break
              opportunity BETWEEN them or a nine-station Hornet runs off the
              right edge. */}
          <div style={{
            padding: '4px 16px', fontSize: 16, color: TEXT, lineHeight: 1.45,
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
            <div style={{ padding: '4px 16px', fontSize: 17, color: DIM, borderBottom: `1px solid ${BORDER}` }}>
              {weaponSummary.map((w) => `${w.count}x ${w.name}`).join(' | ')}
            </div>
          )}
        </>
      )}

      {/* Datalink — donors and team carry their STN alongside the callsign.
          A name alone is not usable in the cockpit: the L16 track number is
          what actually gets dialled, and the mission already carries it on
          every unit (stnL16), so look it up rather than making the crew
          cross-reference the crew table. */}
      {rep && rep.hasDatalinks && (rep.donors || rep.teamMembers) && (
        <>
          <div style={sectionTitle}>DATALINK</div>
          <div style={{ padding: '4px 16px', fontSize: 17 }}>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: DIM }}>OWN STN: </span>
              <span style={{ color: rep.stnL16 ? ACCENT : DIM, fontWeight: 600 }}>
                {rep.stnL16 || '—'}
              </span>
            </div>
            {(rep.donors ?? []).length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: DIM }}>DONORS: </span>
                {(rep.donors ?? []).map((d) => withStn(d, clientUnits)).join(', ')}
              </div>
            )}
            {(rep.teamMembers ?? []).length > 0 && (
              <div>
                <span style={{ color: DIM }}>TEAM: </span>
                {(rep.teamMembers ?? []).map((t) => withStn(t, clientUnits)).join(', ')}
              </div>
            )}
          </div>
        </>
      )}

      {/* TOLD — Takeoff & Landing Data */}
      {rep && (
        <>
          <div style={sectionTitle}>TOLD</div>
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

      {/* Notes */}
      <div style={{ padding: '6px 0 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 17, color: DIM, marginBottom: 2, fontWeight: 600 }}>NOTES</div>
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
