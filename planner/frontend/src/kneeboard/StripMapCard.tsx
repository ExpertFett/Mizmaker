/**
 * Strip Map Card (v1.19.72, task #50) — per-flight kneeboard card
 * with a north-up route map and a "doghouse" annotation at each leg
 * midpoint carrying MC / DIST / TIME / ALT. Modelled on the
 * combatflite strip-map output but Tier A scope: north-up only (no
 * route rotation), single page per flight, no fuel/threat annotation
 * yet — those are Tier B follow-ups for once testers tell us what
 * doghouse fields they actually use.
 *
 * The card renders pure SVG (no OpenLayers tile loading inside the
 * card itself) so it goes through the existing `renderCardToBlob`
 * html-to-canvas pipeline without surprises. Coordinates project via
 * a simple cos(centerLat)-scaled equirectangular onto the SVG
 * viewBox, with a 10% margin around the waypoint bounds.
 */

import { metersToFeet, msToKnots } from '../utils/conversions';
import type { Waypoint, MissionGroup, MissionOverviewData } from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { MissionDateLine } from './cardStyles';

interface StripMapCardProps {
  group: MissionGroup;
  overview?: MissionOverviewData;
  notes?: string;
}

const W = 600;
const H = 850;
const FONT = "'Arial', sans-serif";
const BG = 'var(--kb-bg, #1a1a1a)';
const BG_NOTES = 'var(--kb-notes-bg, #4a4a4a)';
const BORDER = 'var(--kb-border, #444)';
const BORDER_MED = 'var(--kb-border-med, #555)';
const BORDER_LIGHT = 'var(--kb-border-light, #666)';
const TEXT = 'var(--kb-text, #e0e0e0)';
const TEXT_BRIGHT = 'var(--kb-text-bright, #fff)';
const TEXT_MUTED = 'var(--kb-text-muted, #ccc)';
const ACCENT = '#ffa500';

// Strip-map SVG area dimensions inside the card. Header + footer eat
// the rest of the 600×850 canvas.
const MAP_W = 576;
const MAP_H = 620;
const MAP_PADDING_PCT = 0.10;

interface Projected {
  x: number;
  y: number;
  wp: Waypoint;
}

/**
 * Equirectangular projection from lat/lon to SVG pixel coordinates.
 *
 * `centerLat` is used to scale longitude (1° lon shrinks toward the
 * poles); we project relative to the route's centre so distortion is
 * minimised across the visible area. Output is then linearly scaled
 * to fit MAP_W × MAP_H with a margin.
 */
function projectWaypoints(wps: Waypoint[]): Projected[] {
  const valid = wps.filter((wp) => wp.lat != null && wp.lon != null);
  if (valid.length === 0) return [];

  // Bounds in lat/lon space — degrees
  let minLat = +Infinity;
  let maxLat = -Infinity;
  let minLon = +Infinity;
  let maxLon = -Infinity;
  for (const wp of valid) {
    if (wp.lat! < minLat) minLat = wp.lat!;
    if (wp.lat! > maxLat) maxLat = wp.lat!;
    if (wp.lon! < minLon) minLon = wp.lon!;
    if (wp.lon! > maxLon) maxLon = wp.lon!;
  }
  const centerLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((centerLat * Math.PI) / 180);

  // Span in "projected" units (lon scaled by cos)
  const latSpan = Math.max(maxLat - minLat, 1e-6);
  const lonSpan = Math.max((maxLon - minLon) * lonScale, 1e-6);

  // Add margin around the bounds, then pick the limiting axis so the
  // route fits proportionally — preserves shape, doesn't squish.
  const mLat = latSpan * MAP_PADDING_PCT;
  const mLon = lonSpan * MAP_PADDING_PCT;
  const drawLatSpan = latSpan + 2 * mLat;
  const drawLonSpan = lonSpan + 2 * mLon;
  const scale = Math.min(MAP_W / drawLonSpan, MAP_H / drawLatSpan);

  // Centre the route inside the map area (extra space on whichever
  // axis the route doesn't fill).
  const offsetX = (MAP_W - drawLonSpan * scale) / 2;
  const offsetY = (MAP_H - drawLatSpan * scale) / 2;

  return valid.map((wp) => {
    const projLon = (wp.lon! - minLon) * lonScale + mLon;
    const projLat = wp.lat! - minLat + mLat;
    // SVG y grows downward; flip lat so north is up.
    const x = offsetX + projLon * scale;
    const y = offsetY + (drawLatSpan - projLat) * scale;
    return { x, y, wp };
  });
}

function abbreviate(name: string): string {
  if (!name || !name.trim()) return '';
  const clean = name.trim().toUpperCase();
  if (clean.length <= 4) return clean;
  const words = clean.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length >= 2) {
    return words.map((w) => w[0]).join('').slice(0, 4);
  }
  const consonants = clean.replace(/[AEIOU]/g, '');
  if (consonants.length >= 4) return consonants.slice(0, 4);
  return clean.slice(0, 4);
}

function fmtMc(deg?: number): string {
  if (deg == null) return '---';
  return `${Math.round(deg).toString().padStart(3, '0')}°`;
}

function fmtDist(nm?: number): string {
  if (nm == null || nm <= 0) return '-';
  return `${nm.toFixed(1)}`;
}

function fmtTime(seconds: number): string {
  if (seconds <= 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtAlt(alt_m: number, alt_type: string): string {
  const ft = Math.round(metersToFeet(alt_m));
  if (ft <= 0) return 'SFC';
  const kft = ft >= 1000 ? `${(ft / 1000).toFixed(0)}K` : `${ft}`;
  return `${kft} ${alt_type === 'RADIO' ? 'AGL' : 'MSL'}`;
}

/**
 * Pick which side of the leg the doghouse sits on, so doghouses on
 * adjacent legs don't overlap. We alternate between above and below
 * the leg midpoint based on the leg's index — good enough for most
 * routes; if a tester reports overlap on a tight zigzag we can switch
 * to a collision-avoidance pass.
 */
function doghouseOffset(legIdx: number): { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' } {
  // Alternate above (negative y) and below (positive y) for legibility.
  const aboveBelow = legIdx % 2 === 0 ? -1 : 1;
  return { dx: 0, dy: aboveBelow * 38, anchor: 'middle' };
}

export function StripMapCard({ group, overview, notes }: StripMapCardProps) {
  const wps = group.waypoints;
  const airframe = getAircraftType(group);
  const projected = projectWaypoints(wps);

  const totalDist = wps.reduce((sum, wp) => sum + (wp.leg_distance_nm || 0), 0);
  const totalEte = wps.length > 0 ? (wps[wps.length - 1].cumulative_eta || 0) : 0;

  return (
    <div style={{
      width: W,
      height: H,
      backgroundColor: BG,
      border: `1px solid ${BORDER}`,
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: FONT,
      color: TEXT,
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        borderBottom: `2px solid ${BORDER_LIGHT}`,
        paddingBottom: 6,
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 25,
          fontWeight: 'bold',
          color: TEXT_BRIGHT,
          letterSpacing: 1,
        }}>
          STRIP MAP — {group.groupName.toUpperCase()}
        </div>
        <div style={{ fontSize: 17, color: TEXT_MUTED, marginTop: 4 }}>
          {airframe} · {projected.length} WP · {totalDist.toFixed(1)} nm · ETE {fmtTime(totalEte)}
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Strip map SVG */}
      <div style={{
        border: `1px solid ${BORDER_MED}`,
        backgroundColor: '#0a0f1a',
        padding: 0,
        marginBottom: 8,
        flexShrink: 0,
      }}>
        {projected.length < 2 ? (
          <div style={{
            width: MAP_W,
            height: MAP_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: TEXT_MUTED,
            fontSize: 18,
          }}>
            Not enough waypoints with coordinates to render a strip map.
          </div>
        ) : (
          <svg width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`}
               xmlns="http://www.w3.org/2000/svg">
            {/* Background grid — pure decoration to give a chart feel */}
            <defs>
              <pattern id="stripGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1a2540" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width={MAP_W} height={MAP_H} fill="url(#stripGrid)" />

            {/* Route polyline */}
            <polyline
              points={projected.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#4a8fd4"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Doghouses at each leg midpoint */}
            {projected.slice(1).map((to, legIdx) => {
              const from = projected[legIdx];
              const wp = to.wp;
              const mx = (from.x + to.x) / 2;
              const my = (from.y + to.y) / 2;
              const off = doghouseOffset(legIdx);
              const boxX = mx + off.dx - 50;
              const boxY = my + off.dy - 30;
              const boxW = 100;
              const boxH = 60;
              // Leg-time computed from cumulative_eta if present.
              const legEta =
                wp.cumulative_eta != null && from.wp.cumulative_eta != null
                  ? wp.cumulative_eta - from.wp.cumulative_eta
                  : (wp.leg_distance_nm || 0) * 1852 / Math.max(wp.speed_ms || 1, 1);
              return (
                <g key={`dh-${legIdx}`}>
                  {/* Leader line from leg midpoint to doghouse */}
                  <line
                    x1={mx} y1={my}
                    x2={boxX + boxW / 2} y2={boxY + (off.dy > 0 ? 0 : boxH)}
                    stroke="#888" strokeWidth={1} strokeDasharray="2,2"
                  />
                  {/* Doghouse box */}
                  <rect
                    x={boxX} y={boxY} width={boxW} height={boxH}
                    fill="#202833" stroke="#ffa500" strokeWidth={1.5}
                    rx={3} ry={3}
                  />
                  {/* Doghouse contents — four rows */}
                  <text x={boxX + 6} y={boxY + 14}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>MC</text>
                  <text x={boxX + boxW - 6} y={boxY + 14}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill={TEXT_BRIGHT}
                        textAnchor="end">{fmtMc(wp.leg_bearing_deg)}</text>

                  <text x={boxX + 6} y={boxY + 28}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>DIST</text>
                  <text x={boxX + boxW - 6} y={boxY + 28}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill={TEXT_BRIGHT}
                        textAnchor="end">{fmtDist(wp.leg_distance_nm)} nm</text>

                  <text x={boxX + 6} y={boxY + 42}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>TIME</text>
                  <text x={boxX + boxW - 6} y={boxY + 42}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill={TEXT_BRIGHT}
                        textAnchor="end">{fmtTime(legEta)}</text>

                  <text x={boxX + 6} y={boxY + 56}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>ALT</text>
                  <text x={boxX + boxW - 6} y={boxY + 56}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={12} fontWeight="bold" fill={TEXT_BRIGHT}
                        textAnchor="end">{fmtAlt(wp.altitude_m, wp.altitude_type)}</text>
                </g>
              );
            })}

            {/* Waypoint dots + labels (drawn last so they sit on top
                of leader lines and doghouses) */}
            {projected.map((p) => {
              const abbr = abbreviate(p.wp.waypoint_name);
              const isOrigin = p.wp.waypoint_number === 0;
              return (
                <g key={`wp-${p.wp.waypoint_number}`}>
                  <circle cx={p.x} cy={p.y} r={isOrigin ? 7 : 5}
                          fill={isOrigin ? '#3fb950' : '#ffa500'}
                          stroke="#fff" strokeWidth={1.5} />
                  <text x={p.x + 9} y={p.y - 6}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill="#fff"
                        stroke="#000" strokeWidth={3}
                        paintOrder="stroke">
                    {p.wp.waypoint_number}{abbr ? ` ${abbr}` : ''}
                  </text>
                  <text x={p.x + 9} y={p.y - 6}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill="#fff">
                    {p.wp.waypoint_number}{abbr ? ` ${abbr}` : ''}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Footer: doghouse legend + notes */}
      <div style={{
        fontSize: 13,
        color: TEXT_MUTED,
        textAlign: 'center',
        marginBottom: 4,
      }}>
        Doghouse: <span style={{ color: TEXT_BRIGHT }}>MC</span> magnetic course ·{' '}
        <span style={{ color: TEXT_BRIGHT }}>DIST</span> leg distance (nm) ·{' '}
        <span style={{ color: TEXT_BRIGHT }}>TIME</span> leg time at planned speed ·{' '}
        <span style={{ color: TEXT_BRIGHT }}>ALT</span> at next WP
      </div>
      <div style={{
        backgroundColor: BG_NOTES,
        border: `1px solid ${BORDER_LIGHT}`,
        flex: 1,
        padding: '6px 10px',
        fontSize: 16,
        color: TEXT_BRIGHT,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
      }}>
        <div style={{ color: ACCENT, fontWeight: 'bold', fontSize: 17, marginBottom: 4 }}>
          NOTES
        </div>
        {notes || ''}
      </div>
    </div>
  );
}

// Marker so unused-vars detection doesn't flag msToKnots, which we
// might reach for once Tier-B fuel/threat fields land.
void msToKnots;
