/**
 * AI airfield identifier for chart-overlay placement.
 *
 * The DM uploads an airport plate / approach chart / sector graphic, then
 * clicks "🤖 AI IDENTIFY". We hand the image (as base64) plus the list of
 * known airfields (from the mission's Olympus airbase feed) to Claude or
 * Gemini and ask it to pick the closest match — or "UNKNOWN" if there
 * isn't one.
 *
 * Why this exists: the SNAP dropdown alone makes the DM read every label
 * on a foreign chart to find the airfield by name. Vision LLMs can read
 * the chart's own labels + ICAO codes + runway numbers + lat/lon stamps
 * and pick the right field instantly. Their bill, their key (BYOK).
 *
 * Returns:
 *   - `{ match: 'EXACT_NAME' }` when the model is confident
 *   - `{ match: null, reason: 'why not' }` otherwise
 *
 * Pure data — caller decides whether to auto-snap or just pre-fill the
 * dropdown.
 */

import { callAi, type AiContentBlock } from '../../ai/aiClient';
import type { AiProvider } from '../../ai/aiStore';

export interface AirfieldCandidate {
  name: string;
  lat: number;
  lng: number;
}

export interface IdentifyResult {
  /** Name from the candidate list, or null when no confident match. */
  match: string | null;
  /** Optional reasoning the model returned. */
  reason?: string;
  /** Raw model output for debug. */
  raw?: string;
  /** Token usage (helps the DM watch their bill). */
  tokens?: { input: number; output: number };
}

/** Strip the `data:image/...;base64,` prefix so the AI SDKs accept the data. */
function splitDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return { mediaType: 'image/png', data: dataUrl };
  return { mediaType: m[1], data: m[2] };
}

const SYSTEM = `You are an aviation-chart analyst helping a DCS World Game Master pin scanned approach plates and airport diagrams onto a live tactical map.

You will receive:
  1. ONE image — could be a Jeppesen-style approach plate, an airport diagram, a kneeboard sector graphic, or a random chart screenshot.
  2. A SHORT JSON list of CANDIDATE airfield names that exist on the current DCS theatre map.

YOUR TASK:
  - Read the chart's labels: ICAO code, airfield name, city, runway numbers, lat/lon stamp, frequencies, anything that identifies the place.
  - Find the SINGLE candidate that best matches.
  - If you cannot match with high confidence (>0.7), return null.

OUTPUT — strict JSON, NO prose, NO code fence:
  {"match": "EXACT_CANDIDATE_NAME_OR_NULL", "reason": "short 1-sentence explanation"}

  - The "match" value MUST be either exactly one of the candidate names verbatim, or the JSON literal null.
  - Do NOT invent airfield names or modify the candidate strings.
  - Do NOT include any text outside the JSON object.`;

export async function identifyAirfieldFromImage(opts: {
  provider: AiProvider;
  apiKey: string;
  model: string;
  dataUrl: string;
  candidates: AirfieldCandidate[];
}): Promise<IdentifyResult> {
  if (!opts.apiKey) return { match: null, reason: 'No AI key configured.' };
  if (opts.candidates.length === 0) return { match: null, reason: 'No candidate airfields in the feed yet.' };

  const { mediaType, data } = splitDataUrl(opts.dataUrl);
  // Trim the candidate list so we don't burn input tokens on theatre fields
  // that aren't in the chart's region. 60 entries comfortably covers any
  // single DCS theatre.
  const candidateList = opts.candidates.slice(0, 60).map((c) => c.name);

  const content: AiContentBlock[] = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
    { type: 'text', text:
      `Candidate airfields on the current map (pick exactly one or null):\n` +
      JSON.stringify(candidateList) +
      `\n\nReturn ONLY the JSON object as specified.` },
  ];

  let res;
  try {
    res = await callAi({
      provider: opts.provider, apiKey: opts.apiKey, model: opts.model,
      system: SYSTEM, content, maxTokens: 200, jsonMode: true,
    });
  } catch (e) {
    return { match: null, reason: e instanceof Error ? e.message : 'AI call failed' };
  }

  // Permissive parse — strip prose / code fences if the model leaked any.
  const raw = (res.text || '').trim();
  let cleaned = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) cleaned = fence[1].trim();
  // If the model wrapped its answer in extra prose, grab the first {...} block.
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) cleaned = obj[0];

  let parsed: { match?: string | null; reason?: string } | null = null;
  try { parsed = JSON.parse(cleaned); } catch { parsed = null; }
  const tokens = { input: res.usage.input_tokens, output: res.usage.output_tokens };
  if (!parsed) return { match: null, reason: 'Could not parse AI response.', raw, tokens };

  const match = parsed.match;
  if (match === null || match === undefined) {
    return { match: null, reason: parsed.reason || 'No confident match.', raw, tokens };
  }
  // Defensive — only return a match if it's actually in the candidate list.
  const hit = candidateList.find((n) => n === match || n.toLowerCase() === String(match).toLowerCase());
  if (!hit) {
    return { match: null, reason: `Model returned "${match}" which is not in the candidate list.`, raw, tokens };
  }
  return { match: hit, reason: parsed.reason, raw, tokens };
}
