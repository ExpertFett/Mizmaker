/**
 * Comms Card — per-flight kneeboard card.
 * Shows radio frequency, modulation, and mission phase flow based on waypoint actions.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, BORDER_MED, TEXT, DIM, ACCENT, ROW_ALT, footerStyle, notesBox, MissionDateLine } from './cardStyles';
import type { MissionGroup, MissionOverviewData, Airbase } from '../types/mission';
import { getAircraftType } from '../utils/groups';

/** Nautical miles between two lat/lon points. */
function nmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3440.065;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const CARRIER_RE = /CVN|CV_|LHA|LHD|Stennis|Forrestal|Kuznetsov/i;

interface CommsCardProps {
  group: MissionGroup;
  allGroups: MissionGroup[];
  overview?: MissionOverviewData;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
  /** Theater airfields — used to resolve the recovery field's tower/approach
   *  frequencies and runway. Optional so existing call sites keep working. */
  airbases?: Airbase[];
  /** Active SOP comm plan. Any entry whose role reads as a command / strike /
   *  check-in net is surfaced under COMMAND. */
  sopComms?: { role: string; frequency: number }[];
}

function formatFreq(freq: number, mod: number): string {
  return `${freq.toFixed(3)} ${mod === 0 ? 'AM' : 'FM'}`;
}

export function CommsCard({ group, allGroups, overview, notes, airbases = [], sopComms = [] }: CommsCardProps) {
  const airframe = getAircraftType(group);

  // Build mission phase flow from waypoint actions
  const phases = group.waypoints
    .filter((wp) => wp.waypoint_action || wp.waypoint_type)
    .map((wp) => {
      let phase = '';
      const action = (wp.waypoint_action || '').toLowerCase();
      const type = (wp.waypoint_type || '').toLowerCase();
      if (action.includes('parking') || action.includes('from runway')) phase = 'DEPARTURE';
      else if (action.includes('to runway') || type.includes('landing')) phase = 'RECOVERY';
      else if (wp.waypoint_name?.toUpperCase().includes('IP')) phase = 'IP';
      else if (wp.waypoint_name?.toUpperCase().includes('TGT')) phase = 'TARGET';
      else phase = `WP${wp.waypoint_number}`;
      return { wp: wp.waypoint_number, name: wp.waypoint_name || phase, phase };
    });

  // Collect all known frequencies from groups in same coalition
  const coalitionGroups = allGroups.filter((g) => g.coalition === group.coalition && g.frequency > 0);

  // Separate support assets — flights list intentionally not derived
  // anymore: per-flight freqs were removed from this card (overflow
  // fix). AWACS + tanker support is the only thing rendered.
  const tankers = coalitionGroups.filter((g) => (g.task || '').toLowerCase() === 'refueling');
  const awacs = coalitionGroups.filter((g) => (g.task || '').toLowerCase() === 'awacs');

  // COMMAND net — whatever the SOP calls the C2 / strike / check-in frequency.
  // Derived, never invented: if the SOP does not define one the section simply
  // carries the controlling agency (AWACS) and nothing else.
  const commandNets = sopComms.filter((c) =>
    /command|strike|check.?in|c2|control/i.test(c.role || ''));

  // RECOVERY — the boat or the field this flight actually operates from.
  // Resolved from the first waypoint: a carrier within 10 NM means it is a
  // deck launch, otherwise fall back to the nearest airfield.
  const start = group.waypoints?.find((w) => w.lat != null && w.lon != null);
  let carrier: MissionGroup | null = null;
  let field: Airbase | null = null;
  if (start?.lat != null && start.lon != null) {
    let best = Infinity;
    for (const g of allGroups) {
      if (g.coalition !== group.coalition || g.category !== 'ship') continue;
      if (!(g.units || []).some((u) => CARRIER_RE.test(u.type || ''))) continue;
      const u = (g.units || [])[0];
      if (u?.lat == null || u?.lon == null) continue;
      const d = nmBetween(start.lat, start.lon, u.lat, u.lon);
      if (d < best) { best = d; carrier = g; }
    }
    if (best > 10) carrier = null;
    if (!carrier) {
      let bestAb = Infinity;
      for (const ab of airbases) {
        if (ab.lat == null || ab.lon == null) continue;
        const d = nmBetween(start.lat, start.lon, ab.lat, ab.lon);
        if (d < bestAb) { bestAb = d; field = ab; }
      }
      if (bestAb > 25) field = null;
    }
  }

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>COMMS CARD — {group.groupName.toUpperCase()}</div>
        <div style={subtitleStyle}>
          {airframe} | Primary: {formatFreq(group.frequency, group.modulation)}
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Primary frequency */}
      <div style={sectionTitle}>FLIGHT FREQUENCY</div>
      <div style={{ padding: '6px 16px', fontSize: 19, fontWeight: 700, color: ACCENT, borderBottom: `1px solid ${BORDER}` }}>
        {formatFreq(group.frequency, group.modulation)}
      </div>

      {/* COMMAND — the controlling agency and, when the SOP names one, the
          strike / command net. Kept above SUPPORT: it is who you check in
          with, not who you take gas from. */}
      {(awacs.length > 0 || commandNets.length > 0) && (
        <>
          <div style={sectionTitle}>COMMAND</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {commandNets.map((c, i) => (
                <tr key={`cmd-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell, color: ACCENT, fontWeight: 600, width: 110 }}>
                    {c.role.toUpperCase()}
                  </td>
                  <td style={cell} />
                  <td style={{ ...cell, textAlign: 'center', width: 120, fontWeight: 600 }}>
                    {c.frequency.toFixed(3)}
                  </td>
                </tr>
              ))}
              {awacs.map((g, i) => (
                <tr key={g.groupId} style={{ background: (commandNets.length + i) % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell, color: ACCENT, fontWeight: 600, width: 110 }}>AWACS</td>
                  <td style={cell}>{g.groupName}</td>
                  <td style={{ ...cell, textAlign: 'center', width: 120 }}>
                    {formatFreq(g.frequency, g.modulation)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* RECOVERY — the boat or field this flight launches from and comes back
          to, with the numbers you actually dial: TACAN/ICLS for a deck, tower
          and runway for a field. Resolved from the first waypoint. */}
      {(carrier || field) && (
        <>
          <div style={sectionTitle}>RECOVERY</div>
          <div style={{ padding: '5px 16px', borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: ACCENT, marginBottom: 3 }}>
              {carrier ? carrier.groupName.toUpperCase() : (field?.name || '').toUpperCase()}
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 16 }}>
              {carrier ? (
                <>
                  <span>
                    <span style={{ color: DIM }}>TACAN </span>
                    <span style={{ color: TEXT, fontWeight: 600 }}>
                      {carrier.tacan
                        ? `${carrier.tacan.channel}${carrier.tacan.band}` +
                          (carrier.tacan.callsign ? ` (${carrier.tacan.callsign})` : '')
                        : '—'}
                    </span>
                  </span>
                  <span>
                    <span style={{ color: DIM }}>ICLS </span>
                    <span style={{ color: TEXT, fontWeight: 600 }}>
                      {carrier.icls?.channel ?? '—'}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <span style={{ color: DIM }}>TOWER </span>
                    <span style={{ color: TEXT, fontWeight: 600 }}>
                      {field?.atc_radio?.uhf_mhz
                        ? field.atc_radio.uhf_mhz.toFixed(3)
                        : field?.atc_radio?.vhf_high_mhz
                          ? field.atc_radio.vhf_high_mhz.toFixed(3)
                          : '—'}
                    </span>
                  </span>
                  {field?.atc_radio?.vhf_high_mhz != null && field?.atc_radio?.uhf_mhz != null && (
                    <span>
                      <span style={{ color: DIM }}>VHF </span>
                      <span style={{ color: TEXT, fontWeight: 600 }}>
                        {field.atc_radio.vhf_high_mhz.toFixed(3)}
                      </span>
                    </span>
                  )}
                  <span>
                    <span style={{ color: DIM }}>RWY </span>
                    <span style={{ color: TEXT, fontWeight: 600 }}>
                      {field?.runways?.length ? field.runways.map((r) => r.name).join(' / ') : '—'}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Support frequencies */}
      {tankers.length > 0 && (
        <>
          <div style={sectionTitle}>SUPPORT</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', width: 80 }}>ROLE</th>
                <th style={{ ...th, textAlign: 'left' }}>CALLSIGN</th>
                <th style={{ ...th, width: 120 }}>FREQ</th>
              </tr>
            </thead>
            <tbody>
              {tankers.map((g, i) => (
                <tr key={g.groupId} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell, color: ACCENT, fontWeight: 600 }}>TANKER</td>
                  <td style={cell}>{g.groupName}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>{formatFreq(g.frequency, g.modulation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Per-flight frequency list intentionally removed — was the cause
          of the 'comms card overflowing the bottom' feedback. Per Fett:
          'we don't need each jet's freq, unless stated otherwise'. The
          per-flight presets live on the editor's Radio Presets section
          (and on each per-flight brief card), not on the shared
          kneeboard. AWACS + tanker support is enough here. */}

      {/* Mission flow */}
      <div style={sectionTitle}>MISSION FLOW</div>
      <div style={{ padding: '6px 16px', fontSize: 17, color: DIM }}>
        {phases.map((p, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: ACCENT }}> → </span>}
            <span style={{ color: TEXT }}>{p.name || p.phase}</span>
          </span>
        ))}
      </div>

      {/* Notes */}
      <div style={sectionTitle}>NOTES</div>
      <div style={notesBox}>
        {notes && notes.trim() ? (
          <div style={{
            fontSize: 17, color: TEXT,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
          }}>
            {notes.trim()}
          </div>
        ) : (
          [...Array(5)].map((_, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${BORDER_MED}`, height: 20, marginBottom: 4 }} />
          ))
        )}
      </div>

      <div style={footerStyle}>Generated by DCS:OPT | VMFA-224(AW)</div>
    </div>
  );
}
