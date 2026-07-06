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

/**
 * Civilian Air Traffic — curated real-world corridors (the "anti-RAT"
 * approach). One self-contained per-map script (config table + spawn engine
 * inline; no MOOSE/MIST) is bundled and loaded on MISSION START. Infinite,
 * density-capped, F10-controllable. Requires the Civil Aircraft Mod and
 * country EGYPT in the neutrals coalition. (v1.19.110)
 */
const CIVTRAFFIC_BY_THEATER: Record<string, string> = {
  caucasus: 'CivTraffic-Caucasus.lua',
  persiangulf: 'CivTraffic-PersianGulf.lua',
  syria: 'CivTraffic-Syria.lua',
  nevada: 'CivTraffic-Nevada.lua',
  marianaislands: 'CivTraffic-MarianaIslands.lua',
  sinai: 'CivTraffic-Sinai.lua',
  sinaimap: 'CivTraffic-Sinai.lua',
  falklands: 'CivTraffic-Falklands.lua',
  southatlantic: 'CivTraffic-Falklands.lua',
  afghanistan: 'CivTraffic-Afghanistan.lua',
  kola: 'CivTraffic-Kola.lua',
  iraq: 'CivTraffic-Iraq.lua',
  germanycw: 'CivTraffic-GermanyColdWar.lua',
  germanycoldwar: 'CivTraffic-GermanyColdWar.lua',
};

/** The civilian-traffic script for a theater, or null if this map isn't
 *  supported yet. Match is case / space / punctuation-insensitive. */
export function civTrafficScriptForTheater(theater: string | undefined): FrameworkScript | null {
  if (!theater) return null;
  const key = theater.toLowerCase().replace(/[^a-z]/g, '');
  const file = CIVTRAFFIC_BY_THEATER[key];
  return file ? { name: `Civ Traffic (${theater})`, bundledFile: file } : null;
}

/**
 * Civilian Ship Traffic — sister of Civ Traffic for SHIPPING (v1.19.111).
 * Real-world lanes as TSS-style one-way pairs, pre-seeded along their length
 * at mission start (ships are slow — the sea starts populated), anchorage
 * queues at ports, fishing fleets inshore. Stock DCS ships — no mods needed.
 * Water maps only: Nevada/Afghanistan are landlocked; Iraq's coastal sliver
 * isn't covered yet.
 */
const SHIPTRAFFIC_BY_THEATER: Record<string, string> = {
  caucasus: 'ShipTraffic-Caucasus.lua',
  persiangulf: 'ShipTraffic-PersianGulf.lua',
  syria: 'ShipTraffic-Syria.lua',
  marianaislands: 'ShipTraffic-MarianaIslands.lua',
  sinai: 'ShipTraffic-Sinai.lua',
  sinaimap: 'ShipTraffic-Sinai.lua',
  falklands: 'ShipTraffic-Falklands.lua',
  southatlantic: 'ShipTraffic-Falklands.lua',
  kola: 'ShipTraffic-Kola.lua',
  germanycw: 'ShipTraffic-GermanyColdWar.lua',
  germanycoldwar: 'ShipTraffic-GermanyColdWar.lua',
};

/** The ship-traffic script for a theater, or null if this map has no
 *  shipping lanes (landlocked or not yet covered). */
export function shipTrafficScriptForTheater(theater: string | undefined): FrameworkScript | null {
  if (!theater) return null;
  const key = theater.toLowerCase().replace(/[^a-z]/g, '');
  const file = SHIPTRAFFIC_BY_THEATER[key];
  return file ? { name: `Ship Traffic (${theater})`, bundledFile: file } : null;
}

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
