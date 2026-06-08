/**
 * Renamer applier — extracted from RenamerTab's handleApplySopCallsigns.
 *
 * Walks player flights (planes/helos with Client/Player skill), pairs
 * each with the next SOP flight by priority, and emits a groupRename
 * edit. Number suffixes are preserved: "Bengal 1" → "Enfield 1",
 * "Bengal 2" → "Enfield 2". Units inside each group are renamed to
 * match: "Bengal 1-1" → "Enfield 1-1".
 */

import { isPlayerGroup } from '../../utils/groups';
import type { MissionGroup, UnitEdit } from '../../types/mission';
import type { SOP } from '../types';
import type { AutoSetupAction } from './types';

export function applyRenamerSop(groups: MissionGroup[], sop: SOP): AutoSetupAction {
  const sopFlightsSorted = [...sop.flights]
    .filter((f) => f.callsign)
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  if (sopFlightsSorted.length === 0) {
    return {
      category: 'Renamer',
      description: 'No SOP flight callsigns to apply',
      edits: [], itemsAffected: 0,
      skippedReason: 'SOP has no flight callsigns defined',
    };
  }

  const playerGroups = groups.filter((g) =>
    isPlayerGroup(g) && (g.category === 'plane' || g.category === 'helicopter'),
  );

  if (playerGroups.length === 0) {
    return {
      category: 'Renamer',
      description: 'No player flights to rename',
      edits: [], itemsAffected: 0,
      skippedReason: 'Mission has no Client/Player groups',
    };
  }

  const edits: UnitEdit[] = [];
  const details: string[] = [];
  // v1.19.55 — track every newGroupName we emit so we can de-collide
  // when two source groups would land on the same name. Previously the
  // dup case silently shipped TWO flights both called "Vic-1" — DCS
  // tolerates it but the planner / brief generator can't tell them
  // apart. Tester report: "the group unit renamer isn't working
  // properly, it's made two flights into vic-1 it's not adding the -
  // in most the names, so it looks like vic1 etc"
  const usedNames = new Set<string>();

  for (let i = 0; i < playerGroups.length; i++) {
    const g = playerGroups[i];
    const sopFlight = sopFlightsSorted[i];
    if (!sopFlight) break;  // ran out of SOP entries; remaining flights stay as-is

    // v1.19.55 — Preserve the SEPARATOR + number suffix from the
    // original name. The old regex was /(\s*\d+)\s*$/ which captured
    // ONLY whitespace before digits, so "Bengal-1" produced suffix "1"
    // (dash silently dropped) and newGroupName became "Vic1". Now the
    // regex also accepts dash / underscore so "Bengal-1" → "Vic-1",
    // "Bengal_2" → "Vic_2", "Bengal 3" → "Vic 3".
    const numMatch = g.groupName.match(/([\s_-]*)(\d+)\s*$/);
    const numSuffix = numMatch ? numMatch[2] : '';
    let sep = numMatch ? numMatch[1] : '';
    // If the original had a number with no separator at all
    // ("Bengal1"), assume the user wants a dash — that's the
    // squadron-callsign convention ("Vic-1", "Enfield-1") and was the
    // shape Fett's testers expected.
    if (numSuffix && !sep) sep = '-';
    let newGroupName = numSuffix
      ? `${sopFlight.callsign}${sep}${numSuffix}`
      : sopFlight.callsign;

    // v1.19.55 — de-collide. If "Vic-1" is already taken (two source
    // groups had the same trailing number, or the SOP has two flights
    // with the same callsign), append "-2", "-3", … until we find a
    // free name. This keeps the planner + brief generator able to tell
    // the flights apart and matches what a human would write by hand.
    if (usedNames.has(newGroupName)) {
      let bump = 2;
      let candidate = `${newGroupName}-${bump}`;
      while (usedNames.has(candidate)) {
        bump++;
        candidate = `${newGroupName}-${bump}`;
      }
      newGroupName = candidate;
    }
    usedNames.add(newGroupName);

    // Build per-unit name map (lead → "newName-1", wingman → "newName-2", ...)
    const unitNamesObj: Record<number, string> = {};
    g.units.forEach((u, idx) => {
      unitNamesObj[u.unitId] = `${newGroupName}-${idx + 1}`;
    });

    edits.push({
      groupId: g.groupId, field: 'groupRename',
      value: { groupId: g.groupId, newGroupName, unitNames: unitNamesObj },
    } as UnitEdit);

    details.push(`${g.groupName} → ${newGroupName}`);
  }

  return {
    category: 'Renamer',
    description: edits.length === playerGroups.length
      ? `Renamed all ${edits.length} player flight${edits.length !== 1 ? 's' : ''}`
      : `Renamed ${edits.length} of ${playerGroups.length} player flights (SOP ran out of entries)`,
    edits,
    itemsAffected: edits.length,
    details,
  };
}
