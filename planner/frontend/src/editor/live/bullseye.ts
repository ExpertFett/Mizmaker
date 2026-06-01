/**
 * Bullseye math for the LotATC-style controller scope (Phase 5).
 *
 * Real GCI controllers vector by BULLSEYE bearing/range — a fixed point per
 * coalition agreed in the brief. Every track call ("Picture: 2 contacts,
 * bullseye 350/40, 18 angels, hot") refers to it. Without a bullseye the
 * BRA tool still works but the picture sounds wrong on the radio.
 *
 * Source of truth is `missionStore.overview.bullseye.blue` (lat/lon shipped
 * by the backend's miz_parser). When a mission isn't loaded — or the .miz
 * doesn't define one — the DM can drop a manual bullseye anywhere on the
 * map and the same math + labels apply.
 *
 * Convention: bearing is TRUE from the BULLSEYE outward to the track,
 * 3-digit padded; range in NM rounded to integer for ≥10, 1 decimal under.
 * Format matches what controllers actually say on the radio:
 *   "bullseye 350/40"  →  bearing 350°, 40 NM out
 */

import { trueBearingDeg, distanceM, type LL } from './braCalc';

const NM_PER_M = 1 / 1852;

export interface BullseyeBR {
  bearingDeg: number;
  rangeNm: number;
}

/** Compute bearing+range from bullseye to a track. Always defined when
 *  both points are valid lat/lon; callers must handle null bullseye. */
export function bullseyeBR(bullseye: LL, track: LL): BullseyeBR {
  return {
    bearingDeg: trueBearingDeg(bullseye, track),
    rangeNm: distanceM(bullseye, track) * NM_PER_M,
  };
}

/** Format a bullseye call the way a controller says it on the radio:
 *  `bullseye 350/40` (range padded to integer ≥10 / 1 decimal under). */
export function formatBullseye(br: BullseyeBR, opts: { tag?: string; decorate?: boolean } = {}): string {
  const { tag = 'bullseye', decorate = true } = opts;
  const brg = String(Math.round(br.bearingDeg) % 360).padStart(3, '0');
  const rng = br.rangeNm >= 10 ? br.rangeNm.toFixed(0) : br.rangeNm.toFixed(1);
  return decorate ? `${tag} ${brg}/${rng}` : `${brg}/${rng}`;
}
