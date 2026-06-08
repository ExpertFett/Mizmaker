/**
 * Tests for applyRenamerSop — the auto-setup SOP-callsign renamer.
 *
 * v1.19.55 — Tester report: "the group unit renamer isn't working
 * properly, it's made two flights into vic-1 it's not adding the - in
 * most the names, so it looks like vic1 etc"
 *
 * Two bugs:
 *   1. "Bengal-1" → "Vic1" (dash dropped). The old regex captured only
 *      whitespace+digits, so dash/underscore separators got eaten.
 *   2. "Bengal-1" + "Camelot-1" → both renamed to "Vic-1" (collision).
 *      No de-collision pass.
 */

import { describe, it, expect } from 'vitest';
import { applyRenamerSop } from './renamer';
import type { MissionGroup } from '../../types/mission';
import type { SOP } from '../types';

// Minimal MissionGroup factory — only the fields the renamer touches.
function group(overrides: Partial<MissionGroup> = {}): MissionGroup {
  return {
    groupId: 1, groupName: 'Bengal-1', coalition: 'blue', country: 'USA',
    category: 'plane', task: '', frequency: 0, modulation: 0,
    units: [{
      unitId: 1, name: 'pilot1', type: 'FA-18C_hornet', skill: 'Client',
    } as never],
    waypoints: [],
    ...overrides,
  };
}

function sop(callsigns: string[]): SOP {
  return {
    id: 'test', name: 'Test SOP',
    flights: callsigns.map((cs, i) => ({ callsign: cs, priority: i + 1 } as never)),
    tacans: [],
    radios: [],
  } as never;
}

describe('applyRenamerSop — dash + collision fixes (v1.19.55)', () => {
  it('preserves dash separator: "Bengal-1" → "Vic-1" (not "Vic1")', () => {
    const result = applyRenamerSop([group({ groupName: 'Bengal-1' })], sop(['Vic']));
    const edit = result.edits[0] as never as { value: { newGroupName: string } };
    expect(edit.value.newGroupName).toBe('Vic-1');
  });

  it('preserves space separator: "Bengal 2" → "Vic 2"', () => {
    const result = applyRenamerSop([group({ groupName: 'Bengal 2' })], sop(['Vic']));
    const edit = result.edits[0] as never as { value: { newGroupName: string } };
    expect(edit.value.newGroupName).toBe('Vic 2');
  });

  it('preserves underscore separator: "Bengal_3" → "Vic_3"', () => {
    const result = applyRenamerSop([group({ groupName: 'Bengal_3' })], sop(['Vic']));
    const edit = result.edits[0] as never as { value: { newGroupName: string } };
    expect(edit.value.newGroupName).toBe('Vic_3');
  });

  it('no separator on source ("Bengal4") → defaults to dash ("Vic-4")', () => {
    const result = applyRenamerSop([group({ groupName: 'Bengal4' })], sop(['Vic']));
    const edit = result.edits[0] as never as { value: { newGroupName: string } };
    expect(edit.value.newGroupName).toBe('Vic-4');
  });

  it('no trailing number: "Bengal" → "Vic" (no synthesised number)', () => {
    const result = applyRenamerSop([group({ groupName: 'Bengal' })], sop(['Vic']));
    const edit = result.edits[0] as never as { value: { newGroupName: string } };
    expect(edit.value.newGroupName).toBe('Vic');
  });

  it('de-collides when two source groups have same trailing number', () => {
    // The headline bug: Bengal-1 + Camelot-1 with a single SOP callsign
    // "Vic" used to land both flights on "Vic-1". Now the second one
    // gets "Vic-1-2".
    const result = applyRenamerSop(
      [
        group({ groupId: 1, groupName: 'Bengal-1' }),
        group({ groupId: 2, groupName: 'Camelot-1' }),
      ],
      sop(['Vic', 'Vic']),  // two SOP entries, same callsign
    );
    const names = result.edits.map(
      (e) => (e as never as { value: { newGroupName: string } }).value.newGroupName,
    );
    expect(names).toEqual(['Vic-1', 'Vic-1-2']);
  });

  it('de-collides across three collisions: -1, -1-2, -1-3', () => {
    const result = applyRenamerSop(
      [
        group({ groupId: 1, groupName: 'A-1' }),
        group({ groupId: 2, groupName: 'B-1' }),
        group({ groupId: 3, groupName: 'C-1' }),
      ],
      sop(['Vic', 'Vic', 'Vic']),
    );
    const names = result.edits.map(
      (e) => (e as never as { value: { newGroupName: string } }).value.newGroupName,
    );
    expect(names).toEqual(['Vic-1', 'Vic-1-2', 'Vic-1-3']);
  });

  it('unit names follow group name + dash + index', () => {
    const result = applyRenamerSop(
      [group({
        groupName: 'Bengal-1',
        units: [
          { unitId: 10, name: 'L', type: 'FA-18C', skill: 'Client' } as never,
          { unitId: 11, name: 'W', type: 'FA-18C', skill: 'Client' } as never,
        ],
      })],
      sop(['Vic']),
    );
    const unitNames = (result.edits[0] as never as {
      value: { unitNames: Record<number, string> };
    }).value.unitNames;
    expect(unitNames[10]).toBe('Vic-1-1');
    expect(unitNames[11]).toBe('Vic-1-2');
  });

  it('different source numbers do NOT collide: "Bengal-1" + "Bengal-2"', () => {
    const result = applyRenamerSop(
      [
        group({ groupId: 1, groupName: 'Bengal-1' }),
        group({ groupId: 2, groupName: 'Bengal-2' }),
      ],
      sop(['Vic', 'Vic']),
    );
    const names = result.edits.map(
      (e) => (e as never as { value: { newGroupName: string } }).value.newGroupName,
    );
    expect(names).toEqual(['Vic-1', 'Vic-2']);
  });
});
