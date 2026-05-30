/**
 * Planner mode — a curated, planning-only face of the SAME codebase.
 *
 * DCS:OPT normally lets you *edit* a .miz (loadout, livery, coalitions,
 * triggers, …) and download the modified file. "Planner mode" hides all of
 * that and exposes only the planning + reference + output surface: map/routes,
 * threats, DMPI, range, bomb-wind, SOP, goals, weather (reference), the
 * radio/datalink/DTC references, and the kneeboard/brief outputs. The
 * modified-.miz download is removed — planner mode never writes back to the
 * mission file, it only produces planning artefacts (kneeboards, brief, DTC,
 * planning JSON).
 *
 * It's a flag on the same build so the two faces never drift: deploy a second
 * Railway instance of this repo with VITE_PLANNER_MODE=true and you get the
 * planner; the default build is byte-for-byte the full editor (flag off ⇒
 * zero behaviour change). For local testing, append ?planner to the URL.
 *
 * Standing rule (Fett): the original editor must not be touched. This module
 * is purely additive and gated — with the flag OFF nothing below applies.
 */

function detectPlannerMode(): boolean {
  // Build-time flag (primary): set VITE_PLANNER_MODE=true on the planner deploy.
  if (import.meta.env.VITE_PLANNER_MODE === 'true') return true;
  // Runtime override (dev/testing): ?planner or ?planner=1 in the URL.
  try {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search);
      if (q.has('planner') && q.get('planner') !== '0' && q.get('planner') !== 'false') {
        return true;
      }
    }
  } catch {
    /* ignore — SSR / no window */
  }
  return false;
}

export const PLANNER_MODE: boolean = detectPlannerMode();

/**
 * Editor sidebar tabs that remain visible in planner mode. Everything not in
 * this set is hidden (the .miz-editing tabs: Coalitions, Mission, Carriers,
 * Scripts, Triggers, Loadout, Livery, Edits preview, Debug, Tools).
 *
 * Kept = planning + read-only references + outputs. Note: weather / radio /
 * datalink / DTC are kept as REFERENCES — they feed the kneeboard/brief/DTC
 * outputs. Since planner mode never downloads a modified .miz, any tweaks made
 * there only shape the planning artefacts, not the mission file.
 */
export const PLANNER_TAB_IDS: ReadonlySet<string> = new Set([
  // SETUP — map/routes + weather reference
  'map', 'weather',
  // PLANNING — threats, target points, range planning
  'threats', 'dmpi', 'rangePlan',
  // FLIGHTS — loadout + DTC
  'weapons', 'dtc',
  // OUTPUT — kneeboard preview/export (added 2026-05-27 per Fett: planners need
  // to see/produce kneeboards inside the planning face too, not bounce out to
  // Editing for the artefact they're trying to build).
  'kneeboard',
  // UTIL — let the planner load a different mission
  'upload',
  // NOTE: SOP / SOP Check / Goals / Visibility / Datalink / Radio / Brief are
  // still Editing-only — the mission editor handles those before (and after)
  // planning. Bomb Wind was removed from the app entirely.
]);

/* -------------------------------------------------------------------------
 * App modes
 *
 * After a mission is loaded, the user picks one of three modes from a
 * switcher at the top of the sidebar:
 *   - 'editing'  — the full editor (original behaviour, every tab + .miz download)
 *   - 'planning' — the curated PLANNER_TAB_IDS subset, no .miz writeback
 *   - 'live'     — Olympus / live-server bridge (STUB for now; wires up after
 *                  Olympus Phase 2)
 *
 * The VITE_PLANNER_MODE flag (PLANNER_MODE above) locks the whole build to
 * Planning and hides the switcher — for a dedicated planning-only deploy.
 * Otherwise the default is Editing (so the full editor is unchanged) and the
 * choice is remembered in localStorage.
 * ----------------------------------------------------------------------- */

export type AppMode = 'planning' | 'editing' | 'live';

/** When true (VITE_PLANNER_MODE set), the app is locked to Planning and the
 *  mode switcher is hidden. */
export const LOCK_TO_PLANNING: boolean = PLANNER_MODE;

const MODE_LS_KEY = 'dcsopt.appMode.v1';
const EMPTY_TABS: ReadonlySet<string> = new Set();

export function loadInitialMode(): AppMode {
  if (LOCK_TO_PLANNING) return 'planning';
  try {
    const m = localStorage.getItem(MODE_LS_KEY);
    if (m === 'planning' || m === 'editing' || m === 'live') return m;
  } catch {
    /* ignore */
  }
  return 'editing'; // default keeps the original full editor
}

export function saveMode(mode: AppMode): void {
  if (LOCK_TO_PLANNING) return; // nothing to persist when locked
  try {
    localStorage.setItem(MODE_LS_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Editor tab ids visible in a given mode. 'all' means the full sidebar
 *  (Editing). Live has no editor tabs yet — it renders its own placeholder. */
export function tabsForMode(mode: AppMode): ReadonlySet<string> | 'all' {
  if (mode === 'editing') return 'all';
  if (mode === 'planning') return PLANNER_TAB_IDS;
  return EMPTY_TABS; // 'live' (stub)
}
