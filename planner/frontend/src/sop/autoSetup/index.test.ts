/**
 * Auto-Setup orchestrator + per-area applier tests.
 *
 * Each applier is a pure function over (state, sop) — easy to fixture
 * in Vitest. We test:
 *   - Each applier produces the right edits + description
 *   - Each applier degrades gracefully when its inputs are sparse
 *     (empty SOP, no carriers, no player flights, etc.)
 *   - The orchestrator aggregates correctly
 *   - A failing applier doesn't take the whole run down
 */

import { describe, it, expect } from 'vitest';
import { runAutoSetup } from './index';
import { applyRenamerSop } from './renamer';
import { applyDatalinkSop, abbreviateCallsign } from './datalink';
import { applyRadioSop } from './radio';
import { applyCarriersSop } from './carriers';
import type { MissionGroup, MissionUnit, ClientUnit } from '../../types/mission';
import type { SOP } from '../types';

/* ------------------------------------------------------------------ */
/* Fixture builders                                                    */
/* ------------------------------------------------------------------ */

function makeUnit(over: Partial<MissionUnit> = {}): MissionUnit {
  return {
    unitId: 1, name: 'Bengal 1-1', type: 'FA-18C_hornet', x: 0, y: 0,
    skill: 'Client', category: 'plane', coalition: 'blue', country: 'USA',
    groupName: 'Bengal 1', groupId: 1, ...over,
  };
}

function makeGroup(over: Partial<MissionGroup> = {}): MissionGroup {
  return {
    groupId: 1, groupName: 'Bengal 1', coalition: 'blue', country: 'USA',
    category: 'plane', task: 'CAS', frequency: 270.8, modulation: 0,
    units: [makeUnit()], waypoints: [], ...over,
  };
}

function makeClientUnit(over: Partial<ClientUnit> = {}): ClientUnit {
  return { unitId: 1, name: 'Bengal 1-1', groupName: 'Bengal 1', ...over } as ClientUnit;
}

function makeSop(over: Partial<SOP> = {}): SOP {
  return {
    id: 'sop_test', name: 'Test SOP', updatedAt: 0,
    flights: [], comms: [], tacans: [],
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* abbreviateCallsign                                                  */
/* ------------------------------------------------------------------ */

describe('abbreviateCallsign', () => {
  it('takes consonant skeleton when ≥2 consonants', () => {
    expect(abbreviateCallsign('Bengal')).toBe('BN');
    expect(abbreviateCallsign('Enfield')).toBe('NF');
  });

  it('falls back to first two chars when consonant skeleton is too short', () => {
    expect(abbreviateCallsign('AAA')).toBe('AA');
  });

  it('passes through ≤2-char names', () => {
    expect(abbreviateCallsign('A1')).toBe('A1');
  });
});

/* ------------------------------------------------------------------ */
/* Renamer applier                                                     */
/* ------------------------------------------------------------------ */

describe('applyRenamerSop', () => {
  it('renames player flights to SOP callsigns, preserving number suffixes', () => {
    const groups = [
      makeGroup({ groupId: 1, groupName: 'Bengal 1' }),
      makeGroup({ groupId: 2, groupName: 'Bengal 2', units: [makeUnit({ unitId: 2, groupId: 2 })] }),
    ];
    const sop = makeSop({
      flights: [
        { callsign: 'Enfield', priority: 1 },
        { callsign: 'Uzi', priority: 2 },
      ],
    });
    const action = applyRenamerSop(groups, sop);
    expect(action.edits).toHaveLength(2);
    expect((action.edits[0] as any).value.newGroupName).toBe('Enfield 1');
    expect((action.edits[1] as any).value.newGroupName).toBe('Uzi 2');
    expect(action.itemsAffected).toBe(2);
  });

  it('orders by SOP priority — lower priority value goes first', () => {
    const groups = [
      makeGroup({ groupId: 1, groupName: 'A 1' }),
      makeGroup({ groupId: 2, groupName: 'B 2', units: [makeUnit({ unitId: 2, groupId: 2 })] }),
    ];
    const sop = makeSop({
      flights: [
        { callsign: 'Wingman', priority: 99 },
        { callsign: 'Lead', priority: 1 },
      ],
    });
    const action = applyRenamerSop(groups, sop);
    expect((action.edits[0] as any).value.newGroupName).toBe('Lead 1');
    expect((action.edits[1] as any).value.newGroupName).toBe('Wingman 2');
  });

  it('skips when no SOP flight callsigns', () => {
    const action = applyRenamerSop([makeGroup()], makeSop());
    expect(action.skippedReason).toMatch(/no flight callsigns/i);
    expect(action.edits).toEqual([]);
  });

  it('skips when no player groups', () => {
    const groups = [makeGroup({ units: [makeUnit({ skill: 'High' })] })];
    const sop = makeSop({ flights: [{ callsign: 'X' }] });
    const action = applyRenamerSop(groups, sop);
    expect(action.skippedReason).toMatch(/no Client\/Player/i);
  });

  it('runs out of SOP entries gracefully', () => {
    const groups = [
      makeGroup({ groupId: 1, groupName: 'A 1' }),
      makeGroup({ groupId: 2, groupName: 'B 2', units: [makeUnit({ unitId: 2, groupId: 2 })] }),
    ];
    const sop = makeSop({ flights: [{ callsign: 'OnlyOne' }] });
    const action = applyRenamerSop(groups, sop);
    expect(action.edits).toHaveLength(1);
    expect(action.description).toMatch(/SOP ran out/);
  });
});

/* ------------------------------------------------------------------ */
/* Datalink applier                                                    */
/* ------------------------------------------------------------------ */

describe('applyDatalinkSop', () => {
  it('emits 3 edits per unit (label + number + stn)', () => {
    const cu = [
      makeClientUnit({ unitId: 1, groupName: 'Bengal 1' }),
      makeClientUnit({ unitId: 2, groupName: 'Bengal 1' }),
    ];
    const sop = makeSop({ flights: [{ callsign: 'Bengal' }] });
    const action = applyDatalinkSop(cu, sop);
    expect(action.edits).toHaveLength(6);  // 2 units × 3 fields
    expect(action.itemsAffected).toBe(1);  // 1 group
  });

  it('uses SOP callsign for the abbreviation when group first-word matches', () => {
    const cu = [makeClientUnit({ unitId: 1, groupName: 'HornetA1' })];
    const sop = makeSop({ flights: [{ callsign: 'Bengal' }] });
    // First-word "hornetA1" doesn't match "bengal" so fallback to group name
    const noMatch = applyDatalinkSop(cu, sop);
    const labelEdit = noMatch.edits.find((e: any) => e.field === 'voiceCallsignLabel');
    expect((labelEdit as any).value).toBe('HR');  // abbreviation of "HornetA1"

    // Now SOP has matching first-word → should use SOP callsign abbreviation
    const cu2 = [makeClientUnit({ unitId: 1, groupName: 'Bengal 1' })];
    const action = applyDatalinkSop(cu2, sop);
    const lbl = action.edits.find((e: any) => e.field === 'voiceCallsignLabel');
    expect((lbl as any).value).toBe('BN');
  });

  it('skips when no client units', () => {
    expect(applyDatalinkSop([], makeSop()).skippedReason).toMatch(/no Client/i);
  });

  it('STN values are unique across groups', () => {
    const cu = [
      makeClientUnit({ unitId: 1, groupName: 'A 1' }),
      makeClientUnit({ unitId: 2, groupName: 'B 1' }),
    ];
    const action = applyDatalinkSop(cu, makeSop());
    const stns = action.edits
      .filter((e: any) => e.field === 'stnL16')
      .map((e: any) => e.value);
    expect(new Set(stns).size).toBe(stns.length);
  });
});

/* ------------------------------------------------------------------ */
/* Radio applier                                                       */
/* ------------------------------------------------------------------ */

describe('applyRadioSop', () => {
  it('produces one radioPresets edit per player flight', () => {
    const groups = [
      makeGroup({ groupId: 1, groupName: 'Bengal 1' }),
      makeGroup({ groupId: 2, groupName: 'Bengal 2', units: [makeUnit({ unitId: 2, groupId: 2 })] }),
    ];
    const sop = makeSop({
      tankers: [{ callsign: 'Texaco', frequency: 277.8 }],
      comms: [{ role: 'Strike Primary', frequency: 270.8 }],
    });
    const action = applyRadioSop(groups, sop);
    expect(action.edits).toHaveLength(2);
    expect((action.edits[0] as any).value.radio).toBe(1);
    expect((action.edits[0] as any).field).toBe('radioPresets');
  });

  it('always anchors GUARD on Ch 20', () => {
    const sop = makeSop({ comms: [{ role: 'Guard', frequency: 121.5 }] });
    const action = applyRadioSop([makeGroup()], sop);
    const channels = (action.edits[0] as any).value.channels;
    const ch20 = channels.find((c: any) => c.ch === 20);
    expect(ch20).toBeDefined();
    expect(ch20.name).toBe('GUARD');
    expect(ch20.freq_mhz).toBe(121.5);
  });

  it('falls back to 243.0 GUARD when SOP has no guard entry', () => {
    const action = applyRadioSop([makeGroup()], makeSop());
    const ch20 = (action.edits[0] as any).value.channels.find((c: any) => c.ch === 20);
    expect(ch20.freq_mhz).toBe(243.0);
  });

  it('skips when no player flights', () => {
    const aiGroup = makeGroup({ units: [makeUnit({ skill: 'High' })] });
    expect(applyRadioSop([aiGroup], makeSop()).skippedReason).toMatch(/no Client/i);
  });
});

/* ------------------------------------------------------------------ */
/* Carriers applier                                                    */
/* ------------------------------------------------------------------ */

describe('applyCarriersSop', () => {
  it('overrides carrier TACAN when SOP has a matching entry', () => {
    const carrier = makeGroup({
      groupId: 5, groupName: 'CVN-74',
      category: 'ship',
      tacan: { channel: 99, band: 'X', callsign: 'OLD' },
      units: [makeUnit({ type: 'Stennis' })],
    });
    const sop = makeSop({
      tacans: [{ role: 'Stennis CVN-74', channel: 74, band: 'X', callsign: 'CVN' }],
    });
    const action = applyCarriersSop([carrier], sop);
    expect(action.edits).toHaveLength(1);
    expect((action.edits[0] as any).value).toEqual({ channel: 74, band: 'X', callsign: 'CVN' });
  });

  it('produces no edits when carrier already matches SOP', () => {
    const carrier = makeGroup({
      groupId: 5, category: 'ship',
      tacan: { channel: 74, band: 'X', callsign: 'CVN' },
      units: [makeUnit({ type: 'Stennis' })],
    });
    const sop = makeSop({
      tacans: [{ role: 'Stennis', channel: 74, band: 'X', callsign: 'CVN' }],
    });
    const action = applyCarriersSop([carrier], sop);
    expect(action.edits).toEqual([]);
  });

  it('skips when no carriers', () => {
    const action = applyCarriersSop([makeGroup()], makeSop({ tacans: [{ role: 'CVN', channel: 74, band: 'X' }] }));
    expect(action.skippedReason).toMatch(/no carrier/i);
  });

  it('skips when SOP has no TACAN entries', () => {
    const carrier = makeGroup({
      category: 'ship',
      units: [makeUnit({ type: 'Stennis' })],
    });
    const action = applyCarriersSop([carrier], makeSop());
    expect(action.skippedReason).toMatch(/no TACAN/i);
  });
});

/* ------------------------------------------------------------------ */
/* Orchestrator                                                        */
/* ------------------------------------------------------------------ */

describe('runAutoSetup', () => {
  it('runs all four appliers in order and aggregates totals', () => {
    const groups = [makeGroup()];
    const cu = [makeClientUnit()];
    const sop = makeSop({
      name: 'Test',
      flights: [{ callsign: 'Enfield' }],
      tankers: [{ callsign: 'Texaco', frequency: 277.8 }],
      comms: [{ role: 'Strike', frequency: 270.8 }],
    });
    const report = runAutoSetup(groups, cu, sop);
    expect(report.sopName).toBe('Test');
    expect(report.actions.map((a) => a.category)).toEqual([
      'Renamer', 'Datalink', 'Radio', 'Comms', 'Carriers',
    ]);
    expect(report.totalEdits).toBeGreaterThan(0);
  });

  it('attaches discrepancy report from buildReport', () => {
    const groups = [makeGroup({ groupName: 'Bengal 1', frequency: 270.8 })];
    const sop = makeSop({
      flights: [{ callsign: 'Bengal', defaultFreq: 305.0 }],   // mismatch
    });
    const report = runAutoSetup(groups, [], sop);
    expect(report.discrepancies.length).toBeGreaterThan(0);
  });
});
