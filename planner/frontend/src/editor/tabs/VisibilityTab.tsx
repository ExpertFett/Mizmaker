/**
 * Visibility Tab — mission-maker-controlled per-group intel filter.
 *
 * Use case: the mission maker has a few units on the battlefield
 * they want flight leads to see (briefed targets, friendly tankers)
 * and others they want hidden (the surprise SAM at the IP, the trap
 * convoy). Without this, flight leads can pre-plan their evasion
 * against threats they shouldn't know about until game time.
 *
 * Mission makers always see every group regardless of this filter
 * — only joined participants (role === 'flight_lead') get the
 * filtered map view.
 *
 * Persistence: session-only in v0.9.25. v0.9.26 will add the
 * `["plannerHiddenGroups"]` writer + parser so the visibility plan
 * round-trips through download / re-upload.
 */

import { useMemo, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useVisibilityStore } from '../../store/visibilityStore';

const COALITION_COLORS: Record<string, string> = {
  blue: '#4a8fd4',
  red: '#d95050',
  neutrals: '#aaaaaa',
};

const CATEGORY_ICON: Record<string, string> = {
  plane: '✈',
  helicopter: '🚁',
  ship: '🚢',
  vehicle: '🚙',
  static: '◻',
};

export function VisibilityTab() {
  const groups = useMissionStore((s) => s.groups);
  const role = useMissionStore((s) => s.role);

  const hiddenSet = useVisibilityStore((s) => s.hiddenForParticipants);
  const toggle = useVisibilityStore((s) => s.toggle);
  const setAll = useVisibilityStore((s) => s.setAll);
  const clearAll = useVisibilityStore((s) => s.clearAll);

  // Filter UI — coalition + category + name search. Lets the user
  // hone in on the trap-convoy among 30 vehicles without scrolling
  // through everything.
  const [coalitionFilter, setCoalitionFilter] = useState<'all' | 'blue' | 'red' | 'neutrals'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (coalitionFilter !== 'all' && g.coalition !== coalitionFilter) return false;
      if (categoryFilter !== 'all' && g.category !== categoryFilter) return false;
      if (search.trim() && !g.groupName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [groups, coalitionFilter, categoryFilter, search]);

  const hiddenCount = hiddenSet.size;
  const totalCount = groups.length;

  // Bulk-set helpers — "Hide all visible" / "Show all visible"
  // operate on the currently filtered list, so the user can hide
  // every red ground unit at once without affecting blue.
  const hideAllFiltered = () => {
    const next = new Set(hiddenSet);
    for (const g of filtered) next.add(g.groupId);
    setAll(Array.from(next));
  };
  const showAllFiltered = () => {
    const next = new Set(hiddenSet);
    for (const g of filtered) next.delete(g.groupId);
    setAll(Array.from(next));
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
          Group Visibility (Intel Control)
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa', lineHeight: 1.5 }}>
          Mission-maker-controlled list of groups hidden from flight
          leads when they join the planning session. Mission makers
          always see every group; only participants get the filtered
          view. Use this to hide surprise SAMs, trap convoys, or
          anything pilots shouldn't pre-plan against.
        </p>
        {role === 'flight_lead' && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 12px',
              background: 'rgba(210, 153, 34, 0.08)',
              border: '1px solid rgba(210, 153, 34, 0.4)',
              borderRadius: 4,
              fontSize: 13,
              color: '#d29922',
            }}
          >
            You're joined as a flight lead — this tab is read-only for
            participants. The mission maker controls visibility.
          </div>
        )}
      </div>

      {/* Summary strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 14,
          padding: '8px 12px',
          background: '#0a1218',
          border: '1px solid #222',
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <span style={{ color: '#e0e0e0', fontWeight: 600 }}>
          {hiddenCount} / {totalCount} hidden from flight leads
        </span>
        {hiddenCount > 0 && (
          <button
            onClick={() => clearAll()}
            disabled={role === 'flight_lead'}
            style={{
              marginLeft: 'auto',
              background: '#3a1a1a',
              border: '1px solid #5a2a2a',
              borderRadius: 4,
              color: '#d95050',
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 600,
              cursor: role === 'flight_lead' ? 'not-allowed' : 'pointer',
              opacity: role === 'flight_lead' ? 0.5 : 1,
              fontFamily: 'inherit',
            }}
          >
            Show All
          </button>
        )}
      </div>

      {/* Filter row */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name..."
          style={{
            flex: 1,
            minWidth: 200,
            background: '#262626',
            border: '1px solid #3a3a3a',
            borderRadius: 4,
            color: '#cccccc',
            fontSize: 13,
            padding: '6px 10px',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <select
          value={coalitionFilter}
          onChange={(e) => setCoalitionFilter(e.target.value as typeof coalitionFilter)}
          style={selectStyle}
        >
          <option value="all">All sides</option>
          <option value="blue">Blue</option>
          <option value="red">Red</option>
          <option value="neutrals">Neutral</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">All categories</option>
          <option value="plane">Aircraft</option>
          <option value="helicopter">Helicopters</option>
          <option value="ship">Ships</option>
          <option value="vehicle">Vehicles</option>
          <option value="static">Statics</option>
        </select>
        <button
          onClick={hideAllFiltered}
          disabled={role === 'flight_lead' || filtered.length === 0}
          style={bulkBtn('#5a2a2a', '#d95050', role === 'flight_lead' || filtered.length === 0)}
          title="Hide every group currently visible in the filtered list"
        >
          Hide all filtered
        </button>
        <button
          onClick={showAllFiltered}
          disabled={role === 'flight_lead' || filtered.length === 0}
          style={bulkBtn('#2a4a2a', '#3fb950', role === 'flight_lead' || filtered.length === 0)}
          title="Reveal every group currently visible in the filtered list"
        >
          Show all filtered
        </button>
      </div>

      {/* Group list */}
      {filtered.length === 0 ? (
        <div
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            background: 'rgba(74, 143, 212, 0.04)',
            border: '1px solid #4a4a4a',
            borderRadius: 6,
            color: '#aaaaaa',
            fontSize: 13,
          }}
        >
          {groups.length === 0 ? 'No groups in this mission.' : 'No groups match the current filters.'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #3a3a3a' }}>
              <th style={{ ...thStyle, width: 50 }}>HIDDEN</th>
              <th style={thStyle}>GROUP NAME</th>
              <th style={{ ...thStyle, width: 90 }}>SIDE</th>
              <th style={{ ...thStyle, width: 110 }}>CATEGORY</th>
              <th style={{ ...thStyle, width: 70 }}>UNITS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => {
              const isHidden = hiddenSet.has(g.groupId);
              const sideColor = COALITION_COLORS[g.coalition] || '#aaaaaa';
              return (
                <tr
                  key={g.groupId}
                  style={{
                    borderBottom: '1px solid #262626',
                    background: isHidden ? 'rgba(217, 80, 80, 0.06)' : undefined,
                  }}
                >
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isHidden}
                      disabled={role === 'flight_lead'}
                      onChange={() => toggle(g.groupId)}
                      style={{ accentColor: '#d95050', cursor: role === 'flight_lead' ? 'not-allowed' : 'pointer' }}
                    />
                  </td>
                  <td style={{ ...tdStyle, color: '#e0e0e0', fontWeight: 500 }}>
                    {g.groupName}
                  </td>
                  <td style={{ ...tdStyle, color: sideColor, fontWeight: 600 }}>
                    {g.coalition.toUpperCase()}
                  </td>
                  <td style={{ ...tdStyle, color: '#cccccc' }}>
                    <span style={{ marginRight: 6 }}>{CATEGORY_ICON[g.category] || '?'}</span>
                    {g.category}
                  </td>
                  <td style={{ ...tdStyle, color: '#aaaaaa', fontFamily: "'B612 Mono', monospace" }}>
                    {g.units.length}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  color: '#aaaaaa',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '6px 8px',
  verticalAlign: 'middle',
};

const selectStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: 13,
  padding: '6px 8px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
};

function bulkBtn(borderHex: string, fgHex: string, disabled: boolean): React.CSSProperties {
  return {
    background: '#262626',
    border: `1px solid ${disabled ? '#3a3a3a' : borderHex}`,
    borderRadius: 4,
    color: disabled ? '#666' : fgHex,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontFamily: 'inherit',
  };
}
