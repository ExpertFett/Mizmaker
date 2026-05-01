import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { useSopStore } from '../../sop/sopStore';
import type { ClientUnit, DonorInfo } from '../../types/mission';

/* ------------------------------------------------------------------ */
/* 2-char callsign abbreviation (consonant skeleton)                   */
/* ------------------------------------------------------------------ */

function abbreviateCallsign(name: string): string {
  const clean = name.trim().toUpperCase();
  if (clean.length <= 2) return clean;
  const consonants = clean.replace(/[^BCDFGHJKLMNPQRSTVWXYZ]/g, '');
  if (consonants.length >= 2) return consonants.slice(0, 2);
  return clean.slice(0, 2);
}

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

export function DatalinkTab() {
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const allUnitsDonor = useMissionStore((s) => s.allUnitsDonor);
  const addEdit = useEditStore((s) => s.addEdit);
  // Active SOP drives callsign auto-assign — match player flights to
  // SOP-defined callsigns by first-word of group name. Falls back to
  // abbreviated group name when no SOP match.
  const activeSop = useSopStore((s) => s.activeId
    ? s.sops.find((x) => x.id === s.activeId) || null
    : null);

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

  const handleAutoAssignAll = useCallback(() => {
    // Use each group's own flight number from its name (e.g. "Bengal 1" → flight 1)
    // STN uses a global counter to ensure uniqueness across all groups

    // Build SOP callsign lookup (first-word → full SOP callsign) so
    // we can match a mission group like "Bengal 1" to an SOP entry
    // named "Bengal" and use the SOP-defined callsign as the source
    // of the 2-char label rather than just the group's first word.
    // For most missions these will be the same string anyway, but
    // when the mission designer named a group differently from the
    // squadron's preferred callsign (e.g. group="HornetA1" but
    // SOP="Bengal"), the SOP wins.
    const sopByFirstWord = new Map<string, string>();
    if (activeSop) {
      for (const f of activeSop.flights) {
        if (!f.callsign) continue;
        const firstWord = f.callsign.split(/[-\s]/)[0].toLowerCase();
        sopByFirstWord.set(firstWord, f.callsign);
      }
    }

    let stnFlight = 1;
    for (const [groupName, { units }] of grouped) {
      // Auto-assign always derives the 2-char label from the group's
      // base name (Bengal 1 → BN, Camelot 2 → CM, etc.), overwriting
      // whatever the lead currently has. With an active SOP, we look
      // up the SOP callsign for this group's first word and use that
      // as the source of the abbreviation instead of the raw group
      // name — letting the squadron control official callsigns even
      // when the mission designer named groups differently.
      const baseName = groupName.replace(/\s*\d+\s*$/, '').trim() || groupName;
      const sopCallsign = sopByFirstWord.get(baseName.toLowerCase());
      const csLabel = abbreviateCallsign(sopCallsign || baseName);

      // Extract flight number from group name (e.g. "Bengal 1" → 1, "Camelot 2" → 2)
      const flightMatch = groupName.match(/(\d+)\s*$/);
      const flightNum = flightMatch ? parseInt(flightMatch[1], 10) : stnFlight;

      for (let i = 0; i < units.length; i++) {
        const memberNum = i + 1;
        const csNumber = String(flightNum) + String(memberNum);
        const stn = String(stnFlight * 10 + memberNum).padStart(5, '0');

        handleFieldChange(units[i].unitId, 'voiceCallsignLabel', csLabel);
        handleFieldChange(units[i].unitId, 'voiceCallsignNumber', csNumber);
        handleFieldChange(units[i].unitId, 'stnL16', stn);
      }
      stnFlight++;
    }
  }, [grouped, handleFieldChange, activeSop]);

  if (clientUnits.length === 0) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 15, padding: 20 }}>
        No client (player) units with datalinks found in this mission.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
            Datalink &amp; Callsign Editor
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
            Click a group to expand. Edit callsigns, STN L16 addresses, donors, and team members.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {activeSop && (
            <span
              title={`Auto-assign will use callsigns from SOP "${activeSop.name}" — ${activeSop.flights.length} entries.`}
              style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                color: '#3fb950',
                border: '1px solid rgba(63, 185, 80, 0.5)',
                background: 'rgba(63, 185, 80, 0.08)',
                borderRadius: 3, padding: '3px 8px',
              }}
            >
              SOP: {activeSop.name.length > 24 ? activeSop.name.slice(0, 24) + '…' : activeSop.name}
            </span>
          )}
          <button
            onClick={handleAutoAssignAll}
            title={activeSop
              ? `Match each player flight's first-word callsign against SOP "${activeSop.name}" entries; use the SOP callsign as the abbreviation source. Falls back to the raw group name when no SOP match.`
              : 'Derive a 2-char callsign label from each group name and assign to every unit. Set an active SOP to drive callsigns from squadron defaults instead.'}
            style={{
              background: '#4a4a4a', border: '1px solid #2a5a8a', borderRadius: 4,
              color: '#6ab4f0', padding: '6px 16px', fontSize: 13, cursor: 'pointer',
              fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >Auto Assign All{activeSop ? ' (SOP)' : ''}</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Coalition pills */}
        <div style={{ display: 'flex', gap: 2, background: '#222222', borderRadius: 4, border: '1px solid #3a3a3a', padding: 2 }}>
          {(['all', 'blue', 'red'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCoalitionFilter(c)}
              style={{
                background: coalitionFilter === c ? (c === 'blue' ? '#262626' : c === 'red' ? '#3a1a1a' : '#3a3a3a') : 'transparent',
                border: 'none', borderRadius: 3,
                color: coalitionFilter === c
                  ? (c === 'blue' ? '#4a8fd4' : c === 'red' ? '#d95050' : '#e0e0e0')
                  : '#aaaaaa',
                cursor: 'pointer', fontSize: 12, fontWeight: coalitionFilter === c ? 600 : 400,
                padding: '4px 10px', textTransform: 'uppercase',
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <span style={{ fontSize: 13, color: '#aaaaaa', marginLeft: 'auto' }}>
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
      border: '1px solid #3a3a3a',
      borderRadius: 6,
      background: '#222222',
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
          background: isExpanded ? '#1a1a1a' : 'transparent',
        }}
      >
        <span style={{ color: '#aaaaaa', fontSize: 12, userSelect: 'none', width: 12 }}>
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>

        <span style={{
          background: coalitionColor,
          color: '#1a1a1a', fontSize: 10, fontWeight: 700,
          padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {coalition}
        </span>

        <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 15 }}>
          {groupName}
        </span>

        <span style={{ color: '#aaaaaa', fontSize: 13 }}>
          {type}
        </span>

        <span style={{ color: '#4a4a4a', fontSize: 12 }}>
          {units.length} unit{units.length !== 1 ? 's' : ''}
        </span>

        {/* Callsign summary pills */}
        <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'flex-end', overflow: 'hidden' }}>
          {callsignSummary.map((cs, i) => (
            <span key={i} style={{
              fontSize: 11, color: '#cccccc', background: '#262626',
              padding: '1px 8px', borderRadius: 10, border: '1px solid #3a3a3a',
              fontFamily: "'B612 Mono', monospace", whiteSpace: 'nowrap',
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
                fontFamily: "'B612 Mono', monospace", whiteSpace: 'nowrap',
              }}>
                {u.stnL16}
              </span>
            ) : null
          ))}
        </div>
      </div>

      {/* Expanded unit cards */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid #3a3a3a' }}>
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
      borderBottom: '1px solid #262626',
    }}>
      {/* Row 1: Unit name + identity fields */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
        flexWrap: 'wrap',
      }}>
        {/* Unit name */}
        <span style={{ color: '#cccccc', fontWeight: 500, fontSize: 14, minWidth: 100 }}>
          {unit.name}
        </span>

        <span style={{ color: '#4a4a4a', fontSize: 12 }}>{unit.type}</span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Callsign Label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={fieldLabelStyle}>CS</label>
          <input
            value={unit.voiceCallsignLabel}
            maxLength={3}
            onChange={(e) => onFieldChange(unit.unitId, 'voiceCallsignLabel', e.target.value)}
            style={{ ...monoInputStyle, width: 48, ...changedStyle('voiceCallsignLabel') }}
            placeholder="ENF"
          />
        </div>

        {/* Callsign Number */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={fieldLabelStyle}>#</label>
          <input
            value={unit.voiceCallsignNumber}
            onChange={(e) => onFieldChange(unit.unitId, 'voiceCallsignNumber', e.target.value)}
            style={{ ...monoInputStyle, width: 36, ...changedStyle('voiceCallsignNumber') }}
            placeholder="11"
          />
        </div>

        {/* STN L16 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <label style={{ ...fieldLabelStyle, color: '#d29922' }}>STN</label>
          <input
            value={unit.stnL16}
            maxLength={5}
            onChange={(e) => onFieldChange(unit.unitId, 'stnL16', e.target.value)}
            style={{ ...monoInputStyle, width: 60, color: '#d29922', ...changedStyle('stnL16') }}
            placeholder="00000"
          />
        </div>
      </div>

      {/* Row 2: Donors + Team Members */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* Donors */}
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <div style={{ fontSize: 11, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Donors
            {unit.donors.length > 0 && (
              <span style={{ color: '#4a4a4a', fontWeight: 400, marginLeft: 4 }}>({unit.donors.length})</span>
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
          <div style={{ fontSize: 11, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Team Members
            {unit.teamMembers.length > 0 && (
              <span style={{ color: '#4a4a4a', fontWeight: 400, marginLeft: 4 }}>({unit.teamMembers.length})</span>
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
          <span style={{ fontSize: 12, color: '#3a3a3a', fontStyle: 'italic' }}>{emptyText}</span>
        )}
        {items.map((item) => (
          <span key={item.missionUnitId} style={tagStyle}>
            <span style={{ color: '#e0e0e0', fontSize: 12 }}>{item.name}</span>
            <span style={{ color: '#4a4a4a', fontSize: 10, marginLeft: 2 }}>{item.type}</span>
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
              <div style={{ padding: '8px 10px', color: '#aaaaaa', fontSize: 12 }}>No matches</div>
            )}
            {filtered.map((u) => {
              const uCoalColor = u.coalition === 'blue' ? '#4a8fd4' : u.coalition === 'red' ? '#d95050' : '#aaaaaa';
              return (
                <div
                  key={u.unitId}
                  onClick={() => {
                    onAdd({ missionUnitId: u.unitId, name: u.name, type: u.type });
                    setPicking(false);
                    setSearch('');
                  }}
                  style={pickerItemStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{
                    width: 4, height: 4, borderRadius: '50%', background: uCoalColor,
                    flexShrink: 0,
                  }} />
                  <span style={{ color: '#e0e0e0', fontSize: 13 }}>{u.name}</span>
                  <span style={{ color: '#aaaaaa', fontSize: 11 }}>{u.type}</span>
                  <span style={{ color: '#4a4a4a', fontSize: 11, marginLeft: 'auto' }}>{u.groupName}</span>
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
  color: '#aaaaaa',
  fontWeight: 600,
  letterSpacing: 0.5,
};

const monoInputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#e0e0e0',
  fontFamily: "'B612 Mono', monospace",
  fontSize: 14,
  padding: '5px 8px',
  outline: 'none',
  textAlign: 'center',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 12,
  color: '#cccccc',
};

const tagRemoveBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#aaaaaa',
  cursor: 'pointer',
  fontSize: 12,
  padding: '0 2px',
  lineHeight: 1,
  marginLeft: 2,
};

const addBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px dashed #3a3a3a',
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
  background: '#222222',
  border: '1px solid #4a4a4a',
  borderRadius: 6,
  width: 300,
  marginTop: 6,
  boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
  overflow: 'hidden',
};

const pickerInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#262626',
  border: 'none',
  borderBottom: '1px solid #3a3a3a',
  color: '#e0e0e0',
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
