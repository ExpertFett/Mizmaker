"""Round-trip tests for the mission goals edit handler.

Goals were session-only through v0.9.9 — they showed up in the brief
generator and the kneeboard card but vanished on download. v0.9.13
adds the `missionGoals` edit field that writes them into the .miz's
`["goals"]` block, where DCS can pick them up for the in-mission
scoring screen / briefing.

These tests guard the handler in two directions:
  - Empty payload writes `["goals"] = {}` (and doesn't break the
    surrounding mission table).
  - Populated payload writes one entry per goal with the score,
    side-prefixed comment, and the empty rules block we use to keep
    DCS from auto-evaluating in training scenarios.
"""

from __future__ import annotations

import re

from tests.conftest import download_edited
from services.unit_editor import _replace_mission_goals


# ---------------------------------------------------------------------------
# Direct unit tests on the replacement function — fast, fixture-free.
# ---------------------------------------------------------------------------

GOALS_OUTER = '''
mission = {
    ["goals"] = {},
    ["theatre"] = "Caucasus",
} -- end of mission
'''

GOALS_POPULATED = '''
mission = {
    ["goals"] =
    {
        [1] =
        {
            ["score"] = 50,
            ["flag"] = 1,
            ["comment"] = "[BLUE] Existing goal",
            ["predicates"] = {},
            ["rules"] = {},
        }, -- end of [1]
    }, -- end of ["goals"]
    ["theatre"] = "Caucasus",
} -- end of mission
'''


def test_empty_goals_keeps_empty_block():
    out = _replace_mission_goals(GOALS_OUTER, [])
    assert '["goals"] = {}' in out
    # Surrounding fields untouched.
    assert '["theatre"] = "Caucasus"' in out


def test_populated_goals_writes_entries():
    goals = [
        {"id": "a", "text": "Destroy SA-11", "side": "blue", "points": 100, "notes": ""},
        {"id": "b", "text": "Protect carrier", "side": "red", "points": 50, "notes": ""},
    ]
    out = _replace_mission_goals(GOALS_OUTER, goals)
    # Two numbered entries land.
    assert '[1] =' in out
    assert '[2] =' in out
    # Score + comment land with side prefix.
    assert '["score"] = 100,' in out
    assert '["score"] = 50,' in out
    assert '[BLUE] Destroy SA-11' in out
    assert '[RED] Protect carrier' in out
    # Empty predicates + rules so DCS doesn't auto-evaluate.
    assert '["predicates"] = {}' in out
    assert '["rules"] = {}' in out


def test_blank_text_goals_filtered():
    # Editor lets the user stage placeholders; the handler drops them.
    goals = [
        {"id": "a", "text": "", "side": "blue", "points": 0, "notes": ""},
        {"id": "b", "text": "Real objective", "side": "red", "points": 25, "notes": ""},
    ]
    out = _replace_mission_goals(GOALS_OUTER, goals)
    # Only one entry survives.
    assert out.count('["score"]') == 1
    assert '[RED] Real objective' in out
    # And it gets index 1, not 2.
    assert '[1] =' in out
    assert '[2] =' not in out


def test_replaces_existing_populated_goals():
    new = [
        {"id": "x", "text": "Brand new goal", "side": "blue", "points": 75, "notes": ""},
    ]
    out = _replace_mission_goals(GOALS_POPULATED, new)
    # Old goal is gone, new one is in.
    assert 'Existing goal' not in out
    assert '[BLUE] Brand new goal' in out
    assert '["score"] = 75,' in out


def test_lua_string_escapes():
    # Quotes and backslashes in the comment must be Lua-escaped or
    # the .miz won't load.
    goals = [{
        "id": "a",
        "text": 'Destroy "Bad Guy" with HARM\\AGM',
        "side": "all",
        "points": 0,
        "notes": "",
    }]
    out = _replace_mission_goals(GOALS_OUTER, goals)
    # The serialized comment must have escaped quotes and double-escaped backslashes.
    assert r'\"Bad Guy\"' in out
    assert r'HARM\\AGM' in out


def test_newlines_collapsed_in_comment():
    # DCS comments are single-line; we collapse newlines to spaces
    # rather than embedding "\n" escapes (which DCS ME doesn't write).
    goals = [{
        "id": "a",
        "text": "Line one\nLine two",
        "side": "blue",
        "points": 0,
        "notes": "",
    }]
    out = _replace_mission_goals(GOALS_OUTER, goals)
    assert "Line one Line two" in out
    assert "\\n" not in out  # no embedded newline escape


def test_notes_not_written():
    # `notes` is editor-only — pilot-internal context, not goal text.
    goals = [{
        "id": "a", "text": "Visible goal", "side": "blue", "points": 10,
        "notes": "INTERNAL: cancel if leader dies",
    }]
    out = _replace_mission_goals(GOALS_OUTER, goals)
    assert "Visible goal" in out
    assert "INTERNAL" not in out


# ---------------------------------------------------------------------------
# Roundtrip — upload simple.miz, dispatch missionGoals edit, unzip,
# regex-assert the goals block survived intact.
# ---------------------------------------------------------------------------

def test_roundtrip_writes_goals_into_miz(client, uploaded_session):
    sid = uploaded_session["sessionId"]
    edits = [{
        "field": "missionGoals",
        "value": [
            {"id": "a", "text": "Destroy SA-11", "side": "blue", "points": 100, "notes": ""},
            {"id": "b", "text": "RTB", "side": "all", "points": 0, "notes": ""},
        ],
    }]
    contents = download_edited(client, sid, edits)
    mission = contents["mission"]
    # Goals block is no longer empty.
    assert re.search(r'\["goals"\]\s*=\s*\{\s*\}', mission) is None
    # Both goals land.
    assert "[BLUE] Destroy SA-11" in mission
    assert "[ALL] RTB" in mission
    assert '["score"] = 100,' in mission


def test_roundtrip_empty_payload_keeps_empty_block(client, uploaded_session):
    sid = uploaded_session["sessionId"]
    edits = [{"field": "missionGoals", "value": []}]
    contents = download_edited(client, sid, edits)
    mission = contents["mission"]
    # Empty list re-emits the empty block — fixture's goals stay empty.
    assert re.search(r'\["goals"\]\s*=\s*\{\s*\}', mission) is not None
