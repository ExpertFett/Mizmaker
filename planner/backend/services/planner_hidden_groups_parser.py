"""Parse the planner-private `["plannerHiddenGroups"]` block.

Mirror of `_replace_planner_hidden_groups` in unit_editor.py — read
what that function writes so the Visibility tab can seed itself
from a re-uploaded planner-generated .miz instead of starting blank
each session.

Output is a list of integer group IDs the mission maker had marked
hidden from flight leads. DCS-ME-authored missions don't have this
key; the parser returns [] in that case (default fully-visible).
"""

from __future__ import annotations

import re
from typing import Optional


def _find_block(text: str) -> Optional[tuple[int, int]]:
    """Return (start, end_exclusive) of the block body, or None.

    Brace-walk through the block to handle the empty `{}` and
    populated `{ [1] = 1, [2] = 5 }` cases uniformly.
    """
    m = re.search(r'\["plannerHiddenGroups"\]\s*=\s*\n?\s*\{', text)
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


def parse_planner_hidden_groups(mission_text: str) -> list[int]:
    """Parse `["plannerHiddenGroups"]` into a list of group IDs.

    The writer emits entries shaped `[N] = <groupId>,` — we just
    pull every integer on the right of an `=` inside the block.
    Returns [] when the block is missing (DCS-ME-authored mission)
    or empty (planner wrote an empty block).
    """
    bounds = _find_block(mission_text)
    if bounds is None:
        return []
    body = mission_text[bounds[0]:bounds[1]]
    # Match `[N] = M,` entries; the group ID is the second capture.
    out: list[int] = []
    for m in re.finditer(r'\[\d+\]\s*=\s*(-?\d+)', body):
        try:
            out.append(int(m.group(1)))
        except ValueError:
            continue
    return out
