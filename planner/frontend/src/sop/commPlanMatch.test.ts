/**
 * Tests for the comm-plan matching + channel-building helpers (#61).
 * These are the pure core shared by SOP Check and the Auto-Setup
 * appliers, so locking them down protects both the report and the
 * frequency-enforcement writeback.
 */

import { describe, it, expect } from 'vitest';
import {
  channelsFromCommPlan,
  classifyNetRole,
  groupAssetRole,
  matchAssetNets,
} from './commPlanMatch';
import type { MissionGroup, MissionUnit } from '../types/mission';
import type { CommPlan } from './types';

function unit(o: Partial<MissionUnit> = {}): MissionUnit {
  return {
    unitId: 1, name: 'x', type: 'FA-18C_hornet', x: 0, y: 0,
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

// A Hornet plan: two radios sharing a net, plus a tanker + AWACS net.
const plan: CommPlan = {
  nets: [
    { id: 'n_tower', name: 'Tower CVN', kind: 'radio', frequency: 228.5, modulation: 'AM' },
    { id: 'n_texaco', name: 'Texaco 1', kind: 'radio', frequency: 332.1, modulation: 'AM' },
    { id: 'n_overlord', name: 'Overlord', kind: 'radio', frequency: 251.0, modulation: 'AM' },
    { id: 'n_mids', name: 'MIDS A Flight', kind: 'midsA', midsChannel: 1 },
  ],
  maps: [
    { aircraft: 'FA-18C_hornet', radio: 1, buttons: { 1: 'n_tower', 11: 'n_texaco', 24: 'n_overlord' } },
    { aircraft: 'FA-18C_hornet', radio: 2, buttons: { 1: 'n_overlord', 19: 'n_mids' } },
  ],
};

describe('channelsFromCommPlan', () => {
  it('builds per-radio specs, skips MIDS + empty, preserves sparse ch 24', () => {
    const out = channelsFromCommPlan('FA-18C_hornet', plan)!;
    expect(out).toBeTruthy();
    expect([...out.keys()].sort()).toEqual([1, 2]);
    const r1 = out.get(1)!;
    expect(r1.map((c) => c.ch)).toEqual([1, 11, 24]); // 24-channel radio survives
    expect(r1.find((c) => c.ch === 11)).toMatchObject({ freq_mhz: 332.1, modulation: 0, name: 'Texaco 1' });
    // Radio 2 button 19 is MIDS — skipped (no freq written to a .miz preset slot)
    const r2 = out.get(2)!;
    expect(r2.map((c) => c.ch)).toEqual([1]);
  });

  it('returns null for an airframe the plan does not cover', () => {
    expect(channelsFromCommPlan('F-14B', plan)).toBeNull();
    expect(channelsFromCommPlan('FA-18C_hornet', undefined)).toBeNull();
  });
});

describe('role classification', () => {
  it('classifies net names by callsign / keyword', () => {
    expect(classifyNetRole('Texaco 1')).toBe('tanker');
    expect(classifyNetRole('Shell')).toBe('tanker');
    expect(classifyNetRole('Overlord')).toBe('awacs');
    expect(classifyNetRole('Magic')).toBe('awacs');
    expect(classifyNetRole('Marshal CVN')).toBeNull();
  });

  it('classifies mission groups by task first, then name', () => {
    expect(groupAssetRole(group({ task: 'Refueling' }))).toBe('tanker');
    expect(groupAssetRole(group({ task: 'AWACS' }))).toBe('awacs');
    expect(groupAssetRole(group({ task: 'CAS', groupName: 'Shell' }))).toBe('tanker');
    expect(groupAssetRole(group({ task: 'CAS', groupName: 'Bengal' }))).toBeNull();
    // Player groups are never assets even if named like one
    expect(groupAssetRole(group({ groupName: 'Texaco', units: [unit({ skill: 'Client' })] }))).toBeNull();
  });
});

describe('matchAssetNets', () => {
  it('pairs a mission tanker + AWACS with their nets by role', () => {
    const groups = [
      group({ groupId: 10, groupName: 'Shell', task: 'Refueling', frequency: 251_000_000 }),
      group({ groupId: 11, groupName: 'Wizard', task: 'AWACS', frequency: 260_000_000 }),
      group({ groupId: 12, groupName: 'Bengal 1', task: 'CAS', units: [unit({ skill: 'Client' })] }),
    ];
    const pairs = matchAssetNets(groups, plan);
    expect(pairs.length).toBe(2);
    const tanker = pairs.find((p) => p.role === 'tanker')!;
    expect(tanker.group.groupId).toBe(10);
    expect(tanker.net.name).toBe('Texaco 1');
    const awacs = pairs.find((p) => p.role === 'awacs')!;
    expect(awacs.group.groupId).toBe(11);
    expect(awacs.net.name).toBe('Overlord');
  });

  it('pairs two tankers to two tanker nets by sorted order', () => {
    const twoTankerPlan: CommPlan = {
      nets: [
        { id: 'a', name: 'Arco 1', kind: 'radio', frequency: 330.0, modulation: 'AM' },
        { id: 'b', name: 'Texaco 1', kind: 'radio', frequency: 332.1, modulation: 'AM' },
      ],
      maps: [],
    };
    const groups = [
      group({ groupId: 20, groupName: 'Shell', task: 'Refueling' }),
      group({ groupId: 21, groupName: 'Arco', task: 'Refueling' }),
    ];
    const pairs = matchAssetNets(groups, twoTankerPlan);
    expect(pairs.length).toBe(2);
    // Sorted by name: groups [Arco(21), Shell(20)] ↔ nets [Arco 1, Texaco 1]
    expect(pairs[0].group.groupId).toBe(21);
    expect(pairs[0].net.name).toBe('Arco 1');
    expect(pairs[1].group.groupId).toBe(20);
    expect(pairs[1].net.name).toBe('Texaco 1');
  });

  it('returns nothing when the plan has no asset nets', () => {
    const groups = [group({ groupName: 'Shell', task: 'Refueling' })];
    const bare: CommPlan = { nets: [{ id: 't', name: 'Tower', kind: 'radio', frequency: 228.5 }], maps: [] };
    expect(matchAssetNets(groups, bare)).toEqual([]);
  });
});
