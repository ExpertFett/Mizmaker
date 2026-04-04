import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { isCarrierGroup, getAirRoleLabel } from '../../utils/groups';

/** Extract a number from a group name/type for TACAN channel derivation.
 *  Tankers: "Texaco 3-1" → 31, "Shell 1-1" → 11
 *  Carriers: "CVN-72" → 72, unit type "CVN_73" → 73
 */
function deriveChannel(name: string, unitType: string, role: 'tanker' | 'carrier'): number {
  if (role === 'carrier') {
    // Match CVN/LHA/LHD number from group name: "CVN-72", "CVN 73"
    const cvnNameMatch = name.match(/(?:CVN|LHA|LHD)[- _]?(\d+)/i);
    if (cvnNameMatch) return parseInt(cvnNameMatch[1], 10);
    // Match from unit type: "CVN_73", "CVN-72", "Stennis"
    const cvnTypeMatch = unitType.match(/(?:CVN|LHA|LHD)[- _]?(\d+)/i);
    if (cvnTypeMatch) return parseInt(cvnTypeMatch[1], 10);
    // Known ship name → hull number mapping
    const hullMap: Record<string, number> = {
      stennis: 74, vinson: 70, roosevelt: 71, lincoln: 72, washington: 73,
      truman: 75, reagan: 76, bush: 77, ford: 78, kennedy: 79,
      tarawa: 1, saipan: 2, nassau: 4, bataan: 5, bonhomme: 6, wasp: 1,
    };
    const lowerName = (name + ' ' + unitType).toLowerCase();
    for (const [ship, hull] of Object.entries(hullMap)) {
      if (lowerName.includes(ship)) return hull;
    }
    // No carrier number found — return 0 for fallback
    return 0;
  }
  // Tankers: match flight-style numbers "3-1" → 31, "1-1" → 11
  const flightMatch = name.match(/(\d+)-(\d+)/);
  if (flightMatch) return parseInt(flightMatch[1] + flightMatch[2], 10);
  // Match trailing number: "Texaco 3" → 3
  const trailingMatch = name.match(/(\d+)\s*$/);
  if (trailingMatch) return parseInt(trailingMatch[1], 10);
  return 0;
}

/** Clamp channel to valid TACAN range 1-126, 0 = unset */
function clampChannel(ch: number): number {
  if (ch < 1 || ch > 126) return 0;
  return ch;
}

interface TacanRow {
  groupId: number;
  groupName: string;
  type: string;
  role: 'tanker' | 'carrier';
  coalition: string;
  channel: number;
  band: string;
  callsign: string;
}

export function TacanTab() {
  const groups = useMissionStore((s) => s.groups);
  const addEdit = useEditStore((s) => s.addEdit);
  const [overrides, setOverrides] = useState<Map<number, Partial<TacanRow>>>(new Map());
  const [result, setResult] = useState('');

  // Find all tankers and carriers
  const tacanGroups = useMemo<TacanRow[]>(() => {
    const rows: TacanRow[] = [];
    for (const g of groups) {
      const airRole = getAirRoleLabel(g);
      const carrier = isCarrierGroup(g);
      if (airRole === 'REFUEL' || carrier) {
        const existing = g.tacan;
        rows.push({
          groupId: g.groupId,
          groupName: g.groupName,
          type: g.units[0]?.type || g.category,
          role: carrier ? 'carrier' : 'tanker',
          coalition: g.coalition,
          channel: existing?.channel || 0,
          band: existing?.band || 'X',
          callsign: existing?.callsign || '',
        });
      }
    }
    return rows;
  }, [groups]);

  const getRow = (groupId: number): TacanRow => {
    const base = tacanGroups.find((r) => r.groupId === groupId)!;
    const ov = overrides.get(groupId);
    return ov ? { ...base, ...ov } : base;
  };

  const updateField = (groupId: number, field: keyof TacanRow, value: string | number) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const existing = next.get(groupId) || {};
      next.set(groupId, { ...existing, [field]: value });
      return next;
    });
  };

  const handleAutoAssign = useCallback(() => {
    const next = new Map<number, Partial<TacanRow>>();
    const usedChannels = new Set<number>();
    let fallbackCh = 30; // fallback counter for groups with no derivable number

    // First pass: derive channels from names
    const derived: { row: TacanRow; ch: number; cs: string }[] = [];
    for (const row of tacanGroups) {
      const ch = clampChannel(deriveChannel(row.groupName, row.type, row.role));
      const cs = row.groupName.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase()
        || (row.role === 'carrier' ? 'CVN' : 'TKR');
      const band = row.role === 'tanker' ? 'Y' : 'X';
      derived.push({ row, ch, cs, band });
    }

    // Second pass: assign channels, deconflicting as needed
    for (const { row, ch, cs, band } of derived) {
      let finalCh = ch;
      if (finalCh === 0 || usedChannels.has(finalCh)) {
        // Find next available channel
        while (usedChannels.has(fallbackCh) || fallbackCh < 1) fallbackCh++;
        finalCh = fallbackCh;
        fallbackCh++;
      }
      if (finalCh > 126) finalCh = 126; // safety clamp
      usedChannels.add(finalCh);
      next.set(row.groupId, { channel: finalCh, band, callsign: cs });
    }

    setOverrides(next);
    setResult(`Auto-assigned ${tacanGroups.length} TACAN channels`);
  }, [tacanGroups]);

  const handleApply = useCallback(() => {
    if (overrides.size === 0) { setResult('No changes to apply'); return; }
    let count = 0;
    for (const [groupId, ov] of overrides) {
      const row = getRow(groupId);
      const group = groups.find((g) => g.groupId === groupId);
      if (!group) continue;
      // Apply to first unit in group (TACAN beacon is per-group)
      const unitId = group.units[0]?.unitId;
      if (!unitId) continue;
      addEdit({
        unitId,
        groupId,
        field: 'tacan',
        value: {
          channel: row.channel,
          band: row.band,
          callsign: row.callsign,
        },
      } as any);
      count++;
    }
    setResult(`Applied TACAN to ${count} group${count !== 1 ? 's' : ''}`);
  }, [overrides, tacanGroups, groups, addEdit]);

  const tankers = tacanGroups.filter((r) => r.role === 'tanker');
  const carriers = tacanGroups.filter((r) => r.role === 'carrier');

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>TACAN / Beacon</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#5a7a8a' }}>
        Assign TACAN channels to tankers and carriers. Auto-assign avoids conflicts.
      </p>

      {tacanGroups.length === 0 ? (
        <div style={{ color: '#5a7a8a', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>
          No tankers or carriers found in this mission.
        </div>
      ) : (
        <>
          <button
            onClick={handleAutoAssign}
            style={{
              background: '#1a3a5a', border: '1px solid #4a8fd4', borderRadius: 4,
              color: '#4a8fd4', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              padding: '8px 16px', marginBottom: 16, width: '100%',
            }}
          >
            Auto-Assign All TACAN Channels
          </button>

          {tankers.length > 0 && (
            <>
              <SectionHeader title="Tankers" count={tankers.length} color="#d29922" />
              {tankers.map((row) => (
                <TacanRowEditor key={row.groupId} row={getRow(row.groupId)} onChange={updateField} />
              ))}
            </>
          )}

          {carriers.length > 0 && (
            <>
              <SectionHeader title="Carriers" count={carriers.length} color="#a371f7" />
              {carriers.map((row) => (
                <TacanRowEditor key={row.groupId} row={getRow(row.groupId)} onChange={updateField} />
              ))}
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #1a2a3a', marginTop: 16 }}>
            <button
              onClick={handleApply}
              disabled={overrides.size === 0}
              style={{
                background: overrides.size > 0 ? '#d29922' : '#1a2a3a',
                border: 'none', borderRadius: 4, color: '#080f1c',
                cursor: overrides.size > 0 ? 'pointer' : 'not-allowed',
                fontSize: 14, fontWeight: 600, padding: '8px 16px',
              }}
            >
              Apply Changes
            </button>
            <span style={{ color: '#5a7a8a', fontSize: 13 }}>
              {overrides.size} group{overrides.size !== 1 ? 's' : ''} modified
            </span>
          </div>

          {result && (
            <div style={{ padding: '8px 12px', background: 'rgba(63, 185, 80, 0.1)', border: '1px solid #3fb950', borderRadius: 4, color: '#3fb950', fontSize: 13, marginTop: 8 }}>
              {result}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, count, color }: { title: string; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px' }}>
      <span style={{ color, fontWeight: 600, fontSize: 14 }}>{title}</span>
      <span style={{
        color, fontSize: 11, background: `${color}15`, border: `1px solid ${color}30`,
        borderRadius: 10, padding: '1px 8px', fontWeight: 600,
      }}>{count}</span>
    </div>
  );
}

function TacanRowEditor({
  row,
  onChange,
}: {
  row: TacanRow;
  onChange: (groupId: number, field: keyof TacanRow, value: string | number) => void;
}) {
  const roleColor = row.role === 'carrier' ? '#a371f7' : '#d29922';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      background: '#0a1218', borderRadius: 6, border: '1px solid #12202e', marginBottom: 6,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#ccdae8', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.groupName}
        </div>
        <div style={{ color: '#5a7a8a', fontSize: 11 }}>{row.type}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label style={{ color: '#5a7a8a', fontSize: 11 }}>CH</label>
        <input
          type="number"
          value={row.channel || ''}
          onChange={(e) => onChange(row.groupId, 'channel', parseInt(e.target.value, 10) || 0)}
          min={1}
          max={126}
          style={{
            width: 52, background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
            color: '#ccdae8', fontSize: 13, padding: '4px 6px', fontFamily: 'monospace', textAlign: 'center',
          }}
        />
        <select
          value={row.band}
          onChange={(e) => onChange(row.groupId, 'band', e.target.value)}
          style={{
            width: 42, background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
            color: roleColor, fontSize: 13, padding: '4px 2px', fontWeight: 600,
          }}
        >
          <option value="X">X</option>
          <option value="Y">Y</option>
        </select>
        <input
          value={row.callsign}
          onChange={(e) => onChange(row.groupId, 'callsign', e.target.value.toUpperCase().slice(0, 3))}
          maxLength={3}
          placeholder="ID"
          style={{
            width: 48, background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
            color: '#ccdae8', fontSize: 13, padding: '4px 6px', fontFamily: 'monospace', textAlign: 'center',
          }}
        />
      </div>
    </div>
  );
}
