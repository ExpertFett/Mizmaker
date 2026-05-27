# mizresearch — Claude instructions

Read this first when starting a session on this repo. It captures
project-specific conventions, known footguns, and standing working
agreements with the user (Fett, callsign VMFA-224(AW)).

## About the project

**What**: a DCS World mission planning webapp that surgically edits `.miz`
files without destroying user formatting. Flask backend, React/Vite
frontend.

**Live URL**: `https://dcsopt.up.railway.app/` (Railway-hosted)
— this is the canonical deploy that tracks `origin/main`; every push
**to main** redeploys here (work lands on `dev` first — see Push rule).
Verify deploys / probe the API against THIS host
(healthcheck path `/api/sam-ranges`). The old `mizmaker-production.up.railway.app`
host is dead (404) since the DCS:OPT rename — do NOT use it. (Confirmed
live host 2026-05-24.)
Do NOT use `planner.v224.org` — that domain is intentionally frozen on
an old (pre-brief-generator) build for a separate person's use; it is
NOT attached to this Railway service and will not update. (Confirmed
2026-05-21.)

**Scale**: ~31k LOC frontend, ~8k LOC backend, ~2k LOC kneeboard cards.
One-dev (Fett + Claude) codebase.

**Architecture**: `planner/backend/` (Flask + Python) and
`planner/frontend/` (Vite + React 19 + TS strict). Sessions are
in-memory on the backend (2hr TTL, 20 max). Mission edits are
regex-based surgical text replacements on the original Lua.

**Repository + branches** (changed 2026-05-26 — site went PUBLIC, real users live):
- Single remote: `origin` → `https://github.com/ExpertFett/Mizmaker.git`
- **`main` = PRODUCTION.** Railway deploys from here; every push to `main`
  triggers a redeploy (~2 min build + container swap). Real users are on the
  live site now — **do NOT push to `main` casually.**
- **`dev` = integration/work branch.** Day-to-day commits land here. `dev`
  does NOT deploy anywhere (no staging service), so verify locally:
  `tsc -b` + `vite build`, Vite HMR, pytest.
- **Promotion to prod is DELIBERATE.** Only when Fett says "ship it" / "deploy"
  / "go live" / "push to prod": fast-forward `main` to `dev` and push `main`
  (the one intentional redeploy), ideally at low traffic.
- Other long-lived branches (`olympus`, `planner-mode`, `supabase-sessions`,
  `live-terminal`) are historical/parked — leave them alone unless asked.
- The old `personal` (ExpertFett/mizmaker856) and `origin`
  (vmfa224-skunkworks/mizresearch) remotes were retired on 2026-04-25 to
  consolidate the scattered branch state. The squadron handoff happens
  later by Fett pushing this repo's history to the squadron repo himself
  — don't add that remote back unless he asks.

**Push rule** (changed 2026-05-26 — was "always main"):
- "commit it" / "push it" / "save it" → commit to **`dev`**, push `origin/dev`.
  This does NOT deploy to prod.
- "ship it" / "deploy" / "go live" / "promote" / "push to prod" → fast-forward
  **`main`** to `dev` and push `origin/main` (triggers the Railway redeploy).
  Prefer low-traffic windows; check `/api/health` `sessions` count first.
- Never push to other branches/remotes unless Fett names one.
- Why this is safe-but-cautious: prod deploys are already near-seamless
  (healthcheck overlap = no hard outage; `SUPABASE_URL` is set so sessions
  persist across restarts; single JS bundle = no forced refresh for open
  tabs). But with users live, prod should still only redeploy on purpose.

**Version bumping**: `planner/frontend/src/version.ts` exports a `VERSION`
string displayed on the upload page header. **Bump the patch number on
every commit that ships user-visible changes** — Fett uses this to know
which build is live without hitting GitHub. The file has the convention
documented; current version semantics are loose ("v0.4.x" for the brief-
generator era, etc.). Don't bump for trivial doc-only or comment-only
commits.

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

## Auth & environment variables (v0.11.0)

DCS:OPT has an **optional Discord login** (identity gate only — `identify`
scope, no email, no guild check, **no database**). The flow is: landing page →
"Log in with Discord" *or* "Continue as guest" → the upload screen. Invite
(`/join/...`) links bypass the gate. Code lives in `backend/services/auth.py`
(signed-cookie session via `itsdangerous`; token exchange via stdlib `urllib`)
and `frontend/src/store/authStore.ts` + `panels/LandingPage.tsx`.

**It degrades gracefully**: when the env vars below are unset, the Discord
button bounces back to `/?auth_error=unconfigured` and `/api/auth/me` returns
`{user: null}` — guest mode still works. So the feature ships dark and lights
up once Fett provisions the Discord app.

Railway env vars (set in the service's Variables tab):
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` — from discord.com/developers
- `DISCORD_REDIRECT_URI` — `https://dcsopt.up.railway.app/api/auth/discord/callback`
  (prod). Dev uses `http://localhost:5173/api/auth/discord/callback` via the
  Vite proxy. Both must be registered under the Discord app's OAuth2 → Redirects.
- `APP_SECRET_KEY` — long random string; signs the login cookie. **Rotating it
  logs everyone out** (existing cookies fail to verify).

Auth routes: `GET /api/auth/discord/login`, `GET /api/auth/discord/callback`,
`GET /api/auth/me`, `POST /api/auth/logout`. Registered in `app.py` before the
SPA catch-all. Tests in `backend/tests/test_auth.py`.

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

## Roadmap (parked)

Things we've discussed but explicitly deferred. Don't start these
without Fett's go-ahead.

- **BYOK AI features** (Bring Your Own Anthropic Key). **Foundation
  shipped in v0.8.0** — `ai/aiStore.ts` (key + model in localStorage),
  `ai/anthropicClient.ts` (direct browser → api.anthropic.com), AI
  Settings modal on the upload screen, vision-based SOP image
  extraction. Pattern: user pastes their personal Anthropic API key
  in a Settings panel, key is stored client-side only (browser
  localStorage), AI calls go directly from the browser to
  `api.anthropic.com` using `anthropic-dangerous-direct-browser-
  access: true`. Their key, their bill — Railway never sees it.
  Remaining AI features to build (each ~30 min once foundation
  exists): smarter commander's intent (full prose from scenario +
  threats + flights), threat narrative paragraphs, mission-flow
  rewrite, brief-presenter speaker notes, custom template token
  auto-mapping ("Option C" from the original brief plan). Every AI
  feature MUST have a graceful non-AI fallback so users without
  keys still see a working brief.

- **Per-flight editor UI** (Phase 3b). Currently flight briefs are
  auto-only — the package render rebuilds them fresh each time from
  mission data. Editor would let mission makers tweak per-flight
  tasking, fuel ladder, notes before render. Wait until testers ask
  for it — they may be happy with the auto-build.

- **Per-slide map images** (option #3 from the brief menu). Auto-embed
  a route map (with threats + flight tracks) on the cover, plus a per-
  flight route map on each flight brief. Uses the existing OL canvas
  + html-to-canvas pipeline the kneeboard cards already use. Most
  visually impressive single feature; medium-large effort.

- **Weapon-employment kneeboards** for newer pilots and training
  missions. Per-weapon reference cards modeled on the SAM threat-
  cards style (DEFEND banner up top, layout faithful to existing
  squadron cards). Each card covers a single store: AGM-65 family,
  AGM-84 (HARM/SLAM-ER), AGM-88, AIM-7/9/120, JDAM (GBU-31/32/38),
  GBU-10/12/16/24, etc. Content per card: WEZ envelope + min/max
  range, employment profile (ALT/AS/dive angle), HUD/MFD pages
  used, switchology cheatsheet, common mistakes. Output is PNG via
  the same headless-Chrome HTML→PNG pipeline used for the SAM
  cards. Tied to a per-flight loadout: when a player flight is
  carrying e.g. an AIM-9X, the AIM-9X card auto-injects into that
  flight's KNEEBOARD/<aircraft>/IMAGES on download. Useful for
  Hornet School training missions where the student loadout is
  known. Medium effort; doable in a single phase once the SAM-card
  template is generalized into a reusable HTML template.

## User profile (Fett)

- Callsign **Fett**. Squadron **VMFA-224(AW) Bengals**. Runs a
  Hornet School training program.
- DCS setup: WinWing stick/throttle/MFDs, F/A-18C primary.
- Preferred hotkey for TOLD workflow: "Double Ugly" = 2 fuel tanks
  on pylons 5 & 7 (centerline + inboard right). Pylon 3 left free
  for weapons. Already wired into LoadoutTab presets.
- Timezone Mountain. Works in chunks — sessions may resume days later.
  Assume context was lost.
