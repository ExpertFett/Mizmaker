/**
 * BYOK (Bring Your Own Key) AI store.
 *
 * The user pastes their Anthropic API key in the AI Settings panel; the
 * key is persisted to localStorage on this browser only and is sent
 * directly from the browser to api.anthropic.com — Railway never sees it.
 *
 * No server-side key, no proxy, no usage tracking on our side. The
 * user's bill is between them and Anthropic.
 */

import { create } from 'zustand';

const KEY_STORAGE_KEY = 'mizresearch.ai.anthropic_key.v1';
const MODEL_STORAGE_KEY = 'mizresearch.ai.model.v1';

/** Default model. Kept as a stable alias so we don't have to chase
 *  point-release version names; users can override via Settings. */
const DEFAULT_MODEL = 'claude-sonnet-4-5';

const PRESET_MODELS = [
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-haiku-4-5',
] as const;

interface AiState {
  /** Anthropic API key. Empty string when not set. */
  apiKey: string;
  /** Selected model alias. */
  model: string;
  /** Last successful test ping (epoch ms). 0 = never tested. */
  lastTestedAt: number;
  /** True if the most recent test ping succeeded. */
  lastTestOk: boolean;

  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  clearKey: () => void;
  recordTestResult: (ok: boolean) => void;
}

function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function loadModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export const useAiStore = create<AiState>((set) => ({
  apiKey: loadKey(),
  model: loadModel(),
  lastTestedAt: 0,
  lastTestOk: false,

  setApiKey: (key) => {
    try { localStorage.setItem(KEY_STORAGE_KEY, key); } catch { /* ignore */ }
    set({ apiKey: key, lastTestedAt: 0, lastTestOk: false });
  },

  setModel: (model) => {
    try { localStorage.setItem(MODEL_STORAGE_KEY, model); } catch { /* ignore */ }
    set({ model });
  },

  clearKey: () => {
    try { localStorage.removeItem(KEY_STORAGE_KEY); } catch { /* ignore */ }
    set({ apiKey: '', lastTestedAt: 0, lastTestOk: false });
  },

  recordTestResult: (ok) => set({ lastTestedAt: Date.now(), lastTestOk: ok }),
}));

export const AI_PRESET_MODELS = PRESET_MODELS;

/** Cheap heuristic to spot obviously-malformed keys before sending. */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-/.test(key.trim()) && key.trim().length > 30;
}
