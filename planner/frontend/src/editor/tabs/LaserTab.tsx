import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { ClientUnit } from '../../types/mission';

export function LaserTab() {
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const laserClsids = useMissionStore((s) => s.laserClsids);
  const addEdit = useEditStore((s) => s.addEdit);

  // Snapshot original laser codes on mount
  const originals = useRef<Map<number, number | null>>(new Map());
  useEffect(() => {
    const map = new Map<number, number | null>();
    for (const u of clientUnits) {
      map.set(u.unitId, u.laserCode);
    }
    originals.current = map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const laserClsidSet = useMemo(() => new Set(laserClsids), [laserClsids]);

  // Match laser-guided weapons by CLSID set OR by weapon name patterns
  const LASER_NAME_PATTERNS = /GBU[-\s]?1[0246]|GBU[-\s]?24|GBU[-\s]?27|Paveway|KAB.*L|LJDAM/i;

  const hasLaserWeapon = useCallback((u: ClientUnit): boolean => {
    return u.pylons.some((p) =>
      laserClsidSet.has(p.clsid) ||
      LASER_NAME_PATTERNS.test(p.name) ||
      LASER_NAME_PATTERNS.test(p.shortName)
    );
  }, [laserClsidSet]);

  // Filter to units that have laserCode or laser-guided weapons
  const laserUnits = useMemo(() => {
    return clientUnits.filter((u) => {
      if (u.laserCode !== null) return true;
      return hasLaserWeapon(u);
    });
  }, [clientUnits, hasLaserWeapon]);

  // Group by groupName, preserving order
  const grouped = useMemo(() => {
    const map = new Map<string, { coalition: string; units: ClientUnit[] }>();
    for (const u of laserUnits) {
      let entry = map.get(u.groupName);
      if (!entry) {
        entry = { coalition: u.coalition, units: [] };
        map.set(u.groupName, entry);
      }
      entry.units.push(u);
    }
    return map;
  }, [laserUnits]);

  const isChanged = useCallback((unitId: number): boolean => {
    const orig = originals.current.get(unitId);
    const unit = clientUnits.find((u) => u.unitId === unitId);
    if (!unit) return false;
    return orig !== unit.laserCode;
  }, [clientUnits]);

  const getLaserWeapons = useCallback((unit: ClientUnit): string[] => {
    return unit.pylons
      .filter((p) => laserClsidSet.has(p.clsid) || LASER_NAME_PATTERNS.test(p.name) || LASER_NAME_PATTERNS.test(p.shortName))
      .map((p) => p.shortName);
  }, [laserClsidSet]);

  const handleLaserCodeChange = useCallback((unitId: number, code: number, autoIncrement: boolean) => {
    addEdit({ unitId, field: 'laserCode', value: code });

    const { clientUnits: units } = useMissionStore.getState();
    const unit = units.find((u) => u.unitId === unitId);
    if (!unit) return;

    // Find the group and determine if this is the lead (index 0)
    const groupUnits = units.filter((u) => u.groupName === unit.groupName);
    const isLead = autoIncrement && groupUnits.length > 0 && groupUnits[0].unitId === unitId;

    if (isLead) {
      // Auto-increment wingmen
      const updatedUnits = units.map((u) => {
        if (u.groupName !== unit.groupName) return u;
        const idx = groupUnits.findIndex((g) => g.unitId === u.unitId);
        const newCode = code + idx;
        if (idx > 0) {
          addEdit({ unitId: u.unitId, field: 'laserCode', value: newCode });
        }
        return { ...u, laserCode: idx === 0 ? code : newCode };
      });
      useMissionStore.setState({ clientUnits: updatedUnits });
    } else {
      const updated = units.map((u) => {
        if (u.unitId !== unitId) return u;
        return { ...u, laserCode: code };
      });
      useMissionStore.setState({ clientUnits: updated });
    }
  }, [addEdit]);

  if (laserUnits.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 15, padding: 20 }}>
        No client units with laser-guided weapons or laser codes found in this mission.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
          Laser Code Editor
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#5a7a8a' }}>
          Edit laser codes for units with laser-guided weapons. Changing the lead unit auto-increments wingmen codes.
        </p>
      </div>

      {Array.from(grouped.entries()).map(([groupName, { coalition, units }]) => {
        const coalitionColor = coalition === 'blue' ? '#4a8fd4' : '#d95050';
        return (
          <div key={groupName} style={{ marginBottom: 20 }}>
            {/* Group header */}
            <div style={{
              padding: '8px 10px',
              fontSize: 13,
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

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, color: '#ccdae8' }}>
              <thead>
                <tr style={{
                  color: '#5a7a8a',
                  borderBottom: '1px solid #1a2a3a',
                  background: '#080f1c',
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
                    <tr key={unit.unitId} style={{ borderBottom: '1px solid #0f1a28' }}>
                      <td style={tdStyle}>
                        <span style={{ color: '#8fa8c0' }}>{unit.name}</span>
                        {isLead && (
                          <span style={{
                            marginLeft: 6,
                            fontSize: 11,
                            color: '#4a8fd4',
                            border: '1px solid #1a3a5a',
                            borderRadius: 3,
                            padding: '0 4px',
                          }}>
                            LEAD
                          </span>
                        )}
                        <div style={{ color: '#5a7a8a', fontSize: 12 }}>{unit.type}</div>
                      </td>
                      <td style={tdStyle}>
                        {weapons.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {weapons.map((w, i) => (
                              <span key={i} style={weaponTagStyle}>{w}</span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: '#3a5a6a', fontSize: 12 }}>None loaded</span>
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
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontFamily: 'monospace',
  fontSize: 14,
  padding: '4px 6px',
};

const weaponTagStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  padding: '1px 6px',
  fontSize: 12,
  color: '#8fa8c0',
  fontFamily: 'monospace',
};
