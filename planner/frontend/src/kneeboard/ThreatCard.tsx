/**
 * Threat Card — shared mission-wide kneeboard card.
 * Shows enemy air defense systems on a tile map with an inventory table.
 */

import { forward as toMGRS } from 'mgrs';
import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, DIM, ACCENT, ROW_ALT, footerStyle, notesBox, FONT, BG, W as CARD_W, MissionDateLine } from './cardStyles';
import type { ThreatRing, MissionOverviewData } from '../types/mission';
import { TileMap, createProjection } from './TileMap';
import { metersToNm } from '../utils/conversions';

/** How much of the threat picture to reveal on the kneeboard. Used as
 *  a "difficulty" slider — full intelligence for a teaching mission,
 *  vague threat areas for a realistic training scenario where pilots
 *  shouldn't know the exact SAM positions in advance.
 *
 *  - full:        every system named + ringed at its actual range,
 *                 with MGRS coords (the v0.9.5 default behaviour).
 *  - operational: rings + size info kept, but specific system
 *                 designations / MGRS hidden. Pilots see the picture
 *                 but not the briefing.
 *  - realistic:   no individual systems shown at all — just a fuzzy
 *                 threat zone per cluster, color-coded by the worst
 *                 category in that cluster. Inventory replaced by a
 *                 high-level category summary.
 */
export type ThreatFidelity = 'full' | 'operational' | 'realistic';

interface ThreatCardProps {
  threats: ThreatRing[];
  playerCoalition: string;
  overview?: MissionOverviewData;
  /** 0-based page index for multi-card pagination. Page 0 has the map
   *  + first PAGE1_ROWS inventory rows; subsequent pages carry only
   *  more inventory rows. Use threatCardPageCount() to plan. */
  page?: number;
  /** Information density — see ThreatFidelity comment. Default 'full'
   *  preserves the original behaviour for backward compatibility. */
  fidelity?: ThreatFidelity;
}

/** First-page inventory has the map above it, so it fits fewer rows
 *  than continuation pages. Tuned to the H=850 card height. */
const PAGE1_ROWS = 12;
const PAGEN_ROWS = 22;

/** Compute how many cards a given threat list needs. */
export function threatCardPageCount(props: Pick<ThreatCardProps, 'threats' | 'playerCoalition'>): number {
  const enemy = props.threats.filter((t) => t.coalition !== props.playerCoalition && t.lat != null && t.lon != null);
  if (enemy.length <= PAGE1_ROWS) return 1;
  return 1 + Math.ceil((enemy.length - PAGE1_ROWS) / PAGEN_ROWS);
}

/* ---- SAM lookup (mirrors ThreatLibraryTab) ---- */

interface SamInfo {
  nato: string;
  guidance: string;
  rangeKm: number;
  altMaxFt: number;
  category: string;
}

const SAM_DB: Record<string, SamInfo> = {
  'S-300':     { nato: 'SA-10 Grumble',   guidance: 'SAR',  rangeKm: 120, altMaxFt: 98000, category: 'strategic' },
  'Patriot':   { nato: 'MIM-104',         guidance: 'TVM',  rangeKm: 100, altMaxFt: 79000, category: 'strategic' },
  'Hawk':      { nato: 'SA-24 / MIM-23',  guidance: 'SACW', rangeKm: 45,  altMaxFt: 45000, category: 'medium' },
  'SA-11':     { nato: 'SA-11 Gadfly',    guidance: 'SAR',  rangeKm: 45,  altMaxFt: 72000, category: 'medium' },
  'Kub':       { nato: 'SA-6 Gainful',    guidance: 'SAR',  rangeKm: 24,  altMaxFt: 40000, category: 'medium' },
  'Osa':       { nato: 'SA-8 Gecko',      guidance: 'RCMD', rangeKm: 9,   altMaxFt: 16000, category: 'short' },
  'Tor':       { nato: 'SA-15 Gauntlet',  guidance: 'RCMD', rangeKm: 12,  altMaxFt: 20000, category: 'short' },
  'SA-15':     { nato: 'SA-15 Gauntlet',  guidance: 'RCMD', rangeKm: 12,  altMaxFt: 20000, category: 'short' },
  'Tunguska':  { nato: 'SA-19 Grison',    guidance: 'RDR',  rangeKm: 8,   altMaxFt: 11000, category: 'shorad' },
  '2S6':       { nato: 'SA-19 Grison',    guidance: 'RDR',  rangeKm: 8,   altMaxFt: 11000, category: 'shorad' },
  'Strela-10': { nato: 'SA-13 Gopher',    guidance: 'IR',   rangeKm: 5,   altMaxFt: 11500, category: 'shorad' },
  'Strela-1':  { nato: 'SA-9 Gaskin',     guidance: 'IR',   rangeKm: 4.2, altMaxFt: 11500, category: 'shorad' },
  'SA-9':      { nato: 'SA-9 Gaskin',     guidance: 'IR',   rangeKm: 4.2, altMaxFt: 11500, category: 'shorad' },
  'Roland':    { nato: 'Roland',          guidance: 'RCMD', rangeKm: 8,   altMaxFt: 19700, category: 'short' },
  'Avenger':   { nato: 'Avenger',         guidance: 'IR',   rangeKm: 5.5, altMaxFt: 12500, category: 'shorad' },
  'Linebacker':{ nato: 'Linebacker',      guidance: 'IR',   rangeKm: 8,   altMaxFt: 12500, category: 'shorad' },
  'Vulcan':    { nato: 'M163 VADS',       guidance: 'RDR',  rangeKm: 1.5, altMaxFt: 3000,  category: 'aaa' },
  'Shilka':    { nato: 'ZSU-23-4',        guidance: 'RDR',  rangeKm: 2.5, altMaxFt: 5000,  category: 'aaa' },
  'ZU-23':     { nato: 'ZU-23',           guidance: 'OPT',  rangeKm: 2.5, altMaxFt: 5000,  category: 'aaa' },
  'rapier':    { nato: 'Rapier',          guidance: 'RCMD', rangeKm: 7,   altMaxFt: 10000, category: 'short' },
};

function lookupSam(type: string): SamInfo | null {
  for (const [key, info] of Object.entries(SAM_DB)) {
    if (type.toLowerCase().includes(key.toLowerCase())) return info;
  }
  return null;
}

const CAT_COLORS: Record<string, string> = {
  strategic: '#f85149',
  medium:    '#d29922',
  short:     '#d29922',
  shorad:    '#3fb950',
  manpad:    '#3fb950',
  aaa:       '#8fa8c0',
};

function fmtCoord(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return '—';
  try { return toMGRS([lon, lat], 3); } catch { return '—'; }
}

export function ThreatCard({
  threats, playerCoalition, overview, page = 0, fidelity = 'full',
}: ThreatCardProps) {
  const enemy = threats.filter((t) => t.coalition !== playerCoalition && t.lat != null && t.lon != null);

  // Enrich with SAM info and sort by range descending
  const enriched = enemy.map((t) => {
    const info = lookupSam(t.type);
    return { ...t, info };
  }).sort((a, b) => (b.info?.rangeKm ?? metersToNm(b.range)) - (a.info?.rangeKm ?? metersToNm(a.range)));

  // Page slicing: page 0 holds map + first PAGE1_ROWS rows; pages 1+
  // carry additional PAGEN_ROWS rows each (no map repeated).
  const isFirstPage = page === 0;
  const pageStart = isFirstPage ? 0 : PAGE1_ROWS + (page - 1) * PAGEN_ROWS;
  const pageEnd = isFirstPage ? PAGE1_ROWS : pageStart + PAGEN_ROWS;
  const pageRows = enriched.slice(pageStart, pageEnd);
  const totalPages = enriched.length <= PAGE1_ROWS
    ? 1
    : 1 + Math.ceil((enriched.length - PAGE1_ROWS) / PAGEN_ROWS);

  // Stats
  const categories = new Map<string, number>();
  for (const t of enriched) {
    const cat = t.info?.category || 'unknown';
    categories.set(cat, (categories.get(cat) || 0) + 1);
  }

  // Note: bounds + map only matter on page 0. Page 1+ skip the map.

  // Map bounds — must encompass each threat's full engagement RING,
  // not just the threat point. With the old 'threat points + 15% pad'
  // logic, a tightly-clustered IADS would zoom in so far that long-range
  // rings (SA-11 at 45 km, S-300 at 120 km) extended way off the visible
  // map. Pilots couldn't see the ground context the rings covered.
  // Fix: compute each threat's lat/lon delta from its range in metres
  // (≈111 km per degree latitude, scales by cos(lat) for longitude),
  // and use the union of those extents as the bounds.
  const hasMap = isFirstPage && enriched.length >= 1;
  let minLat = 0, maxLat = 0, minLon = 0, maxLon = 0;
  if (hasMap) {
    const KM_PER_DEG_LAT = 111.0;
    const ringExtents = enriched
      .filter((t) => t.lat != null && t.lon != null)
      .map((t) => {
        const lat = t.lat!;
        const lon = t.lon!;
        const rangeKm = (t.range || 0) / 1000;
        // A threat with no defined range still gets a small footprint
        // so a single-AAA-point doesn't degenerate to a zero-size map.
        const effectiveRangeKm = Math.max(rangeKm, 5);
        const latDelta = effectiveRangeKm / KM_PER_DEG_LAT;
        const lonDelta = effectiveRangeKm / (KM_PER_DEG_LAT * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
        return { lat, lon, latDelta, lonDelta };
      });
    if (ringExtents.length > 0) {
      minLat = Math.min(...ringExtents.map((r) => r.lat - r.latDelta));
      maxLat = Math.max(...ringExtents.map((r) => r.lat + r.latDelta));
      minLon = Math.min(...ringExtents.map((r) => r.lon - r.lonDelta));
      maxLon = Math.max(...ringExtents.map((r) => r.lon + r.lonDelta));
      // Modest extra padding (10%) for the ground context outside the
      // furthest ring — without this the longest-range ring touches
      // the very edge of the map.
      const padLat = (maxLat - minLat) * 0.10 || 0.02;
      const padLon = (maxLon - minLon) * 0.10 || 0.02;
      minLat -= padLat;
      maxLat += padLat;
      minLon -= padLon;
      maxLon += padLon;
    }
  }

  const MAP_W = CARD_W - 32;
  const MAP_H = 300;

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          THREAT CARD
          {totalPages > 1 ? ` (${page + 1}/${totalPages})` : ''}
          {fidelity !== 'full' && (
            <span style={{ fontSize: 13, color: ACCENT, marginLeft: 8, fontWeight: 600 }}>
              [{fidelity.toUpperCase()}]
            </span>
          )}
        </div>
        <div style={subtitleStyle}>
          {/* In realistic mode we don't even tell the pilot how many
              systems are out there — just a vague "expect threats". */}
          {fidelity === 'realistic'
            ? 'Threat areas marked — specifics withheld for training realism'
            : `${enriched.length} hostile system${enriched.length !== 1 ? 's' : ''} | ${Array.from(categories.entries()).map(([cat, n]) => `${n} ${cat.toUpperCase()}`).join(', ')}`}
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Threat map */}
      {hasMap && (
        <ThreatMap
          threats={enriched}
          mapW={MAP_W}
          mapH={MAP_H}
          minLat={minLat}
          maxLat={maxLat}
          minLon={minLon}
          maxLon={maxLon}
          fidelity={fidelity}
        />
      )}

      {/* Inventory section. In 'realistic' fidelity the per-system
          inventory is replaced by a high-level category summary
          (intel-style "expect a + b in the area"). 'operational'
          keeps the table but obfuscates designation + MGRS so pilots
          see the threat picture without the briefing. 'full' is the
          original behaviour. */}
      {fidelity === 'realistic' ? (
        <RealisticInventorySummary categories={categories} />
      ) : (
        <>
          <div style={sectionTitle}>
            {isFirstPage ? 'THREAT INVENTORY' : "THREAT INVENTORY — CONT'D"}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 18 }}>#</th>
                <th style={{ ...th, textAlign: 'left' }}>DESIGNATION</th>
                {fidelity === 'full' && <th style={{ ...th, width: 40 }}>GDE</th>}
                <th style={{ ...th, width: 40 }}>RNG</th>
                <th style={{ ...th, width: 45 }}>ALT</th>
                {fidelity === 'full' && <th style={{ ...th, width: 95 }}>MGRS</th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t, i) => {
                const cat = t.info?.category || 'unknown';
                const color = CAT_COLORS[cat] || DIM;
                const absIdx = pageStart + i;
                // Operational fidelity hides system designations and
                // MGRS; pilots see "MEDIUM SAM" + range, not "SA-11".
                const designation = fidelity === 'full'
                  ? (t.info ? t.info.nato : t.type.split(' ')[0])
                  : `${cat.toUpperCase()} ${t.info ? 'SAM' : 'THREAT'}`;
                return (
                  <tr key={t.name + absIdx} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                    <td style={{ ...cell, textAlign: 'center', color: ACCENT }}>
                      {absIdx + 1}
                    </td>
                    <td style={{ ...cell, color }}>
                      {designation}
                    </td>
                    {fidelity === 'full' && (
                      <td style={{ ...cell, textAlign: 'center', color: DIM }}>
                        {t.info?.guidance || '—'}
                      </td>
                    )}
                    <td style={{ ...cell, textAlign: 'center' }}>
                      {t.info ? `${t.info.rangeKm}km` : `${metersToNm(t.range).toFixed(0)}nm`}
                    </td>
                    <td style={{ ...cell, textAlign: 'center', color: DIM }}>
                      {t.info ? `${(t.info.altMaxFt / 1000).toFixed(0)}k ft` : '—'}
                    </td>
                    {fidelity === 'full' && (
                      <td style={{ ...cell, textAlign: 'center', color: DIM }}>
                        {fmtCoord(t.lat, t.lon)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {enriched.length === 0 && (
        <div style={{ padding: '20px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No hostile air defense systems detected.
        </div>
      )}

      {/* Legend */}
      <div style={{ padding: '4px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
        {[
          { label: 'STRAT', color: '#f85149' },
          { label: 'MED', color: '#d29922' },
          { label: 'SHORT', color: '#d29922' },
          { label: 'SHORAD', color: '#3fb950' },
          { label: 'AAA', color: '#8fa8c0' },
        ].map((l) => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: l.color }} />
            <span style={{ fontSize: 17, color: DIM }}>{l.label}</span>
          </div>
        ))}
        <div style={{ fontSize: 17, color: DIM, marginLeft: 'auto' }}>
          GDE: Guidance | RNG: Range | ALT: Max alt
        </div>
      </div>

      {/* Notes */}
      <div style={sectionTitle}>NOTES</div>
      <div style={notesBox} />

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Threat Map — tile-backed map with threat rings                      */
/* ------------------------------------------------------------------ */

function ThreatMap({
  threats, mapW, mapH, minLat, maxLat, minLon, maxLon, fidelity,
}: {
  threats: (ThreatRing & { info: SamInfo | null })[];
  mapW: number;
  mapH: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  fidelity: ThreatFidelity;
}) {
  const proj = createProjection(minLat, maxLat, minLon, maxLon, mapW, mapH);

  // Cluster threats for the realistic view. Groups within ~25 km of
  // each other become a single fuzzy zone — pilots see "danger in
  // this region" instead of pinpoint positions. The cluster's color
  // reflects the worst category present (strategic > medium > short
  // > shorad > aaa).
  const clusters = fidelity === 'realistic' ? clusterThreats(threats) : [];

  return (
    <div style={{ padding: '4px 16px', borderBottom: `1px solid ${BORDER}` }}>
      <TileMap width={mapW} height={mapH} minLat={minLat} maxLat={maxLat} minLon={minLon} maxLon={maxLon}>
        <svg width={mapW} height={mapH} style={{ display: 'block' }}>
          {fidelity === 'realistic' ? (
            /* Realistic: render each cluster as a fuzzy radial gradient.
               No exact positions, no rings, no labels. */
            clusters.map((c, i) => {
              const [cx, cy] = proj.project(c.centerLat, c.centerLon);
              const r = proj.metersToPixels(c.radiusM);
              const color = CAT_COLORS[c.worstCategory] || '#d95050';
              const gid = `threat-zone-${i}`;
              return (
                <g key={gid}>
                  <defs>
                    <radialGradient id={gid} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                      <stop offset="65%" stopColor={color} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </radialGradient>
                  </defs>
                  <circle cx={cx} cy={cy} r={r} fill={`url(#${gid})`} />
                  <circle cx={cx} cy={cy} r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="2 6"
                    strokeOpacity={0.5} />
                </g>
              );
            })
          ) : (
            /* Full + operational both render per-system rings with
               accurate sizes. Operational hides the system-name label
               above the ring and the number-in-circle badge to avoid
               revealing exact positions in the inventory cross-reference. */
            threats.map((t, i) => {
              if (t.lat == null || t.lon == null) return null;
              const [tx, ty] = proj.project(t.lat, t.lon);
              const r = proj.metersToPixels(t.range);
              if (r < 2) return null;
              const cat = t.info?.category || 'unknown';
              const color = CAT_COLORS[cat] || '#d95050';
              return (
                <g key={`ring-${i}`}>
                  <circle cx={tx} cy={ty} r={r}
                    fill={`${color}10`}
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    strokeOpacity={0.6} />
                  <line x1={tx - 4} y1={ty} x2={tx + 4} y2={ty} stroke={color} strokeWidth={1} />
                  <line x1={tx} y1={ty - 4} x2={tx} y2={ty + 4} stroke={color} strokeWidth={1} />
                  {fidelity === 'full' && (
                    <>
                      <circle cx={tx} cy={ty} r={7} fill="rgba(26, 26, 26, 0.75)" />
                      <text x={tx} y={ty + 3}
                        textAnchor="middle" fontSize={8} fontFamily={FONT}
                        fill={color} fontWeight={700}>
                        {i + 1}
                      </text>
                      {r > 12 && (
                        <text x={tx} y={ty - r - 4}
                          textAnchor="middle" fontSize={7} fontFamily={FONT}
                          fill={color}
                          stroke={BG} strokeWidth={2} paintOrder="stroke">
                          {t.info?.nato.split(' ').slice(0, 2).join(' ') || t.type.split(' ')[0]}
                        </text>
                      )}
                    </>
                  )}
                </g>
              );
            })
          )}
        </svg>
      </TileMap>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Realistic-mode helpers — cluster threats into vague zones          */
/* ------------------------------------------------------------------ */

interface ThreatCluster {
  centerLat: number;
  centerLon: number;
  /** Cluster radius in meters — encompasses the threats' positions
   *  plus a fudge factor. Renders as the fuzzy zone's outer edge. */
  radiusM: number;
  count: number;
  /** Worst category present in the cluster — drives the zone color. */
  worstCategory: string;
}

const CATEGORY_PRIORITY = ['strategic', 'medium', 'short', 'shorad', 'manpad', 'aaa', 'unknown'];

function clusterThreats(
  threats: (ThreatRing & { info: SamInfo | null })[],
): ThreatCluster[] {
  // Threats within ~25 km of an existing cluster's centre join that
  // cluster; otherwise start a new one. Small dataset, O(n²) is fine.
  const CLUSTER_DIST_KM = 25;
  const KM_PER_DEG_LAT = 111;
  const clusters: {
    lats: number[]; lons: number[];
    cats: string[];
    maxRangeM: number;
  }[] = [];

  for (const t of threats) {
    if (t.lat == null || t.lon == null) continue;
    const cat = t.info?.category || 'unknown';
    let merged = false;
    for (const c of clusters) {
      const cLat = c.lats.reduce((a, b) => a + b, 0) / c.lats.length;
      const cLon = c.lons.reduce((a, b) => a + b, 0) / c.lons.length;
      const dLat = (t.lat - cLat) * KM_PER_DEG_LAT;
      const dLon = (t.lon - cLon) * KM_PER_DEG_LAT * Math.cos(cLat * Math.PI / 180);
      const dKm = Math.sqrt(dLat * dLat + dLon * dLon);
      if (dKm < CLUSTER_DIST_KM) {
        c.lats.push(t.lat);
        c.lons.push(t.lon);
        c.cats.push(cat);
        c.maxRangeM = Math.max(c.maxRangeM, t.range);
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({
        lats: [t.lat], lons: [t.lon],
        cats: [cat],
        maxRangeM: t.range,
      });
    }
  }

  return clusters.map((c) => {
    const cLat = c.lats.reduce((a, b) => a + b, 0) / c.lats.length;
    const cLon = c.lons.reduce((a, b) => a + b, 0) / c.lons.length;
    // Cluster radius: max distance from centre to any member, plus the
    // worst threat's engagement range (fuzzes the edge so a pilot
    // entering from any direction sees danger before reaching points).
    const memberDistsKm = c.lats.map((lat, i) => {
      const dLat = (lat - cLat) * KM_PER_DEG_LAT;
      const dLon = (c.lons[i] - cLon) * KM_PER_DEG_LAT * Math.cos(cLat * Math.PI / 180);
      return Math.sqrt(dLat * dLat + dLon * dLon);
    });
    const maxMemberKm = Math.max(0, ...memberDistsKm);
    const radiusM = (maxMemberKm * 1000) + c.maxRangeM;
    let worst = 'unknown';
    for (const cat of CATEGORY_PRIORITY) {
      if (c.cats.includes(cat)) { worst = cat; break; }
    }
    return {
      centerLat: cLat, centerLon: cLon,
      radiusM,
      count: c.lats.length,
      worstCategory: worst,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Realistic-mode inventory replacement                               */
/* ------------------------------------------------------------------ */

function RealisticInventorySummary({ categories }: { categories: Map<string, number> }) {
  const labels: Record<string, string> = {
    strategic: 'Strategic SAM (long-range, high-altitude)',
    medium:    'Medium-range SAM',
    short:     'Short-range SAM',
    shorad:    'SHORAD / IR threat',
    manpad:    'MANPAD',
    aaa:       'AAA',
    unknown:   'Unidentified',
  };
  const rows = CATEGORY_PRIORITY
    .map((cat) => ({ cat, n: categories.get(cat) || 0 }))
    .filter((r) => r.n > 0);
  return (
    <>
      <div style={sectionTitle}>EXPECTED RESISTANCE</div>
      <div style={{ padding: '6px 16px', fontSize: 17, color: '#cccccc', flexShrink: 0 }}>
        {rows.length === 0 ? (
          <div style={{ color: DIM, fontStyle: 'italic' }}>No air-defence threats detected.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {rows.map((r) => (
              <li key={r.cat} style={{
                color: CAT_COLORS[r.cat] || DIM,
                padding: '2px 0',
              }}>
                <span style={{ color: '#e0e0e0', fontWeight: 600, marginRight: 6 }}>
                  ×{r.n}
                </span>
                {labels[r.cat] || r.cat}
              </li>
            ))}
          </ul>
        )}
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          background: 'rgba(217, 80, 80, 0.08)',
          border: `1px solid rgba(217, 80, 80, 0.3)`,
          borderRadius: 4,
          fontSize: 14,
          color: '#cccccc',
          fontStyle: 'italic',
        }}>
          Specific positions and system designations are withheld for
          training realism. Plan as if exact intelligence is unavailable.
        </div>
      </div>
    </>
  );
}
