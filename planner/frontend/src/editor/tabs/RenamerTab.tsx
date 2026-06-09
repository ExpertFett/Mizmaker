import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { useActiveSop } from '../../sop/sopStore';
import { isPlayerGroup } from '../../utils/groups';
import type { GroupRenamerData } from '../../types/mission';
// Carrier / JTAC / TIC / AEGIS auto-setup panels moved to top-level
// tabs (Carriers and Scripts) as part of the v0.7.x workflow reorg.
// They no longer live inside the Renamer.

type CategoryFilter = 'all' | 'plane' | 'helicopter' | 'vehicle' | 'ship' | 'static';
type CoalitionFilter = 'all' | 'blue' | 'red' | 'neutrals';

export function RenamerTab() {
  const allGroupsRenamer = useMissionStore((s) => s.allGroupsRenamer);
  const groups = useMissionStore((s) => s.groups);
  const addEdit = useEditStore((s) => s.addEdit);
  const activeSop = useActiveSop();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [coalition, setCoalition] = useState<CoalitionFilter>('all');

  // Find & Replace state
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [useRegex, setUseRegex] = useState(false);

  // Track renames: groupId -> newGroupName, unitId -> newUnitName
  const [groupNames, setGroupNames] = useState<Map<number, string>>(new Map());
  const [unitNames, setUnitNames] = useState<Map<number, string>>(new Map());

  // Expanded groups
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    let groups = allGroupsRenamer;
    if (category !== 'all') {
      groups = groups.filter((g) => g.category === category);
    }
    if (coalition !== 'all') {
      groups = groups.filter((g) => g.coalition === coalition);
    }
    if (search) {
      const q = search.toLowerCase();
      groups = groups.filter((g) => {
        const gName = (groupNames.get(g.groupId) ?? g.groupName).toLowerCase();
        if (gName.includes(q)) return true;
        return g.units.some((u) => {
          const uName = (unitNames.get(u.unitId) ?? u.name).toLowerCase();
          return uName.includes(q) || u.type.toLowerCase().includes(q);
        });
      });
    }
    return groups;
  }, [allGroupsRenamer, category, coalition, search, groupNames, unitNames]);

  // Count find matches
  const matchCount = useMemo(() => {
    if (!findText) return 0;
    let count = 0;
    try {
      const pattern = useRegex ? new RegExp(findText, 'gi') : null;
      for (const g of filtered) {
        const gName = groupNames.get(g.groupId) ?? g.groupName;
        if (pattern) {
          count += (gName.match(pattern) || []).length;
        } else if (gName.toLowerCase().includes(findText.toLowerCase())) {
          count++;
        }
        for (const u of g.units) {
          const uName = unitNames.get(u.unitId) ?? u.name;
          if (pattern) {
            count += (uName.match(pattern) || []).length;
          } else if (uName.toLowerCase().includes(findText.toLowerCase())) {
            count++;
          }
        }
      }
    } catch {
      // invalid regex
    }
    return count;
  }, [findText, useRegex, filtered, groupNames, unitNames]);

  const handleGroupRename = useCallback((group: GroupRenamerData, newName: string) => {
    setGroupNames((prev) => {
      const next = new Map(prev);
      next.set(group.groupId, newName);
      return next;
    });
    // Build unit names map for this group
    const unitNamesObj: Record<number, string> = {};
    for (const u of group.units) {
      unitNamesObj[u.unitId] = unitNames.get(u.unitId) ?? u.name;
    }
    addEdit({ groupId: group.groupId, field: 'groupRename', value: { groupId: group.groupId, newGroupName: newName, unitNames: unitNamesObj } });
  }, [addEdit, unitNames]);

  const handleUnitRename = useCallback((unitId: number, newName: string) => {
    setUnitNames((prev) => {
      const next = new Map(prev);
      next.set(unitId, newName);
      return next;
    });
    addEdit({ unitId, field: 'unitRename', value: newName });
  }, [addEdit]);

  const handleAutoName = useCallback((group: GroupRenamerData) => {
    const gName = groupNames.get(group.groupId) ?? group.groupName;
    const unitNamesObj: Record<number, string> = {};
    const nextUnitNames = new Map(unitNames);
    group.units.forEach((u, i) => {
      const newName = `${gName}-${i + 1}`;
      nextUnitNames.set(u.unitId, newName);
      unitNamesObj[u.unitId] = newName;
      addEdit({ unitId: u.unitId, field: 'unitRename', value: newName });
    });
    setUnitNames(nextUnitNames);
    // Auto-expand the group so user can see the renamed units
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(group.groupId);
      return next;
    });
  }, [addEdit, groupNames, unitNames]);

  /**
   * Apply SOP callsigns to player flights in priority order.
   *
   * For each player flight (planes/helos with Client/Player skill),
   * walk through SOP flights ordered by priority (lower = first) and
   * propose a rename. The number suffix from the original group name
   * is preserved ("Bengal 1" → "Enfield 1"); units in each group get
   * their suffix matched too ("Bengal 1-1" → "Enfield 1-1").
   *
   * Doesn't dispatch — sets local state so the user can review before
   * committing on download.
   */
  const sopFlightsSorted = useMemo(() => {
    if (!activeSop) return [];
    return [...activeSop.flights]
      .filter((f) => f.callsign)
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  }, [activeSop]);

  const playerFlightCount = useMemo(
    () => groups.filter((g) =>
      isPlayerGroup(g) && (g.category === 'plane' || g.category === 'helicopter'),
    ).length,
    [groups],
  );

  const handleApplySopCallsigns = useCallback(() => {
    if (!activeSop || sopFlightsSorted.length === 0) return;
    const playerGroups = groups
      .filter((g) =>
        isPlayerGroup(g) && (g.category === 'plane' || g.category === 'helicopter'),
      );
    if (playerGroups.length === 0) return;

    const nextGroupNames = new Map(groupNames);
    const nextUnitNames = new Map(unitNames);
    let assigned = 0;

    for (let i = 0; i < playerGroups.length; i++) {
      const g = playerGroups[i];
      const sopFlight = sopFlightsSorted[i];
      if (!sopFlight) break;  // ran out of SOP entries
      // Preserve trailing flight number from existing name when present
      // ("Bengal 1" → keep " 1" suffix; "Bengal" → no suffix).
      const numMatch = g.groupName.match(/(\s*\d+)\s*$/);
      const numSuffix = numMatch ? numMatch[1] : '';
      const newGroupName = `${sopFlight.callsign}${numSuffix}`;
      nextGroupNames.set(g.groupId, newGroupName);

      // Rename units to match the new group name + their position
      // ("Bengal 1-1" → "Enfield 1-1"). Only retarget the LEAD-derived
      // numbering pattern; preserve any custom unit names that don't
      // start with the old group name.
      g.units.forEach((u, idx) => {
        const numLikely = `-${idx + 1}`;
        nextUnitNames.set(u.unitId, `${newGroupName}${numLikely}`);
      });

      // Dispatch the edit immediately so download writes the new name
      const unitNamesObj: Record<number, string> = {};
      g.units.forEach((u, idx) => {
        unitNamesObj[u.unitId] = `${newGroupName}-${idx + 1}`;
      });
      addEdit({
        groupId: g.groupId, field: 'groupRename',
        value: { groupId: g.groupId, newGroupName, unitNames: unitNamesObj },
      });
      assigned++;
    }

    setGroupNames(nextGroupNames);
    setUnitNames(nextUnitNames);
    void assigned;  // for future status-message use
  }, [activeSop, sopFlightsSorted, groups, groupNames, unitNames, addEdit]);

  const handleFindReplace = useCallback(() => {
    if (!findText) return;
    addEdit({ field: 'findReplace', value: { find: findText, replace: replaceText, useRegex } });

    // Also update local state optimistically
    try {
      const nextGroupNames = new Map(groupNames);
      const nextUnitNames = new Map(unitNames);

      for (const g of filtered) {
        const gName = nextGroupNames.get(g.groupId) ?? g.groupName;
        const newGName = useRegex
          ? gName.replace(new RegExp(findText, 'gi'), replaceText)
          : gName.split(findText).join(replaceText);
        if (newGName !== gName) nextGroupNames.set(g.groupId, newGName);

        for (const u of g.units) {
          const uName = nextUnitNames.get(u.unitId) ?? u.name;
          const newUName = useRegex
            ? uName.replace(new RegExp(findText, 'gi'), replaceText)
            : uName.split(findText).join(replaceText);
          if (newUName !== uName) nextUnitNames.set(u.unitId, newUName);
        }
      }

      setGroupNames(nextGroupNames);
      setUnitNames(nextUnitNames);
    } catch {
      // invalid regex, edit was still sent
    }
  }, [findText, replaceText, useRegex, addEdit, filtered, groupNames, unitNames]);

  const toggleExpanded = (groupId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  if (allGroupsRenamer.length === 0) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 15, padding: 20 }}>
        No groups available for renaming.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
          Group &amp; Unit Renamer
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
          Rename groups and units. Use find &amp; replace for bulk operations.
        </p>
      </div>

      {/* Carrier / JTAC / TIC / AEGIS auto-setup moved to dedicated
          top-level tabs (Carriers + Scripts) in the workflow reorg. */}

      {/* SOP Callsigns — quick way to rename every player flight to
          the squadron's preferred callsigns in priority order. */}
      {activeSop && sopFlightsSorted.length > 0 && playerFlightCount > 0 && (
        <div style={{
          marginBottom: 16,
          border: '1px solid rgba(63, 185, 80, 0.4)',
          background: 'rgba(63, 185, 80, 0.06)',
          borderRadius: 4,
          padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              color: '#3fb950',
              border: '1px solid rgba(63, 185, 80, 0.5)',
              borderRadius: 3, padding: '2px 8px',
            }}>SOP CALLSIGNS</span>
            <span style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 600 }}>
              {activeSop.name}
            </span>
            <span style={{ fontSize: 12, color: '#aaaaaa' }}>
              {sopFlightsSorted.length} callsign{sopFlightsSorted.length !== 1 ? 's' : ''} available
              {' · '}
              {playerFlightCount} player flight{playerFlightCount !== 1 ? 's' : ''} in mission
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={handleApplySopCallsigns}
              style={{
                background: 'rgba(63, 185, 80, 0.15)',
                border: '1px solid #3fb950',
                borderRadius: 4,
                color: '#3fb950',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 14px',
                fontFamily: 'inherit',
              }}
            >
              Apply SOP Callsigns to Player Flights
            </button>
            <span style={{ fontSize: 11, color: '#888' }}>
              First {Math.min(sopFlightsSorted.length, playerFlightCount)}: {sopFlightsSorted.slice(0, Math.min(sopFlightsSorted.length, playerFlightCount)).map((f) => f.callsign).join(', ')}
            </span>
          </div>
        </div>
      )}

      {/* Find & Replace */}
      <div style={{
        marginBottom: 16,
        border: '1px solid #3a3a3a',
        borderRadius: 4,
        background: '#222222',
        padding: '12px 14px',
      }}>
        <div style={{ fontSize: 13, color: '#cccccc', fontWeight: 600, marginBottom: 8 }}>Find &amp; Replace</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Find..."
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            style={textInputStyle}
          />
          <input
            placeholder="Replace with..."
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            style={textInputStyle}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#aaaaaa', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useRegex}
              onChange={(e) => setUseRegex(e.target.checked)}
            />
            Regex
          </label>
          <button onClick={handleFindReplace} style={actionBtnStyle}>
            Replace All
          </button>
          {findText && (
            <span style={{ fontSize: 13, color: '#aaaaaa' }}>
              {matchCount} match{matchCount !== 1 ? 'es' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          placeholder="Search groups & units..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...textInputStyle, width: 220 }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryFilter)}
          style={selectStyle}
        >
          <option value="all">All categories</option>
          <option value="plane">Plane</option>
          <option value="helicopter">Helicopter</option>
          <option value="vehicle">Vehicle</option>
          <option value="ship">Ship</option>
          <option value="static">Static</option>
        </select>
        <select
          value={coalition}
          onChange={(e) => setCoalition(e.target.value as CoalitionFilter)}
          style={selectStyle}
        >
          <option value="all">All coalitions</option>
          <option value="blue">Blue</option>
          <option value="red">Red</option>
          <option value="neutrals">Neutral</option>
        </select>
        <span style={{ fontSize: 13, color: '#aaaaaa' }}>
          {filtered.length} group{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Group cards */}
      {filtered.map((group) => (
        <GroupCard
          key={group.groupId}
          group={group}
          groupName={groupNames.get(group.groupId) ?? group.groupName}
          unitNames={unitNames}
          isExpanded={expanded.has(group.groupId)}
          onToggle={() => toggleExpanded(group.groupId)}
          onGroupRename={handleGroupRename}
          onUnitRename={handleUnitRename}
          onAutoName={handleAutoName}
          originalGroupName={group.groupName}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface GroupCardProps {
  group: GroupRenamerData;
  groupName: string;
  unitNames: Map<number, string>;
  isExpanded: boolean;
  onToggle: () => void;
  onGroupRename: (group: GroupRenamerData, newName: string) => void;
  onUnitRename: (unitId: number, newName: string) => void;
  onAutoName: (group: GroupRenamerData) => void;
  originalGroupName: string;
}

function GroupCard({
  group, groupName, unitNames, isExpanded, onToggle,
  onGroupRename, onUnitRename, onAutoName, originalGroupName,
}: GroupCardProps) {
  const coalitionColor = group.coalition === 'blue' ? '#4a8fd4' : group.coalition === 'red' ? '#d95050' : '#8a8a5a';
  const groupChanged = groupName !== originalGroupName;

  return (
    <div style={{
      marginBottom: 8,
      border: '1px solid #3a3a3a',
      borderRadius: 4,
      background: '#222222',
    }}>
      {/* Group header */}
      <div style={{
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        borderLeft: `3px solid ${coalitionColor}`,
      }}
        onClick={onToggle}
      >
        <span style={{ color: '#aaaaaa', fontSize: 13, userSelect: 'none' }}>
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>
        <span style={{
          background: coalitionColor,
          color: '#1a1a1a',
          fontSize: 11,
          fontWeight: 700,
          padding: '1px 6px',
          borderRadius: 3,
          textTransform: 'uppercase',
        }}>
          {group.coalition}
        </span>
        <input
          value={groupName}
          onChange={(e) => onGroupRename(group, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{
            ...groupInputStyle,
            ...(groupChanged ? { borderLeft: '3px solid #3fb950' } : {}),
          }}
        />
        <span style={{ color: '#aaaaaa', fontSize: 13 }}>
          {group.unitCount} unit{group.unitCount !== 1 ? 's' : ''}
        </span>
        <span style={{ color: '#4a4a4a', fontSize: 12 }}>
          {group.category}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onAutoName(group); }}
          style={autoNameBtnStyle}
          title="Auto-name units as GroupName-1, GroupName-2, etc."
        >
          Auto-name units
        </button>
      </div>

      {/* Expanded unit list */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid #3a3a3a', padding: '8px 14px 8px 30px' }}>
          {group.units.map((unit, i) => {
            const currentName = unitNames.get(unit.unitId) ?? unit.name;
            const changed = currentName !== unit.name;
            return (
              <div key={unit.unitId} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '4px 0',
                borderBottom: i < group.units.length - 1 ? '1px solid #262626' : 'none',
              }}>
                <span style={{ color: '#4a4a4a', fontSize: 12, width: 20, textAlign: 'right' }}>
                  #{i + 1}
                </span>
                <input
                  value={currentName}
                  onChange={(e) => onUnitRename(unit.unitId, e.target.value)}
                  style={{
                    ...unitInputStyle,
                    ...(changed ? { borderLeft: '3px solid #3fb950' } : {}),
                  }}
                />
                <span style={{ color: '#aaaaaa', fontSize: 12 }}>{unit.type}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Auto-setup sections (Carrier, JTAC, TIC, AEGIS) used to live here as
 * collapsibles. They moved to dedicated top-level tabs in the v0.7.x
 * reorg, then in v1.19.54 the standalone Carriers tab folded into
 * Scripts as a sub-tab \u2014 see CarrierSetupPanel.tsx and ScriptsTab.tsx.
 */

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const textInputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: 14,
  padding: '6px 10px',
  outline: 'none',
  fontFamily: 'inherit',
  width: 180,
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

const actionBtnStyle: React.CSSProperties = {
  background: '#3a3a3a',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 12px',
  fontFamily: 'inherit',
};

const groupInputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#e0e0e0',
  fontSize: 14,
  fontWeight: 600,
  padding: '4px 8px',
  outline: 'none',
  fontFamily: 'inherit',
  width: 200,
};

const unitInputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#e0e0e0',
  fontSize: 13,
  padding: '3px 6px',
  outline: 'none',
  fontFamily: 'inherit',
  width: 200,
};

const autoNameBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#aaaaaa',
  cursor: 'pointer',
  fontSize: 12,
  padding: '3px 8px',
  fontFamily: 'inherit',
  marginLeft: 'auto',
};
