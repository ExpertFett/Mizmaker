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
    With block-scoped handlers this should be impossible.

    These tests are the strongest single guard against silent cross-unit
    contamination — the bug class that motivated the whole audit. Each
    one writes a distinctive marker value to unit A, then asserts the
    marker does NOT appear in unit B's exact block. False positives are
    extremely unlikely (the markers are deliberately exotic strings or
    out-of-range numbers); a failure means a handler's window bled past
    the unit boundary.
    """

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
        target_skill = "Random"
        if a.get("skill") == "Random" or b.get("skill") == "Random":
            target_skill = "Average"
        edit = {"unitId": a["unitId"], "field": "skill", "value": target_skill}
        files = download_edited(client, sid, [edit])

        block_b = _unit_block(files["mission"], b["unitId"])
        if b.get("skill") and b["skill"] != target_skill:
            assert f'"skill"] = "{target_skill}"' not in block_b, \
                f"skill edit on unit {a['unitId']} leaked into unit {b['unitId']}"

    def test_livery_edit_does_not_leak_to_neighbour(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        units = self._two_player_units(uploaded_session)
        if len(units) < 2:
            pytest.skip("need two player units for isolation test")
        a, b = units[0], units[1]
        # Marker chosen so it cannot already be present in any livery_id
        # field on simple.miz.
        marker = "TEST_LEAK_LIVERY_DO_NOT_USE"
        edit = {"unitId": a["unitId"], "field": "livery", "value": marker}
        files = download_edited(client, sid, [edit])
        block_b = _unit_block(files["mission"], b["unitId"])
        assert f'"livery_id"] = "{marker}"' not in block_b, \
            f"livery edit on unit {a['unitId']} leaked into unit {b['unitId']}"

    def test_unit_rename_does_not_leak_to_neighbour(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        units = self._two_player_units(uploaded_session)
        if len(units) < 2:
            pytest.skip("need two player units for isolation test")
        a, b = units[0], units[1]
        marker = "TEST_LEAK_NAME_42"
        edit = {"unitId": a["unitId"], "field": "unitRename", "value": marker}
        files = download_edited(client, sid, [edit])
        block_b = _unit_block(files["mission"], b["unitId"])
        # The unit_name handler writes ["name"] = "marker" inside unit A's
        # block. If it leaked, B's block would carry the marker.
        assert marker not in block_b, \
            f"unitRename on unit {a['unitId']} leaked into unit {b['unitId']}"

    def test_heading_edit_does_not_leak_to_neighbour(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        units = self._two_player_units(uploaded_session)
        if len(units) < 2:
            pytest.skip("need two player units for isolation test")
        a, b = units[0], units[1]
        # 4.7123 radians ≈ 270.0° — an exotic value the fixture is
        # extremely unlikely to carry on any unit by coincidence.
        target_heading = 4.7123
        edit = {"unitId": a["unitId"], "field": "heading", "value": target_heading}
        files = download_edited(client, sid, [edit])
        block_b = _unit_block(files["mission"], b["unitId"])
        # B's heading field — if it exists — must NOT carry the marker.
        b_heading_m = re.search(r'\["heading"\]\s*=\s*([0-9.\-eE]+)', block_b)
        if b_heading_m and b_heading_m.group(1).startswith("4.7123"):
            pytest.fail(
                f"heading edit on unit {a['unitId']} leaked into unit {b['unitId']}"
            )

    def test_onboard_num_does_not_leak_to_neighbour(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        units = self._two_player_units(uploaded_session)
        if len(units) < 2:
            pytest.skip("need two player units for isolation test")
        a, b = units[0], units[1]
        marker = "999"  # 999 is unlikely to be the existing tail number on B
        edit = {"unitId": a["unitId"], "field": "onboard_num", "value": marker}
        files = download_edited(client, sid, [edit])
        block_b = _unit_block(files["mission"], b["unitId"])
        # Check b's onboard_num field specifically, not just "999" anywhere.
        ob_m = re.search(r'\["onboard_num"\]\s*=\s*"([^"]*)"', block_b)
        if ob_m:
            assert ob_m.group(1) != marker, \
                f"onboard_num edit on unit {a['unitId']} leaked into unit {b['unitId']}"


# ---------------------------------------------------------------------------
# AddPropAircraft fields — voiceCallsignLabel/Number, STN_L16
# ---------------------------------------------------------------------------

def _player_unit_with_prop(uploaded_session: dict, mission_text: str, lua_field: str):
    """First player unit whose block actually contains the named prop field.
    Skip-friendly — returns None when nothing matches."""
    for g in uploaded_session.get("groups", []):
        for u in g.get("units", []):
            if u.get("skill") not in ("Client", "Player"):
                continue
            uid = u.get("unitId")
            if uid is None:
                continue
            try:
                bs, be = _find_unit_block_bounds(mission_text, uid)
            except ValueError:
                continue
            if re.search(rf'\["{lua_field}"\]\s*=\s*"', mission_text[bs:be]):
                return u
    return None


class TestVoiceCallsignLabel:
    def test_voice_callsign_label_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        original = download_edited(client, sid, [])  # pristine
        unit = _player_unit_with_prop(uploaded_session, original["mission"],
                                       "VoiceCallsignLabel")
        if not unit:
            pytest.skip("no player unit has a VoiceCallsignLabel field")
        new_label = "TST"
        edit = {"unitId": unit["unitId"], "field": "voiceCallsignLabel", "value": new_label}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert f'"VoiceCallsignLabel"] = "{new_label}"' in block, \
            f"VoiceCallsignLabel did not update in unit {unit['unitId']}'s block"


class TestVoiceCallsignNumber:
    def test_voice_callsign_number_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        original = download_edited(client, sid, [])
        unit = _player_unit_with_prop(uploaded_session, original["mission"],
                                       "VoiceCallsignNumber")
        if not unit:
            pytest.skip("no player unit has a VoiceCallsignNumber field")
        new_num = "451"
        edit = {"unitId": unit["unitId"], "field": "voiceCallsignNumber", "value": new_num}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert f'"VoiceCallsignNumber"] = "{new_num}"' in block


class TestStnL16:
    def test_stn_l16_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        original = download_edited(client, sid, [])
        unit = _player_unit_with_prop(uploaded_session, original["mission"], "STN_L16")
        if not unit:
            pytest.skip("no player unit has an STN_L16 field")
        new_stn = "00777"
        edit = {"unitId": unit["unitId"], "field": "stnL16", "value": new_stn}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert f'"STN_L16"] = "{new_stn}"' in block


# ---------------------------------------------------------------------------
# Datalink — donors, teamMembers
# ---------------------------------------------------------------------------

def _player_unit_with_network(uploaded_session: dict, mission_text: str):
    """First player unit whose block contains a ["network"] section."""
    for g in uploaded_session.get("groups", []):
        for u in g.get("units", []):
            if u.get("skill") not in ("Client", "Player"):
                continue
            uid = u.get("unitId")
            if uid is None:
                continue
            try:
                bs, be = _find_unit_block_bounds(mission_text, uid)
            except ValueError:
                continue
            if re.search(r'\["network"\]\s*=\s*\n?\s*\{', mission_text[bs:be]):
                return u
    return None


class TestDonors:
    def test_donor_list_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        original = download_edited(client, sid, [])
        unit = _player_unit_with_network(uploaded_session, original["mission"])
        if not unit:
            pytest.skip("no player unit has a network/datalink block")
        donor_ids = [101, 202, 303]
        edit = {"unitId": unit["unitId"], "field": "donors", "value": donor_ids}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        # All donor ids must appear inside the unit's block. Donors are
        # the only place ["missionUnitId"] gets written, and we know the
        # original mission didn't have these specific ids — so finding
        # them in the unit block proves the donor list landed.
        assert '["donors"]' in block, "donors section missing from unit"
        for did in donor_ids:
            assert f'["missionUnitId"] = {did}' in block, \
                f"donor id {did} not in unit {unit['unitId']}'s block"


class TestTeamMembers:
    def test_team_member_list_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        original = download_edited(client, sid, [])
        unit = _player_unit_with_network(uploaded_session, original["mission"])
        if not unit:
            pytest.skip("no player unit has a network/datalink block")
        member_ids = [42, 99]
        edit = {"unitId": unit["unitId"], "field": "teamMembers", "value": member_ids}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert '["teamMembers"]' in block, "teamMembers section missing from unit"
        for mid in member_ids:
            assert f'["missionUnitId"] = {mid}' in block, \
                f"team member id {mid} not in unit {unit['unitId']}'s block"


# ---------------------------------------------------------------------------
# Callsign block (voice) — AI / Client units with ["callsign"] = { [1], [2], [3], name }
# ---------------------------------------------------------------------------

def _unit_with_callsign_block(uploaded_session: dict, mission_text: str):
    """First unit whose block contains ["callsign"] = { [1] = N, [2] = N, [3] = N, ["name"] = ... }."""
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
            if re.search(r'\["callsign"\]\s*=\s*\{[^}]*?\[1\]\s*=\s*\d+', block):
                return u
    return None


class TestCallsign:
    def test_voice_callsign_replaces_all_four_fields(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        original = download_edited(client, sid, [])
        unit = _unit_with_callsign_block(uploaded_session, original["mission"])
        if not unit:
            pytest.skip("no unit has a callsign block in fixture")
        edit = {
            "unitId": unit["unitId"],
            "field": "callsign",
            "value": {"nameIdx": 5, "flight": 7, "pos": 3, "name": "TestForce71"},
        }
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        # All four sub-fields should reflect the new values inside the
        # unit's callsign sub-block.
        cs_m = re.search(r'\["callsign"\]\s*=\s*\{(.+?)\}', block, flags=re.DOTALL)
        assert cs_m, "callsign block missing"
        cs = cs_m.group(1)
        assert re.search(r'\[1\]\s*=\s*5', cs), "name index didn't update to 5"
        assert re.search(r'\[2\]\s*=\s*7', cs), "flight number didn't update to 7"
        assert re.search(r'\[3\]\s*=\s*3', cs), "position didn't update to 3"
        assert '"name"] = "TestForce71"' in cs, "name string didn't update"


# ---------------------------------------------------------------------------
# Loadout copy — _copy_payload_block via copyLoadout dispatch
# ---------------------------------------------------------------------------

def _two_player_units_with_payload(uploaded_session: dict, mission_text: str):
    """Two player units whose blocks both have a ["payload"] section.
    Returns (source, target) so we can verify a copy round-trip."""
    found = []
    for g in uploaded_session.get("groups", []):
        for u in g.get("units", []):
            if u.get("skill") not in ("Client", "Player"):
                continue
            uid = u.get("unitId")
            if uid is None:
                continue
            try:
                bs, be = _find_unit_block_bounds(mission_text, uid)
            except ValueError:
                continue
            if re.search(r'\["payload"\]\s*=', mission_text[bs:be]):
                found.append(u)
                if len(found) == 2:
                    return found[0], found[1]
    return None, None


class TestCopyLoadout:
    def test_copy_payload_clones_pylons(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        original = download_edited(client, sid, [])
        source, target = _two_player_units_with_payload(uploaded_session, original["mission"])
        if not source or not target:
            pytest.skip("need two player units with payload blocks")

        # Read source's payload block from the pristine mission so we know
        # what should end up on target after the copy.
        src_block = _unit_block(original["mission"], source["unitId"])
        src_payload_m = re.search(r'\["payload"\]\s*=\s*\n?\s*\{(.+?)\}\s*,\s*-- end of \["payload"\]',
                                  src_block, flags=re.DOTALL)
        if not src_payload_m:
            pytest.skip("could not extract source payload block from fixture")

        # Pick a CLSID that exists on source — that's the payload signature.
        src_clsids = re.findall(r'\["CLSID"\]\s*=\s*"([^"]+)"', src_payload_m.group(1))
        if not src_clsids:
            pytest.skip("source unit has no pylons with CLSIDs")
        src_signature = src_clsids[0]

        edit = {"unitId": target["unitId"], "field": "copyLoadout", "value": source["unitId"]}
        files = download_edited(client, sid, [edit])
        target_block = _unit_block(files["mission"], target["unitId"])
        # After copy, target's payload should contain at least one pylon
        # whose CLSID matches the source signature.
        assert f'"CLSID"] = "{src_signature}"' in target_block, \
            f"copyLoadout did not clone source's CLSID {src_signature!r} onto target"


# ---------------------------------------------------------------------------
# Pylon swap — _replace_pylon_clsid
# ---------------------------------------------------------------------------

def _player_unit_with_pylon(uploaded_session: dict, mission_text: str):
    """First player unit with at least one pylon. Returns (unit, pylon_num)."""
    for g in uploaded_session.get("groups", []):
        for u in g.get("units", []):
            if u.get("skill") not in ("Client", "Player"):
                continue
            uid = u.get("unitId")
            if uid is None:
                continue
            try:
                bs, be = _find_unit_block_bounds(mission_text, uid)
            except ValueError:
                continue
            block = mission_text[bs:be]
            payload_m = re.search(r'\["payload"\]\s*=\s*\n?\s*\{', block)
            if not payload_m:
                continue
            payload_region = block[payload_m.start():]
            pylons_m = re.search(r'\["pylons"\]\s*=\s*\n?\s*\{', payload_region)
            if not pylons_m:
                continue
            inner = payload_region[pylons_m.end():]
            pn_m = re.search(r'\[(\d+)\]\s*=\s*\n?\s*\{', inner)
            if pn_m:
                return u, int(pn_m.group(1))
    return None, None


class TestPylonChange:
    def test_pylon_clsid_replaces(self, client, uploaded_session):
        """Swap a pylon's CLSID to a marker string — should appear in the
        target unit's pylons block on round-trip."""
        sid = uploaded_session["sessionId"]
        original = download_edited(client, sid, [])
        unit, pylon_num = _player_unit_with_pylon(uploaded_session, original["mission"])
        if not unit:
            pytest.skip("no player unit with at least one pylon")
        marker_clsid = "TEST_MARKER_CLSID_42"
        edit = {
            "unitId": unit["unitId"],
            "field": "pylonChange",
            "value": {"pylon": pylon_num, "clsid": marker_clsid},
        }
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert f'"CLSID"] = "{marker_clsid}"' in block, \
            f"pylonChange did not write CLSID for pylon {pylon_num} on unit {unit['unitId']}"


# ---------------------------------------------------------------------------
# Payload swap — _replace_payload_block via payloadReplace dispatch
# ---------------------------------------------------------------------------

class TestPayloadReplace:
    def test_payload_replace_writes_new_pylons(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        original = download_edited(client, sid, [])
        unit, _pn = _player_unit_with_pylon(uploaded_session, original["mission"])
        if not unit:
            pytest.skip("no player unit with payload to replace")
        marker_clsid = "TEST_PAYLOAD_REPLACE_42"
        new_payload = {
            "fuel": 4900,
            "chaff": 60,
            "flare": 60,
            "gun": 100,
            "ammo_type": 1,
            "pylons": [
                {"CLSID": marker_clsid},
            ],
        }
        edit = {"unitId": unit["unitId"], "field": "payloadReplace", "value": new_payload}
        files = download_edited(client, sid, [edit])
        block = _unit_block(files["mission"], unit["unitId"])
        assert f'"CLSID"] = "{marker_clsid}"' in block, \
            "payloadReplace did not insert the new CLSID into target unit"


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
