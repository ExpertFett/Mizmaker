/**
 * Tests for the BriefingTab Auto-Fill planner (v1.19.52).
 *
 * Bug: pre-v1.19.52 the Auto-Fill button overwrote every field unconditionally,
 * erasing text the user (or the original .miz) already had in place. Tester
 * report: "I don't want it to erase any work that anyone may have done."
 * Fix: only fill fields whose current value is empty (trim-aware).
 */

import { describe, it, expect } from 'vitest';
import { computeAutoFillPlan } from './BriefingTab';

const BLANK = { sortie: '', description: '', blueTask: '', redTask: '' };
const GENERATED = {
  sortie: 'OPS-25-CAS-01',
  description: 'Friendly forces tasked with neutralising armour east of...',
  blueTask: 'Destroy assigned target set',
  redTask: 'Defend the corridor',
};

describe('computeAutoFillPlan', () => {
  it('fills every field when all are empty', () => {
    const plan = computeAutoFillPlan({ current: BLANK, generated: GENERATED });
    expect(plan.fill).toEqual(GENERATED);
    expect(plan.filled).toEqual(['Sortie', 'Situation', 'Blue Task', 'Red Task']);
    expect(plan.skipped).toEqual([]);
  });

  it('skips a field that has content — the headline bug fix', () => {
    const plan = computeAutoFillPlan({
      current: { ...BLANK, description: 'Mission maker wrote this carefully.' },
      generated: GENERATED,
    });
    expect(plan.fill.description).toBeUndefined();
    expect(plan.fill.sortie).toBe(GENERATED.sortie);
    expect(plan.filled).toContain('Sortie');
    expect(plan.skipped).toContain('Situation');
  });

  it('treats a whitespace-only value as empty (still fills)', () => {
    const plan = computeAutoFillPlan({
      current: { ...BLANK, sortie: '   \n  ' },
      generated: GENERATED,
    });
    expect(plan.fill.sortie).toBe(GENERATED.sortie);
    expect(plan.filled).toContain('Sortie');
  });

  it('skips ALL fields when every one already has content', () => {
    const current = {
      sortie: 'Pre-existing',
      description: 'Pre-existing',
      blueTask: 'Pre-existing',
      redTask: 'Pre-existing',
    };
    const plan = computeAutoFillPlan({ current, generated: GENERATED });
    expect(plan.fill).toEqual({});
    expect(plan.filled).toEqual([]);
    expect(plan.skipped).toEqual(['Sortie', 'Situation', 'Blue Task', 'Red Task']);
  });

  it('mixed: only the two empty fields get filled, two are preserved', () => {
    const plan = computeAutoFillPlan({
      current: { ...BLANK, sortie: 'KEEPME', redTask: 'KEEPME' },
      generated: GENERATED,
    });
    expect(plan.filled).toEqual(['Situation', 'Blue Task']);
    expect(plan.skipped).toEqual(['Sortie', 'Red Task']);
    expect(plan.fill.sortie).toBeUndefined();
    expect(plan.fill.redTask).toBeUndefined();
    expect(plan.fill.description).toBe(GENERATED.description);
    expect(plan.fill.blueTask).toBe(GENERATED.blueTask);
  });

  it('preserves generated escape sequences — caller is responsible for de-escape', () => {
    // The component de-escapes "\\n" → "\n" when applying; the helper
    // shouldn't pre-mangle it.
    const plan = computeAutoFillPlan({
      current: BLANK,
      generated: { ...GENERATED, description: 'line1\\nline2\\nline3' },
    });
    expect(plan.fill.description).toBe('line1\\nline2\\nline3');
  });
});
