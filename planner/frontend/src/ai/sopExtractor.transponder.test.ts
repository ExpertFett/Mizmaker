/**
 * Tests for the transponder-card → SOP merge (v1.19.82, #64).
 * The AI vision call can't be unit-tested, but mergePartialIntoSop's
 * transponder handling is pure: per-flight dedupe (existing wins),
 * mission-wide mode1/mode4 fill, codes preserved as strings.
 */

import { describe, it, expect } from 'vitest';
import { mergePartialIntoSop } from './sopExtractor';
import { makeEmptySop } from '../sop/types';

const partial = {
  transponder: {
    mode1: '51',
    mode4: true,
    assignments: [
      { flight: 'Bengal', mode2: '5101', mode3: '4301' },
      { flight: 'Hammer', mode2: '5201', mode3: '4302', notes: 'CAS' },
    ],
  },
};

describe('mergePartialIntoSop — transponder', () => {
  it('builds a transponder plan with mission Mode 1/4 + per-flight squawks', () => {
    const sop = mergePartialIntoSop(makeEmptySop(), partial as never);
    const t = sop.transponder!;
    expect(t).toBeTruthy();
    expect(t.mode1).toBe('51');
    expect(t.mode4).toBe(true);
    expect(t.assignments.length).toBe(2);
    const bengal = t.assignments.find((a) => a.flight === 'Bengal')!;
    expect(bengal.mode3).toBe('4301'); // preserved as string
    expect(t.assignments.find((a) => a.flight === 'Hammer')!.notes).toBe('CAS');
  });

  it('preserves leading-zero / octal codes as strings', () => {
    const sop = mergePartialIntoSop(makeEmptySop(), {
      transponder: { assignments: [{ flight: 'Viper', mode3: '0710' }] },
    } as never);
    expect(sop.transponder!.assignments[0].mode3).toBe('0710');
  });

  it('does not duplicate or overwrite an existing flight on re-import', () => {
    let sop = mergePartialIntoSop(makeEmptySop(), partial as never);
    // User edits Bengal's squawk by hand.
    sop = {
      ...sop,
      transponder: {
        ...sop.transponder!,
        assignments: sop.transponder!.assignments.map((a) =>
          a.flight === 'Bengal' ? { ...a, mode3: '7777' } : a),
      },
    };
    // Re-import the same card.
    const after = mergePartialIntoSop(sop, partial as never);
    const bengal = after.transponder!.assignments.filter((a) => a.flight === 'Bengal');
    expect(bengal.length).toBe(1);          // not duplicated
    expect(bengal[0].mode3).toBe('7777');   // user's edit wins
  });

  it('leaves transponder untouched when the partial has none', () => {
    const sop = mergePartialIntoSop(makeEmptySop(), { flights: [{ callsign: 'Uzi' }] } as never);
    expect(sop.transponder).toBeUndefined();
  });
});
