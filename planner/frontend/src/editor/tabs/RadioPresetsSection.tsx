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
import { isPlayerGroup } from '../../utils/groups';
import type { MissionGroup } from '../../types/mission';

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

  const playerFlights = useMemo(() =>
    groups.filter((g) =>
      isPlayerGroup(g)
      && (g.category === 'plane' || g.category === 'helicopter')),
    [groups]);

  // Per-flight preset state. Stored as a Map keyed by groupId.
  // Auto-populated on first render; user edits override.
  const [presetsByFlight, setPresetsByFlight] = useState<Map<number, Preset[]>>(new Map());
  const initialised = useRef<Set<number>>(new Set());

  useEffect(() => {
    setPresetsByFlight((prev) => {
      const next = new Map(prev);
      for (const f of playerFlights) {
        if (!initialised.current.has(f.groupId)) {
          next.set(f.groupId, buildAutoPresets(f, groups));
          initialised.current.add(f.groupId);
        }
      }
      return next;
    });
  }, [playerFlights, groups]);

  const updatePreset = useCallback((groupId: number, ch: number, patch: Partial<Preset>) => {
    setPresetsByFlight((prev) => {
      const next = new Map(prev);
      const list = next.get(groupId);
      if (!list) return prev;
      const updated = list.map((p) => p.ch === ch ? { ...p, ...patch } : p);
      next.set(groupId, updated);
      return next;
    });
  }, []);

  const resetFlight = useCallback((flight: MissionGroup) => {
    setPresetsByFlight((prev) => {
      const next = new Map(prev);
      next.set(flight.groupId, buildAutoPresets(flight, groups));
      return next;
    });
  }, [groups]);

  // Cross-flight clipboard: copy one card's presets, paste into another.
  // Stored as in-memory state (not navigator.clipboard) so it works on
  // hosts where clipboard permissions aren't granted, and so we don't
  // pollute the user's OS clipboard with JSON blobs.
  const [presetClipboard, setPresetClipboard] = useState<Preset[] | null>(null);
  const [copiedFromName, setCopiedFromName] = useState<string>('');

  const copyFlight = useCallback((flight: MissionGroup) => {
    const list = presetsByFlight.get(flight.groupId);
    if (!list) return;
    setPresetClipboard(list.map((p) => ({ ...p })));
    setCopiedFromName(flight.units[0]?.name || flight.groupName);
  }, [presetsByFlight]);

  const pasteFlight = useCallback((flight: MissionGroup) => {
    if (!presetClipboard) return;
    setPresetsByFlight((prev) => {
      const next = new Map(prev);
      // Preserve channel numbers from the destination — copy paste only
      // mirrors label/freq/mod, since a flight's own ch1 should still be
      // ch1 on the destination card.
      const cloned = presetClipboard.map((p) => ({ ...p }));
      next.set(flight.groupId, cloned);
      return next;
    });
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
          Reference only — these don't write to the .miz radio slots yet
          {presetClipboard && copiedFromName && (
            <span style={{ marginLeft: 12, color: '#d29922' }}>
              clipboard: {copiedFromName} ({presetClipboard.length} ch)
            </span>
          )}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 12,
                    gridTemplateColumns: playerFlights.length > 1
                      ? 'repeat(auto-fit, minmax(420px, 1fr))' : '1fr' }}>
        {playerFlights.map((flight) => {
          const presets = presetsByFlight.get(flight.groupId) || [];
          const callsign = flight.units[0]?.name || flight.groupName;
          const aircraft = flight.units[0]?.type || '';
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
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => copyFlight(flight)}
                    style={{
                      background: 'transparent', border: '1px solid #4a4a4a',
                      color: '#4a8fd4', padding: '3px 10px', fontSize: 11,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                    title="Copy this flight's preset list to the clipboard so it can be pasted into other flights"
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
                      ? `Paste presets from ${copiedFromName} into this flight (overwrites current preset table)`
                      : 'Copy a flight first, then paste here'}
                  >Paste</button>
                  <button
                    onClick={() => resetFlight(flight)}
                    style={{
                      background: 'transparent', border: '1px solid #4a4a4a',
                      color: '#cccccc', padding: '3px 10px', fontSize: 11,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                    title="Re-derive preset list from current mission groups"
                  >Reset</button>
                </div>
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
                    <tr key={p.ch} style={{ borderTop: '1px solid #2a2a2a' }}>
                      <td style={{ ...td, textAlign: 'center', fontFamily: "'B612 Mono', monospace",
                                    color: p.ch === 20 ? '#d29922' : '#aaaaaa', fontWeight: 600 }}>
                        {p.ch}
                      </td>
                      <td style={td}>
                        <input
                          type="text"
                          value={p.label}
                          onChange={(e) => updatePreset(flight.groupId, p.ch, { label: e.target.value })}
                          placeholder=""
                          style={cellInput}
                        />
                      </td>
                      <td style={td}>
                        <input
                          type="text"
                          value={p.freq}
                          onChange={(e) => updatePreset(flight.groupId, p.ch, { freq: e.target.value })}
                          placeholder=""
                          style={{ ...cellInput, fontFamily: "'B612 Mono', monospace",
                                   textAlign: 'center', width: 90 }}
                        />
                      </td>
                      <td style={td}>
                        <select
                          value={p.mod}
                          onChange={(e) => updatePreset(flight.groupId, p.ch, { mod: e.target.value as 'AM' | 'FM' })}
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
