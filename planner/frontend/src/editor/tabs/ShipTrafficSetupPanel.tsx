/**
 * Civilian Ship Traffic setup — a Scripts-tab framework (v1.19.111).
 *
 * Sister of CivTrafficSetupPanel for SHIPPING: one self-contained .lua per
 * water map (lane config + spawn engine inline; no MOOSE/MIST). Real-world
 * lanes as TSS-style one-way pairs, pre-seeded along their length at mission
 * start (ships are slow — the sea starts populated), anchorage queues at
 * ports, fishing fleets inshore. STOCK DCS ships — no mods required.
 */
import { useCallback, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { addFrameworkTriggers, shipTrafficScriptForTheater } from './frameworkTriggers';

const SUPPORTED = [
  'Caucasus', 'Persian Gulf', 'Syria', 'Sinai', 'Mariana Islands',
  'Kola', 'South Atlantic (Falklands)', 'Germany Cold War',
];

export function ShipTrafficSetupPanel() {
  const overview = useMissionStore((s) => s.overview);
  const theater = overview?.theater;
  const script = shipTrafficScriptForTheater(theater);
  const [applied, setApplied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const apply = useCallback(() => {
    if (!script) return;
    const added = addFrameworkTriggers([script]);
    setApplied(true);
    setMsg(added.length
      ? `Load trigger added — ${script.bundledFile} bundles on download.`
      : 'Load trigger was already present (nothing to add).');
  }, [script]);

  const card: React.CSSProperties = {
    background: '#222222', border: '1px solid #3a3a3a', borderRadius: 6,
    padding: '12px 14px', marginBottom: 14, fontSize: 13, color: '#d8d8d8', lineHeight: 1.55,
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e0e0e0' }}>
          Civilian Ship Traffic — curated shipping lanes
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#aaaaaa' }}>
          Real-world shipping lanes (TSS-style one-way pairs), anchorage queues at the ports, fishing fleets inshore. Lanes <b>pre-seed at mission start</b> — ships are slow, so the sea starts populated instead of filling over hours. Density-capped, controllable in-game from the <b>F10 "Ship Traffic"</b> menu. Runs happily alongside Civ Traffic.
        </p>
      </div>

      {/* One requirement (vs Civ Traffic's two — stock ships need no mod) */}
      <div style={{ ...card, background: 'rgba(210,153,34,0.06)', border: '1px solid rgba(210,153,34,0.3)' }}>
        <div style={{ color: '#e0b24a', fontWeight: 600, marginBottom: 6 }}>⚠ One setup requirement</div>
        <div>
          Country <b>EGYPT</b> placed in the <b>NEUTRALS</b> coalition — dynamic spawns join whatever coalition owns their spawn country. Set this in the Mission Editor's coalition setup. <b>No mods needed</b> — all vessels are stock DCS (bulkers, cargo ships, tankers incl. the Seawise Giant, Zvezdny boats).
        </div>
      </div>

      {!script ? (
        <div style={{ ...card, background: 'rgba(217,80,80,0.06)', border: '1px solid rgba(217,80,80,0.3)', color: '#e8b4b4' }}>
          {theater
            ? <>No shipping lanes for <b>{theater}</b> — landlocked or not covered yet.</>
            : <>Load a mission first so the theater can be detected.</>}
          <div style={{ marginTop: 8, fontSize: 12, color: '#c8b0b0' }}>
            Supported maps: {SUPPORTED.join(' · ')}. (Nevada and Afghanistan have no sea; Iraq's coastal sliver isn't covered yet.)
          </div>
        </div>
      ) : (
        <>
          <div style={card}>
            Detected theater: <b style={{ color: '#9cd0ff' }}>{theater}</b>. Applying wires a
            <b> MISSION START → DO SCRIPT FILE</b> trigger that loads
            <code style={{ color: '#cfe6d6', margin: '0 4px' }}>{script.bundledFile}</code>
            — the file bundles into the .miz automatically on download, same as AEGIS / TIC / Civ Traffic.
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
