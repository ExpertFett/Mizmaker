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
  // SETUP
  'map', 'sop', 'sopCheck', 'goals', 'weather',
  // PLANNING
  'threats', 'dmpi', 'visibility', 'rangePlan', 'windCalc',
  // FLIGHTS — kept as references (feed kneeboards / brief / DTC export)
  'radio', 'datalink', 'dtc',
  // OUTPUT
  'kneeboard', 'briefGen',
  // UTIL — let the planner load a different mission
  'upload',
]);
