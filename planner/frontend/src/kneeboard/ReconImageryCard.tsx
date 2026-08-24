/**
 * Recon Imagery Card — a target area shot the way a recon print looks.
 *
 * The squadron's paper cards carry a monochrome overhead of the objective
 * with the individual targets numbered in red. This generates that from the
 * mission itself: pick a group, the card frames its units on satellite
 * imagery, filters it to a recon-print monochrome, and numbers every unit
 * with a coordinate table underneath — so "target 7" on the radio means the
 * same building to everyone.
 *
 * The imagery is real-world satellite of the same coordinates, which lines
 * up with DCS because the maps are geo-referenced; the card says as much in
 * its footer rather than pretending to be sensor product.
 */

import { TileMap, createProjection } from './TileMap';
import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th,
  notesBox, TEXT, DIM, ACCENT, ROW_ALT, footerStyle, MissionDateLine,
} from './cardStyles';
import type { MissionGroup, MissionOverviewData } from '../types/mission';
import { formatCoord, type CoordFormat } from './coords';

interface Props {
  group: MissionGroup;
  overview?: MissionOverviewData;
  coordFormat?: CoordFormat;
  notes?: string;
}

const IMG_W = 552;
const IMG_H = 420;

/** Padding around the group's footprint, as a fraction of its span. A lone
 *  unit gets a fixed ~0.6 nm half-frame instead. */
const PAD_FRACTION = 0.45;
const MIN_HALF_DEG = 0.01;

export function ReconImageryCard({ group, overview, coordFormat = 'mgrs', notes }: Props) {
  const units = (group.units ?? []).filter((u) => u.lat != null && u.lon != null);

  if (units.length === 0) {
    return (
      <div style={cardRoot}>
        <div style={headerStyle}>
          <div style={titleStyle}>RECON — {group.groupName.toUpperCase()}</div>
        </div>
        <div style={{ padding: '24px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No positioned units in this group.
        </div>
      </div>
    );
  }

  let minLat = Math.min(...units.map((u) => u.lat!));
  let maxLat = Math.max(...units.map((u) => u.lat!));
  let minLon = Math.min(...units.map((u) => u.lon!));
  let maxLon = Math.max(...units.map((u) => u.lon!));
  const spanLat = Math.max(maxLat - minLat, MIN_HALF_DEG);
  const spanLon = Math.max(maxLon - minLon, MIN_HALF_DEG / Math.cos((minLat * Math.PI) / 180));
  minLat -= spanLat * PAD_FRACTION; maxLat += spanLat * PAD_FRACTION;
  minLon -= spanLon * PAD_FRACTION; maxLon += spanLon * PAD_FRACTION;

  const proj = createProjection(minLat, maxLat, minLon, maxLon, IMG_W, IMG_H);
  const marks = units.map((u, i) => {
    const [x, y] = proj.project(u.lat!, u.lon!);
    return { n: i + 1, x, y, u };
  });

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>RECON — {group.groupName.toUpperCase()}</div>
        <div style={subtitleStyle}>
          {units.length} target{units.length !== 1 ? 's' : ''} | {group.coalition.toUpperCase()} | {group.category}
        </div>
        {overview && (
          <MissionDateLine date={overview.date} startTime={overview.start_time}
                           theater={overview.theater} showTheater />
        )}
      </div>

      {/* The print. Filtered to monochrome so the red numbering carries. */}
      <div style={{
        width: IMG_W, height: IMG_H, margin: '4px auto 0', position: 'relative',
        overflow: 'hidden', flexShrink: 0, border: `1px solid #444`,
      }}>
        <div style={{ filter: 'grayscale(1) contrast(1.18) brightness(1.06)' }}>
          <TileMap width={IMG_W} height={IMG_H}
                   minLat={minLat} maxLat={maxLat} minLon={minLon} maxLon={maxLon}
                   layer="satellite" hideCredit />
        </div>
        <svg width={IMG_W} height={IMG_H}
             style={{ position: 'absolute', inset: 0 }}>
          {marks.map((m) => (
            <g key={m.n}>
              {/* Number sits offset from the unit so it never covers what it
                  is pointing at; the tick ties them together. */}
              <line x1={m.x} y1={m.y} x2={m.x - 8} y2={m.y - 8}
                    stroke="#d81f1f" strokeWidth={1.5} />
              <circle cx={m.x} cy={m.y} r={2.5} fill="#d81f1f" />
              <text x={m.x - 11} y={m.y - 11} fontSize={16} fontWeight={700}
                    fill="#d81f1f" textAnchor="middle"
                    stroke="#ffffff" strokeWidth={2.5} paintOrder="stroke">
                {m.n}
              </text>
            </g>
          ))}
          {/* North arrow — the frame is north-up by construction. */}
          <g transform={`translate(${IMG_W - 22}, 26)`}>
            <line x1={0} y1={14} x2={0} y2={-8} stroke="#d81f1f" strokeWidth={2} />
            <polygon points="0,-14 -4,-4 4,-4" fill="#d81f1f" />
            <text x={0} y={28} fontSize={12} fill="#d81f1f" fontWeight={700}
                  textAnchor="middle" stroke="#fff" strokeWidth={2} paintOrder="stroke">N</text>
          </g>
        </svg>
      </div>

      <div style={sectionTitle}>TARGETS</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 30 }}>#</th>
            <th style={{ ...th, textAlign: 'left' }}>TYPE</th>
            <th style={{ ...th, width: 150 }}>{coordFormat === 'mgrs' ? 'MGRS' : 'LAT/LON'}</th>
          </tr>
        </thead>
        <tbody>
          {marks.slice(0, 8).map((m, i) => (
            <tr key={m.n} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
              <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 700 }}>{m.n}</td>
              <td style={{ ...cell, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.u.type}</td>
              <td style={{ ...cell, textAlign: 'center', fontFamily: "'B612 Mono', monospace", fontSize: 14 }}>
                {formatCoord(m.u.lat, m.u.lon, coordFormat, 3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {marks.length > 8 && (
        <div style={{ padding: '2px 16px', fontSize: 13, color: DIM }}>
          +{marks.length - 8} more targets numbered on the print
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

      <div style={footerStyle}>
        Recon Imagery | real-world satellite of mission coordinates | Generated by DCS:OPT
      </div>
    </div>
  );
}
