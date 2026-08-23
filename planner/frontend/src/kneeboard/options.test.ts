import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPTIONS, resolveOptions, DENSITY_ROWS, NOTES_FRACTION,
} from './options';
import { computeJokerBingo } from './fuelModel';
import { validatePopupAttack, DEFAULT_POPUP_LIMITS } from '../utils/popupValidation';
import { contrailSummary } from './contrails';
import { presetLabel } from './radioPresets';
import type { PopupAttackInput } from '../utils/popupAttack';

describe('resolveOptions', () => {
  it('returns the defaults for a mission that never touched them', () => {
    expect(resolveOptions()).toEqual(DEFAULT_OPTIONS);
    expect(resolveOptions(undefined)).toEqual(DEFAULT_OPTIONS);
  });

  it('keeps an override and defaults everything else', () => {
    const o = resolveOptions({ fuel: { bingoFloorLbs: 5500 } as never });
    expect(o.fuel.bingoFloorLbs).toBe(5500);
    expect(o.fuel.jokerPct).toBe(DEFAULT_OPTIONS.fuel.jokerPct);
    expect(o.nav).toEqual(DEFAULT_OPTIONS.nav);
  });

  it('merges per group, so a new option does not reset its section', () => {
    // A blob saved before `mapLayer` existed.
    const stored = { nav: { msaBufferFt: 2000, msaCorridorNm: 10, waypointsPerStripPage: 5 } };
    const o = resolveOptions(stored as never);
    expect(o.nav.msaBufferFt).toBe(2000);
    expect(o.nav.mapLayer).toBe(DEFAULT_OPTIONS.nav.mapLayer);
  });

  it('merges popup limits one level deeper', () => {
    // Setting only the pull-out G must not drop the other five limits.
    const o = resolveOptions({ weapons: { popup: { recoveryG: 5 } } } as never);
    expect(o.weapons.popup.recoveryG).toBe(5);
    expect(o.weapons.popup.terrainMarginFt).toBe(DEFAULT_POPUP_LIMITS.terrainMarginFt);
    expect(o.weapons.popup.diveAngleDeg).toEqual(DEFAULT_POPUP_LIMITS.diveAngleDeg);
    expect(o.weapons.targetChipNm).toBe(DEFAULT_OPTIONS.weapons.targetChipNm);
  });

  it('merges an angle bracket without losing its other end', () => {
    const o = resolveOptions({
      weapons: { popup: { popupAngleDeg: { min: 20 } } },
    } as never);
    expect(o.weapons.popup.popupAngleDeg.min).toBe(20);
    expect(o.weapons.popup.popupAngleDeg.max).toBe(45);
  });

  it('does not mutate the defaults', () => {
    const before = JSON.stringify(DEFAULT_OPTIONS);
    resolveOptions({ fuel: { bingoFloorLbs: 9999 } as never });
    expect(JSON.stringify(DEFAULT_OPTIONS)).toBe(before);
  });
});

describe('defaults reproduce the old hardcoded behaviour', () => {
  it('fuel: same joker and bingo as before the option existed', () => {
    const withOpts = computeJokerBingo(10000, undefined, DEFAULT_OPTIONS.fuel);
    const withoutOpts = computeJokerBingo(10000);
    expect(withOpts).toEqual(withoutOpts);
    expect(withOpts.bingo).toBe(4000);   // the floor, since 20% of 10k is 2k
  });

  it('popup: same findings as the fixed limits produced', () => {
    const profile: PopupAttackInput = {
      attackType: 'type2', targetElevationFt: 0, vipDistanceNm: 5,
      popupAltitudeFtMsl: 8000, popupAngleDeg: 25, angleOffsetDeg: 30,
      diveAngleDeg: 45, releaseAltitudeFtAgl: 1600, releaseSpeedKts: 500,
      ingressAltitudeFtAgl: 500, ingressSpeedKts: 480,
    };
    expect(validatePopupAttack(profile, DEFAULT_OPTIONS.weapons.popup))
      .toEqual(validatePopupAttack(profile));
  });

  it('contrails: same band as the fixed thresholds', () => {
    expect(contrailSummary(-1,
      DEFAULT_OPTIONS.weather.contrailOnsetC,
      DEFAULT_OPTIONS.weather.contrailTopC)).toBe(contrailSummary(-1));
  });

  it('radio labels: default pair is the Hornet L/R', () => {
    const presets = [{ radio: 1, channels: [{ ch: 5, freq_mhz: 288, modulation: 0, name: '' }] }];
    expect(presetLabel(288, presets, DEFAULT_OPTIONS.comms.radioLabels))
      .toBe(presetLabel(288, presets));
  });
});

describe('options actually change behaviour', () => {
  it('a higher bingo floor raises bingo', () => {
    const std = computeJokerBingo(30000, undefined, DEFAULT_OPTIONS.fuel);
    const tomcat = computeJokerBingo(30000, undefined, { ...DEFAULT_OPTIONS.fuel, bingoFloorLbs: 7500 });
    expect(tomcat.bingo).toBeGreaterThanOrEqual(7500);
    expect(tomcat.bingo).toBeGreaterThan(std.bingo);
  });

  it('joker stays above bingo whatever the percentages say', () => {
    const j = computeJokerBingo(10000, undefined,
      { bingoFloorLbs: 4000, bingoPct: 0.5, jokerPct: 0.1, jokerMarginLbs: 800 });
    expect(j.joker).toBeGreaterThanOrEqual(j.bingo + 800);
  });

  it('a gentler pull-out gives up more altitude, so a profile can fail', () => {
    const profile: PopupAttackInput = {
      attackType: 'type2', targetElevationFt: 0, vipDistanceNm: 5,
      popupAltitudeFtMsl: 8000, popupAngleDeg: 25, angleOffsetDeg: 30,
      diveAngleDeg: 30, releaseAltitudeFtAgl: 3000, releaseSpeedKts: 450,
      ingressAltitudeFtAgl: 500, ingressSpeedKts: 480,
    };
    const at4g = validatePopupAttack(profile, DEFAULT_POPUP_LIMITS);
    const at2g = validatePopupAttack(profile, { ...DEFAULT_POPUP_LIMITS, recoveryG: 2 });
    expect(at2g.length).toBeGreaterThan(at4g.length);
  });

  it('custom radio labels replace L/R', () => {
    const presets = [{ radio: 2, channels: [{ ch: 7, freq_mhz: 251, modulation: 0, name: '' }] }];
    expect(presetLabel(251, presets, ['UHF', 'VHF'])).toBe('(7VHF)');
  });

  it('a warmer contrail onset pushes the band higher', () => {
    const std = contrailSummary(-1, -40, -60);
    const late = contrailSummary(-1, -50, -60);
    expect(std).not.toBe(late);
  });
});

describe('presentation tables', () => {
  it('density orders from most rows to fewest on continuation pages', () => {
    expect(DENSITY_ROWS.compact.pageN).toBeGreaterThan(DENSITY_ROWS.normal.pageN);
    expect(DENSITY_ROWS.normal.pageN).toBeGreaterThan(DENSITY_ROWS.large.pageN);
  });

  it('never puts more than the measured ceiling on page one', () => {
    // Page one carries the threat map, which caps the table beneath it at 8
    // rows regardless of density — 9 overflowed a rendered card even with the
    // notes box off. Compact therefore matches normal here rather than
    // exceeding it, and only gains rows on continuation pages.
    for (const d of Object.values(DENSITY_ROWS)) {
      expect(d.page1).toBeLessThanOrEqual(8);
    }
    expect(DENSITY_ROWS.compact.page1).toBe(DENSITY_ROWS.normal.page1);
    expect(DENSITY_ROWS.large.page1).toBeLessThan(DENSITY_ROWS.normal.page1);
  });

  it('every density puts more rows on a continuation page than page one', () => {
    for (const d of Object.values(DENSITY_ROWS)) {
      // Page one carries the map, so it always holds fewer rows.
      expect(d.pageN).toBeGreaterThan(d.page1);
    }
  });

  it('notes fractions run none < quarter < half', () => {
    expect(NOTES_FRACTION.none).toBe(0);
    expect(NOTES_FRACTION.quarter).toBeLessThan(NOTES_FRACTION.half);
    expect(NOTES_FRACTION.half).toBeLessThanOrEqual(0.5);
  });
});
