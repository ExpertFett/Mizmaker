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


def test_upsert_replaces_existing_same_named_rule_v0_9_35():
    """v0.9.35 changed `append_inline_rules` from skip-by-name to
    upsert-by-name. This test guards the new behaviour: when a rule
    with the same name already exists, its BODY is replaced in
    place (preserving the original [N] index) rather than the new
    rule being silently dropped.

    The user reported this as "I still don't see the new triggers
    in the mission" after the v0.9.34 action-shape fix — they had
    a v0.9.33-broken empty rule sitting in their .miz, and the
    pre-v0.9.35 dedupe was skipping the corrected version.
    """
    original = {
        "id": 99, "name": "F10 Radio Menu",
        "enabled": True, "oneTime": True, "eventType": "onMissionStart",
        "conditions": [],
        "actions": [{"type": "DO_SCRIPT", "params": {"lua": "OLD_BODY"}}],
    }
    once = append_inline_rules(INLINE_MISSION, [original])
    assert "OLD_BODY" in once

    # Second pass with a NEW body, same name — should replace.
    updated = {
        **original,
        "actions": [{"type": "DO_SCRIPT", "params": {"lua": "NEW_BODY"}}],
    }
    twice = append_inline_rules(once, [updated])
    assert "NEW_BODY" in twice
    assert "OLD_BODY" not in twice  # body was replaced, not appended
    # And only ONE rule with that name — no duplication.
    assert twice.count('"F10 Radio Menu"') == 1


def test_upsert_preserves_unrelated_rules():
    """Rules with names not in the incoming list stay byte-for-byte
    untouched. Important — the user might have hand-written rules
    in their .miz alongside the planner-generated F10 menu, and
    saving from the planner shouldn't disturb them."""
    # First add an unrelated rule.
    other = {
        "id": 1, "name": "Hand-written Rule",
        "enabled": True, "oneTime": True, "eventType": "onMissionStart",
        "conditions": [],
        "actions": [{"type": "DO_SCRIPT", "params": {"lua": "untouched_lua"}}],
    }
    with_other = append_inline_rules(INLINE_MISSION, [other])
    assert "untouched_lua" in with_other
    assert "Hand-written Rule" in with_other

    # Now add an F10 menu rule alongside it.
    f10 = {
        "id": 2, "name": "F10 Radio Menu",
        "enabled": True, "oneTime": True, "eventType": "onMissionStart",
        "conditions": [],
        "actions": [{"type": "DO_SCRIPT", "params": {"lua": "f10_lua"}}],
    }
    final = append_inline_rules(with_other, [f10])
    # Both rules present, both bodies preserved.
    assert "untouched_lua" in final
    assert "f10_lua" in final
    assert final.count('"Hand-written Rule"') == 1
    assert final.count('"F10 Radio Menu"') == 1
