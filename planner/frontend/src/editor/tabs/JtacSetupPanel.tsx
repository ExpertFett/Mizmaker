/**
 * JTAC Auto-Setup panel — designate ground groups as JTACs with
 * proper naming, laser codes, and frequencies.
 *
 * DCS autolase scripts (like JTAC Autolase) key off group names
 * containing "JTAC". This panel lets users pick ground groups,
 * auto-rename them with JTAC conventions, and assign laser codes.
 */

import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

/* ------------------------------------------------------------------ */
/* JTAC naming presets                                                 */
/* ------------------------------------------------------------------ */

const JTAC_CALLSIGNS = [
  'Axe', 'Hammer', 'Anvil', 'Warrior', 'Reaper',
  'Viper', 'Spartan', 'Raider', 'Warhawk', 'Talon',
  'Dagger', 'Sabre', 'Phantom', 'Striker', 'Outlaw',
];

const DEFAULT_LASER_CODES = [1688, 1687, 1686, 1685, 1684, 1683, 1682, 1681];
const DEFAULT_FREQ_MHZ = [251.0, 253.0, 255.0, 257.0, 259.0, 261.0, 263.0, 265.0];

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '7px 10px', borderRadius: 4, marginBottom: 3,
  fontSize: 12, background: 'rgba(74, 143, 212, 0.04)',
  border: '1px solid #8c9ba2',
};

const inputSmall: React.CSSProperties = {
  width: 60, background: '#6e7c83', border: '1px solid #4a5258',
  borderRadius: 3, color: '#1a1f25', fontSize: 11, padding: '3px 6px',
  fontFamily: 'inherit', textAlign: 'center',
};

const inputName: React.CSSProperties = {
  width: 140, background: '#6e7c83', border: '1px solid #4a5258',
  borderRadius: 3, color: '#1a1f25', fontSize: 12, padding: '4px 8px',
  fontFamily: 'inherit', fontWeight: 600,
};

const btnSmall: React.CSSProperties = {
  background: '#4a5258', border: '1px solid #4a5258', borderRadius: 4,
  color: '#d49a30', cursor: 'pointer', fontSize: 11, fontWeight: 600,
  padding: '4px 10px', fontFamily: 'inherit',
};

const btnActive: React.CSSProperties = {
  ...btnSmall,
  background: 'rgba(63, 185, 80, 0.15)', border: '1px solid rgba(63, 185, 80, 0.3)',
  color: '#3fb950',
};

const btnApply: React.CSSProperties = {
  background: 'rgba(63, 185, 80, 0.15)', border: '1px solid rgba(63, 185, 80, 0.3)',
  borderRadius: 4, color: '#3fb950', fontSize: 13, padding: '8px 20px',
  cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10, padding: '2px 6px', borderRadius: 3,
  fontWeight: 600, flexShrink: 0,
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface JtacConfig {
  groupId: number;
  newGroupName: string;
  laserCode: number;
  freqMHz: number;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function JtacSetupPanel() {
  const groups = useMissionStore((s) => s.groups);
  const addEdit = useEditStore((s) => s.addEdit);

  // Only show ground vehicle groups (the typical JTAC host)
  const groundGroups = useMemo(() =>
    groups.filter((g) => g.category === 'vehicle'),
    [groups],
  );

  const [selectedJtacs, setSelectedJtacs] = useState<Map<number, JtacConfig>>(new Map());
  const [applied, setApplied] = useState(false);
  const [coalFilter, setCoalFilter] = useState<'all' | 'blue' | 'red'>('all');

  const filteredGroups = useMemo(() => {
    if (coalFilter === 'all') return groundGroups;
    return groundGroups.filter((g) => g.coalition === coalFilter);
  }, [groundGroups, coalFilter]);

  const toggleJtac = useCallback((groupId: number) => {
    setSelectedJtacs((prev) => {
      const next = new Map(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        const idx = next.size;
        const callsign = JTAC_CALLSIGNS[idx % JTAC_CALLSIGNS.length];
        next.set(groupId, {
          groupId,
          newGroupName: `JTAC ${callsign}`,
          laserCode: DEFAULT_LASER_CODES[idx % DEFAULT_LASER_CODES.length],
          freqMHz: DEFAULT_FREQ_MHZ[idx % DEFAULT_FREQ_MHZ.length],
        });
      }
      return next;
    });
    setApplied(false);
  }, []);

  const updateConfig = useCallback((groupId: number, updates: Partial<JtacConfig>) => {
    setSelectedJtacs((prev) => {
      const next = new Map(prev);
      const existing = next.get(groupId);
      if (existing) {
        next.set(groupId, { ...existing, ...updates });
      }
      return next;
    });
    setApplied(false);
  }, []);

  const handleApply = useCallback(() => {
    for (const config of selectedJtacs.values()) {
      const group = groundGroups.find((g) => g.groupId === config.groupId);
      if (!group) continue;

      // Rename the group
      const unitNamesObj: Record<number, string> = {};
      group.units.forEach((u, i) => {
        const unitName = group.units.length > 1
          ? `${config.newGroupName}-${i + 1}`
          : config.newGroupName;
        unitNamesObj[u.unitId] = unitName;
      });

      addEdit({
        groupId: config.groupId,
        field: 'groupRename',
        value: {
          groupId: config.groupId,
          newGroupName: config.newGroupName,
          unitNames: unitNamesObj,
        },
      } as any);

      // Set laser code and frequency on first unit (the JTAC operator)
      const primaryUnit = group.units[0];
      if (primaryUnit) {
        addEdit({
          unitId: primaryUnit.unitId,
          field: 'laserCode',
          value: config.laserCode,
        });
        addEdit({
          unitId: primaryUnit.unitId,
          field: 'radioFrequency',
          value: config.freqMHz * 1e6,
        });
        // Set to Player skill for Combined Arms JTAC control
        addEdit({
          unitId: primaryUnit.unitId,
          field: 'skill',
          value: 'Player',
        });
      }

      // Make all units in JTAC group invisible and immortal
      addEdit({
        groupId: config.groupId,
        field: 'groupWrappedActions',
        value: [
          { id: 'SetInvisible', value: true },
          { id: 'SetImmortal', value: true },
        ],
      } as any);
    }
    setApplied(true);
  }, [selectedJtacs, groundGroups, addEdit]);

  if (groundGroups.length === 0) {
    return (
      <div style={{ color: '#3a4248', fontSize: 12, padding: '8px 0' }}>
        No ground vehicle groups found in the mission.
      </div>
    );
  }

  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#3a4248' }}>
        Select ground groups to designate as JTACs. They'll be renamed with "JTAC" prefix
        (required for autolase scripts), assigned laser codes, frequencies, set as
        Combined Arms player slots, and made invisible and invincible.
      </p>

      {/* Coalition filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['all', 'blue', 'red'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setCoalFilter(f)}
            style={{
              ...btnSmall,
              ...(coalFilter === f ? { background: 'rgba(74, 143, 212, 0.15)', color: '#1a1f25' } : {}),
            }}
          >
            {f === 'all' ? 'All' : f.toUpperCase()}
          </button>
        ))}
        <span style={{ fontSize: 11, color: '#3a4248', marginLeft: 8, alignSelf: 'center' }}>
          {filteredGroups.length} groups / {selectedJtacs.size} selected as JTAC
        </span>
      </div>

      {/* Group list */}
      <div style={{ maxHeight: 400, overflow: 'auto', marginBottom: 12 }}>
        {filteredGroups.map((group) => {
          const config = selectedJtacs.get(group.groupId);
          const isSelected = !!config;
          const coalColor = group.coalition === 'blue' ? '#d49a30' : group.coalition === 'red' ? '#d95050' : '#8a8a6a';

          return (
            <div key={group.groupId} style={{
              ...rowStyle,
              borderColor: isSelected ? '#3fb95030' : '#8c9ba2',
              background: isSelected ? 'rgba(63, 185, 80, 0.04)' : 'rgba(74, 143, 212, 0.04)',
            }}>
              {/* Coalition badge */}
              <span style={{
                ...badgeStyle,
                background: `${coalColor}20`,
                color: coalColor,
              }}>
                {group.coalition === 'neutrals' ? 'NEU' : group.coalition.toUpperCase()}
              </span>

              {/* Group name / new name */}
              {isSelected ? (
                <input
                  value={config.newGroupName}
                  onChange={(e) => updateConfig(group.groupId, { newGroupName: e.target.value })}
                  style={inputName}
                />
              ) : (
                <span style={{ color: '#1a1f25', minWidth: 140, fontWeight: 500 }}>
                  {group.groupName}
                </span>
              )}

              {/* Unit info */}
              <span style={{ color: '#3a4248', fontSize: 11 }}>
                {group.units.length}x {group.units[0]?.type || '?'}
              </span>

              {/* JTAC toggle */}
              <button
                onClick={() => toggleJtac(group.groupId)}
                style={isSelected ? btnActive : btnSmall}
              >
                {isSelected ? 'JTAC' : '+ JTAC'}
              </button>

              {/* Laser & freq (when selected) */}
              {isSelected && config && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                  <span style={{ fontSize: 10, color: '#3a4248' }}>Laser:</span>
                  <input
                    type="number"
                    value={config.laserCode}
                    onChange={(e) => updateConfig(group.groupId, { laserCode: parseInt(e.target.value) || 1688 })}
                    style={{ ...inputSmall, width: 50 }}
                    min={1111}
                    max={1788}
                  />
                  <span style={{ fontSize: 10, color: '#3a4248', marginLeft: 4 }}>Freq:</span>
                  <input
                    type="number"
                    value={config.freqMHz}
                    onChange={(e) => updateConfig(group.groupId, { freqMHz: parseFloat(e.target.value) || 251 })}
                    style={{ ...inputSmall, width: 55 }}
                    step={0.5}
                  />
                  <span style={{ fontSize: 10, color: '#4a5258' }}>MHz</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Apply */}
      {selectedJtacs.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleApply}
            disabled={applied}
            style={{
              ...btnApply,
              opacity: applied ? 0.6 : 1,
              cursor: applied ? 'default' : 'pointer',
            }}
          >
            {applied ? 'JTAC Changes Staged' : `Apply ${selectedJtacs.size} JTAC Designation${selectedJtacs.size > 1 ? 's' : ''}`}
          </button>
          {applied && (
            <span style={{ fontSize: 12, color: '#3fb950' }}>
              Groups renamed, laser codes set, CA slots enabled, invisible + invincible
            </span>
          )}
        </div>
      )}
    </div>
  );
}
