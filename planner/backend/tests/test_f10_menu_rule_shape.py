"""Round-trip tests for F10 menu trigger rules.

Locks in the contract between the frontend F10MenuBuilder and the
backend trigger serializer. A v0.9.33 regression where the
frontend used `type: 'a_do_script'` + `params: { script: ... }`
landed an EMPTY Lua block in the .miz — the user saw their
trigger appear in DCS-ME with no script body. The frontend now
sends `type: 'DO_SCRIPT'` + `params: { lua: ... }`, which is what
the inline serializer's `_render_inline_action` actually reads.

These tests guard the contract from either side regressing again.
"""

from __future__ import annotations

import re

from services.trigger_editor import append_inline_rules


# ---------------------------------------------------------------------------
# Fixture — minimal inline trigrules block, the shape DCS-ME emits
# ---------------------------------------------------------------------------

INLINE_MISSION = '''mission = {
    ["theatre"] = "Caucasus",
    ["trigrules"] =
    {
    }, -- end of ["trigrules"]
} -- end of mission
'''


# ---------------------------------------------------------------------------
# Action-shape contract
# ---------------------------------------------------------------------------

def test_do_script_action_with_lua_param_lands_in_inline_text():
    """The frontend MUST send `type: 'DO_SCRIPT'` and `params: { lua }`.

    If either drifts, the inline serializer falls into the unknown-
    type fallback (which uses `rawLua`/`params.lua` defaulting to
    "") and the user gets an empty trigger.
    """
    rule = {
        "id": 99,
        "name": "F10 Radio Menu",
        "enabled": True,
        "oneTime": True,
        "eventType": "onMissionStart",
        "conditions": [],
        "actions": [
            {
                "type": "DO_SCRIPT",
                "params": {
                    "lua": 'missionCommands.addCommand("test", nil, function() end)',
                },
            },
        ],
    }
    out = append_inline_rules(INLINE_MISSION, [rule])
    # The Lua body lands inside the rule's text field.
    assert 'missionCommands.addCommand' in out
    # Predicate is the lowercase Lua name.
    assert 'a_do_script' in out
    # Block is no longer empty.
    assert re.search(r'\["trigrules"\]\s*=\s*\{\s*\}', out) is None


def test_wrong_action_type_a_do_script_drops_into_fallback_with_empty_lua():
    """Documents the v0.9.33 regression — `type: 'a_do_script'` is
    NOT a valid ACTION_TYPE key; the serializer falls through to
    the unknown-type fallback which reads `rawLua`/`params.lua`.
    Without `params.lua` the fallback writes an empty `["text"] = ""`.

    Lock this so any future "let's accept lowercase predicate names"
    refactor does it deliberately rather than by accident — adding
    the alias should make this test fail and the author would need
    to update it.
    """
    rule = {
        "id": 99,
        "name": "F10 (broken)",
        "enabled": True,
        "oneTime": True,
        "eventType": "onMissionStart",
        "conditions": [],
        "actions": [
            {
                "type": "a_do_script",  # WRONG: lowercase predicate
                "params": {
                    "script": 'this gets dropped',  # WRONG: should be `lua`
                },
            },
        ],
    }
    out = append_inline_rules(INLINE_MISSION, [rule])
    # The rule itself is still inserted (the wrapper sees `name`),
    # but the script body is gone.
    assert "F10 (broken)" in out
    assert "this gets dropped" not in out
    # Confirms the regression: empty text field.
    assert '["text"] = ""' in out


def test_skips_duplicate_by_name():
    """append_inline_rules normalizes whitespace + case when matching
    by `name` to avoid shipping the same F10 menu rule twice. If the
    user clicks Generate Trigger twice in a row this is what saves
    them. (Not strictly an F10 bug — guarded for general safety.)
    """
    rule = {
        "id": 99, "name": "F10 Radio Menu",
        "enabled": True, "oneTime": True, "eventType": "onMissionStart",
        "conditions": [],
        "actions": [{"type": "DO_SCRIPT", "params": {"lua": "x = 1"}}],
    }
    once = append_inline_rules(INLINE_MISSION, [rule])
    twice = append_inline_rules(once, [rule])
    # Second call is a no-op — the name already exists.
    assert once == twice
    assert once.count('"F10 Radio Menu"') == 1
