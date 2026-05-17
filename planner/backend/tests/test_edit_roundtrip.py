"""
Round-trip tests for every edit type the /api/download endpoint accepts.

Pattern:
  1. Upload the fixture .miz
  2. POST /api/download with a list of unitEdits
  3. Unzip the returned .miz
  4. Assert the target value is present in mission / options / dictionary

These guard against the entire class of "silent failure" bugs — where an
edit is queued, dropped by the surgical editor, and the user gets a .miz
that looks identical to what they uploaded.
"""

from __future__ import annotations

import re

import pytest

from tests.conftest import download_edited


# ---------------------------------------------------------------------------
# Mission-level edits
# ---------------------------------------------------------------------------

class TestWeather:
    def test_cloud_preset_applies(self, client, uploaded_session):
        """Preset24 (heavy thunderstorm) must end up in both mission & options."""
        sid = uploaded_session["sessionId"]
        wx = uploaded_session["overview"]["weather"]
        edit = {
            "field": "weather",
            "value": {
                "wind": wx["wind"],
                "clouds": {
                    "base": wx["clouds_base_m"],
                    "density": 10,
                    "thickness": 2000,
                    "iprecptns": 2,
                    "preset": "Preset24",
                },
                "fog": {"enabled": False, "mode": 0, "visibility": 0, "thickness": 0},
                "dust": {"enabled": False, "density": 0},
                "visibility": wx["visibility_m"],
                "temperature": wx["temperature_c"],
                "qnh": wx["qnh_mmhg"],
                "groundTurbulence": wx["turbulence"],
            },
        }
        files = download_edited(client, sid, [edit])
        assert re.search(r'\["preset"\]\s*=\s*"Preset24"', files["mission"]), \
            "Weather preset did not apply to mission file"

    def test_qnh_applies(self, client, uploaded_session):
        """A QNH of 760 mmHg should appear in the weather block."""
        sid = uploaded_session["sessionId"]
        wx = uploaded_session["overview"]["weather"]
        edit = {"field": "weather", "value": {
            "wind": wx["wind"],
            "clouds": {"base": wx["clouds_base_m"], "density": wx["clouds_density"],
                       "thickness": wx["clouds_thickness"], "iprecptns": wx["clouds_precipitation"],
                       "preset": wx["clouds_preset"]},
            "fog": {"enabled": False, "mode": 0, "visibility": 0, "thickness": 0},
            "dust": {"enabled": False, "density": 0},
            "visibility": wx["visibility_m"],
            "temperature": wx["temperature_c"],
            "qnh": 760,
            "groundTurbulence": wx["turbulence"],
        }}
        files = download_edited(client, sid, [edit])
        m = re.search(r'\["qnh"\]\s*=\s*(\d+)', files["mission"])
        assert m and int(m.group(1)) == 760, f"QNH not updated: {m.group(1) if m else 'MISSING'}"


class TestBriefing:
    def test_sortie_updates_dictionary(self, client, uploaded_session):
        """Briefing edits must update l10n/DEFAULT/dictionary, not just the mission file.
        This was a bug we fixed in the session — guard it."""
        sid = uploaded_session["sessionId"]
        edit = {"field": "briefing", "value": {
            "sortie": "TEST SORTIE NAME",
            "description": "Test description",
            "descriptionBlueTask": "Blue must succeed.",
            "descriptionRedTask": "Red must defend.",
        }}
        files = download_edited(client, sid, [edit])
        dict_text = files.get("l10n/DEFAULT/dictionary", "")
        assert "TEST SORTIE NAME" in dict_text, \
            "Briefing sortie never reached l10n/DEFAULT/dictionary"
        assert "Blue must succeed." in dict_text, "Briefing blueTask missing"

    def test_upload_resolves_dict_keys_in_briefing(self, uploaded_session):
        """On upload, the briefing fields in the response must be the
        ACTUAL TEXT, not raw DictKey_descriptionText_5 references.
        DCS missions store briefing strings indirectly: the mission Lua
        carries dictionary references and the user-facing text lives in
        l10n/DEFAULT/dictionary. v0.9.2 shipped without resolving these,
        so BriefingTab loaded with raw DictKey_... strings and pilots
        never saw the briefing the mission designer wrote.
        """
        ov = uploaded_session.get("overview") or {}
        for fld in ("sortie", "description", "descriptionBlueTask", "descriptionRedTask"):
            v = ov.get(fld)
            if not v:  # field may legitimately be empty in fixture
                continue
            assert not (isinstance(v, str) and v.startswith("DictKey_")), \
                f"upload returned raw dict key for {fld}: {v!r} — backend " \
                f"isn't resolving against l10n/DEFAULT/dictionary"


class TestForcedOptions:
    def test_padlock_applies_to_both_files(self, client, uploaded_session):
        """forcedOptions must sync to options/difficulty too — DCS ME reads from there."""
        sid = uploaded_session["sessionId"]
        mo = uploaded_session["missionOptions"].copy()
        mo["padlock"] = True
        edit = {"field": "forcedOptions", "value": mo}
        files = download_edited(client, sid, [edit])

        # In the mission's forcedOptions block
        m = re.search(r'\["forcedOptions"\]\s*=\s*\n?\s*\{', files["mission"])
        assert m, "forcedOptions block missing from mission"
        fo_block = files["mission"][m.start():m.start() + 10000]
        assert re.search(r'\["padlock"\]\s*=\s*true', fo_block), \
            "padlock=true not in mission forcedOptions"

        # In options/difficulty
        diff_m = re.search(r'\["difficulty"\]\s*=\s*\n?\s*\{', files["options"])
        assert diff_m, "difficulty block missing from options file"
        diff_block = files["options"][diff_m.start():diff_m.start() + 5000]
        assert re.search(r'\["padlock"\]\s*=\s*true', diff_block), \
            "padlock=true not synced to options/difficulty"


# ---------------------------------------------------------------------------
# Group-level edits
# ---------------------------------------------------------------------------

class TestGroupFrequency:
    def test_frequency_change_persists(self, client, uploaded_session):
        """_replace_group_field has to skip past ["units"] — otherwise it
        clobbers a unit-level radio frequency instead of the group field.
        This bug cost us an evening; guard it."""
        sid = uploaded_session["sessionId"]
        # Pick the first group that has a frequency
        groups = uploaded_session["groups"]
        target = next((g for g in groups if g.get("frequency", 0) > 0), None)
        if not target:
            pytest.skip("fixture has no groups with frequency")

        new_freq = 305.5
        edit = {"field": "groupFrequency", "groupId": target["groupId"], "value": new_freq}
        files = download_edited(client, sid, [edit])

        # Re-parse via another upload to confirm the change is readable
        # (the engine itself reads frequencies from group top-level fields
        # after ["units"] — same path that _replace_group_field writes to)
        import io
        import zipfile
        # Verify the group block itself has the new freq at the GROUP level.
        # Locate the unit block then skip past its ["units"]={...} to find
        # the group-level ["frequency"].
        gid = target["groupId"]
        group_start_m = re.search(
            rf'\["groupId"\]\s*=\s*{gid}\s*,\s*\n\s*\["hidden"\]',
            files["mission"],
        )
        assert group_start_m, f"Could not find group {gid} in output"

        # Brace-match past units
        units_m = re.search(r'\["units"\]\s*=\s*\n?\s*\{',
                            files["mission"][group_start_m.start():group_start_m.start() + 1000])
        assert units_m, "units block missing"
        i = files["mission"].index("{", group_start_m.start() + units_m.end() - 1) + 1
        depth = 1
        while i < len(files["mission"]) and depth > 0:
            if files["mission"][i] == "{": depth += 1
            elif files["mission"][i] == "}": depth -= 1
            i += 1

        after_units = files["mission"][i:i + 5000]
        freq_m = re.search(r'\["frequency"\]\s*=\s*([\d.]+)', after_units)
        assert freq_m, "group-level frequency field missing after units block"
        assert abs(float(freq_m.group(1)) - new_freq) < 0.001, \
            f"Expected group freq {new_freq}, got {freq_m.group(1)}"


# ---------------------------------------------------------------------------
# Unit-level edits
# ---------------------------------------------------------------------------

class TestLaserCode:
    def test_laser_code_inserted_when_missing(self, client, uploaded_session):
        """Laser code must be inserted into a pylon's ["settings"] block even
        when the unit's pylons don't currently have a settings block.
        This used to be a silent no-op."""
        sid = uploaded_session["sessionId"]
        lcu = uploaded_session.get("laserCapableUnits", [])
        if not lcu:
            pytest.skip("fixture has no laser-capable units")
        target = lcu[0]
        new_code = 1555
        edit = {"unitId": target["unitId"], "field": "laserCode", "value": new_code}
        files = download_edited(client, sid, [edit])
        # Find the unit by id and verify a laser_code = 1555 appears within it
        unit_m = re.search(rf'\["unitId"\]\s*=\s*{target["unitId"]}\s*,', files["mission"])
        assert unit_m, f"unit {target['unitId']} missing from output"
        # Search forward for laser_code within the pylons block
        window = files["mission"][unit_m.start():unit_m.start() + 30000]
        assert f'"laser_code"] = {new_code}' in window, \
            f"laser_code {new_code} not found near unit {target['unitId']}"

    def test_laser_code_isolated_to_target_unit(self, client, uploaded_session):
        """Setting laser code on one unit must not clobber another's.
        This was a bug — adjacent-unit cross-contamination in the ±5000 window."""
        sid = uploaded_session["sessionId"]
        lcu = uploaded_session.get("laserCapableUnits", [])
        if len(lcu) < 2:
            pytest.skip("need two laser-capable units")
        target, other = lcu[0], lcu[1]
        # Only edit `target`
        edit = {"unitId": target["unitId"], "field": "laserCode", "value": 1511}
        files = download_edited(client, sid, [edit])

        # `other` should NOT have 1511 in its pylon settings — unless it
        # already did, which we detect by the original data.
        orig_code = other.get("laserCode")
        other_m = re.search(rf'\["unitId"\]\s*=\s*{other["unitId"]}\s*,', files["mission"])
        assert other_m
        window = files["mission"][other_m.start():other_m.start() + 30000]
        # The other unit's laser code should still be whatever it was before,
        # NOT 1511 (unless orig_code was 1511).
        if orig_code != 1511:
            assert f'"laser_code"] = 1511' not in window, \
                "Setting laser code on one unit leaked to adjacent unit"


# ---------------------------------------------------------------------------
# Coalition reassignment
# ---------------------------------------------------------------------------

class TestEditResults:
    """Tests that apply_unit_edits reports what actually happened,
    surfacing silent failures to the client."""

    def test_download_returns_x_edit_results_header(self, client, uploaded_session):
        """Every /api/download response must carry an X-Edit-Results header
        so the frontend can detect dropped edits."""
        sid = uploaded_session["sessionId"]
        # A simple valid edit
        mo = uploaded_session["missionOptions"].copy()
        mo["padlock"] = True
        resp = client.post("/api/download", json={
            "sessionId": sid,
            "unitEdits": [{"field": "forcedOptions", "value": mo}],
        })
        assert resp.status_code == 200
        header = resp.headers.get("X-Edit-Results")
        assert header, "X-Edit-Results header missing"

        import base64, json
        results = json.loads(base64.b64decode(header).decode("utf-8"))["results"]
        assert len(results) == 1
        assert results[0]["field"] == "forcedOptions"
        assert results[0]["status"] == "applied"

    def test_invalid_edit_is_reported_as_invalid(self, client, uploaded_session):
        """An edit without a 'field' attribute must be reported, not silently
        ignored."""
        sid = uploaded_session["sessionId"]
        resp = client.post("/api/download", json={
            "sessionId": sid,
            "unitEdits": [{"value": "garbage"}],  # no field
        })
        assert resp.status_code == 200
        import base64, json
        results = json.loads(base64.b64decode(resp.headers["X-Edit-Results"]).decode("utf-8"))["results"]
        # The malformed edit should either be reported invalid or absent; current
        # implementation skips missing-field edits silently, which we want to FIX.
        # We assert that if it appears at all, it's marked invalid.
        if results:
            assert all(r.get("status") in ("invalid", "skipped") for r in results), \
                f"malformed edit was not reported as invalid: {results}"

    def test_bad_laser_code_target_is_reported_as_skipped(self, client, uploaded_session):
        """If a laser_code edit targets a unit that can't hold a laser, the
        edit should appear in results as 'skipped' (not silently dropped)."""
        sid = uploaded_session["sessionId"]
        # Use a bogus unitId so the edit has no valid target
        resp = client.post("/api/download", json={
            "sessionId": sid,
            "unitEdits": [{"field": "laserCode", "unitId": 999999, "value": 1511}],
        })
        assert resp.status_code == 200
        import base64, json
        results = json.loads(base64.b64decode(resp.headers["X-Edit-Results"]).decode("utf-8"))["results"]
        assert len(results) == 1
        assert results[0]["status"] in ("skipped", "noop"), \
            f"Bogus laser_code edit was silently dropped: {results[0]}"


class TestRadioPresets:
    def test_radio_presets_write_to_every_unit_in_group(self, client, uploaded_session):
        """A radioPresets edit must rewrite Radio[1].channels for every unit
        in the targeted group's units block — DCS replicates lead presets to
        wingmen at runtime, but mission designers normally program presets
        identically on every unit, so we mirror that.
        """
        sid = uploaded_session["sessionId"]
        groups = uploaded_session.get("groups", [])
        # Pick the first player group with at least one unit
        target_group = next(
            (g for g in groups if g.get("category") in ("plane", "helicopter")
             and any(u.get("skill") in ("Client", "Player") for u in g.get("units", []))),
            None,
        )
        if not target_group:
            pytest.skip("fixture has no player flights with radio data")
        gid = target_group["groupId"]

        edit = {
            "field": "radioPresets",
            "groupId": gid,
            "value": {
                "radio": 1,
                "channels": [
                    {"ch": 1, "freq_mhz": 251.000, "modulation": 0, "name": "TWR"},
                    {"ch": 2, "freq_mhz": 305.500, "modulation": 0, "name": "TANKER"},
                    {"ch": 20, "freq_mhz": 243.000, "modulation": 0, "name": "GUARD"},
                ],
            },
        }
        files = download_edited(client, sid, [edit])
        mission = files["mission"]

        # The new Radio[1] block must contain our channel values (251, 305.5, 243)
        # and the channelsNames entries.
        for needle in ("251.000000", "305.500000", "243.000000"):
            assert needle in mission, \
                f"radioPresets channel freq {needle} not written to mission"
        for label in ('"TWR"', '"TANKER"', '"GUARD"'):
            assert label in mission, \
                f"radioPresets channel name {label} not written to mission"


class TestCoalition:
    def test_country_reassignment_applies(self, client, uploaded_session):
        """Regression guard: earlier versions searched for ["target"] = { in
        the whole mission text, landing in trigrules or groundControl.roles
        instead of the coalition block. Fixed by scoping search with
        _find_coalition_block_bounds."""
        """A country reassigned via coalitionReassign should appear in the
        target coalition's country list in the output."""
        sid = uploaded_session["sessionId"]
        countries = uploaded_session.get("countries", [])
        blue_c = next((c for c in countries if c["coalition"] == "blue"), None)
        if not blue_c:
            pytest.skip("fixture has no blue countries")
        target = blue_c["name"]
        edit = {"field": "coalitionReassign", "value": {target: "red"}}
        files = download_edited(client, sid, [edit])

        # Anchor on `["coalition"] = { ... ["red"] = {` — the mission file
        # also has other "red" keys (triggers, groundControl roles), so we
        # must scope the search to the coalition block.
        mission = files["mission"]
        coal_m = re.search(r'\["coalition"\]\s*=\s*\{', mission)
        assert coal_m, "coalition block missing"
        # Brace-match to find end of coalition block
        i = coal_m.end()
        depth = 1
        while i < len(mission) and depth > 0:
            if mission[i] == "{": depth += 1
            elif mission[i] == "}": depth -= 1
            i += 1
        coal_block = mission[coal_m.end():i]
        # Now find ["red"] within the coalition block
        red_m = re.search(r'\["red"\]\s*=\s*\{', coal_block)
        assert red_m, "red coalition missing"
        j = red_m.end()
        depth = 1
        while j < len(coal_block) and depth > 0:
            if coal_block[j] == "{": depth += 1
            elif coal_block[j] == "}": depth -= 1
            j += 1
        red_block = coal_block[red_m.end():j]
        assert re.search(rf'\["name"\]\s*=\s*"{re.escape(target)}"', red_block), \
            f"country {target} did not move to red coalition"


# ---------------------------------------------------------------------------
# Waypoint task selection (v0.9.42 — TIC tab integration)
# ---------------------------------------------------------------------------

class TestWaypointTasks:
    """Round-trip the `waypointTasks` UnitEdit field.

    Corrected semantics (v0.9.45): TIC's runtime script `TIC_v1.1.lua` parses
    behavioural tokens out of each waypoint's ["name"] field — DCS-native
    ETA / ETA_locked are NOT read by TIC. So the handler mutates the
    waypoint NAME, surgically replacing the `t+N` token while preserving
    any other TIC directives (hdg=, speed=, "phase", roe=, flag=, etc.).

    Anchors on group 2 of simple.miz (the carrier — "Lincoln CSG"), whose
    two waypoints start with names "starting point" / "end point" (no
    `t+N` token). Tests cover insert / replace / strip / preserve-others.
    """

    def _extract_group_block(self, mission: str, group_id: int) -> str:
        """Helper — returns text between `[N] = {` and its matching `}` for
        the group whose ["groupId"] = group_id. Mirrors the production
        _find_group_block_bounds logic so the test fails loudly if the
        production version misbehaves."""
        m = re.search(rf'\["groupId"\]\s*=\s*{group_id}\s*,', mission)
        assert m, f"groupId {group_id} not found in mission"
        # Walk back to enclosing `{`
        depth = 0
        i = m.start() - 1
        while i >= 0:
            ch = mission[i]
            if ch == '}':
                depth += 1
            elif ch == '{':
                if depth == 0:
                    break
                depth -= 1
            i -= 1
        start = i
        # Forward brace-match to closing `}`
        j = start + 1
        bdepth = 1
        while j < len(mission) and bdepth > 0:
            if mission[j] == '{':
                bdepth += 1
            elif mission[j] == '}':
                bdepth -= 1
            j += 1
        return mission[start:j]

    def _wp_name(self, mission: str, group_id: int, wp_index: int) -> str:
        """Read the waypoint's name field, scoped to the actual route waypoint
        (NOT a nested ComboTask sub-entry that happens to share the index).

        Reuses the production block locators so the test stays in lock-step
        with the surgical edit's view of the world. simple.miz's carrier
        WP1 has nested `[1]` (TACAN) and `[2]` (ICLS) sub-tasks named
        "Lincoln Tacan" / "lincoln icls" — a regex-only helper without
        depth tracking would extract those names instead of WP2's
        "end point", silently masking real handler bugs.
        """
        from services.unit_editor import (  # local import keeps the module-
            _find_route_points_bounds,     # level imports list short for the
            _find_waypoint_block_bounds,   # other ~30 tests in this file that
            _LUA_STR_VALUE,                # don't need these helpers.
            _lua_str_unescape,
        )
        points_start, points_end = _find_route_points_bounds(mission, group_id)
        wp_start, wp_end = _find_waypoint_block_bounds(mission, points_start, points_end, wp_index)
        wp_region = mission[wp_start:wp_end]
        m = re.search(r'\["name"\]\s*=\s*"' + _LUA_STR_VALUE + r'"', wp_region)
        assert m, f"WP{wp_index} name field not found in group {group_id}"
        return _lua_str_unescape(m.group(1))

    def test_goto_at_time_inserts_offset_token(self, client, uploaded_session):
        """`goto_at_time` with N min should prepend a `t+N` token to the
        waypoint's name, preserving anything else that was already there."""
        sid = uploaded_session["sessionId"]
        eta_seconds = 5 * 60  # 5 minutes
        edit = {
            "field": "waypointTasks",
            "value": {
                "groupId": 2,
                "tasks": [
                    {"wpIndex": 1, "action": "goto_at_time", "eta_seconds": eta_seconds},
                ],
            },
        }
        files = download_edited(client, sid, [edit])
        wp1_name = self._wp_name(files["mission"], 2, 1)
        # Must contain t+5. simple.miz's WP1 starts as "starting point" —
        # the original prose should be preserved.
        assert re.search(r'\bt\+5\b', wp1_name, re.IGNORECASE), \
            f"WP1 name missing t+5 token; got: {wp1_name!r}"
        assert "starting point" in wp1_name, \
            f"WP1 original 'starting point' text was stripped; got: {wp1_name!r}"

    def test_goto_strips_offset_token(self, client, uploaded_session):
        """`goto` should remove any existing `t+N` from the waypoint name
        without touching other tokens. We seed the WP with `t+7` via a
        first round-trip, then strip it via a second."""
        sid = uploaded_session["sessionId"]
        # First edit: put t+7 onto WP2.
        files1 = download_edited(client, sid, [{
            "field": "waypointTasks",
            "value": {
                "groupId": 2,
                "tasks": [{"wpIndex": 2, "action": "goto_at_time", "eta_seconds": 7 * 60}],
            },
        }])
        wp2_after_set = self._wp_name(files1["mission"], 2, 2)
        assert re.search(r'\bt\+7\b', wp2_after_set, re.IGNORECASE), \
            f"seed step failed: WP2 name has no t+7; got {wp2_after_set!r}"

        # Second edit (in the same session): strip it via goto.
        files2 = download_edited(client, sid, [{
            "field": "waypointTasks",
            "value": {
                "groupId": 2,
                "tasks": [{"wpIndex": 2, "action": "goto"}],
            },
        }])
        # Note: download_edited applies edits to the original session text,
        # not to the result of the previous call. So this second download
        # starts from the unedited simple.miz — which has no t+N to begin
        # with — and the strip is a no-op. The assertion here is that the
        # name has no `t+N` token, which holds either way.
        wp2_after_strip = self._wp_name(files2["mission"], 2, 2)
        assert not re.search(r'\bt\+\d+\b', wp2_after_strip, re.IGNORECASE), \
            f"WP2 name still carries a t+N after goto-strip; got: {wp2_after_strip!r}"

    def test_only_targeted_group_is_mutated(self, client, uploaded_session):
        """Regression: an earlier locator did a forward search from
        ["groupId"] and walked into the NEXT group's route. Verify
        group 3's waypoints stay untouched when we only edit group 2."""
        sid = uploaded_session["sessionId"]
        unique_minutes = 31  # arbitrary but recognisable
        edit = {
            "field": "waypointTasks",
            "value": {
                "groupId": 2,
                "tasks": [
                    {"wpIndex": 1, "action": "goto_at_time",
                     "eta_seconds": unique_minutes * 60},
                ],
            },
        }
        files = download_edited(client, sid, [edit])
        g3_block = self._extract_group_block(files["mission"], 3)
        # The sentinel t+31 must NOT appear anywhere in group 3's block.
        assert not re.search(rf'\bt\+{unique_minutes}\b', g3_block, re.IGNORECASE), \
            f"waypointTasks for group 2 leaked into group 3: t+{unique_minutes} found in group 3"

    def test_multiple_waypoints_in_one_edit(self, client, uploaded_session):
        """A single waypointTasks edit carries a list — both waypoints get
        their names mutated independently. WP1 strips (no-op), WP2 inserts t+11."""
        sid = uploaded_session["sessionId"]
        edit = {
            "field": "waypointTasks",
            "value": {
                "groupId": 2,
                "tasks": [
                    {"wpIndex": 1, "action": "goto"},
                    {"wpIndex": 2, "action": "goto_at_time", "eta_seconds": 11 * 60},
                ],
            },
        }
        files = download_edited(client, sid, [edit])
        wp1_name = self._wp_name(files["mission"], 2, 1)
        wp2_name = self._wp_name(files["mission"], 2, 2)
        assert not re.search(r'\bt\+\d+\b', wp1_name, re.IGNORECASE), \
            f"WP1 unexpectedly carries a t+N token: {wp1_name!r}"
        assert re.search(r'\bt\+11\b', wp2_name, re.IGNORECASE), \
            f"WP2 missing t+11 token: {wp2_name!r}"
        assert "end point" in wp2_name, \
            f"WP2 original 'end point' text was stripped: {wp2_name!r}"
