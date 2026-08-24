"""Regression tests: adding triggers must NOT delete or damage existing ones.

The dangerous path (fixed v1.19.113): on an INLINE-format mission,
`extract_triggers` returns existing rules with empty bodies (it can't read
inline action/condition dicts). The export flush sends the full store back, and
`append_inline_rules` upserts every rule by name — which used to re-render each
existing rule from its emptied copy, wiping real actions (e.g. carrier lights).
"""
import re
import zipfile

from services.trigger_editor import extract_triggers, append_inline_rules
from services.miz_parser import parse_mission_text

FIXTURE = "tests/fixtures/simple.miz"


def _mission_text():
    with zipfile.ZipFile(FIXTURE) as z:
        return z.read("mission").decode("utf-8", "replace")


def _rule_body(text, name):
    """Brace-matched body of the inline rule whose comment == name."""
    for m in re.finditer(r"\[\d+\] =\s*\{", text):
        open_pos = text.index("{", m.start())
        depth, i = 1, open_pos + 1
        while i < len(text) and depth > 0:
            depth += (text[i] == "{") - (text[i] == "}")
            i += 1
        body = text[open_pos:i]
        cm = re.search(r'\["comment"\] = "([^"]*)"', body)
        if cm and cm.group(1) == name:
            return body
    return None


FRAMEWORK_RULE = {
    "name": "Script: Civ Traffic (Syria)", "enabled": True, "eventType": "onMissionStart",
    "conditions": [], "actions": [{"type": "DO_SCRIPT_FILE", "params": {"file": "CivTraffic-Syria.lua"}}],
}


def test_adding_framework_trigger_preserves_existing_inline_bodies():
    """The exact app path: seed store with (lossily-extracted) existing rules,
    add a framework rule, send the FULL list back — existing action bodies must
    survive byte-for-byte, not be re-rendered empty."""
    txt = _mission_text()
    before = extract_triggers(parse_mission_text(txt))
    assert before["inlineFormat"] is True, "fixture must be inline to exercise the bug"
    assert len(before["rules"]) == 5

    # Full store list = existing (empty-bodied) + the new framework rule.
    merged = [dict(r) for r in before["rules"]] + [dict(FRAMEWORK_RULE)]
    out = append_inline_rules(txt, merged)

    # 1. No carrier-light action was lost (the original regression: 8 -> 4).
    assert txt.count("carrier_illumination") == out.count("carrier_illumination") > 0

    # 2. Every original rule's body is preserved byte-for-byte.
    for name in ["CVN Lights Nav", "CVN Lights Off", "CVN Lights Launch", "CVN Lights Recovery"]:
        assert _rule_body(txt, name) in out, f"{name} body was mutated"

    # 3. The new script rule was actually added and will bundle on download.
    after = extract_triggers(parse_mission_text(out))
    assert len(after["rules"]) == 6
    assert "CivTraffic-Syria.lua" in out


def test_adding_framework_trigger_is_idempotent():
    txt = _mission_text()
    once = append_inline_rules(txt, [dict(FRAMEWORK_RULE)])
    twice = append_inline_rules(once, [dict(FRAMEWORK_RULE)])
    # The filename appears exactly twice per add: the trigrules display copy
    # and the compiled runtime copy in trig.actions (DCS executes the latter
    # — see test_trig_compile.py). Re-adding must not grow either.
    assert once.count("CivTraffic-Syria.lua") == twice.count("CivTraffic-Syria.lua") == 2


def test_genuine_edit_with_body_still_replaces():
    """The guard only skips EMPTY incoming rules — a real edit that carries a
    body must still replace the existing entry in place."""
    txt = _mission_text()
    edited = {
        "name": "CVN Lights Nav", "enabled": True, "eventType": "once",
        "conditions": [], "actions": [{"type": "DO_SCRIPT", "params": {"lua": "env.info('edited')"}}],
    }
    out = append_inline_rules(txt, [edited])
    assert "env.info('edited')" in out
    # Still exactly 5 rules (replaced in place, not appended as a duplicate).
    assert len(extract_triggers(parse_mission_text(out))["rules"]) == 5
