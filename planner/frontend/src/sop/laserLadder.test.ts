/**
 * Tests for the shared laser-code ladder (#63). These lock the math the
 * Laser tab, SOP Check, and the laser applier all depend on — if the
 * ladder drifts, SOP Check would flag codes the Laser tab just set.
 */

import { describe, it, expect } from 'vitest';
import { nextLaserCode, clampToValidLaserCode, assignLaserLadder } from './laserLadder';
import type { LaserCapableUnit } from '../types/mission';

function lu(o: Partial<LaserCapableUnit> = {}): LaserCapableUnit {
  return {
    unitId: 1, name: 'u', type: 'FA-18C_hornet', groupName: 'Bengal 1',
    coalition: 'blue', isClient: true, pylons: [], laserCode: null, ...o,
  };
}

describe('nextLaserCode', () => {
  it('increments the last digit', () => {
    expect(nextLaserCode(1611)).toBe(1612);
  });
  it('rolls 7→1 with carry, staying in 1-7', () => {
    expect(nextLaserCode(1617)).toBe(1621);
    expect(nextLaserCode(1677)).toBe(1711);
    expect(nextLaserCode(1777)).toBe(2111);
  });
});

describe('clampToValidLaserCode', () => {
  it('clamps every digit into 1-7', () => {
    expect(clampToValidLaserCode(1688)).toBe(1677); // 8s → 7
    expect(clampToValidLaserCode(1600)).toBe(1611); // 0s → 1
  });
});

describe('assignLaserLadder', () => {
  it('hands out a continuous ladder grouped by flight, in list order', () => {
    const units = [
      lu({ unitId: 1, groupName: 'Bengal 1' }),
      lu({ unitId: 2, groupName: 'Bengal 1' }),
      lu({ unitId: 3, groupName: 'Bengal 2' }),
    ];
    const ladder = assignLaserLadder(units, 1611);
    expect(ladder.get(1)).toBe(1611);
    expect(ladder.get(2)).toBe(1612); // continues within flight
    expect(ladder.get(3)).toBe(1613); // continues across flights (deconflict)
  });

  it('clamps an invalid base before laddering', () => {
    const units = [lu({ unitId: 1 }), lu({ unitId: 2 })];
    const ladder = assignLaserLadder(units, 1688);
    expect(ladder.get(1)).toBe(1677);
    expect(ladder.get(2)).toBe(1711);
  });

  it('produces unique codes for every shooter (no fratricide)', () => {
    const units = Array.from({ length: 12 }, (_, i) => lu({ unitId: i + 1, groupName: `F${Math.floor(i / 2)}` }));
    const ladder = assignLaserLadder(units, 1611);
    const codes = [...ladder.values()];
    expect(new Set(codes).size).toBe(codes.length);
  });
});
