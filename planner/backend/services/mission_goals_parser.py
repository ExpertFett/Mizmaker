"""Parse the `["goals"]` block out of a DCS mission.lua.

Mirror of `_replace_mission_goals` in unit_editor.py — we read what
that function writes (and what DCS ME writes) so the planner can
seed the Mission Goals tab from a re-uploaded .miz instead of
starting blank every time.

Output shape matches the frontend `MissionGoal` interface in
`store/goalsStore.ts`:

    {
        "id": "<deterministic id>",
        "text": "<comment without [SIDE] prefix>",
        "side": "blue" | "red" | "neutral" | "all",
        "points": <int>,
        "notes": "",
    }

The `[SIDE]` prefix in the comment is the only place the side lives
(DCS goals don't carry a coalition field), so we recover it by
matching the prefix and stripping it. Goals without a recognized
prefix default to 'all'.

DictKey_* references in the comment field get resolved against the
provided dictionary lookup, same as the briefing parser.
"""

from __future__ import annotations

import re
from typing import Optional


# ---------------------------------------------------------------------------
# Block extraction
# ---------------------------------------------------------------------------

def _find_goals_block(text: str) -> Optional[tuple[int, int]]:
    """Return (start, end_exclusive) of the goals table body, or None.

    Walks brace depth so nested predicate/rule tables don't close
    the goals block early. Returns the slice INSIDE the outermost
    `{ ... }` (caller doesn't see the wrapping braces).
    """
    m = re.search(r'\["goals"\]\s*=\s*\n?\s*\{', text)
    if not m:
        return None
    block_open = m.end() - 1  # position of {
    depth = 0
    fi = block_open
    in_str = False
    while fi < len(text):
        ch = text[fi]
        if ch == '"' and (fi == 0 or text[fi - 1] != '\\'):
            in_str = not in_str
        elif not in_str:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return (block_open + 1, fi)
        fi += 1
    return None


def _split_entries(body: str) -> list[str]:
    """Split the goals block body into per-entry chunks.

    Each entry looks like `[N] = { ... },` — we use brace-matching
    so a goal with non-empty predicates/rules doesn't get truncated.
    Returns the raw entry body (without the `[N] = { ... }` wrapper)
    so the caller can regex-match score + comment inside.
    """
    entries: list[str] = []
    i = 0
    while i < len(body):
        m = re.search(r'\[\d+\]\s*=\s*\{', body[i:])
        if not m:
            break
        entry_open = i + m.end() - 1  # position of {
        depth = 0
        fi = entry_open
        in_str = False
        while fi < len(body):
            ch = body[fi]
            if ch == '"' and (fi == 0 or body[fi - 1] != '\\'):
                in_str = not in_str
            elif not in_str:
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        entries.append(body[entry_open + 1:fi])
                        i = fi + 1
                        break
            fi += 1
        else:
            break
    return entries


# ---------------------------------------------------------------------------
# Side prefix recovery
# ---------------------------------------------------------------------------

_SIDE_PREFIX_RE = re.compile(r'^\s*\[(BLUE|RED|NEUTRAL|ALL)\]\s*', re.IGNORECASE)

_SIDE_NORMALIZE = {
    "BLUE": "blue",
    "RED": "red",
    "NEUTRAL": "neutral",
    "ALL": "all",
}


def _split_side_prefix(comment: str) -> tuple[str, str]:
    """Strip the `[SIDE]` prefix from a goal comment.

    Returns (side, text). If no prefix matches, returns ('all', comment).
    """
    m = _SIDE_PREFIX_RE.match(comment)
    if not m:
        return ("all", comment.strip())
    side = _SIDE_NORMALIZE[m.group(1).upper()]
    text = comment[m.end():].strip()
    return (side, text)


# ---------------------------------------------------------------------------
# Lua string + value extraction
# ---------------------------------------------------------------------------

def _extract_string_field(entry: str, field: str) -> Optional[str]:
    """Pull a `["field"] = "value"` out of an entry body. None if missing.

    Handles Lua escape sequences for quotes and backslashes — same
    set the writer emits in unit_editor.py.
    """
    pattern = rf'\["{field}"\]\s*=\s*"((?:\\.|[^"\\])*)"'
    m = re.search(pattern, entry)
    if not m:
        return None
    raw = m.group(1)
    # Reverse the escapes the writer applies
    return (
        raw
        .replace('\\"', '"')
        .replace('\\\\', '\\')
        .replace('\\n', '\n')
    )


def _extract_int_field(entry: str, field: str) -> int:
    """Pull a `["field"] = N` integer field, defaulting to 0."""
    m = re.search(rf'\["{field}"\]\s*=\s*(-?\d+)', entry)
    if not m:
        return 0
    try:
        return int(m.group(1))
    except ValueError:
        return 0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_mission_goals(mission_text: str, dict_lookup: Optional[dict] = None) -> list[dict]:
    """Parse the `["goals"]` block into a list of MissionGoal dicts.

    `dict_lookup` is the resolved DCS dictionary (parse_dictionary's
    output). When a goal's comment is a `DictKey_*` reference the
    actual text is pulled from the dictionary, same as briefing
    fields. Unknown DictKeys fall through as-is so the user can
    spot the issue rather than getting silent blanks.

    Returns [] if the goals block is missing or empty. Goals with
    blank comments after side-prefix-strip are dropped (same shape
    the writer filters on input — empty goals shouldn't roundtrip).
    """
    bounds = _find_goals_block(mission_text)
    if bounds is None:
        return []
    body = mission_text[bounds[0]:bounds[1]]
    entries = _split_entries(body)

    out: list[dict] = []
    for idx, entry in enumerate(entries, start=1):
        comment_raw = _extract_string_field(entry, "comment") or ""
        # Resolve DictKey_* if present (DCS ME stores comments as
        # dictionary references in localized missions).
        if dict_lookup and comment_raw.startswith("DictKey_"):
            comment_raw = dict_lookup.get(comment_raw, comment_raw)

        side, text = _split_side_prefix(comment_raw)
        if not text.strip():
            continue
        score = _extract_int_field(entry, "score")
        out.append({
            # Deterministic id so the same upload produces the same
            # ids (no Math.random() drift on re-upload). Frontend
            # treats these as opaque keys.
            "id": f"goal_imported_{idx}",
            "text": text,
            "side": side,
            "points": score,
            "notes": "",
        })
    return out
