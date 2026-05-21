/**
 * Tests for the full-brief prompt builder. As with commandersIntent,
 * we don't hit the live API — we lock down the prompt construction:
 * mission story is canonical, theatre is tagged "setting only", the
 * primary mission type surfaces, and red threats are filtered.
 */

import { describe, it, expect } from 'vitest';
import { buildFullBriefUserMessage } from './briefWriter';
import type { CommandersIntentInput, CIFlight } from './commandersIntent';

function flight(role: string, callsign = 'ENFIELD', count = 4): CIFlight {
  return {
    callsign, aircraft: 'FA-18C_hornet', count, role,
    frequency: '305.000', tacan: '', home_plate: 'Senaki-Kolkhi',
  };
}

function makeInput(overrides: Partial<CommandersIntentInput> = {}): CommandersIntentInput {
  return {
    mission_name: 'Operation Steel Rain',
    theater: 'Kola',
    date: '2026-05-20',
    time_zulu: '0830Z',
    scenario: '',
    missionStory: '',
    threats: [],
    flights: [flight('cas')],
    userSteer: '',
    ...overrides,
  };
}

describe('buildFullBriefUserMessage', () => {
  it('tags the theatre as setting-only and surfaces the primary mission type', () => {
    const msg = buildFullBriefUserMessage(makeInput({ theater: 'Kola', flights: [flight('cas')] }));
    expect(msg).toContain('Theatre: Kola (DCS map name — setting only');
    expect(msg).toContain('PRIMARY MISSION TYPE: CAS (close air support');
  });

  it('treats the mission story as canonical context', () => {
    const msg = buildFullBriefUserMessage(makeInput({
      missionStory: 'Friendly ground forces pinned at FOB Sentinel; we open the morning push.',
    }));
    expect(msg).toMatch(/Mission story.*canonical context/);
    expect(msg).toContain('FOB Sentinel');
  });

  it('lists blue flights with role + base', () => {
    const msg = buildFullBriefUserMessage(makeInput({
      flights: [flight('cas', 'ENFIELD'), flight('sead', 'SPRINGFIELD', 2)],
    }));
    expect(msg).toContain('ENFIELD (4× FA-18C_hornet)');
    expect(msg).toContain('SPRINGFIELD (2× FA-18C_hornet)');
    expect(msg).toContain('role: cas');
    expect(msg).toContain('role: sead');
  });

  it('only includes red threats', () => {
    const msg = buildFullBriefUserMessage(makeInput({
      threats: [
        { name: 'SA-11 Buk', type: 'SAM', coalition: 'red', range_km: 35, location: 'Kobuleti' },
        { name: 'Friendly Patriot', type: 'SAM', coalition: 'blue', range_km: 80, location: 'Batumi' },
      ],
    }));
    expect(msg).toContain('SA-11 Buk');
    expect(msg).not.toContain('Friendly Patriot');
  });

  it('asks for the four-field JSON object at the end', () => {
    const msg = buildFullBriefUserMessage(makeInput());
    expect(msg).toMatch(/Return ONLY the JSON object/);
    expect(msg).toContain('scenario, commanders_intent, mission_flow, notes');
  });

  it('falls back to inference when story and scenario are both empty', () => {
    const msg = buildFullBriefUserMessage(makeInput({ missionStory: '', scenario: '' }));
    expect(msg).toContain('Scenario: (not provided');
    expect(msg).not.toContain('Mission story');
  });
});
