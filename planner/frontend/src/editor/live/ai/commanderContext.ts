/**
 * Turning the live Olympus picture into something a model can read cheaply.
 *
 * The whole design constraint here is tokens: get_picture may be called several
 * times in one turn, and every call's output sticks around in the conversation
 * for the rest of the session. So the format is one dense pipe-delimited line
 * per unit under a single legend, rather than JSON — same information, roughly
 * a third of the tokens.
 *
 * Unit conversions live here too. The wire gives radians / m/s / metres; the
 * model is spoken to in degrees / knots / feet, because that's the language the
 * GM's orders are already in ("angels 20", "on the 270 for 15").
 */

import { metresToFeet, type LL } from '../braCalc';
import { bullseyeBR } from '../bullseye';
import type { CmdrAirbase, CmdrLatLng, CmdrUnit } from './commanderTypes';
import type { UnitDbEntry } from '../../../api/groups';

const MS_TO_KT = 1.943844;

/** Course over ground preferred, falling back to nose heading. 0-360 true. */
export function headingDeg(u: CmdrUnit): number | null {
  const rad = u.track ?? u.heading;
  if (rad == null || !Number.isFinite(rad)) return null;
  let deg = (rad * 180) / Math.PI;
  deg %= 360;
  if (deg < 0) deg += 360;
  return Math.round(deg);
}

export function speedKt(u: CmdrUnit): number | null {
  if (u.speed == null || !Number.isFinite(u.speed)) return null;
  return Math.round(u.speed * MS_TO_KT);
}

export function altFt(u: CmdrUnit): number | null {
  const ft = metresToFeet(u.position?.alt);
  return ft == null ? null : Math.round(ft);
}

export function coalitionLabel(c: number | undefined): string {
  return c === 2 ? 'BLU' : c === 1 ? 'RED' : 'NEU';
}

const ROE_LABEL = ['?', 'FREE', 'DESIG', 'RETURN', 'HOLD'];
const ALARM_LABEL = ['auto', 'green', 'red'];

/** How the model is told it may treat a unit. */
function controlLabel(u: CmdrUnit): string {
  if (u.human === 1) return 'HUMAN';
  if (u.controlled === 0) return 'ME-PROTECTED';
  return 'ai';
}

export interface PictureFilter {
  coalition?: 'red' | 'blue' | 'neutral' | 'all';
  category?: string;
  query?: string;
  maxUnits?: number;
}

const COALITION_CODE: Record<string, number> = { neutral: 0, red: 1, blue: 2 };

export function filterUnits(units: CmdrUnit[], f: PictureFilter): CmdrUnit[] {
  const wantCoalition = f.coalition && f.coalition !== 'all' ? COALITION_CODE[f.coalition] : undefined;
  const wantCat = f.category && f.category !== 'all' ? f.category.toLowerCase() : undefined;
  const q = f.query?.trim().toLowerCase();
  return units.filter((u) => {
    if (u.alive === 0) return false;
    if (wantCoalition != null && u.coalition !== wantCoalition) return false;
    if (wantCat && (u.category || '').toLowerCase() !== wantCat) return false;
    if (q) {
      const hay = `${u.name || ''} ${u.unitName || ''} ${u.groupName || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function unitLine(u: CmdrUnit, bullseye: CmdrLatLng | null): string {
  const pos = u.position;
  let be = '—';
  if (bullseye && pos) {
    const br = bullseyeBR(bullseye as LL, { lat: pos.lat, lng: pos.lng });
    be = `${String(Math.round(br.bearingDeg)).padStart(3, '0')}/${Math.round(br.rangeNm)}`;
  }
  const ll = pos ? `${pos.lat.toFixed(4)},${pos.lng.toFixed(4)}` : '—';
  const alt = altFt(u);
  const spd = speedKt(u);
  const hdg = headingDeg(u);
  return [
    u.olympusID ?? '?',
    u.name || '?',
    u.unitName || u.groupName || '?',
    coalitionLabel(u.coalition),
    u.category || '?',
    be,
    ll,
    alt == null ? '—' : String(alt),
    hdg == null ? '—' : String(hdg),
    spd == null ? '—' : String(spd),
    ROE_LABEL[u.ROE ?? 0] || '?',
    ALARM_LABEL[u.alarmState ?? 0] || '?',
    controlLabel(u),
  ].join('|');
}

/**
 * The air/ground picture, grouped by DCS group so the model can reason about
 * flights rather than loose units. Dead units are dropped; the truncation note
 * is explicit so the model knows to narrow its filter rather than assuming it
 * has seen everything.
 */
export function summarizePicture(
  units: CmdrUnit[],
  bullseye: CmdrLatLng | null,
  filter: PictureFilter = {},
): string {
  const max = Math.min(Math.max(filter.maxUnits ?? 60, 1), 150);
  const matched = filterUnits(units, filter);
  if (!matched.length) return 'No units match that filter.';

  const shown = matched.slice(0, max);
  const groups = new Map<string, CmdrUnit[]>();
  for (const u of shown) {
    const key = u.groupName || u.unitName || `unit-${u.olympusID ?? '?'}`;
    const list = groups.get(key);
    if (list) list.push(u); else groups.set(key, [u]);
  }

  const lines: string[] = [
    `LEGEND id|type|callsign|coalition|category|bullseyeBRG/NM|lat,lng|altFt|hdgTrue|kt|ROE|alarm|control`,
    bullseye
      ? `BULLSEYE ${bullseye.lat.toFixed(4)},${bullseye.lng.toFixed(4)}`
      : 'BULLSEYE not set (bearing/range column shows —)',
  ];
  for (const [groupName, list] of groups) {
    const head = list[0];
    lines.push(`GROUP ${groupName} (${list.length} unit${list.length === 1 ? '' : 's'}, ${coalitionLabel(head.coalition)}, ${head.category || '?'})`);
    for (const u of list) lines.push(`  ${unitLine(u, bullseye)}`);
  }
  if (matched.length > shown.length) {
    lines.push(`[${matched.length - shown.length} more units matched but were not shown — narrow the filter (coalition/category/query) to see them]`);
  }
  return lines.join('\n');
}

export function summarizeAirbases(airbases: CmdrAirbase[]): string {
  if (!airbases.length) return 'No airbase data available.';
  const lines = airbases.map((a) => `${a.name}|${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${String(a.coalition ?? '?')}`);
  return ['LEGEND name|lat,lng|coalition', ...lines].join('\n');
}

/**
 * Unit-type search results. The model MUST spawn using an exact key from here —
 * a near-miss silently spawns nothing on Olympus — so the key is the first
 * field on every line.
 */
export function summarizeUnitDbMatches(
  db: Record<string, UnitDbEntry>,
  query: string,
  opts: { era?: string; coalition?: string; max?: number } = {},
): string {
  const q = query.trim().toLowerCase();
  const max = Math.min(Math.max(opts.max ?? 10, 1), 40);
  const era = opts.era?.trim().toLowerCase();
  const coalition = opts.coalition?.trim().toLowerCase();

  const hits = Object.entries(db).filter(([key, e]) => {
    if (era && !(e.era || '').toLowerCase().includes(era)) return false;
    if (coalition && !(e.coalition || '').toLowerCase().includes(coalition)) return false;
    if (!q) return true;
    return `${key} ${e.label || ''} ${e.shortLabel || ''} ${e.type || ''}`.toLowerCase().includes(q);
  });

  if (!hits.length) return `No unit types match "${query}".`;

  const lines = hits.slice(0, max).map(([key, e]) => {
    const roles = new Set<string>();
    for (const l of e.loadouts || []) for (const r of l.roles || []) roles.add(r);
    const roleStr = roles.size ? Array.from(roles).join('/') : '—';
    return `${key}|${e.label || key}|${e.type || '?'}|${e.era || '?'}|${e.coalition || '?'}|${roleStr}`;
  });
  const note = hits.length > lines.length ? `\n[${hits.length - lines.length} more matches — refine the query]` : '';
  return [
    'LEGEND unit_type|label|type|era|coalition|loadout roles',
    '(use the unit_type value EXACTLY as shown when spawning)',
    ...lines,
  ].join('\n') + note;
}
