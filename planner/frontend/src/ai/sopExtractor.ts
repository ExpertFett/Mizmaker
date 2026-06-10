/**
 * Vision-based SOP extraction.
 *
 * Send Claude one or more SOP images + a structured-extraction prompt;
 * get back a partial SOP object that the planner can merge into the
 * user's draft. Empty / unknown fields come back as null so the merge
 * never overwrites a value the user has already typed in.
 */

import { callAi, type AiContentBlock } from './aiClient';
import type { AiProvider } from './aiStore';
import type { SOP, SopAttachment, CommPlan, CommNet, RadioButtonMap } from '../sop/types';
import { makeId } from '../sop/types';

const SYSTEM_PROMPT = `You are a tactical aviation reference reader. The user will give you images of a squadron's Standard Operating Procedures (SOP) — typically callsign tables, frequency cards, TACAN charts, kneeboard reference pages, and RADIO PRESET CARDS.

Extract the structured data into JSON matching the schema below. Rules:
- Read every visible field carefully; do not invent values that aren't on the page.
- For any field you cannot confidently read, return null (not a guess).
- Frequencies are in MHz (e.g. 271.500). If you see kHz convert; if MHz add a decimal.
- TACAN channels are integers 1-126 with band X or Y.
- Modulation is "AM" or "FM". If unstated, infer from frequency band: <136 MHz = FM, >225 MHz = AM, otherwise null.
- Return ONLY valid JSON, no markdown fences, no commentary, no preamble.

RADIO PRESET CARDS (important — this is the comm plan):
A radio-preset card has a title like "HORNET RADIO PRESETS" or "TOMCAT RADIO PRESETS" and one or more columns, each a list of: Button# | Frequency Mod | ID/Name. Two side-by-side button/freq/ID groups = two radios (e.g. "Radio 1" + "Radio 2", or "Rear" + "Front"). When you see one, fill "commPlan":
- "aircraftTitle": the airframe word from the card title ("Hornet", "Tomcat", "Viper", …) — used to map to the DCS type.
- For EACH radio column, one entry in "radioMaps" with its label and a "buttons" object mapping preset number → the ID/Name text in that row.
- Put EVERY distinct ID/Name + its frequency into "nets" ONCE (dedupe across columns — "App. A CVN" appears on both radios but is ONE net). Use the exact ID text as the net name. A MIDS/datalink entry (no MHz freq, has a channel) → kind "midsA"/"midsB" with midsChannel; everything else → kind "radio" with frequency+modulation.
- Button numbers can exceed 20 (e.g. a Tomcat radio with 24). Read ALL of them.

CRITICAL output-length rules — these prevent JSON truncation:
- "notes" is OPTIONAL and OFTEN BEST OMITTED. If you include it, ≤120 characters MAX. ONE short sentence identifying the SOP. NEVER dump tables, lists, or any structured data into notes — that's what the array fields are for. If the only thing you'd put there is a list, OMIT the field entirely.
- If the page has per-unit laser codes (e.g. Victory 1-4: 1661-1664, Wraith 1-4: 1665-1668, etc.) — pick the LOWEST single code visible as "laserCodeBase" (an integer, e.g. 1661) and STOP. DO NOT enumerate per-unit codes anywhere in the response. The planner derives per-flight codes from the base.
- For each array (flights, tankers, comms, tacans, supportAssets): include only the entries that fit the schema. Skip narrative blurbs. Skip "see notes" placeholders.
- Do not invent fields. No "laser_codes" object, no "frequencyTable", no "additionalNotes", no "remarks" — ONLY the fields named in the schema below.
- Each callsign / role string ≤32 chars. Each freq is a single number, not a range.

JSON schema (all top-level fields optional; omit any you can't fill):
{
  "name": string,                  // SOP title if visible (≤80 chars)
  "squadron": string,              // squadron designator (≤40 chars)
  "notes": string,                 // ≤200 chars — short identification only
  "flights": [                     // player flight callsigns
    { "callsign": string, "defaultFreq": number | null, "defaultMod": "AM" | "FM" | null }
  ],
  "tankers": [
    { "callsign": string, "frequency": number | null, "modulation": "AM" | "FM" | null,
      "tacanChannel": number | null, "tacanBand": "X" | "Y" | null,
      "tacanCallsign": string | null }
  ],
  "supportAssets": [
    { "callsign": string, "role": string | null, "frequency": number | null, "modulation": "AM" | "FM" | null }
  ],
  "comms": [
    { "role": string, "frequency": number, "modulation": "AM" | "FM" | null, "notes": string | null }
  ],
  "tacans": [
    { "role": string, "channel": number, "band": "X" | "Y", "callsign": string | null }
  ],
  "laserCodeBase": number,         // 4-digit code, each digit 1-7. Lowest code visible if multiple.
  "commPlan": {                    // ONLY when a radio-preset card is present
    "aircraftTitle": string,       // airframe word from the card title
    "nets": [
      { "name": string, "kind": "radio" | "midsA" | "midsB",
        "frequency": number | null, "modulation": "AM" | "FM" | null,
        "midsChannel": number | null }
    ],
    "radioMaps": [
      { "radio": number,           // 1 = left column, 2 = right column
        "radioLabel": string,      // "Radio 1" / "Rear" / "Front" …
        "buttons": { "<presetNumber>": "<net name>" } }
    ]
  }
}`;

interface PartialCommPlan {
  aircraftTitle?: string | null;
  nets?: Array<{ name: string; kind?: 'radio' | 'midsA' | 'midsB' | null; frequency?: number | null; modulation?: 'AM' | 'FM' | null; midsChannel?: number | null }>;
  radioMaps?: Array<{ radio: number; radioLabel?: string | null; buttons?: Record<string, string> }>;
}

interface PartialSop {
  name?: string | null;
  squadron?: string | null;
  notes?: string | null;
  flights?: Array<{ callsign: string; defaultFreq?: number | null; defaultMod?: 'AM' | 'FM' | null }>;
  tankers?: Array<{ callsign: string; frequency?: number | null; modulation?: 'AM' | 'FM' | null; tacanChannel?: number | null; tacanBand?: 'X' | 'Y' | null; tacanCallsign?: string | null }>;
  supportAssets?: Array<{ callsign: string; role?: string | null; frequency?: number | null; modulation?: 'AM' | 'FM' | null }>;
  comms?: Array<{ role: string; frequency: number; modulation?: 'AM' | 'FM' | null; notes?: string | null }>;
  tacans?: Array<{ role: string; channel: number; band: 'X' | 'Y'; callsign?: string | null }>;
  laserCodeBase?: number | null;
  commPlan?: PartialCommPlan | null;
}

/** Map a radio-preset card's airframe title word → DCS unit type, so the
 *  imported button maps line up with the airframes that appear in a
 *  mission. Falls back to the raw title (the Comm Plan editor accepts a
 *  free-text aircraft anyway). */
const AIRFRAME_FROM_TITLE: Record<string, string> = {
  hornet: 'FA-18C_hornet',
  tomcat: 'F-14B',
  viper: 'F-16C_50',
  warthog: 'A-10C_2',
  hawg: 'A-10C_2',
  harrier: 'AV8BNA',
  'strike eagle': 'F-15ESE',
  eagle: 'F-15ESE',
  apache: 'AH-64D_BLK_II',
};

function resolveAircraftType(title: string | null | undefined): string {
  const t = (title || '').trim().toLowerCase();
  if (!t) return '';
  // Exact word match first, then substring (titles like "HORNET RADIO PRESETS").
  if (AIRFRAME_FROM_TITLE[t]) return AIRFRAME_FROM_TITLE[t];
  for (const [word, type] of Object.entries(AIRFRAME_FROM_TITLE)) {
    if (t.includes(word)) return type;
  }
  return title!.trim();
}

export interface ExtractionResult {
  partial: PartialSop;
  raw: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** Call the active AI provider with the SOP images and parse the
 *  response into a partial SOP. Throws if the API call fails or the
 *  response isn't parseable JSON. */
export async function extractSopFromImages(
  provider: AiProvider,
  apiKey: string,
  model: string,
  attachments: SopAttachment[],
): Promise<ExtractionResult> {
  if (attachments.length === 0) throw new Error('No images to extract from');

  // Vision quota: both providers handle ~12 images comfortably.
  // Capping protects against context-window blowups on big OZPs.
  const limited = attachments.slice(0, 12);

  const content: AiContentBlock[] = [];
  for (const att of limited) {
    if (!att.mimeType.startsWith('image/')) continue;  // skip PDFs etc.
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: att.mimeType, data: att.dataBase64 },
    });
  }
  if (content.length === 0) throw new Error('No image-format attachments to extract from');

  content.push({
    type: 'text',
    text: limited.length === 1
      ? 'Extract the SOP data from this image.'
      : `Extract and merge the SOP data from these ${limited.length} images. They belong to the same squadron SOP — combine entries (don't duplicate the same callsign across multiple images).`,
  });

  // Initial attempt at 16K output tokens. Both Gemini 2.5 Flash and
  // Claude Sonnet support up to 64K output, so we have plenty of
  // headroom — but starting moderate keeps the typical-case fast.
  // If the model truncates, we auto-retry once at 2x.
  let result = await callAi({
    provider,
    apiKey,
    model,
    maxTokens: 16384,
    system: SYSTEM_PROMPT,
    content,
    jsonMode: provider === 'gemini',
  });

  const isTruncated = (r: typeof result) =>
    r.stopReason === 'MAX_TOKENS'
    || r.stopReason === 'max_tokens'
    || r.stopReason === 'length';

  if (isTruncated(result)) {
    // One auto-retry at the absolute upper bound. Both providers
    // accept up to 65535 even if their effective ceilings are lower.
    result = await callAi({
      provider,
      apiKey,
      model,
      maxTokens: 32768,
      system: SYSTEM_PROMPT,
      content,
      jsonMode: provider === 'gemini',
    });
  }

  if (isTruncated(result)) {
    throw new Error(
      `Output was truncated even at 32K tokens (model wrote ${result.usage.output_tokens} output tokens). ` +
      `The image set is too dense for one extraction. Try: ` +
      `(1) split the SOP into fewer images per call (3-4 max), ` +
      `(2) switch to gemini-2.5-pro (better at concise output), or ` +
      `(3) extract from one image at a time and let the merger combine them.`,
    );
  }

  // Parse — strip any accidental markdown fences just in case
  let jsonText = result.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  let parsed: PartialSop;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    // Last-resort recovery: try chopping at the last balanced brace.
    // Some providers slip past the truncation check by claiming
    // 'STOP' but still cutting mid-string when their internal token
    // accounting is off. We can salvage everything up to the last
    // complete top-level field.
    const recovered = tryRecoverPartialJson(jsonText);
    if (recovered) {
      return { partial: recovered, raw: result.text, usage: result.usage };
    }
    throw new Error(
      `Model returned non-JSON response (${(e as Error).message}). First 200 chars: ${jsonText.slice(0, 200)}`,
    );
  }

  return { partial: parsed, raw: result.text, usage: result.usage };
}

/** Best-effort recovery from a JSON response that was truncated
 *  mid-string. Walk backward from the end finding the last position
 *  where the JSON is structurally balanced after closing braces, then
 *  parse that prefix. Returns null if no salvage point is reachable. */
function tryRecoverPartialJson(s: string): PartialSop | null {
  // Strip any trailing partial object fragments like:
  //   ... "notes": "incomplete strin
  // by walking back to the last "}," or "],"
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] !== ',' && s[i] !== '}' && s[i] !== ']') continue;
    // Try parsing a synthesized prefix: prefix up to here + closing brace
    const prefix = s.slice(0, i).replace(/[,\s]+$/, '');
    for (const closer of ['}', ']}']) {
      try {
        const candidate = `${prefix}${closer}`;
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') return parsed as PartialSop;
      } catch {
        /* try the next position */
      }
    }
  }
  return null;
}

/** Merge a partial extraction into an existing SOP. The user's already-
 *  typed values WIN — extraction only fills empty fields and appends
 *  array entries that aren't already present (matched by callsign /
 *  role).
 */
export function mergePartialIntoSop(sop: SOP, partial: PartialSop): SOP {
  const next: SOP = { ...sop, updatedAt: Date.now() };

  if (!next.name && partial.name) next.name = partial.name;
  if (!next.squadron && partial.squadron) next.squadron = partial.squadron;
  if (!next.notes && partial.notes) next.notes = partial.notes;
  if (next.laserCodeBase == null && partial.laserCodeBase != null) {
    next.laserCodeBase = partial.laserCodeBase;
  }

  // Merge arrays — dedupe by primary key. Existing entries win.
  next.flights = mergeBy(
    next.flights,
    (partial.flights || []).map((f) => ({
      callsign: f.callsign || '',
      defaultFreq: f.defaultFreq ?? undefined,
      defaultMod: f.defaultMod ?? undefined,
    })),
    (f) => (f.callsign || '').toLowerCase(),
  );

  next.tankers = mergeBy(
    next.tankers || [],
    (partial.tankers || []).map((t) => ({
      callsign: t.callsign || '',
      frequency: t.frequency ?? undefined,
      modulation: t.modulation ?? undefined,
      tacanChannel: t.tacanChannel ?? undefined,
      tacanBand: t.tacanBand ?? undefined,
      tacanCallsign: t.tacanCallsign ?? undefined,
    })),
    (t) => (t.callsign || '').toLowerCase(),
  );

  next.supportAssets = mergeBy(
    next.supportAssets || [],
    (partial.supportAssets || []).map((s) => ({
      callsign: s.callsign || '',
      role: s.role ?? undefined,
      frequency: s.frequency ?? undefined,
      modulation: s.modulation ?? undefined,
    })),
    (s) => (s.callsign || '').toLowerCase(),
  );

  next.comms = mergeBy(
    next.comms,
    (partial.comms || []).map((c) => ({
      role: c.role || '',
      frequency: c.frequency || 0,
      modulation: c.modulation ?? undefined,
      notes: c.notes ?? undefined,
    })),
    (c) => (c.role || '').toLowerCase(),
  );

  next.tacans = mergeBy(
    next.tacans,
    (partial.tacans || []).map((t) => ({
      role: t.role || '',
      channel: t.channel,
      band: t.band,
      callsign: t.callsign ?? undefined,
    })),
    (t) => (t.role || '').toLowerCase(),
  );

  // v1.19.78 — radio-preset card → comm plan. Resolve the AI's
  // button→net-NAME maps into the id-referenced model (the AI can't
  // mint stable ids). Merge philosophy matches the rest: nets dedupe
  // by name (existing wins), and a button map is added only when the
  // SOP doesn't already carry one for that (aircraft, radio) — so a
  // user-built map is never silently overwritten by a re-import.
  if (partial.commPlan) {
    next.commPlan = mergeCommPlan(next.commPlan, partial.commPlan);
  }

  return next;
}

function mergeCommPlan(existing: CommPlan | undefined, partial: PartialCommPlan): CommPlan {
  const nets: CommNet[] = existing ? [...existing.nets] : [];
  const maps: RadioButtonMap[] = existing ? [...existing.maps] : [];

  // Net id lookup by lowercased name — existing nets win, new ones append.
  const idByName = new Map<string, string>();
  for (const n of nets) idByName.set(n.name.trim().toLowerCase(), n.id);

  type PartialNet = NonNullable<PartialCommPlan['nets']>[number];
  const ensureNet = (name: string, src?: PartialNet): string => {
    const key = name.trim().toLowerCase();
    const found = idByName.get(key);
    if (found) return found;
    const id = makeId();
    const kind = src?.kind || 'radio';
    nets.push({
      id,
      name: name.trim(),
      kind,
      frequency: kind === 'radio' ? (src?.frequency ?? undefined) : undefined,
      modulation: kind === 'radio' ? (src?.modulation ?? 'AM') : undefined,
      midsChannel: kind !== 'radio' ? (src?.midsChannel ?? undefined) : undefined,
    });
    idByName.set(key, id);
    return id;
  };

  // Seed nets from the extracted catalog first so freq/mod/kind attach.
  for (const n of partial.nets || []) {
    if (!n?.name) continue;
    ensureNet(n.name, n);
  }

  const aircraft = resolveAircraftType(partial.aircraftTitle);
  for (const rm of partial.radioMaps || []) {
    if (!Number.isInteger(rm.radio)) continue;
    // Skip if the SOP already has a map for this aircraft+radio (user wins).
    if (maps.some((m) => m.aircraft === aircraft && m.radio === rm.radio)) continue;
    const buttons: Record<number, string> = {};
    for (const [pbStr, netName] of Object.entries(rm.buttons || {})) {
      const pb = parseInt(pbStr, 10);
      if (!Number.isInteger(pb) || pb < 1 || !netName) continue;
      buttons[pb] = ensureNet(netName); // create name-only net if catalog missed it
    }
    maps.push({ aircraft, radio: rm.radio, radioLabel: rm.radioLabel || undefined, buttons });
  }

  return { nets, maps };
}

function mergeBy<T>(existing: T[], extra: T[], key: (item: T) => string): T[] {
  const seen = new Set(existing.map(key).filter(Boolean));
  const out = [...existing];
  for (const item of extra) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    out.push(item);
    seen.add(k);
  }
  return out;
}
