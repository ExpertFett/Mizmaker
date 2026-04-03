import { useState, useRef, useCallback, useReducer, useEffect } from 'react';
import { useMissionStore } from '../store/missionStore';
import { useMapStore } from '../store/mapStore';
import { useEditStore } from '../store/editStore';
import { metersToFeet, feetToMeters, msToKnots, knotsToMs, formatLatLon } from '../utils/conversions';
import { convertSpeed, computeEte, speedRefToGs, type SpeedMode } from '../utils/atmosphere';
import { sessionEdit } from '../api/client';
import { getAircraftType, isPlayerGroup } from '../utils/groups';
import { LauncherSettingsPanel } from '../editor/components/LauncherSettings';
import type { Waypoint, MissionWeather, PylonInfo } from '../types/mission';


/* ------------------------------------------------------------------ */
/* 4-char waypoint abbreviation generator                              */
/* ------------------------------------------------------------------ */

function abbreviate(name: string): string {
  if (!name || !name.trim()) return '';
  const clean = name.trim().toUpperCase();
  if (clean.length <= 4) return clean;
  const words = clean.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length >= 2) {
    const initials = words.map((w) => w[0]).join('').slice(0, 4);
    if (initials.length >= 2) return initials.padEnd(4, words[words.length - 1].slice(1, 1 + (4 - initials.length))).slice(0, 4);
  }
  const vowels = /[AEIOU]/g;
  const consonants = clean.replace(vowels, '');
  if (consonants.length >= 4) return consonants.slice(0, 4);
  return clean.slice(0, 4);
}


/* ------------------------------------------------------------------ */
/* Persistent notes store (client-side, keyed by groupId + wpIndex)    */
/* ------------------------------------------------------------------ */

const wpNotesMap: Record<string, string> = {};
function getWpNote(groupId: number, wpIndex: number): string {
  return wpNotesMap[`${groupId}-${wpIndex}`] ?? '';
}
function setWpNote(groupId: number, wpIndex: number, note: string) {
  wpNotesMap[`${groupId}-${wpIndex}`] = note;
}


export function FloatingFlightPanel() {
  const { groups, selectedGroupId, selectGroup } = useMissionStore();
  const { floatingPanelPos, setFloatingPanelPos, adminMode, setAddWaypointMode, addWaypointMode, selectedWpIndex, setSelectedWpIndex } = useMapStore();
  const overview = useMissionStore((s) => s.overview);
  const wx = overview?.weather;

  const group = groups.find((g) => g.groupId === selectedGroupId);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const minimized = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const [panelTab, setPanelTab] = useState<'route' | 'datalink' | 'loadout'>('route');

  // All hooks MUST be above this early return
  const assignedGroup = useMissionStore((s) => s.assignedGroup);
  const groupId = group?.groupId ?? 0;
  const wpLen = group?.waypoints.length ?? 0;
  const player = group ? isPlayerGroup(group) : false;
  const isOwnGroup = !assignedGroup || (group && group.groupName === assignedGroup);
  const locked = (adminMode && !player) || !isOwnGroup;

  // Helper: update group waypoints from server response
  const _updateFromServer = useCallback((groupName: string, waypoints: any[]) => {
    const { groups } = useMissionStore.getState();
    useMissionStore.setState({
      groups: groups.map((g) => g.groupName === groupName ? { ...g, waypoints } : g),
    });
  }, []);

  // Server-authoritative edit handlers
  const handlePropChange = useCallback(async (wpIndex: number, field: string, value: string | number | boolean) => {
    if (locked) return;
    const { groups, sessionId: sid, sessionToken } = useMissionStore.getState();
    const g = groups.find((gr) => gr.groupId === groupId);
    if (!g || !sid) return;

    // Optimistic local update
    const updatedGroups = groups.map((gr) => {
      if (gr.groupId !== groupId) return gr;
      return { ...gr, waypoints: gr.waypoints.map((wp) => {
        if (wp.waypoint_number !== wpIndex) return wp;
        const updated = { ...wp };
        if (field === 'name') updated.waypoint_name = value as string;
        else if (field === 'alt') updated.altitude_m = value as number;
        else if (field === 'speed') updated.speed_ms = value as number;
        else if (field === 'speed_ref') updated.speed_ref = value as any;
        else if (field === 'speed_input') updated.speed_input = value as number;
        else if (field === 'alt_type') updated.altitude_type = value as 'BARO' | 'RADIO';
        return updated;
      })};
    });
    useMissionStore.setState({ groups: updatedGroups });

    try {
      const result = await sessionEdit(sid, {
        groupName: g.groupName, action: 'update', wpIndex,
        data: { field, value },
      }, sessionToken || undefined);
      if (result.ok) _updateFromServer(result.groupName, result.waypoints);
    } catch (e) { console.error('Edit failed:', e); }
  }, [groupId, locked, _updateFromServer]);

  const handleDelete = useCallback(async (wpIndex: number) => {
    if (locked || wpLen <= 1 || wpIndex === 0) return;
    const { groups, sessionId: sid, sessionToken } = useMissionStore.getState();
    const g = groups.find((gr) => gr.groupId === groupId);
    if (!g || !sid) return;

    // Optimistic local update
    const updatedGroups = groups.map((gr) => {
      if (gr.groupId !== groupId) return gr;
      const newWps = gr.waypoints.filter((wp) => wp.waypoint_number !== wpIndex);
      for (let i = 0; i < newWps.length; i++) newWps[i] = { ...newWps[i], waypoint_number: i };
      return { ...gr, waypoints: newWps };
    });
    useMissionStore.setState({ groups: updatedGroups });

    try {
      const result = await sessionEdit(sid, {
        groupName: g.groupName, action: 'delete', wpIndex,
      }, sessionToken || undefined);
      if (result.ok) _updateFromServer(result.groupName, result.waypoints);
    } catch (e) { console.error('Delete failed:', e); }
  }, [groupId, wpLen, locked, _updateFromServer]);

  const handleReorder = useCallback(async (wpIndex: number, direction: 'up' | 'down') => {
    if (!groupId) return;
    const { groups, sessionId: sid, sessionToken } = useMissionStore.getState();
    const g = groups.find((gr) => gr.groupId === groupId);
    if (!g || !sid) return;

    const wps = [...g.waypoints];
    const fromIdx = wps.findIndex((w) => w.waypoint_number === wpIndex);
    const toIdx = direction === 'up' ? fromIdx - 1 : fromIdx + 1;
    if (fromIdx <= 0 || toIdx <= 0 || toIdx >= wps.length) return;

    // Optimistic local swap
    [wps[fromIdx], wps[toIdx]] = [wps[toIdx], wps[fromIdx]];
    for (let i = 0; i < wps.length; i++) wps[i] = { ...wps[i], waypoint_number: i };
    useMissionStore.setState({
      groups: groups.map((gr) => gr.groupId === groupId ? { ...gr, waypoints: wps } : gr),
    });

    try {
      const result = await sessionEdit(sid, {
        groupName: g.groupName, action: 'reorder', fromIndex: fromIdx, toIndex: toIdx,
      }, sessionToken || undefined);
      if (result.ok) _updateFromServer(result.groupName, result.waypoints);
    } catch (e) { console.error('Reorder failed:', e); }
  }, [groupId, _updateFromServer]);

  if (!group) return null;

  const airframe = getAircraftType(group);
  const pos = floatingPanelPos.x < -0.5
    ? { x: Math.max(50, (window.innerWidth - 740) / 2), y: Math.max(30, (window.innerHeight - 600) / 2) }
    : floatingPanelPos;

  const onDragStart = (e: React.PointerEvent) => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const parentRect = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left - parentRect.left,
      origY: rect.top - parentRect.top,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragState.current || !panelRef.current) return;
    // Move DOM element directly — no React re-render during drag
    const newX = dragState.current.origX + (e.clientX - dragState.current.startX);
    const newY = dragState.current.origY + (e.clientY - dragState.current.startY);
    panelRef.current.style.left = `${newX}px`;
    panelRef.current.style.top = `${newY}px`;
  };
  const onDragEnd = () => {
    if (!dragState.current) return;
    dragState.current = null;
    // Read final position from DOM
    const el = panelRef.current;
    if (!el) return;
    const parent = el.offsetParent;
    const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const rect = el.getBoundingClientRect();
    const pw = parentRect.width;
    const ph = parentRect.height;
    const ew = rect.width;
    const eh = rect.height;
    let x = rect.left - parentRect.left;
    let y = rect.top - parentRect.top;
    // Snap to edges within 40px
    if (x <= 40) x = 0;
    else if (x + ew >= pw - 40) x = pw - ew;
    if (y <= 40) y = 0;
    else if (y + eh >= ph - 40) y = ph - eh;
    // Clamp to stay on screen
    x = Math.max(0, Math.min(x, pw - ew));
    y = Math.max(0, Math.min(y, ph - eh));
    // Apply snap to DOM immediately so there's no flicker
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    setFloatingPanelPos({ x, y });
  };

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: 720,
        maxHeight: '88vh',
        background: 'rgba(8, 15, 28, 0.97)',
        border: '1px solid #1a3a5a',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 300,
        boxShadow: '0 6px 32px rgba(0,0,0,0.6)',
        fontSize: 14,
      }}
    >
      {/* Title bar — drag handle */}
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        style={{
          padding: '12px 18px',
          background: '#0a1a2a',
          borderBottom: '1px solid #1a2a3a',
          cursor: 'grab',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {locked && !isOwnGroup && <span style={{ color: '#5a7a8a', fontSize: 11 }} title="View only — not your assigned flight">VIEW</span>}
          {locked && isOwnGroup && <span style={{ color: '#d29922', fontSize: 14 }} title="Admin locked">&#128274;</span>}
          <span style={{ fontWeight: 600, color: isOwnGroup ? '#ccdae8' : '#5a7a8a', fontSize: 16 }}>{group.groupName}</span>
          <span style={{ color: '#5a7a8a', fontSize: 13 }}>{airframe}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => { minimized.current = !minimized.current; forceUpdate(); }}
            style={titleBtnStyle}
            title={minimized.current ? 'Expand' : 'Minimize'}
          >
            {minimized.current ? '\u25B2' : '\u25BC'}
          </button>
          <button onClick={() => { setSelectedWpIndex(null); selectGroup(null); }} style={titleBtnStyle} title="Close">X</button>
        </div>
      </div>

      {/* Body */}
      {!minimized.current && (
        <>
          {/* Group info */}
          <div style={{ padding: '10px 18px', borderBottom: '1px solid #1a2a3a', fontSize: 13, color: '#5a7a8a' }}>
            {group.task} &middot; {group.frequency ? `${group.frequency.toFixed(1)} MHz` : 'No freq'}
            &middot; {group.coalition} &middot; {group.units.length} units
            {player && <span style={{ color: '#3fb950', marginLeft: 8, fontWeight: 600 }}>FLYABLE</span>}
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid #1a2a3a', background: '#0a1520' }}>
            {(['route', 'datalink', 'loadout'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setPanelTab(tab)}
                style={{
                  flex: 1, padding: '10px 0', fontSize: 13, fontWeight: panelTab === tab ? 600 : 400,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: panelTab === tab ? '#ccdae8' : '#5a7a8a',
                  borderBottom: panelTab === tab ? '2px solid #4a8fd4' : '2px solid transparent',
                }}
              >
                {tab === 'route' ? 'Route' : tab === 'datalink' ? 'Datalink' : 'Loadout'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto' }}>

          {panelTab === 'datalink' && (
            <FlightDatalinkContent groupName={group.groupName} locked={locked} />
          )}

          {panelTab === 'loadout' && (
            <FlightLoadoutContent groupName={group.groupName} locked={locked} />
          )}

          {panelTab === 'route' && (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, color: '#ccdae8' }}>
              <thead>
                <tr style={{ color: '#7a9ab0', borderBottom: '1px solid #1a2a3a', background: '#080f1c', position: 'sticky', top: 0 }}>
                  {!locked && <th style={{ ...thStyle, width: 36 }}></th>}
                  <th style={thStyle}>WP</th>
                  <th style={thStyle}>Name</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Alt (ft)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Speed</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Dist</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Brg</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>ETE</th>
                  {!locked && <th style={{ ...thStyle, width: 32 }}></th>}
                </tr>
              </thead>
              <tbody>
                {group.waypoints.map((wp, idx) => (
                  <WpRow
                    key={`${wp.waypoint_number}-${wp.waypoint_name}-${wp.x}-${wp.y}`}
                    wp={wp}
                    prevWp={idx > 0 ? group.waypoints[idx - 1] : undefined}
                    locked={locked || wp.waypoint_number === 0}
                    canDelete={!locked && group.waypoints.length > 1 && wp.waypoint_number !== 0}
                    canMoveUp={!locked && wp.waypoint_number > 1}
                    canMoveDown={!locked && wp.waypoint_number > 0 && idx < group.waypoints.length - 1}
                    showControls={!locked}
                    weather={wx}
                    selected={selectedWpIndex === wp.waypoint_number}
                    onSelect={() => setSelectedWpIndex(selectedWpIndex === wp.waypoint_number ? null : wp.waypoint_number)}
                    onPropChange={handlePropChange}
                    onDelete={handleDelete}
                    onReorder={handleReorder}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid #1a2a3a', color: '#5a7a8a' }}>
                  <td colSpan={locked ? 4 : 5} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600 }}>Total</td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>
                    {group.waypoints.reduce((s, w) => s + (w.leg_distance_nm || 0), 0).toFixed(1)} nm
                  </td>
                  <td></td>
                  <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#6a8a9a' }}>
                    {(() => {
                      const totalEte = group.waypoints.reduce((s, w) => s + ((w.leg_distance_nm || 0) * 1852 / (w.speed_ms || 1)), 0);
                      return formatEte(totalEte);
                    })()}
                  </td>
                  {!locked && <td></td>}
                </tr>
              </tfoot>
            </table>

            {/* Waypoint detail panel */}
            {selectedWpIndex != null && (
              <WaypointDetail
                groupId={group.groupId}
                groupName={group.groupName}
                waypoints={group.waypoints}
                wpIndex={selectedWpIndex}
                locked={locked}
                onNavigate={(idx) => setSelectedWpIndex(idx)}
                onClose={() => setSelectedWpIndex(null)}
                onPropChange={handlePropChange}
              />
            )}
          </div>
          )}
          </div>

          {/* Footer */}
          {!locked && (
            <div style={{ padding: '10px 18px', borderTop: '1px solid #1a2a3a', display: 'flex', gap: 10 }}>
              <button
                onClick={() => setAddWaypointMode(!addWaypointMode)}
                style={{
                  flex: 1, padding: '9px 14px', fontSize: 13, fontWeight: 500,
                  background: addWaypointMode ? '#1a4a2a' : '#0f2a4a',
                  border: `1px solid ${addWaypointMode ? '#3fb950' : '#1a3a5a'}`,
                  borderRadius: 4,
                  color: addWaypointMode ? '#3fb950' : '#ccdae8',
                  cursor: 'pointer',
                }}
              >
                {addWaypointMode ? 'Click map to place...' : '+ Add Waypoint'}
              </button>
              <span style={{ color: '#5a7a8a', fontSize: 12, alignSelf: 'center' }}>
                or right-click map
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WpRow({ wp, prevWp, locked, canDelete, canMoveUp, canMoveDown, showControls, weather, selected, onSelect, onPropChange, onDelete, onReorder }: {
  wp: Waypoint; prevWp?: Waypoint; locked: boolean; canDelete: boolean;
  canMoveUp?: boolean; canMoveDown?: boolean; showControls: boolean;
  weather?: MissionWeather; selected?: boolean;
  onSelect?: () => void;
  onPropChange: (i: number, f: string, v: string | number | boolean) => void;
  onDelete: (i: number) => void;
  onReorder: (i: number, dir: 'up' | 'down') => void;
}) {
  const altFt = Math.round(metersToFeet(wp.altitude_m));
  const distNm = wp.leg_distance_nm?.toFixed(1) || '-';
  const brg = wp.leg_bearing_deg ? `${Math.round(wp.leg_bearing_deg)}\u00B0` : '-';

  const heading = wp.leg_bearing_deg || 0;

  // ETE for this leg — use the PREVIOUS waypoint's speed (you fly the leg at departure speed)
  const legDist = (wp.leg_distance_nm || 0) * 1852;
  const legSpeed = prevWp ? prevWp.speed_ms : wp.speed_ms;
  const ete = legSpeed > 0 ? computeEte(legDist, legSpeed) : 0;
  const eteStr = ete > 0 ? formatEte(ete) : '-';

  const isWp0 = wp.waypoint_number === 0;

  const inputStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', color: '#ccdae8',
    fontSize: 14, fontFamily: 'monospace', padding: '2px 0',
  };

  const arrowBtn: React.CSSProperties = {
    background: 'transparent', border: 'none', color: '#5a7a8a',
    cursor: 'pointer', fontSize: 12, padding: '1px 2px', lineHeight: 1,
  };

  return (
    <tr
      onClick={onSelect}
      style={{
        borderBottom: '1px solid #0f1a28',
        opacity: isWp0 ? 0.45 : 1,
        background: selected ? 'rgba(74, 143, 212, 0.12)' : 'transparent',
        borderLeft: selected ? '2px solid #4a8fd4' : '2px solid transparent',
        cursor: 'pointer',
      }}
    >
      {showControls && (
        <td style={{ ...tdStyle, padding: '2px 4px', width: 32 }}>
          {!isWp0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
              {canMoveUp && (
                <button onClick={() => onReorder(wp.waypoint_number, 'up')} style={arrowBtn} title="Move up">{'\u25B2'}</button>
              )}
              {canMoveDown && (
                <button onClick={() => onReorder(wp.waypoint_number, 'down')} style={arrowBtn} title="Move down">{'\u25BC'}</button>
              )}
            </div>
          )}
        </td>
      )}
      <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#5a7a8a', fontSize: 13 }}>{wp.waypoint_number}</td>
      <td style={tdStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {locked ? (
            <span style={{ color: '#8fa8c0', fontSize: 14 }}>{wp.waypoint_name}</span>
          ) : (
            <input defaultValue={wp.waypoint_name} onBlur={(e) => onPropChange(wp.waypoint_number, 'name', e.target.value)}
              style={{ ...inputStyle, width: 100, color: '#ccdae8' }} />
          )}
          {abbreviate(wp.waypoint_name) && (
            <span style={{
              fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
              color: '#d29922', background: '#d2992215',
              padding: '1px 4px', borderRadius: 3,
              border: '1px solid #d2992230',
              letterSpacing: 1, whiteSpace: 'nowrap',
            }}>
              {abbreviate(wp.waypoint_name)}
            </span>
          )}
        </div>
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        {locked ? (
          <span style={{ fontFamily: 'monospace', color: '#8fa8c0', fontSize: 14 }}>{altFt}</span>
        ) : (
          <input type="number" defaultValue={altFt}
            onBlur={(e) => onPropChange(wp.waypoint_number, 'alt', feetToMeters(parseFloat(e.target.value)))}
            style={{ ...inputStyle, width: 65, textAlign: 'right' }} />
        )}
        {locked ? (
          <span style={{ fontSize: 11, color: '#5a7a8a', marginLeft: 3 }}>
            {wp.altitude_type === 'RADIO' ? 'AGL' : ''}
          </span>
        ) : (
          <button
            onClick={() => onPropChange(wp.waypoint_number, 'alt_type', wp.altitude_type === 'BARO' ? 'RADIO' : 'BARO')}
            title={wp.altitude_type === 'BARO' ? 'MSL — click for AGL' : 'AGL — click for MSL'}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 10, color: wp.altitude_type === 'RADIO' ? '#d29922' : '#5a7a8a',
              marginLeft: 2, padding: '1px 3px', fontWeight: 600,
            }}
          >
            {wp.altitude_type === 'RADIO' ? 'AGL' : 'MSL'}
          </button>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', lineHeight: 1.4 }}>
        {isWp0 ? (
          <span style={{ color: '#5a7a8a' }}>-</span>
        ) : locked ? (
          <SpeedBlock gs_ms={wp.speed_ms} alt_m={wp.altitude_m} heading={heading} weather={weather} />
        ) : (
          <SpeedEditor wp={wp} heading={heading} weather={weather} onPropChange={onPropChange} />
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: '#5a7a8a', fontSize: 13 }}>{distNm}</td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: '#5a7a8a', fontSize: 13 }}>{brg}</td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: '#6a8a9a', fontSize: 13 }}>{eteStr}</td>
      {showControls && (
        <td style={{ ...tdStyle, textAlign: 'center' }}>
          {canDelete && (
            <button onClick={() => onDelete(wp.waypoint_number)} title="Delete waypoint"
              style={{ background: 'transparent', border: '1px solid transparent', color: '#5a7a8a', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 5px', borderRadius: 3 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#d95050'; e.currentTarget.style.borderColor = '#d95050'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#5a7a8a'; e.currentTarget.style.borderColor = 'transparent'; }}>
              X
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 13 };
const tdStyle: React.CSSProperties = { padding: '8px 12px' };
const titleBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid #1a2a3a', borderRadius: 4,
  color: '#5a7a8a', cursor: 'pointer', fontSize: 13, padding: '4px 10px',
};

function SpeedEditor({ wp, heading, weather, onPropChange }: {
  wp: Waypoint; heading: number; weather?: MissionWeather;
  onPropChange: (i: number, f: string, v: string | number | boolean) => void;
}) {
  const ref = wp.speed_ref || 'gs';
  const currentDisplay = weather && wp.speed_ms > 0
    ? convertSpeed(wp.speed_ms, wp.altitude_m, heading, weather, ref)
    : (ref === 'mach' ? 0 : Math.round(msToKnots(wp.speed_ms)));

  const defaultVal = ref === 'mach' ? currentDisplay.toFixed(2) : Math.round(currentDisplay).toString();

  const handleRefChange = (newRef: string) => {
    // Switching reference — recalculate the display value from current GS
    onPropChange(wp.waypoint_number, 'speed_ref', newRef);
    if (weather) {
      const newDisplay = convertSpeed(wp.speed_ms, wp.altitude_m, heading, weather, newRef as SpeedMode);
      onPropChange(wp.waypoint_number, 'speed_input', newDisplay);
    }
  };

  const handleValueChange = (val: string) => {
    const num = parseFloat(val);
    if (isNaN(num) || !weather) return;
    // Convert entered value in chosen reference to DCS ground speed
    const gs_ms = speedRefToGs(num, ref as SpeedMode, wp.altitude_m, heading, weather);
    onPropChange(wp.waypoint_number, 'speed', gs_ms);
    onPropChange(wp.waypoint_number, 'speed_input', num);
  };

  const selectStyle: React.CSSProperties = {
    background: '#0f1a28', border: '1px solid #1a2a3a', color: '#4a8fd4',
    fontSize: 12, borderRadius: 3, padding: '3px 5px', cursor: 'pointer',
  };
  const inputStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', color: '#ccdae8',
    fontSize: 14, fontFamily: 'monospace', padding: '2px 0', width: 56, textAlign: 'right' as const,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <input
          type={ref === 'mach' ? 'text' : 'number'}
          defaultValue={defaultVal}
          onBlur={(e) => handleValueChange(e.target.value)}
          style={inputStyle}
        />
        <select value={ref} onChange={(e) => handleRefChange(e.target.value)} style={selectStyle}>
          <option value="gs">GS</option>
          <option value="cas">CAS</option>
          <option value="tas">TAS</option>
          <option value="mach">M</option>
        </select>
      </div>
      <SpeedBlock gs_ms={wp.speed_ms} alt_m={wp.altitude_m} heading={heading} weather={weather} excludeRef={ref} />
    </div>
  );
}

function SpeedBlock({ gs_ms, alt_m, heading, weather, excludeRef }: {
  gs_ms: number; alt_m: number; heading: number; weather?: MissionWeather; excludeRef?: string;
}) {
  if (!weather || gs_ms <= 0) return null;

  const items: { label: string; value: string; ref: string }[] = [];
  if (excludeRef !== 'gs') items.push({ label: 'GS', value: Math.round(convertSpeed(gs_ms, alt_m, heading, weather, 'gs')).toString(), ref: 'gs' });
  if (excludeRef !== 'cas') items.push({ label: 'CAS', value: Math.round(convertSpeed(gs_ms, alt_m, heading, weather, 'cas')).toString(), ref: 'cas' });
  if (excludeRef !== 'tas') items.push({ label: 'TAS', value: Math.round(convertSpeed(gs_ms, alt_m, heading, weather, 'tas')).toString(), ref: 'tas' });
  if (excludeRef !== 'mach') items.push({ label: 'M', value: convertSpeed(gs_ms, alt_m, heading, weather, 'mach').toFixed(2), ref: 'mach' });

  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#6a8a9a' }}>
      {items.map((it) => (
        <span key={it.ref} style={{ fontFamily: 'monospace' }}>
          {it.value}<span style={{ fontSize: 10, color: '#4a5a6a', marginLeft: 1 }}>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline Datalink + Loadout panels for the flight                    */
/* ------------------------------------------------------------------ */

function FlightDatalinkContent({ groupName, locked }: { groupName: string; locked: boolean }) {
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const addEdit = useEditStore((s) => s.addEdit);
  const units = clientUnits.filter((u) => u.groupName === groupName);

  if (units.length === 0) return <div style={{ padding: 12, color: '#5a7a8a', fontSize: 12 }}>No client units in this group</div>;

  // Derive a default STN L16 from voice callsign number (e.g. "11" → "00011")
  const defaultStn = (u: typeof units[0]) => {
    if (u.stnL16) return u.stnL16;
    const num = u.voiceCallsignNumber ?? '';
    if (!num) return '';
    return num.padStart(5, '0');
  };

  const handleChange = (unitId: number, field: string, value: string) => {
    addEdit({ unitId, field, value } as any);
    const { clientUnits: all } = useMissionStore.getState();
    const updated = all.map((u) => {
      if (u.unitId !== unitId) return u;
      const copy = { ...u };
      if (field === 'voiceCallsignLabel') copy.voiceCallsignLabel = value;
      else if (field === 'voiceCallsignNumber') copy.voiceCallsignNumber = value;
      else if (field === 'stnL16') copy.stnL16 = value;
      return copy;
    });
    useMissionStore.setState({ clientUnits: updated });
  };

  const inputSt: React.CSSProperties = {
    background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
    color: '#ccdae8', fontSize: 14, fontFamily: 'monospace', padding: '6px 8px', width: '100%',
    textAlign: 'center',
  };

  return (
    <div style={{ padding: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, color: '#ccdae8' }}>
        <thead>
          <tr style={{ color: '#7a9ab0', borderBottom: '1px solid #1a2a3a' }}>
            <th style={{ ...thStyle, textAlign: 'left' }}>Unit</th>
            <th style={{ ...thStyle, width: 90 }}>Callsign</th>
            <th style={{ ...thStyle, width: 60 }}>#</th>
            <th style={{ ...thStyle, width: 100 }}>STN L16</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.unitId} style={{ borderBottom: '1px solid #0f1a28' }}>
              <td style={tdStyle}>
                <div style={{ fontSize: 14, color: '#8fa8c0', fontWeight: 500 }}>{u.name}</div>
                <div style={{ fontSize: 11, color: '#5a7a8a' }}>{u.type}</div>
              </td>
              <td style={tdStyle}>
                {locked ? <span style={{ fontFamily: 'monospace', fontSize: 14 }}>{u.voiceCallsignLabel}</span> : (
                  <input defaultValue={u.voiceCallsignLabel} maxLength={3}
                    onBlur={(e) => handleChange(u.unitId, 'voiceCallsignLabel', e.target.value)}
                    style={inputSt} />
                )}
              </td>
              <td style={tdStyle}>
                {locked ? <span style={{ fontFamily: 'monospace', fontSize: 14 }}>{u.voiceCallsignNumber}</span> : (
                  <input defaultValue={u.voiceCallsignNumber} maxLength={3}
                    onBlur={(e) => handleChange(u.unitId, 'voiceCallsignNumber', e.target.value)}
                    style={inputSt} />
                )}
              </td>
              <td style={tdStyle}>
                {locked ? <span style={{ fontFamily: 'monospace', fontSize: 14, color: '#d29922' }}>{u.stnL16 || defaultStn(u)}</span> : (
                  <input defaultValue={defaultStn(u)} maxLength={5}
                    onBlur={(e) => handleChange(u.unitId, 'stnL16', e.target.value)}
                    style={{ ...inputSt, color: '#d29922' }} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlightLoadoutContent({ groupName, locked }: { groupName: string; locked: boolean }) {
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const pylonOptions = useMissionStore((s) => s.pylonOptions);
  const addEdit = useEditStore((s) => s.addEdit);
  const units = clientUnits.filter((u) => u.groupName === groupName);
  const [expandedPylon, setExpandedPylon] = useState<string | null>(null);
  const [pylonSettings, setPylonSettings] = useState<Record<string, Record<string, any>>>({});

  if (units.length === 0) return <div style={{ padding: 12, color: '#5a7a8a', fontSize: 12 }}>No client units in this group</div>;

  const handlePylonChange = (unitId: number, pylonNum: number, clsid: string) => {
    const unit = units.find((u) => u.unitId === unitId);
    if (!unit) return;
    const opts = pylonOptions[unit.type]?.[String(pylonNum)] as PylonInfo[] | undefined;
    const selected = opts?.find((o) => o.clsid === clsid);
    if (!selected && clsid !== '') return;

    addEdit({ unitId, field: 'pylonChange', value: { pylon: pylonNum, clsid, settings: {} } } as any);

    const { clientUnits: all } = useMissionStore.getState();
    const updated = all.map((u) => {
      if (u.unitId !== unitId) return u;
      const existingPylon = u.pylons.find((p) => p.number === pylonNum);
      let newPylons: PylonInfo[];
      if (existingPylon) {
        newPylons = u.pylons.map((p) => {
          if (p.number !== pylonNum) return p;
          if (!selected) return { ...p, clsid: '', name: '<Empty>', shortName: '<Empty>', category: '' };
          return { ...p, clsid: selected.clsid, name: selected.name, shortName: selected.shortName, category: selected.category };
        });
      } else if (selected) {
        newPylons = [
          ...u.pylons,
          { number: pylonNum, clsid: selected.clsid, name: selected.name, shortName: selected.shortName, category: selected.category },
        ].sort((a, b) => a.number - b.number);
      } else {
        newPylons = u.pylons;
      }
      return { ...u, pylons: newPylons };
    });
    useMissionStore.setState({ clientUnits: updated });
    if (clsid) setExpandedPylon(`${unitId}-${pylonNum}`);
  };

  const handleSettings = (unitId: number, pylonNum: number, settings: Record<string, any>) => {
    const key = `${unitId}-${pylonNum}`;
    setPylonSettings((prev) => ({ ...prev, [key]: settings }));
    const pylon = units.find((u) => u.unitId === unitId)?.pylons.find((p) => p.number === pylonNum);
    if (pylon) addEdit({ unitId, field: 'pylonChange', value: { pylon: pylonNum, clsid: pylon.clsid, settings } } as any);
  };

  const selSt: React.CSSProperties = {
    background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
    color: '#ccdae8', fontSize: 13, padding: '5px 8px', flex: 1,
  };

  return (
    <div style={{ padding: 12 }}>
      {units.map((unit) => {
        const typeOpts = pylonOptions[unit.type] as Record<string, PylonInfo[]> | undefined;
        return (
          <div key={unit.unitId} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#8fa8c0', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{unit.name}</span>
              <span style={{ fontSize: 11, color: '#5a7a8a', fontFamily: 'monospace' }}>
                Fuel:{Math.round(unit.fuel)}lbs FL:{unit.flare} CH:{unit.chaff}
              </span>
            </div>
            {(() => {
              const allStations = typeOpts ? Object.keys(typeOpts).map(Number).sort((a, b) => a - b) : unit.pylons.map((p) => p.number);
              const pylonMap = new Map(unit.pylons.map((p) => [p.number, p]));
              return allStations.map((stationNum) => {
                const pylon = pylonMap.get(stationNum) || { number: stationNum, clsid: '', name: '<Empty>', shortName: '<Empty>', category: '' };
                const opts = typeOpts?.[String(stationNum)] as PylonInfo[] | undefined;
                const byCategory = new Map<string, PylonInfo[]>();
                if (opts) for (const o of opts) {
                  const arr = byCategory.get(o.category || 'Other') || [];
                  arr.push(o); byCategory.set(o.category || 'Other', arr);
                }
                const key = `${unit.unitId}-${stationNum}`;
                const isExp = expandedPylon === key;

                return (
                  <div key={stationNum} style={{ marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#5a7a8a', fontSize: 12, fontFamily: 'monospace', minWidth: 32 }}>S{stationNum}</span>
                      {locked ? (
                        <span style={{ fontSize: 13, color: '#8fa8c0' }}>{pylon.shortName}</span>
                      ) : (
                        <select value={pylon.clsid} onChange={(e) => handlePylonChange(unit.unitId, stationNum, e.target.value)} style={selSt}>
                          <option value="">&lt;Empty&gt;</option>
                          {Array.from(byCategory.entries()).map(([cat, items]) => (
                            <optgroup key={cat} label={cat}>
                              {items.map((o) => <option key={o.clsid} value={o.clsid}>{o.shortName}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      )}
                      {pylon.clsid && !locked && (
                        <button onClick={() => setExpandedPylon(isExp ? null : key)}
                          style={{ background: 'transparent', border: 'none', color: isExp ? '#4a8fd4' : '#3a4a5a', cursor: 'pointer', fontSize: 10 }}>
                          {isExp ? '\u25B2' : '\u2699'}
                        </button>
                      )}
                    </div>
                    {isExp && pylon.clsid && (
                      <div style={{ marginLeft: 34 }}>
                        <LauncherSettingsPanel
                          clsid={pylon.clsid}
                          currentSettings={pylonSettings[key] || {}}
                          onChange={(s) => handleSettings(unit.unitId, stationNum, s)}
                        />
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Waypoint detail panel — shown below route table when a WP selected  */
/* ------------------------------------------------------------------ */

function WaypointDetail({
  groupId,
  groupName,
  waypoints,
  wpIndex,
  locked,
  onNavigate,
  onClose,
  onPropChange,
}: {
  groupId: number;
  groupName: string;
  waypoints: Waypoint[];
  wpIndex: number;
  locked: boolean;
  onNavigate: (idx: number) => void;
  onClose: () => void;
  onPropChange: (i: number, f: string, v: string | number | boolean) => void;
}) {
  const wp = waypoints.find((w) => w.waypoint_number === wpIndex);
  const [note, setNoteState] = useState(() => getWpNote(groupId, wpIndex));

  // Sync notes when navigating
  useEffect(() => {
    setNoteState(getWpNote(groupId, wpIndex));
  }, [groupId, wpIndex]);

  const handleNoteChange = useCallback((val: string) => {
    setNoteState(val);
    setWpNote(groupId, wpIndex, val);
  }, [groupId, wpIndex]);

  // Keyboard nav
  const wpNumbers = waypoints
    .map((w) => w.waypoint_number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const currentIdx = wpNumbers.indexOf(wpIndex);
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx < wpNumbers.length - 1;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(wpNumbers[currentIdx - 1]);
      if (e.key === 'ArrowRight' && hasNext) onNavigate(wpNumbers[currentIdx + 1]);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onNavigate, hasPrev, hasNext, wpNumbers, currentIdx]);

  if (!wp) return null;

  const altFt = Math.round(metersToFeet(wp.altitude_m));
  const spdKts = Math.round(msToKnots(wp.speed_ms));
  const pos = wp.lat && wp.lon ? formatLatLon(wp.lat, wp.lon) : '';
  const legNm = wp.leg_distance_nm ? wp.leg_distance_nm.toFixed(1) : null;
  const legBrg = wp.leg_bearing_deg ? Math.round(wp.leg_bearing_deg) : null;
  const abbr = abbreviate(wp.waypoint_name);

  // Cumulative distance
  let cumulativeNm = 0;
  for (let i = 0; i <= currentIdx; i++) {
    const w = waypoints.find((ww) => ww.waypoint_number === wpNumbers[i]);
    if (w?.leg_distance_nm) cumulativeNm += w.leg_distance_nm;
  }

  const etaMin = wp.eta_seconds ? Math.round(wp.eta_seconds / 60) : null;

  const detailInputStyle: React.CSSProperties = {
    background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
    color: '#ccdae8', fontSize: 13, padding: '5px 8px', width: '100%',
    fontFamily: 'monospace', boxSizing: 'border-box' as const,
  };

  const detailLabel: React.CSSProperties = {
    display: 'block', color: '#4a6a7a', fontSize: 10, marginBottom: 3,
    fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' as const,
  };

  return (
    <div style={{
      borderTop: '1px solid #1a3a5a',
      background: 'rgba(10, 20, 35, 0.6)',
    }}>
      {/* Nav header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '8px 14px',
        borderBottom: '1px solid #1a2a3a',
      }}>
        <button
          onClick={() => hasPrev && onNavigate(wpNumbers[currentIdx - 1])}
          disabled={!hasPrev}
          style={{
            background: 'none', border: '1px solid #1a2a3a', borderRadius: 4,
            color: hasPrev ? '#4a8fd4' : '#1a2a3a',
            cursor: hasPrev ? 'pointer' : 'default',
            fontSize: 14, padding: '2px 8px', lineHeight: 1,
          }}
          title="Previous waypoint (←)"
        >◀</button>

        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#ccdae8' }}>
              WP{wpIndex}
            </span>
            {wp.waypoint_name && (
              <span style={{ color: '#6a8a9a', fontSize: 12 }}>
                {wp.waypoint_name}
              </span>
            )}
            {abbr && (
              <span style={{
                fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                color: '#d29922', background: '#d2992215',
                padding: '1px 5px', borderRadius: 3,
                border: '1px solid #d2992230',
                letterSpacing: 1,
              }} title="4-char abbreviation">
                {abbr}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: '#4a6a7a', marginTop: 1 }}>
            {currentIdx + 1} of {wpNumbers.length}
          </div>
        </div>

        <button
          onClick={() => hasNext && onNavigate(wpNumbers[currentIdx + 1])}
          disabled={!hasNext}
          style={{
            background: 'none', border: '1px solid #1a2a3a', borderRadius: 4,
            color: hasNext ? '#4a8fd4' : '#1a2a3a',
            cursor: hasNext ? 'pointer' : 'default',
            fontSize: 14, padding: '2px 8px', lineHeight: 1,
          }}
          title="Next waypoint (→)"
        >▶</button>

        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#5a7a8a',
            cursor: 'pointer', fontSize: 13, marginLeft: 8, padding: '2px 4px',
          }}
          title="Close detail"
        >✕</button>
      </div>

      {/* Info strip */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid #1a2a3a',
        background: 'rgba(10, 18, 30, 0.5)',
      }}>
        <DetailInfoCell label="ALT" value={`${altFt.toLocaleString()} ft`} sub={wp.altitude_type === 'BARO' ? 'MSL' : 'AGL'} />
        <DetailInfoCell label="SPD" value={`${spdKts} kts`} sub="GS" border />
        {legNm && <DetailInfoCell label="LEG" value={`${legNm} nm`} sub={legBrg !== null ? `${String(legBrg).padStart(3, '0')}°` : ''} border />}
        {cumulativeNm > 0 && <DetailInfoCell label="TOTAL" value={`${cumulativeNm.toFixed(1)} nm`} sub="" border />}
        {etaMin !== null && <DetailInfoCell label="ETA" value={`${etaMin} min`} sub="" border />}
      </div>

      {/* Coordinates */}
      {pos && (
        <div style={{
          padding: '4px 14px', borderBottom: '1px solid #1a2a3a',
          fontFamily: 'monospace', fontSize: 11, color: '#6a8a9a',
          background: 'rgba(10, 18, 30, 0.3)',
        }}>
          {pos}
        </div>
      )}

      {/* Edit fields */}
      <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ flex: 1 }}>
            <span style={detailLabel}>Name</span>
            <input
              key={`detail-name-${groupId}-${wpIndex}`}
              defaultValue={wp.waypoint_name}
              onBlur={(e) => onPropChange(wpIndex, 'name', e.target.value)}
              style={detailInputStyle}
              disabled={locked}
              placeholder="e.g. Target Alpha"
            />
          </label>
          <div style={{ width: 52, textAlign: 'center', paddingBottom: 1 }}>
            <span style={detailLabel}>ABBR</span>
            <div style={{
              background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
              padding: '5px 4px', fontSize: 13, fontFamily: 'monospace',
              color: abbr ? '#d29922' : '#2a3a4a', fontWeight: 700,
              letterSpacing: 1, textAlign: 'center',
            }}>
              {abbr || '----'}
            </div>
          </div>
          <label style={{ width: 70 }}>
            <span style={detailLabel}>Alt Type</span>
            <select
              key={`detail-alttype-${groupId}-${wpIndex}`}
              defaultValue={wp.altitude_type}
              onChange={(e) => onPropChange(wpIndex, 'alt_type', e.target.value)}
              style={{ ...detailInputStyle, padding: '4px 4px' }}
              disabled={locked}
            >
              <option value="BARO">MSL</option>
              <option value="RADIO">AGL</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1 }}>
            <span style={detailLabel}>Altitude (ft)</span>
            <input
              key={`detail-alt-${groupId}-${wpIndex}`}
              type="number"
              defaultValue={altFt}
              onBlur={(e) => onPropChange(wpIndex, 'alt', feetToMeters(parseFloat(e.target.value)))}
              style={detailInputStyle}
              disabled={locked}
            />
          </label>
          <label style={{ flex: 1 }}>
            <span style={detailLabel}>Speed (kts)</span>
            <input
              key={`detail-spd-${groupId}-${wpIndex}`}
              type="number"
              defaultValue={spdKts}
              onBlur={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) onPropChange(wpIndex, 'speed', knotsToMs(val));
              }}
              style={detailInputStyle}
              disabled={locked}
            />
          </label>
        </div>

        {locked && (
          <div style={{ fontSize: 10, color: '#5a6a7a', textAlign: 'center', fontStyle: 'italic' }}>
            Read-only
          </div>
        )}
      </div>

      {/* Notes */}
      <div style={{ padding: '6px 14px 10px', borderTop: '1px solid #1a2a3a' }}>
        <label>
          <span style={detailLabel}>Notes</span>
          <textarea
            value={note}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="IP, fence in, push point, threats nearby..."
            rows={2}
            style={{
              ...detailInputStyle,
              fontFamily: 'inherit',
              fontSize: 12,
              resize: 'vertical',
              minHeight: 32,
              lineHeight: 1.4,
            }}
          />
        </label>
      </div>
    </div>
  );
}

function DetailInfoCell({ label, value, sub, border }: { label: string; value: string; sub?: string; border?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '6px 8px', textAlign: 'center',
      borderLeft: border ? '1px solid #1a2a3a' : 'none',
    }}>
      <div style={{ fontSize: 9, color: '#4a6a7a', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' as const }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#ccdae8', fontFamily: 'monospace' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 9, color: '#5a7a8a' }}>{sub}</div>
      )}
    </div>
  );
}


function formatEte(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}:${s.toString().padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${(m % 60).toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
