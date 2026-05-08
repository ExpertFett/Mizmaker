"""Tests for find_client_units skill filtering.

User reported in v0.9.35 testing: "we added some hornets to a
mission and we don't see them in the drop down." Root cause was
the planner only matching skill == "Client" (multiplayer), so any
Hornet added with default DCS-ME single-player "Player" skill got
silently dropped from the client-unit dropdowns. v0.9.36 widens
the filter to include both. These tests pin the behaviour.
"""

from __future__ import annotations

from services.unit_extractor import find_client_units


def _mk_mission(units: list[dict]) -> dict:
    """Build a minimally-valid mission dict from a flat list of unit
    dicts. Each unit just needs `name`, `type`, `skill`, `unitId`."""
    return {
        "coalition": {
            "blue": {
                "country": [
                    {
                        "name": "USA",
                        "plane": {
                            "group": [
                                {
                                    "name": "TestFlight",
                                    "groupId": 1,
                                    "units": [
                                        {**u, "x": 0, "y": 0, "alt": 0, "heading": 0}
                                        for u in units
                                    ],
                                },
                            ],
                        },
                    },
                ],
            },
        },
    }


def test_includes_skill_client():
    mission = _mk_mission([
        {"unitId": 101, "name": "Bengal 1-1", "type": "FA-18C_hornet", "skill": "Client"},
    ])
    out = find_client_units(mission)
    assert len(out) == 1
    assert out[0]["name"] == "Bengal 1-1"


def test_includes_skill_player():
    """v0.9.36 fix — single-player Hornets must appear in dropdowns."""
    mission = _mk_mission([
        {"unitId": 101, "name": "Bengal 1-1", "type": "FA-18C_hornet", "skill": "Player"},
    ])
    out = find_client_units(mission)
    assert len(out) == 1
    assert out[0]["name"] == "Bengal 1-1"


def test_excludes_ai_skills():
    """AI skill values (High / Average / Excellent / Random etc.)
    are not playable and should NOT appear in client-unit
    dropdowns. Guards against the over-correction where v0.9.36
    would accidentally include AI-only units."""
    mission = _mk_mission([
        {"unitId": 101, "name": "AI High",      "type": "FA-18C_hornet", "skill": "High"},
        {"unitId": 102, "name": "AI Average",   "type": "FA-18C_hornet", "skill": "Average"},
        {"unitId": 103, "name": "AI Excellent", "type": "FA-18C_hornet", "skill": "Excellent"},
        {"unitId": 104, "name": "AI Random",    "type": "FA-18C_hornet", "skill": "Random"},
    ])
    out = find_client_units(mission)
    assert out == []


def test_mixed_group_only_returns_playable():
    """A group with both human and AI units should only return the
    human ones (typical wing layout: lead = Client, wingmen = AI)."""
    mission = _mk_mission([
        {"unitId": 101, "name": "Bengal 1-1", "type": "FA-18C_hornet", "skill": "Client"},
        {"unitId": 102, "name": "Bengal 1-2", "type": "FA-18C_hornet", "skill": "High"},
        {"unitId": 103, "name": "Bengal 1-3", "type": "FA-18C_hornet", "skill": "Player"},
    ])
    out = find_client_units(mission)
    names = sorted(u["name"] for u in out)
    assert names == ["Bengal 1-1", "Bengal 1-3"]
