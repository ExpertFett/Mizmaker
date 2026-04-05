/**
 * Threat Card — shared mission-wide kneeboard card.
 * Shows enemy air defense systems on a tile map with an inventory table.
 */

import { forward as toMGRS } from 'mgrs';
import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, DIM, ACCENT, ROW_ALT, footerStyle, W as CARD_W } from './cardStyles';
import type { ThreatRing } from '../types/mission';
import { TileMap, createProjection } from './TileMap';
import { metersToNm } from '../utils/conversions';

const FONT = "'Consolas', 'Courier New', monospace";

interface ThreatCardProps {
  threats: ThreatRing[];
  playerCoalition: string;
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

export function ThreatCard({ threats, playerCoalition }: ThreatCardProps) {
  const enemy = threats.filter((t) => t.coalition !== playerCoalition && t.lat != null && t.lon != null);

  // Enrich with SAM info and sort by range descending
  const enriched = enemy.map((t) => {
    const info = lookupSam(t.type);
    return { ...t, info };
  }).sort((a, b) => (b.info?.rangeKm ?? metersToNm(b.range)) - (a.info?.rangeKm ?? metersToNm(a.range)));

  // Stats
  const categories = new Map<string, number>();
  for (const t of enriched) {
    const cat = t.info?.category || 'unknown';
    categories.set(cat, (categories.get(cat) || 0) + 1);
  }

  // Map bounds
  const hasMap = enriched.length >= 1;
  let minLat = 0, maxLat = 0, minLon = 0, maxLon = 0;
  if (hasMap) {
    const lats = enriched.map((t) => t.lat!);
    const lons = enriched.map((t) => t.lon!);
    minLat = Math.min(...lats);
    maxLat = Math.max(...lats);
    minLon = Math.min(...lons);
    maxLon = Math.max(...lons);
    const padLat = (maxLat - minLat) * 0.15 || 0.05;
    const padLon = (maxLon - minLon) * 0.15 || 0.05;
    minLat -= padLat;
    maxLat += padLat;
    minLon -= padLon;
    maxLon += padLon;
  }

  const MAP_W = CARD_W - 32;
  const MAP_H = 300;

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>THREAT CARD</div>
        <div style={subtitleStyle}>
          {enriched.length} hostile system{enriched.length !== 1 ? 's' : ''} |
          {Array.from(categories.entries()).map(([cat, n]) => ` ${n} ${cat.toUpperCase()}`).join(',')}
        </div>
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
        />
      )}

      {/* Inventory table */}
      <div style={sectionTitle}>THREAT INVENTORY</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 18 }}>#</th>
            <th style={{ ...th, textAlign: 'left' }}>DESIGNATION</th>
            <th style={{ ...th, width: 40 }}>GDE</th>
            <th style={{ ...th, width: 40 }}>RNG</th>
            <th style={{ ...th, width: 45 }}>ALT</th>
            <th style={{ ...th, width: 95 }}>MGRS</th>
          </tr>
        </thead>
        <tbody>
          {enriched.slice(0, 20).map((t, i) => {
            const cat = t.info?.category || 'unknown';
            const color = CAT_COLORS[cat] || DIM;
            return (
              <tr key={t.name + i} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                <td style={{ ...cell, textAlign: 'center', fontSize: 8, color: ACCENT, padding: '2px 3px' }}>
                  {i + 1}
                </td>
                <td style={{ ...cell, fontSize: 8, padding: '2px 4px', color }}>
                  {t.info ? t.info.nato : t.type.split(' ')[0]}
                </td>
                <td style={{ ...cell, textAlign: 'center', fontSize: 7, padding: '2px 3px', color: DIM }}>
                  {t.info?.guidance || '—'}
                </td>
                <td style={{ ...cell, textAlign: 'center', fontSize: 8, padding: '2px 3px' }}>
                  {t.info ? `${t.info.rangeKm}km` : `${metersToNm(t.range).toFixed(0)}nm`}
                </td>
                <td style={{ ...cell, textAlign: 'center', fontSize: 7, padding: '2px 3px', color: DIM }}>
                  {t.info ? `${(t.info.altMaxFt / 1000).toFixed(0)}k ft` : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'center', fontSize: 7, padding: '2px 3px', color: DIM }}>
                  {fmtCoord(t.lat, t.lon)}
                </td>
              </tr>
            );
          })}
          {enriched.length > 20 && (
            <tr>
              <td colSpan={6} style={{ ...cell, textAlign: 'center', fontSize: 8, color: DIM, padding: '2px 4px' }}>
                +{enriched.length - 20} more systems
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {enriched.length === 0 && (
        <div style={{ padding: '20px 16px', fontSize: 12, color: DIM, textAlign: 'center' }}>
          No hostile air defense systems detected.
        </div>
      )}

      {/* Legend */}
      <div style={{ padding: '4px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', borderTop: `1px solid ${BORDER}` }}>
        {[
          { label: 'STRAT', color: '#f85149' },
          { label: 'MED', color: '#d29922' },
          { label: 'SHORT', color: '#d29922' },
          { label: 'SHORAD', color: '#3fb950' },
          { label: 'AAA', color: '#8fa8c0' },
        ].map((l) => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: l.color }} />
            <span style={{ fontSize: 7, color: DIM }}>{l.label}</span>
          </div>
        ))}
        <div style={{ fontSize: 7, color: DIM, marginLeft: 'auto' }}>
          GDE: Guidance | RNG: Engagement range | ALT: Max altitude
        </div>
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Threat Map — tile-backed map with threat rings                      */
/* ------------------------------------------------------------------ */

function ThreatMap({ threats, mapW, mapH, minLat, maxLat, minLon, maxLon }: {
  threats: (ThreatRing & { info: SamInfo | null })[];
  mapW: number;
  mapH: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}) {
  const proj = createProjection(minLat, maxLat, minLon, maxLon, mapW, mapH);

  return (
    <div style={{ padding: '4px 16px', borderBottom: `1px solid ${BORDER}` }}>
      <TileMap width={mapW} height={mapH} minLat={minLat} maxLat={maxLat} minLon={minLon} maxLon={maxLon}>
        <svg width={mapW} height={mapH} style={{ display: 'block' }}>
          {/* Threat engagement envelopes */}
          {threats.map((t, i) => {
            if (t.lat == null || t.lon == null) return null;
            const [tx, ty] = proj.project(t.lat, t.lon);
            const r = proj.metersToPixels(t.range);
            if (r < 2) return null;
            const cat = t.info?.category || 'unknown';
            const color = CAT_COLORS[cat] || '#d95050';
            return (
              <g key={`ring-${i}`}>
                {/* Engagement zone fill */}
                <circle cx={tx} cy={ty} r={r}
                  fill={`${color}10`}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="4 2"
                  strokeOpacity={0.6} />
                {/* Center crosshair */}
                <line x1={tx - 4} y1={ty} x2={tx + 4} y2={ty} stroke={color} strokeWidth={1} />
                <line x1={tx} y1={ty - 4} x2={tx} y2={ty + 4} stroke={color} strokeWidth={1} />
                {/* Number label */}
                <circle cx={tx} cy={ty} r={7} fill="rgba(6, 13, 20, 0.75)" />
                <text x={tx} y={ty + 3}
                  textAnchor="middle" fontSize={8} fontFamily={FONT}
                  fill={color} fontWeight={700}>
                  {i + 1}
                </text>
                {/* System name above ring */}
                {r > 12 && (
                  <text x={tx} y={ty - r - 4}
                    textAnchor="middle" fontSize={7} fontFamily={FONT}
                    fill={color}
                    stroke="#060d14" strokeWidth={2} paintOrder="stroke">
                    {t.info?.nato.split(' ').slice(0, 2).join(' ') || t.type.split(' ')[0]}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </TileMap>
    </div>
  );
}
