import { useRef, useEffect } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useMapStore } from '../../store/mapStore';
import { useEditStore } from '../../store/editStore';
import { sessionEdit } from '../../api/client';
import { metersToFeet, feetToMeters, msToKnots, knotsToMs, formatLatLon } from '../../utils/conversions';
import { isPlayerGroup } from '../../utils/groups';


export function WaypointEditPopup({
  groupId,
  wpIndex,
  pixelX,
  pixelY,
  onClose,
}: {
  groupId: number;
  wpIndex: number;
  pixelX: number;
  pixelY: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { groups, sessionId, updateGroupData } = useMissionStore();
  const adminMode = useMapStore((s) => s.adminMode);
  const addEdit = useEditStore((s) => s.addEdit);

  const group = groups.find((g) => g.groupId === groupId);
  const wp = group?.waypoints.find((w) => w.waypoint_number === wpIndex);

  // Close on click outside
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  if (!wp || !group) return null;

  const locked = adminMode && !isPlayerGroup(group);

  const save = async (field: string, value: string | number | boolean) => {
    if (!sessionId || locked) return;
    const edit = { type: 'waypointProp' as const, groupId, wpIndex, field, value };
    addEdit(edit);
    try {
      const result = await sessionEdit(sessionId, {
        groupName: group?.groupName || '',
        action: 'update',
        wpIndex,
        data: { field, value },
      });
      if (result.ok) updateGroupData(result.groups, result.units, result.threats, result.airbases);
    } catch (e) { console.error('Edit failed:', e); }
  };

  const altFt = Math.round(metersToFeet(wp.altitude_m));
  const spdKts = Math.round(msToKnots(wp.speed_ms));
  const pos = wp.lat && wp.lon ? formatLatLon(wp.lat, wp.lon) : '';

  const inputStyle: React.CSSProperties = {
    background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 3,
    color: '#ccdae8', fontSize: 11, padding: '3px 6px', width: '100%',
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: pixelX + 15,
        top: pixelY - 20,
        background: 'rgba(10, 20, 35, 0.95)',
        border: '1px solid #1a3a5a',
        borderRadius: 6,
        padding: '12px 14px',
        zIndex: 200,
        width: 220,
        fontSize: 11,
        color: '#ccdae8',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>WP{wpIndex}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#5a7a8a', cursor: 'pointer', fontSize: 13 }}>X</button>
      </div>

      <div style={{ fontSize: 9, color: '#5a7a8a', marginBottom: 8, fontFamily: 'monospace' }}>{pos}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label>
          <span style={{ color: '#5a7a8a', fontSize: 10 }}>Name</span>
          <input defaultValue={wp.waypoint_name} onBlur={(e) => save('name', e.target.value)} style={inputStyle} />
        </label>

        <div style={{ display: 'flex', gap: 6 }}>
          <label style={{ flex: 1 }}>
            <span style={{ color: '#5a7a8a', fontSize: 10 }}>Alt (ft)</span>
            <input type="number" defaultValue={altFt} onBlur={(e) => save('alt', feetToMeters(parseFloat(e.target.value)))} style={inputStyle} />
          </label>
          <label style={{ flex: 1 }}>
            <span style={{ color: '#5a7a8a', fontSize: 10 }}>Spd (kts)</span>
            <input type="number" defaultValue={spdKts} onBlur={(e) => save('speed', knotsToMs(parseFloat(e.target.value)))} style={inputStyle} />
          </label>
        </div>

        <label>
          <span style={{ color: '#5a7a8a', fontSize: 10 }}>Alt Type</span>
          <select defaultValue={wp.altitude_type} onChange={(e) => save('alt_type', e.target.value)}
            style={{ ...inputStyle, padding: '3px 4px' }}>
            <option value="BARO">MSL (Barometric)</option>
            <option value="RADIO">AGL (Radio)</option>
          </select>
        </label>
      </div>
    </div>
  );
}
