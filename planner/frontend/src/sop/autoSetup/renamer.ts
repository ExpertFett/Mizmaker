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

  for (let i = 0; i < playerGroups.length; i++) {
    const g = playerGroups[i];
    const sopFlight = sopFlightsSorted[i];
    if (!sopFlight) break;  // ran out of SOP entries; remaining flights stay as-is

    // Preserve trailing number suffix from existing name
    const numMatch = g.groupName.match(/(\s*\d+)\s*$/);
    const numSuffix = numMatch ? numMatch[1] : '';
    const newGroupName = `${sopFlight.callsign}${numSuffix}`;

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
