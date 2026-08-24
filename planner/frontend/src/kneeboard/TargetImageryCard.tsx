/**
 * Target Imagery Card — one card per DMPI.
 *
 * A real strike brief carries target imagery: an overhead picture of the aim
 * point so the crew can recognise it visually on the run-in. This builds that
 * automatically from the DMPI list — no upload, no user input beyond the DMPIs
 * they already placed.
 *
 * Imagery is ESRI World Imagery via TileMap (satellite basemap). Zoom is
 * chosen by target radius rather than fitted to a route, so every target chip
 * comes out at a consistent, recognisable scale.
 *
 * Layout (600x850 fixed):
 *  - Header: target name + index
 *  - Imagery chip with crosshair + scale ring on the aim point
 *  - Data strip: coordinates, elevation, weapon
 *  - Footer
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  cell, BORDER_MED, TEXT, DIM, footerStyle, notesBox,
  MissionDateLine,
} from './cardStyles';
import { TileMap, createProjection } from './TileMap';
import type { Dmpi } from '../store/dmpiStore';
import type { MissionGroup, MissionOverviewData } from '../types/mission';
import { metersToFeet } from '../utils/conversions';
import { formatCoord, type CoordFormat } from './coords';
import { DEFAULT_OPTIONS, type KneeboardOptions } from './options';

const IMG_W = 568;
const IMG_H = 452;

/** Half-width of the imagery chip, in nautical miles. ~0.65 NM gives roughly a
 *  1.3 NM square — tight enough to identify a building or revetment, wide
 *  enough to show the approach to it. */
const CHIP_HALF_NM_DEFAULT = 0.65;
const NM_TO_DEG_LAT = 1 / 60;

interface TargetImageryCardProps {
  dmpi: Dmpi;
  /** 1-based position in the DMPI list, for the header. */
  index: number;
  total: number;
  overview?: MissionOverviewData;
  coordFormat?: CoordFormat;
  squadron?: string;
  notes?: string;
  /** Flight lead controls — chip zoom and base layer. */
  opts?: KneeboardOptions;
  /** Mission groups — units inside the frame are marked on the print so the
   *  crew sees what's actually parked at the aim point. */
  groups?: MissionGroup[];
}

/** Cap the unit marks: past this the chip is a SAM garrison, not a target
 *  picture, and the marks would bury the imagery. */
const MAX_UNIT_MARKS = 50;
const UNIT_COLOR: Record<string, string> = {
  red: '#d81f1f', blue: '#2f6fd8', neutrals: '#9a9a9a',
};

function unitsInFrame(
  groups: MissionGroup[] | undefined,
  minLat: number, maxLat: number, minLon: number, maxLon: number,
) {
  if (!groups) return [];
  const out: { lat: number; lon: number; type: string; coalition: string }[] = [];
  for (const g of groups) {
    for (const u of g.units ?? []) {
      if (u.lat == null || u.lon == null) continue;
      if (u.lat < minLat || u.lat > maxLat || u.lon < minLon || u.lon > maxLon) continue;
      out.push({ lat: u.lat, lon: u.lon, type: u.type, coalition: g.coalition });
      if (out.length >= MAX_UNIT_MARKS) return out;
    }
  }
  return out;
}

export function TargetImageryCard({
  dmpi, index, total, overview, coordFormat = 'mgrs', squadron, notes,
  opts = DEFAULT_OPTIONS, groups,
}: TargetImageryCardProps) {
  const { lat, lon } = dmpi;
  const CHIP_HALF_NM = opts.weapons.targetChipNm || CHIP_HALF_NM_DEFAULT;

  // Square-ish chip: longitude degrees shrink with latitude, so scale them by
  // cos(lat) or the picture stretches badly at Kola latitudes.
  const dLat = CHIP_HALF_NM * NM_TO_DEG_LAT;
  const dLon = dLat / Math.max(0.15, Math.cos((lat * Math.PI) / 180));

  const minLat = lat - dLat, maxLat = lat + dLat;
  const minLon = lon - dLon, maxLon = lon + dLon;
  const proj = createProjection(minLat, maxLat, minLon, maxLon, IMG_W, IMG_H);
  const [cx, cy] = proj.project(lat, lon);
  // 500 m ring gives the crew a built-in scale reference on the picture.
  const ring = proj.metersToPixels(500);

  const elevFt = dmpi.elevation ? Math.round(metersToFeet(dmpi.elevation)) : null;

  const marks = unitsInFrame(groups, minLat, maxLat, minLon, maxLon)
    .map((u) => { const [x, y] = proj.project(u.lat, u.lon); return { ...u, x, y }; });
  // Type labels only while they stay legible — a dozen marks with text reads
  // as annotation, fifty reads as noise.
  const labelUnits = marks.length <= 12;

  const satellite = opts.nav.mapLayer !== 'dark';

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          TARGET {total > 1 ? `${index}/${total}` : ''} — {(dmpi.name || 'DMPI').toUpperCase()}
        </div>
        {squadron && <div style={subtitleStyle}>{squadron}</div>}
        {overview && (
          <MissionDateLine
            date={overview.date}
            startTime={overview.start_time}
            theater={overview.theater}
            showTheater
          />
        )}
      </div>

      {/* The print. Satellite imagery filtered to recon-photo monochrome so
          the red annotation carries; the SVG overlay sits OUTSIDE the filter
          so the marks stay full-color. */}
      <div style={{
        width: IMG_W, height: IMG_H, margin: '0 auto', position: 'relative',
        overflow: 'hidden', flexShrink: 0,
      }}>
        <div style={satellite ? { filter: 'grayscale(1) contrast(1.18) brightness(1.06)' } : undefined}>
          <TileMap
            width={IMG_W}
            height={IMG_H}
            minLat={minLat}
            maxLat={maxLat}
            minLon={minLon}
            maxLon={maxLon}
            layer={satellite ? 'satellite' : 'dark'}
          />
        </div>
        <svg width={IMG_W} height={IMG_H} style={{ position: 'absolute', inset: 0 }}>
            {/* 500 m scale ring */}
            <circle cx={cx} cy={cy} r={ring} fill="none"
                    stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeDasharray="4 4" />
            {/* Units in frame — hollow diamonds by coalition, so the crew
                sees what's actually parked at the aim point. */}
            {marks.map((u, i) => (
              <g key={i}>
                <rect x={-4.5} y={-4.5} width={9} height={9}
                      transform={`translate(${u.x}, ${u.y}) rotate(45)`}
                      fill="none" stroke={UNIT_COLOR[u.coalition] || UNIT_COLOR.neutrals}
                      strokeWidth={1.8} paintOrder="stroke"
                      style={{ filter: 'drop-shadow(0 0 1.5px rgba(255,255,255,0.9))' }} />
                {labelUnits && (
                  <text x={u.x + 8} y={u.y + 4} fontSize={10} fontWeight={700}
                        fill={UNIT_COLOR[u.coalition] || UNIT_COLOR.neutrals}
                        stroke="#fff" strokeWidth={2} paintOrder="stroke">
                    {u.type.length > 14 ? `${u.type.slice(0, 13)}…` : u.type}
                  </text>
                )}
              </g>
            ))}
            {/* Aim point crosshair — gapped so the target itself stays visible */}
            <line x1={cx - 26} y1={cy} x2={cx - 8} y2={cy} stroke="#ff3b30" strokeWidth={2} />
            <line x1={cx + 8} y1={cy} x2={cx + 26} y2={cy} stroke="#ff3b30" strokeWidth={2} />
            <line x1={cx} y1={cy - 26} x2={cx} y2={cy - 8} stroke="#ff3b30" strokeWidth={2} />
            <line x1={cx} y1={cy + 8} x2={cx} y2={cy + 26} stroke="#ff3b30" strokeWidth={2} />
            <circle cx={cx} cy={cy} r={3} fill="#ff3b30" />
            {/* Truncated: the crosshair sits at frame centre, so a long
                target name printed start-anchored beside it ran 75px off the
                chip. 24 characters is what half the frame holds at this
                size; the full name is in the card header directly above. */}
            <text x={cx + 30} y={cy - 8} fontSize={13} fill="#ff3b30"
                  stroke="#000" strokeWidth={2.5} paintOrder="stroke" fontWeight={700}>
              {(() => {
                const n = (dmpi.name || 'DMPI').toUpperCase();
                return n.length > 24 ? `${n.slice(0, 23)}…` : n;
              })()}
            </text>
            <text x={8} y={IMG_H - 8} fontSize={11} fill="rgba(255,255,255,0.85)"
                  stroke="#000" strokeWidth={2.5} paintOrder="stroke">
              ring 500 m{marks.length ? ` | ${marks.length} unit${marks.length !== 1 ? 's' : ''} in frame` : ''}
            </text>
        </svg>
      </div>

      <div style={sectionTitle}>AIM POINT</div>
      <div style={{
        display: 'flex', borderBottom: `1px solid ${BORDER_MED}`, flexShrink: 0,
      }}>
        {[
          { label: 'COORDS', value: formatCoord(lat, lon, coordFormat) },
          { label: 'ELEV', value: elevFt != null ? `${elevFt.toLocaleString()} ft` : '—' },
          { label: 'WEAPON', value: dmpi.weaponDelivery || '—' },
        ].map(({ label, value }) => (
          <div key={label} style={{
            flex: label === 'COORDS' ? 2 : 1, padding: '5px 10px',
            borderRight: `1px solid ${BORDER_MED}`,
          }}>
            <div style={{ fontSize: 12, color: DIM, fontWeight: 600, letterSpacing: 0.5 }}>{label}</div>
            <div style={{
              fontSize: label === 'COORDS' ? 16 : 18, color: value === '—' ? DIM : TEXT,
              fontWeight: 600, fontFamily: 'ui-monospace, monospace',
            }}>{value}</div>
          </div>
        ))}
      </div>

      {dmpi.description && (
        <div style={{ ...cell, border: 'none', color: DIM, fontSize: 15 }}>
          {dmpi.description}
        </div>
      )}

      <div style={sectionTitle}>NOTES</div>
      <div style={notesBox}>
        {notes && notes.trim() ? (
          <div style={{ fontSize: 16, color: TEXT, whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
            {notes.trim()}
          </div>
        ) : (
          [...Array(2)].map((_, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${BORDER_MED}`, height: 22, marginBottom: 2 }} />
          ))
        )}
      </div>

      <div style={footerStyle}>
        Target imagery | real-world satellite of mission coordinates | Generated by DCS:OPT
      </div>
    </div>
  );
}
