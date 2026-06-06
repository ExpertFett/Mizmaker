/**
 * AI-assisted custom-template token mapping.
 *
 * The squadron-template flow (BriefGenTab → "Custom template" panel) scans
 * an uploaded .pptx for {{token}} placeholders, then tries to auto-resolve
 * each via resolveCustomToken() against the mission store. That handles
 * the obvious ones (mission.name, mission.theater) but loses on bespoke
 * naming (flt1_callsign, target_lat, etc.).
 *
 * This module fills the gap: send the unresolved tokens + a structured
 * brief snapshot to Claude and ask for the best-guess value for each.
 * User reviews + edits the result before render — the AI is suggestion,
 * not commitment.
 *
 * Output contract: { [token]: string }. The model is told that any token
 * it can't confidently map should map to the empty string — never invent.
 */

import { callAi, type AiContentBlock } from './aiClient';
import type { AiProvider } from './aiStore';

// ---------------------------------------------------------------------------
// Input snapshot
// ---------------------------------------------------------------------------

export interface MapperFlight {
  callsign: string;
  aircraft: string;
  count: number;
  role: string;
  frequency?: string;
  tacan?: string;
  home_plate?: string;
}

export interface MapperThreat {
  name?: string;
  type: string;
  coalition: string;
  range_km?: number;
  location?: string;
}

export interface TemplateMapperInput {
  /** Tokens we couldn't auto-resolve. The caller can still pass already-
   *  resolved tokens too if it wants the AI to second-guess them, but the
   *  default usage is "fill the blanks". */
  unresolvedTokens: string[];
  /** Brief snapshot the model can pull values from. We pass it as a flat
   *  object rather than the whole missionStore so the prompt stays tight. */
  brief: {
    mission_name?: string;
    theater?: string;
    date?: string;
    time_zulu?: string;
    coalition?: string;
    scenario?: string;
    commanders_intent?: string;
    threats: MapperThreat[];
    flights: MapperFlight[];
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are filling in {{token}} placeholders in a squadron mission-brief template. You are given a list of TOKENS and a structured BRIEF snapshot. For each token, return the best plain-text value from the brief.

GROUNDING RULES:
- Use ONLY values from the brief snapshot. Never invent callsigns, coordinates, frequencies, dates, or geographic features.
- Tokens are squadron-bespoke names. Examples to expect:
    mission_name, mission.title          → brief.mission_name
    theater, theatre, location           → brief.theater
    date, mission_date                   → brief.date
    time, ztime, push_time               → brief.time_zulu
    flt1_callsign, flight_1.callsign     → brief.flights[0].callsign
    flt1_aircraft, lead_type             → brief.flights[0].aircraft
    flt1_role                             → brief.flights[0].role
    flt1_freq                             → brief.flights[0].frequency
    flt1_home, flt1_homeplate            → brief.flights[0].home_plate
    threat1, primary_threat              → brief.threats[0].name or .type
    scenario                              → brief.scenario
    intent                                → brief.commanders_intent
- Plain text only. No quotes around the value, no markdown, no leading "value:".
- If you can't confidently map a token to a brief value, return the empty string for it. Better blank than wrong.

Return ONLY a valid JSON object: {"token_name": "string value", ...}. Include every token from the input list, even if the value is "". No commentary, no markdown fences.`;

/** Build the user-content text. Exported for unit testing. */
export function buildTemplateMapperUserMessage(input: TemplateMapperInput): string {
  const lines: string[] = [];
  lines.push('TOKENS TO MAP:');
  for (const t of input.unresolvedTokens) {
    lines.push(`  - ${t}`);
  }
  lines.push('');
  lines.push('BRIEF SNAPSHOT:');
  const b = input.brief;
  if (b.mission_name) lines.push(`  mission_name: ${b.mission_name}`);
  if (b.theater) lines.push(`  theater: ${b.theater}`);
  if (b.date) lines.push(`  date: ${b.date}`);
  if (b.time_zulu) lines.push(`  time_zulu: ${b.time_zulu}`);
  if (b.coalition) lines.push(`  coalition: ${b.coalition}`);
  if (b.scenario) lines.push(`  scenario: ${b.scenario.slice(0, 400)}`);
  if (b.commanders_intent) lines.push(`  commanders_intent: ${b.commanders_intent.slice(0, 400)}`);
  if (b.flights.length > 0) {
    lines.push('  flights:');
    for (let i = 0; i < b.flights.length; i++) {
      const f = b.flights[i];
      const parts: string[] = [];
      parts.push(`callsign=${f.callsign || '?'}`);
      parts.push(`aircraft=${f.aircraft || '?'}`);
      parts.push(`count=${f.count}`);
      if (f.role) parts.push(`role=${f.role}`);
      if (f.frequency) parts.push(`frequency=${f.frequency}`);
      if (f.tacan) parts.push(`tacan=${f.tacan}`);
      if (f.home_plate) parts.push(`home_plate=${f.home_plate}`);
      lines.push(`    [${i}] ${parts.join(', ')}`);
    }
  }
  if (b.threats.length > 0) {
    lines.push('  threats:');
    for (let i = 0; i < Math.min(b.threats.length, 10); i++) {
      const t = b.threats[i];
      const parts: string[] = [];
      if (t.name) parts.push(`name=${t.name}`);
      parts.push(`type=${t.type}`);
      parts.push(`coalition=${t.coalition}`);
      if (t.range_km) parts.push(`range_km=${t.range_km}`);
      if (t.location) parts.push(`location=${t.location}`);
      lines.push(`    [${i}] ${parts.join(', ')}`);
    }
    if (b.threats.length > 10) {
      lines.push(`    …and ${b.threats.length - 10} more`);
    }
  }
  lines.push('');
  lines.push('Return the JSON object now.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TemplateMapperResult {
  /** Mapping the user reviews. May contain empty strings for tokens the
   *  AI declined to map (better than a wrong guess). */
  mapping: Record<string, string>;
  /** Token count: how many tokens the AI actually filled in (non-empty)
   *  vs how many it left blank. Surfaced in the toast. */
  filled: number;
  blank: number;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

function extractJson(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '');
  }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    t = t.slice(first, last + 1);
  }
  return t.trim();
}

export async function generateTemplateMapping(
  provider: AiProvider,
  apiKey: string,
  model: string,
  input: TemplateMapperInput,
): Promise<TemplateMapperResult> {
  if (!apiKey) {
    throw new Error('No AI key configured. Open AI Settings to add one.');
  }
  if (input.unresolvedTokens.length === 0) {
    throw new Error('No tokens to map. Upload a template first.');
  }

  const userText = buildTemplateMapperUserMessage(input);
  const content: AiContentBlock[] = [{ type: 'text', text: userText }];

  const result = await callAi({
    provider,
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    content,
    // Up to ~50 tokens for a typical squadron template; allow headroom.
    maxTokens: 2000,
    jsonMode: true,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJson(result.text));
  } catch {
    throw new Error('AI returned malformed JSON. Try again or switch model.');
  }

  // Defensive: only accept tokens we actually asked about. Drop any
  // hallucinated extras. Coerce everything to string.
  const mapping: Record<string, string> = {};
  let filled = 0;
  let blank = 0;
  for (const tok of input.unresolvedTokens) {
    const raw = parsed[tok];
    const val = typeof raw === 'string' ? raw.trim() : '';
    mapping[tok] = val;
    if (val) filled++;
    else blank++;
  }

  return { mapping, filled, blank, usage: result.usage, model: result.model };
}
