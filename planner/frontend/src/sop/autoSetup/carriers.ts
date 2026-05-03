/**
 * Carriers applier — dispatches `tacan` edits for any carrier groups
 * whose TACAN config we can derive from the active SOP.
 *
 * Note: this only handles the TACAN override on the carrier UNIT.
 * Full carrier setup (ICLS, ACLS, recovery scripts, deck crew)
 * still happens in the Carriers tab and requires user interaction
 * for ICLS deconfliction + script generation. Auto-Setup gets you
 * to "TACAN matches SOP" in one click; you still open the tab to
 * generate the wave/recovery triggers.
 */

import { isCarrierGroup } from '../../utils/groups';
import { matchCarrierTacan } from '../discrepancy';
import type { MissionGroup, UnitEdit } from '../../types/mission';
import type { SOP } from '../types';
import type { AutoSetupAction } from './types';

export function applyCarriersSop(groups: MissionGroup[], sop: SOP): AutoSetupAction {
  const carriers = groups.filter(isCarrierGroup);

  if (carriers.length === 0) {
    return {
      category: 'Carriers',
      description: 'No carriers in mission',
      edits: [], itemsAffected: 0,
      skippedReason: 'Mission has no carrier groups',
    };
  }

  if (!sop.tacans || sop.tacans.length === 0) {
    return {
      category: 'Carriers',
      description: 'SOP has no TACAN entries',
      edits: [], itemsAffected: 0,
      skippedReason: 'SOP has no TACAN entries to override with',
    };
  }

  const edits: UnitEdit[] = [];
  const details: string[] = [];

  for (const g of carriers) {
    const sopT = matchCarrierTacan(g, sop);
    if (!sopT) continue;  // SOP doesn't speak about this carrier; skip

    // Skip if mission already matches — avoids producing no-op edits
    // that bloat the queue.
    const ch = g.tacan?.channel ?? null;
    const band = g.tacan?.band ?? null;
    const cs = g.tacan?.callsign ?? '';
    if (ch === sopT.channel && band === sopT.band && cs === (sopT.callsign ?? '')) {
      continue;
    }

    // Carrier TACANs in DCS are unit-level — emitted as `tacan` edits
    // anchored on the carrier's first unit. Same shape the
    // CarrierSetupPanel auto-detect produces when the user clicks Apply.
    const carrierUnit = g.units[0];
    if (!carrierUnit) continue;

    edits.push({
      unitId: carrierUnit.unitId,
      field: 'tacan',
      value: {
        channel: sopT.channel,
        band: sopT.band,
        callsign: sopT.callsign ?? '',
      },
    } as UnitEdit);
    details.push(
      `${g.groupName}: ${ch ? `${ch}${band ?? ''}` : 'unset'} → `
      + `${sopT.channel}${sopT.band}${sopT.callsign ? ' ' + sopT.callsign : ''} (matched "${sopT.role}")`,
    );
  }

  return {
    category: 'Carriers',
    description: edits.length > 0
      ? `Overrode TACAN on ${edits.length} carrier${edits.length !== 1 ? 's' : ''}`
      : 'No carrier TACAN overrides needed',
    edits,
    itemsAffected: edits.length,
    details,
    ...(edits.length === 0 && carriers.length > 0
      ? { skippedReason: 'All carriers already match SOP TACAN entries' }
      : {}),
  };
}
