/**
 * Laser-code ladder — pure helpers shared by the Laser tab, the SOP
 * Check discrepancy engine, and the Auto-Setup laser applier (v1.19.80,
 * task #61 follow-up). Extracted from LaserTab so all three compute the
 * IDENTICAL expected code per unit — otherwise SOP Check would flag a
 * unit as off-SOP that the Laser tab's "Auto Assign" had just set.
 *
 * DCS laser codes are 4 digits, each 1-7 (8 and 9 are invalid). A
 * squadron laser SOP deconflicts every laser shooter in the mission by
 * handing out sequential codes from a base (e.g. 1611), so no two units
 * share a code → no laser fratricide. That's why the ladder runs across
 * ALL laser-capable units, not just player flights.
 */

import type { LaserCapableUnit } from '../types/mission';

/**
 * Increment a laser code by one, rolling each digit 1→7 with carry so
 * every digit stays in the valid 1-7 range. 1617 → 1621, 1677 → 1711.
 */
export function nextLaserCode(code: number): number {
  let d1 = Math.floor(code / 1000) % 10;
  let d2 = Math.floor(code / 100) % 10;
  let d3 = Math.floor(code / 10) % 10;
  let d4 = code % 10;
  d4 += 1;
  if (d4 > 7) { d4 = 1; d3 += 1; }
  if (d3 > 7) { d3 = 1; d2 += 1; }
  if (d2 > 7) { d2 = 1; d1 += 1; }
  if (d1 > 7) d1 = 1; // wrap to 1111 — unreachable with normal mission sizes
  return d1 * 1000 + d2 * 100 + d3 * 10 + d4;
}

/** Clamp every digit of a code into the valid 1-7 range. */
export function clampToValidLaserCode(n: number): number {
  const d1 = Math.floor(n / 1000) % 10;
  const d2 = Math.floor(n / 100) % 10;
  const d3 = Math.floor(n / 10) % 10;
  const d4 = n % 10;
  const clamp = (d: number) => (d < 1 ? 1 : d > 7 ? 7 : d);
  return clamp(d1) * 1000 + clamp(d2) * 100 + clamp(d3) * 10 + clamp(d4);
}

/**
 * Compute the expected laser code for every unit: a continuous ladder
 * from `base`, grouped by flight name in list order (the same order the
 * Laser tab iterates, since the store sorts laserCapableUnits by
 * groupName). Returns Map<unitId, code>.
 *
 * This is THE single source of truth for "what code should this unit
 * have" — the Laser tab's Auto Assign, SOP Check, and the applier all
 * call it so they can never disagree.
 */
export function assignLaserLadder(
  units: LaserCapableUnit[],
  base: number,
): Map<number, number> {
  // Sort by group name before grouping so the ladder is deterministic
  // regardless of input order — callers no longer have to pre-sort to
  // agree with SOP Check (Array.sort is stable, so within-group unit
  // order is preserved). Matches the store's groupName.localeCompare sort.
  const sorted = [...units].sort((a, b) => (a.groupName || '').localeCompare(b.groupName || ''));
  const grouped = new Map<string, LaserCapableUnit[]>();
  for (const u of sorted) {
    let arr = grouped.get(u.groupName);
    if (!arr) { arr = []; grouped.set(u.groupName, arr); }
    arr.push(u);
  }

  const out = new Map<number, number>();
  let next = clampToValidLaserCode(base);
  for (const [, groupUnits] of grouped) {
    for (const u of groupUnits) {
      out.set(u.unitId, next);
      next = nextLaserCode(next);
    }
  }
  return out;
}
