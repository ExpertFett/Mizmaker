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


def _flight(threats=None, side="blue"):
    return {
        "waypoints": [{"x": 1, "y": 2, "alt": 1000, "alt_type": "BARO", "name": "WP1"}],
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
        {"name": "RIVER SA-10", "type": "S-300", "x": -289055.21, "y": 625158.97, "coalition": "red"},
        {"name": "WASP SA-6", "type": "Kub", "x": -280744.69, "y": 624980.25, "coalition": "red"},
        {"name": "FRIENDLY", "type": "Patriot", "x": 1, "y": 2, "coalition": "blue"},
    ]
    sa = build_dtc_from_flight(_flight(threats, side="blue"), "T")["data"]["SA"]
    assert len(sa["MEZ_THRTS"]) == 2  # blue friendly dropped
    m = sa["MEZ_THRTS"][0]
    assert set(m.keys()) == MEZ_KEYS
    assert m["text"] == "RIVER SA-10" and m["x"] == -289055.21
    assert m["threat_type"] == "Custom" and m["id"] == "MEZ_THRTS_1"


def test_mez_autofill_includes_all_when_side_unknown():
    threats = [{"name": "X", "type": "S-300", "x": 1, "y": 2, "coalition": "red"}]
    f = _flight(threats); f["side"] = None
    sa = build_dtc_from_flight(f, "T")["data"]["SA"]
    assert len(sa["MEZ_THRTS"]) == 1


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
