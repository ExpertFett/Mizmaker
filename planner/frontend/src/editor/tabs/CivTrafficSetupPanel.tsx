/**
 * Civilian Air Traffic setup — a Scripts-tab framework (v1.19.110).
 *
 * Bundles the curated per-map civilian-traffic script (the "anti-RAT" corridor
 * approach we built) and wires its MISSION-START load trigger, just like the
 * AEGIS / TIC / Carriers frameworks. One self-contained .lua per theater
 * (config + spawn engine inline; no MOOSE/MIST): infinite spawning along
 * real-world airways/hubs/GA regions, density-capped. Fire-and-forget:
 * no in-game controls — players cannot touch the ambient traffic.
 */
import { useCallback, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { applyFrameworkTriggers, civTrafficScriptForTheater } from './frameworkTriggers';

const SUPPORTED = [
  'Caucasus', 'Persian Gulf', 'Syria', 'Nevada', 'Mariana Islands',
  'Sinai', 'South Atlantic (Falklands)', 'Afghanistan', 'Kola', 'Iraq',
  'Germany Cold War',
];

export function CivTrafficSetupPanel() {
  const overview = useMissionStore((s) => s.overview);
  const sessionId = useMissionStore((s) => s.sessionId);
  const theater = overview?.theater;
  const script = civTrafficScriptForTheater(theater);
  const [applied, setApplied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const apply = useCallback(async () => {
    if (!script) return;
    if (!sessionId) { setMsg('Load a mission first.'); return; }
    try {
      const added = await applyFrameworkTriggers(sessionId, [script]);
      setApplied(true);
      setMsg(added.length
        ? `Load trigger added — ${script.bundledFile} bundles on download.`
        : 'Load trigger was already present (nothing to add).');
    } catch (e) {
      setMsg(`Failed to add trigger: ${e instanceof Error ? e.message : 'error'}`);
    }
  }, [script, sessionId]);

  const card: React.CSSProperties = {
    background: '#222222', border: '1px solid #3a3a3a', borderRadius: 6,
    padding: '12px 14px', marginBottom: 14, fontSize: 13, color: '#d8d8d8', lineHeight: 1.55,
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e0e0e0' }}>
          Civilian Air Traffic — curated corridors
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#aaaaaa' }}>
          Real-world airways, airport hubs, and GA regions — the "anti-RAT" approach. Infinite runtime spawning, tuned for a busy-but-safe density (air + ship traffic combined stays well under ~120 concurrent units per map, so even low-end servers cope). <b>Fire-and-forget</b> — no in-game menu; players can't touch the traffic.
        </p>
      </div>

      {/* Requirements — this script won't run without both */}
      <div style={{ ...card, background: 'rgba(210,153,34,0.06)', border: '1px solid rgba(210,153,34,0.3)' }}>
        <div style={{ color: '#e0b24a', fontWeight: 600, marginBottom: 6 }}>⚠ Two setup requirements</div>
        <div>
          1. <b>Civil Aircraft Mod (CAM)</b> installed on the server + every client (the civilian airframes come from it).<br />
          2. Country <b>EGYPT</b> placed in the <b>NEUTRALS</b> coalition — the dynamic spawns join whatever coalition owns their spawn country. Set this in the Mission Editor's coalition setup.
        </div>
      </div>

      {!script ? (
        <div style={{ ...card, background: 'rgba(217,80,80,0.06)', border: '1px solid rgba(217,80,80,0.3)', color: '#e8b4b4' }}>
          {theater
            ? <>No curated corridors for <b>{theater}</b> yet.</>
            : <>Load a mission first so the theater can be detected.</>}
          <div style={{ marginTop: 8, fontSize: 12, color: '#c8b0b0' }}>
            Supported maps: {SUPPORTED.join(' · ')}.
          </div>
        </div>
      ) : (
        <>
          <div style={card}>
            Detected theater: <b style={{ color: '#9cd0ff' }}>{theater}</b>. Applying wires a
            <b> MISSION START → DO SCRIPT FILE</b> trigger that loads
            <code style={{ color: '#cfe6d6', margin: '0 4px' }}>{script.bundledFile}</code>
            — the file bundles into the .miz automatically on download, same as AEGIS / TIC.
          </div>

          <button
            onClick={apply}
            style={{
              background: applied ? '#1e3a28' : '#1a3a2a',
              border: `1px solid ${applied ? '#3fb950' : '#2f5f43'}`,
              borderRadius: 4, color: applied ? '#8fe0a6' : '#cfe6d6',
              fontSize: 13, fontWeight: 600, padding: '8px 18px', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {applied ? '✓ Applied' : 'Apply — wire load trigger'}
          </button>

          {msg && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#9aa7b4' }}>{msg} Verify it on the <b>Triggers</b> tab.</div>
          )}
        </>
      )}
    </div>
  );
}
