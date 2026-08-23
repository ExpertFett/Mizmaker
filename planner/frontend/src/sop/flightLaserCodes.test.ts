import { describe, it, expect } from 'vitest';
import { assignFlightLaserCodes, isAssignedCode, DEFAULT_LASER_BASE } from './flightLaserCodes';

const u = (unitId: number, groupName: string, laserCode?: number | null) =>
  ({ unitId, groupName, laserCode });

describe('assignFlightLaserCodes', () => {
  it('gives a code to a jet carrying no laser weapon', () => {
    const codes = assignFlightLaserCodes([u(1, 'Bengal-3')], 1511);
    expect(codes.get(1)).toBe(1511);
  });

  it('keeps the real code where the jet actually has one', () => {
    const codes = assignFlightLaserCodes([u(1, 'Bengal-3', 1688)], 1511);
    expect(codes.get(1)).toBe(1688);
  });

  it('never hands out a code another jet is actually carrying', () => {
    // The ladder from 1511 would reach 1512 next; that is taken.
    const codes = assignFlightLaserCodes([
      u(1, 'Bengal-3'),
      u(2, 'Bengal-3', 1512),
      u(3, 'Bengal-3'),
    ], 1511);
    expect(codes.get(1)).toBe(1511);
    expect(codes.get(2)).toBe(1512);
    expect(codes.get(3)).not.toBe(1512);
    expect(new Set([...codes.values()]).size).toBe(3);
  });

  it('reserves real codes before allocating, not as it goes', () => {
    // The taken code belongs to the LAST unit; a naive walk would already
    // have handed 1512 to unit 2 before seeing it.
    const codes = assignFlightLaserCodes([
      u(1, 'A'), u(2, 'A'), u(3, 'A', 1512),
    ], 1511);
    expect(codes.get(3)).toBe(1512);
    expect(new Set([...codes.values()]).size).toBe(3);
  });

  it('keeps every flight in the mission unique', () => {
    const units = [
      u(1, 'Bengal-3'), u(2, 'Bengal-3'), u(3, 'Bengal-3'), u(4, 'Bengal-3'),
      u(5, 'Camelot-1'), u(6, 'Camelot-1'),
    ];
    const codes = assignFlightLaserCodes(units, 1511);
    expect(new Set([...codes.values()]).size).toBe(6);
  });

  it('is deterministic regardless of input order', () => {
    const units = [u(3, 'Camelot-1'), u(1, 'Bengal-3'), u(2, 'Bengal-3')];
    const a = assignFlightLaserCodes(units, 1511);
    const b = assignFlightLaserCodes([...units].reverse(), 1511);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('only emits codes DCS accepts — digits 1-7', () => {
    const units = Array.from({ length: 40 }, (_, i) => u(i, 'F'));
    for (const code of assignFlightLaserCodes(units, 1511).values()) {
      expect(String(code)).toMatch(/^1[1-7]{3}$/);
    }
  });

  it('clamps an out-of-range base rather than emitting an illegal code', () => {
    const codes = assignFlightLaserCodes([u(1, 'A')], 1999);
    expect(String(codes.get(1))).toMatch(/^1[1-7]{3}$/);
  });

  it('defaults the base when the SOP does not set one', () => {
    expect(assignFlightLaserCodes([u(1, 'A')]).get(1)).toBe(DEFAULT_LASER_BASE);
  });

  it('handles an empty roster', () => {
    expect(assignFlightLaserCodes([]).size).toBe(0);
  });
});

describe('isAssignedCode', () => {
  it('separates a briefed assignment from a loaded code', () => {
    expect(isAssignedCode({ unitId: 1 })).toBe(true);
    expect(isAssignedCode({ unitId: 1, laserCode: 1688 })).toBe(false);
  });
});
