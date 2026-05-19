import { useState, useMemo, useEffect, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';

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
  infantry: '#cccccc',
  airdefense: '#d95050',
  artillery: '#c090d0',
  other: '#aaaaaa',
};

/** Map DCS unit type strings to TIC categories */
function classifyUnit(type: string): TicCategory {
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
    '1st Bn 69th Armor',
    '2nd Bn 34th Armor',
    '1st Bn 37th Armor',
    '3rd Bn 67th Armor',
    '1st Bn 66th Armor',
    '2nd Bn 70th Armor',
    '1st Bn 68th Armor',
    '4th Bn 118th Armor',
    '2nd Bn 5th Armor',
    '1st Bn 35th Armor',
  ],
  ifv: [
    '2nd Bn 12th Infantry',
    '1st Bn 18th Infantry',
    '3rd Bn 15th Infantry',
    '1st Bn 26th Infantry',
    '2nd Bn 7th Infantry',
    '1st Bn 9th Infantry',
    '5th Bn 20th Infantry',
    '2nd Bn 2nd Infantry',
    '1st Bn 64th Armor',
    '4th Bn 31st Infantry',
  ],
  apc: [
    '3rd Sqn 7th Cavalry',
    '1st Sqn 4th Cavalry',
    '6th Sqn 6th Cavalry',
    '4th Sqn 9th Cavalry',
    '1st Sqn 10th Cavalry',
    '3rd Sqn 71st Cavalry',
    '1st Sqn 73rd Cavalry',
    '5th Sqn 4th Cavalry',
    '2nd Sqn 14th Cavalry',
    '6th Sqn 8th Cavalry',
  ],
  infantry: [
    '1st Bn 75th Rangers',
    '2nd Bn 504th Airborne',
    '1st Bn 187th Infantry',
    '3rd Bn 325th Airborne',
    '2nd Bn 506th Infantry',
    '1st Bn 508th Airborne',
    '2nd Bn 75th Rangers',
    '1st Bn 327th Infantry',
    '3rd Bn 187th Infantry',
    '1st Bn 501st Airborne',
  ],
  airdefense: [
    '5th Bn 7th ADA',
    '2nd Bn 44th ADA',
    '1st Bn 62nd ADA',
    '3rd Bn 43rd ADA',
    '4th Bn 60th ADA',
    '1st Bn 174th ADA',
    '2nd Bn 263rd ADA',
    '5th Bn 52nd ADA',
  ],
  artillery: [
    '1st Bn 82nd FA',
    '3rd Bn 16th FA',
    '2nd Bn 20th FA',
    '1st Bn 9th FA',
    '3rd Bn 29th FA',
    '1st Bn 41st FA',
    '2nd Bn 4th FA',
    '1st Bn 320th FA',
    '2nd Bn 319th FA',
    '3rd Bn 321st FA',
  ],
  other: [
    '299th BSB',
    '553rd CSSB',
    '47th CSB',
    '87th CSSB',
    '10th Sustainment Bde',
    '168th BSB',
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
/* Per-waypoint task editing (v1: goto / goto_at_time only)            */
/* ------------------------------------------------------------------ */

/** Primary action verbs the per-waypoint dropdown exposes. These drive the
 *  `t+N` token in the waypoint name:
 *    goto          → strip any `t+N`
 *    goto_at_time  → set `t+<minutes>`
 *
 *  v1 placeholders (Hold / Engage on call / etc.) were removed in v0.9.57 —
 *  they were DCS-native concepts that don't map to TIC's name-token model.
 *  Secondary TIC tokens (speed=, roe=, hdg=, flag=, flag+) get their own
 *  inputs alongside the dropdown, not their own primary action.
 */
const WP_ACTIONS = [
  { value: 'goto',         label: 'Go to',          v1: true },
  { value: 'goto_at_time', label: 'Go to at time',  v1: true },
] as const;

type WpActionValue = (typeof WP_ACTIONS)[number]['value'];

/** ROE values TIC parses (TIC_v1.1.lua::extractROE). Lowercase per the
 *  script's `string.lower(str)` step before matching. */
const ROE_OPTIONS = ['', 'simulate', 'kill', 'hold'] as const;
type RoeValue = (typeof ROE_OPTIONS)[number];

/** Deployment values TIC parses (bare words, NOT key=value). */
const DEPLOYMENT_OPTIONS = ['', 'mount', 'dismount'] as const;
type DeploymentValue = (typeof DEPLOYMENT_OPTIONS)[number];

interface WpTaskAssignment {
  action: WpActionValue;
  eta_seconds: number;

  // v0.9.57 secondary tokens — all optional. Backend semantics:
  //   undefined  → leave the token alone in the waypoint name
  //   empty/null → strip the token
  //   value      → set/replace the token
  // We model "undefined" as `null` here so the JSON dispatch carries
  // unambiguous intent for "I touched this field and want it cleared".
  speed?: number | null;          // speed=N      (km/h)
  roe?: RoeValue | null;          // roe=simulate / kill / hold
  hdg?: number | null;            // hdg=N        (degrees)
  flag_wait?: string | null;      // flag=X       (TIC waits for this flag)
  flag_set?: string | null;       // flag+X       (TIC sets this flag on arrival)

  // v0.9.59 — the remaining TIC tokens.
  scale?: string | null;          // scale=N.M    (formation scale, decimal)
  direct?: 'y' | 'n' | null;      // direct=y/n   (skip-to-WP retreat logic)
  strength?: string | null;       // strength=N.M (retreat threshold 0-1)
  phase?: string | null;          // "phase_name" (quoted phase identifier)
  deployment?: DeploymentValue | null;  // mount / dismount (infantry load)
}

type GroupStatus = 'grey' | 'amber' | 'green';

function deriveStatus(groupId: number,
                      appliedGroups: Set<number>,
                      dirtyGroups: Set<number>): GroupStatus {
  if (dirtyGroups.has(groupId)) return 'amber';
  if (appliedGroups.has(groupId)) return 'green';
  return 'grey';
}

const STATUS_COLOR: Record<GroupStatus, string> = {
  grey:  '#6a6a6a',
  amber: '#d29922',
  green: '#3fb950',
};

const STATUS_LABEL: Record<GroupStatus, string> = {
  grey:  'not applied',
  amber: 'changes pending',
  green: 'applied',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function TicSetupPanel() {
  const allGroupsRenamer = useMissionStore((s) => s.allGroupsRenamer);
  const missionGroups = useMissionStore((s) => s.groups);  // for per-group waypoints
  const addEdit = useEditStore((s) => s.addEdit);

  const [coalitionFilter, setCoalitionFilter] = useState<'all' | 'blue' | 'red'>('all');

  // v0.9.42 — TIC + waypoint task integration (v1: goto / goto_at_time)
  // Per-WP task assignments, keyed by groupId then wpIndex (1-based DCS index).
  const [taskAssignments, setTaskAssignments] = useState<Map<number, Map<number, WpTaskAssignment>>>(() => new Map());
  // Groups whose rename has been Applied at least once. Drives green dot.
  const [appliedGroups, setAppliedGroups] = useState<Set<number>>(() => new Set());
  // Groups with WP changes since the last Apply for that group. Drives amber dot.
  const [dirtyGroups, setDirtyGroups] = useState<Set<number>>(() => new Set());
  // Which group's detail pane shows in the side-panel layout.
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

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

  // Keep selectedGroupId in sync with the visible assignment list. If the
  // current selection is filtered out (or assignments regenerate), fall
  // back to the first row.
  useEffect(() => {
    if (assignments.length === 0) {
      if (selectedGroupId !== null) setSelectedGroupId(null);
      return;
    }
    if (selectedGroupId === null || !assignments.some((a) => a.groupId === selectedGroupId)) {
      setSelectedGroupId(assignments[0].groupId);
    }
  }, [assignments, selectedGroupId]);

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

  // Set a per-waypoint action choice. Marks the group "dirty" so the
  // status dot turns amber until the next Apply pass.
  //
  // `defaultEtaSeconds` is the waypoint's existing eta_seconds from the
  // .miz — we seed the state's eta_seconds with it (snapped to whole
  // minutes for the T+ UI) so picking "Go to at time" without touching
  // the minutes input doesn't silently overwrite the waypoint's ETA to 0.
  const setWpAction = useCallback((groupId: number, wpIndex: number, action: WpActionValue,
                                   defaultEtaSeconds: number = 0) => {
    setTaskAssignments((prev) => {
      const next = new Map(prev);
      const groupMap = new Map(next.get(groupId) || []);
      const existing = groupMap.get(wpIndex);
      const seedSeconds = existing?.eta_seconds ?? Math.round(defaultEtaSeconds / 60) * 60;
      groupMap.set(wpIndex, {
        action,
        eta_seconds: seedSeconds,
      });
      next.set(groupId, groupMap);
      return next;
    });
    setDirtyGroups((prev) => {
      if (prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
  }, []);

  // Set the ETA (seconds since mission start) for a waypoint. Only meaningful
  // when its action is goto_at_time, but we accept it anytime so toggling
  // back and forth doesn't lose the user's time entry.
  const setWpEta = useCallback((groupId: number, wpIndex: number, seconds: number) => {
    setTaskAssignments((prev) => {
      const next = new Map(prev);
      const groupMap = new Map(next.get(groupId) || []);
      const existing = groupMap.get(wpIndex);
      groupMap.set(wpIndex, {
        action: existing?.action ?? 'goto',
        eta_seconds: seconds,
      });
      next.set(groupId, groupMap);
      return next;
    });
    setDirtyGroups((prev) => {
      if (prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
  }, []);

  // Secondary-token setter. Generic over every TIC name token the
  // planner exposes. Same "absent / falsy / value" semantics as
  // documented on the backend.
  type SecondaryTokenField =
    | 'speed' | 'roe' | 'hdg' | 'flag_wait' | 'flag_set'
    | 'scale' | 'direct' | 'strength' | 'phase' | 'deployment';
  const setWpToken = useCallback(<F extends SecondaryTokenField>(
    groupId: number, wpIndex: number, field: F, value: WpTaskAssignment[F],
  ) => {
    setTaskAssignments((prev) => {
      const next = new Map(prev);
      const groupMap = new Map(next.get(groupId) || []);
      const existing = groupMap.get(wpIndex) ?? {
        action: 'goto' as WpActionValue,
        eta_seconds: 0,
      };
      groupMap.set(wpIndex, { ...existing, [field]: value });
      next.set(groupId, groupMap);
      return next;
    });
    setDirtyGroups((prev) => {
      if (prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
  }, []);

  // Apply all renames + waypoint tasks
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
      // Set late activation + random heading for each unit
      for (const u of a.units) {
        addEdit({ unitId: u.unitId, field: 'lateActivation', value: true } as any);
        addEdit({ unitId: u.unitId, field: 'heading', value: Math.random() * Math.PI * 2 } as any);
      }
      // v0.9.42 — primary `t+N` token via action + eta_seconds.
      // v0.9.57 — secondary TIC tokens (speed=, roe=, hdg=, flag=, flag+)
      //          per-WP, all optional. Only fields PRESENT in the
      //          assignment get shipped; absent fields tell the backend
      //          to leave that token in the waypoint name alone.
      const groupTasks = taskAssignments.get(a.groupId);
      if (groupTasks && groupTasks.size > 0) {
        const tasks = Array.from(groupTasks.entries()).map(([wpIndex, t]) => {
          const task: Record<string, unknown> = {
            wpIndex,
            action: t.action,
            eta_seconds: t.eta_seconds,
          };
          // Include each secondary token only if the field was touched.
          // `undefined` = leave alone; null / "" = strip; anything else
          // = set. The backend handler honours those semantics 1:1.
          if (t.speed      !== undefined) task.speed      = t.speed;
          if (t.roe        !== undefined) task.roe        = t.roe;
          if (t.hdg        !== undefined) task.hdg        = t.hdg;
          if (t.flag_wait  !== undefined) task.flag_wait  = t.flag_wait;
          if (t.flag_set   !== undefined) task.flag_set   = t.flag_set;
          if (t.scale      !== undefined) task.scale      = t.scale;
          if (t.direct     !== undefined) task.direct     = t.direct;
          if (t.strength   !== undefined) task.strength   = t.strength;
          if (t.phase      !== undefined) task.phase      = t.phase;
          if (t.deployment !== undefined) task.deployment = t.deployment;
          return task;
        });
        if (tasks.length > 0) {
          addEdit({
            groupId: a.groupId,
            field: 'waypointTasks',
            value: { groupId: a.groupId, tasks },
          } as any);
        }
      }
    }
    // Mark every group in the current assignment list as applied; clear
    // dirty since their pending changes were just flushed.
    setAppliedGroups((prev) => {
      const next = new Set(prev);
      for (const a of assignments) next.add(a.groupId);
      return next;
    });
    setDirtyGroups(new Set());
  }, [assignments, addEdit, taskAssignments]);

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
          <div style={{ fontSize: 15, fontWeight: 600, color: '#d29922', marginBottom: 4 }}>
            TIC Script Auto-Setup
          </div>
          <div style={{ fontSize: 13, color: '#aaaaaa' }}>
            Renames ground groups to TIC-compatible format with real-world military designations.
            Groups with the same formation name will fight together.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={coalitionFilter}
            onChange={(e) => setCoalitionFilter(e.target.value as any)}
            style={selectStyle}
          >
            <option value="all">Both Sides</option>
            <option value="blue">Blue Only</option>
            <option value="red">Red Only</option>
          </select>
          <button onClick={() => generateAssignments(true)} style={btnStyle}>
            Regenerate
          </button>
          {/* Top Apply mirrors the bottom one. With the per-group model
              users can Apply multiple times — once per round of WP edits
              — so we don't lock the button after the first click. */}
          <button
            onClick={applyAll}
            disabled={assignments.length === 0}
            style={{
              ...btnStyle,
              background: '#1a3a1a',
              border: '1px solid #3fb950',
              color: '#3fb950',
              fontWeight: 600,
            }}
          >
            Apply
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
            flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 13, color: '#aaaaaa' }}>
              <strong style={{ color: '#e0e0e0' }}>{assignments.length}</strong> groups in{' '}
              <strong style={{ color: '#e0e0e0' }}>{formationNames.size}</strong> formations
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
            background: '#262626', border: '1px solid #3a3a3a', borderRadius: 4,
            fontSize: 12, color: '#aaaaaa',
          }}>
            <strong style={{ color: '#cccccc' }}>TIC Format:</strong>{' '}
            <code style={{ color: '#d29922' }}>TIC:FormationName#</code> = member,{' '}
            <code style={{ color: '#3fb950' }}>TIC!FormationName#</code> = leader,{' '}
            <code style={{ color: '#4a8fd4' }}>+</code> = keep units grouped
          </div>

          {/* === Two-column: group list (left) + detail (right) ===
              v0.9.42 side-panel layout. List stays compact even with 30+
              groups; detail pane has room for the route table + per-WP
              parameter editors (more important once v2 adds hold /
              engage / fire-at-pt verbs with their own param fields). */}
          {(() => {
            const sel = assignments.find((a) => a.groupId === selectedGroupId) || null;
            const selWaypoints = sel
              ? missionGroups.find((g) => g.groupId === sel.groupId)?.waypoints ?? []
              : [];

            return (
              <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12 }}>

                {/* LEFT: compact group list */}
                <div style={listColumnStyle}>
                  <div style={listHeaderStyle}>
                    {assignments.length} GROUPS &middot; {coalitionFilter === 'all' ? 'BOTH SIDES' : coalitionFilter.toUpperCase() + ' ONLY'}
                  </div>
                  {assignments.map((a) => {
                    const status = deriveStatus(a.groupId, appliedGroups, dirtyGroups);
                    const wpCount = missionGroups.find((g) => g.groupId === a.groupId)?.waypoints?.length ?? 0;
                    const isSelected = a.groupId === selectedGroupId;
                    return (
                      <div
                        key={a.groupId}
                        onClick={() => setSelectedGroupId(a.groupId)}
                        style={{
                          ...listRowStyle,
                          background: isSelected ? '#2a2a2a' : 'transparent',
                          borderLeft: isSelected ? '3px solid #4a8fd4' : '3px solid transparent',
                        }}
                        title={`status: ${STATUS_LABEL[status]}`}
                      >
                        <span style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: STATUS_COLOR[status], flexShrink: 0,
                        }} />
                        <span style={{
                          background: a.coalition === 'blue' ? '#4a8fd4' : '#d95050',
                          color: '#1a1a1a', fontSize: 10, fontWeight: 700,
                          padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase',
                        }}>
                          {a.coalition}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontFamily: "'B612 Mono', monospace", fontSize: 12.5,
                            color: '#e0e0e0', whiteSpace: 'nowrap',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {a.newGroupName}
                          </div>
                          <div style={{ fontSize: 11, color: '#aaaaaa' }}>
                            {wpCount} WP{wpCount !== 1 ? 's' : ''} &middot; {CATEGORY_LABELS[a.ticCategory]} &middot; {a.isLeader ? 'leader' : 'member'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* RIGHT: detail pane for the selected group */}
                <div style={detailColumnStyle}>
                  {!sel ? (
                    <div style={{ padding: 24, color: '#aaaaaa', fontSize: 13, textAlign: 'center' }}>
                      Select a group on the left to see its waypoints.
                    </div>
                  ) : (
                    <>
                      {/* Detail header */}
                      <div style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid #3a3a3a',
                        borderLeft: `3px solid ${CATEGORY_COLORS[sel.ticCategory]}`,
                        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      }}>
                        <span style={{
                          background: sel.coalition === 'blue' ? '#4a8fd4' : '#d95050',
                          color: '#1a1a1a', fontSize: 11, fontWeight: 700,
                          padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase',
                        }}>{sel.coalition}</span>
                        <span style={{
                          color: CATEGORY_COLORS[sel.ticCategory],
                          fontSize: 11, fontWeight: 600,
                          border: `1px solid ${CATEGORY_COLORS[sel.ticCategory]}`,
                          padding: '1px 6px', borderRadius: 3,
                        }}>{CATEGORY_LABELS[sel.ticCategory]}</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flex: 1, minWidth: 200 }}>
                          <span style={{ color: '#aaaaaa', fontSize: 12, textDecoration: 'line-through' }}>
                            {sel.originalName}
                          </span>
                          <span style={{ color: '#aaaaaa' }}>&rarr;</span>
                          <span style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 600, fontFamily: "'B612 Mono', monospace" }}>
                            {sel.newGroupName}
                          </span>
                        </div>
                        <button
                          onClick={() => toggleLeader(sel.groupId)}
                          style={{
                            ...smallBtnStyle,
                            color: sel.isLeader ? '#3fb950' : '#aaaaaa',
                            border: `1px solid ${sel.isLeader ? '#3fb950' : '#3a3a3a'}`,
                          }}
                          title="Toggle formation leader (TIC! vs TIC:)"
                        >
                          {sel.isLeader ? 'Leader' : 'Member'}
                        </button>
                        <button
                          onClick={() => toggleKeepTogether(sel.groupId)}
                          style={{
                            ...smallBtnStyle,
                            color: sel.keepTogether ? '#4a8fd4' : '#aaaaaa',
                            border: `1px solid ${sel.keepTogether ? '#4a8fd4' : '#3a3a3a'}`,
                          }}
                          title="Keep units grouped (+) or let TIC split them"
                        >
                          {sel.keepTogether ? 'Grouped +' : 'Split'}
                        </button>
                      </div>

                      {/* Formation name + unit chips */}
                      <div style={{
                        padding: '8px 16px',
                        borderBottom: '1px solid #262626',
                        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                        fontSize: 12, color: '#aaaaaa',
                      }}>
                        <label style={{ fontWeight: 600 }}>Formation:</label>
                        <input
                          value={sel.formationName}
                          onChange={(e) => updateFormationName(sel.groupId, e.target.value)}
                          style={{
                            background: '#262626', border: '1px solid #3a3a3a', borderRadius: 3,
                            color: '#e0e0e0', fontSize: 13, padding: '3px 8px', width: 220, outline: 'none',
                            fontFamily: "'B612 Mono', monospace",
                          }}
                        />
                        <span style={{
                          fontSize: 11, color: '#d29922', background: '#1a1a10',
                          padding: '2px 8px', borderRadius: 3, border: '1px solid #3a3a1a', fontWeight: 600,
                        }}>
                          {sel.companyDesignator} Co
                        </span>
                        <span>{sel.unitCount} unit{sel.unitCount !== 1 ? 's' : ''}:</span>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {sel.units.map((u) => (
                            <span key={u.unitId} style={{
                              fontSize: 11, color: '#cccccc', background: '#262626',
                              padding: '2px 6px', borderRadius: 3, border: '1px solid #3a3a3a',
                              fontFamily: "'B612 Mono', monospace",
                            }}>
                              {u.newName}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Route — per-waypoint task table */}
                      <div style={{ padding: '12px 16px' }}>
                        <h3 style={{
                          margin: '0 0 10px',
                          fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
                          color: '#aaaaaa', fontWeight: 600,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                          <span>Route &mdash; {selWaypoints.length} waypoint{selWaypoints.length !== 1 ? 's' : ''}</span>
                          {dirtyGroups.has(sel.groupId) && (
                            <span style={{
                              color: '#d29922', fontSize: 11, fontWeight: 400,
                              textTransform: 'none', letterSpacing: 0,
                            }}>
                              changes pending — click Apply
                            </span>
                          )}
                        </h3>
                        {selWaypoints.length === 0 ? (
                          <div style={{ color: '#aaaaaa', fontSize: 13, padding: '12px 0' }}>
                            This group has no waypoints in the mission. Add waypoints in DCS ME first.
                          </div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={wpThStyle}>WP</th>
                                <th style={wpThStyle}>Position</th>
                                <th style={wpThStyle}>Task</th>
                                <th style={wpThStyle}>Parameters</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selWaypoints.map((wp) => {
                                // Two different indexing schemes are at play:
                                //
                                //   wpIndex (1-based)  — DCS Lua table position
                                //                        in route.points[N].
                                //                        This is what the backend's
                                //                        _find_waypoint_block_bounds
                                //                        scans for. Used in dispatch.
                                //   wpLabel (0-based)  — TIC's mental model
                                //                        (and the mission designer's):
                                //                        WP0 = initial / spawn position,
                                //                        WP1 = first move waypoint,
                                //                        WP2 = second move, ...
                                //                        Used in the UI label only.
                                //
                                // Parser stores `waypoint_number` 0-indexed already
                                // (miz_parser.py:737 — for F/A-18 steerpoint parity);
                                // we use that directly as the user-facing label.
                                const wpIndex = wp.waypoint_number + 1;
                                const wpLabel = wp.waypoint_number;
                                const groupTasks = taskAssignments.get(sel.groupId);
                                const fromState = groupTasks?.get(wpIndex);
                                // Seed from the waypoint NAME, not from DCS-native
                                // eta_locked — TIC ignores DCS scheduling and parses
                                // `t+N` out of the name string at runtime
                                // (TIC_v1.1.lua::extractOffsetTime). Mirror the same
                                // regex shape here so the dropdown shows what the
                                // mission designer authored.
                                // Parse v1 + v2 TIC tokens out of the existing
                                // waypoint name so the inputs render the actual
                                // current state. Each regex mirrors the Lua
                                // pattern in TIC_v1.1.lua::extract* on the
                                // runtime side — same word boundaries, same
                                // case-insensitivity.
                                const wpn = wp.waypoint_name || '';
                                const tNameMatch     = wpn.match(/\bt\+(\d+)\b/i);
                                const speedMatch     = wpn.match(/\bspeed=(\d+)\b/i);
                                const roeMatch       = wpn.match(/\broe=(simulate|kill|hold)\b/i);
                                const hdgMatch       = wpn.match(/\bhdg=(\d+)\b/i);
                                const flagWaitMatch  = wpn.match(/\bflag=(\w+)\b/i);
                                const flagSetMatch   = wpn.match(/\bflag\+(\w+)\b/i);
                                // v0.9.59 — scale/direct/strength via the same
                                // \w+ permissive shape (allowing `.` for
                                // decimals on scale and strength).
                                const scaleMatch    = wpn.match(/\bscale=([\d.]+)/i);
                                const directMatch   = wpn.match(/\bdirect=(y|n|yes|no)\b/i);
                                const strengthMatch = wpn.match(/\bstrength=([\d.]+)/i);
                                const phaseMatch    = wpn.match(/"([^"]+)"/);
                                const deployMatch   = wpn.match(/\b(mount|dismount)\b/i);
                                const nameMinutes = tNameMatch ? parseInt(tNameMatch[1], 10) : 0;
                                const action: WpActionValue = fromState?.action
                                  ?? (tNameMatch ? 'goto_at_time' : 'goto');
                                const etaSeconds = fromState?.eta_seconds ?? (nameMinutes * 60);
                                // Effective value for each v2 token: state if
                                // touched, otherwise the parsed name value (or
                                // empty when absent).
                                const eff = {
                                  speed: fromState?.speed     !== undefined
                                       ? (fromState.speed ?? '')
                                       : (speedMatch ? speedMatch[1] : ''),
                                  roe: (fromState?.roe         !== undefined
                                       ? (fromState.roe ?? '')
                                       : (roeMatch ? roeMatch[1].toLowerCase() : '')) as string,
                                  hdg: fromState?.hdg         !== undefined
                                       ? (fromState.hdg ?? '')
                                       : (hdgMatch ? hdgMatch[1] : ''),
                                  flag_wait: fromState?.flag_wait !== undefined
                                       ? (fromState.flag_wait ?? '')
                                       : (flagWaitMatch ? flagWaitMatch[1] : ''),
                                  flag_set: fromState?.flag_set   !== undefined
                                       ? (fromState.flag_set ?? '')
                                       : (flagSetMatch ? flagSetMatch[1] : ''),
                                  scale: fromState?.scale      !== undefined
                                       ? (fromState.scale ?? '')
                                       : (scaleMatch ? scaleMatch[1] : ''),
                                  direct: (fromState?.direct   !== undefined
                                       ? (fromState.direct ?? '')
                                       : (directMatch
                                           ? (directMatch[1].toLowerCase().startsWith('y') ? 'y' : 'n')
                                           : '')) as string,
                                  strength: fromState?.strength !== undefined
                                       ? (fromState.strength ?? '')
                                       : (strengthMatch ? strengthMatch[1] : ''),
                                  phase: fromState?.phase      !== undefined
                                       ? (fromState.phase ?? '')
                                       : (phaseMatch ? phaseMatch[1] : ''),
                                  deployment: (fromState?.deployment !== undefined
                                       ? (fromState.deployment ?? '')
                                       : (deployMatch ? deployMatch[1].toLowerCase() : '')) as string,
                                };
                                const touched = fromState !== undefined;
                                return (
                                  <tr key={wpIndex} style={{
                                    borderBottom: '1px solid #262626',
                                  }}>
                                    <td style={{
                                      ...wpTdStyle,
                                      boxShadow: touched ? 'inset 3px 0 0 #d29922' : 'none',
                                      paddingLeft: touched ? 6 : 0,
                                      fontFamily: "'B612 Mono', monospace",
                                      whiteSpace: 'nowrap',
                                    }}>
                                      WP{wpLabel}
                                    </td>
                                    <td style={{ ...wpTdStyle, fontFamily: "'B612 Mono', monospace", fontSize: 11, color: '#aaaaaa', whiteSpace: 'nowrap' }}>
                                      {wp.lat != null && wp.lon != null
                                        ? <>N {wp.lat.toFixed(3)}<br />E {wp.lon.toFixed(3)}</>
                                        : <>x {wp.x.toFixed(0)}<br />y {wp.y.toFixed(0)}</>
                                      }
                                    </td>
                                    <td style={wpTdStyle}>
                                      <select
                                        value={action}
                                        onChange={(e) => setWpAction(sel.groupId, wpIndex, e.target.value as WpActionValue, nameMinutes * 60)}
                                        style={tokenInputStyle(150)}
                                      >
                                        {WP_ACTIONS.map((opt) => (
                                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                      </select>
                                    </td>
                                    <td style={wpTdStyle}>
                                      {/* Parameters cell: primary param (ETA
                                          for goto_at_time) on the first row,
                                          then v2 secondary TIC tokens
                                          (speed=, roe=, hdg=, flag=, flag+)
                                          below. All v2 inputs are optional
                                          — empty means "no token for this WP";
                                          backend leaves the name untouched on
                                          that token unless the user types
                                          something or explicitly clears. */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {action === 'goto_at_time' ? (
                                          <div style={tokenRowStyle}>
                                            <span style={paramLblStyle}>T+</span>
                                            <input
                                              type="number" min={0} step={1}
                                              value={Math.round(etaSeconds / 60)}
                                              onChange={(e) => {
                                                const mins = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
                                                setWpEta(sel.groupId, wpIndex, mins * 60);
                                              }}
                                              style={tokenInputStyle(80)}
                                            />
                                            <span style={paramLblStyle}>min after previous WP</span>
                                          </div>
                                        ) : (
                                          <div style={{ ...paramLblStyle, color: '#666' }}>
                                            &mdash; no time constraint &mdash;
                                          </div>
                                        )}
                                        <div style={tokenRowStyle}>
                                          <span style={paramLblStyle}>speed</span>
                                          <input
                                            type="number" min={0} step={1}
                                            placeholder=""
                                            value={eff.speed === '' ? '' : String(eff.speed)}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setWpToken(sel.groupId, wpIndex, 'speed',
                                                v === '' ? null : Math.max(0, parseInt(v, 10) || 0));
                                            }}
                                            style={tokenInputStyle(64)}
                                            title="speed=N — unit speed in km/h"
                                          />
                                          <span style={paramLblStyle}>km/h</span>

                                          <span style={{ ...paramLblStyle, marginLeft: 8 }}>roe</span>
                                          <select
                                            value={eff.roe}
                                            onChange={(e) => {
                                              const v = e.target.value as RoeValue;
                                              setWpToken(sel.groupId, wpIndex, 'roe', v === '' ? null : v);
                                            }}
                                            style={tokenInputStyle(96)}
                                            title="roe=simulate / kill / hold"
                                          >
                                            <option value="">—</option>
                                            <option value="simulate">simulate</option>
                                            <option value="kill">kill</option>
                                            <option value="hold">hold</option>
                                          </select>

                                          <span style={{ ...paramLblStyle, marginLeft: 8 }}>hdg</span>
                                          <input
                                            type="number" min={0} max={359} step={1}
                                            placeholder=""
                                            value={eff.hdg === '' ? '' : String(eff.hdg)}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setWpToken(sel.groupId, wpIndex, 'hdg',
                                                v === '' ? null : Math.max(0, Math.min(359, parseInt(v, 10) || 0)));
                                            }}
                                            style={tokenInputStyle(64)}
                                            title="hdg=N — heading degrees (0–359)"
                                          />
                                          <span style={paramLblStyle}>°</span>
                                        </div>
                                        <div style={tokenRowStyle}>
                                          <span style={paramLblStyle}>wait flag</span>
                                          <input
                                            type="text"
                                            placeholder=""
                                            value={String(eff.flag_wait ?? '')}
                                            onChange={(e) => {
                                              const v = e.target.value.trim();
                                              setWpToken(sel.groupId, wpIndex, 'flag_wait', v === '' ? null : v);
                                            }}
                                            style={tokenInputStyle(96)}
                                            title="flag=X — TIC waits for flag X to be true before proceeding"
                                          />
                                          <span style={{ ...paramLblStyle, marginLeft: 8 }}>set flag</span>
                                          <input
                                            type="text"
                                            placeholder=""
                                            value={String(eff.flag_set ?? '')}
                                            onChange={(e) => {
                                              const v = e.target.value.trim();
                                              setWpToken(sel.groupId, wpIndex, 'flag_set', v === '' ? null : v);
                                            }}
                                            style={tokenInputStyle(96)}
                                            title="flag+X — TIC sets flag X true on arrival"
                                          />
                                        </div>
                                        {/* v0.9.59 row: scale + direct + strength */}
                                        <div style={tokenRowStyle}>
                                          <span style={paramLblStyle}>scale</span>
                                          <input
                                            type="number" min={0} max={2} step={0.1}
                                            placeholder=""
                                            value={eff.scale === '' ? '' : String(eff.scale)}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setWpToken(sel.groupId, wpIndex, 'scale', v === '' ? null : v);
                                            }}
                                            style={tokenInputStyle(72)}
                                            title="scale=N.M — formation scale factor (0.5 tight, 1.0 default, 2.0 spread)"
                                          />
                                          <span style={{ ...paramLblStyle, marginLeft: 8 }}>direct</span>
                                          <select
                                            value={eff.direct ?? ''}
                                            onChange={(e) => {
                                              const v = e.target.value as 'y' | 'n' | '';
                                              setWpToken(sel.groupId, wpIndex, 'direct', v === '' ? null : v);
                                            }}
                                            style={tokenInputStyle(64)}
                                            title="direct=y/n — skip to this WP straight (retreat logic when combined with strength=)"
                                          >
                                            <option value="">—</option>
                                            <option value="y">y</option>
                                            <option value="n">n</option>
                                          </select>
                                          <span style={{ ...paramLblStyle, marginLeft: 8 }}>strength</span>
                                          <input
                                            type="number" min={0} max={1} step={0.1}
                                            placeholder=""
                                            value={eff.strength === '' ? '' : String(eff.strength)}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setWpToken(sel.groupId, wpIndex, 'strength', v === '' ? null : v);
                                            }}
                                            style={tokenInputStyle(72)}
                                            title="strength=N.M — combat-effectiveness threshold (0.0-1.0); below this the formation moves to this WP. Pair with direct=y for retreat."
                                          />
                                        </div>
                                        {/* v0.9.59 row: phase + deployment */}
                                        <div style={tokenRowStyle}>
                                          <span style={paramLblStyle}>phase</span>
                                          <input
                                            type="text"
                                            placeholder=""
                                            value={String(eff.phase ?? '')}
                                            onChange={(e) => {
                                              const v = e.target.value.trim();
                                              setWpToken(sel.groupId, wpIndex, 'phase', v === '' ? null : v);
                                            }}
                                            style={tokenInputStyle(140)}
                                            title='"phase_name" — quoted phase identifier; TIC groups all WPs with the same phase together'
                                          />
                                          <span style={{ ...paramLblStyle, marginLeft: 8 }}>deploy</span>
                                          <select
                                            value={eff.deployment ?? ''}
                                            onChange={(e) => {
                                              const v = e.target.value as DeploymentValue;
                                              setWpToken(sel.groupId, wpIndex, 'deployment', v === '' ? null : v);
                                            }}
                                            style={tokenInputStyle(112)}
                                            title="mount / dismount — infantry-carrier load/unload at this WP"
                                          >
                                            <option value="">—</option>
                                            <option value="mount">mount</option>
                                            <option value="dismount">dismount</option>
                                          </select>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Apply bar at bottom */}
          <div style={{
            marginTop: 16, padding: '12px 14px',
            background: '#222222', border: '1px solid #3a3a3a', borderRadius: 4,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ fontSize: 13, color: '#aaaaaa' }}>
              {(() => {
                const total = assignments.length;
                const appliedCount = assignments.filter((a) => appliedGroups.has(a.groupId) && !dirtyGroups.has(a.groupId)).length;
                const dirtyCount = dirtyGroups.size;
                if (appliedCount === total && dirtyCount === 0) {
                  return `All ${total} groups applied — download your .miz to save.`;
                }
                if (dirtyCount > 0) {
                  return `${appliedCount} of ${total} applied · ${dirtyCount} with pending waypoint changes`;
                }
                return `Ready to apply ${total} group${total !== 1 ? 's' : ''}.`;
              })()}
            </div>
            <button
              onClick={applyAll}
              disabled={assignments.length === 0}
              style={{
                ...btnStyle,
                background: '#1a3a1a',
                border: '1px solid #3fb950',
                color: '#3fb950',
                fontSize: 14,
                padding: '8px 20px',
                fontWeight: 600,
              }}
            >
              Apply All
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
  background: '#3a3a3a',
  border: '1px solid #3a3a3a',
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
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: 13,
  padding: '6px 8px',
  outline: 'none',
  fontFamily: 'inherit',
};

// === v0.9.42 side-panel layout styles ===

const listColumnStyle: React.CSSProperties = {
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  overflow: 'hidden',
  alignSelf: 'flex-start',
  maxHeight: 600,
  overflowY: 'auto',
};

const listHeaderStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #3a3a3a',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#aaaaaa',
  background: '#1d1d1d',
  fontWeight: 600,
};

const listRowStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #262626',
  cursor: 'pointer',
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  transition: 'background 0.1s',
};

const detailColumnStyle: React.CSSProperties = {
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 360,
};

const wpThStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#aaaaaa',
  fontWeight: 600,
  padding: '6px 8px 6px 0',
  borderBottom: '1px solid #3a3a3a',
};

const wpTdStyle: React.CSSProperties = {
  padding: '8px 8px 8px 0',
  verticalAlign: 'middle',
};

const paramLblStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#aaaaaa',
};

// v0.9.57 — compact inline inputs for the per-WP TIC-token row.
// `width` lets each input size to its content (speed/hdg are short
// numbers; flag identifiers are slightly wider).
function tokenInputStyle(width: number): React.CSSProperties {
  return {
    background: '#262626',
    border: '1px solid #3a3a3a',
    color: '#e0e0e0',
    fontFamily: "'B612 Mono', monospace",
    fontSize: 12.5,
    padding: '4px 6px',
    borderRadius: 3,
    outline: 'none',
    width,
    boxSizing: 'border-box',
  };
}

const tokenRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
};
