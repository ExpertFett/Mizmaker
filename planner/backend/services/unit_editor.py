"""Surgical text-editing functions for DCS mission Lua files.

Ported from 856's lua_parser.py.  All functions operate on raw Lua text
and use regex + brace-depth counting so that the original formatting is
preserved exactly (no parse-then-serialise round-trip).
"""

import re


# ---------------------------------------------------------------------------
# Location finders
# ---------------------------------------------------------------------------

def _find_unit_block_start(text: str, unit_id: int) -> int:
    """Find the approximate start position of a unit block by its unitId."""
    pattern = rf'\["unitId"\]\s*=\s*{unit_id}\s*,'
    match = re.search(pattern, text)
    if not match:
        raise ValueError(f"Unit {unit_id} not found in mission text")
    return match.start()


def _find_group_block_start(text: str, group_id: int) -> int:
    """Find the position of ["groupId"] = N in the mission text.

    This is the simple 856-style search (first occurrence).  It is used for
    unit-level edits where groupId ambiguity is less of a problem because we
    search near the anchor.
    """
    pattern = rf'\["groupId"\]\s*=\s*{group_id}\s*,'
    match = re.search(pattern, text)
    if not match:
        raise ValueError(f"Group {group_id} not found in mission text")
    return match.start()


# ---------------------------------------------------------------------------
# Unit-level edit helpers
# ---------------------------------------------------------------------------

def _replace_prop_field(text: str, unit_id: int, lua_field: str, new_value: str) -> str:
    """Replace a string field in AddPropAircraft for a specific unit."""
    unit_pos = _find_unit_block_start(text, unit_id)

    search_start = max(0, unit_pos - 3000)
    search_end = min(len(text), unit_pos + 3000)
    region = text[search_start:search_end]

    pattern = rf'(\["{lua_field}"\]\s*=\s*)"([^"]*)"'
    match = re.search(pattern, region)
    if not match:
        raise ValueError(f"Field {lua_field} not found near unit {unit_id}")

    abs_start = search_start + match.start()
    abs_end = search_start + match.end()
    replacement = f'{match.group(1)}"{new_value}"'
    text = text[:abs_start] + replacement + text[abs_end:]
    return text


def _build_network_list_block(key: str, unit_ids: list, base_indent: str) -> str:
    """Build a Lua block for donors or teamMembers."""
    if not unit_ids:
        return f'["{key}"] = {{}}'

    entry_indent = base_indent + "\t\t"
    entries = []
    for i, uid in enumerate(unit_ids, 1):
        entries.append(
            f"{entry_indent}[{i}] = \n"
            f"{entry_indent}{{\n"
            f"{entry_indent}\t[\"missionUnitId\"] = {uid},\n"
            f"{entry_indent}}}, -- end of [{i}]"
        )
    inner = "\n".join(entries)
    return (
        f'["{key}"] = \n'
        f'{base_indent}\t\t\t\t\t\t\t\t\t{{\n'
        f'{inner}\n'
        f'{base_indent}\t\t\t\t\t\t\t\t\t}}, -- end of ["{key}"]'
    )


def _replace_network_list(text: str, unit_id: int, key: str, unit_ids: list) -> str:
    """Replace or insert a donors/teamMembers block for a specific unit."""
    unit_pos = _find_unit_block_start(text, unit_id)

    # Network/datalinks can be far from unitId (payload data in between)
    search_start = max(0, unit_pos - 5000)
    search_end = min(len(text), unit_pos + 5000)
    region = text[search_start:search_end]

    # Try to find existing block: ["key"] = { ... }
    pattern = rf'\["{key}"\]\s*=\s*\n?\s*\{{'
    match = re.search(pattern, region)

    if match:
        # Found existing block -- brace-match to find its closing brace
        brace_start = match.end() - 1
        depth = 0
        i = brace_start
        while i < len(region):
            if region[i] == '{':
                depth += 1
            elif region[i] == '}':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        block_end = i + 1
        # Include trailing comment
        rest = region[block_end:]
        eol = re.match(r',\s*-- end of \["' + re.escape(key) + r'"\]', rest)
        if eol:
            block_end += eol.end()

        # Detect indentation
        lines_before = region[:match.start()].split("\n")
        base_indent = ""
        for line in reversed(lines_before):
            if line.strip():
                base_indent = re.match(r"(\s*)", line).group(1)
                break

        replacement = _build_network_list_block(key, unit_ids, base_indent)
        abs_start = search_start + match.start()
        abs_end = search_start + block_end
        text = text[:abs_start] + replacement + text[abs_end:]
    else:
        # No existing block -- insert into ["network"] = { ... }
        network_pattern = r'\["network"\]\s*=\s*\n?\s*\{'
        net_match = re.search(network_pattern, region)
        if not net_match:
            raise ValueError(f"Network block not found near unit {unit_id}")

        lines_before = region[:net_match.start()].split("\n")
        base_indent = ""
        for line in reversed(lines_before):
            if line.strip():
                base_indent = re.match(r"(\s*)", line).group(1)
                break
        inner_indent = base_indent + "\t"

        new_block = "\n" + inner_indent + _build_network_list_block(key, unit_ids, inner_indent)

        insert_pos = search_start + net_match.end()
        text = text[:insert_pos] + new_block + text[insert_pos:]

    return text


def _replace_donors(text: str, unit_id: int, donor_ids: list) -> str:
    """Replace or insert the donors block for a specific unit."""
    return _replace_network_list(text, unit_id, "donors", donor_ids)


def _replace_team_members(text: str, unit_id: int, member_ids: list) -> str:
    """Replace or insert the teamMembers block for a specific unit."""
    return _replace_network_list(text, unit_id, "teamMembers", member_ids)


def _replace_pylon_clsid(text: str, unit_id: int, pylon_num: int, new_clsid: str,
                          settings_overrides: dict | None = None) -> str:
    """Replace the CLSID for a specific pylon on a specific unit.

    Finds the pylon block [N] = { ["CLSID"] = "...", ... } within the payload
    and replaces the CLSID value.  Writes default settings from
    launcher_settings.json, with optional overrides from the user.
    """
    from services.unit_extractor import build_default_settings

    unit_pos = _find_unit_block_start(text, unit_id)
    search_start = max(0, unit_pos - 5000)
    search_end = min(len(text), unit_pos + 5000)
    region = text[search_start:search_end]

    # Find the pylons section within this unit's payload
    pylons_match = re.search(r'\["pylons"\]\s*=\s*\n?\s*\{', region)
    if not pylons_match:
        raise ValueError(f"Pylons section not found near unit {unit_id}")

    # Find the specific pylon block: [N] = { ... }
    pylons_region = region[pylons_match.start():]
    pylon_pattern = rf'\[{pylon_num}\]\s*=\s*\n?\s*\{{'
    pylon_match = re.search(pylon_pattern, pylons_region)
    if not pylon_match:
        raise ValueError(f"Pylon {pylon_num} not found near unit {unit_id}")

    # Brace-match to find the closing brace for this pylon
    brace_start = pylon_match.end() - 1
    depth = 0
    i = brace_start
    while i < len(pylons_region):
        if pylons_region[i] == '{':
            depth += 1
        elif pylons_region[i] == '}':
            depth -= 1
            if depth == 0:
                break
        i += 1

    # Include trailing comment
    pylon_end = i + 1
    rest = pylons_region[pylon_end:]
    eol_match = re.match(r',\s*-- end of \[\d+\]', rest)
    if eol_match:
        pylon_end += eol_match.end()

    old_pylon = pylons_region[pylon_match.start():pylon_end]

    # Detect indentation
    lines = old_pylon.split('\n')
    first_line = lines[0] if lines else ''
    indent_match = re.match(r'(\s*)', first_line)
    indent = indent_match.group(1) if indent_match else '\t\t\t\t\t\t\t\t\t\t'

    # Build settings from defaults + overrides
    settings = build_default_settings(new_clsid)
    if settings_overrides:
        settings.update(settings_overrides)

    # Build new pylon block with CLSID and settings
    if settings:
        settings_lines = []
        for k, v in settings.items():
            if isinstance(v, str):
                settings_lines.append(f'{indent}\t\t["{k}"] = "{v}",')
            elif isinstance(v, bool):
                settings_lines.append(f'{indent}\t\t["{k}"] = {str(v).lower()},')
            elif isinstance(v, (int, float)):
                settings_lines.append(f'{indent}\t\t["{k}"] = {v},')
        settings_block = "\n".join(settings_lines)
        new_pylon = (
            f'[{pylon_num}] = \n'
            f'{indent}{{\n'
            f'{indent}\t["CLSID"] = "{new_clsid}",\n'
            f'{indent}\t["settings"] = \n'
            f'{indent}\t{{\n'
            f'{settings_block}\n'
            f'{indent}\t}}, -- end of ["settings"]\n'
            f'{indent}}}, -- end of [{pylon_num}]'
        )
    else:
        new_pylon = (
            f'[{pylon_num}] = \n'
            f'{indent}{{\n'
            f'{indent}\t["CLSID"] = "{new_clsid}",\n'
            f'{indent}}}, -- end of [{pylon_num}]'
        )

    # Replace in the full text
    abs_offset = search_start + pylons_match.start()
    old_abs_start = abs_offset + pylon_match.start()
    old_abs_end = abs_offset + pylon_end
    text = text[:old_abs_start] + new_pylon + text[old_abs_end:]
    return text


def _replace_laser_code(text: str, unit_id: int, laser_code: int) -> str:
    """Replace laser_code in all laser-carrying pylons for a unit.

    Finds every pylon that has a ["laser_code"] setting and replaces the value.
    """
    unit_pos = _find_unit_block_start(text, unit_id)
    search_start = max(0, unit_pos - 5000)
    search_end = min(len(text), unit_pos + 5000)
    region = text[search_start:search_end]

    # Find the pylons section
    pylons_match = re.search(r'\["pylons"\]\s*=\s*\n?\s*\{', region)
    if not pylons_match:
        raise ValueError(f"Pylons section not found near unit {unit_id}")

    # Find the end of the pylons block via brace-matching
    brace_pos = search_start + pylons_match.end() - 1
    depth = 1
    i = brace_pos + 1
    while i < len(text) and depth > 0:
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
        i += 1
    pylons_region_start = search_start + pylons_match.start()
    pylons_region_end = i

    # Find all ["laser_code"] = NNNN within this pylons block
    pattern = re.compile(r'(\["laser_code"\]\s*=\s*)(\d+)')
    replacements = []
    for m in pattern.finditer(text, pylons_region_start, pylons_region_end):
        replacements.append((m.start(2), m.end(2)))

    if not replacements:
        raise ValueError(f"No laser_code settings found in pylons for unit {unit_id}")

    # Replace backwards to preserve positions
    for start, end in reversed(replacements):
        text = text[:start] + str(laser_code) + text[end:]

    return text


def _extract_payload_block(text: str, unit_id: int) -> str:
    """Extract the raw Lua text of a unit's payload block."""
    unit_pos = _find_unit_block_start(text, unit_id)
    search_start = max(0, unit_pos - 5000)
    search_end = min(len(text), unit_pos + 5000)
    region = text[search_start:search_end]

    # Find ["payload"] = { ... }, matching braces
    match = re.search(r'\["payload"\]\s*=\s*\n?\s*\{', region)
    if not match:
        raise ValueError(f"Payload block not found near unit {unit_id}")

    # Brace-match to find the closing brace
    brace_start = match.end() - 1
    depth = 0
    i = brace_start
    while i < len(region):
        if region[i] == '{':
            depth += 1
        elif region[i] == '}':
            depth -= 1
            if depth == 0:
                break
        i += 1

    # Include the end-of comment if present
    end = i + 1
    rest = region[end:]
    eol_match = re.match(r',\s*-- end of \["payload"\]', rest)
    if eol_match:
        end += eol_match.end()

    return region[match.start():end]


def _copy_payload_block(text: str, source_uid: int, target_uid: int) -> str:
    """Replace target unit's payload block with source unit's payload block."""
    source_block = _extract_payload_block(text, source_uid)
    target_block = _extract_payload_block(text, target_uid)

    target_pos = text.find(target_block)
    if target_pos == -1:
        raise ValueError(f"Could not locate payload block for unit {target_uid}")

    text = text[:target_pos] + source_block + text[target_pos + len(target_block):]
    return text


def _replace_unit_name(text: str, unit_id: int, new_name: str) -> str:
    """Replace the ["name"] field for a specific unit, found by unitId."""
    unit_pos = _find_unit_block_start(text, unit_id)
    search_start = max(0, unit_pos - 3000)
    search_end = min(len(text), unit_pos + 3000)
    region = text[search_start:search_end]

    rel_pos = unit_pos - search_start
    name_pattern = re.compile(r'\["name"\]\s*=\s*"([^"]*)"')

    # Search forward and backward from unitId, pick the closest match
    best = None
    best_dist = float('inf')
    for m in name_pattern.finditer(region):
        dist = abs(m.start() - rel_pos)
        if dist < best_dist:
            best_dist = dist
            best = m

    if not best or best_dist > 2000:
        raise ValueError(f"Name field not found near unit {unit_id}")

    abs_start = search_start + best.start(1)
    abs_end = search_start + best.end(1)
    text = text[:abs_start] + new_name + text[abs_end:]
    return text


def _replace_livery(text: str, unit_id: int, new_livery: str) -> str:
    """Replace the ["livery_id"] field for a specific unit.
    If the field doesn't exist, insert it near the unit block."""
    unit_pos = _find_unit_block_start(text, unit_id)
    search_start = max(0, unit_pos - 3000)
    search_end = min(len(text), unit_pos + 3000)
    region = text[search_start:search_end]

    rel_pos = unit_pos - search_start
    livery_pattern = re.compile(r'\["livery_id"\]\s*=\s*"([^"]*)"')

    best = None
    best_dist = float('inf')
    for m in livery_pattern.finditer(region):
        dist = abs(m.start() - rel_pos)
        if dist < best_dist:
            best_dist = dist
            best = m

    if best and best_dist <= 2000:
        # Replace existing livery_id value
        abs_start = search_start + best.start(1)
        abs_end = search_start + best.end(1)
        text = text[:abs_start] + new_livery + text[abs_end:]
    else:
        # No livery_id field — insert one after the ["type"] field for this unit
        type_pattern = re.compile(r'\["type"\]\s*=\s*"[^"]*"\s*,')
        type_match = None
        type_dist = float('inf')
        for m in type_pattern.finditer(region):
            dist = abs(m.start() - rel_pos)
            if dist < type_dist:
                type_dist = dist
                type_match = m

        if type_match and type_dist <= 2000:
            insert_pos = search_start + type_match.end()
            indent = "\n                "  # match typical DCS Lua indentation
            text = text[:insert_pos] + f'{indent}["livery_id"] = "{new_livery}",' + text[insert_pos:]
        else:
            import logging
            logging.warning(f"Cannot insert livery_id for unit {unit_id} — no anchor found")

    return text


def _replace_skill(text: str, unit_id: int, new_skill: str) -> str:
    """Replace skill level for a unit."""
    unit_pos = _find_unit_block_start(text, unit_id)
    search_end = min(len(text), unit_pos + 3000)
    region = text[unit_pos:search_end]

    pattern = r'(\["skill"\]\s*=\s*")([^"]*)'
    m = re.search(pattern, region)
    if m:
        abs_start = unit_pos + m.start(2)
        abs_end = unit_pos + m.end(2)
        text = text[:abs_start] + new_skill + text[abs_end:]
    return text


def _replace_radio_frequency(text: str, unit_id: int, freq_hz: int) -> str:
    """Replace Radio[1] frequency for a unit."""
    unit_pos = _find_unit_block_start(text, unit_id)
    search_end = min(len(text), unit_pos + 5000)
    region = text[unit_pos:search_end]

    pattern = r'(\["frequency"\]\s*=\s*)(\d+)'
    m = re.search(pattern, region)
    if m:
        abs_start = unit_pos + m.start(2)
        abs_end = unit_pos + m.end(2)
        text = text[:abs_start] + str(freq_hz) + text[abs_end:]
    return text


# ---------------------------------------------------------------------------
# Group-level edit functions
# ---------------------------------------------------------------------------

def _replace_group_field(text: str, group_id: int, field: str, new_value) -> str:
    """Replace a field (task, frequency, modulation) on a group."""
    group_pos = _find_group_block_start(text, group_id)
    search_end = min(len(text), group_pos + 10000)
    region = text[group_pos:search_end]

    if isinstance(new_value, str):
        lua_val = f'"{new_value}"'
    elif isinstance(new_value, bool):
        lua_val = "true" if new_value else "false"
    else:
        lua_val = str(new_value)

    pattern = rf'(\["{field}"\]\s*=\s*)([^,\n]+)'
    m = re.search(pattern, region)
    if m:
        abs_start = group_pos + m.start(2)
        abs_end = group_pos + m.end(2)
        text = text[:abs_start] + lua_val + text[abs_end:]
    return text


def _rename_group_and_units(text: str, group_id: int, new_group_name: str | None,
                            unit_names: dict) -> str:
    """Rename a group and/or its units.

    Args:
        group_id: The groupId to find.
        new_group_name: New name for the group (None to skip group rename).
        unit_names: Dict of {unitId: newName} for individual unit renames.
    """
    # Rename individual units first (by unitId -- independent of group position)
    # Process in reverse unitId order to avoid position shifts affecting later renames
    for uid in sorted(unit_names.keys(), key=int, reverse=True):
        text = _replace_unit_name(text, int(uid), unit_names[uid])

    # Rename the group itself
    if new_group_name:
        group_pos = _find_group_block_start(text, group_id)

        # The group-level ["name"] appears AFTER the ["units"] block.
        # Find ["units"] = { ... }, brace-match to skip past it, then find ["name"].
        units_match = re.search(r'\["units"\]\s*=\s*\n?\s*\{', text[group_pos:group_pos + 500])
        if not units_match:
            raise ValueError(f"Units block not found near group {group_id}")

        # Brace-match to find end of units block
        brace_start = group_pos + units_match.end() - 1
        depth = 1
        i = brace_start + 1
        while i < len(text) and depth > 0:
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
            i += 1
        units_end = i  # position right after closing }

        # Find the first ["name"] after the units block -- that's the group name
        name_match = re.search(r'\["name"\]\s*=\s*"([^"]*)"', text[units_end:units_end + 500])
        if not name_match:
            raise ValueError(f"Group name not found after units block for group {group_id}")

        abs_start = units_end + name_match.start(1)
        abs_end = units_end + name_match.end(1)
        text = text[:abs_start] + new_group_name + text[abs_end:]

    return text


# ---------------------------------------------------------------------------
# Mission-level edit functions
# ---------------------------------------------------------------------------

def _replace_weather_field(text: str, field_path: str, new_value) -> str:
    """Replace a weather field in the mission Lua text.

    field_path examples: 'weather.wind.atGround.speed', 'weather.clouds.base'
    """
    parts = field_path.split(".")
    lua_key = parts[-1]

    if isinstance(new_value, bool):
        lua_val = "true" if new_value else "false"
    elif isinstance(new_value, (int, float)):
        lua_val = str(new_value)
    else:
        lua_val = f'"{new_value}"'

    pattern = rf'(\["{lua_key}"\]\s*=\s*)([^,\n]+)'
    match = re.search(pattern, text)
    if match:
        text = text[:match.start(2)] + lua_val + text[match.end(2):]
    return text


def _replace_weather_block(text: str, weather_data: dict) -> str:
    """Apply all weather changes via surgical text replacement."""
    # Wind
    wind = weather_data.get("wind", {})
    for level in ("atGround", "at2000", "at8000"):
        level_data = wind.get(level, {})
        if "speed" in level_data:
            pattern = rf'(\["{level}"\]\s*=\s*\n?\s*\{{[^}}]*?\["speed"\]\s*=\s*)([^,\n]+)'
            m = re.search(pattern, text, re.DOTALL)
            if m:
                text = text[:m.start(2)] + str(level_data["speed"]) + text[m.end(2):]
        if "dir" in level_data:
            pattern = rf'(\["{level}"\]\s*=\s*\n?\s*\{{[^}}]*?\["dir"\]\s*=\s*)([^,\n]+)'
            m = re.search(pattern, text, re.DOTALL)
            if m:
                text = text[:m.start(2)] + str(level_data["dir"]) + text[m.end(2):]

    # Clouds
    clouds = weather_data.get("clouds", {})
    for field in ("base", "density", "thickness", "iprecptns"):
        if field in clouds:
            pattern = rf'(\["clouds"\]\s*=\s*\n?\s*\{{[^}}]*?\["{field}"\]\s*=\s*)([^,\n]+)'
            m = re.search(pattern, text, re.DOTALL)
            if m:
                text = text[:m.start(2)] + str(clouds[field]) + text[m.end(2):]
    # Cloud preset (string value)
    if "preset" in clouds:
        preset_val = clouds["preset"]
        pattern = r'(\["preset"\]\s*=\s*)("[^"]*")'
        m = re.search(pattern, text)
        if m:
            text = text[:m.start(2)] + f'"{preset_val}"' + text[m.end(2):]

    # Simple top-level weather fields
    simple_fields = {
        "enable_fog": weather_data.get("fog", {}).get("enabled"),
        "fogVisibility": weather_data.get("fog", {}).get("visibility"),
        "fogThickness": weather_data.get("fog", {}).get("thickness"),
        "groundTurbulence": weather_data.get("groundTurbulence"),
        "qnh": weather_data.get("qnh"),
        "enable_dust": weather_data.get("dust", {}).get("enabled"),
        "dustDensity": weather_data.get("dust", {}).get("density"),
    }
    for field, value in simple_fields.items():
        if value is None:
            continue
        if isinstance(value, bool):
            lua_val = "true" if value else "false"
        else:
            lua_val = str(value)
        pattern = rf'(\["{field}"\]\s*=\s*)([^,\n]+)'
        m = re.search(pattern, text)
        if m:
            text = text[:m.start(2)] + lua_val + text[m.end(2):]

    # Visibility distance
    vis_dist = weather_data.get("visibility")
    if vis_dist is not None:
        pattern = r'(\["distance"\]\s*=\s*)([^,\n]+)'
        vis_block = re.search(r'\["visibility"\]\s*=\s*\n?\s*\{', text)
        if vis_block:
            m = re.search(pattern, text[vis_block.start():])
            if m:
                pos = vis_block.start() + m.start(2)
                text = text[:pos] + str(vis_dist) + text[vis_block.start() + m.end(2):]

    # Temperature
    temp = weather_data.get("temperature")
    if temp is not None:
        pattern = r'(\["temperature"\]\s*=\s*)([^,\n]+)'
        m = re.search(pattern, text)
        if m:
            text = text[:m.start(2)] + str(temp) + text[m.end(2):]

    # Date
    date_data = weather_data.get("date")
    if date_data:
        for field, key in [("Day", "day"), ("Month", "month"), ("Year", "year")]:
            if key in date_data:
                pattern = rf'(\["{field}"\]\s*=\s*)(\d+)'
                m = re.search(pattern, text)
                if m:
                    text = text[:m.start(2)] + str(date_data[key]) + text[m.end(2):]

    # Start time
    start_time = weather_data.get("startTime")
    if start_time is not None:
        pattern = r'(\["start_time"\]\s*=\s*)(\d+)'
        m = re.search(pattern, text)
        if m:
            text = text[:m.start(2)] + str(start_time) + text[m.end(2):]

    return text


def _find_replace_names(text: str, find: str, replace: str, use_regex: bool,
                        in_units: bool, in_groups: bool) -> tuple:
    """Find and replace in unit/group names.  Returns (new_text, count)."""
    count = 0
    if use_regex:
        rx = re.compile(find)
    else:
        rx = None

    def do_replace(s):
        nonlocal count
        if rx:
            new_s, n = rx.subn(replace, s)
        else:
            n = s.count(find)
            new_s = s.replace(find, replace)
        if n > 0:
            count += n
        return new_s, n > 0

    # Find all name fields and replace
    if in_units or in_groups:
        for m in reversed(list(re.finditer(r'\["name"\]\s*=\s*"([^"]*)"', text))):
            old_name = m.group(1)
            new_name, changed = do_replace(old_name)
            if changed:
                text = text[:m.start(1)] + new_name + text[m.end(1):]

    return text, count


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def apply_unit_edits(text: str, edits: list) -> str:
    """Apply surgical text replacements to the original mission Lua text.

    Each edit is a dict with: unitId, field, value (and sometimes groupId).
    Supported fields: voiceCallsignLabel, voiceCallsignNumber, stnL16, donors,
    teamMembers, copyLoadout, pylonChange, laserCode, groupRename, unitRename,
    livery, weather, groupTask, groupFrequency, groupModulation, skill,
    radioFrequency, findReplace
    """
    for edit in edits:
        field = edit.get("field")
        value = edit.get("value")
        if not field:
            continue

        try:
            # Mission-level edits (no unitId needed)
            if field == "weather":
                text = _replace_weather_block(text, value)
                continue
            elif field == "findReplace":
                text, _ = _find_replace_names(
                    text, value["find"], value["replace"],
                    value.get("regex", False),
                    value.get("inUnits", True), value.get("inGroups", True),
                )
                continue

            # Group-level edits
            if field in ("groupTask", "groupFrequency", "groupModulation"):
                group_id = edit["groupId"]
                lua_field = {
                    "groupTask": "task",
                    "groupFrequency": "frequency",
                    "groupModulation": "modulation",
                }[field]
                text = _replace_group_field(text, group_id, lua_field, value)
                continue

            unit_id = edit.get("unitId")

            if field == "voiceCallsignLabel":
                text = _replace_prop_field(text, unit_id, "VoiceCallsignLabel", value)
            elif field == "voiceCallsignNumber":
                text = _replace_prop_field(text, unit_id, "VoiceCallsignNumber", value)
            elif field == "stnL16":
                text = _replace_prop_field(text, unit_id, "STN_L16", value)
            elif field == "donors":
                text = _replace_donors(text, unit_id, value)
            elif field == "teamMembers":
                text = _replace_team_members(text, unit_id, value)
            elif field == "copyLoadout":
                text = _copy_payload_block(text, source_uid=value, target_uid=unit_id)
            elif field == "pylonChange":
                text = _replace_pylon_clsid(text, unit_id, value["pylon"], value["clsid"],
                                            value.get("settings"))
            elif field == "laserCode":
                text = _replace_laser_code(text, unit_id, int(value))
            elif field == "groupRename":
                text = _rename_group_and_units(text, value["groupId"],
                                               value.get("newGroupName"),
                                               value.get("unitNames", {}))
            elif field == "unitRename":
                text = _replace_unit_name(text, unit_id, value)
            elif field == "livery":
                text = _replace_livery(text, unit_id, value)
            elif field == "skill":
                text = _replace_skill(text, unit_id, value)
            elif field == "radioFrequency":
                text = _replace_radio_frequency(text, unit_id, int(value))
        except Exception as e:
            import logging
            logging.warning(f"Skipping edit {field} (unit={edit.get('unitId')}, group={edit.get('groupId')}): {e}")
            continue

    return text
