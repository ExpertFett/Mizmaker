/**
 * Station Loadout Card — the flight's stores drawn on the jet.
 *
 * The Flight Card carries a station table, which is fine as a list but says
 * nothing about where a station is. This card puts the loadout on a top-down
 * outline: each pylon marked on the airframe, with a box under it naming the
 * store and, where the station carries something that uses one, its laser
 * code. Reading asymmetry or finding which side the pod is on becomes a
 * glance instead of a lookup.
 *
 * Laser codes here are the ones actually loaded on that station. The crew
 * roster on this card carries the per-aircrew codes — including for jets
 * with nothing laser-guided aboard, since they may still be asked to lase
 * for someone else. See sop/flightLaserCodes.ts.
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th,
  notesBox, BORDER_MED, TEXT, DIM, ACCENT, WARN, ROW_ALT, footerStyle,
  MissionDateLine,
} from './cardStyles';
import type { MissionGroup, MissionOverviewData, ClientUnit } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { planformFor, planformPath } from './aircraftPlanform';
import { assignFlightLaserCodes, DEFAULT_LASER_BASE } from '../sop/flightLaserCodes';

interface Props {
  group: MissionGroup;
  clientUnits: ClientUnit[];
  overview?: MissionOverviewData;
  /** SOP ladder start for the per-aircrew codes. */
  laserCodeBase?: number;
  notes?: string;
}

const DIAGRAM_H = 300;

/** Trim a store name to something that fits a station box. */
function storeLabel(p: { shortName?: string; name?: string }): string {
  const raw = (p.shortName || p.name || '').trim();
  // Drop the bracketed qualifiers DCS names carry ("Mk-82 [Snakeye]") — the
  // box has room for the store, not its footnote.
  return raw.replace(/\s*[[(].*$/, '').slice(0, 14);
}

export function StationLoadoutCard({
  group, clientUnits, overview, laserCodeBase, notes,
}: Props) {
  const airframe = getAircraftType(group);
  const flightUnits = clientUnits.filter((u) => u.groupName === group.groupName);
  const rep = flightUnits[0];
  const pylons = (rep?.pylons ?? []).filter((p) => p.name);
  const maxStation = pylons.reduce((m, p) => Math.max(m, p.number), 0);

  const plan = planformFor(airframe, maxStation);
  const posOf = (n: number) => plan.stations.find((s) => s.number === n);

  // Per-aircrew codes, allocated across the whole mission so no two jets are
  // briefed the same one.
  const codes = assignFlightLaserCodes(clientUnits, laserCodeBase ?? DEFAULT_LASER_BASE);

  // Station boxes sit in a row under the jet, in physical left-to-right
  // order, each tied back to its pylon by a leader line.
  const loaded = [...pylons].sort((a, b) => {
    const pa = posOf(a.number), pb = posOf(b.number);
    return (pa?.x ?? a.number) - (pb?.x ?? b.number);
  });

  const VB = 100;                       // planform coordinate space
  const jetH = 150;                     // px the outline occupies
  const boxTop = jetH + 22;
  const boxH = 52;
  const gap = 4;
  const cardInner = 552;
  const boxW = loaded.length > 0
    ? Math.min(96, (cardInner - gap * (loaded.length - 1)) / loaded.length)
    : 0;
  const rowW = loaded.length * boxW + gap * (loaded.length - 1);
  const rowLeft = (cardInner - rowW) / 2;

  // Jet is drawn centred at the same scale as the box row so a station's
  // marker sits above its own box.
  const jetW = jetH * 0.95;
  const jetLeft = (cardInner - jetW) / 2;
  const jx = (x: number) => jetLeft + (x / VB) * jetW;
  const jy = (y: number) => (y / VB) * jetH;

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>STATION LOADOUT</div>
        <div style={subtitleStyle}>
          {group.groupName} | {airframe} | {loaded.length} station{loaded.length !== 1 ? 's' : ''} loaded
        </div>
        {overview && (
          <MissionDateLine date={overview.date} startTime={overview.start_time}
                           theater={overview.theater} showTheater />
        )}
      </div>

      {loaded.length === 0 ? (
        <div style={{ padding: '24px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No stores on this airframe.
        </div>
      ) : (
        <svg width={cardInner} height={DIAGRAM_H} style={{ display: 'block', margin: '4px auto 0' }}>
          {/* jet */}
          <g transform={`translate(${jetLeft},0) scale(${jetW / VB},${jetH / VB})`}>
            <path d={planformPath(plan)} fill="#232323" stroke={BORDER_MED} strokeWidth={1.6} />
            {(plan.fins ?? []).map((fin, i) => (
              <g key={i}>
                <polyline points={fin.map(([x, y]) => `${x},${y}`).join(' ')}
                          fill="none" stroke={BORDER_MED} strokeWidth={1.6} />
                <polyline points={fin.map(([x, y]) => `${100 - x},${y}`).join(' ')}
                          fill="none" stroke={BORDER_MED} strokeWidth={1.6} />
              </g>
            ))}
          </g>

          {loaded.map((p, i) => {
            const pos = posOf(p.number);
            const bx = rowLeft + i * (boxW + gap);
            const cx = bx + boxW / 2;
            const px = pos ? jx(pos.x) : cx;
            const py = pos ? jy(pos.y) : jetH;
            const code = p.laserCode ?? null;
            return (
              <g key={p.number}>
                {/* leader from the pylon down to its box */}
                <line x1={px} y1={py} x2={cx} y2={boxTop} stroke="#3d3d3d" strokeWidth={1} />
                <circle cx={px} cy={py} r={3.5} fill={ACCENT} />

                <rect x={bx} y={boxTop} width={boxW} height={boxH}
                      fill="#1b1b1b" stroke={BORDER_MED} strokeWidth={1} rx={2} />
                <text x={cx} y={boxTop + 14} fill={ACCENT} fontSize={13} fontWeight={700}
                      textAnchor="middle">{p.number}</text>
                <text x={cx} y={boxTop + 29} fill={TEXT} fontSize={11} textAnchor="middle">
                  {storeLabel(p)}
                </text>
                {code != null && (
                  <text x={cx} y={boxTop + 43} fill={WARN} fontSize={11} textAnchor="middle">
                    L {code}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* Per-aircrew laser codes — every jet, loaded or not. */}
      <div style={sectionTitle}>LASER CODES</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 30 }}>#</th>
            <th style={{ ...th, textAlign: 'left' }}>CALLSIGN</th>
            <th style={{ ...th, width: 74 }}>CODE</th>
            <th style={{ ...th, width: 96 }}>SOURCE</th>
          </tr>
        </thead>
        <tbody>
          {flightUnits.map((cu, i) => {
            const loadedCode = cu.laserCode != null;
            return (
              <tr key={cu.unitId} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>{i + 1}</td>
                <td style={{ ...cell, fontWeight: 600, overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {/* Helos and AI-derived units carry no voice callsign;
                      the unit name is the only handle they have. */}
                  {cu.voiceCallsignLabel
                    ? `${cu.voiceCallsignLabel} ${cu.voiceCallsignNumber ?? ''}`.trim()
                    : cu.name}
                </td>
                <td style={{ ...cell, textAlign: 'center', color: WARN, fontWeight: 600 }}>
                  {codes.get(cu.unitId) ?? '—'}
                </td>
                {/* Saying which is which matters: one is set in the jet, the
                    other is a briefing assignment for a buddy-lase handoff. */}
                <td style={{ ...cell, textAlign: 'center', fontSize: 14,
                             color: loadedCode ? TEXT : DIM }}>
                  {loadedCode ? 'loaded' : 'assigned'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={sectionTitle}>NOTES</div>
      <div style={notesBox}>
        {notes && notes.trim() && (
          <div style={{ fontSize: 17, color: TEXT, whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word', lineHeight: 1.35 }}>
            {notes.trim()}
          </div>
        )}
      </div>

      <div style={footerStyle}>Station Loadout | Generated by DCS:OPT</div>
    </div>
  );
}
