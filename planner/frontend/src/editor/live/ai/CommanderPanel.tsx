/**
 * AI Mission Commander — natural-language god-mode for the DM terminal.
 *
 * The GM speaks or types an order ("bring in a 2-ship of Flankers over Banak at
 * angels 20"); a Claude tool-use agent reads the live picture and drives the
 * Olympus commands this app already ships. BYOK, browser → Anthropic direct,
 * exactly like every other AI feature here — Railway never sees the key.
 *
 * Two safety rails matter more than anything else in this file:
 *   - mutating tool calls render as approval cards before they fire, so a
 *     misheard voice order can't delete the carrier group;
 *   - deletes and explosions confirm even with auto-execute on.
 *
 * Naming is provisional — COMMANDER_LABEL is the single string to change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { can, getUnitDatabase, sendCommand, type GroupSummary, type ServerProfile, type UnitDbEntry } from '../../../api/groups';
import { useAiStore } from '../../../ai/aiStore';
import { AiSettingsPanel } from '../../../panels/AiSettingsPanel';
import type { AnthropicAnyBlock, AnthropicMessage, AnthropicToolUseBlock } from '../../../ai/anthropicClient';
import { runCommanderTurn, type ApprovalDecision, type ToolStatus } from './commanderAgent';
import { buildCommanderSystem } from './commanderSystemPrompt';
import { alwaysConfirm, buildTools, describeToolCall, isMutating } from './commanderTools';
import { executeCommanderTool, resolveUnitIds, unitTag } from './commanderExecutors';
import {
  cancelSpeech, createRecognizer, speak, speechSupported, speechSynthesisSupported,
  type Recognizer,
} from './commanderVoice';
import type {
  CmdrAirbase, CmdrDbCategory, CmdrLatLng, CmdrUnit, CommanderEnv,
} from './commanderTypes';

export const COMMANDER_LABEL = 'AI COMMANDER';

const C = {
  bg: 'rgba(13,19,29,0.96)',
  border: '#243349',
  accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.18)',
  text: '#dce6f2',
  textDim: '#8aa0ba',
  red: '#e0554f',
  green: '#3fb950',
  amber: '#ffd24a',
};

const LS_AUTO = 'dcsopt.live.commander.autoExec';
const LS_SPEAK = 'dcsopt.live.commander.speak';
const LS_PTT = 'dcsopt.live.commander.pttKey';
/** Not Space — SRS voice already owns that, and both panels are often open. */
const DEFAULT_PTT = 'Backquote';

function loadBool(key: string, dflt: boolean): boolean {
  try { const v = localStorage.getItem(key); return v == null ? dflt : v === '1'; } catch { return dflt; }
}
function saveBool(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private mode */ }
}

type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'notice'; id: string; text: string; tone?: 'error' }
  | {
    kind: 'tool'; id: string; name: string; summary: string;
    status: 'pending' | ToolStatus;
    resultText?: string;
    protectedNames: string[];
  };

let seq = 0;
const nextId = () => `i${++seq}`;

export interface CommanderPanelProps {
  group: GroupSummary;
  profile: ServerProfile;
  /** Live snapshot from LiveMap's unit ref — read at execution time. */
  getUnits: () => CmdrUnit[];
  getAirbases: () => CmdrAirbase[];
  getBullseye: () => CmdrLatLng | null;
  onClose?: () => void;
}

export function CommanderPanel({
  group, profile, getUnits, getAirbases, getBullseye, onClose,
}: CommanderPanelProps) {
  // Individual primitive selectors — an object selector returns a fresh object
  // every render and thrashes the useCallback deps (see LiveMap.tsx:741-750).
  const aiProvider = useAiStore((s) => s.provider);
  const anthropicKey = useAiStore((s) => s.anthropicKey);
  const anthropicModel = useAiStore((s) => s.anthropicModel);

  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [aiOpen, setAiOpen] = useState(false);
  const [autoExec, setAutoExec] = useState(() => loadBool(LS_AUTO, false));
  const [speakReplies, setSpeakReplies] = useState(() => loadBool(LS_SPEAK, true));
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState('');

  const historyRef = useRef<AnthropicMessage[]>([]);
  const cancelledRef = useRef(false);
  const dbCache = useRef<Partial<Record<CmdrDbCategory, Record<string, UnitDbEntry>>>>({});
  const pendingRef = useRef(new Map<string, (d: ApprovalDecision) => void>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const caps = useMemo(() => ({
    spawn: can(group.role, 'spawn'),
    command: can(group.role, 'command'),
    delete: can(group.role, 'delete'),
    effects: can(group.role, 'effects'),
  }), [group.role]);

  const voiceOk = useMemo(() => speechSupported(), []);
  const ttsOk = useMemo(() => speechSynthesisSupported(), []);
  const pttKey = useMemo(() => {
    try { return localStorage.getItem(LS_PTT) || DEFAULT_PTT; } catch { return DEFAULT_PTT; }
  }, []);

  const push = useCallback((it: Item) => setItems((prev) => [...prev, it]), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const env: CommanderEnv = useMemo(() => ({
    getUnits, getAirbases, getBullseye, caps,
    send: (command, params) => sendCommand(group.id, profile.id, command, params)
      .then((r) => ({ ok: r.ok, error: r.error }))
      .catch((e) => ({ ok: false, error: e instanceof Error ? e.message : 'send failed' })),
    getUnitDb: async (cat) => {
      const hit = dbCache.current[cat];
      if (hit) return hit;
      const r = await getUnitDatabase(group.id, profile.id, cat);
      if (!r.ok || !r.data) throw new Error(r.error || 'database unavailable');
      dbCache.current[cat] = r.data;
      return r.data;
    },
  }), [getUnits, getAirbases, getBullseye, caps, group.id, profile.id]);

  /** Which of a call's target units are Mission-Editor protected. */
  const protectedNamesFor = useCallback((input_: Record<string, unknown>): string[] => {
    if (!Array.isArray(input_.unit_ids)) return [];
    return resolveUnitIds(input_.unit_ids, getUnits()).protectedUnits.map(unitTag);
  }, [getUnits]);

  const resolvePending = useCallback((id: string, d: ApprovalDecision) => {
    const fn = pendingRef.current.get(id);
    if (!fn) return;
    pendingRef.current.delete(id);
    fn(d);
  }, []);

  const requestApproval = useCallback((tu: AnthropicToolUseBlock): Promise<ApprovalDecision> => {
    const input_ = tu.input || {};
    const prot = protectedNamesFor(input_);
    const summary = describeToolCall(tu.name, input_, getUnits());

    const autoOk = !isMutating(tu.name)
      || (autoExec && !alwaysConfirm(tu.name, input_) && prot.length === 0);

    push({
      kind: 'tool', id: tu.id, name: tu.name, summary,
      status: autoOk ? 'running' : 'pending',
      protectedNames: prot,
    });

    if (autoOk) return Promise.resolve({ approved: true, includeProtected: false });

    return new Promise<ApprovalDecision>((resolve) => {
      pendingRef.current.set(tu.id, resolve);
    });
  }, [autoExec, getUnits, protectedNamesFor, push]);

  const send = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busyRef.current) return;
    if (!anthropicKey || aiProvider !== 'anthropic') { setAiOpen(true); return; }

    cancelSpeech();
    cancelledRef.current = false;
    setBusy(true);
    setStatus('thinking…');
    setInput('');
    push({ kind: 'user', id: nextId(), text });

    const system = buildCommanderSystem({
      bullseye: getBullseye(), airbases: getAirbases(), caps, role: group.role,
    });

    let spokenReply = '';

    const result = await runCommanderTurn({
      apiKey: anthropicKey,
      model: anthropicModel,
      system,
      tools: buildTools(caps),
      history: historyRef.current,
      userText: text,
      executeTool: (name, toolInput, includeProtected) =>
        executeCommanderTool(name, toolInput, env, { includeProtected }),
      hooks: {
        requestApproval,
        onAssistantContent: (blocks: AnthropicAnyBlock[]) => {
          const said = blocks
            .filter((b) => b.type === 'text')
            .map((b) => String((b as { text?: unknown }).text || ''))
            .join('\n')
            .trim();
          if (said) {
            spokenReply = said;
            push({ kind: 'assistant', id: nextId(), text: said });
          }
        },
        onToolStatus: (id, st, resultText) => {
          setStatus(st === 'running' ? 'executing…' : 'thinking…');
          setItems((prev) => prev.map((it) => (
            it.kind === 'tool' && it.id === id ? { ...it, status: st, resultText } : it
          )));
        },
        isCancelled: () => cancelledRef.current,
      },
    });

    historyRef.current = result.messages;
    setUsage((u) => ({ input: u.input + result.usage.input, output: u.output + result.usage.output }));
    setBusy(false);
    setStatus('');

    if (result.stopped === 'error') {
      push({ kind: 'notice', id: nextId(), text: result.error || 'Request failed.', tone: 'error' });
    } else if (result.stopped === 'iteration_cap') {
      push({ kind: 'notice', id: nextId(), text: 'Stopped after the maximum number of steps. Send a follow-up to continue.' });
    } else if (result.stopped === 'refusal') {
      push({ kind: 'notice', id: nextId(), text: 'The model declined that request.', tone: 'error' });
    } else if (result.stopped === 'max_tokens') {
      push({ kind: 'notice', id: nextId(), text: 'Reply hit the length limit — it may be cut off.' });
    } else if (result.stopped === 'cancelled') {
      push({ kind: 'notice', id: nextId(), text: 'Cancelled.' });
    } else if (speakReplies && spokenReply) {
      speak(spokenReply);
    }
  }, [
    anthropicKey, anthropicModel, aiProvider, caps, env, getAirbases, getBullseye,
    group.role, push, requestApproval, speakReplies,
  ]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    cancelSpeech();
    for (const [id, resolve] of pendingRef.current) {
      resolve({ approved: false, reason: 'cancelled' });
      pendingRef.current.delete(id);
    }
    setStatus('stopping…');
  }, []);

  // ─── Voice ───────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!voiceOk || busyRef.current || listening) return;
    cancelSpeech();   // let the GM talk over the reply
    setMicError('');
    if (!recognizerRef.current) {
      recognizerRef.current = createRecognizer({
        onInterim: (t) => setInput(t),
        onFinal: (t) => { setInput(''); void send(t); },
        onError: (m) => { setMicError(m); setListening(false); },
      });
    }
    setListening(true);
    recognizerRef.current.start();
  }, [listening, send, voiceOk]);

  const stopListening = useCallback(() => {
    if (!listening) return;
    setListening(false);
    recognizerRef.current?.stop();
  }, [listening]);

  // Global PTT hotkey, with the same don't-fire-while-typing guard the SRS
  // panel uses (SrsRadioPanel.tsx:325-334).
  useEffect(() => {
    if (!voiceOk) return;
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code !== pttKey || e.repeat || isField(e.target)) return;
      e.preventDefault();
      startListening();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== pttKey || isField(e.target)) return;
      e.preventDefault();
      stopListening();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [pttKey, startListening, stopListening, voiceOk]);

  useEffect(() => () => { recognizerRef.current?.abort(); cancelSpeech(); }, []);

  const keyMissing = !anthropicKey || aiProvider !== 'anthropic';
  const pttLabel = pttKey === 'Backquote' ? '`' : pttKey.replace(/^Key|^Digit/, '');

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: C.accentDim, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: busy ? C.amber : C.green, boxShadow: busy ? `0 0 5px ${C.amber}` : 'none' }} />
          {COMMANDER_LABEL}
        </span>
        {onClose && <span onClick={onClose} style={{ cursor: 'pointer', color: C.textDim, fontWeight: 400 }}>×</span>}
      </div>

      {keyMissing && (
        <div style={{ padding: '10px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>
          {aiProvider !== 'anthropic' && anthropicKey
            ? 'The Commander runs on Anthropic tool use. Switch your AI provider to Anthropic to use it.'
            : 'Add your Anthropic API key to use the Commander. Your key stays in this browser.'}
          <div style={{ marginTop: 7 }}>
            <button onClick={() => setAiOpen(true)}
                    style={{ background: C.accentDim, border: `1px solid ${C.accent}`, color: '#cfe6ff', padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 3, cursor: 'pointer' }}>
              OPEN AI SETTINGS
            </button>
          </div>
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, lineHeight: 1.45 }}>
        {items.length === 0 && (
          <div style={{ color: C.textDim, fontSize: 11, padding: '6px 0', lineHeight: 1.6 }}>
            Give an order in plain language — “what’s airborne?”, “bring in a 2-ship of Su-27s over Banak at angels 20”, “make that SAM weapons hold”.
            {voiceOk && <><br />Hold <b>{pttLabel}</b> (or the MIC button) to speak.</>}
          </div>
        )}

        {items.map((it) => {
          if (it.kind === 'user') {
            return (
              <div key={it.id} style={{ alignSelf: 'flex-end', maxWidth: '88%', background: C.accentDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 8px', color: C.text }}>
                {it.text}
              </div>
            );
          }
          if (it.kind === 'assistant') {
            return <div key={it.id} style={{ color: C.text, whiteSpace: 'pre-wrap' }}>{it.text}</div>;
          }
          if (it.kind === 'notice') {
            return (
              <div key={it.id} style={{ fontSize: 11, color: it.tone === 'error' ? C.red : C.textDim, fontStyle: 'italic' }}>
                {it.text}
              </div>
            );
          }

          const pending = it.status === 'pending';
          const border = pending ? C.amber
            : it.status === 'denied' ? C.red
              : it.status === 'error' ? C.red
                : it.status === 'done' ? C.green : C.border;
          return (
            <div key={it.id} style={{ border: `1px solid ${border}`, borderRadius: 6, padding: '6px 8px', background: 'rgba(0,0,0,0.25)' }}>
              <div style={{ fontSize: 10, color: C.textDim, letterSpacing: 0.5, textTransform: 'uppercase' }}>{it.name}</div>
              <div style={{ color: C.text, marginTop: 2 }}>{it.summary}</div>

              {it.protectedNames.length > 0 && pending && (
                <div style={{ marginTop: 4, fontSize: 10, color: C.amber }}>
                  ⚠ Includes {it.protectedNames.length} Mission-Editor unit(s): {it.protectedNames.join(', ')}. Approving abandons their scripted mission.
                </div>
              )}

              {pending ? (
                <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                  <button onClick={() => {
                    setItems((prev) => prev.map((x) => (x.kind === 'tool' && x.id === it.id ? { ...x, status: 'running' } : x)));
                    resolvePending(it.id, { approved: true, includeProtected: it.protectedNames.length > 0 });
                  }}
                          style={{ background: 'rgba(63,185,80,0.18)', border: `1px solid ${C.green}`, color: '#c8f2cd', padding: '3px 10px', fontSize: 11, fontWeight: 700, borderRadius: 3, cursor: 'pointer' }}>
                    APPROVE
                  </button>
                  <button onClick={() => resolvePending(it.id, { approved: false })}
                          style={{ background: 'rgba(224,85,79,0.14)', border: `1px solid ${C.red}`, color: '#f4c9c7', padding: '3px 10px', fontSize: 11, fontWeight: 700, borderRadius: 3, cursor: 'pointer' }}>
                    DENY
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 3, fontSize: 10, color: it.status === 'error' ? C.red : C.textDim, whiteSpace: 'pre-wrap' }}>
                  {it.status === 'running' ? 'running…'
                    : it.status === 'denied' ? 'denied'
                      : (it.resultText || '').split('\n').slice(0, 3).join('\n')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {micError && (
        <div style={{ padding: '4px 10px', fontSize: 10, color: C.red, borderTop: `1px solid ${C.border}` }}>{micError}</div>
      )}

      <div style={{ padding: '7px 10px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder={listening ? 'Listening…' : 'Order (Enter to send)'}
          rows={2}
          disabled={busy}
          style={{ flex: 1, resize: 'none', background: 'rgba(0,0,0,0.4)', border: `1px solid ${listening ? C.amber : C.border}`, color: C.text, padding: '5px 7px', fontSize: 12, fontFamily: 'inherit', borderRadius: 3, outline: 'none' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {voiceOk && (
            <button
              onMouseDown={startListening}
              onMouseUp={stopListening}
              onMouseLeave={() => listening && stopListening()}
              disabled={busy}
              title={`Hold to talk (or hold ${pttLabel})`}
              style={{ background: listening ? 'rgba(224,85,79,0.3)' : C.accentDim, border: `1px solid ${listening ? C.red : C.accent}`, color: '#cfe6ff', padding: '3px 9px', fontSize: 10, fontWeight: 700, letterSpacing: 1, borderRadius: 3, cursor: busy ? 'not-allowed' : 'pointer', userSelect: 'none' }}>
              {listening ? '● REC' : '🎙 MIC'}
            </button>
          )}
          <button onClick={() => (busy ? stop() : void send(input))}
                  disabled={!busy && !input.trim()}
                  style={{ background: busy ? 'rgba(224,85,79,0.2)' : C.accentDim, border: `1px solid ${busy ? C.red : C.accent}`, color: '#cfe6ff', padding: '3px 9px', fontSize: 10, fontWeight: 700, letterSpacing: 1, borderRadius: 3, cursor: 'pointer', opacity: !busy && !input.trim() ? 0.5 : 1 }}>
            {busy ? 'STOP' : 'SEND'}
          </button>
        </div>
      </div>

      <div style={{ padding: '5px 10px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 10, color: C.textDim }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
               title="Run non-destructive orders without asking. Deletes and explosions always confirm.">
          <input type="checkbox" checked={autoExec}
                 onChange={(e) => { setAutoExec(e.target.checked); saveBool(LS_AUTO, e.target.checked); }} />
          Auto-execute
        </label>
        {ttsOk && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={speakReplies}
                   onChange={(e) => { setSpeakReplies(e.target.checked); if (!e.target.checked) cancelSpeech(); saveBool(LS_SPEAK, e.target.checked); }} />
            Speak replies
          </label>
        )}
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {status && <span style={{ color: C.amber, marginRight: 8 }}>{status}</span>}
          {(usage.input > 0 || usage.output > 0) && `${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out`}
        </span>
      </div>

      <AiSettingsPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}
