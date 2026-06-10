/**
 * Types shared by the Auto-Setup orchestrator and per-area appliers.
 *
 * Each applier is a pure function over (state, sop) that returns a
 * single AutoSetupAction. The orchestrator collects these into a
 * report and dispatches the aggregated edit list. UI renders the
 * report.
 *
 * Pure-function design: appliers don't touch React, don't mutate
 * stores, don't fetch from the network. They take state in, hand
 * edits + a description out. That makes them testable in Vitest
 * without mounting any tabs or rendering anything.
 */

import type { UnitEdit, WaypointEdit } from '../../types/mission';
import type { DiscrepancyRow } from '../discrepancy';

export type AutoSetupCategory =
  | 'Renamer'
  | 'Datalink'
  | 'Radio'
  | 'Comms'
  | 'Carriers';

/** One applier's output. Always returned — even when nothing was done
 *  (itemsAffected: 0) — so the report can show a complete picture. */
export interface AutoSetupAction {
  category: AutoSetupCategory;
  /** Short status line for the report ("Renamed 4 player flights"). */
  description: string;
  /** Edits to push into the editStore queue. May be empty. */
  edits: (UnitEdit | WaypointEdit)[];
  /** Number of mission items the action touched. Drives the summary. */
  itemsAffected: number;
  /** Optional per-item rows ("Bengal 1 → Enfield 1") for the modal. */
  details?: string[];
  /** Set when the applier short-circuited and explains why. The action
   *  is still listed in the report so the user knows it ran. */
  skippedReason?: string;
}

/** Aggregated output of runAutoSetup. */
export interface AutoSetupReport {
  /** Friendly name of the SOP that drove the run. */
  sopName: string;
  /** One entry per applier, in execution order. */
  actions: AutoSetupAction[];
  /** Sum of edits across actions. */
  totalEdits: number;
  /** Sum of itemsAffected across actions. */
  totalItems: number;
  /** Pulled from buildReport() — every place the mission still
   *  disagrees with the SOP after the auto-pass. The user clicks
   *  through to the SOP Check tab from here. */
  discrepancies: DiscrepancyRow[];
}
