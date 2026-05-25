"""Regression test for the Olympus units binary decoder (olympus_bridge.decode_units).

Uses a real captured /olympus/units sample (fixtures/olympus_units_sample.hex,
~4KB from a live server: a red Kuznetsov group vs a blue George Washington
group + a human FA-18C). Validates the delta wire-format decode."""

from __future__ import annotations

import struct
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


def _strf(s: str) -> bytes:           # length-prefixed string field value
    b = s.encode()
    return struct.pack("<H", len(b)) + b


def _latlng(lat: float, lng: float, alt: float = 0.0) -> bytes:
    return struct.pack("<ddd", lat, lng, alt)


def _ammo_one() -> bytes:             # one 38-byte ammo item (u16 + str(33) + 3xu8)
    item = struct.pack("<H", 2) + b"AIM-120".ljust(33, b"\x00") + bytes([1, 2, 3])
    return struct.pack("<H", 1) + item


class TestComplexFieldSync:
    """Regression: a unit carrying a complex field (ammo/contacts/activePath)
    must be consumed EXACTLY so the next unit isn't lost — this is what made
    freshly-spawned units (at the tail of the feed) vanish from the map."""

    def test_unit_after_ammo_field_is_not_dropped(self):
        feed = struct.pack("<Q", 0)                                  # time header
        # Unit A: category + ammo (complex) + position + end
        feed += struct.pack("<I", 0xAA)
        feed += bytes([1]) + _strf("Aircraft")
        feed += bytes([43]) + _ammo_one()
        feed += bytes([18]) + _latlng(45.0, 35.0)
        feed += bytes([255])
        # Unit B: name + position + end (the one that used to disappear)
        feed += struct.pack("<I", 0xBB)
        feed += bytes([9]) + _strf("B-UNIT")
        feed += bytes([18]) + _latlng(46.0, 36.0)
        feed += bytes([255])

        units = decode_units(feed)
        assert len(units) == 2
        a, b = units
        assert a["olympusID"] == 0xAA and a["category"] == "Aircraft" and "lat" in a["position"]
        assert "ammo" not in a  # complex aggregate consumed, not shipped
        assert b["olympusID"] == 0xBB and b["name"] == "B-UNIT"
        assert abs(b["position"]["lat"] - 46.0) < 1e-6  # decoded in sync

    def test_contacts_and_activepath_consumed(self):
        feed = struct.pack("<Q", 0)
        feed += struct.pack("<I", 0xC1)
        feed += bytes([44]) + struct.pack("<H", 2) + (struct.pack("<I", 7) + bytes([1])) * 2  # contacts x2
        feed += bytes([45]) + struct.pack("<H", 3) + _latlng(1, 1) * 3                          # activePath x3
        feed += bytes([18]) + _latlng(10.0, 20.0)
        feed += bytes([255])
        feed += struct.pack("<I", 0xC2)
        feed += bytes([9]) + _strf("TAIL")
        feed += bytes([255])

        units = decode_units(feed)
        assert [u["olympusID"] for u in units] == [0xC1, 0xC2]
        assert units[0]["position"]["lng"] == 20.0
        assert units[1]["name"] == "TAIL"
