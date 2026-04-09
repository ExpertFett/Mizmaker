import { useRef, useEffect, useState, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useMapStore } from '../../store/mapStore';
import { sessionEdit } from '../../api/client';
import { metersToFeet, feetToMeters, msToKnots, knotsToMs, formatLatLon } from '../../utils/conversions';
import { isPlayerGroup } from '../../utils/groups';
import { useDraggable } from './useDraggable';


/* ------------------------------------------------------------------ */
/* 4-char waypoint abbreviation generator                              */
/* ------------------------------------------------------------------ */

function abbreviate(name: string): string {
  if (!name || !name.trim()) return '';
  const clean = name.trim().toUpperCase();

  // Already 4 or fewer chars — use as-is
  if (clean.length <= 4) return clean;

  // Multi-word: take first letter of each word (up to 4)
  const words = clean.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length >= 2) {
    const initials = words.map((w) => w[0]).join('').slice(0, 4);
    if (initials.length >= 2) return initials.padEnd(4, words[words.length - 1].slice(1, 1 + (4 - initials.length))).slice(0, 4);
  }

  // Single word: consonant skeleton
  const vowels = /[AEIOU]/g;
  const consonants = clean.replace(vowels, '');
  if (consonants.length >= 4) return consonants.slice(0, 4);

  // Fall back to first 4 chars
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


/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function WaypointEditPopup({
  groupId,
  wpIndex,
  onClose,
  onNavigate,
}: {
  groupId: number;
  wpIndex: number;
  onClose: () => void;
  onNavigate: (groupId: number, wpIndex: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { groups, sessionId } = useMissionStore();
  const adminMode = useMapStore((s) => s.adminMode);
  const { containerRef: dragRef, handleProps } = useDraggable('waypointEditPopup');

  const group = groups.find((g) => g.groupId === groupId);
  const wp = group?.waypoints.find((w) => w.waypoint_number === wpIndex);
  const waypoints = group?.waypoints ?? [];

  // Notes state
  const [note, setNote] = useState(() => getWpNote(groupId, wpIndex));

  // Sync notes when navigating
  useEffect(() => {
    setNote(getWpNote(groupId, wpIndex));
  }, [groupId, wpIndex]);

  const handleNoteChange = useCallback((val: string) => {
    setNote(val);
    setWpNote(groupId, wpIndex, val);
  }, [groupId, wpIndex]);

  // Sorted waypoint numbers for navigation (skip WP0 departure)
  const wpNumbers = waypoints
    .map((w) => w.waypoint_number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const currentIdx = wpNumbers.indexOf(wpIndex);
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx < wpNumbers.length - 1;

  // Close on Escape, arrow nav
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(groupId, wpNumbers[currentIdx - 1]);
      if (e.key === 'ArrowRight' && hasNext) onNavigate(groupId, wpNumbers[currentIdx + 1]);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, onNavigate, groupId, hasPrev, hasNext, wpNumbers, currentIdx]);

  // Merge refs
  const setRefs = (el: HTMLDivElement | null) => {
    (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    (dragRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };

  // Close on click outside
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handle);
    }, 100);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handle); };
  }, [onClose]);

  if (!wp || !group) return null;

  const locked = adminMode && !isPlayerGroup(group);

  const save = async (field: string, value: string | number | boolean) => {
    if (!sessionId || locked) return;
    try {
      const result = await sessionEdit(sessionId, {
        groupName: group?.groupName || '',
        action: 'update',
        wpIndex,
        data: { field, value },
      });
      if (result.ok && result.groupName && result.waypoints) {
        const { groups: currentGroups } = useMissionStore.getState();
        const updated = currentGroups.map((g) =>
          g.groupName === result.groupName ? { ...g, waypoints: result.waypoints } : g,
        );
        useMissionStore.setState({ groups: updated });
      }
    } catch (e) { console.error('Edit failed:', e); }
  };

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

  return (
    <div
      ref={setRefs}
      style={{
        position: 'absolute',
        bottom: 40,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(8, 15, 28, 0.96)',
        border: '1px solid #1a3a5a',
        borderRadius: 10,
        padding: 0,
        zIndex: 200,
        width: 380,
        fontSize: 13,
        color: '#ccdae8',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}
    >
      {/* Header with nav arrows — also drag handle */}
      <div {...handleProps} style={{
        ...handleProps.style,
        display: 'flex', alignItems: 'center', padding: '10px 14px',
        background: 'rgba(20, 40, 70, 0.5)',
        borderBottom: '1px solid #1a2a3a',
        userSelect: 'none',
      }}>
        <button
          onClick={() => hasPrev && onNavigate(groupId, wpNumbers[currentIdx - 1])}
          disabled={!hasPrev}
          style={{
            background: 'none', border: '1px solid #1a2a3a', borderRadius: 4,
            color: hasPrev ? '#4a8fd4' : '#1a2a3a',
            cursor: hasPrev ? 'pointer' : 'default',
            fontSize: 16, padding: '2px 8px', lineHeight: 1,
          }}
          title="Previous waypoint (←)"
        >◀</button>

        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#ccdae8' }}>
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
          <div style={{ fontSize: 10, color: '#4a6a7a', marginTop: 2 }}>
            {group.groupName} · {currentIdx + 1} of {wpNumbers.length}
          </div>
        </div>

        <button
          onClick={() => hasNext && onNavigate(groupId, wpNumbers[currentIdx + 1])}
          disabled={!hasNext}
          style={{
            background: 'none', border: '1px solid #1a2a3a', borderRadius: 4,
            color: hasNext ? '#4a8fd4' : '#1a2a3a',
            cursor: hasNext ? 'pointer' : 'default',
            fontSize: 16, padding: '2px 8px', lineHeight: 1,
          }}
          title="Next waypoint (→)"
        >▶</button>

        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#5a7a8a',
            cursor: 'pointer', fontSize: 14, marginLeft: 8, padding: '2px 4px',
          }}
          title="Close (Esc)"
        >✕</button>
      </div>

      {/* Info strip */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid #1a2a3a',
        background: 'rgba(10, 18, 30, 0.5)',
      }}>
        <InfoCell label="ALT" value={`${altFt.toLocaleString()} ft`} sub={wp.altitude_type === 'BARO' ? 'MSL' : 'AGL'} />
        <InfoCell label="SPD" value={`${spdKts} kts`} sub="GS" border />
        {legNm && <InfoCell label="LEG" value={`${legNm} nm`} sub={legBrg !== null ? `${String(legBrg).padStart(3, '0')}°` : ''} border />}
        {cumulativeNm > 0 && <InfoCell label="TOTAL" value={`${cumulativeNm.toFixed(1)} nm`} sub="" border />}
        {etaMin !== null && <InfoCell label="ETA" value={`${etaMin} min`} sub="" border />}
      </div>

      {/* Coordinates */}
      {pos && (
        <div style={{
          padding: '6px 14px', borderBottom: '1px solid #1a2a3a',
          fontFamily: 'monospace', fontSize: 11, color: '#6a8a9a',
          background: 'rgba(10, 18, 30, 0.3)',
        }}>
          {pos}
        </div>
      )}

      {/* Edit fields */}
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Name row with abbreviation preview */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ flex: 1 }}>
            <span style={fieldLabel}>Name</span>
            <input
              key={`name-${groupId}-${wpIndex}`}
              defaultValue={wp.waypoint_name}
              onBlur={(e) => save('name', e.target.value)}
              style={inputStyle}
              disabled={locked}
              placeholder="e.g. Target Alpha"
            />
          </label>
          <div style={{
            width: 52, textAlign: 'center', paddingBottom: 1,
          }}>
            <span style={fieldLabel}>ABBR</span>
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
            <span style={fieldLabel}>Alt Type</span>
            <select
              key={`alttype-${groupId}-${wpIndex}`}
              defaultValue={wp.altitude_type}
              onChange={(e) => save('alt_type', e.target.value)}
              style={{ ...inputStyle, padding: '4px 4px' }}
              disabled={locked}
            >
              <option value="BARO">MSL</option>
              <option value="RADIO">AGL</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1 }}>
            <span style={fieldLabel}>Altitude (ft)</span>
            <input
              key={`alt-${groupId}-${wpIndex}`}
              type="number"
              defaultValue={altFt}
              onBlur={(e) => save('alt', feetToMeters(parseFloat(e.target.value)))}
              style={inputStyle}
              disabled={locked}
            />
          </label>
          <label style={{ flex: 1 }}>
            <span style={fieldLabel}>Speed (kts)</span>
            <input
              key={`spd-${groupId}-${wpIndex}`}
              type="number"
              defaultValue={spdKts}
              onBlur={(e) => save('speed', knotsToMs(parseFloat(e.target.value)))}
              style={inputStyle}
              disabled={locked}
            />
          </label>
        </div>

        {locked && (
          <div style={{ fontSize: 10, color: '#5a6a7a', textAlign: 'center', fontStyle: 'italic' }}>
            Read-only — AI group in admin mode
          </div>
        )}
      </div>

      {/* Notes */}
      <div style={{ padding: '8px 14px 10px', borderTop: '1px solid #1a2a3a' }}>
        <label>
          <span style={fieldLabel}>Notes</span>
          <textarea
            value={note}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="IP, fence in, push point, threats nearby..."
            rows={2}
            style={{
              ...inputStyle,
              fontFamily: 'inherit',
              fontSize: 12,
              resize: 'vertical',
              minHeight: 36,
              lineHeight: 1.4,
            }}
          />
        </label>
      </div>
    </div>
  );
}


function InfoCell({ label, value, sub, border }: { label: string; value: string; sub?: string; border?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '8px 10px', textAlign: 'center',
      borderLeft: border ? '1px solid #1a2a3a' : 'none',
    }}>
      <div style={{ fontSize: 9, color: '#4a6a7a', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' as const }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#ccdae8', fontFamily: 'monospace' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 9, color: '#5a7a8a' }}>{sub}</div>
      )}
    </div>
  );
}


const inputStyle: React.CSSProperties = {
  background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
  color: '#ccdae8', fontSize: 13, padding: '5px 8px', width: '100%',
  fontFamily: 'monospace', boxSizing: 'border-box',
};

const fieldLabel: React.CSSProperties = {
  display: 'block', color: '#4a6a7a', fontSize: 10, marginBottom: 3,
  fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
};
