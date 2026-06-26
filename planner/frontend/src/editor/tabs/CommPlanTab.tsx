/**
 * Comm Plan tab (v1.19.77) — editor for the SOP's wing comm plan.
 *
 * Modelled directly on real squadron radio-preset kneeboards (VF-103
 * Tomcat + VMFA-224 Hornet cards). Two layers:
 *
 *   NET CATALOG — wing-wide named nets ("Texaco 1 = 332.100 AM").
 *     AI-variant services are separate nets (DCS AI ATC and human SRS
 *     controllers can't share a freq — squadrons offset them +.050).
 *     MIDS voice nets carry a channel, not a frequency (Hornet
 *     intra-flight rides MIDS A/B).
 *
 *   BUTTON MAPS — per airframe × per radio: preset button → net.
 *     Fixed buttons are the briefing contract ("push 3" = Marshal in
 *     every cockpit). Counts vary per radio (Tomcat Rear 24 / Front
 *     20) and placement is band-constrained — the editor warns when a
 *     net's frequency falls outside what the radio can tune.
 *
 * Operates on the ACTIVE SOP (same convention as SOP Check). All
 * edits persist immediately via sopStore.updateSop → localStorage.
 */

import { useMemo, useState, useEffect } from 'react';
import { useSopStore, useActiveSop } from '../../sop/sopStore';
import { useMissionStore } from '../../store/missionStore';
import { isPlayerGroup } from '../../utils/groups';
import {
  makeEmptyCommPlan, makeId,
  type CommNet, type CommNetKind, type CommPlan, type RadioButtonMap, type SOP,
} from '../../sop/types';

/* ── Band data (warn-only) ─────────────────────────────────────────────
 * Tunable ranges per airframe radio. Coarse on purpose — the point is
 * catching "VHF net on a UHF-only radio", not modelling every radio
 * quirk. No entry for an airframe/radio → no warnings (permissive).
 */
type Band = { lo: number; hi: number };
const RADIO_BANDS: Record<string, Record<number, Band[]>> = {
  // Both Hornet ARC-210s tune V/UHF (30-400 coarse).
  'FA-18C_hornet': { 1: [{ lo: 30, hi: 400 }], 2: [{ lo: 30, hi: 400 }] },
  // Viper: COM1 UHF-only, COM2 VHF AM.
  'F-16C_50': { 1: [{ lo: 225, hi: 400 }], 2: [{ lo: 116, hi: 152 }] },
  // Tomcat: Front (pilot, radio 1) UHF ARC-159; Rear (RIO, radio 2)
  // V/UHF ARC-182 — which is why the VHF JTAC nets live on the Rear.
  'F-14B': { 1: [{ lo: 225, hi: 400 }], 2: [{ lo: 30, hi: 400 }] },
  'F-14A-135-GR': { 1: [{ lo: 225, hi: 400 }], 2: [{ lo: 30, hi: 400 }] },
  // A-10: UHF / VHF-AM / VHF-FM.
  'A-10C_2': { 1: [{ lo: 225, hi: 400 }], 2: [{ lo: 116, hi: 152 }], 3: [{ lo: 30, hi: 76 }] },
  'A-10C':   { 1: [{ lo: 225, hi: 400 }], 2: [{ lo: 116, hi: 152 }], 3: [{ lo: 30, hi: 76 }] },
  'F-15ESE': { 1: [{ lo: 225, hi: 400 }], 2: [{ lo: 116, hi: 400 }] },
  'AV8BNA':  { 1: [{ lo: 30, hi: 400 }], 2: [{ lo: 30, hi: 400 }] },
  'AH-64D_BLK_II': { 1: [{ lo: 225, hi: 400 }], 2: [{ lo: 116, hi: 152 }], 3: [{ lo: 30, hi: 88 }], 4: [{ lo: 30, hi: 88 }] },
};

function bandWarning(aircraft: string, radio: number, net: CommNet | undefined): string | null {
  if (!net || net.kind !== 'radio' || !net.frequency) return null;
  const bands = RADIO_BANDS[aircraft]?.[radio];
  if (!bands) return null;
  const ok = bands.some((b) => net.frequency! >= b.lo && net.frequency! <= b.hi);
  return ok ? null : `${net.frequency.toFixed(3)} MHz is outside this radio's tunable range`;
}

/* Decimal-tolerant frequency field. The model stores a number, but a plain
 * controlled `value={number}` text input drops the decimal point: typing
 * "265." re-stringifies the parsed 265 back to "265", so the "." never sticks
 * (you could only enter whole MHz). This keeps a local text buffer so the
 * in-progress "265." survives, commits the parsed number alongside, and
 * re-syncs from the model when the field isn't being edited (SOP swap / AI fill). */
function FreqInput({ value, onCommit, style, placeholder }: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const [text, setText] = useState(value != null ? String(value) : '');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value != null ? String(value) : '');
  }, [value, editing]);
  return (
    <input
      style={style}
      placeholder={placeholder}
      value={text}
      inputMode="decimal"
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        const v = parseFloat(text);
        onCommit(isFinite(v) ? v : undefined);
      }}
      onChange={(e) => {
        const t = e.target.value;
        // digits + a single optional dot (or empty) — lets "265." persist
        if (t === '' || /^\d*\.?\d*$/.test(t)) {
          setText(t);
          const v = parseFloat(t);
          onCommit(isFinite(v) ? v : undefined);
        }
      }}
    />
  );
}

/* ── Shared styles (match SopTab / kneeboard-adjacent surfaces) ──────── */
const MONO = "'B612 Mono', 'Consolas', monospace";
const th: React.CSSProperties = {
  textAlign: 'left', padding: '5px 8px', color: '#888888',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
  borderBottom: '2px solid #3a3a3a',
};
const td: React.CSSProperties = { padding: '3px 8px', verticalAlign: 'middle' };
const cellInput: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 3,
  color: '#e0e0e0', fontSize: 13, padding: '3px 6px', width: '100%', boxSizing: 'border-box',
};
const monoInput: React.CSSProperties = { ...cellInput, fontFamily: MONO };
const smallBtn: React.CSSProperties = {
  background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 3,
  color: '#cccccc', fontSize: 12, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit',
};

const KIND_LABEL: Record<CommNetKind, string> = {
  radio: 'Radio', midsA: 'MIDS A', midsB: 'MIDS B',
};

export function CommPlanTab() {
  const activeSop = useActiveSop();
  const updateSop = useSopStore((s) => s.updateSop);
  const groups = useMissionStore((s) => s.groups);

  // Player airframes present in the loaded mission — offered as quick
  // picks when adding a button map. Free-text entry still allowed so
  // the SOP can carry maps for airframes not in THIS mission.
  const missionAirframes = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      if (isPlayerGroup(g) && g.units[0]?.type) set.add(g.units[0].type);
    }
    return [...set].sort();
  }, [groups]);

  const [newMapAircraft, setNewMapAircraft] = useState('');
  const [newMapRadio, setNewMapRadio] = useState('1');
  const [newMapLabel, setNewMapLabel] = useState('');

  if (!activeSop) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 14, padding: 16, maxWidth: 640 }}>
        No active SOP. Activate one on the SOP tab — the comm plan lives inside
        the SOP so the whole wing shares one net catalog and preset ladder.
      </div>
    );
  }

  const plan: CommPlan = activeSop.commPlan ?? makeEmptyCommPlan();
  const netById = new Map(plan.nets.map((n) => [n.id, n]));

  /** Persist a plan mutation onto the active SOP. */
  const commit = (next: CommPlan) => {
    updateSop({ ...activeSop, commPlan: next } as SOP);
  };

  /* ── Net catalog ops ── */
  const addNet = () => {
    commit({ ...plan, nets: [...plan.nets, { id: makeId(), name: '', kind: 'radio', frequency: undefined, modulation: 'AM' }] });
  };
  const updateNet = (id: string, patch: Partial<CommNet>) => {
    commit({ ...plan, nets: plan.nets.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  };
  const deleteNet = (id: string) => {
    // Also strip the net from every button map so maps never dangle.
    commit({
      nets: plan.nets.filter((n) => n.id !== id),
      maps: plan.maps.map((m) => ({
        ...m,
        buttons: Object.fromEntries(Object.entries(m.buttons).filter(([, nid]) => nid !== id)),
      })),
    });
  };

  /* ── Button map ops ── */
  const addMap = () => {
    const aircraft = newMapAircraft.trim();
    const radio = parseInt(newMapRadio, 10);
    if (!aircraft || !Number.isInteger(radio) || radio < 1) return;
    if (plan.maps.some((m) => m.aircraft === aircraft && m.radio === radio)) return;
    commit({
      ...plan,
      maps: [...plan.maps, { aircraft, radio, radioLabel: newMapLabel.trim() || undefined, buttons: {} }],
    });
    setNewMapLabel('');
  };
  const deleteMap = (aircraft: string, radio: number) => {
    commit({ ...plan, maps: plan.maps.filter((m) => !(m.aircraft === aircraft && m.radio === radio)) });
  };
  const setButton = (aircraft: string, radio: number, pb: number, netId: string) => {
    commit({
      ...plan,
      maps: plan.maps.map((m) => {
        if (m.aircraft !== aircraft || m.radio !== radio) return m;
        const buttons = { ...m.buttons };
        if (netId) buttons[pb] = netId;
        else delete buttons[pb];
        return { ...m, buttons };
      }),
    });
  };
  /** Copy another map's buttons into this one (seed R2 from R1, or a
   *  new airframe from an existing one). */
  const copyMapFrom = (target: RadioButtonMap, sourceKey: string) => {
    const [srcAircraft, srcRadioStr] = sourceKey.split('§');
    const src = plan.maps.find((m) => m.aircraft === srcAircraft && m.radio === parseInt(srcRadioStr, 10));
    if (!src) return;
    commit({
      ...plan,
      maps: plan.maps.map((m) =>
        m.aircraft === target.aircraft && m.radio === target.radio
          ? { ...m, buttons: { ...src.buttons } }
          : m,
      ),
    });
  };

  /** Rows to render for a map: every programmed button plus one blank
   *  row past the max so the user can keep extending (Tomcat Rear
   *  runs to 24; the ARC-182 takes 30). Minimum 20 rows shown. */
  const rowsForMap = (m: RadioButtonMap): number[] => {
    const maxSet = Math.max(0, ...Object.keys(m.buttons).map(Number));
    const count = Math.max(20, maxSet + 1);
    return Array.from({ length: count }, (_, i) => i + 1);
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: '#e0e0e0' }}>
        Comm Plan — {activeSop.name}
      </h2>
      <p style={{ margin: '0 0 16px', color: '#aaaaaa', fontSize: 13, lineHeight: 1.5, maxWidth: 760 }}>
        Net catalog + per-airframe preset button maps. Preset ladders, DTC COMM pages,
        and the radio kneeboard card all derive from this when the SOP is active.
        Fixed buttons are the briefing contract — "push 3" means the same net in every cockpit.
      </p>

      {/* ── NET CATALOG ─────────────────────────────────────────── */}
      <div style={{
        background: '#0a1218', border: '1px solid #1a2a3a', borderRadius: 6,
        padding: '12px 14px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#4a8fd4', letterSpacing: 0.5 }}>
            NET CATALOG ({plan.nets.length})
          </div>
          <button onClick={addNet} style={{ ...smallBtn, color: '#3fb950', borderColor: '#2a5a3a' }}>+ Net</button>
        </div>
        {plan.nets.length === 0 ? (
          <div style={{ color: '#888', fontSize: 13, padding: '8px 0' }}>
            No nets defined. Add the wing's named nets — services (Tower, Marshal, ATIS),
            tankers (Texaco 1…), tactical (Vic 1…), and AI-variant services as their own
            entries (e.g. "AI Tower CVN" offset +.050 from "Tower CVN").
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '34%' }}>Net</th>
                <th style={{ ...th, width: 110 }}>Kind</th>
                <th style={{ ...th, width: 130 }}>Freq (MHz) / Ch</th>
                <th style={{ ...th, width: 80 }}>Mod</th>
                <th style={th}>Notes</th>
                <th style={{ ...th, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {plan.nets.map((n) => (
                <tr key={n.id} style={{ borderBottom: '1px solid #1a2230' }}>
                  <td style={td}>
                    <input style={cellInput} value={n.name} placeholder="e.g. Marshal CVN"
                      onChange={(e) => updateNet(n.id, { name: e.target.value })} />
                  </td>
                  <td style={td}>
                    <select style={cellInput} value={n.kind}
                      onChange={(e) => {
                        const kind = e.target.value as CommNetKind;
                        updateNet(n.id, kind === 'radio'
                          ? { kind, midsChannel: undefined }
                          : { kind, frequency: undefined, modulation: undefined });
                      }}>
                      {(Object.keys(KIND_LABEL) as CommNetKind[]).map((k) => (
                        <option key={k} value={k}>{KIND_LABEL[k]}</option>
                      ))}
                    </select>
                  </td>
                  <td style={td}>
                    {n.kind === 'radio' ? (
                      <FreqInput style={monoInput} value={n.frequency} placeholder="332.100"
                        onCommit={(v) => updateNet(n.id, { frequency: v })} />
                    ) : (
                      <input style={monoInput} value={n.midsChannel ?? ''} placeholder="ch 1-126"
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          updateNet(n.id, { midsChannel: Number.isInteger(v) ? v : undefined });
                        }} />
                    )}
                  </td>
                  <td style={td}>
                    {n.kind === 'radio' ? (
                      <select style={cellInput} value={n.modulation ?? 'AM'}
                        onChange={(e) => updateNet(n.id, { modulation: e.target.value as 'AM' | 'FM' })}>
                        <option value="AM">AM</option>
                        <option value="FM">FM</option>
                      </select>
                    ) : <span style={{ color: '#555' }}>—</span>}
                  </td>
                  <td style={td}>
                    <input style={cellInput} value={n.notes ?? ''} placeholder=""
                      onChange={(e) => updateNet(n.id, { notes: e.target.value })} />
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button onClick={() => deleteNet(n.id)} title="Delete net (removes it from all button maps)"
                      style={{ background: 'transparent', border: 'none', color: '#d95050', cursor: 'pointer', fontSize: 14 }}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── BUTTON MAPS ─────────────────────────────────────────── */}
      <div style={{
        background: '#0a1218', border: '1px solid #1a2a3a', borderRadius: 6,
        padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#4a8fd4', letterSpacing: 0.5, marginRight: 'auto' }}>
            BUTTON MAPS ({plan.maps.length})
          </div>
          <input list="commplan-airframes" style={{ ...cellInput, width: 180 }}
            value={newMapAircraft} placeholder="Aircraft type"
            onChange={(e) => setNewMapAircraft(e.target.value)} />
          <datalist id="commplan-airframes">
            {missionAirframes.map((a) => <option key={a} value={a} />)}
          </datalist>
          <input style={{ ...cellInput, width: 70 }} value={newMapRadio} placeholder="Radio #"
            onChange={(e) => setNewMapRadio(e.target.value)} />
          <input style={{ ...cellInput, width: 120 }} value={newMapLabel} placeholder='Label ("Rear")'
            onChange={(e) => setNewMapLabel(e.target.value)} />
          <button onClick={addMap} style={{ ...smallBtn, color: '#3fb950', borderColor: '#2a5a3a' }}
            disabled={!newMapAircraft.trim()}>
            + Radio Map
          </button>
        </div>

        {plan.maps.length === 0 ? (
          <div style={{ color: '#888', fontSize: 13, padding: '8px 0' }}>
            No button maps yet. Add one per radio per airframe
            (e.g. FA-18C_hornet radio 1, FA-18C_hornet radio 2).
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {plan.maps.map((m) => (
              <div key={`${m.aircraft}-${m.radio}`} style={{
                border: '1px solid #1a2a3a', borderRadius: 6, padding: '8px 10px',
                minWidth: 330, flex: '0 1 360px', background: '#0d1622',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0' }}>
                    {m.aircraft} · <span style={{ color: '#9cd0ff' }}>{m.radioLabel || `Radio ${m.radio}`}</span>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <select
                      title="Copy buttons from another map"
                      style={{ ...cellInput, width: 110, fontSize: 11 }}
                      value=""
                      onChange={(e) => { if (e.target.value) copyMapFrom(m, e.target.value); }}>
                      <option value="">copy from…</option>
                      {plan.maps
                        .filter((s) => !(s.aircraft === m.aircraft && s.radio === m.radio))
                        .map((s) => (
                          <option key={`${s.aircraft}§${s.radio}`} value={`${s.aircraft}§${s.radio}`}>
                            {s.aircraft.slice(0, 10)} R{s.radio}
                          </option>
                        ))}
                    </select>
                    <button onClick={() => deleteMap(m.aircraft, m.radio)} title="Delete this radio map"
                      style={{ background: 'transparent', border: 'none', color: '#d95050', cursor: 'pointer', fontSize: 14 }}>
                      ×
                    </button>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 36 }}>PB</th>
                      <th style={th}>Net</th>
                      <th style={{ ...th, width: 100 }}>Freq</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsForMap(m).map((pb) => {
                      const netId = m.buttons[pb] || '';
                      const net = netId ? netById.get(netId) : undefined;
                      const warn = bandWarning(m.aircraft, m.radio, net);
                      return (
                        <tr key={pb} style={{ borderBottom: '1px solid #15202e' }}>
                          <td style={{ ...td, fontFamily: MONO, color: '#888' }}>{pb}</td>
                          <td style={td}>
                            <select
                              style={{
                                ...cellInput, fontSize: 12,
                                ...(warn ? { borderColor: '#d29922', color: '#d29922' } : {}),
                              }}
                              title={warn ?? undefined}
                              value={netId}
                              onChange={(e) => setButton(m.aircraft, m.radio, pb, e.target.value)}>
                              <option value="">—</option>
                              {plan.nets.filter((n) => n.name).map((n) => (
                                <option key={n.id} value={n.id}>{n.name}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ ...td, fontFamily: MONO, color: warn ? '#d29922' : '#cccccc', whiteSpace: 'nowrap' }}>
                            {net?.kind === 'radio' && net.frequency
                              ? `${net.frequency.toFixed(3)} ${net.modulation ?? 'AM'}`
                              : net?.kind && net.kind !== 'radio'
                                ? `MIDS ${net.kind === 'midsA' ? 'A' : 'B'}${net.midsChannel ? ` ch${net.midsChannel}` : ''}`
                                : ''}
                            {warn && <span title={warn}> ⚠</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
