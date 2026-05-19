/**
 * AI-generated Commander's Intent for the wing brief.
 *
 * Takes the structured fields the user already has in their brief editor
 * (mission name, scenario, threats, flights, comms) and asks the active
 * AI provider to write a short prose intent in the standard Purpose /
 * Method / End State structure squadron pilots actually expect.
 *
 * Output contract: returns plain text the caller drops into
 * brief.commanders_intent. No markdown fences, no preamble — the model
 * is instructed to emit only the three labelled paragraphs.
 *
 * Fallback: if the user has no AI key configured, the caller should
 * leave the existing mission-type-aware placeholder in place. This
 * module never returns a placeholder itself — it only succeeds or
 * throws so the UI can surface the failure cleanly.
 */

import { callAi, type AiContentBlock } from './aiClient';
import type { AiProvider } from './aiStore';

// ---------------------------------------------------------------------------
// Input shape — mirrors the relevant subset of WingBrief from
// services/brief_builder.py. We don't import the BriefGenTab interface
// directly to keep this module self-contained and unit-testable.
// ---------------------------------------------------------------------------

export interface CIFlight {
  callsign: string;
  aircraft: string;
  count: number;
  role: string;          // 'cas' | 'dca' | 'strike' | ... — free-form, may be ''
  frequency: string;
  tacan: string;
  home_plate: string;
}

export interface CIThreat {
  name: string;
  type: string;
  coalition: string;     // 'red' | 'blue' | 'neutral'
  range_km: number;
  location: string;
}

export interface CommandersIntentInput {
  mission_name: string;
  theater: string;
  date: string;
  time_zulu: string;
  /** The scenario paragraph the user already sees / edits — combined
   *  mission description + blue/red task from the .miz dictionary.
   *  Often sparse or empty; mission_story is the primary narrative
   *  source when the user fills that in. */
  scenario: string;
  /** Free-form mission backstory the user types into the brief editor.
   *  This is the PRIMARY narrative the AI builds the intent from —
   *  the .miz scenario is often empty or generic, but the maker
   *  always has the story in their head. Empty string = use scenario
   *  alone. */
  missionStory?: string;
  threats: CIThreat[];
  flights: CIFlight[];
  /** Optional free-form steer from the user (e.g. "emphasise SEAD
   *  flow", "make it sound urgent"). Empty string = no steer. */
  userSteer?: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a USMC / USN strike fighter mission commander writing the Commander's Intent paragraph for a squadron mission brief. The audience is squadron pilots (CFI-level civilians flying DCS World), so the tone is direct, operational, and free of bureaucratic filler — sound like a flight lead at the chalkboard, not a staff officer.

Write EXACTLY three short paragraphs, each prefixed with its label on its own line. The labels are:
  Purpose:
  Method:
  End State:

GROUNDING RULES — these prevent hallucination:
- The THEATRE field is just the DCS map (Caucasus, Kola, Marianas, etc.). It is a SETTING, not a strategic context. NEVER infer geopolitics or named operations from the theatre — no "Norwegian Sea freedom of navigation", no "Black Sea fleet defence", no "South China Sea contingency". The theatre alone tells you NOTHING about what side is doing what or why.
- The mission type comes from the PRIMARY MISSION TYPE field and the blue flight roles. If the flights say "cas", this is close air support — not maritime defence, not a strike, not DCA. Write the intent for the role you are given.
- If the mission story or scenario describes the situation, use THAT verbatim as your context. Do not contradict it. Do not "improve" it with details you invented.
- If the story AND scenario are both empty: write a generic intent for the PRIMARY MISSION TYPE that names no specific geography, no specific enemy forces, no specific objectives beyond what the role implies. Better to say "destroy the assigned target set" than to invent a target.
- Use the ACTUAL flight callsigns and aircraft types from the input. Never invent specific callsigns, ship names, unit designations, geographic features, or threat sites not in the input.

WRITING RULES:
- Purpose: one sentence (max two). The "why" — anchored to the role and the scenario/story when given, generic otherwise.
- Method: 2-4 sentences. The high-level plan. Who pushes, in what order, with what mutual support. Reference the actual flights provided. Do not list waypoints.
- End State: one to two sentences. What the AO looks like when we're done. Include force preservation ("package RTB safe") when appropriate.
- Total length: 80-160 words. Tight is better than verbose.
- Output PLAIN TEXT only. No markdown headings, no bullets, no asterisks, no code fences. Just three labelled paragraphs separated by blank lines.
- Do not add a fourth section. Do not include any preamble or sign-off.`;

/** Classify a flight's role string into a coarse mission-type bucket.
 *  Mirrors services/brief_builder.py::_detect_mission_type so the AI
 *  prompt anchors to the same vocabulary the backend uses elsewhere. */
function classifyRole(role: string): string | null {
  const r = (role || '').toLowerCase();
  if (!r) return null;
  if (r.includes('cas')) return 'cas';
  if (r.includes('anti-ship') || r.includes('antiship')) return 'antiship';
  if (r.includes('sead') || r.includes('dead')) return 'sead';
  if (r.includes('strike')) return 'strike';
  if (r.includes('cap') || r.includes('intercept') || r.includes('escort')) return 'dca';
  if (r.includes('recon') || r.includes('afac')) return 'recon';
  if (r.includes('refuel') || r.includes('tanker')) return 'tanker';
  return null;
}

/** Bucket the package's blue flights into a primary mission type so
 *  the AI can anchor its intent to a concrete role rather than the
 *  theatre name. Returns 'unknown' when no flights have a recognisable
 *  role — the prompt rules then ask the model for a generic intent. */
export function detectPrimaryMissionType(flights: CIFlight[]): string {
  const buckets: Record<string, number> = {};
  for (const f of flights) {
    const k = classifyRole(f.role);
    if (k) buckets[k] = (buckets[k] || 0) + 1;
  }
  const keys = Object.keys(buckets);
  if (keys.length === 0) return 'unknown';
  // Tanker on its own is a support package; mixed with anything else
  // it's not the primary. Exclude it when computing "mixed".
  const nonTanker = keys.filter((k) => k !== 'tanker');
  if (nonTanker.length > 1) return 'mixed';
  if (nonTanker.length === 1) return nonTanker[0];
  return 'tanker';
}

/** Build the user-content text block from structured brief fields.
 *  Exported for unit testing — the prompt builder is the part most
 *  likely to drift / break, so we want to assert against its output. */
export function buildCommandersIntentUserMessage(input: CommandersIntentInput): string {
  const lines: string[] = [];
  lines.push(`Mission: ${input.mission_name || 'Untitled'}`);
  // Theatre prefixed with "(setting only)" hint so the model treats it
  // as a map, not a strategic context. Belt-and-braces with the system
  // prompt rule — costs almost no tokens and removed the Kola →
  // Norwegian Sea / NATO maritime hallucination we saw in v0.9.62.
  if (input.theater) lines.push(`Theatre: ${input.theater} (DCS map name — setting only, not a strategic indicator)`);
  if (input.date || input.time_zulu) {
    lines.push(`When: ${[input.date, input.time_zulu].filter(Boolean).join(' ')}`);
  }

  // Primary mission type derived from the actual blue flight roles.
  // The model anchors its intent to this, not the theatre. When we
  // have no role data, we say so explicitly so the model writes
  // generic prose instead of inventing a scenario.
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
    unknown: 'UNKNOWN (no role data; write a generic intent)',
  };
  lines.push(`PRIMARY MISSION TYPE: ${primaryLabel[primary] || primary}`);
  lines.push('');

  // Mission story — the user's own narrative is the primary context.
  // When provided it gets top billing: the model treats it as the
  // canonical source. The auto-extracted scenario is a fallback.
  const story = (input.missionStory || '').trim();
  if (story) {
    lines.push('Mission story (authored by the mission maker — this is the canonical context):');
    lines.push(story);
    lines.push('');
  }

  // Scenario blurb — strip any DictKey_ leakage (already done server-side,
  // but be defensive in case the user pasted in something odd). When the
  // mission story is filled in, the scenario is secondary supplementary
  // context; when story is empty, the scenario is all we've got.
  const scenario = (input.scenario || '').trim();
  const hasUsefulScenario = scenario && !scenario.startsWith('No scenario description');
  if (hasUsefulScenario) {
    lines.push(story ? 'Scenario (from .miz, supplementary):' : 'Scenario:');
    lines.push(scenario);
    lines.push('');
  } else if (!story) {
    lines.push('Scenario: (not provided — infer from flights + threats)');
    lines.push('');
  }

  // Friendly flights — keep this compact so the model doesn't echo
  // it back as a list. One line per flight.
  if (input.flights.length > 0) {
    lines.push('Blue flights:');
    for (const f of input.flights) {
      const parts: string[] = [];
      parts.push(`${f.callsign || '?'} (${f.count}× ${f.aircraft || '?'})`);
      if (f.role) parts.push(`role: ${f.role}`);
      if (f.home_plate) parts.push(`base: ${f.home_plate}`);
      if (f.frequency) parts.push(`freq: ${f.frequency}`);
      if (f.tacan) parts.push(`tacan: ${f.tacan}`);
      lines.push(`  - ${parts.join(', ')}`);
    }
    lines.push('');
  }

  // Threats — only enumerate red coalition threats (blue ones in the
  // table are friendly AAA / IADS the brief shows for awareness; not
  // relevant to the commander's intent for a blue strike). Cap at 12
  // to keep the prompt readable when a mission has dozens of SAMs.
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
    if (reds.length > 12) {
      lines.push(`  - …and ${reds.length - 12} more`);
    }
    lines.push('');
  }

  if (input.userSteer && input.userSteer.trim()) {
    lines.push('Additional steer from the mission maker:');
    lines.push(input.userSteer.trim());
    lines.push('');
  }

  lines.push('Write the Commander\'s Intent now. Three paragraphs, labelled Purpose / Method / End State. Plain text only.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CommandersIntentResult {
  /** The model's prose output, suitable for dropping into
   *  brief.commanders_intent. Already trimmed and sanitised of any
   *  stray markdown fences the model occasionally emits. */
  text: string;
  /** Token usage — surfaced in the toast so users see what their
   *  generation cost them. */
  usage: { input_tokens: number; output_tokens: number };
  /** Model that responded (may differ from requested for fallbacks). */
  model: string;
}

/** Strip leaked markdown fences / stray formatting some models add
 *  despite explicit "plain text" instructions. */
function sanitise(text: string): string {
  let t = text.trim();
  // Strip surrounding ```...``` fences if present
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '');
  }
  // Strip leading "Commander's Intent" header — we don't need a title,
  // the card already has one.
  t = t.replace(/^\s*#+\s*Commander'?s?\s+Intent\s*[\r\n]+/i, '');
  // Some models bold the labels: "**Purpose:**". Unbold to keep plain
  // text rendering predictable in the PPTX.
  t = t.replace(/\*\*\s*(Purpose|Method|End State)\s*:\s*\*\*/gi, '$1:');
  return t.trim();
}

export async function generateCommandersIntent(
  provider: AiProvider,
  apiKey: string,
  model: string,
  input: CommandersIntentInput,
): Promise<CommandersIntentResult> {
  if (!apiKey) {
    throw new Error('No AI key configured. Open AI Settings to add one.');
  }

  const userText = buildCommandersIntentUserMessage(input);
  const content: AiContentBlock[] = [{ type: 'text', text: userText }];

  const result = await callAi({
    provider,
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    content,
    // Intent fits in ~250 tokens easily; 600 leaves headroom for a
    // chatty model without burning cost on runaway output.
    maxTokens: 600,
  });

  const cleaned = sanitise(result.text);
  if (!cleaned) {
    throw new Error('AI returned an empty response. Try again or switch model.');
  }
  return { text: cleaned, usage: result.usage, model: result.model };
}
