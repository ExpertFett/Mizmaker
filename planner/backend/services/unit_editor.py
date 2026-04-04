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


def _find_unit_block_bounds(text: str, unit_id: int) -> tuple[int, int]:
    """Find the start and end positions of the unit block containing ["unitId"] = N.

    DCS Lua unit blocks look like:
        [N] = {
            ["livery_id"] = "...",
            ["type"] = "FA-18C_hornet",
            ["payload"] = { ["pylons"] = {...}, ... },
            ...
            ["unitId"] = 5,
        }, -- end of [N]

    Returns (block_start, block_end) where block_start is the position of the
    opening '{' and block_end is after the closing '}'.
    """
    uid_pos = _find_unit_block_start(text, unit_id)

    # Walk backward to find the unit's opening '{'.
    # We need to track braces while skipping string contents.
    depth = 0
    i = uid_pos - 1
    while i >= 0:
        ch = text[i]
        if ch == '"':
            # Skip backward over string contents
            i -= 1
            while i >= 0 and text[i] != '"':
                if text[i] == '\\' and i > 0:
                    i -= 1  # skip escaped char
                i -= 1
            # i is now at the opening quote or -1
        elif ch == '}':
            depth += 1
        elif ch == '{':
            if depth == 0:
                break  # This is our opening brace
            depth -= 1
        i -= 1
    block_start = i

    # Walk forward from opening brace to find closing brace
    depth = 0
    j = block_start
    in_string = False
    while j < len(text):
        ch = text[j]
        if ch == '"' and (j == 0 or text[j - 1] != '\\'):
            in_string = not in_string
        elif not in_string:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    break
        j += 1
    block_end = j + 1

    return block_start, block_end


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

    Uses _find_unit_block_bounds to precisely scope to the correct unit block,
    then finds payload→pylons within that block only.
    """
    from services.unit_extractor import build_default_settings

    # Step 1: Find the exact unit block boundaries
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    # Step 2: Find ["payload"] within this unit block
    payload_match = re.search(r'\["payload"\]\s*=\s*\n?\s*\{', unit_block)
    if not payload_match:
        raise ValueError(f"Payload section not found in unit block for unitId {unit_id}")

    # Step 3: Find ["pylons"] within the payload section
    payload_region = unit_block[payload_match.start():]
    pylons_match = re.search(r'\["pylons"\]\s*=\s*\n?\s*\{', payload_region)
    if not pylons_match:
        raise ValueError(f"Pylons section not found in payload for unitId {unit_id}")

    # Step 4: Brace-match to find pylons section closing brace (skip string contents)
    pylons_open = pylons_match.end() - 1  # position of '{' relative to payload_region
    depth = 0
    pi = pylons_open
    in_str = False
    while pi < len(payload_region):
        ch = payload_region[pi]
        if ch == '"' and (pi == 0 or payload_region[pi - 1] != '\\'):
            in_str = not in_str
        elif not in_str:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    break
        pi += 1
    pylons_close = pi  # relative to payload_region

    # Extract pylons section text (from ["pylons"] to its closing brace)
    pylons_text = payload_region[pylons_match.start():pylons_close + 1]

    # Absolute position of pylons section start in full text
    pylons_abs = block_start + payload_match.start() + pylons_match.start()

    # Step 5: Search for the specific pylon [N] = { within the pylons section
    pylon_pattern = rf'\[{pylon_num}\]\s*=\s*\n?\s*\{{'
    pylon_match = re.search(pylon_pattern, pylons_text)

    if not pylon_match:
        # Pylon doesn't exist — insert new one before pylons closing brace
        if not new_clsid:
            return text

        # Detect indent from existing pylon entries or use default
        existing_pylon = re.search(r'(\s*)\[\d+\]\s*=\s*\n?\s*\{', pylons_text)
        indent = existing_pylon.group(1) if existing_pylon else '\n\t\t\t\t\t\t\t\t\t\t'

        settings = build_default_settings(new_clsid)
        if settings_overrides:
            settings.update(settings_overrides)

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
                f'{indent}[{pylon_num}] =\n'
                f'{indent}{{\n'
                f'{indent}\t["CLSID"] = "{new_clsid}",\n'
                f'{indent}\t["settings"] =\n'
                f'{indent}\t{{\n'
                f'{settings_block}\n'
                f'{indent}\t}}, -- end of ["settings"]\n'
                f'{indent}}}, -- end of [{pylon_num}]\n'
            )
        else:
            new_pylon = (
                f'{indent}[{pylon_num}] =\n'
                f'{indent}{{\n'
                f'{indent}\t["CLSID"] = "{new_clsid}",\n'
                f'{indent}}}, -- end of [{pylon_num}]\n'
            )

        # Insert before the closing brace of pylons section
        # pylons_close is relative to payload_region; convert to absolute
        abs_insert = block_start + payload_match.start() + pylons_close
        text = text[:abs_insert] + new_pylon + text[abs_insert:]
        return text

    # Step 6: Pylon exists — brace-match to find its closing brace
    brace_start = pylon_match.end() - 1
    depth = 0
    i = brace_start
    in_string = False
    while i < len(pylons_text):
        ch = pylons_text[i]
        if ch == '"' and (i == 0 or pylons_text[i - 1] != '\\'):
            in_string = not in_string
        elif not in_string:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    break
        i += 1

    # Include trailing comma and comment if present
    pylon_end = i + 1
    rest = pylons_text[pylon_end:]
    eol_match = re.match(r',\s*-- end of \[\d+\]', rest)
    if eol_match:
        pylon_end += eol_match.end()

    old_pylon = pylons_text[pylon_match.start():pylon_end]

    # Detect indentation from old pylon
    first_line = old_pylon.split('\n')[0] if old_pylon else ''
    indent_match = re.match(r'(\s*)', first_line)
    indent = indent_match.group(1) if indent_match else '\t\t\t\t\t\t\t\t\t\t'

    # Build settings
    settings = build_default_settings(new_clsid)
    if settings_overrides:
        settings.update(settings_overrides)

    # Build replacement pylon block
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
            f'[{pylon_num}] =\n'
            f'{indent}{{\n'
            f'{indent}\t["CLSID"] = "{new_clsid}",\n'
            f'{indent}\t["settings"] =\n'
            f'{indent}\t{{\n'
            f'{settings_block}\n'
            f'{indent}\t}}, -- end of ["settings"]\n'
            f'{indent}}}, -- end of [{pylon_num}]'
        )
    else:
        new_pylon = (
            f'[{pylon_num}] =\n'
            f'{indent}{{\n'
            f'{indent}\t["CLSID"] = "{new_clsid}",\n'
            f'{indent}}}, -- end of [{pylon_num}]'
        )

    # Replace in full text
    old_abs_start = pylons_abs + pylon_match.start()
    old_abs_end = pylons_abs + pylon_end
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
    import logging
    unit_pos = _find_unit_block_start(text, unit_id)

    # Walk backward from unitId to find the unit block's opening brace.
    # In DCS Lua, units are `[N] = { ... ["unitId"] = X, ... },`
    # livery_id is near the top of the block, unitId is near the bottom.
    depth = 0
    i = unit_pos
    while i > 0:
        ch = text[i]
        if ch == '}':
            depth += 1
        elif ch == '{':
            if depth == 0:
                break  # found the opening brace of this unit block
            depth -= 1
        i -= 1
    block_start = i

    # The unit block extends from block_start to somewhere past unit_pos
    unit_block = text[block_start:unit_pos + 500]

    livery_pattern = re.compile(r'\["livery_id"\]\s*=\s*"([^"]*)"')
    m = livery_pattern.search(unit_block)
    if m:
        abs_start = block_start + m.start(1)
        abs_end = block_start + m.end(1)
        logging.warning(f"[livery] Replacing livery for unit {unit_id}: '{text[abs_start:abs_end]}' -> '{new_livery}'")
        text = text[:abs_start] + new_livery + text[abs_end:]
    else:
        # No livery_id — insert after ["type"] within this unit block
        type_pattern = re.compile(r'\["type"\]\s*=\s*"[^"]*"\s*,')
        tm = type_pattern.search(unit_block)
        if tm:
            insert_pos = block_start + tm.end()
            indent = "\n                "
            logging.warning(f"[livery] Inserting livery_id for unit {unit_id}: '{new_livery}'")
            text = text[:insert_pos] + f'{indent}["livery_id"] = "{new_livery}",' + text[insert_pos:]
        else:
            logging.warning(f"[livery] Cannot insert livery_id for unit {unit_id} — no anchor found")

    return text


def _replace_heading(text: str, unit_id: int, heading_rad: float) -> str:
    """Replace heading for a unit (radians)."""
    unit_pos = _find_unit_block_start(text, unit_id)
    search_end = min(len(text), unit_pos + 3000)
    region = text[unit_pos:search_end]

    pattern = r'(\["heading"\]\s*=\s*)([0-9eE.+\-]+)'
    m = re.search(pattern, region)
    if m:
        abs_start = unit_pos + m.start(2)
        abs_end = unit_pos + m.end(2)
        text = text[:abs_start] + str(heading_rad) + text[abs_end:]
    return text


def _replace_late_activation(text: str, unit_id: int, enabled: bool) -> str:
    """Set lateActivation on the group that contains a given unit.

    lateActivation is a group-level field in DCS Lua.  We locate the unit,
    then search backward to find the enclosing group block and set the flag.
    """
    unit_pos = _find_unit_block_start(text, unit_id)
    lua_val = "true" if enabled else "false"

    # Search backward from unit position for the group-level region
    search_start = max(0, unit_pos - 15000)
    region = text[search_start:unit_pos]

    # Look for existing lateActivation in the group block above the unit
    pattern = r'(\["lateActivation"\]\s*=\s*)(true|false)'
    m = None
    for m in re.finditer(pattern, region):
        pass  # get the last match (closest to unit)

    if m:
        abs_start = search_start + m.start(2)
        abs_end = search_start + m.end(2)
        text = text[:abs_start] + lua_val + text[abs_end:]
    else:
        # No lateActivation field exists — insert one after groupId line
        gid_pattern = r'\["groupId"\]\s*=\s*\d+\s*,'
        gm = None
        for gm in re.finditer(gid_pattern, region):
            pass
        if gm:
            insert_pos = search_start + gm.end()
            text = text[:insert_pos] + f'\n\t\t\t\t["lateActivation"] = {lua_val},' + text[insert_pos:]

    return text


def _replace_tacan_beacon(text: str, unit_id: int, channel: int, band: str,
                          callsign: str) -> str:
    """Replace ActivateBeacon TACAN params for a unit's waypoint task.

    Finds the ActivateBeacon that has a matching unitId param, then updates
    its channel, modeChannel (band), and callsign.
    """
    # Find ALL ActivateBeacon occurrences and pick the one with matching unitId
    beacon_pattern = r'\["id"\]\s*=\s*"ActivateBeacon"'
    beacon_pos = None
    for m in re.finditer(beacon_pattern, text):
        # Check if this beacon's params contain our unitId
        region = text[m.start():m.start() + 1000]
        uid_match = re.search(rf'\["unitId"\]\s*=\s*{unit_id}\b', region)
        if uid_match:
            beacon_pos = m.start()
            break

    if beacon_pos is None:
        # Fallback: find the closest ActivateBeacon before the unit position
        unit_pos = _find_unit_block_start(text, unit_id)
        best = None
        for m in re.finditer(beacon_pattern, text):
            if m.start() < unit_pos:
                best = m.start()
            else:
                break
        if best is None:
            return text
        beacon_pos = best

    beacon_region = text[beacon_pos:beacon_pos + 1000]

    # Replace channel
    ch_match = re.search(r'(\["channel"\]\s*=\s*)(\d+)', beacon_region)
    if ch_match:
        abs_s = beacon_pos + ch_match.start(2)
        abs_e = beacon_pos + ch_match.end(2)
        text = text[:abs_s] + str(channel) + text[abs_e:]

    # Re-read region after text shift
    beacon_region = text[beacon_pos:beacon_pos + 1000]

    # Replace modeChannel (band: "X" or "Y")
    mode_val = '"Y"' if band.upper() == 'Y' else '"X"'
    mc_match = re.search(r'(\["modeChannel"\]\s*=\s*)("[^"]*"|\d+)', beacon_region)
    if mc_match:
        abs_s = beacon_pos + mc_match.start(2)
        abs_e = beacon_pos + mc_match.end(2)
        text = text[:abs_s] + mode_val + text[abs_e:]

    beacon_region = text[beacon_pos:beacon_pos + 1000]

    # Replace callsign
    cs_match = re.search(r'(\["callsign"\]\s*=\s*")([^"]*)', beacon_region)
    if cs_match:
        abs_s = beacon_pos + cs_match.start(2)
        abs_e = beacon_pos + cs_match.end(2)
        text = text[:abs_s] + callsign + text[abs_e:]

    return text


def _replace_callsign(text: str, unit_id: int, name_idx: int, flight: int,
                       pos: int, name_str: str) -> str:
    """Replace the callsign block for an AI unit.

    DCS Lua structure:
        ["callsign"] = {
            [1] = <name_index>,
            [2] = <flight_number>,
            [3] = <position_in_flight>,
            ["name"] = "<NameFF>",
        },
    """
    unit_pos = _find_unit_block_start(text, unit_id)
    search_end = min(len(text), unit_pos + 5000)
    region = text[unit_pos:search_end]

    # Replace [1] = name index
    m = re.search(r'(\["callsign"\]\s*=\s*\{[^}]*?\[1\]\s*=\s*)(\d+)', region)
    if m:
        abs_s = unit_pos + m.start(2)
        abs_e = unit_pos + m.end(2)
        text = text[:abs_s] + str(name_idx) + text[abs_e:]

    # Re-read region after text shift
    region = text[unit_pos:min(len(text), unit_pos + 5000)]

    # Replace [2] = flight number
    m = re.search(r'(\["callsign"\]\s*=\s*\{[^}]*?\[2\]\s*=\s*)(\d+)', region)
    if m:
        abs_s = unit_pos + m.start(2)
        abs_e = unit_pos + m.end(2)
        text = text[:abs_s] + str(flight) + text[abs_e:]

    region = text[unit_pos:min(len(text), unit_pos + 5000)]

    # Replace [3] = position
    m = re.search(r'(\["callsign"\]\s*=\s*\{[^}]*?\[3\]\s*=\s*)(\d+)', region)
    if m:
        abs_s = unit_pos + m.start(2)
        abs_e = unit_pos + m.end(2)
        text = text[:abs_s] + str(pos) + text[abs_e:]

    region = text[unit_pos:min(len(text), unit_pos + 5000)]

    # Replace ["name"] = "..."
    m = re.search(r'(\["callsign"\]\s*=\s*\{[^}]*?\["name"\]\s*=\s*")([^"]*)', region)
    if m:
        abs_s = unit_pos + m.start(2)
        abs_e = unit_pos + m.end(2)
        text = text[:abs_s] + name_str + text[abs_e:]

    return text


def _replace_onboard_num(text: str, unit_id: int, new_num: str) -> str:
    """Replace onboard_num (tail number) for a unit."""
    unit_pos = _find_unit_block_start(text, unit_id)
    search_end = min(len(text), unit_pos + 3000)
    region = text[unit_pos:search_end]

    pattern = r'(\["onboard_num"\]\s*=\s*")([^"]*)'
    m = re.search(pattern, region)
    if m:
        abs_start = unit_pos + m.start(2)
        abs_end = unit_pos + m.end(2)
        text = text[:abs_start] + new_num + text[abs_end:]
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
    import os as _os
    _dbg_path = _os.path.join(_os.path.dirname(_os.path.dirname(__file__)), "weather_debug.log")
    _log_lines = []
    def _log(msg):
        _log_lines.append(msg)

    _log(f"=== WEATHER REPLACE START ===")
    _log(f"weather_data keys: {list(weather_data.keys())}")
    _log(f"weather_data: {weather_data}")

    original_len = len(text)

    # --- Dump a snippet of the weather section for debugging ---
    weather_section = re.search(r'\["weather"\]\s*=\s*\n?\s*\{', text)
    if weather_section:
        snippet = text[weather_section.start():weather_section.start() + 2000]
        _log(f"WEATHER SECTION SNIPPET (first 2000 chars):\n{snippet}")
    else:
        _log("WARNING: Could not find [\"weather\"] block in text!")

    # Wind
    wind = weather_data.get("wind", {})
    for level in ("atGround", "at2000", "at8000"):
        level_data = wind.get(level, {})
        if "speed" in level_data:
            pattern = rf'(\["{level}"\]\s*=\s*\n?\s*\{{[^}}]*?\["speed"\]\s*=\s*)([^,\n]+)'
            m = re.search(pattern, text, re.DOTALL)
            if m:
                _log(f"WIND {level} speed: '{m.group(2)}' -> '{level_data['speed']}'")
                text = text[:m.start(2)] + str(level_data["speed"]) + text[m.end(2):]
            else:
                _log(f"WIND {level} speed: NO MATCH")
        if "dir" in level_data:
            pattern = rf'(\["{level}"\]\s*=\s*\n?\s*\{{[^}}]*?\["dir"\]\s*=\s*)([^,\n]+)'
            m = re.search(pattern, text, re.DOTALL)
            if m:
                _log(f"WIND {level} dir: '{m.group(2)}' -> '{level_data['dir']}'")
                text = text[:m.start(2)] + str(level_data["dir"]) + text[m.end(2):]
            else:
                _log(f"WIND {level} dir: NO MATCH")

    # Clouds
    clouds = weather_data.get("clouds", {})
    _log(f"CLOUDS data: {clouds}")
    for field in ("base", "density", "thickness", "iprecptns"):
        if field in clouds:
            pattern = rf'(\["clouds"\]\s*=\s*\n?\s*\{{[^}}]*?\["{field}"\]\s*=\s*)([^,\n]+)'
            m = re.search(pattern, text, re.DOTALL)
            if m:
                _log(f"CLOUDS {field}: '{m.group(2)}' -> '{clouds[field]}'")
                text = text[:m.start(2)] + str(clouds[field]) + text[m.end(2):]
            else:
                _log(f"CLOUDS {field}: NO MATCH for pattern")
    # Cloud preset — DCS 2.7+ REQUIRES a valid cloud preset for volumetric clouds.
    # Individual density/base/thickness are legacy fields ignored by the new renderer.
    # When no preset is specified, we pick one based on density to avoid blank skies.
    # Also: must scope the preset search to WITHIN the clouds block only (not halo etc).
    if "preset" in clouds:
        preset_val = clouds["preset"]
        # If no preset specified, pick a reasonable default based on cloud density
        if not preset_val:
            density = clouds.get("density", 0)
            if density == 0:
                preset_val = ""  # truly clear sky, no preset needed
            elif density <= 2:
                preset_val = "Preset1"   # FEW070 — few thin clouds
            elif density <= 4:
                preset_val = "Preset5"   # SCT080 — scattered clouds
            elif density <= 6:
                preset_val = "Preset10"  # BKN070 — broken clouds
            elif density <= 8:
                preset_val = "Preset15"  # OVC040 — overcast mid
            else:
                preset_val = "Preset22"  # OVC010 — heavy overcast low
            if preset_val:
                _log(f"CLOUDS preset: auto-selected '{preset_val}' for density={density}")

        clouds_block = re.search(r'\["clouds"\]\s*=\s*\n?\s*\{', text)
        if clouds_block:
            # Find the CLOSING brace of the clouds block to scope our search
            brace_start = text.index('{', clouds_block.start())
            depth = 0
            cb_end = brace_start
            for ci in range(brace_start, len(text)):
                if text[ci] == '{': depth += 1
                elif text[ci] == '}':
                    depth -= 1
                    if depth == 0:
                        cb_end = ci + 1
                        break
            clouds_text = text[clouds_block.start():cb_end]

            # Search for preset line ONLY within the clouds block
            line_pattern = r'[ \t]*\["preset"\]\s*=\s*"[^"]*"\s*,[ \t]*\n?'
            m_line = re.search(line_pattern, clouds_text)
            if m_line:
                abs_start = clouds_block.start() + m_line.start()
                abs_end = clouds_block.start() + m_line.end()
                if preset_val:
                    old_line = text[abs_start:abs_end]
                    indent = re.match(r'([ \t]*)', old_line).group(1)
                    new_line = f'{indent}["preset"] = "{preset_val}",\n'
                    _log(f"CLOUDS preset: '{m_line.group().strip()}' -> preset='{preset_val}'")
                    text = text[:abs_start] + new_line + text[abs_end:]
                else:
                    _log(f"CLOUDS preset: density=0, removing preset (was '{m_line.group().strip()}')")
                    text = text[:abs_start] + text[abs_end:]
            else:
                # No existing preset line — insert one if needed
                if preset_val:
                    _log(f"CLOUDS preset: inserting preset='{preset_val}'")
                    brace_pos = text.index('{', clouds_block.start())
                    field_match = re.search(r'\n([ \t]+)\["', text[brace_pos:brace_pos + 200])
                    if field_match:
                        indent = field_match.group(1)
                        insert_pos = brace_pos + field_match.start()
                        text = text[:insert_pos] + f'\n{indent}["preset"] = "{preset_val}",' + text[insert_pos:]
                else:
                    _log(f"CLOUDS preset: no existing line and density=0, skip")
        else:
            _log("CLOUDS preset: no clouds block found")

    # Top-level weather fields (booleans + numbers)
    simple_fields = {
        "enable_fog": weather_data.get("fog", {}).get("enabled"),
        "groundTurbulence": weather_data.get("groundTurbulence"),
        "qnh": weather_data.get("qnh"),
        "enable_dust": weather_data.get("dust", {}).get("enabled"),
        "dust_density": weather_data.get("dust", {}).get("density"),
    }
    for field, value in simple_fields.items():
        if value is None:
            _log(f"SIMPLE {field}: skipped (None)")
            continue
        if isinstance(value, bool):
            lua_val = "true" if value else "false"
        else:
            lua_val = str(value)
        pattern = rf'(\["{field}"\]\s*=\s*)([^,\n]+)'
        m = re.search(pattern, text)
        if m:
            _log(f"SIMPLE {field}: '{m.group(2)}' -> '{lua_val}'")
            text = text[:m.start(2)] + lua_val + text[m.end(2):]
        else:
            _log(f"SIMPLE {field}: NO MATCH (value={lua_val})")

    # Fog — nested inside ["fog"] = { ["visibility"] = N, ["thickness"] = N }
    fog_data = weather_data.get("fog", {})
    _log(f"FOG data: {fog_data}")
    fog_block = re.search(r'\["fog"\]\s*=\s*\n?\s*\{', text)
    if fog_block:
        # Find closing brace of fog block for proper scoping
        fb_brace = text.index('{', fog_block.start())
        fb_depth = 0
        fb_end = fb_brace
        for fi in range(fb_brace, len(text)):
            if text[fi] == '{': fb_depth += 1
            elif text[fi] == '}':
                fb_depth -= 1
                if fb_depth == 0:
                    fb_end = fi + 1
                    break
        fog_text = text[fog_block.start():fb_end]
        _log(f"FOG block found at pos {fog_block.start()}, full block: {repr(fog_text)}")

        for fog_field, fog_key in [("visibility", "visibility"), ("thickness", "thickness")]:
            if fog_key in fog_data:
                pattern = rf'(\["{fog_field}"\]\s*=\s*)([^,\n]+)'
                m = re.search(pattern, fog_text)
                if m:
                    pos = fog_block.start() + m.start(2)
                    end = fog_block.start() + m.end(2)
                    _log(f"FOG {fog_field}: '{m.group(2)}' -> '{fog_data[fog_key]}'")
                    text = text[:pos] + str(fog_data[fog_key]) + text[end:]
                    # Re-extract fog block text since positions shifted
                    fog_text = text[fog_block.start():fog_block.start() + len(fog_text) + 10]
                else:
                    _log(f"FOG {fog_field}: NO MATCH in fog block")
    else:
        _log("FOG: no fog block found in text!")

    # DCS 2.9+ uses a SEPARATE ["fog2"] block for the fog mode dropdown in ME.
    # mode: 0=off, 2=manual fog enabled. Without this block, DCS ME shows fog as Off.
    fog2_mode = fog_data.get("mode", 0)  # 0=Off, 1=Manual, 2=Auto
    fog2_block = re.search(r'\["fog2"\]\s*=\s*\n?\s*\{', text)
    if fog2_block:
        # Update existing mode field
        mode_pattern = r'(\["mode"\]\s*=\s*)([^,\n]+)'
        f2_brace = text.index('{', fog2_block.start())
        f2_depth = 0
        f2_end = f2_brace
        for fi in range(f2_brace, len(text)):
            if text[fi] == '{': f2_depth += 1
            elif text[fi] == '}':
                f2_depth -= 1
                if f2_depth == 0:
                    f2_end = fi + 1
                    break
        f2_text = text[fog2_block.start():f2_end]
        m_mode = re.search(mode_pattern, f2_text)
        if m_mode:
            pos = fog2_block.start() + m_mode.start(2)
            end_pos = fog2_block.start() + m_mode.end(2)
            _log(f"FOG2 mode: '{m_mode.group(2)}' -> '{fog2_mode}'")
            text = text[:pos] + str(fog2_mode) + text[end_pos:]
        else:
            _log(f"FOG2 block exists but no mode field found")
    else:
        # Insert ["fog2"] block — place it before ["fog"] block
        if fog_block:
            # Get indentation from the fog block
            line_start = text.rfind('\n', 0, fog_block.start()) + 1
            indent = ''
            for ch in text[line_start:fog_block.start()]:
                if ch in ' \t':
                    indent += ch
                else:
                    break
            fog2_insert = (
                f'{indent}["fog2"] = \n'
                f'{indent}{{\n'
                f'{indent}\t["mode"] = {fog2_mode},\n'
                f'{indent}}}, -- end of ["fog2"]\n'
            )
            _log(f"FOG2: inserting new block with mode={fog2_mode}")
            text = text[:line_start] + fog2_insert + text[line_start:]
        else:
            _log("FOG2: cannot insert, no fog block to reference")

    # Visibility distance
    vis_dist = weather_data.get("visibility")
    if vis_dist is not None:
        pattern = r'(\["distance"\]\s*=\s*)([^,\n]+)'
        vis_block = re.search(r'\["visibility"\]\s*=\s*\n?\s*\{', text)
        if vis_block:
            m = re.search(pattern, text[vis_block.start():])
            if m:
                pos = vis_block.start() + m.start(2)
                _log(f"VISIBILITY distance: '{m.group(2)}' -> '{vis_dist}'")
                text = text[:pos] + str(vis_dist) + text[vis_block.start() + m.end(2):]
            else:
                _log(f"VISIBILITY distance: NO MATCH")
        else:
            _log("VISIBILITY: no visibility block found")
    else:
        _log("VISIBILITY: not in weather_data")

    # Temperature
    temp = weather_data.get("temperature")
    if temp is not None:
        pattern = r'(\["temperature"\]\s*=\s*)([^,\n]+)'
        m = re.search(pattern, text)
        if m:
            _log(f"TEMPERATURE: '{m.group(2)}' -> '{temp}'")
            text = text[:m.start(2)] + str(temp) + text[m.end(2):]
        else:
            _log(f"TEMPERATURE: NO MATCH")
    else:
        _log("TEMPERATURE: not in weather_data")

    # Halo preset — scoped to the ["halo"] block
    halo_preset = weather_data.get("haloPreset")
    if halo_preset is not None:
        halo_block = re.search(r'\["halo"\]\s*=\s*\n?\s*\{', text)
        if halo_block:
            # Find the closing brace of halo block for scoping
            brace_start = text.index('{', halo_block.start())
            depth = 0
            hb_end = brace_start
            for hi in range(brace_start, len(text)):
                if text[hi] == '{': depth += 1
                elif text[hi] == '}':
                    depth -= 1
                    if depth == 0:
                        hb_end = hi + 1
                        break
            halo_text = text[halo_block.start():hb_end]
            preset_pattern = r'(\["preset"\]\s*=\s*)("[^"]*")'
            m = re.search(preset_pattern, halo_text)
            if m:
                pos = halo_block.start() + m.start(2)
                end = halo_block.start() + m.end(2)
                _log(f"HALO preset: '{m.group(2)}' -> '\"{halo_preset}\"'")
                text = text[:pos] + f'"{halo_preset}"' + text[end:]
            else:
                # No existing preset — insert one
                field_match = re.search(r'\n([ \t]+)', halo_text)
                if field_match:
                    indent = field_match.group(1)
                    insert_pos = brace_start + 1
                    text = text[:insert_pos] + f'\n{indent}["preset"] = "{halo_preset}",' + text[insert_pos:]
                    _log(f"HALO preset: inserted '{halo_preset}'")
        else:
            _log("HALO: no halo block found")

    # Date — scoped to the ["date"] block at mission root level (single tab indent)
    date_data = weather_data.get("date")
    if date_data:
        date_block = re.search(r'\n\t\["date"\]\s*=\s*\n?\s*\{', text)
        if date_block:
            date_region_start = date_block.start()
            date_region = text[date_region_start:date_region_start + 200]
            _log(f"DATE block snippet: {repr(date_region)}")
            for field, key in [("Day", "day"), ("Month", "month"), ("Year", "year")]:
                if key in date_data:
                    pattern = rf'(\["{field}"\]\s*=\s*)(\d+)'
                    m = re.search(pattern, date_region)
                    if m:
                        pos = date_region_start + m.start(2)
                        end = date_region_start + m.end(2)
                        _log(f"DATE {field}: '{m.group(2)}' -> '{date_data[key]}'")
                        text = text[:pos] + str(date_data[key]) + text[end:]
                        date_region = text[date_region_start:date_region_start + 200]
                    else:
                        _log(f"DATE {field}: NO MATCH")
        else:
            _log("DATE: no date block found")

    # Start time — mission root level (single tab indent, near end of file)
    start_time = weather_data.get("startTime")
    if start_time is not None:
        pattern = r'(\["start_time"\]\s*=\s*)(\d+)'
        all_matches = list(re.finditer(pattern, text))
        _log(f"START_TIME: found {len(all_matches)} matches, using last")
        if all_matches:
            m = all_matches[-1]
            _log(f"START_TIME: '{m.group(2)}' -> '{int(start_time)}'")
            text = text[:m.start(2)] + str(int(start_time)) + text[m.end(2):]
    else:
        _log("START_TIME: not in weather_data")

    _log(f"TEXT SIZE: {original_len} -> {len(text)} ({len(text)-original_len:+d})")
    _log(f"=== WEATHER REPLACE END ===\n")

    with open(_dbg_path, "a") as _f:
        _f.write("\n".join(_log_lines) + "\n")

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
    radioFrequency, onboard_num, callsign, tacan, findReplace
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
            elif field == "lateActivation":
                text = _replace_late_activation(text, unit_id, bool(value))
            elif field == "heading":
                text = _replace_heading(text, unit_id, float(value))
            elif field == "radioFrequency":
                text = _replace_radio_frequency(text, unit_id, int(value))
            elif field == "onboard_num":
                text = _replace_onboard_num(text, unit_id, str(value))
            elif field == "tacan":
                text = _replace_tacan_beacon(
                    text, unit_id,
                    int(value["channel"]), str(value.get("band", "X")),
                    str(value.get("callsign", "")),
                )
            elif field == "callsign":
                text = _replace_callsign(
                    text, unit_id,
                    int(value["nameIdx"]), int(value["flight"]),
                    int(value["pos"]), str(value["name"]),
                )
        except Exception as e:
            import logging
            logging.warning(f"Skipping edit {field} (unit={edit.get('unitId')}, group={edit.get('groupId')}): {e}")
            continue

    return text
