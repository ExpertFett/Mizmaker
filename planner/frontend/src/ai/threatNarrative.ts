/**
 * AI threat-narrative generator — produces a 2-4 sentence prose summary of the
 * threat environment for the wing brief, rendered above the threats table.
 * Mirrors the commandersIntent pattern: small system prompt + a compact user
 * message built from structured brief inputs, then callAi() through the
 * BYOK provider the user has configured.
 */

import { callAi, type AiContentBlock } from './aiClient';
import { type AiProvider } from './aiStore';
import { detectPrimaryMissionType } from './commandersIntent';

export interface TNThreatRow {
  type?: string;
  range_nm?: number | string;
  tier?: string;
  coalition?: string;
}
export interface TNAirThreatRow {
  composition?: string;
  airframe_class?: string;
  weapons?: string;
  notes?: string;
}
export interface TNFlight { role?: string; aircraft?: string; count?: number; }

export interface ThreatNarrativeInput {
  mission_name?: string;
  theater?: string;
  flights: TNFlight[];
  threats: TNThreatRow[];
  air_threats: TNAirThreatRow[];
  playerCoalition?: string;
}

export interface ThreatNarrativeResult { text: string; usage: { input_tokens: number; output_tokens: number }; model: string; }

const SYSTEM_PROMPT = `You are a fast-jet flight-lead writing the THREAT paragraph of a mission brief.
Output 2 to 4 sentences of plain prose only — no bullet lists, no markdown,
no headers. Cover:
  • The dominant threat type and tier (e.g. "medium-range SAM belt", "MiG-29 CAP", "SHORAD pocket").
  • Where in the AO the threats concentrate, in plain words ("along the ingress", "around the target", "northern axis").
  • The recommended counter for THIS package's mission type (deny entry, jam,
    evade, suppress, fight through, route around).
  • Any priority air or surface threat the lead should pre-brief.
Summarise — do not enumerate every system. Stay sober and tactical, not
dramatic. If both surface and air threats are present, address both briefly.`;

export function buildThreatNarrativeUserMessage(input: ThreatNarrativeInput): string {
  const lines: string[] = [];
  if (input.mission_name) lines.push(`Mission: ${input.mission_name}`);
  if (input.theater) lines.push(`Theatre: ${input.theater} (DCS map — setting only)`);
  const primary = detectPrimaryMissionType((input.flights || []).map((f) => ({ role: f.role || '', aircraft: f.aircraft, count: f.count })) as any);
  lines.push(`PACKAGE MISSION TYPE: ${primary.toUpperCase()}`);
  lines.push('');

  const enemyCoal = input.playerCoalition === 'red' ? 'blue' : 'red';
  const surface = (input.threats || []).filter(
    (t) => !t.coalition || t.coalition === enemyCoal || t.coalition === '',
  );
  if (surface.length) {
    lines.push(`SURFACE THREATS (${surface.length}):`);
    for (const t of surface.slice(0, 20)) {
      const range = t.range_nm != null && t.range_nm !== '' ? ` · ~${t.range_nm} NM` : '';
      const tier = t.tier ? ` · ${t.tier}` : '';
      lines.push(`  • ${t.type || 'unknown'}${tier}${range}`);
    }
    if (surface.length > 20) lines.push(`  • …and ${surface.length - 20} more`);
    lines.push('');
  } else {
    lines.push('SURFACE THREATS: none catalogued.');
    lines.push('');
  }

  const air = input.air_threats || [];
  if (air.length) {
    lines.push(`AIR THREATS (${air.length}):`);
    for (const a of air.slice(0, 12)) {
      lines.push(`  • ${a.composition || a.airframe_class || 'unknown'}${a.weapons ? ` — ${a.weapons}` : ''}${a.notes ? ` (${a.notes})` : ''}`);
    }
    lines.push('');
  } else {
    lines.push('AIR THREATS: none catalogued.');
    lines.push('');
  }
  lines.push('Write the THREAT paragraph now.');
  return lines.join('\n');
}

export async function generateThreatNarrative(
  provider: AiProvider, apiKey: string, model: string, input: ThreatNarrativeInput,
): Promise<ThreatNarrativeResult> {
  if (!apiKey) throw new Error('No AI key configured. Open AI Settings to add one.');
  const userText = buildThreatNarrativeUserMessage(input);
  const content: AiContentBlock[] = [{ type: 'text', text: userText }];
  const result = await callAi({
    provider, apiKey, model,
    system: SYSTEM_PROMPT, content,
    maxTokens: 400, // 2-4 sentences fits in ~150 tokens; 400 leaves headroom.
  });
  const cleaned = (result.text || '').trim();
  if (!cleaned) throw new Error('AI returned an empty response. Try again or switch model.');
  return { text: cleaned, usage: result.usage, model: result.model };
}
