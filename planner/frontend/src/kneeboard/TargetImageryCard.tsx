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
import { UnitGlyph, classifyUnit } from './unitGlyphs';
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
  /** Mega-zoom variant (per-DMPI "Detail zoom" checkbox): a ~0.3 NM frame at
   *  max tile zoom, full-card size, so building-level detail resolves. Ring
   *  drops to 100 m and the corner inset is skipped — this IS the close-up. */
  detail?: boolean;
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
  const out: {
    lat: number; lon: number; type: string; coalition: string;
    category: string; heading?: number;
  }[] = [];
  for (const g of groups) {
    for (const u of g.units ?? []) {
      if (u.lat == null || u.lon == null) continue;
      if (u.lat < minLat || u.lat > maxLat || u.lon < minLon || u.lon > maxLon) continue;
      out.push({
        lat: u.lat, lon: u.lon, type: u.type, coalition: g.coalition,
        category: g.category, heading: u.heading_deg,
      });
      if (out.length >= MAX_UNIT_MARKS) return out;
    }
  }
  return out;
}

export function TargetImageryCard({
  dmpi, index, total, overview, coordFormat = 'mgrs', squadron, notes,
  opts = DEFAULT_OPTIONS, groups, detail = false,
}: TargetImageryCardProps) {
  const { lat, lon } = dmpi;
  const CHIP_HALF_NM = detail
    ? 0.16   // ~300 m half-frame — building-level
    : (opts.weapons.targetChipNm || CHIP_HALF_NM_DEFAULT);
  const maxZoom = detail ? 17 : undefined;

  // Square-ish chip: longitude degrees shrink with latitude, so scale them by
  // cos(lat) or the picture stretches badly at Kola latitudes.
  const dLat = CHIP_HALF_NM * NM_TO_DEG_LAT;
  const dLon = dLat / Math.max(0.15, Math.cos((lat * Math.PI) / 180));

  const minLat = lat - dLat, maxLat = lat + dLat;
  const minLon = lon - dLon, maxLon = lon + dLon;
  const proj = createProjection(minLat, maxLat, minLon, maxLon, IMG_W, IMG_H, maxZoom);
  const [cx, cy] = proj.project(lat, lon);
  // Scale ring: 500 m on the standard chip, 100 m on the detail frame.
  const ringM = detail ? 100 : 500;
  const ring = proj.metersToPixels(ringM);

  const elevFt = dmpi.elevation ? Math.round(metersToFeet(dmpi.elevation)) : null;

  const marks = unitsInFrame(groups, minLat, maxLat, minLon, maxLon)
    .map((u) => { const [x, y] = proj.project(u.lat, u.lon); return { ...u, x, y }; });
  // Type labels only while they stay legible — a dozen marks with text reads
  // as annotation, fifty reads as noise.
  const labelUnits = marks.length <= 12;

  const satellite = opts.nav.mapLayer !== 'dark';

  // Detail inset — the recon-print close-up box. A packed battery is a blob
  // at chip zoom; a ±350 m frame on the aim point resolves the individual
  // silhouettes. Drawn only when units sit near the aim point.
  const INSET = 190;
  const iHalfLat = 350 / 111000;
  const iHalfLon = iHalfLat / Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const insetUnits = marks.filter((u) =>
    Math.abs(u.lat - lat) < iHalfLat && Math.abs(u.lon - lon) < iHalfLon);
  const showInset = satellite && insetUnits.length > 0 && !detail;
  const iProj = createProjection(
    lat - iHalfLat, lat + iHalfLat, lon - iHalfLon, lon + iHalfLon, INSET, INSET);

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          TARGET {total > 1 ? `${index}/${total}` : ''} — {(dmpi.name || 'DMPI').toUpperCase()}{detail ? ' (DETAIL)' : ''}
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

      {/* The print. Satellite imagery in recon-photo monochrome (baked into
          the tile pixels — CSS filters don't survive the html2canvas export);
          the SVG overlay sits on top at full color so the marks carry. */}
      <div style={{
        width: IMG_W, height: IMG_H, margin: '0 auto', position: 'relative',
        overflow: 'hidden', flexShrink: 0,
      }}>
        <TileMap
          width={IMG_W}
          height={IMG_H}
          minLat={minLat}
          maxLat={maxLat}
          minLon={minLon}
          maxLon={maxLon}
          layer={satellite ? 'satellite' : 'dark'}
          mono={satellite}
          maxZoom={maxZoom}
        />
        <svg width={IMG_W} height={IMG_H} style={{ position: 'absolute', inset: 0 }}>
            {/* 500 m scale ring */}
            <circle cx={cx} cy={cy} r={ring} fill="none"
                    stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeDasharray="4 4" />
            {/* Units in frame — oriented silhouettes by type and coalition,
                rotated to each unit's actual mission heading, so the crew
                sees what's parked at the aim point and which way it faces. */}
            {marks.map((u, i) => (
              <g key={i}>
                <UnitGlyph x={u.x} y={u.y} headingDeg={u.heading}
                           kind={classifyUnit(u.type, u.category)}
                           color={UNIT_COLOR[u.coalition] || UNIT_COLOR.neutrals} />
                {labelUnits && (
                  <text x={u.x + 11} y={u.y + 4} fontSize={10} fontWeight={700}
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
              ring {ringM} m{marks.length ? ` | ${marks.length} unit${marks.length !== 1 ? 's' : ''} in frame (marks not to scale)` : ''}
            </text>
        </svg>

        {/* Detail inset — ±350 m close-up on the aim point so the individual
            silhouettes resolve instead of clustering into a blob. */}
        {showInset && (
          <div style={{
            position: 'absolute', right: 6, bottom: 20, width: INSET, height: INSET,
            border: '2px solid rgba(255,255,255,0.9)', overflow: 'hidden',
            boxShadow: '0 0 8px rgba(0,0,0,0.8)',
          }}>
            <TileMap width={INSET} height={INSET}
                     minLat={lat - iHalfLat} maxLat={lat + iHalfLat}
                     minLon={lon - iHalfLon} maxLon={lon + iHalfLon}
                     layer="satellite" hideCredit mono />
            <svg width={INSET} height={INSET} style={{ position: 'absolute', inset: 0 }}>
              {insetUnits.map((u, i) => {
                const [ix, iy] = iProj.project(u.lat, u.lon);
                return (
                  <UnitGlyph key={i} x={ix} y={iy} headingDeg={u.heading}
                             kind={classifyUnit(u.type, u.category)}
                             color={UNIT_COLOR[u.coalition] || UNIT_COLOR.neutrals} />
                );
              })}
              <text x={5} y={INSET - 6} fontSize={10} fontWeight={700}
                    fill="rgba(255,255,255,0.9)" stroke="#000" strokeWidth={2}
                    paintOrder="stroke">
                DETAIL — 700 m frame
              </text>
            </svg>
          </div>
        )}
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

      {/* Notes only when typed (v1.19.136) — no empty box. */}
      {notes && notes.trim() && (<>
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
      </>)}

      <div style={footerStyle}>
        Target imagery | real-world satellite of mission coordinates | Generated by DCS:OPT
      </div>
    </div>
  );
}
