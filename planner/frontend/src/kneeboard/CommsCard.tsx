/**
 * Comms Card — per-flight kneeboard card.
 * Shows radio frequency, modulation, and mission phase flow based on waypoint actions.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, TEXT, DIM, ACCENT, ROW_ALT, footerStyle } from './cardStyles';
import type { MissionGroup } from '../types/mission';
import { getAircraftType } from '../utils/groups';

interface CommsCardProps {
  group: MissionGroup;
  allGroups: MissionGroup[];
}

function formatFreq(freq: number, mod: number): string {
  return `${freq.toFixed(3)} ${mod === 0 ? 'AM' : 'FM'}`;
}

export function CommsCard({ group, allGroups }: CommsCardProps) {
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

  // Separate support assets
  const tankers = coalitionGroups.filter((g) => (g.task || '').toLowerCase() === 'refueling');
  const awacs = coalitionGroups.filter((g) => (g.task || '').toLowerCase() === 'awacs');
  const flights = coalitionGroups.filter((g) =>
    (g.task || '').toLowerCase() !== 'refueling' &&
    (g.task || '').toLowerCase() !== 'awacs' &&
    g.category === 'plane',
  );

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>COMMS CARD — {group.groupName.toUpperCase()}</div>
        <div style={subtitleStyle}>
          {airframe} | Primary: {formatFreq(group.frequency, group.modulation)}
        </div>
      </div>

      {/* Primary frequency */}
      <div style={sectionTitle}>FLIGHT FREQUENCY</div>
      <div style={{ padding: '6px 16px', fontSize: 14, fontWeight: 700, color: ACCENT, borderBottom: `1px solid ${BORDER}` }}>
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

      {/* Other flights — cap at 20 rows to prevent overflow */}
      {flights.length > 1 && (
        <>
          <div style={sectionTitle}>FLIGHT FREQUENCIES</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>FLIGHT</th>
                <th style={{ ...th, width: 80 }}>TASK</th>
                <th style={{ ...th, width: 120 }}>FREQ</th>
              </tr>
            </thead>
            <tbody>
              {flights.slice(0, 20).map((g, i) => (
                <tr key={g.groupId} style={{
                  background: g.groupId === group.groupId ? 'rgba(74, 143, 212, 0.12)' : i % 2 === 0 ? 'transparent' : ROW_ALT,
                }}>
                  <td style={{ ...cell, fontWeight: g.groupId === group.groupId ? 600 : 400, fontSize: 9, padding: '2px 6px' }}>
                    {g.groupName}{g.groupId === group.groupId ? ' *' : ''}
                  </td>
                  <td style={{ ...cell, textAlign: 'center', fontSize: 8, color: DIM, padding: '2px 6px' }}>{g.task || '—'}</td>
                  <td style={{ ...cell, textAlign: 'center', fontSize: 9, padding: '2px 6px' }}>{formatFreq(g.frequency, g.modulation)}</td>
                </tr>
              ))}
              {flights.length > 20 && (
                <tr>
                  <td colSpan={3} style={{ ...cell, textAlign: 'center', fontSize: 8, color: DIM, padding: '2px 6px' }}>
                    +{flights.length - 20} more flights
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* Mission flow */}
      <div style={sectionTitle}>MISSION FLOW</div>
      <div style={{ padding: '4px 16px 6px', fontSize: 10, color: DIM }}>
        {phases.map((p, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: ACCENT }}> → </span>}
            <span style={{ color: TEXT }}>{p.name || p.phase}</span>
          </span>
        ))}
      </div>

      {/* Notes — reduced to fit */}
      <div style={{ padding: '4px 16px 20px' }}>
        <div style={{ fontSize: 10, color: DIM, marginBottom: 3 }}>NOTES:</div>
        {[...Array(3)].map((_, i) => (
          <div key={i} style={{ borderBottom: `1px solid ${BORDER}`, height: 14, marginBottom: 3 }} />
        ))}
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}
