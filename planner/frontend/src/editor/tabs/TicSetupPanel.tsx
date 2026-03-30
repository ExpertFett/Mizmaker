import { useState, useMemo, useEffect, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { GroupRenamerData } from '../../types/mission';

/* ------------------------------------------------------------------ */
/* DCS unit type → TIC category mapping                                */
/* ------------------------------------------------------------------ */

type TicCategory = 'tank' | 'ifv' | 'apc' | 'infantry' | 'airdefense' | 'artillery' | 'other';

const CATEGORY_LABELS: Record<TicCategory, string> = {
  tank: 'Armor',
  ifv: 'Mech Infantry',
  apc: 'Motorized',
  infantry: 'Infantry',
  airdefense: 'Air Defense',
  artillery: 'Artillery',
  other: 'Support',
};

const CATEGORY_COLORS: Record<TicCategory, string> = {
  tank: '#d29922',
  ifv: '#4a8fd4',
  apc: '#3fb950',
  infantry: '#8fa8c0',
  airdefense: '#d95050',
  artillery: '#c090d0',
  other: '#5a7a8a',
};

/** Map DCS unit type strings to TIC categories */
function classifyUnit(type: string): TicCategory {
  const t = type.toLowerCase();

  // Tanks
  if (/t-55|t-62|t-72|t-80|t-90|m1a|m-?1\s?abrams|abrams|leopard|leclerc|challenger|merkava|ariete|chieftain|centurion|type-?59|type-?96|type-?99|ztz|mbt|m60/i.test(type))
    return 'tank';

  // IFVs (infantry carriers with weapons)
  if (/bmp|bradley|m2a2|warrior|marder|puma|cv90|bmd|stryker.*mgs|lav-?25/i.test(type))
    return 'ifv';

  // APCs
  if (/btr|m113|stryker|apc|mrap|aav|spartan|fuchs|vab|piranha|pandur|boxer|bushmaster|caiman|cougar|maxxpro|m1126|lav/i.test(type))
    return 'apc';

  // Infantry
  if (/infantry|soldier|paratrooper|insurgent|sniper|manpad|stinger.*m|igla/i.test(type))
    return 'infantry';

  // Air Defense
  if (/sa-?\d|s-?300|s-?400|buk|tor|osa|tunguska|shilka|gepard|vulcan|roland|hawk|patriot|nasams|rapier|avenger|linebacker|strela|igla.*v|zu-?23|flak|zsu/i.test(type))
    return 'airdefense';

  // Artillery
  if (/mlrs|grad|smerch|uragan|m109|m270|2s\d|paladin|pzh|gvozdika|msta|acacia|dana|caesar|archer|himars|howitzer|mortar|m252|2b\d/i.test(type))
    return 'artillery';

  // Fallback: check prefix patterns from DCS display names
  if (/^(MBT|Tk)/.test(type)) return 'tank';
  if (/^IFV/.test(type)) return 'ifv';
  if (/^APC/.test(type)) return 'apc';
  if (/^SAM|^SPAAA/.test(type)) return 'airdefense';
  if (/^MLRS|^SPH/.test(type)) return 'artillery';

  return 'other';
}

/* ------------------------------------------------------------------ */
/* Real-world unit designation databases                               */
/* ------------------------------------------------------------------ */

/**
 * NATO / Blue coalition — US Army style designations.
 * Format: "Bn-Regt Branch" e.g. "1-69 Armor", "3-7 Cavalry"
 * Based on real US Army battalion-level designations.
 */
const BLUE_DESIGNATIONS: Record<TicCategory, string[]> = {
  tank: [
    '1-69 Armor',        // 1st Battalion, 69th Armor Regiment (3rd BCT, 3AD)
    '2-34 Armor',        // 2nd Battalion, 34th Armor Regiment (1st BCT, 1AD)
    '1-37 Armor',        // 1st Battalion, 37th Armor Regiment (2nd BCT, 1AD)
    '3-67 Armor',        // 3rd Battalion, 67th Armor Regiment
    '1-66 Armor',        // 1st Battalion, 66th Armor Regiment (4th ID)
    '2-70 Armor',        // 2nd Battalion, 70th Armor Regiment
    '1-68 Armor',        // 1st Battalion, 68th Armor Regiment (3rd BCT, 4ID)
    '4-118 Armor',       // 4th Combined Arms Battalion, 118th Infantry (SCNG)
    '2-5 Armor',         // 2nd Battalion, 5th Armor (historical)
    '1-35 Armor',        // 1st Battalion, 35th Armor Regiment (2AD)
  ],
  ifv: [
    '2-12 Infantry',     // 2nd Battalion, 12th Infantry Regiment (4th ID)
    '1-18 Infantry',     // 1st Battalion, 18th Infantry ("Vanguards")
    '3-15 Infantry',     // 3rd Battalion, 15th Infantry (3rd ID)
    '1-26 Infantry',     // 1st Battalion, 26th Infantry ("Blue Spaders")
    '2-7 Infantry',      // 2nd Battalion, 7th Infantry (3rd ID)
    '1-9 Infantry',      // 1st Battalion, 9th Infantry ("Manchus")
    '5-20 Infantry',     // 5th Battalion, 20th Infantry
    '2-2 Infantry',      // 2nd Battalion, 2nd Infantry ("Ramrods")
    '1-64 Armor',        // 1st Battalion, 64th Armor (mech heavy)
    '4-31 Infantry',     // 4th Battalion, 31st Infantry (10th Mountain)
  ],
  apc: [
    '3-7 Cavalry',       // 3rd Squadron, 7th Cavalry Regiment ("Garryowen")
    '1-4 Cavalry',       // 1st Squadron, 4th Cavalry Regiment
    '6-6 Cavalry',       // 6th Squadron, 6th Cavalry Regiment
    '4-9 Cavalry',       // 4th Squadron, 9th Cavalry Regiment
    '1-10 Cavalry',      // 1st Squadron, 10th Cavalry (4th ID)
    '3-71 Cavalry',      // 3rd Squadron, 71st Cavalry (10th Mountain)
    '1-73 Cavalry',      // 1st Squadron, 73rd Cavalry (82nd Airborne)
    '5-4 Cavalry',       // 5th Squadron, 4th Cavalry
    '2-14 Cavalry',      // 2nd Squadron, 14th Cavalry
    '6-8 Cavalry',       // 6th Squadron, 8th Cavalry
  ],
  infantry: [
    '1-75 Rangers',      // 1st Battalion, 75th Ranger Regiment
    '2-504 Airborne',    // 2nd Battalion, 504th PIR (82nd Airborne)
    '1-187 Infantry',    // 1st Battalion, 187th Infantry ("Rakkasans", 101st)
    '3-325 Airborne',    // 3rd Battalion, 325th AIR (82nd Airborne)
    '2-506 Infantry',    // 2nd Battalion, 506th Infantry ("Currahee", 101st)
    '1-508 Airborne',    // 1st Battalion, 508th PIR
    '2-75 Rangers',      // 2nd Battalion, 75th Ranger Regiment
    '1-327 Infantry',    // 1st Battalion, 327th Infantry ("Bastogne", 101st)
    '3-187 Infantry',    // 3rd Battalion, 187th Infantry
    '1-501 Airborne',    // 1st Battalion, 501st PIR
  ],
  airdefense: [
    '5-7 ADA',           // 5th Battalion, 7th Air Defense Artillery
    '2-44 ADA',          // 2nd Battalion, 44th Air Defense Artillery
    '1-62 ADA',          // 1st Battalion, 62nd ADA (Patriot)
    '3-43 ADA',          // 3rd Battalion, 43rd ADA
    '4-60 ADA',          // 4th Battalion, 60th ADA
    '1-174 ADA',         // 1st Battalion, 174th ADA (OHNG)
    '2-263 ADA',         // 2nd Battalion, 263rd ADA
    '5-52 ADA',          // 5th Battalion, 52nd ADA
  ],
  artillery: [
    '1-82 FA',           // 1st Battalion, 82nd Field Artillery (1AD)
    '3-16 FA',           // 3rd Battalion, 16th Field Artillery
    '2-20 FA',           // 2nd Battalion, 20th Field Artillery
    '1-9 FA',            // 1st Battalion, 9th Field Artillery
    '3-29 FA',           // 3rd Battalion, 29th Field Artillery
    '1-41 FA',           // 1st Battalion, 41st Field Artillery
    '2-4 FA',            // 2nd Battalion, 4th Field Artillery
    '1-320 FA',          // 1st Battalion, 320th Field Artillery (101st)
    '2-319 FA',          // 2nd Battalion, 319th AFAR (82nd Airborne)
    '3-321 FA',          // 3rd Battalion, 321st Field Artillery
  ],
  other: [
    '299th BSB',         // 299th Brigade Support Battalion
    '553rd CSSB',        // 553rd Combat Sustainment Support Battalion
    '47th CSB',          // 47th Combat Support Battalion
    '87th CSSB',         // 87th CSSB
    '10th SB',           // 10th Sustainment Brigade
    '168th BSB',         // 168th Brigade Support Battalion
  ],
};

/**
 * Russian / Red coalition — Russian Army style designations.
 * Based on real Russian military unit numbering patterns.
 */
const RED_DESIGNATIONS: Record<TicCategory, string[]> = {
  tank: [
    '4th Gds Tank Bn',    // 4th Guards Tank Battalion (Kantemirovskaya)
    '12th Tank Bn',        // 12th Tank Battalion
    '6th Gds Tank Bn',    // 6th Guards Tank Battalion (Taman Division)
    '24th Tank Bn',        // 24th Separate Tank Battalion
    '38th Gds Tank Bn',   // 38th Guards Tank Battalion
    '239th Tank Bn',       // 239th Tank Battalion
    '54th Gds Tank Bn',   // 54th Guards Tank Battalion
    '163rd Tank Bn',       // 163rd Tank Battalion (90th TD)
    '13th Tank Bn',        // 13th Tank Battalion
    '352nd Tank Bn',       // 352nd Tank Battalion
  ],
  ifv: [
    '138th MRB',           // 138th Guards Motor Rifle Brigade
    '42nd MRB',            // 42nd Guards Motor Rifle Division
    '237th MRB',           // 237th Guards Airborne Assault Regiment
    '752nd MRR',           // 752nd Motor Rifle Regiment
    '291st MRB',           // 291st Motor Rifle Battalion
    '59th Gds MRB',        // 59th Guards Motor Rifle Brigade
    '136th Gds MRB',       // 136th Guards Motor Rifle Brigade
    '200th MRB',           // 200th Separate Motor Rifle Brigade (Arctic)
    '74th Gds MRB',        // 74th Guards Motor Rifle Brigade
    '228th MRR',           // 228th Motor Rifle Regiment
  ],
  apc: [
    '15th Recon Bn',       // 15th Separate Reconnaissance Battalion
    '33rd Recon Bn',       // 33rd Mountain Recon Battalion
    '100th Recon Bde',     // 100th Reconnaissance Brigade
    '175th Recon Bn',      // 175th Separate Recon Battalion
    '45th Spetsnaz Bde',   // 45th Guards Spetsnaz Brigade
    '346th Spetsnaz Bde',  // 346th Spetsnaz Brigade
    '3rd Gds Spetsnaz Bde',// 3rd Guards Spetsnaz Brigade
    '22nd Gds Spetsnaz Bde',// 22nd Guards Spetsnaz Brigade
    '16th Spetsnaz Bde',   // 16th Separate Spetsnaz Brigade
    '25th Recon Bn',       // 25th Separate Recon Battalion
  ],
  infantry: [
    '810th Naval Inf Bde',  // 810th Guards Naval Infantry Brigade (Black Sea Fleet)
    '217th VDV Bn',         // 217th Guards Airborne Battalion
    '83rd VDV Bde',         // 83rd Guards Air Assault Brigade
    '31st Gds VDV Bde',    // 31st Guards Air Assault Brigade (Ulyanovsk)
    '234th VDV Regt',       // 234th Guards Airborne Regiment
    '106th Gds VDV Div',   // 106th Guards Airborne Division
    '98th Gds VDV Div',    // 98th Guards Airborne Division
    '76th Gds VDV Div',    // 76th Guards Air Assault Division
    '11th VDV Bde',        // 11th Guards Air Assault Brigade
    '56th VDV Bde',        // 56th Guards Air Assault Brigade
  ],
  airdefense: [
    '53rd AD Bde',         // 53rd Air Defense Brigade
    '77th AD Regt',        // 77th Air Defense Regiment
    '202nd AD Bde',        // 202nd Air Defense Brigade
    '1528th AD Regt',      // 1528th AA Missile Regiment
    '174th AD Bde',        // 174th Air Defense Brigade
    '61st AD Bde',         // 61st Air Defense Brigade (Kaliningrad)
    '93rd AD Regt',        // 93rd Air Defense Regiment
    '1544th AD Regt',      // 1544th SAM Regiment
  ],
  artillery: [
    '288th Arty Bde',      // 288th Artillery Brigade
    '385th Gds Arty Bde', // 385th Guards Artillery Brigade
    '291st Arty Bde',      // 291st Artillery Brigade
    '120th Gds Arty Bde', // 120th Guards Artillery Brigade
    '47th Rocket Bde',     // 47th Rocket Artillery Brigade (BM-21 Grad)
    '79th Rocket Bde',     // 79th Guards Rocket Artillery Brigade
    '9th Arty Bde',        // 9th Artillery Brigade
    '20th Gds MRL Bde',   // 20th Guards MRL Brigade
    '152nd Arty Bde',      // 152nd Artillery Brigade
    '439th Rocket Bde',    // 439th Guards Rocket Artillery Brigade
  ],
  other: [
    '74th Log Bde',        // 74th Logistics Brigade
    '187th Log Bn',        // 187th Logistics Battalion
    '329th Eng Bn',        // 329th Engineering Battalion
    '68th Eng Bde',        // 68th Engineering Brigade
    '12th Eng Bde',        // 12th Engineering Brigade
    '45th Eng Regt',       // 45th Engineer Regiment
  ],
};

/**
 * Company-level letter designators for sub-units within a formation.
 * Blue uses NATO phonetic, Red uses numbered companies.
 */
const BLUE_COMPANIES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Fox'];
const RED_COMPANIES = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

interface FormationAssignment {
  groupId: number;
  originalName: string;
  ticCategory: TicCategory;
  formationName: string;       // e.g. "1-69 Armor" or "4th Gds Tank Bn"
  companyDesignator: string;   // e.g. "Alpha" or "2nd"
  isLeader: boolean;
  keepTogether: boolean;
  newGroupName: string;
  units: { unitId: number; originalName: string; type: string; newName: string }[];
  coalition: string;
  unitCount: number;
}

/** Tracks how many groups have been assigned from each designation pool */
const _usedDesignations = new Map<string, number>();
let _designationOffset = 0;

function generateFormationName(
  category: TicCategory,
  coalition: string,
): { formation: string; company: string } {
  const pool = coalition === 'red' ? RED_DESIGNATIONS : BLUE_DESIGNATIONS;
  const companies = coalition === 'red' ? RED_COMPANIES : BLUE_COMPANIES;
  const designations = pool[category] || pool['other'];

  // Track usage per coalition+category so we cycle through the list
  const key = `${coalition}:${category}`;
  const used = _usedDesignations.get(key) || 0;

  // Formation = battalion/regiment level designation (offset shifts on each regenerate)
  const formationIdx = (Math.floor(used / companies.length) + _designationOffset) % designations.length;
  const companyIdx = used % companies.length;

  _usedDesignations.set(key, used + 1);

  return {
    formation: designations[formationIdx],
    company: companies[companyIdx],
  };
}

function resetDesignationCounters(shuffle = false) {
  _usedDesignations.clear();
  if (shuffle) {
    _designationOffset = (_designationOffset + 1) % 10;
  }
}

function buildTicGroupName(formationName: string, company: string, isLeader: boolean, keepTogether: boolean): string {
  // Compact: "A-1-69-Armor" for "Alpha" company of "1-69 Armor"
  const compactFormation = formationName.replace(/\s+/g, '-');
  const compactCompany = company.charAt(0); // A, B, C, D... or 1, 2, 3...
  const sep = isLeader ? '!' : ':';
  const multi = keepTogether ? '+' : '';
  return `TIC${sep}${compactCompany}-${compactFormation}${multi}#`;
}

function buildRealWorldUnitName(
  formationName: string,
  company: string,
  unitType: string,
  unitIndex: number,
  _totalUnits: number,
  coalition: string,
): string {
  const shortType = unitType.replace(/\s*\([^)]*\)/g, '').trim();
  const vehicleNum = unitIndex + 1;

  if (coalition === 'red') {
    // Russian style: "2nd Co, 4th Gds Tank Bn - 201 (T-72B3)"
    // Vehicle number: company hundreds + sequential: 101, 102, 201, 202
    const companyNum = RED_COMPANIES.indexOf(company) + 1;
    const vehCode = `${companyNum}${String(vehicleNum).padStart(2, '0')}`;
    return `${vehCode} ${shortType} | ${company} Co, ${formationName}`;
  }

  // NATO style: "A-11 M1A2 | Alpha Co, 1-69 Armor"
  // Vehicle numbering: Company letter + platoon(1) + vehicle
  const coLetter = company.charAt(0);
  return `${coLetter}-1${vehicleNum} ${shortType} | ${company} Co, ${formationName}`;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function TicSetupPanel() {
  const allGroupsRenamer = useMissionStore((s) => s.allGroupsRenamer);
  const addEdit = useEditStore((s) => s.addEdit);

  const [coalitionFilter, setCoalitionFilter] = useState<'all' | 'blue' | 'red'>('all');
  const [applied, setApplied] = useState(false);

  // Filter to vehicle groups only
  const vehicleGroups = useMemo(() => {
    let groups = allGroupsRenamer.filter((g) => g.category === 'vehicle');
    if (coalitionFilter !== 'all') {
      groups = groups.filter((g) => g.coalition === coalitionFilter);
    }
    return groups;
  }, [allGroupsRenamer, coalitionFilter]);

  // Classify and build formation assignments
  const [assignments, setAssignments] = useState<FormationAssignment[]>([]);

  // Auto-generate assignments when vehicle groups change
  const generateAssignments = useCallback((shuffle = false) => {
    try {
      resetDesignationCounters(shuffle);

      const result: FormationAssignment[] = [];

      for (const group of vehicleGroups) {
        // Skip groups with no units
        if (!group.units || group.units.length === 0) continue;

        const types = group.units.map((u) => classifyUnit(u.type));
        const majorityType = getMajority(types, 'other' as TicCategory);
        const { formation, company } = generateFormationName(majorityType, group.coalition);

        const isLeader = result.filter((r) =>
          r.formationName === formation && r.coalition === group.coalition
        ).length === 0; // first group for this formation = leader
        const keepTogether = group.unitCount > 1;
        const newGroupName = buildTicGroupName(formation, company, isLeader, keepTogether);

        const units = group.units.map((u, ui) => ({
          unitId: u.unitId,
          originalName: u.name,
          type: u.type,
          newName: buildRealWorldUnitName(formation, company, u.type, ui, group.unitCount, group.coalition),
        }));

        result.push({
          groupId: group.groupId,
          originalName: group.groupName,
          ticCategory: majorityType,
          formationName: formation,
          companyDesignator: company,
          isLeader,
          keepTogether,
          newGroupName,
          units,
          coalition: group.coalition,
          unitCount: group.unitCount,
        });
      }

      setAssignments(result);
      setApplied(false);
    } catch (err) {
      console.error('[TIC] generateAssignments error:', err);
      setAssignments([]);
    }
  }, [vehicleGroups]);

  // Auto-gen on first render and when filter changes
  useEffect(() => {
    if (vehicleGroups.length > 0) {
      generateAssignments();
    } else {
      setAssignments([]);
    }
  }, [vehicleGroups, generateAssignments]);

  // Toggle leader
  const toggleLeader = useCallback((groupId: number) => {
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.groupId !== groupId) return a;
        const newLeader = !a.isLeader;
        return {
          ...a,
          isLeader: newLeader,
          newGroupName: buildTicGroupName(a.formationName, a.companyDesignator, newLeader, a.keepTogether),
        };
      }),
    );
  }, []);

  // Toggle keep-together
  const toggleKeepTogether = useCallback((groupId: number) => {
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.groupId !== groupId) return a;
        const newKT = !a.keepTogether;
        return {
          ...a,
          keepTogether: newKT,
          newGroupName: buildTicGroupName(a.formationName, a.companyDesignator, a.isLeader, newKT),
        };
      }),
    );
  }, []);

  // Edit formation name
  const updateFormationName = useCallback((groupId: number, newFormation: string) => {
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.groupId !== groupId) return a;
        return {
          ...a,
          formationName: newFormation,
          newGroupName: buildTicGroupName(newFormation, a.companyDesignator, a.isLeader, a.keepTogether),
          units: a.units.map((u, ui) => ({
            ...u,
            newName: buildRealWorldUnitName(newFormation, a.companyDesignator, u.type, ui, a.unitCount, a.coalition),
          })),
        };
      }),
    );
  }, []);

  // Apply all renames
  const applyAll = useCallback(() => {
    for (const a of assignments) {
      // groupRename handles both group name + all unit names in one edit
      const unitNamesObj: Record<number, string> = {};
      for (const u of a.units) {
        unitNamesObj[u.unitId] = u.newName;
      }
      addEdit({
        groupId: a.groupId,
        field: 'groupRename',
        value: { groupId: a.groupId, newGroupName: a.newGroupName, unitNames: unitNamesObj },
      } as any);
    }
    setApplied(true);
  }, [assignments, addEdit]);

  // Summary stats — must be before any early return to satisfy Rules of Hooks
  const categoryStats = useMemo(() => {
    const stats = new Map<TicCategory, number>();
    for (const a of assignments) {
      stats.set(a.ticCategory, (stats.get(a.ticCategory) || 0) + 1);
    }
    return stats;
  }, [assignments]);

  const formationNames = useMemo(() => {
    const names = new Set<string>();
    for (const a of assignments) names.add(a.formationName);
    return names;
  }, [assignments]);

  // Total vehicle groups (unfiltered) to decide if panel has anything at all
  const totalVehicleGroups = useMemo(() =>
    allGroupsRenamer.filter((g) => g.category === 'vehicle').length,
  [allGroupsRenamer]);

  if (totalVehicleGroups === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 14, padding: 16 }}>
        No ground vehicle groups found in this mission.
      </div>
    );
  }

  return (
    <div>
      {/* Header — always visible so user can switch filters */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#d29922', marginBottom: 4 }}>
            TIC Script Auto-Setup
          </div>
          <div style={{ fontSize: 13, color: '#5a7a8a' }}>
            Renames ground groups to TIC-compatible format with real-world military designations.
            Groups with the same formation name will fight together.
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
          <button onClick={() => generateAssignments(true)} style={btnStyle}>
            Regenerate
          </button>
          <button
            onClick={applyAll}
            disabled={applied || assignments.length === 0}
            style={{
              ...btnStyle,
              background: applied ? '#1a2a1a' : '#1a3a1a',
              border: `1px solid ${applied ? '#3a5a3a' : '#3fb950'}`,
              color: applied ? '#3a5a3a' : '#3fb950',
              fontWeight: 600,
            }}
          >
            {applied ? '✓ Applied' : 'Apply'}
          </button>
        </div>
      </div>

      {vehicleGroups.length === 0 ? (
        <div style={{ color: '#5a7a8a', fontSize: 14, padding: '16px 0' }}>
          No vehicle groups for this coalition. Try a different filter above.
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div style={{
            display: 'flex', gap: 12, marginBottom: 16, padding: '10px 14px',
            background: '#0a1520', border: '1px solid #1a2a3a', borderRadius: 4,
            flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 13, color: '#5a7a8a' }}>
              <strong style={{ color: '#ccdae8' }}>{assignments.length}</strong> groups in{' '}
              <strong style={{ color: '#ccdae8' }}>{formationNames.size}</strong> formations
            </div>
            <div style={{ display: 'flex', gap: 10, flex: 1, justifyContent: 'flex-end' }}>
              {Array.from(categoryStats).map(([cat, count]) => (
                <span key={cat} style={{ fontSize: 12, color: CATEGORY_COLORS[cat] }}>
                  {CATEGORY_LABELS[cat]}: {count}
                </span>
              ))}
            </div>
          </div>

          {/* TIC naming reference */}
          <div style={{
            marginBottom: 16, padding: '8px 14px',
            background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4,
            fontSize: 12, color: '#5a7a8a',
          }}>
            <strong style={{ color: '#8fa8c0' }}>TIC Format:</strong>{' '}
            <code style={{ color: '#d29922' }}>TIC:FormationName#</code> = member,{' '}
            <code style={{ color: '#3fb950' }}>TIC!FormationName#</code> = leader,{' '}
            <code style={{ color: '#4a8fd4' }}>+</code> = keep units grouped
          </div>

          {/* Assignment cards */}
          {assignments.map((a) => (
            <div
              key={a.groupId}
              style={{
                marginBottom: 8,
                border: `1px solid ${a.isLeader ? '#3fb950' : '#1a2a3a'}`,
                borderRadius: 4,
                background: '#0a1520',
              }}
            >
              <div style={{
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                borderLeft: `3px solid ${CATEGORY_COLORS[a.ticCategory]}`,
              }}>
                {/* Coalition badge */}
                <span style={{
                  background: a.coalition === 'blue' ? '#4a8fd4' : '#d95050',
                  color: '#080f1c', fontSize: 11, fontWeight: 700,
                  padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase',
                }}>
                  {a.coalition}
                </span>

                {/* Category badge */}
                <span style={{
                  color: CATEGORY_COLORS[a.ticCategory],
                  fontSize: 11, fontWeight: 600,
                  border: `1px solid ${CATEGORY_COLORS[a.ticCategory]}`,
                  padding: '1px 6px', borderRadius: 3,
                }}>
                  {CATEGORY_LABELS[a.ticCategory]}
                </span>

                {/* Original name → new name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 200 }}>
                  <span style={{ color: '#5a7a8a', fontSize: 13, textDecoration: 'line-through' }}>
                    {a.originalName}
                  </span>
                  <span style={{ color: '#5a7a8a' }}>&rarr;</span>
                  <span style={{ color: '#ccdae8', fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>
                    {a.newGroupName}
                  </span>
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button
                    onClick={() => toggleLeader(a.groupId)}
                    style={{
                      ...smallBtnStyle,
                      color: a.isLeader ? '#3fb950' : '#5a7a8a',
                      border: `1px solid ${a.isLeader ? '#3fb950' : '#1a2a3a'}`,
                    }}
                    title="Toggle formation leader (TIC! vs TIC:)"
                  >
                    {a.isLeader ? 'Leader' : 'Member'}
                  </button>
                  <button
                    onClick={() => toggleKeepTogether(a.groupId)}
                    style={{
                      ...smallBtnStyle,
                      color: a.keepTogether ? '#4a8fd4' : '#5a7a8a',
                      border: `1px solid ${a.keepTogether ? '#4a8fd4' : '#1a2a3a'}`,
                    }}
                    title="Keep units grouped (+) or let TIC split them"
                  >
                    {a.keepTogether ? 'Grouped +' : 'Split'}
                  </button>
                </div>
              </div>

              {/* Formation name editor */}
              <div style={{
                padding: '6px 14px 10px',
                borderTop: '1px solid #0f1a28',
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}>
                <label style={{ fontSize: 12, color: '#5a7a8a', fontWeight: 600 }}>Formation:</label>
                <input
                  value={a.formationName}
                  onChange={(e) => updateFormationName(a.groupId, e.target.value)}
                  style={{
                    background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 3,
                    color: '#ccdae8', fontSize: 13, padding: '3px 8px', width: 200, outline: 'none',
                  }}
                />
                <span style={{
                  fontSize: 11, color: '#d29922', background: '#1a1a10',
                  padding: '1px 6px', borderRadius: 3, border: '1px solid #3a3a1a',
                }}>
                  {a.companyDesignator} Co
                </span>
                <span style={{ fontSize: 12, color: '#5a7a8a' }}>
                  {a.unitCount} unit{a.unitCount !== 1 ? 's' : ''}:
                </span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {a.units.map((u) => (
                    <span key={u.unitId} style={{
                      fontSize: 11, color: '#8fa8c0', background: '#0f1a28',
                      padding: '2px 6px', borderRadius: 3, border: '1px solid #1a2a3a',
                    }}>
                      {u.newName}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {/* Apply button */}
          <div style={{
            marginTop: 20, padding: '14px',
            background: '#0a1520', border: '1px solid #1a2a3a', borderRadius: 4,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ fontSize: 13, color: '#5a7a8a' }}>
              {applied
                ? 'Renames queued! Download your .miz to save changes.'
                : `Ready to rename ${assignments.length} groups to TIC format.`}
            </div>
            <button
              onClick={applyAll}
              disabled={applied || assignments.length === 0}
              style={{
                ...btnStyle,
                background: applied ? '#1a2a1a' : '#1a3a1a',
                border: `1px solid ${applied ? '#3a5a3a' : '#3fb950'}`,
                color: applied ? '#3a5a3a' : '#3fb950',
                fontSize: 14,
                padding: '8px 20px',
                fontWeight: 600,
              }}
            >
              {applied ? 'Applied' : 'Apply All TIC Names'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getMajority<T>(items: T[], fallback?: T): T {
  if (items.length === 0) return fallback as T;
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let best = items[0];
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const btnStyle: React.CSSProperties = {
  background: '#1a2a3a',
  border: '1px solid #2a3a4a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 12px',
  fontFamily: 'inherit',
};

const smallBtnStyle: React.CSSProperties = {
  background: 'transparent',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
  padding: '2px 8px',
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#ccdae8',
  fontSize: 13,
  padding: '6px 8px',
  outline: 'none',
  fontFamily: 'inherit',
};
