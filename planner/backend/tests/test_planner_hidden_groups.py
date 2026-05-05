"""Round-trip tests for the visibility-filter persistence handler.

v0.9.26 added the `["plannerHiddenGroups"]` writer + parser so the
mission maker's intel-control list (group IDs hidden from flight
leads, authored via the v0.9.25 Visibility tab) round-trips
through download / re-upload. Mirrors the test_planner_dmpis.py
pattern.
"""

from __future__ import annotations

import re

from tests.conftest import download_edited
from services.unit_editor import _replace_planner_hidden_groups
from services.planner_hidden_groups_parser import parse_planner_hidden_groups


EMPTY_MISSION = '''
mission = {
    ["theatre"] = "Caucasus",
} -- end of mission
'''

POPULATED_MISSION = '''
mission = {
    ["plannerHiddenGroups"] =
    {
        [1] = 7,
        [2] = 12,
    }, -- end of ["plannerHiddenGroups"]
    ["theatre"] = "Caucasus",
} -- end of mission
'''


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------

def test_empty_list_writes_empty_block():
    out = _replace_planner_hidden_groups(EMPTY_MISSION, [])
    assert '["plannerHiddenGroups"] = {}' in out
    assert '["theatre"] = "Caucasus"' in out


def test_populated_list_writes_entries():
    out = _replace_planner_hidden_groups(EMPTY_MISSION, [3, 7, 11])
    assert '[1] = 3,' in out
    assert '[2] = 7,' in out
    assert '[3] = 11,' in out


def test_writer_dedups_and_sorts():
    # Same input set in different orders should produce identical
    # output — the writer sorts + dedupes for stable diffs.
    a = _replace_planner_hidden_groups(EMPTY_MISSION, [11, 3, 7, 3])
    b = _replace_planner_hidden_groups(EMPTY_MISSION, [3, 7, 11])
    assert a == b
    # And sort order is ascending.
    idx_3 = a.find('= 3,')
    idx_7 = a.find('= 7,')
    idx_11 = a.find('= 11,')
    assert idx_3 < idx_7 < idx_11


def test_replaces_existing_block():
    out = _replace_planner_hidden_groups(POPULATED_MISSION, [99])
    assert '= 7,' not in out  # old IDs gone
    assert '= 12,' not in out
    assert '[1] = 99,' in out


def test_replaces_existing_with_empty():
    out = _replace_planner_hidden_groups(POPULATED_MISSION, [])
    assert '["plannerHiddenGroups"] = {}' in out
    assert '= 7,' not in out


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def test_missing_block_returns_empty():
    assert parse_planner_hidden_groups(EMPTY_MISSION) == []


def test_empty_block_returns_empty():
    text = '''
    mission = {
        ["plannerHiddenGroups"] = {},
    }
    '''
    assert parse_planner_hidden_groups(text) == []


def test_parser_extracts_ids():
    parsed = parse_planner_hidden_groups(POPULATED_MISSION)
    assert parsed == [7, 12]


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------

def test_roundtrip_write_then_parse():
    original = [3, 7, 11, 99]
    written = _replace_planner_hidden_groups(EMPTY_MISSION, original)
    parsed = parse_planner_hidden_groups(written)
    assert parsed == sorted(set(original))


# ---------------------------------------------------------------------------
# E2E through the apply_unit_edits dispatch path
# ---------------------------------------------------------------------------

def test_e2e_dispatch_writes_hidden_groups(client, uploaded_session):
    sid = uploaded_session["sessionId"]
    edits = [{"field": "plannerHiddenGroups", "value": [42, 17]}]
    contents = download_edited(client, sid, edits)
    mission = contents["mission"]
    # Block exists and contains both IDs.
    assert re.search(r'\["plannerHiddenGroups"\]\s*=\s*\{[^}]*\}', mission, re.DOTALL) is not None
    assert '= 17,' in mission
    assert '= 42,' in mission
