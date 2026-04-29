"""
Surgical .miz Lua editor — hierarchy-based group targeting.

Navigates coalition → country → category → group[N] by brace-matching.
Finds groups by their depth-1 ["name"] field. No groupId searching.
Replaces the entire ["points"] block within the matched group.
"""

import io
import os
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
               kneeboards: list = None, new_dictionary_text: str | None = None,
               new_options_text: str | None = None) -> bytes:
    """Repack a .miz archive with the edited mission text and optional kneeboards.

    kneeboards: list of dicts with keys:
        aircraft_type: str  (e.g. "FA-18C_hornet")
        filename: str       (e.g. "Bengal_1_Route.png")
        data: bytes         (raw PNG bytes)
    new_dictionary_text: if provided, overwrites l10n/DEFAULT/dictionary. Used
        for briefing-text edits (DCS stores user-facing strings there via
        DictKey_* references from the mission file).
    new_options_text: if provided, overwrites the `options` file. Used for
        forcedOptions edits (DCS ME displays these from options/difficulty).

    Side effect: scans the new mission text for `a_do_script_file("name.lua")`
    references and auto-embeds matching files from the planner's bundled
    script library (planner/backend/assets/scripts/) into the .miz at
    `l10n/DEFAULT/<name>`. Without this, MOOSE / AEGIS / TIC / carrier-control
    triggers the planner generates would silently fail when the user opens the
    mission, because DO_SCRIPT_FILE looks up the file inside the .miz ZIP.
    """
    # Resolve the set of bundled script files we'd embed if the mission
    # references them. Build the lookup once; missing references are no-ops.
    script_assets = _bundled_script_assets()
    referenced = _scan_script_file_references(new_mission_text)
    auto_embed = {fname: script_assets[fname] for fname in referenced if fname in script_assets}

    output = io.BytesIO()
    embedded_paths: set[str] = set()
    with zipfile.ZipFile(io.BytesIO(original_miz_bytes), "r") as zin:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == "mission":
                    zout.writestr(item, new_mission_text.encode("utf-8"))
                elif new_dictionary_text is not None and item.filename == "l10n/DEFAULT/dictionary":
                    zout.writestr(item, new_dictionary_text.encode("utf-8"))
                elif new_options_text is not None and item.filename == "options":
                    zout.writestr(item, new_options_text.encode("utf-8"))
                else:
                    # If the .miz already ships a file we'd auto-embed, prefer
                    # the user's existing copy — they may have edited it.
                    base = item.filename.rsplit("/", 1)[-1]
                    if base in auto_embed and item.filename.startswith("l10n/DEFAULT/"):
                        embedded_paths.add(base)
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

            # Auto-embed any referenced script files the mission lacks.
            for fname, data in auto_embed.items():
                if fname in embedded_paths:
                    continue  # user's own copy wins
                zout.writestr(f"l10n/DEFAULT/{fname}", data)
    return output.getvalue()


# ── Bundled script library (Moose, TIC, AEGIS, carrier-control, …) ──────────
#
# Triggers the planner generates often reference DO_SCRIPT_FILE("Moose_.lua")
# or similar. For those references to resolve at mission load time, the
# referenced files have to live inside the .miz ZIP at
# l10n/DEFAULT/<filename>. We ship canonical copies in
# planner/backend/assets/scripts/ and embed them automatically.

_SCRIPT_ASSET_CACHE: dict[str, bytes] | None = None


def _bundled_script_assets() -> dict[str, bytes]:
    """Lazy-loaded dict of {filename: bytes} for bundled scripts."""
    global _SCRIPT_ASSET_CACHE
    if _SCRIPT_ASSET_CACHE is not None:
        return _SCRIPT_ASSET_CACHE

    cache: dict[str, bytes] = {}
    here = os.path.dirname(os.path.abspath(__file__))
    asset_dir = os.path.join(here, "..", "assets", "scripts")
    if os.path.isdir(asset_dir):
        for name in os.listdir(asset_dir):
            if not name.endswith(".lua"):
                continue
            full = os.path.join(asset_dir, name)
            try:
                with open(full, "rb") as f:
                    cache[name] = f.read()
            except OSError:
                continue
    _SCRIPT_ASSET_CACHE = cache
    return cache


def _scan_script_file_references(mission_text: str) -> set[str]:
    """Collect every filename referenced by a_do_script_file actions.

    Both rendering shapes are picked up:
      - inline:  ["predicate"] = "a_do_script_file", ["file"] = "Moose_.lua"
      - indexed: a_do_script_file("Moose_.lua")  (in trig.actions[N])
    """
    import re as _re
    refs: set[str] = set()
    # Indexed: bare function call as a string in trig.actions
    for m in _re.finditer(r'a_do_script_file\s*\(\s*"([^"]+)"\s*\)', mission_text):
        refs.add(m.group(1))
    # Inline: ["file"] = "..." inside an a_do_script_file action block.
    # Match "file" key followed (within ~200 chars) by predicate=a_do_script_file
    # OR vice versa. Simpler: any ["file"] = "<name>.lua" near the predicate.
    for m in _re.finditer(
        r'\["file"\]\s*=\s*"([^"]+\.lua)"[^}]*?\["predicate"\]\s*=\s*"a_do_script_file"',
        mission_text,
        flags=_re.DOTALL,
    ):
        refs.add(m.group(1))
    for m in _re.finditer(
        r'\["predicate"\]\s*=\s*"a_do_script_file"[^}]*?\["file"\]\s*=\s*"([^"]+\.lua)"',
        mission_text,
        flags=_re.DOTALL,
    ):
        refs.add(m.group(1))
    # Strip directory prefixes (DCS stores bare filenames in l10n/DEFAULT)
    return {r.rsplit("/", 1)[-1] for r in refs}


def _escape_lua_string(s: str) -> str:
    """Escape a string for safe insertion inside Lua double-quoted literals."""
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\r\n', '\n').replace('\n', '\\\n')


def apply_briefing_edits_to_dictionary(
    mission_text: str, dictionary_text: str, edits: list,
) -> str:
    """Rewrite the DCS dictionary file to reflect briefing edits.

    DCS stores user-facing briefing strings in ``l10n/DEFAULT/dictionary`` with
    keys like ``["DictKey_sortie_5"] = "actual text"``, and the mission file
    only holds the DictKey reference. Replacing the mission-file reference
    alone doesn't change what the player sees in DCS, so we need to update
    the dictionary entry instead.

    For each briefing edit, resolve the DictKey from the mission file and
    replace the matching entry in the dictionary. Missing DictKey references
    or entries are silently skipped.
    """
    import re as _re

    # field -> lua key in mission
    field_to_mission_key = {
        "sortie": "sortie",
        "description": "descriptionText",
        "descriptionBlueTask": "descriptionBlueTask",
        "descriptionRedTask": "descriptionRedTask",
    }

    # Collect the LAST briefing edit's values (later edits override earlier)
    briefing_values: dict = {}
    for edit in edits:
        if edit.get("field") != "briefing":
            continue
        val = edit.get("value") or {}
        briefing_values.update({k: v for k, v in val.items() if k in field_to_mission_key})

    if not briefing_values:
        return dictionary_text

    for field, new_val in briefing_values.items():
        mission_key = field_to_mission_key[field]
        # Find the DictKey reference in the mission file:
        # ["sortie"] = "DictKey_sortie_5"
        m = _re.search(rf'\["{mission_key}"\]\s*=\s*"(DictKey_[^"]+)"', mission_text)
        if not m:
            # Mission file has literal text (no DictKey); apply_unit_edits
            # already handled it — no dictionary update needed.
            continue
        dict_key = m.group(1)

        # The frontend may have already escaped \n into "\\n" (Lua-form). DCS
        # dictionaries, however, are written as raw Lua string literals with
        # literal backslash-newline for multi-line. We normalize to a list of
        # Python-level \n then re-escape for Lua.
        raw_value = str(new_val).replace('\\n', '\n')
        escaped = _escape_lua_string(raw_value)

        # Replace: ["DictKey_..."] = "..."
        key_pattern = _re.compile(
            rf'(\["{_re.escape(dict_key)}"\]\s*=\s*)"((?:\\.|[^"\\])*)"',
            _re.DOTALL,
        )
        replacement = rf'\g<1>"{escaped}"'
        new_dict_text, n = key_pattern.subn(replacement, dictionary_text, count=1)
        if n == 0:
            # Dictionary entry missing — append one inside the closing brace
            closing = _re.search(r'\}\s*--\s*end of dictionary\s*$', dictionary_text)
            if not closing:
                closing = _re.search(r'\}\s*$', dictionary_text)
            if closing:
                insertion = f'\t["{dict_key}"] = "{escaped}",\n'
                new_dict_text = dictionary_text[:closing.start()] + insertion + dictionary_text[closing.start():]
        dictionary_text = new_dict_text

    return dictionary_text


def extract_dictionary_from_miz(miz_bytes: bytes) -> str | None:
    """Read the l10n/DEFAULT/dictionary text from a .miz. Returns None if absent."""
    with zipfile.ZipFile(io.BytesIO(miz_bytes), "r") as zf:
        try:
            return zf.read("l10n/DEFAULT/dictionary").decode("utf-8")
        except KeyError:
            return None


def extract_options_from_miz(miz_bytes: bytes) -> str | None:
    """Read the options text from a .miz. Returns None if absent."""
    with zipfile.ZipFile(io.BytesIO(miz_bytes), "r") as zf:
        try:
            return zf.read("options").decode("utf-8")
        except KeyError:
            return None


# Whitelist of forcedOptions fields to mirror into options/difficulty.
# NOT listed: "birds" (bool in forcedOptions vs int count in difficulty),
# "optionsViewExtended" (complex nested, not in difficulty), "civTraffic"
# (sometimes enum int in forcedOptions vs string in difficulty).
_DIFFICULTY_SYNCABLE_KEYS = {
    # plain booleans
    "padlock", "permitCrash", "immortal", "fuel", "miniHUD",
    "easyFlight", "externalViews", "userMarks", "wakeTurbulence",
    "accidental_failures", "RBDAI", "easyRadar",
    # enums — only mirrored if existing difficulty value has matching type
    "labels", "geffect", "optionsView",
}

# forcedOptions field name → options/difficulty field name (rename cases only).
_FORCED_TO_DIFFICULTY_RENAMES = {
    "easyComms": "easyCommunication",
}


def _lua_literal_kind(lua_literal: str) -> str:
    """Classify a captured Lua RHS literal as 'bool', 'int', 'float', 'string', or 'other'."""
    s = lua_literal.strip().rstrip(',')
    if s in ("true", "false"):
        return "bool"
    if s.startswith('"') and s.endswith('"'):
        return "string"
    try:
        int(s)
        return "int"
    except ValueError:
        pass
    try:
        float(s)
        return "float"
    except ValueError:
        pass
    return "other"


def apply_forced_options_to_options_file(options_text: str, forced_options: dict) -> str:
    """Sync forcedOptions values into the `options` file's ["difficulty"] block.

    DCS ME reads flags from options/difficulty for display. We write into each
    matching key but only if the value type matches the existing difficulty
    entry — this prevents corrupting enum fields (e.g. older missions store
    geffect as a string "realistic", newer ones as an int).
    """
    import re as _re

    diff_match = _re.search(r'\["difficulty"\]\s*=\s*\n?\s*\{', options_text)
    if not diff_match:
        return options_text

    # Brace-match the difficulty block
    brace_start = options_text.index('{', diff_match.start())
    depth = 1
    i = brace_start + 1
    while i < len(options_text) and depth > 0:
        ch = options_text[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        i += 1
    diff_end = i

    diff_text = options_text[brace_start:diff_end]
    new_diff_text = diff_text

    for fo_key, value in forced_options.items():
        is_rename = fo_key in _FORCED_TO_DIFFICULTY_RENAMES
        if not is_rename and fo_key not in _DIFFICULTY_SYNCABLE_KEYS:
            continue
        if isinstance(value, (list, dict)):
            continue

        diff_key = _FORCED_TO_DIFFICULTY_RENAMES.get(fo_key, fo_key)

        pat = _re.compile(rf'(\["{_re.escape(diff_key)}"\]\s*=\s*)([^,\n]+)')
        m = pat.search(new_diff_text)
        if not m:
            continue

        existing_kind = _lua_literal_kind(m.group(2))

        # Determine incoming value's Lua kind
        if isinstance(value, bool):
            incoming_kind, lua_val = "bool", ("true" if value else "false")
        elif isinstance(value, int):
            incoming_kind, lua_val = "int", str(value)
        elif isinstance(value, float):
            incoming_kind = "float"
            lua_val = str(int(value)) if value == int(value) else str(value)
        elif isinstance(value, str):
            incoming_kind, lua_val = "string", f'"{value}"'
        else:
            continue

        # Only overwrite if the type matches — otherwise we'd corrupt the
        # difficulty block (e.g. writing int 2 where "realistic" is expected).
        # Allow int<->float crossover since Lua doesn't distinguish.
        kinds_match = (
            existing_kind == incoming_kind or
            (existing_kind in ("int", "float") and incoming_kind in ("int", "float"))
        )
        if not kinds_match:
            continue

        new_diff_text = new_diff_text[:m.start(2)] + lua_val + new_diff_text[m.end(2):]

    return options_text[:brace_start] + new_diff_text + options_text[diff_end:]
