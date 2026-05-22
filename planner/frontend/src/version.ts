/**
 * App version — bumped manually on each meaningful deploy so testers and
 * Fett can confirm at a glance which build is live. Displayed on the
 * upload screen header.
 *
 * Versioning convention (kept loose):
 *   v0.1 — initial planner upload + map
 *   v0.2 — kneeboard cards
 *   v0.3 — SOP system + visual rework (kneeboard palette, square corners)
 *   v0.4 — brief generator (wing + per-flight, PPTX/PDF/PNG/JPG export)
 *
 * After each push to origin/main that meaningfully changes user-visible
 * behaviour, bump the patch number. The patch number resets when the
 * minor bumps (e.g. v0.4.5 → v0.5.0).
 */
export const VERSION = 'v1.0.0-beta';
