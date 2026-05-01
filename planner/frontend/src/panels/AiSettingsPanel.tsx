/**
 * AI Settings — modal where the user picks a provider, pastes their
 * API key for that provider, picks a model, and tests the connection.
 *
 * Keys are stored in localStorage on this browser only and are sent
 * directly browser → provider — no proxy.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  useAiStore, looksLikeAnthropicKey, looksLikeGeminiKey,
  ANTHROPIC_PRESET_MODELS, GEMINI_PRESET_MODELS,
  type AiProvider,
} from '../ai/aiStore';
import { pingAi } from '../ai/aiClient';

interface Props {
  open: boolean;
  onClose: () => void;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'fail'; error: string };

const PROVIDER_INFO: Record<AiProvider, {
  label: string;
  short: string;
  paid: boolean;
  blurb: string;
  signupUrl: string;
  signupLabel: string;
  keyHint: string;
  validate: (k: string) => boolean;
  presets: readonly string[];
}> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    short: 'Anthropic',
    paid: true,
    blurb: 'Pay-per-token. Separate from your Claude.ai Pro subscription. ~$0.01–0.03 per SOP extraction. Sonnet recommended.',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    signupLabel: 'console.anthropic.com',
    keyHint: 'sk-ant-api03-…',
    validate: looksLikeAnthropicKey,
    presets: ANTHROPIC_PRESET_MODELS,
  },
  gemini: {
    label: 'Google Gemini (free tier)',
    short: 'Gemini',
    paid: false,
    blurb: 'Free tier covers SOP extraction comfortably (1500 requests/day on Gemini 2.5 Flash). Get a free key in 30 seconds — no credit card required.',
    signupUrl: 'https://aistudio.google.com/app/apikey',
    signupLabel: 'aistudio.google.com',
    keyHint: 'AIza…',
    validate: looksLikeGeminiKey,
    presets: GEMINI_PRESET_MODELS,
  },
};

export function AiSettingsPanel({ open, onClose }: Props) {
  const provider = useAiStore((s) => s.provider);
  const anthropicKey = useAiStore((s) => s.anthropicKey);
  const geminiKey = useAiStore((s) => s.geminiKey);
  const anthropicModel = useAiStore((s) => s.anthropicModel);
  const geminiModel = useAiStore((s) => s.geminiModel);
  const setProvider = useAiStore((s) => s.setProvider);
  const setKey = useAiStore((s) => s.setKey);
  const setModel = useAiStore((s) => s.setModel);
  const clearKey = useAiStore((s) => s.clearKey);
  const recordTestResult = useAiStore((s) => s.recordTestResult);

  // Local edit state — persisted on Save
  const [draftProvider, setDraftProvider] = useState<AiProvider>(provider);
  const [draftAnthropicKey, setDraftAnthropicKey] = useState(anthropicKey);
  const [draftGeminiKey, setDraftGeminiKey] = useState(geminiKey);
  const [draftAnthropicModel, setDraftAnthropicModel] = useState(anthropicModel);
  const [draftGeminiModel, setDraftGeminiModel] = useState(geminiModel);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    if (open) {
      setDraftProvider(provider);
      setDraftAnthropicKey(anthropicKey);
      setDraftGeminiKey(geminiKey);
      setDraftAnthropicModel(anthropicModel);
      setDraftGeminiModel(geminiModel);
      setTest({ kind: 'idle' });
      setShowKey(false);
    }
  }, [open, provider, anthropicKey, geminiKey, anthropicModel, geminiModel]);

  const info = PROVIDER_INFO[draftProvider];
  const draftKey = draftProvider === 'anthropic' ? draftAnthropicKey : draftGeminiKey;
  const draftModel = draftProvider === 'anthropic' ? draftAnthropicModel : draftGeminiModel;
  const setDraftKey = (k: string) => {
    if (draftProvider === 'anthropic') setDraftAnthropicKey(k);
    else setDraftGeminiKey(k);
  };
  const setDraftModel = (m: string) => {
    if (draftProvider === 'anthropic') setDraftAnthropicModel(m);
    else setDraftGeminiModel(m);
  };

  const handleTest = useCallback(async () => {
    setTest({ kind: 'testing' });
    const result = await pingAi(draftProvider, draftKey.trim(), draftModel);
    if (result.ok) {
      setTest({ kind: 'ok', latencyMs: result.latencyMs });
      recordTestResult(draftProvider, true);
    } else {
      setTest({
        kind: 'fail',
        error: result.error + (result.status ? ` (HTTP ${result.status})` : ''),
      });
      recordTestResult(draftProvider, false);
    }
  }, [draftProvider, draftKey, draftModel, recordTestResult]);

  const handleSave = useCallback(() => {
    setProvider(draftProvider);
    setKey('anthropic', draftAnthropicKey.trim());
    setKey('gemini', draftGeminiKey.trim());
    setModel('anthropic', draftAnthropicModel);
    setModel('gemini', draftGeminiModel);
    onClose();
  }, [draftProvider, draftAnthropicKey, draftGeminiKey, draftAnthropicModel, draftGeminiModel, setProvider, setKey, setModel, onClose]);

  const handleClear = useCallback(() => {
    if (!confirm(`Remove your ${info.short} API key from this browser?`)) return;
    clearKey(draftProvider);
    setDraftKey('');
    onClose();
  }, [info.short, draftProvider, clearKey, onClose]);

  if (!open) return null;

  const keyValid = !draftKey || info.validate(draftKey);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 580,
          maxWidth: '92vw',
          background: '#1a1a1a',
          border: '1px solid #4a4a4a',
          borderRadius: 8,
          padding: 22,
          color: '#e0e0e0',
          fontFamily: 'inherit',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>AI Settings</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: '#aaaaaa',
              fontSize: 18, cursor: 'pointer', padding: 4,
            }}
            title="Close"
          >×</button>
        </div>

        {/* Provider selector — radio-style buttons */}
        <label style={labelStyle}>
          AI Provider
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {(Object.keys(PROVIDER_INFO) as AiProvider[]).map((p) => {
              const i = PROVIDER_INFO[p];
              const active = draftProvider === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setDraftProvider(p); setTest({ kind: 'idle' }); }}
                  style={{
                    flex: 1,
                    background: active
                      ? (p === 'gemini' ? 'rgba(63, 185, 80, 0.12)' : 'rgba(163, 113, 247, 0.12)')
                      : 'transparent',
                    border: `1px solid ${active
                      ? (p === 'gemini' ? '#3fb950' : '#a371f7')
                      : '#3a3a3a'}`,
                    borderRadius: 4,
                    color: active
                      ? (p === 'gemini' ? '#3fb950' : '#c8a8ff')
                      : '#cccccc',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '10px 14px',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  {i.label}
                  <div style={{
                    marginTop: 4, fontSize: 10, fontWeight: 500,
                    color: active ? 'inherit' : '#aaaaaa',
                    letterSpacing: 0.3,
                  }}>
                    {i.paid ? 'PAID' : 'FREE TIER'}
                  </div>
                </button>
              );
            })}
          </div>
        </label>

        <div style={{
          fontSize: 12, color: '#aaaaaa', lineHeight: 1.5,
          marginBottom: 16, padding: '10px 12px',
          background: draftProvider === 'gemini'
            ? 'rgba(63, 185, 80, 0.06)'
            : 'rgba(163, 113, 247, 0.06)',
          border: `1px solid ${draftProvider === 'gemini'
            ? 'rgba(63, 185, 80, 0.25)'
            : 'rgba(163, 113, 247, 0.25)'}`,
          borderRadius: 4,
        }}>
          {info.blurb} Get a key at{' '}
          <a
            href={info.signupUrl}
            target="_blank" rel="noopener noreferrer"
            style={{ color: draftProvider === 'gemini' ? '#3fb950' : '#c8a8ff' }}
          >{info.signupLabel}</a>.
          Stored in this browser only — never sent to Railway.
        </div>

        {/* API key */}
        <label style={labelStyle}>
          {info.short} API key
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder={info.keyHint}
              autoComplete="off"
              style={{
                ...inputStyle,
                flex: 1,
                fontFamily: "'B612 Mono', monospace",
                fontSize: 12,
                borderColor: !draftKey ? '#3a3a3a' : keyValid ? '#3fb950' : '#d29922',
              }}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              style={btnGhost}
              type="button"
              title={showKey ? 'Hide key' : 'Show key'}
            >{showKey ? '🙈' : '👁'}</button>
          </div>
          {!keyValid && (
            <div style={{ fontSize: 11, color: '#d29922', marginTop: 4 }}>
              Doesn't look like a typical {info.short} key (expected{' '}
              <code>{info.keyHint}</code>). Saving anyway is fine — this is just a sanity check.
            </div>
          )}
        </label>

        {/* Model */}
        <label style={labelStyle}>
          Model
          <select
            value={draftModel}
            onChange={(e) => setDraftModel(e.target.value)}
            style={{ ...inputStyle, marginTop: 4 }}
          >
            {info.presets.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {!info.presets.includes(draftModel as typeof info.presets[number]) && (
              <option value={draftModel}>{draftModel} (custom)</option>
            )}
          </select>
        </label>

        {/* Test connection */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, marginBottom: 8 }}>
          <button
            onClick={handleTest}
            disabled={!draftKey || test.kind === 'testing'}
            style={{
              ...btnPrimary,
              opacity: !draftKey || test.kind === 'testing' ? 0.5 : 1,
              cursor: !draftKey || test.kind === 'testing' ? 'not-allowed' : 'pointer',
            }}
          >
            {test.kind === 'testing' ? 'Testing…' : 'Test Connection'}
          </button>
          {test.kind === 'ok' && (
            <span style={{ color: '#3fb950', fontSize: 13 }}>
              ✓ Connected — {test.latencyMs} ms round-trip
            </span>
          )}
          {test.kind === 'fail' && (
            <span style={{ color: '#d95050', fontSize: 13 }}>
              ✗ {test.error}
            </span>
          )}
        </div>

        {/* Footer buttons */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginTop: 20, paddingTop: 14, borderTop: '1px solid #3a3a3a',
        }}>
          <button onClick={handleSave} style={btnSave}>Save</button>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          {draftKey && (
            <button onClick={handleClear} style={{ ...btnGhost, color: '#d95050', borderColor: 'rgba(217, 80, 80, 0.4)', marginLeft: 'auto' }}>
              Remove {info.short} Key
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#cccccc',
  marginBottom: 12,
  letterSpacing: 0.3,
};

const inputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: 13,
  padding: '7px 10px',
  fontFamily: 'inherit',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  background: 'rgba(74, 143, 212, 0.12)',
  border: '1px solid #4a8fd4',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  padding: '7px 16px',
  fontFamily: 'inherit',
};

const btnSave: React.CSSProperties = {
  background: 'rgba(63, 185, 80, 0.15)',
  border: '1px solid #3fb950',
  borderRadius: 4,
  color: '#3fb950',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  padding: '7px 18px',
  fontFamily: 'inherit',
};

const btnGhost: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#cccccc',
  cursor: 'pointer',
  fontSize: 13,
  padding: '7px 14px',
  fontFamily: 'inherit',
};
