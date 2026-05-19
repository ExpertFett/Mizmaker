/**
 * Battlefield Commanders tab — Combined Arms slots, JTAC assignment,
 * and ground/naval force overview.
 *
 * Lets users:
 * - Toggle ground/ship units to "Player" skill for Combined Arms control
 * - Designate JTAC units with frequency and laser code
 * - View ground order of battle by coalition
 */

import { useState, useMemo, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

/* ------------------------------------------------------------------ */
/* Known JTAC-capable unit types                                       */
/* ------------------------------------------------------------------ */

const JTAC_CAPABLE_TYPES = new Set([
  'Hummer', 'Soldier M4', 'Infantry AK', 'JTAC',
  'BRDM-2', 'HMMWV', 'M-1 Abrams', 'Stryker',
  'LAV-25', 'M-2 Bradley', 'AAV7', 'TPz Fuchs',
  'Warrior', 'Marder',
]);

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #4a4a4a', borderRadius: 6,
  padding: 14, marginBottom: 12,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, marginBottom: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '7px 10px', borderRadius: 4, marginBottom: 3,
  fontSize: 12, background: 'rgba(74, 143, 212, 0.04)',
  border: '1px solid #222222',
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10, padding: '2px 6px', borderRadius: 3,
  fontWeight: 600, flexShrink: 0,
};

const btnSmall: React.CSSProperties = {
  background: '#3a3a3a', border: '1px solid #3a3a3a', borderRadius: 4,
  color: '#4a8fd4', cursor: 'pointer', fontSize: 11, fontWeight: 600,
  padding: '4px 10px', fontFamily: 'inherit',
};

const btnActive: React.CSSProperties = {
  ...btnSmall,
  background: 'rgba(63, 185, 80, 0.15)', border: '1px solid rgba(63, 185, 80, 0.3)',
  color: '#3fb950',
};

const inputSmall: React.CSSProperties = {
  width: 70, background: '#0a1218', border: '1px solid #3a3a3a',
  borderRadius: 3, color: '#e0e0e0', fontSize: 11, padding: '3px 6px',
  fontFamily: 'inherit', textAlign: 'center',
};

const btnApply: React.CSSProperties = {
  background: 'rgba(63, 185, 80, 0.15)', border: '1px solid rgba(63, 185, 80, 0.3)',
  borderRadius: 4, color: '#3fb950', fontSize: 13, padding: '8px 20px',
  cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function BattlefieldCommandersTab() {
  const groups = useMissionStore((s) => s.groups);
  const addEdit = useEditStore((s) => s.addEdit);

  // Filter to ground and ship groups
  const groundGroups = useMemo(() =>
    groups.filter((g) => g.category === 'vehicle' || g.category === 'ship'),
    [groups],
  );

  // Track CA slot toggles: unitId → true means set to Player
  const [caSlots, setCaSlots] = useState<Map<number, boolean>>(new Map());
  // Track JTAC designations: unitId → { laserCode, frequency }
  const [jtacDesignations, setJtacDesignations] = useState<Map<number, { laserCode: number; frequency: number }>>(new Map());
  const [applied, setApplied] = useState(false);

  // Group by coalition
  const byCoalition = useMemo(() => {
    const result: Record<string, typeof groundGroups> = { blue: [], red: [], neutrals: [] };
    for (const g of groundGroups) {
      const coal = g.coalition || 'neutrals';
      if (!result[coal]) result[coal] = [];
      result[coal].push(g);
    }
    return result;
  }, [groundGroups]);

  const toggleCaSlot = useCallback((unitId: number, currentSkill: string) => {
    setCaSlots((prev) => {
      const next = new Map(prev);
      const isCurrentlyPlayer = currentSkill === 'Player' || currentSkill === 'Client';
      const isToggled = prev.get(unitId);

      if (isToggled !== undefined) {
        next.delete(unitId); // Undo toggle
      } else {
        next.set(unitId, !isCurrentlyPlayer); // Toggle opposite of current
      }
      return next;
    });
    setApplied(false);
  }, []);

  const toggleJtac = useCallback((unitId: number) => {
    setJtacDesignations((prev) => {
      const next = new Map(prev);
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.set(unitId, { laserCode: 1688, frequency: 251000000 });
      }
      return next;
    });
    setApplied(false);
  }, []);

  const updateJtacField = useCallback((unitId: number, field: 'laserCode' | 'frequency', val: number) => {
    setJtacDesignations((prev) => {
      const next = new Map(prev);
      const existing = next.get(unitId) || { laserCode: 1688, frequency: 251000000 };
      next.set(unitId, { ...existing, [field]: val });
      return next;
    });
    setApplied(false);
  }, []);

  const hasChanges = caSlots.size > 0 || jtacDesignations.size > 0;

  const handleApply = useCallback(() => {
    // Apply CA slot changes as skill edits
    for (const [unitId, makePlayer] of caSlots.entries()) {
      addEdit({
        unitId,
        field: 'skill',
        value: makePlayer ? 'Player' : 'Average',
      });
    }

    // Apply JTAC designations as laser code + frequency edits
    for (const [unitId, config] of jtacDesignations.entries()) {
      addEdit({
        unitId,
        field: 'laserCode',
        value: config.laserCode,
      });
      addEdit({
        unitId,
        field: 'radioFrequency',
        value: config.frequency,
      });
      // Also set skill to Player so the JTAC is controllable
      addEdit({
        unitId,
        field: 'skill',
        value: 'Player',
      });
    }

    setApplied(true);
  }, [caSlots, jtacDesignations, addEdit]);

  const handleReset = useCallback(() => {
    setCaSlots(new Map());
    setJtacDesignations(new Map());
    setApplied(false);
  }, []);

  const coalColors: Record<string, string> = {
    blue: '#4a8fd4', red: '#d95050', neutrals: '#8a8a6a',
  };

  return (
    <div style={{ maxWidth: 850 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
          Battlefield Commanders
        </h2>
        {hasChanges && !applied && (
          <button onClick={handleReset} style={{
            background: 'transparent', border: '1px solid #3a3a3a', borderRadius: 4,
            color: '#aaaaaa', cursor: 'pointer', fontSize: 12,
            padding: '5px 12px', fontFamily: 'inherit',
          }}>
            Reset
          </button>
        )}
      </div>
      <p style={{ margin: '0 0 6px', fontSize: 12, color: '#aaaaaa' }}>
        Set up Combined Arms player slots and JTAC designations for ground and naval units.
      </p>
      <p style={{ margin: '0 0 14px', fontSize: 11, color: '#4a4a4a' }}>
        Combined Arms slots let players control ground units in-game. JTAC units provide laser designation and close air support coordination.
      </p>

      {groundGroups.length === 0 ? (
        <div style={{
          padding: '24px 16px', background: 'rgba(74, 143, 212, 0.04)',
          borderRadius: 6, border: '1px solid #4a4a4a', textAlign: 'center',
          color: '#aaaaaa', fontSize: 13,
        }}>
          No ground or naval groups found. Upload a mission with vehicle or ship units.
        </div>
      ) : (
        <>
          {(['blue', 'red', 'neutrals'] as const).map((coal) => {
            const coalGroups = byCoalition[coal] || [];
            if (coalGroups.length === 0) return null;
            const color = coalColors[coal];

            return (
              <div key={coal} style={cardStyle}>
                <div style={{ ...sectionLabel, color, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                  {coal === 'neutrals' ? 'NEUTRAL' : coal.toUpperCase()} FORCES
                  <span style={{ fontSize: 11, fontWeight: 400, color: '#aaaaaa', marginLeft: 4 }}>
                    {coalGroups.length} group{coalGroups.length !== 1 ? 's' : ''} / {coalGroups.reduce((s, g) => s + g.units.length, 0)} units
                  </span>
                </div>

                {coalGroups.map((group) => (
                  <div key={group.groupId} style={{ marginBottom: 8 }}>
                    {/* Group header */}
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: '#bbbbbb',
                      padding: '4px 10px', marginBottom: 2,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span>{group.groupName}</span>
                      <span style={{
                        ...badgeStyle,
                        background: group.category === 'ship' ? 'rgba(74, 143, 212, 0.15)' : 'rgba(138, 138, 106, 0.15)',
                        color: group.category === 'ship' ? '#4a8fd4' : '#8a8a6a',
                      }}>
                        {group.category === 'ship' ? 'NAVAL' : 'GROUND'}
                      </span>
                      {group.task && (
                        <span style={{ fontSize: 10, color: '#4a4a4a' }}>
                          Task: {group.task}
                        </span>
                      )}
                    </div>

                    {/* Unit rows */}
                    {group.units.map((unit) => {
                      const isPlayer = unit.skill === 'Player' || unit.skill === 'Client';
                      const caToggle = caSlots.get(unit.unitId);
                      const willBePlayer = caToggle !== undefined ? caToggle : isPlayer;
                      const caChanged = caToggle !== undefined;

                      const jtacConfig = jtacDesignations.get(unit.unitId);
                      const isJtacCapable = JTAC_CAPABLE_TYPES.has(unit.type) || unit.type.toLowerCase().includes('jtac');

                      return (
                        <div key={unit.unitId} style={{
                          ...rowStyle,
                          borderColor: caChanged || jtacConfig ? '#4a8fd430' : '#222222',
                          background: caChanged || jtacConfig ? 'rgba(74, 143, 212, 0.06)' : 'rgba(74, 143, 212, 0.04)',
                        }}>
                          {/* Unit info */}
                          <span style={{ color: '#e0e0e0', minWidth: 140, fontWeight: 500 }}>
                            {unit.name}
                          </span>
                          <span style={{ color: '#aaaaaa', minWidth: 120, fontSize: 11 }}>
                            {unit.type}
                          </span>

                          {/* Current skill badge */}
                          <span style={{
                            ...badgeStyle,
                            background: willBePlayer ? 'rgba(63, 185, 80, 0.15)' : 'rgba(90, 122, 138, 0.15)',
                            color: willBePlayer ? '#3fb950' : '#aaaaaa',
                          }}>
                            {willBePlayer ? 'PLAYER' : unit.skill}
                          </span>

                          {/* CA slot toggle */}
                          <button
                            onClick={() => toggleCaSlot(unit.unitId, unit.skill)}
                            style={willBePlayer && caChanged ? btnActive : btnSmall}
                            title={willBePlayer ? 'Remove Combined Arms slot' : 'Make Combined Arms controllable'}
                          >
                            {willBePlayer ? (caChanged ? 'CA Slot +' : 'CA Slot') : '+ CA Slot'}
                          </button>

                          {/* JTAC designation */}
                          {(isJtacCapable || jtacConfig) && (
                            <>
                              <button
                                onClick={() => toggleJtac(unit.unitId)}
                                style={jtacConfig ? btnActive : btnSmall}
                                title="Designate as JTAC"
                              >
                                {jtacConfig ? 'JTAC' : '+ JTAC'}
                              </button>

                              {jtacConfig && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 10, color: '#aaaaaa' }}>Laser:</span>
                                  <input
                                    type="number"
                                    value={jtacConfig.laserCode}
                                    onChange={(e) => updateJtacField(unit.unitId, 'laserCode', parseInt(e.target.value) || 1688)}
                                    style={{ ...inputSmall, width: 55 }}
                                    min={1111}
                                    max={1788}
                                  />
                                  <span style={{ fontSize: 10, color: '#aaaaaa', marginLeft: 4 }}>Freq:</span>
                                  <input
                                    type="number"
                                    value={jtacConfig.frequency / 1e6}
                                    onChange={(e) => updateJtacField(unit.unitId, 'frequency', (parseFloat(e.target.value) || 251) * 1e6)}
                                    style={{ ...inputSmall, width: 65 }}
                                    step={0.025}
                                  />
                                  <span style={{ fontSize: 10, color: '#4a4a4a' }}>MHz</span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}

          {/* Apply bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginTop: 14,
            padding: '10px 0', borderTop: '1px solid #3a3a3a',
          }}>
            <button
              onClick={handleApply}
              disabled={!hasChanges}
              style={{
                ...btnApply,
                opacity: !hasChanges ? 0.4 : applied ? 0.6 : 1,
                cursor: !hasChanges ? 'not-allowed' : applied ? 'default' : 'pointer',
              }}
            >
              {applied ? 'Changes Staged' : 'Stage Commander Changes'}
            </button>
            {applied && (
              <span style={{ fontSize: 12, color: '#3fb950' }}>
                Changes will be applied when you download the .miz
              </span>
            )}
            {hasChanges && !applied && (
              <span style={{ fontSize: 12, color: '#d29922' }}>
                {caSlots.size + jtacDesignations.size} edit(s) pending
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
