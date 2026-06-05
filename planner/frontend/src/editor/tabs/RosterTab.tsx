/**
 * RosterTab — import a player roster (CSV) and assign it onto the mission's
 * player/client slots.
 *
 * Flow: upload/paste a CSV → columns auto-detected (Pilot / Callsign / Flight /
 * Seat) → roster rows auto-matched to client slots (by current callsign, then
 * sequential fill) with manual dropdown fix-ups → Apply dispatches:
 *   • voiceCallsignLabel + voiceCallsignNumber  (the spoken callsign)
 *   • unitRename                                 (the pilot/slot name)
 * Those edits flow through to the existing Comms/Flight kneeboards + briefs.
 * The bottom table is a ready-to-screenshot roster reference.
 *
 * CSV only for now (every spreadsheet exports CSV); XLSX would need openpyxl
 * on the backend — flagged as a follow-up.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

type Row = Record<string, string>;
type ColKey = 'pilot' | 'callsign' | 'flight' | 'seat';

const COL_HINTS: Record<ColKey, string[]> = {
  pilot: ['pilot', 'name', 'player', 'aircrew', 'student'],
  callsign: ['callsign', 'call sign', 'cs', 'voice'],
  flight: ['flight', 'element', 'section', 'package'],
  seat: ['seat', 'pos', 'position', 'dash', 'number', '#'],
};

/** Minimal CSV parser: handles quoted fields, escaped quotes, CRLF. */
function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const lines: string[][] = [];
  let field = '', row: string[] = [], inQ = false;
  const pushF = () => { row.push(field); field = ''; };
  const pushR = () => { pushF(); lines.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') pushF();
    else if (c === '\n') pushR();
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) pushR();
  const nonEmpty = lines.filter((l) => l.some((x) => x.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((l) => {
    const o: Row = {};
    headers.forEach((h, i) => { o[h] = (l[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows };
}

function autoDetectCols(headers: string[]): Record<ColKey, string> {
  const out: Record<ColKey, string> = { pilot: '', callsign: '', flight: '', seat: '' };
  for (const key of Object.keys(COL_HINTS) as ColKey[]) {
    const hit = headers.find((h) => COL_HINTS[key].some((hint) => h.toLowerCase().includes(hint)));
    if (hit) out[key] = hit;
  }
  return out;
}

/** Split a roster callsign cell ("Uzi 1-1", "Uzi11", "Springfield 2") into the
 *  DCS voice-callsign label (letters) + number (digits concatenated). */
function splitCallsign(raw: string): { label: string; number: string } {
  const s = (raw || '').trim();
  if (!s) return { label: '', number: '' };
  const label = (s.match(/[A-Za-z][A-Za-z\s'-]*/)?.[0] || '').trim();
  const number = (s.match(/\d+/g) || []).join('');
  return { label, number };
}

export function RosterTab() {
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const addEdit = useEditStore((s) => s.addEdit);

  const [raw, setRaw] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [cols, setCols] = useState<Record<ColKey, string>>({ pilot: '', callsign: '', flight: '', seat: '' });
  const [assign, setAssign] = useState<Record<number, number | null>>({}); // unitId -> row index
  const [applied, setApplied] = useState(false);
  const [parseMsg, setParseMsg] = useState('');

  // Player slots sorted by group then unitId (flight order).
  const slots = useMemo(() => {
    return [...clientUnits].sort((a, b) =>
      (a.groupName || '').localeCompare(b.groupName || '') || a.unitId - b.unitId);
  }, [clientUnits]);

  // Common post-parse: stash headers/rows, auto-detect column mapping, auto-match.
  const applyParsed = useCallback((h: string[], r: Row[], label?: string) => {
    setHeaders(h); setRows(r);
    const detected = autoDetectCols(h);
    setCols(detected);
    autoMatch(r, detected);
    setApplied(false);
    setParseMsg(r.length
      ? `Parsed ${r.length} roster row${r.length === 1 ? '' : 's'}, ${h.length} columns${label ? ` (${label})` : ''}.`
      : 'No rows found — is this a CSV/XLSX with a header line?');
  }, [slots]); // eslint-disable-line react-hooks/exhaustive-deps

  const ingest = useCallback((text: string) => {
    setRaw(text);
    const { headers: h, rows: r } = parseCsv(text);
    applyParsed(h, r);
  }, [applyParsed]);

  // File upload — route XLSX through the backend (needs openpyxl) and parse
  // CSV/TSV client-side. Falls back to text() for unknown extensions.
  const handleFile = useCallback(async (f: File) => {
    const lower = (f.name || '').toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
      try {
        const fd = new FormData(); fd.append('file', f);
        const res = await fetch('/api/roster/parse', { method: 'POST', body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({} as { error?: string }));
          setParseMsg(err.error || `XLSX parse failed (HTTP ${res.status})`);
          return;
        }
        const d = await res.json() as { headers: string[]; rows: Row[] };
        setRaw(''); // XLSX has no plain-text representation to preview
        applyParsed(d.headers || [], d.rows || [], 'XLSX');
      } catch (e: any) {
        setParseMsg(e?.message || 'XLSX upload failed');
      }
    } else {
      ingest(await f.text());
    }
  }, [applyParsed, ingest]);

  // Auto-match: first by callsign equality, then sequential fill of remaining slots.
  const autoMatch = useCallback((r: Row[], detected: Record<ColKey, string>) => {
    const next: Record<number, number | null> = {};
    const used = new Set<number>();
    if (detected.callsign) {
      for (const slot of slots) {
        const slotCs = `${slot.voiceCallsignLabel}${slot.voiceCallsignNumber}`.toLowerCase();
        const idx = r.findIndex((row, i) => {
          if (used.has(i)) return false;
          const { label, number } = splitCallsign(row[detected.callsign]);
          return `${label}${number}`.toLowerCase().replace(/[\s'-]/g, '') === slotCs.replace(/[\s'-]/g, '') && (label || number);
        });
        if (idx >= 0) { next[slot.unitId] = idx; used.add(idx); }
      }
    }
    // Sequential fill for unmatched slots
    let cursor = 0;
    for (const slot of slots) {
      if (next[slot.unitId] != null) continue;
      while (cursor < r.length && used.has(cursor)) cursor++;
      if (cursor < r.length) { next[slot.unitId] = cursor; used.add(cursor); cursor++; }
      else next[slot.unitId] = null;
    }
    setAssign(next);
  }, [slots]);

  const rowLabel = (i: number): string => {
    const row = rows[i]; if (!row) return '—';
    const cs = cols.callsign ? row[cols.callsign] : '';
    const pilot = cols.pilot ? row[cols.pilot] : '';
    return [cs, pilot].filter(Boolean).join('  ·  ') || `Row ${i + 1}`;
  };

  const resolved = useMemo(() => slots.map((slot) => {
    const i = assign[slot.unitId];
    const row = (i != null && rows[i]) ? rows[i] : null;
    const cs = row && cols.callsign ? splitCallsign(row[cols.callsign]) : null;
    const pilot = row && cols.pilot ? row[cols.pilot] : '';
    return { slot, row, cs, pilot };
  }), [slots, assign, rows, cols]);

  const matchedCount = resolved.filter((x) => x.row).length;

  const apply = useCallback(() => {
    for (const { slot, cs, pilot } of resolved) {
      if (cs && (cs.label || cs.number)) {
        if (cs.label) addEdit({ unitId: slot.unitId, field: 'voiceCallsignLabel', value: cs.label } as any);
        if (cs.number) addEdit({ unitId: slot.unitId, field: 'voiceCallsignNumber', value: cs.number } as any);
      }
      if (pilot) addEdit({ unitId: slot.unitId, field: 'unitRename', value: pilot } as any);
    }
    setApplied(true);
  }, [resolved, addEdit]);

  if (clientUnits.length === 0) {
    return <div style={{ color: MUTED, fontSize: 14, padding: 16 }}>No player/client slots found in this mission.</div>;
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 2px', fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>Player Roster</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: MUTED }}>
        Upload a CSV roster and assign it to the mission's {slots.length} player slot{slots.length === 1 ? '' : 's'}.
        Sets each slot's voice callsign + pilot name; flows into Comms/Flight kneeboards & briefs.
      </p>

      {/* Generate signup sheet — produces a fillable XLSX / CSV / MD pre-
          populated from the mission's player slots. Pilots fill the Pilot
          column, the runner uploads the result back via the "Upload CSV /
          XLSX" button below. (v1.19.15) */}
      <SignupSheetRow />
      <AarRow />

      {/* Upload / paste */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={btn}>
          Upload CSV / XLSX
          <input type="file" accept=".csv,.tsv,.xlsx,.xlsm,text/csv" style={{ display: 'none' }}
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </label>
        <span style={{ fontSize: 12, color: MUTED }}>or paste below ·</span>
        {parseMsg && <span style={{ fontSize: 12, color: rows.length ? '#3fb950' : '#d8a657' }}>{parseMsg}</span>}
      </div>
      <textarea
        value={raw} onChange={(e) => ingest(e.target.value)}
        placeholder={'Pilot,Callsign,Flight,Seat\nSmith,Uzi 1-1,Uzi,1\nJones,Uzi 1-2,Uzi,2'}
        style={{ width: '100%', boxSizing: 'border-box', minHeight: 80, background: '#1a1a1a', color: '#e0e0e0', border: `1px solid ${BORDER}`, borderRadius: 4, padding: 8, fontSize: 12, fontFamily: "'B612 Mono', monospace", marginBottom: 14 }} />

      {/* Column mapping */}
      {headers.length > 0 && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16, padding: '10px 14px', background: '#222', border: `1px solid ${BORDER}`, borderRadius: 4 }}>
          {(Object.keys(COL_HINTS) as ColKey[]).map((key) => (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={lbl}>{key === 'seat' ? 'Seat/Pos' : key[0].toUpperCase() + key.slice(1)}</label>
              <select value={cols[key]} onChange={(e) => { const c = { ...cols, [key]: e.target.value }; setCols(c); autoMatch(rows, c); setApplied(false); }} style={sel}>
                <option value="">—</option>
                {headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Slot assignment table */}
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: MUTED }}><strong style={{ color: '#e0e0e0' }}>{matchedCount}</strong> / {slots.length} slots matched</span>
            <button onClick={() => autoMatch(rows, cols)} style={btn}>Re-auto-match</button>
          </div>
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
            {resolved.map(({ slot, cs, pilot }, idx) => (
              <div key={slot.unitId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: idx ? `1px solid ${BORDER}` : 'none', background: idx % 2 ? '#1d1d1d' : '#222' }}>
                <span style={{ width: 16, color: slot.coalition === 'blue' ? '#4a8fd4' : slot.coalition === 'red' ? '#d95050' : MUTED }}>●</span>
                <span style={{ width: 150, fontSize: 12, color: '#cccccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${slot.groupName} · ${slot.type}`}>
                  {slot.groupName} <span style={{ color: MUTED }}>· {slot.type}</span>
                </span>
                <span style={{ width: 70, fontSize: 12, color: MUTED }}>{slot.voiceCallsignLabel}{slot.voiceCallsignNumber}</span>
                <span style={{ color: MUTED }}>←</span>
                <select value={assign[slot.unitId] ?? ''} onChange={(e) => { setAssign((p) => ({ ...p, [slot.unitId]: e.target.value === '' ? null : Number(e.target.value) })); setApplied(false); }} style={{ ...sel, flex: 1 }}>
                  <option value="">— unassigned —</option>
                  {rows.map((_, i) => <option key={i} value={i}>{rowLabel(i)}</option>)}
                </select>
                <span style={{ width: 150, fontSize: 12, fontFamily: "'B612 Mono', monospace", color: '#e0e0e0', textAlign: 'right' }}>
                  {cs && (cs.label || cs.number) ? `${cs.label} ${cs.number}` : ''}{pilot ? `  ${pilot}` : ''}
                </span>
              </div>
            ))}
          </div>

          {/* Apply */}
          <div style={{ marginTop: 16, padding: 14, background: '#222', border: `1px solid ${BORDER}`, borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: MUTED }}>
              {applied ? 'Roster applied! Download your .miz to save changes.' : `Apply will set callsigns + pilot names on ${matchedCount} slot${matchedCount === 1 ? '' : 's'}.`}
            </span>
            <button onClick={apply} disabled={applied || matchedCount === 0}
                    style={{ ...btn, background: applied ? '#1a2020' : '#1a2a1a', border: `1px solid ${applied ? '#3a5a3a' : '#3fb950'}`, color: applied ? '#3a5a3a' : '#3fb950', fontWeight: 600, padding: '8px 18px' }}>
              {applied ? '✓ Applied' : 'Apply Roster'}
            </button>
          </div>

          {/* Reference table (screenshot-ready) */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', marginBottom: 6 }}>Roster reference</div>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: MUTED }}>
                <th style={th}>Flight</th><th style={th}>Callsign</th><th style={th}>Pilot</th><th style={th}>Aircraft</th>
              </tr></thead>
              <tbody>
                {resolved.filter((x) => x.row).map(({ slot, cs, pilot }) => (
                  <tr key={slot.unitId} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td style={td}>{slot.groupName}</td>
                    <td style={{ ...td, fontFamily: "'B612 Mono', monospace", color: '#e0e0e0' }}>{cs ? `${cs.label} ${cs.number}` : `${slot.voiceCallsignLabel}${slot.voiceCallsignNumber}`}</td>
                    <td style={td}>{pilot || '—'}</td>
                    <td style={{ ...td, color: MUTED }}>{slot.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ───── Signup sheet generator ─────────────────────────────────────────────
// Pulls the mission's player slots from the backend and serves a fillable
// XLSX / CSV / Markdown sheet. Pilots fill the Pilot column, the event
// runner uploads the result back via the file-picker above — column
// headers match what autoDetectCols expects so the round-trip works.
function SignupSheetRow() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'md'>('xlsx');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const download = async () => {
    if (!sessionId || busy) return;
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/sessions/${sessionId}/signup_sheet?format=${format}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: 'failed' }));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      // Pull the filename out of Content-Disposition for the suggested name.
      const cd = r.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="?([^";]+)"?/);
      const name = m?.[1] || `signup.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg(`✓ Downloaded ${name}`);
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : 'failed'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 14, padding: '10px 14px', background: '#1d2530', border: `1px solid ${BORDER}`, borderRadius: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>Generate signup sheet</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2, lineHeight: 1.45 }}>
            Pre-populated from this mission's player slots. Post for sign-ups, then upload the filled file back above to assign pilots.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['xlsx', 'csv', 'md'] as const).map((f) => (
            <button key={f} onClick={() => setFormat(f)}
                    style={{ background: format === f ? '#3a5a82' : '#2a2a2a', border: `1px solid ${format === f ? '#4a8fd4' : BORDER}`, color: format === f ? '#cfe6ff' : '#aaa', cursor: 'pointer', fontSize: 12, padding: '5px 10px', borderRadius: 3, fontFamily: 'inherit', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              {f}
            </button>
          ))}
        </div>
        <button onClick={download} disabled={!sessionId || busy} style={{ ...btn, opacity: !sessionId || busy ? 0.5 : 1, cursor: !sessionId || busy ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Generating…' : '⬇ Download'}
        </button>
      </div>
      {msg && <div style={{ fontSize: 11, marginTop: 6, color: msg.startsWith('✓') ? '#3fb950' : '#e0554f' }}>{msg}</div>}
    </div>
  );
}

// ───── After-Action Review download row ──────────────────────────────────
// Generates a post-flight debrief skeleton (markdown / CSV / XLSX) pre-
// filled with the mission's participants + any pilot names already
// applied via the roster edits above. Empty engagement log + notes
// blocks for the runner to fill in by hand. Backend: services/aar.py.
function AarRow() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const edits = useEditStore((s) => s.edits);
  const [format, setFormat] = useState<'md' | 'csv' | 'xlsx'>('md');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [notes, setNotes] = useState('');
  const [durationMin, setDurationMin] = useState('');
  // Live event count — refreshed when this row mounts + each download.
  // Surfaces feedback that the Live mode recorder is actually capturing
  // losses, so the planner knows the AAR will auto-populate.
  const [eventCount, setEventCount] = useState<number | null>(null);

  const refreshEventCount = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await fetch(`/api/sessions/${sessionId}/events`);
      if (!r.ok) return;
      const j = await r.json();
      setEventCount(Array.isArray(j.events) ? j.events.length : 0);
    } catch { /* swallow */ }
  }, [sessionId]);

  useEffect(() => { refreshEventCount(); }, [refreshEventCount]);

  const clearEvents = async () => {
    if (!sessionId) return;
    if (!window.confirm(`Clear ${eventCount ?? 0} recorded live event(s)? The AAR will fall back to manual entry.`)) return;
    try {
      const r = await fetch(`/api/sessions/${sessionId}/events`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEventCount(0);
      setMsg('✓ Live event log cleared');
    } catch (e) {
      setMsg(`✗ Clear failed: ${e instanceof Error ? e.message : ''}`);
    }
  };

  // Build signups dict from in-flight edits: callsign (unit name) → pilot name.
  // The roster Apply step writes `unitRename` edits per unitId, so we map
  // each unitId → display callsign + use the latest rename value.
  const signups = useMemo(() => {
    const idToCallsign = new Map<string, string>();
    for (const u of clientUnits) {
      idToCallsign.set(String(u.unitId), u.name || '');
    }
    const out: Record<string, string> = {};
    for (const ed of edits as Array<{ unitId?: string | number; field: string; value: string }>) {
      if (ed.field === 'unitRename' && ed.unitId != null) {
        const cs = idToCallsign.get(String(ed.unitId));
        if (cs) out[cs] = String(ed.value || '');
      }
    }
    return out;
  }, [edits, clientUnits]);

  const download = async () => {
    if (!sessionId || busy) return;
    setBusy(true); setMsg('');
    try {
      const body = {
        format,
        signups,
        events: [],  // populated by Live session loop in a future iteration
        notes,
        duration_min: durationMin ? Number(durationMin) : null,
      };
      const r = await fetch(`/api/sessions/${sessionId}/aar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: 'failed' }));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="?([^";]+)"?/);
      const name = m?.[1] || `aar.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg(`✓ Downloaded ${name}`);
      refreshEventCount();
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : 'failed'}`);
    } finally {
      setBusy(false);
    }
  };

  const pilotCount = Object.values(signups).filter((p) => (p || '').trim()).length;

  return (
    <div style={{ marginBottom: 14, padding: '10px 14px', background: '#1d2530', border: `1px solid ${BORDER}`, borderRadius: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>Generate AAR / debrief</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2, lineHeight: 1.45 }}>
            Post-mission debrief skeleton — pre-filled with participants
            {pilotCount > 0 ? ` + ${pilotCount} signed-up pilot${pilotCount === 1 ? '' : 's'}` : ''}
            {eventCount !== null && eventCount > 0 ? (
              <>
                {' '}+ <span style={{ color: '#3fb950', fontWeight: 600 }}>{eventCount} live event{eventCount === 1 ? '' : 's'}</span>
                {' '}<button onClick={clearEvents} title="Clear the recorded live event log"
                             style={{ background: 'none', border: 'none', color: '#e0554f', cursor: 'pointer', fontSize: 10, padding: 0, textDecoration: 'underline' }}>
                  clear
                </button>
              </>
            ) : (
              <>{' '}<span style={{ color: '#888', fontStyle: 'italic' }}>(no live events recorded yet — Live mode logs losses automatically)</span></>
            )}.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['md', 'csv', 'xlsx'] as const).map((f) => (
            <button key={f} onClick={() => setFormat(f)}
                    style={{ background: format === f ? '#3a5a82' : '#2a2a2a', border: `1px solid ${format === f ? '#4a8fd4' : BORDER}`, color: format === f ? '#cfe6ff' : '#aaa', cursor: 'pointer', fontSize: 12, padding: '5px 10px', borderRadius: 3, fontFamily: 'inherit', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              {f}
            </button>
          ))}
        </div>
        <button onClick={download} disabled={!sessionId || busy} style={{ ...btn, opacity: !sessionId || busy ? 0.5 : 1, cursor: !sessionId || busy ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Generating…' : '⬇ Download'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
        <input
          type="number" min={0} step={5}
          value={durationMin} onChange={(e) => setDurationMin(e.target.value)}
          placeholder="Duration (min)"
          style={{ ...sel, width: 130 }} />
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional debrief notes — what went well, what to fix, lessons learned…"
          style={{ ...sel, flex: 1, minHeight: 50, fontFamily: 'inherit', resize: 'vertical' }} />
      </div>
      {msg && <div style={{ fontSize: 11, marginTop: 6, color: msg.startsWith('✓') ? '#3fb950' : '#e0554f' }}>{msg}</div>}
    </div>
  );
}

const MUTED = '#aaaaaa';
const BORDER = '#3a3a3a';
const btn: React.CSSProperties = { background: '#3a3a3a', border: `1px solid ${BORDER}`, borderRadius: 4, color: '#4a8fd4', cursor: 'pointer', fontSize: 13, padding: '6px 12px', fontFamily: 'inherit' };
const sel: React.CSSProperties = { background: '#262626', border: `1px solid ${BORDER}`, borderRadius: 4, color: '#e0e0e0', fontSize: 13, padding: '5px 7px', outline: 'none', fontFamily: 'inherit' };
const lbl: React.CSSProperties = { fontSize: 11, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 };
const th: React.CSSProperties = { padding: '5px 8px', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '5px 8px', color: '#cccccc' };
