import { describe, it, expect } from 'vitest';
import {
  sampleRoute, corridorPoints, msaPerLeg, roundMsa,
  MSA_BUFFER_FT, type RouteSample,
} from './routeProfile';

const wp = (lat: number, lon: number, altM: number) => ({ lat, lon, altitude_m: altM });

// Roughly 60 NM per degree of latitude, so this is a ~60 NM northbound leg.
const TWO_LEG = [wp(69.0, 30.0, 0), wp(70.0, 30.0, 3048), wp(70.0, 32.0, 3048)];

describe('sampleRoute', () => {
  it('returns nothing without at least two positioned waypoints', () => {
    expect(sampleRoute([])).toEqual([]);
    expect(sampleRoute([wp(69, 30, 0)])).toEqual([]);
    expect(sampleRoute([{ lat: null, lon: null, altitude_m: 0 }, wp(70, 30, 0)])).toEqual([]);
  });

  it('starts at the first waypoint and ends at the last', () => {
    const s = sampleRoute(TWO_LEG);
    expect(s[0].distNm).toBeCloseTo(0, 5);
    expect(s[0].lat).toBeCloseTo(69.0, 4);
    expect(s.at(-1)!.lon).toBeCloseTo(32.0, 3);
  });

  it('spaces samples evenly by distance', () => {
    const s = sampleRoute(TWO_LEG);
    const steps = s.slice(1).map((x, i) => x.distNm - s[i].distNm);
    const first = steps[0];
    for (const step of steps) expect(step).toBeCloseTo(first, 6);
  });

  it('interpolates planned altitude between waypoints', () => {
    // Climbing 0 -> 10,000 ft over the first leg.
    const s = sampleRoute([wp(69.0, 30.0, 0), wp(70.0, 30.0, 3048)], 11);
    expect(s[0].plannedAltFt).toBeCloseTo(0, 1);
    expect(s.at(-1)!.plannedAltFt).toBeCloseTo(10000, 0);
    expect(s[5].plannedAltFt).toBeGreaterThan(4000);
    expect(s[5].plannedAltFt).toBeLessThan(6000);
  });

  it('tags each sample with the leg it belongs to', () => {
    const s = sampleRoute(TWO_LEG);
    expect(s[0].leg).toBe(0);
    expect(s.at(-1)!.leg).toBe(1);
    expect(new Set(s.map((x) => x.leg))).toEqual(new Set([0, 1]));
  });

  it('never exceeds the sample cap on a long route', () => {
    const long = [wp(20, 0, 0), wp(60, 0, 3000)];   // ~2,400 NM
    expect(sampleRoute(long, 160).length).toBeLessThanOrEqual(160);
  });

  it('handles a zero-length route without dividing by zero', () => {
    expect(sampleRoute([wp(69, 30, 0), wp(69, 30, 0)])).toEqual([]);
  });
});

describe('corridorPoints', () => {
  it('offsets perpendicular to a northbound track — i.e. east and west', () => {
    const s = sampleRoute([wp(69.0, 30.0, 0), wp(70.0, 30.0, 0)], 11);
    const [a, b] = corridorPoints(s, 5);
    // Perpendicular to north is east/west: longitude moves, latitude barely.
    expect(Math.abs(a[0] - s[5].lat)).toBeLessThan(0.02);
    expect(Math.abs(a[1] - s[5].lon)).toBeGreaterThan(0.05);
    expect(Math.sign(a[1] - s[5].lon)).toBe(-Math.sign(b[1] - s[5].lon));
  });

  it('offsets north and south for an eastbound track', () => {
    const s = sampleRoute([wp(69.0, 30.0, 0), wp(69.0, 32.0, 0)], 11);
    const [a] = corridorPoints(s, 5);
    expect(Math.abs(a[0] - s[5].lat)).toBeGreaterThan(0.05);
  });

  it('puts both offsets the requested distance out', () => {
    const s = sampleRoute([wp(69.0, 30.0, 0), wp(70.0, 30.0, 0)], 11);
    const [a, b] = corridorPoints(s, 5, 5);
    const nm = (p: [number, number]) => Math.hypot(
      (p[0] - s[5].lat) * 60,
      (p[1] - s[5].lon) * 60 * Math.cos((s[5].lat * Math.PI) / 180));
    expect(nm(a)).toBeCloseTo(5, 0);
    expect(nm(b)).toBeCloseTo(5, 0);
  });

  it('does not blow up at the ends where there is no previous sample', () => {
    const s = sampleRoute(TWO_LEG);
    for (const i of [0, s.length - 1]) {
      const [a, b] = corridorPoints(s, i);
      expect(Number.isFinite(a[0]) && Number.isFinite(b[1])).toBe(true);
    }
  });
});

describe('roundMsa', () => {
  it('rounds up to the next hundred, the way an MSA is published', () => {
    expect(roundMsa(2401)).toBe(2500);
    expect(roundMsa(2400)).toBe(2400);
  });
});

describe('msaPerLeg', () => {
  const withTerrain = (vals: [number, number | null][]): RouteSample[] =>
    vals.map(([leg, corridorFt], i) => ({
      distNm: i, lat: 0, lon: 0, plannedAltFt: 0, leg, corridorFt, terrainFt: corridorFt,
    }));

  it('takes the highest terrain on each leg and adds the buffer', () => {
    const msa = msaPerLeg(withTerrain([[0, 1200], [0, 3310], [1, 500]]));
    expect(msa.get(0)).toBe(roundMsa(3310 + MSA_BUFFER_FT));
    expect(msa.get(1)).toBe(roundMsa(500 + MSA_BUFFER_FT));
  });

  it('uses the corridor height, not the centreline — the ridge off track counts', () => {
    const samples: RouteSample[] = [
      { distNm: 0, lat: 0, lon: 0, plannedAltFt: 0, leg: 0, terrainFt: 100, corridorFt: 6000 },
    ];
    expect(msaPerLeg(samples).get(0)).toBe(roundMsa(6000 + MSA_BUFFER_FT));
  });

  it('ignores legs with no data rather than reporting a floor of zero', () => {
    const msa = msaPerLeg(withTerrain([[0, null], [1, 800]]));
    expect(msa.has(0)).toBe(false);
    expect(msa.get(1)).toBe(roundMsa(800 + MSA_BUFFER_FT));
  });

  it('never returns an MSA below the buffer, even over water', () => {
    // Sea clamps to 0 upstream, so the floor is the buffer itself.
    expect(msaPerLeg(withTerrain([[0, 0]])).get(0)).toBe(MSA_BUFFER_FT);
  });

  it('is empty for an empty route', () => {
    expect(msaPerLeg([]).size).toBe(0);
  });
});
