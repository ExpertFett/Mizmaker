import { useState } from 'react';
import { useMissionStore } from '../store/missionStore';
import { useMapStore } from '../store/mapStore';
import { metersToFeet, msToKnots } from '../utils/conversions';
import { getAircraftType, getFlightColor } from '../utils/groups';
import type { MissionGroup, Waypoint } from '../types/mission';

export function PlayerGroupsButton() {
  const [open, setOpen] = useState(false);
  const groups = useMissionStore((s) => s.groups);
  const playerGroups = groups.filter((g) =>
    g.units.some((u) => u.skill === 'Client' || u.skill === 'Player'),
  );

  if (playerGroups.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '10px 14px',
          background: open ? 'rgba(63, 185, 80, 0.15)' : 'rgba(63, 185, 80, 0.08)',
          border: `2px solid ${open ? '#3fb950' : '#2a5a3a'}`,
          borderRadius: 6,
          color: '#3fb950',
          cursor: 'pointer',
          fontSize: 15,
          fontWeight: 600,
          width: '100%',
        }}
      >
        {open ? '\u25BC' : '\u25B6'} Flights ({playerGroups.length})
      </button>
      {open && <PlayerFlightCards groups={playerGroups} />}
    </>
  );
}

function PlayerFlightCards({ groups }: { groups: MissionGroup[] }) {
  const selectGroup = useMissionStore((s) => s.selectGroup);
  const selectedGroupId = useMissionStore((s) => s.selectedGroupId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      {groups.map((g, i) => (
        <FlightCard
          key={g.groupId}
          group={g}
          color={getFlightColor(g, i)}
          isSelected={g.groupId === selectedGroupId}
          onSelect={() => selectGroup(g.groupId === selectedGroupId ? null : g.groupId)}
        />
      ))}
    </div>
  );
}

function FlightCard({ group, color, isSelected, onSelect }: {
  group: MissionGroup; color: string; isSelected: boolean; onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { hiddenGroupIds, toggleGroupVisibility } = useMapStore();
  const hidden = hiddenGroupIds.has(group.groupId);
  const airframe = getAircraftType(group);
  const clientCount = group.units.filter((u) => u.skill === 'Client' || u.skill === 'Player').length;
  const totalDist = group.waypoints.reduce((s, w) => s + (w.leg_distance_nm || 0), 0);

  const handleEye = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleGroupVisibility(group.groupId);
  };

  return (
    <div
      style={{
        background: isSelected ? 'rgba(255,255,255,0.05)' : '#0a1520',
        border: `1px solid ${isSelected ? color : '#1a2a3a'}`,
        borderRadius: 5,
        overflow: 'hidden',
        opacity: hidden ? 0.4 : 1,
      }}
    >
      {/* Header — click to select on map */}
      <div
        onClick={onSelect}
        style={{
          padding: '8px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          borderLeft: `3px solid ${color}`,
        }}
      >
        <div>
          <span style={{ fontWeight: 600, color: '#ccdae8', fontSize: 14 }}>{group.groupName}</span>
          <span style={{ color: '#6a8a9a', fontSize: 12, marginLeft: 8 }}>{airframe}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#5a7a8a', fontSize: 12 }}>{clientCount} slots</span>
          <button
            onClick={handleEye}
            title={hidden ? 'Show route' : 'Hide route'}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 15, color: hidden ? '#3a4a5a' : '#6a8a9a', padding: '0 2px', lineHeight: 1,
            }}
          >
            {hidden ? '\u25CB' : '\u25C9'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{
              background: 'transparent', border: 'none', color: '#5a7a8a',
              cursor: 'pointer', fontSize: 12, padding: '2px 4px',
            }}
          >
            {expanded ? '\u25B2' : '\u25BC'}
          </button>
        </div>
      </div>

      {/* Compact route summary — always visible */}
      <div style={{ padding: '0 10px 6px 13px', fontSize: 12, color: '#5a7a8a', display: 'flex', gap: 8 }}>
        <span>{group.task}</span>
        <span>{group.waypoints.length} WPs</span>
        <span>{totalDist.toFixed(0)} nm</span>
        {group.frequency ? <span>{group.frequency.toFixed(1)} MHz</span> : null}
      </div>

      {/* Expanded waypoint list */}
      {expanded && (
        <div style={{ borderTop: '1px solid #1a2a3a', maxHeight: 200, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#ccdae8' }}>
            <tbody>
              {group.waypoints.map((wp) => (
                <CompactWpRow key={wp.waypoint_number} wp={wp} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CompactWpRow({ wp }: { wp: Waypoint }) {
  const altFt = Math.round(metersToFeet(wp.altitude_m));
  const spdKts = Math.round(msToKnots(wp.speed_ms));
  const distNm = wp.leg_distance_nm?.toFixed(1) || '-';
  const brg = wp.leg_bearing_deg ? `${Math.round(wp.leg_bearing_deg)}\u00B0` : '-';
  const isWp0 = wp.waypoint_number === 0;

  return (
    <tr style={{ borderBottom: '1px solid #0a1520', opacity: isWp0 ? 0.4 : 1 }}>
      <td style={{ padding: '3px 6px', fontFamily: 'monospace', color: '#5a7a8a', width: 24 }}>{wp.waypoint_number}</td>
      <td style={{ padding: '3px 6px' }}>{wp.waypoint_name}</td>
      <td style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'monospace' }}>{altFt}</td>
      <td style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'monospace', color: '#5a7a8a' }}>{spdKts || '-'}</td>
      <td style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'monospace', color: '#5a7a8a' }}>{distNm}</td>
      <td style={{ padding: '3px 6px', textAlign: 'right', fontFamily: 'monospace', color: '#5a7a8a' }}>{brg}</td>
    </tr>
  );
}
