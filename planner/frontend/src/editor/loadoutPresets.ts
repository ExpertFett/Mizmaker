/**
 * Loadout presets for the Loadout tab.
 *
 * A preset is a priority-ordered list of weapon patterns. To apply a preset
 * to a flight, for each pylon we scan the pylon's valid options (from
 * pylonOptions[aircraftType][pylonNum]) and install the highest-priority
 * pattern that matches. Non-weapon items (fuel tanks, ECM pods, targeting
 * pods, etc.) are preserved by default so flights keep the support gear that
 * makes them functional.
 *
 * Presets are aircraft-agnostic — they describe weapon families, not specific
 * CLSIDs. So the same "SEAD" preset works on an F-16, F/A-18, or Tornado.
 */

import type { PylonInfo } from '../types/mission';

export interface PresetWeapon {
  /** Short label shown to the user when we install this weapon. */
  label: string;
  /** Match against pylon option name/shortName/CLSID (case insensitive). */
  match: RegExp;
}

export interface LoadoutPreset {
  id: string;
  label: string;
  description: string;
  color: string;
  /**
   * Priority-ordered weapons. For each replaceable pylon we install the FIRST
   * entry whose pattern is in the pylon's valid options.
   */
  weapons: PresetWeapon[];
  /**
   * Optional self-defense weapons (usually AIM-9/AIM-120). Tried if no primary
   * weapon matched — lets a SEAD pylon that can't fit a HARM take a Sidewinder
   * instead of going empty.
   */
  selfDefense?: PresetWeapon[];
  /**
   * If true, empty EVERY pylon (even support gear). Used for "Clean".
   */
  wipeAll?: boolean;
}

// Patterns for weapons we generally recognize — tuned against DCS weapon names
// which use forms like "AGM-88C HARM", "GBU-12 Paveway II", "AIM-120C-5 AMRAAM".
const HARM = { label: 'AGM-88 HARM', match: /AGM[-\s]?88/i };
const SHRIKE = { label: 'AGM-45 Shrike', match: /AGM[-\s]?45/i };
const MAVERICK_LASER = { label: 'AGM-65E/L Maverick (laser)', match: /AGM[-\s]?65[EKL]/i };
const MAVERICK_IR = { label: 'AGM-65D/G Maverick (IR)', match: /AGM[-\s]?65[DG]/i };
const MAVERICK_GEN = { label: 'AGM-65 Maverick', match: /AGM[-\s]?65/i };
const HELLFIRE = { label: 'AGM-114 Hellfire', match: /AGM[-\s]?114/i };
const HARPOON = { label: 'AGM-84 Harpoon', match: /AGM[-\s]?84(?!.*SLAM)/i };
const SLAM = { label: 'AGM-84 SLAM', match: /SLAM/i };
const JSOW = { label: 'AGM-154 JSOW', match: /AGM[-\s]?154/i };
const STORMSHADOW = { label: 'Storm Shadow', match: /Storm\s*Shadow|SCALP/i };

const GBU_12 = { label: 'GBU-12 Paveway II (500lb LGB)', match: /GBU[-\s]?12/i };
const GBU_10 = { label: 'GBU-10 Paveway II (2000lb LGB)', match: /GBU[-\s]?10/i };
const GBU_16 = { label: 'GBU-16 Paveway II (1000lb LGB)', match: /GBU[-\s]?16/i };
const GBU_24 = { label: 'GBU-24 Paveway III (2000lb LGB)', match: /GBU[-\s]?24/i };
const GBU_38 = { label: 'GBU-38 JDAM (500lb GPS)', match: /GBU[-\s]?38/i };
const GBU_31 = { label: 'GBU-31 JDAM (2000lb GPS)', match: /GBU[-\s]?31/i };
const GBU_32 = { label: 'GBU-32 JDAM (1000lb GPS)', match: /GBU[-\s]?32/i };
const GBU_54 = { label: 'GBU-54 Laser JDAM (500lb)', match: /GBU[-\s]?54/i };
const MK82 = { label: 'Mk-82 (500lb GP)', match: /Mk[-\s]?82(?!.*Snake|.*AIR)/i };
const MK82_AIR = { label: 'Mk-82 AIR / Snakeye', match: /Mk[-\s]?82.*(AIR|Snake)/i };
const MK83 = { label: 'Mk-83 (1000lb GP)', match: /Mk[-\s]?83/i };
const MK84 = { label: 'Mk-84 (2000lb GP)', match: /Mk[-\s]?84/i };
const CBU_87 = { label: 'CBU-87 (cluster)', match: /CBU[-\s]?87/i };
const CBU_97 = { label: 'CBU-97 (SFW)', match: /CBU[-\s]?97/i };
const CBU_99 = { label: 'CBU-99 Rockeye', match: /CBU[-\s]?99|Rockeye/i };
const CBU_103 = { label: 'CBU-103 WCMD', match: /CBU[-\s]?103/i };
const CBU_105 = { label: 'CBU-105 WCMD SFW', match: /CBU[-\s]?105/i };

const HYDRA = { label: 'Hydra 70 rockets', match: /LAU[-\s]?(61|68|131).*Hydra|Hydra\s*70/i };
const APKWS = { label: 'APKWS guided rockets', match: /APKWS/i };

const AIM_120C = { label: 'AIM-120C AMRAAM', match: /AIM[-\s]?120C/i };
const AIM_120 = { label: 'AIM-120 AMRAAM', match: /AIM[-\s]?120/i };
const AIM_7 = { label: 'AIM-7 Sparrow', match: /AIM[-\s]?7/i };
const AIM_9X = { label: 'AIM-9X Sidewinder', match: /AIM[-\s]?9X/i };
const AIM_9 = { label: 'AIM-9 Sidewinder', match: /AIM[-\s]?9/i };
const AIM_54 = { label: 'AIM-54 Phoenix', match: /AIM[-\s]?54/i };

const ASELF = [AIM_9X, AIM_9, AIM_120C, AIM_120];

export const LOADOUT_PRESETS: LoadoutPreset[] = [
  {
    id: 'sead',
    label: 'SEAD',
    description: 'Suppression of Enemy Air Defenses — anti-radiation missiles',
    color: '#d29922',
    weapons: [HARM, SHRIKE],
    selfDefense: ASELF,
  },
  {
    id: 'dead',
    label: 'DEAD',
    description: 'Destruction of Enemy Air Defenses — HARMs + PGMs',
    color: '#d97050',
    weapons: [HARM, GBU_31, GBU_24, GBU_12, MAVERICK_LASER, JSOW, MAVERICK_GEN],
    selfDefense: ASELF,
  },
  {
    id: 'cas',
    label: 'CAS',
    description: 'Close Air Support — PGMs, Mavericks, cluster, GP bombs',
    color: '#3fb950',
    weapons: [
      MAVERICK_LASER, MAVERICK_IR, MAVERICK_GEN, HELLFIRE,
      GBU_54, GBU_38, GBU_12, APKWS, HYDRA,
      CBU_105, CBU_103, CBU_97, CBU_87, CBU_99,
      MK82_AIR, MK82,
    ],
    selfDefense: ASELF,
  },
  {
    id: 'strike',
    label: 'STRIKE',
    description: 'Fixed target strike — heavy PGMs and dumb bombs',
    color: '#ff6b8a',
    weapons: [
      GBU_31, GBU_24, GBU_10, GBU_32, GBU_16, GBU_12, GBU_38,
      JSOW, SLAM, STORMSHADOW,
      MK84, MK83, MK82_AIR, MK82,
    ],
    selfDefense: ASELF,
  },
  {
    id: 'cap',
    label: 'CAP',
    description: 'Combat Air Patrol — air-to-air only',
    color: '#d49a30',
    weapons: [AIM_120C, AIM_120, AIM_54, AIM_9X, AIM_9, AIM_7],
  },
  {
    id: 'antiship',
    label: 'ANTI-SHIP',
    description: 'Maritime strike — Harpoons and SLAMs',
    color: '#d95050',
    weapons: [HARPOON, SLAM],
    selfDefense: ASELF,
  },
  {
    id: 'clean',
    label: 'CLEAN',
    description: 'Empty every pylon',
    color: '#3a4248',
    weapons: [],
    wipeAll: true,
  },
];

/**
 * Categories/name patterns we consider "support" and leave untouched when
 * applying a preset. Fuel tanks, ECM, targeting pods, sensor pods, datalink.
 */
const SUPPORT_CATEGORY = /Fuel|ECM|Targeting|Sensor|IRST|FLIR|Navigation|Datalink/i;
const SUPPORT_NAME = /Fuel\s*Tank|ALQ|LITENING|LANTIRN|Sniper|ATFLIR|IRST|TGP|TPOD|TPodZ|MFPU|DLPod/i;
const FUEL_NAME = /Fuel\s*Tank|FPU[-_]?\d+|FUEL_TANK|330\s*gal|480\s*gal|600\s*gal/i;

/**
 * Per-airframe preferred fuel tank pylon layout ("Double Ugly" for Hornets).
 * When applying a preset to one of these jets, fuel tanks on pylons NOT in the
 * list are cleared so they become available for weapons. Other airframes keep
 * whatever fuel config the mission had.
 */
const PREFERRED_FUEL_PYLONS: Record<string, number[]> = {
  // F/A-18C Hornet: Double Ugly = 2 tanks (centerline + right inner), pylon 3 free
  'FA-18C_hornet': [5, 7],
  // F/A-18F Super Hornet (lineages differ, same default)
  'FA-18E': [5, 7],
  'FA-18F': [5, 7],
};

function pylonIsSupport(pylon: PylonInfo): boolean {
  if (pylon.category && SUPPORT_CATEGORY.test(pylon.category)) return true;
  if (pylon.name && SUPPORT_NAME.test(pylon.name)) return true;
  if (pylon.shortName && SUPPORT_NAME.test(pylon.shortName)) return true;
  return false;
}

function pylonIsFuelTank(pylon: PylonInfo): boolean {
  if (!pylon.clsid) return false;
  if (pylon.name && FUEL_NAME.test(pylon.name)) return true;
  if (pylon.shortName && FUEL_NAME.test(pylon.shortName)) return true;
  if (pylon.category && /Fuel/i.test(pylon.category)) return true;
  return false;
}

/**
 * Should we keep this support pylon as-is when applying a preset? For most
 * items yes — but for fuel tanks on Hornets, we honor the preferred 2-tank
 * layout so SEAD/CAS/etc. presets end up with the Double Ugly config.
 */
function shouldKeepSupport(pylon: PylonInfo, pnum: number, aircraftType?: string): boolean {
  if (!pylonIsSupport(pylon)) return false;
  if (pylonIsFuelTank(pylon) && aircraftType && PREFERRED_FUEL_PYLONS[aircraftType]) {
    return PREFERRED_FUEL_PYLONS[aircraftType].includes(pnum);
  }
  return true;
}

function optionMatches(opt: PylonInfo, pattern: RegExp): boolean {
  return pattern.test(opt.clsid) || pattern.test(opt.name) || pattern.test(opt.shortName);
}

export interface PresetPylonResult {
  pylon: number;
  clsid: string;       // '' = empty
  label: string;       // short name of installed weapon or 'Empty'
  kept?: boolean;      // true if we left the pylon alone (support item)
}

/**
 * Plan preset application for a single unit. Returns one entry per pylon
 * number in the unit's valid options. Caller translates this into edits.
 *
 * validOptions: map of pylon_number_string → valid PylonInfo[] for that pylon
 * currentPylons: the unit's current pylons (from store)
 * aircraftType: e.g. "FA-18C_hornet" — enables airframe-specific behavior
 *   like Hornet's Double Ugly (2-tank) fuel layout
 */
export function planPresetForUnit(
  preset: LoadoutPreset,
  validOptions: Record<string, PylonInfo[]>,
  currentPylons: PylonInfo[],
  aircraftType?: string,
): PresetPylonResult[] {
  const results: PresetPylonResult[] = [];
  const currentByNum = new Map<number, PylonInfo>();
  for (const p of currentPylons) currentByNum.set(p.number, p);

  const pylonNums = Object.keys(validOptions)
    .map((k) => parseInt(k, 10))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);

  const preferredFuelPylons = aircraftType ? PREFERRED_FUEL_PYLONS[aircraftType] : undefined;

  for (const pnum of pylonNums) {
    const current = currentByNum.get(pnum);
    const opts = validOptions[String(pnum)] || [];

    if (preset.wipeAll) {
      results.push({ pylon: pnum, clsid: '', label: 'Empty' });
      continue;
    }

    // Airframe-specific: on Hornets, if this pylon should carry a fuel tank
    // per the Double Ugly config and currently doesn't, install one.
    if (preferredFuelPylons && preferredFuelPylons.includes(pnum)) {
      const currentIsFuel = current ? pylonIsFuelTank(current) : false;
      if (currentIsFuel && current) {
        // Already has a tank, keep it
        results.push({ pylon: pnum, clsid: current.clsid, label: current.shortName || current.name, kept: true });
        continue;
      }
      // Find a fuel tank option for this pylon and install it
      const tankOpt = opts.find((o) => pylonIsFuelTank(o));
      if (tankOpt) {
        results.push({ pylon: pnum, clsid: tankOpt.clsid, label: tankOpt.shortName || 'Fuel Tank' });
        continue;
      }
      // No tank option available — fall through to weapon selection
    }

    // Preserve support items — but honor airframe fuel preference
    if (current && current.clsid && shouldKeepSupport(current, pnum, aircraftType)) {
      results.push({ pylon: pnum, clsid: current.clsid, label: current.shortName || current.name, kept: true });
      continue;
    }

    // Try primary weapons in priority order
    let chosen: { opt: PylonInfo; label: string } | null = null;
    for (const w of preset.weapons) {
      const hit = opts.find((o) => optionMatches(o, w.match));
      if (hit) { chosen = { opt: hit, label: hit.shortName || w.label }; break; }
    }
    // Fallback to self-defense
    if (!chosen && preset.selfDefense) {
      for (const w of preset.selfDefense) {
        const hit = opts.find((o) => optionMatches(o, w.match));
        if (hit) { chosen = { opt: hit, label: hit.shortName || w.label }; break; }
      }
    }

    if (chosen) {
      results.push({ pylon: pnum, clsid: chosen.opt.clsid, label: chosen.label });
    } else {
      // No weapon match.
      // If this pylon currently has a fuel tank we *don't* want (Hornet pylon 3
      // with a tank, for example), empty it so the user can slot something in.
      if (current && current.clsid && pylonIsFuelTank(current) && preferredFuelPylons && !preferredFuelPylons.includes(pnum)) {
        results.push({ pylon: pnum, clsid: '', label: 'Empty (dropped tank)' });
        continue;
      }
      // Otherwise leave it as-is.
      if (current && current.clsid) {
        results.push({ pylon: pnum, clsid: current.clsid, label: current.shortName || current.name, kept: true });
      } else {
        results.push({ pylon: pnum, clsid: '', label: 'Empty', kept: true });
      }
    }
  }

  return results;
}
