# DCS Amber preview (v0.9.65)

Experiment: swap the primary editor accent from the orange we picked
during the warm-grey sweep (`#ffa500`) to the gold-amber DCS uses in
its in-game UI (`#fbb941`). The amber is taken from the Carrier GUI's
`carrier-gui.dlg` LabelSkin text color — the one explicit color in
that file, the rest deferred to DCS's built-in skins.

Why: the orange reads slightly "construction-cone"; the amber reads
"cockpit instrument lighting / squadron patch metalwork" — closer to
what Fett sees inside DCS itself when planning a mission.

## What changed

Editor-only sweep. Kneeboard cards were deliberately NOT touched —
those render to PNG and ship into DCS as physical artefacts; treat
them as a separate visual surface.

| File | Count |
|---|---|
| `editor/tabs/BriefGenTab.tsx` | 8 |
| `editor/tabs/AtisConfigTab.tsx` | 1 |
| `editor/tabs/DtcTab.tsx` | 1 |
| `editor/tabs/RadioPresetsSection.tsx` | 1 |

All occurrences of `#ffa500` → `#fbb941`. No other colors moved.

## Files NOT touched (intentional)

- `kneeboard/cardStyles.ts` (`ACCENT = '#ffa500'`) — kneeboard PNGs
- `kneeboard/RouteCard.tsx` — same surface
- `kneeboard/captureRoute.ts` — route layer waypoint dot color
- Sidebar active-tab indicator (`#4a8fd4` cool blue, unchanged)
- Background palette (greys, unchanged)

## Reverting

If the amber doesn't land:

```bash
cd planner/frontend/src/editor/tabs
# Reverse sweep on the four files we touched
sed -i 's/#fbb941/#ffa500/g' BriefGenTab.tsx AtisConfigTab.tsx DtcTab.tsx RadioPresetsSection.tsx
```

Or just `git revert <v0.9.65 sha>` for a clean undo commit.

## If we keep it

Follow-up to consider:
- Sweep kneeboard cards too (`cardStyles.ts:15`, `RouteCard.tsx:45`,
  `captureRoute.ts:23`) so the brief/kneeboard surfaces stay in sync.
- Centralise into a `theme/colors.ts` constants file so future tweaks
  don't need a multi-file sweep.
