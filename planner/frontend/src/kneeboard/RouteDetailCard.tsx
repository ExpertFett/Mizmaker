/**
 * Route Detail Card — per-flight kneeboard card.
 * Shows route with threat proximity analysis and terrain notes.
 * (Text-based — map overlay version is a future enhancement.)
 */

import { forward as toMGRS } from 'mgrs';
import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, BG, TEXT, DIM, ACCENT, ROW_ALT, WARN, footerStyle, notesBox, FONT, W as CARD_W, MissionDateLine } from './cardStyles';
import type { MissionGroup, ThreatRing, MissionOverviewData, Waypoint } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { metersToFeet, metersToNm } from '../utils/conversions';
import { TileMap, createProjection } from './TileMap';

interface RouteDetailCardProps {
  group: MissionGroup;
  threats: ThreatRing[];
  overview?: MissionOverviewData;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
}

function distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const R = 6371000;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function fmtCoord(lat?: number, lon?: number): string {
  if (lat == null || lon == null) return '—';
  try { return toMGRS([lon, lat], 3); } catch { return '—'; }
}

export function RouteDetailCard({ group, threats, overview, notes }: RouteDetailCardProps) {
  const airframe = getAircraftType(group);
  const wps = group.waypoints;
  const enemyThreats = threats.filter((t) => t.coalition !== group.coalition);

  // For each waypoint, find nearest threat and check if within engagement zone
  const wpThreats = wps.map((wp) => {
    if (wp.lat == null || wp.lon == null) return { nearest: null, inRange: false, dist: 0 };
    let nearest: ThreatRing | null = null;
    let minDist = Infinity;
    for (const t of enemyThreats) {
      if (t.lat == null || t.lon == null) continue;
      const d = distance(wp.lat, wp.lon, t.lat, t.lon);
      if (d < minDist) { minDist = d; nearest = t; }
    }
    return { nearest, inRange: nearest ? minDist <= nearest.range : false, dist: minDist };
  });

  // Find legs where route passes near threats
  const threatWarnings: { leg: string; threat: string; dist: number; brg: number }[] = [];
  for (let i = 1; i < wps.length; i++) {
    const wp = wps[i];
    if (wp.lat == null || wp.lon == null) continue;
    for (const t of enemyThreats) {
      if (t.lat == null || t.lon == null) continue;
      const d = distance(wp.lat, wp.lon, t.lat, t.lon);
      if (d <= t.range * 1.5) { // Within 150% of threat range
        const brg = bearing(wp.lat, wp.lon, t.lat, t.lon);
        threatWarnings.push({
          leg: `WP${wps[i - 1].waypoint_number}→${wp.waypoint_number}`,
          threat: `${t.name} (${t.type.split(' ')[0]})`,
          dist: d,
          brg,
        });
      }
    }
  }
  // Deduplicate by threat name per leg
  const uniqueWarnings = threatWarnings.filter((w, i, arr) =>
    arr.findIndex((x) => x.leg === w.leg && x.threat === w.threat) === i,
  ).slice(0, 12);

  return (
    <div style={{ ...cardRoot, position: 'relative' }}>
      <div style={headerStyle}>
        <div style={titleStyle}>ROUTE DETAIL — {group.groupName.toUpperCase()}</div>
        <div style={subtitleStyle}>
          {airframe} | {wps.length} waypoints | {enemyThreats.length} known threats
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Visual route map — terrain tiles with the flight's route line,
          DEP/ARR/WP markers, leg-distance labels and enemy threat rings.
          (v0.9.71) Reuses the TileMap + projection used by the Threat
          Card. Only renders when the route has ≥2 plottable waypoints. */}
      <RouteMap group={group} threats={enemyThreats} />

      {/* Route summary with threat proximity */}
      <div style={sectionTitle}>ROUTE WAYPOINTS</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 28 }}>WP</th>
            <th style={{ ...th, textAlign: 'left', width: 60 }}>NAME</th>
            <th style={{ ...th, width: 100 }}>MGRS</th>
            <th style={{ ...th, width: 50 }}>ALT</th>
            <th style={{ ...th, width: 40 }}>HDG</th>
            <th style={{ ...th, width: 40 }}>DIST</th>
            <th style={{ ...th, textAlign: 'left' }}>NEAREST THREAT</th>
          </tr>
        </thead>
        <tbody>
          {wps.map((wp, i) => {
            const t = wpThreats[i];
            const threatDist = t.nearest ? metersToNm(t.dist) : null;
            return (
              <tr key={wp.waypoint_number} style={{
                background: t.inRange ? 'rgba(217, 80, 80, 0.1)' : i % 2 === 0 ? 'transparent' : ROW_ALT,
              }}>
                <td style={{ ...cell, textAlign: 'center', color: ACCENT, fontWeight: 600 }}>{wp.waypoint_number}</td>
                <td style={{ ...cell }}>{(wp.waypoint_name || '').substring(0, 8)}</td>
                <td style={{ ...cell, textAlign: 'center', color: DIM }}>{fmtCoord(wp.lat, wp.lon)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {Math.round(metersToFeet(wp.altitude_m)).toLocaleString()}
                </td>
                <td style={{ ...cell, textAlign: 'center', color: DIM }}>
                  {wp.leg_bearing_deg != null ? `${Math.round(wp.leg_bearing_deg).toString().padStart(3, '0')}` : '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {wp.leg_distance_nm ? wp.leg_distance_nm.toFixed(1) : '—'}
                </td>
                <td style={{
                  ...cell,
                  color: t.inRange ? '#d95050' : threatDist && threatDist < 30 ? WARN : DIM,
                }}>
                  {t.nearest
                    ? `${t.nearest.type.split(' ')[0]} ${threatDist!.toFixed(0)}nm${t.inRange ? ' ⚠ IN RANGE' : ''}`
                    : '—'
                  }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Threat warnings */}
      {uniqueWarnings.length > 0 && (
        <>
          <div style={{ ...sectionTitle, color: '#d95050' }}>THREAT WARNINGS</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 80 }}>LEG</th>
                <th style={{ ...th, textAlign: 'left' }}>THREAT</th>
                <th style={{ ...th, width: 60 }}>DIST</th>
                <th style={{ ...th, width: 50 }}>BRG</th>
              </tr>
            </thead>
            <tbody>
              {uniqueWarnings.map((w, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell, color: ACCENT }}>{w.leg}</td>
                  <td style={{ ...cell, color: WARN }}>{w.threat}</td>
                  <td style={{ ...cell, textAlign: 'right', color: TEXT }}>
                    {metersToNm(w.dist).toFixed(0)} nm
                  </td>
                  <td style={{ ...cell, textAlign: 'center', color: DIM }}>
                    {Math.round(w.brg).toString().padStart(3, '0')}°
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Threat inventory */}
      {enemyThreats.length > 0 && (
        <>
          <div style={sectionTitle}>THREAT INVENTORY</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>SYSTEM</th>
                <th style={{ ...th, width: 60 }}>RANGE</th>
                <th style={{ ...th, width: 100 }}>MGRS</th>
              </tr>
            </thead>
            <tbody>
              {enemyThreats.slice(0, 6).map((t, i) => (
                <tr key={t.name + i} style={{ background: i % 2 === 0 ? 'transparent' : ROW_ALT }}>
                  <td style={{ ...cell }}>{t.name}</td>
                  <td style={{ ...cell, textAlign: 'right', color: WARN }}>
                    {metersToNm(t.range).toFixed(0)} nm
                  </td>
                  <td style={{ ...cell, textAlign: 'center', color: DIM }}>{fmtCoord(t.lat, t.lon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Notes — only rendered when the planner typed one. The map +
          three tables already fill most of the card; a blank ruled
          NOTES box would overflow, so we drop it unless there's
          content to show. (v0.9.71) */}
      {notes && notes.trim() && (
        <>
          <div style={{ ...sectionTitle, marginTop: 6 }}>NOTES</div>
          <div style={notesBox}>
            <div style={{
              fontSize: 17, color: TEXT,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
            }}>
              {notes.trim()}
            </div>
          </div>
        </>
      )}

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Route Map — tile-backed map with the flight's route + threat rings  */
/* ------------------------------------------------------------------ */

// cardRoot has 12px padding each side → usable width is W - 24.
const ROUTE_MAP_W = CARD_W - 24;
const ROUTE_MAP_H = 240;
const KM_PER_DEG_LAT = 111;
const NICE_SCALE_NM = [5, 10, 20, 25, 50, 100, 150, 200, 300];

function RouteMap({ group, threats }: { group: MissionGroup; threats: ThreatRing[] }) {
  // Plottable waypoints — need at least two to draw a line.
  const pts = group.waypoints.filter(
    (w): w is Waypoint & { lat: number; lon: number } => w.lat != null && w.lon != null,
  );
  if (pts.length < 2) return null;

  const enemy = threats.filter(
    (t): t is ThreatRing & { lat: number; lon: number } => t.lat != null && t.lon != null,
  );

  // Bounds = union of the route points and each threat's full ring
  // extent (so a long-range SAM ring isn't clipped off the map edge).
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const extend = (lat: number, lon: number) => {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  };
  for (const p of pts) extend(p.lat, p.lon);
  for (const t of enemy) {
    const rangeKm = Math.max((t.range || 0) / 1000, 5);
    const latD = rangeKm / KM_PER_DEG_LAT;
    const lonD = rangeKm / (KM_PER_DEG_LAT * Math.max(Math.cos(t.lat * Math.PI / 180), 0.01));
    extend(t.lat - latD, t.lon - lonD);
    extend(t.lat + latD, t.lon + lonD);
  }
  const padLat = (maxLat - minLat) * 0.12 || 0.02;
  const padLon = (maxLon - minLon) * 0.12 || 0.02;
  minLat -= padLat; maxLat += padLat; minLon -= padLon; maxLon += padLon;

  const proj = createProjection(minLat, maxLat, minLon, maxLon, ROUTE_MAP_W, ROUTE_MAP_H);
  const projected = pts.map((p) => {
    const [x, y] = proj.project(p.lat, p.lon);
    return { x, y, wp: p };
  });
  const polyline = projected.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Scale bar — largest "nice" nm distance whose pixel length fits ~110px.
  const pxPerNm = proj.metersToPixels(1852);
  let scaleNm = NICE_SCALE_NM[0];
  for (const n of NICE_SCALE_NM) { if (n * pxPerNm <= 110) scaleNm = n; }
  const scalePx = Math.max(8, scaleNm * pxPerNm);
  const scaleX1 = ROUTE_MAP_W - 14 - scalePx;
  const scaleY = ROUTE_MAP_H - 14;

  return (
    <div style={{ padding: '0 0 6px' }}>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
        <TileMap
          width={ROUTE_MAP_W}
          height={ROUTE_MAP_H}
          minLat={minLat}
          maxLat={maxLat}
          minLon={minLon}
          maxLon={maxLon}
        >
          <svg width={ROUTE_MAP_W} height={ROUTE_MAP_H} style={{ display: 'block' }}>
            {/* Enemy threat rings — dashed engagement circles + crosshair */}
            {enemy.map((t, i) => {
              const [tx, ty] = proj.project(t.lat, t.lon);
              const r = proj.metersToPixels(t.range || 0);
              if (r < 2) return null;
              const color = '#d95050';
              return (
                <g key={`tr-${i}`}>
                  <circle cx={tx} cy={ty} r={r}
                    fill={`${color}14`} stroke={color} strokeWidth={1}
                    strokeDasharray="4 3" strokeOpacity={0.75} />
                  <line x1={tx - 4} y1={ty} x2={tx + 4} y2={ty} stroke={color} strokeWidth={1} />
                  <line x1={tx} y1={ty - 4} x2={tx} y2={ty + 4} stroke={color} strokeWidth={1} />
                </g>
              );
            })}

            {/* Route line */}
            <polyline points={polyline} fill="none"
              stroke="#4ad0e0" strokeWidth={2.5} strokeOpacity={0.95}
              strokeLinejoin="round" strokeLinecap="round" />

            {/* Leg distance labels at each leg midpoint */}
            {projected.slice(1).map((b, i) => {
              const a = projected[i];
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const distNm = b.wp.leg_distance_nm;
              if (!distNm) return null;
              return (
                <text key={`leg-${i}`} x={mx} y={my - 3} textAnchor="middle"
                  fontSize={9} fontFamily={FONT} fontWeight={600}
                  fill="#cfeff5" stroke={BG} strokeWidth={2.5} paintOrder="stroke">
                  {distNm.toFixed(0)}nm
                </text>
              );
            })}

            {/* Waypoint markers — DEP (green) / ARR (red) / mid (amber) */}
            {projected.map((p, i) => {
              const isFirst = i === 0;
              const isLast = i === projected.length - 1;
              const color = isFirst ? '#3fb950' : isLast ? '#d95050' : '#ffb24a';
              const label = isFirst ? 'DEP' : isLast ? 'ARR'
                : (p.wp.waypoint_name || `WP${p.wp.waypoint_number}`).substring(0, 6);
              const big = isFirst || isLast;
              return (
                <g key={`wp-${i}`}>
                  <circle cx={p.x} cy={p.y} r={big ? 6 : 4}
                    fill={color} stroke={BG} strokeWidth={1.5} />
                  <text x={p.x} y={p.y - (big ? 10 : 8)} textAnchor="middle"
                    fontSize={big ? 10 : 9} fontFamily={FONT} fontWeight={700}
                    fill={color} stroke={BG} strokeWidth={2.5} paintOrder="stroke">
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Scale bar (bottom-right) */}
            <g>
              <rect x={scaleX1 - 4} y={scaleY - 12} width={scalePx + 8} height={20}
                fill="rgba(26,26,26,0.6)" rx={2} />
              <line x1={scaleX1} y1={scaleY} x2={scaleX1 + scalePx} y2={scaleY}
                stroke="#fff" strokeWidth={2} />
              <line x1={scaleX1} y1={scaleY - 3} x2={scaleX1} y2={scaleY + 3} stroke="#fff" strokeWidth={2} />
              <line x1={scaleX1 + scalePx} y1={scaleY - 3} x2={scaleX1 + scalePx} y2={scaleY + 3} stroke="#fff" strokeWidth={2} />
              <text x={scaleX1 + scalePx / 2} y={scaleY - 4} textAnchor="middle"
                fontSize={9} fontFamily={FONT} fontWeight={600} fill="#fff">
                {scaleNm} nm
              </text>
            </g>
          </svg>
        </TileMap>
      </div>
    </div>
  );
}
