/**
 * Tests for the SOP discrepancy engine — pure-logic unit tests over
 * fixture MissionGroup[] and SOP inputs.
 *
 * Goal: lock in the matching heuristics so we know exactly what will
 * trip the read-only SopCheck panel. When we add Apply-on-click
 * write-back in a follow-up, these same tests guard against the
 * apply path operating on misidentified targets.
 */

import { describe, it, expect } from 'vitest';
import {
  buildReport,
  freqMhz,
  modString,
  fmtFreq,
  freqsMatch,
  firstWord,
  matchSopTanker,
  matchCarrierTacan,
  checkPlayerFlightFreqs,
  checkGuardFreq,
  checkTankers,
  checkCarriers,
} from './discrepancy';
import type { MissionGroup, MissionUnit } from '../types/mission';
import type { SOP } from './types';

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function makeUnit(overrides: Partial<MissionUnit> = {}): MissionUnit {
  return {
    unitId: 1,
    name: 'Bengal 1-1',
    type: 'FA-18C_hornet',
    x: 0,
    y: 0,
    skill: 'Client',
    category: 'plane',
    coalition: 'blue',
    country: 'USA',
    groupName: 'Bengal 1',
    groupId: 1,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<MissionGroup> = {}): MissionGroup {
  return {
    groupId: 1,
    groupName: 'Bengal 1',
    coalition: 'blue',
    country: 'USA',
    category: 'plane',
    task: 'CAS',
    frequency: 270.8,
    modulation: 0,
    units: [makeUnit()],
    waypoints: [],
    ...overrides,
  };
}

function makeSop(overrides: Partial<SOP> = {}): SOP {
  return {
    id: 'sop_test',
    name: 'Test SOP',
    updatedAt: 0,
    flights: [],
    comms: [],
    tacans: [],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Normalisation helpers                                               */
/* ------------------------------------------------------------------ */

describe('freqMhz', () => {
  it('converts Hz to MHz when value is ≥ 1e6', () => {
    expect(freqMhz(305_500_000)).toBe(305.5);
  });

  it('passes MHz values through unchanged', () => {
    expect(freqMhz(305.5)).toBe(305.5);
  });

  it('returns null for null / 0 / negative', () => {
    expect(freqMhz(null)).toBeNull();
    expect(freqMhz(undefined)).toBeNull();
    expect(freqMhz(0)).toBeNull();
    expect(freqMhz(-1)).toBeNull();
  });
});

describe('modString', () => {
  it('returns FM for 1, AM for everything else', () => {
    expect(modString(0)).toBe('AM');
    expect(modString(1)).toBe('FM');
    expect(modString(undefined)).toBe('AM');
  });
});

describe('fmtFreq', () => {
  it('formats with 3 decimals + mod label', () => {
    expect(fmtFreq(270.8, 'AM')).toBe('270.800 AM');
    expect(fmtFreq(243, 'FM')).toBe('243.000 FM');
  });

  it('returns dash for null', () => {
    expect(fmtFreq(null, 'AM')).toBe('—');
  });
});

describe('freqsMatch', () => {
  it('matches exact values', () => {
    expect(freqsMatch(270.8, 270.8)).toBe(true);
  });

  it('matches within 0.5 kHz tolerance', () => {
    expect(freqsMatch(270.8, 270.8003)).toBe(true);
  });

  it('rejects 25 kHz nudge (the smallest Hornet-grid step)', () => {
    expect(freqsMatch(270.8, 270.825)).toBe(false);
  });

  it('rejects null on either side', () => {
    expect(freqsMatch(null, 270.8)).toBe(false);
    expect(freqsMatch(270.8, null)).toBe(false);
  });
});

describe('firstWord', () => {
  it('lowercases the part before space or dash', () => {
    expect(firstWord('Bengal 1')).toBe('bengal');
    expect(firstWord('Enfield-2-1')).toBe('enfield');
    expect(firstWord('UZI')).toBe('uzi');
  });

  it('handles empty / whitespace', () => {
    expect(firstWord('')).toBe('');
    expect(firstWord('   ')).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Tanker matching                                                     */
/* ------------------------------------------------------------------ */

describe('matchSopTanker', () => {
  it('matches by callsign substring in group name', () => {
    const sop = makeSop({
      tankers: [{ callsign: 'Texaco', frequency: 277.8 }],
    });
    const g = makeGroup({ groupName: 'Texaco 1', task: 'Refueling' });
    expect(matchSopTanker(g, sop)?.callsign).toBe('Texaco');
  });

  it('falls back to single tanker when names do not align', () => {
    const sop = makeSop({
      tankers: [{ callsign: 'Arco', frequency: 251.0 }],
    });
    const g = makeGroup({ groupName: 'NonsenseName' });
    expect(matchSopTanker(g, sop)?.callsign).toBe('Arco');
  });

  it('returns null when SOP has multiple tankers and no name matches', () => {
    const sop = makeSop({
      tankers: [
        { callsign: 'Arco', frequency: 251.0 },
        { callsign: 'Shell', frequency: 269.0 },
      ],
    });
    const g = makeGroup({ groupName: 'NonsenseName' });
    expect(matchSopTanker(g, sop)).toBeNull();
  });

  it('returns null when SOP has zero tankers', () => {
    const sop = makeSop({ tankers: [] });
    const g = makeGroup({ groupName: 'Texaco' });
    expect(matchSopTanker(g, sop)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Carrier TACAN matching                                              */
/* ------------------------------------------------------------------ */

describe('matchCarrierTacan', () => {
  it('matches by hull type', () => {
    const sop = makeSop({
      tacans: [
        { role: 'Stennis CVN-74', channel: 74, band: 'X', callsign: 'CVN' },
      ],
    });
    const g = makeGroup({
      units: [makeUnit({ type: 'STENNIS' })],
    });
    expect(matchCarrierTacan(g, sop)?.role).toBe('Stennis CVN-74');
  });

  it('matches by tacan callsign substring', () => {
    const sop = makeSop({
      tacans: [
        { role: 'Lincoln carrier', channel: 71, band: 'X' },
      ],
    });
    const g = makeGroup({
      tacan: { channel: 71, band: 'X', callsign: 'lincoln' },
      units: [makeUnit()],
    });
    expect(matchCarrierTacan(g, sop)?.role).toBe('Lincoln carrier');
  });

  it('falls back to generic CVN/Carrier role when no specific match', () => {
    const sop = makeSop({
      tacans: [
        { role: 'Home Plate', channel: 99, band: 'X' },
      ],
    });
    const g = makeGroup({ units: [makeUnit()] });
    expect(matchCarrierTacan(g, sop)?.role).toBe('Home Plate');
  });

  it('returns null when SOP has no TACAN entries', () => {
    expect(matchCarrierTacan(makeGroup(), makeSop({ tacans: [] }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Per-category checks                                                 */
/* ------------------------------------------------------------------ */

describe('checkPlayerFlightFreqs', () => {
  it('flags red when SOP says X but mission says Y', () => {
    const sop = makeSop({
      flights: [{ callsign: 'Bengal', defaultFreq: 270.8 }],
    });
    const g = makeGroup({ groupName: 'Bengal 1', frequency: 305.0 });
    const rows = checkPlayerFlightFreqs([g], sop);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('red');
    expect(rows[0].field).toBe('Bengal 1');
  });

  it('produces no row when mission matches SOP', () => {
    const sop = makeSop({
      flights: [{ callsign: 'Bengal', defaultFreq: 270.8 }],
    });
    const g = makeGroup({ groupName: 'Bengal 1', frequency: 270.8 });
    expect(checkPlayerFlightFreqs([g], sop)).toEqual([]);
  });

  it('flags gray when player flight callsign is absent from SOP', () => {
    const sop = makeSop({
      flights: [{ callsign: 'Enfield', defaultFreq: 270.8 }],
    });
    const g = makeGroup({ groupName: 'Bengal 1', frequency: 270.8 });
    const rows = checkPlayerFlightFreqs([g], sop);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('gray');
    expect(rows[0].sopValue).toBe('Not in SOP');
  });

  it('skips AI / non-player flights', () => {
    const sop = makeSop({
      flights: [{ callsign: 'Bengal', defaultFreq: 270.8 }],
    });
    const aiUnit = makeUnit({ skill: 'High' });
    const g = makeGroup({
      groupName: 'Bengal 1',
      frequency: 305.0,
      units: [aiUnit],
    });
    expect(checkPlayerFlightFreqs([g], sop)).toEqual([]);
  });

  it('skips ground vehicles even if their name matches', () => {
    const sop = makeSop({
      flights: [{ callsign: 'Bengal', defaultFreq: 270.8 }],
    });
    const g = makeGroup({
      category: 'vehicle',
      groupName: 'Bengal 1',
    });
    expect(checkPlayerFlightFreqs([g], sop)).toEqual([]);
  });

  it('handles freq stored as Hz on the mission side', () => {
    const sop = makeSop({
      flights: [{ callsign: 'Bengal', defaultFreq: 270.8 }],
    });
    const g = makeGroup({ groupName: 'Bengal 1', frequency: 270_800_000 });
    expect(checkPlayerFlightFreqs([g], sop)).toEqual([]);
  });
});

describe('checkGuardFreq', () => {
  it('produces a yellow row when no group is tuned to SOP guard', () => {
    const sop = makeSop({
      comms: [{ role: 'Guard', frequency: 243.0 }],
    });
    const g = makeGroup({ frequency: 270.8 });
    const rows = checkGuardFreq([g], sop);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('yellow');
  });

  it('produces no row when at least one group matches SOP guard', () => {
    const sop = makeSop({
      comms: [{ role: 'Guard', frequency: 243.0 }],
    });
    const groups = [
      makeGroup({ groupId: 1, frequency: 270.8 }),
      makeGroup({ groupId: 2, frequency: 243.0 }),
    ];
    expect(checkGuardFreq(groups, sop)).toEqual([]);
  });

  it('produces no row when SOP has no guard entry', () => {
    const sop = makeSop({ comms: [] });
    expect(checkGuardFreq([makeGroup()], sop)).toEqual([]);
  });
});

describe('checkTankers', () => {
  it('flags freq mismatch when SOP and mission disagree', () => {
    const sop = makeSop({
      tankers: [{ callsign: 'Texaco', frequency: 277.8 }],
    });
    const g = makeGroup({
      groupName: 'Texaco',
      task: 'Refueling',
      frequency: 305.0,
    });
    const rows = checkTankers([g], sop);
    const freqRow = rows.find((r) => r.category === 'Tanker Freq');
    expect(freqRow?.severity).toBe('red');
  });

  it('flags TACAN mismatch independently of freq', () => {
    const sop = makeSop({
      tankers: [{
        callsign: 'Texaco',
        tacanChannel: 51,
        tacanBand: 'Y',
      }],
    });
    const g = makeGroup({
      groupName: 'Texaco',
      task: 'Refueling',
      tacan: { channel: 49, band: 'X', callsign: 'TEX' },
    });
    const rows = checkTankers([g], sop);
    const tcnRow = rows.find((r) => r.category === 'Tanker TACAN');
    expect(tcnRow?.severity).toBe('red');
  });

  it('produces no rows when mission matches SOP', () => {
    const sop = makeSop({
      tankers: [{
        callsign: 'Texaco',
        frequency: 277.8,
        tacanChannel: 51,
        tacanBand: 'Y',
      }],
    });
    const g = makeGroup({
      groupName: 'Texaco',
      task: 'Refueling',
      frequency: 277.8,
      tacan: { channel: 51, band: 'Y', callsign: 'TEX' },
    });
    expect(checkTankers([g], sop)).toEqual([]);
  });

  it('detects tankers by group name even when task is not Refueling', () => {
    const sop = makeSop({
      tankers: [{ callsign: 'Arco', frequency: 251.0 }],
    });
    const g = makeGroup({
      groupName: 'Arco',
      task: 'Nothing',
      frequency: 305.0,
    });
    expect(checkTankers([g], sop).length).toBeGreaterThan(0);
  });
});

describe('checkCarriers', () => {
  it('flags TACAN mismatch on a CVN', () => {
    const sop = makeSop({
      tacans: [{ role: 'Stennis CVN-74', channel: 74, band: 'X', callsign: 'CVN' }],
    });
    // isCarrierGroup needs category=ship + a hull-recognising type
    const g = makeGroup({
      category: 'ship',
      tacan: { channel: 99, band: 'X', callsign: 'STE' },
      units: [makeUnit({ type: 'Stennis' })],
    });
    const rows = checkCarriers([g], sop);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('red');
  });

  it('produces no row when mission matches SOP', () => {
    const sop = makeSop({
      tacans: [{ role: 'Stennis CVN-74', channel: 74, band: 'X' }],
    });
    const g = makeGroup({
      category: 'ship',
      tacan: { channel: 74, band: 'X', callsign: 'CVN' },
      units: [makeUnit({ type: 'Stennis' })],
    });
    expect(checkCarriers([g], sop)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* End-to-end report                                                   */
/* ------------------------------------------------------------------ */

describe('buildReport', () => {
  it('produces zero rows when mission and SOP fully agree', () => {
    const sop = makeSop({
      flights: [{ callsign: 'Bengal', defaultFreq: 270.8 }],
      comms: [{ role: 'Guard', frequency: 243.0 }],
    });
    const groups = [
      makeGroup({ groupName: 'Bengal 1', frequency: 270.8 }),
      // The guard-tuned group has to be a non-player AI group with a
      // callsign that doesn't match anything in SOP — otherwise it
      // would trip the player-flight-freq check.
      makeGroup({
        groupId: 2,
        groupName: 'AWACS Magic',
        frequency: 243.0,
        units: [makeUnit({ skill: 'High', name: 'Magic 1' })],
      }),
    ];
    expect(buildReport(groups, sop)).toEqual([]);
  });

  it('aggregates rows from multiple categories', () => {
    const sop = makeSop({
      flights: [{ callsign: 'Bengal', defaultFreq: 270.8 }],
      comms: [{ role: 'Guard', frequency: 243.0 }],
      tankers: [{ callsign: 'Texaco', frequency: 277.8 }],
    });
    const groups = [
      // Bengal frequency wrong
      makeGroup({ groupName: 'Bengal 1', frequency: 305.0 }),
      // Texaco frequency wrong + no group on guard
      makeGroup({
        groupId: 2, groupName: 'Texaco', task: 'Refueling', frequency: 305.5,
      }),
    ];
    const rows = buildReport(groups, sop);
    // Expect at least: 1 flight-freq red, 1 guard yellow, 1 tanker-freq red
    const cats = rows.map((r) => r.category);
    expect(cats).toContain('Flight Frequency');
    expect(cats).toContain('Guard Channel');
    expect(cats).toContain('Tanker Freq');
  });
});
