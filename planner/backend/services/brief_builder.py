"""
Mission brief builder — turns a parsed .miz into a structured BriefDocument
the frontend can edit and the renderer can turn into a .pptx.

Design:
  - Pure functions. No I/O, no Flask. Easy to test.
  - Each section gets a sensible default the mission maker can later tweak.
  - Section content is plain strings (free text) or simple lists of dicts
    (tabular data) so the frontend editor can show them as textareas
    or tables without needing a custom renderer per section.
  - Theatre overview blurbs are baked in per-theater (Caucasus, Kola, etc.)
    so a fresh-loaded mission immediately has theatre context without
    any user input.

Output shape:
  WingBrief — single brief covering all blue flights. Compact (8-10 slides).
  Used at the start of the mass briefing.

  FlightBrief — per-flight short brief (4-6 slides). Generated separately
  for each blue player group. Used by individual flights for cockpit
  reference.

This module covers WingBrief (Phase 1). FlightBrief comes in Phase 3.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Dictionary resolver — DCS missions store localised strings in a separate
# `l10n/DEFAULT/dictionary` file. Mission text holds a key like
# `DictKey_sortie_5` and the actual user-visible string lives in the
# dictionary as `["DictKey_sortie_5"] = "Case III Joe"`. We resolve these
# in the builder so the brief shows the real text instead of internal keys.
# ---------------------------------------------------------------------------

# Multi-line strings in DCS dictionary use `\` followed by newline as line
# continuations. We need DOTALL on the inner `\\.` so it matches a backslash
# followed by a newline. The outer pattern stays single-line — keys and the
# `]= "..."` framing don't span lines.
_DICT_ENTRY_RE = re.compile(
    r'\["(DictKey_[a-zA-Z0-9_]+)"\]\s*=\s*"((?:[^"\\]|\\(?:.|\n))*)"',
)


def parse_dictionary(dictionary_text: Optional[str]) -> Dict[str, str]:
    """Parse a DCS l10n/DEFAULT/dictionary into a {key: value} lookup.

    Tolerant — returns {} on None or unparseable input rather than raising,
    since the brief should still render with the raw keys if dictionary
    parsing fails.
    """
    if not dictionary_text:
        return {}
    out: Dict[str, str] = {}
    for m in _DICT_ENTRY_RE.finditer(dictionary_text):
        key, raw = m.group(1), m.group(2)
        out[key] = _unescape_lua_string(raw)
    return out


def _unescape_lua_string(raw: str) -> str:
    """Decode the escape sequences a DCS Lua string can contain.

    DCS uses three flavours:
      - `\\<newline>` — line continuation. The backslash is followed by an
        actual newline character in the source. Becomes a newline.
      - `\\n`, `\\t`, `\\"` — standard escape sequences.
      - `\\\\` — literal backslash.

    Order matters: process literal backslash first via a placeholder so
    it doesn't interfere with subsequent escape decoding.
    """
    # 1. Line continuation: backslash + actual newline → newline
    raw = re.sub(r'\\(\r?\n)', r'\1', raw)
    # 2. Stash literal backslashes so they don't double-decode
    raw = raw.replace('\\\\', '\x00')
    # 3. Standard escape sequences
    raw = raw.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
    # 4. Restore literal backslashes
    return raw.replace('\x00', '\\')


def resolve_dict_key(value: Any, lookup: Dict[str, str]) -> Any:
    """If `value` is a DictKey reference, return the resolved string."""
    if isinstance(value, str) and value.startswith("DictKey_"):
        return lookup.get(value, value)
    return value


# ---------------------------------------------------------------------------
# Data model — kept simple so it round-trips cleanly through JSON to the
# frontend editor and back. Every editable field is either a string
# (textarea) or a list of dicts (table).
# ---------------------------------------------------------------------------

@dataclass
class TimelineRow:
    phase: str        # "Ground Ops", "Takeoff", "Push", "TOT", "Egress", "RTB"
    time_zulu: str    # e.g. "1400Z"
    note: str         # e.g. "All flights chocks out"


@dataclass
class FlightRow:
    callsign: str     # "BENGAL11"
    aircraft: str     # "F/A-18C_hornet"
    count: int        # 2
    role: str         # inferred from group task: "Strike", "CAP", "Tanker"
    frequency: str    # "251.000"
    tacan: str        # "73X" or ""
    home_plate: str   # nearest airbase name


@dataclass
class ThreatRow:
    """One row on the threats slide — represents a spatial cluster, not
    an individual emplacement. Built by _build_threats() which groups
    nearby threats into a single 'threat area' so 8× AAA at one airfield
    doesn't take 8 rows on the slide.
    """
    tier: str         # "STRATEGIC" / "TACTICAL" / "SHORAD" / "MANPAD" / "AAA" / "MIXED"
    composition: str  # "1× SA-11 + 4× ZSU-23" — what's actually in the cluster
    name: str         # primary threat for sort/display fallback (kept for compat)
    type: str         # "SAM" / "AAA" / etc — top tier in cluster
    coalition: str    # "red"
    range_km: float   # max engagement range across the cluster
    range_nm: float   # same in nm
    location: str     # "BE 045/35" or "—"


@dataclass
class WaypointRow:
    number: int       # steerpoint index, 1-based for pilot readability
    name: str         # waypoint name (e.g. "MARSHAL", "TGT", "RTB")
    altitude_ft: int  # MSL feet, rounded
    speed_kt: int     # knots ground speed, rounded
    eta_zulu: str     # HHMM"Z" — absolute mission time at this waypoint
    distance_nm: float  # leg distance from previous waypoint


@dataclass
class FlightBrief:
    """One compact 4-5 slide brief per blue player flight.

    Shares header info (mission_name, theater, date, time_zulu) with the
    wing brief but each flight gets its own callsign/aircraft + a route
    table from its waypoints + flight-specific comms + fuel placeholders.
    Editable later via the same UI patterns the wing brief uses; in
    Phase 3a we auto-build them and let the user edit only the notes.
    """
    # Shared header
    mission_name: str
    theater: str
    date: str
    time_zulu: str

    # Flight identity
    callsign: str
    aircraft: str
    count: int
    role: str
    home_plate: str
    divert: str

    # Tasking + content
    tasking: str         # auto-filled from group task; user edits
    waypoints: List[Dict[str, Any]]   # WaypointRow list
    frequency: str
    tacan: str
    icls: str
    fuel_joker_lbs: int  # placeholder — squadron-specific
    fuel_bingo_lbs: int  # placeholder
    fuel_rtb_lbs: int    # placeholder
    notes: str           # special instructions for this flight, default empty


@dataclass
class WingBrief:
    # ---- Header (auto-filled, mostly cosmetic edits) ----
    mission_name: str
    theater: str
    date: str               # YYYY-MM-DD
    time_zulu: str          # HHMMZ
    coalition: str          # "blue" by default — this is the friendly side

    # ---- Free-text sections (user reviews + edits) ----
    theatre_overview: str   # baked-in per-theater blurb
    scenario: str           # combines mission description + blue/red task
    commanders_intent: str  # placeholder with prompts
    mission_flow: str       # high-level launch → push → action → egress
    notes: str              # special instructions, ROE, etc.

    # ---- Structured sections (rendered as tables) ----
    timeline: List[Dict[str, str]]    # serialised TimelineRow
    threats: List[Dict[str, Any]]
    flights: List[Dict[str, Any]]

    # ---- Comms (key/value list — user adds GCI / tankers / divert freq) ----
    comms: List[Dict[str, str]]       # [{label, value}, ...]

    # ---- Squadron logo (optional). Base64 PNG/JPG bytes uploaded by the
    # mission maker — rendered top-right of the cover slide if present.
    # `data:` prefix is tolerated and stripped at render time. Default ""
    # so dataclass still works for builder calls that don't pass it.
    logo_base64: str = ""


# ---------------------------------------------------------------------------
# Theatre overview blurbs — one short paragraph per supported theater.
# Sourced from public knowledge of the regions DCS maps cover. Mission
# makers can rewrite freely; these are just to give a fresh load
# immediate situational framing.
# ---------------------------------------------------------------------------

THEATRE_BLURBS: Dict[str, str] = {
    "Caucasus":
        "Western Caucasus region. Eastern Black Sea coast bounded by the "
        "Greater Caucasus mountain range to the south. Spans the Russian "
        "Federation, Georgia, and Abkhazia. Terrain ranges from coastal "
        "lowlands and Black Sea naval approaches in the west to peaks "
        "exceeding 4,000 m on the southern border. Climate is mild on the "
        "coast, alpine in the mountains. Multiple coalition airfields are "
        "available; Russian-side airbases are concentrated in the Krasnodar "
        "and Sochi area.",
    "Syria":
        "Eastern Mediterranean. Spans coastal Syria, Lebanon, southern "
        "Turkey, Cyprus, northern Israel and parts of Jordan. Terrain "
        "transitions from Mediterranean coast through coastal mountains "
        "to the Bekaa Valley and Syrian desert plateau. Multiple national "
        "air forces in close proximity — IFF and ROE discipline is critical.",
    "PersianGulf":
        "Strait of Hormuz and surrounding Gulf states. Covers Iran, the "
        "United Arab Emirates, Oman, parts of Saudi Arabia and Qatar. "
        "Terrain is largely flat coastal desert with the Zagros mountains "
        "rising along the Iranian side. Naval traffic in the Strait is "
        "heavy. Range to most operating areas is medium; tanker support "
        "extends loiter time significantly.",
    "Nevada":
        "Nevada Test and Training Range, centred on Nellis AFB. High "
        "desert with elevations from approximately 2,000 to 12,000 ft MSL. "
        "Restricted military airspace dominates the area, including the "
        "Tonopah and Sally Corridor ranges. Hot/high density-altitude "
        "considerations apply for both performance and weapons employment.",
    "SinaiMap":
        "Sinai Peninsula and surrounding region. Covers Egypt, Israel, "
        "and parts of Jordan and Saudi Arabia. Terrain is largely arid "
        "desert with the Sinai mountain range to the south and the "
        "Mediterranean coast to the north. Multiple national borders "
        "with sensitive overflight rules.",
    "Normandy":
        "North-western France, late spring 1944. English Channel coast "
        "with the Cotentin Peninsula to the west and the city of Caen to "
        "the east. Bocage country (hedge-lined fields) inland complicates "
        "ground manoeuvre and target acquisition. Allied airfields "
        "concentrated in southern England; expect short transit times "
        "and limited loiter on station.",
    "TheChannel":
        "English Channel between southern England and the French "
        "coast, WWII era. Short overwater transits, weather-driven "
        "operations, and dense flak corridors along both coasts.",
    "MarianaIslands":
        "Western Pacific, centred on Guam, Tinian, and Saipan. Operations "
        "are largely overwater; carrier-based assets and USAF Andersen "
        "AFB on Guam dominate the airfield picture. Expect long ferry "
        "ranges and weather-driven divert planning.",
    "Falklands":
        "South Atlantic, 1982 era. Falkland Islands and surrounding "
        "ocean approximately 800 km east of southern Argentina. "
        "Long ranges from mainland bases, harsh maritime weather, and "
        "limited divert options. Carrier-based ops dominate.",
    "Kola":
        "Kola Peninsula and northern Fennoscandia, approximately 65–70°N. "
        "Spans northern Norway, Finland, Sweden, and the Russian Murmansk "
        "Oblast. Terrain mixes Arctic tundra, fjords, and forested "
        "lowlands. Long ranges, harsh weather, low sun angles in winter, "
        "and limited diverts make planning unforgiving. Airfields cluster "
        "in northern Norway (NATO) and the Murmansk-Severomorsk area "
        "(Russia).",
    "Afghanistan":
        "Central Asian highlands. Hindu Kush mountains dominate central "
        "and northern terrain with elevations regularly above 12,000 ft. "
        "Density-altitude impacts both aircraft performance and weapons "
        "employment. Limited modern infrastructure outside major cities. "
        "Operating areas are widely dispersed.",
    "Iraq":
        "Mesopotamian basin. Tigris-Euphrates river valley with desert "
        "to the west and the Zagros foothills to the east. Terrain is "
        "largely flat with sparse vegetation. Multiple operational eras "
        "supported by the map; verify timeline-specific orders of battle.",
    "TopEndAustralia":
        "Top End of the Northern Territory of Australia. Tropical "
        "savannah with monsoon-driven seasonal weather. Sparse "
        "population, very limited diverts. Long overwater transits to "
        "operating areas across the Timor and Arafura seas.",
    "SouthEastAsia":
        "South-East Asia, Vietnam-era. Jungle terrain with monsoon "
        "weather, riverine targets and dense AAA/MANPADS belts along "
        "established corridors. Limited precision navigation aids; "
        "DR/visual nav skills matter.",
    "GermanyCW":
        "Cold War Germany. Inner German border between NATO and Warsaw "
        "Pact forces. Dense distribution of military airfields on both "
        "sides; short ranges between adversary FEBA and rear airfields. "
        "Expect heavy IADS density and minimal warning time.",
}

DEFAULT_THEATRE_BLURB = (
    "Theatre overview not yet authored for this map. Edit this section "
    "to describe the operational area, terrain, and coalition disposition."
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_player_group(group: dict) -> bool:
    """Match the frontend's isPlayerGroup() — any unit with skill Client/Player."""
    return any(u.get("skill") in ("Client", "Player") for u in group.get("units", []))


def _format_zulu(seconds: Optional[float]) -> str:
    """Format seconds-from-midnight as HHMM"Z"."""
    if seconds is None:
        return "----Z"
    try:
        s = int(seconds)
    except (TypeError, ValueError):
        return "----Z"
    h = (s // 3600) % 24
    m = (s % 3600) // 60
    return f"{h:02d}{m:02d}Z"


def _add_minutes(seconds: Optional[float], minutes: int) -> str:
    if seconds is None:
        return "----Z"
    return _format_zulu(seconds + minutes * 60)


def _format_freq(hz: Optional[float]) -> str:
    if not hz:
        return ""
    return f"{hz / 1_000_000:.3f}"


def _infer_role_from_task(task: str) -> str:
    """Map DCS task names to short role labels for the brief."""
    if not task:
        return ""
    t = task.lower()
    role_map = {
        "cap": "CAP",
        "intercept": "Intercept",
        "escort": "Escort",
        "strike": "Strike",
        "sead": "SEAD",
        "deead": "DEAD",
        "cas": "CAS",
        "anti-ship": "Anti-Ship",
        "antiship strike": "Anti-Ship",
        "reconnaissance": "Recon",
        "afac": "FAC(A)",
        "awacs": "AWACS",
        "refueling": "Tanker",
        "tanker": "Tanker",
        "transport": "Transport",
        "ferry": "Ferry",
        "nothing": "Unassigned",
    }
    for key, label in role_map.items():
        if key in t:
            return label
    return task  # fall through — show whatever DCS calls it


def _nearest_airbase(group: dict, airbases: List[dict]) -> str:
    """Find the airbase closest to the group's first waypoint (= takeoff point)."""
    waypoints = group.get("waypoints") or []
    if not waypoints:
        return ""
    wp = waypoints[0]
    lat = wp.get("lat")
    lon = wp.get("lon")
    if lat is None or lon is None:
        return ""
    best = None
    best_d2 = float("inf")
    for ab in airbases:
        ab_lat = ab.get("lat")
        ab_lon = ab.get("lon")
        if ab_lat is None or ab_lon is None:
            continue
        d2 = (lat - ab_lat) ** 2 + (lon - ab_lon) ** 2  # crude — fine for nearest
        if d2 < best_d2:
            best_d2 = d2
            best = ab["name"]
    return best or ""


# ---------------------------------------------------------------------------
# Section builders — each takes mission data and returns its section's content.
# Kept small so they're individually testable + easy to swap implementations.
# ---------------------------------------------------------------------------

def _build_theatre_overview(theater: str) -> str:
    return THEATRE_BLURBS.get(theater, DEFAULT_THEATRE_BLURB)


def _build_scenario(overview: dict, dictionary: Dict[str, str]) -> str:
    """Combine the mission description + tasks into a coherent scenario blurb.

    Resolves DictKey_* references against the parsed dictionary so the user
    sees the real localised text. Unresolved DictKey literals (lookup
    failure or empty value) are dropped — better to omit a section than
    leak internal keys into the brief.
    """
    def _resolve(key: str) -> str:
        v = str(resolve_dict_key(overview.get(key) or "", dictionary)).strip()
        # Drop literal DictKey_... fall-through (means the lookup failed)
        return "" if v.startswith("DictKey_") else v

    parts: List[str] = []
    desc = _resolve("description")
    blue_task = _resolve("descriptionBlueTask")
    red_task = _resolve("descriptionRedTask")
    if desc:
        parts.append(desc)
    if blue_task:
        parts.append(f"BLUE: {blue_task}")
    if red_task:
        parts.append(f"RED: {red_task}")
    if not parts:
        return ("No scenario description in the mission file. Edit this "
                "section to describe the operational situation, friendly "
                "and adversary posture, and what's at stake.")
    return "\n\n".join(parts)


def _detect_mission_type(groups: List[dict]) -> str:
    """Categorise the package's primary mission from blue flight tasks.

    Returns one of: 'strike', 'cas', 'dca', 'sead', 'antiship', 'recon',
    'tanker', 'mixed', 'unknown'. Used to pick a tailored commander's
    intent template (mission makers always edit, but a mission-typed
    starter is far more useful than a generic one).
    """
    from collections import Counter

    role_buckets = Counter()
    for g in groups:
        if not _is_player_group(g):
            continue
        if g.get("coalition") != "blue":
            continue
        task = (g.get("task") or "").lower()
        if not task:
            continue
        if "cas" in task:
            role_buckets["cas"] += 1
        elif "anti-ship" in task or "antiship" in task:
            role_buckets["antiship"] += 1
        elif "sead" in task or "deead" in task or "dead" in task:
            role_buckets["sead"] += 1
        elif "strike" in task:
            role_buckets["strike"] += 1
        elif "cap" in task or "intercept" in task or "escort" in task:
            role_buckets["dca"] += 1
        elif "reconnaissance" in task or "afac" in task or "recon" in task:
            role_buckets["recon"] += 1
        elif "refueling" in task or "tanker" in task:
            role_buckets["tanker"] += 1

    if not role_buckets:
        return "unknown"
    # Multiple distinct primary roles → mixed
    if len([k for k in role_buckets if k != "tanker"]) > 1:
        return "mixed"
    return role_buckets.most_common(1)[0][0]


_INTENT_TEMPLATES: Dict[str, str] = {
    "strike": (
        "Purpose: Destroy [NAMED TARGET / target set] to deny the enemy "
        "[capability or terrain] for the duration of the operation.\n\n"
        "Method: Single coordinated push from marshal at TOT-15. SEAD/escort "
        "[if present] suppresses threats inside the MEZ; strike package runs "
        "the IP-to-target leg low-to-medium and egresses on the planned "
        "corridor. Battle damage assessment via [tasked asset].\n\n"
        "End State: Target struck and confirmed destroyed. Strike package "
        "RTB with all assets accounted for; AO pushed forward by [phase line]."
    ),
    "cas": (
        "Purpose: Provide close air support to friendly ground forces "
        "operating in [AREA / grid]. Maintain freedom of manoeuvre for the "
        "ground commander.\n\n"
        "Method: Check in with the JTAC / FAC(A) on [primary freq] at the "
        "CAP/holding point. Work CAS 9-line on demand; observe ROE for any "
        "danger-close calls. Hand off to follow-on flight at bingo / on "
        "relief by next vul.\n\n"
        "End State: Ground commander reports satisfied with on-station "
        "support. All flights RTB safe. No friendly fire or collateral "
        "damage incidents."
    ),
    "dca": (
        "Purpose: Defend [AOR / asset] against airborne threats. Deny the "
        "enemy the ability to penetrate friendly airspace and engage "
        "high-value assets.\n\n"
        "Method: Establish CAP at [station / racetrack] under GCI control. "
        "Engage all hostile contacts inside ROE / WEZ; positive ID required "
        "before BVR shots. Maintain mutual support and cycle pairs through "
        "tanker as needed.\n\n"
        "End State: No enemy aircraft penetrate the defended area. CAP "
        "maintained until [relief / mission end]. All friendlies RTB."
    ),
    "sead": (
        "Purpose: Suppress / destroy enemy SAM systems threatening the strike "
        "package's ingress and egress corridors. Open and hold the door.\n\n"
        "Method: Push 5-10 minutes ahead of strike. Establish SEAD orbit "
        "outside the engagement zone of the threat ring. Trigger reactive "
        "shots on emitting threats; pre-emptive HARM on known sites per "
        "mission planning. Coordinate with strike lead on any threat "
        "re-radiations.\n\n"
        "End State: Threat picture inside MEZ degraded sufficiently to allow "
        "strike package access. SEAD asset RTB safe; threat sites destroyed "
        "or suppressed for the duration of the strike window."
    ),
    "antiship": (
        "Purpose: Destroy / disable [SHIP CLASS / named vessel] in the "
        "[MARITIME AOR] to deny enemy sea control of the operating area.\n\n"
        "Method: Coordinated package with [escort / SEAD as required]. "
        "Anti-ship ordnance employment from outside the ship's air-defence "
        "engagement zone where possible. Deconflict with friendly shipping "
        "via the ATO / blue-on-blue ROE.\n\n"
        "End State: Target vessel struck and assessed as a mission kill. "
        "Sea lines of communication contested. Package RTB with all "
        "assets accounted for."
    ),
    "recon": (
        "Purpose: Gain situational awareness of [TARGET AREA / activity] to "
        "inform follow-on tasking. No engagement unless self-defence.\n\n"
        "Method: Transit to the AOR; conduct [visual / sensor] reconnaissance "
        "of the assigned target set. Report findings to [HQ / AWACS] in real "
        "time on the recon push freq. Egress on the planned route.\n\n"
        "End State: Target area imaged / observed. Intelligence handed to "
        "the follow-on tasking authority. Recon asset RTB safe."
    ),
    "tanker": (
        "Purpose: Provide aerial refuelling support to enable extended "
        "on-station time and divert reserve for the strike / DCA package.\n\n"
        "Method: Establish AAR track at [coordinate / fix]. Service receivers "
        "in flow per the comm card; observe pre-contact / contact / post-"
        "contact procedures. Maintain 100% give over the planned refuel "
        "window.\n\n"
        "End State: All scheduled receivers serviced. Tanker offload meets "
        "or exceeds planned. Tanker RTB to [home plate]."
    ),
    "mixed": (
        "Purpose: This package combines multiple mission types — author the "
        "intent across all elements. Cover the strike objective, the DCA / "
        "SEAD / support roles enabling it, and the desired end state for the "
        "package as a whole.\n\n"
        "Method: Sequence the elements (push order, mutual support, "
        "deconfliction). Identify the priority of effort and how the "
        "supporting flights enable the main effort.\n\n"
        "End State: All elements complete their tasking. Package RTB safe. "
        "Strategic objective achieved."
    ),
    "unknown": (
        "Purpose: Why we are flying this mission (the strategic objective).\n\n"
        "Method: How we will accomplish it (the high-level plan in 1-2 "
        "sentences).\n\n"
        "End State: What the AO looks like when we are done."
    ),
}


def _build_commanders_intent_placeholder(groups: List[dict]) -> str:
    """Return a starter intent matched to the package's mission type.

    The mission maker always edits this section — a mission-type-aware
    starter makes the editing one of polish rather than from-scratch.
    """
    return _INTENT_TEMPLATES[_detect_mission_type(groups)]


def _build_mission_flow_placeholder() -> str:
    return (
        "1. Ground ops — pre-flight, taxi, takeoff in flow per timeline.\n"
        "2. Join — flights rejoin and sequence into push order at the marshal point.\n"
        "3. Push — single coordinated push at TOT-15 (see timeline).\n"
        "4. Action — execute tasking; observe ROE and IFF discipline.\n"
        "5. Egress — withdraw on planned route; expect handoff to GCI.\n"
        "6. Recovery — RTB to home plate; divert per assigned alternates."
    )


def _waypoint_time(wp: dict, takeoff_eta: float, mission_start: float) -> Optional[float]:
    """Convert a waypoint's ETA to absolute mission seconds.

    DCS stores eta_seconds as cumulative time from waypoint 0; we add the
    delta from takeoff to mission_start to get the waypoint's absolute
    Zulu seconds-from-midnight value the rest of the timeline uses.
    """
    eta = wp.get("eta_seconds")
    if eta is None:
        return None
    try:
        return mission_start + (float(eta) - takeoff_eta)
    except (TypeError, ValueError):
        return None


def _find_waypoint_time(
    waypoints: List[dict],
    name_patterns: List[str],
    takeoff_eta: float,
    mission_start: float,
) -> Optional[float]:
    """Return the Zulu time of the first waypoint whose name matches any pattern."""
    for wp in waypoints:
        name = (wp.get("waypoint_name") or "").lower()
        if any(p in name for p in name_patterns):
            t = _waypoint_time(wp, takeoff_eta, mission_start)
            if t is not None:
                return t
    return None


def _build_timeline(
    start_seconds: Optional[float],
    groups: Optional[List[dict]] = None,
) -> List[Dict[str, str]]:
    """Build a phase timeline anchored on mission start, enriched with
    actual waypoint times when player flights have meaningfully named
    waypoints. Falls back to heuristic offsets when names aren't recognised.

    Naming conventions we look for (case-insensitive substring match):
      Push  : "push", "marshal", "ip" (initial point — start of run-in)
      TOT   : "tgt", "target", "tot"
      Egress: "egress", "egr", "fence-out"

    Aggregation across player flights:
      Push    = earliest push time (first flight begins the run-in)
      TOT     = median target time (centre of the strike window)
      Egress  = latest egress time (last flight clear of MEZ)
      RTB     = latest landing time across all flights (last bird home)

    Pre-takeoff phases (Ground Ops, Engine Start) stay heuristic — there's
    no waypoint data for them.
    """
    if start_seconds is None:
        start_seconds = 0.0
    groups = groups or []

    # Collect named-waypoint times across all player flights
    push_times: List[float] = []
    tot_times: List[float] = []
    egress_times: List[float] = []
    rtb_times: List[float] = []

    for g in groups:
        if not _is_player_group(g):
            continue
        wps = g.get("waypoints") or []
        if len(wps) < 2:
            continue
        # Reference: first waypoint = takeoff for this flight
        takeoff_eta_local = float(wps[0].get("eta_seconds") or 0)

        push_t = _find_waypoint_time(wps, ["push", "marshal", "ip"],
                                     takeoff_eta_local, start_seconds)
        tot_t  = _find_waypoint_time(wps, ["tgt", "target", "tot"],
                                     takeoff_eta_local, start_seconds)
        egr_t  = _find_waypoint_time(wps, ["egress", "egr", "fence-out", "fence out"],
                                     takeoff_eta_local, start_seconds)
        # RTB = last waypoint absolute time
        last_wp = wps[-1]
        rtb_t = _waypoint_time(last_wp, takeoff_eta_local, start_seconds)

        if push_t is not None: push_times.append(push_t)
        if tot_t is not None:  tot_times.append(tot_t)
        if egr_t is not None:  egress_times.append(egr_t)
        if rtb_t is not None:  rtb_times.append(rtb_t)

    # Aggregate. Keep times as seconds-since-midnight floats so we can
    # enforce monotonic ordering across phases before formatting.
    def _aggregate(times: List[float], fallback_offset_min: int,
                   aggregator) -> float:
        if times:
            return aggregator(times)
        return start_seconds + fallback_offset_min * 60

    def _median(xs: List[float]) -> float:
        xs = sorted(xs); n = len(xs)
        return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2

    push_t   = _aggregate(push_times,   15, min)
    tot_t    = _aggregate(tot_times,    30, _median)
    egress_t = _aggregate(egress_times, 50, max)
    rtb_t    = _aggregate(rtb_times,    90, max)

    # Enforce monotonic ordering. When real waypoint data gives us a
    # tight mission (e.g. CAP loop landing 18 min after takeoff), the
    # heuristic fallbacks for the missing phases can land AFTER RTB,
    # which would print a nonsense timeline. Walk backward from RTB and
    # clamp each phase to ≤ the next.
    pts = [push_t, tot_t, egress_t, rtb_t]
    for i in range(len(pts) - 2, -1, -1):
        if pts[i] > pts[i + 1]:
            pts[i] = pts[i + 1]
    push_t, tot_t, egress_t, rtb_t = pts

    # Annotate notes when waypoint data was used so the mission maker
    # can tell what's authoritative vs. heuristic.
    push_note = ("Coordinated push from marshal"
                 + (" (from waypoint data)" if push_times else ""))
    tot_note = ("Time on target — synchronised across strike package"
                + (" (from waypoint data)" if tot_times else ""))
    egress_note = ("All flights clear of MEZ"
                   + (" (from waypoint data)" if egress_times else ""))
    rtb_note = ("Recovery to home plate or alternate"
                + (f" (from waypoint data, {len(rtb_times)} flight(s))" if rtb_times else ""))

    rows = [
        TimelineRow("Ground Ops", _add_minutes(start_seconds, -30), "Pre-flight, brief, walk to jets"),
        TimelineRow("Engine Start", _add_minutes(start_seconds, -10), "Sequence per ground"),
        TimelineRow("Takeoff", _format_zulu(start_seconds), "Rolling takeoff, flow takeoff per flight"),
        TimelineRow("Push", _format_zulu(push_t), push_note),
        TimelineRow("TOT", _format_zulu(tot_t), tot_note),
        TimelineRow("Egress Complete", _format_zulu(egress_t), egress_note),
        TimelineRow("RTB", _format_zulu(rtb_t), rtb_note),
    ]
    return [asdict(r) for r in rows]


def _build_flights(groups: List[dict], airbases: List[dict]) -> List[Dict[str, Any]]:
    out: List[FlightRow] = []
    for g in groups:
        if not _is_player_group(g):
            continue
        units = g.get("units") or []
        first = units[0] if units else {}
        tacan = ""
        if g.get("tacan"):
            t = g["tacan"]
            tacan = f"{t.get('channel', '')}{t.get('band', '')}"
        out.append(FlightRow(
            callsign=first.get("name") or g.get("groupName", ""),
            aircraft=first.get("type", ""),
            count=len(units),
            role=_infer_role_from_task(g.get("task", "")),
            frequency=_format_freq(g.get("frequency")),
            tacan=tacan,
            home_plate=_nearest_airbase(g, airbases),
        ))
    return [asdict(f) for f in out]


# Threat tier classification — name-pattern based, ordered by capability.
# Pilots care about tier first, individual model second. The brief slide
# leads with tier so the strategic/tactical SAMs are obvious before the
# AAA noise.
#
# Patterns are case-insensitive substrings of the DCS unit name. First
# match wins, so list specific names before generic ones (e.g. "SA-10"
# before "SA-1" would matter — we're careful with order).

_TIER_PATTERNS: List[tuple[str, List[str]]] = [
    ("STRATEGIC", [
        # Long-range area-defence: 100+ km tier
        "S-300", "Patriot", "MIM-104",
        "SA-10", "SA-12", "SA-20", "SA-21",
    ]),
    ("TACTICAL", [
        # Medium-range SAMs: 20-60km tier
        "SA-2", "SA-3", "SA-6", "SA-11", "SA-17",
        "Buk", "Kub", "S-125", "Hawk",
        # MR/SR overlaps that are still capable
    ]),
    ("SHORAD", [
        # Short-range air defence: 5-15km
        "SA-8", "SA-9", "SA-13", "SA-15", "SA-19",
        "Tor", "Strela", "Osa", "Roland", "Avenger", "Linebacker",
        "Tunguska", "rapier", "NASAMS",
    ]),
    ("MANPAD", [
        # Man-portable IR — short range, low altitude
        "SA-7", "SA-14", "SA-16", "SA-18", "SA-24",
        "Igla", "Stinger", "Manpad",
    ]),
    ("AAA", [
        # Anti-aircraft artillery, gun-only
        "ZSU", "ZU-23", "Vulcan", "Shilka", "Bofors",
        "Flak", "Oerlikon", "AA gun", "AAA",
    ]),
]


def _classify_threat_tier(name: str) -> str:
    """Return the tier label for a threat name. Falls back to 'OTHER'
    when no pattern matches so unrecognised systems still show up
    rather than getting filtered silently.
    """
    n = (name or "").lower()
    for tier, patterns in _TIER_PATTERNS:
        for p in patterns:
            if p.lower() in n:
                return tier
    return "OTHER"


# Tier sort order — higher number = more dangerous, sorted desc on the slide
_TIER_RANK: Dict[str, int] = {
    "STRATEGIC": 5, "TACTICAL": 4, "SHORAD": 3,
    "MANPAD": 2, "AAA": 1, "OTHER": 0, "MIXED": 4,
}


def _bearing_distance_from_be(threat_lat: float, threat_lon: float,
                               be_lat: float, be_lon: float) -> tuple[int, int]:
    """Compute bearing (true, deg) and distance (nm) from bullseye to threat.

    Used for the airborne-relevant 'BE 045/35' callout convention.
    Both inputs in WGS84 degrees. Output (bearing_deg, distance_nm) ints.
    """
    import math
    # Haversine for distance
    R_NM = 3440.065  # earth radius in nm
    la1, lo1 = math.radians(be_lat), math.radians(be_lon)
    la2, lo2 = math.radians(threat_lat), math.radians(threat_lon)
    dl = lo2 - lo1
    a = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin(dl / 2) ** 2)
    distance_nm = 2 * R_NM * math.asin(math.sqrt(a))
    # Bearing — initial heading from BE to threat
    y = math.sin(dl) * math.cos(la2)
    x = (math.cos(la1) * math.sin(la2)
         - math.sin(la1) * math.cos(la2) * math.cos(dl))
    bearing = (math.degrees(math.atan2(y, x)) + 360) % 360
    return int(round(bearing)), int(round(distance_nm))


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance between two lat/lon points in km. Used for spatial clustering."""
    import math
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dl = lo2 - lo1
    a = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin(dl / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


# Threats this close to each other are treated as one "threat area" on
# the slide. 10 km is a typical airbase / IADS site footprint — keeps
# co-located AAA + SAM systems on one row, but separates true clusters.
_CLUSTER_RADIUS_KM = 10.0


def _build_threats(threats: List[dict], bullseye: Optional[dict] = None) -> List[Dict[str, Any]]:
    """Spatial-cluster threats into 'threat areas' for the slide.

    Threats within `_CLUSTER_RADIUS_KM` of each other become one row
    regardless of type — a typical airfield IADS (1× SA-11 + 4× SA-15
    + 6× ZU-23) collapses to a single 'IADS complex' row instead of
    11 individual rows. Each row reports:

      tier        — highest-tier threat in the cluster (STRATEGIC / TACTICAL
                    / SHORAD / MANPAD / AAA / OTHER), or MIXED when ≥2 tiers
                    coexist — that's the 'this is a layered defence' signal
      composition — 'N× Type' summary, e.g. '1× SA-11 + 4× SA-15 + 6× ZU-23'
      position    — bullseye reference of the cluster centroid
      WEZ         — max engagement range across the cluster, in km AND nm

    Sorted by tier rank desc, then by range desc within a tier.
    """
    if not threats:
        return []

    # Bullseye for blue side (the brief audience). Falls back to "—" if
    # the .miz didn't define one.
    be_lat = be_lon = None
    if bullseye and isinstance(bullseye, dict):
        blue_be = bullseye.get("blue") or {}
        be_lat = blue_be.get("lat")
        be_lon = blue_be.get("lon")

    # Single-link spatial clustering. For each threat, find a cluster
    # whose centroid is within radius; otherwise start a new cluster.
    # Centroids update as members are added (running average).
    clusters: List[dict] = []
    for t in threats:
        lat = t.get("lat"); lon = t.get("lon")
        # Threats with no coords get a cluster of their own — better
        # than dropping them silently.
        if lat is None or lon is None:
            clusters.append({"members": [t], "lats": [], "lons": []})
            continue
        lat = float(lat); lon = float(lon)
        placed = False
        for c in clusters:
            if not c["lats"]:
                continue  # cluster of coord-less threats — don't merge in
            cen_lat = sum(c["lats"]) / len(c["lats"])
            cen_lon = sum(c["lons"]) / len(c["lons"])
            if _haversine_km(lat, lon, cen_lat, cen_lon) <= _CLUSTER_RADIUS_KM:
                c["members"].append(t)
                c["lats"].append(lat)
                c["lons"].append(lon)
                placed = True
                break
        if not placed:
            clusters.append({"members": [t], "lats": [lat], "lons": [lon]})

    # Translate clusters into ThreatRow records
    from collections import Counter
    rows: List[ThreatRow] = []
    for c in clusters:
        members = c["members"]
        if not members:
            continue

        # Count by name to build the composition string
        name_counts = Counter(m.get("name") or "Unknown" for m in members)
        composition = " + ".join(
            f"{cnt}× {name}" for name, cnt in name_counts.most_common()
        )

        # Tier — set of tiers across the cluster. If >1 distinct tier,
        # it's a layered defence; flag as MIXED but track the highest.
        tiers = {_classify_threat_tier(m.get("name") or "") for m in members}
        if not tiers:
            top_tier = "OTHER"
        else:
            top_tier = max(tiers, key=lambda t: _TIER_RANK.get(t, 0))
        cluster_tier = "MIXED" if len([t for t in tiers if t != "OTHER"]) > 1 else top_tier

        # Range — biggest engagement zone in the cluster
        max_range_m = max(float(m.get("range") or 0) for m in members)
        range_km = max_range_m / 1000.0
        range_nm = max_range_m / 1852.0  # nm for the airborne audience

        # Position — bearing/distance from bullseye to cluster centroid
        if c["lats"] and c["lons"]:
            cen_lat = sum(c["lats"]) / len(c["lats"])
            cen_lon = sum(c["lons"]) / len(c["lons"])
            if be_lat is not None and be_lon is not None:
                bearing, dist = _bearing_distance_from_be(cen_lat, cen_lon, be_lat, be_lon)
                location = f"BE {bearing:03d}/{dist}"
            else:
                location = f"{cen_lat:.3f}, {cen_lon:.3f}"
        else:
            location = "—"

        # Primary name + type — used as tiebreakers and for legacy fields
        primary_name = name_counts.most_common(1)[0][0]
        primary_type = members[0].get("type", "")
        coalition = members[0].get("coalition", "red")

        rows.append(ThreatRow(
            tier=cluster_tier,
            composition=composition,
            name=primary_name,
            type=primary_type,
            coalition=coalition,
            range_km=round(range_km, 1),
            range_nm=round(range_nm, 1),
            location=location,
        ))

    # Sort: highest tier first, then biggest range first within tier
    rows.sort(key=lambda r: (-_TIER_RANK.get(r.tier, 0), -r.range_km))
    return [asdict(r) for r in rows]


def _build_comms(groups: List[dict]) -> List[Dict[str, str]]:
    """Pull the most-used frequencies as a starter comm card.

    User edits to add GCI, tanker, AAR, divert tower, etc. since those
    aren't reliably present in the mission file.
    """
    out: List[Dict[str, str]] = []
    seen = set()
    for g in groups:
        if not _is_player_group(g):
            continue
        f = _format_freq(g.get("frequency"))
        callsign = (g.get("units") or [{}])[0].get("name") or g.get("groupName", "")
        if not f or callsign in seen:
            continue
        out.append({"label": callsign, "value": f"{f} MHz"})
        seen.add(callsign)
    if not out:
        out.append({"label": "Primary", "value": "edit — add primary freq"})
    out.append({"label": "GCI", "value": "edit — add GCI freq"})
    out.append({"label": "AAR", "value": "edit — add tanker freq if applicable"})
    out.append({"label": "Guard", "value": "243.000"})
    return out


# ---------------------------------------------------------------------------
# Top-level builder
# ---------------------------------------------------------------------------

def _build_tasking_text(group: dict, mission_type: str) -> str:
    """Produce a one-paragraph tasking statement for a single flight.

    Combines the DCS task name with a mission-type-aware lead-in so the
    pilot reads something useful instead of just `Strike` or `CAP`.
    """
    task = (group.get("task") or "").strip()
    if not task:
        return ("Author the specific tasking for this flight: target / area / "
                "ROE / hand-off / on-station time.")
    role = _infer_role_from_task(task)
    by_type = {
        "strike":   f"Strike — {task}. Run the IP-to-target leg, confirm BDA, egress on planned route.",
        "cas":      f"CAS — {task}. Check in with JTAC on the brief freq; work 9-line on demand; observe ROE on danger close.",
        "dca":      f"DCA — {task}. Hold CAP under GCI; engage hostiles inside ROE/WEZ; positive ID before BVR.",
        "sead":     f"SEAD — {task}. Suppress threats inside the strike package's ingress corridor; pre-emptive on known sites, reactive on emitters.",
        "antiship": f"Anti-ship — {task}. Coordinated employment from outside vessel ADEZ where possible; deconflict with friendly shipping.",
        "recon":    f"Recon — {task}. Transit, image/observe target area, report findings on the recon push freq, egress.",
        "tanker":   f"Tanker — {task}. Establish AAR track; service receivers in flow per the comm card.",
    }
    return by_type.get(mission_type) or f"Tasking: {role or task}."


def build_flight_briefs(
    *,
    mission_data: dict,
    theater: str,
    filename: str,
    dictionary_text: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Build one FlightBrief per blue player flight.

    Returns a list of plain dicts (one per flight) for round-trip
    serialization. Order matches the order player flights appear in the
    parsed mission data — that's typically the squadron's preferred order
    when groups are named alphabetically/numerically.
    """
    overview = mission_data.get("overview") or {}
    groups = mission_data.get("groups") or []
    airbases = mission_data.get("airbases") or []
    start_seconds = overview.get("start_time") or 0
    dictionary = parse_dictionary(dictionary_text)
    mission_type = _detect_mission_type(groups)

    raw_sortie = overview.get("sortie") or ""
    resolved_sortie = str(resolve_dict_key(raw_sortie, dictionary)).strip()
    mission_name = resolved_sortie or filename or "Untitled Mission"
    if mission_name.startswith("DictKey_"):
        mission_name = filename or "Untitled Mission"

    out: List[Dict[str, Any]] = []
    for g in groups:
        if not _is_player_group(g):
            continue
        units = g.get("units") or []
        first = units[0] if units else {}
        callsign = first.get("name") or g.get("groupName", "Unknown")
        aircraft = first.get("type", "Unknown")

        tacan = ""
        if g.get("tacan"):
            t = g["tacan"]
            tacan = f"{t.get('channel', '')}{t.get('band', '')}"
        icls = str(g.get("icls", {}).get("channel", "")) if g.get("icls") else ""
        home_plate = _nearest_airbase(g, airbases)

        # Best-effort divert: nearest airbase to last waypoint that isn't home plate
        divert = ""
        wps = g.get("waypoints") or []
        if wps and airbases:
            last_wp = wps[-1]
            lat, lon = last_wp.get("lat"), last_wp.get("lon")
            if lat is not None and lon is not None:
                ranked = sorted(
                    [a for a in airbases if a.get("lat") is not None and a.get("lon") is not None],
                    key=lambda a: (lat - a["lat"]) ** 2 + (lon - a["lon"]) ** 2,
                )
                for a in ranked:
                    if a["name"] != home_plate:
                        divert = a["name"]
                        break

        # Build waypoint table — convert ETA seconds to absolute Zulu and
        # altitude meters → feet, speed m/s → knots
        wp_rows: List[Dict[str, Any]] = []
        takeoff_eta = float(wps[0].get("eta_seconds", 0)) if wps else 0
        for i, wp in enumerate(wps):
            absolute_t = start_seconds + (float(wp.get("eta_seconds") or 0) - takeoff_eta)
            row = WaypointRow(
                number=i + 1,
                name=wp.get("waypoint_name") or f"WP{i}",
                altitude_ft=int(round((wp.get("altitude_m") or 0) * 3.28084)),
                speed_kt=int(round((wp.get("speed_ms") or 0) * 1.94384)),
                eta_zulu=_format_zulu(absolute_t),
                distance_nm=round(float(wp.get("leg_distance_nm") or 0), 1),
            )
            wp_rows.append(asdict(row))

        brief = FlightBrief(
            mission_name=str(mission_name),
            theater=theater,
            date=overview.get("date") or "",
            time_zulu=_format_zulu(start_seconds),

            callsign=callsign,
            aircraft=aircraft,
            count=len(units),
            role=_infer_role_from_task(g.get("task", "")),
            home_plate=home_plate,
            divert=divert,

            tasking=_build_tasking_text(g, mission_type),
            waypoints=wp_rows,
            frequency=_format_freq(g.get("frequency")),
            tacan=tacan,
            icls=icls,
            # Squadron-specific fuel — placeholders the editor or pilot fills
            fuel_joker_lbs=4500,
            fuel_bingo_lbs=3500,
            fuel_rtb_lbs=2500,
            notes="",
        )
        out.append(asdict(brief))
    return out


def build_wing_brief(
    *,
    mission_data: dict,
    theater: str,
    filename: str,
    dictionary_text: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a complete WingBrief from parsed mission data.

    Args:
      mission_data: output of services.miz_parser.extract_full_mission_data
      theater: theater name (e.g. "Caucasus")
      filename: original .miz filename, used as a fallback mission_name
      dictionary_text: raw text of the .miz's l10n/DEFAULT/dictionary file,
        used to resolve DictKey_* references. Optional — falls back to
        showing the raw key if not provided.

    Returns the brief as a plain dict (for easy JSON serialization to the
    frontend editor). Use `WingBrief(**dict)` to round-trip back to the
    dataclass on render.
    """
    overview = mission_data.get("overview") or {}
    groups = mission_data.get("groups") or []
    threats = mission_data.get("threats") or []
    airbases = mission_data.get("airbases") or []
    start_seconds = overview.get("start_time")
    dictionary = parse_dictionary(dictionary_text)

    # Mission name precedence: resolved sortie → unresolved sortie literal
    # → filename → "Untitled Mission". Some .miz files have a sortie DictKey
    # that resolves to an empty string (placeholder set but never authored);
    # those should fall through to the filename rather than show blank.
    raw_sortie = overview.get("sortie") or ""
    resolved_sortie = str(resolve_dict_key(raw_sortie, dictionary)).strip()
    mission_name = resolved_sortie or filename or "Untitled Mission"
    # If the "resolved" name is still a literal DictKey_... reference, the
    # dictionary lookup failed — show the filename instead of the ugly key.
    if mission_name.startswith("DictKey_"):
        mission_name = filename or "Untitled Mission"

    brief = WingBrief(
        mission_name=str(mission_name),
        theater=theater,
        date=overview.get("date") or "",
        time_zulu=_format_zulu(start_seconds),
        coalition="blue",

        theatre_overview=_build_theatre_overview(theater),
        scenario=_build_scenario(overview, dictionary),
        commanders_intent=_build_commanders_intent_placeholder(groups),
        mission_flow=_build_mission_flow_placeholder(),
        notes="",

        timeline=_build_timeline(start_seconds, groups),
        threats=_build_threats(threats, overview.get("bullseye")),
        flights=_build_flights(groups, airbases),

        comms=_build_comms(groups),
    )
    return asdict(brief)
