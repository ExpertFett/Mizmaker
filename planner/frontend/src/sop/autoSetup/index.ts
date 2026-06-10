/**
 * Auto-Setup orchestrator — runs every per-area applier in sequence
 * and aggregates the results into a single AutoSetupReport.
 *
 * Pure-function design: takes (groups, clientUnits, sop), returns
 * a report. The caller (sidebar Auto-Setup button) is responsible
 * for dispatching report.actions.flatMap(a => a.edits) into the
 * editStore and rendering the modal. That separation keeps this
 * file unit-testable in Vitest without touching React.
 *
 * Order matters: Renamer runs FIRST so subsequent appliers (Radio
 * presets, Datalink) see the new group names if they're in the
 * post-rename state. In practice the appliers are all pure and
 * mostly orthogonal — but locking the order keeps the report
 * reproducible.
 */

import { buildReport } from '../discrepancy';
import { applyRenamerSop } from './renamer';
import { applyDatalinkSop } from './datalink';
import { applyRadioSop } from './radio';
import { applyCommAssetsSop } from './comms';
import { applyCarriersSop } from './carriers';
import type { ClientUnit, MissionGroup } from '../../types/mission';
import type { SOP } from '../types';
import type { AutoSetupReport, AutoSetupAction } from './types';

export type { AutoSetupReport, AutoSetupAction, AutoSetupCategory } from './types';

export function runAutoSetup(
  groups: MissionGroup[],
  clientUnits: ClientUnit[],
  sop: SOP,
): AutoSetupReport {
  // Run each applier. Any thrown exception becomes a "failed" action
  // so a single broken applier can't take the whole run down.
  const actions: AutoSetupAction[] = [
    safelyRun('Renamer', () => applyRenamerSop(groups, sop)),
    safelyRun('Datalink', () => applyDatalinkSop(clientUnits, sop)),
    safelyRun('Radio', () => applyRadioSop(groups, sop)),
    safelyRun('Comms', () => applyCommAssetsSop(groups, sop)),
    safelyRun('Carriers', () => applyCarriersSop(groups, sop)),
  ];

  // Discrepancies are the post-pass picture: things the SOP says that
  // the auto-pass couldn't address. The user clicks through to the
  // SOP Check tab to drill in.
  const discrepancies = buildReport(groups, sop);

  return {
    sopName: sop.name,
    actions,
    totalEdits: actions.reduce((sum, a) => sum + a.edits.length, 0),
    totalItems: actions.reduce((sum, a) => sum + a.itemsAffected, 0),
    discrepancies,
  };
}

function safelyRun(
  category: AutoSetupAction['category'],
  fn: () => AutoSetupAction,
): AutoSetupAction {
  try {
    return fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      category,
      description: `Applier failed`,
      edits: [], itemsAffected: 0,
      skippedReason: `${msg}`,
    };
  }
}
