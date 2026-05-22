/**
 * Comms Card — per-flight kneeboard card.
 * Shows radio frequency, modulation, and mission phase flow based on waypoint actions.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, BORDER_MED, TEXT, DIM, ACCENT, ROW_ALT, footerStyle, notesBox, MissionDateLine } from './cardStyles';
import type { MissionGroup, MissionOverviewData } from '../types/mission';
import { getAircraftType } from '../utils/groups';

interface CommsCardProps {
  group: MissionGroup;
  allGroups: MissionGroup[];
  overview?: MissionOverviewData;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
}

function formatFreq(freq: number, mod: number): string {
  return `${freq.toFixed(3)} ${mod === 0 ? 'AM' : 'FM'}`;
}

export function CommsCard({ group, allGroups, overview, notes }: CommsCardProps) {
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

      {/* Support frequencies */}
      {(tankers.length > 0 || awacs.length > 0) && (
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
              {awacs.map((g, i) => (
                <tr key={g.groupId} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell, color: ACCENT, fontWeight: 600 }}>AWACS</td>
                  <td style={cell}>{g.groupName}</td>
                  <td style={{ ...cell, textAlign: 'center' }}>{formatFreq(g.frequency, g.modulation)}</td>
                </tr>
              ))}
              {tankers.map((g, i) => (
                <tr key={g.groupId} style={{ background: (awacs.length + i) % 2 === 0 ? 'transparent' : ROW_ALT }}>
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
