import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface LiveryUnit {
  unitId: number;
  name: string;
  groupName: string;
  livery_id: string;
}

interface LiveryEntry {
  type: string;
  coalition: string;
  category: string;
  units: LiveryUnit[];
  liveries: string[];
}

interface AvailLivery {
  id: string;
  name: string;
}

type CoalitionFilter = 'all' | 'blue' | 'red';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Make a livery id more human-readable */
function formatLiveryName(raw: string): string {
  if (!raw) return '(default)';
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Group units by their group name */
function groupByGroupName(units: LiveryUnit[]): Map<string, LiveryUnit[]> {
  const map = new Map<string, LiveryUnit[]>();
  for (const u of units) {
    if (!map.has(u.groupName)) map.set(u.groupName, []);
    map.get(u.groupName)!.push(u);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

export function LiveryTab() {
  const liveryData = useMissionStore((s) => s.liveryData) as LiveryEntry[];
  const addEdit = useEditStore((s) => s.addEdit);

  const [filter, setFilter] = useState('');
  const [coalitionFilter, setCoalitionFilter] = useState<CoalitionFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [changes, setChanges] = useState<Map<number, string>>(new Map());
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  const originals = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    const map = new Map<number, string>();
    for (const entry of liveryData) {
      for (const u of entry.units) {
        map.set(u.unitId, u.livery_id);
      }
    }
    originals.current = map;
  }, [liveryData]);

  // Unique aircraft types and categories for filter pills
  const aircraftTypes = useMemo(() => {
    const types = new Set<string>();
    for (const e of liveryData) types.add(e.type);
    return Array.from(types).sort();
  }, [liveryData]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const e of liveryData) if (e.category) cats.add(e.category);
    return Array.from(cats).sort();
  }, [liveryData]);

  const filtered = useMemo(() => {
    let entries = liveryData;
    if (coalitionFilter !== 'all') {
      entries = entries.filter((e) => e.coalition === coalitionFilter);
    }
    if (categoryFilter !== 'all') {
      entries = entries.filter((e) => e.category === categoryFilter);
    }
    if (typeFilter !== 'all') {
      entries = entries.filter((e) => e.type === typeFilter);
    }
    if (filter) {
      const q = filter.toLowerCase();
      entries = entries.filter((e) =>
        e.type.toLowerCase().includes(q) ||
        e.units.some((u) => u.name.toLowerCase().includes(q) || u.groupName.toLowerCase().includes(q)),
      );
    }
    return entries;
  }, [liveryData, filter, coalitionFilter, typeFilter, categoryFilter]);

  const handleLiveryChange = useCallback((unitId: number, value: string) => {
    setChanges((prev) => {
      const next = new Map(prev);
      next.set(unitId, value);
      return next;
    });
    addEdit({ unitId, field: 'livery', value } as any);
  }, [addEdit]);

  const handleGroupApply = useCallback((units: LiveryUnit[], liveryId: string) => {
    for (const u of units) {
      handleLiveryChange(u.unitId, liveryId);
    }
  }, [handleLiveryChange]);

  const handleTypeApply = useCallback((entry: LiveryEntry, liveryId: string) => {
    for (const u of entry.units) {
      handleLiveryChange(u.unitId, liveryId);
    }
  }, [handleLiveryChange]);

  const isChanged = useCallback((unitId: number): boolean => {
    const current = changes.get(unitId);
    if (current === undefined) return false;
    return current !== originals.current.get(unitId);
  }, [changes]);

  const toggleType = useCallback((type: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Stats
  const totalUnits = useMemo(() => filtered.reduce((s, e) => s + e.units.length, 0), [filtered]);
  const changedCount = useMemo(() => {
    let count = 0;
    for (const entry of filtered) {
      for (const u of entry.units) {
        if (isChanged(u.unitId)) count++;
      }
    }
    return count;
  }, [filtered, isChanged]);

  if (liveryData.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 15, padding: 20 }}>
        No livery data available for this mission.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
          Livery Editor
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#5a7a8a' }}>
          Set paint schemes per group or per individual unit. Click a type card to expand unit-level controls.
        </p>
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <input
          placeholder="Search type, unit, or group..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={filterInputStyle}
        />

        {/* Coalition pills */}
        <div style={{ display: 'flex', gap: 2, background: '#0a1520', borderRadius: 4, border: '1px solid #1a2a3a', padding: 2 }}>
          {(['all', 'blue', 'red'] as CoalitionFilter[]).map((c) => (
            <button
              key={c}
              onClick={() => setCoalitionFilter(c)}
              style={{
                background: coalitionFilter === c ? (c === 'blue' ? '#1a2a4a' : c === 'red' ? '#3a1a1a' : '#1a2a3a') : 'transparent',
                border: 'none',
                borderRadius: 3,
                color: coalitionFilter === c
                  ? (c === 'blue' ? '#4a8fd4' : c === 'red' ? '#d95050' : '#ccdae8')
                  : '#5a7a8a',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: coalitionFilter === c ? 600 : 400,
                padding: '4px 10px',
                textTransform: 'uppercase',
              }}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Category filter */}
        {categories.length > 1 && (
          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setTypeFilter('all'); }}
            style={filterSelectStyle}
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
            ))}
          </select>
        )}

        {/* Stats */}
        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#5a7a8a' }}>
          {filtered.length} type{filtered.length !== 1 ? 's' : ''}, {totalUnits} unit{totalUnits !== 1 ? 's' : ''}
          {changedCount > 0 && (
            <span style={{ color: '#3fb950', marginLeft: 8 }}>
              {changedCount} changed
            </span>
          )}
        </div>
      </div>

      {/* Aircraft type filter pills */}
      {aircraftTypes.length > 1 && (
        <div style={{
          display: 'flex', gap: 3, marginBottom: 16, flexWrap: 'wrap',
          background: '#0a1520', borderRadius: 4, border: '1px solid #1a2a3a', padding: 3,
        }}>
          <button
            onClick={() => setTypeFilter('all')}
            style={{
              background: typeFilter === 'all' ? '#1a2a3a' : 'transparent',
              border: 'none', borderRadius: 3,
              color: typeFilter === 'all' ? '#ccdae8' : '#5a7a8a',
              cursor: 'pointer', fontSize: 12, fontWeight: typeFilter === 'all' ? 600 : 400,
              padding: '5px 12px', whiteSpace: 'nowrap',
            }}
          >
            All Types
          </button>
          {aircraftTypes
            .filter((t) => {
              // If category filter active, only show types matching that category
              if (categoryFilter === 'all') return true;
              return liveryData.some((e) => e.type === t && e.category === categoryFilter);
            })
            .map((t) => {
              const count = liveryData.filter((e) => e.type === t).reduce((s, e) => s + e.units.length, 0);
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
                  style={{
                    background: typeFilter === t ? '#1a2a3a' : 'transparent',
                    border: 'none', borderRadius: 3,
                    color: typeFilter === t ? '#ccdae8' : '#5a7a8a',
                    cursor: 'pointer', fontSize: 12, fontWeight: typeFilter === t ? 600 : 400,
                    padding: '5px 10px', whiteSpace: 'nowrap',
                  }}
                >
                  {t} <span style={{ color: '#3a5a6a', fontSize: 11 }}>({count})</span>
                </button>
              );
            })}
        </div>
      )}

      {/* Type cards */}
      {filtered.map((entry) => (
        <TypeCard
          key={`${entry.coalition}-${entry.type}`}
          entry={entry}
          changes={changes}
          isChanged={isChanged}
          isExpanded={expandedTypes.has(entry.type)}
          onToggle={() => toggleType(entry.type)}
          onLiveryChange={handleLiveryChange}
          onGroupApply={handleGroupApply}
          onTypeApply={handleTypeApply}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Type Card — one per aircraft type                                   */
/* ------------------------------------------------------------------ */

interface TypeCardProps {
  entry: LiveryEntry;
  changes: Map<number, string>;
  isChanged: (unitId: number) => boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onLiveryChange: (unitId: number, value: string) => void;
  onGroupApply: (units: LiveryUnit[], liveryId: string) => void;
  onTypeApply: (entry: LiveryEntry, liveryId: string) => void;
}

function TypeCard({
  entry, changes, isChanged, isExpanded, onToggle,
  onLiveryChange, onGroupApply, onTypeApply,
}: TypeCardProps) {
  const [availableLiveries, setAvailableLiveries] = useState<AvailLivery[]>([]);
  const [bulkLivery, setBulkLivery] = useState('');

  const coalitionColor = entry.coalition === 'blue' ? '#4a8fd4'
    : entry.coalition === 'red' ? '#d95050' : '#8a8a5a';

  // Fetch liveries for this type
  useEffect(() => {
    fetch(`/api/liveries/${encodeURIComponent(entry.type)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setAvailableLiveries(data);
        } else {
          setAvailableLiveries(entry.liveries.map((l) => ({ id: l, name: l })));
        }
      })
      .catch(() => {
        setAvailableLiveries(entry.liveries.map((l) => ({ id: l, name: l })));
      });
  }, [entry.type, entry.liveries]);

  // Group units by group name
  const unitGroups = useMemo(() => groupByGroupName(entry.units), [entry.units]);

  // Count how many changed in this entry
  const changedInType = useMemo(() => {
    return entry.units.filter((u) => isChanged(u.unitId)).length;
  }, [entry.units, isChanged]);

  // Summarize current liveries in use
  const liverySummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of entry.units) {
      const current = changes.get(u.unitId) ?? u.livery_id;
      counts.set(current, (counts.get(current) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, count }));
  }, [entry.units, changes]);

  return (
    <div style={{
      marginBottom: 10,
      border: `1px solid ${changedInType > 0 ? '#2a3a2a' : '#1a2a3a'}`,
      borderRadius: 6,
      background: '#0a1520',
      overflow: 'hidden',
    }}>
      {/* Header — always visible */}
      <div
        onClick={onToggle}
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer',
          borderLeft: `3px solid ${coalitionColor}`,
          background: isExpanded ? '#0c1825' : 'transparent',
        }}
      >
        {/* Expand arrow */}
        <span style={{ color: '#5a7a8a', fontSize: 12, userSelect: 'none', width: 12 }}>
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>

        {/* Coalition badge */}
        <span style={{
          background: coalitionColor,
          color: '#080f1c', fontSize: 10, fontWeight: 700,
          padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {entry.coalition}
        </span>

        {/* Type name */}
        <span style={{ color: '#ccdae8', fontWeight: 600, fontSize: 15, flex: '0 0 auto' }}>
          {entry.type}
        </span>

        {/* Unit count */}
        <span style={{ color: '#5a7a8a', fontSize: 13 }}>
          {entry.units.length} unit{entry.units.length !== 1 ? 's' : ''} in {unitGroups.size} group{unitGroups.size !== 1 ? 's' : ''}
        </span>

        {/* Current livery pills */}
        <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap', overflow: 'hidden' }}>
          {liverySummary.slice(0, 3).map(({ id, count }) => (
            <span key={id} style={{
              fontSize: 11, color: '#8fa8c0', background: '#0f1a28',
              padding: '2px 8px', borderRadius: 10, border: '1px solid #1a2a3a',
              whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {formatLiveryName(id)}{count > 1 ? ` (${count})` : ''}
            </span>
          ))}
          {liverySummary.length > 3 && (
            <span style={{ fontSize: 11, color: '#5a7a8a' }}>+{liverySummary.length - 3} more</span>
          )}
        </div>

        {/* Changed indicator */}
        {changedInType > 0 && (
          <span style={{
            fontSize: 11, color: '#3fb950', fontWeight: 600,
            background: '#1a2a1a', padding: '2px 8px', borderRadius: 10,
          }}>
            {changedInType} changed
          </span>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid #1a2a3a' }}>
          {/* Bulk apply bar */}
          <div style={{
            padding: '10px 16px',
            background: '#080f1c',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            borderBottom: '1px solid #1a2a3a',
          }}>
            <span style={{ fontSize: 12, color: '#5a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Set All {entry.type}
            </span>
            <select
              value={bulkLivery}
              onChange={(e) => setBulkLivery(e.target.value)}
              style={{ ...selectStyle, flex: 1, maxWidth: 350 }}
            >
              <option value="">-- select livery --</option>
              {availableLiveries.map((l) => (
                <option key={l.id} value={l.id}>{l.name || formatLiveryName(l.id)}</option>
              ))}
            </select>
            <button
              onClick={() => { if (bulkLivery) onTypeApply(entry, bulkLivery); }}
              disabled={!bulkLivery}
              style={{
                ...actionBtnStyle,
                opacity: bulkLivery ? 1 : 0.4,
              }}
            >
              Apply to All
            </button>
          </div>

          {/* Group rows */}
          {Array.from(unitGroups).map(([groupName, units]) => (
            <GroupRow
              key={groupName}
              groupName={groupName}
              units={units}
              changes={changes}
              isChanged={isChanged}
              availableLiveries={availableLiveries}
              onLiveryChange={onLiveryChange}
              onGroupApply={onGroupApply}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Group Row — one per flight/group within a type                      */
/* ------------------------------------------------------------------ */

interface GroupRowProps {
  groupName: string;
  units: LiveryUnit[];
  changes: Map<number, string>;
  isChanged: (unitId: number) => boolean;
  availableLiveries: AvailLivery[];
  onLiveryChange: (unitId: number, value: string) => void;
  onGroupApply: (units: LiveryUnit[], liveryId: string) => void;
}

function GroupRow({
  groupName, units, changes, isChanged,
  availableLiveries, onLiveryChange, onGroupApply,
}: GroupRowProps) {
  const [showUnits, setShowUnits] = useState(false);

  // Current livery for group-level dropdown (use first unit's current value)
  const groupLivery = changes.get(units[0].unitId) ?? units[0].livery_id;

  // Check if all units in group have the same livery
  const allSame = useMemo(() => {
    const first = changes.get(units[0].unitId) ?? units[0].livery_id;
    return units.every((u) => (changes.get(u.unitId) ?? u.livery_id) === first);
  }, [units, changes]);

  const changedCount = units.filter((u) => isChanged(u.unitId)).length;

  return (
    <div style={{ borderBottom: '1px solid #0f1a28' }}>
      {/* Group-level row */}
      <div style={{
        padding: '8px 16px 8px 32px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        {/* Expand for per-unit control */}
        <button
          onClick={() => setShowUnits(!showUnits)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#5a7a8a', fontSize: 11, padding: '2px 4px',
          }}
          title="Per-unit livery control"
        >
          {showUnits ? '\u25BC' : '\u25B6'}
        </button>

        {/* Group name */}
        <span style={{ color: '#8fa8c0', fontSize: 14, fontWeight: 500, minWidth: 140 }}>
          {groupName}
        </span>

        {/* Unit count */}
        <span style={{ color: '#3a5a6a', fontSize: 12 }}>
          {units.length} unit{units.length !== 1 ? 's' : ''}
        </span>

        {/* Group-level livery selector */}
        <select
          value={allSame ? groupLivery : '__mixed__'}
          onChange={(e) => {
            if (e.target.value !== '__mixed__') {
              onGroupApply(units, e.target.value);
            }
          }}
          style={{
            ...selectStyle,
            flex: 1,
            maxWidth: 320,
            ...(changedCount > 0 ? { borderColor: '#3fb950' } : {}),
          }}
        >
          {!allSame && <option value="__mixed__">-- mixed liveries --</option>}
          {availableLiveries.map((l) => (
            <option key={l.id} value={l.id}>{l.name || formatLiveryName(l.id)}</option>
          ))}
          {/* If current livery isn't in the available list, show it */}
          {allSame && !availableLiveries.find((l) => l.id === groupLivery) && (
            <option value={groupLivery}>{formatLiveryName(groupLivery)} (current)</option>
          )}
        </select>

        {/* Changed indicator */}
        {changedCount > 0 && (
          <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 500 }}>
            {changedCount} changed
          </span>
        )}
      </div>

      {/* Per-unit rows (only when expanded) */}
      {showUnits && (
        <div style={{ padding: '0 16px 8px 64px' }}>
          {units.map((u) => {
            const currentValue = changes.get(u.unitId) ?? u.livery_id;
            const changed = isChanged(u.unitId);
            return (
              <div key={u.unitId} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '4px 0',
                borderBottom: '1px solid #080f1c',
              }}>
                <span style={{ color: '#5a7a8a', fontSize: 13, minWidth: 130 }}>
                  {u.name}
                </span>
                <select
                  value={currentValue}
                  onChange={(e) => onLiveryChange(u.unitId, e.target.value)}
                  style={{
                    ...selectStyle,
                    fontSize: 12,
                    flex: 1,
                    maxWidth: 300,
                    ...(changed ? { borderColor: '#3fb950' } : {}),
                  }}
                >
                  {/* Current value if not in list */}
                  {!availableLiveries.find((l) => l.id === currentValue) && (
                    <option value={currentValue}>{formatLiveryName(currentValue)} (current)</option>
                  )}
                  {availableLiveries.map((l) => (
                    <option key={l.id} value={l.id}>{l.name || formatLiveryName(l.id)}</option>
                  ))}
                </select>
                {changed && (
                  <span style={{ fontSize: 10, color: '#3fb950' }}>modified</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const filterInputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#ccdae8',
  fontSize: 14,
  padding: '8px 12px',
  width: 280,
  outline: 'none',
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#ccdae8',
  fontSize: 13,
  padding: '5px 8px',
  outline: 'none',
  fontFamily: 'inherit',
};

const actionBtnStyle: React.CSSProperties = {
  background: '#1a2a3a',
  border: '1px solid #2a3a4a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 14px',
  fontWeight: 500,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

const filterSelectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#ccdae8',
  fontSize: 13,
  padding: '6px 10px',
  outline: 'none',
  fontFamily: 'inherit',
};
