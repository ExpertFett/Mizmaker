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
import type {
  Waypoint, MissionGroup, MissionOverviewData, ThreatRing, Airbase, ClientUnit,
} from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { MissionDateLine } from './cardStyles';
import { TileMap, createProjection } from './TileMap';
import { getAircraftPerf, computeFuelLegs } from './fuelModel';
import { DEFAULT_OPTIONS, type KneeboardOptions } from './options';

/** Waypoints carried per page. A long route squeezed onto one 600x850 card is
 *  unreadable, so it continues across cards with a match line — the same way a
 *  paper chart is cut. Pages overlap by one waypoint so the joining leg shows
 *  on both. */
/** Default waypoints per sheet; the flight lead can trade sheets for map
 *  size. */
const WPS_PER_PAGE_DEFAULT = 7;

/** Nautical miles between two lat/lon points. */
function nmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3440.065;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** How many cards this flight's route needs. */
export function stripMapPageCount(group: MissionGroup, perPage = WPS_PER_PAGE_DEFAULT): number {
  const WPS_PER_PAGE = Math.max(2, perPage);
  const n = (group.waypoints || []).filter((w) => w.lat != null && w.lon != null).length;
  if (n <= WPS_PER_PAGE) return 1;
  return Math.ceil((n - 1) / (WPS_PER_PAGE - 1));
}

interface StripMapCardProps {
  group: MissionGroup;
  overview?: MissionOverviewData;
  notes?: string;
  /** 0-based page. Long routes continue across cards. */
  page?: number;
  /** Surface threats — rings are drawn where they reach the route corridor. */
  threats?: ThreatRing[];
  /** Theater airfields, for diverts along the route. */
  airbases?: Airbase[];
  /** Used with fuelOverride to annotate fuel remaining in each doghouse. */
  clientUnits?: ClientUnit[];
  fuelOverride?: { start?: number; joker?: number; bingo?: number };
  /** Flight lead controls — sheet density and base layer. */
  opts?: KneeboardOptions;
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

export function StripMapCard({
  group, overview, notes, page = 0,
  threats = [], airbases = [], clientUnits = [], fuelOverride,
  opts = DEFAULT_OPTIONS,
}: StripMapCardProps) {
  const WPS_PER_PAGE = Math.max(2, opts.nav.waypointsPerStripPage);
  const wps = group.waypoints;
  const airframe = getAircraftType(group);

  const allWps = (wps || []).filter((w) => w.lat != null && w.lon != null);
  const totalPages = stripMapPageCount(group, WPS_PER_PAGE);
  // Pages overlap by one waypoint so the joining leg appears on both cards.
  const startIdx = page * (WPS_PER_PAGE - 1);
  const pageWps = allWps.slice(startIdx, startIdx + WPS_PER_PAGE);

  // Fuel is walked over the WHOLE route, not the page, or page 2 would start
  // back at full tanks.
  const unitType = group.units?.[0]?.type || '';
  const perf = getAircraftPerf(unitType);
  const rep = clientUnits.find((cu) => cu.groupName === group.groupName);
  const rawFuel = rep?.fuel ?? 0;
  const startFuelLbs = fuelOverride?.start
    ?? (rawFuel <= 1 ? Math.round(rawFuel * perf.maxFuelLbs) : Math.round(rawFuel * 2.20462));
  const fuelByWp = new Map(
    computeFuelLegs(allWps, { startFuelLbs, emptyLbs: perf.emptyLbs, unitType })
      .map((l) => [l.wp, l]),
  );

  // Frame this page's waypoints, padded, then project through the same tile
  // maths the other map cards use so imagery lines up underneath.
  let minLat = +Infinity, maxLat = -Infinity, minLon = +Infinity, maxLon = -Infinity;
  for (const w of pageWps) {
    minLat = Math.min(minLat, w.lat!); maxLat = Math.max(maxLat, w.lat!);
    minLon = Math.min(minLon, w.lon!); maxLon = Math.max(maxLon, w.lon!);
  }
  const MIN_SPAN = 0.08;
  if (maxLat - minLat < MIN_SPAN) {
    const c = (minLat + maxLat) / 2; minLat = c - MIN_SPAN / 2; maxLat = c + MIN_SPAN / 2;
  }
  if (maxLon - minLon < MIN_SPAN) {
    const c = (minLon + maxLon) / 2; minLon = c - MIN_SPAN / 2; maxLon = c + MIN_SPAN / 2;
  }
  const padLat = (maxLat - minLat) * MAP_PADDING_PCT;
  const padLon = (maxLon - minLon) * MAP_PADDING_PCT;
  minLat -= padLat; maxLat += padLat; minLon -= padLon; maxLon += padLon;

  // Pinned scale: force the frame to a fixed width in NM so every sheet in a
  // deck is drawn at the same scale, instead of each one fitting its own legs.
  if (opts.nav.pinnedScaleNm > 0) {
    const cLat = (minLat + maxLat) / 2, cLon = (minLon + maxLon) / 2;
    const halfLon = opts.nav.pinnedScaleNm / 2 / (60 * Math.cos((cLat * Math.PI) / 180));
    // Keep the frame's aspect ratio so the projection does not distort.
    const halfLat = (halfLon * Math.cos((cLat * Math.PI) / 180)) * (MAP_H / MAP_W);
    minLon = cLon - halfLon; maxLon = cLon + halfLon;
    minLat = cLat - halfLat; maxLat = cLat + halfLat;
  }

  // Track-up rotates the whole sheet so the leg runs up the page, which is
  // what a paper strip map was. The projection stays north-up and the rendered
  // block is rotated instead — rotating the projection would mean rotating
  // every overlay's maths too. See ROTATION_INFLATE.
  const trackUp = opts.nav.stripOrientation === 'track';
  const legCourse = (() => {
    if (!trackUp || pageWps.length < 2) return 0;
    const a0 = pageWps[0], b0 = pageWps[pageWps.length - 1];
    const dLon = (b0.lon! - a0.lon!) * Math.cos((a0.lat! * Math.PI) / 180);
    const dLat = b0.lat! - a0.lat!;
    return (Math.atan2(dLon, dLat) * 180) / Math.PI;
  })();

  // A rotated square has to be sqrt(2) bigger than its window or the corners
  // come up empty. Inflate the drawn area and the bbox together so the visible
  // window stays full whatever the rotation.
  const inflate = trackUp ? Math.SQRT2 : 1;
  if (inflate > 1) {
    const cLat = (minLat + maxLat) / 2, cLon = (minLon + maxLon) / 2;
    const hLat = ((maxLat - minLat) / 2) * inflate;
    const hLon = ((maxLon - minLon) / 2) * inflate;
    minLat = cLat - hLat; maxLat = cLat + hLat;
    minLon = cLon - hLon; maxLon = cLon + hLon;
  }
  /** Counter-rotation keeping a label upright inside a rotated sheet. */
  const upright = (x: number | string, y: number | string) =>
    (trackUp ? `rotate(${legCourse}, ${x}, ${y})` : undefined);

  const drawW = Math.round(MAP_W * inflate);
  const drawH = Math.round(MAP_H * inflate);

  const proj = createProjection(minLat, maxLat, minLon, maxLon, drawW, drawH);
  const projected: Projected[] = pageWps.map((wp) => {
    const [x, y] = proj.project(wp.lat!, wp.lon!);
    return { x, y, wp };
  });

  // Threat rings that actually reach this frame — a ring 200 NM away is noise.
  // Enemy only. A friendly Hawk battery is not a threat ring — this card drew
  // our own SAMs in red until it was rendered and looked at.
  //
  // Then cluster: a SAM site is many units, and one ring per UNIT put 43
  // overlapping circles and labels on a single sheet. Group by type and
  // position (~0.02 deg, roughly a mile) and keep the longest-reaching member,
  // which is the ring that actually shapes the route.
  const siteMap = new Map<string, ThreatRing>();
  for (const t of threats) {
    if (t.lat == null || t.lon == null || t.coalition === 'blue') continue;
    const key = `${(t.type || '').split(' ')[0]}|${t.lat.toFixed(2)}|${t.lon.toFixed(2)}`;
    const cur = siteMap.get(key);
    if (!cur || (t.range ?? 0) > (cur.range ?? 0)) siteMap.set(key, t);
  }
  const frameThreats = [...siteMap.values()]
    .map((t) => {
      const [x, y] = proj.project(t.lat!, t.lon!);
      const r = proj.metersToPixels((t.range ?? 0));
      return { t, x, y, r };
    })
    .filter((o) => o.r > 2
      && o.x + o.r > 0 && o.x - o.r < MAP_W
      && o.y + o.r > 0 && o.y - o.r < MAP_H)
    // Biggest threats first, then capped — past a dozen rings the sheet is
    // unreadable and the small stuff is not what kills you at altitude.
    .sort((a, b) => b.r - a.r)
    .slice(0, 12);

  // Diverts — nearest fields to the route on this page, so an emergency has an
  // answer without leaving the card.
  const diverts = airbases
    // A field with no runway is a helipad or FARP — not a divert for a jet.
    .filter((a) => a.lat != null && a.lon != null && (a.runways?.length ?? 0) > 0)
    .map((a) => ({
      a,
      nm: Math.min(...pageWps.map((w) => nmBetween(w.lat!, w.lon!, a.lat!, a.lon!))),
    }))
    .filter((o) => o.nm < 60)
    .sort((x, y) => x.nm - y.nm)
    .slice(0, 4)
    .map((o) => {
      const [x, y] = proj.project(o.a.lat!, o.a.lon!);
      return { ...o, x, y };
    })
    .filter((o) => o.x > 0 && o.x < MAP_W && o.y > 0 && o.y < MAP_H);

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
      // Every other card root clips; this one did not, which the inflated
      // track-up rotation layer would happily escape through.
      overflow: 'hidden',
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
          {airframe} · {allWps.length} WP · {totalDist.toFixed(1)} nm · ETE {fmtTime(totalEte)}
          {totalPages > 1 && ` · SHEET ${page + 1}/${totalPages}`}
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
          <div style={{
            width: MAP_W, height: MAP_H, overflow: 'hidden', position: 'relative',
          }}>
            <div style={{
              position: 'absolute',
              // The drawn block is inflated, so pull it back by half the
              // overhang to keep its centre on the window's centre.
              left: -(drawW - MAP_W) / 2,
              top: -(drawH - MAP_H) / 2,
              width: drawW, height: drawH,
              transform: trackUp ? `rotate(${-legCourse}deg)` : undefined,
              transformOrigin: 'center center',
            }}>
          <TileMap width={drawW} height={drawH}
                   minLat={minLat} maxLat={maxLat} minLon={minLon} maxLon={maxLon}
                   layer={opts.nav.mapLayer === 'dark' ? 'dark' : 'satellite'}>
          <svg width={drawW} height={drawH} viewBox={`0 0 ${drawW} ${drawH}`}
               xmlns="http://www.w3.org/2000/svg">
            {/* Threat rings that reach this sheet. Drawn first so the route
                and doghouses stay legible on top of them. */}
            {frameThreats.map((o, i) => (
              <g key={`thr-${i}`}>
                <circle cx={o.x} cy={o.y} r={o.r} fill="rgba(217,80,80,0.10)"
                        stroke="rgba(217,80,80,0.85)" strokeWidth={1.2} strokeDasharray="5 4" />
                {/* Clamped into the frame — a ring centred near the edge
                    otherwise pushes its label off the sheet. */}
                <text transform={upright(Math.min(Math.max(o.x, 40), drawW - 40), o.y - 4)}
                      x={Math.min(Math.max(o.x, 40), drawW - 40)} y={o.y - 4}
                      fontSize={11} fill="#ff8a8a" textAnchor="middle"
                      stroke="#000" strokeWidth={2.5} paintOrder="stroke" fontWeight={700}>
                  {/* Short designator, not the raw unit name: "S-300PS", not
                      "301 S-300PS 40B6M tr | 3rd Co, 202nd AD Bde". */}
                  {(o.t.type || o.t.name || '').split(' ')[0]}
                </text>
              </g>
            ))}

            {/* Diverts within 60 NM of this sheet's track. */}
            {diverts.map((o, i) => (
              <g key={`div-${i}`}>
                <circle cx={o.x} cy={o.y} r={4} fill="none" stroke="#7fd97f" strokeWidth={1.6} />
                <line x1={o.x - 6} y1={o.y} x2={o.x + 6} y2={o.y} stroke="#7fd97f" strokeWidth={1.2} />
                {/* A start-anchored label on a marker in the right third of
                    the frame runs off the sheet ("Monchegorsk 49" measured
                    8px outside) — flip it to the marker's left instead. */}
                <text transform={upright(o.x > drawW * 0.7 ? o.x - 8 : o.x + 8, o.y + 4)}
                      x={o.x > drawW * 0.7 ? o.x - 8 : o.x + 8} y={o.y + 4}
                      fontSize={11} fill="#7fd97f"
                      textAnchor={o.x > drawW * 0.7 ? 'end' : 'start'}
                      stroke="#000" strokeWidth={2.5} paintOrder="stroke" fontWeight={600}>
                  {o.a.name} {Math.round(o.nm)}
                </text>
              </g>
            ))}

            {/* North arrow. Drawn in frame space, so on a track-up sheet the
                rotation carries it round automatically and it points at true
                north on the page — which is exactly what it is for. Only the
                "N" needs holding upright. The card header states the
                orientation either way; the reader should never have to guess.

                The arrow sits at the top-right of the WINDOW, not the inflated
                drawing, so it stays visible once the sheet is rotated and
                clipped. */}
            <g transform={`translate(${(drawW + MAP_W) / 2 - 30}, ${(drawH - MAP_H) / 2 + 26})`}>
              <line x1={0} y1={20} x2={0} y2={-8} stroke={TEXT_MUTED} strokeWidth={1.6} />
              <polygon points="0,-14 -4.5,-2 4.5,-2" fill={TEXT_BRIGHT} />
              <text transform={upright(0, 34)} x={0} y={34} fontSize={12} fontFamily={FONT} fill={TEXT_MUTED}
                    textAnchor="middle" fontWeight={700}>N</text>
            </g>

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
              const boxH = 88;
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
                  <text transform={upright(boxX + 6, boxY + 14)} x={boxX + 6} y={boxY + 14}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>MC</text>
                  <text transform={upright(boxX + boxW - 6, boxY + 14)} x={boxX + boxW - 6} y={boxY + 14}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill={TEXT_BRIGHT}
                        textAnchor="end">{fmtMc(wp.leg_bearing_deg)}</text>

                  <text transform={upright(boxX + 6, boxY + 28)} x={boxX + 6} y={boxY + 28}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>DIST</text>
                  <text transform={upright(boxX + boxW - 6, boxY + 28)} x={boxX + boxW - 6} y={boxY + 28}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill={TEXT_BRIGHT}
                        textAnchor="end">{fmtDist(wp.leg_distance_nm)} nm</text>

                  <text transform={upright(boxX + 6, boxY + 42)} x={boxX + 6} y={boxY + 42}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>TIME</text>
                  <text transform={upright(boxX + boxW - 6, boxY + 42)} x={boxX + boxW - 6} y={boxY + 42}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill={TEXT_BRIGHT}
                        textAnchor="end">{fmtTime(legEta)}</text>

                  <text transform={upright(boxX + 6, boxY + 56)} x={boxX + 6} y={boxY + 56}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>ALT</text>
                  <text transform={upright(boxX + boxW - 6, boxY + 56)} x={boxX + boxW - 6} y={boxY + 56}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={12} fontWeight="bold" fill={TEXT_BRIGHT}
                        textAnchor="end">{fmtAlt(wp.altitude_m, wp.altitude_type)}</text>

                  {/* ETE is the leg; ELAP is time since takeoff. The second is
                      what you actually cross-check against a time hack. */}
                  <text transform={upright(boxX + 6, boxY + 70)} x={boxX + 6} y={boxY + 70}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>ELAP</text>
                  <text transform={upright(boxX + boxW - 6, boxY + 70)} x={boxX + boxW - 6} y={boxY + 70}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={12} fontWeight="bold" fill={TEXT_BRIGHT}
                        textAnchor="end">{fmtTime(wp.cumulative_eta || 0)}</text>

                  {/* Fuel remaining at this point — same model the Fuel Ladder
                      card uses, so the two cards agree. */}
                  <text transform={upright(boxX + 6, boxY + 84)} x={boxX + 6} y={boxY + 84}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={11} fill={TEXT_MUTED}>FUEL</text>
                  <text transform={upright(boxX + boxW - 6, boxY + 84)} x={boxX + boxW - 6} y={boxY + 84}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={12} fontWeight="bold" fill={ACCENT}
                        textAnchor="end">
                    {fuelByWp.get(wp.waypoint_number)?.remaining?.toLocaleString() ?? '-'}
                  </text>
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
                  <text transform={upright(p.x + 9, p.y - 6)} x={p.x + 9} y={p.y - 6}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill="#fff"
                        stroke="#000" strokeWidth={3}
                        paintOrder="stroke">
                    {p.wp.waypoint_number}{abbr ? ` ${abbr}` : ''}
                  </text>
                  <text transform={upright(p.x + 9, p.y - 6)} x={p.x + 9} y={p.y - 6}
                        fontFamily="'B612 Mono', 'Consolas', monospace"
                        fontSize={13} fontWeight="bold" fill="#fff">
                    {p.wp.waypoint_number}{abbr ? ` ${abbr}` : ''}
                  </text>
                </g>
              );
            })}
            {/* Match lines — this sheet is a cut from a longer route, so say
                where it joins the next one. */}
            {page > 0 && (
              <text transform={upright((drawW - MAP_W) / 2 + 8, (drawH - MAP_H) / 2 + 16)} x={(drawW - MAP_W) / 2 + 8} y={(drawH - MAP_H) / 2 + 16} fontSize={12} fill={ACCENT} fontWeight={700}
                    stroke="#000" strokeWidth={2.5} paintOrder="stroke">
                ◀ MATCH SHEET {page}
              </text>
            )}
            {page < totalPages - 1 && (
              <text transform={upright((drawW + MAP_W) / 2 - 8, (drawH + MAP_H) / 2 - 8)} x={(drawW + MAP_W) / 2 - 8} y={(drawH + MAP_H) / 2 - 8} fontSize={12} fill={ACCENT} fontWeight={700}
                    textAnchor="end" stroke="#000" strokeWidth={2.5} paintOrder="stroke">
                MATCH SHEET {page + 2} ▶
              </text>
            )}
          </svg>
          </TileMap>
            </div>
          </div>
        )}
      </div>

      {/* Footer legend — only when leg boxes were actually drawn. A single-
          waypoint route has no legs, and a legend describing boxes that are
          not on the map just confuses (Fett report, v1.19.136). Reworded from
          "Doghouse" to point at the boxes themselves. */}
      {projected.length > 1 && (
        <div style={{
          fontSize: 13,
          color: TEXT_MUTED,
          textAlign: 'center',
          marginBottom: 4,
        }}>
          Leg boxes: <span style={{ color: TEXT_BRIGHT }}>MC</span> magnetic course ·{' '}
          <span style={{ color: TEXT_BRIGHT }}>DIST</span> leg distance (nm) ·{' '}
          <span style={{ color: TEXT_BRIGHT }}>TIME</span> leg time at planned speed ·{' '}
          <span style={{ color: TEXT_BRIGHT }}>ALT</span> at next WP ·{' '}
          <span style={{ color: TEXT_BRIGHT }}>ELAP</span> since takeoff ·{' '}
          <span style={{ color: TEXT_BRIGHT }}>FUEL</span> lbs remaining
        </div>
      )}
      {/* Notes only when typed (v1.19.136). */}
      {notes && notes.trim() && (
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
          {notes.trim()}
        </div>
      )}
    </div>
  );
}

// Marker so unused-vars detection doesn't flag msToKnots, which we
// might reach for once Tier-B fuel/threat fields land.
void msToKnots;
