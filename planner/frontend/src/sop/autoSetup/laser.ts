/**
 * Laser-code applier (v1.19.80) — stamps the SOP laser ladder onto
 * every laser-capable unit whose code is off-SOP.
 *
 * A squadron laser SOP hands out sequential codes from a base so no two
 * shooters share a code (no laser fratricide). This applier computes
 * that ladder (assignLaserLadder — the same function the Laser tab's
 * Auto Assign and SOP Check use) and stages a `laserCode` unit edit for
 * each unit currently off its slot. Plan-driven only: when the SOP
 * defines no laserCodeBase there is nothing to enforce.
 *
 * The backend `_replace_laser_code` writes the code onto every
 * laser-guided pylon of the unit, inserting the field when absent.
 */

import { assignLaserLadder } from '../laserLadder';
import type { LaserCapableUnit, UnitEdit } from '../../types/mission';
import type { SOP } from '../types';
import type { AutoSetupAction } from './types';

export function applyLaserCodesSop(
  laserUnits: LaserCapableUnit[],
  sop: SOP,
): AutoSetupAction {
  if (sop.laserCodeBase == null) {
    return {
      category: 'Laser',
      description: 'No SOP laser code base',
      edits: [], itemsAffected: 0,
      skippedReason: 'Active SOP has no laserCodeBase',
    };
  }
  if (laserUnits.length === 0) {
    return {
      category: 'Laser',
      description: 'No laser-capable units in mission',
      edits: [], itemsAffected: 0,
      skippedReason: 'Mission has no laser-guided shooters',
    };
  }

  const ladder = assignLaserLadder(laserUnits, sop.laserCodeBase);
  const edits: UnitEdit[] = [];
  const details: string[] = [];

  for (const u of laserUnits) {
    const want = ladder.get(u.unitId);
    if (want == null || u.laserCode === want) continue;
    edits.push({ unitId: u.unitId, field: 'laserCode', value: want } as UnitEdit);
    details.push(`${u.groupName} / ${u.name}: ${u.laserCode ?? '—'} → ${want}`);
  }

  if (edits.length === 0) {
    return {
      category: 'Laser',
      description: `${laserUnits.length} laser unit${laserUnits.length !== 1 ? 's' : ''} already on the SOP ladder`,
      edits: [], itemsAffected: 0,
      skippedReason: 'All laser codes already match the SOP ladder',
    };
  }

  return {
    category: 'Laser',
    description: `Set ${edits.length} laser code${edits.length !== 1 ? 's' : ''} from the SOP ladder (base ${sop.laserCodeBase})`,
    edits,
    itemsAffected: edits.length,
    details,
  };
}
