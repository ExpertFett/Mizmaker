# mizresearch — Claude instructions

Read this first when starting a session on this repo. It captures
project-specific conventions, known footguns, and standing working
agreements with the user (Fett, callsign VMFA-224(AW)).

## About the project

**What**: a DCS World mission planning webapp that surgically edits `.miz`
files without destroying user formatting. Flask backend, React/Vite
frontend. Live at planner.v224.org (Railway-hosted).

**Scale**: ~31k LOC frontend, ~8k LOC backend, ~2k LOC kneeboard cards.
One-dev (Fett + Claude) codebase.

**Architecture**: `planner/backend/` (Flask + Python) and
`planner/frontend/` (Vite + React 19 + TS strict). Sessions are
in-memory on the backend (2hr TTL, 20 max). Mission edits are
regex-based surgical text replacements on the original Lua.

**Repository + branch**:
- Single remote: `origin` → `https://github.com/ExpertFett/Mizmaker.git`
- Single branch: `main` — Railway deploys from here, every push triggers
  a redeploy. There is no "feature branch" workflow right now; commits
  go straight to `main`.
- The old `personal` (ExpertFett/mizmaker856) and `origin`
  (vmfa224-skunkworks/mizresearch) remotes were retired on 2026-04-25 to
  consolidate the scattered branch state. The squadron handoff happens
  later by Fett pushing this repo's history to the squadron repo himself
  — don't add that remote back unless he asks.

**Push rule**: when Fett says "commit it to github", "push it", "deploy",
etc., the target is always `origin/main`. Never push to any other branch
or remote unless he explicitly names one.

## Working agreements (standing orders)

### Default behaviors
- **Fix bugs by default.** If a test run or inspection reveals a bug,
  fix it immediately without asking permission. Don't mark `xfail` and
  move on — that was a one-time expedient, not the rule.
- **Don't run tests before asking.** Fett will tell you when to test.
  HMR + pytest are fine without asking.
- **Commit and push only when explicitly asked.** Uncommitted work
  is expected; don't surprise-commit.
- **When in doubt about scope, ask with `AskUserQuestion`.** Don't
  assume. Fett has strong opinions about what to build next.

### Tone
- Short, direct. No meeting-minutes recaps, no "let me know!".
- Use tables for comparisons, bullets for lists, prose for explanation.
- Call out real risks bluntly. No boosterism; no "you've done great!".
- Emoji for status markers (✅ ⚠️ 🎯 🛫) — used sparingly, never as filler.

### Plan mode
- Use `EnterPlanMode` for architecture-level work or anything the user
  calls "step back" / "assess" / "refactor".
- Don't re-read the plan file after writing it; the user sees it when
  you call `ExitPlanMode`.

### Testing discipline
- Backend tests in `planner/backend/tests/`. Run with:
  `cd planner/backend && python -m pytest tests/ -v`
- Fixtures tracked in git at `tests/fixtures/*.miz` (override .gitignore).
- Every new edit type should get a round-trip test in `test_edit_roundtrip.py`.
- **A test that catches a real bug is a success, not a failure.** Leave
  it passing; fix the underlying bug.

## Known footguns (already stepped on — don't repeat)

### Backend
1. **Silent edit failures**: `apply_unit_edits` used to swallow exceptions.
   Fixed — it now returns `(text, results[])` and the download endpoint
   surfaces results via the `X-Edit-Results` response header. Any new
   edit must go through this path so failures are visible.
2. **±N-char search windows**: every surgical edit in `services/unit_editor.py`
   relies on finding an anchor (e.g. `["unitId"] = N`) then regexing
   within ±2000-5000 chars. This breaks on complex missions (big
   datalink / 100-pylon loadouts / CSG-3 mod). Use brace-matched
   `_find_unit_block_bounds` when you can. Document the window size
   in a comment when you can't.
3. **Scoped searches for coalition/option/difficulty**: fields like
   `["red"]`, `["blue"]`, `["country"]` appear in multiple sections
   (trigrules, groundControl.roles, coalition). Always scope searches
   to the enclosing block. See `_find_coalition_block_bounds` for the
   pattern.
4. **Two-file edits**: some DCS settings live in two places. Both must
   be updated:
   - **Briefing** text → `l10n/DEFAULT/dictionary` (DictKey references
     in `mission` point here). Use `apply_briefing_edits_to_dictionary`.
   - **Forced options** → `options/difficulty`. Use
     `apply_forced_options_to_options_file` (type-aware — won't
     overwrite string enum with int).
5. **slpp parser is a module-level singleton** with mutable state.
   Always instantiate a fresh `SLPP()` per parse. See
   `services/miz_parser.py::parse_mission_text`.
6. **Thread safety**: Flask dev server is threaded. `sessions` dict
   has a `_lock` but per-session mutations don't. Don't add concurrent
   writers without locks.
7. **Unicode on Windows**: always pass `encoding='utf-8'` to `open()`.
   Windows default is cp1252 and the mission Lua has non-cp1252 chars.
   Wrap diagnostic logging in try/except so a log-write failure can't
   kill a real edit.

### Frontend
1. **`useMemo` is not `useEffect`**. Don't call `setState` inside a
   `useMemo` — it runs during render and will break HMR / cause
   cross-mount state leaks. (We hit this in CoalitionsTab.)
2. **Direct `useMissionStore.setState({...})` from tabs**: 20+ places
   in the code do this. It works but bypasses action boundaries. Try
   not to add more. When you must, comment why.
3. **Tabs unmount on switch** unless you use the `visitedTabs` pattern
   in `MissionEditor.tsx`. All new tabs must be registered there with
   `display: none` toggling, not conditional render.
4. **Portal dropdowns for menus inside `overflow: hidden` cards**:
   LoadoutTab uses `createPortal` for the preset menu. Reuse that
   pattern — don't try to escape with z-index alone.
5. **`Set`/`Map` in `useState`**: every update must create a new
   instance (`new Set(prev).add(x)`) or React won't detect the change.
6. **MissionDateLine** lives in `kneeboard/cardStyles.ts`. New cards
   should use it for consistency.

## Test mission fixtures

- `planner/backend/tests/fixtures/simple.miz` (30KB, Case III Joe, 25
  clients, has weather + groups but no laser-capable units — laser tests
  skip)
- User has larger missions available:
  - `C:/Users/garre/Downloads/Mission 5.2_edited_edited.miz` — Kola,
    F-18 + F-16 + Apaches, full SOP-driven workflow
  - `D:/MASTER DCS SORT THE FUCK OUT OF ME DADDY/Missions/` — ~29 .miz
    files of various complexity

## Dev servers

- **Frontend**: `http://localhost:5173` (Vite HMR). Start with
  `cd planner/frontend && node node_modules/vite/bin/vite.js --host`
- **Backend**: `http://localhost:5001` (Flask dev). Start with
  `cd planner/backend && python app.py`
- Restart the backend manually when you edit Python (no reloader).
  Frontend HMR handles itself.

## Useful commands

```bash
# Run the test suite
cd planner/backend && python -m pytest tests/ -v

# Install dev deps
pip install -r requirements-dev.txt

# Quick smoke test against live backend
python /c/Users/garre/AppData/Local/Temp/test_*.py

# Check HMR logs
tail -20 "C:/Users/garre/AppData/Local/Temp/claude/D--/.../tasks/b*.output"
```

## In-flight plan

Ongoing architecture-stabilization work. See
`C:/Users/garre/.claude/plans/synthetic-napping-pinwheel.md` for the
master plan. Current phase:

- [x] 1.1 pytest foundation
- [x] 1.2 silent-failure surfacing (EditResults → X-Edit-Results header → toast)
- [ ] 1.3 Claude-in-the-loop E2E scenario runner
- [x] 1.4 Claude diff reviewer (`./scripts/review.sh` + `.claude/review-prompt.md`)
- [ ] 2.1 Read-back verification on every edit function
- [ ] 2.2 Supabase session persistence (the named reason for this branch)

## User profile (Fett)

- Callsign **Fett**. Squadron **VMFA-224(AW) Bengals**. Runs a
  Hornet School training program.
- DCS setup: WinWing stick/throttle/MFDs, F/A-18C primary.
- Preferred hotkey for TOLD workflow: "Double Ugly" = 2 fuel tanks
  on pylons 5 & 7 (centerline + inboard right). Pylon 3 left free
  for weapons. Already wired into LoadoutTab presets.
- Timezone Mountain. Works in chunks — sessions may resume days later.
  Assume context was lost.
