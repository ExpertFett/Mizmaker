/**
 * Prompt-construction tests for templateMapper. We don't hit the live API
 * — we lock down the shape of the user message so future edits can't
 * silently drop the unresolved-token list or the brief snapshot fields
 * the model relies on for grounding.
 */

import { describe, it, expect } from 'vitest';
import {
  buildTemplateMapperUserMessage,
  type TemplateMapperInput,
} from './templateMapper';

function makeInput(overrides: Partial<TemplateMapperInput> = {}): TemplateMapperInput {
  return {
    unresolvedTokens: ['flt1_callsign', 'flt1_aircraft', 'mission_name'],
    brief: {
      mission_name: 'Operation Test',
      theater: 'Caucasus',
      date: '2026-06-06',
      time_zulu: '0900Z',
      coalition: 'blue',
      scenario: 'Test scenario',
      commanders_intent: '',
      threats: [],
      flights: [
        { callsign: 'ENFIELD', aircraft: 'FA-18C', count: 4, role: 'cas',
          frequency: '305.000', tacan: '', home_plate: 'Senaki' },
      ],
    },
    ...overrides,
  };
}

describe('buildTemplateMapperUserMessage', () => {
  it('lists every unresolved token under TOKENS TO MAP', () => {
    const msg = buildTemplateMapperUserMessage(makeInput());
    expect(msg).toMatch(/TOKENS TO MAP:/);
    expect(msg).toMatch(/- flt1_callsign/);
    expect(msg).toMatch(/- flt1_aircraft/);
    expect(msg).toMatch(/- mission_name/);
  });

  it('emits BRIEF SNAPSHOT with mission identity fields', () => {
    const msg = buildTemplateMapperUserMessage(makeInput());
    expect(msg).toMatch(/BRIEF SNAPSHOT:/);
    expect(msg).toMatch(/mission_name: Operation Test/);
    expect(msg).toMatch(/theater: Caucasus/);
    expect(msg).toMatch(/date: 2026-06-06/);
    expect(msg).toMatch(/time_zulu: 0900Z/);
  });

  it('emits each flight on its own line with structured fields', () => {
    const msg = buildTemplateMapperUserMessage(makeInput());
    expect(msg).toMatch(/flights:/);
    expect(msg).toMatch(/\[0\] callsign=ENFIELD, aircraft=FA-18C, count=4, role=cas, frequency=305.000, home_plate=Senaki/);
  });

  it('caps threats at 10 with an overflow line', () => {
    const threats = Array.from({ length: 13 }, (_, i) => ({
      type: `SA-${i}`, coalition: 'red',
    }));
    const msg = buildTemplateMapperUserMessage(makeInput({
      brief: { ...makeInput().brief, threats },
    }));
    // First 10 must appear
    expect(msg).toMatch(/\[9\] type=SA-9/);
    // 11th and beyond must NOT appear by index
    expect(msg).not.toMatch(/\[10\] type=SA-10/);
    // Overflow line must appear with the correct count
    expect(msg).toMatch(/…and 3 more/);
  });

  it('omits sections that are empty (no flights, no threats)', () => {
    const msg = buildTemplateMapperUserMessage(makeInput({
      brief: { ...makeInput().brief, flights: [], threats: [] },
    }));
    expect(msg).not.toMatch(/flights:/);
    expect(msg).not.toMatch(/threats:/);
  });

  it('truncates very long scenarios to keep prompt size bounded', () => {
    const longScenario = 'A'.repeat(600);
    const msg = buildTemplateMapperUserMessage(makeInput({
      brief: { ...makeInput().brief, scenario: longScenario },
    }));
    // 400 chars + the "scenario: " prefix; the full 600 must NOT appear
    expect(msg.indexOf('A'.repeat(401))).toBe(-1);
    expect(msg).toMatch(/scenario: A{400}/);
  });

  it('ends with the JSON return instruction', () => {
    const msg = buildTemplateMapperUserMessage(makeInput());
    expect(msg.trim().endsWith('Return the JSON object now.')).toBe(true);
  });
});
