import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import { useSopStore } from '../../sop/sopStore';
import type { LaserCapableUnit } from '../../types/mission';

/**
 * DCS laser codes use digits 1-7 only (8 and 9 are invalid).
 * This increments the last digit, rolling over through higher digits,
 * keeping all digits in the valid 1-7 range.
 */
function nextLaserCode(code: number): number {
  let d1 = Math.floor(code / 1000) % 10;
  let d2 = Math.floor(code / 100) % 10;
  let d3 = Math.floor(code / 10) % 10;
  let d4 = code % 10;
  d4 += 1;
  if (d4 > 7) { d4 = 1; d3 += 1; }
  if (d3 > 7) { d3 = 1; d2 += 1; }
  if (d2 > 7) { d2 = 1; d1 += 1; }
  if (d1 > 7) d1 = 1; // wrap to 1111 — unreachable with normal mission sizes
  return d1 * 1000 + d2 * 100 + d3 * 10 + d4;
}

function clampToValidLaserCode(n: number): number {
  const d1 = Math.floor(n / 1000) % 10;
  const d2 = Math.floor(n / 100) % 10;
  const d3 = Math.floor(n / 10) % 10;
  const d4 = n % 10;
  const clamp = (d: number) => (d < 1 ? 1 : d > 7 ? 7 : d);
  return clamp(d1) * 1000 + clamp(d2) * 100 + clamp(d3) * 10 + clamp(d4);
}

export function LaserTab() {
  const laserCapableUnits = useMissionStore((s) => s.laserCapableUnits);
  const addEdit = useEditStore((s) => s.addEdit);
  const activeSop = useSopStore((s) => s.activeId ? s.sops.find((x) => x.id === s.activeId) || null : null);
  // Default base code prefers the active SOP's laserCodeBase, else 1511.
  const [baseCode, setBaseCode] = useState(() => activeSop?.laserCodeBase ?? 1511);
  const [autoResult, setAutoResult] = useState('');

  // If the user activates/deactivates an SOP, update the base code to match.
  useEffect(() => {
    if (activeSop?.laserCodeBase) setBaseCode(activeSop.laserCodeBase);
  }, [activeSop?.id, activeSop?.laserCodeBase]);

  // Snapshot original laser codes on mount
  const originals = useRef<Map<number, number | null>>(new Map());
  useEffect(() => {
    const map = new Map<number, number | null>();
    for (const u of laserCapableUnits) {
      map.set(u.unitId, u.laserCode);
    }
    originals.current = map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Match laser-guided weapons by short-form or UUID-ish CLSID pattern.
  // (Backend already filtered to laser-capable units; this is just for the
  // "Laser Weapons" column display.)
  const LASER_NAME_PATTERNS = /GBU[-\s_]?1[0246]|GBU[-\s_]?24|GBU[-\s_]?27|GBU[-\s_]?28|Paveway|LGB|KAB[-\s_]?500L|KAB[-\s_]?1500L|LJDAM|AGM[-\s_]?65[EKL]|AGM[-\s_]?114[KL]|APKWS|Maverick[-\s_]?E/i;

  const laserUnits = laserCapableUnits; // backend already filtered

  // Group by groupName, preserving order
  const grouped = useMemo(() => {
    const map = new Map<string, { coalition: string; isClient: boolean; units: LaserCapableUnit[] }>();
    for (const u of laserUnits) {
      let entry = map.get(u.groupName);
      if (!entry) {
        entry = { coalition: u.coalition, isClient: u.isClient, units: [] };
        map.set(u.groupName, entry);
      }
      entry.units.push(u);
      if (u.isClient) entry.isClient = true;
    }
    return map;
  }, [laserUnits]);

  const isChanged = useCallback((unitId: number): boolean => {
    const orig = originals.current.get(unitId);
    const unit = laserCapableUnits.find((u) => u.unitId === unitId);
    if (!unit) return false;
    return orig !== unit.laserCode;
  }, [laserCapableUnits]);

  const getLaserWeapons = useCallback((unit: LaserCapableUnit): string[] => {
    return unit.pylons
      .filter((p) => LASER_NAME_PATTERNS.test(p.clsid) || LASER_NAME_PATTERNS.test(p.name) || LASER_NAME_PATTERNS.test(p.shortName))
      .map((p) => p.shortName);
  }, []);

  const handleLaserCodeChange = useCallback((unitId: number, code: number, autoIncrement: boolean) => {
    addEdit({ unitId, field: 'laserCode', value: code });

    const { laserCapableUnits: units } = useMissionStore.getState();
    const unit = units.find((u) => u.unitId === unitId);
    if (!unit) return;

    const groupUnits = units.filter((u) => u.groupName === unit.groupName);
    const isLead = autoIncrement && groupUnits.length > 0 && groupUnits[0].unitId === unitId;

    if (isLead) {
      const updatedUnits = units.map((u) => {
        if (u.groupName !== unit.groupName) return u;
        const idx = groupUnits.findIndex((g) => g.unitId === u.unitId);
        // Use proper DCS laser-code increment (digits 1-7 only)
        let newCode = code;
        for (let i = 0; i < idx; i++) newCode = nextLaserCode(newCode);
        if (idx > 0) {
          addEdit({ unitId: u.unitId, field: 'laserCode', value: newCode });
        }
        return { ...u, laserCode: idx === 0 ? code : newCode };
      });
      useMissionStore.setState({ laserCapableUnits: updatedUnits });
    } else {
      const updated = units.map((u) => {
        if (u.unitId !== unitId) return u;
        return { ...u, laserCode: code };
      });
      useMissionStore.setState({ laserCapableUnits: updated });
    }
  }, [addEdit]);

  const handleAutoAssign = useCallback(() => {
    const start = clampToValidLaserCode(baseCode);
    const { laserCapableUnits: units } = useMissionStore.getState();
    let nextCode = start;
    const assignedByUnit = new Map<number, number>();
    let groupCount = 0;
    for (const [, { units: groupUnits }] of grouped) {
      groupCount += 1;
      for (const u of groupUnits) {
        assignedByUnit.set(u.unitId, nextCode);
        nextCode = nextLaserCode(nextCode);
      }
    }

    const updatedUnits = units.map((u) => {
      const code = assignedByUnit.get(u.unitId);
      if (code === undefined) return u;
      addEdit({ unitId: u.unitId, field: 'laserCode', value: code });
      return { ...u, laserCode: code };
    });
    useMissionStore.setState({ laserCapableUnits: updatedUnits });

    setAutoResult(
      `Assigned ${assignedByUnit.size} laser code${assignedByUnit.size !== 1 ? 's' : ''} across ${groupCount} group${groupCount !== 1 ? 's' : ''} starting at ${start}`,
    );
  }, [grouped, baseCode, addEdit]);

  if (laserUnits.length === 0) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 15, padding: 20 }}>
        No units with laser-guided weapons or laser codes found in this mission.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
            Laser Code Editor
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
            Edit laser codes for units with laser-guided weapons. Changing the lead unit auto-increments wingmen codes.
          </p>
        </div>

        {/* Auto Assign controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <label style={{ fontSize: 12, color: '#aaaaaa' }}>Start:</label>
          <input
            type="number"
            min={1111}
            max={7777}
            value={baseCode}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n)) setBaseCode(n);
            }}
            style={{ ...monoInputStyle, width: 70 }}
          />
          {activeSop?.laserCodeBase && (
            <button
              onClick={() => setBaseCode(activeSop.laserCodeBase!)}
              title={`Reset to SOP "${activeSop.name}" base: ${activeSop.laserCodeBase}`}
              style={sopChipStyle}
            >
              SOP: {activeSop.laserCodeBase}
            </button>
          )}
          <button
            onClick={handleAutoAssign}
            title={activeSop?.laserCodeBase
              ? `Assigns sequential laser codes (digits 1-7) across all groups, leads first. Using SOP "${activeSop.name}" base ${activeSop.laserCodeBase}.`
              : 'Assigns sequential laser codes (digits 1-7) across all groups, leads first'}
            style={{
              background: '#4a4a4a',
              border: '1px solid #4a8fd4',
              borderRadius: 4,
              color: '#4a8fd4',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 14px',
              fontFamily: 'inherit',
            }}
          >
            Auto Assign{activeSop?.laserCodeBase ? ' (SOP)' : ''}
          </button>
        </div>
      </div>

      {autoResult && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(63, 185, 80, 0.08)',
          border: '1px solid rgba(63, 185, 80, 0.3)',
          borderRadius: 4,
          color: '#3fb950',
          fontSize: 13,
          marginBottom: 12,
        }}>
          ✓ {autoResult}
        </div>
      )}

      {Array.from(grouped.entries()).map(([groupName, { coalition, isClient, units }]) => {
        const coalitionColor = coalition === 'blue' ? '#4a8fd4' : '#d95050';
        return (
          <div key={groupName} style={{ marginBottom: 20 }}>
            {/* Group header */}
            <div style={{
              padding: '8px 10px',
              fontSize: 13,
              fontWeight: 600,
              borderBottom: '1px solid #3a3a3a',
              borderLeft: `3px solid ${coalitionColor}`,
              background: '#222222',
            }}>
              <span style={{ color: coalitionColor, marginRight: 8 }}>{coalition.toUpperCase()}</span>
              <span style={{ color: '#cccccc' }}>{groupName}</span>
              <span style={{
                marginLeft: 8,
                fontSize: 11,
                fontWeight: 600,
                color: isClient ? '#3fb950' : '#8a8a6a',
                border: `1px solid ${isClient ? 'rgba(63, 185, 80, 0.4)' : 'rgba(138, 138, 106, 0.4)'}`,
                borderRadius: 3,
                padding: '0 5px',
              }}>
                {isClient ? 'CLIENT' : 'AI'}
              </span>
              <span style={{ color: '#aaaaaa', marginLeft: 8, fontWeight: 400 }}>
                ({units.length} unit{units.length !== 1 ? 's' : ''})
              </span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, color: '#e0e0e0' }}>
              <thead>
                <tr style={{
                  color: '#aaaaaa',
                  borderBottom: '1px solid #3a3a3a',
                  background: '#1a1a1a',
                }}>
                  <th style={thStyle}>Unit</th>
                  <th style={thStyle}>Laser Weapons</th>
                  <th style={{ ...thStyle, width: 120 }}>Laser Code</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit, idx) => {
                  const weapons = getLaserWeapons(unit);
                  const changed = isChanged(unit.unitId);
                  const isLead = idx === 0;

                  return (
                    <tr key={unit.unitId} style={{ borderBottom: '1px solid #262626' }}>
                      <td style={tdStyle}>
                        <span style={{ color: '#cccccc' }}>{unit.name}</span>
                        {isLead && (
                          <span style={{
                            marginLeft: 6,
                            fontSize: 11,
                            color: '#4a8fd4',
                            border: '1px solid #4a4a4a',
                            borderRadius: 3,
                            padding: '0 4px',
                          }}>
                            LEAD
                          </span>
                        )}
                        <div style={{ color: '#aaaaaa', fontSize: 12 }}>{unit.type}</div>
                      </td>
                      <td style={tdStyle}>
                        {weapons.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {weapons.map((w, i) => (
                              <span key={i} style={weaponTagStyle}>{w}</span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: '#4a4a4a', fontSize: 12 }}>None loaded</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          min={1111}
                          max={8888}
                          value={unit.laserCode ?? ''}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= 1111 && val <= 8888) {
                              handleLaserCodeChange(unit.unitId, val, isLead);
                            }
                          }}
                          style={{
                            ...monoInputStyle,
                            width: 70,
                            ...(changed ? { borderLeft: '3px solid #3fb950' } : {}),
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  verticalAlign: 'top',
};

const monoInputStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#e0e0e0',
  fontFamily: "'B612 Mono', monospace",
  fontSize: 14,
  padding: '4px 6px',
};

const sopChipStyle: React.CSSProperties = {
  background: 'rgba(210, 153, 34, 0.08)',
  border: '1px solid rgba(210, 153, 34, 0.4)',
  borderRadius: 3,
  color: '#d29922',
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 6px',
  fontFamily: 'inherit',
  letterSpacing: 0.5,
  whiteSpace: 'nowrap',
};

const weaponTagStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '1px 6px',
  fontSize: 12,
  color: '#cccccc',
  fontFamily: "'B612 Mono', monospace",
};
