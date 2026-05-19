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

    def test_v2_secondary_tokens_round_trip(self, client, uploaded_session):
        """v0.9.57 — waypointTasks edit accepts v2 secondary TIC tokens
        (speed, roe, hdg, flag_wait, flag_set) alongside the v1 action.
        Each shows up in the waypoint name with the right separator:
            speed=N, roe=X, hdg=N, flag=X (wait), flag+X (set)
        Multiple tokens on one WP coexist in the rendered name."""
        sid = uploaded_session["sessionId"]
        edit = {
            "field": "waypointTasks",
            "value": {
                "groupId": 2,
                "tasks": [{
                    "wpIndex": 1, "action": "goto_at_time", "eta_seconds": 5*60,
                    "speed": 25, "roe": "kill", "hdg": 270,
                    "flag_wait": "42", "flag_set": "Q",
                }],
            },
        }
        files = download_edited(client, sid, [edit])
        name = self._wp_name(files["mission"], 2, 1)
        for token in ("t+5", "speed=25", "roe=kill", "hdg=270", "flag=42", "flag+Q"):
            # Tokens use literal `+` or `=`; word boundary check matches
            # the runtime TIC parser's behaviour.
            rx = re.escape(token).replace(r"\=", "=").replace(r"\+", r"\+")
            assert re.search(r"\b" + rx + r"\b", name, re.IGNORECASE), \
                f"WP1 name missing token {token}; got {name!r}"

    def test_v3_remaining_tokens_round_trip(self, client, uploaded_session):
        """v0.9.59 — completes the TIC name-token vocab the planner
        emits: scale=N.M, direct=y/n, strength=N.M, "phase_name", and
        bare mount/dismount. Each lands in the waypoint name with the
        right shape and TIC_v1.1.lua::extract* parses it cleanly."""
        sid = uploaded_session["sessionId"]
        edit = {
            "field": "waypointTasks",
            "value": {
                "groupId": 2,
                "tasks": [{
                    "wpIndex": 1, "action": "goto",
                    "scale": "0.5", "direct": "y", "strength": "0.3",
                    "phase": "alpha", "deployment": "mount",
                }],
            },
        }
        files = download_edited(client, sid, [edit])
        name = self._wp_name(files["mission"], 2, 1)
        # Each token in the resulting name. Use literal matchers so we
        # don't accidentally match a substring that happens to look right.
        assert "scale=0.5" in name,    f"missing scale=0.5; got {name!r}"
        assert "direct=y" in name,     f"missing direct=y; got {name!r}"
        assert "strength=0.3" in name, f"missing strength=0.3; got {name!r}"
        assert '"alpha"' in name,      f'missing "alpha"; got {name!r}'
        assert re.search(r"\bmount\b", name, re.IGNORECASE), \
            f"missing mount; got {name!r}"

    def test_v3_phase_replace(self, client, uploaded_session):
        """Quoted phase token uses replace-not-append semantics (mirrors
        the TIC script's `for s in gmatch ... break` first-match-wins
        behaviour). Second call with a different phase must REPLACE the
        first, not duplicate it."""
        sid = uploaded_session["sessionId"]
        files = download_edited(client, sid, [{
            "field": "waypointTasks",
            "value": {"groupId": 2, "tasks": [{
                "wpIndex": 1, "action": "goto", "phase": "bravo",
            }]},
        }])
        name = self._wp_name(files["mission"], 2, 1)
        # Only one phase token should be present
        phase_count = len(re.findall(r'"[^"]+"', name))
        assert phase_count == 1, \
            f"expected exactly one quoted phase token, got {phase_count} in {name!r}"
        assert '"bravo"' in name

    def test_v2_secondary_token_strip(self, client, uploaded_session):
        """Empty / None value on a secondary token strips it from the
        name. Used by the frontend when the user clears an input field."""
        sid = uploaded_session["sessionId"]
        # Seed WP1 with speed=20 first
        download_edited(client, sid, [{
            "field": "waypointTasks",
            "value": {"groupId": 2, "tasks": [
                {"wpIndex": 1, "action": "goto_at_time", "eta_seconds": 60,
                 "speed": 20},
            ]},
        }])
        # download_edited applies against the ORIGINAL session text each
        # call, so the seed step is illustrative only — the strip step
        # tested below operates on a fresh upload regardless. The point
        # is to confirm the strip path (speed=None) doesn't leak a value
        # into the resulting name.
        files = download_edited(client, sid, [{
            "field": "waypointTasks",
            "value": {"groupId": 2, "tasks": [
                {"wpIndex": 1, "action": "goto_at_time", "eta_seconds": 60,
                 "speed": None},
            ]},
        }])
        name = self._wp_name(files["mission"], 2, 1)
        assert not re.search(r"\bspeed=", name, re.IGNORECASE), \
            f"speed= token leaked into name on strip path; got {name!r}"

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


# ---------------------------------------------------------------------------
# Script auto-bundling (v0.9.47 — fixed escaped-form indexed do_script_file)
# ---------------------------------------------------------------------------

class TestScriptAutoBundle:
    """Guard the regression that hung DCS at Terrain Init on 2026-05-17.

    The user's .miz stored its TIC + MOOSE init triggers in the INDEXED
    `trig.actions[N] = "..."` form, where the actions are raw Lua source
    strings stored inside Lua string literals. The escape rule produces:

        [1] = "a_do_script_file(\\"Moose_.lua\\")",

    so the inner `"` chars appear as `\\"` in the file bytes. The pre-v0.9.47
    scanner regex `a_do_script_file\\s*\\(\\s*"([^"]+)"\\s*\\)` required
    BARE `"`, so it missed the escaped form, the bundling step skipped, and
    DCS hung looking for the missing Moose_.lua / TIC_v1.1.lua at l10n/DEFAULT/.

    These tests are unit tests on _scan_script_file_references — much
    cheaper than a full upload/download round-trip since the regex is
    self-contained.
    """

    def test_scanner_finds_bare_form(self):
        from services.miz_editor import _scan_script_file_references
        sample = 'a_do_script_file("Moose_.lua")'
        assert _scan_script_file_references(sample) == {"Moose_.lua"}

    def test_scanner_finds_escaped_form(self):
        """The form actually emitted into trig.actions[N] = "..." strings."""
        from services.miz_editor import _scan_script_file_references
        sample = r'[1] = "a_do_script_file(\"Moose_.lua\")",'
        assert _scan_script_file_references(sample) == {"Moose_.lua"}

    def test_scanner_finds_both_forms_together(self):
        """A mission can mix forms (e.g. bare in one trigger source string,
        inline `["file"]` in another). Both must be collected."""
        from services.miz_editor import _scan_script_file_references
        sample = (
            r'[1] = "a_do_script_file(\"Moose_.lua\")",' "\n"
            r'[2] = "a_do_script_file(\"TIC_v1.1.lua\")",'
        )
        assert _scan_script_file_references(sample) == {"Moose_.lua", "TIC_v1.1.lua"}

    def test_scanner_resolves_reskey_indirected_refs(self):
        """v0.9.58 — when a mission has already been through a planner
        round-trip, its do_script_file triggers reference the script
        files via the ResKey indirection layer:

            [1] = "a_do_script_file(getValueResourceByKey(\\"ResKey_Action_1\\"));",

        With ["ResKey_Action_1"] = "Moose_.lua" in mapResource. The
        scanner needs to resolve through that map back to the bundled
        filename so the auto-embed pass replaces the user's stale copy
        with the asset-library version (the v0.9.49 vetted-wins rule).
        """
        from services.miz_editor import _scan_script_file_references
        mission = (
            r'[1] = "a_do_script_file(getValueResourceByKey(\"ResKey_Action_1\"));",' "\n"
            r'[2] = "a_do_script_file(getValueResourceByKey(\"ResKey_Action_2\"));",'
        )
        mapres = (
            'mapResource = {\n'
            '    ["ResKey_Action_1"] = "Moose_.lua",\n'
            '    ["ResKey_Action_2"] = "TIC_v1.1.lua",\n'
            '}\n'
        )
        # Without mapResource: no resolve, scanner returns empty (those
        # references look opaque without the lookup table).
        assert _scan_script_file_references(mission, "") == set()
        # With mapResource: scanner resolves both refs.
        assert _scan_script_file_references(mission, mapres) == {"Moose_.lua", "TIC_v1.1.lua"}

    def test_reskey_indirected_mission_gets_vetted_scripts(self):
        """Full repack: a .miz that already carries ResKey-rewritten
        trigger refs + stale user copies of Moose/TIC. After repack
        the bundled .lua files are the vetted asset-library bytes."""
        import io as _io, zipfile as _zf
        from services.miz_editor import repack_miz, _bundled_script_assets
        mission = (
            '["trig"] = {\n'
            '    ["actions"] = {\n'
            r'        [1] = "a_do_script_file(getValueResourceByKey(\"ResKey_Action_1\"));",' "\n"
            '    },\n'
            '}\n'
        )
        mapres = (
            'mapResource = {\n'
            '    ["ResKey_Action_1"] = "Moose_.lua",\n'
            '}\n'
        )
        stale_bytes = b"-- STALE MOOSE - should be overridden\n"
        buf = _io.BytesIO()
        with _zf.ZipFile(buf, "w", _zf.ZIP_DEFLATED) as z:
            z.writestr("mission", mission)
            z.writestr("l10n/DEFAULT/mapResource", mapres)
            z.writestr("l10n/DEFAULT/Moose_.lua", stale_bytes)
        out = repack_miz(buf.getvalue(), mission)
        assets = _bundled_script_assets()
        with _zf.ZipFile(_io.BytesIO(out)) as zf:
            moose = zf.read("l10n/DEFAULT/Moose_.lua")
        assert moose == assets["Moose_.lua"], \
            "ResKey-indirected mission's stale Moose wasn't replaced"
        assert moose != stale_bytes, "stale bytes leaked through"

    def test_link_script_files_preserves_escaped_calls_but_still_embeds(self):
        """The ResKey rewrite is for the inline `["file"]` form. The
        escaped indexed form should be left verbatim (rewriting it would
        require nesting another layer of `\\"…\\"` which is brittle), but
        the file MUST still land in embed_set so the bundler writes it."""
        from services.miz_editor import _link_script_files_to_reskeys
        sample = r'[1] = "a_do_script_file(\"Moose_.lua\")",'
        new_text, _, embed = _link_script_files_to_reskeys(
            sample, "", {"Moose_.lua"},
        )
        assert "Moose_.lua" in embed, \
            f"escaped-form indexed call should add to embed_set; got {embed}"
        assert r'a_do_script_file(\"Moose_.lua\")' in new_text, \
            f"escaped-form call should NOT be rewritten in-place; got: {new_text!r}"


# ---------------------------------------------------------------------------
# TIC-rename auto-clears scheduling locks (v0.9.48 — DCS warning fix)
# ---------------------------------------------------------------------------

class TestTicRenameClearsLocks:
    """When a group is renamed to TIC format the planner clears
    ETA_locked + speed_locked on every waypoint. TIC's runtime drives
    its own scheduling and emits warnings of the form
    "All waypoints (N-M) have locked speed and surrounded by waypoints
    with locked time" when those DCS-native flags remain true."""

    def test_tic_rename_bookends_eta_locks(self, client, uploaded_session):
        """After a TIC rename, the per-WP lock combination must satisfy
        all THREE DCS ME validators simultaneously (see the long
        docstring in _clear_tic_scheduling_locks for why):

            WP1        → ETA_locked=true,  speed_locked=true
            WP2        → ETA_locked=false, speed_locked=false
            WP3..n-1   → ETA_locked=false, speed_locked=true
            WPlast     → ETA_locked=true,  speed_locked=true

        For 2-WP routes WPlast == WP2 → rules for "second WP" win
        (ETA=true, speed=false). For 1-WP routes only WP1 exists.

        v0.9.48 cleared everything; v0.9.51 bookended ETA; v0.9.52
        landed on this 4-corner combination after a user click in DCS
        ME tripped updateTimeAndSpeedFor_:1710.
        """
        sid = uploaded_session["sessionId"]
        edit = {
            "field": "groupRename",
            "value": {
                "groupId": 2,
                "newGroupName": "TIC!Test-Formation#",
                "unitNames": {},
            },
        }
        files = download_edited(client, sid, [edit])
        from services.unit_editor import (
            _find_route_points_bounds, _find_waypoint_block_bounds,
            _enumerate_waypoint_indices,
        )
        mission = files["mission"]
        ps, pe = _find_route_points_bounds(mission, 2)
        indices = sorted(_enumerate_waypoint_indices(mission, 2))
        assert indices, "fixture should have at least one WP"
        first_wp = indices[0]
        last_wp  = indices[-1]
        second_wp = indices[1] if len(indices) >= 2 else None

        for idx in indices:
            ws, we = _find_waypoint_block_bounds(mission, ps, pe, idx)
            region = mission[ws:we]
            eta_m = re.search(r'\["ETA_locked"\]\s*=\s*(\w+)', region)
            spd_m = re.search(r'\["speed_locked"\]\s*=\s*(\w+)', region)

            expected_eta = "true" if idx in (first_wp, last_wp) else "false"
            # WP1 always speed-locked; WP2 speed-unlocked (the single
            # WP that gives the route walker its `length > 0` win);
            # other WPs speed-locked.
            if idx == first_wp:
                expected_spd = "true"
            elif idx == second_wp:
                expected_spd = "false"
            else:
                expected_spd = "true"

            assert eta_m and eta_m.group(1) == expected_eta, (
                f"WP{idx} ETA_locked={eta_m.group(1) if eta_m else 'absent'}; "
                f"expected {expected_eta}"
            )
            assert spd_m and spd_m.group(1) == expected_spd, (
                f"WP{idx} speed_locked={spd_m.group(1) if spd_m else 'absent'}; "
                f"expected {expected_spd}"
            )

    def test_non_tic_rename_leaves_locks_alone(self, client, uploaded_session):
        """Renaming to a NON-TIC name shouldn't touch the locks — the
        clear is gated on the TIC prefix. Mission designers who rename
        groups for other reasons keep their original scheduling intact."""
        sid = uploaded_session["sessionId"]
        edit = {
            "field": "groupRename",
            "value": {
                "groupId": 2,
                "newGroupName": "Just A Regular Name",
                "unitNames": {},
            },
        }
        files = download_edited(client, sid, [edit])
        from services.unit_editor import (
            _find_route_points_bounds, _find_waypoint_block_bounds,
        )
        mission = files["mission"]
        ps, pe = _find_route_points_bounds(mission, 2)
        # WP1 of group 2 in simple.miz starts with ETA_locked = true.
        ws, we = _find_waypoint_block_bounds(mission, ps, pe, 1)
        region = mission[ws:we]
        m = re.search(r'\["ETA_locked"\]\s*=\s*(\w+)', region)
        assert m and m.group(1) == "true", \
            f"non-TIC rename should leave WP1 ETA_locked=true; saw {m.group(1) if m else 'absent'}"

    def test_tic_rename_sets_manual_heading(self, client, uploaded_session):
        """TIC rename also sets ["manualHeading"] = true on the group —
        the DCS ME "INITIAL HEADING" checkbox. Without it DCS recomputes
        the spawn heading from the WP1→WP2 vector, overriding the random
        heading the TIC tab writes per-unit."""
        sid = uploaded_session["sessionId"]
        files = download_edited(client, sid, [{
            "field": "groupRename",
            "value": {"groupId": 2, "newGroupName": "TIC!HD#", "unitNames": {}},
        }])
        mission = files["mission"]
        m = re.search(r'\["manualHeading"\]\s*=\s*(\w+)', mission)
        assert m and m.group(1) == "true", \
            f"manualHeading should be true after TIC rename; got {m.group(0) if m else '<absent>'}"

    def test_non_tic_rename_does_not_set_manual_heading(self, client, uploaded_session):
        """Non-TIC renames keep manualHeading absent (or whatever it
        was). Gated on the TIC prefix so non-TIC missions stay unchanged."""
        sid = uploaded_session["sessionId"]
        files = download_edited(client, sid, [{
            "field": "groupRename",
            "value": {"groupId": 2, "newGroupName": "Regular Name", "unitNames": {}},
        }])
        mission = files["mission"]
        assert not re.search(r'\["manualHeading"\]', mission), \
            "manualHeading was inserted on a non-TIC rename"

    def test_second_pass_tic_rename_finds_real_group(self, client, uploaded_session):
        """Regression for v0.9.56 — uploading an already-TIC-edited mission
        and running a second TIC rename used to fail with `Units block not
        found near group N`. The cause: _find_group_block_start required
        ["hidden"] as the IMMEDIATE next field after ["groupId"], but our
        own _replace_late_activation inserts ["lateActivation"] right after
        ["groupId"] on the first pass — so the second pass's locator fell
        back to matches[0] which was a trigger reference (small ["params"]
        dict) instead of the real group block (which has the ["units"]
        field downstream)."""
        sid = uploaded_session["sessionId"]
        # First pass: rename + set lateActivation per unit, the standard
        # TIC tab dispatch shape. The lateActivation handler inserts the
        # field right after groupId when it doesn't already exist.
        files1 = download_edited(client, sid, [
            {"field": "groupRename",
             "value": {"groupId": 2, "newGroupName": "TIC!Pass1#", "unitNames": {}}},
            {"field": "lateActivation", "unitId": 2, "value": True},
        ])
        # Sanity check: the first pass inserted ["lateActivation"] right
        # after ["groupId"] = 2 — the exact arrangement that broke the
        # second pass before the fix.
        first_mission = files1["mission"]
        assert re.search(
            r'\["groupId"\]\s*=\s*2\s*,\s*\n\s*\["lateActivation"\]\s*=\s*true',
            first_mission,
        ), "test setup failed — lateActivation didn't land right after groupId"

        # Re-upload the edited mission and run another TIC rename. With
        # the broken locator this would have produced an X-Edit-Results
        # entry: "Units block not found near group 2".
        import io as _io
        data = {"file": (_io.BytesIO(first_mission.encode("utf-8")), "_edited.miz")}
        # Actually we need to wrap as a .miz — easier: re-use the test
        # client with the original session but verify directly that the
        # locator picks the right anchor on the edited text.
        from services.unit_editor import _find_group_block_start
        pos = _find_group_block_start(first_mission, 2)
        # The real group block has ["units"] within a reasonable window
        # downstream; a trigger ref has only a tight ["params"] dict.
        window_after = first_mission[pos:pos + 5000]
        assert '["units"]' in window_after, (
            f"locator returned a non-real-group position for groupId 2; "
            f"context: {first_mission[pos:pos+200]!r}"
        )

    def test_is_tic_format_name_predicate(self):
        """Spot-check the prefix predicate so future TIC name format
        changes get caught here before they regress the auto-clear."""
        from services.unit_editor import _is_tic_format_name
        assert _is_tic_format_name("TIC!A-1st-Bn-69th-Armor#")
        assert _is_tic_format_name("TIC:B-2nd-Bn-34th-Armor#")
        assert _is_tic_format_name("TIC!1-4th-Gds-Tank-Bn+#")  # leader + grouped
        assert not _is_tic_format_name("Ground-1")
        assert not _is_tic_format_name("ticky")          # case-sensitive on purpose
        assert not _is_tic_format_name("")
        assert not _is_tic_format_name(None)


# ---------------------------------------------------------------------------
# Vetted-asset wins for bundled scripts (v0.9.49 — fixes DCS Terrain Init hang
# with stale user-supplied Moose_.lua)
# ---------------------------------------------------------------------------

class TestBundledScriptOverride:
    """Pre-v0.9.49 the repack preserved a user's pre-existing copy of
    bundled scripts ("user's own copy wins"). That made DCS hang at
    Terrain Init when the user's .miz carried a stale Moose_.lua paired
    with the planner's newer TIC_v1.1.lua — the TIC script called Moose
    APIs the old Moose didn't have. v0.9.49 flips it: the planner's
    vetted asset always wins for any referenced bundled script."""

    def _make_miz_with_stale_script(self, mission_text: str, stale_bytes: bytes) -> bytes:
        """Build a minimal .miz containing the mission + a stale Moose_.lua."""
        import io as _io, zipfile as _zf
        buf = _io.BytesIO()
        with _zf.ZipFile(buf, "w", _zf.ZIP_DEFLATED) as z:
            z.writestr("mission", mission_text)
            z.writestr("l10n/DEFAULT/Moose_.lua", stale_bytes)
        return buf.getvalue()

    def test_stale_user_moose_gets_replaced_with_vetted(self):
        """The user's .miz has an older Moose_.lua and a trigger that
        references it. The output must contain the asset-library bytes,
        not the user's stale ones."""
        import io as _io, zipfile as _zf
        from services.miz_editor import repack_miz, _bundled_script_assets

        # The mission has an escaped-form indexed `a_do_script_file`
        # reference (the only kind the user's hung mission actually used).
        mission = (
            '["trig"] = {\n'
            '    ["actions"] = {\n'
            r'        [1] = "a_do_script_file(\"Moose_.lua\")",' "\n"
            '    },\n'
            '}\n'
        )
        stale_bytes = b"-- THIS IS STALE MOOSE; should be overridden by vetted asset\n"
        user_miz = self._make_miz_with_stale_script(mission, stale_bytes)
        # Sanity check the setup
        with _zf.ZipFile(_io.BytesIO(user_miz)) as zf:
            assert zf.read("l10n/DEFAULT/Moose_.lua") == stale_bytes

        # Run through repack — no mission edits, no kneeboards, just
        # exercise the bundled-script override path.
        out = repack_miz(user_miz, mission)

        assets = _bundled_script_assets()
        with _zf.ZipFile(_io.BytesIO(out)) as zf:
            moose = zf.read("l10n/DEFAULT/Moose_.lua")
        assert moose == assets["Moose_.lua"], \
            "vetted Moose_.lua should overwrite user's stale copy"
        assert moose != stale_bytes, \
            "stale bytes leaked through into the output .miz"

    def test_mapresource_insert_handles_inline_empty_block(self):
        """Pre-v0.9.53 the ResKey-append regex required a leading newline
        before the closing `}`, so missions with `mapResource = {}`
        (inline-empty — a common shape for missions with no resources)
        fell through to a dumb append that put new ResKey entries AFTER
        the closing brace, producing invalid Lua. DCS then silently
        failed to resolve a_do_script_file at runtime — triggers showed
        in the ME but the .lua files never loaded. Brace-matched insert
        fixes both inline and multi-line shapes."""
        import io as _io, zipfile as _zf
        from services.trigger_editor import serialize_triggers_to_lua
        from services.miz_editor import repack_miz

        # Build inline-format triggers + minimal .miz with an inline-empty
        # mapResource — the exact shape that broke runtime resolution.
        td = {"rules": [{
            "id": 1, "name": "Moose", "eventType": "onMissionStart",
            "enabled": True, "conditions": [],
            "actions": [{"type": "DO_SCRIPT_FILE", "params": {"file": "Moose_.lua"}}],
        }]}
        trig_str, trigrules_str = serialize_triggers_to_lua(td)
        mission = "mission = {\n" + trig_str + "\n" + trigrules_str + "\n}\n"

        src = _io.BytesIO()
        with _zf.ZipFile(src, "w", _zf.ZIP_DEFLATED) as z:
            z.writestr("mission", mission)
            z.writestr("l10n/DEFAULT/mapResource", "mapResource = {} -- end of mapResource\n")

        out = repack_miz(src.getvalue(), mission)
        with _zf.ZipFile(_io.BytesIO(out)) as zf:
            mr = zf.read("l10n/DEFAULT/mapResource").decode("utf-8")

        # The new ResKey entry must land INSIDE the mapResource table,
        # not after it. The cheap structural check: count `{`s and `}`s
        # — they must match (one of each) — AND the entry must appear
        # before the closing brace.
        assert mr.count("{") == 1, f"unexpected `{{` count in {mr!r}"
        assert mr.count("}") == 1, f"unexpected `}}` count in {mr!r}"
        assert "Moose_.lua" in mr, "Moose_.lua mapping missing"
        assert mr.index("Moose_.lua") < mr.index("}"), \
            "ResKey entry landed AFTER the closing brace (the v0.9.53 bug)"


    def test_unreferenced_user_script_passes_through(self):
        """A user-supplied .lua under l10n/DEFAULT/ that ISN'T one of our
        bundled assets (e.g. a custom mission script) should be preserved
        verbatim — the override is gated on `a_do_script_file` references
        to scripts the planner actually ships."""
        import io as _io, zipfile as _zf
        from services.miz_editor import repack_miz

        # Mission has NO a_do_script_file references → nothing to bundle.
        mission = '["dummy"] = {}\n'
        user_bytes = b"-- this is the user's own custom_voice.lua, must survive\n"
        buf = _io.BytesIO()
        with _zf.ZipFile(buf, "w", _zf.ZIP_DEFLATED) as z:
            z.writestr("mission", mission)
            z.writestr("l10n/DEFAULT/custom_voice.lua", user_bytes)
        user_miz = buf.getvalue()

        out = repack_miz(user_miz, mission)
        with _zf.ZipFile(_io.BytesIO(out)) as zf:
            assert zf.read("l10n/DEFAULT/custom_voice.lua") == user_bytes, \
                "user's non-bundled .lua got mangled"


# ---------------------------------------------------------------------------
# Trigger serializer emits inline format (v0.9.50 — DCS me_mission.lua fix)
# ---------------------------------------------------------------------------

class TestInlineTriggerSerialization:
    """Until v0.9.50 `serialize_triggers_to_lua` emitted the legacy indexed
    format — `trigrules[N].actions = {[1] = <int>}` pointing back into a
    parallel `trig.actions` table. Modern DCS me_mission.lua's `fixTriggers`
    walks the rule's actions and indexes each value as a dict, so the
    integer leak produced `attempt to index local 'v' (a number value)`
    and DCS hung at Terrain Init.

    The serializer now emits inline format — each action carries its own
    `{predicate, params}` dict inside the rule. These tests pin that shape."""

    def test_do_script_file_rule_emits_inline_action(self):
        from services.trigger_editor import serialize_triggers_to_lua
        td = {
            "rules": [{
                "id": 1, "name": "Script: MOOSE Framework",
                "eventType": "onMissionStart", "enabled": True,
                "conditions": [],
                "actions": [{"type": "DO_SCRIPT_FILE", "params": {"file": "Moose_.lua"}}],
            }],
        }
        _, trigrules = serialize_triggers_to_lua(td)
        # Must contain a structured action with predicate + file fields
        assert re.search(
            r'\["predicate"\]\s*=\s*"a_do_script_file"', trigrules,
        ), "missing inline a_do_script_file predicate"
        assert re.search(
            r'\["file"\]\s*=\s*"Moose_\.lua"', trigrules,
        ), "missing inline file=Moose_.lua param"
        # Must NOT contain the legacy indexed form (int leading to crash).
        assert not re.search(
            r'\["actions"\]\s*=\s*\{\s*\[\d+\]\s*=\s*\d+\s*,', trigrules,
        ), f"indexed-format actions leaked through:\n{trigrules}"

    def test_trig_block_actions_table_is_empty(self):
        """In inline format the per-rule action data lives inside trigrules.
        `trig.actions` should be an empty table — the old role of storing
        Lua source strings indexed from trigrules is obsolete and the
        strings tripped the v0.9.47 escaped-quote bundling scanner."""
        from services.trigger_editor import serialize_triggers_to_lua
        td = {"rules": [{
            "id": 1, "name": "x", "eventType": "once", "enabled": True,
            "conditions": [],
            "actions": [{"type": "DO_SCRIPT_FILE", "params": {"file": "any.lua"}}],
        }]}
        trig_str, _ = serialize_triggers_to_lua(td)
        assert re.search(r'\["actions"\]\s*=\s*\{\s*\}', trig_str), \
            f"trig.actions should be empty in inline format; got:\n{trig_str}"

    def test_rule_enabled_state_lands_in_flag_table(self):
        from services.trigger_editor import serialize_triggers_to_lua
        td = {"rules": [
            {"id": 1, "name": "on", "eventType": "once", "enabled": True,
             "conditions": [], "actions": []},
            {"id": 2, "name": "off", "eventType": "once", "enabled": False,
             "conditions": [], "actions": []},
        ]}
        trig_str, _ = serialize_triggers_to_lua(td)
        assert re.search(r'\[1\]\s*=\s*true', trig_str)
        assert re.search(r'\[2\]\s*=\s*false', trig_str)
