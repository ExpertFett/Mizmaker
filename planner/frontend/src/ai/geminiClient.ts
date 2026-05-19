/**
 * Direct browser → generativelanguage.googleapis.com client for Google
 * AI Studio (Gemini) keys. No CORS / browser-access dance — Google
 * supports browser-direct calls natively.
 *
 * API surface mirrors anthropicClient.ts so the dispatcher in
 * aiClient.ts can use either interchangeably.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiTextBlock {
  type: 'text';
  text: string;
}

export interface GeminiImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export type GeminiContentBlock = GeminiTextBlock | GeminiImageBlock;

export interface GeminiCallOpts {
  apiKey: string;
  model: string;
  maxTokens?: number;
  system?: string;
  content: GeminiContentBlock[];
  /** When true, ask Gemini to return strict JSON. Greatly cleaner
   *  parsing than relying on the model to skip markdown fences. */
  jsonMode?: boolean;
}

export interface GeminiResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  stopReason: string;
}

export class GeminiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function callGemini(opts: GeminiCallOpts): Promise<GeminiResult> {
  const { apiKey, model, content, system, maxTokens = 4096, jsonMode } = opts;
  if (!apiKey) throw new GeminiError(0, 'No Gemini API key set');
  if (content.length === 0) throw new GeminiError(0, 'No content provided');

  // Translate our generic content blocks into Gemini's `parts` shape.
  const parts: Array<Record<string, unknown>> = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ text: block.text });
    } else {
      parts.push({
        inlineData: {
          mimeType: block.source.media_type,
          data: block.source.data,
        },
      });
    }
  }

  // Gemini 2.5 Flash/Pro use internal "thinking" tokens by default.
  // These DO count against maxOutputTokens but are NOT returned as
  // visible text, so a 600-token budget can produce ~20 tokens of
  // actual output. For our use cases (structured SOP extraction +
  // constrained-format prose generation) thinking adds latency and
  // cost without helping output quality. Disable it explicitly.
  // The field is ignored on pre-2.5 models, but we gate on the model
  // string anyway in case Google ever 400's on unsupported configs.
  const is25 = /^gemini-2\.5/i.test(model);
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: maxTokens,
    ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    ...(is25 ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
  };
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig,
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  // Auth: Gemini takes the API key as a query parameter, not a header.
  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new GeminiError(0, `Network error: ${(e as Error).message}`);
  }

  if (!res.ok) {
    let errBody: unknown = null;
    try { errBody = await res.json(); } catch { /* not JSON */ }
    const errMsg = (errBody as { error?: { message?: string } })?.error?.message
      || `Gemini API returned ${res.status}`;
    throw new GeminiError(res.status, errMsg, errBody);
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
    modelVersion?: string;
  };

  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((p) => p.text || '')
    .join('\n');

  return {
    text,
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount || 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
    model: data.modelVersion || model,
    stopReason: candidate?.finishReason || 'STOP',
  };
}

/** Smallest possible call — used by Settings to verify the key works. */
export async function pingGemini(apiKey: string, model: string): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string; status?: number }> {
  const start = Date.now();
  try {
    await callGemini({
      apiKey,
      model,
      maxTokens: 16,
      content: [{ type: 'text', text: 'Reply with the single word OK.' }],
    });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    if (e instanceof GeminiError) {
      return { ok: false, error: e.message, status: e.status };
    }
    return { ok: false, error: (e as Error).message };
  }
}
