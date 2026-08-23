/**
 * ID validation and Olympus param construction.
 *
 * The spawn-shape test is the important one: Olympus silently drops a spawn
 * that carries any extra field, returning 200 with nothing spawned. An exact
 * key-set assertion is the only way that regression shows up in CI rather than
 * as "the AI said it spawned a flight and nothing appeared".
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildAltSpeedCommands, buildBehaviorCommands, buildDeleteParams, buildSpawnParams,
  executeCommanderTool, ftToM, ktToMs, resolveUnitIds,
  alarmToInt, emissionsToInt, reactionToInt, roeToInt,
} from './commanderExecutors';
import type { CmdrUnit, CommanderEnv } from './commanderTypes';
import type { UnitDbEntry } from '../../../api/groups';

const unit = (over: Partial<CmdrUnit> = {}): CmdrUnit => ({
  olympusID: 1, name: 'FA-18C_hornet', unitName: 'Enfield 1-1',
  category: 'Aircraft', coalition: 2, alive: 1, controlled: 1, human: 0,
  position: { lat: 41, lng: 42, alt: 6096 },
  ...over,
});

const AIR_DB: Record<string, UnitDbEntry> = {
  'Su-27': {
    label: 'Su-27 Flanker-B',
    loadouts: [
      { name: 'CAP Heavy', code: 'LOADOUT_CAP', roles: ['CAP'] },
      { name: 'Ferry', code: 'LOADOUT_FERRY', roles: ['Ferry'] },
    ],
  },
};

function makeEnv(over: Partial<CommanderEnv> = {}): CommanderEnv {
  return {
    getUnits: () => [unit()],
    getAirbases: () => [],
    getBullseye: () => null,
    caps: { spawn: true, command: true, delete: true, effects: true },
    send: vi.fn(async () => ({ ok: true })),
    getUnitDb: async () => AIR_DB,
    ...over,
  };
}

describe('conversions', () => {
  it('feet to metres', () => expect(ftToM(20000)).toBe(6096));
  it('knots to m/s', () => expect(ktToMs(400)).toBe(206));
});

describe('enum mappers', () => {
  it('ROE is 1-based', () => {
    expect(roeToInt('free')).toBe(1);
    expect(roeToInt('hold')).toBe(4);
  });
  it('alarm/reaction/emissions are 0-based', () => {
    expect(alarmToInt('auto')).toBe(0);
    expect(alarmToInt('red')).toBe(2);
    expect(reactionToInt('none')).toBe(0);
    expect(emissionsToInt('silent')).toBe(0);
    expect(emissionsToInt('free')).toBe(3);
  });
  it('returns undefined for an unknown word rather than 0', () => {
    expect(roeToInt('weapons-free-ish')).toBeUndefined();
  });
});

describe('resolveUnitIds', () => {
  const units = [
    unit({ olympusID: 1 }),
    unit({ olympusID: 2, controlled: 0 }),        // Mission-Editor
    unit({ olympusID: 3, human: 1 }),             // real player
    unit({ olympusID: 4, alive: 0 }),             // destroyed
  ];

  it('accepts a live AI unit', () => {
    expect(resolveUnitIds([1], units).valid.map((u) => u.olympusID)).toEqual([1]);
  });
  it('separates protected Mission-Editor units', () => {
    const r = resolveUnitIds([1, 2], units);
    expect(r.valid.map((u) => u.olympusID)).toEqual([1]);
    expect(r.protectedUnits.map((u) => u.olympusID)).toEqual([2]);
  });
  it('never returns a human-piloted unit', () => {
    const r = resolveUnitIds([3], units);
    expect(r.valid).toHaveLength(0);
    expect(r.protectedUnits).toHaveLength(0);
    expect(r.rejected[0]).toMatch(/human-piloted/);
  });
  it('rejects destroyed units', () => {
    expect(resolveUnitIds([4], units).rejected[0]).toMatch(/destroyed/);
  });
  it('rejects IDs that are not in the picture', () => {
    expect(resolveUnitIds([999], units).rejected[0]).toMatch(/not in the current picture/);
  });
  it('rejects non-numeric IDs', () => {
    expect(resolveUnitIds(['Enfield'], units).rejected[0]).toMatch(/not a numeric/);
  });
  it('reports an empty list', () => {
    expect(resolveUnitIds([], units).rejected[0]).toMatch(/No unit_ids/);
  });
});

describe('buildSpawnParams', () => {
  const base = { category: 'aircraft', unit_type: 'Su-27', coalition: 'red', lat: 41, lng: 42 };

  it('builds the exact Olympus unit shape and NOTHING else', () => {
    const built = buildSpawnParams({ ...base, altitude_ft: 20000 }, AIR_DB['Su-27']);
    expect('error' in built).toBe(false);
    if ('error' in built) return;
    const u = (built.params.units as Array<Record<string, unknown>>)[0];
    // Any extra key here makes Olympus silently drop the spawn.
    expect(Object.keys(u).sort()).toEqual(['altitude', 'liveryID', 'loadout', 'location', 'skill', 'unitType']);
  });

  it('omits altitude and loadout for ground units', () => {
    const built = buildSpawnParams(
      { category: 'groundunit', unit_type: 'Su-27', coalition: 'red', lat: 1, lng: 2 },
      AIR_DB['Su-27'],
    );
    if ('error' in built) throw new Error(built.error);
    const u = (built.params.units as Array<Record<string, unknown>>)[0];
    expect(Object.keys(u).sort()).toEqual(['liveryID', 'location', 'skill', 'unitType']);
    expect(built.params.airbaseName).toBeUndefined();
  });

  it('sets airbaseName only for air spawns', () => {
    const air = buildSpawnParams(base, AIR_DB['Su-27']);
    if ('error' in air) throw new Error(air.error);
    expect(air.params.airbaseName).toBe('');
  });

  it('converts altitude from feet to metres', () => {
    const built = buildSpawnParams({ ...base, altitude_ft: 20000 }, AIR_DB['Su-27']);
    if ('error' in built) throw new Error(built.error);
    expect((built.params.units as Array<Record<string, unknown>>)[0].altitude).toBe(6096);
  });

  it('resolves a loadout name to its code', () => {
    const built = buildSpawnParams({ ...base, loadout_name: 'CAP Heavy' }, AIR_DB['Su-27']);
    if ('error' in built) throw new Error(built.error);
    expect((built.params.units as Array<Record<string, unknown>>)[0].loadout).toBe('LOADOUT_CAP');
  });

  it('lists the valid loadouts when the name is wrong', () => {
    const built = buildSpawnParams({ ...base, loadout_name: 'Bombs' }, AIR_DB['Su-27']);
    expect('error' in built && built.error).toMatch(/CAP Heavy, Ferry/);
  });

  it('refuses an unknown unit type and points at search_unit_types', () => {
    const built = buildSpawnParams(base, undefined);
    expect('error' in built && built.error).toMatch(/search_unit_types/);
  });

  it('picks the right command per category', () => {
    const heli = buildSpawnParams({ ...base, category: 'helicopter' }, AIR_DB['Su-27']);
    if ('error' in heli) throw new Error(heli.error);
    expect(heli.command).toBe('spawnHelicopters');
  });

  it('clamps count to 8', () => {
    const built = buildSpawnParams({ ...base, count: 50 }, AIR_DB['Su-27']);
    if ('error' in built) throw new Error(built.error);
    expect((built.params.units as unknown[]).length).toBe(8);
  });

  it('scatters multiple units instead of stacking them', () => {
    const built = buildSpawnParams({ ...base, count: 2, spread_nm: 1 }, AIR_DB['Su-27']);
    if ('error' in built) throw new Error(built.error);
    const us = built.params.units as Array<{ location: { lat: number; lng: number } }>;
    expect(us[0].location).not.toEqual(us[1].location);
  });

  it('rejects a bad coalition', () => {
    const built = buildSpawnParams({ ...base, coalition: 'purple' }, AIR_DB['Su-27']);
    expect('error' in built && built.error).toMatch(/coalition/);
  });
});

describe('command builders', () => {
  it('builds behaviour commands with the right enum bases', () => {
    const cmds = buildBehaviorCommands({ roe: 'hold', alarm_state: 'red' }, 7);
    expect(cmds).toEqual([
      { command: 'setROE', params: { ID: 7, ROE: 4 } },
      { command: 'setAlarmState', params: { ID: 7, alarmState: 2 } },
    ]);
  });
  it('emits nothing when no behaviour field is supplied', () => {
    expect(buildBehaviorCommands({}, 7)).toEqual([]);
  });
  it('converts altitude and speed units', () => {
    const cmds = buildAltSpeedCommands({ altitude_ft: 20000, speed_kt: 400 }, 7);
    expect(cmds).toEqual([
      { command: 'setAltitude', params: { ID: 7, altitude: 6096 } },
      { command: 'setSpeed', params: { ID: 7, speed: 206 } },
    ]);
  });
  it('builds the delete param shape', () => {
    expect(buildDeleteParams(7, false)).toEqual({ ID: 7, explosion: false, explosionType: '', immediate: true });
  });
});

describe('executeCommanderTool', () => {
  it('refuses a tool the role does not permit', async () => {
    const env = makeEnv({ caps: { spawn: false, command: true, delete: false, effects: false } });
    const r = await executeCommanderTool('delete_units', { unit_ids: [1] }, env);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/does not grant/);
    expect(env.send).not.toHaveBeenCalled();
  });

  it('re-validates IDs at execution time against the live snapshot', async () => {
    // The unit was in the picture when proposed but has since died.
    const env = makeEnv({ getUnits: () => [] });
    const r = await executeCommanderTool('set_behavior', { unit_ids: [1], roe: 'hold' }, env);
    expect(r.isError).toBe(true);
    expect(env.send).not.toHaveBeenCalled();
  });

  it('skips protected units unless the GM approved them', async () => {
    const env = makeEnv({ getUnits: () => [unit({ olympusID: 2, controlled: 0 })] });
    const r = await executeCommanderTool('set_behavior', { unit_ids: [2], roe: 'hold' }, env);
    expect(env.send).not.toHaveBeenCalled();
    expect(r.text).toMatch(/protected/i);
  });

  it('commands protected units once approved', async () => {
    const env = makeEnv({ getUnits: () => [unit({ olympusID: 2, controlled: 0 })] });
    await executeCommanderTool('set_behavior', { unit_ids: [2], roe: 'hold' }, env, { includeProtected: true });
    expect(env.send).toHaveBeenCalledWith('setROE', { ID: 2, ROE: 4 });
  });

  it('reports partial failure honestly', async () => {
    const env = makeEnv({
      getUnits: () => [unit({ olympusID: 1 }), unit({ olympusID: 2 })],
      send: vi.fn(async (_c: string, p: Record<string, unknown>) =>
        (p.ID === 1 ? { ok: true } : { ok: false, error: 'Olympus rejected' })),
    });
    const r = await executeCommanderTool('set_behavior', { unit_ids: [1, 2], roe: 'free' }, env);
    expect(r.text).toMatch(/1\/2 succeeded/);
    expect(r.text).toMatch(/Olympus rejected/);
  });

  it('never targets a human even when explicitly asked', async () => {
    const env = makeEnv({ getUnits: () => [unit({ olympusID: 1 }), unit({ olympusID: 9, human: 1 })] });
    const r = await executeCommanderTool('attack_unit', { unit_ids: [1], target_id: 9 }, env);
    expect(r.isError).toBe(true);
    expect(env.send).not.toHaveBeenCalled();
  });

  it('builds smoke without an ID (it is a map effect, not a unit order)', async () => {
    const env = makeEnv();
    await executeCommanderTool('spawn_effect', { kind: 'smoke', lat: 1, lng: 2, color: 'red' }, env);
    expect(env.send).toHaveBeenCalledWith('smoke', { color: 'red', location: { lat: 1, lng: 2 } });
  });

  it('rejects an unknown tool name', async () => {
    const r = await executeCommanderTool('launch_nukes', {}, makeEnv());
    expect(r.isError).toBe(true);
  });
});
