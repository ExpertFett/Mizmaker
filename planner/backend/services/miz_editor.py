"""
Surgical .miz Lua editor — hierarchy-based group targeting.

Navigates coalition → country → category → group[N] by brace-matching.
Finds groups by their depth-1 ["name"] field. No groupId searching.
Replaces the entire ["points"] block within the matched group.
"""

import io
import re
import zipfile
from typing import Dict, List, Any, Optional, Tuple


def _find_matching_brace(text: str, open_pos: int) -> int:
    """Find position after the closing } that matches the { at open_pos."""
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


def _read_depth1_field(block: str, field: str) -> Optional[str]:
    """Read a string field at brace depth 1 within a block."""
    depth = 0
    i = 0
    pattern = rf'\["{field}"\]\s*=\s*"([^"]*)"'
    while i < len(block):
        if block[i] == '{':
            depth += 1
        elif block[i] == '}':
            depth -= 1
        if depth == 1:
            m = re.match(pattern, block[i:i + 200])
            if m:
                return m.group(1)
        i += 1
    return None


def find_group_block(text: str, group_name: str) -> Tuple[int, int]:
    """
    Find a group block by navigating the Lua hierarchy and matching by name.

    Walks: coalition[side] → country[N] → category → group[N]
    Brace-matches each [N], reads the depth-1 ["name"], returns (start, end)
    of the matching group's { ... } block.
    """
    categories = ["plane", "helicopter", "vehicle", "ship", "static"]

    # Find each ["group"] = { inside any category
    for cat in categories:
        cat_pattern = rf'\["{cat}"\]\s*=\s*\n?\s*\{{\s*\n?\s*\["group"\]\s*=\s*\n?\s*\{{'
        for cat_match in re.finditer(cat_pattern, text):
            group_table_open = cat_match.end() - 1  # position of { after ["group"] =

            # Enumerate [N] = { entries inside this group table
            pos = group_table_open + 1
            while True:
                # Skip whitespace and comments
                skip = re.match(r'\s*(--[^\n]*)?\s*', text[pos:])
                if skip:
                    pos += skip.end()

                # Check for closing } of the group table
                if pos >= len(text) or text[pos] == '}':
                    break

                # Match [N] = {
                entry_match = re.match(r'\[(\d+)\]\s*=\s*\n?\s*\{', text[pos:pos + 40])
                if not entry_match:
                    break

                block_open = pos + entry_match.end() - 1  # { position
                block_close = _find_matching_brace(text, block_open)

                # Read the depth-1 name from this block
                block = text[block_open:block_close]
                name = _read_depth1_field(block, "name")

                if name == group_name:
                    return (block_open, block_close)

                # Move past this block + trailing comma/whitespace
                pos = block_close
                trail = re.match(r'\s*,?\s*(-- end of \[\d+\])?\s*', text[pos:pos + 60])
                if trail:
                    pos += trail.end()

    raise ValueError(f'Group "{group_name}" not found in mission')


def _find_points_in_block(text: str, block_start: int, block_end: int) -> Tuple[int, int]:
    """Find the ["points"] = { ... } range within a group block."""
    block = text[block_start:block_end]
    m = re.search(r'\["points"\]\s*=\s*\n?\s*\{', block)
    if not m:
        raise ValueError("No route.points found in group block")

    points_open = block_start + m.end() - 1
    points_close = _find_matching_brace(text, points_open)

    # Include the ["points"] key and trailing comment
    points_start = block_start + m.start()
    trailing = text[points_close:points_close + 80]
    trail = re.match(r'\s*,?\s*(-- end of \["points"\])?', trailing)
    if trail:
        points_close += trail.end()

    return (points_start, points_close)


def _serialize_lua_value(value: Any, indent: str = "") -> str:
    """Recursively serialize a Python value to Lua syntax."""
    if value is None:
        return "nil"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        escaped = value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r')
        return f'"{escaped}"'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        if not value:
            return "{}"
        inner = indent + "\t"
        lines = ["{"]
        for k, v in value.items():
            val_str = _serialize_lua_value(v, inner)
            if isinstance(k, str):
                lines.append(f'{inner}["{k}"] = {val_str},')
            else:
                lines.append(f'{inner}[{k}] = {val_str},')
        lines.append(f'{indent}}}')
        return "\n".join(lines)
    if isinstance(value, (list, tuple)):
        if not value:
            return "{}"
        inner = indent + "\t"
        lines = ["{"]
        for i, v in enumerate(value):
            val_str = _serialize_lua_value(v, inner)
            lines.append(f'{inner}[{i + 1}] = {val_str},')
        lines.append(f'{indent}}}')
        return "\n".join(lines)
    return str(value)


def _serialize_points(waypoints: List[Dict], base_indent: str) -> str:
    """Serialize waypoints as a Lua ["points"] = { ... } block."""
    inner = base_indent + "\t"
    field = inner + "\t"

    lines = [f'{base_indent}["points"] =', f'{base_indent}{{']

    for i, wp in enumerate(waypoints):
        idx = i + 1  # Lua 1-based
        lines.append(f'{inner}[{idx}] =')
        lines.append(f'{inner}{{')

        fields = [
            ("alt", wp.get("altitude_m", 0)),
            ("type", wp.get("waypoint_type", "Turning Point")),
            ("action", wp.get("waypoint_action", "Turning Point")),
            ("alt_type", wp.get("altitude_type", "BARO")),
            ("formation_template", ""),
            ("ETA", wp.get("eta_seconds", 0)),
            ("ETA_locked", wp.get("eta_locked", False)),
            ("y", wp.get("y", 0)),
            ("x", wp.get("x", 0)),
            ("name", wp.get("waypoint_name", "")),
            ("speed", wp.get("speed_ms", 0)),
            ("speed_locked", wp.get("speed_locked", True)),
        ]

        # Preserve airdromeId for departure waypoints
        if wp.get("airdrome_id"):
            fields.append(("airdromeId", wp["airdrome_id"]))

        for key, val in fields:
            if isinstance(val, str):
                lines.append(f'{field}["{key}"] = "{val}",')
            elif isinstance(val, bool):
                lines.append(f'{field}["{key}"] = {"true" if val else "false"},')
            else:
                lines.append(f'{field}["{key}"] = {val},')

        # Task block — preserve original if available
        task_data = wp.get("task")
        if task_data and isinstance(task_data, dict):
            task_lua = _serialize_lua_value(task_data, field)
            lines.append(f'{field}["task"] = {task_lua},')
        else:
            lines.append(f'{field}["task"] =')
            lines.append(f'{field}{{')
            lines.append(f'{field}\t["id"] = "ComboTask",')
            lines.append(f'{field}\t["params"] =')
            lines.append(f'{field}\t{{')
            lines.append(f'{field}\t\t["tasks"] =')
            lines.append(f'{field}\t\t{{')
            lines.append(f'{field}\t\t}}, -- end of tasks')
            lines.append(f'{field}\t}}, -- end of params')
            lines.append(f'{field}}}, -- end of task')

        lines.append(f'{inner}}}, -- end of [{idx}]')

    lines.append(f'{base_indent}}}, -- end of ["points"]')
    return '\n'.join(lines)


def replace_group_waypoints(text: str, group_name: str, waypoints: List[Dict]) -> str:
    """
    Replace waypoints for a group identified by name.
    Navigates the Lua hierarchy to find the right block — no groupId needed.
    """
    block_start, block_end = find_group_block(text, group_name)
    points_start, points_end = _find_points_in_block(text, block_start, block_end)

    # Detect indentation from existing block
    line_start = text.rfind('\n', 0, points_start)
    indent = ''
    if line_start >= 0:
        for ch in text[line_start + 1:points_start]:
            if ch in ' \t':
                indent += ch
            else:
                break

    new_points = _serialize_points(waypoints, indent)
    return text[:points_start] + new_points + text[points_end:]


def repack_miz(original_miz_bytes: bytes, new_mission_text: str,
               kneeboards: list = None) -> bytes:
    """Repack a .miz archive with the edited mission text and optional kneeboards.

    kneeboards: list of dicts with keys:
        aircraft_type: str  (e.g. "FA-18C_hornet")
        filename: str       (e.g. "Bengal_1_Route.png")
        data: bytes         (raw PNG bytes)
    """
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original_miz_bytes), "r") as zin:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == "mission":
                    zout.writestr(item, new_mission_text.encode("utf-8"))
                else:
                    zout.writestr(item, zin.read(item.filename))

            # Inject kneeboard PNGs into KNEEBOARD/<aircraft_type>/IMAGES/
            # Shared cards (aircraft_type == '_SHARED_') go into KNEEBOARD/IMAGES/
            if kneeboards:
                for kb in kneeboards:
                    if kb['aircraft_type'] == '_SHARED_':
                        path = f"KNEEBOARD/IMAGES/{kb['filename']}"
                    else:
                        path = f"KNEEBOARD/{kb['aircraft_type']}/IMAGES/{kb['filename']}"
                    zout.writestr(path, kb["data"])
    return output.getvalue()
