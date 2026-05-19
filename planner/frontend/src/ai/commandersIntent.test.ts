/**
 * Tests for the Commander's Intent prompt builder.
 *
 * We don't (and shouldn't) hit the real AI APIs from a unit test —
 * those calls cost money and aren't deterministic. Instead we lock
 * down the prompt-construction logic that's most likely to drift:
 * - scenario / threats / flights all surface in the user message
 * - red threats filter correctly; long lists get capped
 * - empty scenario gets a placeholder hint, not an empty section
 * - the user steer surfaces verbatim when provided
 */

import { describe, it, expect } from 'vitest';
import {
  buildCommandersIntentUserMessage,
  detectPrimaryMissionType,
  type CommandersIntentInput,
  type CIFlight,
} from './commandersIntent';

function flight(role: string, callsign = 'TEST', count = 2): CIFlight {
  return {
    callsign, aircraft: 'FA-18C_hornet', count, role,
    frequency: '', tacan: '', home_plate: '',
  };
}

function makeInput(overrides: Partial<CommandersIntentInput> = {}): CommandersIntentInput {
  return {
    mission_name: 'Operation Steel Rain',
    theater: 'Caucasus',
    date: '2026-05-18',
    time_zulu: '0830Z',
    scenario: 'BLUE forces conduct a deliberate strike on the Kobuleti SAM ring.',
    threats: [],
    flights: [],
    userSteer: '',
    ...overrides,
  };
}

describe('buildCommandersIntentUserMessage', () => {
  it('includes mission name, theatre, and date/time at the top', () => {
    const msg = buildCommandersIntentUserMessage(makeInput());
    expect(msg).toContain('Mission: Operation Steel Rain');
    expect(msg).toContain('Theatre: Caucasus');
    expect(msg).toContain('When: 2026-05-18 0830Z');
  });

  it('marks the theatre as "setting only, not a strategic indicator"', () => {
    // Regression: v0.9.62 produced Norwegian Sea / NATO maritime nonsense
    // on Kola CAS missions because the model treated theatre as a
    // strategic context. The "setting only" tag steers it away.
    const msg = buildCommandersIntentUserMessage(makeInput({ theater: 'Kola' }));
    expect(msg).toContain('Theatre: Kola (DCS map name — setting only');
  });

  it('quotes the scenario block when one is provided', () => {
    const msg = buildCommandersIntentUserMessage(makeInput({
      scenario: 'BLUE forces conduct a deliberate strike on the Kobuleti SAM ring.',
    }));
    expect(msg).toContain('Scenario:');
    expect(msg).toContain('Kobuleti SAM ring');
  });

  it('falls back to an inference hint when the scenario is empty', () => {
    const msg = buildCommandersIntentUserMessage(makeInput({ scenario: '' }));
    expect(msg).toContain('Scenario: (not provided');
  });

  it('falls back to inference hint for the placeholder "no scenario" string', () => {
    // The backend emits this canned string when the .miz has no
    // dictionary entries. Treat it as "no scenario" for prompt purposes.
    const msg = buildCommandersIntentUserMessage(makeInput({
      scenario: 'No scenario description in the mission file. Edit this section…',
    }));
    expect(msg).toContain('Scenario: (not provided');
    expect(msg).not.toContain('No scenario description in the mission file');
  });

  it('renders blue flights with callsign + aircraft + role', () => {
    const msg = buildCommandersIntentUserMessage(makeInput({
      flights: [
        { callsign: 'ENFIELD', aircraft: 'FA-18C_hornet', count: 4, role: 'cas',
          frequency: '305.000', tacan: '', home_plate: 'Senaki-Kolkhi' },
        { callsign: 'SPRINGFIELD', aircraft: 'F-16C_50', count: 2, role: 'sead',
          frequency: '262.000', tacan: '', home_plate: 'Senaki-Kolkhi' },
      ],
    }));
    expect(msg).toContain('Blue flights:');
    expect(msg).toContain('ENFIELD (4× FA-18C_hornet)');
    expect(msg).toContain('SPRINGFIELD (2× F-16C_50)');
    expect(msg).toContain('role: cas');
    expect(msg).toContain('role: sead');
    expect(msg).toContain('base: Senaki-Kolkhi');
  });

  it('only includes red-coalition threats in the Red threats section', () => {
    const msg = buildCommandersIntentUserMessage(makeInput({
      threats: [
        { name: 'SA-11 Buk', type: 'SAM', coalition: 'red', range_km: 35, location: 'Kobuleti' },
        { name: 'Friendly Patriot', type: 'SAM', coalition: 'blue', range_km: 80, location: 'Batumi' },
        { name: 'ZSU-23-4', type: 'AAA', coalition: 'red', range_km: 2, location: 'Convoy' },
      ],
    }));
    expect(msg).toContain('Red threats:');
    expect(msg).toContain('SA-11 Buk');
    expect(msg).toContain('ZSU-23-4');
    // Blue Patriot must NOT bleed into the red list (it's friendly).
    expect(msg).not.toContain('Friendly Patriot');
  });

  it('caps long threat lists at 12 entries with a "and N more" note', () => {
    const threats = Array.from({ length: 20 }, (_, i) => ({
      name: `SAM-${i}`, type: 'SAM', coalition: 'red',
      range_km: 30, location: 'AOR',
    }));
    const msg = buildCommandersIntentUserMessage(makeInput({ threats }));
    expect(msg).toContain('SAM-0');
    expect(msg).toContain('SAM-11');
    expect(msg).not.toContain('SAM-12');
    expect(msg).toContain('…and 8 more');
  });

  it('includes the user steer verbatim when provided', () => {
    const msg = buildCommandersIntentUserMessage(makeInput({
      userSteer: 'Stress IFF discipline; this is a training run.',
    }));
    expect(msg).toContain('Additional steer from the mission maker:');
    expect(msg).toContain('Stress IFF discipline');
  });

  it('omits the steer section entirely when steer is empty or whitespace', () => {
    const blank = buildCommandersIntentUserMessage(makeInput({ userSteer: '' }));
    const ws = buildCommandersIntentUserMessage(makeInput({ userSteer: '   \t  ' }));
    expect(blank).not.toContain('Additional steer');
    expect(ws).not.toContain('Additional steer');
  });

  it('ends with an explicit "write the intent now" instruction', () => {
    const msg = buildCommandersIntentUserMessage(makeInput());
    expect(msg).toMatch(/Write the Commander'?s Intent now/);
    expect(msg).toContain('Purpose / Method / End State');
  });

  describe('primary mission type anchor', () => {
    it('classifies a pure CAS package as cas', () => {
      expect(detectPrimaryMissionType([flight('cas'), flight('cas')])).toBe('cas');
    });

    it('recognises SEAD and DEAD as the same bucket', () => {
      expect(detectPrimaryMissionType([flight('SEAD')])).toBe('sead');
      expect(detectPrimaryMissionType([flight('DEAD')])).toBe('sead');
    });

    it('returns "mixed" for strike + SEAD packages (tanker excluded)', () => {
      expect(detectPrimaryMissionType([
        flight('strike'), flight('SEAD'), flight('Refueling'),
      ])).toBe('mixed');
    });

    it('returns "tanker" for tanker-only packages', () => {
      expect(detectPrimaryMissionType([flight('Refueling')])).toBe('tanker');
    });

    it('returns "unknown" when no flight has a recognisable role', () => {
      expect(detectPrimaryMissionType([])).toBe('unknown');
      expect(detectPrimaryMissionType([flight('')])).toBe('unknown');
      expect(detectPrimaryMissionType([flight('Nothing')])).toBe('unknown');
    });

    it('emits the PRIMARY MISSION TYPE line with the role-specific label', () => {
      const msg = buildCommandersIntentUserMessage(makeInput({
        flights: [
          { callsign: 'ENFIELD', aircraft: 'FA-18C_hornet', count: 4, role: 'cas',
            frequency: '', tacan: '', home_plate: '' },
        ],
      }));
      expect(msg).toContain('PRIMARY MISSION TYPE: CAS (close air support');
    });

    it('emits PRIMARY MISSION TYPE: UNKNOWN when no flights have roles', () => {
      const msg = buildCommandersIntentUserMessage(makeInput({ flights: [] }));
      expect(msg).toContain('PRIMARY MISSION TYPE: UNKNOWN');
    });
  });

  describe('mission story (user-authored narrative)', () => {
    it('renders the story as the canonical context when provided', () => {
      const msg = buildCommandersIntentUserMessage(makeInput({
        missionStory: 'A Russian motor-rifle brigade crossed the line overnight; ' +
          'FOB Sentinel is pinned and our package opens the morning push.',
      }));
      expect(msg).toMatch(/Mission story.*canonical context/);
      expect(msg).toContain('A Russian motor-rifle brigade');
      expect(msg).toContain('FOB Sentinel');
    });

    it('marks the .miz scenario as supplementary when story is present', () => {
      const msg = buildCommandersIntentUserMessage(makeInput({
        missionStory: 'My handwritten story.',
        scenario: 'Some auto-extracted .miz scenario.',
      }));
      // Both should appear, but the .miz scenario gets a secondary label.
      expect(msg).toContain('My handwritten story.');
      expect(msg).toContain('Scenario (from .miz, supplementary):');
      expect(msg).toContain('Some auto-extracted .miz scenario.');
    });

    it('uses scenario alone (no supplementary label) when story is empty', () => {
      const msg = buildCommandersIntentUserMessage(makeInput({
        missionStory: '',
        scenario: 'Some .miz scenario.',
      }));
      expect(msg).toContain('Scenario:');
      expect(msg).not.toContain('supplementary');
    });

    it('omits both sections and asks for inference when story AND scenario are empty', () => {
      const msg = buildCommandersIntentUserMessage(makeInput({
        missionStory: '',
        scenario: '',
      }));
      expect(msg).toContain('Scenario: (not provided');
      expect(msg).not.toContain('Mission story');
    });

    it('treats whitespace-only story as empty', () => {
      const msg = buildCommandersIntentUserMessage(makeInput({
        missionStory: '   \n\t  ',
        scenario: 'Some scenario.',
      }));
      expect(msg).not.toContain('Mission story');
      expect(msg).not.toContain('supplementary');
    });
  });
});
