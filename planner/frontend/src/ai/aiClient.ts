/**
 * Provider-agnostic AI client. Routes to anthropicClient.ts or
 * geminiClient.ts based on the active provider in aiStore.
 *
 * Domain-specific helpers (sopExtractor, etc.) talk to this module —
 * they don't import the per-provider clients directly.
 */

import { callAnthropic, pingAnthropic } from './anthropicClient';
import { callGemini, pingGemini } from './geminiClient';
import type { AiProvider } from './aiStore';

export interface AiTextBlock { type: 'text'; text: string }
export interface AiImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}
export type AiContentBlock = AiTextBlock | AiImageBlock;

export interface AiCallOpts {
  provider: AiProvider;
  apiKey: string;
  model: string;
  system?: string;
  content: AiContentBlock[];
  maxTokens?: number;
  /** Ask the provider to return strict JSON (Gemini supports natively;
   *  Anthropic uses prompt-engineering since there's no flag). */
  jsonMode?: boolean;
}

export interface AiResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  stopReason: string;
}

export async function callAi(opts: AiCallOpts): Promise<AiResult> {
  if (opts.provider === 'gemini') {
    return callGemini({
      apiKey: opts.apiKey,
      model: opts.model,
      system: opts.system,
      content: opts.content,
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
    });
  }
  return callAnthropic({
    apiKey: opts.apiKey,
    model: opts.model,
    system: opts.system,
    content: opts.content,
    maxTokens: opts.maxTokens,
  });
}

export async function pingAi(provider: AiProvider, apiKey: string, model: string) {
  return provider === 'gemini'
    ? pingGemini(apiKey, model)
    : pingAnthropic(apiKey, model);
}
