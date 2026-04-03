/**
 * Fuel Ladder Card — per-flight kneeboard card.
 * Shows fuel burn estimate per leg with running total.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, TEXT, DIM, ACCENT, ROW_ALT, WARN, footerStyle } from './cardStyles';
import type { MissionGroup, ClientUnit } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { metersToFeet, msToKnots } from '../utils/conversions';

interface FuelLadderCardProps {
  group: MissionGroup;
  clientUnits: ClientUnit[];
}

// Very rough fuel flow estimates (lbs/hr) by category — users can refine
const FUEL_FLOW_ESTIMATE: Record<string, number> = {
  'FA-18C_hornet': 4800,
  'F-14A-135-GR': 6000,
  'F-14B': 6000,
  'F-16C_50': 4200,
  'F-15ESE': 5500,
  'A-10C': 2400,
  'A-10C_2': 2400,
  'AV8BNA': 3200,
  'F-15C': 5000,
};
const DEFAULT_FLOW = 4500;

export function FuelLadderCard({ group, clientUnits }: FuelLadderCardProps) {
  const airframe = getAircraftType(group);
  const wps = group.waypoints;
  const rep = clientUnits.find((cu) => cu.groupName === group.groupName);
  const startFuel = rep?.fuel || 0;
  const flowRate = FUEL_FLOW_ESTIMATE[group.units[0]?.type] || DEFAULT_FLOW;

  // Compute fuel at each waypoint
  const legs: { wp: number; name: string; dist: number; ete: number; burn: number; remaining: number }[] = [];
  let fuel = startFuel;
  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i];
    const prevEta = i > 0 ? (wps[i - 1].cumulative_eta || 0) : 0;
    const legEta = (wp.cumulative_eta || 0) - prevEta;
    const legHours = legEta / 3600;
    const burn = i === 0 ? 0 : Math.round(flowRate * legHours);
    fuel = Math.max(0, fuel - burn);
    legs.push({
      wp: wp.waypoint_number,
      name: (wp.waypoint_name || '').substring(0, 8),
      dist: wp.leg_distance_nm || 0,
      ete: legEta,
      burn,
      remaining: fuel,
    });
  }

  const totalBurn = startFuel - fuel;
  const jokerFuel = Math.round(startFuel * 0.35);
  const bingoFuel = Math.round(startFuel * 0.2);

  function fmtEte(s: number): string {
    if (s <= 0) return '—';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>FUEL LADDER — {group.groupName.toUpperCase()}</div>
        <div style={subtitleStyle}>
          {airframe} | Start: {startFuel.toLocaleString()} lbs | Flow: ~{flowRate.toLocaleString()} lbs/hr
        </div>
      </div>

      {/* Key fuel marks */}
      <div style={{ display: 'flex', gap: 24, padding: '6px 16px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 10 }}>
          <span style={{ color: DIM }}>START </span>
          <span style={{ color: TEXT, fontWeight: 600 }}>{startFuel.toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 10 }}>
          <span style={{ color: WARN }}>JOKER </span>
          <span style={{ color: WARN, fontWeight: 600 }}>{jokerFuel.toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 10 }}>
          <span style={{ color: '#d95050' }}>BINGO </span>
          <span style={{ color: '#d95050', fontWeight: 600 }}>{bingoFuel.toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 10 }}>
          <span style={{ color: DIM }}>TOTAL BURN </span>
          <span style={{ color: TEXT }}>{totalBurn.toLocaleString()}</span>
        </div>
      </div>

      {/* Fuel ladder table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 32 }}>WP</th>
            <th style={{ ...th, textAlign: 'left', width: 70 }}>NAME</th>
            <th style={{ ...th, width: 50 }}>DIST</th>
            <th style={{ ...th, width: 50 }}>ETE</th>
            <th style={{ ...th, width: 70 }}>BURN</th>
            <th style={{ ...th, width: 90 }}>REMAINING</th>
            <th style={th}>GAUGE</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg, i) => {
            const pct = startFuel > 0 ? leg.remaining / startFuel : 0;
            const barColor = leg.remaining <= bingoFuel ? '#d95050' : leg.remaining <= jokerFuel ? WARN : ACCENT;
            return (
              <tr key={leg.wp} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>{leg.wp}</td>
                <td style={{ ...cell, fontSize: 9 }}>{leg.name}</td>
                <td style={{ ...cell, textAlign: 'right', fontSize: 9 }}>{leg.dist > 0 ? leg.dist.toFixed(1) : '—'}</td>
                <td style={{ ...cell, textAlign: 'right', fontSize: 9 }}>{fmtEte(leg.ete)}</td>
                <td style={{ ...cell, textAlign: 'right', fontSize: 9 }}>{leg.burn > 0 ? `-${leg.burn.toLocaleString()}` : '—'}</td>
                <td style={{
                  ...cell,
                  textAlign: 'right',
                  fontWeight: 600,
                  color: leg.remaining <= bingoFuel ? '#d95050' : leg.remaining <= jokerFuel ? WARN : TEXT,
                }}>
                  {leg.remaining.toLocaleString()}
                </td>
                <td style={{ ...cell, padding: '3px 8px' }}>
                  <div style={{ width: '100%', height: 8, background: '#0a0f18', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: barColor, borderRadius: 2 }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Notes */}
      <div style={{ padding: '8px 16px' }}>
        <div style={{ fontSize: 9, color: DIM, marginBottom: 6 }}>
          * Fuel burn is estimated at cruise flow rate. Actual consumption varies with altitude, speed, and configuration.
        </div>
        <div style={{ fontSize: 10, color: DIM, marginBottom: 4 }}>NOTES:</div>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ borderBottom: `1px solid ${BORDER}`, height: 16, marginBottom: 4 }} />
        ))}
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}
