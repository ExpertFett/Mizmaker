/**
 * Route Detail Card — per-flight kneeboard card.
 * Shows route with threat proximity analysis and terrain notes.
 * (Text-based — map overlay version is a future enhancement.)
 */

import { forward as toMGRS } from 'mgrs';
import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, cell, th, BORDER, TEXT, DIM, ACCENT, ROW_ALT, WARN, footerStyle, W as CARD_W } from './cardStyles';
import type { MissionGroup, ThreatRing, Waypoint } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { metersToFeet, metersToNm } from '../utils/conversions';
import { TileMap, createProjection } from './TileMap';

const FONT = "'Consolas', 'Courier New', monospace";

interface RouteDetailCardProps {
  group: MissionGroup;
  threats: ThreatRing[];
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

export function RouteDetailCard({ group, threats }: RouteDetailCardProps) {
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
      </div>

      {/* Route + Threat Map */}
      <RouteDetailMap waypoints={wps} threats={enemyThreats} coalition={group.coalition} />

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
              {enemyThreats.slice(0, 10).map((t, i) => (
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

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Route + Threat Map with real map tiles                              */
/* ------------------------------------------------------------------ */

function RouteDetailMap({ waypoints, threats, coalition }: {
  waypoints: Waypoint[];
  threats: ThreatRing[];
  coalition: string;
}) {
  const wps = waypoints.filter((w) => w.lat != null && w.lon != null);
  if (wps.length < 2) return null;

  const MAP_W = CARD_W - 32;
  const MAP_H = 260;

  // Compute bounds from route + nearby threats
  const routeLats = wps.map((w) => w.lat!);
  const routeLons = wps.map((w) => w.lon!);
  let minLat = Math.min(...routeLats);
  let maxLat = Math.max(...routeLats);
  let minLon = Math.min(...routeLons);
  let maxLon = Math.max(...routeLons);

  const latSpan = maxLat - minLat || 0.1;
  const lonSpan = maxLon - minLon || 0.1;
  for (const t of threats) {
    if (t.lat == null || t.lon == null) continue;
    if (t.lat >= minLat - latSpan && t.lat <= maxLat + latSpan &&
        t.lon >= minLon - lonSpan && t.lon <= maxLon + lonSpan) {
      minLat = Math.min(minLat, t.lat);
      maxLat = Math.max(maxLat, t.lat);
      minLon = Math.min(minLon, t.lon);
      maxLon = Math.max(maxLon, t.lon);
    }
  }

  // Add 10% padding to bounds
  const padLat = (maxLat - minLat) * 0.1 || 0.01;
  const padLon = (maxLon - minLon) * 0.1 || 0.01;
  minLat -= padLat;
  maxLat += padLat;
  minLon -= padLon;
  maxLon += padLon;

  const proj = createProjection(minLat, maxLat, minLon, maxLon, MAP_W, MAP_H);

  // Route polyline
  const routePoints = wps.map((w) => proj.project(w.lat!, w.lon!));
  const polyline = routePoints.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <div style={{ padding: '4px 16px', borderBottom: `1px solid ${BORDER}` }}>
      <TileMap width={MAP_W} height={MAP_H} minLat={minLat} maxLat={maxLat} minLon={minLon} maxLon={maxLon}>
        <svg width={MAP_W} height={MAP_H} style={{ display: 'block' }}>
          {/* Threat rings */}
          {threats.map((t, i) => {
            if (t.lat == null || t.lon == null) return null;
            const [tx, ty] = proj.project(t.lat, t.lon);
            const r = proj.metersToPixels(t.range);
            if (r < 2) return null;
            const isRed = t.coalition === 'red' || t.coalition !== coalition;
            return (
              <g key={`threat-${i}`}>
                <circle cx={tx} cy={ty} r={r}
                  fill={isRed ? 'rgba(217, 80, 80, 0.1)' : 'rgba(74, 143, 212, 0.08)'}
                  stroke={isRed ? 'rgba(217, 80, 80, 0.5)' : 'rgba(74, 143, 212, 0.4)'}
                  strokeWidth={1} strokeDasharray="4 2" />
                <line x1={tx - 3} y1={ty} x2={tx + 3} y2={ty}
                  stroke={isRed ? '#d95050' : '#4a8fd4'} strokeWidth={1} />
                <line x1={tx} y1={ty - 3} x2={tx} y2={ty + 3}
                  stroke={isRed ? '#d95050' : '#4a8fd4'} strokeWidth={1} />
                {r > 15 && (
                  <text x={tx} y={ty + r + 10}
                    textAnchor="middle" fontSize={7} fontFamily={FONT}
                    fill={isRed ? 'rgba(217, 80, 80, 0.8)' : 'rgba(74, 143, 212, 0.7)'}
                    stroke="#060d14" strokeWidth={2} paintOrder="stroke">
                    {t.type.split(' ')[0]}
                  </text>
                )}
              </g>
            );
          })}

          {/* Route line with glow */}
          <polyline points={polyline} fill="none" stroke="rgba(74, 143, 212, 0.3)" strokeWidth={5} strokeLinejoin="round" />
          <polyline points={polyline} fill="none" stroke="#4a8fd4" strokeWidth={2} strokeLinejoin="round" />

          {/* Direction arrows + leg distances */}
          {routePoints.map(([x, y], i) => {
            if (i === 0) return null;
            const [px, py] = routePoints[i - 1];
            const mx = (px + x) / 2;
            const my = (py + y) / 2;
            const angle = Math.atan2(y - py, x - px) * 180 / Math.PI;
            const dist = wps[i].leg_distance_nm;
            const offX = Math.sin(angle * Math.PI / 180) * 10;
            const offY = -Math.cos(angle * Math.PI / 180) * 10;
            return (
              <g key={`arr${i}`}>
                <polygon points={`${mx - 4},-3 ${mx + 4},0 ${mx - 4},3`} fill="#4a8fd4" opacity={0.6}
                  transform={`translate(${mx},${my}) rotate(${angle}) translate(${-mx},${-my})`} />
                {dist && dist >= 0.5 && (
                  <text x={mx + offX} y={my + offY} textAnchor="middle" fontSize={7}
                    fill="#7ab8e8" fontFamily={FONT}
                    stroke="#060d14" strokeWidth={2} paintOrder="stroke">
                    {dist.toFixed(0)}nm
                  </text>
                )}
              </g>
            );
          })}

          {/* Waypoint dots + labels */}
          {routePoints.map(([x, y], i) => {
            const wp = wps[i];
            const isFirst = i === 0;
            const isLast = i === wps.length - 1;
            const r = isFirst || isLast ? 5 : 3.5;
            const color = isFirst ? '#3fb950' : isLast ? '#f85149' : '#4a8fd4';
            return (
              <g key={`wp${i}`}>
                <circle cx={x} cy={y} r={r + 1.5} fill="rgba(6, 13, 20, 0.6)" />
                <circle cx={x} cy={y} r={r} fill={color} stroke="#0a1520" strokeWidth={1.5} />
                <text x={x + (isFirst || isLast ? 8 : 0)} y={y - r - 4}
                  textAnchor={isFirst || isLast ? 'start' : 'middle'} fontSize={8} fontFamily={FONT}
                  fill={isFirst || isLast ? color : '#ccdae8'}
                  fontWeight={isFirst || isLast ? 700 : 500}
                  stroke="#060d14" strokeWidth={2} paintOrder="stroke">
                  {isFirst ? 'DEP' : isLast ? 'ARR' : `${wp.waypoint_number}`}
                </text>
              </g>
            );
          })}

          {/* Scale bar */}
          {(() => {
            const nmInMeters = 1852;
            const testNm = [1, 2, 5, 10, 20, 50, 100, 200];
            let barNm = 5;
            let barPx = 0;
            for (const nm of testNm) {
              barPx = proj.metersToPixels(nm * nmInMeters);
              if (barPx >= 40 && barPx <= 120) { barNm = nm; break; }
            }
            if (barPx <= 0) return null;
            return (
              <g>
                <rect x={MAP_W - 20 - barPx} y={MAP_H - 22} width={barPx + 8} height={14}
                  fill="rgba(6, 13, 20, 0.85)" rx={2} />
                <line x1={MAP_W - 16 - barPx} y1={MAP_H - 12} x2={MAP_W - 16} y2={MAP_H - 12}
                  stroke={DIM} strokeWidth={1} />
                <line x1={MAP_W - 16 - barPx} y1={MAP_H - 15} x2={MAP_W - 16 - barPx} y2={MAP_H - 9}
                  stroke={DIM} strokeWidth={1} />
                <line x1={MAP_W - 16} y1={MAP_H - 15} x2={MAP_W - 16} y2={MAP_H - 9}
                  stroke={DIM} strokeWidth={1} />
                <text x={MAP_W - 16 - barPx / 2} y={MAP_H - 16}
                  textAnchor="middle" fontSize={7} fill={DIM} fontFamily={FONT}>
                  {barNm} nm
                </text>
              </g>
            );
          })()}
        </svg>
      </TileMap>
    </div>
  );
}
