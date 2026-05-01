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
