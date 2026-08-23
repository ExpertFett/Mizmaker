import { describe, it, expect } from 'vitest';
import { toMhz } from './frequency';

describe('toMhz', () => {
  it('passes MHz through untouched', () => {
    for (const f of [30, 121.5, 243, 251, 305, 399.975]) expect(toMhz(f)).toBe(f);
  });

  it('converts Hz, the form an extractor or a unit record produces', () => {
    expect(toMhz(251000000)).toBeCloseTo(251, 6);
    expect(toMhz(127500000)).toBeCloseTo(127.5, 6);
  });

  it('converts kHz', () => {
    expect(toMhz(128300)).toBeCloseTo(128.3, 6);
  });

  it('returns 0 for absent or nonsensical input rather than NaN', () => {
    for (const v of [null, undefined, NaN, Infinity, 0, -5]) expect(toMhz(v)).toBe(0);
  });

  it('is idempotent', () => {
    for (const f of [251, 251000000, 128300]) expect(toMhz(toMhz(f))).toBeCloseTo(toMhz(f), 6);
  });

  it('agrees with the backend on the band boundaries', () => {
    expect(toMhz(1)).toBe(1);
    expect(toMhz(1000)).toBe(1);
    expect(toMhz(1_000_000)).toBe(1);
  });
});
