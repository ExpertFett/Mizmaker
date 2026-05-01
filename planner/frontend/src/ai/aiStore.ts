/**
 * BYOK (Bring Your Own Key) AI store — multi-provider.
 *
 * Supported providers:
 *   - 'anthropic'  paid (separate from Claude.ai Pro). Sonnet / Opus / Haiku.
 *   - 'gemini'     Google AI Studio. Free tier covers SOP extraction.
 *
 * Keys are persisted per-provider so a user can have both configured
 * and flip between them via the Settings panel. All keys live in
 * localStorage on this browser only; calls go directly browser →
 * api.anthropic.com or generativelanguage.googleapis.com — Railway
 * never sees keys or content.
 */

import { create } from 'zustand';

export type AiProvider = 'anthropic' | 'gemini';

// localStorage keys. v2 = the multi-provider rewrite (v0.8.x).
const PROVIDER_STORAGE_KEY = 'mizresearch.ai.provider.v2';
const ANTHROPIC_KEY_STORAGE = 'mizresearch.ai.anthropic_key.v1';   // unchanged from v1
const GEMINI_KEY_STORAGE    = 'mizresearch.ai.gemini_key.v1';
const ANTHROPIC_MODEL_STORAGE = 'mizresearch.ai.anthropic_model.v1';
const GEMINI_MODEL_STORAGE    = 'mizresearch.ai.gemini_model.v1';
// v1 → v2 migration source key (single key + model from the pre-v0.8 era)
const LEGACY_MODEL_STORAGE  = 'mizresearch.ai.model.v1';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const DEFAULT_GEMINI_MODEL    = 'gemini-2.5-flash';

const ANTHROPIC_PRESETS = [
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-haiku-4-5',
] as const;

const GEMINI_PRESETS = [
  'gemini-2.5-flash',         // recommended free default — fast, good vision
  'gemini-2.5-pro',           // higher quality, lower free quota
  'gemini-2.0-flash',         // older free option, more stable
] as const;

interface AiState {
  /** Active provider — drives which key + model dispatch uses. */
  provider: AiProvider;
  /** Anthropic API key. Empty = not configured. */
  anthropicKey: string;
  /** Google AI Studio API key. Empty = not configured. */
  geminiKey: string;
  /** Selected Anthropic model. */
  anthropicModel: string;
  /** Selected Gemini model. */
  geminiModel: string;

  /** Last successful test ping (epoch ms) per provider. 0 = never tested. */
  lastTestedAt: Record<AiProvider, number>;
  /** True if the most recent test ping for this provider succeeded. */
  lastTestOk: Record<AiProvider, boolean>;

  setProvider: (p: AiProvider) => void;
  setKey: (provider: AiProvider, key: string) => void;
  setModel: (provider: AiProvider, model: string) => void;
  clearKey: (provider: AiProvider) => void;
  recordTestResult: (provider: AiProvider, ok: boolean) => void;
}

function loadString(key: string, fallback = ''): string {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function loadProvider(): AiProvider {
  const v = loadString(PROVIDER_STORAGE_KEY);
  if (v === 'anthropic' || v === 'gemini') return v;
  // First-time choice: if there's a legacy anthropic key, default to
  // anthropic for backward compat. Otherwise gemini (free tier).
  return loadString(ANTHROPIC_KEY_STORAGE) ? 'anthropic' : 'gemini';
}

function loadAnthropicModel(): string {
  return loadString(ANTHROPIC_MODEL_STORAGE)
    || loadString(LEGACY_MODEL_STORAGE)         // migrate v1 single-model field
    || DEFAULT_ANTHROPIC_MODEL;
}

function loadGeminiModel(): string {
  return loadString(GEMINI_MODEL_STORAGE) || DEFAULT_GEMINI_MODEL;
}

export const useAiStore = create<AiState>((set) => ({
  provider: loadProvider(),
  anthropicKey: loadString(ANTHROPIC_KEY_STORAGE),
  geminiKey: loadString(GEMINI_KEY_STORAGE),
  anthropicModel: loadAnthropicModel(),
  geminiModel: loadGeminiModel(),
  lastTestedAt: { anthropic: 0, gemini: 0 },
  lastTestOk: { anthropic: false, gemini: false },

  setProvider: (p) => {
    try { localStorage.setItem(PROVIDER_STORAGE_KEY, p); } catch { /* ignore */ }
    set({ provider: p });
  },

  setKey: (provider, key) => {
    const storeKey = provider === 'anthropic' ? ANTHROPIC_KEY_STORAGE : GEMINI_KEY_STORAGE;
    try { localStorage.setItem(storeKey, key); } catch { /* ignore */ }
    set((s) => ({
      ...(provider === 'anthropic' ? { anthropicKey: key } : { geminiKey: key }),
      lastTestedAt: { ...s.lastTestedAt, [provider]: 0 },
      lastTestOk: { ...s.lastTestOk, [provider]: false },
    }));
  },

  setModel: (provider, model) => {
    const storeKey = provider === 'anthropic' ? ANTHROPIC_MODEL_STORAGE : GEMINI_MODEL_STORAGE;
    try { localStorage.setItem(storeKey, model); } catch { /* ignore */ }
    set(provider === 'anthropic' ? { anthropicModel: model } : { geminiModel: model });
  },

  clearKey: (provider) => {
    const storeKey = provider === 'anthropic' ? ANTHROPIC_KEY_STORAGE : GEMINI_KEY_STORAGE;
    try { localStorage.removeItem(storeKey); } catch { /* ignore */ }
    set((s) => ({
      ...(provider === 'anthropic' ? { anthropicKey: '' } : { geminiKey: '' }),
      lastTestedAt: { ...s.lastTestedAt, [provider]: 0 },
      lastTestOk: { ...s.lastTestOk, [provider]: false },
    }));
  },

  recordTestResult: (provider, ok) => set((s) => ({
    lastTestedAt: { ...s.lastTestedAt, [provider]: Date.now() },
    lastTestOk: { ...s.lastTestOk, [provider]: ok },
  })),
}));

export const ANTHROPIC_PRESET_MODELS = ANTHROPIC_PRESETS;
export const GEMINI_PRESET_MODELS = GEMINI_PRESETS;

/** Cheap heuristic to spot obviously-malformed Anthropic keys. */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-/.test(key.trim()) && key.trim().length > 30;
}

/** Google AI Studio keys typically start with 'AIza' — quick sanity check. */
export function looksLikeGeminiKey(key: string): boolean {
  return /^AIza[\w-]{20,}$/.test(key.trim());
}

/** Convenience selector: returns whichever (key, model) pair matches
 *  the active provider, plus the active provider id for dispatch. */
export function getActiveAiCreds(state: Pick<AiState, 'provider' | 'anthropicKey' | 'geminiKey' | 'anthropicModel' | 'geminiModel'>): { provider: AiProvider; key: string; model: string } {
  if (state.provider === 'anthropic') {
    return { provider: 'anthropic', key: state.anthropicKey, model: state.anthropicModel };
  }
  return { provider: 'gemini', key: state.geminiKey, model: state.geminiModel };
}
