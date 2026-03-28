import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { ClientUnit, DonorInfo } from '../../types/mission';

export function DatalinkTab() {
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const allUnitsDonor = useMissionStore((s) => s.allUnitsDonor);
  const addEdit = useEditStore((s) => s.addEdit);

  // Snapshot original values on mount for change-tracking
  const originals = useRef<Map<number, Partial<ClientUnit>>>(new Map());
  useEffect(() => {
    const map = new Map<number, Partial<ClientUnit>>();
    for (const u of clientUnits) {
      map.set(u.unitId, {
        voiceCallsignLabel: u.voiceCallsignLabel,
        voiceCallsignNumber: u.voiceCallsignNumber,
        stnL16: u.stnL16,
        donors: [...u.donors],
        teamMembers: [...u.teamMembers],
      });
    }
    originals.current = map;
    // Only snapshot on first mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Group units by groupName, preserving order
  const grouped = useMemo(() => {
    const map = new Map<string, { coalition: string; units: ClientUnit[] }>();
    for (const u of clientUnits) {
      if (!u.hasDatalinks) continue;
      let entry = map.get(u.groupName);
      if (!entry) {
        entry = { coalition: u.coalition, units: [] };
        map.set(u.groupName, entry);
      }
      entry.units.push(u);
    }
    return map;
  }, [clientUnits]);

  const handleFieldChange = useCallback((unitId: number, field: string, value: string) => {
    addEdit({ unitId, field, value } as any);

    // Optimistic update in store
    const { clientUnits } = useMissionStore.getState();
    const updated = clientUnits.map((u) => {
      if (u.unitId !== unitId) return u;
      const copy = { ...u };
      if (field === 'voiceCallsignLabel') copy.voiceCallsignLabel = value;
      else if (field === 'voiceCallsignNumber') copy.voiceCallsignNumber = value;
      else if (field === 'stnL16') copy.stnL16 = value;
      return copy;
    });
    useMissionStore.setState({ clientUnits: updated });
  }, [addEdit]);

  const handleAddDonor = useCallback((unitId: number, donor: DonorInfo) => {
    addEdit({ unitId, field: 'addDonor', value: donor.missionUnitId } as any);
    const { clientUnits } = useMissionStore.getState();
    const updated = clientUnits.map((u) => {
      if (u.unitId !== unitId) return u;
      if (u.donors.some((d) => d.missionUnitId === donor.missionUnitId)) return u;
      return { ...u, donors: [...u.donors, donor] };
    });
    useMissionStore.setState({ clientUnits: updated });
  }, [addEdit]);

  const handleRemoveDonor = useCallback((unitId: number, donorId: number) => {
    addEdit({ unitId, field: 'removeDonor', value: donorId } as any);
    const { clientUnits } = useMissionStore.getState();
    const updated = clientUnits.map((u) => {
      if (u.unitId !== unitId) return u;
      return { ...u, donors: u.donors.filter((d) => d.missionUnitId !== donorId) };
    });
    useMissionStore.setState({ clientUnits: updated });
  }, [addEdit]);

  const handleAddTeamMember = useCallback((unitId: number, member: DonorInfo) => {
    addEdit({ unitId, field: 'addTeamMember', value: member.missionUnitId } as any);
    const { clientUnits } = useMissionStore.getState();
    const updated = clientUnits.map((u) => {
      if (u.unitId !== unitId) return u;
      if (u.teamMembers.some((m) => m.missionUnitId === member.missionUnitId)) return u;
      return { ...u, teamMembers: [...u.teamMembers, member] };
    });
    useMissionStore.setState({ clientUnits: updated });
  }, [addEdit]);

  const handleRemoveTeamMember = useCallback((unitId: number, memberId: number) => {
    addEdit({ unitId, field: 'removeTeamMember', value: memberId } as any);
    const { clientUnits } = useMissionStore.getState();
    const updated = clientUnits.map((u) => {
      if (u.unitId !== unitId) return u;
      return { ...u, teamMembers: u.teamMembers.filter((m) => m.missionUnitId !== memberId) };
    });
    useMissionStore.setState({ clientUnits: updated });
  }, [addEdit]);

  const isChanged = (unitId: number, field: keyof ClientUnit): boolean => {
    const orig = originals.current.get(unitId);
    if (!orig) return false;
    const unit = clientUnits.find((u) => u.unitId === unitId);
    if (!unit) return false;
    return (orig as any)[field] !== (unit as any)[field];
  };

  if (clientUnits.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 14, padding: 20 }}>
        No client (player) units with datalinks found in this mission.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#ccdae8' }}>
          Datalink &amp; Callsign Editor
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5a7a8a' }}>
          Edit callsigns, STN L16 addresses, donor lists, and team members for player units.
        </p>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccdae8' }}>
        <thead>
          <tr style={{
            color: '#5a7a8a',
            borderBottom: '1px solid #1a2a3a',
            background: '#080f1c',
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}>
            <th style={thStyle}>Unit</th>
            <th style={thStyle}>Type</th>
            <th style={{ ...thStyle, width: 70 }}>Callsign</th>
            <th style={{ ...thStyle, width: 50 }}>CS#</th>
            <th style={{ ...thStyle, width: 80 }}>STN L16</th>
            <th style={thStyle}>Donors</th>
            <th style={thStyle}>Team Members</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(grouped.entries()).map(([groupName, { coalition, units }]) => (
            <GroupSection
              key={groupName}
              groupName={groupName}
              coalition={coalition}
              units={units}
              allUnitsDonor={allUnitsDonor}
              isChanged={isChanged}
              onFieldChange={handleFieldChange}
              onAddDonor={handleAddDonor}
              onRemoveDonor={handleRemoveDonor}
              onAddTeamMember={handleAddTeamMember}
              onRemoveTeamMember={handleRemoveTeamMember}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface GroupSectionProps {
  groupName: string;
  coalition: string;
  units: ClientUnit[];
  allUnitsDonor: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  isChanged: (unitId: number, field: keyof ClientUnit) => boolean;
  onFieldChange: (unitId: number, field: string, value: string) => void;
  onAddDonor: (unitId: number, donor: DonorInfo) => void;
  onRemoveDonor: (unitId: number, donorId: number) => void;
  onAddTeamMember: (unitId: number, member: DonorInfo) => void;
  onRemoveTeamMember: (unitId: number, memberId: number) => void;
}

function GroupSection({
  groupName, coalition, units, allUnitsDonor,
  isChanged, onFieldChange,
  onAddDonor, onRemoveDonor, onAddTeamMember, onRemoveTeamMember,
}: GroupSectionProps) {
  const coalitionColor = coalition === 'blue' ? '#4a8fd4' : '#d95050';

  return (
    <>
      {/* Group header row */}
      <tr style={{ background: '#0a1520' }}>
        <td colSpan={7} style={{
          padding: '8px 10px',
          fontSize: 12,
          fontWeight: 600,
          borderBottom: '1px solid #1a2a3a',
          borderLeft: `3px solid ${coalitionColor}`,
        }}>
          <span style={{ color: coalitionColor, marginRight: 8 }}>{coalition.toUpperCase()}</span>
          <span style={{ color: '#8fa8c0' }}>{groupName}</span>
          <span style={{ color: '#5a7a8a', marginLeft: 8, fontWeight: 400 }}>
            ({units.length} unit{units.length !== 1 ? 's' : ''})
          </span>
        </td>
      </tr>
      {units.map((unit) => (
        <UnitRow
          key={unit.unitId}
          unit={unit}
          allUnitsDonor={allUnitsDonor}
          isChanged={isChanged}
          onFieldChange={onFieldChange}
          onAddDonor={onAddDonor}
          onRemoveDonor={onRemoveDonor}
          onAddTeamMember={onAddTeamMember}
          onRemoveTeamMember={onRemoveTeamMember}
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */

interface UnitRowProps {
  unit: ClientUnit;
  allUnitsDonor: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  isChanged: (unitId: number, field: keyof ClientUnit) => boolean;
  onFieldChange: (unitId: number, field: string, value: string) => void;
  onAddDonor: (unitId: number, donor: DonorInfo) => void;
  onRemoveDonor: (unitId: number, donorId: number) => void;
  onAddTeamMember: (unitId: number, member: DonorInfo) => void;
  onRemoveTeamMember: (unitId: number, memberId: number) => void;
}

function UnitRow({
  unit, allUnitsDonor, isChanged,
  onFieldChange, onAddDonor, onRemoveDonor, onAddTeamMember, onRemoveTeamMember,
}: UnitRowProps) {
  const changedBorder = (field: keyof ClientUnit): React.CSSProperties =>
    isChanged(unit.unitId, field)
      ? { borderLeft: '3px solid #3fb950' }
      : {};

  return (
    <tr style={{ borderBottom: '1px solid #0f1a28' }}>
      {/* Unit name (read-only) */}
      <td style={tdStyle}>
        <span style={{ color: '#8fa8c0' }}>{unit.name}</span>
      </td>

      {/* Type (read-only) */}
      <td style={{ ...tdStyle, color: '#5a7a8a', fontSize: 12 }}>
        {unit.type}
      </td>

      {/* Callsign Label */}
      <td style={tdStyle}>
        <input
          defaultValue={unit.voiceCallsignLabel}
          maxLength={3}
          onBlur={(e) => onFieldChange(unit.unitId, 'voiceCallsignLabel', e.target.value)}
          style={{
            ...monoInputStyle,
            width: 50,
            ...changedBorder('voiceCallsignLabel'),
          }}
        />
      </td>

      {/* Callsign Number */}
      <td style={tdStyle}>
        <input
          defaultValue={unit.voiceCallsignNumber}
          onBlur={(e) => onFieldChange(unit.unitId, 'voiceCallsignNumber', e.target.value)}
          style={{
            ...monoInputStyle,
            width: 36,
            ...changedBorder('voiceCallsignNumber'),
          }}
        />
      </td>

      {/* STN L16 */}
      <td style={tdStyle}>
        <input
          defaultValue={unit.stnL16}
          maxLength={5}
          onBlur={(e) => onFieldChange(unit.unitId, 'stnL16', e.target.value)}
          style={{
            ...monoInputStyle,
            width: 64,
            ...changedBorder('stnL16'),
          }}
        />
      </td>

      {/* Donors */}
      <td style={tdStyle}>
        <TagList
          items={unit.donors}
          onRemove={(id) => onRemoveDonor(unit.unitId, id)}
          onAdd={(donor) => onAddDonor(unit.unitId, donor)}
          allUnits={allUnitsDonor}
          excludeIds={[unit.unitId, ...unit.donors.map((d) => d.missionUnitId)]}
        />
      </td>

      {/* Team Members */}
      <td style={tdStyle}>
        <TagList
          items={unit.teamMembers}
          onRemove={(id) => onRemoveTeamMember(unit.unitId, id)}
          onAdd={(member) => onAddTeamMember(unit.unitId, member)}
          allUnits={allUnitsDonor}
          excludeIds={[unit.unitId, ...unit.teamMembers.map((m) => m.missionUnitId)]}
        />
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Tag list with inline search picker                                 */
/* ------------------------------------------------------------------ */

interface TagListProps {
  items: DonorInfo[];
  onRemove: (id: number) => void;
  onAdd: (donor: DonorInfo) => void;
  allUnits: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  excludeIds: number[];
}

function TagList({ items, onRemove, onAdd, allUnits, excludeIds }: TagListProps) {
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!picking) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPicking(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [picking]);

  const filtered = useMemo(() => {
    const excludeSet = new Set(excludeIds);
    const q = search.toLowerCase();
    return allUnits
      .filter((u) => !excludeSet.has(u.unitId))
      .filter((u) =>
        !q || u.name.toLowerCase().includes(q) || u.type.toLowerCase().includes(q) || u.groupName.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [allUnits, excludeIds, search]);

  return (
    <div ref={containerRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', position: 'relative' }}>
      {items.map((item) => (
        <span key={item.missionUnitId} style={tagStyle}>
          <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </span>
          <button
            onClick={() => onRemove(item.missionUnitId)}
            style={tagRemoveBtn}
            title={`Remove ${item.name}`}
          >
            x
          </button>
        </span>
      ))}
      <button
        onClick={() => { setPicking(!picking); setSearch(''); }}
        style={addBtnStyle}
        title="Add"
      >
        +
      </button>

      {picking && (
        <div style={pickerStyle}>
          <input
            autoFocus
            placeholder="Search units..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={pickerInputStyle}
          />
          <div style={{ maxHeight: 160, overflow: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '6px 8px', color: '#5a7a8a', fontSize: 11 }}>No matches</div>
            )}
            {filtered.map((u) => (
              <div
                key={u.unitId}
                onClick={() => {
                  onAdd({ missionUnitId: u.unitId, name: u.name, type: u.type });
                  setPicking(false);
                  setSearch('');
                }}
                style={pickerItemStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#1a2a3a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ color: '#ccdae8', fontSize: 12 }}>{u.name}</span>
                <span style={{ color: '#5a7a8a', fontSize: 11, marginLeft: 6 }}>{u.type}</span>
                <span style={{ color: '#3a5a6a', fontSize: 10, marginLeft: 'auto' }}>{u.groupName}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  verticalAlign: 'top',
};

const monoInputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontFamily: 'monospace',
  fontSize: 13,
  padding: '4px 6px',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  padding: '2px 6px',
  fontSize: 11,
  color: '#8fa8c0',
  maxWidth: 140,
};

const tagRemoveBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#5a7a8a',
  cursor: 'pointer',
  fontSize: 11,
  padding: '0 2px',
  lineHeight: 1,
};

const addBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 14,
  padding: '0 6px',
  lineHeight: '20px',
};

const pickerStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  zIndex: 10,
  background: '#0a1520',
  border: '1px solid #1a3a5a',
  borderRadius: 4,
  width: 280,
  marginTop: 4,
  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
};

const pickerInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#0f1a28',
  border: 'none',
  borderBottom: '1px solid #1a2a3a',
  color: '#ccdae8',
  fontSize: 12,
  padding: '8px',
  outline: 'none',
  fontFamily: 'inherit',
};

const pickerItemStyle: React.CSSProperties = {
  padding: '5px 8px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  transition: 'background 0.1s',
};
