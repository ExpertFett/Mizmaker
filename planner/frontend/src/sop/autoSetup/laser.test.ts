/**
 * Tests for the laser-code applier (#63) — staging laserCode edits to
 * conform every shooter to the SOP ladder.
 */

import { describe, it, expect } from 'vitest';
import { applyLaserCodesSop } from './laser';
import type { LaserCapableUnit, UnitEdit } from '../../types/mission';
import type { SOP } from '../types';

function lu(o: Partial<LaserCapableUnit> = {}): LaserCapableUnit {
  return {
    unitId: 1, name: 'u', type: 'FA-18C_hornet', groupName: 'Bengal 1',
    coalition: 'blue', isClient: true, pylons: [], laserCode: null, ...o,
  };
}
function sop(laserCodeBase?: number): SOP {
  return { id: 's', name: 'S', updatedAt: 0, flights: [], comms: [], tacans: [], laserCodeBase };
}

describe('applyLaserCodesSop', () => {
  it('stages laserCode edits for units off the ladder', () => {
    const units = [
      lu({ unitId: 1, laserCode: 1688 }),  // wrong
      lu({ unitId: 2, laserCode: null }),  // unset
    ];
    const action = applyLaserCodesSop(units, sop(1611));
    expect(action.itemsAffected).toBe(2);
    const byUnit = Object.fromEntries(
      action.edits.map((e) => [(e as UnitEdit).unitId, (e as UnitEdit).value]),
    );
    expect(byUnit[1]).toBe(1611);
    expect(byUnit[2]).toBe(1612);
    expect(action.edits.every((e) => (e as UnitEdit).field === 'laserCode')).toBe(true);
  });

  it('no-ops when every shooter is already on the ladder', () => {
    const units = [lu({ unitId: 1, laserCode: 1611 }), lu({ unitId: 2, laserCode: 1612 })];
    const action = applyLaserCodesSop(units, sop(1611));
    expect(action.edits.length).toBe(0);
    expect(action.skippedReason).toMatch(/already match/i);
  });

  it('skips when the SOP defines no laser base', () => {
    const action = applyLaserCodesSop([lu({ laserCode: 1234 })], sop(undefined));
    expect(action.edits.length).toBe(0);
    expect(action.skippedReason).toMatch(/no laserCodeBase/i);
  });

  it('skips when there are no laser-capable units', () => {
    const action = applyLaserCodesSop([], sop(1611));
    expect(action.edits.length).toBe(0);
    expect(action.itemsAffected).toBe(0);
  });
});
