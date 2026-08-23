/**
 * Airfield Diagram Card — a generated approach plate.
 *
 * DCS ships no airfield charts, and the community ones only exist for a few
 * popular maps. Everything needed to draw a usable one is already in the
 * theatre data the planner loads: runway designators and their magnetic
 * headings, the ATC radios, and the field position. So draw it — every field
 * on every map, including the ones nobody has ever made a chart for.
 *
 * This is a diagram, not a survey plate. Runways are drawn at their real
 * headings and in the right relative orientation to each other, which is what
 * you need to pick a runway and set up an approach. Their lengths and offsets
 * are not in the data, so the drawing does not claim them — see RUNWAY_LEN.
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th,
  notesBox, BORDER_MED, TEXT, DIM, ACCENT, WARN, ROW_ALT, footerStyle,
  MissionDateLine,
} from './cardStyles';
import type { Airbase, MissionOverviewData } from '../types/mission';
import { formatCoord, type CoordFormat } from './coords';

interface Props {
  airbase: Airbase;
  /** Field elevation in ft MSL, from the elevation service. */
  elevationFt?: number | null;
  /** Player coalition, for the ownership line. */
  coalition?: string;
  overview?: MissionOverviewData;
  coordFormat?: CoordFormat;
  notes?: string;
}

const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** Runway strip length on the diagram. Deliberately uniform: the theatre data
 *  carries no runway lengths, so drawing them at different sizes would invent
 *  a fact. Orientation is real; scale is not. */
const RUNWAY_LEN = 116;
const RUNWAY_W = 15;

/** Both ends of a runway, zero-padded the way a plate prints them. */
function ends(rw: { ends?: string[]; headings?: number[]; name?: string }): string[] {
  if (rw.ends && rw.ends.length >= 2) {
    return rw.ends.map((e) => (/^\d$/.test(e) ? `0${e}` : e));
  }
  if (rw.headings && rw.headings.length >= 2) {
    return rw.headings.map((h) => String(Math.round(h / 10)).padStart(2, '0'));
  }
  return (rw.name || '').split(/[-/]/).map((e) => e.trim()).filter(Boolean);
}

function headingOf(rw: { headings?: number[]; ends?: string[] }): number {
  if (rw.headings && rw.headings.length) return rw.headings[0];
  const e = ends(rw)[0];
  const n = parseInt(e, 10);
  return Number.isFinite(n) ? n * 10 : 0;
}

function fmtFreq(mhz?: number): string {
  return mhz != null && mhz > 0 ? mhz.toFixed(3) : '—';
}

export function AirfieldDiagramCard({
  airbase, elevationFt, coalition = 'blue', overview, coordFormat = 'mgrs', notes,
}: Props) {
  const runways = airbase.runways ?? [];
  const radio = airbase.atc_radio;
  const owner = airbase.coalition;
  const hostile = owner !== 'neutral' && owner !== coalition;
  const canService = runways.length > 0 && !hostile;

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>{airbase.name.toUpperCase()}</div>
        <div style={subtitleStyle}>
          Airfield diagram | {runways.length} runway{runways.length !== 1 ? 's' : ''}
          {elevationFt != null && ` | ${Math.round(elevationFt).toLocaleString()} ft MSL`}
        </div>
        {overview && (
          <MissionDateLine date={overview.date} startTime={overview.start_time}
                           theater={overview.theater} showTheater />
        )}
      </div>

      {runways.length === 0 ? (
        <div style={{ padding: '24px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No runway data for this field.
        </div>
      ) : (
        <svg width={SIZE} height={SIZE} style={{ display: 'block', margin: '6px auto 0' }}>
          {/* compass rose — the diagram is north-up, so the ring is the
              reference the headings are read against */}
          <circle cx={CX} cy={CY} r={SIZE / 2 - 14} fill="#1b1b1b" stroke="#2f2f2f" strokeWidth={1} />
          {[0, 90, 180, 270].map((deg) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            const r1 = SIZE / 2 - 14, r2 = SIZE / 2 - 6;
            return (
              <g key={deg}>
                <line x1={CX + Math.cos(rad) * r1} y1={CY + Math.sin(rad) * r1}
                      x2={CX + Math.cos(rad) * (r1 - 6)} y2={CY + Math.sin(rad) * (r1 - 6)}
                      stroke="#4a4a4a" strokeWidth={1} />
                <text x={CX + Math.cos(rad) * r2} y={CY + Math.sin(rad) * r2 + 4}
                      fill={DIM} fontSize={11} textAnchor="middle">
                  {deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : 'W'}
                </text>
              </g>
            );
          })}

          {runways.map((rw, i) => {
            const hdg = headingOf(rw);
            const [a, b] = ends(rw);
            // SVG rotation is clockwise from the +x axis; a compass heading is
            // clockwise from north, so subtract 90 to line them up.
            const rad = ((hdg - 90) * Math.PI) / 180;
            const dx = Math.cos(rad) * (RUNWAY_LEN / 2);
            const dy = Math.sin(rad) * (RUNWAY_LEN / 2);
            const labelR = RUNWAY_LEN / 2 + 15;
            return (
              <g key={i}>
                <line x1={CX - dx} y1={CY - dy} x2={CX + dx} y2={CY + dy}
                      stroke="#4f4f4f" strokeWidth={RUNWAY_W} strokeLinecap="butt" />
                <line x1={CX - dx} y1={CY - dy} x2={CX + dx} y2={CY + dy}
                      stroke="#8a8a8a" strokeWidth={1} strokeDasharray="6 6" />
                {/* Designator sits at the end you would be looking at when
                    lined up on that heading. */}
                <text x={CX + Math.cos(rad) * labelR} y={CY + Math.sin(rad) * labelR + 4}
                      fill={ACCENT} fontSize={13} fontWeight={700} textAnchor="middle">{a}</text>
                <text x={CX - Math.cos(rad) * labelR} y={CY - Math.sin(rad) * labelR + 4}
                      fill={ACCENT} fontSize={13} fontWeight={700} textAnchor="middle">{b}</text>
              </g>
            );
          })}
        </svg>
      )}

      <div style={{ padding: '2px 16px 4px', fontSize: 12, color: DIM, textAlign: 'center' }}>
        North-up. Runway headings are real; lengths and offsets are not in the
        mission data and are drawn uniform.
      </div>

      <div style={sectionTitle}>FIELD DATA</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            <td style={{ ...cell, width: 150, color: DIM }}>POSITION</td>
            <td style={{ ...cell, fontFamily: "'B612 Mono', monospace" }}>
              {formatCoord(airbase.lat, airbase.lon, coordFormat, 3)}
            </td>
          </tr>
          <tr style={{ background: ROW_ALT }}>
            <td style={{ ...cell, color: DIM }}>ELEVATION</td>
            <td style={cell}>
              {elevationFt != null ? `${Math.round(elevationFt).toLocaleString()} ft MSL` : '—'}
            </td>
          </tr>
          <tr>
            <td style={{ ...cell, color: DIM }}>RUNWAYS</td>
            <td style={cell}>
              {runways.map((rw) => ends(rw).join('/')).join('  ·  ') || '—'}
            </td>
          </tr>
          <tr style={{ background: ROW_ALT }}>
            <td style={{ ...cell, color: DIM }}>OWNER</td>
            <td style={{ ...cell, color: hostile ? '#e06666' : TEXT, fontWeight: 600 }}>
              {(owner || 'unknown').toUpperCase()}
              {canService
                ? <span style={{ color: '#7fd97f', marginLeft: 8 }}>fuel + rearm</span>
                : hostile && <span style={{ color: '#e06666', marginLeft: 8 }}>do not divert</span>}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={sectionTitle}>ATC</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>POSITION</th>
            <th style={{ ...th, width: 110 }}>UHF</th>
            <th style={{ ...th, width: 110 }}>VHF</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}>Tower</td>
            <td style={{ ...cell, textAlign: 'center', color: WARN, fontWeight: 600 }}>
              {fmtFreq(radio?.uhf_mhz)}
            </td>
            <td style={{ ...cell, textAlign: 'center' }}>{fmtFreq(radio?.vhf_high_mhz)}</td>
          </tr>
          <tr style={{ background: ROW_ALT }}>
            <td style={cell}>VHF low / HF</td>
            <td style={{ ...cell, textAlign: 'center', color: DIM }}>{fmtFreq(radio?.hf_mhz)}</td>
            <td style={{ ...cell, textAlign: 'center', color: DIM }}>{fmtFreq(radio?.vhf_low_mhz)}</td>
          </tr>
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

      <div style={{ ...footerStyle, borderTop: `1px solid ${BORDER_MED}` }}>
        Airfield Diagram | Generated by DCS:OPT
      </div>
    </div>
  );
}
