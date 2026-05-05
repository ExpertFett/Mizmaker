# Backlog

Living list of ideas + open work. Not a hard plan — items here are
candidates, not commitments. Roughly ordered by user-visible impact,
not effort.

## Map UX

- ~~**Map unit-type filter dropdown.**~~ Shipped in v0.9.24 — inline
  collapsible "Unit Types (N/5)" dropdown in the LayerSwitcher with
  per-category checkboxes for plane / helicopter / ship / vehicle /
  static, plus All / None bulk toggles. Replaces the v0.9.23 single
  Statics toggle.

## Collaboration / Roles

- **Per-unit visibility for flight leads (intel control).**
  - ✅ v0.9.25 shipped: useVisibilityStore + Visibility tab + map
    render filter for unit markers and routes. Mission makers see
    every group; flight leads see only what's opted in.
  - ✅ v0.9.26 shipped: planner-private `["plannerHiddenGroups"]`
    writer + parser; visibility plan round-trips through download
    / re-upload.
  - ✅ v0.9.27 shipped: ThreatRing.groupId in the backend payload
    (future-proofing for when flight leads see threats), plus a
    "Preview as Flight Lead" toggle on the Visibility tab so the
    mission maker can render their map exactly as a joined
    participant would see it for sanity-checking the intel plan.
  - ✅ v0.9.28 shipped: right-click context menu on unit markers
    with "Hide from flight leads" / "Show to flight leads" toggle.
    Closes the visibility feature loop — quick path for ad-hoc
    hides while looking at the map, bulk Visibility tab for
    multi-group operations.

## Persistence

- **Goals/DMPI roundtrip integration test.** We have unit tests for
  the writer and the reader independently, but no end-to-end test
  that uploads simple.miz → writes goals → downloads → re-uploads
  the downloaded bytes → verifies the upload response includes the
  same goals. Strong correctness signal for the .miz roundtrip.
- **Phase 2 Supabase implementation.** Blocked on user provisioning
  the Supabase project + creds. Auth scope decided: invite-only.

## Debug auto-fix

- **LHA waypoint speed clamp.** Issue is detected but no auto-fix
  attached because waypoint edits go through the route-edit endpoint
  rather than the `unitEdits` dispatcher. Either wire the debug Apply
  path through both code paths, OR add a unit-edit handler that
  mutates the session's `group_waypoints` dict before .miz repack.

## Frontend hygiene

- **Migrate more tabs to TextInput / Select primitives.** v0.9.18
  did GoalsTab + DmpiTab. Top candidates by inline-style hits:
  AtisConfigTab, CarrierSetupPanel, BatchEditTab, DatalinkTab.
  Opportunistic — touch a tab, swap its inputs.
- **Split TriggerTab.tsx (2,852 LOC).** Largest monolith. Break
  out per-feature subcomponents.
- **Split DtcTab.tsx (1,723 LOC) + WeatherTab.tsx (1,612 LOC).**

## Long-term

- **Proper Lua parsing.** Replace ±N-char regex window editing with
  parse → mutate → serialise. Big rewrite — needs the test suite as
  a regression net, which we now have.
