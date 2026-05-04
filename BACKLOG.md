# Backlog

Living list of ideas + open work. Not a hard plan — items here are
candidates, not commitments. Roughly ordered by user-visible impact,
not effort.

## Map UX

- **Map unit-type filter dropdown.** Today the map's "filter out
  units" UI is binary — units are either visible or hidden.
  Add a dropdown / multiselect so the user can pick which TYPES
  of units render (e.g. show only carriers + tankers, or hide
  ground vehicles to declutter a CAS planning view). Should
  probably live next to the existing visibility toggle on the
  map control strip. Affects `MapContainer.tsx` + the unit-render
  layer; the unit-type metadata is already on each MissionGroup.

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
