"""
Round-trip tests for unit-level edit fields not covered by
test_edit_roundtrip.py. Each one exercises a specific dispatch branch
in apply_unit_edits and a specific _replace_* handler in unit_editor.

Pattern matches the rest of the suite: upload the simple fixture, post
the edit, unzip the result, regex-match the target Lua field. Tests
that need a particular kind of unit (e.g. a TACAN beacon, a player
flight) skip cleanly when the fixture doesn't have one.

These guard the surgical text editor's most fragile property — every
handler reads a ±N-char window around an anchor and silently no-ops
when the regex doesn't match. Several of the per-unit handlers
(_replace_skill, _replace_livery, _replace_unit_name, _replace_heading,
_replace_radio_frequency) currently ship with a 3000-char window that
isn't large enough to reach top-of-block fields on player units with
full radio preset programming — those tests are marked xfail with
SILENT_FAILURE_BUG until the handlers are fixed. Keeping them in the
suite as expected-failures means the day a handler is fixed, pytest
turns them green automatically (XPASS) and the bug-tracking comment
gets a reminder to remove the marker.
"""

from __future__ import annotations

import re

import pytest

from tests.conftest import download_edited


# Shared bug reference. Used as the xfail reason for every test that
# exercises a handler currently afflicted by the ±N-char window bug.
SILENT_FAILURE_BUG = (
    "Known: handler's ±3000-char search window can't reach top-of-block "
    "fields on player units with full radio preset programming. Tracked "
    "as Phase 1 risk #1 in the standing plan; fix is to either widen the "
    "window or use _find_unit_block_bounds-based scoping."
)


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


def _unit_window(text: str, unit_id: int, before: int = 30000, after: int = 5000) -> str:
    """Slice a generous window around a unitId — wide enough to reach
    top-of-block fields like skill/livery/name on player units. Default
    backward window matches the lateActivation handler's ±15k+ scan."""
    m = re.search(rf'\["unitId"\]\s*=\s*{unit_id}\s*,', text)
    if not m:
        return ""
    start = max(0, m.start() - before)
    return text[start:m.start() + after]


# ---------------------------------------------------------------------------
# Simple unit-level property edits
# ---------------------------------------------------------------------------

class TestSkill:
    @pytest.mark.xfail(reason=SILENT_FAILURE_BUG, strict=False)
    def test_skill_change_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_skill = "Excellent" if unit.get("skill") != "Excellent" else "Good"
        edit = {"unitId": unit["unitId"], "field": "skill", "value": new_skill}
        files = download_edited(client, sid, [edit])
        window = _unit_window(files["mission"], unit["unitId"])
        assert f'"skill"] = "{new_skill}"' in window, \
            f"skill {new_skill} not written for unit {unit['unitId']}"


class TestLivery:
    @pytest.mark.xfail(reason=SILENT_FAILURE_BUG, strict=False)
    def test_livery_change_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_livery = "TEST_LIVERY_ID"
        edit = {"unitId": unit["unitId"], "field": "livery", "value": new_livery}
        files = download_edited(client, sid, [edit])
        window = _unit_window(files["mission"], unit["unitId"])
        assert f'"livery_id"] = "{new_livery}"' in window, \
            f"livery_id {new_livery} not written for unit {unit['unitId']}"


class TestUnitRename:
    @pytest.mark.xfail(reason=SILENT_FAILURE_BUG, strict=False)
    def test_unit_rename_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_name = "TEST_PILOT_42"
        edit = {"unitId": unit["unitId"], "field": "unitRename", "value": new_name}
        files = download_edited(client, sid, [edit])
        window = _unit_window(files["mission"], unit["unitId"])
        assert f'"name"] = "{new_name}"' in window


class TestHeading:
    @pytest.mark.xfail(reason=SILENT_FAILURE_BUG, strict=False)
    def test_heading_change_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_heading = 1.5708
        edit = {"unitId": unit["unitId"], "field": "heading", "value": new_heading}
        files = download_edited(client, sid, [edit])
        window = _unit_window(files["mission"], unit["unitId"])
        assert re.search(r'\["heading"\]\s*=\s*1\.570', window)


class TestLateActivation:
    """lateActivation walks BACKWARD from the unit position with a 15k window,
    so this one actually works on player units. Keep the assertion strict."""

    def test_late_activation_toggles(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        edit = {"unitId": unit["unitId"], "field": "lateActivation", "value": True}
        files = download_edited(client, sid, [edit])
        # Look at the broad neighbourhood of the unit — lateActivation is a
        # group-level field, sometimes inserted near groupId, often above.
        window = _unit_window(files["mission"], unit["unitId"], before=20000, after=2000)
        assert re.search(r'\["lateActivation"\]\s*=\s*true', window), \
            "lateActivation=true not written for the group containing the player unit"


class TestOnboardNum:
    """onboard_num appears AFTER unitId in some fixtures (DCS writers vary on
    field order). Works on simple.miz today; if a future fixture writes it
    above unitId, mark xfail."""

    def test_onboard_num_change_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        new_num = "742"
        edit = {"unitId": unit["unitId"], "field": "onboard_num", "value": new_num}
        files = download_edited(client, sid, [edit])
        window = _unit_window(files["mission"], unit["unitId"])
        assert f'"onboard_num"] = "{new_num}"' in window, \
            f"onboard_num {new_num} not written for unit {unit['unitId']}"


class TestPerUnitRadioFrequency:
    @pytest.mark.xfail(reason=SILENT_FAILURE_BUG, strict=False)
    def test_radio_frequency_change_persists(self, client, uploaded_session):
        sid = uploaded_session["sessionId"]
        unit, _ = _first_player_unit(uploaded_session)
        if not unit:
            pytest.skip("no player unit in fixture")
        # 305.5 MHz expressed in Hz — the per-unit handler takes Hz integers.
        new_freq_hz = 305_500_000
        edit = {"unitId": unit["unitId"], "field": "radioFrequency", "value": new_freq_hz}
        files = download_edited(client, sid, [edit])
        window = _unit_window(files["mission"], unit["unitId"])
        assert str(new_freq_hz) in window


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
        # task appears at group-level after units. Just verify the new value
        # exists somewhere in the mission, then verify the group's groupId
        # marker is still present so we know we didn't corrupt the structure.
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
        # Use the same anchored search as TestGroupFrequency.
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
    """Verifies a tacan edit lands SOMEWHERE in an ActivateBeacon block.
    The handler picks the closest beacon to a unit; tests that try to
    pin a specific beacon-by-unit-id are brittle since beacons may use
    sub-unit IDs not in the upload's groups[].units list."""

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
        # Verify SOME ActivateBeacon block has all three new values. We
        # don't pin to the unit's beacon by unitId because the handler's
        # fallback may have edited a different beacon block.
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
    @pytest.mark.xfail(
        reason=(
            "Known: _replace_icls' fallback only searches BEFORE the unit's "
            "unitId line. When the ICLS task is registered in the carrier "
            "group's waypoints (after the units block), and the test picks "
            "a non-carrier unit from the group, the handler finds nothing "
            "to edit. TACAN's _replace_tacan_beacon has the same fallback "
            "pattern but happens to land correctly on simple.miz. Fix is "
            "to scope by group block, not by linear text position."
        ),
        strict=False,
    )
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
        # Same coarse check as TACAN — verify some ActivateICLS block now has
        # channel=17.
        icls_blocks: list[str] = []
        for m in re.finditer(r'\["id"\]\s*=\s*"ActivateICLS"', files["mission"]):
            icls_blocks.append(files["mission"][m.start():m.start() + 1500])
        if not icls_blocks:
            pytest.skip("no ActivateICLS task in fixture (fixture's icls field "
                        "may be reported via a different mechanism)")
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
# Edit-result reporting smoke — proves dispatch is wired for each new field.
# Catches regressions where someone adds a field to the dispatch table but
# forgets the result branch, or where a handler raises an unexpected
# exception (caught + reported as 'skipped' rather than crashing the
# request).
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
        # We accept "applied", "noop", or "skipped" — what we DON'T want
        # is "invalid" (dispatch missing). "skipped" is acceptable while
        # the SILENT_FAILURE_BUG handlers still raise on unreachable
        # fields; once they're fixed, this assertion can tighten to
        # ("applied", "noop") only.
        assert results[0]["status"] in ("applied", "noop", "skipped"), \
            f"{field} edit reported as {results[0]['status']}: {results[0].get('reason')}"
        # 'invalid' specifically means the dispatch table doesn't know the
        # field — that's the regression we're guarding against.
        assert results[0]["status"] != "invalid", \
            f"{field} is not in the dispatch table — dispatcher reports invalid"
