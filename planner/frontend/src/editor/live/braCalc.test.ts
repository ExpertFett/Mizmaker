/**
 * BRA / BRAA + bullseye math tests for the LotATC controller scope.
 *
 * These cover the pure math the GCI/ATC tools rely on. Headless-testing
 * the Live UI itself needs Discord auth so we lean on this layer instead;
 * regressions here would silently corrupt every controller call.
 */

import { describe, it, expect } from 'vitest';
import {
  trueBearingDeg, distanceM, computeBra, computeBraa, formatBra, formatBraa,
  metresToFeet, type LL,
} from './braCalc';
import { bullseyeBR, formatBullseye } from './bullseye';

// Convenient anchors. (lat, lng).
const ORIGIN: LL = { lat: 0, lng: 0 };

// 1 NM ≈ 1/60 degree latitude. 60 NM north of origin ≈ +1° lat.
const NORTH_60NM: LL = { lat: 1, lng: 0 };
const SOUTH_60NM: LL = { lat: -1, lng: 0 };
const EAST_60NM:  LL = { lat: 0, lng: 1 };  // ~60 NM east at equator
const WEST_60NM:  LL = { lat: 0, lng: -1 };

describe('trueBearingDeg', () => {
  it('returns 0 for due north', () => {
    expect(trueBearingDeg(ORIGIN, NORTH_60NM)).toBeCloseTo(0, 5);
  });
  it('returns 180 for due south', () => {
    expect(trueBearingDeg(ORIGIN, SOUTH_60NM)).toBeCloseTo(180, 5);
  });
  it('returns 90 for due east', () => {
    expect(trueBearingDeg(ORIGIN, EAST_60NM)).toBeCloseTo(90, 1);
  });
  it('returns 270 for due west', () => {
    expect(trueBearingDeg(ORIGIN, WEST_60NM)).toBeCloseTo(270, 1);
  });
  it('always wraps to 0..360, never negative', () => {
    const b = trueBearingDeg({ lat: 0, lng: 0.001 }, { lat: 0, lng: 0 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});

describe('distanceM', () => {
  it('returns ~111 km for 1° latitude separation', () => {
    // Earth ~111.2km per degree latitude; allow ±200m slack.
    const m = distanceM(ORIGIN, NORTH_60NM);
    expect(m).toBeGreaterThan(111_000);
    expect(m).toBeLessThan(111_400);
  });
  it('returns 0 for identical points', () => {
    expect(distanceM(ORIGIN, ORIGIN)).toBe(0);
  });
});

describe('computeBra', () => {
  it('passes target altitude through as thousands rounded', () => {
    const b = computeBra(ORIGIN, { ...NORTH_60NM, altFt: 18_400 });
    expect(b.altThousands).toBe(18);
  });
  it('null altThousands when target has no altitude', () => {
    const b = computeBra(ORIGIN, NORTH_60NM);
    expect(b.altThousands).toBeNull();
  });
  it('rounds altitude correctly at thousand boundaries', () => {
    expect(computeBra(ORIGIN, { ...NORTH_60NM, altFt: 17_500 }).altThousands).toBe(18);
    expect(computeBra(ORIGIN, { ...NORTH_60NM, altFt: 17_499 }).altThousands).toBe(17);
  });
});

describe('computeBraa aspect categorisation', () => {
  // anchor at origin, target 60NM north, target heading varies
  const target = { ...NORTH_60NM, altFt: 20_000 };
  // Target is north of anchor → reverse bearing (target→anchor) = 180°.
  // Aspect = |reverseBearing - targetTrack|.
  it('HOT when track points back at anchor (±30°)', () => {
    expect(computeBraa(ORIGIN, target, 180).aspectLabel).toBe('HOT');
    expect(computeBraa(ORIGIN, target, 175).aspectLabel).toBe('HOT');
    expect(computeBraa(ORIGIN, target, 205).aspectLabel).toBe('HOT');
  });
  it('FLANK at 30-60° aspect', () => {
    expect(computeBraa(ORIGIN, target, 220).aspectLabel).toBe('FLANK');
    expect(computeBraa(ORIGIN, target, 140).aspectLabel).toBe('FLANK');
  });
  it('BEAM at 60-120° aspect', () => {
    expect(computeBraa(ORIGIN, target, 90).aspectLabel).toBe('BEAM');
    expect(computeBraa(ORIGIN, target, 270).aspectLabel).toBe('BEAM');
  });
  it('COLD when track points away from anchor (>120°)', () => {
    expect(computeBraa(ORIGIN, target, 0).aspectLabel).toBe('COLD');
    expect(computeBraa(ORIGIN, target, 60).aspectLabel).toBe('COLD');
  });
  it('null aspect when track is missing', () => {
    expect(computeBraa(ORIGIN, target, null).aspectLabel).toBeNull();
    expect(computeBraa(ORIGIN, target, undefined).aspectLabel).toBeNull();
    expect(computeBraa(ORIGIN, target, NaN).aspectLabel).toBeNull();
  });
});

describe('formatBra', () => {
  it('pads bearing to 3 digits', () => {
    const s = formatBra({ bearingDeg: 5, rangeNm: 20, altThousands: 15 });
    expect(s).toMatch(/BRA 005° \/ 20 NM \/ 15K/);
  });
  it('wraps 360 to 000', () => {
    const s = formatBra({ bearingDeg: 359.6, rangeNm: 20, altThousands: 15 });
    expect(s).toMatch(/BRA 000°/);
  });
  it('uses 1-decimal range under 10 NM', () => {
    const s = formatBra({ bearingDeg: 90, rangeNm: 5.4, altThousands: 10 });
    expect(s).toMatch(/\/ 5\.4 NM \//);
  });
  it('integer range at 10+ NM', () => {
    const s = formatBra({ bearingDeg: 90, rangeNm: 12.7, altThousands: 10 });
    expect(s).toMatch(/\/ 13 NM \//);
  });
  it('shows em-dash for unknown altitude', () => {
    const s = formatBra({ bearingDeg: 90, rangeNm: 12, altThousands: null });
    expect(s).toMatch(/\/ — *$/);
  });
  it('plain mode drops decoration', () => {
    const s = formatBra({ bearingDeg: 75, rangeNm: 12, altThousands: 18 }, { decorate: false });
    expect(s).toBe('075/12/18');
  });
});

describe('formatBraa', () => {
  it('appends aspect label when known', () => {
    const s = formatBraa({ bearingDeg: 90, rangeNm: 12, altThousands: 18, aspectDeg: 10, aspectLabel: 'HOT' });
    expect(s).toMatch(/HOT$/);
  });
  it('drops aspect when null', () => {
    const s = formatBraa({ bearingDeg: 90, rangeNm: 12, altThousands: 18, aspectDeg: null, aspectLabel: null });
    expect(s).not.toMatch(/HOT|FLANK|BEAM|COLD/);
  });
});

describe('metresToFeet', () => {
  it('converts metres to feet', () => {
    expect(metresToFeet(100)).toBeCloseTo(328.084, 2);
  });
  it('returns undefined for null/undef/NaN', () => {
    expect(metresToFeet(null)).toBeUndefined();
    expect(metresToFeet(undefined)).toBeUndefined();
    expect(metresToFeet(NaN)).toBeUndefined();
  });
});

describe('bullseyeBR + formatBullseye', () => {
  it('matches trueBearingDeg + distance NM', () => {
    const br = bullseyeBR(ORIGIN, NORTH_60NM);
    expect(br.bearingDeg).toBeCloseTo(0, 4);
    expect(br.rangeNm).toBeGreaterThan(59);
    expect(br.rangeNm).toBeLessThan(61);
  });
  it('formats as bullseye BRG/RNG', () => {
    const s = formatBullseye({ bearingDeg: 75, rangeNm: 40 });
    expect(s).toBe('bullseye 075/40');
  });
  it('decorate=false drops the prefix', () => {
    const s = formatBullseye({ bearingDeg: 350, rangeNm: 8.4 }, { decorate: false });
    expect(s).toBe('350/8.4');
  });
  it('respects custom tag', () => {
    const s = formatBullseye({ bearingDeg: 100, rangeNm: 15 }, { tag: 'bull' });
    expect(s).toBe('bull 100/15');
  });
});
