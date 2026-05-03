"""Mission Debug / Validation Service.

Analyzes a parsed DCS mission for conflicts, SOP deviations, and common issues.
Returns categorized findings (errors, warnings, info) for the debug panel.
"""

import re
from collections import defaultdict

# ---------------------------------------------------------------------------
# Known types
# ---------------------------------------------------------------------------

CARRIER_TYPES = {
    "CVN_71", "CVN_72", "CVN_73", "CVN_74", "CVN_75",
    "Stennis", "CV_1143_5",  # Kuznetsov
    "VINSON", "CVN-71", "CVN-72", "CVN-73", "CVN-74", "CVN-75",
}

LHA_TYPES = {"LHA_Tarawa", "USS_Tarawa"}

TANKER_TYPES = {
    "KC-135", "KC135MPRS", "KC130", "KC-135BRT",
    "S-3B Tanker", "S-3B", "KC_10_Extender", "KC_10_Extender_D",
    "IL-78M",
}

AWACS_TYPES = {"E-3A", "E-2C", "A-50", "KJ-2000"}

HORNET_TYPES = {"FA-18C_hornet", "FA-18E", "FA-18F"}

# Tanker type keywords for matching (DCS type strings vary)
TANKER_KEYWORDS = ["kc-135", "kc135", "kc130", "kc_10", "kc-130", "s-3b tanker", "il-78"]
AWACS_KEYWORDS = ["e-3a", "e-2c", "a-50", "kj-2000"]

# Protected group/unit names that scripts depend on
PROTECTED_NAMES = ["Roosevelt", "Tarawa"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_type_match(unit_type: str, keywords: list) -> bool:
    t = unit_type.lower()
    return any(kw in t for kw in keywords)


def _is_carrier(unit_type: str) -> bool:
    return unit_type in CARRIER_TYPES or "cvn" in unit_type.lower()


def _is_lha(unit_type: str) -> bool:
    return unit_type in LHA_TYPES or "tarawa" in unit_type.lower() or "lha" in unit_type.lower()


def _is_tanker(unit_type: str) -> bool:
    return unit_type in TANKER_TYPES or _is_type_match(unit_type, TANKER_KEYWORDS)


def _is_awacs(unit_type: str) -> bool:
    return unit_type in AWACS_TYPES or _is_type_match(unit_type, AWACS_KEYWORDS)


def _knots_from_ms(speed_ms: float) -> float:
    return speed_ms * 1.94384


def _feet_from_m(alt_m: float) -> float:
    return alt_m * 3.28084


def _mhz_from_hz(freq_hz: float) -> float:
    return freq_hz / 1e6 if freq_hz > 1e6 else freq_hz


# ---------------------------------------------------------------------------
# Issue class
# ---------------------------------------------------------------------------

class Fix:
    """Auto-fix descriptor attached to an Issue.

    Carries everything the frontend needs to render a before/after
    preview AND dispatch the actual edit(s) when the user clicks
    Apply. Same shape regardless of which check produced it, so the
    Debug tab UI stays uniform.

    `before` / `after` are arbitrary dicts shaped per category — for
    a TACAN conflict they'd be {channel, band}; for a missing ICLS
    they'd be {channel}. The frontend renders them as a labeled
    key-value table without needing per-category branches.

    `edits` is a list of edit objects matching the /api/download
    `unitEdits` payload — pushed straight into editStore on Apply
    so the next download writes them into the .miz.
    """

    def __init__(self, description: str, before: dict, after: dict, edits: list):
        self.description = description
        self.before = before
        self.after = after
        self.edits = edits

    def to_dict(self):
        return {
            "description": self.description,
            "before": self.before,
            "after": self.after,
            "edits": self.edits,
        }


class Issue:
    def __init__(self, severity: str, category: str, title: str, detail: str,
                 group_name: str = "", unit_name: str = "",
                 fix: Fix = None):
        self.severity = severity      # "error", "warning", "info"
        self.category = category      # "frequency", "tacan", "carrier", "tanker", etc.
        self.title = title
        self.detail = detail
        self.group_name = group_name
        self.unit_name = unit_name
        # Optional auto-fix descriptor. None means the issue isn't
        # auto-fixable (user has to make a judgement call) and the
        # frontend hides the Fix button. Issues with simple,
        # well-defined remediations (TACAN/ICLS deconflict, missing
        # carrier beacons, etc.) carry a Fix; subjective ones
        # (frequency choice, protected-name absence) don't.
        self.fix = fix

    def to_dict(self):
        d = {
            "severity": self.severity,
            "category": self.category,
            "title": self.title,
            "detail": self.detail,
        }
        if self.group_name:
            d["groupName"] = self.group_name
        if self.unit_name:
            d["unitName"] = self.unit_name
        if self.fix:
            d["fix"] = self.fix.to_dict()
        return d


# ---------------------------------------------------------------------------
# Individual check functions
# ---------------------------------------------------------------------------

def _check_frequency_conflicts(groups: list) -> list:
    """Find groups sharing the same radio frequency."""
    issues = []
    freq_map = defaultdict(list)

    for g in groups:
        freq = g.get("frequency")
        if not freq or freq == 0:
            continue
        freq_mhz = round(_mhz_from_hz(freq), 3)
        freq_map[freq_mhz].append(g)

    for freq_mhz, glist in freq_map.items():
        if len(glist) > 1:
            names = ", ".join(g["groupName"] for g in glist)
            # Same coalition sharing freq is a conflict; cross-coalition is expected
            coalitions = set(g["coalition"] for g in glist)
            for coal in coalitions:
                coal_groups = [g for g in glist if g["coalition"] == coal]
                if len(coal_groups) > 1:
                    coal_names = ", ".join(g["groupName"] for g in coal_groups)
                    issues.append(Issue(
                        "warning", "frequency",
                        f"Frequency conflict: {freq_mhz} MHz",
                        f"Multiple {coal} groups share {freq_mhz} MHz: {coal_names}",
                    ))

    return issues


def _check_tacan_conflicts(groups: list) -> list:
    """Find groups with duplicate TACAN channel+band.

    Auto-fix: keep the first group's channel, bump every other group
    to the next free channel on the same band. Channel preference
    walks 1..126 odd-then-even (1, 3, 5, ..., 2, 4, 6, ...) — the
    canonical SOP convention puts carriers / lead tankers on odd
    channels and pad-fills with evens.
    """
    issues = []
    tacan_map = defaultdict(list)

    for g in groups:
        tacan = g.get("tacan")
        if not tacan:
            continue
        key = f"{tacan['channel']}{tacan.get('band', 'X')}"
        tacan_map[key].append(g)

    # Snapshot every channel/band pair currently in use, so the
    # deconflict pass below doesn't bump a duplicate onto another
    # already-occupied slot.
    used: set[tuple[int, str]] = set()
    for g in groups:
        t = g.get("tacan")
        if t and t.get("channel"):
            used.add((int(t["channel"]), t.get("band", "X")))

    def next_free(band: str) -> int:
        for ch in [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29,
                   31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55, 57, 59,
                   61, 63, 65, 67, 69, 71, 73, 75, 77, 79, 81, 83, 85, 87, 89,
                   91, 93, 95, 97, 99, 101, 103, 105, 107, 109, 111, 113, 115,
                   117, 119, 121, 123, 125,
                   2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
                   32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60,
                   62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90,
                   92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114, 116,
                   118, 120, 122, 124, 126]:
            if (ch, band) not in used:
                return ch
        return 1  # all 126 channels taken; shouldn't happen

    for key, glist in tacan_map.items():
        if len(glist) > 1:
            names = ", ".join(f"{g['groupName']} ({g.get('tacan', {}).get('callsign', '?')})" for g in glist)
            # Per group on the conflict (except the first — that one
            # keeps the original channel), build a Fix that moves it
            # to the next free channel. We emit ONE issue per
            # conflict pair; the fix payload edits each non-first
            # group in the pair.
            head = glist[0]
            tail = glist[1:]
            tail_band = head.get("tacan", {}).get("band", "X")
            after_assignments: list[tuple[dict, int]] = []
            for g in tail:
                ch = next_free(tail_band)
                after_assignments.append((g, ch))
                used.add((ch, tail_band))

            edits = []
            after_summary = []
            for g, ch in after_assignments:
                # tacan edit anchored on the group's first unit (the
                # ActivateBeacon target). Same shape TacanTab uses.
                unit_id = (g.get("units") or [{}])[0].get("unitId")
                if unit_id is None:
                    continue
                cs = g.get("tacan", {}).get("callsign", "")
                edits.append({
                    "unitId": unit_id,
                    "groupId": g.get("groupId"),
                    "field": "tacan",
                    "value": {"channel": ch, "band": tail_band, "callsign": cs},
                })
                after_summary.append(f"{g['groupName']}: {ch}{tail_band}")

            fix = None
            if edits:
                fix = Fix(
                    description=f"Move {len(edits)} group{'s' if len(edits) != 1 else ''} off {key}",
                    before={"channel_band": key, "groups": [g['groupName'] for g in glist]},
                    after={"keep_on_" + key: head['groupName'],
                           "moves": after_summary},
                    edits=edits,
                )
            issues.append(Issue(
                "error", "tacan",
                f"TACAN conflict: {key}",
                f"Multiple groups on TACAN {key}: {names}",
                fix=fix,
            ))

    return issues


def _check_icls_conflicts(groups: list) -> list:
    """Find groups with duplicate ICLS channels. Auto-fix walks
    odd channels first (5/7/9/11/13 — the canonical carrier set)
    then evens; first conflicting group keeps its channel."""
    issues = []
    icls_map = defaultdict(list)

    for g in groups:
        icls = g.get("icls")
        if not icls:
            continue
        ch = icls["channel"]
        icls_map[ch].append(g)

    used: set[int] = set()
    for g in groups:
        ic = g.get("icls")
        if ic and ic.get("channel"):
            used.add(int(ic["channel"]))

    def next_free_icls() -> int:
        for ch in [1, 3, 5, 7, 9, 11, 13, 15, 17, 19,
                   2, 4, 6, 8, 10, 12, 14, 16, 18, 20]:
            if ch not in used:
                return ch
        return 1

    for ch, glist in icls_map.items():
        if len(glist) > 1:
            names = ", ".join(g["groupName"] for g in glist)
            head = glist[0]
            tail = glist[1:]
            edits = []
            after_summary = []
            for g in tail:
                new_ch = next_free_icls()
                used.add(new_ch)
                unit_id = (g.get("units") or [{}])[0].get("unitId")
                if unit_id is None:
                    continue
                edits.append({
                    "unitId": unit_id,
                    "groupId": g.get("groupId"),
                    "field": "icls",
                    "value": {"channel": new_ch},
                })
                after_summary.append(f"{g['groupName']}: ch {new_ch}")

            fix = None
            if edits:
                fix = Fix(
                    description=f"Move {len(edits)} group{'s' if len(edits) != 1 else ''} off ICLS ch {ch}",
                    before={"channel": ch, "groups": [g['groupName'] for g in glist]},
                    after={f"keep_on_ch_{ch}": head['groupName'],
                           "moves": after_summary},
                    edits=edits,
                )
            issues.append(Issue(
                "error", "icls",
                f"ICLS conflict: Channel {ch}",
                f"Multiple groups on ICLS channel {ch}: {names}",
                fix=fix,
            ))

    return issues


def _check_carriers(groups: list) -> list:
    """Check carrier configuration issues."""
    issues = []
    carrier_groups = []
    lha_groups = []

    for g in groups:
        if g.get("category") != "ship":
            continue
        for u in g.get("units", []):
            if _is_carrier(u["type"]):
                carrier_groups.append(g)
                break
            if _is_lha(u["type"]):
                lha_groups.append(g)
                break

    if not carrier_groups:
        issues.append(Issue(
            "info", "carrier",
            "No carriers found",
            "Mission has no carrier groups.",
        ))

    # Snapshot used TACAN/ICLS slots so the auto-assignments below
    # land on free channels.
    used_tacan: set[tuple[int, str]] = set()
    used_icls: set[int] = set()
    for og in groups:
        ot = og.get("tacan")
        if ot and ot.get("channel"):
            used_tacan.add((int(ot["channel"]), ot.get("band", "X")))
        oi = og.get("icls")
        if oi and oi.get("channel"):
            used_icls.add(int(oi["channel"]))

    def next_free_carrier_tacan() -> int:
        # Carrier TACAN convention: channels in the 70s on X band.
        for ch in [72, 74, 76, 78, 71, 73, 75, 77, 79]:
            if (ch, "X") not in used_tacan:
                return ch
        # Fallback walk
        for ch in range(1, 127):
            if (ch, "X") not in used_tacan:
                return ch
        return 72

    def next_free_carrier_icls() -> int:
        # Carrier ICLS convention: 5/7/9/11/13 on odd channels first.
        for ch in [7, 5, 9, 11, 13, 1, 3, 15, 17, 19,
                   2, 4, 6, 8, 10, 12, 14, 16, 18, 20]:
            if ch not in used_icls:
                return ch
        return 7

    for g in carrier_groups:
        unit_id = (g.get("units") or [{}])[0].get("unitId")

        # Check TACAN
        if not g.get("tacan"):
            fix = None
            if unit_id is not None:
                ch = next_free_carrier_tacan()
                used_tacan.add((ch, "X"))
                # Default callsign from hull number when present
                # (CVN-72 -> "CVN") or use generic.
                hull = (g.get("units") or [{}])[0].get("type", "")
                m = re.search(r'CVN[_-]?(\d{2,3})', hull, re.IGNORECASE)
                callsign = "CVN" if m else "CVN"
                fix = Fix(
                    description=f"Assign TACAN {ch}X to {g['groupName']}",
                    before={"tacan": "(none)"},
                    after={"channel": ch, "band": "X", "callsign": callsign},
                    edits=[{
                        "unitId": unit_id,
                        "groupId": g.get("groupId"),
                        "field": "tacan",
                        "value": {"channel": ch, "band": "X", "callsign": callsign},
                    }],
                )
            issues.append(Issue(
                "error", "carrier",
                f"Carrier missing TACAN: {g['groupName']}",
                f"Carrier group '{g['groupName']}' has no TACAN beacon configured.",
                group_name=g["groupName"],
                fix=fix,
            ))

        # Check ICLS
        if not g.get("icls"):
            fix = None
            if unit_id is not None:
                ch = next_free_carrier_icls()
                used_icls.add(ch)
                fix = Fix(
                    description=f"Assign ICLS ch {ch} to {g['groupName']}",
                    before={"icls": "(none)"},
                    after={"channel": ch},
                    edits=[{
                        "unitId": unit_id,
                        "groupId": g.get("groupId"),
                        "field": "icls",
                        "value": {"channel": ch},
                    }],
                )
            issues.append(Issue(
                "warning", "carrier",
                f"Carrier missing ICLS: {g['groupName']}",
                f"Carrier group '{g['groupName']}' has no ICLS configured.",
                group_name=g["groupName"],
                fix=fix,
            ))

        # Check waypoints (should have at least WP0, WP1, WP2)
        wps = g.get("waypoints", [])
        if len(wps) < 3:
            issues.append(Issue(
                "warning", "carrier",
                f"Carrier few waypoints: {g['groupName']}",
                f"Carrier '{g['groupName']}' has only {len(wps)} waypoint(s). "
                f"Recommend at least 3 (WP0 start, WP1-2 orbit, with WP2 returning to WP0).",
                group_name=g["groupName"],
            ))

    for g in lha_groups:
        # Check LHA speed <= 10kts
        wps = g.get("waypoints", [])
        for wp in wps:
            speed_kts = _knots_from_ms(wp.get("speed_ms", 0))
            if speed_kts > 12:  # small tolerance
                issues.append(Issue(
                    "warning", "carrier",
                    f"LHA speed too high: {g['groupName']}",
                    f"LHA '{g['groupName']}' WP{wp.get('waypoint_number', '?')} speed is "
                    f"{speed_kts:.0f} kts. SOP recommends 10 kts or below.",
                    group_name=g["groupName"],
                ))
                break  # one warning per group is enough

    # Check protected names exist
    all_group_names = [g["groupName"] for g in groups]
    all_unit_names = []
    for g in groups:
        for u in g.get("units", []):
            all_unit_names.append(u.get("name", ""))

    for name in PROTECTED_NAMES:
        found = any(name.lower() in gn.lower() for gn in all_group_names) or \
                any(name.lower() in un.lower() for un in all_unit_names)
        if not found:
            issues.append(Issue(
                "error", "carrier",
                f"Protected name missing: {name}",
                f"No group or unit containing '{name}' found. "
                f"Carrier scripts depend on this name — do not delete or rename.",
            ))

    return issues


def _check_tankers(groups: list) -> list:
    """Check tanker configuration."""
    issues = []
    tanker_groups = []

    for g in groups:
        if g.get("category") not in ("plane",):
            continue
        for u in g.get("units", []):
            if _is_tanker(u["type"]):
                tanker_groups.append(g)
                break

    if not tanker_groups:
        issues.append(Issue(
            "info", "tanker",
            "No tankers found",
            "Mission has no tanker groups.",
        ))
        return issues

    # Check TACAN on tankers
    for g in tanker_groups:
        if not g.get("tacan"):
            issues.append(Issue(
                "warning", "tanker",
                f"Tanker missing TACAN: {g['groupName']}",
                f"Tanker '{g['groupName']}' has no TACAN beacon.",
                group_name=g["groupName"],
            ))

        if not g.get("frequency") or g["frequency"] == 0:
            issues.append(Issue(
                "warning", "tanker",
                f"Tanker missing frequency: {g['groupName']}",
                f"Tanker '{g['groupName']}' has no radio frequency set.",
                group_name=g["groupName"],
            ))

    # Check altitude deconfliction between tankers
    tanker_alts = []
    for g in tanker_groups:
        wps = g.get("waypoints", [])
        if len(wps) >= 2:
            # Use WP1 altitude (orbit altitude)
            alt_ft = _feet_from_m(wps[1].get("altitude_m", 0))
            tanker_alts.append((g["groupName"], alt_ft))

    # Check for tankers within 1000ft of each other
    for i, (name_a, alt_a) in enumerate(tanker_alts):
        for name_b, alt_b in tanker_alts[i + 1:]:
            if abs(alt_a - alt_b) < 1000 and abs(alt_a - alt_b) > 0:
                issues.append(Issue(
                    "warning", "tanker",
                    "Tanker altitude deconfliction",
                    f"'{name_a}' ({alt_a:.0f}ft) and '{name_b}' ({alt_b:.0f}ft) "
                    f"are within 1000ft. Consider adjusting altitude separation.",
                ))
            elif alt_a == alt_b and alt_a > 0:
                issues.append(Issue(
                    "error", "tanker",
                    "Tankers at same altitude",
                    f"'{name_a}' and '{name_b}' are both at {alt_a:.0f}ft.",
                ))

    return issues


def _check_awacs(groups: list) -> list:
    """Check AWACS configuration."""
    issues = []
    awacs_groups = []

    for g in groups:
        if g.get("category") not in ("plane",):
            continue
        for u in g.get("units", []):
            if _is_awacs(u["type"]):
                awacs_groups.append(g)
                break

    if not awacs_groups:
        issues.append(Issue(
            "info", "awacs",
            "No AWACS found",
            "Mission has no AWACS groups.",
        ))
        return issues

    for g in awacs_groups:
        if not g.get("frequency") or g["frequency"] == 0:
            issues.append(Issue(
                "warning", "awacs",
                f"AWACS missing frequency: {g['groupName']}",
                f"AWACS '{g['groupName']}' has no radio frequency set.",
                group_name=g["groupName"],
            ))

    return issues


def _check_client_flights(groups: list, client_units: list) -> list:
    """Check client flight configuration."""
    issues = []

    if not client_units:
        issues.append(Issue(
            "warning", "client",
            "No client slots found",
            "Mission has no player-controllable aircraft.",
        ))
        return issues

    # Check Hornets have STN L16
    for cu in client_units:
        unit_type = cu.get("type", "")
        if unit_type in HORNET_TYPES:
            stn = cu.get("stnL16", "")
            if not stn or stn == "0" or stn == "":
                issues.append(Issue(
                    "warning", "client",
                    f"Hornet missing STN: {cu.get('name', '?')}",
                    f"'{cu.get('name', '?')}' ({unit_type}) has no Link16 STN set.",
                    unit_name=cu.get("name", ""),
                    group_name=cu.get("groupName", ""),
                ))

    # Check for client groups with no frequency
    client_group_names = set(cu.get("groupName", "") for cu in client_units)
    for g in groups:
        if g["groupName"] not in client_group_names:
            continue
        if not g.get("frequency") or g["frequency"] == 0:
            issues.append(Issue(
                "warning", "client",
                f"Client group missing frequency: {g['groupName']}",
                f"Player group '{g['groupName']}' has no radio frequency.",
                group_name=g["groupName"],
            ))

    return issues


def _check_duplicate_ids(groups: list) -> list:
    """Check for duplicate unit IDs."""
    issues = []
    seen_ids = {}

    for g in groups:
        for u in g.get("units", []):
            uid = u.get("unitId")
            if uid in seen_ids:
                issues.append(Issue(
                    "error", "general",
                    f"Duplicate unit ID: {uid}",
                    f"Unit '{u.get('name', '?')}' in '{g['groupName']}' shares ID {uid} "
                    f"with '{seen_ids[uid]}'. This will cause in-game issues.",
                    group_name=g["groupName"],
                    unit_name=u.get("name", ""),
                ))
            else:
                seen_ids[uid] = u.get("name", "?")

    return issues


def _check_duplicate_group_names(groups: list) -> list:
    """Check for duplicate group names."""
    issues = []
    name_count = defaultdict(list)

    for g in groups:
        name_count[g["groupName"]].append(g)

    for name, glist in name_count.items():
        if len(glist) > 1:
            coalitions = ", ".join(set(g["coalition"] for g in glist))
            issues.append(Issue(
                "warning", "general",
                f"Duplicate group name: {name}",
                f"Group name '{name}' appears {len(glist)} times (coalitions: {coalitions}).",
            ))

    return issues


def _check_unit_skill_issues(groups: list) -> list:
    """Check for potential skill-related issues."""
    issues = []
    client_count_by_coalition = defaultdict(int)

    for g in groups:
        for u in g.get("units", []):
            skill = u.get("skill", "")
            if skill in ("Client", "Player"):
                client_count_by_coalition[g["coalition"]] += 1

    if client_count_by_coalition.get("red", 0) > 0 and client_count_by_coalition.get("blue", 0) > 0:
        issues.append(Issue(
            "info", "general",
            "PvP mission detected",
            f"Blue has {client_count_by_coalition['blue']} player slots, "
            f"Red has {client_count_by_coalition['red']} player slots.",
        ))

    return issues


def _check_weather_issues(overview: dict) -> list:
    """Check weather configuration for potential issues."""
    issues = []
    weather = overview.get("weather", {})

    if not weather:
        return issues

    wind_ground = weather.get("wind", {}).get("atGround", {})
    wind_speed = wind_ground.get("speed", 0)

    # High ground wind warning
    if wind_speed > 15:
        wind_kts = wind_speed * 1.94384
        issues.append(Issue(
            "warning", "weather",
            f"High ground winds: {wind_kts:.0f} kts",
            f"Ground wind is {wind_kts:.0f} kts ({wind_speed:.0f} m/s). "
            f"This may affect carrier recovery and ground operations.",
        ))

    # Low visibility
    vis = weather.get("visibility_m", 99999)
    if vis < 5000:
        issues.append(Issue(
            "warning", "weather",
            f"Low visibility: {vis}m",
            f"Visibility is {vis}m. Consider impact on visual approaches and CAS.",
        ))

    # Fog
    if weather.get("fog_enabled"):
        fog_vis = weather.get("fog_visibility", 0)
        issues.append(Issue(
            "info", "weather",
            f"Fog enabled: {fog_vis}m visibility",
            f"Fog is active with {fog_vis}m visibility, thickness {weather.get('fog_thickness', 0)}m.",
        ))

    return issues


def _check_mission_flags(mission_dict: dict) -> list:
    """Check for flag conflicts in triggers."""
    issues = []

    triggers = mission_dict.get("trigrules", {})
    if not triggers:
        return issues

    flag_usage = defaultdict(list)  # flag_number -> [trigger descriptions]

    # slpp normalization converts sequential int-keyed Lua tables to Python lists.
    # Handle both list and dict forms for trigrules / conditions / actions.
    def _iter_items(obj):
        if isinstance(obj, dict):
            return obj.items()
        if isinstance(obj, list):
            return enumerate(obj, start=1)
        return []

    for rule_idx, rule in _iter_items(triggers):
        if not isinstance(rule, dict):
            continue
        rule_name = f"Rule {rule_idx}"

        # Check conditions for flag references
        conditions = rule.get("conditions", {})
        for _, cond in _iter_items(conditions):
            if not isinstance(cond, dict):
                continue
            flag = cond.get("flag")
            if flag is not None:
                flag_usage[flag].append(f"{rule_name} (condition)")

        # Check actions for flag references
        actions = rule.get("actions", {})
        for _, act in _iter_items(actions):
            if not isinstance(act, dict):
                continue
            flag = act.get("flag")
            if flag is not None:
                flag_usage[flag].append(f"{rule_name} (action)")

    # Report flags used by many triggers (potential conflict)
    for flag, usages in flag_usage.items():
        if len(usages) > 3:
            issues.append(Issue(
                "info", "flags",
                f"Flag {flag} heavily used",
                f"Flag {flag} is referenced by {len(usages)} trigger rules.",
            ))

    return issues


def _generate_summary(groups: list, client_units: list, overview: dict) -> list:
    """Generate informational summary items."""
    issues = []

    # Count by category
    cat_counts = defaultdict(int)
    coal_counts = defaultdict(int)
    for g in groups:
        cat_counts[g.get("category", "?")] += len(g.get("units", []))
        coal_counts[g["coalition"]] += len(g.get("units", []))

    total = sum(cat_counts.values())
    issues.append(Issue(
        "info", "summary",
        f"Total units: {total}",
        f"Blue: {coal_counts.get('blue', 0)}, Red: {coal_counts.get('red', 0)}, "
        f"Neutral: {coal_counts.get('neutrals', 0)} | "
        f"Planes: {cat_counts.get('plane', 0)}, Helos: {cat_counts.get('helicopter', 0)}, "
        f"Vehicles: {cat_counts.get('vehicle', 0)}, Ships: {cat_counts.get('ship', 0)}, "
        f"Statics: {cat_counts.get('static', 0)}",
    ))

    issues.append(Issue(
        "info", "summary",
        f"Player slots: {len(client_units)}",
        f"{len(client_units)} client aircraft across "
        f"{len(set(cu.get('groupName') for cu in client_units))} flight groups.",
    ))

    issues.append(Issue(
        "info", "summary",
        f"Theater: {overview.get('theater', '?')}",
        f"Sortie: {overview.get('sortie', 'N/A')} | "
        f"Date: {overview.get('date', '?')} | "
        f"Start: {int(overview.get('start_time', 0)) // 3600:02d}:"
        f"{(int(overview.get('start_time', 0)) % 3600) // 60:02d}Z",
    ))

    return issues


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_debug_analysis(groups: list, client_units: list,
                       overview: dict, mission_dict: dict) -> list:
    """Run all debug checks and return a list of issue dicts.

    Args:
        groups: Parsed group list from extract_full_mission_data
        client_units: Client unit list from find_client_units
        overview: Mission overview from extract_full_mission_data
        mission_dict: Raw parsed mission dict for deep checks
    """
    all_issues = []

    # Run all checks
    all_issues.extend(_generate_summary(groups, client_units, overview))
    all_issues.extend(_check_frequency_conflicts(groups))
    all_issues.extend(_check_tacan_conflicts(groups))
    all_issues.extend(_check_icls_conflicts(groups))
    all_issues.extend(_check_carriers(groups))
    all_issues.extend(_check_tankers(groups))
    all_issues.extend(_check_awacs(groups))
    all_issues.extend(_check_client_flights(groups, client_units))
    all_issues.extend(_check_duplicate_ids(groups))
    all_issues.extend(_check_duplicate_group_names(groups))
    all_issues.extend(_check_unit_skill_issues(groups))
    all_issues.extend(_check_weather_issues(overview))
    all_issues.extend(_check_mission_flags(mission_dict))

    return [issue.to_dict() for issue in all_issues]
