# Cool-blue palette snapshot (pre-kneeboard-swap)

Saved before the warm-grey kneeboard color swap so we can revert with a
single regex sweep if the new look doesn't land.

## Mapping that was applied

| Cool original (count) | Warm replacement | Role |
|---|---|---|
| `#080f1c` (30×) | `#1a1a1a` | App background (MissionEditor root) |
| `#0a1520` (44×) | `#222222` | Scrollbar track, secondary panel bg |
| `#0f1a28` (105×) | `#262626` | Sidebar/panel background |
| `#0f2a4a` (3×)  | `#333333` | Button bg (export/JSON) |
| `#1a2a3a` (262×)| `#3a3a3a` | Light border |
| `#1a3a5a` (73×) | `#4a4a4a` | Medium border, scrollbar thumb (matches kneeboard `BG_NOTES`) |
| `#ccdae8` (210×)| `#e0e0e0` | Body text (matches kneeboard `TEXT`) |
| `#5a7a8a` (399×)| `#aaa`    | Muted text / labels (matches kneeboard `DIM`) |
| `#8fa8c0` (84×) | `#ccc`    | Secondary text (matches kneeboard `TEXT_MUTED`) |

**Accent preserved**: `#4a8fd4` (cool blue). Per request, accent color was
not changed in this pass. Kneeboards use `#ffa500` orange for accents — if
we want full kneeboard parity later, that's the last swap.

## Second pass — additional blue stragglers (UploadPanel etc.)

The first sweep covered the canonical 9-color palette. A second pass caught
22 additional blue-leaning hex codes that were used in specific panels
(upload, errors, joinSession, etc.). Bright sub-accents (`#6ab4f0`, `#1f6feb`,
`#38bdf8`, `#58a6ff`, `#79c0ff`) and purples were LEFT ALONE — they read
as intentional state colors.

| Cool original | Warm replacement | Use |
|---|---|---|
| `#0a1420`, `#0a1a2a`, `#0c1622`, `#0c1824`, `#0c1825`, `#0e1929`, `#101a25` | `#1a1a1a` | Various dark backgrounds |
| `#12202e`, `#152030` | `#222222` | Slightly lighter dark backgrounds |
| `#1a2a4a` | `#262626` | Panel background variant |
| `#2a3a4a` | `#3a3a3a` | Border light |
| `#3a4a5a`, `#3a5a6a` | `#4a4a4a` | Border medium |
| `#4a5a6a`, `#4a6a7a` | `#555555` | Border heavy / disabled bg |
| `#5a6a7a` | `#666666` | Subtle dividers |
| `#5a7a9a` | `#888888` | Faded text |
| `#6a8a9a`, `#6a8aaa` | `#aaaaaa` | Muted text |
| `#7a9ab0`, `#8a9aaa` | `#bbbbbb` | Mid-tone text |
| `#8aaabe` | `#cccccc` | Secondary text |

## Reverting

Run the inverse sweep on `frontend/src/`:

```bash
cd planner/frontend/src
sed -i 's/#1a1a1a/#080f1c/g; s/#222222/#0a1520/g; s/#262626/#0f1a28/g; s/#333333/#0f2a4a/g; s/#3a3a3a/#1a2a3a/g; s/#4a4a4a/#1a3a5a/g; s/#e0e0e0/#ccdae8/g; s/#aaa\b/#5a7a8a/g; s/#ccc\b/#8fa8c0/g' \
  $(find . -name "*.tsx" -o -name "*.ts")
```

(Note: `\b` boundaries on `#aaa`/`#ccc` to avoid matching `#aaaa00` etc.
On macOS sed, use `gsed` or manually iterate.)

## Files NOT touched

- `kneeboard/cardStyles.ts` — kneeboard cards have their own palette and
  are deliberately unaffected. They render to PNG and embed in DCS.
- `main.tsx` reset CSS — scrollbar track color updated separately
  alongside the sweep so they stay in sync.
