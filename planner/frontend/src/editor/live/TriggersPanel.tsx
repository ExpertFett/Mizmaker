/**
 * TriggersPanel — DM-side trigger fire control (Phase 9).
 *
 * Replaces the DCS F10 comm menu Fett hates with a clean web panel. Each
 * trigger the DM has tagged as "DM-fireable" (Editor → Triggers → DM Fire)
 * shows up here with a one-click Fire button.
 *
 * Fire mechanism:
 *   - Panel POSTs flagIndex to /api/groups/<gid>/profiles/<pid>/fire_trigger
 *   - Backend uses Olympus' spawnGroundUnits to spawn a Soldier M4 at a
 *     magic coord (lat 89° + flag×1e-6) that encodes the flag index
 *   - The dcsopt-dm-bridge.lua script (loaded into the mission) catches
 *     the S_EVENT_BIRTH, decodes the flag from the lat, sets the user
 *     flag the (Editor-modified) trigger condition watches, despawns the
 *     signal unit
 *
 * Trigger list sources:
 *   - Primary: same-tab .miz session, fetched via /api/triggers
 *   - Manual fallback: DM types a flag index for missions they didn't
 *     upload (still works as long as the mission has the bridge script
 *     loaded and the trigger condition includes the flag check)
 *
 * The "DM-fireable" tag flow is half-built in this push — the panel can
 * fire ANY flag, but the Editor's "DM Fire" checkbox + on-download
 * trigger-condition modification ships in 9b. For tonight: DM picks a
 * mission that ALREADY has triggers watching for specific flag indices,
 * loads the bridge script, and uses this panel to fire them.
 */

import { useEffect, useMemo, useState } from 'react';
import { fireTrigger, type GroupSummary, type ServerProfile, can } from '../../api/groups';
import { useMissionStore } from '../../store/missionStore';

interface Trigger {
  id: number | string;
  name?: string;
  comment?: string;
  type?: string;
  conditions?: unknown;
  actions?: unknown;
  /** Hint from the Editor — flag the trigger watches when fired by DM. */
  dmFlag?: number;
}

const C = {
  bg: 'rgba(13,19,29,0.96)',
  border: '#243349',
  borderHi: '#3a6ea5',
  accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.18)',
  text: '#dce6f2',
  textDim: '#8aa0ba',
  amber: '#ffd24a',
  green: '#3fb950',
  red: '#e0554f',
};

export function TriggersPanel({ group, profile, onClose }: {
  group: GroupSummary; profile: ServerProfile; onClose: () => void;
}) {
  const sessionId = useMissionStore((s) => s.sessionId);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string>('');
  const [search, setSearch] = useState('');
  const [manualFlag, setManualFlag] = useState('');
  const [lastFire, setLastFire] = useState<{ flag: number; ok: boolean; msg: string } | null>(null);
  const canFire = can(group.role, 'command');

  // DM-fireable hints — persisted in editStore via the Editor's Triggers tab,
  // shadowed in localStorage. Each trigger id maps to { dmFire: bool, flagIndex }.
  type DmHints = Record<string, { dmFire: boolean; flagIndex: number }>;
  const [hints] = useState<DmHints>(() => {
    try { return JSON.parse(localStorage.getItem('dcsopt.editor.triggerDmFire') || '{}'); }
    catch { return {}; }
  });

  // Fetch triggers from the session-loaded mission. The /api/triggers
  // endpoint is sessionId-keyed — Live-without-mission users see only the
  // manual-flag fallback.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true); setLoadErr('');
    fetch(`/api/triggers?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d) => {
        if (cancelled) return;
        const rules = (d.rules || []) as Trigger[];
        // Merge in DM hints by id.
        const merged = rules.map((t) => {
          const h = hints[String(t.id)];
          return h?.dmFire ? { ...t, dmFlag: h.flagIndex } : t;
        });
        setTriggers(merged);
      })
      .catch((e) => !cancelled && setLoadErr(e instanceof Error ? e.message : 'load failed'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [sessionId, hints]);

  const dmFireable = useMemo(() => triggers.filter((t) => t.dmFlag), [triggers]);
  const others = useMemo(() => triggers.filter((t) => !t.dmFlag), [triggers]);
  const filter = (arr: Trigger[]) => arr.filter((t) =>
    !search.trim() ||
    String(t.id).includes(search) ||
    (t.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (t.comment || '').toLowerCase().includes(search.toLowerCase())
  );

  const fire = async (flagIndex: number) => {
    try {
      const r = await fireTrigger(group.id, profile.id, flagIndex);
      setLastFire({ flag: flagIndex, ok: r.ok, msg: r.ok ? `Spawned signal at ${r.encodedLat.toFixed(6)}°` : 'spawn failed' });
    } catch (e) {
      setLastFire({ flag: flagIndex, ok: false, msg: e instanceof Error ? e.message : 'failed' });
    }
  };

  const downloadBridge = async () => {
    try {
      const r = await fetch('/api/assets/dcsopt-dm-bridge.lua');
      if (!r.ok) throw new Error('bridge script unavailable');
      const text = await r.text();
      const blob = new Blob([text], { type: 'text/x-lua' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'dcsopt-dm-bridge.lua';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Bridge script download failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: C.accentDim, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text }}>
        <span>🎬 TRIGGERS</span>
        <span onClick={onClose} style={{ cursor: 'pointer', color: C.textDim, fontWeight: 400 }}>×</span>
      </div>

      {/* Bridge-script + capability banner */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.textDim, lineHeight: 1.55 }}>
        Bridge mechanism: spawn-signal at lat ≈ 89°. Mission must load
        <span onClick={downloadBridge} style={{ color: C.accent, cursor: 'pointer', fontWeight: 600, marginLeft: 4 }}>
          dcsopt-dm-bridge.lua
        </span>{' '}
        for fires to actually take effect.
        {!canFire && <div style={{ color: C.red, marginTop: 4 }}>Your role can&apos;t fire triggers (read-only view).</div>}
      </div>

      {/* Manual flag fire — always available */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4, letterSpacing: 0.5 }}>QUICK FIRE BY FLAG INDEX</div>
        <div style={{ display: 'flex', gap: 5 }}>
          <input value={manualFlag} onChange={(e) => setManualFlag(e.target.value.replace(/[^0-9]/g, ''))}
                 placeholder="e.g. 9042"
                 style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`, color: C.text, padding: '4px 7px', fontSize: 11, borderRadius: 3, outline: 'none', fontFamily: 'ui-monospace, monospace' }} />
          <button onClick={() => { const n = Number(manualFlag); if (n > 0) fire(n); }}
                  disabled={!canFire || !manualFlag}
                  style={{ background: canFire && manualFlag ? C.accentDim : 'transparent', border: `1px solid ${canFire && manualFlag ? C.accent : C.border}`, color: canFire && manualFlag ? '#cfe6ff' : C.textDim, padding: '4px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, borderRadius: 3, cursor: canFire && manualFlag ? 'pointer' : 'not-allowed' }}>
            FIRE
          </button>
        </div>
      </div>

      {lastFire && (
        <div style={{ padding: '5px 10px', fontSize: 10, color: lastFire.ok ? C.green : C.red, borderBottom: `1px solid ${C.border}`, background: lastFire.ok ? 'rgba(63,185,80,0.06)' : 'rgba(224,85,79,0.06)' }}>
          {lastFire.ok ? '✓' : '✗'} flag {lastFire.flag}: {lastFire.msg}
        </div>
      )}

      {/* Mission triggers list (when a session is loaded) */}
      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
               placeholder={sessionId ? `Search ${triggers.length} triggers…` : 'Load a .miz in this tab to see triggers'}
               disabled={!sessionId}
               style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`, color: sessionId ? C.text : C.textDim, padding: '4px 7px', fontSize: 11, borderRadius: 3, outline: 'none', fontFamily: 'inherit' }} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading && <div style={{ padding: 12, color: C.textDim, fontSize: 11, textAlign: 'center' }}>Loading triggers…</div>}
        {loadErr && <div style={{ padding: 12, color: C.red, fontSize: 11 }}>{loadErr}</div>}
        {!sessionId && !loading && (
          <div style={{ padding: 14, fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
            No mission session in this tab. Manual-fire by flag still works above —
            useful when the mission was loaded by another DM and you know which
            flag the trigger watches.
          </div>
        )}

        {dmFireable.length > 0 && (
          <Section title={`DM-FIREABLE (${dmFireable.length})`} accent={C.amber}>
            {filter(dmFireable).map((t) => (
              <TriggerRow key={String(t.id)} t={t} canFire={canFire} onFire={() => t.dmFlag && fire(t.dmFlag)} />
            ))}
          </Section>
        )}

        {others.length > 0 && (
          <Section title={`OTHER TRIGGERS (${others.length})`} accent={C.textDim}>
            {filter(others).slice(0, 60).map((t) => (
              <TriggerRow key={String(t.id)} t={t} canFire={false} onFire={undefined}
                          subtitle="No DM flag tagged — set one in Editor → Triggers" />
            ))}
            {others.length > 60 && (
              <div style={{ padding: '4px 10px', fontSize: 10, color: C.textDim, textAlign: 'center' }}>
                + {others.length - 60} more (filter to narrow)
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: accent, background: 'rgba(255,255,255,0.02)' }}>{title}</div>
      {children}
    </div>
  );
}

function TriggerRow({ t, canFire, onFire, subtitle }: { t: Trigger; canFire: boolean; onFire?: () => void; subtitle?: string }) {
  const name = t.name || t.comment || `Rule ${t.id}`;
  return (
    <div style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6, borderTop: `1px solid rgba(36,51,73,0.5)`, fontSize: 11, color: C.text }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ color: C.textDim, fontSize: 9, letterSpacing: 0.3 }}>
          id {t.id}{t.dmFlag ? ` · flag ${t.dmFlag}` : ''}{t.type ? ` · ${t.type}` : ''}
        </div>
        {subtitle && <div style={{ color: C.textDim, fontSize: 9, marginTop: 1, fontStyle: 'italic' }}>{subtitle}</div>}
      </div>
      {onFire && (
        <button onClick={onFire} disabled={!canFire}
                style={{ background: canFire ? 'rgba(255,210,74,0.10)' : 'transparent', border: `1px solid ${canFire ? C.amber : C.border}`, color: canFire ? C.amber : C.textDim, padding: '3px 9px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, borderRadius: 3, cursor: canFire ? 'pointer' : 'not-allowed' }}>
          FIRE
        </button>
      )}
    </div>
  );
}
