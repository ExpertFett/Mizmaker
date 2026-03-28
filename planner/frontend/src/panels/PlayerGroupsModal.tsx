import { useState, useCallback } from 'react';
import { useMissionStore } from '../store/missionStore';
import { useEditStore } from '../store/editStore';
import { editWaypoints } from '../api/client';
import { metersToFeet, feetToMeters, msToKnots, knotsToMs, formatLatLon } from '../utils/conversions';
import { getAircraftType, getFlightColor } from '../utils/groups';
import type { MissionGroup, Waypoint } from '../types/mission';

const ACTION_TYPES = [
  'Turning Point', 'Fly Over Point', 'From Parking Area',
  'From Parking Area Hot', 'From Runway', 'Landing',
  'Off Road', 'On Road', 'Custom',
];

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
        onClick={() => setOpen(true)}
        style={{
          padding: '8px 12px',
          background: '#0f2a4a',
          border: '1px solid #1a3a5a',
          borderRadius: 4,
          color: '#3fb950',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          width: '100%',
        }}
      >
        Flyable Groups ({playerGroups.length})
      </button>
      {open && <PlayerGroupsModal groups={playerGroups} onClose={() => setOpen(false)} />}
    </>
  );
}

function PlayerGroupsModal({
  groups,
  onClose,
}: {
  groups: MissionGroup[];
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(
    groups.length > 0 ? groups[0].groupId : null,
  );
  const selectGroup = useMissionStore((s) => s.selectGroup);
  const selected = groups.find((g) => g.groupId === selectedId);

  // Track which player index for color
  const colorMap = new Map<number, string>();
  groups.forEach((g, i) => colorMap.set(g.groupId, getFlightColor(g, i)));

  const handleSelectOnMap = (groupId: number) => {
    selectGroup(groupId);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#0a1520',
          border: '1px solid #1a3a5a',
          borderRadius: 8,
          width: 900,
          maxWidth: '92vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #1a2a3a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16, color: '#ccdae8', fontWeight: 600 }}>Flyable Groups</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#5a7a8a', fontSize: 18, cursor: 'pointer' }}>X</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Group tabs */}
          <div style={{ width: 220, minWidth: 220, borderRight: '1px solid #1a2a3a', overflow: 'auto', padding: '8px 0' }}>
            {groups.map((g) => (
              <GroupTab
                key={g.groupId}
                group={g}
                color={colorMap.get(g.groupId) || '#58a6ff'}
                isSelected={g.groupId === selectedId}
                onClick={() => setSelectedId(g.groupId)}
              />
            ))}
          </div>

          {/* Flight plan */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {selected ? (
              <FlightPlan
                group={selected}
                color={colorMap.get(selected.groupId) || '#58a6ff'}
                onSelectOnMap={handleSelectOnMap}
              />
            ) : (
              <div style={{ padding: 20, color: '#5a7a8a' }}>Select a group</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupTab({ group, color, isSelected, onClick }: {
  group: MissionGroup; color: string; isSelected: boolean; onClick: () => void;
}) {
  const clientCount = group.units.filter((u) => u.skill === 'Client' || u.skill === 'Player').length;
  const airframe = getAircraftType(group);

  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 14px',
        cursor: 'pointer',
        background: isSelected ? 'rgba(255,255,255,0.05)' : 'transparent',
        borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
      }}
    >
      <div style={{ fontSize: 13, color: isSelected ? '#ccdae8' : '#8fa8c0', fontWeight: isSelected ? 600 : 400 }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 8 }} />
        {group.groupName}
      </div>
      <div style={{ fontSize: 10, color: '#5a7a8a', marginTop: 2, marginLeft: 16 }}>
        {airframe} | {clientCount} slots | {group.waypoints.length} WPs
      </div>
    </div>
  );
}

function FlightPlan({ group, color, onSelectOnMap }: {
  group: MissionGroup; color: string; onSelectOnMap: (id: number) => void;
}) {
  const { sessionId, updateGroupData } = useMissionStore();
  const { addEdit } = useEditStore();
  const clientUnits = group.units.filter((u) => u.skill === 'Client' || u.skill === 'Player');
  const airframe = getAircraftType(group);

  const handlePropChange = useCallback(async (wpIndex: number, field: string, value: string | number | boolean) => {
    if (!sessionId) return;
    const edit = { type: 'waypointProp' as const, groupId: group.groupId, wpIndex, field, value };
    addEdit(edit);
    try {
      const result = await editWaypoints(sessionId, [edit]);
      if (result.ok) updateGroupData(result.groups, result.units, result.threats, result.airbases);
    } catch (e) { console.error('Edit failed:', e); }
  }, [sessionId, group.groupId, addEdit, updateGroupData]);

  const handleDelete = useCallback(async (wpIndex: number) => {
    if (!sessionId || group.waypoints.length <= 1 || wpIndex === 0) return;
    const edit = { type: 'waypointDelete' as const, groupId: group.groupId, wpIndex };
    addEdit(edit);
    try {
      const result = await editWaypoints(sessionId, [edit]);
      if (result.ok) updateGroupData(result.groups, result.units, result.threats, result.airbases);
    } catch (e) { console.error('Delete failed:', e); }
  }, [sessionId, group.groupId, group.waypoints.length, addEdit, updateGroupData]);

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #1a2a3a' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#ccdae8' }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 8 }} />
              {group.groupName}
            </div>
            <div style={{ fontSize: 11, color: '#5a7a8a', marginTop: 2 }}>
              {airframe} | {group.task} | {group.frequency ? `${group.frequency.toFixed(1)} MHz` : ''} | {group.country}
            </div>
          </div>
          <button
            onClick={() => onSelectOnMap(group.groupId)}
            style={{ padding: '6px 12px', background: '#0f2a4a', border: '1px solid #1a3a5a', borderRadius: 4, color: '#4a8fd4', cursor: 'pointer', fontSize: 11 }}
          >
            Show on Map
          </button>
        </div>

        {/* Pilot slots */}
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {clientUnits.map((u) => (
            <div key={u.unitId} style={{ padding: '4px 10px', background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4, fontSize: 11 }}>
              <span style={{ color: '#ccdae8' }}>{u.name}</span>
              <span style={{ color: '#5a7a8a', marginLeft: 6 }}>{u.type}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Editable waypoint table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, color: '#ccdae8' }}>
        <thead>
          <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a', background: '#080f1c', position: 'sticky', top: 0 }}>
            <th style={thStyle}>WP</th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Position</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Alt (ft)</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Spd (kts)</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Dist</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Brg</th>
            <th style={thStyle}>Action</th>
            <th style={{ ...thStyle, width: 28 }}></th>
          </tr>
        </thead>
        <tbody>
          {group.waypoints.map((wp) => (
            <EditableWpRow
              key={wp.waypoint_number}
              wp={wp}
              canDelete={group.waypoints.length > 1 && wp.waypoint_number !== 0}
              onPropChange={handlePropChange}
              onDelete={handleDelete}
            />
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid #1a2a3a', color: '#5a7a8a' }}>
            <td colSpan={5} style={{ padding: '6px 10px', fontSize: 11 }}>Total</td>
            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
              {group.waypoints.reduce((s, w) => s + (w.leg_distance_nm || 0), 0).toFixed(1)} nm
            </td>
            <td colSpan={3}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function EditableWpRow({ wp, canDelete, onPropChange, onDelete }: {
  wp: Waypoint; canDelete: boolean;
  onPropChange: (i: number, f: string, v: string | number | boolean) => void;
  onDelete: (i: number) => void;
}) {
  const isWp0 = wp.waypoint_number === 0;
  const altFt = Math.round(metersToFeet(wp.altitude_m));
  const spdKts = Math.round(msToKnots(wp.speed_ms));
  const distNm = wp.leg_distance_nm?.toFixed(1) || '-';
  const brg = wp.leg_bearing_deg ? `${Math.round(wp.leg_bearing_deg)}\u00B0` : '-';
  const pos = wp.lat && wp.lon ? formatLatLon(wp.lat, wp.lon) : '-';

  const inputStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', color: '#ccdae8',
    fontSize: 11, fontFamily: 'monospace', padding: 0,
  };

  return (
    <tr style={{ borderBottom: '1px solid #0f1a28', opacity: isWp0 ? 0.5 : 1 }}>
      <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#5a7a8a' }}>{wp.waypoint_number}</td>
      <td style={tdStyle}>
        {isWp0 ? (
          <span style={{ color: '#5a7a8a' }}>{wp.waypoint_name}</span>
        ) : (
          <input defaultValue={wp.waypoint_name} onBlur={(e) => onPropChange(wp.waypoint_number, 'name', e.target.value)}
            style={{ ...inputStyle, width: 80 }} />
        )}
      </td>
      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: '#5a7a8a' }}>{pos}</td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        {isWp0 ? (
          <span style={{ fontFamily: 'monospace', color: '#5a7a8a' }}>{altFt}</span>
        ) : (
          <input type="number" defaultValue={altFt}
            onBlur={(e) => onPropChange(wp.waypoint_number, 'alt', feetToMeters(parseFloat(e.target.value)))}
            style={{ ...inputStyle, width: 55, textAlign: 'right' }} />
        )}
        <span style={{ fontSize: 9, color: '#5a7a8a', marginLeft: 2 }}>{wp.altitude_type === 'RADIO' ? 'AGL' : 'MSL'}</span>
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        {isWp0 ? (
          <span style={{ fontFamily: 'monospace', color: '#5a7a8a' }}>{spdKts}</span>
        ) : (
          <input type="number" defaultValue={spdKts}
            onBlur={(e) => onPropChange(wp.waypoint_number, 'speed', knotsToMs(parseFloat(e.target.value)))}
            style={{ ...inputStyle, width: 45, textAlign: 'right' }} />
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: '#5a7a8a' }}>{distNm}</td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: '#5a7a8a' }}>{brg}</td>
      <td style={tdStyle}>
        {isWp0 ? (
          <span style={{ fontSize: 10, color: '#5a7a8a' }}>{wp.waypoint_action}</span>
        ) : (
          <select defaultValue={wp.waypoint_action}
            onChange={(e) => onPropChange(wp.waypoint_number, 'action', e.target.value)}
            style={{ background: '#0f1a28', border: '1px solid #1a2a3a', color: '#8fa8c0', fontSize: 10, borderRadius: 3, padding: '1px 2px' }}>
            {ACTION_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: 'center' }}>
        {canDelete && (
          <button onClick={() => onDelete(wp.waypoint_number)} title="Delete waypoint"
            style={{ background: 'transparent', border: '1px solid transparent', color: '#5a7a8a', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '2px 4px', borderRadius: 3 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#d95050'; e.currentTarget.style.borderColor = '#d95050'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#5a7a8a'; e.currentTarget.style.borderColor = 'transparent'; }}>
            X
          </button>
        )}
      </td>
    </tr>
  );
}

const thStyle: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontWeight: 500 };
const tdStyle: React.CSSProperties = { padding: '5px 10px' };
