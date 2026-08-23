/**
 * Route Profile Card — the route seen from the side.
 *
 * Every other route card is a plan view, which cannot show the one thing a
 * low-level ingress depends on: whether the planned altitude actually clears
 * the ground under it. This draws terrain along the route with the planned
 * altitude over it, and per-leg MSA from a corridor either side of track.
 *
 * Terrain comes from the global elevation service — see services/elevation.py.
 * Kola is at 69N, past SRTM's 60N limit, so until that existed this card
 * would have drawn a flat sea for the entire campaign.
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th,
  notesBox, BORDER_MED, TEXT, DIM, ACCENT, WARN, ROW_ALT, footerStyle,
  MissionDateLine,
} from './cardStyles';
import type { MissionGroup, MissionOverviewData } from '../types/mission';
import { msaPerLeg, MSA_CORRIDOR_NM, type RouteSample } from '../utils/routeProfile';

interface Props {
  group: MissionGroup;
  /** Samples with terrain already resolved. Empty or terrain-less samples
   *  still render — the planned altitude line is useful on its own. */
  samples: RouteSample[];
  overview?: MissionOverviewData;
  notes?: string;
}

const CHART_W = 552;
const CHART_H = 250;
const PAD = { left: 46, right: 8, top: 10, bottom: 22 };

function fmtAlt(ft: number): string {
  return ft >= 1000 ? `${(ft / 1000).toFixed(0)}k` : String(Math.round(ft / 100) * 100);
}

export function RouteProfileCard({ group, samples, overview, notes }: Props) {
  const hasTerrain = samples.some((s) => s.terrainFt != null);
  const msa = msaPerLeg(samples);

  const maxDist = samples.length ? samples[samples.length - 1].distNm : 1;
  const peakTerrain = Math.max(0, ...samples.map((s) => s.corridorFt ?? s.terrainFt ?? 0));
  const peakPlanned = Math.max(0, ...samples.map((s) => s.plannedAltFt));
  const top = Math.max(1000, peakTerrain, peakPlanned) * 1.15;

  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const xOf = (nm: number) => PAD.left + (nm / Math.max(0.001, maxDist)) * plotW;
  const yOf = (ft: number) => PAD.top + plotH - (ft / top) * plotH;

  // Terrain as a filled silhouette, so the profile reads as ground rather
  // than as a second altitude trace.
  const terrainPath = hasTerrain
    ? `M${xOf(0)},${yOf(0)} `
      + samples.filter((s) => s.terrainFt != null)
        .map((s) => `L${xOf(s.distNm)},${yOf(s.terrainFt!)}`).join(' ')
      + ` L${xOf(maxDist)},${yOf(0)} Z`
    : '';

  // The corridor line is what MSA is built on — drawn dashed above the
  // silhouette so a ridge off track is visible, not just implied by a number.
  const corridorPath = samples.some((s) => s.corridorFt != null)
    ? samples.filter((s) => s.corridorFt != null)
        .map((s, i) => `${i === 0 ? 'M' : 'L'}${xOf(s.distNm)},${yOf(s.corridorFt!)}`).join(' ')
    : '';

  const plannedPath = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${xOf(s.distNm)},${yOf(s.plannedAltFt)}`).join(' ');

  // Ground conflicts are measured against the CENTRELINE, not the corridor.
  // The corridor is right for MSA — it accounts for the ridge off track — but
  // using it here flags every approach into a valley, since terrain either
  // side of an airfield is naturally above your altitude on final. What
  // deserves a red dot is the ground actually under the aircraft.
  //
  // Departure and recovery legs are excluded for the same reason: a takeoff
  // roll is legitimately at field elevation, and sampling error there would
  // otherwise dominate the count.
  const lastLeg = samples.length ? samples[samples.length - 1].leg : 0;
  const violations = samples.filter(
    (s) => s.terrainFt != null
      && s.leg > 0 && s.leg < lastLeg
      && s.plannedAltFt < s.terrainFt);

  const legRows = [...msa.entries()].sort((a, b) => a[0] - b[0]);
  const wpName = (i: number) => group.waypoints[i]?.waypoint_name || `WP${i}`;

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>ROUTE PROFILE</div>
        <div style={subtitleStyle}>
          {group.groupName} | {maxDist.toFixed(0)} NM | MSA over ±{MSA_CORRIDOR_NM} NM corridor
        </div>
        {overview && (
          <MissionDateLine date={overview.date} startTime={overview.start_time}
                           theater={overview.theater} showTheater />
        )}
      </div>

      {samples.length === 0 ? (
        <div style={{ padding: '24px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          Route needs at least two positioned waypoints.
        </div>
      ) : (
        <svg width={CHART_W} height={CHART_H} style={{ display: 'block', margin: '4px auto 0' }}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={CHART_W - PAD.right} y1={yOf(f * top)} y2={yOf(f * top)}
                    stroke="#2a2a2a" strokeWidth={1} />
              <text x={PAD.left - 5} y={yOf(f * top) + 4} fill={DIM} fontSize={10} textAnchor="end">
                {fmtAlt(f * top)}
              </text>
            </g>
          ))}

          {terrainPath && <path d={terrainPath} fill="#3a2f24" stroke="#5a4a3a" strokeWidth={1} />}
          {corridorPath && (
            <path d={corridorPath} fill="none" stroke="#7a6450" strokeWidth={1}
                  strokeDasharray="3 3" />
          )}
          <path d={plannedPath} fill="none" stroke={ACCENT} strokeWidth={2} />

          {/* waypoint ticks */}
          {samples.filter((s, i) => i > 0 && s.leg !== samples[i - 1].leg).map((s) => (
            <line key={s.distNm} x1={xOf(s.distNm)} x2={xOf(s.distNm)}
                  y1={PAD.top} y2={PAD.top + plotH} stroke="#3d3d3d" strokeWidth={1} />
          ))}

          {violations.map((s) => (
            <circle key={s.distNm} cx={xOf(s.distNm)} cy={yOf(s.plannedAltFt)} r={3} fill="#e06666" />
          ))}

          {[0, 0.5, 1].map((f) => (
            <text key={f} x={xOf(f * maxDist)} y={CHART_H - 6} fill={DIM} fontSize={10}
                  textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
              {(f * maxDist).toFixed(0)} NM
            </text>
          ))}
        </svg>
      )}

      {!hasTerrain && samples.length > 0 && (
        <div style={{ padding: '2px 16px', fontSize: 13, color: DIM }}>
          Terrain unavailable — planned altitude shown without ground reference.
        </div>
      )}
      {violations.length > 0 && (
        <div style={{ padding: '2px 16px', fontSize: 14, color: '#e06666', fontWeight: 600 }}>
          Planned altitude is below the ground at {violations.length} point
          {violations.length !== 1 ? 's' : ''} en route.
        </div>
      )}

      <div style={sectionTitle}>MSA BY LEG</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>LEG</th>
            <th style={{ ...th, width: 96 }}>PEAK</th>
            <th style={{ ...th, width: 96 }}>MSA</th>
          </tr>
        </thead>
        <tbody>
          {legRows.length === 0 ? (
            <tr><td colSpan={3} style={{ ...cell, textAlign: 'center', color: DIM }}>
              No terrain data for this route.
            </td></tr>
          ) : legRows.slice(0, 8).map(([leg, alt], i) => {
            const peak = Math.max(...samples.filter((s) => s.leg === leg)
              .map((s) => s.corridorFt ?? s.terrainFt ?? 0));
            return (
              <tr key={leg} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                <td style={{ ...cell, overflow: 'hidden', textOverflow: 'ellipsis',
                             whiteSpace: 'nowrap' }}>
                  {wpName(leg)} → {wpName(leg + 1)}
                </td>
                <td style={{ ...cell, textAlign: 'center', color: DIM }}>
                  {Math.round(peak).toLocaleString()} ft
                </td>
                <td style={{ ...cell, textAlign: 'center', color: WARN, fontWeight: 600 }}>
                  {alt.toLocaleString()} ft
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {legRows.length > 8 && (
        <div style={{ padding: '2px 16px', fontSize: 13, color: DIM }}>
          +{legRows.length - 8} more legs
        </div>
      )}

      <div style={sectionTitle}>NOTES</div>
      <div style={notesBox}>
        {notes && notes.trim() && (
          <div style={{ fontSize: 17, color: TEXT, whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word', lineHeight: 1.35 }}>
            {notes.trim()}
          </div>
        )}
      </div>

      <div style={{ ...footerStyle, borderTop: `1px solid ${BORDER_MED}` }}>
        Route Profile | Generated by DCS:OPT
      </div>
    </div>
  );
}
