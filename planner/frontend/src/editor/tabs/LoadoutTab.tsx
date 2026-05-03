import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { LauncherSettingsPanel } from '../components/LauncherSettings';
import type { ClientUnit, PylonInfo } from '../../types/mission';
import { LOADOUT_PRESETS, planPresetForUnit, type LoadoutPreset } from '../loadoutPresets';
import { isLaserPylon } from '../../utils/laserDetection';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Weapon category → color for summary pills */
const CAT_COLORS: Record<string, string> = {
  'Air-to-Air':   '#4a8fd4',
  'Air-to-Ground': '#d29922',
  'Anti-Ship':    '#d95050',
  'Bomb':         '#d29922',
  'Missile':      '#d95050',
  'Rocket':       '#c090d0',
  'Fuel Tank':    '#3fb950',
  'ECM':          '#cccccc',
  'Targeting':    '#cccccc',
  'Gun Pod':      '#aaaaaa',
  'Other':        '#aaaaaa',
};

function getCatColor(cat: string): string {
  if (!cat) return '#aaaaaa';
  for (const [key, color] of Object.entries(CAT_COLORS)) {
    if (cat.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return '#aaaaaa';
}

/** Build a compact weapons summary for a unit */
function buildLoadoutSummary(pylons: PylonInfo[]): { label: string; count: number; color: string }[] {
  const counts = new Map<string, { count: number; color: string }>();
  for (const p of pylons) {
    if (!p.clsid || p.shortName === '<Empty>') continue;
    const key = p.shortName;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { count: 1, color: getCatColor(p.category) });
  }
  return Array.from(counts.entries())
    .map(([label, { count, color }]) => ({ label, count, color }));
}

/* ------------------------------------------------------------------ */
/* Main Component                                                      */
/* ------------------------------------------------------------------ */

export function LoadoutTab() {
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const pylonOptions = useMissionStore((s) => s.pylonOptions);
  const addEdit = useEditStore((s) => s.addEdit);

  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(new Set());
  const [copiedUnitId, setCopiedUnitId] = useState<number | null>(null);
  // Track which preset was last applied per flight so we can show a badge in
  // the group header. Session-only — not persisted to the miz.
  const [appliedPresetByGroup, setAppliedPresetByGroup] = useState<Map<string, LoadoutPreset>>(new Map());

  // Snapshot originals for change tracking
  const originals = useRef<Map<number, PylonInfo[]>>(new Map());
  useEffect(() => {
    const map = new Map<number, PylonInfo[]>();
    for (const u of clientUnits) {
      map.set(u.unitId, u.pylons.map((p) => ({ ...p })));
    }
    originals.current = map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unique aircraft types for filter
  const aircraftTypes = useMemo(() => {
    const types = new Set<string>();
    for (const u of clientUnits) types.add(u.type);
    return Array.from(types).sort();
  }, [clientUnits]);

  // Group units by groupName, with optional type filter
  const grouped = useMemo(() => {
    const map = new Map<string, { coalition: string; type: string; units: ClientUnit[] }>();
    for (const u of clientUnits) {
      if (typeFilter !== 'all' && u.type !== typeFilter) continue;
      let entry = map.get(u.groupName);
      if (!entry) {
        entry = { coalition: u.coalition, type: u.type, units: [] };
        map.set(u.groupName, entry);
      }
      entry.units.push(u);
    }
    return map;
  }, [clientUnits, typeFilter]);

  const isPylonChanged = useCallback((unitId: number, pylonNum: number): boolean => {
    const orig = originals.current.get(unitId);
    if (!orig) return false;
    const unit = clientUnits.find((u) => u.unitId === unitId);
    if (!unit) return false;
    const origPylon = orig.find((p) => p.number === pylonNum);
    const curPylon = unit.pylons.find((p) => p.number === pylonNum);
    if (!origPylon || !curPylon) return false;
    return origPylon.clsid !== curPylon.clsid;
  }, [clientUnits]);

  const handlePylonChange = useCallback((unitId: number, pylonNum: number, clsid: string) => {
    const { clientUnits: units } = useMissionStore.getState();
    const unit = units.find((u) => u.unitId === unitId);
    if (!unit) return;

    const opts = pylonOptions[unit.type]?.[String(pylonNum)] as PylonInfo[] | undefined;
    const selected = opts?.find((o) => o.clsid === clsid);
    if (!selected && clsid !== '') return;

    // Manual pylon edit invalidates the preset badge
    setAppliedPresetByGroup((prev) => {
      if (!prev.has(unit.groupName)) return prev;
      const next = new Map(prev);
      next.delete(unit.groupName);
      return next;
    });

    addEdit({ unitId, field: 'pylonChange', value: { pylon: pylonNum, clsid, settings: {} } } as any);

    const updated = units.map((u) => {
      if (u.unitId !== unitId) return u;
      const existingPylon = u.pylons.find((p) => p.number === pylonNum);
      let newPylons: PylonInfo[];
      if (existingPylon) {
        // Update existing pylon
        newPylons = u.pylons.map((p) => {
          if (p.number !== pylonNum) return p;
          if (!selected) return { ...p, clsid: '', name: '<Empty>', shortName: '<Empty>', category: '' };
          return { ...p, clsid: selected.clsid, name: selected.name, shortName: selected.shortName, category: selected.category };
        });
      } else if (selected) {
        // Add new pylon that didn't exist in the mission
        newPylons = [
          ...u.pylons,
          { number: pylonNum, clsid: selected.clsid, name: selected.name, shortName: selected.shortName, category: selected.category },
        ].sort((a, b) => a.number - b.number);
      } else {
        newPylons = u.pylons;
      }
      return { ...u, pylons: newPylons };
    });

    // Keep laserCapableUnits in sync — without this, adding a laser
    // weapon (GBU-12, Paveway, Maverick-E etc.) to a unit didn't make
    // it appear on the LaserTab because that array is computed once at
    // upload time and isn't auto-refreshed.
    const { laserCapableUnits, laserClsids } = useMissionStore.getState();
    const updatedUnit = updated.find((u) => u.unitId === unitId);
    if (updatedUnit) {
      const hasLaser = updatedUnit.pylons.some((p) =>
        isLaserPylon(p.clsid, p.name, p.shortName, laserClsids));
      const alreadyTracked = laserCapableUnits.some((u) => u.unitId === unitId);
      let nextLaserUnits = laserCapableUnits;
      if (hasLaser && !alreadyTracked) {
        // Promote unit into laserCapableUnits (LaserCapableUnit shape is
        // a strict subset of ClientUnit's, so we can adapt directly).
        nextLaserUnits = [...laserCapableUnits, {
          unitId: updatedUnit.unitId,
          name: updatedUnit.name,
          type: updatedUnit.type,
          groupName: updatedUnit.groupName,
          coalition: updatedUnit.coalition,
          isClient: true,  // came from clientUnits
          pylons: updatedUnit.pylons,
          laserCode: updatedUnit.laserCode,
        }];
      } else if (alreadyTracked) {
        // Unit already on laser list — just sync its pylons + laserCode
        // so removing the last laser weapon doesn't keep showing the
        // user the old laser-capable state. (We keep the entry around
        // even if hasLaser=false but the unit had a pre-set laserCode,
        // matching the backend's "has_laser_weapon OR laser_code" rule.)
        const stillBelongs = hasLaser || updatedUnit.laserCode != null;
        if (stillBelongs) {
          nextLaserUnits = laserCapableUnits.map((u) =>
            u.unitId === unitId
              ? { ...u, pylons: updatedUnit.pylons, laserCode: updatedUnit.laserCode }
              : u);
        } else {
          nextLaserUnits = laserCapableUnits.filter((u) => u.unitId !== unitId);
        }
      }
      // setClientUnits + setLaserCapableUnits are separate actions — two
      // shallow updates instead of one. Re-render impact is negligible
      // (Zustand batches synchronous setState calls in React 19).
      const store = useMissionStore.getState();
      store.setClientUnits(updated);
      if (nextLaserUnits !== laserCapableUnits) {
        store.setLaserCapableUnits(nextLaserUnits);
      }
    } else {
      useMissionStore.getState().setClientUnits(updated);
    }
  }, [addEdit, pylonOptions]);

  const handleCopyLoadout = useCallback((sourceId: number, targetId: number) => {
    const { clientUnits: units } = useMissionStore.getState();
    const source = units.find((u) => u.unitId === sourceId);
    if (!source) return;

    const target = units.find((u) => u.unitId === targetId);
    if (target) {
      setAppliedPresetByGroup((prev) => {
        if (!prev.has(target.groupName)) return prev;
        const next = new Map(prev);
        next.delete(target.groupName);
        return next;
      });
    }

    addEdit({ unitId: targetId, field: 'copyLoadout', value: sourceId });

    const updated = units.map((u) => {
      if (u.unitId !== targetId) return u;
      return { ...u, pylons: source.pylons.map((p) => ({ ...p })) };
    });
    useMissionStore.getState().setClientUnits(updated);
  }, [addEdit]);

  /** Apply a loadout preset to every unit in a flight (per-flight, not global). */
  const handleApplyPreset = useCallback((preset: LoadoutPreset, groupUnits: ClientUnit[]) => {
    const { clientUnits: units } = useMissionStore.getState();
    let changedCount = 0;
    const updated = units.map((u) => {
      const target = groupUnits.find((g) => g.unitId === u.unitId);
      if (!target) return u;
      const opts = pylonOptions[u.type] as Record<string, PylonInfo[]> | undefined;
      if (!opts) return u;  // no pylon schema for this airframe

      const plan = planPresetForUnit(preset, opts, u.pylons, u.type);
      const newPylons: PylonInfo[] = [];
      for (const step of plan) {
        if (step.kept && step.clsid) {
          // Preserve existing pylon data (shortName/category)
          const existing = u.pylons.find((p) => p.number === step.pylon);
          if (existing) { newPylons.push({ ...existing }); continue; }
        }
        if (step.kept && !step.clsid) continue;  // empty & not changed

        if (!step.clsid) {
          // Actively emptied (wipeAll). Skip; no pylon entry.
          const orig = u.pylons.find((p) => p.number === step.pylon);
          if (orig && orig.clsid) {
            addEdit({ unitId: u.unitId, field: 'pylonChange', value: { pylon: step.pylon, clsid: '', settings: {} } } as any);
            changedCount++;
          }
          continue;
        }

        // Install new weapon — look up full info from options
        const optsForPylon = opts[String(step.pylon)] || [];
        const chosen = optsForPylon.find((o) => o.clsid === step.clsid);
        if (!chosen) continue;
        newPylons.push({
          number: step.pylon,
          clsid: chosen.clsid,
          name: chosen.name,
          shortName: chosen.shortName,
          category: chosen.category,
        });
        // Only queue an edit if this is actually a change from current
        const current = u.pylons.find((p) => p.number === step.pylon);
        if (!current || current.clsid !== chosen.clsid) {
          addEdit({ unitId: u.unitId, field: 'pylonChange', value: { pylon: step.pylon, clsid: chosen.clsid, settings: {} } } as any);
          changedCount++;
        }
      }
      return { ...u, pylons: newPylons.sort((a, b) => a.number - b.number) };
    });
    useMissionStore.getState().setClientUnits(updated);
    // Remember which preset was applied for each touched flight so we can show a badge
    const touchedGroupNames = new Set(groupUnits.map((u) => u.groupName));
    setAppliedPresetByGroup((prev) => {
      const next = new Map(prev);
      for (const gn of touchedGroupNames) next.set(gn, preset);
      return next;
    });
    return changedCount;
  }, [pylonOptions, addEdit]);

  // Clear a preset badge when the user manually changes pylons afterwards
  const clearPresetForGroup = useCallback((groupName: string) => {
    setAppliedPresetByGroup((prev) => {
      if (!prev.has(groupName)) return prev;
      const next = new Map(prev);
      next.delete(groupName);
      return next;
    });
  }, []);

  const handlePasteToGroup = useCallback((sourceId: number, groupUnits: ClientUnit[]) => {
    const { clientUnits: units } = useMissionStore.getState();
    const source = units.find((u) => u.unitId === sourceId);
    if (!source) return;

    const targetIds = groupUnits.filter((u) => u.unitId !== sourceId && u.type === source.type).map((u) => u.unitId);
    for (const tid of targetIds) {
      addEdit({ unitId: tid, field: 'copyLoadout', value: sourceId });
    }

    const updated = units.map((u) => {
      if (!targetIds.includes(u.unitId)) return u;
      return { ...u, pylons: source.pylons.map((p) => ({ ...p })) };
    });
    useMissionStore.getState().setClientUnits(updated);
    setCopiedUnitId(null);
  }, [addEdit]);

  const toggleGroup = useCallback((name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleUnit = useCallback((id: number) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (clientUnits.length === 0) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 15, padding: 20 }}>
        No client (player) units found in this mission.
      </div>
    );
  }

  const copiedUnit = copiedUnitId ? clientUnits.find((u) => u.unitId === copiedUnitId) : null;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
          Loadout Editor
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
          Click a group to expand, then click a unit to edit individual pylons.
          Copy a loadout and paste it to other same-type units.
        </p>
      </div>

      {/* Filter + clipboard bar */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap',
      }}>
        {/* Type filter pills */}
        <div style={{ display: 'flex', gap: 2, background: '#222222', borderRadius: 4, border: '1px solid #3a3a3a', padding: 2, flexWrap: 'wrap' }}>
          <FilterPill
            label="All"
            active={typeFilter === 'all'}
            onClick={() => setTypeFilter('all')}
          />
          {aircraftTypes.map((t) => (
            <FilterPill
              key={t}
              label={t}
              active={typeFilter === t}
              onClick={() => setTypeFilter(t)}
            />
          ))}
        </div>

        {/* Clipboard indicator */}
        {copiedUnit && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto',
            background: '#262626', border: '1px solid #4a4a4a', borderRadius: 4, padding: '4px 10px',
          }}>
            <span style={{ fontSize: 12, color: '#4a8fd4' }}>
              Copied: {copiedUnit.name}
            </span>
            <button
              onClick={() => setCopiedUnitId(null)}
              style={{
                background: 'transparent', border: 'none', color: '#aaaaaa',
                cursor: 'pointer', fontSize: 13, padding: '0 4px',
              }}
            >
              x
            </button>
          </div>
        )}

        {/* Stats */}
        <span style={{ fontSize: 13, color: '#aaaaaa', marginLeft: copiedUnit ? 0 : 'auto' }}>
          {Array.from(grouped.values()).reduce((s, g) => s + g.units.length, 0)} units in {grouped.size} groups
        </span>
      </div>

      {/* Group cards */}
      {Array.from(grouped.entries()).map(([groupName, { coalition, type, units }]) => (
        <GroupCard
          key={groupName}
          groupName={groupName}
          coalition={coalition}
          type={type}
          units={units}
          isExpanded={expandedGroups.has(groupName)}
          expandedUnits={expandedUnits}
          pylonOptions={pylonOptions}
          copiedUnitId={copiedUnitId}
          isPylonChanged={isPylonChanged}
          appliedPreset={appliedPresetByGroup.get(groupName)}
          onToggleGroup={() => toggleGroup(groupName)}
          onToggleUnit={toggleUnit}
          onPylonChange={handlePylonChange}
          onCopyUnit={setCopiedUnitId}
          onPasteToUnit={handleCopyLoadout}
          onPasteToGroup={handlePasteToGroup}
          onApplyPreset={handleApplyPreset}
          onClearPreset={() => clearPresetForGroup(groupName)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filter Pill                                                         */
/* ------------------------------------------------------------------ */

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? '#3a3a3a' : 'transparent',
        border: 'none',
        borderRadius: 3,
        color: active ? '#e0e0e0' : '#aaaaaa',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        padding: '4px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Group Card                                                          */
/* ------------------------------------------------------------------ */

interface GroupCardProps {
  groupName: string;
  coalition: string;
  type: string;
  units: ClientUnit[];
  isExpanded: boolean;
  expandedUnits: Set<number>;
  pylonOptions: Record<string, any>;
  copiedUnitId: number | null;
  isPylonChanged: (unitId: number, pylonNum: number) => boolean;
  appliedPreset?: LoadoutPreset;
  onToggleGroup: () => void;
  onToggleUnit: (id: number) => void;
  onPylonChange: (unitId: number, pylonNum: number, clsid: string) => void;
  onCopyUnit: (id: number) => void;
  onPasteToUnit: (sourceId: number, targetId: number) => void;
  onPasteToGroup: (sourceId: number, groupUnits: ClientUnit[]) => void;
  onApplyPreset: (preset: LoadoutPreset, groupUnits: ClientUnit[]) => number;
  onClearPreset: () => void;
}

function GroupCard({
  groupName, coalition, type, units, isExpanded, expandedUnits,
  pylonOptions, copiedUnitId, isPylonChanged, appliedPreset,
  onToggleGroup, onToggleUnit, onPylonChange,
  onCopyUnit, onPasteToUnit, onPasteToGroup, onApplyPreset, onClearPreset,
}: GroupCardProps) {
  const coalitionColor = coalition === 'blue' ? '#4a8fd4' : '#d95050';
  const copiedUnit = copiedUnitId ? units.find((u) => u.unitId === copiedUnitId) : null;
  // Only show "Paste to Group" if the copied unit is the same aircraft type as this group
  const allUnits = useMissionStore((s) => s.clientUnits);
  const copiedUnitType = copiedUnitId ? allUnits.find((u) => u.unitId === copiedUnitId)?.type : null;
  const canPasteToGroup = copiedUnitId != null && copiedUnitType === type && units.some((u) => u.unitId !== copiedUnitId);

  return (
    <div style={{
      marginBottom: 8,
      border: '1px solid #3a3a3a',
      borderRadius: 6,
      background: '#222222',
      overflow: 'hidden',
    }}>
      {/* Group header */}
      <div
        onClick={onToggleGroup}
        style={{
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          borderLeft: `3px solid ${coalitionColor}`,
          background: isExpanded ? '#1a1a1a' : 'transparent',
        }}
      >
        <span style={{ color: '#aaaaaa', fontSize: 12, userSelect: 'none', width: 12 }}>
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>

        <span style={{
          background: coalitionColor,
          color: '#1a1a1a', fontSize: 10, fontWeight: 700,
          padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {coalition}
        </span>

        <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 15 }}>
          {groupName}
        </span>

        {/* Applied preset badge */}
        {appliedPreset && (
          <span
            onClick={(e) => { e.stopPropagation(); onClearPreset(); }}
            title={`${appliedPreset.description} — click to dismiss`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 700,
              color: appliedPreset.color,
              background: `${appliedPreset.color}15`,
              border: `1px solid ${appliedPreset.color}55`,
              padding: '1px 7px',
              borderRadius: 3,
              letterSpacing: 0.5,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {appliedPreset.label}
            <span style={{ color: `${appliedPreset.color}aa`, fontSize: 10, fontWeight: 400 }}>×</span>
          </span>
        )}

        <span style={{ color: '#aaaaaa', fontSize: 13 }}>
          {type}
        </span>

        <span style={{ color: '#4a4a4a', fontSize: 12 }}>
          {units.length} unit{units.length !== 1 ? 's' : ''}
        </span>

        {/* Compact loadout summary pills from first unit */}
        <div style={{ display: 'flex', gap: 3, flex: 1, justifyContent: 'flex-end', overflow: 'hidden', flexWrap: 'wrap' }}>
          {buildLoadoutSummary(units[0].pylons).slice(0, 5).map(({ label, count, color }) => (
            <span key={label} style={{
              fontSize: 10, color, background: '#262626',
              padding: '1px 6px', borderRadius: 10, border: `1px solid ${color}22`,
              whiteSpace: 'nowrap',
            }}>
              {count > 1 ? `${count}x ` : ''}{label}
            </span>
          ))}
        </div>

        {/* Per-flight preset picker */}
        <PresetPicker units={units} onApply={onApplyPreset} />

        {/* Paste to group button */}
        {canPasteToGroup && !copiedUnit && (
          <button
            onClick={(e) => { e.stopPropagation(); onPasteToGroup(copiedUnitId!, units); }}
            style={pasteBtnStyle}
            title="Paste copied loadout to all same-type units in this group"
          >
            Paste to Group
          </button>
        )}
      </div>

      {/* Expanded unit list */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid #3a3a3a' }}>
          {units.map((unit) => (
            <UnitRow
              key={unit.unitId}
              unit={unit}
              pylonOptions={pylonOptions}
              isExpanded={expandedUnits.has(unit.unitId)}
              copiedUnitId={copiedUnitId}
              isPylonChanged={isPylonChanged}
              onToggle={() => onToggleUnit(unit.unitId)}
              onPylonChange={onPylonChange}
              onCopy={() => onCopyUnit(unit.unitId)}
              onPaste={copiedUnitId ? () => onPasteToUnit(copiedUnitId, unit.unitId) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Unit Row                                                            */
/* ------------------------------------------------------------------ */

interface UnitRowProps {
  unit: ClientUnit;
  pylonOptions: Record<string, any>;
  isExpanded: boolean;
  copiedUnitId: number | null;
  isPylonChanged: (unitId: number, pylonNum: number) => boolean;
  onToggle: () => void;
  onPylonChange: (unitId: number, pylonNum: number, clsid: string) => void;
  onCopy: () => void;
  onPaste?: () => void;
}

function UnitRow({
  unit, pylonOptions, isExpanded, copiedUnitId, isPylonChanged,
  onToggle, onPylonChange, onCopy, onPaste,
}: UnitRowProps) {
  const addEdit = useEditStore((s) => s.addEdit);
  const typeOptions = pylonOptions[unit.type] as Record<string, PylonInfo[]> | undefined;
  const [pylonSettings, setPylonSettings] = useState<Record<number, Record<string, any>>>({});
  const [expandedPylon, setExpandedPylon] = useState<number | null>(null);

  const isCopied = copiedUnitId === unit.unitId;
  const canPaste = onPaste && copiedUnitId !== unit.unitId;

  const summary = useMemo(() => buildLoadoutSummary(unit.pylons), [unit.pylons]);
  const totalStations = typeOptions ? Object.keys(typeOptions).length : unit.pylons.length;
  const loadedStations = unit.pylons.filter((p) => p.clsid && p.shortName !== '<Empty>').length;

  const handleSettingsChange = useCallback((pylonNum: number, settings: Record<string, any>) => {
    setPylonSettings((prev) => ({ ...prev, [pylonNum]: settings }));
    const pylon = unit.pylons.find((p) => p.number === pylonNum);
    if (pylon) {
      addEdit({ unitId: unit.unitId, field: 'pylonChange', value: { pylon: pylonNum, clsid: pylon.clsid, settings } } as any);
    }
  }, [unit.unitId, unit.pylons, addEdit]);

  return (
    <div style={{ borderBottom: '1px solid #262626' }}>
      {/* Unit header row */}
      <div
        onClick={onToggle}
        style={{
          padding: '8px 16px 8px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          background: isExpanded ? '#1a1a1a' : 'transparent',
        }}
      >
        <span style={{ color: '#aaaaaa', fontSize: 11, userSelect: 'none', width: 12 }}>
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>

        {/* Unit name */}
        <span style={{ color: '#cccccc', fontWeight: 500, fontSize: 14, minWidth: 120 }}>
          {unit.name}
        </span>

        {/* Status badges */}
        <div style={{ display: 'flex', gap: 4 }}>
          <Badge label="Fuel" value={(() => {
            const fuelPct = unit.fuel <= 1 ? `${Math.round(unit.fuel * 100)}%` : `${Math.round(unit.fuel)}`;
            const tankCount = unit.pylons.filter(p => (p.category || '').toLowerCase().includes('fuel') || (p.name || '').toLowerCase().includes('fuel tank')).length;
            return tankCount > 0 ? `${fuelPct} +${tankCount}ET` : fuelPct;
          })()} />
          <Badge label="FL" value={String(unit.flare)} />
          <Badge label="CH" value={String(unit.chaff)} />
          <Badge label="Gun" value={`${unit.gun}%`} />
        </div>

        {/* Stations loaded indicator */}
        <span style={{ fontSize: 11, color: '#aaaaaa', marginLeft: 4 }}>
          {loadedStations}/{totalStations} stn
        </span>

        {/* Loadout summary pills */}
        <div style={{ display: 'flex', gap: 3, flex: 1, justifyContent: 'flex-end', overflow: 'hidden', flexWrap: 'wrap' }}>
          {summary.slice(0, 6).map(({ label, count, color }) => (
            <span key={label} style={{
              fontSize: 10, color, background: '#262626',
              padding: '1px 6px', borderRadius: 10, border: `1px solid ${color}22`,
              whiteSpace: 'nowrap',
            }}>
              {count > 1 ? `${count}x ` : ''}{label}
            </span>
          ))}
        </div>

        {/* Copy / Paste buttons */}
        <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onCopy}
            style={{
              ...smallActionBtn,
              background: isCopied ? 'rgba(63, 185, 80, 0.15)' : 'rgba(74, 143, 212, 0.1)',
              color: isCopied ? '#3fb950' : '#4a8fd4',
              borderColor: isCopied ? '#3fb950' : '#4a4a4a',
            }}
            title="Copy this loadout"
          >
            {isCopied ? '\u2713 Copied' : 'Copy'}
          </button>
          {canPaste && (
            <button
              onClick={onPaste}
              style={{
                ...smallActionBtn,
                background: 'rgba(217, 153, 34, 0.15)',
                color: '#d99922',
                borderColor: '#d9992244',
              }}
              title="Paste copied loadout to this unit"
            >
              Paste
            </button>
          )}
        </div>
      </div>

      {/* Expanded pylon editor */}
      {isExpanded && (
        <div style={{ padding: '8px 16px 12px 56px' }}>
          {(() => {
            const allStations = typeOptions
              ? Object.keys(typeOptions).map(Number).sort((a, b) => a - b)
              : unit.pylons.map((p) => p.number);
            const pylonMap = new Map(unit.pylons.map((p) => [p.number, p]));

            return allStations.map((stationNum) => {
              const pylon = pylonMap.get(stationNum) || {
                number: stationNum, clsid: '', name: '<Empty>', shortName: '<Empty>', category: '',
              };
              const options = typeOptions?.[String(stationNum)] as PylonInfo[] | undefined;
              const changed = isPylonChanged(unit.unitId, stationNum);
              const isExpPylon = expandedPylon === pylon.number;
              const isEmpty = !pylon.clsid || pylon.shortName === '<Empty>';

              // Group options by category
              const byCategory = new Map<string, PylonInfo[]>();
              if (options) {
                for (const opt of options) {
                  const cat = opt.category || 'Other';
                  let arr = byCategory.get(cat);
                  if (!arr) { arr = []; byCategory.set(cat, arr); }
                  arr.push(opt);
                }
              }

              return (
                <div key={pylon.number} style={{ marginBottom: 2 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '3px 0',
                  }}>
                    {/* Station number */}
                    <span style={{
                      color: isEmpty ? '#3a3a3a' : '#aaaaaa',
                      fontSize: 12, fontFamily: "'B612 Mono', monospace", minWidth: 30, textAlign: 'right',
                    }}>
                      {stationNum}
                    </span>

                    {/* Category color dot */}
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: isEmpty ? '#3a3a3a' : getCatColor(pylon.category),
                      flexShrink: 0,
                    }} />

                    {/* Dropdown */}
                    <select
                      value={pylon.clsid}
                      onChange={(e) => {
                        onPylonChange(unit.unitId, pylon.number, e.target.value);
                        if (e.target.value) setExpandedPylon(pylon.number);
                        else setExpandedPylon(null);
                      }}
                      style={{
                        ...pylonSelectStyle,
                        flex: 1,
                        ...(changed ? { borderColor: '#3fb950' } : {}),
                        ...(isEmpty ? { color: '#4a4a4a' } : {}),
                      }}
                    >
                      <option value="">(empty)</option>
                      {Array.from(byCategory.entries()).map(([cat, opts]) => (
                        <optgroup key={cat} label={cat}>
                          {opts.map((opt) => (
                            <option key={opt.clsid} value={opt.clsid}>{opt.shortName}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>

                    {/* Settings gear */}
                    {!isEmpty && (
                      <button
                        onClick={() => setExpandedPylon(isExpPylon ? null : pylon.number)}
                        style={{
                          background: 'transparent', border: 'none',
                          color: isExpPylon ? '#4a8fd4' : '#4a4a4a',
                          cursor: 'pointer', fontSize: 12, padding: '2px 4px',
                        }}
                        title="Weapon settings"
                      >
                        {isExpPylon ? '\u25B2' : '\u2699'}
                      </button>
                    )}
                  </div>

                  {/* Weapon settings panel */}
                  {isExpPylon && pylon.clsid && (
                    <div style={{ marginLeft: 38, marginBottom: 4 }}>
                      <LauncherSettingsPanel
                        clsid={pylon.clsid}
                        currentSettings={pylonSettings[pylon.number] || {}}
                        onChange={(settings) => handleSettingsChange(pylon.number, settings)}
                      />
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      background: '#262626',
      border: '1px solid #3a3a3a',
      borderRadius: 3,
      padding: '2px 6px',
      fontSize: 11,
      color: '#cccccc',
      fontFamily: "'B612 Mono', monospace",
      whiteSpace: 'nowrap',
    }}>
      <span style={{ color: '#aaaaaa', marginRight: 3 }}>{label}</span>
      <span style={{ color: '#e0e0e0', fontWeight: 500 }}>{value}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const pylonSelectStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#e0e0e0',
  fontFamily: "'B612 Mono', monospace",
  fontSize: 12,
  padding: '3px 6px',
  outline: 'none',
};

const smallActionBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
  padding: '2px 8px',
  fontFamily: 'inherit',
};

const pasteBtnStyle: React.CSSProperties = {
  background: 'rgba(74, 143, 212, 0.1)',
  border: '1px solid #4a4a4a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 12,
  padding: '3px 10px',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

/* ------------------------------------------------------------------ */
/* Per-flight preset picker                                            */
/* ------------------------------------------------------------------ */

function PresetPicker({
  units, onApply,
}: {
  units: ClientUnit[];
  onApply: (preset: LoadoutPreset, groupUnits: ClientUnit[]) => number;
}) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click (accounting for the portal'd menu)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current && btnRef.current.contains(target)) return;
      if (menuRef.current && menuRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Position the menu relative to the button whenever it opens or the window scrolls/resizes.
  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuWidth = 300;
      // Prefer aligning to right edge of button
      let left = rect.right - menuWidth;
      if (left < 8) left = 8;
      // Place below the button
      let top = rect.bottom + 4;
      // If it would overflow the viewport, place above the button
      const estHeight = 70 * LOADOUT_PRESETS.length;
      if (top + estHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - estHeight - 4);
      }
      setMenuPos({ top, left });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open]);

  const apply = (preset: LoadoutPreset, e: React.MouseEvent) => {
    e.stopPropagation();
    const changed = onApply(preset, units);
    setFlash(`${preset.label}: ${changed} pylon${changed !== 1 ? 's' : ''} changed`);
    setOpen(false);
    setTimeout(() => setFlash(null), 2500);
  };

  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{
          background: 'rgba(210, 153, 34, 0.1)',
          border: '1px solid rgba(210, 153, 34, 0.4)',
          borderRadius: 4,
          color: '#d29922',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          padding: '3px 10px',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
        title="Apply a role-based loadout preset to this flight"
      >
        Preset ▾
      </button>
      {flash && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#262626', border: '1px solid rgba(63, 185, 80, 0.3)',
          borderRadius: 4, padding: '4px 8px', fontSize: 11, color: '#3fb950',
          whiteSpace: 'nowrap', zIndex: 200, pointerEvents: 'none',
        }}>
          ✓ {flash}
        </div>
      )}
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            background: '#222222',
            border: '1px solid #4a4a4a',
            borderRadius: 6,
            padding: 4,
            zIndex: 9999,
            width: 300,
            boxShadow: '0 6px 24px rgba(0, 0, 0, 0.6)',
          }}
        >
          {LOADOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={(e) => apply(preset, e)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: 'transparent',
                border: 'none',
                borderLeft: `3px solid ${preset.color}`,
                color: '#e0e0e0', cursor: 'pointer',
                fontSize: 12, padding: '6px 10px',
                fontFamily: 'inherit', borderRadius: 3,
                marginBottom: 2,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#262626'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <div style={{ color: preset.color, fontWeight: 700, fontSize: 12 }}>{preset.label}</div>
              <div style={{ color: '#aaaaaa', fontSize: 11, marginTop: 1 }}>{preset.description}</div>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
