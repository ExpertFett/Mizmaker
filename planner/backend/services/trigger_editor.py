"""
Trigger & Audio editor for DCS .miz files.

Parses trig/trigrules tables from mission Lua, provides structured JSON,
and supports surgical replacement of trigger blocks.
Also handles audio file management within the .miz ZIP archive.
"""

import io
import re
import zipfile
from typing import Dict, List, Any, Optional, Tuple

from services.miz_editor import _find_matching_brace, _serialize_lua_value


# ── Condition/Action function parsers ──────────────────────────────────────

# Map DCS Lua condition function names → friendly types
CONDITION_PARSERS = {
    "c_time_after":                 "TIME_MORE_THAN",
    "c_time_before":                "TIME_LESS_THAN",
    "c_flag_is_true":               "FLAG_IS_TRUE",
    "c_flag_is_false":              "FLAG_IS_FALSE",
    "c_flag_equals":                "FLAG_EQUALS",
    "c_flag_less":                  "FLAG_LESS_THAN",
    "c_flag_more":                  "FLAG_MORE_THAN",
    "c_flag_equals_flag":           "FLAG_EQUALS_FLAG",
    "c_unit_in_zone":               "UNIT_IN_ZONE",
    "c_unit_alive":                 "UNIT_ALIVE",
    "c_group_alive":                "GROUP_ALIVE",
    "c_group_dead":                 "GROUP_DEAD",
    "c_unit_in_zone_unit":          "UNIT_IN_ZONE_UNIT",
    "c_part_of_coalition_in_zone":  "COALITION_IN_ZONE",
    "c_part_of_group_in_zone":      "PART_OF_GROUP_IN_ZONE",
    "c_coalition_has_airdrome":     "COALITION_HAS_AIRDROME",
    "c_predicate":                  "LUA_PREDICATE",
    "c_random_less":                "RANDOM_LESS_THAN",
    "c_unit_hit":                   "UNIT_HIT",
    "c_missile_in_zone":            "MISSILE_IN_ZONE",
    "c_bomb_in_zone":               "BOMB_IN_ZONE",
}

# Map DCS Lua action function names → friendly types
ACTION_PARSERS = {
    "a_set_flag":                   "SET_FLAG",
    "a_clear_flag":                 "CLEAR_FLAG",
    "a_flag_increase":              "FLAG_INCREASE",
    "a_flag_decrease":              "FLAG_DECREASE",
    "a_flag_set_random":            "FLAG_SET_RANDOM",
    "a_out_text_delay":             "MESSAGE_TO_ALL",
    "a_out_text_delay_s":           "MESSAGE_TO_ALL",
    "a_out_text_delay_coalition":   "MESSAGE_TO_COALITION",
    "a_out_text_delay_group":       "MESSAGE_TO_GROUP",
    "a_out_sound":                  "SOUND_TO_ALL",
    "a_out_sound_coalition":        "SOUND_TO_COALITION",
    "a_out_sound_group":            "SOUND_TO_GROUP",
    "a_out_sound_country":          "SOUND_TO_COUNTRY",
    "a_stop_last_sound":            "STOP_SOUND",
    "a_do_script":                  "DO_SCRIPT",
    "a_do_script_file":             "DO_SCRIPT_FILE",
    "a_activate_group":             "GROUP_ACTIVATE",
    "a_deactivate_group":           "GROUP_DEACTIVATE",
    "a_ai_on":                      "AI_ON",
    "a_ai_off":                     "AI_OFF",
    "a_explosion":                  "EXPLOSION",
    "a_smoke_stop":                 "SMOKE_STOP",
    "a_add_radio_item":             "ADD_RADIO_ITEM",
    "a_remove_radio_item":          "REMOVE_RADIO_ITEM",
    "a_end_mission":                "END_MISSION",
    "a_load_mission":               "LOAD_MISSION",
    "a_set_failure":                "SET_FAILURE",
    "a_set_success":                "SET_SUCCESS",
    "a_signal_flare":               "SIGNAL_FLARE",
    "a_illumination_bomb":          "ILLUMINATION_BOMB",
    "a_smoke_marker":               "SMOKE_MARKER",
    # TIC carrier-control template predicates — used by the planner's
    # CarrierSetupPanel auto-generated trigger rules. Listed here so
    # they round-trip through the inline serializer cleanly.
    "a_ai_task":                          "AI_TASK",
    "a_set_carrier_illumination_mode":    "CARRIER_LIGHTS",
}

# Predicate → eventType mapping
PREDICATE_MAP = {
    "triggerOnce":       "once",
    "triggerContinuous": "continuous",
    "triggerStart":      "onMissionStart",
    "triggerFront":      "onMissionStart",  # close enough
}


def _parse_lua_args(arg_str: str) -> List[str]:
    """Parse comma-separated Lua function arguments, respecting strings."""
    args = []
    current = ""
    depth = 0
    in_string = False
    string_char = None

    for ch in arg_str:
        if in_string:
            current += ch
            if ch == string_char and (len(current) < 2 or current[-2] != '\\'):
                in_string = False
        elif ch in ('"', "'"):
            in_string = True
            string_char = ch
            current += ch
        elif ch == '(':
            depth += 1
            current += ch
        elif ch == ')':
            depth -= 1
            current += ch
        elif ch == ',' and depth == 0:
            args.append(current.strip())
            current = ""
        else:
            current += ch

    if current.strip():
        args.append(current.strip())
    return args


def _clean_lua_string(s: str) -> str:
    """Remove surrounding quotes from a Lua string argument."""
    s = s.strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    return s


def _parse_condition_string(lua_str: str) -> Dict[str, Any]:
    """Parse a DCS condition Lua string into structured data."""
    # Match function call: c_func_name(args...)
    m = re.match(r'return\s+(\w+)\((.*)?\)\s*$', lua_str.strip(), re.DOTALL)
    if not m:
        return {"type": "CUSTOM_LUA", "params": {"lua": lua_str}, "rawLua": lua_str}

    func_name = m.group(1)
    args_str = m.group(2) or ""
    args = _parse_lua_args(args_str)

    cond_type = CONDITION_PARSERS.get(func_name, "UNKNOWN")

    params: Dict[str, Any] = {}

    if cond_type == "TIME_MORE_THAN" and len(args) >= 1:
        params["seconds"] = int(float(args[0]))
    elif cond_type == "TIME_LESS_THAN" and len(args) >= 1:
        params["seconds"] = int(float(args[0]))
    elif cond_type in ("FLAG_IS_TRUE", "FLAG_IS_FALSE") and len(args) >= 1:
        params["flag"] = _clean_lua_string(args[0])
    elif cond_type in ("FLAG_EQUALS", "FLAG_LESS_THAN", "FLAG_MORE_THAN") and len(args) >= 2:
        params["flag"] = _clean_lua_string(args[0])
        params["value"] = int(float(args[1]))
    elif cond_type == "FLAG_EQUALS_FLAG" and len(args) >= 2:
        params["flag"] = _clean_lua_string(args[0])
        params["flag2"] = _clean_lua_string(args[1])
    elif cond_type in ("UNIT_IN_ZONE", "UNIT_IN_ZONE_UNIT") and len(args) >= 2:
        params["unit"] = _clean_lua_string(args[0])
        params["zone"] = _clean_lua_string(args[1])
    elif cond_type in ("UNIT_ALIVE", "UNIT_HIT"):
        if args:
            params["unit"] = _clean_lua_string(args[0])
    elif cond_type in ("GROUP_ALIVE", "GROUP_DEAD"):
        if args:
            params["group"] = _clean_lua_string(args[0])
    elif cond_type == "COALITION_IN_ZONE" and len(args) >= 2:
        params["coalition"] = _clean_lua_string(args[0])
        params["zone"] = _clean_lua_string(args[1])
    elif cond_type == "COALITION_HAS_AIRDROME" and len(args) >= 2:
        params["coalition"] = _clean_lua_string(args[0])
        params["airdromeId"] = int(float(args[1]))
    elif cond_type == "PART_OF_GROUP_IN_ZONE" and len(args) >= 2:
        params["group"] = _clean_lua_string(args[0])
        params["zone"] = _clean_lua_string(args[1])
    elif cond_type == "LUA_PREDICATE":
        params["lua"] = args_str.strip()
    elif cond_type == "RANDOM_LESS_THAN" and len(args) >= 1:
        params["percent"] = int(float(args[0]))
    else:
        params["rawArgs"] = args

    result = {"type": cond_type, "params": params}
    if cond_type in ("UNKNOWN", "CUSTOM_LUA"):
        result["rawLua"] = lua_str
    return result


def _parse_action_string(lua_str: str) -> Dict[str, Any]:
    """Parse a DCS action Lua string into structured data."""
    # Match function call: a_func_name(args...)
    m = re.match(r'(\w+)\((.*)?\)\s*;?\s*$', lua_str.strip(), re.DOTALL)
    if not m:
        return {"type": "CUSTOM_LUA", "params": {"lua": lua_str}, "rawLua": lua_str}

    func_name = m.group(1)
    args_str = m.group(2) or ""
    args = _parse_lua_args(args_str)

    action_type = ACTION_PARSERS.get(func_name, "UNKNOWN")

    params: Dict[str, Any] = {}

    if action_type == "SET_FLAG" and len(args) >= 2:
        params["flag"] = _clean_lua_string(args[0])
        val = args[1].strip()
        if val.lower() == "true":
            params["value"] = True
        elif val.lower() == "false":
            params["value"] = False
        else:
            try:
                params["value"] = int(float(val))
            except ValueError:
                params["value"] = val
    elif action_type == "CLEAR_FLAG" and len(args) >= 1:
        params["flag"] = _clean_lua_string(args[0])
    elif action_type in ("FLAG_INCREASE", "FLAG_DECREASE") and len(args) >= 2:
        params["flag"] = _clean_lua_string(args[0])
        params["value"] = int(float(args[1]))
    elif action_type == "FLAG_SET_RANDOM" and len(args) >= 3:
        params["flag"] = _clean_lua_string(args[0])
        params["min"] = int(float(args[1]))
        params["max"] = int(float(args[2]))
    elif action_type in ("MESSAGE_TO_ALL",) and len(args) >= 1:
        # a_out_text_delay_s(getPlayerVehicleName(), seconds, "msg", duration)
        # or simpler forms
        params["text"] = _clean_lua_string(args[-2]) if len(args) >= 3 else _clean_lua_string(args[0])
        params["duration"] = int(float(args[-1])) if len(args) >= 2 else 10
    elif action_type == "MESSAGE_TO_COALITION" and len(args) >= 3:
        params["coalition"] = _clean_lua_string(args[0])
        params["text"] = _clean_lua_string(args[1])
        params["duration"] = int(float(args[2])) if len(args) >= 3 else 10
    elif action_type in ("SOUND_TO_ALL",) and len(args) >= 1:
        params["file"] = _clean_lua_string(args[0])
    elif action_type == "SOUND_TO_COALITION" and len(args) >= 2:
        params["coalition"] = _clean_lua_string(args[0])
        params["file"] = _clean_lua_string(args[1])
    elif action_type == "SOUND_TO_GROUP" and len(args) >= 2:
        params["group"] = _clean_lua_string(args[0])
        params["file"] = _clean_lua_string(args[1])
    elif action_type == "SOUND_TO_COUNTRY" and len(args) >= 2:
        params["country"] = _clean_lua_string(args[0])
        params["file"] = _clean_lua_string(args[1])
    elif action_type == "DO_SCRIPT" and len(args) >= 1:
        params["lua"] = _clean_lua_string(args[0])
    elif action_type == "DO_SCRIPT_FILE" and len(args) >= 1:
        params["file"] = _clean_lua_string(args[0])
    elif action_type in ("GROUP_ACTIVATE", "GROUP_DEACTIVATE", "AI_ON", "AI_OFF"):
        if args:
            params["group"] = _clean_lua_string(args[0])
    elif action_type == "EXPLOSION" and len(args) >= 3:
        params["x"] = float(args[0])
        params["y"] = float(args[1])
        params["power"] = float(args[2])
    elif action_type in ("END_MISSION", "SET_FAILURE", "SET_SUCCESS", "STOP_SOUND"):
        pass  # no params
    elif action_type == "SMOKE_MARKER" and len(args) >= 3:
        params["x"] = float(args[0])
        params["y"] = float(args[1])
        params["color"] = _clean_lua_string(args[2])
    else:
        params["rawArgs"] = args

    result = {"type": action_type, "params": params}
    if action_type in ("UNKNOWN", "CUSTOM_LUA"):
        result["rawLua"] = lua_str
    return result


# ── Extraction ─────────────────────────────────────────────────────────────

def extract_triggers(mission_dict: dict) -> Dict[str, Any]:
    """
    Extract triggers from parsed mission dict into structured JSON.

    Returns {rules: [...], flags: [...]}
    """
    trig = mission_dict.get("trig", {})
    trigrules = mission_dict.get("trigrules", {})

    if not trig and not trigrules:
        return {"rules": [], "flags": []}

    # SLPP + our _normalize_slpp_keys helper converts any Lua table
    # whose keys happen to all be sequential ints starting at 1 into a
    # Python list. ["conditions"] / ["actions"] / ["flag"] / ["func"]
    # use int keys, so they often arrive here as lists. The original
    # code assumed dicts and called `.get()` on them — Fett's mission
    # had this exact shape and the GET /api/triggers call 500'd with
    # "'list' object has no attribute 'get'", which surfaced as the
    # 'Failed to add carrier trigger' alert.
    def _to_idx_dict(x):
        """Normalize SLPP list-or-dict to {int_idx: value} for .get() use."""
        if isinstance(x, dict):
            return x
        if isinstance(x, list):
            return {i + 1: v for i, v in enumerate(x) if v is not None}
        return {}

    if not isinstance(trig, dict):
        # Whole `trig` table arrived as a list — synthesize a dict by
        # picking off the named sub-blocks if they exist (rare path),
        # otherwise treat the trig data as empty.
        trig = {}

    conditions_lua = _to_idx_dict(trig.get("conditions", {}))
    actions_lua = _to_idx_dict(trig.get("actions", {}))
    flags_state = _to_idx_dict(trig.get("flag", {}))
    func_lua = _to_idx_dict(trig.get("func", {}))

    # Detect "inline" trigger format: some DCS missions store actions
    # as list-of-dicts directly inside the rule (each dict carries
    # `predicate` + params) instead of as indexes into trig.actions.
    # Our serializer only knows how to emit indexed format; if we
    # rewrote an inline-format mission we'd silently wipe every
    # rule's body. Flag this case so the SAVE endpoint can refuse
    # rather than corrupt the .miz.
    inline_format = _detect_inline_format(trigrules)

    rules = []

    # trigrules can be dict with int keys or list
    rule_items = []
    if isinstance(trigrules, dict):
        rule_items = sorted(trigrules.items(), key=lambda x: int(x[0]) if str(x[0]).isdigit() else 0)
    elif isinstance(trigrules, list):
        rule_items = list(enumerate(trigrules, 1))

    for rule_idx, rule_data in rule_items:
        if not isinstance(rule_data, dict):
            continue

        try:
            rule_id = int(rule_idx)
        except (TypeError, ValueError):
            continue

        # Parse conditions
        cond_indices = rule_data.get("conditions", {})
        parsed_conditions = []
        if isinstance(cond_indices, dict):
            flat_vals = [v for v in cond_indices.values() if isinstance(v, (int, float, str))]
            for ci in sorted(flat_vals, key=lambda x: int(x) if isinstance(x, (int, float)) else 0):
                lua_str = conditions_lua.get(int(ci), conditions_lua.get(str(ci), ""))
                if lua_str:
                    parsed_conditions.append(_parse_condition_string(str(lua_str)))
        elif isinstance(cond_indices, list):
            for ci in cond_indices:
                if not isinstance(ci, (int, float, str)):
                    continue
                lua_str = conditions_lua.get(int(ci), conditions_lua.get(str(ci), ""))
                if lua_str:
                    parsed_conditions.append(_parse_condition_string(str(lua_str)))

        # Parse actions
        act_indices = rule_data.get("actions", {})
        parsed_actions = []
        if isinstance(act_indices, dict):
            flat_vals = [v for v in act_indices.values() if isinstance(v, (int, float, str))]
            for ai in sorted(flat_vals, key=lambda x: int(x) if isinstance(x, (int, float)) else 0):
                lua_str = actions_lua.get(int(ai), actions_lua.get(str(ai), ""))
                if lua_str:
                    parsed_actions.append(_parse_action_string(str(lua_str)))
        elif isinstance(act_indices, list):
            for ai in act_indices:
                if not isinstance(ai, (int, float, str)):
                    continue
                lua_str = actions_lua.get(int(ai), actions_lua.get(str(ai), ""))
                if lua_str:
                    parsed_actions.append(_parse_action_string(str(lua_str)))

        # Determine event type
        predicate = rule_data.get("predicate", "triggerOnce")
        event_type = PREDICATE_MAP.get(predicate, "once")

        # Enabled state from trig.flag
        enabled = True
        flag_val = flags_state.get(rule_id, flags_state.get(str(rule_id)))
        if flag_val is not None:
            enabled = bool(flag_val)

        rules.append({
            "id": rule_id,
            "name": rule_data.get("comment", f"Trigger {rule_id}"),
            "enabled": enabled,
            "oneTime": event_type == "once",
            "eventType": event_type,
            "conditions": parsed_conditions,
            "actions": parsed_actions,
            "predicate": predicate,
        })

    # Extract flag references
    flags = _extract_flag_references(rules)

    return {"rules": rules, "flags": flags, "inlineFormat": inline_format}


def _detect_inline_format(trigrules) -> bool:
    """Return True if the trigrules table uses the inline action format.

    Indexed format (what our serializer emits):
      ["actions"] = { [1] = 5, [2] = 7 }     -- ints pointing at trig.actions[N]

    Inline format (DCS sometimes uses, especially older missions):
      ["actions"] = { [1] = { ["predicate"] = "a_set_flag", ... } }

    The two are incompatible; rewriting an inline mission with our
    indexed serializer empties out every rule's body.
    """
    if isinstance(trigrules, dict):
        rule_iter = trigrules.values()
    elif isinstance(trigrules, list):
        rule_iter = trigrules
    else:
        return False

    for rule in rule_iter:
        if not isinstance(rule, dict):
            continue
        actions = rule.get("actions")
        if isinstance(actions, list):
            for a in actions:
                if isinstance(a, dict):
                    return True  # inline action object found
        elif isinstance(actions, dict):
            for a in actions.values():
                if isinstance(a, dict):
                    return True
    return False


def _safe_params(item) -> Dict[str, Any]:
    """Best-effort extract a dict-shaped `params` from a condition/action.

    The trigger Lua we parse out of user-edited missions is sometimes
    shaped weirdly — third-party scripts, hand-edited triggers, mods
    can produce conditions whose params decode as a list rather than a
    dict. Without this guard, downstream code that does
    `cond.get('params', {}).get('flag')` blows up with
    "'list' object has no attribute 'get'", which is exactly what
    happened on Fett's session when he tried to add the carrier
    trigger and the GET /api/triggers call 500'd before we ever got
    to POST.
    """
    if not isinstance(item, dict):
        return {}
    p = item.get("params")
    if isinstance(p, dict):
        return p
    return {}


def _extract_flag_references(rules: List[Dict]) -> List[Dict]:
    """Scan all trigger rules and extract a deduplicated flag summary."""
    flag_map: Dict[str, Dict[str, List[str]]] = {}

    for rule in rules:
        if not isinstance(rule, dict):
            continue
        rule_name = rule.get("name", f"Trigger {rule.get('id', '?')}")
        conditions = rule.get("conditions", [])
        if not isinstance(conditions, list):
            conditions = []
        actions = rule.get("actions", [])
        if not isinstance(actions, list):
            actions = []

        for cond in conditions:
            params = _safe_params(cond)
            flag_id = params.get("flag")
            if flag_id is not None:
                flag_id = str(flag_id)
                if flag_id not in flag_map:
                    flag_map[flag_id] = {"setBy": [], "readBy": []}
                if rule_name not in flag_map[flag_id]["readBy"]:
                    flag_map[flag_id]["readBy"].append(rule_name)

            # Also check flag2 for FLAG_EQUALS_FLAG
            flag2 = params.get("flag2")
            if flag2 is not None:
                flag2 = str(flag2)
                if flag2 not in flag_map:
                    flag_map[flag2] = {"setBy": [], "readBy": []}
                if rule_name not in flag_map[flag2]["readBy"]:
                    flag_map[flag2]["readBy"].append(rule_name)

        for act in actions:
            params = _safe_params(act)
            flag_id = params.get("flag")
            if flag_id is not None:
                flag_id = str(flag_id)
                if flag_id not in flag_map:
                    flag_map[flag_id] = {"setBy": [], "readBy": []}
                if rule_name not in flag_map[flag_id]["setBy"]:
                    flag_map[flag_id]["setBy"].append(rule_name)

    return [
        {"flagId": fid, "setBy": info["setBy"], "readBy": info["readBy"]}
        for fid, info in sorted(flag_map.items())
    ]


# ── Audio file management ──────────────────────────────────────────────────

AUDIO_EXTENSIONS = {".wav", ".ogg", ".mp3"}
AUDIO_DIRS = ["l10n/DEFAULT/", "Sounds/", "sounds/"]


def list_audio_files(miz_bytes: bytes) -> List[Dict[str, Any]]:
    """List audio files inside a .miz ZIP archive."""
    if miz_bytes is None:
        return []

    audio_files = []
    try:
        with zipfile.ZipFile(io.BytesIO(miz_bytes), "r") as zf:
            for info in zf.infolist():
                name_lower = info.filename.lower()
                # Check if it's an audio file by extension
                for ext in AUDIO_EXTENSIONS:
                    if name_lower.endswith(ext):
                        audio_files.append({
                            "filename": info.filename.split("/")[-1],
                            "path": info.filename,
                            "sizeBytes": info.file_size,
                        })
                        break
    except zipfile.BadZipFile:
        pass

    return audio_files


def get_audio_bytes(miz_bytes: bytes, path: str) -> Optional[bytes]:
    """Extract audio file bytes from the .miz ZIP."""
    if miz_bytes is None:
        return None

    try:
        with zipfile.ZipFile(io.BytesIO(miz_bytes), "r") as zf:
            return zf.read(path)
    except (zipfile.BadZipFile, KeyError):
        return None


def add_audio_to_miz(miz_bytes: bytes, filename: str, audio_data: bytes) -> bytes:
    """Add an audio file to the .miz ZIP under l10n/DEFAULT/."""
    output = io.BytesIO()
    path = f"l10n/DEFAULT/{filename}"

    with zipfile.ZipFile(io.BytesIO(miz_bytes), "r") as zin:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                # Skip if we're replacing an existing file with same path
                if item.filename == path:
                    continue
                zout.writestr(item, zin.read(item.filename))
            # Add the new audio file
            zout.writestr(path, audio_data)

    return output.getvalue()


def remove_audio_from_miz(miz_bytes: bytes, path: str) -> bytes:
    """Remove an audio file from the .miz ZIP."""
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(miz_bytes), "r") as zin:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == path:
                    continue
                zout.writestr(item, zin.read(item.filename))
    return output.getvalue()


# ── Trigger serialization (write back to Lua) ─────────────────────────────

def _condition_to_lua(cond: Dict) -> str:
    """Convert a structured condition back to DCS Lua function call string."""
    ctype = cond.get("type", "CUSTOM_LUA")
    p = cond.get("params", {})
    # Defensive: malformed triggers can produce list-shaped params. Treat
    # those as empty so .get() calls below don't blow up.
    if not isinstance(p, dict):
        p = {}

    if cond.get("rawLua"):
        return cond["rawLua"]

    if ctype == "TIME_MORE_THAN":
        return f'return c_time_after({p.get("seconds", 0)})'
    if ctype == "TIME_LESS_THAN":
        return f'return c_time_before({p.get("seconds", 0)})'
    if ctype == "FLAG_IS_TRUE":
        return f'return c_flag_is_true({_lua_flag(p.get("flag", "1"))})'
    if ctype == "FLAG_IS_FALSE":
        return f'return c_flag_is_false({_lua_flag(p.get("flag", "1"))})'
    if ctype == "FLAG_EQUALS":
        return f'return c_flag_equals({_lua_flag(p.get("flag", "1"))}, {p.get("value", 0)})'
    if ctype == "FLAG_LESS_THAN":
        return f'return c_flag_less({_lua_flag(p.get("flag", "1"))}, {p.get("value", 0)})'
    if ctype == "FLAG_MORE_THAN":
        return f'return c_flag_more({_lua_flag(p.get("flag", "1"))}, {p.get("value", 0)})'
    if ctype == "FLAG_EQUALS_FLAG":
        return f'return c_flag_equals_flag({_lua_flag(p.get("flag", "1"))}, {_lua_flag(p.get("flag2", "2"))})'
    if ctype == "UNIT_IN_ZONE":
        return f'return c_unit_in_zone("{p.get("unit", "")}", "{p.get("zone", "")}")'
    if ctype == "UNIT_ALIVE":
        return f'return c_unit_alive("{p.get("unit", "")}")'
    if ctype == "GROUP_ALIVE":
        return f'return c_group_alive("{p.get("group", "")}")'
    if ctype == "GROUP_DEAD":
        return f'return c_group_dead("{p.get("group", "")}")'
    if ctype == "COALITION_IN_ZONE":
        return f'return c_part_of_coalition_in_zone("{p.get("coalition", "")}", "{p.get("zone", "")}")'
    if ctype == "PART_OF_GROUP_IN_ZONE":
        return f'return c_part_of_group_in_zone("{p.get("group", "")}", "{p.get("zone", "")}")'
    if ctype == "COALITION_HAS_AIRDROME":
        return f'return c_coalition_has_airdrome("{p.get("coalition", "")}", {p.get("airdromeId", 0)})'
    if ctype == "RANDOM_LESS_THAN":
        return f'return c_random_less({p.get("percent", 50)})'
    if ctype == "LUA_PREDICATE":
        return f'return c_predicate({p.get("lua", "")})'
    if ctype == "CUSTOM_LUA":
        return p.get("lua", "")

    return f'return c_flag_is_true(1)  -- unknown condition type: {ctype}'


def _action_to_lua(act: Dict) -> str:
    """Convert a structured action back to DCS Lua function call string."""
    atype = act.get("type", "CUSTOM_LUA")
    p = act.get("params", {})
    # Defensive: malformed triggers can produce list-shaped params. Treat
    # those as empty so .get() calls below don't blow up.
    if not isinstance(p, dict):
        p = {}

    if act.get("rawLua"):
        return act["rawLua"]

    if atype == "SET_FLAG":
        val = p.get("value", True)
        if isinstance(val, bool):
            val = "true" if val else "false"
        return f'a_set_flag({_lua_flag(p.get("flag", "1"))}, {val})'
    if atype == "CLEAR_FLAG":
        return f'a_clear_flag({_lua_flag(p.get("flag", "1"))})'
    if atype == "FLAG_INCREASE":
        return f'a_flag_increase({_lua_flag(p.get("flag", "1"))}, {p.get("value", 1)})'
    if atype == "FLAG_DECREASE":
        return f'a_flag_decrease({_lua_flag(p.get("flag", "1"))}, {p.get("value", 1)})'
    if atype == "FLAG_SET_RANDOM":
        return f'a_flag_set_random({_lua_flag(p.get("flag", "1"))}, {p.get("min", 0)}, {p.get("max", 100)})'
    if atype == "MESSAGE_TO_ALL":
        text = p.get("text", "").replace('"', '\\"')
        return f'a_out_text_delay_s(getPlayerVehicleName(), {p.get("duration", 10)}, "{text}", {p.get("duration", 10)})'
    if atype == "MESSAGE_TO_COALITION":
        text = p.get("text", "").replace('"', '\\"')
        return f'a_out_text_delay_coalition("{p.get("coalition", "blue")}", {p.get("duration", 10)}, "{text}", {p.get("duration", 10)})'
    if atype == "MESSAGE_TO_GROUP":
        text = p.get("text", "").replace('"', '\\"')
        return f'a_out_text_delay_group("{p.get("group", "")}", {p.get("duration", 10)}, "{text}", {p.get("duration", 10)})'
    if atype == "SOUND_TO_ALL":
        return f'a_out_sound("{p.get("file", "")}")'
    if atype == "SOUND_TO_COALITION":
        return f'a_out_sound_coalition("{p.get("coalition", "blue")}", "{p.get("file", "")}")'
    if atype == "SOUND_TO_GROUP":
        return f'a_out_sound_group("{p.get("group", "")}", "{p.get("file", "")}")'
    if atype == "SOUND_TO_COUNTRY":
        return f'a_out_sound_country("{p.get("country", "")}", "{p.get("file", "")}")'
    if atype == "STOP_SOUND":
        return 'a_stop_last_sound()'
    if atype == "DO_SCRIPT":
        lua = p.get("lua", "")
        # Escape special characters so the Lua string literal stays on one line
        lua = lua.replace('\\', '\\\\')   # backslashes first
        lua = lua.replace('"', '\\"')      # double quotes
        lua = lua.replace('\n', '\\n')     # newlines
        lua = lua.replace('\r', '\\r')     # carriage returns
        return f'a_do_script("{lua}")'
    if atype == "DO_SCRIPT_FILE":
        return f'a_do_script_file("{p.get("file", "")}")'
    if atype in ("GROUP_ACTIVATE", "GROUP_DEACTIVATE", "AI_ON", "AI_OFF"):
        func = {
            "GROUP_ACTIVATE": "a_activate_group",
            "GROUP_DEACTIVATE": "a_deactivate_group",
            "AI_ON": "a_ai_on",
            "AI_OFF": "a_ai_off",
        }[atype]
        return f'{func}("{p.get("group", "")}")'
    if atype == "EXPLOSION":
        return f'a_explosion({p.get("x", 0)}, {p.get("y", 0)}, {p.get("power", 100)})'
    if atype == "SMOKE_MARKER":
        return f'a_smoke_marker({p.get("x", 0)}, {p.get("y", 0)}, "{p.get("color", "red")}")'
    if atype == "END_MISSION":
        return 'a_end_mission()'
    if atype == "SET_FAILURE":
        return 'a_set_failure()'
    if atype == "SET_SUCCESS":
        return 'a_set_success()'
    if atype == "CUSTOM_LUA":
        return p.get("lua", "")

    return f'-- unknown action type: {atype}'


def _lua_flag(flag_id) -> str:
    """Format a flag ID for Lua — numeric IDs are bare, string names are quoted."""
    flag_id = str(flag_id)
    try:
        int(flag_id)
        return flag_id
    except ValueError:
        return f'"{flag_id}"'


def serialize_triggers_to_lua(trigger_data: Dict, indent: str = "\t") -> Tuple[str, str]:
    """
    Convert structured trigger JSON back to trig + trigrules Lua blocks.

    Returns (trig_lua, trigrules_lua) as strings ready to insert into mission text.
    """
    rules = trigger_data.get("rules", [])

    # Build indexed condition/action tables
    conditions_lua = {}
    actions_lua = {}
    flags_lua = {}
    func_lua = {}
    trigrules_lua = {}

    cond_idx = 1
    act_idx = 1

    for rule in rules:
        if not isinstance(rule, dict):
            continue
        rule_id = rule.get("id")
        if rule_id is None:
            continue

        # Map this rule's conditions to global indices. Coerce non-dict
        # entries to empty so we don't blow up on malformed triggers.
        rule_cond_indices = {}
        rule_conditions = rule.get("conditions", [])
        if not isinstance(rule_conditions, list):
            rule_conditions = []
        for i, cond in enumerate(rule_conditions, 1):
            if not isinstance(cond, dict):
                continue
            conditions_lua[cond_idx] = _condition_to_lua(cond)
            rule_cond_indices[i] = cond_idx
            cond_idx += 1

        # Map this rule's actions to global indices
        rule_act_indices = {}
        rule_actions = rule.get("actions", [])
        if not isinstance(rule_actions, list):
            rule_actions = []
        for i, act in enumerate(rule_actions, 1):
            if not isinstance(act, dict):
                continue
            actions_lua[act_idx] = _action_to_lua(act)
            rule_act_indices[i] = act_idx
            act_idx += 1

        # Build func entry (wraps conditions in if/then)
        cond_checks = " and ".join(
            f"condition({ci})" for ci in sorted(rule_cond_indices.values())
        )
        act_calls = "; ".join(
            f"action({ai})" for ai in sorted(rule_act_indices.values())
        )
        func_lua[rule_id] = f"if {cond_checks or 'true'} then {act_calls}; end"

        # Enabled flag
        flags_lua[rule_id] = rule.get("enabled", True)

        # Predicate
        predicate = rule.get("predicate", "triggerOnce")
        if rule.get("eventType") == "continuous":
            predicate = "triggerContinuous"
        elif rule.get("eventType") == "onMissionStart":
            predicate = "triggerStart"
        elif rule.get("eventType") == "once":
            predicate = "triggerOnce"

        trigrules_lua[rule_id] = {
            "conditions": rule_cond_indices,
            "actions": rule_act_indices,
            "comment": rule.get("name", f"Trigger {rule_id}"),
            "eventlist": "",
            "predicate": predicate,
        }

    # Build trig table
    trig_dict = {
        "actions": conditions_lua and actions_lua or {},
        "conditions": conditions_lua,
        "func": func_lua,
        "flag": flags_lua,
        "funcStartup": {},
        "events": {},
        "customStartup": {},
    }
    # Fix: actions should be actions_lua
    trig_dict["actions"] = actions_lua

    trig_str = f'{indent}["trig"] = {_serialize_lua_value(trig_dict, indent)},'
    trigrules_str = f'{indent}["trigrules"] = {_serialize_lua_value(trigrules_lua, indent)},'

    return trig_str, trigrules_str


def update_triggers_in_mission(mission_text: str, trigger_data: Dict) -> str:
    """
    Replace the trig and trigrules blocks in mission Lua text.

    Uses surgical text replacement via brace-matching.
    """
    # Find and replace ["trig"] block
    mission_text = _replace_lua_block(mission_text, "trig", trigger_data, is_trig=True)
    # Find and replace ["trigrules"] block
    mission_text = _replace_lua_block(mission_text, "trigrules", trigger_data, is_trig=False)

    return mission_text


# ── Inline-format append path ───────────────────────────────────────────────
#
# Some DCS missions use an "inline" trigger format where each rule's
# conditions and actions are stored as dicts inside the rule itself, not
# as indexes into trig.conditions / trig.actions:
#
#   [N] = {
#     ["rules"]   = { [1] = {["predicate"]="c_time_after", ["seconds"]=2} },
#     ["actions"] = { [1] = {["predicate"]="a_do_script_file", ["file"]="..."} },
#     ["comment"] = "...",
#     ["predicate"] = "triggerFront",
#   }
#
# Our serializer above only emits indexed format. For inline missions we
# instead surgically APPEND new rules at the end of the trigrules block,
# leaving the original rules byte-for-byte untouched.

# Reverse maps: structured action/condition type → DCS predicate function name
ACTION_TYPE_TO_PREDICATE = {v: k for k, v in ACTION_PARSERS.items()}
CONDITION_TYPE_TO_PREDICATE = {v: k for k, v in CONDITION_PARSERS.items()}

# Each known action type → the param key DCS uses for the body of that
# action in inline format. Most actions take a single primary param.
ACTION_PARAM_KEYS = {
    "DO_SCRIPT":         "text",
    "DO_SCRIPT_FILE":    "file",
    "SET_FLAG":          "flag",       # also "value"
    "CLEAR_FLAG":        "flag",
    "MESSAGE_TO_ALL":    "text",       # also "seconds"
}


def _lua_render_value(v) -> str:
    """Render a Python scalar / dict / list as inline Lua text (no
    leading indent, no trailing comma — caller handles those)."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "nil"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        esc = v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r")
        return f'"{esc}"'
    if isinstance(v, dict):
        parts = ["{"]
        for k, val in v.items():
            key_str = f'["{k}"]' if isinstance(k, str) else f'[{k}]'
            parts.append(f'  {key_str} = {_lua_render_value(val)},')
        parts.append("}")
        return "\n".join(parts)
    if isinstance(v, list):
        parts = ["{"]
        for i, val in enumerate(v, 1):
            parts.append(f'  [{i}] = {_lua_render_value(val)},')
        parts.append("}")
        return "\n".join(parts)
    return f'"{v}"'


def _render_inline_action(act: Dict, indent: str = "\t\t\t\t\t") -> str:
    """Render a structured action dict as an inline-format action entry.

    Returns just the body (without the outer `[N] = ` and trailing comma)
    — caller wraps with the index.
    """
    atype = act.get("type", "CUSTOM_LUA")
    params = act.get("params", {}) if isinstance(act.get("params"), dict) else {}
    predicate = ACTION_TYPE_TO_PREDICATE.get(atype)

    inner = indent + "\t"
    lines = ["{"]

    if predicate:
        # Map the structured param keys → DCS inline param keys.
        # Most actions just have a single primary key plus optional extras.
        if atype == "DO_SCRIPT":
            lines.append(f'{inner}["text"] = {_lua_render_value(params.get("lua", ""))},')
        elif atype == "DO_SCRIPT_FILE":
            lines.append(f'{inner}["file"] = {_lua_render_value(params.get("file", ""))},')
        elif atype == "SET_FLAG":
            lines.append(f'{inner}["flag"] = {_lua_render_value(str(params.get("flag", "1")))},')
            v = params.get("value", True)
            lines.append(f'{inner}["value"] = {_lua_render_value(v)},')
        elif atype == "CLEAR_FLAG":
            lines.append(f'{inner}["flag"] = {_lua_render_value(str(params.get("flag", "1")))},')
        elif atype == "MESSAGE_TO_ALL":
            lines.append(f'{inner}["text"] = {_lua_render_value(params.get("text", ""))},')
            lines.append(f'{inner}["seconds"] = {int(params.get("duration", 10))},')
        else:
            # Generic: dump every param key/value as-is.
            for pk, pv in params.items():
                lines.append(f'{inner}["{pk}"] = {_lua_render_value(pv)},')
        lines.append(f'{inner}["predicate"] = "{predicate}",')
    else:
        # Unknown action type: fall back to raw Lua via DO_SCRIPT.
        raw = act.get("rawLua") or params.get("lua", "")
        lines.append(f'{inner}["text"] = {_lua_render_value(raw)},')
        lines.append(f'{inner}["predicate"] = "a_do_script",')

    lines.append(f'{indent}}}')
    return "\n".join(lines)


def _render_inline_condition(cond: Dict, indent: str = "\t\t\t\t\t") -> str:
    """Render a structured condition dict as inline-format condition entry.

    Generic strategy: render every params key/value as-is, then append
    the predicate. The TIC-style conditions carry several optional
    Mission-Editor metadata fields (coalitionlist, zone, value) that
    callers can pass through verbatim.
    """
    ctype = cond.get("type", "CUSTOM_LUA")
    params = cond.get("params", {}) if isinstance(cond.get("params"), dict) else {}
    predicate = CONDITION_TYPE_TO_PREDICATE.get(ctype)

    inner = indent + "\t"
    lines = ["{"]

    if predicate:
        # Stringify flag IDs: DCS stores them as Lua strings.
        normalized = dict(params)
        if "flag" in normalized:
            normalized["flag"] = str(normalized["flag"])
        if "flag2" in normalized:
            normalized["flag2"] = str(normalized["flag2"])
        for pk, pv in normalized.items():
            lines.append(f'{inner}["{pk}"] = {_lua_render_value(pv)},')
        lines.append(f'{inner}["predicate"] = "{predicate}",')
    else:
        # Always-true sentinel
        lines.append(f'{inner}["predicate"] = "c_time_after",')
        lines.append(f'{inner}["seconds"] = 0,')

    lines.append(f'{indent}}}')
    return "\n".join(lines)


def _render_inline_rule(rule: Dict, rule_id: int, indent: str = "\t\t") -> str:
    """Render a full rule entry in inline format.

    Returns the `[N] = { ... }, -- end of [N]` text ready for splicing
    into the trigrules block.
    """
    inner = indent + "\t"
    field = inner + "\t"

    # Predicate (fire trigger event type)
    predicate = rule.get("predicate") or {
        "once": "triggerOnce",
        "continuous": "triggerContinuous",
        "onMissionStart": "triggerStart",
    }.get(rule.get("eventType", "once"), "triggerOnce")

    conditions = rule.get("conditions", []) or []
    actions = rule.get("actions", []) or []

    lines = []
    lines.append(f'{indent}[{rule_id}] =')
    lines.append(f'{indent}{{')

    # Conditions go under ["rules"] in inline format
    if conditions:
        lines.append(f'{inner}["rules"] =')
        lines.append(f'{inner}{{')
        for i, c in enumerate(conditions, 1):
            body = _render_inline_condition(c, field)
            lines.append(f'{field}[{i}] = {body},')
        lines.append(f'{inner}}}, -- end of ["rules"]')
    else:
        lines.append(f'{inner}["rules"] = {{}},')

    lines.append(f'{inner}["comment"] = {_lua_render_value(rule.get("name", f"Trigger {rule_id}"))},')
    lines.append(f'{inner}["eventlist"] = "",')
    lines.append(f'{inner}["predicate"] = "{predicate}",')

    if actions:
        lines.append(f'{inner}["actions"] =')
        lines.append(f'{inner}{{')
        for i, a in enumerate(actions, 1):
            body = _render_inline_action(a, field)
            lines.append(f'{field}[{i}] = {body},')
        lines.append(f'{inner}}}, -- end of ["actions"]')
    else:
        lines.append(f'{inner}["actions"] = {{}},')

    lines.append(f'{indent}}}, -- end of [{rule_id}]')
    return "\n".join(lines)


def _max_existing_rule_id(text: str) -> int:
    """Scan the trigrules block and return the highest existing rule id."""
    m = re.search(r'\["trigrules"\]\s*=\s*\n?\s*\{', text)
    if not m:
        return 0
    open_pos = text.index('{', m.start())
    depth = 1
    i = open_pos + 1
    while i < len(text) and depth > 0:
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
        i += 1
    block = text[open_pos:i]
    # Top-level rule indexes have indentation level matching the trigrules
    # body — but a simpler heuristic: any `[N] =` at depth 1 inside the
    # trigrules block. We approximate by scanning for `[\d+] =\n\t+{` which
    # only matches actual rule entries, not nested condition/action ids.
    max_id = 0
    cs_depth = 0
    cs_i = 0
    while cs_i < len(block):
        ch = block[cs_i]
        if ch == '{':
            cs_depth += 1
        elif ch == '}':
            cs_depth -= 1
        elif ch == '[' and cs_depth == 1:
            idx_m = re.match(r'\[(\d+)\]\s*=', block[cs_i:])
            if idx_m:
                max_id = max(max_id, int(idx_m.group(1)))
        cs_i += 1
    return max_id


def append_inline_rules(mission_text: str, new_rules: List[Dict]) -> str:
    """Insert new rules in inline format at the end of the trigrules block.

    Skips rules that already exist (by name). Each new rule is given an
    id one greater than the current max.
    """
    if not new_rules:
        return mission_text

    m = re.search(r'\["trigrules"\]\s*=\s*\n?\s*\{', mission_text)
    if not m:
        return mission_text

    open_pos = mission_text.index('{', m.start())
    depth = 1
    i = open_pos + 1
    while i < len(mission_text) and depth > 0:
        if mission_text[i] == '{':
            depth += 1
        elif mission_text[i] == '}':
            depth -= 1
        i += 1
    close_pos = i - 1  # position of the closing `}` of trigrules

    # Collect existing rule comments so we can skip duplicates by name.
    # Normalize whitespace + case so 'Activate  CVN TACAN' (double space —
    # observed in Fett's TIC template) matches our generated 'Activate
    # CVN TACAN' (single space) and we don't ship duplicate trigger
    # rules that fire identical actions on the same flag.
    def _normalize(name: str) -> str:
        return re.sub(r'\s+', ' ', name or '').strip().lower()

    block = mission_text[open_pos:close_pos + 1]
    existing_names = {
        _normalize(n) for n in re.findall(r'\["comment"\]\s*=\s*"([^"]*)"', block)
    }

    next_id = _max_existing_rule_id(mission_text) + 1
    pieces: List[str] = []
    for rule in new_rules:
        if _normalize(rule.get("name", "")) in existing_names:
            continue  # skip duplicate by name (whitespace-tolerant)
        pieces.append(_render_inline_rule(rule, next_id, indent="\t\t"))
        next_id += 1

    if not pieces:
        return mission_text  # nothing new to add

    insertion = "\n" + "\n".join(pieces)
    # Inject before the closing `}` of trigrules. Find the start of the
    # line containing close_pos so we land cleanly above it.
    line_start = mission_text.rfind("\n", 0, close_pos)
    if line_start < 0:
        line_start = close_pos
    return mission_text[:line_start] + insertion + mission_text[line_start:]


def _replace_lua_block(text: str, key: str, trigger_data: Dict, is_trig: bool) -> str:
    """Find and replace a top-level Lua table block by key name."""
    # Pattern to match ["key"] = {
    pattern = rf'\["{key}"\]\s*=\s*\n?\s*\{{'
    m = re.search(pattern, text)

    if not m:
        # Block doesn't exist — insert before the closing } of mission table
        trig_str, trigrules_str = serialize_triggers_to_lua(trigger_data, "\t")
        insert_str = trig_str if is_trig else trigrules_str

        # Find the last } in the file (closing of mission = { ... })
        last_brace = text.rfind("}")
        if last_brace > 0:
            return text[:last_brace] + insert_str + "\n" + text[last_brace:]
        return text

    # Find the { and its matching }
    open_pos = m.end() - 1
    close_pos = _find_matching_brace(text, open_pos)

    # Include the ["key"] = prefix and trailing comma
    block_start = m.start()
    trailing = text[close_pos:close_pos + 20]
    trail_m = re.match(r'\s*,?\s*', trailing)
    block_end = close_pos + (trail_m.end() if trail_m else 0)

    # Generate new Lua
    trig_str, trigrules_str = serialize_triggers_to_lua(trigger_data, "\t")
    new_block = trig_str if is_trig else trigrules_str

    return text[:block_start] + new_block + text[block_end:]
