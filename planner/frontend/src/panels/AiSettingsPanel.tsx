/**
 * AI Settings — modal where the user pastes their Anthropic API key,
 * picks a model, and tests the connection.
 *
 * The key is stored in localStorage on this browser only. Anthropic
 * calls go directly browser → api.anthropic.com — no proxy.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAiStore, looksLikeAnthropicKey, AI_PRESET_MODELS } from '../ai/aiStore';
import { pingAnthropic } from '../ai/anthropicClient';

interface Props {
  open: boolean;
  onClose: () => void;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'fail'; error: string };

export function AiSettingsPanel({ open, onClose }: Props) {
  const apiKey = useAiStore((s) => s.apiKey);
  const model = useAiStore((s) => s.model);
  const setApiKey = useAiStore((s) => s.setApiKey);
  const setModel = useAiStore((s) => s.setModel);
  const clearKey = useAiStore((s) => s.clearKey);
  const recordTestResult = useAiStore((s) => s.recordTestResult);

  // Local edit state — persisted to the store on Save
  const [draftKey, setDraftKey] = useState(apiKey);
  const [draftModel, setDraftModel] = useState(model);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  // Re-sync drafts when the modal opens fresh
  useEffect(() => {
    if (open) {
      setDraftKey(apiKey);
      setDraftModel(model);
      setTest({ kind: 'idle' });
    }
  }, [open, apiKey, model]);

  const handleTest = useCallback(async () => {
    setTest({ kind: 'testing' });
    const result = await pingAnthropic(draftKey.trim(), draftModel);
    if (result.ok) {
      setTest({ kind: 'ok', latencyMs: result.latencyMs });
      recordTestResult(true);
    } else {
      setTest({
        kind: 'fail',
        error: result.error + (result.status ? ` (HTTP ${result.status})` : ''),
      });
      recordTestResult(false);
    }
  }, [draftKey, draftModel, recordTestResult]);

  const handleSave = useCallback(() => {
    setApiKey(draftKey.trim());
    setModel(draftModel);
    onClose();
  }, [draftKey, draftModel, setApiKey, setModel, onClose]);

  const handleClear = useCallback(() => {
    if (!confirm('Remove your Anthropic API key from this browser?')) return;
    clearKey();
    setDraftKey('');
    onClose();
  }, [clearKey, onClose]);

  if (!open) return null;

  const keyValid = !draftKey || looksLikeAnthropicKey(draftKey);

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
          width: 560,
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

        <div style={{
          fontSize: 12, color: '#aaaaaa', lineHeight: 1.5,
          marginBottom: 16, padding: '10px 12px',
          background: 'rgba(74, 143, 212, 0.06)',
          border: '1px solid rgba(74, 143, 212, 0.25)',
          borderRadius: 4,
        }}>
          <strong style={{ color: '#6ab4f0' }}>BYOK:</strong> Your key is stored on this
          browser only and is sent directly from your browser to{' '}
          <code style={{ color: '#cccccc' }}>api.anthropic.com</code>. Railway never
          sees it. Get a key at{' '}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank" rel="noopener noreferrer"
            style={{ color: '#4a8fd4' }}
          >console.anthropic.com</a>{' '}— each AI extraction costs about $0.01–0.03 on your bill.
        </div>

        {/* API key */}
        <label style={labelStyle}>
          Anthropic API key
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="sk-ant-api03-…"
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
              Doesn't look like a typical Anthropic key (should start with{' '}
              <code>sk-ant-</code>). Saving anyway is fine — this is just a sanity check.
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
            {AI_PRESET_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {!AI_PRESET_MODELS.includes(draftModel as typeof AI_PRESET_MODELS[number]) && (
              <option value={draftModel}>{draftModel} (custom)</option>
            )}
          </select>
          <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
            Sonnet is the recommended default — cheap and accurate for vision +
            structured-extraction tasks. Opus is slightly better at very dense
            kneeboards but ~5× the cost. Haiku is cheapest but may miss details.
          </div>
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
          {apiKey && (
            <button onClick={handleClear} style={{ ...btnGhost, color: '#d95050', borderColor: 'rgba(217, 80, 80, 0.4)', marginLeft: 'auto' }}>
              Remove Key
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
