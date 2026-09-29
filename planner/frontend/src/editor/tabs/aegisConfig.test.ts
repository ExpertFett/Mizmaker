import { describe, expect, it } from 'vitest';
import {
  AEGIS_OPTIONS, buildAegisSetupLua, changedOptions, presetValues, validateOptions,
  DEFAULT_SCRIPT_OPTIONS,
} from './aegisConfig';
import { findForeignAegisSetup } from './frameworkTriggers';
import { AEGIS_SYSTEMS, lookupAirDefense } from '../../data/airDefense';
import type { TriggerRule } from '../../types/mission';

describe('aegisConfig', () => {
  it('engine-default preset emits no config keys', () => {
    expect(changedOptions(presetValues('default'))).toEqual([]);
    const lua = buildAegisSetupLua({
      side: 'red', groupNames: ['SAM-SA10-NORTH'], pdLinks: [],
      values: presetValues('default'), script: DEFAULT_SCRIPT_OPTIONS,
    });
    expect(lua).toContain('AEGIS:New("red", {})');
    expect(lua).toContain('iads:Activate()');
    // F10 menu + map debug leak IADS state to the other side — off by default
    expect(lua).not.toContain('AddF10Menu');
    expect(lua).not.toContain('StartMapDebug');
  });

  it('activates the late-activated groups before starting AEGIS', () => {
    const lua = buildAegisSetupLua({
      side: 'blue', groupNames: ['SAM-HAWK-EAST', 'EW-EAST-DET120'], pdLinks: [],
      values: presetValues('default'), script: DEFAULT_SCRIPT_OPTIONS,
    });
    expect(lua.indexOf('g:activate()')).toBeGreaterThan(-1);
    expect(lua.indexOf('g:activate()')).toBeLessThan(lua.indexOf('AEGIS:New'));
    expect(lua).toContain('"EW-EAST-DET120",');
  });

  it('emits only changed keys, with Lua literals', () => {
    const v = { ...presetValues('default'), emconOnMin: 20, emconSpookEnabled: true, defaultZone: 'NEZ' };
    const lua = buildAegisSetupLua({
      side: 'red', groupNames: [], pdLinks: [{ pd: 'PD-SA15-NORTH', parent: 'SAM-SA10-NORTH' }],
      values: v, script: { debug: true, f10Menu: true, mapDebug: false },
    });
    expect(lua).toContain('emconOnMin = 20,');
    expect(lua).toContain('emconSpookEnabled = true,');
    expect(lua).toContain('defaultZone = "NEZ",');
    expect(lua).toContain('debug = true,');
    expect(lua).not.toContain('emconOnMax');
    expect(lua).toContain('iads:AddPointDefense("PD-SA15-NORTH", "SAM-SA10-NORTH")');
    expect(lua.indexOf('AddPointDefense')).toBeLessThan(lua.indexOf('iads:Activate()'));
    expect(lua).toContain('iads:AddF10Menu()');
  });

  it('escapes group names', () => {
    const lua = buildAegisSetupLua({
      side: 'red', groupNames: ['odd "name" \\ x'], pdLinks: [],
      values: presetValues('default'), script: DEFAULT_SCRIPT_OPTIONS,
    });
    expect(lua).toContain('"odd \\"name\\" \\\\ x",');
  });

  it('flags min > max and non-numbers', () => {
    expect(validateOptions(presetValues('hard'))).toEqual([]);
    expect(validateOptions(presetValues('training'))).toEqual([]);
    const bad = { ...presetValues('default'), emconOnMin: 200, harmCooldownMin: NaN };
    const errs = validateOptions(bad);
    expect(errs.some((e) => e.includes('Silent phase min'))).toBe(true);
    expect(errs.some((e) => e.includes('Go-dark min'))).toBe(true);
  });

  it('option keys are unique', () => {
    const keys = AEGIS_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('findForeignAegisSetup', () => {
  const rule = (name: string, action: TriggerRule['actions'][number]): TriggerRule => ({
    id: 1, name, enabled: true, oneTime: false, eventType: 'once', conditions: [], actions: [action],
  });
  it('ignores the engine load and our own generated rules', () => {
    expect(findForeignAegisSetup([
      rule('Script: AEGIS IADS', { type: 'DO_SCRIPT_FILE', params: { file: 'aegis-iads-v0.8.4-beta.lua' } } as never),
      rule('AEGIS Setup (red)', { type: 'DO_SCRIPT', params: { lua: 'AEGIS:New("red", {})' } } as never),
    ])).toBeNull();
  });
  it('detects a hand-written setup', () => {
    expect(findForeignAegisSetup([
      rule('my iads', { type: 'DO_SCRIPT', params: { lua: 'local i = AEGIS:New("red", {})' } } as never),
    ])).toBe('my iads');
    expect(findForeignAegisSetup([
      rule('setup file', { type: 'DO_SCRIPT_FILE', params: { file: 'aegis-setup.lua' } } as never),
    ])).toBe('setup file');
  });
});

describe('airDefense DB', () => {
  it('fixes the old mismatches', () => {
    expect(lookupAirDefense('2S6 Tunguska')?.id).toBe('SA19');           // was labelled SA-22 in AEGIS panel
    expect(lookupAirDefense('RPC_5N62V')?.aegis?.wez).toBe(125);         // was 55 in AEGIS panel
    expect(lookupAirDefense('snr s-125 tr')?.id).toBe('SA3');            // was missing from ring table
    expect(lookupAirDefense('M1097 Avenger')?.id).toBe('AVENGER');
    expect(lookupAirDefense('Hawk ln')?.nato).toBe('MIM-23 Hawk');       // card said SA-24
  });
  it('substring order: specific beats generic', () => {
    expect(lookupAirDefense('Strela-10M3')?.id).toBe('SA13');
    expect(lookupAirDefense('Strela-1 9P31')?.id).toBe('SA9');
    expect(lookupAirDefense('Buk-M2 9S36 Fire Dome tr')?.id).toBe('SA17');
    expect(lookupAirDefense('S-300PS 5P85C ln')?.id).toBe('SA10');
    expect(lookupAirDefense('Monitor')).toBeNull();                      // old bare 'Tor' key hit this
  });
  it('EW radars are role ew', () => {
    expect(lookupAirDefense('1L13 EWR')?.role).toBe('ew');
    expect(lookupAirDefense('55G6 EWR')?.role).toBe('ew');
  });
  it('AEGIS codes are unique', () => {
    const codes = AEGIS_SYSTEMS.map((s) => s.aegis.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
