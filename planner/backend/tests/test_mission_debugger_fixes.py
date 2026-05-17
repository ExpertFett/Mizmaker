"""Tests for mission_debugger auto-fix builders.

Locks in the shape of the `Fix` objects emitted by the debug tab so
the frontend can rely on a stable contract. Each test stages a
minimal `groups` list that triggers exactly one issue, then asserts
the produced fix carries:
  - a non-empty edits list with the right field
  - before / after dicts the frontend can render
  - deterministic channel/freq picks (so the same input always
    produces the same fix, which keeps the auto-fix preview sensible)

The frontend test suite (vitest) covers the rendering side; this is
the backend-side guarantee that the data arrives in the expected shape.
"""

import pytest
# Import path matches every other test in this folder — CI runs pytest with
# cwd = `planner/backend/`, so `services.X` is on rootdir, but
# `planner.backend.services.X` isn't (would need the repo root on sys.path).
# pytest 9 tightened the importer default and stopped tolerating the old
# form, leaving collection blocked on this one file. See run #24 (2026-05-04)
# for the first red — pip cache expired around that date and CI started
# pulling pytest 9.x via the unpinned `pytest>=8.0` in requirements-dev.txt.
from services.mission_debugger import (
    _check_tankers,
    _check_awacs,
    _check_frequency_conflicts,
    _check_tacan_conflicts,
    _check_icls_conflicts,
    _check_client_flights,
)


# ---------------------------------------------------------------------------
# Helpers — build a minimal group dict
# ---------------------------------------------------------------------------

def _mk_group(group_id: int, name: str, coalition: str, unit_type: str,
              category: str = "plane", *, freq=None, tacan=None, icls=None,
              waypoints=None) -> dict:
    g = {
        "groupId": group_id,
        "groupName": name,
        "coalition": coalition,
        "category": category,
        "units": [{"unitId": group_id * 10, "type": unit_type, "name": name + "-1"}],
    }
    if freq is not None:
        g["frequency"] = freq
    if tacan is not None:
        g["tacan"] = tacan
    if icls is not None:
        g["icls"] = icls
    if waypoints is not None:
        g["waypoints"] = waypoints
    return g


# ---------------------------------------------------------------------------
# Tanker fixes
# ---------------------------------------------------------------------------

class TestTankerMissingTacan:
    def test_emits_fix_with_tacan_edit(self):
        groups = [_mk_group(1, "Texaco", "blue", "KC-135")]
        issues = _check_tankers(groups)
        missing_tacan = [i for i in issues if "TACAN" in i.title]
        assert len(missing_tacan) == 1
        fix = missing_tacan[0].fix
        assert fix is not None
        assert len(fix.edits) == 1
        e = fix.edits[0]
        assert e["field"] == "tacan"
        assert e["unitId"] == 10
        assert e["groupId"] == 1
        assert e["value"]["band"] == "Y"
        # First free Y-band channel — picks 1Y from the empty pool.
        assert e["value"]["channel"] == 1
        # Callsign defaults to first 3 letters of group name uppercased.
        assert e["value"]["callsign"] == "TEX"

    def test_skips_used_y_channels(self):
        # Texaco gets 1Y, Arco should pick 3Y (next odd Y).
        groups = [
            _mk_group(1, "Texaco", "blue", "KC-135",
                      tacan={"channel": 1, "band": "Y", "callsign": "TEX"}),
            _mk_group(2, "Arco", "blue", "KC-130"),
        ]
        issues = _check_tankers(groups)
        missing = [i for i in issues if "TACAN" in i.title]
        assert len(missing) == 1
        assert missing[0].fix.edits[0]["value"]["channel"] == 3

    def test_x_band_carriers_dont_collide(self):
        # Carrier on 72X must not block the tanker's Y-band assignment.
        groups = [
            _mk_group(1, "CVN-72", "blue", "CVN_72", category="ship",
                      tacan={"channel": 72, "band": "X", "callsign": "CVN"}),
            _mk_group(2, "Texaco", "blue", "KC-135"),
        ]
        issues = _check_tankers(groups)
        missing = [i for i in issues if "TACAN" in i.title]
        assert len(missing) == 1
        # 1Y is still free; we don't care that 72 is in use on X-band.
        assert missing[0].fix.edits[0]["value"]["channel"] == 1


class TestTankerMissingFrequency:
    def test_emits_fix_with_radio_freq_edit(self):
        groups = [_mk_group(1, "Texaco", "blue", "KC-135")]
        issues = _check_tankers(groups)
        missing_freq = [i for i in issues if "frequency" in i.title]
        assert len(missing_freq) == 1
        fix = missing_freq[0].fix
        assert fix is not None
        assert len(fix.edits) == 1
        e = fix.edits[0]
        assert e["field"] == "radioFrequency"
        # Pool starts at 271.0 MHz, so first pick is 271.0.
        assert e["value"] == 271_000_000
        assert e["unitId"] == 10

    def test_picks_next_free_freq(self):
        # 271.0 already used — should jump to 271.250 next.
        groups = [
            _mk_group(1, "Shell", "blue", "KC-135", freq=271_000_000),
            _mk_group(2, "Texaco", "blue", "KC-130"),
        ]
        issues = _check_tankers(groups)
        missing = [i for i in issues if "frequency" in i.title]
        assert len(missing) == 1
        assert missing[0].fix.edits[0]["value"] == 271_250_000


# ---------------------------------------------------------------------------
# AWACS fixes
# ---------------------------------------------------------------------------

class TestAwacsMissingFrequency:
    def test_emits_fix_in_awacs_pool(self):
        groups = [_mk_group(1, "Magic", "blue", "E-3A")]
        issues = _check_awacs(groups)
        missing = [i for i in issues if "frequency" in i.title]
        assert len(missing) == 1
        fix = missing[0].fix
        assert fix is not None
        e = fix.edits[0]
        assert e["field"] == "radioFrequency"
        # AWACS pool is 280-289 MHz — first pick is 280.0.
        assert e["value"] == 280_000_000

    def test_pool_does_not_collide_with_tanker_pool(self):
        # AWACS picks should never overlap with the 271-279 tanker pool.
        groups = [_mk_group(1, "Magic", "blue", "E-3A")]
        issues = _check_awacs(groups)
        missing = [i for i in issues if "frequency" in i.title]
        f_hz = missing[0].fix.edits[0]["value"]
        f_mhz = f_hz / 1_000_000
        assert 280.0 <= f_mhz < 290.0


# ---------------------------------------------------------------------------
# Frequency conflict deconflict
# ---------------------------------------------------------------------------

class TestFrequencyConflictFix:
    def test_keeps_head_moves_tail(self):
        # Two blue groups on 305.000 MHz — fix should keep the first,
        # bump the second to 305.250.
        groups = [
            _mk_group(1, "Bengal 1", "blue", "FA-18C_hornet", freq=305_000_000),
            _mk_group(2, "Bengal 2", "blue", "FA-18C_hornet", freq=305_000_000),
        ]
        issues = _check_frequency_conflicts(groups)
        assert len(issues) == 1
        fix = issues[0].fix
        assert fix is not None
        assert len(fix.edits) == 1
        e = fix.edits[0]
        assert e["field"] == "radioFrequency"
        assert e["groupId"] == 2  # tail group
        assert e["value"] == 305_250_000

    def test_cross_coalition_not_a_conflict(self):
        # Blue and Red on the same freq is fine — no conflict, no fix.
        groups = [
            _mk_group(1, "Bengal 1", "blue", "FA-18C_hornet", freq=305_000_000),
            _mk_group(2, "Bandit 1", "red", "MiG-29A", freq=305_000_000),
        ]
        issues = _check_frequency_conflicts(groups)
        assert issues == []

    def test_three_way_conflict(self):
        # Three groups on the same freq — head keeps, two others move
        # to consecutive free slots.
        groups = [
            _mk_group(1, "A", "blue", "FA-18C_hornet", freq=305_000_000),
            _mk_group(2, "B", "blue", "FA-18C_hornet", freq=305_000_000),
            _mk_group(3, "C", "blue", "FA-18C_hornet", freq=305_000_000),
        ]
        issues = _check_frequency_conflicts(groups)
        assert len(issues) == 1
        fix = issues[0].fix
        assert len(fix.edits) == 2
        # Both moves land on different freqs.
        moved = [e["value"] for e in fix.edits]
        assert len(set(moved)) == 2
        # Both moves are above 305.000.
        for v in moved:
            assert v > 305_000_000


# ---------------------------------------------------------------------------
# Existing fix builders — sanity checks that the v0.9.8 contract still holds
# ---------------------------------------------------------------------------

class TestHornetMissingStn:
    def _mk_client(self, unit_id: int, name: str, *, stn: str = "") -> dict:
        return {
            "unitId": unit_id,
            "name": name,
            "type": "FA-18C_hornet",
            "groupName": "Bengal 1",
            "stnL16": stn,
        }

    def test_emits_fix_with_stn_edit(self):
        clients = [self._mk_client(101, "Bengal 1-1")]
        issues = _check_client_flights([], clients)
        missing = [i for i in issues if "STN" in i.title]
        assert len(missing) == 1
        fix = missing[0].fix
        assert fix is not None
        assert len(fix.edits) == 1
        e = fix.edits[0]
        assert e["field"] == "stnL16"
        assert e["unitId"] == 101
        # First free slot in the flight*10+wing scheme is 00011.
        assert e["value"] == "00011"

    def test_skips_used_stns(self):
        # Bengal 1-1 already has 00011, Bengal 1-2 should pick 00012.
        clients = [
            self._mk_client(101, "Bengal 1-1", stn="00011"),
            self._mk_client(102, "Bengal 1-2"),
        ]
        issues = _check_client_flights([], clients)
        missing = [i for i in issues if "STN" in i.title]
        assert len(missing) == 1
        assert missing[0].fix.edits[0]["value"] == "00012"

    def test_jumps_to_next_flight_when_first_full(self):
        # 00011..00014 all taken — fix should jump to 00021 (next flight).
        clients = [
            self._mk_client(101, "Bengal 1-1", stn="00011"),
            self._mk_client(102, "Bengal 1-2", stn="00012"),
            self._mk_client(103, "Bengal 1-3", stn="00013"),
            self._mk_client(104, "Bengal 1-4", stn="00014"),
            self._mk_client(201, "Hawk 2-1"),
        ]
        issues = _check_client_flights([], clients)
        missing = [i for i in issues if "STN" in i.title]
        assert len(missing) == 1
        assert missing[0].fix.edits[0]["value"] == "00021"

    def test_treats_blank_string_as_missing(self):
        # Empty string and "0" both trigger the fix path.
        clients = [
            self._mk_client(101, "Bengal 1-1", stn=""),
            self._mk_client(102, "Bengal 1-2", stn="0"),
        ]
        issues = _check_client_flights([], clients)
        missing = [i for i in issues if "STN" in i.title]
        assert len(missing) == 2
        # Each gets a unique STN.
        assigned = [i.fix.edits[0]["value"] for i in missing]
        assert len(set(assigned)) == 2

    def test_non_hornet_skipped(self):
        # F-16 has no STN warning today (planner only checks Hornets).
        clients = [{
            "unitId": 101,
            "name": "Viper 1-1",
            "type": "F-16C_50",
            "groupName": "Viper 1",
            "stnL16": "",
        }]
        issues = _check_client_flights([], clients)
        missing = [i for i in issues if "STN" in i.title]
        assert missing == []


class TestExistingFixesUnchanged:
    def test_tacan_conflict_fix_shape(self):
        groups = [
            _mk_group(1, "A", "blue", "FA-18C_hornet",
                      tacan={"channel": 73, "band": "X", "callsign": "AAA"}),
            _mk_group(2, "B", "blue", "FA-18C_hornet",
                      tacan={"channel": 73, "band": "X", "callsign": "BBB"}),
        ]
        issues = _check_tacan_conflicts(groups)
        assert len(issues) == 1
        fix = issues[0].fix
        assert fix is not None
        assert fix.edits[0]["field"] == "tacan"

    def test_icls_conflict_fix_shape(self):
        groups = [
            _mk_group(1, "A", "blue", "CVN_72", category="ship",
                      icls={"channel": 7}),
            _mk_group(2, "B", "blue", "CVN_73", category="ship",
                      icls={"channel": 7}),
        ]
        issues = _check_icls_conflicts(groups)
        assert len(issues) == 1
        fix = issues[0].fix
        assert fix is not None
        assert fix.edits[0]["field"] == "icls"
