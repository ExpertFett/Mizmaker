"""DTC (Data Transfer Cartridge) builder for DCS World.

Generates .dtc files (JSON) for F/A-18C Hornet from mission data.
Can also be used standalone to create/edit DTCs.
"""

import json
import os
import copy
import math


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


# SA-page defaults (added with the 2026 radar/SA DTC update). Mirrors a real
# exported Hornet DTC: declutter toggles per master-reject level (all on),
# datalink/sensor track symbology, and the empty CAP/corridor/FAOR-FLOT/MEZ
# lists. MEZ_THRTS is auto-filled at build time from the mission's threats.
def _dcltr_all_on():
    return {
        "Bullseye_TDC_Info": True, "CAP": True, "CORR": True, "Compase_Rose": True,
        "Countermeasure_Inventory": True, "FAOR": True, "FLOT": True, "Ground_Speed": True,
        "MEZ_Names": True, "MEZ_Rings": True, "SEQ": True, "Waypoint_Info": True,
    }

SA_DEFAULTS = {
    "CAP_PTS": [],
    "CORRIDORS": [],
    "Default_CAP_Point": 10,
    "Default_CORRIDORS_Point": 8,
    "Default_FAOR_Line": 4,
    "Default_FLOT_Line": 4,
    "Default_MEZ_THRTS_Level": 1,
    "FAOR_FLOT": {"FAOR": [], "FLOT": []},
    "MEZ_THRTS": [],
    "mirror_MEZ_THRTS": False,
    "SETTINGS": {
        "DCLTR_SETTINGS": {"MREJ1": _dcltr_all_on(), "MREJ2": _dcltr_all_on()},
        "SENSORS_SETTINGS": {
            "FF_tracks": True, "FRIEND_Symbols": 3, "PPLI_tracks": True,
            "RWR_Symbols": 1, "SURV_tracks": True, "UNK_tracks": True,
        },
    },
}


def _make_mez_threat(num, name="", x=0.0, y=0.0, threat_level=1, threat_ring_radius=1, threat_type="Custom"):
    """One SA-page MEZ threat entry. threat_type 'Custom' + level/radius mirror a
    hand-built DTC; real SAM-range mapping can refine radius once the unit is
    confirmed in-jet."""
    return {
        "id": f"MEZ_THRTS_{num}",
        "num": num,
        "text": str(name or "")[:24],
        "threat_level": int(threat_level),
        "threat_ring_radius": threat_ring_radius,
        "threat_type": threat_type,
        "x": x,
        "y": y,
    }


def _make_cap_point(num, note="", x=0.0, y=0.0, course=0, diameter=9260, length=37040, turn_direction="Left"):
    """One SA-page CAP point (race-track orbit marker). Mirrors a real exported
    DTC: id/num + position + leg geometry. `diameter` defaults to 9260 m (5 nm)
    and `length` to 37040 m (20 nm) — the same defaults the manual CAP editor
    uses — because a DCS Orbit task carries no track-width; the pilot can refine
    course/diameter/length in the SA subtab."""
    return {
        "id": f"CAP_PTS_{num}",
        "num": num,
        "note": str(note or "")[:24],
        "x": x,
        "y": y,
        "course": round(course),
        "diameter": round(diameter),
        "length": round(length),
        "turn_direction": turn_direction if turn_direction in ("Left", "Right") else "Left",
    }


def _find_orbit_task(task):
    """Return the params dict of the first Orbit task on a route point, or None.

    A .miz route point's task is `{"id":"ComboTask","params":{"tasks":{1:{...}}}}`
    where `tasks` is a Lua table (slpp → dict keyed 1..N, or a list). An orbit
    entry has `["id"] == "Orbit"` and `["params"]` carrying pattern/speed/altitude.
    """
    if not isinstance(task, dict):
        return None
    tasks = task.get("params", {}).get("tasks", {}) if isinstance(task.get("params"), dict) else {}
    if isinstance(tasks, dict):
        tasks = list(tasks.values())
    if not isinstance(tasks, list):
        return None
    for t in tasks:
        if isinstance(t, dict) and t.get("id") == "Orbit":
            params = t.get("params", {})
            return params if isinstance(params, dict) else {}
    return None


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

                    # Orbit waypoints → SA-page CAP markers. A Race-Track orbit
                    # uses this point + the next as the leg ends, so course/length
                    # come from the bearing/distance between them; a Circle orbit
                    # has no leg (course/length 0). DCS coords: x=north, y=east.
                    orbits = []
                    for i, pt in enumerate(points):
                        params = _find_orbit_task(pt.get("task"))
                        if params is None:
                            continue
                        ox, oy = pt.get("x", 0), pt.get("y", 0)
                        pattern = str(params.get("pattern", "") or "")
                        course, leg_len = 0.0, 0.0
                        if pattern.lower().startswith("race") and i + 1 < len(points):
                            nx, ny = points[i + 1].get("x", 0), points[i + 1].get("y", 0)
                            dx, dy = nx - ox, ny - oy
                            leg_len = math.hypot(dx, dy)
                            if leg_len > 0:
                                course = (math.degrees(math.atan2(dy, dx)) + 360) % 360
                        orbits.append({
                            "x": ox, "y": oy,
                            "name": pt.get("name", "") or "CAP",
                            "pattern": pattern,
                            "course": course,
                            "length": leg_len,
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
                        "orbits": orbits,  # → SA-page CAP_PTS auto-fill
                        "radios": radios,
                        "theatre": mission.get("theatre", ""),
                        "group_name": group_name,
                        "aircraft_type": aircraft_type,
                        "side": coal_name,  # 'red'/'blue' — used to pick enemy threats for the SA page
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

    # SA page (2026 radar/SA DTC update). Start from defaults, then drop the
    # mission's threats onto the page as MEZ markers (name + position). Only the
    # flight's enemy threats are included when a side is known.
    sa = copy.deepcopy(SA_DEFAULTS)
    flight_side = flight_data.get("side")
    threats = flight_data.get("threats", []) or []
    num = 0
    for t in threats:
        if flight_side and t.get("coalition") and t.get("coalition") == flight_side:
            continue  # skip friendly threats
        num += 1
        # threat_ring_radius is in NAUTICAL MILES on the SA page (confirmed
        # against a real DTC: SA-9 4.2km→2.268nm, Hawk 45km→24.3nm). The
        # mission threat's `range` is in metres → nm = m / 1852. Falls back to
        # a 1 nm marker when the threat has no defined range.
        rng_m = t.get("range") or 0
        radius_nm = round(rng_m / 1852.0, 3) if rng_m else 1
        sa["MEZ_THRTS"].append(_make_mez_threat(
            num,
            name=t.get("name", "") or t.get("type", ""),
            x=t.get("x", 0),
            y=t.get("y", 0),
            threat_ring_radius=radius_nm,
        ))

    # CAP points auto-filled from the flight's orbit waypoints (only when none
    # are set yet, so a user's hand-built CAP track is never clobbered).
    orbits = flight_data.get("orbits", []) or []
    if orbits and not sa["CAP_PTS"]:
        for j, o in enumerate(orbits, 1):
            sa["CAP_PTS"].append(_make_cap_point(
                j,
                note=o.get("name", ""),
                x=o.get("x", 0),
                y=o.get("y", 0),
                course=o.get("course", 0),
                length=o.get("length", 0) or 37040,
                diameter=9260,
                turn_direction="Left",
            ))

    dtc = {
        "data": {
            "ALR67": alr67,
            "COMM": comm,
            "name": dtc_name,
            "SA": sa,
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

    # Frontend dtcData sends the full uppercase COMM block (the DTC tab edits
    # data.COMM.COMMx.Channel_N in place). The editor stores freqs/mods as
    # strings and uses CUE/GUARD/MAN/MAR_S for the special channels — coerce to
    # numbers and alias onto the real Channel_C/G/M/S. We only write to channels
    # that already exist, so a stray editor-only key can never reach the file.
    fe_comm = edits.get("COMM")
    if isinstance(fe_comm, dict):
        SPECIAL_ALIAS = {"CUE": "Channel_C", "GUARD": "Channel_G", "MAN": "Channel_M", "MAR_S": "Channel_S"}
        for comm_key in ("COMM1", "COMM2"):
            fe_radio = fe_comm.get(comm_key)
            real_radio = data["COMM"].get(comm_key)
            if not isinstance(fe_radio, dict) or not isinstance(real_radio, dict):
                continue
            for fe_key, ch in fe_radio.items():
                if not isinstance(ch, dict):
                    continue
                real_key = fe_key if fe_key in real_radio else SPECIAL_ALIAS.get(fe_key)
                if not real_key or real_key not in real_radio:
                    continue
                upd = {}
                if ch.get("frequency") not in (None, ""):
                    try:
                        upd["frequency"] = float(ch["frequency"])
                    except (TypeError, ValueError):
                        pass
                mod = ch.get("modulation")
                if mod is not None:
                    # Display shape uses 'AM'/'FM'; the file uses 0/1 (AM=0, FM=1).
                    if isinstance(mod, str) and mod.strip().upper() in ("AM", "FM"):
                        upd["modulation"] = 0 if mod.strip().upper() == "AM" else 1
                    else:
                        try:
                            upd["modulation"] = int(float(mod))
                        except (TypeError, ValueError):
                            pass
                if ch.get("name") is not None:
                    upd["name"] = str(ch["name"])
                if upd:
                    real_radio[real_key].update(upd)

    # Frontend dtcData sends CMDS as a top-level uppercase map of the display
    # shape ({chaffQty, chaffInterval, flareQty, flareInterval}). Map it onto the
    # real ALR67.CMDS.CMDSProgramSettings[<prog>].{Chaff,Flare}. We only touch
    # Quantity (and Interval where the real dispenser already carries one — the
    # exported Flare schema has Quantity only), so Repeat/Other1/Other2 survive.
    fe_cmds = edits.get("CMDS")
    if isinstance(fe_cmds, dict):
        programs = data.get("ALR67", {}).get("CMDS", {}).get("CMDSProgramSettings", {})

        def _set_int(d, key, val):
            try:
                d[key] = int(float(val))
            except (TypeError, ValueError):
                pass

        def _set_interval(d, val):
            # Only write Interval onto a dispenser that already exposes one,
            # so we don't bolt a field onto the exported Flare schema.
            if "Interval" in d:
                try:
                    d["Interval"] = float(val)
                except (TypeError, ValueError):
                    pass

        for prog_name, vals in fe_cmds.items():
            if prog_name not in programs or not isinstance(vals, dict):
                continue
            prog = programs[prog_name]
            if not isinstance(prog, dict):
                continue  # CMDSProgramSettings also holds scalars (e.g. delay_between_programs)
            chaff = prog.setdefault("Chaff", {"Quantity": 0})
            flare = prog.setdefault("Flare", {"Quantity": 0})
            if vals.get("chaffQty") is not None:
                _set_int(chaff, "Quantity", vals["chaffQty"])
            if vals.get("chaffInterval") is not None:
                _set_interval(chaff, vals["chaffInterval"])
            if vals.get("flareQty") is not None:
                _set_int(flare, "Quantity", vals["flareQty"])
            if vals.get("flareInterval") is not None:
                _set_interval(flare, vals["flareInterval"])

    # Frontend dtcData sends WYPT.NAV_SETTINGS in the display shape
    # (TACAN {channel,band,mode,enabled}, ICLS {channel,enabled},
    # ACLS {frequency,enabled}). Map back to the real keys. ChannelMode/Mode
    # enums: X/T-R = 1 (confirmed against real exported DTCs); Y = 2 and
    # A-A = 2 are best-effort and only applied on an explicit user change —
    # an untouched TACAN round-trips its loaded value exactly.
    fe_wypt = edits.get("WYPT")
    if isinstance(fe_wypt, dict) and isinstance(fe_wypt.get("NAV_SETTINGS"), dict):
        fe_nav = fe_wypt["NAV_SETTINGS"]
        real_nav = data["WYPT"]["NAV_SETTINGS"]
        ft = fe_nav.get("TACAN")
        if isinstance(ft, dict):
            rt = real_nav.setdefault("TACAN", {"Channel": 1, "ChannelMode": 1, "Mode": 1, "OnOff": False})
            if ft.get("channel") is not None:
                try:
                    rt["Channel"] = int(float(ft["channel"]))
                except (TypeError, ValueError):
                    pass
            if isinstance(ft.get("band"), str):
                rt["ChannelMode"] = 2 if ft["band"].strip().upper() == "Y" else 1
            if isinstance(ft.get("mode"), str):
                rt["Mode"] = 2 if ft["mode"].strip().upper().replace("/", "-") in ("A-A", "AA") else 1
            if "enabled" in ft:
                rt["OnOff"] = bool(ft["enabled"])
        fi = fe_nav.get("ICLS")
        if isinstance(fi, dict):
            ri = real_nav.setdefault("ICLS", {"Channel": 1, "OnOff": False})
            if fi.get("channel") is not None:
                try:
                    ri["Channel"] = int(float(fi["channel"]))
                except (TypeError, ValueError):
                    pass
            if "enabled" in fi:
                ri["OnOff"] = bool(fi["enabled"])
        fa = fe_nav.get("ACLS")
        if isinstance(fa, dict):
            ra = real_nav.setdefault("ACLS", {"Frequency": 0, "OnOff": False})
            if fa.get("frequency") not in (None, ""):
                try:
                    ra["Frequency"] = float(fa["frequency"])
                except (TypeError, ValueError):
                    pass
            if "enabled" in fa:
                ra["OnOff"] = bool(fa["enabled"])

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

    # Full SA object straight from the frontend dtcData (the SA subtab edits the
    # auto-filled SA in place, then export sends the whole data block). Takes
    # precedence — it already contains the user's declutter/sensor/MEZ choices.
    if isinstance(edits.get("SA"), dict):
        data["SA"] = edits["SA"]

    # SA-page edits. `sa` can carry:
    #   declutter: {MREJ1: {...bool}, MREJ2: {...bool}}
    #   sensors:   {FF_tracks, FRIEND_Symbols, PPLI_tracks, RWR_Symbols, SURV_tracks, UNK_tracks}
    #   mez_threats: [{text, x, y, threat_level, threat_ring_radius, threat_type}, ...]  (full replace)
    if "sa" in edits:
        sa_data = data.setdefault("SA", copy.deepcopy(SA_DEFAULTS))
        sa_edit = edits["sa"] or {}
        if "declutter" in sa_edit:
            dcl = sa_data["SETTINGS"]["DCLTR_SETTINGS"]
            for mrej, vals in sa_edit["declutter"].items():
                if mrej in dcl and isinstance(vals, dict):
                    dcl[mrej].update(vals)
        if "sensors" in sa_edit and isinstance(sa_edit["sensors"], dict):
            sa_data["SETTINGS"]["SENSORS_SETTINGS"].update(sa_edit["sensors"])
        if "mez_threats" in sa_edit and isinstance(sa_edit["mez_threats"], list):
            sa_data["MEZ_THRTS"] = [
                _make_mez_threat(
                    i + 1,
                    name=m.get("text", ""),
                    x=m.get("x", 0),
                    y=m.get("y", 0),
                    threat_level=m.get("threat_level", 1),
                    threat_ring_radius=m.get("threat_ring_radius", 1),
                    threat_type=m.get("threat_type", "Custom"),
                )
                for i, m in enumerate(sa_edit["mez_threats"])
            ]

    return dtc


def serialize_dtc(dtc: dict) -> bytes:
    """Serialize a DTC dict to JSON bytes matching DCS formatting."""
    return json.dumps(dtc, indent=4, ensure_ascii=False).encode("utf-8")
