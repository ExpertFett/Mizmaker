/**
 * Helper for AEGIS / TIC apply-button auto-trigger wiring (v1.19.54).
 *
 * Tester ask: "when someone presses the apply button for AEGIS or TIC, make
 * sure it auto puts in the triggers that pull up the script etc."
 *
 * Without this, the user had to:
 *   1. Apply renames in Scripts > AEGIS (or TIC)
 *   2. Navigate to Triggers tab
 *   3. Find AEGIS / TIC / MOOSE / MIST in the script library sidebar
 *   4. Click "+ Add to Triggers" for each one in the right order
 * Now step (1) does steps 2-4 automatically — the user opens the Triggers
 * tab and the load triggers are already there.
 *
 * The helper is idempotent: if a DO_SCRIPT_FILE rule for the same
 * bundledFile already exists, we don't add a duplicate. So re-clicking
 * Apply (e.g. after tweaking the setup) doesn't pile up triggers.
 */

import { useTriggerStore } from '../../store/triggerStore';
import type { TriggerRule } from '../../types/mission';

export interface FrameworkScript {
  /** Human-readable name; becomes the rule's `name` field as
   *  `"Script: <name>"`. */
  name: string;
  /** Filename in planner/backend/assets/scripts. Used in the DO_SCRIPT_FILE
   *  action's params.file. */
  bundledFile: string;
}

/**
 * The AEGIS bundle — load order is enforced by the planner's trigger
 * sequencer (TIME MORE > 1 / > 2). MOOSE loads first, then AEGIS IADS
 * (v0.8.4 = the vetted-stable variant), then the user's setup script.
 *
 * We deliberately pick the v0.8.4 file rather than v0.9.0 or v0.9.1 —
 * the dynamic / networked variants are opt-in (still UNTESTED per
 * their own docstrings) and the user can swap to them via the Triggers
 * library after the fact if they want.
 */
export const AEGIS_BUNDLE: FrameworkScript[] = [
  { name: 'MOOSE Framework', bundledFile: 'Moose_.lua' },
  { name: 'AEGIS IADS', bundledFile: 'aegis-iads-v0.8.4-beta.lua' },
];

/**
 * TIC bundle. MOOSE + MIST are both common dependencies; TIC_v1.1
 * itself loads after them.
 */
export const TIC_BUNDLE: FrameworkScript[] = [
  { name: 'MOOSE Framework', bundledFile: 'Moose_.lua' },
  { name: 'MIST (Mission Scripting Tools)', bundledFile: 'mist.lua' },
  { name: 'TIC (Troops in Contact)', bundledFile: 'TIC_v1.1.lua' },
];

/** Does the trigger list already carry a DO_SCRIPT_FILE rule for this
 *  file? Used to avoid duplicate rules on re-apply. */
function ruleAlreadyExists(rules: TriggerRule[], bundledFile: string): boolean {
  return rules.some((r) =>
    (r.actions ?? []).some((a) =>
      a.type === 'DO_SCRIPT_FILE'
      && (a.params as { file?: string })?.file === bundledFile,
    ),
  );
}

/**
 * Append the given framework scripts to the trigger list (mission-start,
 * enabled, no conditions). Skips scripts that already have a matching
 * DO_SCRIPT_FILE rule, so re-applying the panel is safe.
 *
 * Returns the names of newly-added scripts so the caller can surface a
 * status message. Empty array = nothing was added (everything was
 * already wired).
 */
export function addFrameworkTriggers(scripts: FrameworkScript[]): string[] {
  const added: string[] = [];
  const { addRule, updateRule } = useTriggerStore.getState();
  for (const s of scripts) {
    const current = useTriggerStore.getState().rules;
    if (ruleAlreadyExists(current, s.bundledFile)) continue;
    addRule();
    const newest = useTriggerStore.getState().rules.slice(-1)[0];
    if (!newest) continue;
    updateRule(newest.id, {
      name: `Script: ${s.name}`,
      eventType: 'onMissionStart',
      enabled: true,
      conditions: [],
      actions: [{ type: 'DO_SCRIPT_FILE', params: { file: s.bundledFile } } as never],
    });
    added.push(s.name);
  }
  return added;
}
