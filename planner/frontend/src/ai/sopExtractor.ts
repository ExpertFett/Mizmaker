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
import type { SOP, SopAttachment } from '../sop/types';

const SYSTEM_PROMPT = `You are a tactical aviation reference reader. The user will give you images of a squadron's Standard Operating Procedures (SOP) — typically callsign tables, frequency cards, TACAN charts, kneeboard reference pages.

Extract the structured data into JSON matching the schema below. Rules:
- Read every visible field carefully; do not invent values that aren't on the page.
- For any field you cannot confidently read, return null (not a guess).
- Frequencies are in MHz (e.g. 271.500). If you see kHz convert; if MHz add a decimal.
- TACAN channels are integers 1-126 with band X or Y.
- Modulation is "AM" or "FM". If unstated, infer from frequency band: <136 MHz = FM, >225 MHz = AM, otherwise null.
- Return ONLY valid JSON, no markdown fences, no commentary, no preamble.

CRITICAL output-length rules — these prevent JSON truncation:
- "notes" must be ≤200 characters. ONE short sentence identifying the SOP (squadron, era, scenario name). DO NOT dump tables or lists into notes.
- If the page has per-unit laser codes for many flights (e.g. Victory 1-4: 1661-1664, Wraith 1-4: 1665-1668), pick the LOWEST code visible as "laserCodeBase" and DO NOT enumerate the rest. The schema only stores a single base; the planner derives per-flight codes from there.
- For arrays (flights, tankers, comms, tacans, supportAssets): include only entries that are clearly meant to be programmed into the jet/mission. Skip narrative explanations.
- Do not add fields outside the schema below. No "laser_codes" object, no "frequencyTable" — only the named fields.

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
  "laserCodeBase": number          // 4-digit code, each digit 1-7. Lowest code visible if multiple.
}`;

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

  const result = await callAi({
    provider,
    apiKey,
    model,
    // 8192 covers the largest realistic SOP comfortably (typically 1-3K
    // tokens of structured JSON) without the 4096 cap chopping the
    // last array mid-string.
    maxTokens: 8192,
    system: SYSTEM_PROMPT,
    content,
    jsonMode: provider === 'gemini',
  });

  // If the provider stopped generating because it hit the token cap,
  // the JSON is almost certainly mid-string. Surface a clear error
  // rather than letting JSON.parse bury the issue in a column number.
  const truncated = result.stopReason === 'MAX_TOKENS'
    || result.stopReason === 'max_tokens'
    || result.stopReason === 'length';
  if (truncated) {
    throw new Error(
      `Output was truncated (hit ${result.usage.output_tokens}-token output cap before finishing). ` +
      `Try a higher-capacity model (gemini-2.5-pro / claude-opus) or split the SOP into smaller image batches.`,
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

  return next;
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
