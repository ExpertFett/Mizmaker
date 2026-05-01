/**
 * Vision-based SOP extraction.
 *
 * Send Claude one or more SOP images + a structured-extraction prompt;
 * get back a partial SOP object that the planner can merge into the
 * user's draft. Empty / unknown fields come back as null so the merge
 * never overwrites a value the user has already typed in.
 */

import { callAnthropic, type AnthropicContentBlock } from './anthropicClient';
import type { SOP, SopAttachment } from '../sop/types';

const SYSTEM_PROMPT = `You are a tactical aviation reference reader. The user will give you images of a squadron's Standard Operating Procedures (SOP) — typically callsign tables, frequency cards, TACAN charts, kneeboard reference pages.

Extract the structured data into JSON matching the schema below. Rules:
- Read every visible field carefully; do not invent values that aren't on the page.
- For any field you cannot confidently read, return null (not a guess).
- Frequencies are in MHz (e.g. 271.500). If you see kHz convert; if MHz add a decimal.
- TACAN channels are integers 1-126 with band X or Y.
- Modulation is "AM" or "FM". If unstated, infer from frequency band: <136 MHz = FM, >225 MHz = AM, otherwise null.
- Return ONLY valid JSON, no markdown fences, no commentary, no preamble.

JSON schema (all top-level fields optional; omit any you can't fill):
{
  "name": string,                  // SOP title if visible
  "squadron": string,              // squadron designator
  "notes": string,                 // any free-form notes / context shown
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
  "laserCodeBase": number          // 4-digit code, each digit 1-7
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

/** Call Anthropic with the SOP images and parse the response into a
 *  partial SOP. Throws if the API call fails or the response isn't
 *  parseable JSON. */
export async function extractSopFromImages(
  apiKey: string,
  model: string,
  attachments: SopAttachment[],
): Promise<ExtractionResult> {
  if (attachments.length === 0) throw new Error('No images to extract from');

  // Vision quota: Anthropic limits to ~20 images per request and ~5MB
  // per image after compression. SOP screenshots are well under that
  // but cap at 12 to avoid surprise context-window blowups on big
  // OZP imports.
  const limited = attachments.slice(0, 12);

  const content: AnthropicContentBlock[] = [];
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

  const result = await callAnthropic({
    apiKey,
    model,
    maxTokens: 4096,
    system: SYSTEM_PROMPT,
    content,
  });

  // Parse — strip any accidental markdown fences just in case
  let jsonText = result.text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  let parsed: PartialSop;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `Model returned non-JSON response (${(e as Error).message}). First 200 chars: ${jsonText.slice(0, 200)}`,
    );
  }

  return { partial: parsed, raw: result.text, usage: result.usage };
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
