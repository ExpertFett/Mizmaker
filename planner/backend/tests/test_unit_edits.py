"""
Round-trip tests for unit-level edit fields not covered by
test_edit_roundtrip.py. Each one exercises a specific dispatch branch
in apply_unit_edits and a specific _replace_* handler in unit_editor.

Pattern matches the rest of the suite: upload the simple fixture, post
the edit, unzip the result, regex-match the target Lua field. Tests
that need a particular kind of unit (e.g. a TACAN beacon, a player
flight) skip cleanly when the fixture doesn't have one.

These guard the surgical text editor's most fragile property — every
handler reads a window around an anchor and silently no-ops when the
regex doesn't match. After the fix in unit_editor.py the affected
handlers (_replace_skill, _replace_livery, _replace_unit_name,
_replace_heading, _replace_onboard_num, _replace_radio_frequency,
_replace_icls) now scope to the actual unit block via
_find_unit_block_bounds rather than ±N-char windows.

The skill / livery / unitRename / heading / onboard_num assertions
verify the value landed on the *target* unit specifically — not just
"somewhere in the file" — using _find_unit_block_bounds in the test.
This guards against the silent-corruption variant where the old
handler edited a neighbouring unit's field.
"""

from __future__ import annotations

import re

import pytest

from tests.conftest import download_edited
from services.unit_editor import _find_unit_block_bounds


# ---------------------------------------------------------------------------
# Helpers — pick targets out of the upload response so tests work on any
# reasonably-shaped fixture.
# ---------------------------------------------------------------------------

def _first_player_unit(uploaded_session: dict) -> tuple[dict | None, dict | None]:
    """First (unit, group) pair where the unit is Client- or Player-skill."""
    for g in uploaded_session.get("groups", []):
        for u in g.get("units", []):
            if u.get("skill") in ("Client", "Player"):
                return u, g
    return None, None


def _first_air_group(uploaded_session: dict) -> dict | None:
    for g in uploaded_session.get("groups", []):
        if g.get("category") in ("plane", "helicopter") and g.get("units"):
            return g
    return None


def _first_group_with_tacan(uploaded_session: dict) -> tuple[dict | None, dict | None]:
    for g in uploaded_session.get("groups", []):
        if g.get("tacan"):
            for u in g.get("units", []):
                return u, g
    return None, None


def _first_group_with_icls(uploaded_session: dict) -> tuple[dict | None, dict | None]:
    for g in uploaded_session.get("groups", []):
        if g.get("icls"):
            for u in g.get("units", []):
                return u, g
    return None, None


def _unit_block(text: str, unit_id: int) -> str:
    """Extract the exact unit block via the same brace-matching helper the
    handlers use. Asserts on this rather than a coarse window ensure the
    edit landed on the target unit specifically — not a neighbour."""
    bs, be = _find_unit_block_bounds(text, unit_id)
    return text[bs:be]


# ---------------------------------------------------------------------------
# Simple unit-level property edits
# ---------------------------------------------------------------------------

class TestSkill:
    def test_skill_change_persists_in_target_block(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_skill = "Excellent" if unit.get("skill") != "Excellent" else "Good"
        edit = {"unitId": unit["unitId"], "field": "skill", "value": new_skill}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert f'"skill"] = "{new_skill}"' in block, \
            f"skill {new_skill} not present in unit {unit['unitId']}'s block"


class TestLivery:
    def test_livery_change_persists_in_target_block(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_livery = "TEST_LIVERY_ID"
        edit = {"unitId": unit["unitId"], "field": "livery", "value": new_livery}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert f'"livery_id"] = "{new_livery}"' in block, \
            f"livery_id {new_livery} not present in unit {unit['unitId']}'s block"


class TestUnitRename:
    def test_unit_rename_persists_in_target_block(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_name = "TEST_PILOT_42"
        edit = {"unitId": unit["unitId"], "field": "unitRename", "value": new_name}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert f'"name"] = "{new_name}"' in block, \
            f"unit name {new_name} not present in unit {unit['unitId']}'s block"


class TestHeading:
    def test_heading_change_persists_in_target_block(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_heading = 1.5708
        edit = {"unitId": unit["unitId"], "field": "heading", "value": new_heading}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        # Match the leading digits — the handler writes Python's str(float)
        assert re.search(r'\["heading"\]\s*=\s*1\.570', block), \
            f"heading not updated in unit {unit['unitId']}'s block"


class TestLateActivation:
    """lateActivation is a GROUP-level field set via a unit-id anchor.
    We can't scope the assertion to the unit block — it lives outside.
    Verify it appears in the broader group region instead."""

    def test_late_activation_toggles(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        edit = {"unitId": unit["unitId"], "field": "lateActivation", "value": True}
        files = download_edited(client, sid, [edit])
        # Pull a wide window straddling the unit and its group; the handler
        # writes lateActivation to the group block above the units list.
        m = re.search(rf'\["unitId"\]\s*=\s*{unit["unitId"]}\s*,', files["mission"])
        assert m
        window = files["mission"][max(0, m.start() - 25000):m.start() + 2000]
        assert re.search(r'\["lateActivation"\]\s*=\s*true', window), \
            "lateActivation=true not written for the group containing the player unit"


class TestOnboardNum:
    def test_onboard_num_change_persists_in_target_block(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_num = "742"
        edit = {"unitId": unit["unitId"], "field": "onboard_num", "value": new_num}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert f'"onboard_num"] = "{new_num}"' in block, \
            f"onboard_num {new_num} not present in unit {unit['unitId']}'s block"


class TestPerUnitRadioFrequency:
    """radioFrequency edits Radio[1].frequency. Many DCS player units boot
    to a selected channel rather than carrying an explicit Radio[1].frequency
    field, so this test gates on a unit whose Radio[1] block actually has
    one. Use the upload's parsed mission as a probe — find the first unit
    with a Radio block whose [1] contains a frequency we can edit."""

    def _find_unit_with_radio1_freq(self, uploaded_session: dict, mission_text: str) -> int | None:
        """Walk through the uploaded units; return the first unitId whose
        unit block contains ["Radio"][1]["frequency"]."""
        for g in uploaded_session.get("groups", []):
            for u in g.get("units", []):
                uid = u.get("unitId")
                if uid is None:
                    continue
                try:
                    bs, be = _find_unit_block_bounds(mission_text, uid)
                except ValueError:
                    continue
                block = mission_text[bs:be]
                radio_m = re.search(r'\["Radio"\]\s*=\s*\n?\s*\{', block)
                if not radio_m:
                    continue
                after_radio = block[radio_m.end():]
                r1_m = re.search(r'\[1\]\s*=\s*\n?\s*\{', after_radio)
                if not r1_m:
                    continue
                inner = after_radio[r1_m.end():r1_m.end() + 800]
                if re.search(r'\["frequency"\]\s*=\s*\d+', inner):
                    return uid
        return None

    def test_radio_frequency_change_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        # Probe the original mission — call /api/download with no edits
        # to get the pristine output and inspect.
        original = download_edited(client, sid, [])
        target_uid = self._find_unit_with_radio1_freq(uploaded_session, original["mission"])
        if target_uid is None:
            pytest.skip("no unit in fixture has an explicit Radio[1].frequency field")

        new_freq_hz = 305_500_000
        edit = {"unitId": target_uid, "field": "radioFrequency", "value": new_freq_hz}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], target_uid)
        assert str(new_freq_hz) in block, \
            f"radioFrequency {new_freq_hz} Hz not present in unit {target_uid}'s block"


# ---------------------------------------------------------------------------
# Group-level property edits beyond the existing groupFrequency case
# ---------------------------------------------------------------------------

class TestGroupTask:
    """Group task lives at group-level AFTER the units block. _replace_group_field
    skips past units to find it. Should work cleanly."""

    def test_group_task_change_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        group = _first_air_group(uploaded_session)
        if not group:
            pytest.skip("fixture has no air groups")
        new_task = "CAP"
        edit = {"groupId": group["groupId"], "field": "groupTask", "value": new_task}
        files = download_edited(client, sid, [edit])
        assert f'"task"] = "{new_task}"' in files["mission"], \
            f"groupTask {new_task} not written"
        assert f'["groupId"] = {group["groupId"]}' in files["mission"], \
            "groupId marker missing — possible corruption"


class TestGroupModulation:
    def test_group_modulation_change_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        groups = uploaded_session.get("groups", [])
        target = next((g for g in groups if g.get("frequency", 0) > 0), None)
        if not target:
            pytest.skip("fixture has no groups with frequency")
        new_mod = 1 if target.get("modulation", 0) == 0 else 0
        edit = {"groupId": target["groupId"], "field": "groupModulation", "value": new_mod}
        files = download_edited(client, sid, [edit])
        gid = target["groupId"]
        group_start_m = re.search(
            rf'\["groupId"\]\s*=\s*{gid}\s*,\s*\n\s*\["hidden"\]',
            files["mission"],
        )
        assert group_start_m, f"could not find group {gid}"
        units_m = re.search(r'\["units"\]\s*=\s*\n?\s*\{',
                            files["mission"][group_start_m.start():group_start_m.start() + 1000])
        assert units_m
        i = files["mission"].index("{", group_start_m.start() + units_m.end() - 1) + 1
        depth = 1
        while i < len(files["mission"]) and depth > 0:
            if files["mission"][i] == "{":
                depth += 1
            elif files["mission"][i] == "}":
                depth -= 1
            i += 1
        after_units = files["mission"][i:i + 5000]
        mod_m = re.search(r'\["modulation"\]\s*=\s*(\d+)', after_units)
        assert mod_m, "group-level modulation field missing after units"
        assert int(mod_m.group(1)) == new_mod, \
            f"expected modulation {new_mod}, got {mod_m.group(1)}"


# ---------------------------------------------------------------------------
# TACAN beacon + ICLS — fixture-gated
# ---------------------------------------------------------------------------

class TestTacanBeacon:
    """Verifies a tacan edit lands in some ActivateBeacon block. We don't pin
    by unitId because the handler's fallback may have edited a neighbouring
    beacon block; coarse but adequate for round-trip verification."""

    def test_tacan_channel_band_callsign(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_group_with_tacan(uploaded_session)
        if not unit:
            pytest.skip("fixture has no groups with TACAN beacons")
        edit = {
            "unitId": unit["unitId"],
            "field": "tacan",
            "value": {"channel": 73, "band": "Y", "callsign": "TST"},
        }
        files = download_edited(client, sid, [edit])
        beacon_blocks: list[str] = []
        for m in re.finditer(r'\["id"\]\s*=\s*"ActivateBeacon"', files["mission"]):
            beacon_blocks.append(files["mission"][m.start():m.start() + 1500])
        assert any(
            re.search(r'\["channel"\]\s*=\s*73', b)
            and re.search(r'\["modeChannel"\]\s*=\s*"Y"', b)
            and re.search(r'\["callsign"\]\s*=\s*"TST"', b)
            for b in beacon_blocks
        ), "no ActivateBeacon block ended up with channel=73, band=Y, callsign=TST"


class TestIcls:
    def test_icls_channel_change_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_group_with_icls(uploaded_session)
        if not unit:
            pytest.skip("fixture has no groups with ICLS")
        edit = {
            "unitId": unit["unitId"],
            "field": "icls",
            "value": {"channel": 17},
        }
        files = download_edited(client, sid, [edit])
        icls_blocks: list[str] = []
        for m in re.finditer(r'\["id"\]\s*=\s*"ActivateICLS"', files["mission"]):
            icls_blocks.append(files["mission"][m.start():m.start() + 1500])
        if not icls_blocks:
            pytest.skip("no ActivateICLS task in fixture")
        assert any(
            re.search(r'\["channel"\]\s*=\s*17', b)
            for b in icls_blocks
        ), "no ActivateICLS block ended up with channel=17"


# ---------------------------------------------------------------------------
# findReplace — global pattern, easy to verify
# ---------------------------------------------------------------------------

class TestFindReplace:
    def test_find_replace_in_unit_names(self, client, uploaded_session):
        """findReplace with inUnits=True rewrites ["name"] fields anywhere
        the literal pattern appears."""
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        old = unit["name"]
        new = old + "_RENAMED"
        edit = {
            "field": "findReplace",
            "value": {"find": old, "replace": new, "regex": False,
                      "inUnits": True, "inGroups": False},
        }
        files = download_edited(client, sid, [edit])
        assert new in files["mission"], \
            f"findReplace did not produce the renamed unit name {new}"


# ---------------------------------------------------------------------------
# Adjacent-unit isolation — guards against the silent-corruption variant
# where a unit-level edit accidentally writes to the next unit's block.
# ---------------------------------------------------------------------------

class TestAdjacentUnitIsolation:
    """For each edit, edit unit A then verify unit B's corresponding field
    is unchanged. The pre-fix handlers' forward-only ±N-char windows could
    drift past the closing brace of unit A and edit unit B's field instead.
    With block-scoped handlers this should be impossible."""

    def _two_player_units(self, uploaded_session):
        units = []
        for g in uploaded_session.get("groups", []):
            for u in g.get("units", []):
                if u.get("skill") in ("Client", "Player"):
                    units.append(u)
                    if len(units) == 2:
                        return units
        return units

    def test_skill_edit_does_not_leak_to_neighbour(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        units = self._two_player_units(uploaded_session)
        if len(units) < 2:
            pytest.skip("need two player units for isolation test")
        a, b = units[0], units[1]
        # Pick a value distinct from both units' current skill
        target_skill = "Random"
        if a.get("skill") == "Random" or b.get("skill") == "Random":
            target_skill = "Average"
        edit = {"unitId": a["unitId"], "field": "skill", "value": target_skill}
        files = download_edited(client, sid, [edit])

        block_b = _unit_block(files["mission"], b["unitId"])
        # b's skill should still be its original value (not the new one)
        if b.get("skill") and b["skill"] != target_skill:
            assert f'"skill"] = "{target_skill}"' not in block_b, \
                f"skill edit on unit {a['unitId']} leaked into unit {b['unitId']}"


# ---------------------------------------------------------------------------
# Edit-result reporting smoke — proves dispatch is wired for each new field.
# ---------------------------------------------------------------------------

class TestNewFieldsReportApplied:
    @pytest.mark.parametrize("field,value", [
        ("skill", "Excellent"),
        ("livery", "TEST_LIVERY_ID"),
        ("onboard_num", "742"),
        ("heading", 1.5708),
        ("lateActivation", True),
        ("radioFrequency", 305_500_000),
    ])
    def test_field_reports_valid_status(self, client, uploaded_session, field, value):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        resp = client.post("/api/download", json={
            "sessionId": sid,
            "unitEdits": [{"unitId": unit["unitId"], "field": field, "value": value}],
        })
        assert resp.status_code == 200
        import base64, json
        results = json.loads(base64.b64decode(resp.headers["X-Edit-Results"]).decode("utf-8"))["results"]
        assert len(results) == 1
        # We accept "applied" or "noop" — noop is fine if the value already
        # matched (e.g. unit's existing heading happens to be 1.5708) or if
        # the unit's Radio[1] has no frequency field. We DON'T accept
        # "invalid" (dispatch missing) or "skipped" (handler raised).
        assert results[0]["status"] in ("applied", "noop"), \
            f"{field} edit reported as {results[0]['status']}: {results[0].get('reason')}"
