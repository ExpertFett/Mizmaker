import { describe, it, expect } from 'vitest';
import { parseIntent, composeIntent } from './commandersIntent';

describe('commanders intent parse/compose', () => {
  it('round-trips the three labelled parts', () => {
    const src = 'Purpose: Deny the road.\n\nMethod: Sweep ahead of CAS.\n\nEnd State: Advance stalled.';
    const p = parseIntent(src);
    expect(p.purpose).toBe('Deny the road.');
    expect(p.method).toBe('Sweep ahead of CAS.');
    expect(p.endState).toBe('Advance stalled.');
    expect(p.freeform).toBe('');
    expect(composeIntent(p)).toBe(src);
  });

  it('composes to empty when nothing is written, so the slide is omitted', () => {
    expect(composeIntent(parseIntent(''))).toBe('');
    expect(composeIntent(parseIntent('   \n  '))).toBe('');
    expect(composeIntent({ purpose: '', method: '', endState: '', freeform: '' })).toBe('');
  });

  it('omits unfilled parts rather than emitting empty labels', () => {
    const out = composeIntent({ purpose: 'Hold the CAP.', method: '', endState: '', freeform: '' });
    expect(out).toBe('Purpose: Hold the CAP.');
    expect(out).not.toContain('Method');
    expect(out).not.toContain('End State');
  });

  it('preserves unlabelled prose (e.g. AI output) instead of destroying it', () => {
    const prose = 'We are flying to keep the boat safe and the students alive.';
    const p = parseIntent(prose);
    expect(p.freeform).toBe(prose);
    expect(composeIntent(p)).toBe(prose);
  });

  it('keeps multi-line bodies with their label', () => {
    const p = parseIntent('Method: First line.\nSecond line.\n\nEnd State: Done.');
    expect(p.method).toBe('First line.\nSecond line.');
    expect(p.endState).toBe('Done.');
  });

  it('accepts label variations', () => {
    const p = parseIntent('PURPOSE: A\nend-state: B');
    expect(p.purpose).toBe('A');
    expect(p.endState).toBe('B');
  });
});
