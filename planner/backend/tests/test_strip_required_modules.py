"""Tests for the requiredModules-stripping handler.

DCS embeds the mod list a mission needs into the .miz, and refuses
to load if any are missing. v0.9.32 adds a `stripRequiredModules`
edit field that empties the block on download so anyone can play
regardless of which mods they have installed.
"""

from __future__ import annotations

import re

from tests.conftest import download_edited
from services.unit_editor import _strip_required_modules


POPULATED_MISSION = '''
mission = {
    ["requiredModules"] =
    {
        [1] = "F-15E",
        [2] = "supercarrier",
        [3] = "CSG-3",
    }, -- end of ["requiredModules"]
    ["theatre"] = "Caucasus",
} -- end of mission
'''

EMPTY_BLOCK_MISSION = '''
mission = {
    ["requiredModules"] = {},
    ["theatre"] = "Caucasus",
} -- end of mission
'''

NO_BLOCK_MISSION = '''
mission = {
    ["theatre"] = "Caucasus",
} -- end of mission
'''


def test_strips_populated_block_to_empty():
    out = _strip_required_modules(POPULATED_MISSION)
    # Old entries gone.
    assert '"F-15E"' not in out
    assert '"supercarrier"' not in out
    assert '"CSG-3"' not in out
    # Block now empty.
    assert re.search(r'\["requiredModules"\]\s*=\s*\{\s*\}', out) is not None
    # Surrounding fields preserved.
    assert '["theatre"] = "Caucasus"' in out


def test_already_empty_block_stays_empty():
    out = _strip_required_modules(EMPTY_BLOCK_MISSION)
    assert re.search(r'\["requiredModules"\]\s*=\s*\{\s*\}', out) is not None
    # Idempotent — running it again on the output produces the
    # same result.
    assert _strip_required_modules(out) == out


def test_missing_block_is_a_noop():
    # Some old DCS missions don't have the key at all. Stripping
    # should leave the file untouched rather than inventing a key.
    out = _strip_required_modules(NO_BLOCK_MISSION)
    assert out == NO_BLOCK_MISSION
    assert "requiredModules" not in out


def test_e2e_dispatch_strips_required_modules(client, uploaded_session):
    sid = uploaded_session["sessionId"]
    edits = [{"field": "stripRequiredModules", "value": True}]
    contents = download_edited(client, sid, edits)
    mission = contents["mission"]
    # Block exists and is empty.
    assert re.search(r'\["requiredModules"\]\s*=\s*\{\s*\}', mission) is not None
