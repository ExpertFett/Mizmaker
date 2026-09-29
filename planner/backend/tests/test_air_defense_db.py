"""Canonical air-defense DB (data/air_defense_db.json) — integrity + the
threats[] / ewRadars[] split in extract_full_mission_data."""
from reference.loader import get_air_defense_db, get_sam_threat_ranges, get_ewr_ranges
from services.miz_parser import extract_full_mission_data


def test_types_unique_and_roles_valid():
    seen = {}
    for s in get_air_defense_db()["systems"]:
        assert s["role"] in ("sam", "ew"), s["id"]
        assert s["rangeKm"] > 0, s["id"]
        for t in s["types"]:
            assert t not in seen, f"{t} in both {seen[t]} and {s['id']}"
            seen[t] = s["id"]


def test_previously_missing_systems_now_ring():
    sam = get_sam_threat_ranges()
    for t in ("SNR_75V", "snr s-125 tr", "RPC_5N62V", "M1097 Avenger", "Patriot str"):
        assert t in sam, t
    # old keys kept so existing missions render the same
    assert sam["S-300PS 40B6M tr"] == 120000
    assert sam["Kub 1S91 str"] == 24000


def test_ewr_is_not_a_sam():
    sam, ew = get_sam_threat_ranges(), get_ewr_ranges()
    assert "1L13 EWR" in ew and "55G6 EWR" in ew
    assert not set(sam) & set(ew)


def _mission(units):
    return {
        "coalition": {"red": {"country": {1: {"name": "USSR", "vehicle": {"group": {1: {
            "groupId": 7, "name": "IADS", "x": 0, "y": 0,
            "units": {i + 1: {"unitId": 100 + i, "name": f"u{i}", "type": t, "x": 0, "y": 0}
                      for i, t in enumerate(units)},
            "route": {"points": {}},
        }}}}}}},
    }


def test_ewr_goes_to_ewradars_not_threats():
    data = extract_full_mission_data(_mission(["1L13 EWR", "SNR_75V"]), "Caucasus")
    assert [t["type"] for t in data["threats"]] == ["SNR_75V"]
    assert [t["type"] for t in data["ewRadars"]] == ["1L13 EWR"]
    ew = data["ewRadars"][0]
    assert ew["role"] == "ew" and ew["groupId"] == 7 and ew["range"] == 300000
