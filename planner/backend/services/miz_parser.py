"""
.miz file parser — extracts mission data with full waypoint detail.

A .miz file is a ZIP archive containing Lua table files.
The 'mission' entry holds the main mission data as a Lua table.
We parse it with slpp, then traverse the coalition→country→category→group hierarchy.
"""

import io
import json
import zipfile
from typing import Dict, List, Any, Optional

from slpp import slpp as lua

from services.projection import dcs_to_latlon, THEATERS

# Load SAM threat ranges
import os
_data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
with open(os.path.join(_data_dir, "sam_threat_ranges.json")) as f:
    SAM_THREAT_RANGES: Dict[str, int] = json.load(f)

CATEGORIES = ["plane", "helicopter", "vehicle", "ship", "static"]
COALITIONS = ["blue", "red", "neutrals"]


def extract_mission_from_miz(miz_bytes: bytes) -> str:
    """Extract the 'mission' Lua text from a .miz ZIP archive."""
    with zipfile.ZipFile(io.BytesIO(miz_bytes), "r") as zf:
        return zf.read("mission").decode("utf-8")


def parse_mission_text(text: str) -> dict:
    """Parse Lua mission text into a Python dict."""
    # Strip the 'mission = ' prefix if present
    stripped = text.strip()
    if stripped.startswith("mission"):
        idx = stripped.index("{")
        stripped = stripped[idx:]
    return lua.decode(stripped)


def extract_full_mission_data(mission_dict: dict, theater: str) -> dict:
    """
    Extract complete mission data for the frontend.

    Returns dict with: overview, groups[], units[], threats[], airbases[]
    """
    has_projection = theater in THEATERS

    overview = _extract_overview(mission_dict, theater)
    groups = []
    units = []
    threats = []
    airbases = []

    coalition_data = mission_dict.get("coalition", {})
    for side in COALITIONS:
        side_data = coalition_data.get(side, {})

        # Extract airbases
        for ab_id, ab in (side_data.get("nav_points") or {}).items():
            if isinstance(ab, dict) and "callsignStr" in ab:
                ab_entry = {
                    "name": ab.get("callsignStr", ""),
                    "coalition": side,
                    "x": ab.get("x", 0),
                    "y": ab.get("y", 0),
                }
                if has_projection and ab_entry["x"] and ab_entry["y"]:
                    lat, lon = dcs_to_latlon(ab_entry["x"], ab_entry["y"], theater)
                    ab_entry["lat"] = lat
                    ab_entry["lon"] = lon
                airbases.append(ab_entry)

        countries = side_data.get("country", {})
        if isinstance(countries, dict):
            countries = list(countries.values())

        for country in countries:
            if not isinstance(country, dict):
                continue
            country_name = country.get("name", "Unknown")

            for category in CATEGORIES:
                cat_data = country.get(category, {})
                if not isinstance(cat_data, dict):
                    continue
                group_list = cat_data.get("group", {})
                if isinstance(group_list, dict):
                    group_list = list(group_list.values())

                for group in group_list:
                    if not isinstance(group, dict):
                        continue
                    g = _extract_group(group, side, country_name, category, theater, has_projection)
                    groups.append(g)

                    for unit in g["units"]:
                        units.append(unit)
                        # Check for SAM/AAA threats
                        if unit["type"] in SAM_THREAT_RANGES:
                            threats.append({
                                "name": unit["name"],
                                "type": unit["type"],
                                "x": unit["x"],
                                "y": unit["y"],
                                "lat": unit.get("lat"),
                                "lon": unit.get("lon"),
                                "range": SAM_THREAT_RANGES[unit["type"]],
                                "coalition": side,
                            })

    return {
        "overview": overview,
        "groups": groups,
        "units": units,
        "threats": threats,
        "airbases": airbases,
    }


def _extract_overview(d: dict, theater: str) -> dict:
    date = d.get("date", {})
    wx = d.get("weather", {})
    wind = wx.get("wind", {})
    qnh_mmhg = wx.get("qnh", 760)

    return {
        "theater": theater,
        "sortie": d.get("sortie", ""),
        "date": f"{date.get('Year', 2000)}-{date.get('Month', 1):02d}-{date.get('Day', 1):02d}",
        "start_time": d.get("start_time", 0),
        "description": d.get("descriptionText", ""),
        "weather": {
            "wind": {
                "atGround": {"speed": _num(wind.get("atGround", {}).get("speed")), "dir": _num(wind.get("atGround", {}).get("dir"))},
                "at2000": {"speed": _num(wind.get("at2000", {}).get("speed")), "dir": _num(wind.get("at2000", {}).get("dir"))},
                "at8000": {"speed": _num(wind.get("at8000", {}).get("speed")), "dir": _num(wind.get("at8000", {}).get("dir"))},
            },
            "temperature_c": _num(wx.get("season", {}).get("temperature", 15)),
            "qnh_mmhg": qnh_mmhg,
            "qnh_inhg": round(qnh_mmhg * 0.03937, 2),
            "qnh_hpa": round(qnh_mmhg * 1.33322, 1),
            "clouds_base_m": _num(wx.get("clouds", {}).get("base", 0)),
            "clouds_preset": wx.get("clouds", {}).get("preset", ""),
            "visibility_m": _num(wx.get("visibility", {}).get("distance", 80000)),
            "fog_enabled": wx.get("enable_fog", False),
            "dust_enabled": wx.get("enable_dust", False),
            "turbulence": _num(wx.get("groundTurbulence", 0)),
        },
    }


def _extract_group(
    group: dict,
    coalition: str,
    country: str,
    category: str,
    theater: str,
    has_projection: bool,
) -> dict:
    group_id = group.get("groupId", 0)
    group_name = group.get("name", "")

    # Extract units
    raw_units = group.get("units", {})
    if isinstance(raw_units, dict):
        raw_units = list(raw_units.values())

    extracted_units = []
    for u in raw_units:
        if not isinstance(u, dict):
            continue
        unit = {
            "unitId": u.get("unitId", 0),
            "name": u.get("name", ""),
            "type": u.get("type", ""),
            "x": _num(u.get("x")),
            "y": _num(u.get("y")),
            "skill": u.get("skill", ""),
            "category": category,
            "coalition": coalition,
            "country": country,
            "groupName": group_name,
            "groupId": group_id,
        }
        if has_projection and unit["x"] and unit["y"]:
            lat, lon = dcs_to_latlon(unit["x"], unit["y"], theater)
            unit["lat"] = lat
            unit["lon"] = lon
        extracted_units.append(unit)

    # Extract waypoints from route.points
    route = group.get("route", {})
    raw_points = route.get("points", {})
    if isinstance(raw_points, dict):
        # Lua 1-indexed keys → sort numerically
        sorted_keys = sorted(raw_points.keys(), key=lambda k: int(k) if str(k).isdigit() else 0)
        raw_points = [raw_points[k] for k in sorted_keys]

    waypoints = []
    for i, pt in enumerate(raw_points):
        if not isinstance(pt, dict):
            continue
        wp = {
            "waypoint_number": i,  # 0-indexed to match DCS jet steerpoints
            "waypoint_name": pt.get("name", f"WP{i}"),
            "waypoint_type": pt.get("type", ""),
            "waypoint_action": pt.get("action", ""),
            "x": _num(pt.get("x")),
            "y": _num(pt.get("y")),
            "altitude_m": _num(pt.get("alt", 0)),
            "altitude_type": pt.get("alt_type", "BARO"),
            "speed_ms": _num(pt.get("speed", 0)),
            "eta_seconds": _num(pt.get("ETA", 0)),
            "eta_locked": pt.get("ETA_locked", True),
            "speed_locked": pt.get("speed_locked", True),
            "airdrome_id": pt.get("airdromeId"),
            "task": pt.get("task"),  # preserve original task data for round-trip
        }
        if has_projection and wp["x"] and wp["y"]:
            lat, lon = dcs_to_latlon(wp["x"], wp["y"], theater)
            wp["lat"] = lat
            wp["lon"] = lon
        waypoints.append(wp)

    return {
        "groupId": group_id,
        "groupName": group_name,
        "coalition": coalition,
        "country": country,
        "category": category,
        "task": group.get("task", ""),
        "frequency": _num(group.get("frequency")),
        "modulation": group.get("modulation", 0),
        "units": extracted_units,
        "waypoints": waypoints,
    }


def _num(val) -> float:
    """Safely convert to float, default 0."""
    if val is None:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0
