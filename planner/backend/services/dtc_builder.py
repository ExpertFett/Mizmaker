"""DTC (Data Transfer Cartridge) builder for DCS World.

Generates .dtc files (JSON) for F/A-18C Hornet from mission data.
Can also be used standalone to create/edit DTCs.
"""

import json
import os
import copy


def _load_defaults():
    """Load the default ALR67 (RWR + CMDS threat tables) template."""
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "dtc_defaults_fa18.json")
    # encoding='utf-8' is required: Windows defaults to cp1252 and the
    # threat-table file may contain unicode characters in airframe names
    # / threat descriptions.
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


FA18_DEFAULTS = _load_defaults()

# Default COMM channel template
_DEFAULT_COMM_CHANNEL = {"frequency": 305.0, "modulation": 0, "name": ""}

# Default waypoint template
_DEFAULT_WAYPOINT = {
    "alt": 0,
    "altitudeType": 1,  # 1=BARO(MSL), 0=RADIO(AGL)
    "id": "STPT1",
    "idOA": "OA1",
    "idOA_Line": "OA1Line",
    "isOA": False,
    "note": "",
    "OA_Alt": 0,
    "OA_Bearing": 0,
    "OA_Bearing_Units": 1,
    "OA_DeltaX": 0,
    "OA_DeltaY": 0,
    "OA_Elevation_Units": 1,
    "OA_Range": 0,
    "OA_Range_Units": 1,
    "OA_X": 0,
    "OA_Y": 0,
    "R1": False,
    "R2": False,
    "R3": False,
    "text_note": "",
    "velocityType": 3,
    "wypt_num": 1,
    "x": 0,
    "y": 0,
}


def _make_comm_channel(num, frequency=305.0, modulation=0, name=""):
    """Create a single COMM channel entry."""
    if not name:
        name = f"CH {num}" if isinstance(num, int) else num
    return {"frequency": frequency, "modulation": modulation, "name": name}


def _make_default_comm():
    """Create default COMM section with empty channels."""
    comm = {}
    for i in range(1, 21):
        comm[f"Channel_{i}"] = _make_comm_channel(i)
    # Special channels
    comm["Channel_C"] = _make_comm_channel("CUE", 30.0, 1, "CUE")
    comm["Channel_G"] = _make_comm_channel("GUARD", 243.0, 0, "GUARD")
    comm["Channel_M"] = _make_comm_channel("MAN", 305.0, 0, "MAN")
    comm["Channel_S"] = _make_comm_channel("MAR", 156.05, 1, "MAR")
    return comm


def _make_waypoint(num, x=0, y=0, alt=0, alt_type=1, name=""):
    """Create a single waypoint entry."""
    wp = copy.deepcopy(_DEFAULT_WAYPOINT)
    wp["wypt_num"] = num
    wp["id"] = f"STPT{num}"
    wp["idOA"] = f"OA{num}"
    wp["idOA_Line"] = f"OA{num}Line"
    wp["x"] = x
    wp["y"] = y
    wp["alt"] = alt
    wp["altitudeType"] = alt_type
    wp["text_note"] = name
    return wp


def _alt_type_to_int(alt_type_str):
    """Convert miz alt_type string to DTC integer."""
    if alt_type_str == "RADIO":
        return 0
    return 1  # BARO is default


def extract_flight_for_dtc(mission: dict, group_name: str):
    """Extract waypoints and radio data for a specific flight from a parsed mission.

    Returns dict with keys: waypoints, radios, theatre, group_name, aircraft_type
    """
    coalitions = mission.get("coalition", {})
    for coal_name, coal in coalitions.items():
        countries = coal.get("country", {})
        if isinstance(countries, dict):
            countries = list(countries.values())
        for country in countries:
            if not isinstance(country, dict):
                continue
            for cat in ("plane", "helicopter"):
                cat_data = country.get(cat, {})
                if not cat_data:
                    continue
                groups = cat_data.get("group", {})
                if isinstance(groups, dict):
                    groups = list(groups.values())
                for group in groups:
                    if not isinstance(group, dict):
                        continue
                    if group.get("name") != group_name:
                        continue

                    # Found the group — extract waypoints from route
                    route = group.get("route", {})
                    points = route.get("points", {})
                    if isinstance(points, dict):
                        points = list(points.values())

                    waypoints = []
                    for i, pt in enumerate(points):
                        waypoints.append({
                            "x": pt.get("x", 0),
                            "y": pt.get("y", 0),
                            "alt": pt.get("alt", 0),
                            "alt_type": pt.get("alt_type", "BARO"),
                            "name": pt.get("name", ""),
                            "action": pt.get("action", ""),
                            "type": pt.get("type", ""),
                            "speed": pt.get("speed", 0),
                        })

                    # Get radio data from first unit
                    units = group.get("units", {})
                    if isinstance(units, dict):
                        units = list(units.values())
                    first_unit = units[0] if units else {}
                    radios = first_unit.get("Radio", {})
                    aircraft_type = first_unit.get("type", "")

                    return {
                        "waypoints": waypoints,
                        "radios": radios,
                        "theatre": mission.get("theatre", ""),
                        "group_name": group_name,
                        "aircraft_type": aircraft_type,
                    }

    return None


def build_dtc_from_flight(flight_data: dict, dtc_name: str = None):
    """Build a complete F/A-18C DTC JSON from extracted flight data.

    flight_data: output of extract_flight_for_dtc()
    Returns the full DTC dict ready for JSON serialization.
    """
    if dtc_name is None:
        dtc_name = flight_data.get("group_name", "MizFix DTC")

    # Start with ALR67 defaults (RWR + threat tables + CMDS programs)
    alr67 = copy.deepcopy(FA18_DEFAULTS["ALR67"])

    # Build COMM from mission radios
    comm = {"mirror_COMM1": False, "mirror_COMM2": False}
    miz_radios = flight_data.get("radios", {})
    # Radio data may be a list (from slpp normalization) or dict
    def _radio_get(data, key, default=None):
        """Get from dict or list (1-indexed)."""
        if isinstance(data, dict):
            return data.get(key, data.get(str(key), default))
        if isinstance(data, list):
            idx = int(key) - 1 if isinstance(key, (int, float)) else int(key) - 1
            return data[idx] if 0 <= idx < len(data) else default
        return default

    for radio_num in (1, 2):
        miz_radio = _radio_get(miz_radios, radio_num, {}) or {}
        if not isinstance(miz_radio, dict):
            miz_radio = {}
        miz_channels = miz_radio.get("channels", {})
        miz_modulations = miz_radio.get("modulations", {})
        miz_names = miz_radio.get("channelsNames", {})
        # Normalize lists to dicts for iteration
        if isinstance(miz_channels, list):
            miz_channels = {i+1: v for i, v in enumerate(miz_channels) if v is not None}
        if isinstance(miz_modulations, list):
            miz_modulations = {i+1: v for i, v in enumerate(miz_modulations) if v is not None}
        if isinstance(miz_names, list):
            miz_names = {str(i+1): v for i, v in enumerate(miz_names) if v is not None}

        radio_comm = _make_default_comm()
        for ch_num, freq in miz_channels.items():
            ch_key = f"Channel_{ch_num}"
            if ch_key in radio_comm:
                mod = miz_modulations.get(ch_num, 0)
                name = miz_names.get(str(ch_num), f"CH {ch_num}")
                radio_comm[ch_key] = _make_comm_channel(ch_num, freq, mod, name)

        comm[f"COMM{radio_num}"] = radio_comm

    # Build waypoints
    nav_pts = []
    miz_waypoints = flight_data.get("waypoints", [])
    for i, wp in enumerate(miz_waypoints):
        stpt_num = i + 1
        alt_type_int = _alt_type_to_int(wp.get("alt_type", "BARO"))
        nav_wp = _make_waypoint(
            num=stpt_num,
            x=wp["x"],
            y=wp["y"],
            alt=round(wp.get("alt", 0)),
            alt_type=alt_type_int,
            name=wp.get("name", ""),
        )
        nav_pts.append(nav_wp)

    wypt = {
        "mirror_NAV_PTS": False,
        "NAV_PTS": nav_pts,
        "NAV_ROUTE": [[], [], []],
        "NAV_SETTINGS": {
            "AA_Waypoint": {"AA_WP_Enabled": True, "AA_WP_Number": 59},
            "ACLS": {"Frequency": 225, "OnOff": False},
            "Altitude_Warning": {"Warn_Alt_Baro": 2000, "Warn_Alt_Rdr": 500},
            "Home_Waypoint": {"FPAS_HOME_WP": 1},
            "ICLS": {"Channel": 1, "OnOff": False},
            "TACAN": {
                "Channel": 1,
                "ChannelMode": 1,
                "Mode": 1,
                "OnOff": False,
            },
        },
        "terrain": flight_data.get("theatre", ""),
    }

    dtc = {
        "data": {
            "ALR67": alr67,
            "COMM": comm,
            "name": dtc_name,
            "TCN": [],
            "terrain": flight_data.get("theatre", ""),
            "type": "FA-18C_hornet",
            "WYPT": wypt,
        },
        "name": dtc_name,
        "type": "FA-18C_hornet",
    }

    return dtc


def build_dtc_from_edits(base_dtc: dict, edits: dict):
    """Apply user edits to a DTC dict.

    edits can contain:
      - comm1: {channel_num: {frequency, modulation, name}, ...}
      - comm2: same
      - cmds: {program_name: {Chaff: {...}, Flare: {...}, ...}, ...}
      - waypoints: [{wypt_num, x, y, alt, altitudeType, text_note}, ...]
      - tacan: {Channel, ChannelMode, Mode, OnOff}
      - icls: {Channel, OnOff}
      - acls: {Frequency, OnOff}
      - alt_warning: {Warn_Alt_Baro, Warn_Alt_Rdr}
      - name: str
    """
    dtc = copy.deepcopy(base_dtc)
    data = dtc["data"]

    if "name" in edits:
        data["name"] = edits["name"]
        dtc["name"] = edits["name"]

    # COMM edits
    for radio_key in ("comm1", "comm2"):
        if radio_key in edits:
            comm_key = radio_key.upper()  # COMM1 or COMM2
            for ch_str, ch_data in edits[radio_key].items():
                ch_key = f"Channel_{ch_str}"
                if ch_key in data["COMM"][comm_key]:
                    data["COMM"][comm_key][ch_key].update(ch_data)

    # CMDS edits
    if "cmds" in edits:
        programs = data["ALR67"]["CMDS"]["CMDSProgramSettings"]
        for prog_name, prog_data in edits["cmds"].items():
            if prog_name in programs:
                for dispenser, values in prog_data.items():
                    if dispenser in programs[prog_name]:
                        programs[prog_name][dispenser].update(values)

    # Waypoint edits
    if "waypoints" in edits:
        nav_pts = data["WYPT"]["NAV_PTS"]
        for wp_edit in edits["waypoints"]:
            wnum = wp_edit.get("wypt_num")
            # Find existing or append
            found = False
            for wp in nav_pts:
                if wp["wypt_num"] == wnum:
                    wp.update({k: v for k, v in wp_edit.items()
                              if k in wp})
                    found = True
                    break
            if not found:
                nav_pts.append(_make_waypoint(
                    num=wnum,
                    x=wp_edit.get("x", 0),
                    y=wp_edit.get("y", 0),
                    alt=wp_edit.get("alt", 0),
                    alt_type=wp_edit.get("altitudeType", 1),
                    name=wp_edit.get("text_note", ""),
                ))

    # NAV settings edits
    settings = data["WYPT"]["NAV_SETTINGS"]
    if "tacan" in edits:
        settings["TACAN"].update(edits["tacan"])
    if "icls" in edits:
        settings["ICLS"].update(edits["icls"])
    if "acls" in edits:
        settings["ACLS"].update(edits["acls"])
    if "alt_warning" in edits:
        settings["Altitude_Warning"].update(edits["alt_warning"])

    return dtc


def serialize_dtc(dtc: dict) -> bytes:
    """Serialize a DTC dict to JSON bytes matching DCS formatting."""
    return json.dumps(dtc, indent=4, ensure_ascii=False).encode("utf-8")
