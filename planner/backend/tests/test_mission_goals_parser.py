"""Tests for the mission goals parser.

Mirror of test_mission_goals.py — that one covers the writer; this
covers the reader. Together they form the round-trip guarantee:
write → read → write should be a no-op (modulo deterministic ids).

Coverage:
  - Empty / missing goals block returns []
  - Single goal extracts text + side from `[BLUE] Foo` prefix
  - Multiple goals preserve order
  - Side prefix recovery: BLUE/RED/NEUTRAL/ALL + missing prefix
  - DictKey_* references resolved against a lookup
  - Lua escapes (quotes, backslashes) round-trip
  - Round-trip: write 3 goals, parse them back, get the same list
"""

from __future__ import annotations

from services.unit_editor import _replace_mission_goals
from services.mission_goals_parser import parse_mission_goals


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

EMPTY_MISSION = '''
mission = {
    ["goals"] = {},
    ["theatre"] = "Caucasus",
} -- end of mission
'''

NO_GOALS_BLOCK = '''
mission = {
    ["theatre"] = "Caucasus",
} -- end of mission
'''


# ---------------------------------------------------------------------------
# Empty / missing
# ---------------------------------------------------------------------------

def test_empty_goals_block_returns_empty_list():
    assert parse_mission_goals(EMPTY_MISSION) == []


def test_missing_goals_block_returns_empty_list():
    assert parse_mission_goals(NO_GOALS_BLOCK) == []


# ---------------------------------------------------------------------------
# Single goal
# ---------------------------------------------------------------------------

def test_single_goal_extracts_text_and_side():
    text = '''
    ["goals"] =
    {
        [1] =
        {
            ["score"] = 100,
            ["flag"] = 1,
            ["comment"] = "[BLUE] Destroy SAM",
            ["predicates"] = {},
            ["rules"] = {},
        }, -- end of [1]
    }, -- end of ["goals"]
    '''
    goals = parse_mission_goals(text)
    assert len(goals) == 1
    g = goals[0]
    assert g["text"] == "Destroy SAM"
    assert g["side"] == "blue"
    assert g["points"] == 100
    assert g["notes"] == ""
    # Deterministic id keyed off entry index.
    assert g["id"] == "goal_imported_1"


# ---------------------------------------------------------------------------
# Side prefix recovery — every coalition + missing-prefix fallback
# ---------------------------------------------------------------------------

def _make_goal_block(comment: str) -> str:
    return f'''
    ["goals"] =
    {{
        [1] =
        {{
            ["score"] = 0,
            ["flag"] = 1,
            ["comment"] = "{comment}",
            ["predicates"] = {{}},
            ["rules"] = {{}},
        }},
    }},
    '''


def test_red_side_prefix():
    goals = parse_mission_goals(_make_goal_block("[RED] Defend airfield"))
    assert goals[0]["side"] == "red"
    assert goals[0]["text"] == "Defend airfield"


def test_neutral_side_prefix():
    goals = parse_mission_goals(_make_goal_block("[NEUTRAL] Provide ATC"))
    assert goals[0]["side"] == "neutral"


def test_all_side_prefix():
    goals = parse_mission_goals(_make_goal_block("[ALL] RTB by 1900Z"))
    assert goals[0]["side"] == "all"


def test_missing_prefix_defaults_to_all():
    # A goal written by DCS-ME (no [SIDE] prefix) defaults to 'all'
    # so the user can re-tag it in the editor.
    goals = parse_mission_goals(_make_goal_block("Legacy DCS-ME goal"))
    assert goals[0]["side"] == "all"
    assert goals[0]["text"] == "Legacy DCS-ME goal"


def test_lowercase_prefix_normalized():
    # Be forgiving on case — the writer always emits uppercase but
    # a hand-edited mission might have lowercase.
    goals = parse_mission_goals(_make_goal_block("[blue] Destroy SAM"))
    assert goals[0]["side"] == "blue"
    assert goals[0]["text"] == "Destroy SAM"


# ---------------------------------------------------------------------------
# Multiple goals — order preserved
# ---------------------------------------------------------------------------

def test_multiple_goals_preserve_order():
    text = '''
    ["goals"] =
    {
        [1] =
        {
            ["score"] = 50,
            ["comment"] = "[BLUE] Goal A",
            ["predicates"] = {},
            ["rules"] = {},
        },
        [2] =
        {
            ["score"] = 25,
            ["comment"] = "[RED] Goal B",
            ["predicates"] = {},
            ["rules"] = {},
        },
        [3] =
        {
            ["score"] = 0,
            ["comment"] = "[ALL] Goal C",
            ["predicates"] = {},
            ["rules"] = {},
        },
    },
    '''
    goals = parse_mission_goals(text)
    assert len(goals) == 3
    assert [g["text"] for g in goals] == ["Goal A", "Goal B", "Goal C"]
    assert [g["side"] for g in goals] == ["blue", "red", "all"]
    assert [g["points"] for g in goals] == [50, 25, 0]


# ---------------------------------------------------------------------------
# DictKey resolution
# ---------------------------------------------------------------------------

def test_dictkey_comment_resolved_via_lookup():
    text = _make_goal_block("DictKey_GoalText_1")
    lookup = {"DictKey_GoalText_1": "[BLUE] Destroy SA-11"}
    goals = parse_mission_goals(text, lookup)
    assert goals[0]["text"] == "Destroy SA-11"
    assert goals[0]["side"] == "blue"


def test_dictkey_unknown_falls_through():
    # If the dictionary is missing the key we leave the raw reference
    # so the user can spot the breakage rather than seeing a blank.
    text = _make_goal_block("DictKey_GoalText_1")
    goals = parse_mission_goals(text, {})
    # Falls through with no [SIDE] prefix → 'all'.
    assert goals[0]["text"] == "DictKey_GoalText_1"
    assert goals[0]["side"] == "all"


# ---------------------------------------------------------------------------
# Round-trip with the writer
# ---------------------------------------------------------------------------

def test_roundtrip_write_then_parse():
    original = [
        {"id": "x", "text": "Destroy SA-11", "side": "blue", "points": 100, "notes": "ignore me"},
        {"id": "y", "text": "RTB by 1900Z", "side": "all", "points": 0, "notes": ""},
        {"id": "z", "text": 'Engage "Bandit 1"', "side": "red", "points": 50, "notes": ""},
    ]
    written = _replace_mission_goals(EMPTY_MISSION, original)
    parsed = parse_mission_goals(written)
    assert len(parsed) == 3
    # Text + side + points round-trip cleanly.
    assert parsed[0]["text"] == "Destroy SA-11"
    assert parsed[0]["side"] == "blue"
    assert parsed[0]["points"] == 100
    assert parsed[1]["text"] == "RTB by 1900Z"
    assert parsed[1]["side"] == "all"
    # Quote-escape round-trip works too.
    assert parsed[2]["text"] == 'Engage "Bandit 1"'
    assert parsed[2]["side"] == "red"
    # `notes` is editor-only — never appears in the .miz, so it
    # always parses back as empty.
    for g in parsed:
        assert g["notes"] == ""


def test_blank_text_dropped_on_parse():
    # A goal whose comment-after-prefix is blank gets dropped, same
    # way the writer drops blank-text goals on input.
    goals = parse_mission_goals(_make_goal_block("[BLUE]   "))
    assert goals == []
