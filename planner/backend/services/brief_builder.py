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
    name: str         # "SA-15 Tor M1"
    type: str         # "SAM"
    coalition: str    # "red"
    range_km: float   # 12.0
    location: str     # "Vicinity of Apatity"


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


def _build_commanders_intent_placeholder() -> str:
    """A starter the mission maker rewrites — gives a structure to fill."""
    return (
        "Purpose: Why we are flying this mission (the strategic objective).\n\n"
        "Method: How we will accomplish it (the high-level plan in 1-2 sentences).\n\n"
        "End State: What the AO looks like when we are done."
    )


def _build_mission_flow_placeholder() -> str:
    return (
        "1. Ground ops — pre-flight, taxi, takeoff in flow per timeline.\n"
        "2. Join — flights rejoin and sequence into push order at the marshal point.\n"
        "3. Push — single coordinated push at TOT-15 (see timeline).\n"
        "4. Action — execute tasking; observe ROE and IFF discipline.\n"
        "5. Egress — withdraw on planned route; expect handoff to GCI.\n"
        "6. Recovery — RTB to home plate; divert per assigned alternates."
    )


def _build_timeline(start_seconds: Optional[float]) -> List[Dict[str, str]]:
    """Heuristic timeline based on mission start time. User adjusts after.

    Phase offsets (minutes from mission start time = takeoff):
      -30  Ground ops      (preflight, brief shop, walk to jets)
      -10  Engine start
       0   Takeoff
      +15  Push
      +30  Time on target (TOT)
      +50  Egress complete
      +90  RTB
    """
    rows = [
        TimelineRow("Ground Ops", _add_minutes(start_seconds, -30), "Pre-flight, brief, walk to jets"),
        TimelineRow("Engine Start", _add_minutes(start_seconds, -10), "Sequence per ground"),
        TimelineRow("Takeoff", _format_zulu(start_seconds), "Rolling takeoff, flow takeoff per flight"),
        TimelineRow("Push", _add_minutes(start_seconds, 15), "Coordinated push from marshal"),
        TimelineRow("TOT", _add_minutes(start_seconds, 30), "Time on target — synchronised across strike package"),
        TimelineRow("Egress Complete", _add_minutes(start_seconds, 50), "All flights clear of MEZ"),
        TimelineRow("RTB", _add_minutes(start_seconds, 90), "Recovery to home plate or alternate"),
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


def _build_threats(threats: List[dict]) -> List[Dict[str, Any]]:
    rows: List[ThreatRow] = []
    for t in threats:
        rows.append(ThreatRow(
            name=t.get("name", "Unknown"),
            type=t.get("type", ""),
            coalition=t.get("coalition", ""),
            range_km=round((t.get("range") or 0) / 1000.0, 1),
            location="",  # filled later when we add bullseye / nearest-town inference
        ))
    rows.sort(key=lambda r: r.range_km, reverse=True)  # biggest threat first
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
        commanders_intent=_build_commanders_intent_placeholder(),
        mission_flow=_build_mission_flow_placeholder(),
        notes="",

        timeline=_build_timeline(start_seconds),
        threats=_build_threats(threats),
        flights=_build_flights(groups, airbases),

        comms=_build_comms(groups),
    )
    return asdict(brief)
