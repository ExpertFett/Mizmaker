import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { GroupRenamerData } from '../../types/mission';

/* ------------------------------------------------------------------ */
/* AEGIS IADS SYSTEM_DB — maps DCS unit types to AEGIS system codes   */
/* ------------------------------------------------------------------ */

type AegisSystemCode =
  | 'SA2' | 'SA3' | 'SA5' | 'SA6' | 'SA8' | 'SA10' | 'SA10B' | 'SA10C'
  | 'SA11' | 'SA12' | 'SA12G' | 'SA13' | 'SA15' | 'SA15CH' | 'SA17'
  | 'SA19' | 'SA20A' | 'SA20B' | 'SA21' | 'SA22' | 'SA23' | 'SA23G'
  | 'SA23V4' | 'SA23V4G' | 'SAMPT' | 'HAWK' | 'PATRIOT' | 'NASAMS'
  | 'GEPARD' | 'SHILKA' | 'ROLAND' | 'RAPIER';

type AegisCategory = 'AREA' | 'SHORAD' | 'PD';
type AegisRole = 'SAM' | 'EW' | 'PD' | 'PWR' | 'CMD';

interface SystemEntry {
  code: AegisSystemCode;
  trackRadar: string;
  category: AegisCategory;
  wez: number;
  nez: number;
  displayName: string;
}

const SYSTEM_DB: SystemEntry[] = [
  // Area SAMs
  { code: 'SA2',     trackRadar: 'SNR_75V',                  category: 'AREA',   wez: 22, nez: 14, displayName: 'SA-2 Guideline' },
  { code: 'SA3',     trackRadar: 'snr s-125 tr',             category: 'AREA',   wez: 15, nez: 10, displayName: 'SA-3 Goa' },
  { code: 'SA5',     trackRadar: 'RPC_5N62V',                category: 'AREA',   wez: 55, nez: 35, displayName: 'SA-5 Gammon' },
  { code: 'SA6',     trackRadar: 'Kub 1S91 str',             category: 'AREA',   wez: 15, nez: 8,  displayName: 'SA-6 Gainful' },
  { code: 'SA10',    trackRadar: 'S-300PS 40B6M tr',         category: 'AREA',   wez: 43, nez: 25, displayName: 'SA-10 Grumble' },
  { code: 'SA10B',   trackRadar: 'S-300PS 40B6MD sr',        category: 'AREA',   wez: 43, nez: 25, displayName: 'SA-10B Grumble' },
  { code: 'SA10C',   trackRadar: 'S-300PMU1 40B6M tr',       category: 'AREA',   wez: 75, nez: 40, displayName: 'SA-10C Grumble' },
  { code: 'SA11',    trackRadar: 'SA-11 Buk SR 9S18M1',      category: 'AREA',   wez: 19, nez: 12, displayName: 'SA-11 Gadfly' },
  { code: 'SA12',    trackRadar: 'S-300V 9S32 TR',           category: 'AREA',   wez: 40, nez: 25, displayName: 'SA-12 Gladiator' },
  { code: 'SA12G',   trackRadar: 'S-300VM 9S32ME tr',        category: 'AREA',   wez: 50, nez: 30, displayName: 'SA-12G Giant' },
  { code: 'SA17',    trackRadar: 'Buk-M2 9S36 Fire Dome tr', category: 'AREA',   wez: 25, nez: 15, displayName: 'SA-17 Grizzly' },
  { code: 'SA20A',   trackRadar: 'S-300PMU2 92H6E tr',       category: 'AREA',   wez: 80, nez: 45, displayName: 'SA-20A Gargoyle' },
  { code: 'SA20B',   trackRadar: 'S-400 92H6E tr',           category: 'AREA',   wez: 120, nez: 60, displayName: 'SA-20B' },
  { code: 'SA21',    trackRadar: 'SAM SA-21 tr',             category: 'AREA',   wez: 150, nez: 80, displayName: 'SA-21 Growler' },
  { code: 'SA23',    trackRadar: 'S-300VM 9S457ME sr',       category: 'AREA',   wez: 100, nez: 50, displayName: 'SA-23 Gladiator/Giant' },
  { code: 'SA23G',   trackRadar: 'S-300VM 9S15M2 sr',        category: 'AREA',   wez: 100, nez: 50, displayName: 'SA-23G' },
  { code: 'SA23V4',  trackRadar: 'S-300V4 9S32ME tr',        category: 'AREA',   wez: 200, nez: 100, displayName: 'SA-23 V4' },
  { code: 'SA23V4G', trackRadar: 'S-300V4 9S457ME sr',       category: 'AREA',   wez: 200, nez: 100, displayName: 'SA-23 V4G' },
  { code: 'SAMPT',   trackRadar: 'SAMPT Arabel tr',          category: 'AREA',   wez: 50, nez: 30, displayName: 'SAMP/T Mamba' },
  { code: 'HAWK',    trackRadar: 'Hawk tr',                  category: 'AREA',   wez: 25, nez: 15, displayName: 'MIM-23 Hawk' },
  { code: 'PATRIOT', trackRadar: 'Patriot str',              category: 'AREA',   wez: 80, nez: 40, displayName: 'MIM-104 Patriot' },
  { code: 'NASAMS',  trackRadar: 'NASAMS_Radar_MPQ64F1',     category: 'AREA',   wez: 15, nez: 8,  displayName: 'NASAMS' },
  // SHORAD
  { code: 'SA8',     trackRadar: 'Osa 9A33 ln',              category: 'SHORAD', wez: 6, nez: 3,   displayName: 'SA-8 Gecko' },
  { code: 'SA13',    trackRadar: 'Strela-10M3',              category: 'SHORAD', wez: 3, nez: 2,   displayName: 'SA-13 Gopher' },
  { code: 'SA15',    trackRadar: 'Tor 9A331',                category: 'SHORAD', wez: 7, nez: 4,   displayName: 'SA-15 Gauntlet' },
  { code: 'SA15CH',  trackRadar: 'HQ-17',                    category: 'SHORAD', wez: 7, nez: 4,   displayName: 'HQ-17 (SA-15 export)' },
  { code: 'SA22',    trackRadar: '2S6 Tunguska',             category: 'SHORAD', wez: 5, nez: 3,   displayName: 'SA-22 Greyhound' },
  { code: 'ROLAND',  trackRadar: 'Roland ADS',               category: 'SHORAD', wez: 5, nez: 3,   displayName: 'Roland' },
  { code: 'RAPIER',  trackRadar: 'rapier_fsa_blindfire_radar',category: 'SHORAD', wez: 4, nez: 2,  displayName: 'Rapier' },
  // Point Defense
  { code: 'SA19',    trackRadar: '2S6 Tunguska',             category: 'PD',     wez: 5, nez: 3,   displayName: 'SA-19 Grison (PD)' },
  { code: 'GEPARD',  trackRadar: 'Gepard',                   category: 'PD',     wez: 3, nez: 1,   displayName: 'Gepard' },
  { code: 'SHILKA',  trackRadar: 'ZSU-23-4 Shilka',         category: 'PD',     wez: 2, nez: 1,   displayName: 'ZSU-23-4 Shilka' },
];

const EWR_TYPES = [
  '1L13 EWR', '55G6 EWR', 'EWR P-37 Bar Lock',
  'FPS-117', 'FPS-117 Dome', 'FPS-117 ECS',
  'Roland EWR', 'Dog Ear radar',
];

const SEARCH_RADAR_TYPES = [
  'p-19 s-125 sr', 'S-300PS 64H6E sr', 'S-300PS 40B6MD sr',
  'SA-11 Buk CC 9S470M1', 'S-300VM 9S15M2 sr', 'S-300VM 9S457ME sr',
  'Hawk sr', 'Patriot cp', 'NASAMS_Command_Post',
];

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
      if (t === entry.trackRadar || t.includes(entry.trackRadar)) {
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
  linkedSamName: string;
  units: { unitId: number; name: string; type: string }[];
  unitCount: number;
  lat: number;
  lon: number;
}

function buildAegisName(a: AegisAssignment): string {
  switch (a.role) {
    case 'EW':
      return `EW-${a.sector}${a.sectorIndex > 1 ? `-${a.sectorIndex}` : ''}`;
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
  const addEdit = useEditStore((s) => s.addEdit);

  const [coalitionFilter, setCoalitionFilter] = useState<'all' | 'blue' | 'red'>('all');
  const [applied, setApplied] = useState(false);
  const [assignments, setAssignments] = useState<AegisAssignment[]>([]);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [unmatchedGroups, setUnmatchedGroups] = useState<GroupRenamerData[]>([]);

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
        newGroupName: '', zoneOverride: '', zoneRange: null, activationRange: null, linkedSamName: '',
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

  const applyAll = useCallback(() => {
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
      // Set late activation + random heading for each unit
      for (const u of a.units) {
        addEdit({ unitId: u.unitId, field: 'lateActivation', value: true } as any);
        addEdit({ unitId: u.unitId, field: 'heading', value: Math.random() * Math.PI * 2 } as any);
      }
    }
    setApplied(true);
  }, [assignments, addEdit]);

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
        <code style={{ color: '#e0e0e0' }}>-ACT50</code> = activation range (nm)
      </div>

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
            ? 'AEGIS names queued! Download your .miz to save changes.'
            : `Ready to rename ${assignments.length} groups to AEGIS format.`}
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
  onUpdateLinkedSam: (groupId: number, samName: string) => void;
}

function AegisCard({
  assignment: a, samNames,
  onUpdateSector, onUpdateRole, onUpdateZoneOverride,
  onUpdateActivationRange, onUpdateLinkedSam,
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

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
};
