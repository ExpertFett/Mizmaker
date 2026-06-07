/**
 * EMCON / Zip-Lip script-emission tests for generateMooseCarrierScript.
 *
 * The generator is a pure function — these lock down the Lua it emits for
 * each EMCON profile so a future refactor can't silently break the
 * radar/ROE/ALARM constants or drop the F10 menu wiring.
 */

import { describe, it, expect } from 'vitest';
import { generateMooseCarrierScript, type CarrierConfig } from './CarrierSetupPanel';

function carrier(overrides: Partial<CarrierConfig> = {}): CarrierConfig {
  return {
    groupId: 1,
    groupName: 'TR CSG',
    unitType: 'Stennis',
    coalition: 'blue',
    label: 'CVN',
    callsign: 'Rough Rider',
    tacanCh: 74,
    tacanBand: 'X',
    tacanCallsign: 'CVN',
    iclsCh: 7,
    aclsEnabled: true,
    hasIcls: true,
    tiwSpeed: 25,
    rescueHeloGroup: '',
    rescueModex: 42,
    flagBase: 1,
    emcon: 'off',
    ...overrides,
  };
}

describe('generateMooseCarrierScript — EMCON', () => {
  it('emits NO EMCON block when emcon = off', () => {
    const lua = generateMooseCarrierScript([carrier({ emcon: 'off' })]);
    expect(lua).not.toMatch(/_emconOn\b/);
    expect(lua).not.toMatch(/_emconOff\b/);
    expect(lua).not.toMatch(/EMCON · /);
    expect(lua).not.toMatch(/enableEmission\(false\)/);
  });

  it('Zip-Lip uses ALARM GREEN (1) + ROE WEAPON HOLD (4)', () => {
    const lua = generateMooseCarrierScript([carrier({ emcon: 'zip_lip' })]);
    expect(lua).toMatch(/ALARM_STATE, 1\)/);
    expect(lua).toMatch(/ROE, 4\)/);
    expect(lua).toMatch(/ZIP-LIP set/);
  });

  it('EMCON Alpha uses ALARM RED (2) + ROE OPEN FIRE (2)', () => {
    const lua = generateMooseCarrierScript([carrier({ emcon: 'alpha' })]);
    expect(lua).toMatch(/ALARM_STATE, 2\)/);
    expect(lua).toMatch(/ROE, 2\)/);
    expect(lua).toMatch(/EMCON ALPHA set/);
  });

  it('emconOff always restores ALARM RED + ROE OPEN FIRE regardless of profile', () => {
    const lua = generateMooseCarrierScript([carrier({ emcon: 'zip_lip' })]);
    // Grab the whole emconOff function — from its definition to the final
    // top-of-column `end` that closes it (multiline mode).
    const m = lua.match(/function \w+_emconOff\(\)([\s\S]+?)\nend\n/);
    expect(m).not.toBeNull();
    const offBody = m![1];
    expect(offBody).toMatch(/enableEmission\(true\)/);
    expect(offBody).toMatch(/ALARM_STATE, 2\)/);  // ALARM RED — re-arms search
    expect(offBody).toMatch(/ROE, 2\)/);          // OPEN_FIRE — re-arms engagement
  });

  it('iterates ALL ship units (not just the carrier) for emission control', () => {
    const lua = generateMooseCarrierScript([carrier({ emcon: 'zip_lip' })]);
    expect(lua).toMatch(/for _, u in ipairs\(grp:getUnits\(\)\) do\s+u:enableEmission\(false\)/);
  });

  it('wires an F10 submenu per carrier with both Set + Lift entries', () => {
    const lua = generateMooseCarrierScript([carrier({ emcon: 'zip_lip', callsign: 'Rough Rider' })]);
    expect(lua).toMatch(/missionCommands\.addSubMenu\("EMCON · Rough Rider"\)/);
    expect(lua).toMatch(/missionCommands\.addCommand\("Set ZIP-LIP"/);
    expect(lua).toMatch(/missionCommands\.addCommand\("Lift EMCON \(emissions live\)"/);
  });

  it('applies EMCON at activation via timer.scheduleFunction', () => {
    const lua = generateMooseCarrierScript([carrier({ emcon: 'zip_lip' })]);
    expect(lua).toMatch(/timer\.scheduleFunction\(\w+_emconOn,/);
  });

  it('handles a mixed fleet (one Zip-Lip, one off) cleanly', () => {
    const lua = generateMooseCarrierScript([
      carrier({ groupId: 1, callsign: 'Rough Rider', emcon: 'zip_lip' }),
      carrier({ groupId: 2, callsign: 'Lincoln', emcon: 'off', label: 'CVN' }),
    ]);
    expect(lua).toMatch(/EMCON · Rough Rider/);
    expect(lua).not.toMatch(/EMCON · Lincoln/);
  });
});
