/**
 * Radio Presets — per-player-flight preset table.
 *
 * Real jets (Hornet, Viper, etc.) carry 20–40 preset radio channels in
 * each radio. Pilots cycle channels in cockpit during a sortie — they
 * don't fly on a single fixed frequency. The Radio tab's old Comms
 * view treated each player flight like a tanker (single freq), which
 * doesn't reflect how flights actually operate.
 *
 * This section gives each player flight a 20-row preset table with
 * sensible auto-suggested defaults pulled from the mission:
 *   - Ch 1 = the flight's own primary (mission spawn freq)
 *   - Ch 2 = AWACS, if any in mission
 *   - Ch 3-4 = Tankers (refuelling-tasked groups)
 *   - Ch 5+ = Intra-package coordination — other player flights
 *   - Ch 20 = GUARD 243.000 (always)
 *
 * The user edits any cell inline. Currently REFERENCE-ONLY — these
 * values aren't written to the .miz radio preset slots; that's a
 * Phase D follow-up requiring per-unit unit-edit dispatch through the
 * existing edit pipeline.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { isPlayerGroup } from '../../utils/groups';
import type { MissionGroup, ClientUnit } from '../../types/mission';

interface Preset {
  ch: number;        // 1-20
  label: string;     // "STENNIS TWR", "SHELL 1-1", etc.
  freq: string;      // "305.000" — string so user can edit in place
  mod: 'AM' | 'FM';
}

const PRESET_COUNT = 20;
const GUARD_PRESET: Preset = { ch: 20, label: 'GUARD', freq: '243.000', mod: 'AM' };

function fmtFreq(hz: number): string {
  if (!hz) return '';
  return (hz / 1_000_000).toFixed(3);
}

/** Per-flight preset state: one Preset[] per radio number. */
type FlightPresets = Map<number, Preset[]>;

/** Aircraft-type → radio labels. Fast jets that DCS models with named
 *  COMMs use those names; everything else falls back to "COMM N". */
const RADIO_LABELS: Record<string, Record<number, string>> = {
  'FA-18C_hornet': { 1: 'COMM 1', 2: 'COMM 2' },
  'F-16C_50':      { 1: 'UHF',    2: 'VHF' },
  'F-15ESE':       { 1: 'UHF',    2: 'VHF' },
  'A-10C_2':       { 1: 'UHF',    2: 'VHF', 3: 'FM' },
  'A-10C':         { 1: 'UHF',    2: 'VHF', 3: 'FM' },
  'AV8BNA':        { 1: 'COMM 1', 2: 'COMM 2' },
  'AH-64D_BLK_II': { 1: 'UHF',    2: 'VHF', 3: 'FM 1', 4: 'FM 2' },
};

function radioLabel(aircraft: string, radioNum: number): string {
  const map = RADIO_LABELS[aircraft];
  return (map && map[radioNum]) || `COMM ${radioNum}`;
}

/** Build a single radio's preset list (PRESET_COUNT-padded). */
function buildPresetsForRadio(channels: { ch: number; freq_mhz: number; modulation: number; name: string }[]): Preset[] {
  const byCh = new Map<number, Preset>();
  for (const c of channels) {
    byCh.set(c.ch, {
      ch: c.ch,
      label: c.name || '',
      freq: c.freq_mhz > 0 ? c.freq_mhz.toFixed(3) : '',
      mod: c.modulation === 1 ? 'FM' : 'AM',
    });
  }
  const out: Preset[] = [];
  for (let ch = 1; ch <= PRESET_COUNT; ch++) {
    out.push(byCh.get(ch) || { ch, label: '', freq: '', mod: 'AM' });
  }
  // Standard convention: GUARD on the highest channel slot. Only stamp
  // if the .miz left it blank — never overwrite a value the designer set.
  if (!out[PRESET_COUNT - 1].freq) {
    out[PRESET_COUNT - 1] = { ...GUARD_PRESET, ch: PRESET_COUNT };
  }
  return out;
}

/**
 * Build a Map<radioNum, Preset[]> from the lead's .miz-stored presets.
 * Returns null when the lead carries no Radio data at all (caller falls
 * back to the auto-derived single-radio default).
 */
function buildPresetsFromMiz(leadClient: ClientUnit | undefined): FlightPresets | null {
  if (!leadClient || !leadClient.radioPresets || leadClient.radioPresets.length === 0) {
    return null;
  }
  const out: FlightPresets = new Map();
  for (const r of leadClient.radioPresets) {
    out.set(r.radio, buildPresetsForRadio(r.channels));
  }
  return out.size > 0 ? out : null;
}

/**
 * Build the auto-suggested preset list for a given flight using the
 * other groups in the mission. Returns exactly PRESET_COUNT entries
 * (20), padded with blanks. The user can edit any of them.
 */
function buildAutoPresets(flight: MissionGroup, allGroups: MissionGroup[]): Preset[] {
  const presets: Preset[] = [];

  // Ch 1 — own primary freq
  if (flight.frequency > 0) {
    const cs = flight.units[0]?.name || flight.groupName;
    presets.push({
      ch: 1,
      label: `${cs} (own)`,
      freq: fmtFreq(flight.frequency),
      mod: flight.modulation === 1 ? 'FM' : 'AM',
    });
  }

  // Ch 2 — AWACS, if any
  const awacs = allGroups.find((g) => (g.task || '').toLowerCase() === 'awacs');
  if (awacs && awacs.frequency > 0) {
    presets.push({
      ch: 2,
      label: 'AWACS',
      freq: fmtFreq(awacs.frequency),
      mod: awacs.modulation === 1 ? 'FM' : 'AM',
    });
  }

  // Ch 3-4 — Tankers (up to 2)
  const tankers = allGroups
    .filter((g) => (g.task || '').toLowerCase() === 'refueling' && g.frequency > 0)
    .slice(0, 2);
  for (const t of tankers) {
    const cs = t.units[0]?.name || t.groupName;
    presets.push({
      ch: presets.length + 1,
      label: cs,
      freq: fmtFreq(t.frequency),
      mod: t.modulation === 1 ? 'FM' : 'AM',
    });
  }

  // Ch 5+ — Other player flights (intra-package coordination). Skip
  // self; cap at the channels remaining before GUARD on ch 20.
  const others = allGroups
    .filter((g) =>
      g.groupId !== flight.groupId
      && isPlayerGroup(g)
      && g.coalition === flight.coalition
      && g.frequency > 0)
    .slice(0, PRESET_COUNT - presets.length - 1); // leave room for GUARD
  for (const g of others) {
    const cs = g.units[0]?.name || g.groupName;
    presets.push({
      ch: presets.length + 1,
      label: cs,
      freq: fmtFreq(g.frequency),
      mod: g.modulation === 1 ? 'FM' : 'AM',
    });
  }

  // Pad to PRESET_COUNT - 1, then add GUARD on the last channel
  while (presets.length < PRESET_COUNT - 1) {
    presets.push({ ch: presets.length + 1, label: '', freq: '', mod: 'AM' });
  }
  presets.push(GUARD_PRESET);
  return presets;
}

export function RadioPresetsSection() {
  const groups = useMissionStore((s) => s.groups);
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const addEdit = useEditStore((s) => s.addEdit);

  // Convert a UI preset list to the backend radioPresets edit shape.
  // Strips placeholder rows (empty / 0 freq) so the .miz only carries
  // channels the user actually set — matches DCS's "missing key = unset"
  // convention rather than dumping 20× freq=0 rows into the Lua.
  const dispatchRadioPresetsEdit = useCallback(
    (groupId: number, radioNum: number, presets: Preset[]) => {
      const channels = presets
        .map((p) => {
          const freq = parseFloat(p.freq);
          return {
            ch: p.ch,
            freq_mhz: isFinite(freq) && freq > 0 ? freq : 0,
            modulation: p.mod === 'FM' ? 1 : 0,
            name: (p.label || '').trim(),
          };
        })
        .filter((c) => c.freq_mhz > 0);
      addEdit({
        field: 'radioPresets',
        groupId,
        value: { radio: radioNum, channels },
      } as any);
    },
    [addEdit],
  );

  const playerFlights = useMemo(() =>
    groups.filter((g) =>
      isPlayerGroup(g)
      && (g.category === 'plane' || g.category === 'helicopter')),
    [groups]);

  // Find the lead client unit for a flight by groupName so we can read
  // its .miz-stored radio presets. Lead = first matching client unit
  // for the group; mission designers typically program presets on the
  // lead and DCS replicates them to wingmen at runtime.
  const findLeadClient = useCallback((flight: MissionGroup): ClientUnit | undefined => {
    return clientUnits.find((u) => u.groupName === flight.groupName);
  }, [clientUnits]);

  // Resolve a flight's initial preset state. Reads every radio the lead
  // has in the .miz; if the lead carries nothing, falls back to a single
  // auto-derived COMM 1 (Radio[1]).
  const resolveInitial = useCallback((flight: MissionGroup): FlightPresets => {
    const lead = findLeadClient(flight);
    const fromMiz = buildPresetsFromMiz(lead);
    if (fromMiz) return fromMiz;
    const single: FlightPresets = new Map();
    single.set(1, buildAutoPresets(flight, groups));
    return single;
  }, [findLeadClient, groups]);

  // Per-flight preset state. groupId → (radioNum → Preset[]).
  const [presetsByFlight, setPresetsByFlight] = useState<Map<number, FlightPresets>>(new Map());
  const initialised = useRef<Set<number>>(new Set());

  useEffect(() => {
    setPresetsByFlight((prev) => {
      const next = new Map(prev);
      for (const f of playerFlights) {
        if (!initialised.current.has(f.groupId)) {
          next.set(f.groupId, resolveInitial(f));
          initialised.current.add(f.groupId);
        }
      }
      return next;
    });
  }, [playerFlights, resolveInitial]);

  const updatePreset = useCallback(
    (groupId: number, radioNum: number, ch: number, patch: Partial<Preset>) => {
      setPresetsByFlight((prev) => {
        const next = new Map(prev);
        const flightMap = next.get(groupId);
        if (!flightMap) return prev;
        const list = flightMap.get(radioNum);
        if (!list) return prev;
        const updated = list.map((p) => p.ch === ch ? { ...p, ...patch } : p);
        const newFlightMap = new Map(flightMap);
        newFlightMap.set(radioNum, updated);
        next.set(groupId, newFlightMap);
        // Auto-dispatch this radio's full preset list. Backend handler
        // is idempotent — each edit replaces the unit's Radio[N]
        // sub-blocks wholesale.
        dispatchRadioPresetsEdit(groupId, radioNum, updated);
        return next;
      });
    },
    [dispatchRadioPresetsEdit],
  );

  const resetFlight = useCallback((flight: MissionGroup) => {
    setPresetsByFlight((prev) => {
      const next = new Map(prev);
      const fresh = resolveInitial(flight);
      next.set(flight.groupId, fresh);
      // Dispatch every radio so the edit queue reverts too.
      for (const [radioNum, presets] of fresh) {
        dispatchRadioPresetsEdit(flight.groupId, radioNum, presets);
      }
      return next;
    });
  }, [resolveInitial, dispatchRadioPresetsEdit]);

  // Cross-flight clipboard: copy one card's presets (all radios), paste
  // into another. Stored as in-memory state (not navigator.clipboard) so
  // clipboard permissions don't matter and we don't pollute OS clipboard.
  const [presetClipboard, setPresetClipboard] = useState<FlightPresets | null>(null);
  const [copiedFromName, setCopiedFromName] = useState<string>('');

  const copyFlight = useCallback((flight: MissionGroup) => {
    const flightMap = presetsByFlight.get(flight.groupId);
    if (!flightMap) return;
    // Deep clone so subsequent edits to source don't bleed into the clipboard.
    const cloned: FlightPresets = new Map();
    for (const [r, list] of flightMap) {
      cloned.set(r, list.map((p) => ({ ...p })));
    }
    setPresetClipboard(cloned);
    setCopiedFromName(flight.units[0]?.name || flight.groupName);
  }, [presetsByFlight]);

  const pasteFlight = useCallback((flight: MissionGroup) => {
    if (!presetClipboard) return;
    setPresetsByFlight((prev) => {
      const next = new Map(prev);
      // Only paste into radios that exist on the destination flight, so
      // a Hornet's COMM2 doesn't get force-injected into a single-radio
      // helo. Source radios with no destination match are dropped.
      const destFlightMap = next.get(flight.groupId) || new Map<number, Preset[]>();
      const newFlightMap: FlightPresets = new Map();
      for (const [radioNum, destList] of destFlightMap) {
        const srcList = presetClipboard.get(radioNum);
        const cloned = (srcList || destList).map((p) => ({ ...p }));
        newFlightMap.set(radioNum, cloned);
        if (srcList) {
          dispatchRadioPresetsEdit(flight.groupId, radioNum, cloned);
        }
      }
      next.set(flight.groupId, newFlightMap);
      return next;
    });
  }, [presetClipboard, dispatchRadioPresetsEdit]);

  const clipboardSummary = useMemo(() => {
    if (!presetClipboard) return null;
    const totals = Array.from(presetClipboard.values())
      .map((list) => list.filter((p) => p.freq).length);
    const totalCh = totals.reduce((a, b) => a + b, 0);
    return `${presetClipboard.size} radio${presetClipboard.size !== 1 ? 's' : ''} / ${totalCh} ch`;
  }, [presetClipboard]);

  if (playerFlights.length === 0) {
    return (
      <div style={{
        padding: '16px 20px', marginBottom: 16,
        background: '#222222', border: '1px solid #3a3a3a',
        color: '#aaaaaa', fontSize: 13, fontStyle: 'italic',
      }}>
        No player flights in this mission — radio preset cards will appear
        here when player flights are added.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 12, color: '#ffa500', fontWeight: 600,
          letterSpacing: 1, textTransform: 'uppercase',
        }}>
          Radio Presets — Per Flight
        </div>
        <span style={{ fontSize: 11, color: '#888888' }}>
          Edits write to every radio of every unit in the flight on download
          {presetClipboard && copiedFromName && clipboardSummary && (
            <span style={{ marginLeft: 12, color: '#d29922' }}>
              clipboard: {copiedFromName} ({clipboardSummary})
            </span>
          )}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 12,
                    gridTemplateColumns: playerFlights.length > 1
                      ? 'repeat(auto-fit, minmax(420px, 1fr))' : '1fr' }}>
        {playerFlights.map((flight) => {
          const flightMap = presetsByFlight.get(flight.groupId) || new Map<number, Preset[]>();
          const callsign = flight.units[0]?.name || flight.groupName;
          const aircraft = flight.units[0]?.type || '';
          // Render radios in numeric order (Radio[1] before Radio[2] etc.)
          const radioNums = Array.from(flightMap.keys()).sort((a, b) => a - b);
          return (
            <div key={flight.groupId} style={{
              background: '#1a1a1a', border: '1px solid #3a3a3a',
            }}>
              <div style={{
                padding: '8px 12px', borderBottom: '1px solid #3a3a3a',
                background: '#262626',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>
                    {callsign}
                  </span>
                  <span style={{ fontSize: 12, color: '#aaaaaa', marginLeft: 8 }}>
                    {flight.units.length}× {aircraft}
                  </span>
                  {radioNums.length > 1 && (
                    <span style={{
                      fontSize: 10, color: '#d29922', marginLeft: 8,
                      padding: '1px 6px', border: '1px solid #d2992233', borderRadius: 3,
                      letterSpacing: 0.5,
                    }}>
                      {radioNums.length} RADIOS
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => copyFlight(flight)}
                    style={{
                      background: 'transparent', border: '1px solid #4a4a4a',
                      color: '#4a8fd4', padding: '3px 10px', fontSize: 11,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                    title="Copy this flight's full preset table (all radios) to the clipboard so it can be pasted into other flights"
                  >Copy</button>
                  <button
                    onClick={() => pasteFlight(flight)}
                    disabled={!presetClipboard}
                    style={{
                      background: 'transparent', border: '1px solid #4a4a4a',
                      color: presetClipboard ? '#3fb950' : '#555',
                      padding: '3px 10px', fontSize: 11,
                      cursor: presetClipboard ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit',
                      opacity: presetClipboard ? 1 : 0.5,
                    }}
                    title={presetClipboard
                      ? `Paste presets from ${copiedFromName} into this flight (matches radios by number; extras are dropped)`
                      : 'Copy a flight first, then paste here'}
                  >Paste</button>
                  <button
                    onClick={() => resetFlight(flight)}
                    style={{
                      background: 'transparent', border: '1px solid #4a4a4a',
                      color: '#cccccc', padding: '3px 10px', fontSize: 11,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                    title="Re-read preset values from the .miz, dropping any unsaved edits"
                  >Reset</button>
                </div>
              </div>
              {radioNums.map((radioNum, idx) => {
                const presets = flightMap.get(radioNum) || [];
                return (
                  <div key={radioNum} style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #3a3a3a',
                  }}>
                    <div style={{
                      padding: '6px 12px',
                      background: '#202833',
                      borderBottom: '1px solid #3a3a3a',
                      fontSize: 11, fontWeight: 700, color: '#6ab4f0',
                      letterSpacing: 1, textTransform: 'uppercase',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span>{radioLabel(aircraft, radioNum)}</span>
                      <span style={{ color: '#666', fontSize: 10, fontWeight: 400 }}>
                        Radio[{radioNum}]
                      </span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#262626' }}>
                          <th style={th}>CH</th>
                          <th style={{ ...th, textAlign: 'left' }}>LABEL</th>
                          <th style={th}>FREQ (MHz)</th>
                          <th style={th}>MOD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {presets.map((p) => (
                          <tr key={`${radioNum}-${p.ch}`} style={{ borderTop: '1px solid #2a2a2a' }}>
                            <td style={{ ...td, textAlign: 'center', fontFamily: "'B612 Mono', monospace",
                                          color: p.ch === PRESET_COUNT ? '#d29922' : '#aaaaaa', fontWeight: 600 }}>
                              {p.ch}
                            </td>
                            <td style={td}>
                              <input
                                type="text"
                                value={p.label}
                                onChange={(e) => updatePreset(flight.groupId, radioNum, p.ch, { label: e.target.value })}
                                placeholder=""
                                style={cellInput}
                              />
                            </td>
                            <td style={td}>
                              <input
                                type="text"
                                value={p.freq}
                                onChange={(e) => updatePreset(flight.groupId, radioNum, p.ch, { freq: e.target.value })}
                                placeholder=""
                                style={{ ...cellInput, fontFamily: "'B612 Mono', monospace",
                                         textAlign: 'center', width: 90 }}
                              />
                            </td>
                            <td style={td}>
                              <select
                                value={p.mod}
                                onChange={(e) => updatePreset(flight.groupId, radioNum, p.ch, { mod: e.target.value as 'AM' | 'FM' })}
                                style={{ ...cellInput, width: 60, cursor: 'pointer' }}
                              >
                                <option value="AM">AM</option>
                                <option value="FM">FM</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '5px 8px', textAlign: 'center', fontSize: 11,
  color: '#cccccc', borderBottom: '1px solid #4a4a4a',
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const td: React.CSSProperties = { padding: '2px 4px', verticalAlign: 'middle' };
const cellInput: React.CSSProperties = {
  width: '100%', background: '#1a1a1a', border: '1px solid #3a3a3a',
  color: '#e0e0e0', padding: '3px 6px', fontSize: 12, fontFamily: 'inherit',
};
