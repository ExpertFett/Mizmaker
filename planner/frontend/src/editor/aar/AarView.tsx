/**
 * AAR view — the fourth app mode (Editor → Plan → Live → AAR).
 *
 * After a Live session, the event recorder (see LiveMap) has been POSTing
 * kill/loss/weapon/rtb/note entries to /api/sessions/<sid>/events. This view
 * reads them back, shows a post-mission debrief (summary + engagement log),
 * and generates the downloadable AAR (xlsx / csv / markdown) via
 * POST /api/sessions/<sid>/aar. Results are posted to Ready Room from the
 * Roster tab (AarRow). (v1.19.110)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { TabHelp } from '../components/TabHelp';
import { parseAcmiFile, type AcmiEvent, type AcmiSummary } from '../../utils/acmi';

interface AarEvent {
  type?: string;
  time_min?: number;
  unit?: string;
  killer?: string;
  target?: string;
  side?: string | number;
  coalition?: string;
  text?: string;
  note?: string;
  recorded_at?: number;
  [k: string]: unknown;
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  kill: { label: 'KILL', color: '#3fb950' },
  loss: { label: 'LOSS', color: '#d95050' },
  weapon: { label: 'WPN', color: '#d29922' },
  rtb: { label: 'RTB', color: '#4a9eff' },
  spawn: { label: 'ENTER', color: '#7f9ab0' },
  note: { label: 'NOTE', color: '#9aa7b4' },
};

function eventDetail(e: AarEvent): string {
  const who = String(e.unit ?? e.target ?? '—');
  const side = e.side != null && e.side !== '—' ? ` [${e.side}]` : '';
  if (e.type === 'kill' || e.type === 'loss') {
    const by = e.killer ? ` — by ${e.killer}` : '';
    const what = e.detail ? ` (${e.detail})` : '';
    return `${who}${what}${side}${by}`;
  }
  if (e.type === 'spawn') {
    const t = e.detail ? ` (${e.detail})` : '';
    return `${who}${t}${side} entered`;
  }
  if (e.type === 'rtb') return `${who}${side} left / RTB`;
  if (e.detail) return String(e.detail);
  if (e.text) return String(e.text);
  if (e.note) return String(e.note);
  // Fallback: show the non-boilerplate keys.
  const skip = new Set(['type', 'time_min', 'recorded_at', 'source']);
  const parts = Object.entries(e)
    .filter(([k, v]) => !skip.has(k) && v != null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return parts.join('  ') || '—';
}

export function AarView() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const filename = useMissionStore((s) => s.filename);
  const overview = useMissionStore((s) => s.overview);

  const [events, setEvents] = useState<AarEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Tacview import — when loaded, its events drive the debrief instead of the
  // Olympus-recorded session events. Tacview is the complete sortie record.
  const [tvEvents, setTvEvents] = useState<AcmiEvent[] | null>(null);
  const [tvSummary, setTvSummary] = useState<AcmiSummary | null>(null);
  const [tvName, setTvName] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const importTacview = useCallback(async (file: File) => {
    setBusy('import'); setErr(null);
    try {
      const { events: evs, summary } = await parseAcmiFile(file);
      setTvEvents(evs);
      setTvSummary(summary);
      setTvName(file.name);
      if (evs.length === 0) {
        setErr('Read the file but found no trackable objects — is it a DCS Tacview ACMI recording?');
      }
    } catch (e) {
      setErr(`Couldn't read the Tacview file: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const load = useCallback(async () => {
    if (!sessionId) { setEvents(null); return; }
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/events`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: AarEvent[] = Array.isArray(data?.events) ? data.events : [];
      list.sort((a, b) => (a.time_min ?? 0) - (b.time_min ?? 0) || (a.recorded_at ?? 0) - (b.recorded_at ?? 0));
      setEvents(list);
    } catch (e) {
      setErr(`Couldn't load the event log: ${(e as Error).message}`);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async (format: 'xlsx' | 'csv' | 'md') => {
    if (!sessionId) return;
    setBusy(format); setErr(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/aar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tvEvents ? { format, events: tvEvents } : { format }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(filename || 'mission').replace(/\.miz$/i, '')}_aar.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(`AAR generation failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [sessionId, filename, tvEvents]);

  const clearEvents = useCallback(async () => {
    if (!sessionId) return;
    if (!window.confirm('Clear the recorded engagement log for this session? The AAR you generate afterward will have an empty engagement table.')) return;
    setBusy('clear'); setErr(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/events`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(`Couldn't clear: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [sessionId, load]);

  // Tacview events (when imported) are the authoritative record; else the
  // Olympus-recorded session events.
  const shown: AarEvent[] | null = (tvEvents ?? events) as AarEvent[] | null;
  const kills = (shown || []).filter((e) => e.type === 'kill').length;
  const losses = (shown || []).filter((e) => e.type === 'loss').length;
  const missionName = overview?.sortie || filename || 'Untitled mission';

  const btn: React.CSSProperties = {
    background: '#1a3a2a', border: '1px solid #2f5f43', borderRadius: 4,
    color: '#cfe6d6', fontSize: 13, padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit',
  };
  const btnGhost: React.CSSProperties = {
    background: 'transparent', border: '1px solid #3a3a3a', borderRadius: 4,
    color: '#aaaaaa', fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 24, color: '#e0e0e0' }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>After-Action Review</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>{missionName}</p>
      </div>

      <TabHelp tabKey="aar">
        The fourth step in the flow (<b>Editor → Plan → Live → AAR</b>). Two ways to fill the engagement log: it records automatically while you run the mission in <b>Live</b> (Olympus telemetry), or <b>Import a Tacview recording</b> (<code>.acmi</code> / <code>.zip.acmi</code>) for the complete flight log. Then <b>generate the debrief</b> as a spreadsheet, CSV, or Markdown, and post attendance + results to your squadron from the <b>Roster</b> tab's Ready Room row.
      </TabHelp>

      {!sessionId ? (
        <div style={{ padding: '16px 18px', background: '#222222', border: '1px solid #3a3a3a', borderRadius: 6, fontSize: 13, color: '#c8d4e0', lineHeight: 1.6 }}>
          No mission session is loaded, so there's nothing to debrief yet. Upload a <b>.miz</b>, run it in <b>Live</b> mode (with an Olympus connection so kills/losses record), then come back here.
        </div>
      ) : (
        <>
          {/* Summary + actions */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <Stat label="Events" value={shown ? shown.length : '—'} color="#e0e0e0" />
            <Stat label="Kills" value={kills} color="#3fb950" />
            <Stat label="Losses" value={losses} color="#d95050" />
            <div style={{ flex: 1 }} />
            <input
              ref={fileRef} type="file" accept=".acmi,.txt.acmi,.zip.acmi,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importTacview(f); e.target.value = ''; }}
            />
            <button style={btnGhost} disabled={busy != null} onClick={() => fileRef.current?.click()}
              title="Import a Tacview recording (.acmi / .zip.acmi) — the complete sortie record; no Live session needed.">
              {busy === 'import' ? 'Reading…' : '⤢ Import Tacview'}
            </button>
            <span style={{ fontSize: 12, color: '#888' }}>Generate:</span>
            <button style={btn} disabled={busy != null} onClick={() => generate('xlsx')}>{busy === 'xlsx' ? '…' : 'Spreadsheet'}</button>
            <button style={btn} disabled={busy != null} onClick={() => generate('csv')}>{busy === 'csv' ? '…' : 'CSV'}</button>
            <button style={btn} disabled={busy != null} onClick={() => generate('md')}>{busy === 'md' ? '…' : 'Markdown'}</button>
            <button style={btnGhost} disabled={busy != null} onClick={load} title="Reload the Olympus event log">↻ Refresh</button>
          </div>

          {tvEvents && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9cd0ff', background: 'rgba(74,143,212,0.08)', border: '1px solid rgba(74,143,212,0.28)', borderRadius: '4px 4px 0 0', padding: '6px 12px' }}>
                <span>Source: <b>Tacview</b> — {tvName} ({tvEvents.length} events). Drives the debrief + Generate.</span>
                <div style={{ flex: 1 }} />
                <button style={{ ...btnGhost, padding: '3px 10px' }} onClick={() => { setTvEvents(null); setTvSummary(null); setTvName(''); }}>Use Olympus log</button>
              </div>
              {tvSummary && (
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: '#c8d4e0', background: '#1c2530', border: '1px solid rgba(74,143,212,0.28)', borderTop: 'none', borderRadius: '0 0 4px 4px', padding: '8px 12px' }}>
                  <span><b style={{ color: '#e0e0e0' }}>{Math.round(tvSummary.durationMin)}</b> min flown</span>
                  <span><b style={{ color: '#e0e0e0' }}>{tvSummary.aircraft}</b> aircraft</span>
                  {Object.entries(tvSummary.bySide).map(([side, n]) => (
                    <span key={side} style={{ color: /red|enem/i.test(side) ? '#e0776f' : /blue|all/i.test(side) ? '#7fb8ff' : '#c8d4e0' }}>{side}: <b>{n}</b></span>
                  ))}
                  <span><b style={{ color: tvSummary.destroyed ? '#d95050' : '#e0e0e0' }}>{tvSummary.destroyed}</b> destroyed</span>
                </div>
              )}
            </div>
          )}

          {err && (
            <div style={{ padding: '8px 12px', marginBottom: 14, borderRadius: 4, background: 'rgba(217,80,80,0.08)', border: '1px solid rgba(217,80,80,0.35)', color: '#e8a0a0', fontSize: 12 }}>
              {err}
            </div>
          )}

          {/* Engagement log */}
          <div style={{ border: '1px solid #3a3a3a', borderRadius: 6, background: '#222222', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #3a3a3a' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Engagement Log</span>
              {!tvEvents && events && events.length > 0 && (
                <button style={{ ...btnGhost, color: '#d95050', borderColor: '#5a2a2a' }} disabled={busy != null} onClick={clearEvents}>Clear log</button>
              )}
            </div>
            {loading ? (
              <div style={{ padding: 20, fontSize: 13, color: '#888' }}>Loading…</div>
            ) : !shown || shown.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: '#888', fontStyle: 'italic' }}>
                No events recorded. They log automatically during a Live session with an Olympus connection — or <b>Import a Tacview recording</b> above to debrief straight from the flight log. You can also generate a skeleton AAR and fill the engagement table in by hand.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: '#888', textAlign: 'left' }}>
                    <th style={{ padding: '6px 14px', width: 70, fontWeight: 600 }}>T+ (min)</th>
                    <th style={{ padding: '6px 8px', width: 64, fontWeight: 600 }}>Type</th>
                    <th style={{ padding: '6px 14px', fontWeight: 600 }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e, i) => {
                    const meta = TYPE_META[String(e.type)] || { label: String(e.type || '?').toUpperCase(), color: '#9aa7b4' };
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #2e2e2e' }}>
                        <td style={{ padding: '6px 14px', color: '#cccccc', fontFamily: "'B612 Mono', monospace" }}>
                          {e.time_min != null ? `+${Math.round(e.time_min)}` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{ color: meta.color, fontWeight: 700, fontSize: 11, letterSpacing: 0.5 }}>{meta.label}</span>
                        </td>
                        <td style={{ padding: '6px 14px', color: '#d8d8d8' }}>{eventDetail(e)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ background: '#222222', border: '1px solid #3a3a3a', borderRadius: 6, padding: '6px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}
