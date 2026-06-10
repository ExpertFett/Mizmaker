/**
 * Tests for the comm-asset applier (#61) — staging groupFrequency /
 * groupModulation edits that bring mission tankers / AWACS onto the
 * comm-plan nets the players will tune.
 */

import { describe, it, expect } from 'vitest';
import { applyCommAssetsSop } from './comms';
import type { MissionGroup, MissionUnit, UnitEdit } from '../../types/mission';
import type { SOP, CommPlan } from '../types';

function unit(o: Partial<MissionUnit> = {}): MissionUnit {
  return {
    unitId: 1, name: 'x', type: 'KC-135', x: 0, y: 0,
    skill: 'High', category: 'plane', coalition: 'blue', country: 'USA',
    groupName: 'g', groupId: 1, ...o,
  };
}
function group(o: Partial<MissionGroup> = {}): MissionGroup {
  return {
    groupId: 1, groupName: 'g', coalition: 'blue', country: 'USA',
    category: 'plane', task: 'CAS', frequency: 250_000_000, modulation: 0,
    units: [unit()], waypoints: [], ...o,
  };
}
function sop(commPlan?: CommPlan): SOP {
  return { id: 's', name: 'S', updatedAt: 0, flights: [], comms: [], tacans: [], commPlan };
}

const planWithTanker: CommPlan = {
  nets: [{ id: 'tx', name: 'Texaco 1', kind: 'radio', frequency: 332.1, modulation: 'AM' }],
  maps: [],
};

describe('applyCommAssetsSop', () => {
  it('stages a groupFrequency edit (in Hz) when the tanker is off the net freq', () => {
    const groups = [group({ groupId: 9, groupName: 'Shell', task: 'Refueling', frequency: 251_000_000 })];
    const action = applyCommAssetsSop(groups, sop(planWithTanker));
    expect(action.itemsAffected).toBe(1);
    const freqEdit = action.edits.find((e) => (e as UnitEdit).field === 'groupFrequency') as UnitEdit;
    expect(freqEdit).toBeTruthy();
    expect(freqEdit.groupId).toBe(9);
    expect(freqEdit.value).toBe(332_100_000); // MHz → Hz, integer
  });

  it('also stages groupModulation when the modulation differs', () => {
    const fmPlan: CommPlan = {
      nets: [{ id: 'tx', name: 'Texaco 1', kind: 'radio', frequency: 40.0, modulation: 'FM' }],
      maps: [],
    };
    const groups = [group({ groupId: 9, groupName: 'Shell', task: 'Refueling', frequency: 251_000_000, modulation: 0 })];
    const action = applyCommAssetsSop(groups, sop(fmPlan));
    const modEdit = action.edits.find((e) => (e as UnitEdit).field === 'groupModulation') as UnitEdit;
    expect(modEdit).toBeTruthy();
    expect(modEdit.value).toBe(1); // FM
  });

  it('no-ops when the asset already matches the net (no edits)', () => {
    const groups = [group({ groupId: 9, groupName: 'Shell', task: 'Refueling', frequency: 332_100_000, modulation: 0 })];
    const action = applyCommAssetsSop(groups, sop(planWithTanker));
    expect(action.edits.length).toBe(0);
    expect(action.itemsAffected).toBe(0);
    expect(action.skippedReason).toBeTruthy();
  });

  it('skips entirely when the SOP has no comm plan', () => {
    const groups = [group({ groupName: 'Shell', task: 'Refueling' })];
    const action = applyCommAssetsSop(groups, sop(undefined));
    expect(action.edits.length).toBe(0);
    expect(action.skippedReason).toMatch(/no comm plan/i);
  });
});
