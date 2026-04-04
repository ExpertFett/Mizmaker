import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { isPlayerGroup } from '../../utils/groups';

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
  return ROLE_COLORS[role] || '#5a7a8a';
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
  const groups = useMissionStore((s) => s.groups);
  const addEdit = useEditStore((s) => s.addEdit);
  const [overrides, setOverrides] = useState<Map<number, { frequency?: number; modulation?: number }>>(new Map());
  const [coalitionFilter, setCoalitionFilter] = useState<'all' | 'blue' | 'red'>('all');
  const [result, setResult] = useState('');

  // Build rows from air groups with frequency
  const allRows = useMemo<FreqRow[]>(() => {
    const rows: FreqRow[] = [];
    for (const g of groups) {
      if (g.frequency <= 0 && g.category !== 'plane' && g.category !== 'helicopter') continue;
      if (g.category === 'vehicle' || g.category === 'static') continue;
      const player = isPlayerGroup(g);
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

    // Sort: support first (preserve their freqs), then players, then AI
    const sorted = [...allRows].sort((a, b) => roleSortPriority(a.roleLabel) - roleSortPriority(b.roleLabel));

    for (const row of sorted) {
      const mod = row.modulation;
      let freq = row.frequency;
      if (freq <= 0) continue;

      const key = freqKey(freq, mod);
      if (usedFreqs.has(key)) {
        // Find next available AM frequency
        while (amIdx < amPool.length && usedFreqs.has(freqKey(amPool[amIdx], mod))) amIdx++;
        if (amIdx < amPool.length) {
          freq = amPool[amIdx];
          amIdx++;
        }
        next.set(row.groupId, { frequency: freq, modulation: mod });
      }
      usedFreqs.add(freqKey(freq, mod));
    }

    setOverrides(next);
    if (next.size === 0) {
      setResult('No conflicts found — all frequencies are unique');
    } else {
      setResult(`Deconflicted — ${next.size} frequency change${next.size !== 1 ? 's' : ''} proposed`);
    }
  }, [allRows]);

  // Apply changes
  const handleApply = useCallback(() => {
    if (overrides.size === 0) { setResult('No changes to apply'); return; }
    let count = 0;
    for (const [groupId, ov] of overrides) {
      if (ov.frequency !== undefined) {
        addEdit({ groupId, field: 'groupFrequency', value: ov.frequency } as any);
        count++;
      }
      if (ov.modulation !== undefined) {
        addEdit({ groupId, field: 'groupModulation', value: ov.modulation } as any);
        count++;
      }
    }
    setResult(`Applied ${count} change${count !== 1 ? 's' : ''} — download .miz to save`);
  }, [overrides, addEdit]);

  // Reset
  const handleReset = useCallback(() => {
    setOverrides(new Map());
    setResult('');
  }, []);

  if (allRows.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 14, padding: 16 }}>
        No air groups with radio frequencies found in this mission.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
            Comm Card / Frequency Matrix
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#5a7a8a' }}>
            View and deconflict radio frequencies across all flights.
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
          <button onClick={handleAutoDeconflict} style={btnStyle}>
            Auto Deconflict
          </button>
          {overrides.size > 0 && (
            <>
              <button onClick={handleReset} style={{ ...btnStyle, color: '#5a7a8a', borderColor: '#2a3a4a' }}>
                Reset
              </button>
              <button onClick={handleApply} style={applyBtnStyle}>
                Apply {overrides.size} Change{overrides.size !== 1 ? 's' : ''}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Conflict banner */}
      {conflictCount > 0 && (
        <div style={{
          padding: '8px 14px', marginBottom: 12, borderRadius: 4,
          background: 'rgba(210, 153, 34, 0.1)', border: '1px solid #d29922',
          color: '#d29922', fontSize: 13,
        }}>
          {conflictCount} frequency conflict{conflictCount !== 1 ? 's' : ''} detected — multiple groups share the same frequency
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
          <SectionHeader label="AI FLIGHTS" count={aiRows.length} color="#5a7a8a" />
          <FreqTable rows={aiRows} getEffective={getEffective} isConflict={isConflict} updateFreq={updateFreq} updateMod={updateMod} overrides={overrides} />
        </>
      )}
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
      <span style={{ fontSize: 10, color: '#5a7a8a', fontWeight: 400 }}>({count})</span>
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
              <td style={{ ...cellStyle, textAlign: 'center', color: '#5a7a8a', width: 30 }}>{i + 1}</td>
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
                color: row.coalition === 'blue' ? '#4a8fd4' : row.coalition === 'red' ? '#d95050' : '#5a7a8a',
              }}>
                {row.coalition.toUpperCase()}
              </td>
              <td style={{ ...cellStyle, textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  {freqChanged && (
                    <span style={{
                      fontSize: 11, color: '#5a7a8a', fontFamily: 'monospace',
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
                      borderColor: conflict ? '#d95050' : freqChanged ? '#d29922' : '#1a2a3a',
                      color: freqChanged ? '#d29922' : '#ccdae8',
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
  color: '#5a7a8a',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  textAlign: 'center',
  borderBottom: '2px solid #1a2a3a',
};

const cellStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 13,
  color: '#ccdae8',
  borderBottom: '1px solid #12202e',
};

const inputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#ccdae8',
  fontSize: 13,
  fontFamily: 'monospace',
  padding: '4px 6px',
  textAlign: 'center',
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  background: '#1a3a5a',
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
  color: '#080f1c',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 14px',
  fontWeight: 600,
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#ccdae8',
  fontSize: 13,
  padding: '6px 8px',
  outline: 'none',
  fontFamily: 'inherit',
};
