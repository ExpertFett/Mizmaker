"""Round-trip tests for the planner DMPI persistence handler.

DMPIs aren't a native DCS field, so v0.9.15 added a planner-private
`["plannerDmpis"]` slot inside the mission table. This file guards
both the writer (`_replace_planner_dmpis`) and the reader
(`parse_planner_dmpis`) the way we did for goals in v0.9.13/v0.9.14.

Coverage:
  - Empty input writes empty block; empty/missing block parses to []
  - Populated payload writes one entry per DMPI with all fields
  - Lat/lon precision survives writer/reader round-trip
  - Lua escapes (quotes, backslashes) round-trip cleanly
  - Re-write replaces an existing block (in-place edit case)
  - End-to-end through the apply_unit_edits dispatch path
"""

from __future__ import annotations

from tests.conftest import download_edited
from services.unit_editor import _replace_planner_dmpis
from services.planner_dmpis_parser import parse_planner_dmpis


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

EMPTY_MISSION = '''
mission = {
    ["theatre"] = "Caucasus",
} -- end of mission
'''

POPULATED_MISSION = '''
mission = {
    ["plannerDmpis"] =
    {
        [1] =
        {
            ["name"] = "Old DMPI",
            ["lat"] = 41.0,
            ["lon"] = 41.0,
            ["elevation"] = 0,
            ["description"] = "stale",
            ["weaponDelivery"] = "",
            ["notes"] = "",
        }, -- end of [1]
    }, -- end of ["plannerDmpis"]
    ["theatre"] = "Caucasus",
} -- end of mission
'''


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------

def test_empty_dmpis_writes_empty_block():
    out = _replace_planner_dmpis(EMPTY_MISSION, [])
    assert '["plannerDmpis"] = {}' in out
    # Surrounding fields untouched.
    assert '["theatre"] = "Caucasus"' in out


def test_populated_dmpis_writes_entries():
    dmpis = [
        {
            "id": "a", "name": "DMPI 1",
            "lat": 41.5, "lon": 41.5, "elevation": 1000,
            "description": "SAM site",
            "weaponDelivery": "GBU-12",
            "notes": "",
        },
        {
            "id": "b", "name": "DMPI 2",
            "lat": -10.0, "lon": 30.5, "elevation": 0,
            "description": "Bunker",
            "weaponDelivery": "GBU-31",
            "notes": "Confirm with JTAC",
        },
    ]
    out = _replace_planner_dmpis(EMPTY_MISSION, dmpis)
    assert '[1] =' in out
    assert '[2] =' in out
    assert '["name"] = "DMPI 1"' in out
    assert '["name"] = "DMPI 2"' in out
    assert '["lat"] = 41.5' in out
    assert '["lat"] = -10' in out
    assert '["weaponDelivery"] = "GBU-12"' in out


def test_blank_name_filtered():
    dmpis = [
        {"id": "a", "name": "", "lat": 1, "lon": 1,
         "elevation": 0, "description": "", "weaponDelivery": "", "notes": ""},
        {"id": "b", "name": "Real DMPI", "lat": 2, "lon": 2,
         "elevation": 0, "description": "", "weaponDelivery": "", "notes": ""},
    ]
    out = _replace_planner_dmpis(EMPTY_MISSION, dmpis)
    # Only the real one survives.
    assert out.count('["name"]') == 1
    assert "Real DMPI" in out


def test_replaces_existing_block():
    new = [{
        "id": "x", "name": "Brand New", "lat": 50.0, "lon": 50.0,
        "elevation": 5000, "description": "fresh",
        "weaponDelivery": "AGM-65", "notes": "",
    }]
    out = _replace_planner_dmpis(POPULATED_MISSION, new)
    assert "Old DMPI" not in out
    assert "Brand New" in out
    assert '["lat"] = 50' in out


def test_lua_escapes_in_strings():
    # Quote escapes + newline collapse on the writer side. Backslash
    # escaping is covered by `test_roundtrip_write_then_parse`, which
    # asserts the writer + reader pair preserves a backslash literal
    # — testing the writer's escape in isolation is brittle because
    # the assertion has to be encoded in Python's own backslash rules.
    dmpis = [{
        "id": "a", "name": 'DMPI "Bandit"',
        "lat": 0, "lon": 0, "elevation": 0,
        "description": "Plain description",
        "weaponDelivery": "",
        "notes": "Line one\nLine two",
    }]
    out = _replace_planner_dmpis(EMPTY_MISSION, dmpis)
    # Inner quotes become \" in the Lua string.
    assert r'\"Bandit\"' in out
    # Newlines collapsed to spaces, not embedded as \n.
    assert "Line one Line two" in out
    # And the (literal) "\\n" form should NOT appear — we collapse,
    # we don't embed escapes.
    assert "\\n" not in out


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def test_missing_block_returns_empty():
    assert parse_planner_dmpis(EMPTY_MISSION) == []


def test_empty_block_returns_empty():
    text = '''
    mission = {
        ["plannerDmpis"] = {},
        ["theatre"] = "Caucasus",
    }
    '''
    assert parse_planner_dmpis(text) == []


def test_parse_extracts_all_fields():
    parsed = parse_planner_dmpis(POPULATED_MISSION)
    assert len(parsed) == 1
    d = parsed[0]
    assert d["name"] == "Old DMPI"
    assert d["lat"] == 41.0
    assert d["lon"] == 41.0
    assert d["description"] == "stale"
    # Deterministic id — same input produces same id.
    assert d["id"] == "dmpi_imported_1"


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------

def test_roundtrip_write_then_parse():
    bs = chr(92)
    desc_with_bs = f"confirm w{bs}JTAC"
    original = [
        {"id": "x", "name": "DMPI 1", "lat": 41.5, "lon": 41.5,
         "elevation": 1000, "description": "SAM site",
         "weaponDelivery": "GBU-12", "notes": "primary"},
        {"id": "y", "name": 'DMPI "Bandit"', "lat": -10.0, "lon": 30.5,
         "elevation": 0, "description": desc_with_bs,
         "weaponDelivery": "AGM-65", "notes": ""},
    ]
    written = _replace_planner_dmpis(EMPTY_MISSION, original)
    parsed = parse_planner_dmpis(written)
    assert len(parsed) == 2
    # Field-by-field round-trip.
    assert parsed[0]["name"] == "DMPI 1"
    assert parsed[0]["lat"] == 41.5
    assert parsed[0]["elevation"] == 1000
    assert parsed[0]["weaponDelivery"] == "GBU-12"
    assert parsed[0]["notes"] == "primary"
    # Quote + backslash escapes round-trip.
    assert parsed[1]["name"] == 'DMPI "Bandit"'
    assert parsed[1]["description"] == desc_with_bs


# ---------------------------------------------------------------------------
# End-to-end through the upload+download dispatch path
# ---------------------------------------------------------------------------

def test_e2e_dispatch_writes_dmpis(client, uploaded_session):
    sid = uploaded_session["sessionId"]
    edits = [{
        "field": "plannerDmpis",
        "value": [
            {"id": "a", "name": "DMPI 1", "lat": 41.5, "lon": 41.5,
             "elevation": 1000, "description": "SAM site",
             "weaponDelivery": "GBU-12", "notes": ""},
        ],
    }]
    contents = download_edited(client, sid, edits)
    mission = contents["mission"]
    assert "DMPI 1" in mission
    assert '["lat"] = 41.5' in mission
    assert '["weaponDelivery"] = "GBU-12"' in mission
