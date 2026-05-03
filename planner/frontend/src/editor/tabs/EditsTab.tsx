/**
 * Edits — read-only preview of every queued edit before download.
 *
 * Pilots flag a tab, click around, queue dozens of edits across
 * Loadout / DTC / Datalink / Renamer / Brief / etc. By the time
 * they hit Download, there's no easy way to verify what's about
 * to ship. This tab surfaces the entire queue with friendly
 * descriptions so you can:
 *   - Confirm the edit you just made was actually queued
 *   - Spot a stale or duplicated edit before it lands in the .miz
 *   - Remove a single edit without dumping the whole queue
 *
 * Read-only with one mutation: per-edit Remove. Bulk Clear lives
 * in the existing ExportPanel; we don't duplicate it here so the
 * authoritative "wipe" stays in one place.
 *
 * Phase 3 of the standing safety-net plan calls this an "edit
 * preview panel" — this is v1, intentionally read-only. Undo /
 * redo (the full command-pattern edit history) comes later as a
 * separate feature on top of this.
 */

import { useMemo } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { UnitEdit, WaypointEdit, MissionGroup } from '../../types/mission';

type AnyEdit = UnitEdit | WaypointEdit;

interface EditRow {
  index: number;
  category: string;          // grouping bucket: Mission, Group, Unit, Waypoint
  field: string;             // raw field key
  fieldLabel: string;        // human-readable
  target: string;            // "Mission", "Bengal 1 (group)", "Bengal 1-1 (unit)", etc.
  valueLabel: string;        // truncated string of value
}

const FIELD_LABELS: Record<string, string> = {
  // Mission-level
  forcedOptions: 'Mission options',
  briefing: 'Briefing',
  coalitionReassign: 'Coalition reassign',
  weather: 'Weather',
  findReplace: 'Find / replace',
  // Group-level
  groupTask: 'Group task',
  groupFrequency: 'Group radio freq',
  groupModulation: 'Group modulation',
  groupRename: 'Group rename',
  groupWrappedActions: 'Group wrapped actions',
  radioPresets: 'Radio presets',
  // Unit-level
  voiceCallsignLabel: 'Voice callsign label',
  voiceCallsignNumber: 'Voice callsign number',
  stnL16: 'STN L16',
  donors: 'Datalink donors',
  teamMembers: 'Datalink team',
  copyLoadout: 'Copy loadout',
  pylonChange: 'Pylon CLSID',
  laserCode: 'Laser code',
  unitRename: 'Unit rename',
  livery: 'Livery',
  skill: 'Skill',
  lateActivation: 'Late activation',
  heading: 'Heading',
  radioFrequency: 'Radio freq (unit)',
  onboard_num: 'Tail number',
  tacan: 'TACAN beacon',
  icls: 'ICLS',
  callsign: 'Voice callsign',
  payloadReplace: 'Payload',
};

function isWaypointEdit(e: AnyEdit): e is WaypointEdit {
  return (
    typeof (e as WaypointEdit).type === 'string' &&
    (e as WaypointEdit).type.startsWith('waypoint')
  );
}

function categoryFor(e: AnyEdit): string {
  if (isWaypointEdit(e)) return 'Waypoint';
  const ue = e as UnitEdit;
  if (ue.unitId != null) return 'Unit';
  if (ue.groupId != null) return 'Group';
  return 'Mission';
}

function shortValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    // Hz frequencies are huge — render in MHz when plausible.
    if (value > 1e6 && value < 1e10) return `${(value / 1e6).toFixed(3)} MHz`;
    return String(value);
  }
  if (typeof value === 'string') {
    return value.length > 60 ? value.slice(0, 57) + '…' : value;
  }
  if (Array.isArray(value)) {
    return `[${value.length} item${value.length !== 1 ? 's' : ''}]`;
  }
  if (typeof value === 'object') {
    // Show a few keys.
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return '{}';
    const summary = keys.slice(0, 4).join(', ');
    return `{${summary}${keys.length > 4 ? '…' : ''}}`;
  }
  return String(value);
}

function targetLabel(e: AnyEdit, groupsById: Map<number, MissionGroup>): string {
  if (isWaypointEdit(e)) {
    const g = groupsById.get(e.groupId);
    const wpRef = e.wpIndex != null ? ` WP ${e.wpIndex + 1}` : e.afterIndex != null ? ` after WP ${e.afterIndex + 1}` : '';
    return g ? `${g.groupName}${wpRef}` : `Group ${e.groupId}${wpRef}`;
  }
  const ue = e as UnitEdit;
  if (ue.unitId != null) {
    // Find which group has this unitId so we can show the human name.
    for (const g of groupsById.values()) {
      const u = g.units.find((u) => u.unitId === ue.unitId);
      if (u) return `${u.name} (${g.groupName})`;
    }
    return `Unit ${ue.unitId}`;
  }
  if (ue.groupId != null) {
    const g = groupsById.get(ue.groupId);
    return g ? g.groupName : `Group ${ue.groupId}`;
  }
  return 'Mission';
}

export function EditsTab() {
  const groups = useMissionStore((s) => s.groups);
  const edits = useEditStore((s) => s.edits);
  const removeEditAt = useEditStore((s) => s.removeEditAt);
  const clearEdits = useEditStore((s) => s.clearEdits);

  const groupsById = useMemo(() => {
    const m = new Map<number, MissionGroup>();
    for (const g of groups) m.set(g.groupId, g);
    return m;
  }, [groups]);

  const rows = useMemo<EditRow[]>(() => {
    return edits.map((e, index) => {
      const field = isWaypointEdit(e) ? e.type : (e as UnitEdit).field;
      return {
        index,
        category: categoryFor(e),
        field,
        fieldLabel: FIELD_LABELS[field] ?? field,
        target: targetLabel(e, groupsById),
        valueLabel: shortValue(isWaypointEdit(e) ? e.value ?? e.waypointData : (e as UnitEdit).value),
      };
    });
  }, [edits, groupsById]);

  const totalsByCategory = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of rows) t[r.category] = (t[r.category] ?? 0) + 1;
    return t;
  }, [rows]);

  return (
    <div style={{ maxWidth: 1100, padding: '0 4px' }}>
      <h2 style={{ color: '#e0e0e0', fontSize: 18, margin: '0 0 8px', fontWeight: 600 }}>
        Pending Edits
      </h2>
      <p style={{ color: '#888', fontSize: 12, margin: '0 0 14px', maxWidth: 720 }}>
        Read-only preview of every edit currently queued for the next download.
        Edits accumulate as you click around in the other tabs and ship in one
        batch when you press Download. Use this view to confirm what's about
        to land before committing.
      </p>

      {/* Summary strip */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 16,
          padding: '10px 14px',
          background: '#0a1218',
          border: '1px solid #222',
          borderRadius: 6,
          fontSize: 13,
          alignItems: 'center',
        }}
      >
        <span style={{ color: '#e0e0e0', fontWeight: 600 }}>
          {rows.length} queued
        </span>
        {(['Mission', 'Group', 'Unit', 'Waypoint'] as const).map((cat) => (
          totalsByCategory[cat] ? (
            <span key={cat} style={{ color: '#aaa' }}>
              {cat}: <strong style={{ color: '#e0e0e0' }}>{totalsByCategory[cat]}</strong>
            </span>
          ) : null
        ))}
        {rows.length > 0 && (
          <button
            onClick={() => {
              if (confirm(`Clear all ${rows.length} queued edits? This cannot be undone.`)) {
                clearEdits();
              }
            }}
            style={{
              marginLeft: 'auto',
              background: '#3a1a1a',
              border: '1px solid #5a2a2a',
              borderRadius: 4,
              color: '#d95050',
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div
          style={{
            padding: 28,
            textAlign: 'center',
            color: '#3fb950',
            background: '#0a1218',
            border: '1px dashed #1a3a1a',
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          No edits queued. Click around in any other tab to start building a
          batch — they'll show up here as they're queued.
        </div>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            color: '#e0e0e0',
            background: '#1a1a1a',
            border: '1px solid #3a3a3a',
            borderRadius: 4,
          }}
        >
          <thead>
            <tr style={{ background: '#222', color: '#aaaaaa' }}>
              <th style={{ ...thStyle, width: 40 }}>#</th>
              <th style={{ ...thStyle, width: 90 }}>Category</th>
              <th style={thStyle}>Field</th>
              <th style={thStyle}>Target</th>
              <th style={thStyle}>Value</th>
              <th style={{ ...thStyle, width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.index} style={{ borderTop: '1px solid #2a2a2a' }}>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#666' }}>
                  {r.index + 1}
                </td>
                <td style={tdStyle}>
                  <span style={categoryChip(r.category)}>{r.category}</span>
                </td>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#cccccc' }}>{r.fieldLabel}</td>
                <td style={{ ...tdStyle, color: '#cccccc' }}>{r.target}</td>
                <td
                  style={{
                    ...tdStyle,
                    fontFamily: "'B612 Mono', monospace",
                    color: '#3fb950',
                    maxWidth: 320,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.valueLabel}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <button
                    onClick={() => removeEditAt(r.index)}
                    title="Remove this edit from the queue"
                    style={{
                      background: 'transparent',
                      border: '1px solid #3a3a3a',
                      borderRadius: 3,
                      color: '#888',
                      fontSize: 11,
                      padding: '3px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 10px',
  verticalAlign: 'top',
};

function categoryChip(cat: string): React.CSSProperties {
  const palette: Record<string, { bg: string; border: string; fg: string }> = {
    Mission: { bg: '#1a2a3a', border: '#2a4a6a', fg: '#6ab4f0' },
    Group: { bg: '#2a2a1a', border: '#4a4a2a', fg: '#d29922' },
    Unit: { bg: '#1a3a1a', border: '#2a5a2a', fg: '#3fb950' },
    Waypoint: { bg: '#3a1a3a', border: '#5a2a5a', fg: '#a371f7' },
  };
  const c = palette[cat] ?? { bg: '#222', border: '#3a3a3a', fg: '#aaa' };
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.fg,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  };
}
