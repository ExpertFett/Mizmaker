"""Parse the planner-private `["plannerDmpis"]` block out of mission.lua.

Mirror of `_replace_planner_dmpis` in unit_editor.py — read what that
function writes so the DMPI tab can seed itself from a re-uploaded
planner-generated .miz instead of starting empty every session.

Output shape matches the frontend `Dmpi` interface in
`store/dmpiStore.ts`:

    {
        "id": "<deterministic id>",
        "name": "...",
        "lat": <float>,
        "lon": <float>,
        "elevation": <float>,
        "description": "...",
        "weaponDelivery": "...",
        "notes": "...",
    }

DMPIs aren't a native DCS field, so a freshly-authored DCS-ME mission
will have no `["plannerDmpis"]` key at all — that case returns an
empty list. Only planner-touched .miz files carry the block.
"""

from __future__ import annotations

import re
from typing import Optional


# ---------------------------------------------------------------------------
# Block extraction (same brace-walk pattern the writer uses)
# ---------------------------------------------------------------------------

def _find_block(text: str) -> Optional[tuple[int, int]]:
    m = re.search(r'\["plannerDmpis"\]\s*=\s*\n?\s*\{', text)
    if not m:
        return None
    block_open = m.end() - 1
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
    entries: list[str] = []
    i = 0
    while i < len(body):
        m = re.search(r'\[\d+\]\s*=\s*\{', body[i:])
        if not m:
            break
        entry_open = i + m.end() - 1
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
# Field extraction — same Lua escape conventions as the writer
# ---------------------------------------------------------------------------

def _extract_string_field(entry: str, field: str) -> str:
    pattern = rf'\["{field}"\]\s*=\s*"((?:\\.|[^"\\])*)"'
    m = re.search(pattern, entry)
    if not m:
        return ""
    raw = m.group(1)
    return (
        raw
        .replace('\\"', '"')
        .replace('\\\\', '\\')
        .replace('\\n', '\n')
    )


def _extract_float_field(entry: str, field: str) -> float:
    m = re.search(rf'\["{field}"\]\s*=\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)', entry)
    if not m:
        return 0.0
    try:
        return float(m.group(1))
    except ValueError:
        return 0.0


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_planner_dmpis(mission_text: str) -> list[dict]:
    """Parse the `["plannerDmpis"]` block into a list of Dmpi dicts.

    Returns [] when the block is missing (DCS-ME-authored mission)
    or empty (planner wrote an empty block). Entries with blank
    `name` are dropped — same shape the writer filters on input.
    """
    bounds = _find_block(mission_text)
    if bounds is None:
        return []
    body = mission_text[bounds[0]:bounds[1]]
    entries = _split_entries(body)

    out: list[dict] = []
    for idx, entry in enumerate(entries, start=1):
        name = _extract_string_field(entry, "name")
        if not name.strip():
            continue
        out.append({
            # Deterministic id keyed off entry index — re-uploads of
            # the same mission produce the same ids, no churn.
            "id": f"dmpi_imported_{idx}",
            "name": name,
            "lat": _extract_float_field(entry, "lat"),
            "lon": _extract_float_field(entry, "lon"),
            "elevation": _extract_float_field(entry, "elevation"),
            "description": _extract_string_field(entry, "description"),
            "weaponDelivery": _extract_string_field(entry, "weaponDelivery"),
            "notes": _extract_string_field(entry, "notes"),
        })
    return out
