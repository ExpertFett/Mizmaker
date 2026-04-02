import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { LauncherSettingsPanel } from '../components/LauncherSettings';
import type { ClientUnit, PylonInfo } from '../../types/mission';

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
  'ECM':          '#8fa8c0',
  'Targeting':    '#8fa8c0',
  'Gun Pod':      '#5a7a8a',
  'Other':        '#5a7a8a',
};

function getCatColor(cat: string): string {
  if (!cat) return '#5a7a8a';
  for (const [key, color] of Object.entries(CAT_COLORS)) {
    if (cat.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return '#5a7a8a';
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
    useMissionStore.setState({ clientUnits: updated });
  }, [addEdit, pylonOptions]);

  const handleCopyLoadout = useCallback((sourceId: number, targetId: number) => {
    const { clientUnits: units } = useMissionStore.getState();
    const source = units.find((u) => u.unitId === sourceId);
    if (!source) return;

    addEdit({ unitId: targetId, field: 'copyLoadout', value: sourceId });

    const updated = units.map((u) => {
      if (u.unitId !== targetId) return u;
      return { ...u, pylons: source.pylons.map((p) => ({ ...p })) };
    });
    useMissionStore.setState({ clientUnits: updated });
  }, [addEdit]);

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
    useMissionStore.setState({ clientUnits: updated });
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
      <div style={{ color: '#5a7a8a', fontSize: 15, padding: 20 }}>
        No client (player) units found in this mission.
      </div>
    );
  }

  const copiedUnit = copiedUnitId ? clientUnits.find((u) => u.unitId === copiedUnitId) : null;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
          Loadout Editor
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#5a7a8a' }}>
          Click a group to expand, then click a unit to edit individual pylons.
          Copy a loadout and paste it to other same-type units.
        </p>
      </div>

      {/* Filter + clipboard bar */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap',
      }}>
        {/* Type filter pills */}
        <div style={{ display: 'flex', gap: 2, background: '#0a1520', borderRadius: 4, border: '1px solid #1a2a3a', padding: 2, flexWrap: 'wrap' }}>
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
            background: '#0f1a28', border: '1px solid #1a3a5a', borderRadius: 4, padding: '4px 10px',
          }}>
            <span style={{ fontSize: 12, color: '#4a8fd4' }}>
              Copied: {copiedUnit.name}
            </span>
            <button
              onClick={() => setCopiedUnitId(null)}
              style={{
                background: 'transparent', border: 'none', color: '#5a7a8a',
                cursor: 'pointer', fontSize: 13, padding: '0 4px',
              }}
            >
              x
            </button>
          </div>
        )}

        {/* Stats */}
        <span style={{ fontSize: 13, color: '#5a7a8a', marginLeft: copiedUnit ? 0 : 'auto' }}>
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
          onToggleGroup={() => toggleGroup(groupName)}
          onToggleUnit={toggleUnit}
          onPylonChange={handlePylonChange}
          onCopyUnit={setCopiedUnitId}
          onPasteToUnit={handleCopyLoadout}
          onPasteToGroup={handlePasteToGroup}
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
        background: active ? '#1a2a3a' : 'transparent',
        border: 'none',
        borderRadius: 3,
        color: active ? '#ccdae8' : '#5a7a8a',
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
  onToggleGroup: () => void;
  onToggleUnit: (id: number) => void;
  onPylonChange: (unitId: number, pylonNum: number, clsid: string) => void;
  onCopyUnit: (id: number) => void;
  onPasteToUnit: (sourceId: number, targetId: number) => void;
  onPasteToGroup: (sourceId: number, groupUnits: ClientUnit[]) => void;
}

function GroupCard({
  groupName, coalition, type, units, isExpanded, expandedUnits,
  pylonOptions, copiedUnitId, isPylonChanged,
  onToggleGroup, onToggleUnit, onPylonChange,
  onCopyUnit, onPasteToUnit, onPasteToGroup,
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
      border: '1px solid #1a2a3a',
      borderRadius: 6,
      background: '#0a1520',
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
          background: isExpanded ? '#0c1825' : 'transparent',
        }}
      >
        <span style={{ color: '#5a7a8a', fontSize: 12, userSelect: 'none', width: 12 }}>
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>

        <span style={{
          background: coalitionColor,
          color: '#080f1c', fontSize: 10, fontWeight: 700,
          padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {coalition}
        </span>

        <span style={{ color: '#ccdae8', fontWeight: 600, fontSize: 15 }}>
          {groupName}
        </span>

        <span style={{ color: '#5a7a8a', fontSize: 13 }}>
          {type}
        </span>

        <span style={{ color: '#3a5a6a', fontSize: 12 }}>
          {units.length} unit{units.length !== 1 ? 's' : ''}
        </span>

        {/* Compact loadout summary pills from first unit */}
        <div style={{ display: 'flex', gap: 3, flex: 1, justifyContent: 'flex-end', overflow: 'hidden', flexWrap: 'wrap' }}>
          {buildLoadoutSummary(units[0].pylons).slice(0, 5).map(({ label, count, color }) => (
            <span key={label} style={{
              fontSize: 10, color, background: '#0f1a28',
              padding: '1px 6px', borderRadius: 10, border: `1px solid ${color}22`,
              whiteSpace: 'nowrap',
            }}>
              {count > 1 ? `${count}x ` : ''}{label}
            </span>
          ))}
        </div>

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
        <div style={{ borderTop: '1px solid #1a2a3a' }}>
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
    <div style={{ borderBottom: '1px solid #0f1a28' }}>
      {/* Unit header row */}
      <div
        onClick={onToggle}
        style={{
          padding: '8px 16px 8px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          background: isExpanded ? '#0c1622' : 'transparent',
        }}
      >
        <span style={{ color: '#5a7a8a', fontSize: 11, userSelect: 'none', width: 12 }}>
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>

        {/* Unit name */}
        <span style={{ color: '#8fa8c0', fontWeight: 500, fontSize: 14, minWidth: 120 }}>
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
        <span style={{ fontSize: 11, color: '#5a7a8a', marginLeft: 4 }}>
          {loadedStations}/{totalStations} stn
        </span>

        {/* Loadout summary pills */}
        <div style={{ display: 'flex', gap: 3, flex: 1, justifyContent: 'flex-end', overflow: 'hidden', flexWrap: 'wrap' }}>
          {summary.slice(0, 6).map(({ label, count, color }) => (
            <span key={label} style={{
              fontSize: 10, color, background: '#0f1a28',
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
              borderColor: isCopied ? '#3fb950' : '#1a3a5a',
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
                      color: isEmpty ? '#2a3a4a' : '#5a7a8a',
                      fontSize: 12, fontFamily: 'monospace', minWidth: 30, textAlign: 'right',
                    }}>
                      {stationNum}
                    </span>

                    {/* Category color dot */}
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: isEmpty ? '#1a2a3a' : getCatColor(pylon.category),
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
                        ...(isEmpty ? { color: '#3a5a6a' } : {}),
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
                          color: isExpPylon ? '#4a8fd4' : '#3a5a6a',
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
      background: '#0f1a28',
      border: '1px solid #1a2a3a',
      borderRadius: 3,
      padding: '2px 6px',
      fontSize: 11,
      color: '#8fa8c0',
      fontFamily: 'monospace',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ color: '#6a8a9a', marginRight: 3 }}>{label}</span>
      <span style={{ color: '#ccdae8', fontWeight: 500 }}>{value}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const pylonSelectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontFamily: 'monospace',
  fontSize: 12,
  padding: '3px 6px',
  outline: 'none',
};

const smallActionBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
  padding: '2px 8px',
  fontFamily: 'inherit',
};

const pasteBtnStyle: React.CSSProperties = {
  background: 'rgba(74, 143, 212, 0.1)',
  border: '1px solid #1a3a5a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 12,
  padding: '3px 10px',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};
