# Dark-grey palette snapshot (pre-Carrier-light swap)

Saved before the Carrier-GUI-style light theme conversion (v0.9.66) so
we can revert with a single regex sweep if the new look doesn't land.
Parallels the earlier `cool-blue-backup.md` which captured the warm-grey
swap from the cool-blue era.

## Why we swept

Fett's reference image: the in-DCS Carrier Control dialog he made in
a separate chat. That dialog is rendered through DCS's built-in skin
engine — muted blue-grey panels, dark text, amber section headers,
silvery buttons with thin metallic borders. The Mizmaker dark theme
felt like a webapp; the Carrier look feels like in-game DCS UI.

## Mapping that was applied

| Dark original (count) | Carrier-light replacement | Role |
|---|---|---|
| `#1a1a1a` (78×)   | `#7a8a92` | App background, textarea fill |
| `#222222` / `#222` (91×) | `#8c9ba2` | Card body / panel background |
| `#262626` (139×)  | `#6e7c83` | Card header stripe |
| `#2a2a2a` (10×)   | `#aab4ba` | Button face |
| `#3a3a3a` (349×)  | `#4a5258` | Light border |
| `#4a4a4a` (144×)  | `#4a5258` | Medium border (consolidated) |
| `#0f0f0f` (2×)    | `#5a6870` | Deeper panel |
| `#e0e0e0` (264×)  | `#1a1f25` | Body text (LIGHT → DARK INVERSION) |
| `#cccccc` / `#ccc` (136×) | `#1a1f25` | Secondary text (also dark) |
| `#aaaaaa` / `#aaa` (488×) | `#3a4248` | Muted text |
| `#888888` / `#888` (49×) | `#5a6268` | More muted |
| `#666` (12×) | `#5a6268` | Very muted |
| `#fbb941` (11×) | `#d49a30` | Amber accent (more saturated for contrast on light bg) |
| `#4a8fd4` (175×) | `#d49a30` | **Sidebar/info accent → amber** (unified) |
| `#5a6878` (4×) | `#5a6268` | Sidebar section heading colour |

**State colours preserved** (these read fine on light bg, no change):

- `#d95050` red — danger / error
- `#3fb950` green — SOP active dot / success
- `#d9a050` warning — orange warning (different role from accent amber)

## Files NOT touched (intentional)

- `kneeboard/` directory — kneeboard cards render to PNG and ship into
  DCS as physical artefacts. They keep their own dark palette unless
  Fett asks for a separate kneeboard sweep.
- Brief slide rendering (`brief_builder.py` / `brief_renderer.py`) —
  those produce the PPTX/PDF that's the squadron's output, not the
  webapp. Different visual surface.

## Reverting (if Carrier-light doesn't land)

Run the inverse sweep on `frontend/src/` (skipping `kneeboard/`):

```bash
cd planner/frontend/src
find . -name "*.tsx" -o -name "*.ts" -not -path "./kneeboard/*" | xargs sed -i '
  s/#7a8a92/#1a1a1a/g
  s/#8c9ba2/#222222/g
  s/#6e7c83/#262626/g
  s/#aab4ba/#2a2a2a/g
  s/#4a5258/#3a3a3a/g
  s/#5a6870/#0f0f0f/g
  s/#1a1f25/#e0e0e0/g
  s/#3a4248/#aaaaaa/g
  s/#5a6268/#888888/g
  s/#d49a30/#fbb941/g
'
```

Note: the `#4a8fd4` cool-blue → amber mapping is one-way (we lost the
separate "info badge" colour). Revert restores amber where it was
unified; the original cool blue is gone. If you want both back,
consult git history — pre-sweep state is the commit before v0.9.66.

Or just `git revert <v0.9.66 sha>` for a one-commit clean undo.
