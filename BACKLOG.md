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

- **Per-unit visibility for flight leads (intel control).** Mission
  maker wants to expose some units on the battlefield to joined
  flight leads while hiding others — same shape as the threat-card
  fog-of-war but per-unit and authored by the mission maker, not a
  global fidelity toggle. Use case: the briefed target is visible
  ("here's the convoy you're hunting"), but the surprise SAM that
  pops up at the IP is hidden until game time, so flight leads
  can't pre-plan their evasion. Mission maker always sees every
  unit; flight leads see only what's been opted in.
  Implementation sketch:
    - Add a `plannerVisibleToParticipants: boolean` flag per
      MissionGroup (default true so existing missions stay
      unchanged).
    - Mission-maker-only UI to toggle it — probably right-click
      on the map marker → "Hide from flight leads", plus a
      bulk "Visibility" tab listing every unit with checkboxes.
    - Map render layer filters units by role: `role === 'mission_maker'
      || group.plannerVisibleToParticipants !== false`.
    - Threat rings should respect the flag too (a hidden SAM
      shouldn't leak via its threat ring).
    - Persist into the .miz under a planner-private mission key
      (same pattern as `["plannerDmpis"]` in v0.9.15) so the
      visibility plan round-trips through download/re-upload.
  The role + assignedGroup machinery already exists in
  `useMissionStore`; the missing piece is the per-unit flag plus
  the render-time filter.

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
