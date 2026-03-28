"""
Surgical .miz Lua text editor — extends 856's regex+brace-matching approach
to support waypoint manipulation.

Philosophy: NEVER re-serialize the Lua table. Apply targeted regex replacements
on the raw text to preserve all formatting, comments, and unknown fields.
"""

import io
import re
import zipfile
from typing import Dict, List, Any, Optional, Tuple


def _find_group_block_start(text: str, group_id: int) -> int:
    """Find the character position of ["groupId"] = N in the mission text."""
    pattern = rf'\["groupId"\]\s*=\s*{group_id}\s*,'
    match = re.search(pattern, text)
    if not match:
        raise ValueError(f"Group {group_id} not found in mission text")
    return match.start()


def _find_matching_brace(text: str, open_pos: int) -> int:
    """Find the position after the closing } that matches the { at open_pos."""
    depth = 1
    i = open_pos + 1
    in_string = False
    while i < len(text) and depth > 0:
        c = text[i]
        if c == '"' and (i == 0 or text[i - 1] != '\\'):
            in_string = not in_string
        elif not in_string:
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
        i += 1
    return i


def _find_waypoint_block(text: str, group_id: int, wp_index: int) -> Tuple[int, int]:
    """
    Find the start and end positions of waypoint [wp_index] within a group's route.points.
    wp_index is 1-based (Lua convention).
    Returns (block_start, block_end).
    """
    group_pos = _find_group_block_start(text, group_id)
    # Search forward from group for ["points"]
    search_region = text[group_pos:group_pos + 80000]

    points_match = re.search(r'\["points"\]\s*=\s*\n?\s*\{', search_region)
    if not points_match:
        raise ValueError(f"No route.points found for group {group_id}")

    points_start = group_pos + points_match.end()

    # Find [wp_index] = { within points
    wp_pattern = rf'\[{wp_index}\]\s*=\s*\n?\s*\{{'
    wp_match = re.search(wp_pattern, text[points_start:points_start + 50000])
    if not wp_match:
        raise ValueError(f"Waypoint [{wp_index}] not found in group {group_id}")

    block_start = points_start + wp_match.start()
    brace_pos = points_start + wp_match.end() - 1
    block_end = _find_matching_brace(text, brace_pos)

    return block_start, block_end


def _replace_waypoint_field(text: str, group_id: int, wp_index: int,
                            field: str, new_value: Any) -> str:
    """Replace a single field within a waypoint block."""
    wp_start, wp_end = _find_waypoint_block(text, group_id, wp_index)
    region = text[wp_start:wp_end]

    if isinstance(new_value, str):
        lua_val = f'"{new_value}"'
    elif isinstance(new_value, bool):
        lua_val = "true" if new_value else "false"
    elif isinstance(new_value, float):
        lua_val = f"{new_value}"
    elif isinstance(new_value, int):
        lua_val = str(new_value)
    else:
        lua_val = str(new_value)

    pattern = rf'(\["{field}"\]\s*=\s*)([^,\n]+)'
    m = re.search(pattern, region)
    if not m:
        raise ValueError(f"Field '{field}' not found in waypoint [{wp_index}] of group {group_id}")

    abs_start = wp_start + m.start(2)
    abs_end = wp_start + m.end(2)
    return text[:abs_start] + lua_val + text[abs_end:]


def apply_waypoint_move(text: str, group_id: int, wp_index: int,
                        new_x: float, new_y: float) -> str:
    """Move a waypoint to new DCS coordinates."""
    text = _replace_waypoint_field(text, group_id, wp_index, "x", new_x)
    text = _replace_waypoint_field(text, group_id, wp_index, "y", new_y)
    return text


def apply_waypoint_prop(text: str, group_id: int, wp_index: int,
                        field: str, value: Any) -> str:
    """Update a waypoint property (alt, speed, action, name, alt_type, etc.)."""
    return _replace_waypoint_field(text, group_id, wp_index, field, value)


def _detect_indentation(text: str, group_id: int, wp_index: int) -> str:
    """Detect the indentation used by an existing waypoint block."""
    wp_start, _ = _find_waypoint_block(text, group_id, wp_index)
    # Walk backwards to find the line start
    line_start = text.rfind('\n', 0, wp_start)
    if line_start == -1:
        return "                            "
    return text[line_start + 1:wp_start].rstrip()


def _serialize_waypoint_lua(index: int, data: dict, indent: str = "                            ") -> str:
    """Serialize a waypoint dict as a Lua table string."""
    lines = [f'{indent}[{index}] =']
    lines.append(f'{indent}{{')
    inner = indent + "    "

    fields = [
        ("alt", data.get("altitude_m", 2000)),
        ("type", data.get("waypoint_type", "Turning Point")),
        ("action", data.get("waypoint_action", "Turning Point")),
        ("alt_type", data.get("altitude_type", "BARO")),
        ("formation_template", ""),
        ("ETA", data.get("eta_seconds", 0)),
        ("ETA_locked", data.get("eta_locked", False)),
        ("y", data.get("y", 0)),
        ("x", data.get("x", 0)),
        ("name", data.get("waypoint_name", "")),
        ("speed", data.get("speed_ms", 200)),
        ("speed_locked", data.get("speed_locked", True)),
        ("task", {"id": "ComboTask", "params": {"tasks": {}}}),
    ]

    for key, val in fields:
        if isinstance(val, str):
            lines.append(f'{inner}["{key}"] = "{val}",')
        elif isinstance(val, bool):
            lines.append(f'{inner}["{key}"] = {"true" if val else "false"},')
        elif isinstance(val, dict):
            # Minimal task block
            lines.append(f'{inner}["{key}"] =')
            lines.append(f'{inner}{{')
            lines.append(f'{inner}    ["id"] = "ComboTask",')
            lines.append(f'{inner}    ["params"] =')
            lines.append(f'{inner}    {{')
            lines.append(f'{inner}        ["tasks"] =')
            lines.append(f'{inner}        {{')
            lines.append(f'{inner}        }}, -- end of tasks')
            lines.append(f'{inner}    }}, -- end of params')
            lines.append(f'{inner}}}, -- end of task')
        else:
            lines.append(f'{inner}["{key}"] = {val},')

    lines.append(f'{indent}}}, -- end of [{index}]')
    return '\n'.join(lines)


def insert_waypoint(text: str, group_id: int, after_index: int,
                    waypoint_data: dict) -> str:
    """
    Insert a new waypoint after the given index in a group's route.points.
    Renumbers subsequent waypoints.
    """
    _, insert_after = _find_waypoint_block(text, group_id, after_index)

    new_index = after_index + 1
    indent = _detect_indentation(text, group_id, after_index)
    lua_block = _serialize_waypoint_lua(new_index, waypoint_data, indent)

    text = text[:insert_after] + "\n" + lua_block + text[insert_after:]

    # Renumber subsequent waypoints (work backwards to avoid cascade)
    text = _renumber_waypoints_after(text, group_id, new_index + 1)

    return text


def delete_waypoint(text: str, group_id: int, wp_index: int) -> str:
    """Delete a waypoint and renumber subsequent ones."""
    wp_start, wp_end = _find_waypoint_block(text, group_id, wp_index)

    # Extend to include the trailing comma/whitespace
    trailing = text[wp_end:wp_end + 20]
    trail_match = re.match(r'\s*,?\s*\n?', trailing)
    if trail_match:
        wp_end += trail_match.end()

    # Also remove leading whitespace on the line
    line_start = text.rfind('\n', 0, wp_start)
    if line_start >= 0:
        wp_start = line_start

    text = text[:wp_start] + text[wp_end:]

    # Renumber subsequent waypoints
    text = _renumber_waypoints_down(text, group_id, wp_index + 1)

    return text


def _renumber_waypoints_after(text: str, group_id: int, from_index: int) -> str:
    """Renumber waypoints from from_index upward: [N] → [N+1]."""
    group_pos = _find_group_block_start(text, group_id)
    search_region = text[group_pos:group_pos + 80000]
    points_match = re.search(r'\["points"\]\s*=\s*\n?\s*\{', search_region)
    if not points_match:
        return text

    points_start = group_pos + points_match.end()

    # Find all [N] indices in points block and renumber from highest down
    existing = []
    for m in re.finditer(r'\[(\d+)\]\s*=\s*\n?\s*\{', text[points_start:points_start + 80000]):
        idx = int(m.group(1))
        if idx >= from_index:
            existing.append((idx, points_start + m.start(), points_start + m.end()))

    # Sort descending to avoid position shifts
    for idx, start, end in sorted(existing, reverse=True):
        old_tag = f"[{idx}]"
        new_tag = f"[{idx + 1}]"
        # Replace just the index tag
        tag_match = re.search(rf'\[{idx}\]', text[start:end])
        if tag_match:
            abs_s = start + tag_match.start()
            abs_e = start + tag_match.end()
            text = text[:abs_s] + new_tag + text[abs_e:]

    return text


def _renumber_waypoints_down(text: str, group_id: int, from_index: int) -> str:
    """Renumber waypoints from from_index downward: [N] → [N-1]."""
    group_pos = _find_group_block_start(text, group_id)
    search_region = text[group_pos:group_pos + 80000]
    points_match = re.search(r'\["points"\]\s*=\s*\n?\s*\{', search_region)
    if not points_match:
        return text

    points_start = group_pos + points_match.end()

    existing = []
    for m in re.finditer(r'\[(\d+)\]\s*=\s*\n?\s*\{', text[points_start:points_start + 80000]):
        idx = int(m.group(1))
        if idx >= from_index:
            existing.append((idx, points_start + m.start(), points_start + m.end()))

    # Sort ascending for downward renumber
    for idx, start, end in sorted(existing):
        old_tag = f"[{idx}]"
        new_tag = f"[{idx - 1}]"
        tag_match = re.search(rf'\[{idx}\]', text[start:end])
        if tag_match:
            abs_s = start + tag_match.start()
            abs_e = start + tag_match.end()
            text = text[:abs_s] + new_tag + text[abs_e:]

    return text


def apply_edits(text: str, edits: List[Dict]) -> str:
    """
    Apply a list of edits to mission text.
    Each edit: {"type": "waypointMove"|"waypointProp"|"waypointInsert"|"waypointDelete", ...}

    Frontend sends 0-based wpIndex (matching DCS steerpoint numbering).
    Lua mission files use 1-based indices. Convert here.
    """
    for edit in edits:
        edit_type = edit.get("type")
        gid = edit.get("groupId")
        wpi_0 = edit.get("wpIndex")  # 0-based from frontend
        wpi = wpi_0 + 1 if wpi_0 is not None else None  # 1-based for Lua

        if edit_type == "waypointMove":
            text = apply_waypoint_move(text, gid, wpi, edit["x"], edit["y"])
        elif edit_type == "waypointProp":
            text = apply_waypoint_prop(text, gid, wpi, edit["field"], edit["value"])
        elif edit_type == "waypointInsert":
            after_lua = edit["afterIndex"] + 1  # convert to 1-based
            text = insert_waypoint(text, gid, after_lua, edit["waypointData"])
        elif edit_type == "waypointDelete":
            text = delete_waypoint(text, gid, wpi)

    return text


def repack_miz(original_miz_bytes: bytes, new_mission_text: str) -> bytes:
    """Repack a .miz archive with the edited mission text."""
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original_miz_bytes), "r") as zin:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == "mission":
                    zout.writestr(item, new_mission_text.encode("utf-8"))
                else:
                    zout.writestr(item, zin.read(item.filename))
    return output.getvalue()
