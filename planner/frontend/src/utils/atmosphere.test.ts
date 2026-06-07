/**
 * Tests for the contrail-altitude calculator. The ISA-based math is
 * the same approach NAVMETOC / civil-flight-planning tools use; these
 * cases lock down the boundary behaviour so a future refactor can't
 * silently shift the answer by a few thousand feet.
 */

import { describe, it, expect } from 'vitest';
import { contrailAltitudeFt } from './atmosphere';

describe('contrailAltitudeFt', () => {
  it('returns null when surface temp is missing or non-finite', () => {
    expect(contrailAltitudeFt(null)).toBeNull();
    expect(contrailAltitudeFt(undefined)).toBeNull();
    expect(contrailAltitudeFt(NaN)).toBeNull();
  });

  it('ISA standard day (+15°C) → ~27,800 ft', () => {
    const h = contrailAltitudeFt(15);
    expect(h).not.toBeNull();
    // (15 - (-40)) / 0.001981 ≈ 27,764 ft. Allow ±100 ft for rounding.
    expect(h!).toBeGreaterThan(27_700);
    expect(h!).toBeLessThan(27_900);
  });

  it('cold day (0°C) → ~20,200 ft', () => {
    const h = contrailAltitudeFt(0)!;
    // (0 + 40) / 0.001981 ≈ 20,192 ft
    expect(h).toBeGreaterThan(20_100);
    expect(h).toBeLessThan(20_300);
  });

  it('hot day (+25°C) → ~32,800 ft', () => {
    const h = contrailAltitudeFt(25)!;
    // (25 + 40) / 0.001981 ≈ 32,812 ft
    expect(h).toBeGreaterThan(32_700);
    expect(h).toBeLessThan(32_900);
  });

  it('Kola winter (-10°C) → ~15,100 ft', () => {
    const h = contrailAltitudeFt(-10)!;
    // (-10 + 40) / 0.001981 ≈ 15,144 ft
    expect(h).toBeGreaterThan(15_050);
    expect(h).toBeLessThan(15_250);
  });

  it('arctic surface already below threshold → 0 ft', () => {
    expect(contrailAltitudeFt(-40)).toBe(0);
    expect(contrailAltitudeFt(-50)).toBe(0);
  });

  it('caps at the tropopause (~36,089 ft) on extreme hot day', () => {
    // T_sl = 32°C → (32+40)/0.001981 ≈ 36,346 ft > tropopause
    const h = contrailAltitudeFt(32)!;
    expect(h).toBe(36_089);
  });

  it('custom threshold (warmer -38°C engine) shifts contrail floor LOWER', () => {
    const std = contrailAltitudeFt(15, -40)!;
    const warmer = contrailAltitudeFt(15, -38)!;
    // Warmer threshold (-38 > -40) means the criterion is met at a LOWER
    // altitude — air doesn't need to get as cold. So contrails START
    // sooner on the climb. (Sanity: this is the high-bypass-engine case
    // — modern turbofans contrail at slightly warmer ambient than legacy.)
    expect(warmer).toBeLessThan(std);
    // Difference should be ~1000 ft per 2°C of threshold change.
    expect(std - warmer).toBeGreaterThan(800);
    expect(std - warmer).toBeLessThan(1200);
  });
});
