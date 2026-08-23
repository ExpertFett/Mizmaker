/**
 * Turning validated tool calls into Olympus commands.
 *
 * Two hard-won constraints shape this file:
 *
 *  1. Olympus spawn params must match the client EXACTLY — {unitType, location,
 *     skill, liveryID, altitude?, loadout?} and nothing else. An extra field
 *     (`heading`, once) makes Olympus silently drop the unit while still
 *     returning 200. See SpawnPanel.tsx:178-183. buildSpawnParams is therefore
 *     the only place spawn params are constructed, and it has an exact-shape test.
 *
 *  2. IDs are re-validated HERE, at execution time — not when the model proposed
 *     the call. Units die in the seconds between a get_picture and the GM
 *     tapping Approve, and a stale ID must fail loudly in the tool result rather
 *     than silently retarget something else.
 *
 * Human-piloted units are never commandable. Mission-Editor units (controlled
 * === 0) are skipped unless the GM approved a card that named them.
 */

import type { UnitDbEntry } from '../../../api/groups';
import type {
  CmdrDbCategory, CmdrUnit, CommanderEnv, ToolExecResult,
} from './commanderTypes';
import {
  summarizeAirbases, summarizePicture, summarizeUnitDbMatches,
} from './commanderContext';
import { alwaysConfirm, isKnownTool, requiredCap } from './commanderTools';

const FT_TO_M = 0.3048;
const KT_TO_MS = 0.514444;
/** Above this many units we stagger; 50+ parallel deletes freeze the sim for
 *  5-15s (LiveMap.tsx:409-413 records the incident). */
const STAGGER_THRESHOLD = 10;
const STAGGER_MS = 150;

export function ftToM(ft: number): number { return Math.round(ft * FT_TO_M); }
export function ktToMs(kt: number): number { return Math.round(kt * KT_TO_MS); }

// Enum mappings. ROE is 1-based on the wire; the rest are 0-based.
const ROE_MAP: Record<string, number> = { free: 1, designated: 2, return_fire: 3, hold: 4 };
const ALARM_MAP: Record<string, number> = { auto: 0, green: 1, red: 2 };
const REACTION_MAP: Record<string, number> = { none: 0, manoeuvre: 1, passive: 2, evade: 3 };
const EMISSIONS_MAP: Record<string, number> = { silent: 0, attack: 1, defend: 2, free: 3 };

export function roeToInt(s: string): number | undefined { return ROE_MAP[s]; }
export function alarmToInt(s: string): number | undefined { return ALARM_MAP[s]; }
export function reactionToInt(s: string): number | undefined { return REACTION_MAP[s]; }
export function emissionsToInt(s: string): number | undefined { return EMISSIONS_MAP[s]; }

export interface ResolvedIds {
  /** Safe to command right now. */
  valid: CmdrUnit[];
  /** Mission-Editor units — commanding abandons their scripted mission. */
  protectedUnits: CmdrUnit[];
  /** Human-readable reasons for everything that was thrown out. */
  rejected: string[];
}

/**
 * Match model-supplied IDs against the live snapshot. Anything unknown, dead or
 * human-piloted is rejected with a reason the model can read and correct.
 */
export function resolveUnitIds(ids: unknown, units: CmdrUnit[]): ResolvedIds {
  const out: ResolvedIds = { valid: [], protectedUnits: [], rejected: [] };
  if (!Array.isArray(ids) || !ids.length) {
    out.rejected.push('No unit_ids supplied.');
    return out;
  }
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isFinite(id)) { out.rejected.push(`"${String(raw)}" is not a numeric olympusID.`); continue; }
    const u = units.find((x) => x.olympusID === id);
    if (!u) { out.rejected.push(`#${id} is not in the current picture (dead or never existed).`); continue; }
    if (u.alive === 0) { out.rejected.push(`#${id} is destroyed.`); continue; }
    if (u.human === 1) { out.rejected.push(`#${id} is human-piloted and cannot be commanded.`); continue; }
    if (u.controlled === 0) out.protectedUnits.push(u); else out.valid.push(u);
  }
  return out;
}

export function unitTag(u: CmdrUnit): string {
  return `${u.unitName || u.groupName || u.name || 'unit'} (#${u.olympusID})`;
}

export interface BuiltCommand { command: string; params: Record<string, unknown> }

const SPAWN_CMD: Record<CmdrDbCategory, string> = {
  aircraft: 'spawnAircrafts',
  helicopter: 'spawnHelicopters',
  groundunit: 'spawnGroundUnits',
  navyunit: 'spawnNavyUnits',
};

/** Scatter multiple units so they don't stack on one point. */
function offsetLatLng(lat: number, lng: number, nm: number, i: number, total: number): { lat: number; lng: number } {
  if (total <= 1 || nm <= 0) return { lat, lng };
  const angle = (2 * Math.PI * i) / total;
  const dLat = (nm / 60) * Math.cos(angle);
  const dLng = (nm / 60) * Math.sin(angle) / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

export interface SpawnInput {
  category?: unknown; unit_type?: unknown; count?: unknown; coalition?: unknown;
  lat?: unknown; lng?: unknown; altitude_ft?: unknown; loadout_name?: unknown;
  skill?: unknown; spread_nm?: unknown;
}

/**
 * Build a spawn command, or an error explaining what the model got wrong.
 * The unit object here must stay byte-identical to SpawnPanel's — see header.
 */
export function buildSpawnParams(
  input: SpawnInput,
  dbEntry: UnitDbEntry | undefined,
): BuiltCommand | { error: string } {
  const category = String(input.category || '') as CmdrDbCategory;
  if (!SPAWN_CMD[category]) return { error: `Unknown category "${String(input.category)}".` };
  const unitType = String(input.unit_type || '');
  if (!unitType) return { error: 'unit_type is required.' };
  if (!dbEntry) {
    return { error: `Unit type "${unitType}" is not in the ${category} database. Call search_unit_types and use an exact unit_type from the results.` };
  }
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'lat and lng must be numbers.' };

  const coalition = String(input.coalition || '');
  if (!['blue', 'red', 'neutral'].includes(coalition)) {
    return { error: `coalition must be blue, red or neutral (got "${coalition}").` };
  }

  const count = Math.min(Math.max(Math.round(Number(input.count) || 1), 1), 8);
  const skill = String(input.skill || 'High');
  const air = category === 'aircraft' || category === 'helicopter';
  const spread = Number(input.spread_nm);
  const spreadNm = Number.isFinite(spread) ? spread : 0.5;

  let loadoutCode = '';
  if (air && input.loadout_name) {
    const wanted = String(input.loadout_name);
    const match = (dbEntry.loadouts || []).find((l) => l.name === wanted);
    if (!match) {
      const names = (dbEntry.loadouts || []).map((l) => l.name).filter(Boolean).slice(0, 12);
      return { error: `Loadout "${wanted}" not found for ${unitType}. Valid loadouts: ${names.length ? names.join(', ') : '(none — this airframe is AI-only)'}` };
    }
    loadoutCode = match.code || '';
  }

  const units = Array.from({ length: count }, (_, i) => {
    const p = offsetLatLng(lat, lng, spreadNm, i, count);
    // EXACT Olympus client shape — do not add fields. See file header.
    const u: Record<string, unknown> = {
      unitType, location: { lat: p.lat, lng: p.lng }, skill, liveryID: '',
    };
    if (air) {
      u.altitude = ftToM(Number(input.altitude_ft) || 0);
      u.loadout = loadoutCode;
    }
    return u;
  });

  const params: Record<string, unknown> = {
    units, coalition, country: '', immediate: false, spawnPoints: 0,
  };
  if (air) params.airbaseName = '';
  return { command: SPAWN_CMD[category], params };
}

/** Expand a set_behavior call into the individual Olympus commands it implies. */
export function buildBehaviorCommands(input: Record<string, unknown>, ID: number): BuiltCommand[] {
  const out: BuiltCommand[] = [];
  if (typeof input.roe === 'string') {
    const v = roeToInt(input.roe);
    if (v != null) out.push({ command: 'setROE', params: { ID, ROE: v } });
  }
  if (typeof input.alarm_state === 'string') {
    const v = alarmToInt(input.alarm_state);
    if (v != null) out.push({ command: 'setAlarmState', params: { ID, alarmState: v } });
  }
  if (typeof input.reaction_to_threat === 'string') {
    const v = reactionToInt(input.reaction_to_threat);
    if (v != null) out.push({ command: 'setReactionToThreat', params: { ID, reactionToThreat: v } });
  }
  if (typeof input.emissions === 'string') {
    const v = emissionsToInt(input.emissions);
    if (v != null) out.push({ command: 'setEmissionsCountermeasures', params: { ID, emissionsCountermeasures: v } });
  }
  if (typeof input.on_off === 'boolean') {
    out.push({ command: 'setOnOff', params: { ID, onOff: input.on_off } });
  }
  if (typeof input.follow_roads === 'boolean') {
    out.push({ command: 'setFollowRoads', params: { ID, followRoads: input.follow_roads } });
  }
  return out;
}

export function buildAltSpeedCommands(input: Record<string, unknown>, ID: number): BuiltCommand[] {
  const out: BuiltCommand[] = [];
  if (input.altitude_ft != null && Number.isFinite(Number(input.altitude_ft))) {
    out.push({ command: 'setAltitude', params: { ID, altitude: ftToM(Number(input.altitude_ft)) } });
  }
  if (typeof input.altitude_type === 'string') {
    out.push({ command: 'setAltitudeType', params: { ID, altitudeType: input.altitude_type } });
  }
  if (input.speed_kt != null && Number.isFinite(Number(input.speed_kt))) {
    out.push({ command: 'setSpeed', params: { ID, speed: ktToMs(Number(input.speed_kt)) } });
  }
  if (typeof input.speed_type === 'string') {
    out.push({ command: 'setSpeedType', params: { ID, speedType: input.speed_type } });
  }
  return out;
}

export function buildDeleteParams(ID: number, explosion: boolean): Record<string, unknown> {
  return { ID, explosion, explosionType: '', immediate: true };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Dispatch a batch, staggering when large enough to stall the sim. */
async function dispatch(
  env: CommanderEnv,
  cmds: BuiltCommand[],
): Promise<{ ok: number; failed: number; firstError?: string }> {
  let ok = 0, failed = 0;
  let firstError: string | undefined;
  const stagger = cmds.length > STAGGER_THRESHOLD;
  for (let i = 0; i < cmds.length; i++) {
    try {
      const r = await env.send(cmds[i].command, cmds[i].params);
      if (r.ok) ok++; else { failed++; firstError ??= r.error; }
    } catch (e) {
      failed++;
      firstError ??= e instanceof Error ? e.message : 'send failed';
    }
    if (stagger && i < cmds.length - 1) await sleep(STAGGER_MS);
  }
  return { ok, failed, firstError };
}

function report(label: string, r: { ok: number; failed: number; firstError?: string }, notes: string[]): ToolExecResult {
  const total = r.ok + r.failed;
  const head = r.failed
    ? `✗ ${label}: ${r.ok}/${total} succeeded${r.firstError ? ` — ${r.firstError}` : ''}`
    : `✓ ${label}: ${r.ok}/${total} sent`;
  return { text: [head, ...notes].join('\n'), isError: r.ok === 0 && total > 0 };
}

/** Notes about skipped units, written for the model to relay honestly. */
function skipNotes(res: ResolvedIds, includeProtected: boolean): string[] {
  const notes: string[] = [];
  if (res.rejected.length) notes.push(`Skipped: ${res.rejected.join(' ')}`);
  if (!includeProtected && res.protectedUnits.length) {
    notes.push(`Skipped ${res.protectedUnits.length} protected Mission-Editor unit(s): ${res.protectedUnits.map(unitTag).join(', ')}. The Game Master must approve these explicitly.`);
  }
  return notes;
}

function targetsFor(res: ResolvedIds, includeProtected: boolean): CmdrUnit[] {
  return includeProtected ? [...res.valid, ...res.protectedUnits] : res.valid;
}

/**
 * Run one tool call. Never throws for expected failures — an error is returned
 * as an is_error tool result so the model can read it and self-correct.
 */
export async function executeCommanderTool(
  name: string,
  input: Record<string, unknown>,
  env: CommanderEnv,
  opts: { includeProtected?: boolean } = {},
): Promise<ToolExecResult> {
  const includeProtected = !!opts.includeProtected;

  if (!isKnownTool(name)) return { text: `Unknown tool "${name}".`, isError: true };
  const cap = requiredCap(name);
  if (cap && !env.caps[cap]) {
    return { text: `The Game Master's role does not grant "${cap}" — this action is unavailable.`, isError: true };
  }

  const units = env.getUnits();

  switch (name) {
    case 'get_picture':
      return {
        text: summarizePicture(units, env.getBullseye(), {
          coalition: input.coalition as 'red' | 'blue' | 'neutral' | 'all' | undefined,
          category: input.category as string | undefined,
          query: input.query as string | undefined,
          maxUnits: Number(input.max_units) || undefined,
        }),
      };

    case 'get_airbases':
      return { text: summarizeAirbases(env.getAirbases()) };

    case 'get_bullseye': {
      const be = env.getBullseye();
      return { text: be ? `Bullseye: ${be.lat.toFixed(5)}, ${be.lng.toFixed(5)}` : 'No bullseye is set for this mission.' };
    }

    case 'search_unit_types': {
      const cat = String(input.category || '') as CmdrDbCategory;
      if (!SPAWN_CMD[cat]) return { text: `Unknown category "${String(input.category)}".`, isError: true };
      try {
        const db = await env.getUnitDb(cat);
        return {
          text: summarizeUnitDbMatches(db, String(input.query || ''), {
            era: input.era as string | undefined,
            coalition: input.coalition as string | undefined,
            max: Number(input.max_results) || undefined,
          }),
        };
      } catch (e) {
        return { text: `Could not load the ${cat} database: ${e instanceof Error ? e.message : 'failed'}`, isError: true };
      }
    }

    case 'spawn_units': {
      const cat = String(input.category || '') as CmdrDbCategory;
      let db: Record<string, UnitDbEntry> = {};
      if (SPAWN_CMD[cat]) {
        try { db = await env.getUnitDb(cat); } catch { /* validated below */ }
      }
      const built = buildSpawnParams(input as SpawnInput, db[String(input.unit_type || '')]);
      if ('error' in built) return { text: built.error, isError: true };
      const r = await dispatch(env, [built]);
      const n = (built.params.units as unknown[]).length;
      return report(`Spawn ${n}× ${input.unit_type}`, r, []);
    }

    case 'move_units': {
      const res = resolveUnitIds(input.unit_ids, units);
      const targets = targetsFor(res, includeProtected);
      const notes = skipNotes(res, includeProtected);
      if (!targets.length) return { text: ['No commandable units.', ...notes].join('\n'), isError: true };
      const path = Array.isArray(input.path)
        ? (input.path as Array<Record<string, unknown>>)
          .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        : [];
      if (!path.length) return { text: 'path must contain at least one {lat,lng} waypoint.', isError: true };
      const r = await dispatch(env, targets.map((u) => ({
        command: 'setPath', params: { ID: u.olympusID, path },
      })));
      return report('Move', r, notes);
    }

    case 'set_altitude_speed': {
      const res = resolveUnitIds(input.unit_ids, units);
      const targets = targetsFor(res, includeProtected);
      const notes = skipNotes(res, includeProtected);
      if (!targets.length) return { text: ['No commandable units.', ...notes].join('\n'), isError: true };
      const cmds = targets.flatMap((u) => buildAltSpeedCommands(input, u.olympusID as number));
      if (!cmds.length) return { text: 'Nothing to set — supply altitude_ft and/or speed_kt.', isError: true };
      const r = await dispatch(env, cmds);
      return report('Set altitude/speed', r, notes);
    }

    case 'set_behavior': {
      const res = resolveUnitIds(input.unit_ids, units);
      const targets = targetsFor(res, includeProtected);
      const notes = skipNotes(res, includeProtected);
      if (!targets.length) return { text: ['No commandable units.', ...notes].join('\n'), isError: true };
      const cmds = targets.flatMap((u) => buildBehaviorCommands(input, u.olympusID as number));
      if (!cmds.length) return { text: 'Nothing to change — supply at least one behaviour field.', isError: true };
      const r = await dispatch(env, cmds);
      return report('Set behaviour', r, notes);
    }

    case 'attack_unit': {
      const res = resolveUnitIds(input.unit_ids, units);
      const targets = targetsFor(res, includeProtected);
      const notes = skipNotes(res, includeProtected);
      if (!targets.length) return { text: ['No commandable units.', ...notes].join('\n'), isError: true };
      const targetID = Number(input.target_id);
      const victim = units.find((u) => u.olympusID === targetID);
      if (!victim) return { text: `Target #${input.target_id} is not in the current picture.`, isError: true };
      if (victim.human === 1) return { text: `Target #${targetID} is human-piloted; AI cannot be ordered to attack a player this way.`, isError: true };
      const r = await dispatch(env, targets.map((u) => ({
        command: 'attackUnit', params: { ID: u.olympusID, targetID },
      })));
      return report(`Attack ${unitTag(victim)}`, r, notes);
    }

    case 'fire_at_point': {
      const res = resolveUnitIds(input.unit_ids, units);
      const targets = targetsFor(res, includeProtected);
      const notes = skipNotes(res, includeProtected);
      if (!targets.length) return { text: ['No commandable units.', ...notes].join('\n'), isError: true };
      const lat = Number(input.lat), lng = Number(input.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { text: 'lat and lng must be numbers.', isError: true };
      const command = input.mode === 'bomb_point' ? 'bombPoint' : 'fireAtArea';
      const r = await dispatch(env, targets.map((u) => ({
        command, params: { ID: u.olympusID, location: { lat, lng } },
      })));
      return report(command === 'bombPoint' ? 'Bomb point' : 'Fire at area', r, notes);
    }

    case 'delete_units': {
      const res = resolveUnitIds(input.unit_ids, units);
      const targets = targetsFor(res, includeProtected);
      const notes = skipNotes(res, includeProtected);
      if (!targets.length) return { text: ['No deletable units.', ...notes].join('\n'), isError: true };
      const explosion = input.explosion === true;
      const r = await dispatch(env, targets.map((u) => ({
        command: 'deleteUnit', params: buildDeleteParams(u.olympusID as number, explosion),
      })));
      return report('Delete', r, notes);
    }

    case 'spawn_effect': {
      const lat = Number(input.lat), lng = Number(input.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { text: 'lat and lng must be numbers.', isError: true };
      const built: BuiltCommand = input.kind === 'explosion'
        ? {
          command: 'explosion',
          params: {
            explosionType: String(input.explosion_type || ''),
            intensity: Number(input.intensity) || 50,
            location: { lat, lng },
          },
        }
        : {
          command: 'smoke',
          params: { color: String(input.color || 'green'), location: { lat, lng } },
        };
      const r = await dispatch(env, [built]);
      return report(input.kind === 'explosion' ? 'Explosion' : 'Smoke', r, []);
    }

    default:
      return { text: `Tool "${name}" is not implemented.`, isError: true };
  }
}

export { alwaysConfirm };
