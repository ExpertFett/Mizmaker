import { useMissionStore } from '../store/missionStore';
import { useEditStore } from '../store/editStore';
import { editWaypoints } from '../api/client';
import { metersToFeet, msToKnots } from '../utils/conversions';
import type { Waypoint } from '../types/mission';

const ACTION_TYPES = [
  'Turning Point',
  'Fly Over Point',
  'From Parking Area',
  'From Parking Area Hot',
  'From Runway',
  'Landing',
  'Off Road',
  'On Road',
  'Custom',
];

export function WaypointPanel() {
  const { groups, selectedGroupId, sessionId, updateGroupData } =
    useMissionStore();
  const { addEdit } = useEditStore();

  const group = groups.find((g) => g.groupId === selectedGroupId);
  if (!group) {
    return (
      <div style={{ padding: 20, color: '#5a7a8a', textAlign: 'center', fontSize: 13 }}>
        Select a group to view waypoints
      </div>
    );
  }

  const handlePropChange = async (
    wpIndex: number,
    field: string,
    value: string | number | boolean,
  ) => {
    if (!sessionId) return;
    const edit = { type: 'waypointProp' as const, groupId: group.groupId, wpIndex, field, value };
    addEdit(edit);
    try {
      const result = await editWaypoints(sessionId, [edit]);
      if (result.ok) {
        updateGroupData(result.groups, result.units, result.threats, result.airbases);
      }
    } catch (e) {
      console.error('Edit failed:', e);
    }
  };

  const handleDelete = async (wpIndex: number) => {
    if (!sessionId) return;
    if (group.waypoints.length <= 1) return;
    if (wpIndex === 0) return; // WP0 is not deletable

    const edit = { type: 'waypointDelete' as const, groupId: group.groupId, wpIndex };
    addEdit(edit);
    try {
      const result = await editWaypoints(sessionId, [edit]);
      if (result.ok) {
        updateGroupData(result.groups, result.units, result.threats, result.airbases);
      }
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Group header */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #1a2a3a',
          background: '#0a1520',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: '#ccdae8' }}>
          {group.groupName}
        </div>
        <div style={{ fontSize: 11, color: '#5a7a8a', marginTop: 2 }}>
          {group.category} | {group.task} | {group.units.length} units |{' '}
          {group.frequency ? `${group.frequency.toFixed(1)} MHz` : ''}
        </div>
      </div>

      {/* Waypoint table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 11,
            color: '#ccdae8',
          }}
        >
          <thead>
            <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a' }}>
              <th style={{ padding: '4px 8px', textAlign: 'left' }}>#</th>
              <th style={{ padding: '4px 8px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '4px 8px', textAlign: 'right' }}>Alt (ft)</th>
              <th style={{ padding: '4px 8px', textAlign: 'right' }}>Spd (kts)</th>
              <th style={{ padding: '4px 8px', textAlign: 'right' }}>Dist (nm)</th>
              <th style={{ padding: '4px 8px', textAlign: 'right' }}>Brg</th>
              <th style={{ padding: '4px 8px', textAlign: 'left' }}>Action</th>
              <th style={{ padding: '4px 4px', width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {group.waypoints.map((wp) => (
              <WaypointRow
                key={wp.waypoint_number}
                wp={wp}
                isWp0={wp.waypoint_number === 0}
                canDelete={group.waypoints.length > 1 && wp.waypoint_number !== 0}
                onPropChange={handlePropChange}
                onDelete={handleDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WaypointRow({
  wp,
  isWp0,
  canDelete,
  onPropChange,
  onDelete,
}: {
  wp: Waypoint;
  isWp0: boolean;
  canDelete: boolean;
  onPropChange: (wpIndex: number, field: string, value: string | number | boolean) => void;
  onDelete: (wpIndex: number) => void;
}) {
  const altFt = Math.round(metersToFeet(wp.altitude_m));
  const spdKts = Math.round(msToKnots(wp.speed_ms));
  const distNm = wp.leg_distance_nm?.toFixed(1) || '-';
  const brg = wp.leg_bearing_deg ? `${Math.round(wp.leg_bearing_deg)}°` : '-';

  const dimStyle = { color: '#3a4a5a' };

  return (
    <tr
      style={{
        borderBottom: '1px solid #0f1a28',
        opacity: isWp0 ? 0.5 : 1,
      }}
    >
      <td style={{ padding: '6px 8px', color: '#5a7a8a', fontFamily: 'monospace' }}>{wp.waypoint_number}</td>
      <td style={{ padding: '6px 8px' }}>
        {isWp0 ? (
          <span style={{ color: '#5a7a8a', fontSize: 11 }}>{wp.waypoint_name}</span>
        ) : (
          <input
            type="text"
            defaultValue={wp.waypoint_name}
            onBlur={(e) => onPropChange(wp.waypoint_number, 'name', e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ccdae8',
              width: 80,
              fontSize: 11,
              padding: 0,
            }}
          />
        )}
      </td>
      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
        {isWp0 ? (
          <span style={dimStyle}>{altFt}</span>
        ) : (
          <input
            type="number"
            defaultValue={altFt}
            onBlur={(e) => onPropChange(wp.waypoint_number, 'alt', parseFloat(e.target.value) / 3.28084)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ccdae8',
              width: 55,
              textAlign: 'right',
              fontSize: 11,
              fontFamily: 'monospace',
              padding: 0,
            }}
          />
        )}
        <span style={{ fontSize: 9, color: '#5a7a8a', marginLeft: 2 }}>
          {wp.altitude_type === 'RADIO' ? 'AGL' : 'MSL'}
        </span>
      </td>
      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
        {spdKts || '-'}
      </td>
      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#5a7a8a' }}>
        {distNm}
      </td>
      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#5a7a8a' }}>
        {brg}
      </td>
      <td style={{ padding: '6px 8px' }}>
        {isWp0 ? (
          <span style={{ fontSize: 10, color: '#5a7a8a' }}>{wp.waypoint_action}</span>
        ) : (
          <select
            defaultValue={wp.waypoint_action}
            onChange={(e) => onPropChange(wp.waypoint_number, 'action', e.target.value)}
            style={{
              background: '#0f1a28',
              border: '1px solid #1a2a3a',
              color: '#8fa8c0',
              fontSize: 10,
              borderRadius: 3,
              padding: '1px 2px',
            }}
          >
            {ACTION_TYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
      </td>
      <td style={{ padding: '4px 4px', textAlign: 'center' }}>
        {canDelete && (
          <button
            onClick={() => onDelete(wp.waypoint_number)}
            title="Delete waypoint"
            style={{
              background: 'transparent',
              border: '1px solid transparent',
              color: '#5a7a8a',
              cursor: 'pointer',
              fontSize: 13,
              lineHeight: 1,
              padding: '2px 4px',
              borderRadius: 3,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#d95050';
              e.currentTarget.style.borderColor = '#d95050';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#5a7a8a';
              e.currentTarget.style.borderColor = 'transparent';
            }}
          >
            X
          </button>
        )}
      </td>
    </tr>
  );
}
