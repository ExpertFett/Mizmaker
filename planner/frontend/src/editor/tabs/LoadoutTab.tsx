import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { LauncherSettingsPanel } from '../components/LauncherSettings';
import type { ClientUnit, PylonInfo } from '../../types/mission';

export function LoadoutTab() {
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const pylonOptions = useMissionStore((s) => s.pylonOptions);
  const addEdit = useEditStore((s) => s.addEdit);

  // Snapshot original pylon state on mount for change-tracking
  const originals = useRef<Map<number, PylonInfo[]>>(new Map());
  useEffect(() => {
    const map = new Map<number, PylonInfo[]>();
    for (const u of clientUnits) {
      map.set(u.unitId, u.pylons.map((p) => ({ ...p })));
    }
    originals.current = map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copy-loadout state
  const [copySource, setCopySource] = useState<number | null>(null);

  // Group units by groupName
  const grouped = useMemo(() => {
    const map = new Map<string, { coalition: string; units: ClientUnit[] }>();
    for (const u of clientUnits) {
      let entry = map.get(u.groupName);
      if (!entry) {
        entry = { coalition: u.coalition, units: [] };
        map.set(u.groupName, entry);
      }
      entry.units.push(u);
    }
    return map;
  }, [clientUnits]);

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

    // Find the selected option from pylonOptions
    const opts = pylonOptions[unit.type]?.[String(pylonNum)] as PylonInfo[] | undefined;
    const selected = opts?.find((o) => o.clsid === clsid);
    if (!selected && clsid !== '') return;

    addEdit({ unitId, field: 'pylonChange', value: { pylon: pylonNum, clsid, settings: {} } } as any);

    // Optimistic update
    const updated = units.map((u) => {
      if (u.unitId !== unitId) return u;
      const newPylons = u.pylons.map((p) => {
        if (p.number !== pylonNum) return p;
        if (!selected) return { ...p, clsid: '', name: '<Empty>', shortName: '<Empty>', category: '' };
        return { ...p, clsid: selected.clsid, name: selected.name, shortName: selected.shortName, category: selected.category };
      });
      return { ...u, pylons: newPylons };
    });
    useMissionStore.setState({ clientUnits: updated });
  }, [addEdit, pylonOptions]);

  const handleCopyLoadout = useCallback((sourceId: number, targetIds: number[]) => {
    const { clientUnits: units } = useMissionStore.getState();
    const source = units.find((u) => u.unitId === sourceId);
    if (!source) return;

    for (const targetId of targetIds) {
      addEdit({ unitId: targetId, field: 'copyLoadout', value: sourceId });
    }

    const updated = units.map((u) => {
      if (!targetIds.includes(u.unitId)) return u;
      return { ...u, pylons: source.pylons.map((p) => ({ ...p })) };
    });
    useMissionStore.setState({ clientUnits: updated });
    setCopySource(null);
  }, [addEdit]);

  if (clientUnits.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 14, padding: 20 }}>
        No client (player) units found in this mission.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#ccdae8' }}>
          Loadout Editor
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5a7a8a' }}>
          Edit weapon loadouts per pylon for each player unit.
        </p>
      </div>

      {/* Copy loadout controls */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 12, color: '#5a7a8a' }}>Copy loadout from:</label>
        <select
          value={copySource ?? ''}
          onChange={(e) => setCopySource(e.target.value ? Number(e.target.value) : null)}
          style={selectStyle}
        >
          <option value="">Select source unit...</option>
          {clientUnits.map((u) => (
            <option key={u.unitId} value={u.unitId}>{u.name} ({u.type})</option>
          ))}
        </select>
        {copySource !== null && (
          <>
            <span style={{ fontSize: 12, color: '#5a7a8a' }}>to same-type units:</span>
            {(() => {
              const source = clientUnits.find((u) => u.unitId === copySource);
              const targets = clientUnits.filter((u) => u.unitId !== copySource && u.type === source?.type);
              if (targets.length === 0) {
                return <span style={{ fontSize: 11, color: '#5a7a8a' }}>No matching units</span>;
              }
              return (
                <button
                  onClick={() => handleCopyLoadout(copySource, targets.map((t) => t.unitId))}
                  style={copyBtnStyle}
                >
                  Apply to {targets.length} unit{targets.length !== 1 ? 's' : ''}
                </button>
              );
            })()}
          </>
        )}
      </div>

      {Array.from(grouped.entries()).map(([groupName, { coalition, units }]) => {
        const coalitionColor = coalition === 'blue' ? '#4a8fd4' : '#d95050';
        return (
          <div key={groupName} style={{ marginBottom: 20 }}>
            {/* Group header */}
            <div style={{
              padding: '8px 10px',
              fontSize: 12,
              fontWeight: 600,
              borderBottom: '1px solid #1a2a3a',
              borderLeft: `3px solid ${coalitionColor}`,
              background: '#0a1520',
            }}>
              <span style={{ color: coalitionColor, marginRight: 8 }}>{coalition.toUpperCase()}</span>
              <span style={{ color: '#8fa8c0' }}>{groupName}</span>
              <span style={{ color: '#5a7a8a', marginLeft: 8, fontWeight: 400 }}>
                ({units.length} unit{units.length !== 1 ? 's' : ''})
              </span>
            </div>

            {units.map((unit) => (
              <UnitCard
                key={unit.unitId}
                unit={unit}
                pylonOptions={pylonOptions}
                isPylonChanged={isPylonChanged}
                onPylonChange={handlePylonChange}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface UnitCardProps {
  unit: ClientUnit;
  pylonOptions: Record<string, any>;
  isPylonChanged: (unitId: number, pylonNum: number) => boolean;
  onPylonChange: (unitId: number, pylonNum: number, clsid: string) => void;
}

function UnitCard({ unit, pylonOptions, isPylonChanged, onPylonChange }: UnitCardProps) {
  const addEdit = useEditStore((s) => s.addEdit);
  const typeOptions = pylonOptions[unit.type] as Record<string, PylonInfo[]> | undefined;
  const [pylonSettings, setPylonSettings] = useState<Record<number, Record<string, any>>>({});
  const [expandedPylon, setExpandedPylon] = useState<number | null>(null);

  const handleSettingsChange = useCallback((pylonNum: number, settings: Record<string, any>) => {
    setPylonSettings((prev) => ({ ...prev, [pylonNum]: settings }));
    const pylon = unit.pylons.find((p) => p.number === pylonNum);
    if (pylon) {
      addEdit({ unitId: unit.unitId, field: 'pylonChange', value: { pylon: pylonNum, clsid: pylon.clsid, settings } } as any);
    }
  }, [unit.unitId, unit.pylons, addEdit]);

  return (
    <div style={{
      background: '#0c1622',
      borderBottom: '1px solid #0f1a28',
      padding: '10px 12px',
    }}>
      {/* Unit header with badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ color: '#8fa8c0', fontWeight: 600, fontSize: 13 }}>{unit.name}</span>
        <span style={{ color: '#5a7a8a', fontSize: 12 }}>{unit.type}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Badge label="Fuel" value={`${Math.round(unit.fuel * 100)}%`} />
          <Badge label="FL" value={String(unit.flare)} />
          <Badge label="CH" value={String(unit.chaff)} />
          <Badge label="Gun" value={`${unit.gun}%`} />
        </div>
      </div>

      {/* Pylon list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {unit.pylons.map((pylon) => {
          const options = typeOptions?.[String(pylon.number)] as PylonInfo[] | undefined;
          const changed = isPylonChanged(unit.unitId, pylon.number);
          const isExpanded = expandedPylon === pylon.number;

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
            <div key={pylon.number}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#5a7a8a', fontSize: 11, fontFamily: 'monospace', minWidth: 36, textAlign: 'right' }}>
                  Stn {pylon.number}
                </span>
                <select
                  value={pylon.clsid}
                  onChange={(e) => {
                    onPylonChange(unit.unitId, pylon.number, e.target.value);
                    if (e.target.value) setExpandedPylon(pylon.number);
                    else setExpandedPylon(null);
                  }}
                  style={{ ...selectStyle, flex: 1, ...(changed ? { borderLeft: '3px solid #3fb950' } : {}) }}
                >
                  <option value="">&lt;Empty&gt;</option>
                  {Array.from(byCategory.entries()).map(([cat, opts]) => (
                    <optgroup key={cat} label={cat}>
                      {opts.map((opt) => (
                        <option key={opt.clsid} value={opt.clsid}>{opt.shortName}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span style={{ color: '#8fa8c0', fontSize: 11, fontFamily: 'monospace', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pylon.shortName}
                </span>
                {pylon.clsid && (
                  <button
                    onClick={() => setExpandedPylon(isExpanded ? null : pylon.number)}
                    style={{ background: 'transparent', border: 'none', color: isExpanded ? '#4a8fd4' : '#3a4a5a', cursor: 'pointer', fontSize: 10, padding: '2px 4px' }}
                    title="Weapon settings"
                  >
                    {isExpanded ? '\u25B2' : '\u2699'}
                  </button>
                )}
              </div>
              {isExpanded && pylon.clsid && (
                <div style={{ marginLeft: 44 }}>
                  <LauncherSettingsPanel
                    clsid={pylon.clsid}
                    currentSettings={pylonSettings[pylon.number] || {}}
                    onChange={(settings) => handleSettingsChange(pylon.number, settings)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      background: '#0f1a28',
      border: '1px solid #1a2a3a',
      borderRadius: 3,
      padding: '1px 6px',
      fontSize: 10,
      color: '#5a7a8a',
      fontFamily: 'monospace',
    }}>
      <span style={{ color: '#3a5a6a', marginRight: 3 }}>{label}</span>
      <span style={{ color: '#8fa8c0' }}>{value}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const selectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontFamily: 'monospace',
  fontSize: 12,
  padding: '4px 6px',
};

const copyBtnStyle: React.CSSProperties = {
  background: 'rgba(74, 143, 212, 0.12)',
  border: '1px solid #1a3a5a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 12,
  padding: '4px 12px',
};
