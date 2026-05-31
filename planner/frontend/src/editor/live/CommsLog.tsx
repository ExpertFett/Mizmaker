/**
 * CommsLog — controller text-comms drawer (Phase 3 of the LotATC scope).
 *
 * The DM (anyone with `command` cap) composes typed orders like
 * "Uzi 1-1 vector 080 for 18"; every group member's CommsLog receives
 * the line within ~1s via an SSE stream. Pure app-internal lane (Olympus
 * has no chat command).
 *
 * Backfill: on mount, GET `/api/groups/<gid>/comms` returns the last ~200
 * messages so a member joining mid-session sees what was said.
 *
 * Stream: EventSource on `/api/groups/<gid>/comms/stream` with reconnect
 * on the browser's default behavior. Heartbeats every 30s keep the
 * connection alive through Cloudflare; we don't surface them.
 *
 * Composer: hidden when the user lacks the `command` cap (DM model — only
 * GM / admin / commander can broadcast; ATC / JTAC / operator are read-only).
 */

import { useEffect, useRef, useState } from 'react';
import { listComms, postComms, commsStreamUrl, can, type CommsMessage, type GroupSummary } from '../../api/groups';

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

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return ''; }
}

export function CommsLog({ group, onClose }: { group: GroupSummary; onClose?: () => void }) {
  const [messages, setMessages] = useState<CommsMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamErr, setStreamErr] = useState<string>('');
  const [streamUp, setStreamUp] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canBroadcast = can(group.role, 'command');

  // Backfill once on mount. The EventSource picks up everything posted from
  // here on, so combining the two gives the full history without races —
  // assuming no message arrives in the gap between the GET and the connect,
  // which the dedup-by-id below handles regardless.
  useEffect(() => {
    let cancelled = false;
    listComms(group.id).then((r) => {
      if (cancelled) return;
      setMessages(r.messages ?? []);
    }).catch(() => { /* tolerate; the stream will populate */ });
    return () => { cancelled = true; };
  }, [group.id]);

  // Stream subscriber. Native EventSource handles reconnects + sends an
  // empty event-type frame for heartbeats (": heartbeat") which the API
  // ignores. We attach to the named "comms" event.
  useEffect(() => {
    const es = new EventSource(commsStreamUrl(group.id));
    const onOpen = () => { setStreamUp(true); setStreamErr(''); };
    const onError = () => { setStreamUp(false); setStreamErr('stream offline — reconnecting…'); };
    const onComms = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data) as CommsMessage;
        setMessages((prev) => {
          // Dedup vs whatever backfill/POST round-trip already inserted.
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg].slice(-300);
        });
      } catch { /* ignore parse errors */ }
    };
    es.addEventListener('open', onOpen);
    es.addEventListener('error', onError);
    es.addEventListener('comms', onComms as EventListener);
    return () => {
      es.removeEventListener('open', onOpen);
      es.removeEventListener('error', onError);
      es.removeEventListener('comms', onComms as EventListener);
      es.close();
    };
  }, [group.id]);

  // Auto-scroll to bottom on new messages unless the user has scrolled up.
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const nearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await postComms(group.id, text);
      // Optimistic insert in case the stream lags. Dedup handles overlap.
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      setInput('');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setStreamErr(`Send failed: ${m}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: C.accentDim, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: streamUp ? C.green : C.red, boxShadow: streamUp ? `0 0 5px ${C.green}` : 'none' }} />
          COMMS LOG
        </span>
        {onClose && <span onClick={onClose} style={{ cursor: 'pointer', color: C.textDim, fontWeight: 400 }}>×</span>}
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, lineHeight: 1.45 }}>
        {messages.length === 0 && (
          <div style={{ color: C.textDim, fontSize: 11, padding: '6px 0' }}>
            No comms yet. {canBroadcast ? 'Use the composer to broadcast.' : 'Waiting for the DM…'}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', padding: '3px 0', borderBottom: `1px solid rgba(36,51,73,0.4)` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 10, color: C.textDim }}>
              <span><span style={{ color: m.role === 'admin' ? C.amber : C.text, fontWeight: 600 }}>{m.author}</span> · {m.role.toUpperCase()}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(m.ts)}</span>
            </div>
            <div style={{ color: C.text }}>{m.text}</div>
          </div>
        ))}
      </div>

      {streamErr && (
        <div style={{ padding: '4px 10px', fontSize: 10, color: streamUp ? C.textDim : C.red, borderTop: `1px solid ${C.border}` }}>
          {streamErr}
        </div>
      )}

      {canBroadcast ? (
        <div style={{ padding: '8px 10px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 6 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Broadcast (Enter to send, Shift+Enter newline)"
            rows={2}
            style={{ flex: 1, resize: 'none', background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`, color: C.text, padding: '5px 7px', fontSize: 12, fontFamily: 'inherit', borderRadius: 3, outline: 'none' }}
          />
          <button onClick={send} disabled={sending || !input.trim()}
                  style={{ background: C.accentDim, border: `1px solid ${C.accent}`, color: '#cfe6ff', padding: '0 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1, borderRadius: 3, cursor: sending ? 'wait' : 'pointer', opacity: !input.trim() ? 0.5 : 1 }}>
            {sending ? '…' : 'SEND'}
          </button>
        </div>
      ) : (
        <div style={{ padding: '6px 10px', borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.textDim, fontStyle: 'italic' }}>
          Read-only (your role can't broadcast).
        </div>
      )}
    </div>
  );
}
