"""Fuel-load editor + waypoint loiter/orbit task.

Fuel: a `fuel` unit-edit sets the payload's absolute ["fuel"] (kg), scoped to
the unit. Loiter: set_waypoint_orbit injects a real-DCS-shaped Orbit task (+
optional stopCondition duration) onto a route waypoint; replace_group_waypoints
serializes it and the result must re-parse cleanly.
"""
import io
import zipfile
import re

from services.miz_parser import parse_mission_text, extract_full_mission_data
from services.unit_editor import apply_unit_edits, _replace_fuel
from services.miz_editor import set_waypoint_orbit, clear_waypoint_orbit, replace_group_waypoints


def _mission_text():
    with zipfile.ZipFile("tests/fixtures/simple.miz") as z:
        return z.read("mission").decode("utf-8")


def _unit_with_payload(mt):
    """Return a unitId whose unit block carries a ["payload"]."""
    for m in re.finditer(r'\["unitId"\]\s*=\s*(\d+)', mt):
        uid = int(m.group(1))
        # payload may sit either side of unitId in the block — check a window both ways
        win = mt[max(0, m.start() - 1500):m.start() + 1500]
        if '["payload"]' in win:
            return uid
    return None


def test_fuel_edit_sets_payload_fuel():
    mt = _mission_text()
    uid = _unit_with_payload(mt)
    assert uid is not None, "fixture has no aircraft with a payload"
    out = _replace_fuel(mt, uid, 1234)
    assert '["fuel"] = 1234' in out
    parse_mission_text(out)  # must remain valid Lua


def test_fuel_edit_via_apply_unit_edits():
    mt = _mission_text()
    uid = _unit_with_payload(mt)
    new_text, results = apply_unit_edits(mt, [{"field": "fuel", "unitId": uid, "value": 2500.5}])
    assert results[0]["status"] == "applied", results
    assert '["fuel"] = 2500.5' in new_text
    parse_mission_text(new_text)


def test_loiter_orbit_round_trip():
    mt = _mission_text()
    md = parse_mission_text(mt)
    data = extract_full_mission_data(md, "Caucasus")
    g = next(x for x in data["groups"] if len(x.get("waypoints", [])) >= 2)
    wps = g["waypoints"]
    set_waypoint_orbit(wps[1], pattern="Circle", altitude_m=600, speed_ms=100, duration_sec=600)

    new_text = replace_group_waypoints(mt, g["groupName"], wps)
    parse_mission_text(new_text)  # serialized task must re-parse
    assert '["id"] = "Orbit"' in new_text
    assert '["pattern"] = "Circle"' in new_text
    assert '["duration"] = 600' in new_text
    assert '["speedEdited"] = true' in new_text


def test_loiter_replace_not_stack_then_clear():
    """Setting orbit twice replaces (one Orbit), clearing removes it."""
    wp = {"altitude_m": 1000, "speed_ms": 120,
          "task": {"id": "ComboTask", "params": {"tasks": {}}}}
    set_waypoint_orbit(wp, pattern="Race-Track", duration_sec=300)
    set_waypoint_orbit(wp, pattern="Circle", duration_sec=900)  # replace
    tasks = wp["task"]["params"]["tasks"]
    orbits = [t for t in tasks.values() if t.get("id") == "Orbit"]
    assert len(orbits) == 1
    assert orbits[0]["params"]["pattern"] == "Circle"
    assert orbits[0]["stopCondition"]["duration"] == 900
    clear_waypoint_orbit(wp)
    assert not any(t.get("id") == "Orbit" for t in wp["task"]["params"]["tasks"].values())


def test_loiter_indefinite_has_no_stopcondition():
    wp = {"altitude_m": 5000, "speed_ms": 150, "task": {"id": "ComboTask", "params": {"tasks": {}}}}
    set_waypoint_orbit(wp, pattern="Race-Track", duration_sec=0)
    orbit = next(t for t in wp["task"]["params"]["tasks"].values() if t.get("id") == "Orbit")
    assert "stopCondition" not in orbit
