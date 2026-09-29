import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { GroupRenamerData } from '../../types/mission';
import { applyFrameworkTriggers, applyAegisSetupTriggers, AEGIS_BUNDLE } from './frameworkTriggers';
import { AEGIS_SYSTEMS, EWR_TYPES, AEGIS_SEARCH_RADAR_TYPES } from '../../data/airDefense';
import {
  AEGIS_OPTIONS, AEGIS_PRESETS, DEFAULT_SCRIPT_OPTIONS, buildAegisSetupLua, changedOptions,
  presetValues, validateOptions,
  type AegisOptionDef, type AegisOptionValue, type AegisPresetId, type AegisScriptOptions,
} from './aegisConfig';

/**
 * Deterministic pseudo-random facing in [0, 2π) keyed off unitId. Using a
 * stable hash instead of Math.random() means re-clicking Apply re-emits the
 * SAME heading for each unit, so it doesn't silently re-randomize facings the
 * planner already reviewed. (Classic fract-sin hash — well distributed.)
 */
function stableHeading(unitId: number): number {
  const x = Math.sin(unitId * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * Math.PI * 2;
}

/* ------------------------------------------------------------------ */
/* AEGIS system identification — from the shared air-defense DB.       */
/* Values mirror AEGIS.SYSTEM_DB in the bundled engine (see JSON).     */
/* ------------------------------------------------------------------ */

type AegisSystemCode = string;
type AegisCategory = 'AREA' | 'SHORAD' | 'PD';
type AegisRole = 'SAM' | 'EW' | 'PD' | 'PWR' | 'CMD';

interface SystemEntry {
  code: AegisSystemCode;
  trackRadars: string[];
  category: AegisCategory;
  wez: number;
  nez: number;
  displayName: string;
}

const SYSTEM_DB: SystemEntry[] = AEGIS_SYSTEMS.map((s) => ({
  code: s.aegis.code,
  trackRadars: s.aegis.trackRadars,
  category: s.aegis.cat,
  wez: s.aegis.wez,
  nez: s.aegis.nez,
  displayName: s.nato,
}));

const SEARCH_RADAR_TYPES = AEGIS_SEARCH_RADAR_TYPES;

/** A PD-class system only becomes a PD- node when an area SAM or EW radar on
 *  the same side sits within the engine's PD association range. A PD with no
 *  parent at startup is logged "NO PARENT" and never joins a sector, so a lone
 *  SA-15 / Shilka is emitted as an autonomous SAM- instead. */
const PD_PARENT_RANGE_NM = 5;

const SECTOR_COLORS: Record<string, string> = {
  NORTH: '#4a8fd4', SOUTH: '#d95050', EAST: '#d29922', WEST: '#3fb950', CENTER: '#c090d0',
};

const ROLE_COLORS: Record<AegisRole, string> = {
  SAM: '#d95050', EW: '#4a8fd4', PD: '#d29922', PWR: '#c090d0', CMD: '#3fb950',
};

const ROLE_DESCRIPTIONS: Record<AegisRole, string> = {
  SAM: 'Surface-to-Air Missile site',
  EW: 'Early Warning Radar',
  PD: 'Point Defense (protects a SAM)',
  PWR: 'Power Source (links to a SAM)',
  CMD: 'Command Center (sector C2)',
};

/* ------------------------------------------------------------------ */
/* DCS unit type → AEGIS system identification                         */
/* ------------------------------------------------------------------ */

interface AegisMatch {
  system: SystemEntry | null;
  role: AegisRole;
  isEwr: boolean;
}

function identifyGroup(unitTypes: string[]): AegisMatch | null {
  for (const entry of SYSTEM_DB) {
    for (const t of unitTypes) {
      if (entry.trackRadars.some((tr) => t === tr || t.includes(tr))) {
        // Provisional — generateAssignments demotes PD→SAM when no parent is near.
        const role: AegisRole = entry.category === 'PD' ? 'PD' : 'SAM';
        return { system: entry, role, isEwr: false };
      }
    }
  }
  for (const t of unitTypes) {
    for (const ewr of EWR_TYPES) {
      if (t === ewr || t.includes(ewr)) {
        return { system: null, role: 'EW', isEwr: true };
      }
    }
    for (const sr of SEARCH_RADAR_TYPES) {
      if (t === sr || t.includes(sr)) {
        return { system: null, role: 'EW', isEwr: true };
      }
    }
  }
  return null;
}

function assignSector(lat: number, lon: number, centerLat: number, centerLon: number): string {
  const dLat = lat - centerLat;
  const dLon = lon - centerLon;
  if (Math.abs(dLat) > Math.abs(dLon)) {
    return dLat > 0 ? 'NORTH' : 'SOUTH';
  } else {
    return dLon > 0 ? 'EAST' : 'WEST';
  }
}

/* ------------------------------------------------------------------ */
/* Assignment data structures                                          */
/* ------------------------------------------------------------------ */

interface AegisAssignment {
  groupId: number;
  originalName: string;
  coalition: string;
  role: AegisRole;
  systemCode: AegisSystemCode | null;
  systemDisplayName: string;
  sector: string;
  sectorIndex: number;
  wez: number;
  nez: number;
  newGroupName: string;
  zoneOverride: string;
  zoneRange: number | null;
  activationRange: number | null;
  /** EW only: -DET{nm} detection cap */
  detRange: number | null;
  linkedSamName: string;
  units: { unitId: number; name: string; type: string }[];
  unitCount: number;
  lat: number;
  lon: number;
}

function buildAegisName(a: AegisAssignment): string {
  switch (a.role) {
    case 'EW': {
      let name = `EW-${a.sector}${a.sectorIndex > 1 ? `-${a.sectorIndex}` : ''}`;
      if (a.detRange != null && a.detRange > 0) name += `-DET${a.detRange}`;
      return name;
    }
    case 'SAM': {
      let name = `SAM-${a.systemCode}-${a.sector}`;
      if (a.sectorIndex > 1) name += `-${a.sectorIndex}`;
      if (a.zoneOverride && a.zoneRange != null) name += `-${a.zoneOverride}${a.zoneRange}`;
      if (a.activationRange != null) name += `-ACT${a.activationRange}`;
      return name;
    }
    case 'PD': {
      let name = `PD-${a.systemCode}-${a.sector}`;
      if (a.sectorIndex > 1) name += `-${a.sectorIndex}`;
      return name;
    }
    case 'PWR':
      return `PWR-${a.linkedSamName || a.sector}`;
    case 'CMD':
      return `CMD-${a.sector}${a.sectorIndex > 1 ? `-${a.sectorIndex}` : ''}`;
    default:
      return a.originalName;
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AegisSetupPanel() {
  const allGroupsRenamer = useMissionStore((s) => s.allGroupsRenamer);
  const allUnits = useMissionStore((s) => s.units);
  const sessionId = useMissionStore((s) => s.sessionId);
  const addEdit = useEditStore((s) => s.addEdit);

  const [coalitionFilter, setCoalitionFilter] = useState<'all' | 'blue' | 'red'>('all');
  const [applied, setApplied] = useState(false);
  const [assignments, setAssignments] = useState<AegisAssignment[]>([]);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [unmatchedGroups, setUnmatchedGroups] = useState<GroupRenamerData[]>([]);
  const [preset, setPreset] = useState<AegisPresetId>('default');
  const [optValues, setOptValues] = useState<Record<string, AegisOptionValue>>(() => presetValues('default'));
  const [scriptOpts, setScriptOpts] = useState<AegisScriptOptions>(DEFAULT_SCRIPT_OPTIONS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [setupMsg, setSetupMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const unitPositions = useMemo(() => {
    const map = new Map<number, { lat: number; lon: number }>();
    for (const u of allUnits) {
      if (u.lat != null && u.lon != null) {
        map.set(u.unitId, { lat: u.lat, lon: u.lon });
      }
    }
    return map;
  }, [allUnits]);

  const getGroupCenter = useCallback((group: GroupRenamerData): { lat: number; lon: number } | null => {
    let sumLat = 0, sumLon = 0, count = 0;
    for (const u of group.units) {
      const pos = unitPositions.get(u.unitId);
      if (pos) { sumLat += pos.lat; sumLon += pos.lon; count++; }
    }
    if (count === 0) return null;
    return { lat: sumLat / count, lon: sumLon / count };
  }, [unitPositions]);

  const vehicleGroups = useMemo(() => {
    let groups = allGroupsRenamer.filter((g) => g.category === 'vehicle');
    if (coalitionFilter !== 'all') groups = groups.filter((g) => g.coalition === coalitionFilter);
    return groups;
  }, [allGroupsRenamer, coalitionFilter]);

  const generateAssignments = useCallback(() => {
    const matched: AegisAssignment[] = [];
    const unmatched: GroupRenamerData[] = [];
    const identified: { group: GroupRenamerData; match: AegisMatch; center: { lat: number; lon: number } }[] = [];

    for (const group of vehicleGroups) {
      const types = group.units.map((u) => u.type);
      const match = identifyGroup(types);
      const center = getGroupCenter(group);
      if (match && center) {
        identified.push({ group, match, center });
      } else if (!match) {
        unmatched.push(group);
      }
    }

    let centerLat = 0, centerLon = 0;
    if (identified.length > 0) {
      for (const item of identified) { centerLat += item.center.lat; centerLon += item.center.lon; }
      centerLat /= identified.length;
      centerLon /= identified.length;
    }

    // PD-class sites with no area SAM of their side nearby stand alone as SAM-.
    const nm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
      const dLat = (b.lat - a.lat) * 60;
      const dLon = (b.lon - a.lon) * 60 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
      return Math.hypot(dLat, dLon);
    };
    // Engine (_AutoAssociatePDs) accepts an AREA SAM or an EW radar as parent.
    const parents = identified.filter((i) =>
      (i.match.role === 'SAM' && i.match.system?.category === 'AREA') || i.match.role === 'EW');
    for (const item of identified) {
      if (item.match.role !== 'PD') continue;
      const hasParent = parents.some((p) =>
        p.group.coalition === item.group.coalition && nm(p.center, item.center) <= PD_PARENT_RANGE_NM);
      if (!hasParent) item.match = { ...item.match, role: 'SAM' };
    }

    const sectorCounters = new Map<string, number>();
    for (const { group, match, center } of identified) {
      const sector = assignSector(center.lat, center.lon, centerLat, centerLon);
      const role = match.role;
      const systemCode = match.system?.code ?? null;
      const counterKey = `${role}-${systemCode || 'EW'}-${sector}`;
      const currentCount = (sectorCounters.get(counterKey) || 0) + 1;
      sectorCounters.set(counterKey, currentCount);

      const assignment: AegisAssignment = {
        groupId: group.groupId, originalName: group.groupName, coalition: group.coalition,
        role, systemCode, systemDisplayName: match.system?.displayName || 'Early Warning Radar',
        sector, sectorIndex: currentCount, wez: match.system?.wez || 0, nez: match.system?.nez || 0,
        newGroupName: '', zoneOverride: '', zoneRange: null, activationRange: null, detRange: null, linkedSamName: '',
        units: group.units, unitCount: group.unitCount, lat: center.lat, lon: center.lon,
      };
      assignment.newGroupName = buildAegisName(assignment);
      matched.push(assignment);
    }
    setAssignments(matched);
    setUnmatchedGroups(unmatched);
    setApplied(false);
  }, [vehicleGroups, getGroupCenter]);

  // Auto-gen on first render and when filter changes
  useEffect(() => {
    if (vehicleGroups.length > 0) {
      generateAssignments();
    } else {
      setAssignments([]);
      setUnmatchedGroups([]);
    }
  }, [vehicleGroups, generateAssignments]);

  const updateSector = useCallback((groupId: number, newSector: string) => {
    setAssignments((prev) => {
      const updated = prev.map((a) => {
        if (a.groupId !== groupId) return a;
        const newA = { ...a, sector: newSector };
        newA.newGroupName = buildAegisName(newA);
        return newA;
      });
      return reindexSectors(updated);
    });
  }, []);

  const updateRole = useCallback((groupId: number, newRole: AegisRole) => {
    setAssignments((prev) => {
      const updated = prev.map((a) => {
        if (a.groupId !== groupId) return a;
        const newA = { ...a, role: newRole };
        newA.newGroupName = buildAegisName(newA);
        return newA;
      });
      return reindexSectors(updated);
    });
  }, []);

  const updateZoneOverride = useCallback((groupId: number, zoneType: string, range: number | null) => {
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.groupId !== groupId) return a;
        const newA = { ...a, zoneOverride: zoneType, zoneRange: range };
        newA.newGroupName = buildAegisName(newA);
        return newA;
      }),
    );
  }, []);

  const updateActivationRange = useCallback((groupId: number, range: number | null) => {
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.groupId !== groupId) return a;
        const newA = { ...a, activationRange: range };
        newA.newGroupName = buildAegisName(newA);
        return newA;
      }),
    );
  }, []);

  const updateDetRange = useCallback((groupId: number, range: number | null) => {
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.groupId !== groupId) return a;
        const newA = { ...a, detRange: range };
        newA.newGroupName = buildAegisName(newA);
        return newA;
      }),
    );
  }, []);

  const updateLinkedSam = useCallback((groupId: number, samName: string) => {
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.groupId !== groupId) return a;
        const newA = { ...a, linkedSamName: samName };
        newA.newGroupName = buildAegisName(newA);
        return newA;
      }),
    );
  }, []);

  const optionErrors = useMemo(() => validateOptions(optValues), [optValues]);

  /** One generated setup script per side that has at least one SAM. */
  const setups = useMemo(() => {
    const sides = (['red', 'blue'] as const).filter((side) =>
      assignments.some((a) => a.coalition === side && a.role === 'SAM'));
    return sides.map((side) => {
      const mine = assignments.filter((a) => a.coalition === side);
      return {
        side,
        lua: buildAegisSetupLua({
          side,
          groupNames: mine.map((a) => a.newGroupName),
          pdLinks: mine
            .filter((a) => a.role === 'PD' && a.linkedSamName)
            .map((a) => ({ pd: a.newGroupName, parent: a.linkedSamName })),
          values: optValues,
          script: scriptOpts,
        }),
      };
    });
  }, [assignments, optValues, scriptOpts]);

  const applyAll = useCallback(async () => {
    if (optionErrors.length > 0) {
      setSetupMsg({ tone: 'err', text: `Fix the AEGIS settings first: ${optionErrors[0]}` });
      return;
    }
    for (const a of assignments) {
      const unitNamesObj: Record<number, string> = {};
      for (let i = 0; i < a.units.length; i++) {
        const u = a.units[i];
        const shortType = u.type.replace(/\s*\([^)]*\)/g, '').trim();
        unitNamesObj[u.unitId] = `${a.newGroupName} | ${shortType}`;
      }
      addEdit({
        groupId: a.groupId,
        field: 'groupRename',
        value: { groupId: a.groupId, newGroupName: a.newGroupName, unitNames: unitNamesObj },
      } as any);
      // Late activation hides the sites until the generated setup script
      // activates them right before AEGIS starts. Without that script
      // nothing activates them (the engine never does) — see aegisConfig.ts.
      for (const u of a.units) {
        addEdit({ unitId: u.unitId, field: 'lateActivation', value: true });
        addEdit({ unitId: u.unitId, field: 'heading', value: stableHeading(u.unitId) });
      }
    }
    // v1.19.54 — wire MOOSE + AEGIS framework load triggers automatically.
    // v1.19.113: self-persist (fetch-merge-save) so the load triggers survive
    // download even if the user never opens the Triggers tab.
    // v1.19.156: ALSO write the per-side AEGIS:New/Activate setup rule — the
    // engine was loaded but never started before this.
    if (sessionId) {
      try { await applyFrameworkTriggers(sessionId, AEGIS_BUNDLE); } catch { /* non-fatal */ }
      try {
        const res = await applyAegisSetupTriggers(sessionId, setups);
        if (res.blockedBy) {
          setSetupMsg({ tone: 'warn', text:
            `Renames queued, but setup NOT written: trigger "${res.blockedBy}" already starts AEGIS. ` +
            'Remove it in Triggers and re-apply, or keep your own setup (it must activate the late-activated groups).' });
        } else if (res.written.length === 0) {
          setSetupMsg({ tone: 'warn', text: 'Renames queued. No SAM sites found, so no AEGIS setup script was written.' });
        } else {
          setSetupMsg({ tone: 'ok', text: `Renames queued + ${res.written.join(', ')} written to Triggers.` });
        }
      } catch (e) {
        setSetupMsg({ tone: 'err', text: `Renames queued, but saving the setup trigger failed: ${String(e)}` });
      }
    }
    setApplied(true);
  }, [assignments, addEdit, sessionId, setups, optionErrors]);

  const roleStats = useMemo(() => {
    const stats = new Map<AegisRole, number>();
    for (const a of assignments) stats.set(a.role, (stats.get(a.role) || 0) + 1);
    return stats;
  }, [assignments]);

  const sectorStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const a of assignments) stats.set(a.sector, (stats.get(a.sector) || 0) + 1);
    return stats;
  }, [assignments]);

  const samNames = useMemo(() => {
    return assignments.filter((a) => a.role === 'SAM').map((a) => a.newGroupName);
  }, [assignments]);

  // Total vehicle groups (unfiltered) to decide if panel has anything at all
  const totalVehicleGroups = useMemo(() =>
    allGroupsRenamer.filter((g) => g.category === 'vehicle').length,
  [allGroupsRenamer]);

  if (totalVehicleGroups === 0) {
    return (
      <div style={{ color: '#aaaaaa', fontSize: 14, padding: 16 }}>
        No ground vehicle groups found in this mission.
      </div>
    );
  }

  return (
    <div>
      {/* Header — always visible so user can switch filters */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#d95050', marginBottom: 4 }}>
            AEGIS IADS Auto-Setup
          </div>
          <div style={{ fontSize: 13, color: '#aaaaaa' }}>
            Auto-renames SAM, EWR, and support groups to AEGIS-compatible naming format.
            Sectors are auto-assigned based on geographic position.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={coalitionFilter}
            onChange={(e) => { setCoalitionFilter(e.target.value as any); setApplied(false); }}
            style={selectStyle}
          >
            <option value="all">Both Sides</option>
            <option value="blue">Blue Only</option>
            <option value="red">Red Only</option>
          </select>
          <button onClick={generateAssignments} style={btnStyle}>Regenerate</button>
          <button
            onClick={applyAll}
            disabled={applied || assignments.length === 0}
            style={{
              ...btnStyle,
              background: applied ? '#1a2020' : '#2a1a1a',
              border: `1px solid ${applied ? '#5a3a3a' : '#d95050'}`,
              color: applied ? '#5a3a3a' : '#d95050',
              fontWeight: 600,
            }}
          >
            {applied ? '✓ Applied' : 'Apply'}
          </button>
        </div>
      </div>

      {vehicleGroups.length === 0 ? (
        <div style={{ color: '#aaaaaa', fontSize: 14, padding: '16px 0' }}>
          No vehicle groups for this coalition. Try a different filter above.
        </div>
      ) : (
        <>
      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 16, padding: '10px 14px',
        background: '#222222', border: '1px solid #3a3a3a', borderRadius: 4,
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ fontSize: 13, color: '#aaaaaa' }}>
          <strong style={{ color: '#e0e0e0' }}>{assignments.length}</strong> AEGIS groups identified
          {unmatchedGroups.length > 0 && (
            <span style={{ color: '#aaaaaa', marginLeft: 8 }}>({unmatchedGroups.length} unmatched)</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {Array.from(roleStats).map(([role, count]) => (
            <span key={role} style={{ fontSize: 12, color: ROLE_COLORS[role] }}>{role}: {count}</span>
          ))}
          <span style={{ color: '#3a3a3a' }}>|</span>
          {Array.from(sectorStats).map(([sector, count]) => (
            <span key={sector} style={{ fontSize: 12, color: SECTOR_COLORS[sector] || '#aaaaaa' }}>{sector}: {count}</span>
          ))}
        </div>
      </div>

      {/* AEGIS naming reference */}
      <div style={{
        marginBottom: 16, padding: '8px 14px',
        background: '#262626', border: '1px solid #3a3a3a', borderRadius: 4,
        fontSize: 12, color: '#aaaaaa', lineHeight: 1.8,
      }}>
        <strong style={{ color: '#cccccc' }}>AEGIS Format:</strong>{' '}
        <code style={{ color: '#d95050' }}>SAM-TYPE-SECTOR[-ID]</code>{' '}
        <code style={{ color: '#4a8fd4' }}>EW-SECTOR[-ID]</code>{' '}
        <code style={{ color: '#d29922' }}>PD-TYPE-SECTOR[-ID]</code>{' '}
        <code style={{ color: '#c090d0' }}>PWR-TARGET</code>{' '}
        <code style={{ color: '#3fb950' }}>CMD-SECTOR[-ID]</code>
        <br />
        <strong style={{ color: '#cccccc' }}>Suffixes:</strong>{' '}
        <code style={{ color: '#e0e0e0' }}>-NEZ30</code> / <code style={{ color: '#e0e0e0' }}>-WEZ45</code> = zone override,{' '}
        <code style={{ color: '#e0e0e0' }}>-ACT50</code> = activation range (nm),{' '}
        <code style={{ color: '#e0e0e0' }}>-DET120</code> = EW detection cap (nm)
      </div>

      {/* AEGIS settings → generated AEGIS:New(...) setup script */}
      <AegisSettings
        preset={preset}
        values={optValues}
        scriptOpts={scriptOpts}
        errors={optionErrors}
        showAdvanced={showAdvanced}
        showPreview={showPreview}
        previewLua={setups.map((x) => x.lua).join('\n')}
        onPreset={(id) => { setPreset(id); setOptValues(presetValues(id)); setApplied(false); }}
        onValue={(k, v) => { setOptValues((prev) => ({ ...prev, [k]: v })); setApplied(false); }}
        onScriptOpts={(o) => { setScriptOpts(o); setApplied(false); }}
        onToggleAdvanced={() => setShowAdvanced((x) => !x)}
        onTogglePreview={() => setShowPreview((x) => !x)}
      />

      {setupMsg && (
        <div style={{
          marginBottom: 12, padding: '8px 14px', borderRadius: 4, fontSize: 13,
          background: '#222222',
          border: `1px solid ${setupMsg.tone === 'ok' ? '#3fb950' : setupMsg.tone === 'warn' ? '#d29922' : '#d95050'}`,
          color: setupMsg.tone === 'ok' ? '#3fb950' : setupMsg.tone === 'warn' ? '#d29922' : '#d95050',
        }}>{setupMsg.text}</div>
      )}

      {/* Assignment cards */}
      {assignments.map((a) => (
        <AegisCard
          key={a.groupId}
          assignment={a}
          samNames={samNames}
          onUpdateSector={updateSector}
          onUpdateRole={updateRole}
          onUpdateZoneOverride={updateZoneOverride}
          onUpdateActivationRange={updateActivationRange}
          onUpdateDetRange={updateDetRange}
          onUpdateLinkedSam={updateLinkedSam}
        />
      ))}

      {/* Unmatched groups toggle */}
      {unmatchedGroups.length > 0 && (
        <div style={{ marginTop: 12, border: '1px solid #3a3a3a', borderRadius: 4, background: '#222222' }}>
          <div
            onClick={() => setShowUnmatched(!showUnmatched)}
            style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ color: '#aaaaaa', fontSize: 13 }}>{showUnmatched ? '\u25BC' : '\u25B6'}</span>
            <span style={{ fontSize: 13, color: '#aaaaaa' }}>
              {unmatchedGroups.length} unmatched vehicle group{unmatchedGroups.length !== 1 ? 's' : ''} (no AEGIS system detected)
            </span>
          </div>
          {showUnmatched && (
            <div style={{ padding: '4px 14px 10px', borderTop: '1px solid #3a3a3a' }}>
              {unmatchedGroups.map((g) => (
                <div key={g.groupId} style={{
                  padding: '4px 0', fontSize: 13, color: '#aaaaaa',
                  display: 'flex', gap: 10, alignItems: 'center',
                }}>
                  <span style={{
                    background: g.coalition === 'blue' ? '#4a8fd4' : '#d95050',
                    color: '#1a1a1a', fontSize: 11, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase',
                  }}>{g.coalition}</span>
                  <span style={{ color: '#cccccc' }}>{g.groupName}</span>
                  <span style={{ color: '#4a4a4a', fontSize: 12 }}>
                    {g.units.map((u) => u.type).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Apply button */}
      <div style={{
        marginTop: 20, padding: '14px',
        background: '#222222', border: '1px solid #3a3a3a', borderRadius: 4,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontSize: 13, color: '#aaaaaa' }}>
          {applied
            ? 'AEGIS names queued + setup trigger written. Download your .miz to save changes.'
            : `Ready to rename ${assignments.length} groups and write the AEGIS setup (${setups.map((x) => x.side).join(' + ') || 'no SAMs'}).`}
        </div>
        <button
          onClick={applyAll}
          disabled={applied || assignments.length === 0}
          style={{
            ...btnStyle,
            background: applied ? '#1a2020' : '#2a1a1a',
            border: `1px solid ${applied ? '#5a3a3a' : '#d95050'}`,
            color: applied ? '#5a3a3a' : '#d95050',
            fontSize: 14, padding: '8px 20px', fontWeight: 600,
          }}
        >
          {applied ? 'Applied' : 'Apply All AEGIS Names'}
        </button>
      </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card component for each AEGIS assignment                           */
/* ------------------------------------------------------------------ */

interface AegisCardProps {
  assignment: AegisAssignment;
  samNames: string[];
  onUpdateSector: (groupId: number, sector: string) => void;
  onUpdateRole: (groupId: number, role: AegisRole) => void;
  onUpdateZoneOverride: (groupId: number, zoneType: string, range: number | null) => void;
  onUpdateActivationRange: (groupId: number, range: number | null) => void;
  onUpdateDetRange: (groupId: number, range: number | null) => void;
  onUpdateLinkedSam: (groupId: number, samName: string) => void;
}

function AegisCard({
  assignment: a, samNames,
  onUpdateSector, onUpdateRole, onUpdateZoneOverride,
  onUpdateActivationRange, onUpdateDetRange, onUpdateLinkedSam,
}: AegisCardProps) {
  const [expanded, setExpanded] = useState(false);
  const borderColor = ROLE_COLORS[a.role] || '#3a3a3a';

  return (
    <div style={{ marginBottom: 8, border: '1px solid #3a3a3a', borderRadius: 4, background: '#222222' }}>
      {/* Main row */}
      <div style={{
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        flexWrap: 'wrap', borderLeft: `3px solid ${borderColor}`, cursor: 'pointer',
      }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{
          background: a.coalition === 'blue' ? '#4a8fd4' : '#d95050',
          color: '#1a1a1a', fontSize: 11, fontWeight: 700,
          padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase',
        }}>{a.coalition}</span>

        <span style={{
          color: ROLE_COLORS[a.role], fontSize: 11, fontWeight: 600,
          border: `1px solid ${ROLE_COLORS[a.role]}`, padding: '1px 6px', borderRadius: 3,
        }}>{a.role}</span>

        <span style={{
          color: SECTOR_COLORS[a.sector] || '#aaaaaa', fontSize: 11, fontWeight: 600,
          border: `1px solid ${SECTOR_COLORS[a.sector] || '#3a3a3a'}`, padding: '1px 6px', borderRadius: 3,
        }}>{a.sector}</span>

        <span style={{ fontSize: 12, color: '#cccccc', minWidth: 120 }}>{a.systemDisplayName}</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 200 }}>
          <span style={{ color: '#aaaaaa', fontSize: 13, textDecoration: 'line-through' }}>{a.originalName}</span>
          <span style={{ color: '#aaaaaa' }}>&rarr;</span>
          <span style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 600, fontFamily: "'B612 Mono', monospace" }}>{a.newGroupName}</span>
        </div>

        {a.role === 'SAM' && a.wez > 0 && (
          <span style={{ fontSize: 11, color: '#aaaaaa' }}>WEZ:{a.wez}nm NEZ:{a.nez}nm</span>
        )}
        <span style={{ color: '#aaaaaa', fontSize: 13 }}>{'\u25BC'}</span>
      </div>

      {/* Expanded options */}
      {expanded && (
        <div style={{
          padding: '10px 14px', borderTop: '1px solid #3a3a3a',
          display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Sector</label>
            <select value={a.sector} onChange={(e) => onUpdateSector(a.groupId, e.target.value)} style={selectStyle}>
              <option value="NORTH">NORTH</option>
              <option value="SOUTH">SOUTH</option>
              <option value="EAST">EAST</option>
              <option value="WEST">WEST</option>
              <option value="CENTER">CENTER</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Role</label>
            <select value={a.role} onChange={(e) => onUpdateRole(a.groupId, e.target.value as AegisRole)} style={selectStyle}>
              <option value="SAM">SAM</option>
              <option value="EW">EW</option>
              <option value="PD">PD</option>
              <option value="PWR">PWR</option>
              <option value="CMD">CMD</option>
            </select>
            <span style={{ fontSize: 11, color: '#4a4a4a' }}>{ROLE_DESCRIPTIONS[a.role]}</span>
          </div>

          {a.role === 'SAM' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>Zone Override</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <select
                  value={a.zoneOverride}
                  onChange={(e) => {
                    const zoneType = e.target.value;
                    const defaultRange = zoneType === 'NEZ' ? a.nez : zoneType === 'WEZ' ? a.wez : null;
                    onUpdateZoneOverride(a.groupId, zoneType, defaultRange);
                  }}
                  style={{ ...selectStyle, width: 70 }}
                >
                  <option value="">None</option>
                  <option value="NEZ">NEZ</option>
                  <option value="WEZ">WEZ</option>
                </select>
                {a.zoneOverride && (
                  <input
                    type="number"
                    value={a.zoneRange ?? ''}
                    onChange={(e) => onUpdateZoneOverride(a.groupId, a.zoneOverride, e.target.value ? Number(e.target.value) : null)}
                    placeholder="nm"
                    style={{ ...numInputStyle, width: 55 }}
                  />
                )}
              </div>
            </div>
          )}

          {a.role === 'SAM' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>Activation Range</label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="number"
                  value={a.activationRange ?? ''}
                  onChange={(e) => onUpdateActivationRange(a.groupId, e.target.value ? Number(e.target.value) : null)}
                  placeholder="nm"
                  style={{ ...numInputStyle, width: 55 }}
                />
                <span style={{ fontSize: 11, color: '#aaaaaa' }}>nm</span>
              </div>
            </div>
          )}

          {a.role === 'EW' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>Detection cap</label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="number"
                  value={a.detRange ?? ''}
                  onChange={(e) => onUpdateDetRange(a.groupId, e.target.value ? Number(e.target.value) : null)}
                  placeholder="none"
                  style={{ ...numInputStyle, width: 60 }}
                />
                <span style={{ fontSize: 11, color: '#aaaaaa' }}>nm</span>
              </div>
            </div>
          )}

          {(a.role === 'PD' || a.role === 'PWR') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>{a.role === 'PD' ? 'Protects SAM' : 'Powers SAM'}</label>
              <select value={a.linkedSamName} onChange={(e) => onUpdateLinkedSam(a.groupId, e.target.value)} style={selectStyle}>
                <option value="">Auto (sector-based)</option>
                {samNames.map((name) => (<option key={name} value={name}>{name}</option>))}
              </select>
            </div>
          )}

          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={labelStyle}>Units ({a.unitCount})</label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {a.units.map((u) => (
                <span key={u.unitId} style={{
                  fontSize: 11, color: '#cccccc', background: '#262626',
                  padding: '2px 6px', borderRadius: 3, border: '1px solid #3a3a3a',
                }}>{u.type}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings — preset + options that become the AEGIS:New config table  */
/* ------------------------------------------------------------------ */

interface AegisSettingsProps {
  preset: AegisPresetId;
  values: Record<string, AegisOptionValue>;
  scriptOpts: AegisScriptOptions;
  errors: string[];
  showAdvanced: boolean;
  showPreview: boolean;
  previewLua: string;
  onPreset: (id: AegisPresetId) => void;
  onValue: (key: string, v: AegisOptionValue) => void;
  onScriptOpts: (o: AegisScriptOptions) => void;
  onToggleAdvanced: () => void;
  onTogglePreview: () => void;
}

function AegisSettings(p: AegisSettingsProps) {
  const changed = changedOptions(p.values).length;
  const primary = AEGIS_OPTIONS.filter((o) => o.primary);
  const groups = Array.from(new Set(AEGIS_OPTIONS.map((o) => o.group)));
  const field = (o: AegisOptionDef) => {
    const v = p.values[o.key];
    const isChanged = v !== o.default;
    let input: React.ReactNode;
    if (o.choices) {
      input = (
        <select value={String(v)} onChange={(e) => p.onValue(o.key, e.target.value)} style={selectStyle}>
          {o.choices.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      );
    } else if (typeof o.default === 'boolean') {
      input = (
        <input type="checkbox" checked={v === true} onChange={(e) => p.onValue(o.key, e.target.checked)} />
      );
    } else {
      input = (
        <input
          type="number"
          value={typeof v === 'number' && Number.isFinite(v) ? v : ''}
          step={typeof o.default === 'number' && o.default < 1 ? 0.01 : 1}
          min={0}
          onChange={(e) => p.onValue(o.key, e.target.value === '' ? NaN : Number(e.target.value))}
          style={{ ...numInputStyle, width: 64 }}
        />
      );
    }
    return (
      <div key={o.key} title={o.help} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 }}>
        <label style={{ ...labelStyle, color: isChanged ? '#d29922' : labelStyle.color }}>
          {o.label}{o.unit ? ` (${o.unit})` : ''}
        </label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {input}
          {isChanged && <span style={{ fontSize: 11, color: '#4a4a4a' }}>default {String(o.default)}</span>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 16, border: '1px solid #3a3a3a', borderRadius: 4, background: '#222222' }}>
      <div style={{ padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>IADS behaviour</div>
        <select value={p.preset} onChange={(e) => p.onPreset(e.target.value as AegisPresetId)} style={selectStyle}>
          {(Object.keys(AEGIS_PRESETS) as AegisPresetId[]).map((id) => (
            <option key={id} value={id}>{AEGIS_PRESETS[id].label}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: '#aaaaaa', flex: 1 }}>{AEGIS_PRESETS[p.preset].help}</span>
        <span style={{ fontSize: 12, color: changed ? '#d29922' : '#4a4a4a' }}>
          {changed} setting{changed === 1 ? '' : 's'} off default
        </span>
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid #3a3a3a', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {primary.map(field)}
      </div>

      <div style={{ padding: '8px 14px', borderTop: '1px solid #3a3a3a', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={checkLabelStyle}>
          <input type="checkbox" checked={p.scriptOpts.debug}
            onChange={(e) => p.onScriptOpts({ ...p.scriptOpts, debug: e.target.checked })} />
          Debug logging
        </label>
        <label style={checkLabelStyle}
          title="The engine's F10 menu is global: BOTH coalitions can open it and read this side's IADS status.">
          <input type="checkbox" checked={p.scriptOpts.f10Menu}
            onChange={(e) => p.onScriptOpts({ ...p.scriptOpts, f10Menu: e.target.checked })} />
          F10 status menu <span style={{ color: '#d29922', fontSize: 11 }}>(visible to both sides)</span>
        </label>
        <label style={checkLabelStyle}
          title="Paints every IADS site on the F10 map for everyone. Mission-maker testing only.">
          <input type="checkbox" checked={p.scriptOpts.mapDebug}
            onChange={(e) => p.onScriptOpts({ ...p.scriptOpts, mapDebug: e.target.checked })} />
          F10 map debug markers <span style={{ color: '#d29922', fontSize: 11 }}>(reveals sites)</span>
        </label>
        <span style={{ flex: 1 }} />
        <button onClick={p.onToggleAdvanced} style={btnStyle}>{p.showAdvanced ? 'Hide advanced' : 'Advanced'}</button>
        <button onClick={p.onTogglePreview} style={btnStyle}>{p.showPreview ? 'Hide script' : 'Preview script'}</button>
      </div>

      {p.errors.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid #3a3a3a', color: '#d95050', fontSize: 12 }}>
          {p.errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}

      {p.showAdvanced && groups.map((g) => (
        <div key={g} style={{ padding: '10px 14px', borderTop: '1px solid #3a3a3a' }}>
          <div style={{ ...labelStyle, color: '#cccccc', marginBottom: 8 }}>{g}</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {AEGIS_OPTIONS.filter((o) => o.group === g && !o.primary).map(field)}
          </div>
        </div>
      ))}

      {p.showPreview && (
        <pre style={{
          margin: 0, padding: '10px 14px', borderTop: '1px solid #3a3a3a', maxHeight: 320, overflow: 'auto',
          fontSize: 12, color: '#cccccc', fontFamily: "'B612 Mono', monospace", whiteSpace: 'pre',
        }}>{p.previewLua || '-- No SAM sites identified: nothing to generate.'}</pre>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function reindexSectors(assignments: AegisAssignment[]): AegisAssignment[] {
  const counters = new Map<string, number>();
  return assignments.map((a) => {
    const key = `${a.role}-${a.systemCode || 'EW'}-${a.sector}`;
    const idx = (counters.get(key) || 0) + 1;
    counters.set(key, idx);
    const newA = { ...a, sectorIndex: idx };
    newA.newGroupName = buildAegisName(newA);
    return newA;
  });
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const btnStyle: React.CSSProperties = {
  background: '#3a3a3a', border: '1px solid #3a3a3a', borderRadius: 4,
  color: '#4a8fd4', cursor: 'pointer', fontSize: 13, padding: '6px 12px', fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  background: '#262626', border: '1px solid #3a3a3a', borderRadius: 4,
  color: '#e0e0e0', fontSize: 13, padding: '6px 8px', outline: 'none', fontFamily: 'inherit',
};

const numInputStyle: React.CSSProperties = {
  background: '#262626', border: '1px solid #3a3a3a', borderRadius: 3,
  color: '#e0e0e0', fontSize: 13, padding: '4px 6px', outline: 'none', fontFamily: 'inherit',
};

const checkLabelStyle: React.CSSProperties = {
  fontSize: 13, color: '#cccccc', display: 'flex', gap: 6, alignItems: 'center',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
};
