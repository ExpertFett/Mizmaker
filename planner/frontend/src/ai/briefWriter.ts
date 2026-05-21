/**
 * AI full-brief writer.
 *
 * Given the mission story (plus the flights / threats / scenario the
 * planner already has), asks the active AI provider to write the whole
 * narrative section of the wing brief in one call — Scenario,
 * Commander's Intent, Mission Flow, and Special Instructions / Notes.
 *
 * What it does NOT touch: the structured tables (flights, threats,
 * comms, timeline) come straight from the .miz and must not be
 * AI-invented, and the cover/logo/theatre-overview are left as-is.
 *
 * Output contract: the model returns a JSON object with four string
 * fields. We parse it defensively (strip code fences, validate each
 * field is a string) and hand the caller a typed result. Reuses the
 * same grounding rules and mission-type detection as commandersIntent
 * so the brief stays anchored to the actual flight roles instead of
 * hallucinating from the theatre name.
 */

import { callAi, type AiContentBlock } from './aiClient';
import type { AiProvider } from './aiStore';
import {
  type CommandersIntentInput,
  detectPrimaryMissionType,
} from './commandersIntent';

const SYSTEM_PROMPT = `You are a USMC / USN strike fighter mission commander writing a squadron mission brief for DCS World pilots (CFI-level civilians). Tone: direct, operational, flight-lead-at-the-chalkboard — no bureaucratic filler.

You will be given a MISSION STORY (the planner's own narrative), the package's flights, any red threats, and a PRIMARY MISSION TYPE derived from the flight roles. Write the brief's narrative sections from that.

GROUNDING RULES — these prevent hallucination:
- The MISSION STORY is the canonical context. Build everything from it. Do not contradict it or "improve" it with invented details.
- The THEATRE is just the DCS map name (Caucasus, Kola, Marianas, etc.) — a SETTING, not a strategic context. NEVER infer geopolitics or named real-world operations from the theatre. No "Norwegian Sea freedom of navigation", no invented fleets.
- The mission type comes from PRIMARY MISSION TYPE + the flight roles. If they say CAS, this is close air support — not maritime defence, not a strike.
- Use the ACTUAL flight callsigns and aircraft types provided. Never invent callsigns, ship names, unit designations, geographic features, or threat sites not in the input.
- If the story and scenario are both empty, write a generic-but-correct brief for the PRIMARY MISSION TYPE that names no specific geography or enemy forces beyond what the role implies.

Return ONLY a valid JSON object (no markdown fences, no commentary) with EXACTLY these four string fields:
{
  "scenario": "2-4 sentences setting the situation: what's happening, who's doing what, what's at stake. Plain prose.",
  "commanders_intent": "Three short paragraphs, each label on its own line: 'Purpose:' (the why, 1-2 sentences), 'Method:' (the high-level plan referencing the actual flights, 2-4 sentences), 'End State:' (what the AO looks like when done, 1-2 sentences). Plain text, no markdown.",
  "mission_flow": "A numbered list (1., 2., 3., …) of the mission phases from ground ops through recovery — push order, on-station/action, egress, RTB. 5-8 short lines. Reference the flights where it helps.",
  "notes": "Special instructions: ROE reminders, code-words, contingency / divert calls, comms discipline, anything pilots need on the card. A few short bullet-style lines (use '- ' prefixes). Keep it tight."
}

Each field is plain text (the JSON value is a string; use \\n for line breaks). No markdown headings, no asterisks, no bold. Do not add fields beyond the four named.`;

export interface BriefSections {
  scenario: string;
  commanders_intent: string;
  mission_flow: string;
  notes: string;
}

export interface FullBriefResult {
  sections: BriefSections;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

/** Build the user-content text from the structured brief fields.
 *  Exported for unit testing. Mirrors commandersIntent's builder so the
 *  two AI features feed the model the same grounded context. */
export function buildFullBriefUserMessage(input: CommandersIntentInput): string {
  const lines: string[] = [];
  lines.push(`Mission: ${input.mission_name || 'Untitled'}`);
  if (input.theater) lines.push(`Theatre: ${input.theater} (DCS map name — setting only, not a strategic indicator)`);
  if (input.date || input.time_zulu) {
    lines.push(`When: ${[input.date, input.time_zulu].filter(Boolean).join(' ')}`);
  }

  const primary = detectPrimaryMissionType(input.flights);
  const primaryLabel: Record<string, string> = {
    cas: 'CAS (close air support to friendly ground forces)',
    sead: 'SEAD/DEAD (suppress or destroy enemy air defences)',
    strike: 'STRIKE (deliberate attack on fixed targets)',
    antiship: 'ANTI-SHIP (maritime strike on surface vessels)',
    dca: 'DCA (defensive counter-air / CAP / intercept)',
    recon: 'RECON / AFAC (reconnaissance or forward air control)',
    tanker: 'TANKER (aerial refuelling support)',
    mixed: 'MIXED PACKAGE (multiple mission types — cover each element)',
    unknown: 'UNKNOWN (no role data; write a generic brief)',
  };
  lines.push(`PRIMARY MISSION TYPE: ${primaryLabel[primary] || primary}`);
  lines.push('');

  const story = (input.missionStory || '').trim();
  if (story) {
    lines.push('Mission story (authored by the mission maker — this is the canonical context):');
    lines.push(story);
    lines.push('');
  }

  const scenario = (input.scenario || '').trim();
  const hasUsefulScenario = scenario && !scenario.startsWith('No scenario description');
  if (hasUsefulScenario) {
    lines.push(story ? 'Scenario (from .miz, supplementary):' : 'Scenario (from .miz):');
    lines.push(scenario);
    lines.push('');
  } else if (!story) {
    lines.push('Scenario: (not provided — infer from flights + threats)');
    lines.push('');
  }

  if (input.flights.length > 0) {
    lines.push('Blue flights:');
    for (const f of input.flights) {
      const parts: string[] = [`${f.callsign || '?'} (${f.count}× ${f.aircraft || '?'})`];
      if (f.role) parts.push(`role: ${f.role}`);
      if (f.home_plate) parts.push(`base: ${f.home_plate}`);
      if (f.frequency) parts.push(`freq: ${f.frequency}`);
      if (f.tacan) parts.push(`tacan: ${f.tacan}`);
      lines.push(`  - ${parts.join(', ')}`);
    }
    lines.push('');
  }

  const reds = input.threats.filter((t) => (t.coalition || '').toLowerCase() === 'red');
  if (reds.length > 0) {
    lines.push('Red threats:');
    for (const t of reds.slice(0, 12)) {
      const parts: string[] = [t.name || t.type || '(unnamed)'];
      if (t.type && t.type !== t.name) parts.push(t.type);
      if (t.range_km > 0) parts.push(`${t.range_km.toFixed(0)}km`);
      if (t.location) parts.push(t.location);
      lines.push(`  - ${parts.join(' · ')}`);
    }
    if (reds.length > 12) lines.push(`  - …and ${reds.length - 12} more`);
    lines.push('');
  }

  if (input.userSteer && input.userSteer.trim()) {
    lines.push('Additional steer from the mission maker:');
    lines.push(input.userSteer.trim());
    lines.push('');
  }

  lines.push('Write the brief now. Return ONLY the JSON object with the four string fields scenario, commanders_intent, mission_flow, notes.');
  return lines.join('\n');
}

/** Strip code fences and pull the first {...} JSON object out of a model
 *  response, tolerating the occasional preamble some models add. */
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

/** Light cleanup of a single section string — strip stray markdown
 *  bold/fences a model might sneak in despite instructions. */
function cleanSection(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\*\*\s*(Purpose|Method|End State)\s*:\s*\*\*/gi, '$1:')
    .replace(/\*\*/g, '')
    .trim();
}

export async function generateFullBrief(
  provider: AiProvider,
  apiKey: string,
  model: string,
  input: CommandersIntentInput,
): Promise<FullBriefResult> {
  if (!apiKey) {
    throw new Error('No AI key configured. Open AI Settings to add one.');
  }

  const userText = buildFullBriefUserMessage(input);
  const content: AiContentBlock[] = [{ type: 'text', text: userText }];

  const result = await callAi({
    provider,
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    content,
    // Four prose sections — give generous headroom. The brief sections
    // together run ~400-700 tokens; 1500 is comfortable.
    maxTokens: 1500,
    // Gemini honours this natively; Anthropic relies on the prompt's
    // "return ONLY JSON" instruction (callAi ignores the flag for it).
    jsonMode: true,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJson(result.text));
  } catch {
    throw new Error('AI returned malformed JSON. Try again or switch model.');
  }

  const sections: BriefSections = {
    scenario: cleanSection(parsed.scenario),
    commanders_intent: cleanSection(parsed.commanders_intent),
    mission_flow: cleanSection(parsed.mission_flow),
    notes: cleanSection(parsed.notes),
  };

  // At least the intent + scenario should come back non-empty; if the
  // model produced nothing usable, surface it rather than wiping the
  // brief with blanks.
  if (!sections.scenario && !sections.commanders_intent && !sections.mission_flow && !sections.notes) {
    throw new Error('AI returned an empty brief. Try again or add more to the Mission Story.');
  }

  return { sections, usage: result.usage, model: result.model };
}
