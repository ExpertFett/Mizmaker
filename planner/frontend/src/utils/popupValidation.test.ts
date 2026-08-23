import { describe, it, expect } from 'vitest';
import { validatePopupAttack, pulloutLossFt, slantRangeNm, worstLevel } from './popupValidation';
import type { PopupAttackInput } from './popupAttack';

/** A clean Type 2 popup that should raise nothing. */
const GOOD: PopupAttackInput = {
  attackType: 'type2',
  targetElevationFt: 0,
  vipDistanceNm: 5,
  popupAltitudeFtMsl: 8000,
  popupAngleDeg: 25,
  angleOffsetDeg: 30,
  diveAngleDeg: 30,
  releaseAltitudeFtAgl: 4500,
  releaseSpeedKts: 450,
  ingressAltitudeFtAgl: 500,
  ingressSpeedKts: 480,
};

const at = (patch: Partial<PopupAttackInput>): PopupAttackInput => ({ ...GOOD, ...patch });
const fields = (i: PopupAttackInput) => validatePopupAttack(i).map((f) => f.field);
const levels = (i: PopupAttackInput) => validatePopupAttack(i).map((f) => f.level);

describe('pulloutLossFt', () => {
  it('loses nothing recovering from level flight', () => {
    expect(pulloutLossFt(0, 450)).toBe(0);
  });

  it('loses more from a steeper dive', () => {
    expect(pulloutLossFt(45, 450)).toBeGreaterThan(pulloutLossFt(20, 450));
  });

  it('loses more at higher speed — radius goes with the square of it', () => {
    expect(pulloutLossFt(30, 500)).toBeGreaterThan(pulloutLossFt(30, 350) * 1.5);
  });
});

describe('validatePopupAttack', () => {
  it('passes a clean profile', () => {
    expect(validatePopupAttack(GOOD)).toEqual([]);
    expect(worstLevel([])).toBeNull();
  });

  it('errors when the apex is below the ingress altitude', () => {
    const f = validatePopupAttack(at({ popupAltitudeFtMsl: 400, ingressAltitudeFtAgl: 500 }));
    expect(f.some((x) => x.level === 'error' && x.field === 'popupAltitudeFtMsl')).toBe(true);
  });

  it('errors when release is at or above the apex — the dive never reaches it', () => {
    const f = validatePopupAttack(at({ popupAltitudeFtMsl: 8000, releaseAltitudeFtAgl: 8000 }));
    expect(f.some((x) => x.level === 'error' && x.field === 'releaseAltitudeFtAgl')).toBe(true);
  });

  it('errors when the pull-out would go through the ground', () => {
    // 45 deg at 500 kt gives up a lot; releasing at 1,600 ft cannot absorb it.
    const f = validatePopupAttack(at({ diveAngleDeg: 45, releaseSpeedKts: 500, releaseAltitudeFtAgl: 1600 }));
    const rec = f.find((x) => x.level === 'error' && /pull-out/i.test(x.message));
    expect(rec).toBeDefined();
    expect(rec!.message).toMatch(/under the 500 ft floor/);
  });

  it('quantifies the shortfall rather than just saying no', () => {
    const f = validatePopupAttack(at({ diveAngleDeg: 45, releaseSpeedKts: 500, releaseAltitudeFtAgl: 1600 }));
    expect(f.some((x) => /\d,?\d* ft/.test(x.message))).toBe(true);
  });

  it('cautions on a thin but survivable pull-out', () => {
    // 20 deg at 400 kt gives up ~285 ft; releasing at 1,200 leaves ~915 —
    // above the 500 ft floor but inside the 1,000 ft "thin" band.
    const f = validatePopupAttack(at({ diveAngleDeg: 20, releaseSpeedKts: 400, releaseAltitudeFtAgl: 1200 }));
    expect(f.some((x) => x.level === 'caution' && /bottoms out/.test(x.message))).toBe(true);
    expect(f.every((x) => x.level !== 'error')).toBe(true);
  });

  it('errors below the ingress hard deck', () => {
    expect(fields(at({ ingressAltitudeFtAgl: 100 }))).toContain('ingressAltitudeFtAgl');
    expect(levels(at({ ingressAltitudeFtAgl: 100 }))).toContain('error');
  });

  it('errors when the action point sits on the target', () => {
    expect(fields(at({ vipDistanceNm: 0 }))).toContain('vipDistanceNm');
  });

  it('cautions on angles outside the usual brackets', () => {
    expect(fields(at({ popupAngleDeg: 60 }))).toContain('popupAngleDeg');
    expect(fields(at({ diveAngleDeg: 5, releaseAltitudeFtAgl: 4500 }))).toContain('diveAngleDeg');
  });

  it('cautions on a frag-clearance release but does not call it an error', () => {
    // Shallow + slow so the pull-out still clears; only frag height is at issue.
    const f = validatePopupAttack(at({ diveAngleDeg: 10, releaseSpeedKts: 350, releaseAltitudeFtAgl: 1200 }));
    expect(f.some((x) => x.level === 'caution' && /frag-clearance/.test(x.message))).toBe(true);
  });

  it('does not apply dive or frag rules to a lay-down', () => {
    const f = validatePopupAttack(at({ attackType: 'laydown', releaseAltitudeFtAgl: 500, diveAngleDeg: 0 }));
    expect(f.some((x) => /frag-clearance|pull-out/.test(x.message))).toBe(false);
  });

  it('does not apply popup-climb rules to a straight dive', () => {
    const f = validatePopupAttack(at({ attackType: 'dive', popupAngleDeg: 90 }));
    expect(f.some((x) => x.field === 'popupAngleDeg')).toBe(false);
  });

  it('reports several findings at once for a badly built profile', () => {
    const f = validatePopupAttack(at({
      ingressAltitudeFtAgl: 50, vipDistanceNm: 0, popupAltitudeFtMsl: 100,
    }));
    expect(f.length).toBeGreaterThanOrEqual(3);
    expect(worstLevel(f)).toBe('error');
  });
});

describe('slantRangeNm', () => {
  it('is positive for a normal dive delivery', () => {
    expect(slantRangeNm(GOOD)).toBeGreaterThan(0);
  });

  it('grows as the release moves higher above the target', () => {
    expect(slantRangeNm(at({ releaseAltitudeFtAgl: 6000 })))
      .toBeGreaterThan(slantRangeNm(at({ releaseAltitudeFtAgl: 3000 })));
  });
});

describe('worstLevel', () => {
  it('ranks an error above a caution', () => {
    expect(worstLevel([
      { level: 'caution', field: 'diveAngleDeg', message: '' },
      { level: 'error', field: 'geometry', message: '' },
    ])).toBe('error');
  });
});
