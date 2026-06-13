"""Surgical text-editing functions for DCS mission Lua files.

Ported from 856's lua_parser.py.  All functions operate on raw Lua text
and use regex + brace-depth counting so that the original formatting is
preserved exactly (no parse-then-serialise round-trip).
"""

import re


# ---------------------------------------------------------------------------
# Lua string escape helpers
# ---------------------------------------------------------------------------
#
# DCS mission Lua uses double-quoted string literals with C-style escapes:
# `\"` for an embedded double quote, `\\` for a backslash, `\n` for newline.
# A surgical writer that pastes a user-supplied name directly into the
# source text MUST escape these chars first — otherwise an inner `"` ends
# the string mid-name, the brace-matcher downstream chokes, and DCS
# refuses to load the .miz ("'}' expected near 'X'").
#
# The matching read-side pattern `_LUA_STR_VALUE` accepts `\"` and `\\`
# inside the captured value so that names containing escaped quotes round-
# trip through the find/replace path without being truncated at the first
# inner quote (the old `([^"]*)` capture stopped there and rewrote only
# the prefix).
_LUA_STR_VALUE = r'((?:[^"\\]|\\.)*)'  # capture group: 0+ non-"-non-\\ or \X


def _lua_str_escape(s: str) -> str:
    """Escape a Python string for embedding inside a Lua double-quoted literal.

    Order matters — escape backslash first so we don't double-escape the
    backslashes we ourselves emit for `"` and `\\n`.
    """
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')


def _lua_str_unescape(s: str) -> str:
    """Inverse of _lua_str_escape. `\\n` → newline, `\\"` → `"`, `\\\\` → `\\`.

    Used when round-tripping an existing Lua string value through a
    user-facing transform (e.g. find/replace), where the user types
    against the unescaped form.
    """
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i + 1 < len(s):
            nxt = s[i + 1]
            if nxt == 'n':
                out.append('\n')
            elif nxt == 't':
                out.append('\t')
            elif nxt == 'r':
                out.append('\r')
            else:
                out.append(nxt)  # \", \\, \', etc.
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


# ---------------------------------------------------------------------------
# Location finders
# ---------------------------------------------------------------------------

def _find_unit_block_start(text: str, unit_id: int) -> int:
    """Find the position of ["unitId"] = N inside the unit's actual block.

    DCS Lua references unit IDs in two distinct contexts:
      1. The unit definition itself, inside its parent group's
         ["units"] = { [N] = { ..., ["unitId"] = N, ... } } block.
      2. Task / waypoint action params (ActivateBeacon, ActivateICLS,
         AI_TASK, etc.) that target the unit at runtime.

    The first occurrence in mission text is often (2), not (1) — for
    simple.miz the carrier (unit 2) gets its first ["unitId"] = 2 hit
    inside an ActivateBeacon's params block, then the actual unit
    definition is later. Naively returning re.search().start() drove
    handlers like _replace_livery into the beacon's surroundings,
    silently no-op-ing the edit.

    Heuristic to prefer the real unit block: a unit definition has
    ["type"] = "..." within ~1500 chars of its unitId line (typically
    a few lines before or after, depending on field ordering). Task
    params don't carry a ["type"] string field — they have ["type"] =
    <number> (an enum) instead. We check for the string-typed field
    specifically.

    Falls back to the first match if no candidate has nearby ["type"]
    — preserves old behaviour for missions with unusual structure.
    """
    pattern = rf'\["unitId"\]\s*=\s*{unit_id}\s*,'
    matches = list(re.finditer(pattern, text))
    if not matches:
        raise ValueError(f"Unit {unit_id} not found in mission text")

    type_string_pattern = re.compile(r'\["type"\]\s*=\s*"[^"]*"')
    for m in matches:
        # Look BEFORE the unitId only — unit blocks have ["type"] =
        # "string" preceding ["unitId"] in field order, while task
        # params have ["type"] = <number> (an enum). Looking forward
        # would match the next unit block's type, falsely accepting
        # the task-param position. Window of 800 chars is plenty for
        # a unit block (typical block: type, unitId within ~200
        # chars), and tight enough to avoid bleeding into the previous
        # unit's fields.
        window_start = max(0, m.start() - 800)
        window_end = m.start()
        if type_string_pattern.search(text[window_start:window_end]):
            return m.start()

    # Fallback: first match. Logs a warning so we know when this
    # disambiguator missed.
    import logging
    logging.warning(
        f"_find_unit_block_start({unit_id}): no ['type']=string anchor near "
        f"any unitId match; falling back to first occurrence (may be a task "
        f"param, not the unit block)."
    )
    return matches[0].start()


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


def _enclosing_block_bounds(text: str, pos: int) -> tuple[int, int]:
    """Return (start, end) of the innermost { ... } that directly encloses
    `pos`: start is the index of the opening '{', end is just past the
    matching '}'. String contents are skipped so braces/quotes inside Lua
    strings can't throw off the depth count. Returns (pos, pos) if no
    enclosing block is found.

    Used to brace-bound edits to a task-action block (ActivateBeacon /
    ActivateICLS) or a group block, instead of a fixed +/-N-char window that
    silently partial-edits on large param blocks. (Pre-beta audit P1 #9.)
    """
    # Walk backward to the enclosing opening brace, skipping string contents.
    depth = 0
    i = pos - 1
    while i >= 0:
        ch = text[i]
        if ch == '"':
            i -= 1
            while i >= 0 and text[i] != '"':
                if text[i] == '\\' and i > 0:
                    i -= 1
                i -= 1
        elif ch == '}':
            depth += 1
        elif ch == '{':
            if depth == 0:
                break
            depth -= 1
        i -= 1
    if i < 0:
        return pos, pos
    block_start = i

    # Walk forward to the matching closing brace.
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
    return block_start, j + 1


def _brace_depth(text: str, start: int, pos: int) -> int:
    """Brace depth at `pos`, counting unescaped braces from `start` (the index
    of an opening '{', which itself raises depth to 1). String contents are
    skipped. Used to tell a group-level field (depth 1) from one nested in a
    unit's task params (depth > 1). (Pre-beta audit P1 #9.)"""
    depth = 0
    in_str = False
    i = start
    while i < pos:
        ch = text[i]
        if ch == '"' and (i == 0 or text[i - 1] != '\\'):
            in_str = not in_str
        elif not in_str:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
        i += 1
    return depth


def _find_group_block_start(text: str, group_id: int) -> int:
    """Find the position of ["groupId"] = N in an actual group definition.

    IMPORTANT: ["groupId"] = N also appears inside trigger action parameters
    (e.g. a trigger that targets a specific group), which are NOT group
    definitions. To disambiguate, we look at what comes IMMEDIATELY after
    the groupId match:

      Real group:    `["groupId"] = N,\\n\\t...\\t["someField"] = ...`
                     (some structured field, often `["hidden"]`, but planner
                     inserts can put `["lateActivation"]`, `["manualHeading"]`,
                     etc. in front — anything matching `\\s*\\["<word>"\\]` is
                     a valid "real group" indicator).
      Trigger ref:   `["groupId"] = N,\\n\\t...}, -- end of ["params"]`
                     (closing brace as the next non-whitespace char).

    Pre-v0.9.56 we required specifically `["hidden"]` as the immediate next
    field. After v0.9.42's TIC tab started inserting `["lateActivation"]`
    right after `["groupId"]`, that check failed on a second-pass upload
    of an already-edited mission. The locator fell back to `matches[0]`
    which is usually a trigger reference earlier in the file — downstream
    callers like `_rename_group_and_units` then errored with "Units block
    not found near group N" because they were looking inside a trigger
    action's tiny params dict, not the real group block.

    Falls back to the first match if no "real" group is found (for
    backward compat with 856-style unit edits where the anchor is by
    position).
    """
    pattern = rf'\["groupId"\]\s*=\s*{group_id}\s*,'
    matches = list(re.finditer(pattern, text))
    if not matches:
        raise ValueError(f"Group {group_id} not found in mission text")

    # Real groups have ANY structured field as the immediate next thing
    # after `["groupId"] = N,`. Trigger refs have `}` (closing of the
    # params dict) as the next non-whitespace char.
    real_group_next = re.compile(r'\s*\["[A-Za-z_][A-Za-z_0-9]*"\]')
    for m in matches:
        window = text[m.end():m.end() + 120]
        if real_group_next.match(window):
            return m.start()

    # Fallback: first match (preserves old behavior for edge cases)
    return matches[0].start()


# ---------------------------------------------------------------------------
# Unit-level edit helpers
# ---------------------------------------------------------------------------

def _replace_prop_field(text: str, unit_id: int, lua_field: str, new_value: str) -> str:
    """Replace a string field in AddPropAircraft for a specific unit.

    Block-scoped via _find_unit_block_bounds — the AddPropAircraft block
    on player units sits well above unitId in the file, way past the old
    ±3000-char window. Used for voiceCallsignLabel, voiceCallsignNumber,
    and STN_L16 fields.

    Uses _LUA_STR_VALUE so an existing escaped value (e.g. a callsign
    label containing `\\"`) doesn't truncate the capture at the first
    inner quote; new_value is _lua_str_escape'd before splicing.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    pattern = rf'\["{lua_field}"\]\s*=\s*"' + _LUA_STR_VALUE + r'"'
    match = re.search(pattern, unit_block)
    if not match:
        # v1.19.85 — field absent: INSERT it into AddPropAircraft rather
        # than no-op. Most missions don't pre-set datalink callsign/STN, so
        # without this every Datalink auto-assign edit silently skipped and
        # the downloaded .miz showed "no change". Mirrors _replace_laser_code's
        # insert-when-missing behaviour.
        return _insert_prop_field(text, block_start, unit_block, lua_field, new_value)

    abs_start = block_start + match.start(1)
    abs_end = block_start + match.end(1)
    return text[:abs_start] + _lua_str_escape(str(new_value)) + text[abs_end:]


def _insert_prop_field(text: str, block_start: int, unit_block: str,
                       lua_field: str, new_value: str) -> str:
    """Insert a string AddPropAircraft field that isn't present yet.

    DCS doesn't care about indentation, only valid Lua — so we splice a
    minimally-formatted entry. Prefers an existing ["AddPropAircraft"] = {
    block (insert right after its opening brace); if the unit has none,
    create the block anchored after ["type"] = "...". Raises if neither
    anchor is found so the corruption guard / results never silently lie.
    """
    esc = _lua_str_escape(str(new_value))

    ap = re.search(r'\["AddPropAircraft"\]\s*=\s*\n?\s*\{', unit_block)
    if ap:
        insert_at = block_start + ap.end()  # just past the opening brace
        snippet = f'\n\t\t\t\t["{lua_field}"] = "{esc}",'
        return text[:insert_at] + snippet + text[insert_at:]

    # No AddPropAircraft block — create one after the ["type"] = "..." field.
    ty = re.search(r'\["type"\]\s*=\s*"' + _LUA_STR_VALUE + r'"\s*,', unit_block)
    if not ty:
        raise ValueError(
            f"Cannot insert {lua_field}: no AddPropAircraft or [\"type\"] anchor in unit block"
        )
    insert_at = block_start + ty.end()
    snippet = (
        '\n\t\t\t\t["AddPropAircraft"] = \n'
        '\t\t\t\t{\n'
        f'\t\t\t\t\t["{lua_field}"] = "{esc}",\n'
        '\t\t\t\t}, -- end of ["AddPropAircraft"]'
    )
    return text[:insert_at] + snippet + text[insert_at:]


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
    """Replace or insert a donors/teamMembers block for a specific unit.

    Block-scoped via _find_unit_block_bounds — the datalink ["network"]
    section on player units lives near the top of the unit block, far
    above the old ±5000-char window's reach. Without proper scoping
    this used to silently no-op the donor list update on player units.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    # Try to find existing block: ["key"] = { ... }
    pattern = rf'\["{key}"\]\s*=\s*\n?\s*\{{'
    match = re.search(pattern, unit_block)

    if match:
        # Found existing block — brace-match to find its closing brace.
        brace_start = match.end() - 1
        depth = 0
        i = brace_start
        while i < len(unit_block):
            if unit_block[i] == '{':
                depth += 1
            elif unit_block[i] == '}':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        block_close = i + 1
        # Include trailing comment if present
        rest = unit_block[block_close:]
        eol = re.match(r',\s*-- end of \["' + re.escape(key) + r'"\]', rest)
        if eol:
            block_close += eol.end()

        # Detect indentation from the line that contains the existing block.
        lines_before = unit_block[:match.start()].split("\n")
        base_indent = ""
        for line in reversed(lines_before):
            if line.strip():
                base_indent = re.match(r"(\s*)", line).group(1)
                break

        replacement = _build_network_list_block(key, unit_ids, base_indent)
        abs_start = block_start + match.start()
        abs_end = block_start + block_close
        return text[:abs_start] + replacement + text[abs_end:]

    # No existing block — insert into ["network"] = { ... } within the unit.
    network_pattern = r'\["network"\]\s*=\s*\n?\s*\{'
    net_match = re.search(network_pattern, unit_block)
    if not net_match:
        raise ValueError(f"Network block not found in unit {unit_id} block")

    lines_before = unit_block[:net_match.start()].split("\n")
    base_indent = ""
    for line in reversed(lines_before):
        if line.strip():
            base_indent = re.match(r"(\s*)", line).group(1)
            break
    inner_indent = base_indent + "\t"

    new_block = "\n" + inner_indent + _build_network_list_block(key, unit_ids, inner_indent)
    insert_pos = block_start + net_match.end()
    return text[:insert_pos] + new_block + text[insert_pos:]


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


# Pylon CLSID patterns that indicate a laser-guided weapon. Matches both full
# UUIDs (via external LASER_CLSIDS lookup) and the short-form CLSIDs DCS ME
# sometimes writes (e.g. "{GBU-24}", "{BRU33*GBU-12}").
_LASER_CLSID_PATTERN = re.compile(
    r'GBU[-\s_]?1[0246]|GBU[-\s_]?24|GBU[-\s_]?27|GBU[-\s_]?28|'
    r'Paveway|LGB|KAB[-\s_]?500L|KAB[-\s_]?1500L|LJDAM|'
    r'AGM[-\s_]?65[EKL]|AGM[-\s_]?114[KL]|APKWS|Maverick[-\s_]?E',
    re.IGNORECASE,
)


def _is_laser_pylon_clsid(clsid: str) -> bool:
    """True if CLSID looks like a laser-guided weapon (short form or UUID-known)."""
    if not clsid:
        return False
    if _LASER_CLSID_PATTERN.search(clsid):
        return True
    # Fallback: check pydcs LASER_CLSIDS (full UUIDs)
    try:
        from services.unit_extractor import LASER_CLSIDS
        if clsid in LASER_CLSIDS:
            return True
    except Exception:
        pass
    return False


def _replace_laser_code(text: str, unit_id: int, laser_code: int) -> str:
    """Set laser_code on every laser-guided pylon for a unit.

    If the pylon already has ["laser_code"] = NNNN, replace the value. If the
    pylon is a laser-guided weapon but has no laser_code (or no ["settings"]
    block at all), insert one.
    """
    # Use brace-matched unit bounds — NOT a ±5000-char window, which can
    # straddle adjacent units in the same group and clobber their pylons.
    unit_start, unit_end = _find_unit_block_bounds(text, unit_id)

    # Find the pylons section WITHIN this unit's brace-matched bounds
    pylons_match = re.search(r'\["pylons"\]\s*=\s*\n?\s*\{', text[unit_start:unit_end])
    if not pylons_match:
        raise ValueError(f"Pylons section not found inside unit {unit_id}")

    # Find the end of the pylons block via brace-matching
    brace_pos = unit_start + pylons_match.end() - 1
    depth = 1
    i = brace_pos + 1
    while i < unit_end and depth > 0:
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
        i += 1
    pylons_region_start = unit_start + pylons_match.start()
    pylons_region_end = i

    # Walk each individual pylon entry [N] = { ... }, collect edits, apply
    # back-to-front to preserve earlier offsets.
    edits: list[tuple[int, int, str]] = []  # (abs_start, abs_end, replacement)
    pylon_entry_re = re.compile(r'\[\d+\]\s*=\s*\{')
    for pe in pylon_entry_re.finditer(text, pylons_region_start, pylons_region_end):
        # Brace-match this pylon
        p_brace = pe.end() - 1
        p_depth = 1
        pj = p_brace + 1
        while pj < pylons_region_end and p_depth > 0:
            if text[pj] == '{':
                p_depth += 1
            elif text[pj] == '}':
                p_depth -= 1
            pj += 1
        pylon_block = text[pe.start():pj]
        pylon_abs_start = pe.start()

        # Extract CLSID to decide if this is a laser pylon
        clsid_m = re.search(r'\["CLSID"\]\s*=\s*"([^"]*)"', pylon_block)
        if not clsid_m:
            continue
        clsid = clsid_m.group(1)
        is_laser = _is_laser_pylon_clsid(clsid)

        # Case 1: pylon already has ["laser_code"] — replace regardless
        lc_m = re.search(r'(\["laser_code"\]\s*=\s*)(\d+)', pylon_block)
        if lc_m:
            edits.append((
                pylon_abs_start + lc_m.start(2),
                pylon_abs_start + lc_m.end(2),
                str(laser_code),
            ))
            continue

        # No existing laser_code — only insert if we think this is laser-guided
        if not is_laser:
            continue

        # Case 2: pylon has ["settings"] = { ... } — insert laser_code inside
        settings_m = re.search(r'\["settings"\]\s*=\s*\n?\s*\{', pylon_block)
        if settings_m:
            # Brace-match settings block to find insertion point before closing brace
            s_brace = settings_m.end() - 1
            s_depth = 1
            sj = s_brace + 1
            while sj < len(pylon_block) and s_depth > 0:
                if pylon_block[sj] == '{':
                    s_depth += 1
                elif pylon_block[sj] == '}':
                    s_depth -= 1
                sj += 1
            settings_close = sj - 1  # position of the closing brace
            # Figure out indent from a preceding key line inside settings
            settings_inner = pylon_block[s_brace + 1:settings_close]
            indent_m = re.search(r'\n([ \t]+)\["', settings_inner)
            indent = indent_m.group(1) if indent_m else '\t\t\t\t\t\t\t\t\t\t\t'
            insert_text = f'{indent}["laser_code"] = {laser_code},\n'
            # Position just before the closing brace's preceding whitespace; simplest: insert before the } itself
            insert_abs = pylon_abs_start + settings_close
            edits.append((insert_abs, insert_abs, insert_text))
            continue

        # Case 3: no settings block — create one with just laser_code
        # Insert before the pylon's closing brace. Use the indent of the CLSID line.
        clsid_line_m = re.search(r'\n([ \t]+)\["CLSID"\]', pylon_block)
        indent = clsid_line_m.group(1) if clsid_line_m else '\t\t\t\t\t\t\t\t\t\t'
        # Find the pylon's inner indent and closing brace position
        pylon_close = pj - 1  # position of closing brace in text
        # Insert "\n\t\t\t\t...\t["settings"] = {..laser_code..}" before pylon_close
        # Keep tidy: put settings on its own indented line before the `}`
        insert_text = (
            f'\n{indent}["settings"] = \n'
            f'{indent}{{\n'
            f'{indent}\t["laser_code"] = {laser_code},\n'
            f'{indent}}}, -- end of ["settings"]\n'
            f'{indent[:-1]}'  # slight dedent for closing brace line continuity
        )
        edits.append((pylon_close, pylon_close, insert_text))

    if not edits:
        raise ValueError(f"No laser-guided pylons found for unit {unit_id}")

    # Apply edits back-to-front so earlier offsets stay valid
    for start, end, replacement in sorted(edits, key=lambda e: e[0], reverse=True):
        text = text[:start] + replacement + text[end:]

    return text


def _replace_payload_block(text: str, unit_id: int, payload_dict: dict) -> str:
    """Replace the entire ["payload"] block for a unit from DB/session state.

    Same approach as airboss: serialize the complete payload dict as Lua
    and replace the block in the mission text.  Handles naked birds,
    multi-pylon edits, and preserves fuel/chaff/flare/gun/ammo_type.
    """
    from services.miz_editor import _serialize_lua_value

    # 1. Find unit block by unitId
    unit_start, unit_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[unit_start:unit_end]

    # 2. Find ["payload"] = { within unit block
    payload_match = re.search(r'\["payload"\]\s*=\s*\n?\s*\{', unit_block)
    if not payload_match:
        raise ValueError(f"Payload block not found in unit {unit_id}")

    # 3. Brace-match to get full payload block boundaries
    brace_pos = payload_match.end() - 1  # position of { in unit_block
    p_depth = 1
    p_i = brace_pos + 1
    while p_i < len(unit_block) and p_depth > 0:
        if unit_block[p_i] == '{':
            p_depth += 1
        elif unit_block[p_i] == '}':
            p_depth -= 1
        p_i += 1
    # p_i is now just past the closing } of payload

    # Include trailing comma and comment
    rest = unit_block[p_i:p_i + 60]
    trail = re.match(r',?\s*-- end of \["payload"\]', rest)
    if trail:
        p_i += trail.end()

    # 4. Convert payload_dict to Lua-compatible structure
    lua_payload = {}
    for key in ("fuel", "chaff", "flare", "gun", "ammo_type"):
        if key in payload_dict:
            lua_payload[key] = payload_dict[key]

    # Pylons: handle both array and dict formats, skip empty entries
    raw_pylons = payload_dict.get("pylons", [])
    pylons_dict = {}
    if isinstance(raw_pylons, list):
        for idx, p in enumerate(raw_pylons):
            if p and isinstance(p, dict) and p.get("CLSID"):
                pylons_dict[idx + 1] = p  # 1-indexed
    elif isinstance(raw_pylons, dict):
        for k, p in raw_pylons.items():
            if p and isinstance(p, dict) and p.get("CLSID"):
                pylons_dict[int(k)] = p
    lua_payload["pylons"] = pylons_dict

    # 5. Detect indentation from existing payload line
    line_start = unit_block.rfind('\n', 0, payload_match.start())
    indent = ''
    if line_start >= 0:
        for ch in unit_block[line_start + 1:payload_match.start()]:
            if ch in ' \t':
                indent += ch
            else:
                break
    if not indent:
        indent = '\t\t\t\t\t\t\t\t\t'

    # 6. Serialize and build replacement
    payload_lua = _serialize_lua_value(lua_payload, indent)
    new_block = f'["payload"] = {payload_lua}, -- end of ["payload"]'

    # Replace in full text
    abs_start = unit_start + payload_match.start()
    abs_end = unit_start + p_i
    text = text[:abs_start] + new_block + text[abs_end:]
    return text


def _extract_payload_block(text: str, unit_id: int) -> str:
    """Extract the raw Lua text of a unit's payload block.

    Block-scoped — the previous ±5000-char window picked up a neighbouring
    unit's payload block on tightly-packed group definitions, which then
    propagated through _copy_payload_block as silent cross-unit
    contamination during loadout copy.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    match = re.search(r'\["payload"\]\s*=\s*\n?\s*\{', unit_block)
    if not match:
        raise ValueError(f"Payload block not found in unit {unit_id} block")

    # Brace-match to find the closing brace, scoped to the unit block.
    brace_start = match.end() - 1
    depth = 0
    i = brace_start
    while i < len(unit_block):
        if unit_block[i] == '{':
            depth += 1
        elif unit_block[i] == '}':
            depth -= 1
            if depth == 0:
                break
        i += 1

    end = i + 1
    rest = unit_block[end:]
    eol_match = re.match(r',\s*-- end of \["payload"\]', rest)
    if eol_match:
        end += eol_match.end()

    return unit_block[match.start():end]


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
    """Replace the ["name"] field for a specific unit, found by unitId.

    Scopes the search to the actual unit block (via _find_unit_block_bounds)
    rather than a fragile ±N-char window around unitId — on player units
    with full radio preset programming the unit block is well over 30 KB,
    so the old window couldn't reach the top-of-block ["name"] field.

    Takes the first ["name"] entry in the block. DCS writes the unit's
    own name near the top of the block, before nested structures (payload,
    AddPropAircraft, task params) that may carry their own ["name"] keys.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    name_pattern = re.compile(r'\["name"\]\s*=\s*"' + _LUA_STR_VALUE + r'"')
    m = name_pattern.search(unit_block)
    if not m:
        raise ValueError(f"Name field not found in unit {unit_id} block")

    abs_start = block_start + m.start(1)
    abs_end = block_start + m.end(1)
    # Escape Lua-string specials in new_name before splicing — otherwise an
    # inner `"` (e.g. in a name like 'A-11 "Kiryati" Brigade') ends the
    # string mid-name and DCS refuses to load the .miz.
    return text[:abs_start] + _lua_str_escape(new_name) + text[abs_end:]


def _replace_livery(text: str, unit_id: int, new_livery: str) -> str:
    """Replace the ["livery_id"] field for a specific unit.
    If the field doesn't exist, insert it near the unit block."""
    import logging
    # Scope to the unit block via the string-aware _find_unit_block_bounds.
    # The old hand-rolled backward brace walk did NOT skip string contents,
    # so a '{', '}' or '"' inside a mod livery/type string miscounted brace
    # depth and landed block_start mid-string; the fixed +500 forward window
    # could also fall short on a big unit block. (Pre-beta audit P1 #7.)
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

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
    """Replace heading for a unit (radians).

    Scopes to the unit block via _find_unit_block_bounds so we don't
    accidentally edit a neighbouring unit's heading. Heading sits near
    the top of the unit block; the first match wins.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    pattern = r'(\["heading"\]\s*=\s*)([0-9eE.+\-]+)'
    m = re.search(pattern, unit_block)
    if m:
        abs_start = block_start + m.start(2)
        abs_end = block_start + m.end(2)
        text = text[:abs_start] + str(heading_rad) + text[abs_end:]
    return text


def _replace_late_activation(text: str, unit_id: int, enabled: bool) -> str:
    """Set lateActivation on the group that contains a given unit.

    lateActivation is a group-level field. We anchor on the unit, then climb
    enclosing brace blocks until we reach the real GROUP block — identified by
    having a ["units"] table AND a depth-1 ["groupId"] (a task-action param
    block can carry a groupId but never a units table). We then set an existing
    flag or insert one right after the group's ["groupId"] line.

    Insert position is load-bearing: _find_group_block_start disambiguates real
    groups from trigger refs by the field that follows ["groupId"], so the flag
    MUST land there. Climbing + the ["units"] check replaces a fixed 15000-char
    backward window that could miss the header on a dense group or bleed into a
    neighbouring group. (Pre-beta audit P1 #9.)
    """
    try:
        unit_pos = _find_unit_block_start(text, unit_id)
    except ValueError:
        return text
    lua_val = "true" if enabled else "false"
    gid_re = r'\["groupId"\]\s*=\s*\d+\s*,'

    # Climb to the enclosing group block.
    grp_start = grp_end = None
    pos = unit_pos
    for _ in range(8):
        bs, be = _enclosing_block_bounds(text, pos)
        if bs >= be or bs <= 0:
            break
        blk = text[bs:be]
        if '["units"]' in blk:
            for gm in re.finditer(gid_re, blk):
                if _brace_depth(text, bs, bs + gm.start()) == 1:
                    grp_start, grp_end = bs, be
                    break
        if grp_start is not None:
            break
        pos = bs - 1  # climb to the parent block
    if grp_start is None:
        return text
    region = text[grp_start:grp_end]

    # Existing group-level lateActivation? (units never carry this field)
    m = re.search(r'(\["lateActivation"\]\s*=\s*)(true|false)', region)
    if m:
        abs_start = grp_start + m.start(2)
        abs_end = grp_start + m.end(2)
        return text[:abs_start] + lua_val + text[abs_end:]

    # Insert right after the group-level ["groupId"] (depth-1 within the block).
    for gm in re.finditer(gid_re, region):
        if _brace_depth(text, grp_start, grp_start + gm.start()) == 1:
            insert_pos = grp_start + gm.end()
            return text[:insert_pos] + f'\n\t\t\t\t["lateActivation"] = {lua_val},' + text[insert_pos:]
    return text


def _replace_tacan_beacon(text: str, unit_id: int, channel: int, band: str,
                          callsign: str) -> str:
    """Replace ActivateBeacon TACAN params for a unit's waypoint task.

    Finds the ActivateBeacon that has a matching unitId param, then updates
    its channel, modeChannel (band), and callsign.
    """
    # Find ALL ActivateBeacon occurrences and pick the one whose enclosing
    # action block contains our unitId. Brace-bounding the action block
    # (instead of a fixed +/-1000-char window) means a long callsign or extra
    # params can't push the unitId out of range or leave ["callsign"] beyond
    # the window unedited (silent partial edit). (Pre-beta audit P1 #9.)
    beacon_pattern = r'\["id"\]\s*=\s*"ActivateBeacon"'
    block = None  # (start, end) of the matched action block
    for m in re.finditer(beacon_pattern, text):
        bs, be = _enclosing_block_bounds(text, m.start())
        if re.search(rf'\["unitId"\]\s*=\s*{unit_id}\b', text[bs:be]):
            block = (bs, be)
            break

    if block is None:
        # Fallback: closest ActivateBeacon before the unit position.
        try:
            unit_pos = _find_unit_block_start(text, unit_id)
        except ValueError:
            return text
        best = None
        for m in re.finditer(beacon_pattern, text):
            if m.start() < unit_pos:
                best = m.start()
            else:
                break
        if best is None:
            return text
        block = _enclosing_block_bounds(text, best)

    bs, be = block

    # Replace channel within the action block (recompute bounds after each
    # edit since the text length shifts; bs is stable — it's the opening '{'
    # before any field we touch).
    m = re.search(r'(\["channel"\]\s*=\s*)(\d+)', text[bs:be])
    if m:
        text = text[:bs + m.start(2)] + str(channel) + text[bs + m.end(2):]
        bs, be = _enclosing_block_bounds(text, bs + 1)

    # Replace modeChannel (band: "X" or "Y")
    mode_val = '"Y"' if band.upper() == 'Y' else '"X"'
    m = re.search(r'(\["modeChannel"\]\s*=\s*)("[^"]*"|\d+)', text[bs:be])
    if m:
        text = text[:bs + m.start(2)] + mode_val + text[bs + m.end(2):]
        bs, be = _enclosing_block_bounds(text, bs + 1)

    # Replace callsign
    m = re.search(r'(\["callsign"\]\s*=\s*")([^"]*)', text[bs:be])
    if m:
        text = text[:bs + m.start(2)] + callsign + text[bs + m.end(2):]

    return text


def _replace_icls(text: str, unit_id: int, channel: int) -> str:
    """Replace ActivateICLS channel for a unit's waypoint task.

    Primary path: locate an ActivateICLS task whose params reference
    the supplied unitId. That's the strict, unambiguous match.

    Fallback: pick the ActivateICLS closest to the unit's position
    (in either direction). Needed because the frontend sometimes
    passes a child unit's id (helo deck on a carrier group) when the
    actual ICLS target is the carrier hull — the previous fallback
    only searched BEFORE the unit's position and missed the carrier's
    waypoint-attached ICLS task entirely on simple.miz.
    """
    icls_pattern = r'\["id"\]\s*=\s*"ActivateICLS"'
    block = None  # (start, end) of the matched action block
    for m in re.finditer(icls_pattern, text):
        # Brace-bound the action block instead of a fixed +/-500-char window
        # so the unitId match isn't missed on larger ICLS params. (P1 #9.)
        bs, be = _enclosing_block_bounds(text, m.start())
        if re.search(rf'\["unitId"\]\s*=\s*{unit_id}\b', text[bs:be]):
            block = (bs, be)
            break

    if block is None:
        try:
            unit_pos = _find_unit_block_start(text, unit_id)
        except ValueError:
            return text
        best = None
        best_dist = float('inf')
        for m in re.finditer(icls_pattern, text):
            dist = abs(m.start() - unit_pos)
            if dist < best_dist:
                best_dist = dist
                best = m.start()
        if best is None:
            return text
        block = _enclosing_block_bounds(text, best)

    bs, be = block
    m = re.search(r'(\["channel"\]\s*=\s*)(\d+)', text[bs:be])
    if m:
        text = text[:bs + m.start(2)] + str(channel) + text[bs + m.end(2):]

    return text


def _insert_group_wrapped_actions(text: str, group_id: int, actions: list[dict]) -> str:
    """Insert WrappedAction tasks (SetInvisible, SetImmortal, etc.) into a group's
    first waypoint task list.

    Each action dict has: {"id": "SetInvisible", "value": true/false}

    DCS Lua structure for waypoint tasks:
        ["route"]["points"][1]["task"]["params"]["tasks"][N] = {
            ["id"] = "WrappedAction",
            ["params"] = { ["action"] = { ["id"] = "SetInvisible", ["params"] = { ["value"] = true } } },
        }
    """
    # Find the group by groupId
    gid_pat = rf'\["groupId"\]\s*=\s*{group_id}\b'
    gid_match = re.search(gid_pat, text)
    if not gid_match:
        return text

    # Search forward from the group for the route > points > [1] > task > params > tasks section
    search_start = gid_match.start()
    search_region = text[search_start:search_start + 20000]

    # Find ["tasks"] = { within the first waypoint's task params
    # We look for the pattern: ["route"]...["points"]...[1]...["task"]...["params"]...["tasks"] = {
    tasks_match = re.search(r'\["tasks"\]\s*=\s*\{', search_region)
    if not tasks_match:
        return text

    tasks_open_abs = search_start + tasks_match.end() - 1  # position of {

    # Find what indices already exist inside this tasks block
    # We need a bounded search, so find the matching closing brace
    depth = 0
    k = tasks_open_abs
    in_str = False
    while k < len(text):
        ch = text[k]
        if ch == '"' and (k == 0 or text[k - 1] != '\\'):
            in_str = not in_str
        elif not in_str:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    break
        k += 1
    tasks_close_abs = k

    tasks_content = text[tasks_open_abs:tasks_close_abs + 1]
    existing_indices = [int(m.group(1)) for m in re.finditer(r'\[(\d+)\]\s*=', tasks_content)]
    next_idx = max(existing_indices, default=0) + 1

    # Detect indentation
    indent_match = re.search(r'\n(\s+)\[\d+\]\s*=', tasks_content)
    indent = indent_match.group(1) if indent_match else "                                "
    inner = indent + "    "

    # Build the new task entries
    new_entries = ""
    for action in actions:
        action_id = action["id"]
        lua_val = "true" if action.get("value", True) else "false"
        new_entries += (
            f'\n{indent}[{next_idx}] =\n'
            f'{indent}{{\n'
            f'{inner}["enabled"] = true,\n'
            f'{inner}["auto"] = false,\n'
            f'{inner}["id"] = "WrappedAction",\n'
            f'{inner}["number"] = {next_idx},\n'
            f'{inner}["params"] =\n'
            f'{inner}{{\n'
            f'{inner}    ["action"] =\n'
            f'{inner}    {{\n'
            f'{inner}        ["id"] = "{action_id}",\n'
            f'{inner}        ["params"] =\n'
            f'{inner}        {{\n'
            f'{inner}            ["value"] = {lua_val},\n'
            f'{inner}        }}, -- end of ["params"]\n'
            f'{inner}    }}, -- end of ["action"]\n'
            f'{inner}}}, -- end of ["params"]\n'
            f'{indent}}}, -- end of [{next_idx}]'
        )
        next_idx += 1

    # Insert before the closing } of the tasks block
    text = text[:tasks_close_abs] + new_entries + "\n" + text[tasks_close_abs:]
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

    Block-scoped via _find_unit_block_bounds — the callsign block sits
    near the top of the unit block, well above the bottom-of-block
    unitId line on player units. Forward-only ±5000 search couldn't
    reach it on player flights with full radio preset programming.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)

    # The callsign sub-block is identified by ["callsign"] = { ... }.
    # We do all four edits on a freshly-sliced unit_block view, then
    # apply absolute offsets back to the full text after each one. This
    # is what the original did with `region`, but bounded.
    def _slice(text: str) -> str:
        # Recompute bounds on every iteration since text length shifts.
        bs, be = _find_unit_block_bounds(text, unit_id)
        return text[bs:be], bs

    # [1] = name index
    unit_block, bs = _slice(text)
    m = re.search(r'(\["callsign"\]\s*=\s*\{[^}]*?\[1\]\s*=\s*)(\d+)', unit_block)
    if m:
        text = text[:bs + m.start(2)] + str(name_idx) + text[bs + m.end(2):]

    # [2] = flight number
    unit_block, bs = _slice(text)
    m = re.search(r'(\["callsign"\]\s*=\s*\{[^}]*?\[2\]\s*=\s*)(\d+)', unit_block)
    if m:
        text = text[:bs + m.start(2)] + str(flight) + text[bs + m.end(2):]

    # [3] = position
    unit_block, bs = _slice(text)
    m = re.search(r'(\["callsign"\]\s*=\s*\{[^}]*?\[3\]\s*=\s*)(\d+)', unit_block)
    if m:
        text = text[:bs + m.start(2)] + str(pos) + text[bs + m.end(2):]

    # ["name"] = "..." inside the callsign sub-block
    unit_block, bs = _slice(text)
    m = re.search(r'(\["callsign"\]\s*=\s*\{[^}]*?\["name"\]\s*=\s*")([^"]*)', unit_block)
    if m:
        text = text[:bs + m.start(2)] + name_str + text[bs + m.end(2):]

    return text


def _replace_onboard_num(text: str, unit_id: int, new_num: str) -> str:
    """Replace onboard_num (tail number) for a unit.

    Block-scoped to prevent the forward-only search from drifting into
    an adjacent unit when the current unit's onboard_num happens to sit
    above its unitId line.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    pattern = r'(\["onboard_num"\]\s*=\s*")([^"]*)'
    m = re.search(pattern, unit_block)
    if m:
        abs_start = block_start + m.start(2)
        abs_end = block_start + m.end(2)
        text = text[:abs_start] + new_num + text[abs_end:]
    return text


def _replace_skill(text: str, unit_id: int, new_skill: str) -> str:
    """Replace skill level for a unit.

    Block-scoped — the original forward-only search read past the end
    of the target unit on player units (where ["skill"] sits at the top
    of the block, ~7K+ chars before the bottom-of-block unitId line)
    and could land on a neighbouring unit's skill field.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    pattern = r'(\["skill"\]\s*=\s*")([^"]*)'
    m = re.search(pattern, unit_block)
    if m:
        abs_start = block_start + m.start(2)
        abs_end = block_start + m.end(2)
        text = text[:abs_start] + new_skill + text[abs_end:]
    return text


def _replace_radio_frequency(text: str, unit_id: int, freq_hz: int) -> str:
    """Replace Radio[1] frequency for a unit.

    Scopes to the unit block, then walks into ["Radio"][1] specifically
    so we don't edit Radio[2]'s frequency by accident. The old code
    just took the first ["frequency"] within a forward window, which
    on player units with no Radio[1] block fell back to whatever it
    found first downstream — usually the next unit's primary radio.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    radio_m = re.search(r'\["Radio"\]\s*=\s*\n?\s*\{', unit_block)
    if not radio_m:
        return text  # unit has no Radio block — silent success (noop)

    # Walk into Radio[1].
    after_radio = unit_block[radio_m.end():]
    r1_m = re.search(r'\[1\]\s*=\s*\n?\s*\{', after_radio)
    if not r1_m:
        return text  # no Radio[1] sub-block

    radio1_start_in_block = radio_m.end() + r1_m.end()
    region = unit_block[radio1_start_in_block:]
    freq_m = re.search(r'(\["frequency"\]\s*=\s*)(\d+)', region)
    if not freq_m:
        return text

    abs_start = block_start + radio1_start_in_block + freq_m.start(2)
    abs_end = block_start + radio1_start_in_block + freq_m.end(2)
    return text[:abs_start] + str(freq_hz) + text[abs_end:]


def _enumerate_unit_ids_in_group(text: str, group_id: int) -> list[int]:
    """Return the list of unitIds inside the named group's ["units"] block.

    Used by per-group edits (e.g. radio presets) that need to fan out to
    every unit in a flight. Walks the group's units block via brace
    matching so we don't trip over unitId numbers appearing elsewhere
    in the mission (triggers, etc.).
    """
    group_pos = _find_group_block_start(text, group_id)
    units_match = re.search(r'\["units"\]\s*=\s*\n?\s*\{', text[group_pos:group_pos + 500])
    if not units_match:
        return []
    brace_start = group_pos + units_match.end() - 1
    depth = 1
    i = brace_start + 1
    while i < len(text) and depth > 0:
        ch = text[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        i += 1
    units_block = text[brace_start:i]
    return [int(m.group(1)) for m in re.finditer(r'\["unitId"\]\s*=\s*(\d+)', units_block)]


def _replace_radio_presets_for_unit(text: str, unit_id: int, radio_num: int,
                                    channels: list) -> str:
    """Rewrite the channels / modulations / channelsNames sub-blocks of
    ["Radio"][radio_num] for a unit.

    `channels` is a list of dicts: [{ch, freq_mhz, modulation, name}, ...]

    We rebuild the three sub-blocks from scratch (rather than poking at
    individual entries) so a designer who programmed channel 17 can
    unset it from the planner UI by sending a list that doesn't include
    ch=17. Empty channel sub-blocks render as `{}` so DCS still sees
    the keys.

    Channels with freq_mhz <= 0 are dropped (treated as "not set"),
    matching the frontend's "blank means unset" convention.
    """
    block_start, block_end = _find_unit_block_bounds(text, unit_id)
    unit_block = text[block_start:block_end]

    # Locate ["Radio"] = { ... } inside the unit block.
    radio_m = re.search(r'\["Radio"\]\s*=\s*\n?\s*\{', unit_block)
    if not radio_m:
        return text

    radio_open_rel = unit_block.index('{', radio_m.start())
    depth = 1
    i = radio_open_rel + 1
    while i < len(unit_block) and depth > 0:
        ch = unit_block[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        i += 1
    radio_close_rel = i  # one past the closing }
    radio_block_rel = unit_block[radio_open_rel:radio_close_rel]

    # Locate [radio_num] = { ... } inside the Radio block.
    radio_idx_m = re.search(rf'\[{radio_num}\]\s*=\s*\n?\s*\{{', radio_block_rel)
    if not radio_idx_m:
        return text  # this radio slot doesn't exist on the unit; skip silently

    sub_open_rel = radio_block_rel.index('{', radio_idx_m.start())
    depth = 1
    j = sub_open_rel + 1
    while j < len(radio_block_rel) and depth > 0:
        ch = radio_block_rel[j]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        j += 1
    sub_close_rel = j  # one past closing }
    sub_block = radio_block_rel[sub_open_rel:sub_close_rel]
    inner = sub_block[1:-1]  # drop the surrounding {}

    # Build the new channels / modulations / channelsNames Lua text.
    valid = [c for c in channels if (c.get("freq_mhz") or 0) > 0]
    valid.sort(key=lambda c: int(c["ch"]))

    def _ch_block(label: str, body: str) -> str:
        if body:
            return f'                        ["{label}"] = \n                        {{\n{body}                        }},\n'
        return f'                        ["{label}"] = \n                        {{\n                        }},\n'

    chan_lines = "".join(
        f'                            [{int(c["ch"])}] = {float(c["freq_mhz"]):.6f},\n'
        for c in valid
    )
    mod_lines = "".join(
        f'                            [{int(c["ch"])}] = {int(c.get("modulation", 0))},\n'
        for c in valid
    )
    name_lines = "".join(
        f'                            [{int(c["ch"])}] = {_lua_escape(c.get("name", ""))},\n'
        for c in valid if c.get("name")
    )

    new_inner_parts = []
    new_inner_parts.append(_ch_block("channels", chan_lines))
    new_inner_parts.append(_ch_block("modulations", mod_lines))
    if name_lines:
        new_inner_parts.append(_ch_block("channelsNames", name_lines))
    # Preserve any other top-level keys inside the radio sub-block (e.g.
    # ["frequency"] for the spawn freq) by scanning the existing inner
    # content for keys other than channels/modulations/channelsNames.
    for keep_match in re.finditer(r'\["([^"]+)"\]\s*=\s*([^\n]+?)(,?)\n', inner):
        key = keep_match.group(1)
        if key in ("channels", "modulations", "channelsNames"):
            continue
        new_inner_parts.append(f'                        ["{key}"] = {keep_match.group(2)},\n')

    new_inner = "".join(new_inner_parts)
    new_sub_block = "{\n" + new_inner + "                    }"

    # Splice the new sub-block back into the radio block, then the unit
    # block, then the full text.
    new_radio_block = (
        radio_block_rel[:sub_open_rel]
        + new_sub_block
        + radio_block_rel[sub_close_rel:]
    )
    new_unit_block = (
        unit_block[:radio_open_rel]
        + new_radio_block
        + unit_block[radio_close_rel:]
    )
    return text[:block_start] + new_unit_block + text[block_end:]


def _lua_escape(s: str) -> str:
    """Render a Python string as a Lua double-quoted literal."""
    if s is None:
        return '""'
    safe = str(s).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{safe}"'


def _replace_radio_presets_for_group(text: str, group_id: int, radio_num: int,
                                     channels: list) -> str:
    """Apply the same preset list to every unit in a group's ["units"] block.

    DCS replicates the lead's presets to wingmen at runtime, but mission
    designers usually program presets identically on every unit too —
    so the safest write-back is "stamp every unit with the new list".
    """
    unit_ids = _enumerate_unit_ids_in_group(text, group_id)
    # Process highest unitId first so earlier-positioned units' offsets
    # don't shift while we're still working at the bottom of the block.
    for uid in sorted(unit_ids, reverse=True):
        text = _replace_radio_presets_for_unit(text, uid, radio_num, channels)
    return text


def _find_group_block_bounds(text: str, group_id: int) -> tuple[int, int]:
    """Return (open_brace_pos, close_brace_pos_exclusive) for a group's `[N] = {...}`.

    DCS emits group fields in a fixed-ish order where `["groupId"]` sits
    in the MIDDLE of the block (after `["route"]`, before `["units"]`):

        [N] = {                     <-- block_start (this `{`)
            ["communication"] = ...,
            ["route"] = { ... },    <-- BEFORE groupId in file order
            ["groupId"] = 2,        <-- our anchor
            ["units"] = { ... },    <-- AFTER groupId
            ...
        },                          <-- block_end_exclusive (past this `}`)

    So a forward-only search from the groupId anchor misses ["route"] and
    silently walks into the NEXT group's route — exactly the kind of
    cross-group corruption CLAUDE.md flags as the ±N-char-window footgun.

    Algorithm: find the groupId, walk backward tracking brace depth to
    locate the enclosing `{`, then brace-match forward to find the
    matching `}`. Returns absolute byte offsets in the original text.
    """
    group_pos = _find_group_block_start(text, group_id)

    # Walk backward from groupId looking for our enclosing `{` (depth-0
    # opener). Every `}` we pass on the way is some inner block closing —
    # we increment a counter and decrement on each `{` to skip past them.
    depth = 0
    i = group_pos - 1
    while i >= 0:
        ch = text[i]
        if ch == '}':
            depth += 1
        elif ch == '{':
            if depth == 0:
                break  # this is the group's opening brace
            depth -= 1
        i -= 1
    if i < 0:
        raise ValueError(f"Group {group_id} opening brace not found")
    block_start = i

    # Forward brace-match from block_start to find the closing `}`.
    j = block_start + 1
    bdepth = 1
    while j < len(text) and bdepth > 0:
        cj = text[j]
        if cj == '{':
            bdepth += 1
        elif cj == '}':
            bdepth -= 1
        j += 1
    return block_start, j  # j is just past the closing `}`


def _find_route_points_bounds(text: str, group_id: int) -> tuple[int, int]:
    """Return (start, end_exclusive) for the ["points"] = { ... } block of a group.

    Anchors on the group's BRACE-BOUNDED block (see _find_group_block_bounds)
    rather than searching forward from ["groupId"] — the route block lives
    BEFORE the groupId line in DCS file order, so a forward search would
    walk into a neighbouring group's route and silently corrupt it.

    Within the group block we scan for `["route"] = {` then `["points"] = {`
    inside the route, and brace-match the points table's closing `}`.
    """
    block_start, block_end = _find_group_block_bounds(text, group_id)
    region = text[block_start:block_end]

    route_m = re.search(r'\["route"\]\s*=\s*\n?\s*\{', region)
    if not route_m:
        raise ValueError(f"Route block not found in group {group_id}")

    points_m = re.search(r'\["points"\]\s*=\s*\n?\s*\{', region[route_m.end():])
    if not points_m:
        raise ValueError(f"Points block not found in group {group_id}'s route")

    abs_brace_open = block_start + route_m.end() + points_m.end() - 1
    depth = 1
    i = abs_brace_open + 1
    while i < len(text) and depth > 0:
        ch = text[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        i += 1
    return abs_brace_open, i  # i is just past the closing `}`


def _find_waypoint_block_bounds(text: str, points_start: int, points_end: int,
                                wp_index: int) -> tuple[int, int]:
    """Return (start, end_exclusive) for `[wp_index] = { ... }` inside a points block.

    points_start/end define the enclosing ["points"] = {...} bounds as returned
    by _find_route_points_bounds. wp_index is the 1-based DCS waypoint number.
    Brace-matches the WP block so nested ["task"] sub-tables don't confuse us.
    """
    region = text[points_start:points_end]
    # Anchor on `[N] = {` at depth-1 within the points block. We can't just
    # regex for the literal `[1] =` because nested task blocks contain their
    # own `[1] = {...}` indices for ComboTask sub-tasks. So: scan from
    # points_start tracking depth, and pick the first `[wp_index] = {` we
    # see at depth 1 (i.e. immediately inside the points table).
    depth = 0
    i = 0
    target_anchor = re.compile(rf'\[{wp_index}\]\s*=\s*\n?\s*\{{')
    while i < len(region):
        ch = region[i]
        if ch == '{':
            depth += 1
            i += 1
            continue
        if ch == '}':
            depth -= 1
            i += 1
            continue
        # Only consider matches when we're at depth 1 (immediately inside
        # the points table — depth 0 is before any { is seen).
        if depth == 1:
            m = target_anchor.match(region, i)
            if m:
                # Found the `[N] = {` opener at depth 1. Brace-match its body.
                wp_open = points_start + m.end() - 1  # absolute pos of `{`
                bdepth = 1
                j = wp_open + 1
                while j < len(text) and bdepth > 0:
                    cj = text[j]
                    if cj == '{':
                        bdepth += 1
                    elif cj == '}':
                        bdepth -= 1
                    j += 1
                # Block starts at the `[` of `[N] = ...` for clarity in
                # callers; return (anchor_start, end_after_closing_brace).
                return points_start + m.start(), j
        i += 1
    raise ValueError(f"Waypoint [{wp_index}] not found in points block")


def _set_lua_scalar_field(text: str, block_start: int, block_end: int,
                          field_name: str, lua_value: str) -> str:
    """Set `["field_name"] = value` inside the given [block_start, block_end) range.

    Used for ETA / ETA_locked mutations on a waypoint. If the field already
    exists, its value is replaced; if it doesn't, the field is inserted just
    before the block's closing `}`. Whitespace/indentation around the
    inserted field matches the surrounding waypoint fields.
    """
    region = text[block_start:block_end]
    # Mutate existing value
    pat = re.compile(rf'(\["{re.escape(field_name)}"\]\s*=\s*)([^,\n]+)')
    m = pat.search(region)
    if m:
        abs_start = block_start + m.start(2)
        abs_end = block_start + m.end(2)
        return text[:abs_start] + lua_value + text[abs_end:]

    # Insert just before the closing `}` of the block. Find the LAST `}` in
    # the block (its closing brace) and prepend our new field with matching
    # indent. We sniff indent from the first existing `["x"]` line.
    indent_m = re.search(r'\n(\s*)\["[^"]+"\]\s*=', region)
    indent = indent_m.group(1) if indent_m else '\t\t\t\t'
    # Find the closing brace position relative to the block
    last_brace = region.rfind('}')
    if last_brace < 0:
        return text  # unreachable in well-formed Lua
    insert_at = block_start + last_brace
    insertion = f'{indent}["{field_name}"] = {lua_value},\n'
    return text[:insert_at] + insertion + text[insert_at:]


# Pattern that matches a TIC `t+N` offset token, case-insensitive.
# Mirrors the Lua pattern `t%+(%d+)` from TIC_v1.1.lua::extractOffsetTime,
# wrapped with word boundaries so we don't strip something like `xt+5`
# (unlikely but defensive — the planner is the authoritative writer so
# we can be conservative). `\b` is a position assertion between word
# `[a-zA-Z0-9_]` and non-word characters; for space-separated TIC names
# it matches at exactly the boundaries we want.
_TIC_OFFSET_RE = re.compile(r'\bt\+\d+\b', re.IGNORECASE)


def _set_named_token_in_tic_name(name: str, prefix: str, sep: str,
                                 value: str | int | None) -> str:
    """Insert / replace / remove a TIC token of the form `<prefix><sep><value>`
    inside a waypoint name. Used for the v2 token vocab (speed=N, roe=X,
    hdg=N, flag=X, flag+X).

    All TIC tokens parsed by TIC_v1.1.lua match one of three patterns:
      KEY+VALUE   t+N, flag+X       (use `+` as separator)
      KEY=VALUE   speed=N, roe=X,
                  hdg=N, flag=X     (use `=` as separator)
      BARE WORD   mount, dismount   (no separator — not handled here)

    `value=None` or `value=""` -> strip the matching token from the name.
    Any other value sets / replaces it. Other TIC tokens (including the
    other prefix/sep combinations) are preserved untouched.

    The value-character class matches `\\w` + `.` so decimals like
    `scale=0.5` round-trip cleanly. Tokens are appended at the end of the
    name on insert (after any existing content). `t+N` historically
    prepended for readability — see _set_offset_in_tic_name's special
    case below.
    """
    name = name or ""
    sep_esc = re.escape(sep)
    # Token shape: prefix + sep + value. Value chars: word + dot for decimals.
    pat = re.compile(
        rf'\b{re.escape(prefix)}{sep_esc}[\w.]+\b',
        re.IGNORECASE,
    )
    if value is None or value == "":
        cleaned = pat.sub('', name)
        return re.sub(r'\s+', ' ', cleaned).strip()
    new_token = f'{prefix}{sep}{value}'
    if pat.search(name):
        replaced = pat.sub(new_token, name, count=1)
        return re.sub(r'\s+', ' ', replaced).strip()
    rest = re.sub(r'\s+', ' ', name).strip()
    if rest:
        return f'{rest} {new_token}'
    return new_token


def _set_quoted_phase_in_tic_name(name: str, phase: str | None) -> str:
    """Insert / replace / strip the `"phase_name"` TIC token (extractPhase).

    Lua side (TIC_v1.1.lua::extractPhase): the script iterates
    `string.gmatch(string.lower(str), "\\"([^\\"]+)\\"")` and takes the
    FIRST match. So we mirror that — replace the first quoted run if one
    exists, or append a new one. `phase=None` or empty string strips ALL
    quoted runs (defensive — if a name was somehow given two phase
    tokens, normalize down to none).
    """
    name = name or ""
    pat = re.compile(r'"[^"]+"')
    if not phase:
        cleaned = pat.sub('', name)
        return re.sub(r'\s+', ' ', cleaned).strip()
    new_token = f'"{phase}"'
    if pat.search(name):
        replaced = pat.sub(new_token, name, count=1)
        return re.sub(r'\s+', ' ', replaced).strip()
    rest = re.sub(r'\s+', ' ', name).strip()
    return f'{rest} {new_token}' if rest else new_token


def _set_deployment_in_tic_name(name: str, deployment: str | None) -> str:
    """Insert / replace / strip the bare `mount` or `dismount` TIC token
    (extractDeployment).

    Lua side: the script iterates word-pattern matches and accepts the
    literal strings `mount` or `dismount` (case-insensitive). So this
    helper looks for those exact words as standalone tokens, strips any
    existing one, and appends the new value. `deployment=None` /
    empty / any value other than 'mount' or 'dismount' strips both.
    """
    name = name or ""
    pat = re.compile(r'\b(?:mount|dismount)\b', re.IGNORECASE)
    cleaned = pat.sub('', name)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    d = (deployment or '').strip().lower()
    if d not in ('mount', 'dismount'):
        return cleaned
    return f'{cleaned} {d}' if cleaned else d


def _set_offset_in_tic_name(name: str, minutes: int | None) -> str:
    """Insert / replace / remove the TIC `t+N` offset token in a waypoint name.

    `minutes` semantics:
        None  -> strip any `t+N` token; leave the rest intact.
        int   -> replace existing `t+N` with `t+<minutes>`, or prepend
                 the new token if none exists.

    Other TIC tokens in the name (hdg=, speed=, "phase", roe=, flag=, etc.)
    are preserved unchanged. Whitespace is normalized to single spaces and
    trimmed; an empty result is allowed (and means "no TIC directives").

    The generic _set_named_token_in_tic_name handles the common path, but
    t+N specifically PREPENDS for readability (it's the primary timing
    token mission designers scan-for visually). The append-on-insert
    behaviour the generic helper uses is fine for secondary tokens like
    speed=N / roe=X.
    """
    name = name or ""
    if minutes is None:
        cleaned = _TIC_OFFSET_RE.sub('', name)
        return re.sub(r'\s+', ' ', cleaned).strip()

    new_token = f't+{int(minutes)}'
    if _TIC_OFFSET_RE.search(name):
        replaced = _TIC_OFFSET_RE.sub(new_token, name, count=1)
        return re.sub(r'\s+', ' ', replaced).strip()
    rest = re.sub(r'\s+', ' ', name).strip()
    if rest:
        return f'{new_token} {rest}'
    return new_token


def _replace_waypoint_name(text: str, group_id: int, wp_index: int, new_name: str) -> str:
    """Surgically replace the ["name"] field of a specific waypoint.

    Uses the (group-bounded) waypoint locator and the same Lua-escape
    treatment as _replace_unit_name — embedded quotes / backslashes in
    user-supplied TIC tokens (rare, but `flag+X` style identifiers
    could theoretically contain weird chars) won't break the .miz.
    """
    points_start, points_end = _find_route_points_bounds(text, group_id)
    wp_start, wp_end = _find_waypoint_block_bounds(text, points_start, points_end, wp_index)
    wp_region = text[wp_start:wp_end]

    name_pattern = re.compile(r'\["name"\]\s*=\s*"' + _LUA_STR_VALUE + r'"')
    m = name_pattern.search(wp_region)
    if not m:
        # Waypoint has no ["name"] field. Insert one before the
        # block's closing `}`. This is uncommon — DCS-emitted WPs
        # always carry a name — but we don't want a silent noop.
        last_brace = wp_region.rfind('}')
        if last_brace < 0:
            return text
        indent_m = re.search(r'\n(\s*)\["[^"]+"\]\s*=', wp_region)
        indent = indent_m.group(1) if indent_m else '\t\t\t\t\t\t\t\t\t\t\t\t'
        insertion = f'{indent}["name"] = "{_lua_str_escape(new_name)}",\n'
        insert_at = wp_start + last_brace
        return text[:insert_at] + insertion + text[insert_at:]

    abs_start = wp_start + m.start(1)
    abs_end = wp_start + m.end(1)
    return text[:abs_start] + _lua_str_escape(new_name) + text[abs_end:]


def _read_waypoint_name(text: str, group_id: int, wp_index: int) -> str:
    """Return the current (UNESCAPED) ["name"] value for a waypoint, or ''.

    Used by _replace_waypoint_tasks to preserve other TIC tokens
    around the one we're mutating. Empty string for waypoints with
    no name field (defensive).
    """
    points_start, points_end = _find_route_points_bounds(text, group_id)
    wp_start, wp_end = _find_waypoint_block_bounds(text, points_start, points_end, wp_index)
    wp_region = text[wp_start:wp_end]
    m = re.search(r'\["name"\]\s*=\s*"' + _LUA_STR_VALUE + r'"', wp_region)
    if not m:
        return ''
    return _lua_str_unescape(m.group(1))


def _replace_waypoint_tasks(text: str, group_id: int, tasks: list[dict]) -> str:
    """Apply per-waypoint TIC token edits to a group's route.

    Each entry in `tasks` is a dict describing one waypoint's intended state:

        {
          "wpIndex":     int,    # 1-based DCS waypoint number
          "action":      str,    # "goto" | "goto_at_time"  (controls t+N)
          "eta_seconds": int,    # used when action == "goto_at_time"

          # ── v2 secondary tokens (all optional) ───────────────────────
          # Each behaves the same way: omit / null → leave the token
          # alone in the existing name; empty string → strip the token;
          # any other value → set or replace the token.
          "speed":     int,      # speed=N  (km/h)
          "roe":       str,      # roe=simulate / roe=kill / roe=hold
          "hdg":       int,      # hdg=N    (degrees)
          "flag_wait": str|int,  # flag=X   (TIC waits for this flag)
          "flag_set":  str|int,  # flag+X   (TIC sets this flag on arrival)
        }

    TIC parses the waypoint NAME for behavioural tokens at runtime
    (TIC_v1.1.lua::extract*). So this handler surgically maintains those
    tokens inside each target waypoint's name field. The tokens parsed
    by the script and supported here:

        t+N             — offset time in minutes after previous WP
        speed=N         — set unit speed in km/h
        roe=<verb>      — rules of engagement (simulate/kill/hold)
        hdg=N           — heading degrees
        flag=X          — wait for flag X to be true before proceeding
        flag+X          — set flag X true on arrival

    All other tokens in the name (scale=, "phase", direct=, strength=,
    mount/dismount, etc.) are preserved untouched, even ones the planner
    doesn't yet expose in v2 — mission designers can hand-edit those in
    the waypoint name and the planner won't clobber them.

    Process waypoints in REVERSE wpIndex order so earlier-positioned
    splices don't shift offsets we'd need for later indices.
    """
    if not tasks:
        return text

    # (token_kwarg, prefix, separator) — drives the secondary token loop.
    # Order matters cosmetically (later tokens append to the right of
    # earlier ones in the rendered name); functionally the order is
    # irrelevant since TIC's parser sweeps the whole string.
    SECONDARY_TOKENS = (
        ("speed",      "speed",    "="),  # v0.9.57
        ("roe",        "roe",      "="),  # v0.9.57
        ("hdg",        "hdg",      "="),  # v0.9.57
        ("flag_wait",  "flag",     "="),  # v0.9.57
        ("flag_set",   "flag",     "+"),  # v0.9.57
        ("scale",      "scale",    "="),  # v0.9.59
        ("direct",     "direct",   "="),  # v0.9.59
        ("strength",   "strength", "="),  # v0.9.59
    )

    for spec in sorted(tasks, key=lambda t: int(t.get("wpIndex", 0)), reverse=True):
        wp_idx = int(spec.get("wpIndex"))
        action = str(spec.get("action", "goto"))
        current_name = _read_waypoint_name(text, group_id, wp_idx)
        new_name = current_name

        # ── Primary action: drives the `t+N` token ───────────────────
        if action == "goto":
            new_name = _set_offset_in_tic_name(new_name, None)
        elif action == "goto_at_time":
            minutes = max(0, round(int(spec.get("eta_seconds", 0)) / 60))
            new_name = _set_offset_in_tic_name(new_name, minutes)
        # else: unknown verb — leave t+N alone but still process secondary
        # tokens (forward-compat with future primary verbs we haven't
        # mapped yet).

        # ── v2 secondary tokens — only touch ones present in the spec ──
        # `None` (or omitted entirely) means "leave that token alone in
        # the name". Empty string means "remove the token". Any other
        # value sets/replaces it.
        for kwarg, prefix, sep in SECONDARY_TOKENS:
            if kwarg not in spec:
                continue
            new_name = _set_named_token_in_tic_name(
                new_name, prefix, sep, spec[kwarg],
            )

        # v0.9.59 — quoted "phase" + bare-word mount/dismount don't fit
        # the generic KEY<sep>VALUE token shape, so each has its own
        # helper. Same "absent = leave alone, falsy = strip" convention.
        if "phase" in spec:
            new_name = _set_quoted_phase_in_tic_name(new_name, spec["phase"])
        if "deployment" in spec:
            new_name = _set_deployment_in_tic_name(new_name, spec["deployment"])

        if new_name == current_name:
            continue  # idempotent — skip the splice
        text = _replace_waypoint_name(text, group_id, wp_idx, new_name)
    return text


# ---------------------------------------------------------------------------
# TIC-prep: clear DCS-native scheduling locks on a group's waypoints
# ---------------------------------------------------------------------------

def _enumerate_waypoint_indices(text: str, group_id: int) -> list[int]:
    """Return the 1-based waypoint indices present in a group's route, in order.

    Scans the route's ["points"] block at depth 1 (so nested ComboTask sub-
    table indices don't leak in). Useful for "for every WP of this group"
    operations like the TIC scheduling-lock clearer below.
    """
    points_start, points_end = _find_route_points_bounds(text, group_id)
    region = text[points_start:points_end]
    indices: list[int] = []
    depth = 0
    i = 0
    anchor = re.compile(r'\[(\d+)\]\s*=\s*\n?\s*\{')
    while i < len(region):
        ch = region[i]
        if ch == '{':
            depth += 1
            i += 1
            continue
        if ch == '}':
            depth -= 1
            i += 1
            continue
        if depth == 1:
            m = anchor.match(region, i)
            if m:
                indices.append(int(m.group(1)))
                # Skip past the opening brace so the next iter starts inside
                # the WP body — at depth 2 — and we don't re-match the same
                # `[N] =` line.
                i = m.end()
                depth += 1
                continue
        i += 1
    return indices


def _clear_tic_scheduling_locks(text: str, group_id: int) -> str:
    """Set the per-waypoint lock combination that satisfies BOTH DCS ME's
    route validator (me_route.lua) AND TIC's runtime expectations.

    DCS's validator runs three different checks at three different times,
    and the only lock combination they agree on is non-obvious:

      1. verifyRouteSeg_:1439  — late activation requires WP1.ETA_locked.
      2. verifyRouteSeg_:1444  — if two ETA_locked WPs surround a stretch
                                  where EVERY between-WP has speed_locked,
                                  errors "all WPs have locked speed".
      3. updateTimeAndSpeedFor_:1685/1710 — when the user CLICKS a unit,
                                  computes time-and-speed; if WP1 has
                                  ETA_locked but speed_locked=false, the
                                  branch-3 path tries to compute ETA via
                                  speed and bails when speed isn't locked.

    The first two are load-time validation; the third fires the moment
    you select the unit in DCS ME (which is the symptom Fett hit when
    the previous all-speeds-unlocked scheme broke unit selection).

    Scheme that passes all three:

        WP1        → ETA_locked = true,  speed_locked = true
        WP2        → ETA_locked = false, speed_locked = false  ← THE one
                       middle WP with unlocked speed; gives
                       verifyRouteSeg_:1444 its `length > 0` win.
        WP3..n-1   → ETA_locked = false, speed_locked = true
        WPlast     → ETA_locked = true,  speed_locked = true
                       (for 2-WP routes WPlast == WP2 here, the rules
                       for "second WP" win → ETA=true, speed=false.)

    TIC runtime doesn't read DCS-native ETA_locked / speed_locked. It
    drives scheduling from the waypoint NAME (`t+N`) and speed from its
    per-unit-type profile via `group:RouteGroundTo(coord, speed)`. So
    setting these locks for the validator's sake is invisible at TIC
    runtime.

    Walks WPs in REVERSE index order so byte-length changes from earlier
    splices don't shift positions we still need.
    """
    indices = sorted(_enumerate_waypoint_indices(text, group_id))
    if not indices:
        return text
    first_wp = indices[0]
    last_wp = indices[-1]
    # The "second" waypoint — wp_idx of the second entry. For 2-WP
    # routes this is the same as last_wp. For 1-WP routes there's no
    # second; the loop below just hits WP1 with bookend rules.
    second_wp = indices[1] if len(indices) >= 2 else None
    for wp_idx in sorted(indices, reverse=True):
        is_bookend = (wp_idx == first_wp or wp_idx == last_wp)
        is_second  = (wp_idx == second_wp)
        eta_locked_val   = "true"  if is_bookend else "false"
        # WP1: always locked-speed (branch 3 of updateTimeAndSpeedFor_
        # demands it). The second WP: unlocked speed so the route walk
        # has a between-bookends WP with `length > 0`. Everything else
        # locked speed.
        if wp_idx == first_wp:
            speed_locked_val = "true"
        elif is_second:
            speed_locked_val = "false"
        else:
            speed_locked_val = "true"
        ps, pe = _find_route_points_bounds(text, group_id)
        ws, we = _find_waypoint_block_bounds(text, ps, pe, wp_idx)
        text = _set_lua_scalar_field(text, ws, we, "speed_locked", speed_locked_val)
        ps, pe = _find_route_points_bounds(text, group_id)
        ws, we = _find_waypoint_block_bounds(text, ps, pe, wp_idx)
        text = _set_lua_scalar_field(text, ws, we, "ETA_locked", eta_locked_val)
    return text


def _set_group_manual_heading(text: str, group_id: int, enabled: bool) -> str:
    """Set ["manualHeading"] = true/false on the group's block.

    Maps to the DCS ME "INITIAL HEADING" checkbox (right of the
    compass-wheel widget — see me_vehicle.lua:88 `manualHeading = _('INITIAL\\nHEADING')`).
    When true, DCS uses the unit's HEADING field verbatim as the initial
    spawn heading; when false (default), DCS recomputes the heading from
    the route direction (the WP1 → WP2 vector for vehicles).

    For TIC-renamed groups we set this true because the planner writes a
    random per-unit heading during the TIC rename pass and we want it
    to actually stick — TIC controls movement at runtime anyway, so the
    route-derived heading isn't useful.

    Inserts the field after the ["groupId"] line if absent; mutates the
    existing value if present (idempotent).
    """
    group_pos = _find_group_block_start(text, group_id)
    lua_val = "true" if enabled else "false"

    # Search a generous window after groupId — manualHeading sits among
    # other group-level booleans (lateActivation, hidden, etc.) shortly
    # after the groupId field in DCS-emitted Lua.
    search_end = min(len(text), group_pos + 5000)
    region = text[group_pos:search_end]

    m = re.search(r'(\["manualHeading"\]\s*=\s*)(true|false)', region)
    if m:
        abs_start = group_pos + m.start(2)
        abs_end = group_pos + m.end(2)
        return text[:abs_start] + lua_val + text[abs_end:]

    # Field absent — insert directly after the ["groupId"] = N, line.
    gid_pattern = re.compile(rf'\["groupId"\]\s*=\s*{group_id}\s*,')
    gm = gid_pattern.search(text, group_pos)
    if not gm:
        return text  # defensive — locator should have given us a real anchor
    insert_pos = gm.end()
    return text[:insert_pos] + f'\n\t\t\t\t["manualHeading"] = {lua_val},' + text[insert_pos:]


def _is_tic_format_name(name: str | None) -> bool:
    """True iff `name` is in the TIC group-name format the TIC_v1.1.lua
    script recognises — TIC! (formation leader) or TIC: (member),
    optionally with a `+` separator. Bookend `#` ends the prefix.
    """
    if not name:
        return False
    return name.startswith("TIC!") or name.startswith("TIC:")


# ---------------------------------------------------------------------------
# Group-level edit functions
# ---------------------------------------------------------------------------

def _replace_group_field(text: str, group_id: int, field: str, new_value) -> str:
    """Replace a group-level field (task, frequency, modulation) on a group.

    Group-level fields like ["frequency"] appear AFTER the ["units"] block.
    We brace-match past the units block first, then search for the field — this
    avoids mistakenly matching unit-level ["frequency"] fields that appear
    inside individual unit Radio blocks.
    """
    group_pos = _find_group_block_start(text, group_id)

    # Find and brace-match past the ["units"] block.
    units_match = re.search(r'\["units"\]\s*=\s*\n?\s*\{', text[group_pos:group_pos + 500])
    if not units_match:
        # No units block — search from the group start as fallback.
        search_start = group_pos
    else:
        brace_start = group_pos + units_match.end() - 1
        depth = 1
        i = brace_start + 1
        while i < len(text) and depth > 0:
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
            i += 1
        search_start = i  # just past the units block's closing brace

    # Now search within the remainder of the group block. Group-level fields
    # sit between the closing units brace and the end of the group block.
    # Limit to 5000 chars — group-level fields cluster at the end.
    search_end = min(len(text), search_start + 5000)
    region = text[search_start:search_end]

    if isinstance(new_value, str):
        lua_val = f'"{new_value}"'
    elif isinstance(new_value, bool):
        lua_val = "true" if new_value else "false"
    else:
        lua_val = str(new_value)

    pattern = rf'(\["{field}"\]\s*=\s*)([^,\n]+)'
    m = re.search(pattern, region)
    if m:
        abs_start = search_start + m.start(2)
        abs_end = search_start + m.end(2)
        text = text[:abs_start] + lua_val + text[abs_end:]
    return text


def _rename_group_and_units(text: str, group_id: int, new_group_name: str | None,
                            unit_names: dict) -> str:
    """Rename a group and/or its units.

    Args:
        group_id: The groupId to find.
        new_group_name: New name for the group (None to skip group rename).
        unit_names: Dict of {unitId: newName} for individual unit renames.

    Side effect (v0.9.48): when the new group name is in TIC format
    (`TIC!` or `TIC:` prefix), every waypoint of the group has its
    DCS-native ETA_locked + speed_locked cleared. TIC's runtime script
    drives its own scheduling and complains ("All waypoints have locked
    speed / locked time") when those flags remain true. The rename is
    the user's signal that the group is now TIC-managed.
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
        name_match = re.search(r'\["name"\]\s*=\s*"' + _LUA_STR_VALUE + r'"', text[units_end:units_end + 500])
        if not name_match:
            raise ValueError(f"Group name not found after units block for group {group_id}")

        abs_start = units_end + name_match.start(1)
        abs_end = units_end + name_match.end(1)
        # See _replace_unit_name for the escape rationale — same bug class.
        text = text[:abs_start] + _lua_str_escape(new_group_name) + text[abs_end:]

        # If the user renamed to TIC format, also:
        #   (a) bookend the WP scheduling locks (DCS ME validator),
        #   (b) set INITIAL HEADING (["manualHeading"] = true) on the
        #       group so the random per-unit heading the TIC tab wrote
        #       actually sticks at spawn time. Without manualHeading,
        #       DCS recomputes the spawn heading from the WP1→WP2
        #       vector, which overrides our random.
        if _is_tic_format_name(new_group_name):
            try:
                text = _clear_tic_scheduling_locks(text, group_id)
            except ValueError:
                # Group has no route block (carrier static, infantry with
                # no waypoints, etc.). Locks-clearing isn't applicable —
                # silent no-op rather than aborting the rename.
                pass
            text = _set_group_manual_heading(text, group_id, True)

    return text


# ---------------------------------------------------------------------------
# Mission-level edit functions
# ---------------------------------------------------------------------------

def _replace_briefing_fields(text: str, value: dict) -> str:
    """Replace mission briefing text fields (sortie, descriptionText, blue/red task).

    The old implementation had two coupled bugs that destroyed M5 + M7 on
    2026-05-15:

    1. Locator regex `"([^"]*)"` truncated at the first `\\"` inside an
       existing escaped brief — e.g. inches-of-mercury `29.92\\"`. The
       capture covered only the prefix, leaving the tail of the OLD brief
       stranded in the file after the new closing `"`. Lua bailed on the
       first `\\n` it saw outside a string ("'}' expected near '\\'").

    2. The replacement string `rf'\\1"{new_val}"'` was fed to re.sub, which
       re-interprets `\\`-sequences in replacement text. Escaped backslashes
       in new_val survived by luck of how re.sub handles unknown escapes,
       but the path was fragile.

    Both fixed by switching to _LUA_STR_VALUE (walks `\\"`) for the locator
    and direct splicing of the escaped value (no re.sub on the replacement).
    """
    field_map = {
        "sortie": "sortie",
        "description": "descriptionText",
        "descriptionBlueTask": "descriptionBlueTask",
        "descriptionRedTask": "descriptionRedTask",
    }
    for key, lua_key in field_map.items():
        if key not in value:
            continue
        pattern = re.compile(rf'\["{lua_key}"\]\s*=\s*"' + _LUA_STR_VALUE + r'"')
        m = pattern.search(text)
        if not m:
            continue
        escaped = _lua_str_escape(str(value[key]))
        text = text[:m.start(1)] + escaped + text[m.end(1):]
    return text


def _find_coalition_block_bounds(text: str) -> tuple[int, int] | None:
    """Return (start, end_exclusive) of the singular ["coalition"] = {...} block.

    DCS mission files contain multiple places where "blue"/"red"/"neutrals"
    keys appear (trigrules, groundControl roles, etc.). Coalition-editing
    functions MUST scope their searches to the actual ["coalition"] block.
    """
    m = re.search(r'\["coalition"\]\s*=\s*\n?\s*\{', text)
    if not m:
        return None
    brace = text.index('{', m.start())
    depth = 1
    i = brace + 1
    while i < len(text) and depth > 0:
        ch = text[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        i += 1
    return brace, i  # i is just past the closing }


def _replace_coalition_assignments(text: str, changes: dict) -> str:
    """Move countries between coalitions in the raw mission Lua text.

    changes: dict mapping country_name -> target_coalition
    e.g. {"USA": "red", "Russia": "blue"}

    DCS Lua structure:
      ["coalition"]["blue"]["country"][N] = { ["name"] = "USA", ... }

    For each country, we:
    1. Find the country's ["name"] entry INSIDE the ["coalition"] block
    2. Verify which coalition it's currently in (scoped to coalition block)
    3. Remove it from the source coalition
    4. Insert it into the target coalition's ["country"] section
       (again, scoped to the coalition block — NOT the first ["red"] match,
       which may be inside trigrules or groundControl.roles)
    """
    for country_name, target_coal in changes.items():
        if target_coal not in ("blue", "red", "neutrals"):
            continue

        # Re-resolve the coalition block each iteration since prior edits
        # may have shifted offsets.
        coal_bounds = _find_coalition_block_bounds(text)
        if not coal_bounds:
            continue
        coal_start, coal_end = coal_bounds

        # --- Step 1: Find ["name"] = "CountryName" WITHIN the coalition block ---
        name_pat = rf'\["name"\]\s*=\s*"{re.escape(country_name)}"'
        name_match = re.search(name_pat, text[coal_start:coal_end])
        if not name_match:
            continue

        name_pos = coal_start + name_match.start()

        # --- Step 2: Determine current coalition ---
        # Find the nearest ["blue"/"red"/"neutrals"] = key before this position,
        # scoped to the coalition block only.
        current_coal = None
        best_pos = -1
        for coal in ("blue", "red", "neutrals"):
            # Search within coal_start..name_pos (not whole text)
            region_before = text[coal_start:name_pos]
            for m in re.finditer(rf'\["{coal}"\]\s*=', region_before):
                abs_pos = coal_start + m.start()
                if abs_pos > best_pos:
                    best_pos = abs_pos
                    current_coal = coal

        if not current_coal or current_coal == target_coal:
            continue

        # --- Step 3: Find the [N] = { ... } entry block ---
        # Walk backward from the name match to find the opening { of this country
        depth = 0
        i = name_pos - 1
        while i >= 0:
            ch = text[i]
            if ch == '"':
                i -= 1
                while i >= 0 and text[i] != '"':
                    if i > 0 and text[i - 1] == '\\':
                        i -= 1
                    i -= 1
            elif ch == '}':
                depth += 1
            elif ch == '{':
                if depth == 0:
                    break
                depth -= 1
            i -= 1
        open_brace = i
        if open_brace < 0:
            continue

        # Back up to find [N] = before the opening brace
        prefix = text[max(0, open_brace - 120):open_brace]
        idx_match = re.search(r'\[(\d+)\]\s*=\s*$', prefix.rstrip())
        if not idx_match:
            continue
        entry_start = max(0, open_brace - 120) + idx_match.start()

        # Consume leading whitespace on the line
        while entry_start > 0 and text[entry_start - 1] in (' ', '\t'):
            entry_start -= 1

        # Find closing brace using depth counting
        depth = 0
        j = open_brace
        in_str = False
        while j < len(text):
            ch = text[j]
            if ch == '"' and (j == 0 or text[j - 1] != '\\'):
                in_str = not in_str
            elif not in_str:
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        break
            j += 1
        close_brace = j

        # Grab inner content (the country data between braces)
        inner_content = text[open_brace + 1:close_brace]

        # Determine end of entry including trailing comma and comment
        entry_end = close_brace + 1
        rest = text[entry_end:entry_end + 80]
        trail = re.match(r'\s*,[ \t]*(--[^\n]*)?\n?', rest)
        if trail:
            entry_end += trail.end()

        # Remove the entry plus its leading whitespace line, but keep a newline
        # between the previous line and whatever follows so we don't merge
        # a "-- end of [N]" comment with the next closing brace.
        if entry_start > 0 and text[entry_start - 1] == '\n':
            entry_start -= 1

        # --- Step 4: Remove the entry from source coalition ---
        # Ensure a newline exists at the splice point so adjacent lines
        # don't collapse (which would hide a } inside a -- comment).
        before = text[:entry_start]
        after = text[entry_end:]
        if before and before[-1] != '\n' and after and after[0] != '\n':
            text = before + '\n' + after
        else:
            text = before + after

        # --- Step 5: Find the target coalition's ["country"] section ---
        # Re-resolve coalition bounds — prior edits above shifted offsets.
        coal_bounds_after = _find_coalition_block_bounds(text)
        if not coal_bounds_after:
            continue
        coal_start_after, coal_end_after = coal_bounds_after

        # CRITICAL: scope the ["target_coal"] search to the coalition block.
        # The un-scoped version used to land in trigrules' ["red"], corrupting
        # the mission. Countries landed in the wrong coalition.
        search_region = text[coal_start_after:coal_end_after]
        target_coal_match = re.search(rf'\["{target_coal}"\]\s*=\s*\{{', search_region)
        if not target_coal_match:
            continue
        # Convert back to absolute offsets
        target_coal_abs_end = coal_start_after + target_coal_match.end()

        country_match = re.search(
            r'\["country"\]\s*=\s*\{',
            text[target_coal_abs_end:coal_end_after],
        )
        if not country_match:
            continue

        # Position of the { opening the country table
        country_open = target_coal_abs_end + country_match.end() - 1

        # Find the closing } of the country table
        depth = 0
        k = country_open
        in_str = False
        while k < len(text):
            ch = text[k]
            if ch == '"' and (k == 0 or text[k - 1] != '\\'):
                in_str = not in_str
            elif not in_str:
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        break
            k += 1
        country_close = k  # Position of closing }

        # --- Step 6: Determine next index and insert ---
        # Only count [N] = at depth 1 (top-level country entries), not nested ones
        country_section = text[country_open:country_close]
        existing_indices = []
        cs_depth = 0
        cs_i = 0
        while cs_i < len(country_section):
            ch = country_section[cs_i]
            if ch == '"':
                cs_i += 1
                while cs_i < len(country_section) and country_section[cs_i] != '"':
                    if country_section[cs_i] == '\\':
                        cs_i += 1
                    cs_i += 1
            elif ch == '{':
                cs_depth += 1
            elif ch == '}':
                cs_depth -= 1
            elif ch == '[' and cs_depth == 1:
                idx_m = re.match(r'\[(\d+)\]\s*=', country_section[cs_i:])
                if idx_m:
                    existing_indices.append(int(idx_m.group(1)))
            cs_i += 1
        next_idx = max(existing_indices, default=0) + 1

        # Detect indentation from existing entries or use 12 spaces
        indent_match = re.search(r'\n(\s+)\[\d+\]\s*=', country_section)
        indent = indent_match.group(1) if indent_match else "            "

        new_entry = f"\n{indent}[{next_idx}] =\n{indent}{{{inner_content}}}, -- end of [{next_idx}]"

        # Insert before the closing } of the country table.
        # Find the start of the line containing country_close so we
        # preserve its indentation (DCS ME may rely on it).
        line_start = text.rfind('\n', 0, country_close)
        if line_start < 0:
            line_start = 0
        else:
            line_start += 1  # skip the \n itself
        closing_line = text[line_start:country_close + 1]  # e.g. "\t\t\t}"
        # Check if there's a comment after the }
        after_close = text[country_close + 1:]
        trail_m = re.match(r'[^\n]*', after_close)
        closing_line += trail_m.group(0) if trail_m else ""
        closing_end = country_close + 1 + (trail_m.end() if trail_m else 0)

        text = text[:line_start] + new_entry + "\n" + closing_line + text[closing_end:]

    # --- Also update ["coalitions"] (plural) ID mapping table ---
    # DCS uses this separate table to determine coalition membership in the ME.
    # Structure: ["coalitions"]["blue"] = { [1]=id, [2]=id, ... }
    text = _update_coalitions_id_table(text, changes)

    return text


def _update_coalitions_id_table(text: str, changes: dict) -> str:
    """Update the ["coalitions"] (plural) country-ID mapping table.

    DCS missions have TWO coalition structures:
      ["coalition"]  — contains actual unit/group data per country
      ["coalitions"] — simple mapping of country IDs to coalitions

    Both must be updated when moving a country between coalitions.
    """
    # Find the ["coalitions"] block
    coalitions_match = re.search(r'\["coalitions"\]\s*=\s*\n?\s*\{', text)
    if not coalitions_match:
        return text

    # For each country change, find its numeric ID and move it
    for country_name, target_coal in changes.items():
        if target_coal not in ("blue", "red", "neutrals"):
            continue

        # Find the country's numeric ID from the ["coalition"] block
        # Look for ["name"] = "CountryName" near ["id"] = N
        name_pat = rf'\["name"\]\s*=\s*"{re.escape(country_name)}"'
        name_match = re.search(name_pat, text)
        if not name_match:
            continue

        # Search nearby for ["id"] = N (within ~500 chars before/after)
        search_start = max(0, name_match.start() - 500)
        search_end = min(len(text), name_match.end() + 500)
        region = text[search_start:search_end]
        id_match = re.search(r'\["id"\]\s*=\s*(\d+)', region)
        if not id_match:
            continue
        country_id = int(id_match.group(1))

        # Now find and remove country_id from its current coalition in ["coalitions"]
        coalitions_start = coalitions_match.start()
        # Find the end of the ["coalitions"] block
        brace_pos = text.index('{', coalitions_start)
        depth = 0
        k = brace_pos
        in_str = False
        while k < len(text):
            ch = text[k]
            if ch == '"' and (k == 0 or text[k-1] != '\\'):
                in_str = not in_str
            elif not in_str:
                if ch == '{': depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0: break
            k += 1
        coalitions_end = k + 1
        coalitions_block = text[coalitions_start:coalitions_end]

        # Find the source coalition sub-table containing country_id
        source_coal = None
        for coal in ("blue", "red", "neutrals"):
            coal_pat = rf'\["{coal}"\]\s*=\s*\n?\s*\{{'
            coal_m = re.search(coal_pat, coalitions_block)
            if not coal_m:
                continue
            # Find the closing } of this sub-table
            sub_open = coal_m.end() - 1
            sub_depth = 0
            si = sub_open
            while si < len(coalitions_block):
                if coalitions_block[si] == '{': sub_depth += 1
                elif coalitions_block[si] == '}':
                    sub_depth -= 1
                    if sub_depth == 0: break
                si += 1
            sub_block = coalitions_block[sub_open:si + 1]
            # Check if country_id is in this sub-table
            if re.search(rf'=\s*{country_id}\s*,', sub_block):
                source_coal = coal
                break

        if not source_coal or source_coal == target_coal:
            continue

        # Remove country_id from source and re-index
        for coal in (source_coal,):
            coal_pat = rf'(\["{coal}"\]\s*=\s*\n?\s*)\{{'
            coal_m = re.search(coal_pat, text[coalitions_start:coalitions_end])
            if not coal_m:
                continue
            abs_start = coalitions_start + coal_m.end() - 1
            # Find closing }
            sub_depth = 0
            si = abs_start
            while si < len(text):
                if text[si] == '{': sub_depth += 1
                elif text[si] == '}':
                    sub_depth -= 1
                    if sub_depth == 0: break
                si += 1
            sub_close = si

            # Extract all IDs, remove country_id, re-index
            sub_content = text[abs_start + 1:sub_close]
            ids = [int(m.group(1)) for m in re.finditer(r'=\s*(\d+)', sub_content)]
            ids = [i for i in ids if i != country_id]

            # Detect indent
            indent_m = re.search(r'\n(\s+)\[', sub_content)
            indent = indent_m.group(1) if indent_m else "\t\t\t"

            new_entries = "".join(f"\n{indent}[{i+1}] = {cid}," for i, cid in enumerate(ids))
            close_indent = indent[:-1] if indent.endswith('\t') else indent
            new_sub = "{" + new_entries + "\n" + close_indent + "}"
            # Replace the sub-table
            text = text[:abs_start] + new_sub + text[sub_close + 1:]

            # Recalculate coalitions_end since text changed
            coalitions_match2 = re.search(r'\["coalitions"\]\s*=\s*\n?\s*\{', text)
            brace_pos2 = text.index('{', coalitions_match2.start())
            depth2 = 0
            k2 = brace_pos2
            while k2 < len(text):
                if text[k2] == '{': depth2 += 1
                elif text[k2] == '}':
                    depth2 -= 1
                    if depth2 == 0: break
                k2 += 1
            coalitions_end = k2 + 1
            coalitions_start = coalitions_match2.start()

        # Add country_id to target coalition
        coal_pat = rf'(\["{target_coal}"\]\s*=\s*\n?\s*)\{{'
        coal_m = re.search(coal_pat, text[coalitions_start:coalitions_end])
        if not coal_m:
            continue
        abs_start = coalitions_start + coal_m.end() - 1
        sub_depth = 0
        si = abs_start
        while si < len(text):
            if text[si] == '{': sub_depth += 1
            elif text[si] == '}':
                sub_depth -= 1
                if sub_depth == 0: break
            si += 1
        sub_close = si

        sub_content = text[abs_start + 1:sub_close]
        ids = [int(m.group(1)) for m in re.finditer(r'=\s*(\d+)', sub_content)]
        ids.append(country_id)

        indent_m = re.search(r'\n(\s+)\[', sub_content)
        indent = indent_m.group(1) if indent_m else "\t\t\t"

        new_entries = "".join(f"\n{indent}[{i+1}] = {cid}," for i, cid in enumerate(ids))
        close_indent = indent[:-1] if indent.endswith('\t') else indent
        new_sub = "{" + new_entries + "\n" + close_indent + "}"
        text = text[:abs_start] + new_sub + text[sub_close + 1:]

    return text


def _replace_forced_options(text: str, options: dict) -> str:
    """Replace or create the forcedOptions block in the mission Lua text.

    `options` is a flat dict of key→value pairs, e.g.:
    {"padlock": True, "labels": 0, "externalViews": False}
    """
    import re

    # Serialize options dict to DCS Lua format
    from services.miz_editor import _serialize_lua_value

    lines = []
    for k, v in sorted(options.items()):
        if isinstance(v, bool):
            lua_val = "true" if v else "false"
        elif isinstance(v, (int, float)):
            lua_val = str(int(v)) if isinstance(v, float) and v == int(v) else str(v)
        elif isinstance(v, str):
            lua_val = f'"{v}"'
        else:
            # Nested structures (lists, dicts) — serialize as Lua tables
            lua_val = _serialize_lua_value(v, "        ")
        lines.append(f'        ["{k}"] = {lua_val},')
    inner = "\n".join(lines)
    new_block = f'["forcedOptions"] =\n    {{\n{inner}\n    }}'

    # Try to find and replace existing forcedOptions block
    # Use brace-matching to handle nested structures (e.g. optionsViewExtended)
    fo_match = re.search(r'\["forcedOptions"\]\s*=\s*\n?\s*\{', text)
    if fo_match:
        fo_open = fo_match.end() - 1  # position of {
        depth = 0
        fi = fo_open
        in_str = False
        while fi < len(text):
            ch = text[fi]
            if ch == '"' and (fi == 0 or text[fi-1] != '\\'):
                in_str = not in_str
            elif not in_str:
                if ch == '{': depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0: break
            fi += 1
        text = text[:fo_match.start()] + new_block + text[fi + 1:]
    else:
        # No existing block — insert before the closing of the mission table
        # Look for the last "} -- end of mission" or just before final closing
        # Insert right before the end of the mission root table
        # The mission Lua typically ends with: } -- end of mission
        insert_pattern = re.compile(r'(\n\} -- end of mission)', re.IGNORECASE)
        if insert_pattern.search(text):
            text = insert_pattern.sub(f'\n    {new_block},\\1', text)
        else:
            # Fallback: insert before the very last closing brace
            last_brace = text.rfind("}")
            if last_brace > 0:
                text = text[:last_brace] + f'    {new_block},\n' + text[last_brace:]

    return text


def _replace_mission_goals(text: str, goals: list) -> str:
    """Replace the top-level ["goals"] block with a fresh list of goals.

    `goals` is the frontend's MissionGoal[] payload — a list of
    {id, text, side, points, notes} dicts. We translate each into a
    minimal DCS goal entry:

        [N] = {
            ["score"] = <points>,
            ["flag"] = N,
            ["comment"] = "[<SIDE>] <text>",
            ["predicates"] = {},
            ["rules"] = {},
        },

    Empty `rules` means DCS won't auto-evaluate the goal at runtime
    — perfect for training scenarios where the instructor scores
    manually. The `[<SIDE>]` prefix in the comment encodes the
    coalition for human readers without us having to wire DCS
    coalition predicates (which would require a real evaluation
    rule, out of scope for v1).

    `notes` is editor-only and intentionally NOT written into the
    .miz — it's pilot-internal context, not a goal description.

    Empty goals list (or all-empty-text goals) writes an empty
    `["goals"] = {}` block, same shape DCS ME emits when the user
    has no goals defined.
    """
    # Filter out blank-text rows the editor lets the user stage.
    valid = [g for g in goals if (g.get("text") or "").strip()]

    if not valid:
        new_block = '["goals"] = {}'
    else:
        entries = []
        for i, g in enumerate(valid, start=1):
            side = (g.get("side") or "all").upper()
            comment_raw = (g.get("text") or "").strip()
            # Escape Lua string special chars: backslash, double quote,
            # newline. DCS comments live on a single line so we collapse
            # newlines to spaces rather than emitting "\n".
            comment_safe = (
                comment_raw
                .replace('\\', '\\\\')
                .replace('"', '\\"')
                .replace('\n', ' ')
                .replace('\r', '')
            )
            comment_full = f'[{side}] {comment_safe}'
            score = int(g.get("points") or 0)
            entries.append(
                f'        [{i}] = \n'
                f'        {{\n'
                f'            ["score"] = {score},\n'
                f'            ["flag"] = {i},\n'
                f'            ["comment"] = "{comment_full}",\n'
                f'            ["predicates"] = {{}},\n'
                f'            ["rules"] = {{}},\n'
                f'        }}, -- end of [{i}]'
            )
        inner = '\n'.join(entries)
        new_block = f'["goals"] = \n    {{\n{inner}\n    }}'

    # Find existing goals block — brace-match like _replace_forced_options
    # so we cleanly replace whatever shape DCS ME left (empty {}, or
    # a populated block with N entries).
    goals_match = re.search(r'\["goals"\]\s*=\s*\n?\s*\{', text)
    if goals_match:
        block_open = goals_match.end() - 1  # position of {
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
                        break
            fi += 1
        text = text[:goals_match.start()] + new_block + text[fi + 1:]
    else:
        # No existing block (extremely rare — DCS always emits at least
        # `["goals"] = {}`). Insert right before mission root close.
        insert_pattern = re.compile(r'(\n\} -- end of mission)', re.IGNORECASE)
        if insert_pattern.search(text):
            text = insert_pattern.sub(f'\n    {new_block},\\1', text)
        else:
            last_brace = text.rfind("}")
            if last_brace > 0:
                text = text[:last_brace] + f'    {new_block},\n' + text[last_brace:]

    return text


def _replace_planner_dmpis(text: str, dmpis: list) -> str:
    """Replace the planner-private ["plannerDmpis"] block in mission Lua.

    DMPIs aren't a native DCS field — DCS ignores unknown top-level keys
    in the mission table, so we use a custom `["plannerDmpis"]` slot
    that:
      - Round-trips cleanly through the planner (write -> read -> write)
      - Doesn't interfere with anything DCS reads at runtime
      - Survives re-save in this editor (DCS ME may strip it on its
        own re-save, which is acceptable — planner-authored sessions
        are the use case)

    `dmpis` is the frontend Dmpi[] payload — list of {id, name, lat,
    lon, elevation, description, weaponDelivery, notes} dicts. We
    drop the `id` (re-derived deterministically on read) and write
    every other field.

    Empty list writes an empty block — same shape this writer emits
    for goals so the read path can rely on the block's existence as
    the "DMPIs were touched" signal.
    """
    valid = [d for d in dmpis if (d.get("name") or "").strip()]

    def _esc(s: str) -> str:
        return (
            (s or "")
            .replace('\\', '\\\\')
            .replace('"', '\\"')
            .replace('\n', ' ')
            .replace('\r', '')
        )

    if not valid:
        new_block = '["plannerDmpis"] = {}'
    else:
        entries = []
        for i, d in enumerate(valid, start=1):
            lat = float(d.get("lat") or 0)
            lon = float(d.get("lon") or 0)
            elev = float(d.get("elevation") or 0)
            entries.append(
                f'        [{i}] = \n'
                f'        {{\n'
                f'            ["name"] = "{_esc(d.get("name", ""))}",\n'
                f'            ["lat"] = {lat},\n'
                f'            ["lon"] = {lon},\n'
                f'            ["elevation"] = {elev},\n'
                f'            ["description"] = "{_esc(d.get("description", ""))}",\n'
                f'            ["weaponDelivery"] = "{_esc(d.get("weaponDelivery", ""))}",\n'
                f'            ["notes"] = "{_esc(d.get("notes", ""))}",\n'
                f'        }}, -- end of [{i}]'
            )
        inner = '\n'.join(entries)
        new_block = f'["plannerDmpis"] = \n    {{\n{inner}\n    }}'

    # Replace existing or insert before mission close — same brace
    # walk pattern as `_replace_forced_options` and `_replace_mission_goals`.
    block_match = re.search(r'\["plannerDmpis"\]\s*=\s*\n?\s*\{', text)
    if block_match:
        block_open = block_match.end() - 1
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
                        break
            fi += 1
        text = text[:block_match.start()] + new_block + text[fi + 1:]
    else:
        # No existing block — insert before mission root close.
        insert_pattern = re.compile(r'(\n\} -- end of mission)', re.IGNORECASE)
        if insert_pattern.search(text):
            text = insert_pattern.sub(f'\n    {new_block},\\1', text)
        else:
            last_brace = text.rfind("}")
            if last_brace > 0:
                text = text[:last_brace] + f'    {new_block},\n' + text[last_brace:]

    return text


def _strip_required_modules(text: str) -> str:
    """Empty the mission's `["requiredModules"]` block.

    DCS embeds the list of mods the mission depends on into the
    .miz file. When a player loads the mission, DCS refuses if any
    required module is missing. That's annoying when the mission
    maker had a mod installed but doesn't actually use it in this
    sortie — every joiner has to install the same mod just to load
    in. Stripping the list lets anyone play; if the mission really
    needs a mod (e.g. the briefing references a CSG-3 unit) it'll
    just fail at runtime in a more useful way.

    We replace whatever's inside with an empty table rather than
    deleting the key entirely — DCS-ME emits the key on save
    regardless, so an empty `{}` is the cleanest "no requirements"
    state and round-trips through DCS-ME without surprises.
    """
    new_block = '["requiredModules"] = {}'
    block_match = re.search(r'\["requiredModules"\]\s*=\s*\n?\s*\{', text)
    if block_match:
        block_open = block_match.end() - 1
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
                        break
            fi += 1
        text = text[:block_match.start()] + new_block + text[fi + 1:]
    # If the key is missing entirely (very old DCS missions), we
    # don't insert one — vanilla DCS treats the absence as
    # "no requirements" the same way.
    return text


def _replace_planner_hidden_groups(text: str, group_ids: list) -> str:
    """Replace the planner-private ["plannerHiddenGroups"] block.

    Persists the v0.9.25 visibility filter — group IDs the mission
    maker has marked hidden from joined flight leads. DCS itself
    ignores unknown top-level mission keys, so the slot doesn't
    affect runtime behaviour; it only round-trips through this
    planner.

    `group_ids` is a list of integer group IDs. Empty list writes
    an empty block, same convention the goals + DMPI writers use
    so the read path can rely on the block's existence as the
    "visibility was authored" signal.
    """
    valid_ids = [int(g) for g in (group_ids or []) if g is not None]

    if not valid_ids:
        new_block = '["plannerHiddenGroups"] = {}'
    else:
        # Sort + dedupe so the same set always serialises to the
        # same byte sequence — keeps the .miz diff stable when the
        # user re-saves without changes.
        unique_sorted = sorted(set(valid_ids))
        entries = [f'        [{i}] = {gid},' for i, gid in enumerate(unique_sorted, start=1)]
        inner = '\n'.join(entries)
        new_block = f'["plannerHiddenGroups"] = \n    {{\n{inner}\n    }}'

    # Replace existing or insert before mission close — same brace
    # walk pattern as `_replace_planner_dmpis`.
    block_match = re.search(r'\["plannerHiddenGroups"\]\s*=\s*\n?\s*\{', text)
    if block_match:
        block_open = block_match.end() - 1
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
                        break
            fi += 1
        text = text[:block_match.start()] + new_block + text[fi + 1:]
    else:
        insert_pattern = re.compile(r'(\n\} -- end of mission)', re.IGNORECASE)
        if insert_pattern.search(text):
            text = insert_pattern.sub(f'\n    {new_block},\\1', text)
        else:
            last_brace = text.rfind("}")
            if last_brace > 0:
                text = text[:last_brace] + f'    {new_block},\n' + text[last_brace:]

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

    # Debug log write must never break the weather edit — wrap & force utf-8.
    try:
        with open(_dbg_path, "a", encoding="utf-8") as _f:
            _f.write("\n".join(_log_lines) + "\n")
    except Exception:
        pass

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

    # Find all name fields and replace.
    # The capture is the raw Lua-escaped value; user-supplied find/replace
    # strings operate on the unescaped form (matches what the user sees in
    # the editor). Unescape → replace → re-escape so embedded `"` survives.
    if in_units or in_groups:
        name_re = re.compile(r'\["name"\]\s*=\s*"' + _LUA_STR_VALUE + r'"')
        for m in reversed(list(name_re.finditer(text))):
            old_unescaped = _lua_str_unescape(m.group(1))
            new_unescaped, changed = do_replace(old_unescaped)
            if changed:
                text = text[:m.start(1)] + _lua_str_escape(new_unescaped) + text[m.end(1):]

    return text, count


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def apply_unit_edits(text: str, edits: list) -> tuple[str, list[dict]]:
    """Apply surgical text replacements to the original mission Lua text.

    Each edit is a dict with: unitId, field, value (and sometimes groupId).
    Supported fields: voiceCallsignLabel, voiceCallsignNumber, stnL16, donors,
    teamMembers, copyLoadout, pylonChange, laserCode, groupRename, unitRename,
    livery, weather, groupTask, groupFrequency, groupModulation, skill,
    radioFrequency, onboard_num, callsign, tacan, findReplace

    Returns (modified_text, results). Each result is a dict:
      {field, status, unitId?, groupId?, reason?, textDelta?}
    where status is one of:
      - "applied": edit ran to completion and changed the text
      - "noop":    edit ran but text did not change (regex didn't match,
                   target field absent, etc.) — a likely silent failure
      - "skipped": edit raised an exception; reason contains the message
      - "invalid": edit was malformed (missing field/value)

    This surfaces silent-failure cases to the API caller so users can
    see when an edit they queued was dropped.
    """
    results: list[dict] = []
    for edit in edits:
        field = edit.get("field")
        value = edit.get("value")
        entry: dict = {"field": field or "<missing>"}
        if edit.get("unitId") is not None:
            entry["unitId"] = edit["unitId"]
        if edit.get("groupId") is not None:
            entry["groupId"] = edit["groupId"]
        if not field:
            entry["status"] = "invalid"
            entry["reason"] = "edit has no 'field' attribute"
            results.append(entry)
            continue

        text_before = text
        dispatched = True  # set to False if no branch matched
        try:
            # Mission-level edits (no unitId needed)
            if field == "forcedOptions":
                text = _replace_forced_options(text, value)
            elif field == "briefing":
                text = _replace_briefing_fields(text, value)
            elif field == "coalitionReassign":
                text = _replace_coalition_assignments(text, value)
            elif field == "weather":
                text = _replace_weather_block(text, value)
            elif field == "missionGoals":
                # `value` is the frontend MissionGoal[] payload.
                # Persists Mission Goals tab edits into .miz on download.
                text = _replace_mission_goals(text, value)
            elif field == "plannerDmpis":
                # `value` is the frontend Dmpi[] payload. Persists
                # DMPI list into a planner-private mission key on
                # download (DCS ignores unknown top-level keys).
                text = _replace_planner_dmpis(text, value)
            elif field == "plannerHiddenGroups":
                # `value` is a list of group IDs the mission maker
                # has marked hidden from flight leads (v0.9.26).
                # Stored under `["plannerHiddenGroups"]` for round-trip.
                text = _replace_planner_hidden_groups(text, value)
            elif field == "stripRequiredModules":
                # `value` is unused — presence of the edit signals
                # the user wants the requiredModules block emptied
                # so anyone can load the mission regardless of
                # installed mods. (v0.9.32)
                text = _strip_required_modules(text)
            elif field == "findReplace":
                text, _ = _find_replace_names(
                    text, value["find"], value["replace"],
                    value.get("regex", False),
                    value.get("inUnits", True), value.get("inGroups", True),
                )
            # Group-level edits
            elif field == "groupWrappedActions":
                text = _insert_group_wrapped_actions(text, edit["groupId"], value)
            elif field == "radioPresets":
                # Per-group preset write-back. value = {radio: 1,
                # channels: [{ch, freq_mhz, modulation, name}, ...]}
                radio_num = int(value.get("radio", 1))
                channels = value.get("channels", []) or []
                text = _replace_radio_presets_for_group(text, edit["groupId"], radio_num, channels)
            elif field in ("groupTask", "groupFrequency", "groupModulation"):
                lua_field = {
                    "groupTask": "task",
                    "groupFrequency": "frequency",
                    "groupModulation": "modulation",
                }[field]
                text = _replace_group_field(text, edit["groupId"], lua_field, value)
            elif field == "waypointTasks":
                # v1 vocab: "goto" | "goto_at_time". Drives ETA + ETA_locked
                # on each named waypoint of a group's route. Bundled with
                # groupRename in the TIC tab's Apply so both rename + WP
                # task changes land atomically on download. See
                # _replace_waypoint_tasks for the Lua mutation rules.
                text = _replace_waypoint_tasks(
                    text, value["groupId"], value.get("tasks", []),
                )
            # Unit-level edits
            elif field == "voiceCallsignLabel":
                text = _replace_prop_field(text, edit.get("unitId"), "VoiceCallsignLabel", value)
            elif field == "voiceCallsignNumber":
                text = _replace_prop_field(text, edit.get("unitId"), "VoiceCallsignNumber", value)
            elif field == "stnL16":
                text = _replace_prop_field(text, edit.get("unitId"), "STN_L16", value)
            elif field == "donors":
                text = _replace_donors(text, edit.get("unitId"), value)
            elif field == "teamMembers":
                text = _replace_team_members(text, edit.get("unitId"), value)
            elif field == "copyLoadout":
                text = _copy_payload_block(text, source_uid=value, target_uid=edit.get("unitId"))
            elif field == "pylonChange":
                text = _replace_pylon_clsid(text, edit.get("unitId"), value["pylon"], value["clsid"],
                                            value.get("settings"))
            elif field == "laserCode":
                text = _replace_laser_code(text, edit.get("unitId"), int(value))
            elif field == "groupRename":
                text = _rename_group_and_units(text, value["groupId"],
                                               value.get("newGroupName"),
                                               value.get("unitNames", {}))
            elif field == "unitRename":
                text = _replace_unit_name(text, edit.get("unitId"), value)
            elif field == "livery":
                text = _replace_livery(text, edit.get("unitId"), value)
            elif field == "skill":
                text = _replace_skill(text, edit.get("unitId"), value)
            elif field == "lateActivation":
                text = _replace_late_activation(text, edit.get("unitId"), bool(value))
            elif field == "heading":
                text = _replace_heading(text, edit.get("unitId"), float(value))
            elif field == "radioFrequency":
                text = _replace_radio_frequency(text, edit.get("unitId"), int(value))
            elif field == "onboard_num":
                text = _replace_onboard_num(text, edit.get("unitId"), str(value))
            elif field == "tacan":
                text = _replace_tacan_beacon(
                    text, edit.get("unitId"),
                    int(value["channel"]), str(value.get("band", "X")),
                    str(value.get("callsign", "")),
                )
            elif field == "icls":
                text = _replace_icls(text, edit.get("unitId"), int(value["channel"]))
            elif field == "callsign":
                text = _replace_callsign(
                    text, edit.get("unitId"),
                    int(value["nameIdx"]), int(value["flight"]),
                    int(value["pos"]), str(value["name"]),
                )
            elif field == "payloadReplace":
                text = _replace_payload_block(text, edit.get("unitId"), value)
            else:
                dispatched = False

            # Record outcome
            if not dispatched:
                entry["status"] = "invalid"
                entry["reason"] = f"unknown edit field: {field}"
            elif text == text_before:
                entry["status"] = "noop"
                entry["reason"] = "target field not found or value already matches"
            else:
                entry["status"] = "applied"
                entry["textDelta"] = len(text) - len(text_before)
            results.append(entry)
        except Exception as e:
            import logging, traceback
            logging.warning(
                f"Skipping edit field={field} unit={edit.get('unitId')} group={edit.get('groupId')}: "
                f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            )
            entry["status"] = "skipped"
            entry["reason"] = f"{type(e).__name__}: {e}"
            results.append(entry)

    return text, results
