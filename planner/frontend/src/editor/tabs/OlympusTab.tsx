/**
 * Olympus Bridge tab (Phase 1) — connect to a LIVE DCS Olympus backend and
 * verify reachability + auth. Pushing the planned ORBAT (Phase 2) builds on this.
 *
 * All calls go through the DCS:OPT backend relay (/api/olympus/*), which talks
 * to Olympus :4512 server-to-server (no browser CORS/mixed-content). Run
 * DCS:OPT on the same network as your DCS / Olympus server.
 */

import { useState } from 'react';

interface OlympusConn { host: string; port: string; password: string }

const LS_KEY = 'dcsopt.olympus.conn.v1';

function loadConn(): OlympusConn {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { host: 'localhost', port: '4512', password: '', ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { host: 'localhost', port: '4512', password: '' };
}

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; mission?: unknown }
  | { kind: 'fail'; error: string };

export function OlympusTab() {
  const [conn, setConn] = useState<OlympusConn>(loadConn);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const update = (patch: Partial<OlympusConn>) => {
    const next = { ...conn, ...patch };
    setConn(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const test = async () => {
    if (!conn.host.trim()) { setStatus({ kind: 'fail', error: 'Enter the Olympus host first.' }); return; }
    setStatus({ kind: 'testing' });
    try {
      const res = await fetch('/api/olympus/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: conn.host.trim(),
          port: Number(conn.port) || 4512,
          password: conn.password,
        }),
      });
      const data = await res.json();
      if (data.ok) setStatus({ kind: 'ok', mission: data.mission });
      else setStatus({ kind: 'fail', error: data.error || 'Connection failed.' });
    } catch (e: any) {
      setStatus({ kind: 'fail', error: e?.message || 'Request failed.' });
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 640, color: '#e0e0e0', fontSize: 14 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600 }}>Olympus Bridge</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#aaaaaa', lineHeight: 1.5 }}>
        Push this mission's planned forces into a <strong>live</strong> DCS Olympus session.
        Calls go through the DCS:OPT backend, so <strong>run DCS:OPT on the same network</strong> as
        your DCS / Olympus server. <span style={{ color: '#d9a24a' }}>Beta — experimental.</span>
      </p>

      <div style={{ background: '#222222', border: '1px solid #3a3a3a', padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'center' }}>
          <label style={lbl}>Host / IP</label>
          <input style={inp} value={conn.host} placeholder="localhost or 192.168.x.x"
                 onChange={(e) => update({ host: e.target.value })} />
          <label style={lbl}>Port</label>
          <input style={{ ...inp, width: 100 }} value={conn.port} placeholder="4512"
                 onChange={(e) => update({ port: e.target.value.replace(/[^0-9]/g, '') })} />
          <label style={lbl}>Password</label>
          <input style={inp} type="password" value={conn.password}
                 placeholder="Game Master / Commander password"
                 onChange={(e) => update({ password: e.target.value })} />
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: '#888888' }}>
          Use the role password set in Olympus's <code>olympus.json</code> (Game Master can do everything).
          Leave blank if no password is configured.
        </p>
      </div>

      <button onClick={test} disabled={status.kind === 'testing'} style={{
        background: '#2a3a4a', border: '1px solid #4a8fd4', color: '#9cd0ff',
        fontSize: 14, fontWeight: 600, padding: '9px 18px', cursor: 'pointer',
        opacity: status.kind === 'testing' ? 0.6 : 1, fontFamily: 'inherit',
      }}>
        {status.kind === 'testing' ? 'Testing…' : 'Test Connection'}
      </button>

      {status.kind === 'ok' && (
        <div style={{ ...box, borderColor: '#3fb950', color: '#3fb950' }}>
          ✓ Connected — Olympus reachable and password accepted.
        </div>
      )}
      {status.kind === 'fail' && (
        <div style={{ ...box, borderColor: '#d95050', color: '#d95050' }}>
          ✗ {status.error}
        </div>
      )}

      <div style={{ marginTop: 20, padding: '12px 14px', background: '#1c1c1c', border: '1px dashed #3a3a3a', fontSize: 12, color: '#999999', lineHeight: 1.6 }}>
        <strong style={{ color: '#cccccc' }}>Coming next (Phase 2):</strong> a "Push ORBAT" button that
        spawns this mission's planned ground/air units into the live Olympus session.
        <br />
        <span style={{ color: '#777777' }}>
          Note: two relay constants (command base path + endpoint strings) are still being confirmed
          against a live Olympus — if Test Connection misbehaves, a 30-sec capture will lock them.
        </span>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 13, color: '#aaaaaa' };
const inp: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #4a4a4a', color: '#e0e0e0',
  padding: '7px 10px', fontSize: 14, fontFamily: 'inherit',
};
const box: React.CSSProperties = {
  marginTop: 14, padding: '10px 14px', border: '1px solid', fontSize: 13,
  background: '#1c1c1c',
};
