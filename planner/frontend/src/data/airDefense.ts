/**
 * Air-defense reference data — the ONE table for SAM/AAA/EWR systems.
 *
 * Source file is planner/backend/data/air_defense_db.json, imported straight
 * from the backend tree so Flask (threat rings, /api/sam-ranges) and every
 * frontend consumer (AEGIS setup, threat library, kneeboard threat card) read
 * identical numbers. Before this there were six hand-kept copies that
 * disagreed (SA-5 WEZ 55 vs 125 NM, SA-2/3/5 missing from the ring table,
 * Patriot/Avenger keyed on type names DCS doesn't use).
 *
 * Edit the JSON, not this file. AEGIS values mirror AEGIS.SYSTEM_DB in the
 * bundled Lua — the engine is authoritative for those.
 */
import db from '../../../backend/data/air_defense_db.json';

export type AirDefenseRole = 'sam' | 'ew';
export type AirDefenseCategory = 'strategic' | 'medium' | 'short' | 'shorad' | 'manpad' | 'aaa' | 'ew';
export type AegisCat = 'AREA' | 'SHORAD' | 'PD';

export interface AegisSystemData {
  code: string;
  /** NM */
  wez: number;
  /** NM */
  nez: number;
  /** NM */
  actRange: number;
  /** feet MSL — AEGIS compares against altitude MSL, not AGL */
  altMin: number;
  /** feet MSL */
  altMax: number;
  cat: AegisCat;
  needsPower?: boolean;
  trackRadars: string[];
}

export interface AirDefenseSystem {
  id: string;
  role: AirDefenseRole;
  nato: string;
  system: string;
  guidance: string;
  guidanceShort: string;
  category: AirDefenseCategory;
  rangeKm: number;
  altMinFt?: number;
  altMaxFt?: number;
  /** true = nominal figure (EW detection), not a hard engagement limit */
  approx?: boolean;
  types: string[];
  match: string[];
  aegis?: AegisSystemData;
}

export const AIR_DEFENSE_SYSTEMS: readonly AirDefenseSystem[] =
  (db as { systems: AirDefenseSystem[] }).systems;

/** Search-radar types AEGIS can use as EW nodes (SAM-site acquisition radars). */
export const AEGIS_SEARCH_RADAR_TYPES: readonly string[] =
  (db as { aegisSearchRadarTypes: string[] }).aegisSearchRadarTypes;

/** Standalone early-warning radar types. */
export const EWR_TYPES: readonly string[] =
  AIR_DEFENSE_SYSTEMS.filter((s) => s.role === 'ew').flatMap((s) => s.types);

/** Systems AEGIS knows, in DB order. */
export const AEGIS_SYSTEMS: readonly (AirDefenseSystem & { aegis: AegisSystemData })[] =
  AIR_DEFENSE_SYSTEMS.filter((s): s is AirDefenseSystem & { aegis: AegisSystemData } => !!s.aegis);

const byType = new Map<string, AirDefenseSystem>();
for (const s of AIR_DEFENSE_SYSTEMS) for (const t of s.types) byType.set(t, s);

/**
 * Look a DCS unit type up: exact type match first, then the ordered
 * case-insensitive substring keys (first system in DB order wins).
 */
export function lookupAirDefense(unitType: string): AirDefenseSystem | null {
  const exact = byType.get(unitType);
  if (exact) return exact;
  const lower = unitType.toLowerCase();
  for (const s of AIR_DEFENSE_SYSTEMS) {
    for (const key of s.match) {
      if (lower.includes(key.toLowerCase())) return s;
    }
  }
  return null;
}
