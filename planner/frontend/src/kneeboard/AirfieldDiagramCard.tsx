/**
 * Airfield Diagram Card — generated approach plates.
 *
 * DCS ships no airfield charts, and the community ones only exist for a few
 * popular maps. Everything needed to draw a usable one is already in the
 * theatre data the planner loads: runway designators and their magnetic
 * headings, the ATC radios, and the field position. So draw it — every field
 * on every map, including the ones nobody has ever made a chart for.
 *
 * One card covers up to four fields in a 2x2 grid. A card per field pushed
 * the ones you would actually divert to behind three you would not, which is
 * a lot of kneeboard for something you read at a glance.
 *
 * These are diagrams, not survey plates. Runways are drawn at their real
 * headings and in the right relative orientation to each other, which is what
 * you need to pick a runway and set up an approach. Their lengths and offsets
 * are not in the data, so the drawing does not claim them — see RUNWAY_LEN.
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  notesBox, BORDER_MED, TEXT, DIM, ACCENT, WARN, footerStyle,
  MissionDateLine,
} from './cardStyles';
import type { Airbase, MissionOverviewData } from '../types/mission';
import { formatCoord, type CoordFormat } from './coords';

interface Props {
  /** Every field to draw. One card covers up to FIELDS_PER_CARD of them. */
  airbases: Airbase[];
  /** Field elevations in ft MSL, index-matched to `airbases`. */
  elevationFt?: (number | null)[];
  /** Player coalition, for the ownership line. */
  coalition?: string;
  overview?: MissionOverviewData;
  coordFormat?: CoordFormat;
  notes?: string;
  /** 0-based page when there are more fields than fit one card. */
  page?: number;
}

/** Fields per card. Four fits a 2x2 grid at a size where the runway
 *  designators are still readable in the cockpit. */
export const FIELDS_PER_CARD = 4;

export function airfieldCardCount(fieldCount: number): number {
  return Math.max(1, Math.ceil(fieldCount / FIELDS_PER_CARD));
}

const SIZE = 130;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** Runway strip length on the diagram. Deliberately uniform: the theatre data
 *  carries no runway lengths, so drawing them at different sizes would invent
 *  a fact. Orientation is real; scale is not. */
const RUNWAY_LEN = 80;
const RUNWAY_W = 9;

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
  const n = parseInt(ends(rw)[0], 10);
  return Number.isFinite(n) ? n * 10 : 0;
}

function fmtFreq(mhz?: number): string {
  return mhz != null && mhz > 0 ? mhz.toFixed(3) : '—';
}

function Row({ k, v, accent, mono, color }: {
  k: string; v: string; accent?: boolean; mono?: boolean; color?: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <span style={{ color: DIM, width: 42, flexShrink: 0 }}>{k}</span>
      <span style={{
        color: color ?? (accent ? WARN : TEXT),
        fontWeight: accent ? 600 : 400,
        fontFamily: mono ? "'B612 Mono', monospace" : undefined,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{v}</span>
    </div>
  );
}

/** One field: north-up diagram plus the numbers you would dial. */
function FieldPanel({ ab, elevationFt, coalition, coordFormat }: {
  ab: Airbase;
  elevationFt?: number | null;
  coalition: string;
  coordFormat: CoordFormat;
}) {
  const runways = ab.runways ?? [];
  const radio = ab.atc_radio;
  const owner = ab.coalition;
  const hostile = owner !== 'neutral' && owner !== coalition;

  return (
    <div style={{ border: `1px solid ${BORDER_MED}`, padding: '4px 6px 5px',
                  display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: hostile ? '#e06666' : TEXT,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ab.name.toUpperCase()}
      </div>

      {runways.length === 0 ? (
        <div style={{ height: SIZE, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 13, color: DIM }}>
          No runway data
        </div>
      ) : (
        <svg width={SIZE} height={SIZE} style={{ display: 'block', margin: '1px auto 0' }}>
          {/* North-up compass ring — the reference the headings read against. */}
          <circle cx={CX} cy={CY} r={SIZE / 2 - 9} fill="#1b1b1b"
                  stroke="#2f2f2f" strokeWidth={1} />
          {[0, 90, 180, 270].map((deg) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            const r = SIZE / 2 - 3;
            return (
              <text key={deg} x={CX + Math.cos(rad) * r} y={CY + Math.sin(rad) * r + 3}
                    fill={deg === 0 ? ACCENT : DIM} fontSize={9} textAnchor="middle">
                {deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : 'W'}
              </text>
            );
          })}

          {runways.map((rw, i) => {
            const [a, b] = ends(rw);
            // SVG rotation is clockwise from +x; a compass heading is clockwise
            // from north, so subtract 90 to line them up.
            const rad = ((headingOf(rw) - 90) * Math.PI) / 180;
            const dx = Math.cos(rad) * (RUNWAY_LEN / 2);
            const dy = Math.sin(rad) * (RUNWAY_LEN / 2);
            const labelR = RUNWAY_LEN / 2 + 10;
            return (
              <g key={i}>
                <line x1={CX - dx} y1={CY - dy} x2={CX + dx} y2={CY + dy}
                      stroke="#4f4f4f" strokeWidth={RUNWAY_W} strokeLinecap="butt" />
                <line x1={CX - dx} y1={CY - dy} x2={CX + dx} y2={CY + dy}
                      stroke="#8a8a8a" strokeWidth={0.8} strokeDasharray="4 4" />
                {/* Designator at the end you face when lined up on it. */}
                <text x={CX + Math.cos(rad) * labelR} y={CY + Math.sin(rad) * labelR + 3}
                      fill={ACCENT} fontSize={11} fontWeight={700} textAnchor="middle">{a}</text>
                <text x={CX - Math.cos(rad) * labelR} y={CY - Math.sin(rad) * labelR + 3}
                      fill={ACCENT} fontSize={11} fontWeight={700} textAnchor="middle">{b}</text>
              </g>
            );
          })}
        </svg>
      )}

      <div style={{ fontSize: 13, lineHeight: 1.4, marginTop: 2 }}>
        <Row k="RWY" v={runways.map((rw) => ends(rw).join('/')).join(' · ') || '—'} />
        <Row k="TWR" v={fmtFreq(radio?.uhf_mhz)} accent />
        <Row k="VHF" v={fmtFreq(radio?.vhf_high_mhz)} />
        <Row k="ELEV" v={elevationFt != null
          ? `${Math.round(elevationFt).toLocaleString()} ft` : '—'} />
        <Row k="POS" v={formatCoord(ab.lat, ab.lon, coordFormat, 3)} mono />
        <Row k="USE" v={hostile ? 'ENEMY — no divert' : 'fuel + rearm'}
             color={hostile ? '#e06666' : '#7fd97f'} />
      </div>
    </div>
  );
}

export function AirfieldDiagramCard({
  airbases, elevationFt = [], coalition = 'blue', overview,
  coordFormat = 'mgrs', notes, page = 0,
}: Props) {
  const start = page * FIELDS_PER_CARD;
  const shown = airbases.slice(start, start + FIELDS_PER_CARD);
  const pages = airfieldCardCount(airbases.length);

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          AIRFIELD DIAGRAMS{pages > 1 ? ` (${page + 1}/${pages})` : ''}
        </div>
        <div style={subtitleStyle}>
          {shown.length} field{shown.length !== 1 ? 's' : ''} | north-up | headings real,
          runway lengths not in mission data
        </div>
        {overview && (
          <MissionDateLine date={overview.date} startTime={overview.start_time}
                           theater={overview.theater} showTheater />
        )}
      </div>

      {shown.length === 0 ? (
        <div style={{ padding: '24px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No usable airfields near this route.
        </div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
          padding: '6px 0', flexShrink: 0,
        }}>
          {shown.map((ab, i) => (
            <FieldPanel key={ab.name} ab={ab} elevationFt={elevationFt[start + i]}
                        coalition={coalition} coordFormat={coordFormat} />
          ))}
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

      <div style={footerStyle}>Airfield Diagrams | Generated by DCS:OPT</div>
    </div>
  );
}
