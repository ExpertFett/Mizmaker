"""DTC SA-page section (2026 radar/SA DTC update).

Locks the SA section the builder now emits: declutter (MREJ1/2), sensor track
settings, and MEZ_THRTS auto-filled from mission threats (enemy side only),
plus the `sa` edit path. Schema mirrors a real exported Hornet DTC.
"""
from services.dtc_builder import build_dtc_from_flight, build_dtc_from_edits

SA_TOP_KEYS = {
    "CAP_PTS", "CORRIDORS", "Default_CAP_Point", "Default_CORRIDORS_Point",
    "Default_FAOR_Line", "Default_FLOT_Line", "Default_MEZ_THRTS_Level",
    "FAOR_FLOT", "MEZ_THRTS", "mirror_MEZ_THRTS", "SETTINGS",
}
MEZ_KEYS = {"id", "num", "text", "threat_level", "threat_ring_radius", "threat_type", "x", "y"}
DCLTR_KEYS = {
    "Bullseye_TDC_Info", "CAP", "CORR", "Compase_Rose", "Countermeasure_Inventory",
    "FAOR", "FLOT", "Ground_Speed", "MEZ_Names", "MEZ_Rings", "SEQ", "Waypoint_Info",
}


def _flight(threats=None, side="blue", orbits=None):
    return {
        "waypoints": [{"x": 1, "y": 2, "alt": 1000, "alt_type": "BARO", "name": "WP1"}],
        "orbits": orbits or [],
        "radios": {}, "theatre": "Caucasus", "group_name": "Uzi",
        "aircraft_type": "FA-18C_hornet", "side": side, "threats": threats or [],
    }


def test_sa_section_present_and_shaped():
    dtc = build_dtc_from_flight(_flight(), "T")
    sa = dtc["data"]["SA"]
    assert set(sa.keys()) == SA_TOP_KEYS
    assert set(sa["SETTINGS"]["DCLTR_SETTINGS"]["MREJ1"].keys()) == DCLTR_KEYS
    assert set(sa["SETTINGS"]["DCLTR_SETTINGS"]["MREJ2"].keys()) == DCLTR_KEYS
    sensors = sa["SETTINGS"]["SENSORS_SETTINGS"]
    assert sensors["FRIEND_Symbols"] == 3 and sensors["RWR_Symbols"] == 1
    assert sa["MEZ_THRTS"] == []  # no threats → empty


def test_mez_autofill_filters_to_enemy():
    threats = [
        {"name": "RIVER SA-10", "type": "S-300", "x": -289055.21, "y": 625158.97, "coalition": "red", "range": 45000},
        {"name": "WASP SA-6", "type": "Kub", "x": -280744.69, "y": 624980.25, "coalition": "red"},
        {"name": "FRIENDLY", "type": "Patriot", "x": 1, "y": 2, "coalition": "blue", "range": 100000},
    ]
    sa = build_dtc_from_flight(_flight(threats, side="blue"), "T")["data"]["SA"]
    assert len(sa["MEZ_THRTS"]) == 2  # blue friendly dropped
    m = sa["MEZ_THRTS"][0]
    assert set(m.keys()) == MEZ_KEYS
    assert m["text"] == "RIVER SA-10" and m["x"] == -289055.21
    assert m["threat_type"] == "Custom" and m["id"] == "MEZ_THRTS_1"
    # threat_ring_radius is nautical miles = range_m / 1852 (45 km → 24.298 nm)
    assert m["threat_ring_radius"] == round(45000 / 1852.0, 3)
    # no-range threat falls back to a 1 nm marker
    assert sa["MEZ_THRTS"][1]["threat_ring_radius"] == 1


def test_mez_autofill_includes_all_when_side_unknown():
    threats = [{"name": "X", "type": "S-300", "x": 1, "y": 2, "coalition": "red"}]
    f = _flight(threats); f["side"] = None
    sa = build_dtc_from_flight(f, "T")["data"]["SA"]
    assert len(sa["MEZ_THRTS"]) == 1


def test_comm_export_reconcile():
    """Frontend dtcData COMM edits (string freqs, AM/FM modulation, CUE/GUARD
    aliases) reach the exported .dtc as numbers on the real channel keys."""
    dtc = build_dtc_from_flight(_flight(), "T")
    fe = {  # what the DTC tab sends back as edits["COMM"]
        "COMM1": {
            "Channel_1": {"frequency": "251.0", "modulation": "FM", "name": "STRIKE"},
            "Channel_2": {"frequency": "305.0", "modulation": "AM", "name": "TWR"},
            "Channel_3": {"frequency": "256.0", "modulation": "1"},   # legacy int form still ok
            "CUE": {"frequency": "30.0"},          # special-channel alias → Channel_C
            "BOGUS": {"frequency": "1"},            # editor-only key → must be ignored
        },
    }
    out = build_dtc_from_edits(dtc, {"COMM": fe})["data"]["COMM"]
    c1 = out["COMM1"]["Channel_1"]
    assert c1["frequency"] == 251.0 and isinstance(c1["frequency"], float)
    assert c1["modulation"] == 1 and isinstance(c1["modulation"], int)   # FM → 1
    assert c1["name"] == "STRIKE"
    assert out["COMM1"]["Channel_2"]["modulation"] == 0                  # AM → 0
    assert out["COMM1"]["Channel_3"]["modulation"] == 1                  # "1" → 1
    assert out["COMM1"]["Channel_C"]["frequency"] == 30.0               # CUE aliased
    assert "BOGUS" not in out["COMM1"]                                   # stray key never injected


def test_cmds_export_reconcile():
    """Frontend dtcData CMDS (flat display shape) maps onto the real nested
    ALR67.CMDS.CMDSProgramSettings, preserving Repeat/Other1/Other2."""
    dtc = build_dtc_from_flight(_flight(), "T")
    progs = dtc["data"]["ALR67"]["CMDS"]["CMDSProgramSettings"]
    # capture a Repeat to prove it survives the overlay
    repeat_before = progs["AUTO_1"]["Chaff"].get("Repeat")
    fe = {
        "AUTO_1": {"chaffQty": 8, "chaffInterval": 0.25, "flareQty": 4, "flareInterval": 0.5},
        # CMDSProgramSettings carries this scalar alongside the programs; the
        # frontend echoes it back. The reconcile must skip it, not crash on it
        # (regression: 'int' object has no attribute 'setdefault' → export 500).
        "delay_between_programs": {"chaffQty": 0, "chaffInterval": 0, "flareQty": 0, "flareInterval": 0},
    }
    out = build_dtc_from_edits(dtc, {"CMDS": fe})["data"]["ALR67"]["CMDS"]["CMDSProgramSettings"]
    assert not isinstance(out["delay_between_programs"], dict)  # scalar left untouched
    assert out["AUTO_1"]["Chaff"]["Quantity"] == 8
    assert out["AUTO_1"]["Chaff"]["Interval"] == 0.25
    assert out["AUTO_1"]["Flare"]["Quantity"] == 4
    # Repeat (a field the display shape doesn't model) is untouched
    assert out["AUTO_1"]["Chaff"].get("Repeat") == repeat_before
    # Flare has no Interval in the real schema → we don't bolt one on
    assert "Interval" not in out["AUTO_1"]["Flare"]


def test_nav_export_reconcile():
    """Frontend dtcData WYPT.NAV_SETTINGS (display keys) maps back to the real
    TACAN/ICLS/ACLS keys with the X/T-R = 1 enum."""
    dtc = build_dtc_from_flight(_flight(), "T")
    fe = {"NAV_SETTINGS": {
        "TACAN": {"channel": 31, "band": "X", "mode": "T-R", "enabled": True},
        "ICLS": {"channel": 8, "enabled": True},
        "ACLS": {"frequency": "336", "enabled": False},
    }}
    nav = build_dtc_from_edits(dtc, {"WYPT": fe})["data"]["WYPT"]["NAV_SETTINGS"]
    assert nav["TACAN"] == {"Channel": 31, "ChannelMode": 1, "Mode": 1, "OnOff": True}
    assert nav["ICLS"]["Channel"] == 8 and nav["ICLS"]["OnOff"] is True
    assert nav["ACLS"]["Frequency"] == 336.0 and nav["ACLS"]["OnOff"] is False
    # Y band / A-A mode take the best-effort enum (2) when explicitly chosen
    nav2 = build_dtc_from_edits(dtc, {"WYPT": {"NAV_SETTINGS": {
        "TACAN": {"channel": 47, "band": "Y", "mode": "A-A", "enabled": True}}}})["data"]["WYPT"]["NAV_SETTINGS"]
    assert nav2["TACAN"]["ChannelMode"] == 2 and nav2["TACAN"]["Mode"] == 2


def test_cap_autofill_from_orbit():
    """Race-Track orbit waypoints auto-populate SA-page CAP_PTS with the leg
    bearing/length; an existing CAP track is never clobbered."""
    orbits = [{"x": -700000.0, "y": -110000.0, "name": "CAP NORTH",
               "pattern": "Race-Track", "course": 90.0, "length": 37040.0}]
    sa = build_dtc_from_flight(_flight(orbits=orbits), "T")["data"]["SA"]
    assert len(sa["CAP_PTS"]) == 1
    cap = sa["CAP_PTS"][0]
    assert cap["id"] == "CAP_PTS_1" and cap["num"] == 1
    assert cap["note"] == "CAP NORTH"
    assert cap["x"] == -700000.0 and cap["y"] == -110000.0
    assert cap["course"] == 90 and cap["length"] == 37040
    assert cap["diameter"] == 9260 and cap["turn_direction"] == "Left"
    # no orbits → no CAP points
    assert build_dtc_from_flight(_flight(), "T")["data"]["SA"]["CAP_PTS"] == []


def test_extract_detects_orbit_waypoints():
    """extract_flight_for_dtc finds an Orbit task on a route point and computes
    the race-track leg course/length from this point → the next point."""
    from services.dtc_builder import extract_flight_for_dtc
    mission = {
        "theatre": "Caucasus",
        "coalition": {"blue": {"country": [{"plane": {"group": [{
            "name": "Uzi",
            "route": {"points": [
                {"x": 0.0, "y": 0.0, "name": "TAKEOFF"},
                {"x": 0.0, "y": 1000.0, "name": "CAP", "task": {
                    "id": "ComboTask", "params": {"tasks": {
                        1: {"id": "Orbit", "params": {"pattern": "Race-Track"}}}}}},
                {"x": 0.0, "y": 2000.0, "name": "CAP END"},
            ]},
            "units": [{"type": "FA-18C_hornet", "Radio": {}}],
        }]}}]}},
    }
    fd = extract_flight_for_dtc(mission, "Uzi")
    assert fd is not None and len(fd["orbits"]) == 1
    o = fd["orbits"][0]
    assert o["name"] == "CAP" and o["x"] == 0.0 and o["y"] == 1000.0
    # leg runs +1000 m east (y) → course 090, length 1000 m
    assert round(o["course"]) == 90 and round(o["length"]) == 1000


def test_sa_edits_apply():
    dtc = build_dtc_from_flight(_flight(), "T")
    edited = build_dtc_from_edits(dtc, {"sa": {
        "declutter": {"MREJ1": {"FLOT": False, "CAP": False}},
        "sensors": {"FRIEND_Symbols": 1, "UNK_tracks": False},
        "mez_threats": [{"text": "NEMO", "x": -270499.8, "y": 632938.4, "threat_level": 2, "threat_ring_radius": 40}],
    }})
    sa = edited["data"]["SA"]
    dcl = sa["SETTINGS"]["DCLTR_SETTINGS"]["MREJ1"]
    assert dcl["FLOT"] is False and dcl["CAP"] is False and dcl["MEZ_Rings"] is True
    assert sa["SETTINGS"]["SENSORS_SETTINGS"]["FRIEND_Symbols"] == 1
    assert sa["SETTINGS"]["SENSORS_SETTINGS"]["UNK_tracks"] is False
    assert len(sa["MEZ_THRTS"]) == 1
    assert sa["MEZ_THRTS"][0]["text"] == "NEMO" and sa["MEZ_THRTS"][0]["threat_level"] == 2
    assert sa["MEZ_THRTS"][0]["threat_ring_radius"] == 40 and sa["MEZ_THRTS"][0]["id"] == "MEZ_THRTS_1"
