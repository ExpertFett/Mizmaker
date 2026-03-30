import { useState } from 'react';
import { useMissionStore } from '../store/missionStore';
import { useMapStore } from '../store/mapStore';
import type { MissionGroup } from '../types/mission';
import { filterGroups } from '../map/layers/routeLayer';
import { getAircraftType, isPlayerGroup } from '../utils/groups';

const COALITION_COLORS: Record<string, string> = {
  blue: '#4a8fd4',
  red: '#d95050',
  neutrals: '#8fa8c0',
};

const CATEGORY_ICONS: Record<string, string> = {
  plane: '\u2708',
  helicopter: '\u{1F681}',
  vehicle: '\u{1F69A}',
  ship: '\u26F5',
  static: '\u25CF',
};

export function GroupList() {
  const { groups, selectedGroupId, selectGroup } = useMissionStore();
  const viewMode = useMapStore((s) => s.viewMode);
  const [filter, setFilter] = useState('');
  const [coalitionFilter, setCoalitionFilter] = useState<string>('all');

  const viewFiltered = filterGroups(groups, viewMode);
  const filtered = viewFiltered.filter((g) => {
    if (coalitionFilter !== 'all' && g.coalition !== coalitionFilter) return false;
    if (filter && !g.groupName.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderBottom: '1px solid #1a2a3a' }}>
      <div style={{ padding: '8px 12px', display: 'flex', gap: 6 }}>
        <input
          type="text"
          placeholder="Filter groups..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            background: '#0f1a28',
            border: '1px solid #1a2a3a',
            borderRadius: 4,
            color: '#ccdae8',
            padding: '5px 8px',
            fontSize: 14,
          }}
        />
        <select
          value={coalitionFilter}
          onChange={(e) => setCoalitionFilter(e.target.value)}
          style={{
            background: '#0f1a28',
            border: '1px solid #1a2a3a',
            borderRadius: 4,
            color: '#ccdae8',
            fontSize: 14,
            padding: '4px',
          }}
        >
          <option value="all">All</option>
          <option value="blue">Blue</option>
          <option value="red">Red</option>
          <option value="neutrals">Neutral</option>
        </select>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 8px' }}>
        {filtered.map((g) => (
          <GroupItem
            key={g.groupId}
            group={g}
            selected={g.groupId === selectedGroupId}
            onSelect={() => selectGroup(g.groupId === selectedGroupId ? null : g.groupId)}
          />
        ))}
      </div>
    </div>
  );
}

function GroupItem({ group, selected, onSelect }: {
  group: MissionGroup; selected: boolean; onSelect: () => void;
}) {
  const { hiddenGroupIds, toggleGroupVisibility } = useMapStore();
  const hidden = hiddenGroupIds.has(group.groupId);
  const color = COALITION_COLORS[group.coalition] || '#888';
  const icon = CATEGORY_ICONS[group.category] || '';
  const wpCount = group.waypoints.length;
  const airframe = getAircraftType(group);
  const player = isPlayerGroup(group);

  const handleEye = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleGroupVisibility(group.groupId);
  };

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '7px 10px',
        marginBottom: 2,
        borderRadius: 4,
        cursor: 'pointer',
        background: selected ? 'rgba(74, 143, 212, 0.15)' : 'transparent',
        borderLeft: `3px solid ${color}`,
        fontSize: 14,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        opacity: hidden ? 0.4 : 1,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ marginRight: 6 }}>{icon}</span>
        <span style={{ color: '#ccdae8', fontWeight: selected ? 600 : 400, fontSize: 14 }}>
          {group.groupName}
        </span>
        {player && <span style={{ color: '#3fb950', marginLeft: 6, fontSize: 11, fontWeight: 600 }}>PLAYER</span>}
        <div style={{ fontSize: 12, color: '#6a8a9a', marginTop: 2, marginLeft: 22 }}>
          {airframe} | {group.task}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ color: '#5a7a8a', fontSize: 12 }}>{wpCount} wp</span>
        <button
          onClick={handleEye}
          title={hidden ? 'Show route' : 'Hide route'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 15,
            color: hidden ? '#3a4a5a' : '#6a8a9a',
            padding: '0 2px',
            lineHeight: 1,
          }}
        >
          {hidden ? '\u25CB' : '\u25C9'}
        </button>
      </div>
    </div>
  );
}
