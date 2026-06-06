/**
 * AI brief-presenter speaker notes.
 *
 * Takes the same structured brief inputs commandersIntent / briefWriter
 * use and asks the active AI provider for per-slide talking points —
 * 1-4 short plain-text sentences keyed by slide id (cover, theatre,
 * scenario, intent, threats, flights, comms, mission_flow, timeline,
 * notes, popup). The brief renderer stuffs them into each slide's
 * notes_text_frame so the presenter sees them in PowerPoint's notes
 * pane during the brief.
 *
 * No-AI fallback: when the user has no key configured, the BriefGenTab
 * button is disabled / hidden — the brief still renders without notes.
 *
 * Output contract: the model returns a JSON object with one string per
 * slide id. We parse it defensively (strip code fences, validate each
 * field is a string) and hand the caller a clean dict.
 */

import { callAi, type AiContentBlock } from './aiClient';
import type { AiProvider } from './aiStore';
import {
  type CommandersIntentInput,
  detectPrimaryMissionType,
} from './commandersIntent';

const SYSTEM_PROMPT = `You are an experienced flight lead helping another pilot present a mission brief. For each slide in the brief, write 1-4 short plain-prose sentences a presenter would say while that slide is up. The audience is squadron pilots (CFI-level civilians flying DCS World) — direct, operational, no bureaucratic filler.

GROUNDING RULES — same as the rest of the brief:
- Use only facts present in the structured input. Don't invent threats, callsigns, or scenarios.
- The THEATRE is just the DCS map name — never infer geopolitics or named real-world operations from it.
- Anchor to the PRIMARY MISSION TYPE; if the package is CAS, the notes talk like CAS, not maritime defence.
- Speaker notes are spoken transitions — short sentences, no bullets, no markdown, no headers.

Return ONLY a valid JSON object (no markdown fences, no commentary) with these string fields. Every value is plain text (1-4 sentences each):
{
  "cover": "What to say while introducing the brief (mission name + when + tone-setter).",
  "theatre": "What to say while the theatre overview is up (geography, where the AO is).",
  "scenario": "What to say to set the situation.",
  "intent": "How to walk pilots through Purpose / Method / End State.",
  "threats": "What to highlight on the threats slide — priority threats, where they sit.",
  "flights": "How to walk through the force composition table.",
  "comms": "What to remind on comms (priorities, who to talk to).",
  "mission_flow": "How to walk the timeline of the mission.",
  "timeline": "What to call out on the timeline (push, on-station, RTB).",
  "notes": "Pre-flight reminders on special instructions.",
  "popup": "What to say if a popup-attack slide is shown."
}

Each value must be 1-4 short sentences. If you have nothing useful to say for a given slide, return an empty string for that key — never invent content to fill it.`;

export interface SpeakerNotes {
  cover: string;
  theatre: string;
  scenario: string;
  intent: string;
  threats: string;
  flights: string;
  comms: string;
  mission_flow: string;
  timeline: string;
  notes: string;
  popup: string;
}

export interface SpeakerNotesResult {
  notes: SpeakerNotes;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

/** Build the user-content text from structured brief fields. Mirrors the
 *  briefWriter prompt builder so the model sees the same grounded context.
 *  Exported for unit testing the prompt shape. */
export function buildSpeakerNotesUserMessage(input: CommandersIntentInput): string {
  const lines: string[] = [];
  lines.push(`Mission: ${input.mission_name || 'Untitled'}`);
  if (input.theater) lines.push(`Theatre: ${input.theater} (DCS map name — setting only, not a strategic indicator)`);
  if (input.date || input.time_zulu) {
    lines.push(`When: ${[input.date, input.time_zulu].filter(Boolean).join(' ')}`);
  }

  const primary = detectPrimaryMissionType(input.flights);
  lines.push(`PRIMARY MISSION TYPE: ${primary.toUpperCase()}`);
  lines.push('');

  const story = (input.missionStory || '').trim();
  if (story) {
    lines.push('Mission story (canonical context):');
    lines.push(story);
    lines.push('');
  }
  const scenario = (input.scenario || '').trim();
  if (scenario && !scenario.startsWith('No scenario description')) {
    lines.push(story ? 'Scenario (from .miz, supplementary):' : 'Scenario:');
    lines.push(scenario);
    lines.push('');
  }

  if (input.flights.length > 0) {
    lines.push('Blue flights:');
    for (const f of input.flights) {
      const parts: string[] = [`${f.callsign || '?'} (${f.count}× ${f.aircraft || '?'})`];
      if (f.role) parts.push(`role: ${f.role}`);
      if (f.home_plate) parts.push(`base: ${f.home_plate}`);
      lines.push(`  - ${parts.join(', ')}`);
    }
    lines.push('');
  }

  const reds = input.threats.filter((t) => (t.coalition || '').toLowerCase() === 'red');
  if (reds.length > 0) {
    lines.push('Red threats:');
    for (const t of reds.slice(0, 10)) {
      lines.push(`  - ${t.name || t.type || '(unnamed)'}${t.range_km > 0 ? ` · ${t.range_km.toFixed(0)}km` : ''}`);
    }
    if (reds.length > 10) lines.push(`  - …and ${reds.length - 10} more`);
    lines.push('');
  }

  if (input.userSteer && input.userSteer.trim()) {
    lines.push('Mission-maker steer:');
    lines.push(input.userSteer.trim());
    lines.push('');
  }

  lines.push('Write the speaker notes now. Return ONLY the JSON object with the 11 string fields.');
  return lines.join('\n');
}

/** Strip code fences and pull the first {...} JSON object out of a model
 *  response, tolerating preamble some models add despite instructions. */
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

function cleanNote(v: unknown): string {
  if (typeof v !== 'string') return '';
  // Strip markdown bold + leading list markers a chatty model might add.
  return v
    .replace(/\*\*/g, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .trim();
}

const NOTE_KEYS: (keyof SpeakerNotes)[] = [
  'cover', 'theatre', 'scenario', 'intent',
  'threats', 'flights', 'comms', 'mission_flow',
  'timeline', 'notes', 'popup',
];

export async function generateSpeakerNotes(
  provider: AiProvider,
  apiKey: string,
  model: string,
  input: CommandersIntentInput,
): Promise<SpeakerNotesResult> {
  if (!apiKey) {
    throw new Error('No AI key configured. Open AI Settings to add one.');
  }

  const userText = buildSpeakerNotesUserMessage(input);
  const content: AiContentBlock[] = [{ type: 'text', text: userText }];

  const result = await callAi({
    provider,
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    content,
    // 11 short fields × ~50 tokens each = ~550 tokens. 1200 leaves headroom.
    maxTokens: 1200,
    jsonMode: true,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJson(result.text));
  } catch {
    throw new Error('AI returned malformed JSON. Try again or switch model.');
  }

  const notes = {} as SpeakerNotes;
  for (const k of NOTE_KEYS) {
    notes[k] = cleanNote(parsed[k]);
  }

  const anyContent = NOTE_KEYS.some((k) => notes[k].length > 0);
  if (!anyContent) {
    throw new Error('AI returned no speaker notes. Try again or add more to the Mission Story.');
  }

  return { notes, usage: result.usage, model: result.model };
}

/** Convert the SpeakerNotes object to the {slide_id: string} map shape
 *  the backend expects in WingBrief.speaker_notes. Empty strings are
 *  dropped so the renderer skips slides with no useful note. */
export function speakerNotesToBriefMap(notes: SpeakerNotes): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of NOTE_KEYS) {
    const v = notes[k];
    if (v && v.trim()) out[k] = v.trim();
  }
  return out;
}
