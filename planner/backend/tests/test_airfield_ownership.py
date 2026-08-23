"""Airfield ownership + supply state from the .miz `warehouses` file.

The mission file reports every airbase as "neutral" — ownership is not
recorded there. Without the warehouses overlay the divert list on the
Home Plate kneeboard offered enemy airfields as valid recovery options.
"""
import pytest

from services.miz_parser import extract_full_mission_data, _load_theater_airbases

WAREHOUSES = """warehouses =
{
    ["airports"] =
    {
        [14] =
        {
            ["coalition"] = "BLUE",
            ["unlimitedFuel"] = true,
            ["unlimitedMunitions"] = true,
            ["unlimitedAircrafts"] = true,
        },
        [8] =
        {
            ["coalition"] = "RED",
            ["unlimitedFuel"] = true,
            ["unlimitedMunitions"] = false,
            ["unlimitedAircrafts"] = true,
        },
    },
}
"""

THEATER = "Kola"


def _by_id(airbases):
    return {a["id"]: a for a in airbases if a.get("id") is not None}


@pytest.fixture
def kola_available():
    if not _load_theater_airbases(THEATER):
        pytest.skip("no airbase data for Kola in this environment")


def test_warehouses_set_real_coalitions(kola_available):
    data = extract_full_mission_data({}, THEATER, warehouses_text=WAREHOUSES)
    fields = _by_id(data["airbases"])
    assert fields[14]["coalition"] == "blue"
    assert fields[8]["coalition"] == "red"


def test_supplies_reflect_warehouse_flags(kola_available):
    data = extract_full_mission_data({}, THEATER, warehouses_text=WAREHOUSES)
    fields = _by_id(data["airbases"])
    assert fields[14]["supplies"] == {"fuel": True, "munitions": True, "aircraft": True}
    assert fields[8]["supplies"]["munitions"] is False


def test_without_warehouses_everything_stays_neutral(kola_available):
    data = extract_full_mission_data({}, THEATER)
    assert {a["coalition"] for a in data["airbases"]} == {"neutral"}


def test_ownership_does_not_leak_into_the_next_mission(kola_available):
    """The theater airbase list is cached process-wide. Stamping one
    mission's front line onto it leaked into every later parse — including
    other users' sessions on the shared server."""
    extract_full_mission_data({}, THEATER, warehouses_text=WAREHOUSES)
    clean = extract_full_mission_data({}, THEATER)
    assert {a["coalition"] for a in clean["airbases"]} == {"neutral"}
    assert all("supplies" not in a for a in clean["airbases"])


@pytest.mark.parametrize("bad", ["", "not lua at all", "warehouses = {", 'warehouses = {["airports"] = 5}'])
def test_unparseable_warehouses_degrades_quietly(kola_available, bad):
    data = extract_full_mission_data({}, THEATER, warehouses_text=bad)
    assert data["airbases"], "airbases must still render without ownership"
    assert {a["coalition"] for a in data["airbases"]} == {"neutral"}
