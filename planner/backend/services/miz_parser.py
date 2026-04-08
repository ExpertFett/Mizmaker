"""
.miz file parser — extracts mission data with full waypoint detail.

A .miz file is a ZIP archive containing Lua table files.
The 'mission' entry holds the main mission data as a Lua table.
We parse it with Lupa (LuaJIT runtime), then traverse the
coalition→country→category→group hierarchy.
"""

import io
import json
import zipfile
from typing import Dict, List, Any, Optional

import lupa

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


def _lua_table_to_python(lua_table):
    """Recursively convert a Lupa Lua table to Python dicts/lists."""
    if isinstance(lua_table, (str, int, float, bool, type(None))):
        return lua_table

    if not hasattr(lua_table, '__getitem__'):
        return str(lua_table)

    try:
        keys = list(lua_table)
    except Exception:
        return {}

    # Check if array (sequential int keys starting at 1)
    is_array = all(isinstance(k, (int, float)) for k in keys) and len(keys) > 0
    if is_array:
        max_idx = int(max(keys))
        result = []
        for i in range(1, max_idx + 1):
            try:
                val = lua_table[i]
                if isinstance(val, (str, int, float, bool, type(None))):
                    result.append(val)
                elif hasattr(val, '__getitem__'):
                    result.append(_lua_table_to_python(val))
                else:
                    result.append(str(val))
            except Exception:
                result.append(None)
        return result
    else:
        result = {}
        for key in keys:
            try:
                val = lua_table[key]
                k = str(key) if not isinstance(key, str) else key
                if isinstance(val, (str, int, float, bool, type(None))):
                    result[k] = val
                elif hasattr(val, '__getitem__'):
                    result[k] = _lua_table_to_python(val)
                else:
                    result[k] = str(val)
            except Exception:
                continue
        return result


def _create_sandboxed_lua():
    """Create a Lua runtime with dangerous globals removed.

    DCS .miz files are pure data (table assignments). They don't need os, io,
    or any module system. Removing these prevents a crafted .miz from executing
    arbitrary commands on the server.
    """
    lua = lupa.LuaRuntime(unpack_returned_tuples=True)
    lua.execute("""
        os = nil
        io = nil
        debug = nil
        loadfile = nil
        dofile = nil
        require = nil
        package = nil
        load = nil
    """)
    return lua


def parse_mission_text(text: str) -> dict:
    """Parse Lua mission text into a Python dict using Lupa (LuaJIT)."""
    lua_runtime = _create_sandboxed_lua()
    lua_runtime.execute(text)
    mission = lua_runtime.globals().mission
    if mission is None:
        raise ValueError("No 'mission' table found in Lua text")
    return _lua_table_to_python(mission)


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

    return {
        "overview": overview,
        "groups": groups,
        "units": units,
        "threats": threats,
        "airbases": airbases,
        "drawings": drawings,
        "triggerZones": trigger_zones,
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
        vertices = z.get("verticies", z.get("vertices", {}))
        if vertices:
            if isinstance(vertices, dict):
                verts_list = [vertices[k] for k in sorted(vertices.keys(), key=lambda k: int(k) if str(k).isdigit() else 0)]
            else:
                verts_list = vertices

            coords = []
            for v in verts_list:
                if isinstance(v, dict):
                    vx = _num(v.get("x"))
                    vy = _num(v.get("y"))
                    if has_projection and vx and vy:
                        vlat, vlon = dcs_to_latlon(vx, vy, theater)
                        coords.append([vlat, vlon])
                    else:
                        coords.append([vx, vy])
            zone["vertices"] = coords

        zones.append(zone)

    return zones
