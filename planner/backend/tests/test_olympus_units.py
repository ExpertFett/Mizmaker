"""Regression test for the Olympus units binary decoder (olympus_bridge.decode_units).

Uses a real captured /olympus/units sample (fixtures/olympus_units_sample.hex,
~4KB from a live server: a red Kuznetsov group vs a blue George Washington
group + a human FA-18C). Validates the delta wire-format decode."""

from __future__ import annotations

from pathlib import Path

from services.olympus_bridge import decode_units

SAMPLE = bytes.fromhex(
    (Path(__file__).parent / "fixtures" / "olympus_units_sample.hex").read_text().strip()
)


def _by_name(units, name):
    return next((u for u in units if u.get("name") == name), None)


class TestDecodeUnits:
    def test_parses_multiple_units(self):
        units = decode_units(SAMPLE)
        assert len(units) >= 9

    def test_first_unit_is_kuznetsov(self):
        u = decode_units(SAMPLE)[0]
        assert u["olympusID"] == 0x01000101
        assert u["category"] == "NavyUnit"
        assert u["coalition"] == 1
        assert u["name"] == "KUZNECOW"
        assert u["unitName"] == "Naval-2-4"
        assert abs(u["position"]["lat"] - 45.97) < 0.05
        assert abs(u["position"]["lng"] - 35.28) < 0.05

    def test_blue_carrier_and_escorts(self):
        units = decode_units(SAMPLE)
        cvn = _by_name(units, "CVN_73")
        assert cvn is not None and cvn["coalition"] == 2
        ticos = [u for u in units if u.get("name") == "TICONDEROG"]
        assert len(ticos) >= 3
        assert all(u["coalition"] == 2 for u in ticos)
        assert all("lat" in u.get("position", {}) for u in ticos)

    def test_human_aircraft(self):
        u = _by_name(decode_units(SAMPLE), "FA-18C_hornet")
        assert u is not None
        assert u["category"] == "Aircraft"
        assert u["coalition"] == 2
        assert u.get("human") == 1
        assert "lat" in u["position"]

    def test_empty_and_garbage_safe(self):
        assert decode_units(b"") == []          # too short
        out = decode_units(b"\x00" * 20)        # garbage -> no crash
        assert isinstance(out, list)
        assert all("name" not in u for u in out)  # no real units conjured
