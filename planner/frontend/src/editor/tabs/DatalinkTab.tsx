import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { ClientUnit, DonorInfo } from '../../types/mission';

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

export function DatalinkTab() {
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const allUnitsDonor = useMissionStore((s) => s.allUnitsDonor);
  const addEdit = useEditStore((s) => s.addEdit);

  const [coalitionFilter, setCoalitionFilter] = useState<'all' | 'blue' | 'red'>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Snapshot originals for change tracking
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Group by groupName, filter by coalition and hasDatalinks
  const grouped = useMemo(() => {
    const map = new Map<string, { coalition: string; type: string; units: ClientUnit[] }>();
    for (const u of clientUnits) {
      if (!u.hasDatalinks) continue;
      if (coalitionFilter !== 'all' && u.coalition !== coalitionFilter) continue;
      let entry = map.get(u.groupName);
      if (!entry) {
        entry = { coalition: u.coalition, type: u.type, units: [] };
        map.set(u.groupName, entry);
      }
      entry.units.push(u);
    }
    return map;
  }, [clientUnits, coalitionFilter]);

  const totalUnits = useMemo(() => {
    let n = 0;
    for (const g of grouped.values()) n += g.units.length;
    return n;
  }, [grouped]);

  const handleFieldChange = useCallback((unitId: number, field: string, value: string) => {
    addEdit({ unitId, field, value } as any);
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

  const isChanged = useCallback((unitId: number, field: keyof ClientUnit): boolean => {
    const orig = originals.current.get(unitId);
    if (!orig) return false;
    const unit = clientUnits.find((u) => u.unitId === unitId);
    if (!unit) return false;
    return (orig as any)[field] !== (unit as any)[field];
  }, [clientUnits]);

  const toggleGroup = useCallback((name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  if (clientUnits.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 15, padding: 20 }}>
        No client (player) units with datalinks found in this mission.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
          Datalink &amp; Callsign Editor
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#5a7a8a' }}>
          Click a group to expand. Edit callsigns, STN L16 addresses, donors, and team members.
        </p>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Coalition pills */}
        <div style={{ display: 'flex', gap: 2, background: '#0a1520', borderRadius: 4, border: '1px solid #1a2a3a', padding: 2 }}>
          {(['all', 'blue', 'red'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCoalitionFilter(c)}
              style={{
                background: coalitionFilter === c ? (c === 'blue' ? '#1a2a4a' : c === 'red' ? '#3a1a1a' : '#1a2a3a') : 'transparent',
                border: 'none', borderRadius: 3,
                color: coalitionFilter === c
                  ? (c === 'blue' ? '#4a8fd4' : c === 'red' ? '#d95050' : '#ccdae8')
                  : '#5a7a8a',
                cursor: 'pointer', fontSize: 12, fontWeight: coalitionFilter === c ? 600 : 400,
                padding: '4px 10px', textTransform: 'uppercase',
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <span style={{ fontSize: 13, color: '#5a7a8a', marginLeft: 'auto' }}>
          {grouped.size} group{grouped.size !== 1 ? 's' : ''}, {totalUnits} unit{totalUnits !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Group cards */}
      {Array.from(grouped.entries()).map(([groupName, { coalition, type, units }]) => (
        <GroupCard
          key={groupName}
          groupName={groupName}
          coalition={coalition}
          type={type}
          units={units}
          allUnitsDonor={allUnitsDonor}
          isExpanded={expandedGroups.has(groupName)}
          isChanged={isChanged}
          onToggle={() => toggleGroup(groupName)}
          onFieldChange={handleFieldChange}
          onAddDonor={handleAddDonor}
          onRemoveDonor={handleRemoveDonor}
          onAddTeamMember={handleAddTeamMember}
          onRemoveTeamMember={handleRemoveTeamMember}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Group Card                                                          */
/* ------------------------------------------------------------------ */

interface GroupCardProps {
  groupName: string;
  coalition: string;
  type: string;
  units: ClientUnit[];
  allUnitsDonor: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  isExpanded: boolean;
  isChanged: (unitId: number, field: keyof ClientUnit) => boolean;
  onToggle: () => void;
  onFieldChange: (unitId: number, field: string, value: string) => void;
  onAddDonor: (unitId: number, donor: DonorInfo) => void;
  onRemoveDonor: (unitId: number, donorId: number) => void;
  onAddTeamMember: (unitId: number, member: DonorInfo) => void;
  onRemoveTeamMember: (unitId: number, memberId: number) => void;
}

function GroupCard({
  groupName, coalition, type, units, allUnitsDonor,
  isExpanded, isChanged, onToggle,
  onFieldChange, onAddDonor, onRemoveDonor, onAddTeamMember, onRemoveTeamMember,
}: GroupCardProps) {
  const coalitionColor = coalition === 'blue' ? '#4a8fd4' : '#d95050';

  // Quick summary: callsigns in this group
  const callsignSummary = units.map((u) =>
    `${u.voiceCallsignLabel}${u.voiceCallsignNumber}`,
  );

  return (
    <div style={{
      marginBottom: 8,
      border: '1px solid #1a2a3a',
      borderRadius: 6,
      background: '#0a1520',
      overflow: 'hidden',
    }}>
      {/* Group header */}
      <div
        onClick={onToggle}
        style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          borderLeft: `3px solid ${coalitionColor}`,
          background: isExpanded ? '#0c1825' : 'transparent',
        }}
      >
        <span style={{ color: '#5a7a8a', fontSize: 12, userSelect: 'none', width: 12 }}>
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>

        <span style={{
          background: coalitionColor,
          color: '#080f1c', fontSize: 10, fontWeight: 700,
          padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {coalition}
        </span>

        <span style={{ color: '#ccdae8', fontWeight: 600, fontSize: 15 }}>
          {groupName}
        </span>

        <span style={{ color: '#5a7a8a', fontSize: 13 }}>
          {type}
        </span>

        <span style={{ color: '#3a5a6a', fontSize: 12 }}>
          {units.length} unit{units.length !== 1 ? 's' : ''}
        </span>

        {/* Callsign summary pills */}
        <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'flex-end', overflow: 'hidden' }}>
          {callsignSummary.map((cs, i) => (
            <span key={i} style={{
              fontSize: 11, color: '#8fa8c0', background: '#0f1a28',
              padding: '1px 8px', borderRadius: 10, border: '1px solid #1a2a3a',
              fontFamily: 'monospace', whiteSpace: 'nowrap',
            }}>
              {cs}
            </span>
          ))}
        </div>

        {/* STN summary */}
        <div style={{ display: 'flex', gap: 4 }}>
          {units.map((u) => (
            u.stnL16 ? (
              <span key={u.unitId} style={{
                fontSize: 10, color: '#d29922', background: '#1a1a10',
                padding: '1px 6px', borderRadius: 10, border: '1px solid #2a2a1a',
                fontFamily: 'monospace', whiteSpace: 'nowrap',
              }}>
                {u.stnL16}
              </span>
            ) : null
          ))}
        </div>
      </div>

      {/* Expanded unit cards */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid #1a2a3a' }}>
          {units.map((unit) => (
            <UnitCard
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
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Unit Card                                                           */
/* ------------------------------------------------------------------ */

interface UnitCardProps {
  unit: ClientUnit;
  allUnitsDonor: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  isChanged: (unitId: number, field: keyof ClientUnit) => boolean;
  onFieldChange: (unitId: number, field: string, value: string) => void;
  onAddDonor: (unitId: number, donor: DonorInfo) => void;
  onRemoveDonor: (unitId: number, donorId: number) => void;
  onAddTeamMember: (unitId: number, member: DonorInfo) => void;
  onRemoveTeamMember: (unitId: number, memberId: number) => void;
}

function UnitCard({
  unit, allUnitsDonor, isChanged,
  onFieldChange, onAddDonor, onRemoveDonor, onAddTeamMember, onRemoveTeamMember,
}: UnitCardProps) {
  const changedStyle = (field: keyof ClientUnit): React.CSSProperties =>
    isChanged(unit.unitId, field) ? { borderColor: '#3fb950' } : {};

  return (
    <div style={{
      padding: '12px 16px 12px 32px',
      borderBottom: '1px solid #0f1a28',
    }}>
      {/* Row 1: Unit name + identity fields */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
        flexWrap: 'wrap',
      }}>
        {/* Unit name */}
        <span style={{ color: '#8fa8c0', fontWeight: 500, fontSize: 14, minWidth: 100 }}>
          {unit.name}
        </span>

        <span style={{ color: '#3a5a6a', fontSize: 12 }}>{unit.type}</span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Callsign Label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={fieldLabelStyle}>CS</label>
          <input
            defaultValue={unit.voiceCallsignLabel}
            maxLength={3}
            onBlur={(e) => onFieldChange(unit.unitId, 'voiceCallsignLabel', e.target.value)}
            style={{ ...monoInputStyle, width: 48, ...changedStyle('voiceCallsignLabel') }}
            placeholder="ENF"
          />
        </div>

        {/* Callsign Number */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={fieldLabelStyle}>#</label>
          <input
            defaultValue={unit.voiceCallsignNumber}
            onBlur={(e) => onFieldChange(unit.unitId, 'voiceCallsignNumber', e.target.value)}
            style={{ ...monoInputStyle, width: 36, ...changedStyle('voiceCallsignNumber') }}
            placeholder="11"
          />
        </div>

        {/* STN L16 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={{ ...fieldLabelStyle, color: '#d29922' }}>STN</label>
          <input
            defaultValue={unit.stnL16}
            maxLength={5}
            onBlur={(e) => onFieldChange(unit.unitId, 'stnL16', e.target.value)}
            style={{ ...monoInputStyle, width: 60, color: '#d29922', ...changedStyle('stnL16') }}
            placeholder="00000"
          />
        </div>
      </div>

      {/* Row 2: Donors + Team Members */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* Donors */}
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <div style={{ fontSize: 11, color: '#5a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Donors
            {unit.donors.length > 0 && (
              <span style={{ color: '#3a5a6a', fontWeight: 400, marginLeft: 4 }}>({unit.donors.length})</span>
            )}
          </div>
          <TagList
            items={unit.donors}
            onRemove={(id) => onRemoveDonor(unit.unitId, id)}
            onAdd={(donor) => onAddDonor(unit.unitId, donor)}
            allUnits={allUnitsDonor}
            excludeIds={[unit.unitId, ...unit.donors.map((d) => d.missionUnitId)]}
            emptyText="No donors assigned"
          />
        </div>

        {/* Team Members */}
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <div style={{ fontSize: 11, color: '#5a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Team Members
            {unit.teamMembers.length > 0 && (
              <span style={{ color: '#3a5a6a', fontWeight: 400, marginLeft: 4 }}>({unit.teamMembers.length})</span>
            )}
          </div>
          <TagList
            items={unit.teamMembers}
            onRemove={(id) => onRemoveTeamMember(unit.unitId, id)}
            onAdd={(member) => onAddTeamMember(unit.unitId, member)}
            allUnits={allUnitsDonor}
            excludeIds={[unit.unitId, ...unit.teamMembers.map((m) => m.missionUnitId)]}
            emptyText="No team members"
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tag List with inline search picker                                  */
/* ------------------------------------------------------------------ */

interface TagListProps {
  items: DonorInfo[];
  onRemove: (id: number) => void;
  onAdd: (donor: DonorInfo) => void;
  allUnits: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  excludeIds: number[];
  emptyText: string;
}

function TagList({ items, onRemove, onAdd, allUnits, excludeIds, emptyText }: TagListProps) {
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {items.length === 0 && !picking && (
          <span style={{ fontSize: 12, color: '#2a3a4a', fontStyle: 'italic' }}>{emptyText}</span>
        )}
        {items.map((item) => (
          <span key={item.missionUnitId} style={tagStyle}>
            <span style={{ color: '#ccdae8', fontSize: 12 }}>{item.name}</span>
            <span style={{ color: '#3a5a6a', fontSize: 10, marginLeft: 2 }}>{item.type}</span>
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
          title="Add unit"
        >
          +
        </button>
      </div>

      {picking && (
        <div style={pickerStyle}>
          <input
            autoFocus
            placeholder="Search units..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={pickerInputStyle}
          />
          <div style={{ maxHeight: 180, overflow: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '8px 10px', color: '#5a7a8a', fontSize: 12 }}>No matches</div>
            )}
            {filtered.map((u) => {
              const uCoalColor = u.coalition === 'blue' ? '#4a8fd4' : u.coalition === 'red' ? '#d95050' : '#5a7a8a';
              return (
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
                  <span style={{
                    width: 4, height: 4, borderRadius: '50%', background: uCoalColor,
                    flexShrink: 0,
                  }} />
                  <span style={{ color: '#ccdae8', fontSize: 13 }}>{u.name}</span>
                  <span style={{ color: '#5a7a8a', fontSize: 11 }}>{u.type}</span>
                  <span style={{ color: '#3a5a6a', fontSize: 11, marginLeft: 'auto' }}>{u.groupName}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#5a7a8a',
  fontWeight: 600,
  letterSpacing: 0.5,
};

const monoInputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#ccdae8',
  fontFamily: 'monospace',
  fontSize: 14,
  padding: '5px 8px',
  outline: 'none',
  textAlign: 'center',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 12,
  color: '#8fa8c0',
};

const tagRemoveBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#5a7a8a',
  cursor: 'pointer',
  fontSize: 12,
  padding: '0 2px',
  lineHeight: 1,
  marginLeft: 2,
};

const addBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px dashed #1a2a3a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 14,
  padding: '2px 8px',
  lineHeight: '20px',
};

const pickerStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  zIndex: 10,
  background: '#0a1520',
  border: '1px solid #1a3a5a',
  borderRadius: 6,
  width: 300,
  marginTop: 6,
  boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
  overflow: 'hidden',
};

const pickerInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#0f1a28',
  border: 'none',
  borderBottom: '1px solid #1a2a3a',
  color: '#ccdae8',
  fontSize: 13,
  padding: '10px 12px',
  outline: 'none',
  fontFamily: 'inherit',
};

const pickerItemStyle: React.CSSProperties = {
  padding: '6px 12px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  transition: 'background 0.1s',
};
