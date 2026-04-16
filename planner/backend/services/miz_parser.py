"""
.miz file parser — extracts mission data with full waypoint detail.

A .miz file is a ZIP archive containing Lua table files.
The 'mission' entry holds the main mission data as a Lua table.
We parse it with SLPP (pure-Python Lua table parser), then traverse the
coalition→country→category→group hierarchy.
"""

import io
import json
import re
import zipfile
from typing import Dict, List, Any, Optional

from slpp import SLPP

from services.projection import dcs_to_latlon, THEATERS

from reference.loader import get_sam_threat_ranges, get_airbases

SAM_THREAT_RANGES: Dict[str, int] = get_sam_threat_ranges()
_THEATER_AIRBASES = get_airbases()


def _load_theater_airbases(theater: str) -> list:
    """Load airbase positions from static data for this theater."""
    raw = _THEATER_AIRBASES.get(theater, [])
    return [{"name": ab["name"], "lat": ab.get("lat"), "lon": ab.get("lon"), "coalition": "neutral"} for ab in raw]


CATEGORIES = ["plane", "helicopter", "vehicle", "ship", "static"]
COALITIONS = ["blue", "red", "neutrals"]


def extract_mission_from_miz(miz_bytes: bytes) -> str:
    """Extract the 'mission' Lua text from a .miz ZIP archive."""
    with zipfile.ZipFile(io.BytesIO(miz_bytes), "r") as zf:
        return zf.read("mission").decode("utf-8")


def _normalize_slpp_keys(obj):
    """Recursively convert integer-keyed dicts from slpp into lists where appropriate.

    slpp parses sequential Lua tables as dicts with int keys {1: ..., 2: ...}.
    The rest of the code expects lists for sequential data and dicts with string keys otherwise.
    """
    if isinstance(obj, dict):
        # Check if all keys are ints (sequential Lua table)
        if obj and all(isinstance(k, int) for k in obj.keys()):
            max_key = max(obj.keys())
            result = [_normalize_slpp_keys(obj.get(i)) for i in range(1, max_key + 1)]
            return result
        else:
            return {str(k) if isinstance(k, int) else k: _normalize_slpp_keys(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_normalize_slpp_keys(item) for item in obj]
    else:
        return obj


def parse_mission_text(text: str) -> dict:
    """Parse Lua mission text into a Python dict using slpp.

    Uses a fresh SLPP() instance per call — the default `slpp.slpp` is a
    module-level singleton with mutable parser state, which is NOT thread-safe
    under Flask's default threaded request handler.
    """
    # DCS mission files look like: mission = { ... }
    # Strip the variable assignment to get just the table
    match = re.search(r'^mission\s*=\s*', text, re.MULTILINE)
    if not match:
        raise ValueError("No 'mission' table found in Lua text")
    table_text = text[match.end():]
    lua = SLPP()
    mission = lua.decode(table_text)
    if mission is None:
        raise ValueError("Failed to parse mission Lua table")
    return _normalize_slpp_keys(mission)


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

    # Load static airbase data for this theater
    airbases = _load_theater_airbases(theater)

    coalition_data = mission_dict.get("coalition", {})
    for side in COALITIONS:
        side_data = coalition_data.get(side, {})

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

    drawings = _extract_drawings(mission_dict, theater, has_projection)
    trigger_zones = _extract_trigger_zones(mission_dict, theater, has_projection)
    mission_options = _extract_mission_options(mission_dict)

    return {
        "overview": overview,
        "groups": groups,
        "units": units,
        "threats": threats,
        "airbases": airbases,
        "drawings": drawings,
        "triggerZones": trigger_zones,
        "missionOptions": mission_options,
    }


def _parse_dcs_color(color_str: str) -> str:
    """Convert DCS color '0xRRGGBBAA' to CSS 'rgba(R,G,B,A)'."""
    if not color_str or not color_str.startswith("0x"):
        return "rgba(255,255,255,1)"
    try:
        hex_val = color_str[2:]
        r = int(hex_val[0:2], 16)
        g = int(hex_val[2:4], 16)
        b = int(hex_val[4:6], 16)
        a = int(hex_val[6:8], 16) / 255 if len(hex_val) >= 8 else 1
        return f"rgba({r},{g},{b},{a:.2f})"
    except (ValueError, IndexError):
        return "rgba(255,255,255,1)"


def _extract_drawings(d: dict, theater: str, has_projection: bool) -> list:
    """Extract map drawings from mission data."""
    drawings_data = d.get("drawings", {})
    layers = drawings_data.get("layers", {})
    if isinstance(layers, dict):
        layers = list(layers.values())

    result = []
    for layer in layers:
        if not isinstance(layer, dict):
            continue
        layer_name = layer.get("name", "")
        objects = layer.get("objects", {})
        if isinstance(objects, dict):
            objects = list(objects.values())

        for obj in objects:
            if not isinstance(obj, dict):
                continue
            if not obj.get("visible", True):
                continue

            ptype = obj.get("primitiveType", "")
            base_x = _num(obj.get("mapX"))
            base_y = _num(obj.get("mapY"))

            drawing = {
                "type": ptype,
                "name": obj.get("name", ""),
                "layer": layer_name,
                "color": _parse_dcs_color(obj.get("colorString", "")),
                "fillColor": _parse_dcs_color(obj.get("fillColorString", "")) if obj.get("fillColorString") else None,
                "thickness": _num(obj.get("thickness", 2)),
            }

            if ptype == "TextBox":
                drawing["text"] = obj.get("text", "") or obj.get("name", "")
                drawing["fontSize"] = _num(obj.get("fontSize", 12))
                if has_projection:
                    lat, lon = dcs_to_latlon(base_x, base_y, theater)
                    drawing["lat"] = lat
                    drawing["lon"] = lon

            elif ptype == "Line":
                raw_pts = obj.get("points", {})
                if isinstance(raw_pts, dict):
                    raw_pts = [raw_pts[k] for k in sorted(raw_pts.keys(), key=lambda k: int(k) if str(k).isdigit() else 0)]
                coords = []
                for pt in raw_pts:
                    if isinstance(pt, dict):
                        px = base_x + _num(pt.get("x"))
                        py = base_y + _num(pt.get("y"))
                        if has_projection:
                            lat, lon = dcs_to_latlon(px, py, theater)
                            coords.append([lon, lat])
                if coords:
                    drawing["coords"] = coords
                    drawing["closed"] = obj.get("closed", False)
                    drawing["style"] = obj.get("style", "solid")

            elif ptype == "Polygon":
                mode = obj.get("polygonMode", "")
                drawing["polygonMode"] = mode

                if mode == "circle":
                    drawing["radius"] = _num(obj.get("radius", 0))
                    if has_projection:
                        lat, lon = dcs_to_latlon(base_x, base_y, theater)
                        drawing["lat"] = lat
                        drawing["lon"] = lon

                else:
                    # rect, oval, free, arrow — all have pre-calculated points
                    raw_pts = obj.get("points", {})
                    if isinstance(raw_pts, dict):
                        raw_pts = [raw_pts[k] for k in sorted(raw_pts.keys(), key=lambda k: int(k) if str(k).isdigit() else 0)]
                    coords = []
                    for pt in raw_pts:
                        if isinstance(pt, dict):
                            px = base_x + _num(pt.get("x"))
                            py = base_y + _num(pt.get("y"))
                            if has_projection:
                                lat, lon = dcs_to_latlon(px, py, theater)
                                coords.append([lon, lat])
                    if coords:
                        drawing["coords"] = coords

            if drawing.get("coords") or drawing.get("lat") is not None or drawing.get("text"):
                result.append(drawing)

    return result


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
        "descriptionBlueTask": d.get("descriptionBlueTask", ""),
        "descriptionRedTask": d.get("descriptionRedTask", ""),
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
            "clouds_density": int(_num(wx.get("clouds", {}).get("density", 0))),
            "clouds_thickness": _num(wx.get("clouds", {}).get("thickness", 200)),
            "clouds_precipitation": int(_num(wx.get("clouds", {}).get("iprecptns", 0))),
            "clouds_preset": wx.get("clouds", {}).get("preset", ""),
            "visibility_m": _num(wx.get("visibility", {}).get("distance", 80000)),
            "fog_enabled": wx.get("enable_fog", False) or wx.get("fog2", {}).get("mode", 0) == 2,
            "fog_visibility": _num(wx.get("fog", {}).get("visibility", 0)),
            "fog_thickness": _num(wx.get("fog", {}).get("thickness", 0)),
            "dust_enabled": wx.get("enable_dust", False),
            "dust_density": _num(wx.get("dust_density", 0)),
            "turbulence": _num(wx.get("groundTurbulence", 0)),
            "halo_preset": wx.get("halo", {}).get("preset", "auto"),
        },
    }


def _extract_mission_options(d: dict) -> dict:
    """Extract forcedOptions and mission-level options from the mission dict.

    DCS forcedOptions controls what players can/cannot do:
    - labels, padlock, externalViews, birds, civTraffic, easyFlight, etc.
    These are set in the ME under 'Mission Options'.
    """
    forced = d.get("forcedOptions", {})
    if not isinstance(forced, dict):
        forced = {}

    # DCS stores these as nested dicts; flatten to simple key-value pairs
    # Boolean fields (true/false)
    bool_keys = [
        "padlock", "permitCrash", "immortal", "fuel",
        "miniHUD", "easyRadar", "easyFlight",
        "externalViews", "birds", "userMarks", "wakeTurbulence",
        "accidental_failures", "easyComms", "RBDAI",
    ]
    # Integer/enum fields
    enum_keys = [
        "labels", "civTraffic", "geffect", "optionsView",
    ]

    result: dict = {}
    for k in bool_keys:
        v = forced.get(k)
        if v is not None:
            result[k] = bool(v)
    for k in enum_keys:
        v = forced.get(k)
        if v is not None:
            result[k] = v

    # Also grab any keys we didn't explicitly list (future-proof)
    for k, v in forced.items():
        if k not in result:
            result[k] = v

    return result


def _extract_tacan_from_tasks(waypoints: list) -> dict | None:
    """Recursively search waypoint task dicts for ActivateBeacon TACAN params."""
    def _search(obj):
        if not isinstance(obj, dict):
            return None
        # Direct ActivateBeacon command
        if obj.get("id") == "ActivateBeacon":
            params = obj.get("params", {})
            ch = params.get("channel")
            if ch:
                return {
                    "channel": int(ch),
                    "band": "Y" if params.get("modeChannel") == "Y" or params.get("modeChannel") == 2 else "X",
                    "callsign": str(params.get("callsign", "")),
                }
        # WrappedAction containing an ActivateBeacon
        action = obj.get("action")
        if isinstance(action, dict):
            r = _search(action)
            if r:
                return r
        # ComboTask / list of tasks
        tasks = obj.get("tasks")
        if isinstance(tasks, dict):
            tasks = list(tasks.values())
        if isinstance(tasks, list):
            for t in tasks:
                r = _search(t)
                if r:
                    return r
        # Params may contain nested structures
        params = obj.get("params")
        if isinstance(params, dict):
            r = _search(params)
            if r:
                return r
        return None

    for wp in waypoints:
        task = wp.get("task")
        if task and isinstance(task, dict):
            result = _search(task)
            if result:
                return result
    return None


def _extract_icls_from_tasks(waypoints: list) -> dict | None:
    """Recursively search waypoint task dicts for ActivateICLS params."""
    def _search(obj):
        if not isinstance(obj, dict):
            return None
        if obj.get("id") == "ActivateICLS":
            params = obj.get("params", {})
            ch = params.get("channel")
            if ch:
                return {"channel": int(ch)}
        action = obj.get("action")
        if isinstance(action, dict):
            r = _search(action)
            if r:
                return r
        tasks = obj.get("tasks")
        if isinstance(tasks, dict):
            tasks = list(tasks.values())
        if isinstance(tasks, list):
            for t in tasks:
                r = _search(t)
                if r:
                    return r
        params = obj.get("params")
        if isinstance(params, dict):
            r = _search(params)
            if r:
                return r
        return None

    for wp in waypoints:
        task = wp.get("task")
        if task and isinstance(task, dict):
            result = _search(task)
            if result:
                return result
    return None


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

    # Extract TACAN beacon data from waypoint tasks (tankers, carriers)
    tacan = _extract_tacan_from_tasks(waypoints)
    icls = _extract_icls_from_tasks(waypoints)

    return {
        "groupId": group_id,
        "groupName": group_name,
        "coalition": coalition,
        "country": country,
        "category": category,
        "task": group.get("task", ""),
        "frequency": _num(group.get("frequency")),
        "modulation": group.get("modulation", 0),
        "tacan": tacan,
        "icls": icls,
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


def _find_unit_position(d: dict, unit_id: int) -> Optional[tuple]:
    """Find a unit's (x, y) position by unitId across all coalitions."""
    coalition_data = d.get("coalition", {})
    for side in ("blue", "red", "neutrals"):
        side_data = coalition_data.get(side, {})
        countries = side_data.get("country", {})
        if isinstance(countries, dict):
            countries = list(countries.values())
        for country in countries:
            if not isinstance(country, dict):
                continue
            for cat in ("plane", "helicopter", "vehicle", "ship", "static"):
                cat_data = country.get(cat, {})
                if not isinstance(cat_data, dict):
                    continue
                groups = cat_data.get("group", {})
                if isinstance(groups, dict):
                    groups = list(groups.values())
                for group in groups:
                    if not isinstance(group, dict):
                        continue
                    units = group.get("units", {})
                    if isinstance(units, dict):
                        units = list(units.values())
                    for u in units:
                        if not isinstance(u, dict):
                            continue
                        if u.get("unitId") == unit_id:
                            return (_num(u.get("x")), _num(u.get("y")))
    return None


def _extract_trigger_zones(d: dict, theater: str, has_projection: bool) -> list:
    """Extract trigger zones from the mission dict."""
    triggers = d.get("triggers", {})
    zones_data = triggers.get("zones", {})

    if isinstance(zones_data, list):
        zones_list = zones_data
    elif isinstance(zones_data, dict):
        zones_list = list(zones_data.values())
    else:
        return []

    zones = []
    for z in zones_list:
        if not isinstance(z, dict):
            continue

        x = _num(z.get("x"))
        y = _num(z.get("y"))
        radius = _num(z.get("radius", 0))
        name = z.get("name", "")
        zone_id = z.get("zoneId", 0)
        hidden = z.get("hidden", False)
        zone_type = z.get("type", 0)  # 0=circle, 2=polygon

        # Parse color
        color_data = z.get("color", {})
        if isinstance(color_data, dict):
            r = int(_num(color_data.get(1, color_data.get("1", 1))) * 255)
            g = int(_num(color_data.get(2, color_data.get("2", 1))) * 255)
            b = int(_num(color_data.get(3, color_data.get("3", 1))) * 255)
            a = _num(color_data.get(4, color_data.get("4", 0.15)))
            color = f"rgba({r},{g},{b},{a})"
        else:
            color = "rgba(255,255,255,0.15)"

        zone: Dict[str, Any] = {
            "zoneId": zone_id,
            "name": name,
            "x": x,
            "y": y,
            "radius": radius,
            "color": color,
            "hidden": hidden,
            "type": zone_type,
        }

        if has_projection and x and y:
            lat, lon = dcs_to_latlon(x, y, theater)
            zone["lat"] = lat
            zone["lon"] = lon

        # Polygon vertices (type 2)
        # When a zone has linkUnit, vertices are OFFSETS from the linked
        # unit's position, not absolute map coordinates.
        vertices = z.get("verticies", z.get("vertices", {}))
        if vertices:
            if isinstance(vertices, dict):
                verts_list = [vertices[k] for k in sorted(vertices.keys(), key=lambda k: int(k) if str(k).isdigit() else 0)]
            else:
                verts_list = vertices

            # Determine the actual center for offset calculation
            link_unit_id = z.get("linkUnit")
            offset_x, offset_y = 0.0, 0.0
            if link_unit_id is not None:
                unit_pos = _find_unit_position(d, link_unit_id)
                if unit_pos:
                    offset_x, offset_y = unit_pos

            coords = []
            for v in verts_list:
                if isinstance(v, dict):
                    vx = _num(v.get("x")) + offset_x
                    vy = _num(v.get("y")) + offset_y
                    if has_projection and vx and vy:
                        vlat, vlon = dcs_to_latlon(vx, vy, theater)
                        coords.append([vlat, vlon])
                    else:
                        coords.append([vx, vy])
            zone["vertices"] = coords

        zones.append(zone)

    return zones
