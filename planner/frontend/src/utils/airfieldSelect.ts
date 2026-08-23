/**
 * Which airfields get a diagram.
 *
 * A theatre has dozens of fields and a flight cares about a handful: where it
 * launches from, where it recovers, and the nearest places it could go if
 * something breaks. Anything without a runway is filtered out — those records
 * are ICAO stubs the theatre data carries alongside the real field, and a jet
 * cannot use them regardless.
 */

import type { Airbase, MissionGroup } from '../types/mission';

const NM_PER_DEG_LAT = 60;

function nmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * NM_PER_DEG_LAT;
  const dLon = (aLon - bLon) * NM_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Fields worth a diagram for this flight, nearest first, home plate leading.
 *
 * Enemy-held fields are excluded: a diagram is a divert aid, and the Airbase
 * Reference card already lists hostile fields for identification.
 */
export function airfieldsForFlight(
  group: MissionGroup | undefined,
  airbases: Airbase[],
  coalition: string,
  limit = 4,
): Airbase[] {
  const usable = airbases.filter(
    (a) => a.lat != null && a.lon != null
      && (a.runways?.length ?? 0) > 0
      && (a.coalition === 'neutral' || a.coalition === coalition));

  // Collapse the duplicate records the theatre data carries for one field.
  const byPos = new Map<string, Airbase>();
  for (const a of usable) {
    const key = `${a.lat!.toFixed(2)},${a.lon!.toFixed(2)}`;
    if (!byPos.has(key)) byPos.set(key, a);
  }
  const pool = [...byPos.values()];

  const origin = group?.waypoints?.[0];
  if (origin?.lat == null || origin.lon == null) return pool.slice(0, limit);

  return pool
    .map((a) => ({ a, d: nmBetween(origin.lat!, origin.lon!, a.lat!, a.lon!) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, limit)
    .map(({ a }) => a);
}
