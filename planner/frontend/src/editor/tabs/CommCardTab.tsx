import { useState, useMemo, useCallback } from 'react';
import { useEditStore } from '../../store/editStore';
import { useEffectiveGroups } from '../../store/effectiveGroups';
import { useActiveSop } from '../../sop/sopStore';
import { isPlayerGroup } from '../../utils/groups';
import { RadioPresetsSection } from './RadioPresetsSection';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface FreqRow {
  groupId: number;
  groupName: string;
  coalition: string;
  category: string;
  task: string;
  roleLabel: string;
  isPlayer: boolean;
  frequency: number;   // MHz
  modulation: number;  // 0=AM, 1=FM
  unitCount: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getRoleLabel(task: string, category: string, isPlayer: boolean): string {
  if (isPlayer) return 'PLAYER';
  const t = task.toLowerCase();
  if (t === 'refueling') return 'TANKER';
  if (t === 'awacs') return 'AWACS';
  if (t === 'cap') return 'CAP';
  if (t === 'cas') return 'CAS';
  if (t === 'sead') return 'SEAD';
  if (t === 'strike' || t === 'pinpoint strike') return 'STRIKE';
  if (t === 'antiship strike') return 'ANTISHIP';
  if (t === 'escort') return 'ESCORT';
  if (t === 'intercept') return 'INTERCEPT';
  if (t === 'transport') return 'TRANSPORT';
  if (category === 'helicopter') return 'HELO';
  if (category === 'ship') return 'NAVAL';
  return t.toUpperCase() || category.toUpperCase();
}

function roleSortPriority(role: string): number {
  if (role === 'AWACS') return 0;
  if (role === 'TANKER') return 1;
  if (role === 'PLAYER') return 2;
  return 3;
}

const ROLE_COLORS: Record<string, string> = {
  TANKER: '#d29922',
  AWACS: '#a371f7',
  PLAYER: '#4a8fd4',
  CAP: '#58a6ff',
  CAS: '#3fb950',
  SEAD: '#f78166',
  STRIKE: '#ff6b8a',
};

function roleColor(role: string): string {
  return ROLE_COLORS[role] || '#aaaaaa';
}

function freqKey(freq: number, mod: number): string {
  return `${freq.toFixed(3)}-${mod}`;
}

/** Generate stepped frequency pool */
function generateFreqPool(start: number, end: number, step: number): number[] {
  const pool: number[] = [];
  for (let f = start; f <= end; f = Math.round((f + step) * 1000) / 1000) {
    pool.push(f);
  }
  return pool;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CommCardTab() {
  // v1.19.66 — overlay staged groupFrequency edits so the matrix
  // reflects what's queued in editStore (was missionStore-only).
  const groups = useEffectiveGroups();
  const addEdit = useEditStore((s) => s.addEdit);
  const activeSop = useActiveSop();
  const [overrides, setOverrides] = useState<Map<number, { frequency?: number; modulation?: number }>>(new Map());
  const [coalitionFilter, setCoalitionFilter] = useState<'all' | 'blue' | 'red'>('all');
  const [result, setResult] = useState('');

  // Build rows from air groups with frequency. Player flights are
  // filtered out — they're handled by RadioPresetsSection (one card
  // per flight, 20-channel preset table). The legacy matrix here is
  // for tankers/AWACS/AI where a single primary freq is the model.
  const allRows = useMemo<FreqRow[]>(() => {
    const rows: FreqRow[] = [];
    for (const g of groups) {
      if (g.frequency <= 0 && g.category !== 'plane' && g.category !== 'helicopter') continue;
      if (g.category === 'vehicle' || g.category === 'static') continue;
      const player = isPlayerGroup(g);
      if (player) continue;  // skip — handled by RadioPresetsSection
      rows.push({
        groupId: g.groupId,
        groupName: g.groupName,
        coalition: g.coalition,
        category: g.category,
        task: g.task || '',
        roleLabel: getRoleLabel(g.task || '', g.category, player),
        isPlayer: player,
        frequency: g.frequency,
        modulation: g.modulation,
        unitCount: g.units.length,
      });
    }
    rows.sort((a, b) => {
      const pa = roleSortPriority(a.roleLabel);
      const pb = roleSortPriority(b.roleLabel);
      if (pa !== pb) return pa - pb;
      return a.frequency - b.frequency;
    });
    return rows;
  }, [groups]);

  // Apply overrides to get effective values
  const getEffective = useCallback((row: FreqRow) => {
    const ov = overrides.get(row.groupId);
    return {
      frequency: ov?.frequency ?? row.frequency,
      modulation: ov?.modulation ?? row.modulation,
    };
  }, [overrides]);

  // Detect conflicts
  const conflictMap = useMemo(() => {
    const freqUsers = new Map<string, number[]>();
    for (const row of allRows) {
      const eff = overrides.get(row.groupId);
      const freq = eff?.frequency ?? row.frequency;
      const mod = eff?.modulation ?? row.modulation;
      if (freq <= 0) continue;
      const key = freqKey(freq, mod);
      const arr = freqUsers.get(key) || [];
      arr.push(row.groupId);
      freqUsers.set(key, arr);
    }
    const conflicts = new Map<string, number[]>();
    for (const [key, ids] of freqUsers) {
      if (ids.length > 1) conflicts.set(key, ids);
    }
    return conflicts;
  }, [allRows, overrides]);

  // Check if a group is in conflict
  const isConflict = useCallback((groupId: number, freq: number, mod: number) => {
    if (freq <= 0) return false;
    const key = freqKey(freq, mod);
    const users = conflictMap.get(key);
    return users != null && users.length > 1 && users.includes(groupId);
  }, [conflictMap]);

  const conflictCount = conflictMap.size;

  // Detailed conflict breakdown — which groups share each conflicting frequency
  const conflictDetails = useMemo(() => {
    const rowById = new Map<number, FreqRow>();
    for (const r of allRows) rowById.set(r.groupId, r);
    const details: { freq: number; mod: number; members: FreqRow[] }[] = [];
    for (const [key, ids] of conflictMap) {
      const [freqStr, modStr] = key.split('-');
      const freq = parseFloat(freqStr);
      const mod = parseInt(modStr, 10);
      const members = ids.map((id) => rowById.get(id)!).filter(Boolean);
      details.push({ freq, mod, members });
    }
    // Sort by frequency ascending
    details.sort((a, b) => a.freq - b.freq);
    return details;
  }, [conflictMap, allRows]);

  // Filter by coalition
  const filteredRows = useMemo(() => {
    if (coalitionFilter === 'all') return allRows;
    return allRows.filter((r) => r.coalition === coalitionFilter);
  }, [allRows, coalitionFilter]);

  // Section groups
  const supportRows = filteredRows.filter((r) => r.roleLabel === 'TANKER' || r.roleLabel === 'AWACS');
  const playerRows = filteredRows.filter((r) => r.isPlayer);
  const aiRows = filteredRows.filter((r) => !r.isPlayer && r.roleLabel !== 'TANKER' && r.roleLabel !== 'AWACS');

  // Update override
  const updateFreq = useCallback((groupId: number, freq: number) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const existing = next.get(groupId) || {};
      next.set(groupId, { ...existing, frequency: freq });
      return next;
    });
    setResult('');
  }, []);

  const updateMod = useCallback((groupId: number, mod: number) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const existing = next.get(groupId) || {};
      next.set(groupId, { ...existing, modulation: mod });
      return next;
    });
    setResult('');
  }, []);

  // Auto-deconflict
  const handleAutoDeconflict = useCallback(() => {
    const next = new Map<number, { frequency?: number; modulation?: number }>();
    const usedFreqs = new Set<string>();
    const amPool = generateFreqPool(225.000, 399.975, 0.025);
    let amIdx = 0;

    // Build SOP lookups (first-word callsign → SOP freq/mod)
    const sopByCallsign = new Map<string, { freq: number; mod: number }>();
    let sopHits = 0;
    if (activeSop) {
      const addSop = (cs: string, freq?: number, modStr?: string) => {
        if (!freq || freq <= 0) return;
        const mod = modStr === 'FM' ? 1 : 0;
        sopByCallsign.set(cs.toLowerCase(), { freq, mod });
      };
      for (const t of activeSop.tankers || []) addSop(t.callsign, t.frequency, t.modulation);
      for (const a of activeSop.supportAssets || []) addSop(a.callsign, a.frequency, a.modulation);
      for (const f of activeSop.flights) addSop(f.callsign, f.defaultFreq, f.defaultMod);
    }

    const firstWord = (name: string) => name.split(/[-\s]/)[0].toLowerCase();

    // Sort: support first (preserve their freqs), then players, then AI
    const sorted = [...allRows].sort((a, b) => roleSortPriority(a.roleLabel) - roleSortPriority(b.roleLabel));

    for (const row of sorted) {
      let mod = row.modulation;
      let freq = row.frequency;
      let fromSop = false;

      // If SOP defines a freq for this callsign, use it (even if it creates a new conflict we'll
      // resolve below)
      const sopEntry = sopByCallsign.get(firstWord(row.groupName));
      if (sopEntry) {
        freq = sopEntry.freq;
        mod = sopEntry.mod;
        fromSop = true;
      }

      if (freq <= 0) continue;

      const key = freqKey(freq, mod);
      const conflict = usedFreqs.has(key);

      if (conflict) {
        // SOP freqs win over auto-bumping — bump non-SOP rows off this freq below.
        // For now, if this row is SOP-driven and we have an existing conflict, we
        // try to bump; if not, we find next AM freq.
        while (amIdx < amPool.length && usedFreqs.has(freqKey(amPool[amIdx], mod))) amIdx++;
        if (amIdx < amPool.length) {
          freq = amPool[amIdx];
          amIdx++;
        }
      }

      // Queue an override only for fields that actually differ. Earlier
      // versions blanket-set both frequency and modulation whenever
      // either changed — the unchanged half then dispatched as a no-op
      // edit on download, which the user saw as a "X edit(s) made no
      // change: groupModulation target field not found" warning.
      const patch: { frequency?: number; modulation?: number } = {};
      if (freq !== row.frequency) patch.frequency = freq;
      if (mod !== row.modulation) patch.modulation = mod;
      if (Object.keys(patch).length > 0) {
        next.set(row.groupId, patch);
        if (fromSop) sopHits++;
      } else if (fromSop) {
        // SOP matches what's already set — still counts as an SOP match for the result
        sopHits++;
      }

      usedFreqs.add(freqKey(freq, mod));
    }

    setOverrides(next);
    if (next.size === 0) {
      setResult(
        sopHits > 0
          ? `All frequencies already align with SOP "${activeSop!.name}"`
          : 'No conflicts found — all frequencies are unique',
      );
    } else {
      setResult(
        `Deconflicted — ${next.size} frequency change${next.size !== 1 ? 's' : ''} proposed` +
        (sopHits > 0 ? ` (${sopHits} from SOP "${activeSop!.name}")` : ''),
      );
    }
  }, [allRows, activeSop]);

  // Apply changes
  const handleApply = useCallback(() => {
    if (overrides.size === 0) { setResult('No changes to apply'); return; }
    // Index rows by id so we can compare against the source values and
    // skip dispatching a key whose override accidentally matches the
    // current value (e.g. user typed then re-typed the same number).
    const rowById = new Map<number, FreqRow>();
    for (const r of allRows) rowById.set(r.groupId, r);

    let count = 0;
    for (const [groupId, ov] of overrides) {
      const row = rowById.get(groupId);
      if (ov.frequency !== undefined && (!row || ov.frequency !== row.frequency)) {
        addEdit({ groupId, field: 'groupFrequency', value: ov.frequency } as any);
        count++;
      }
      if (ov.modulation !== undefined && (!row || ov.modulation !== row.modulation)) {
        addEdit({ groupId, field: 'groupModulation', value: ov.modulation } as any);
        count++;
      }
    }
    if (count === 0) {
      setResult('No effective changes — overrides matched current values');
    } else {
      setResult(`Applied ${count} change${count !== 1 ? 's' : ''} — download .miz to save`);
    }
  }, [overrides, allRows, addEdit]);

  // Reset
  const handleReset = useCallback(() => {
    setOverrides(new Map());
    setResult('');
  }, []);

  if (allRows.length === 0) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 14, padding: 16 }}>
        No air groups with radio frequencies found in this mission.
      </div>
    );
  }

  return (
    <div>
      {/* Per Fett's Phase G feedback: AI/tanker/AWACS frequency matrix
          comes FIRST (you set those once for the mission), then
          per-player-flight preset cards below. The previous order had
          presets on top which buried the deconflict workflow. */}

      {/* Legacy frequency matrix — covers tankers, AWACS, and AI flights
          where a single primary freq is the right model. Player flights
          are filtered out (they're handled by RadioPresetsSection below). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
            Tanker / AWACS / AI Frequencies
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#aaaaaa' }}>
            Single-freq groups (tankers, AWACS, AI flights). For player flights, use the preset cards above.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={coalitionFilter}
            onChange={(e) => setCoalitionFilter(e.target.value as any)}
            style={selectStyle}
          >
            <option value="all">Both Sides</option>
            <option value="blue">Blue Only</option>
            <option value="red">Red Only</option>
          </select>
          <button
            onClick={handleAutoDeconflict}
            title={activeSop
              ? `Apply SOP "${activeSop.name}" frequencies where callsigns match, then deconflict remaining groups.`
              : 'Resolve frequency conflicts by reassigning duplicate flights to unused AM frequencies.'}
            style={btnStyle}
          >
            Auto Deconflict{activeSop ? ' (SOP)' : ''}
          </button>
          {overrides.size > 0 && (
            <>
              <button onClick={handleReset} style={{ ...btnStyle, color: '#aaaaaa', borderColor: '#3a3a3a' }}>
                Reset
              </button>
              <button onClick={handleApply} style={applyBtnStyle}>
                Apply {overrides.size} Change{overrides.size !== 1 ? 's' : ''}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Conflict detail — which groups share each conflicting frequency */}
      {conflictCount > 0 && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, borderRadius: 4,
          background: 'rgba(217, 80, 80, 0.08)', border: '1px solid rgba(217, 80, 80, 0.4)',
          fontSize: 12,
        }}>
          <div style={{ color: '#d95050', fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
            {conflictCount} frequency conflict{conflictCount !== 1 ? 's' : ''} detected
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {conflictDetails.map((d) => (
              <div key={`${d.freq}-${d.mod}`} style={{
                display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
              }}>
                <span style={{
                  fontFamily: "'B612 Mono', monospace", color: '#d95050', fontWeight: 700,
                  minWidth: 110, fontSize: 13,
                }}>
                  {d.freq.toFixed(3)} {d.mod === 0 ? 'AM' : 'FM'}
                </span>
                <span style={{ color: '#aaaaaa', fontSize: 11 }}>
                  {d.members.length} groups:
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {d.members.map((m, idx) => (
                    <span key={m.groupId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: roleColor(m.roleLabel),
                        border: `1px solid ${roleColor(m.roleLabel)}55`,
                        padding: '1px 4px', borderRadius: 2,
                      }}>
                        {m.roleLabel}
                      </span>
                      <span style={{ color: '#e0e0e0' }}>{m.groupName}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 600,
                        color: m.coalition === 'blue' ? '#4a8fd4' : m.coalition === 'red' ? '#d95050' : '#aaaaaa',
                      }}>
                        ({m.coalition.toUpperCase()})
                      </span>
                      {idx < d.members.length - 1 && (
                        <span style={{ color: '#4a4a4a', marginLeft: 4 }}>|</span>
                      )}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Result message */}
      {result && (
        <div style={{
          padding: '8px 14px', marginBottom: 12, borderRadius: 4,
          background: result.includes('Applied') ? 'rgba(63, 185, 80, 0.1)' : 'rgba(74, 143, 212, 0.1)',
          border: `1px solid ${result.includes('Applied') ? '#3fb950' : '#4a8fd4'}`,
          color: result.includes('Applied') ? '#3fb950' : '#4a8fd4',
          fontSize: 13,
        }}>
          {result}
        </div>
      )}

      {/* Support assets */}
      {supportRows.length > 0 && (
        <>
          <SectionHeader label="SUPPORT ASSETS" count={supportRows.length} color="#d29922" />
          <FreqTable rows={supportRows} getEffective={getEffective} isConflict={isConflict} updateFreq={updateFreq} updateMod={updateMod} overrides={overrides} />
        </>
      )}

      {/* Player flights */}
      {playerRows.length > 0 && (
        <>
          <SectionHeader label="PLAYER FLIGHTS" count={playerRows.length} color="#4a8fd4" />
          <FreqTable rows={playerRows} getEffective={getEffective} isConflict={isConflict} updateFreq={updateFreq} updateMod={updateMod} overrides={overrides} />
        </>
      )}

      {/* AI flights */}
      {aiRows.length > 0 && (
        <>
          <SectionHeader label="AI FLIGHTS" count={aiRows.length} color="#aaaaaa" />
          <FreqTable rows={aiRows} getEffective={getEffective} isConflict={isConflict} updateFreq={updateFreq} updateMod={updateMod} overrides={overrides} />
        </>
      )}

      {/* Per-flight radio preset cards. Each player flight gets a
          20-channel preset table (own primary, AWACS, tankers, sister
          flights, GUARD). Copy/paste between cards mirrors a setup once
          the lead flight is configured. */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #3a3a3a' }}>
        <RadioPresetsSection />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 1,
      padding: '8px 0 4px', marginTop: 8, borderBottom: `1px solid ${color}33`,
      display: 'flex', gap: 8, alignItems: 'center',
    }}>
      {label}
      <span style={{ fontSize: 10, color: '#aaaaaa', fontWeight: 400 }}>({count})</span>
    </div>
  );
}

function FreqTable({ rows, getEffective, isConflict, updateFreq, updateMod, overrides }: {
  rows: FreqRow[];
  getEffective: (row: FreqRow) => { frequency: number; modulation: number };
  isConflict: (groupId: number, freq: number, mod: number) => boolean;
  updateFreq: (groupId: number, freq: number) => void;
  updateMod: (groupId: number, mod: number) => void;
  overrides: Map<number, { frequency?: number; modulation?: number }>;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
      <thead>
        <tr>
          <th style={thStyle}>#</th>
          <th style={{ ...thStyle, textAlign: 'left' }}>CALLSIGN / GROUP</th>
          <th style={{ ...thStyle, width: 70 }}>ROLE</th>
          <th style={{ ...thStyle, width: 60 }}>SIDE</th>
          <th style={{ ...thStyle, width: 120 }}>FREQ (MHz)</th>
          <th style={{ ...thStyle, width: 60 }}>MOD</th>
          <th style={{ ...thStyle, width: 30 }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const eff = getEffective(row);
          const conflict = isConflict(row.groupId, eff.frequency, eff.modulation);
          const hasOverride = overrides.has(row.groupId);
          const freqChanged = hasOverride && overrides.get(row.groupId)?.frequency !== undefined && overrides.get(row.groupId)?.frequency !== row.frequency;
          return (
            <tr key={row.groupId} style={{
              background: conflict
                ? 'rgba(217, 80, 80, 0.12)'
                : freqChanged
                  ? 'rgba(210, 153, 34, 0.08)'
                  : i % 2 === 0 ? 'transparent' : 'rgba(74, 143, 212, 0.03)',
              borderLeft: conflict ? '3px solid #d95050' : freqChanged ? '3px solid #d29922' : '3px solid transparent',
            }}>
              <td style={{ ...cellStyle, textAlign: 'center', color: '#aaaaaa', width: 30 }}>{i + 1}</td>
              <td style={{ ...cellStyle, fontWeight: 600 }}>{row.groupName}</td>
              <td style={{ ...cellStyle, textAlign: 'center' }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: roleColor(row.roleLabel),
                  border: `1px solid ${roleColor(row.roleLabel)}44`,
                  padding: '1px 6px', borderRadius: 3,
                }}>
                  {row.roleLabel}
                </span>
              </td>
              <td style={{
                ...cellStyle, textAlign: 'center', fontSize: 10, fontWeight: 600,
                color: row.coalition === 'blue' ? '#4a8fd4' : row.coalition === 'red' ? '#d95050' : '#aaaaaa',
              }}>
                {row.coalition.toUpperCase()}
              </td>
              <td style={{ ...cellStyle, textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  {freqChanged && (
                    <span style={{
                      fontSize: 11, color: '#aaaaaa', fontFamily: "'B612 Mono', monospace",
                      textDecoration: 'line-through', opacity: 0.7,
                    }}>
                      {row.frequency.toFixed(3)}
                    </span>
                  )}
                  {freqChanged && <span style={{ color: '#d29922', fontSize: 11 }}>→</span>}
                  <input
                    type="number"
                    step={0.025}
                    min={30}
                    max={400}
                    value={eff.frequency || ''}
                    onChange={(e) => updateFreq(row.groupId, parseFloat(e.target.value) || 0)}
                    style={{
                      ...inputStyle,
                      width: freqChanged ? 90 : 100,
                      borderColor: conflict ? '#d95050' : freqChanged ? '#d29922' : '#3a3a3a',
                      color: freqChanged ? '#d29922' : '#e0e0e0',
                    }}
                  />
                </div>
              </td>
              <td style={{ ...cellStyle, textAlign: 'center' }}>
                <select
                  value={eff.modulation}
                  onChange={(e) => updateMod(row.groupId, Number(e.target.value))}
                  style={{ ...selectStyle, fontSize: 11, padding: '3px 4px' }}
                >
                  <option value={0}>AM</option>
                  <option value={1}>FM</option>
                </select>
              </td>
              <td style={{ ...cellStyle, textAlign: 'center', width: 30 }}>
                {conflict && (
                  <span title="Frequency conflict — shared with another group" style={{
                    color: '#fff', fontSize: 10, fontWeight: 700,
                    background: '#d95050', borderRadius: '50%',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18,
                  }}>!</span>
                )}
                {!conflict && freqChanged && (
                  <span title="Frequency will be changed" style={{
                    color: '#d29922', fontSize: 12,
                  }}>*</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const thStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 10,
  fontWeight: 600,
  color: '#aaaaaa',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  textAlign: 'center',
  borderBottom: '2px solid #3a3a3a',
};

const cellStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 13,
  color: '#e0e0e0',
  borderBottom: '1px solid #222222',
};

const inputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: 13,
  fontFamily: "'B612 Mono', monospace",
  padding: '4px 6px',
  textAlign: 'center',
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  background: '#4a4a4a',
  border: '1px solid #4a8fd4',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 12px',
  fontFamily: 'inherit',
};

const applyBtnStyle: React.CSSProperties = {
  background: '#d29922',
  border: '1px solid #d29922',
  borderRadius: 4,
  color: '#1a1a1a',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 14px',
  fontWeight: 600,
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: 13,
  padding: '6px 8px',
  outline: 'none',
  fontFamily: 'inherit',
};
