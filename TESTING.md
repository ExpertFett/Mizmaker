# DCS:OPT — stuff to test (scratch checklist)

Everything here is on the **`dev`** branch / your **local** servers
(`localhost:5173`) unless marked LIVE. Local scratch file — not committed.

Legend: ☐ = to test · 🟢 = works on localhost, no setup · 🔵 = needs Supabase
creds in `planner/backend/.env` · 🎮 = needs DCS / a live mission · 🚀 = only
testable in prod after "ship it"

---

## Editor — works on localhost right now (🟢)

- ☐ **Roster tab** (FLIGHTS → Roster) on a mission that has player/client slots:
  - ☐ Paste or upload a CSV (e.g. `Pilot,Callsign,Flight,Seat`)
  - ☐ Columns auto-detect; fix any with the dropdowns
  - ☐ Auto-match fills slots; correct any with the per-slot dropdown
  - ☐ **Apply Roster**, then **Download**, open the .miz in the DCS ME →
        confirm voice callsigns + pilot/slot names are set
  - ☐ Bottom "Roster reference" table reads correctly (screenshot test)
- ☐ **MOOSE/MIST** (Triggers → script library):
  - ☐ **MIST** now appears in the list
  - ☐ Add MOOSE + MIST to triggers, download, unzip the .miz → both .lua
        embedded in `l10n/DEFAULT/`; MOOSE banner = 2.9.17, MIST = 4.5.126
- ☐ **Weapon-employment kneeboards** (Kneeboard tab → enable "Weapon Reference"):
  - ☐ A weapon-picker appears; pick stores (AIM-9X, GBU-12, AGM-65, etc.)
  - ☐ Each picked store shows as a card in the preview carousel
  - ☐ Download → `Weapon_N.png` images present, content reads correctly
  - ⚠️ Content is reference-level + carries a "verify vs NATOPS" disclaimer —
        as the instructor, check the figures/switchology and tell me any fixes
  - ☐ (deferred) auto-inject per flight's actual loadout — currently manual pick
- ☐ **Missions-edited counter**: edit + download any mission → reload the
      homepage → footer shows `🎯 1 missions edited`
      (NOTE: local resets when the backend restarts — that's expected; it
       persists for real only in prod after the migration, see 🚀 below)

## Live map — localhost, but the Live tab needs Supabase creds (🔵 + 🎮)

(Drop `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` into `planner/backend/.env`,
tell me, I'll restart the backend. Then the local backend talks to your DCS
Olympus server directly.)

- ☐ **Map polish**:
  - ☐ Air units' triangles point in their direction of travel (heading)
  - ☐ Dead units render dimmed/hollow
  - ☐ 🏷 button in the left tool rail toggles unit-name labels
  - ⚠️ If heading arrows point the wrong way, tell me — Olympus may send
        degrees not radians (I added a guard but can't verify without live data)
- ☐ **IADS generator** (◎ IADS mode) — *the big one*:
  - ☐ Draw a **circle** (click center, set radius) — overlay matches ground scale
  - ☐ Draw a **polygon** (click vertices, ≥3) — Undo/Clear work
  - ☐ **Tier buttons** (Light/Medium/Heavy) fill the composition sensibly
  - ☐ **Generate** spawns the sites in the area

## DCS-side validation — the real unknowns (🎮)

- ☐ **Dynamic AEGIS**: load `aegis-iads-v0.9.0-beta-dynamic.lua` in a mission
      with `dynamicDiscovery = true`. Spawn (via IADS mode or Olympus):
  - ☐ an **SA-15** (self-contained) → appears, AEGIS log shows
        `*** DYNAMIC SAM adopted:`, it EMCON-cycles / engages
  - ☐ an **SA-6** (multi-vehicle) → **does one spawn call create ONE linked,
        functional battery?** ← this answers whether the area-SAM recipes work
        or need rework. Tell me the result.
  - ☐ a **1L13 EWR** → adopted as a tracked EW

## Prod only — after you "ship it" (🚀)

- ☐ Run `planner/backend/migrations/0003_stats.sql` in the Supabase SQL editor
      (one paste) so the missions-edited counter **persists across deploys**
- ☐ Confirm the live version badge flips to the shipped version
- ☐ MOOSE/MIST + Roster + counter all present on the public site
