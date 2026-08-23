/**
 * A laser code for every aircrew, not just the ones carrying an LGB.
 *
 * The mission file only records a laser code where a pylon carries something
 * that uses one, so a jet without a laser-guided store came through with no
 * code at all and the flight card printed a dash. That is the wrong model for
 * how a squadron briefs: codes are assigned to aircrew, not to stores. A jet
 * with four slicks today may still be asked to buddy-lase for someone, or to
 * take a handoff, and it needs a briefed code to do it.
 *
 * So: real codes always win — whatever is actually loaded is what the card
 * shows. Everyone else gets the next code off the SOP ladder, skipping any
 * code already in use anywhere in the mission so two jets are never briefed
 * the same one.
 *
 * This deliberately does NOT feed the Laser tab's applier. That tab edits the
 * codes the mission actually stores, which only exist on laser-carrying
 * pylons; the extra codes here are briefing assignments for jets the .miz has
 * nowhere to record them on.
 */

import { nextLaserCode, clampToValidLaserCode } from './laserLadder';

/** Where the ladder starts when the SOP does not say. Valid DCS codes are
 *  1xxx with each remaining digit 1-7; 1511 is a common squadron start. */
export const DEFAULT_LASER_BASE = 1511;

interface UnitLike {
  unitId: number;
  groupName?: string;
  laserCode?: number | null;
}

/**
 * Map every unit to a laser code.
 *
 * `units` should be every unit the ladder must stay unique across — pass the
 * whole mission's client units, not one flight, or two flights will collide.
 * Sorted by group name first so the ladder is stable regardless of input
 * order, matching assignLaserLadder.
 */
export function assignFlightLaserCodes(
  units: UnitLike[],
  base: number = DEFAULT_LASER_BASE,
): Map<number, number> {
  // Group name then unit id. The secondary key matters: sorting on the group
  // alone leaves wingmen in whatever order the caller happened to pass, so
  // the same flight could be briefed different codes between two renders.
  // DCS numbers units sequentially within a group, so unit id is also flight
  // order in practice.
  const sorted = [...units].sort((a, b) =>
    (a.groupName || '').localeCompare(b.groupName || '') || (a.unitId - b.unitId));

  // Every code the mission already commits to. Reserved before handing any
  // out, so a jet late in the ladder cannot be given a code that a jet
  // earlier in the list is actually carrying.
  const taken = new Set<number>();
  for (const u of sorted) {
    if (u.laserCode != null) taken.add(u.laserCode);
  }

  const out = new Map<number, number>();
  let next = clampToValidLaserCode(base);
  const claimNext = (): number => {
    // Bounded: the 1xxx/1-7 space is 343 codes, so give up rather than spin
    // if a mission somehow reserves all of them.
    for (let i = 0; i < 343; i++) {
      const code = next;
      next = nextLaserCode(next);
      if (!taken.has(code)) { taken.add(code); return code; }
    }
    return next;
  };

  for (const u of sorted) {
    out.set(u.unitId, u.laserCode != null ? u.laserCode : claimNext());
  }
  return out;
}

/** True when this unit's code is a briefing assignment rather than something
 *  actually loaded — the card dims those so nobody reads an assigned code as
 *  a configured one. */
export function isAssignedCode(unit: UnitLike): boolean {
  return unit.laserCode == null;
}
