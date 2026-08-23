/**
 * Direct browser → api.anthropic.com client.
 *
 * Uses the `anthropic-dangerous-direct-browser-access: true` header so
 * the user's API key stays in their browser. We never proxy through
 * Railway — that's a non-goal of BYOK.
 *
 * Surface area is intentionally small: one function (callAnthropic)
 * that takes structured content blocks and returns the model's text
 * output. Domain-specific helpers (SOP extraction, threat narrative,
 * etc.) live in their own files (sopExtractor.ts, …) and just compose
 * this primitive with their own prompts.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;   // e.g. 'image/png', 'image/jpeg'
    data: string;          // base64-encoded, NO data: prefix
  };
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

export interface AnthropicCallOpts {
  apiKey: string;
  model: string;
  /** Cap on output tokens. 4096 is plenty for SOP extraction; bump for
   *  long-form narrative tasks. */
  maxTokens?: number;
  /** System prompt — sets the model's role / constraints. */
  system?: string;
  /** User message content blocks (text, images). */
  content: AnthropicContentBlock[];
}

export interface AnthropicResult {
  /** Concatenated text from every text block in the response. */
  text: string;
  /** Token usage for billing. */
  usage: { input_tokens: number; output_tokens: number };
  /** Model that actually responded (often == requested but may differ). */
  model: string;
  /** Why generation stopped: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' */
  stopReason: string;
}

/** Throw types — callers can branch on these for nicer UX. */
export class AnthropicError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function callAnthropic(opts: AnthropicCallOpts): Promise<AnthropicResult> {
  const { apiKey, model, content, system, maxTokens = 4096 } = opts;
  if (!apiKey) throw new AnthropicError(0, 'No Anthropic API key set');
  if (content.length === 0) throw new AnthropicError(0, 'No content provided');

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }],
  };
  if (system) body.system = system;

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Required for browser-side calls. Without this header
        // Anthropic refuses cross-origin requests on the assumption
        // you've leaked your key in client-side code. We do this
        // intentionally for BYOK.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AnthropicError(0, `Network error: ${(e as Error).message}`);
  }

  if (!res.ok) {
    let errBody: unknown = null;
    try { errBody = await res.json(); } catch { /* not JSON */ }
    const errMsg = (errBody as { error?: { message?: string } })?.error?.message
      || `Anthropic API returned ${res.status}`;
    throw new AnthropicError(res.status, errMsg, errBody);
  }

  const data = await res.json() as {
    model: string;
    content: Array<{ type: string; text?: string }>;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  const text = (data.content || [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text || '')
    .join('\n');

  return {
    text,
    usage: data.usage,
    model: data.model,
    stopReason: data.stop_reason,
  };
}

// ─── Tool-use / multi-turn primitive ───────────────────────────────────────
//
// `callAnthropic` above is deliberately single-turn and text-only. The AI
// Commander (editor/live/ai/) needs the full agent loop: many turns, a `tools`
// param, and the RAW content blocks back (tool_use blocks and all).
//
// Two rules of the Messages API are baked into the types here, because getting
// either wrong is a 400 that only shows up on the second iteration:
//
//  1. Assistant content must be echoed back into history VERBATIM. Current
//     models (claude-opus-5 has thinking on by default) return `thinking`
//     blocks carrying a signature; dropping, reordering or editing them breaks
//     the next call. Hence AnthropicAnyBlock is deliberately opaque — the loop
//     can't accidentally "clean up" a block type it doesn't recognise.
//  2. Every tool_use id gets exactly one tool_result, and all results for a
//     turn ride in ONE user message. Splitting them degrades parallel tool use.
//
// We send neither `thinking` nor `temperature`: omitting both is valid on every
// current model (and `temperature` is rejected outright on opus-5 / sonnet-5).

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** A content block we pass through untouched. Opaque on purpose — see above. */
export type AnthropicAnyBlock = { type: string; [k: string]: unknown };

// These extend the opaque block so they stay assignable to it — the loop mixes
// narrowed blocks back into AnthropicAnyBlock[] history.
export interface AnthropicToolUseBlock extends AnthropicAnyBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock extends AnthropicAnyBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicAnyBlock[];
}

export interface AgentTurnOpts {
  apiKey: string;
  model: string;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicToolDef[];
  toolChoice?: { type: 'auto' | 'any' | 'none' };
  /** Caps thinking + response text TOGETHER on thinking-enabled models, so
   *  don't run this tight or replies truncate mid-sentence. */
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AgentTurnResult {
  /** Raw blocks, order preserved, nothing filtered. Echo straight back. */
  content: AnthropicAnyBlock[];
  /** 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'stop_sequence' */
  stopReason: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

/** Type guard for pulling tool calls out of a turn's content blocks. */
export function isToolUseBlock(b: AnthropicAnyBlock): b is AnthropicToolUseBlock {
  return b.type === 'tool_use'
    && typeof (b as { id?: unknown }).id === 'string'
    && typeof (b as { name?: unknown }).name === 'string';
}

/** One turn of a tool-use conversation. Same auth/headers as callAnthropic. */
export async function anthropicAgentTurn(opts: AgentTurnOpts): Promise<AgentTurnResult> {
  const { apiKey, model, messages, system, tools, toolChoice, maxTokens = 8192, signal } = opts;
  if (!apiKey) throw new AnthropicError(0, 'No Anthropic API key set');
  if (!messages.length) throw new AnthropicError(0, 'No messages provided');

  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools?.length) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new AnthropicError(0, 'Cancelled');
    throw new AnthropicError(0, `Network error: ${(e as Error).message}`);
  }

  if (!res.ok) {
    let errBody: unknown = null;
    try { errBody = await res.json(); } catch { /* not JSON */ }
    const errMsg = (errBody as { error?: { message?: string } })?.error?.message
      || `Anthropic API returned ${res.status}`;
    throw new AnthropicError(res.status, errMsg, errBody);
  }

  const data = await res.json() as {
    model: string;
    content: AnthropicAnyBlock[];
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    content: Array.isArray(data.content) ? data.content : [],
    stopReason: data.stop_reason,
    usage: data.usage || { input_tokens: 0, output_tokens: 0 },
    model: data.model,
  };
}

/** Smallest possible call — used by the Settings panel to verify the
 *  user's key works before they close the dialog. */
export async function pingAnthropic(apiKey: string, model: string): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string; status?: number }> {
  const start = Date.now();
  try {
    await callAnthropic({
      apiKey,
      model,
      maxTokens: 16,
      content: [{ type: 'text', text: 'Reply with the single word OK.' }],
    });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    if (e instanceof AnthropicError) {
      return { ok: false, error: e.message, status: e.status };
    }
    return { ok: false, error: (e as Error).message };
  }
}
