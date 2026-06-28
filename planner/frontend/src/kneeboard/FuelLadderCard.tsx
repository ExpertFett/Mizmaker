/**
 * Fuel Ladder Card — per-flight kneeboard card.
 *
 * Uses physics-based fuel flow model with DCS engine data to estimate
 * fuel burn per leg based on altitude, speed, and aircraft weight.
 * Shows running fuel total with joker/bingo marks and visual gauges.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, footerStyle, notesBox, BORDER, TEXT, TEXT_BRIGHT, DIM, ACCENT, ROW_ALT, WARN, MissionDateLine } from './cardStyles';
import type { MissionGroup, ClientUnit, MissionOverviewData } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { metersToFeet, msToKnots } from '../utils/conversions';
import { estimateFuelFlow, getAircraftPerf } from './fuelModel';

interface FuelLadderCardProps {
  group: MissionGroup;
  clientUnits: ClientUnit[];
  overview?: MissionOverviewData;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
  /** Per-flight manual overrides (absolute LBS). Any set field wins over
   *  the loadout-derived / percentage defaults. (v1.19.108) */
  fuelOverride?: { start?: number; joker?: number; bingo?: number };
}

export function FuelLadderCard({ group, clientUnits, overview, notes, fuelOverride }: FuelLadderCardProps) {
  const airframe = getAircraftType(group);
  const unitType = group.units[0]?.type || '';
  const wps = group.waypoints;
  const rep = clientUnits.find((cu) => cu.groupName === group.groupName);

  // Per-type perf from the DB (empty weight + max internal fuel), falling
  // back to a default for unknown airframes. (Pre-beta audit P2.)
  const perf = getAircraftPerf(unitType);
  const emptyLbs = perf.emptyLbs;

  // DCS stores loadout fuel as KG (absolute) — or, in some older / normalised
  // missions, as a 0–1 fraction of max internal. Convert to LBS so the card
  // matches the Loadout tab's "≈ lb" readout and the brief's T/O fuel.
  // (v1.19.108 — previously printed the raw kg value labeled "lbs", which
  // under-read by ~2.2× and fed a wrong fuel weight into the burn model.)
  const rawFuel = rep?.fuel ?? 0;
  const loadoutLbs = rawFuel <= 1
    ? Math.round(rawFuel * perf.maxFuelLbs)   // fraction of internal capacity
    : Math.round(rawFuel * 2.20462);          // kg → lb
  const startFuel = fuelOverride?.start ?? loadoutLbs;
  const isManual = fuelOverride != null &&
    (fuelOverride.start != null || fuelOverride.joker != null || fuelOverride.bingo != null);
  // Gross weight = empty + fuel + stores (estimate stores at 2000 lbs)
  const storesEstLbs = 2000;

  // Compute fuel at each waypoint using physics model
  const legs: {
    wp: number; name: string; altFt: number; spdKts: number;
    dist: number; ete: number; burn: number; remaining: number;
    flowRate: number;
  }[] = [];

  let fuel = startFuel;
  for (let i = 0; i < wps.length; i++) {
    const wp = wps[i];
    const prevEta = i > 0 ? (wps[i - 1].cumulative_eta || 0) : 0;
    const legEta = (wp.cumulative_eta || 0) - prevEta;
    const legHours = legEta / 3600;

    const altFt = Math.round(metersToFeet(wp.altitude_m));
    const spdKts = Math.round(msToKnots(wp.speed_ms || 0));

    // Gross weight estimate: empty + fuel + stores
    const gwLbs = emptyLbs + fuel + storesEstLbs;

    // Estimate fuel flow at this leg's conditions
    const flowRate = i === 0 ? 0 : estimateFuelFlow(altFt, wp.speed_ms || 100, gwLbs, unitType);
    const burn = i === 0 ? 0 : Math.round(flowRate * legHours);

    fuel = Math.max(0, fuel - burn);
    legs.push({
      wp: wp.waypoint_number,
      name: (wp.waypoint_name || '').substring(0, 7),
      altFt,
      spdKts,
      dist: wp.leg_distance_nm || 0,
      ete: legEta,
      burn,
      remaining: fuel,
      flowRate: Math.round(flowRate),
    });
  }

  const totalBurn = startFuel - fuel;
  const jokerFuel = fuelOverride?.joker ?? Math.round(startFuel * 0.35);
  const bingoFuel = fuelOverride?.bingo ?? Math.round(startFuel * 0.2);

  function fmtEte(s: number): string {
    if (s <= 0) return '—';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // Find if/where we hit joker and bingo
  const jokerWp = legs.find((l) => l.remaining <= jokerFuel && l.remaining > 0);
  const bingoWp = legs.find((l) => l.remaining <= bingoFuel && l.remaining > 0);

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>FUEL LADDER — {group.groupName.toUpperCase()}</div>
        <div style={subtitleStyle}>
          {airframe} | Start: {startFuel.toLocaleString()} lbs | {isManual ? 'Manual fuel marks' : 'Physics-based estimate'}
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Key fuel marks */}
      <div style={{ display: 'flex', gap: 16, padding: '6px 0', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <div style={{ fontSize: 17 }}>
          <span style={{ color: DIM }}>START </span>
          <span style={{ color: TEXT_BRIGHT, fontWeight: 600 }}>{startFuel.toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 17 }}>
          <span style={{ color: WARN }}>JOKER </span>
          <span style={{ color: WARN, fontWeight: 600 }}>{jokerFuel.toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 17 }}>
          <span style={{ color: '#d95050' }}>BINGO </span>
          <span style={{ color: '#d95050', fontWeight: 600 }}>{bingoFuel.toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 17 }}>
          <span style={{ color: DIM }}>BURN </span>
          <span style={{ color: TEXT }}>{totalBurn.toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 17 }}>
          <span style={{ color: DIM }}>LAND </span>
          <span style={{
            color: fuel <= bingoFuel ? '#d95050' : fuel <= jokerFuel ? WARN : TEXT,
            fontWeight: 600,
          }}>{fuel.toLocaleString()}</span>
        </div>
      </div>

      {/* Joker/Bingo waypoint callouts */}
      {(jokerWp || bingoWp) && (
        <div style={{ display: 'flex', gap: 16, padding: '4px 0', borderBottom: `1px solid ${BORDER}`, fontSize: 17, flexShrink: 0 }}>
          {jokerWp && (
            <span style={{ color: WARN }}>JOKER at WP {jokerWp.wp} ({jokerWp.remaining.toLocaleString()} lbs)</span>
          )}
          {bingoWp && (
            <span style={{ color: '#d95050' }}>BINGO at WP {bingoWp.wp} ({bingoWp.remaining.toLocaleString()} lbs)</span>
          )}
        </div>
      )}

      {/* Fuel ladder table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', flexShrink: 0 }}>
        <colgroup>
          <col style={{ width: 28 }} />
          <col style={{ width: 52 }} />
          <col style={{ width: 48 }} />
          <col style={{ width: 42 }} />
          <col style={{ width: 42 }} />
          <col style={{ width: 50 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 64 }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>WP</th>
            <th style={{ ...th, textAlign: 'left' }}>NAME</th>
            <th style={th}>ALT</th>
            <th style={th}>KTS</th>
            <th style={th}>ETE</th>
            <th style={th}>FF</th>
            <th style={th}>BURN</th>
            <th style={th}>FUEL</th>
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
                <td style={cell}>{leg.name}</td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {leg.altFt > 0 ? (leg.altFt >= 1000 ? `${(leg.altFt / 1000).toFixed(1)}k` : leg.altFt) : 'SFC'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>{leg.spdKts > 0 ? leg.spdKts : '—'}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{fmtEte(leg.ete)}</td>
                <td style={{ ...cell, textAlign: 'right', color: DIM }}>
                  {leg.flowRate > 0 ? `${(leg.flowRate / 1000).toFixed(1)}k` : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {leg.burn > 0 ? `-${leg.burn.toLocaleString()}` : '—'}
                </td>
                <td style={{
                  ...cell,
                  textAlign: 'right',
                  fontWeight: 600,
                  color: leg.remaining <= bingoFuel ? '#d95050' : leg.remaining <= jokerFuel ? WARN : TEXT,
                }}>
                  {leg.remaining.toLocaleString()}
                </td>
                <td style={{ ...cell, padding: '3px 6px' }}>
                  <div style={{
                    width: '100%', height: 8,
                    background: BORDER, borderRadius: 2, overflow: 'hidden',
                    position: 'relative',
                  }}>
                    <div style={{
                      width: `${Math.round(pct * 100)}%`,
                      height: '100%', background: barColor, borderRadius: 2,
                    }} />
                    {/* Joker mark */}
                    {startFuel > 0 && (
                      <div style={{
                        position: 'absolute',
                        left: `${Math.round((jokerFuel / startFuel) * 100)}%`,
                        top: 0, width: 1, height: '100%',
                        background: WARN, opacity: 0.6,
                      }} />
                    )}
                    {/* Bingo mark */}
                    {startFuel > 0 && (
                      <div style={{
                        position: 'absolute',
                        left: `${Math.round((bingoFuel / startFuel) * 100)}%`,
                        top: 0, width: 1, height: '100%',
                        background: '#d95050', opacity: 0.6,
                      }} />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        padding: '6px 0', borderTop: `2px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}`,
        fontSize: 19, fontWeight: 600, flexShrink: 0,
      }}>
        <span style={{ color: TEXT }}>TOTAL BURN: {totalBurn.toLocaleString()} lbs</span>
        <span style={{
          color: fuel <= bingoFuel ? '#d95050' : fuel <= jokerFuel ? WARN : TEXT,
        }}>LANDING FUEL: {fuel.toLocaleString()} lbs</span>
      </div>

      {/* Disclaimer */}
      <div style={{ padding: '6px 0', fontSize: 17, color: DIM, flexShrink: 0 }}>
        * Estimates based on level cruise drag model. Actual burn varies with throttle, turns, combat, and loadout drag. {isManual ? 'Fuel marks set manually.' : 'Joker=35% / Bingo=20% of start fuel.'}
      </div>

      {/* Notes section — fills remaining space */}
      <div style={{ ...sectionTitle, marginTop: 4 }}>NOTES</div>
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

      <div style={footerStyle}>Generated by DCS:OPT | VMFA-224(AW)</div>
    </div>
  );
}
