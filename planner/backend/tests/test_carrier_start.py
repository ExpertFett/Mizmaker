"""Carrier cold/hot starts must survive a route edit.

A deck start links to the boat via ["helipadId"] + ["linkUnit"] (the carrier's
unitId); land starts use ["airdromeId"]. The extractor used to capture only
airdromeId, so re-serializing an edited route dropped the carrier link and DCS
fell back to an AIR start. This guards the round-trip.
"""
import io
import zipfile

from services.miz_parser import parse_mission_text, extract_full_mission_data
from services.miz_editor import replace_group_waypoints, _serialize_points


def _mission():
    with zipfile.ZipFile("tests/fixtures/simple.miz") as z:
        return z.read("mission").decode("utf-8")


def _carrier_group(data):
    for g in data["groups"]:
        wps = g.get("waypoints") or []
        if wps and wps[0].get("helipad_id"):
            return g
    return None


def test_extractor_captures_carrier_link():
    data = extract_full_mission_data(parse_mission_text(_mission()), "Caucasus")
    g = _carrier_group(data)
    assert g is not None, "fixture has no carrier deck start"
    wp0 = g["waypoints"][0]
    assert wp0["waypoint_type"] in ("TakeOffParking", "TakeOffParkingHot", "TakeOff", "TakeOffGround")
    assert wp0["helipad_id"] and wp0["link_unit"]  # the carrier's unitId


def test_carrier_start_survives_route_reserialize():
    mt = _mission()
    data = extract_full_mission_data(parse_mission_text(mt), "Caucasus")
    g = _carrier_group(data)
    out = replace_group_waypoints(mt, g["groupName"], g["waypoints"])
    parse_mission_text(out)  # must remain valid Lua

    # Re-extract the edited group and confirm WP0 is still a deck start.
    g2 = next(x for x in extract_full_mission_data(parse_mission_text(out), "Caucasus")["groups"]
              if x["groupName"] == g["groupName"])
    wp0 = g2["waypoints"][0]
    assert wp0["waypoint_type"] == g["waypoints"][0]["waypoint_type"]  # NOT "Turning Point"
    assert wp0["helipad_id"] == g["waypoints"][0]["helipad_id"]
    assert wp0["link_unit"] == g["waypoints"][0]["link_unit"]


def test_serializer_emits_helipad_and_link_unit():
    pts = [{"waypoint_number": 0, "waypoint_type": "TakeOffParking",
            "waypoint_action": "From Parking Area", "x": 1.0, "y": 2.0,
            "helipad_id": 7, "link_unit": 7}]
    lua = _serialize_points(pts, "\t\t\t\t")
    assert '["helipadId"] = 7,' in lua
    assert '["linkUnit"] = 7,' in lua
    assert '["type"] = "TakeOffParking",' in lua
