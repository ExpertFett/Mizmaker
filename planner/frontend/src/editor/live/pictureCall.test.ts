/**
 * Picture-call aggregator tests. This is what a DM looks at to make the
 * "PICTURE — N contacts" radio call. Getting the band logic wrong means
 * a low bandit reads as mid, or the wrong aspect goes out on the radio.
 */

import { describe, it, expect } from 'vitest';
import { buildPictureCall, formatPictureCall, type PictureTrack } from './pictureCall';
import type { LL } from './braCalc';

const ANCHOR: LL = { lat: 0, lng: 0 };

function bandit(overrides: Partial<PictureTrack> = {}): PictureTrack {
  return {
    lat: 1, lng: 0,  // 60 NM north of ANCHOR
    altFt: 18_000,
    coalition: 1,    // hostile
    trackDeg: 180,   // pointing at anchor → HOT
    ...overrides,
  };
}

describe('buildPictureCall', () => {
  it('returns null when there are zero hostiles', () => {
    expect(buildPictureCall(ANCHOR, [])).toBeNull();
    expect(buildPictureCall(ANCHOR, [bandit({ coalition: 2 })])).toBeNull();
  });

  it('counts only coalition === 1 as bandits (drops friendlies / neutrals)', () => {
    const p = buildPictureCall(ANCHOR, [
      bandit(),                       // hostile
      bandit({ coalition: 2 }),       // friendly
      bandit({ coalition: undefined }), // neutral
    ]);
    expect(p?.totalBandits).toBe(1);
  });

  it('buckets bandits into low / mid / high by altitude', () => {
    const p = buildPictureCall(ANCHOR, [
      bandit({ altFt: 5_000 }),    // low
      bandit({ altFt: 18_000 }),   // mid
      bandit({ altFt: 35_000 }),   // high
    ]);
    expect(p?.totalBandits).toBe(3);
    expect(p?.bands.map((b) => b.band)).toEqual(['low', 'mid', 'high']);
    expect(p?.bands.every((b) => b.count === 1)).toBe(true);
  });

  it('uses CLOSEST track in each band for the BRAA call', () => {
    const close: PictureTrack = bandit({ lat: 0.5, altFt: 18_000 });   // ~30 NM
    const far: PictureTrack = bandit({ lat: 2, altFt: 18_000 });        // ~120 NM
    const p = buildPictureCall(ANCHOR, [close, far]);
    // The line should mention the close range (~30 NM) not the far (120).
    const line = p?.bands[0]?.line || '';
    expect(line).toMatch(/2 bandits/);
    // Range in the line is "30" or close to it; far would be ~120.
    const rangeMatch = line.match(/(\d+)(\.\d+)? NM/);
    const range = rangeMatch ? parseInt(rangeMatch[1], 10) : 0;
    expect(range).toBeLessThan(50);
  });

  it('drops aspect when bandits in a band have mixed aspects', () => {
    const hot: PictureTrack = bandit({ trackDeg: 180 });   // HOT
    const cold: PictureTrack = bandit({ lat: 1.001, trackDeg: 0 });  // COLD
    const p = buildPictureCall(ANCHOR, [hot, cold]);
    const line = p?.bands[0]?.line || '';
    // mixed aspects → no aspect tag in the line
    expect(line).not.toMatch(/HOT|FLANK|BEAM|COLD/);
  });

  it('keeps aspect when all bandits in a band have the same aspect', () => {
    const p = buildPictureCall(ANCHOR, [
      bandit({ trackDeg: 180 }),
      bandit({ lat: 1.001, trackDeg: 180 }),
    ]);
    const line = p?.bands[0]?.line || '';
    expect(line).toMatch(/HOT/);
  });

  it('treats undefined altitude as mid band (does not crash)', () => {
    const p = buildPictureCall(ANCHOR, [bandit({ altFt: undefined })]);
    expect(p?.bands.length).toBe(1);
    expect(p?.bands[0].band).toBe('mid');
  });

  it('boundary: 9_999 ft = low, 10_000 = mid, 30_001 = high', () => {
    const p1 = buildPictureCall(ANCHOR, [bandit({ altFt: 9_999 })]);
    const p2 = buildPictureCall(ANCHOR, [bandit({ altFt: 10_000 })]);
    const p3 = buildPictureCall(ANCHOR, [bandit({ altFt: 30_001 })]);
    expect(p1?.bands[0].band).toBe('low');
    expect(p2?.bands[0].band).toBe('mid');
    expect(p3?.bands[0].band).toBe('high');
  });

  it('emits bandsBE only when a bullseye is provided', () => {
    const noBE = buildPictureCall(ANCHOR, [bandit()]);
    expect(noBE?.bandsBE).toBeUndefined();
    const withBE = buildPictureCall(ANCHOR, [bandit()], { lat: 0, lng: 0.5 });
    expect(withBE?.bandsBE?.length).toBe(1);
  });

  it('bullseye-relative line uses the "bullseye BRG/RNG" format', () => {
    const p = buildPictureCall(ANCHOR, [bandit()], { lat: 0, lng: 0 });
    const beLine = p?.bandsBE?.[0]?.line || '';
    expect(beLine).toMatch(/bullseye \d{3}\/\d/);
  });
});

describe('formatPictureCall', () => {
  it('"No bandits." when nothing in the picture', () => {
    const empty = { anchor: ANCHOR, bands: [], totalBandits: 0 };
    expect(formatPictureCall(empty)).toBe('No bandits.');
  });

  it('header reads "single" for a lone contact', () => {
    const p = buildPictureCall(ANCHOR, [bandit()])!;
    const txt = formatPictureCall(p);
    expect(txt).toMatch(/PICTURE — single/);
  });

  it('header reads "N contacts" for many', () => {
    const p = buildPictureCall(ANCHOR, [
      bandit({ altFt: 5_000 }),
      bandit({ altFt: 18_000 }),
      bandit({ altFt: 35_000 }),
    ])!;
    const txt = formatPictureCall(p);
    expect(txt).toMatch(/PICTURE — 3 contacts/);
  });

  it('prefers bullseye mode when bandsBE is available + auto-mode', () => {
    const p = buildPictureCall(ANCHOR, [bandit()], { lat: 0, lng: 0.5 })!;
    const txt = formatPictureCall(p);  // auto
    expect(txt).toMatch(/bullseye \d{3}\/\d/);
  });

  it('mode: "braa" forces BRA form even when bullseye is available', () => {
    const p = buildPictureCall(ANCHOR, [bandit()], { lat: 0, lng: 0.5 })!;
    const txt = formatPictureCall(p, { mode: 'braa' });
    expect(txt).not.toMatch(/bullseye/);
    expect(txt).toMatch(/\d{3}° \/ \d+/);
  });
});
