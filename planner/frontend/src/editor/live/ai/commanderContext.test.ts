/**
 * Unit conversions and the picture summarizer.
 *
 * The conversions are where a silent wrong answer is most likely: the wire
 * gives radians / m/s / metres and the model is told degrees / knots / feet, so
 * a missed conversion reads as plausible-but-wrong rather than as an error.
 */

import { describe, it, expect } from 'vitest';
import {
  altFt, coalitionLabel, filterUnits, headingDeg, speedKt,
  summarizeAirbases, summarizePicture, summarizeUnitDbMatches,
} from './commanderContext';
import type { CmdrUnit } from './commanderTypes';

const hornet = (over: Partial<CmdrUnit> = {}): CmdrUnit => ({
  olympusID: 1001,
  name: 'FA-18C_hornet',
  unitName: 'Enfield 1-1',
  groupName: 'Enfield',
  category: 'Aircraft',
  coalition: 2,
  alive: 1,
  controlled: 1,
  human: 0,
  ROE: 3,
  alarmState: 0,
  heading: Math.PI / 2,      // 090
  speed: 200,                // ~389 kt
  position: { lat: 41.0, lng: 42.0, alt: 6096 },  // 20,000 ft
  ...over,
});

describe('headingDeg', () => {
  it('converts radians to whole degrees', () => {
    expect(headingDeg(hornet())).toBe(90);
  });
  it('prefers track (course over ground) over nose heading', () => {
    expect(headingDeg(hornet({ heading: 0, track: Math.PI }))).toBe(180);
  });
  it('normalizes negative angles into 0-360', () => {
    expect(headingDeg(hornet({ track: -Math.PI / 2 }))).toBe(270);
  });
  it('normalizes angles beyond a full turn', () => {
    expect(headingDeg(hornet({ track: 2 * Math.PI + Math.PI / 2 }))).toBe(90);
  });
  it('returns null when neither is present', () => {
    expect(headingDeg({ olympusID: 1 })).toBeNull();
  });
});

describe('speedKt', () => {
  it('converts m/s to knots', () => {
    expect(speedKt(hornet({ speed: 100 }))).toBe(194);
  });
  it('returns null when absent', () => {
    expect(speedKt({ olympusID: 1 })).toBeNull();
  });
});

describe('altFt', () => {
  it('converts metres to feet', () => {
    expect(altFt(hornet())).toBe(20000);
  });
  it('returns null with no position', () => {
    expect(altFt({ olympusID: 1 })).toBeNull();
  });
});

describe('coalitionLabel', () => {
  it('maps the wire codes', () => {
    expect(coalitionLabel(2)).toBe('BLU');
    expect(coalitionLabel(1)).toBe('RED');
    expect(coalitionLabel(0)).toBe('NEU');
    expect(coalitionLabel(undefined)).toBe('NEU');
  });
});

describe('filterUnits', () => {
  const units = [
    hornet(),
    hornet({ olympusID: 2001, name: 'Su-27', unitName: 'Dodge 1', groupName: 'Dodge', coalition: 1 }),
    hornet({ olympusID: 3001, name: 'S-300PS', unitName: 'SAM-1', groupName: 'SAM-1', category: 'GroundUnit', coalition: 1 }),
    hornet({ olympusID: 4001, alive: 0 }),
  ];

  it('drops dead units unconditionally', () => {
    expect(filterUnits(units, {}).map((u) => u.olympusID)).not.toContain(4001);
  });
  it('filters by coalition', () => {
    expect(filterUnits(units, { coalition: 'red' }).map((u) => u.olympusID)).toEqual([2001, 3001]);
  });
  it('filters by category', () => {
    expect(filterUnits(units, { category: 'GroundUnit' }).map((u) => u.olympusID)).toEqual([3001]);
  });
  it('matches the query against type, callsign and group', () => {
    expect(filterUnits(units, { query: 'su-27' }).map((u) => u.olympusID)).toEqual([2001]);
    expect(filterUnits(units, { query: 'enfield' }).map((u) => u.olympusID)).toEqual([1001]);
  });
});

describe('summarizePicture', () => {
  const bullseye = { lat: 41.0, lng: 41.0 };

  it('emits a legend and one line per unit, grouped', () => {
    const out = summarizePicture([hornet(), hornet({ olympusID: 1002, unitName: 'Enfield 1-2' })], bullseye);
    expect(out).toContain('LEGEND');
    expect(out).toContain('GROUP Enfield (2 units, BLU, Aircraft)');
    expect(out).toContain('1001|FA-18C_hornet|Enfield 1-1|BLU');
    expect(out).toContain('1002|');
  });

  it('includes converted altitude, heading and speed', () => {
    const out = summarizePicture([hornet()], bullseye);
    expect(out).toContain('|20000|90|389|');
  });

  it('computes a bullseye bearing/range for each unit', () => {
    // Target is due east of the bullseye at this latitude.
    const out = summarizePicture([hornet()], bullseye);
    expect(out).toMatch(/\|090\/\d+\|/);
  });

  it('marks protected and human units so the model can respect them', () => {
    const out = summarizePicture([
      hornet({ olympusID: 1, controlled: 0 }),
      hornet({ olympusID: 2, human: 1 }),
    ], bullseye);
    expect(out).toContain('ME-PROTECTED');
    expect(out).toContain('HUMAN');
  });

  it('says so explicitly when it truncates', () => {
    const many = Array.from({ length: 30 }, (_, i) => hornet({ olympusID: 100 + i, groupName: `G${i}` }));
    const out = summarizePicture(many, bullseye, { maxUnits: 5 });
    expect(out).toContain('25 more units matched but were not shown');
  });

  it('caps max_units at 150 however large the request', () => {
    const many = Array.from({ length: 300 }, (_, i) => hornet({ olympusID: 100 + i, groupName: `G${i}` }));
    const out = summarizePicture(many, bullseye, { maxUnits: 9999 });
    expect(out).toContain('150 more units matched');
  });

  it('handles an empty picture', () => {
    expect(summarizePicture([], bullseye)).toBe('No units match that filter.');
  });

  it('notes when there is no bullseye rather than faking a bearing', () => {
    const out = summarizePicture([hornet()], null);
    expect(out).toContain('BULLSEYE not set');
  });
});

describe('summarizeAirbases', () => {
  it('lists name and position', () => {
    const out = summarizeAirbases([{ name: 'Batumi', lat: 41.6, lng: 41.6, coalition: 2 }]);
    expect(out).toContain('Batumi|41.6000,41.6000|2');
  });
  it('handles an empty list', () => {
    expect(summarizeAirbases([])).toBe('No airbase data available.');
  });
});

describe('summarizeUnitDbMatches', () => {
  const db = {
    'Su-27': { label: 'Su-27 Flanker-B', type: 'Fighter', era: 'Modern', coalition: 'red', loadouts: [{ name: 'CAP', code: 'x', roles: ['CAP'] }] },
    'FA-18C_hornet': { label: 'F/A-18C Hornet', type: 'Multirole', era: 'Modern', coalition: 'blue', loadouts: [] },
  };

  it('returns the exact spawn key first on each line', () => {
    const out = summarizeUnitDbMatches(db, 'su-27');
    expect(out).toContain('Su-27|Su-27 Flanker-B|Fighter|Modern|red|CAP');
  });
  it('tells the model to use the key verbatim', () => {
    expect(summarizeUnitDbMatches(db, 'su')).toContain('EXACTLY');
  });
  it('reports no matches rather than returning an empty list', () => {
    expect(summarizeUnitDbMatches(db, 'tomcat')).toBe('No unit types match "tomcat".');
  });
  it('filters by coalition', () => {
    const out = summarizeUnitDbMatches(db, '', { coalition: 'blue' });
    expect(out).toContain('FA-18C_hornet');
    expect(out).not.toContain('Su-27|');
  });
});
