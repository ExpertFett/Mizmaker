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
from typing import Any, Dict, List, Optional, Tuple


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
class AirThreatRow:
    """One row on the AIR THREATS section — an enemy airframe TYPE aggregated
    across the whole mission, with a capability rundown useful to friendly
    pilots (what it shoots, and how to fight it)."""
    composition: str     # "8× Su-27"  (total of this type, enemy-wide)
    airframe_class: str  # "Heavy 4th-gen fighter"
    weapons: str         # "R-27ER/ET (BVR ~30nm) · R-73 (WVR)"
    notes: str           # terse tactical advice for blue pilots
    coalition: str       # "red"
    silhouette: str = "" # recognition-silhouette family (backend/assets/aircraft)


@dataclass
class ControlMeasureRow:
    """One row on the CONTROL MEASURES slide — a named reference point the
    package steers to or deconflicts around."""
    kind: str      # "BULLSEYE" / "STEER POINT" / "TARGET" / "ROZ" / "HOLDING AREA" / "TANKER TRACK"
    name: str      # "ROCK", "AEGIS", "KB HELHEIM", ...
    ll: str        # "N71° 07.661'  E024° 29.797'"  (deg + decimal-min)
    mgrs: str      # "35W PT 11645 37846"  ("" if unavailable)
    elevation: str # "282 FT" or "—"


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
    fuel_start_lbs: int  # T/O internal fuel from the loadout (0 = unknown)
    fuel_joker_lbs: int  # derived from start when known, else placeholder
    fuel_bingo_lbs: int  # derived from start when known, else placeholder
    fuel_rtb_lbs: int    # derived from start when known, else placeholder
    notes: str           # special instructions for this flight, default empty
    timeline: List[Dict[str, str]]  # this flight's own schedule (TimelineRow list)
    # Per-slide route map (v1.13.x). group_name matches this flight back to its
    # mission group so the frontend can render a route map; route_map_base64 is
    # the client-rendered PNG (no data: prefix) placed on a ROUTE MAP slide.
    group_name: str = ""
    route_map_base64: str = ""
    # Popup-attack profiles (v1.17.8). Same list every flight currently gets
    # (no per-flight binding yet); kept on each FlightBrief so the renderer
    # doesn't need a second argument and so the per-flight pptx is self-
    # contained when downloaded individually.
    popup_attacks: List[Dict[str, Any]] = field(default_factory=list)


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
    threats: List[Dict[str, Any]]     # surface (SAM/AAA) clusters
    air_threats: List[Dict[str, Any]] # enemy aircraft groups (serialised AirThreatRow)
    flights: List[Dict[str, Any]]

    # ---- Comms (key/value list — user adds GCI / tankers / divert freq) ----
    comms: List[Dict[str, str]]       # [{label, value}, ...]

    # ---- Squadron logo (optional). Base64 PNG/JPG bytes uploaded by the
    # mission maker — rendered top-right of the cover slide if present.
    # `data:` prefix is tolerated and stripped at render time. Default ""
    # so dataclass still works for builder calls that don't pass it.
    logo_base64: str = ""

    # ---- Cover hero image (optional). Base64 PNG/JPG. Rendered as the
    # full-width background of the upper half of the cover slide — useful
    # for a theater shot, mission area photo, or squadron art. The title
    # text floats below (or over a dark gradient on) the image. Empty
    # default so missions without a cover image use a text-only layout.
    cover_image_base64: str = ""
    # AI-generated 2-4 sentence threat paragraph (v1.15.x). Rendered above the
    # surface-threats table when present. User-editable like the other prose
    # sections; defaults empty so old missions/clients without it still render.
    threat_narrative: str = ""
    # Weather stated as consequence, not a data dump (v1.19.116). A real
    # brief always briefs the sky; the wing brief previously carried no
    # weather at all. Empty -> the renderer omits the slide.
    weather_brief: str = ""
    # Popup-attack profiles (v1.17.6). Mirrors the Kneeboard tab's profile
    # list (PopupAttackInput[] shape). When non-empty, the renderer adds a
    # POPUP ATTACK slide with one row per profile; empty = no slide. Pure
    # passthrough — the frontend owns the schema; backend just renders.
    popup_attacks: List[Dict[str, Any]] = field(default_factory=list)
    # Brief-presenter speaker notes (v1.19.x — BYOK AI extra).
    # Map of slide-id → 1-4 sentences of plain-text talking points that
    # python-pptx stuffs into each slide's notes pane. Slide IDs are the
    # short identifiers the renderer uses internally (see
    # SPEAKER_NOTE_SLIDES in brief_renderer.py): cover, theatre, scenario,
    # intent, threats, air_threats, flights, comms, timeline, notes, popup.
    # Empty default = no notes injected (renderer skips the per-slide note
    # write entirely). Generated client-side by ai/speakerNotes.ts when the
    # user clicks "✨ Generate speaker notes" — backend just renders.
    speaker_notes: Dict[str, str] = field(default_factory=dict)
    # v1.19.59 — Brief theme colours (squadron palette override).
    # Hex strings (e.g. "#1a1a1a") for each role. Empty / missing keys
    # fall back to the renderer's auto-dark or auto-light defaults.
    # Mirrors the kneeboard theme customizer's CSS-var shape but uses
    # PPTX-flavoured names since the brief renderer works in RGBColor.
    # Roles:
    #   bg          slide background
    #   text        body text + table cells
    #   bright      titles + section headers (defaults to text+pop)
    #   accent      bottom bar + section underlines + tag chips
    #   dim         attribution + secondary metadata
    #   border      table cell + chip borders
    #   header_bg   table header row background
    #   cell_bg     table body cell background
    # Brief renderer applies each key when present; absent keys leave the
    # default. (See render_wing_brief in brief_renderer.py.)
    theme_colors: Dict[str, str] = field(default_factory=dict)
    # v1.19.137 — Control measures table (bullseye, steerpoints/DMPIs, ROZ /
    # holding areas from trigger zones, tanker tracks). Each row is a
    # serialised ControlMeasureRow. Empty -> renderer omits the slide.
    control_measures: List[Dict[str, str]] = field(default_factory=list)
    # v1.19.137 — Single-line METAR for the WX slide (matches the squadron's
    # hand brief). Empty -> no METAR line.
    metar: str = ""
    # v1.19.137 — "Classified document" styling toggle + banner text. When
    # classified is True the renderer stamps a top/bottom banner on every
    # slide and adds a classification block to the cover. Fiction only —
    # a disclaimer footer says so. classification defaults to the common
    # exercise marking; the mission maker can edit it.
    classified: bool = False
    classification: str = "TOP SECRET // REL TO COALITION"
    # v1.19.137 — Package timeline ladder (Gantt). Each entry:
    # {callsign, role, push_z, tot_z, land_z, push_min, tot_min, land_min}.
    # Empty -> renderer omits the slide.
    package_timeline: List[Dict[str, Any]] = field(default_factory=list)
    # v1.19.137 — Rules of engagement. Seeded with a standard editable
    # template (ROE isn't in the .miz); the mission maker tailors it. Empty
    # dict -> renderer omits the ROE slide. Shape:
    #   {weapons_status, threat_posture, fire_authority, hostile_authority,
    #    hostile_criteria: [{code, category, text}], nofire: [str], abort}
    roe: Dict[str, Any] = field(default_factory=dict)
    # v1.19.139 — Operating-area centre, used by the renderer to fetch a
    # satellite background for the place-driven slides (cover, situation,
    # threats, intent). {lat, lon, span_km} framing the route + threats, or
    # None when the mission carries no usable coordinates (renderer then falls
    # back to its flat-dark slides). Not user-edited — recomputed each build.
    ao_center: Optional[Dict[str, Any]] = None
    # v1.19.139 — Glanceable WX cards (wind/vis/cloud/temp/QNH) rendered as a
    # chip row under the METAR on the weather slide, so a clean (map-less)
    # slide still carries real content. Empty -> just METAR + prose.
    weather_stats: List[Dict[str, str]] = field(default_factory=list)
    # v1.19.140 — Target imagery: one satellite close-up slide per DMPI/aim
    # point, like a real strike brief's target photos. Each entry:
    # {name, lat, lon, ll, mgrs, elev, weapon, description}. lat/lon are
    # numeric (the renderer fetches ESRI imagery centred there); the rest are
    # preformatted display strings. Built from the placed DMPIs. Empty -> no
    # target-imagery slides.
    target_imagery: List[Dict[str, Any]] = field(default_factory=list)
    # v1.19.153 — AAR plan. `tankers` is the pool of friendly tankers
    # ({callsign, freq, tacan}) the editor offers as options; `tanker_assignments`
    # is one row per player flight ({flight, tanker, freq, tacan}), auto-suggested
    # as the nearest track and overridable in the editor. Empty when no tankers.
    tankers: List[Dict[str, str]] = field(default_factory=list)
    tanker_assignments: List[Dict[str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Theatre overview blurbs — one short paragraph per supported theater.
# Sourced from public knowledge of the regions DCS maps cover. Mission
# makers can rewrite freely; these are just to give a fresh load
# immediate situational framing.
# ---------------------------------------------------------------------------

THEATRE_BLURBS: Dict[str, str] = {
    "Caucasus":
        "Black Sea coast backed by a 4,000 m ridgeline. Coalition fields on "
        "the coast, Russian fields around Krasnodar and Sochi. The valleys "
        "mask well — they also put you below radar coverage.",
    "Syria":
        "Eastern Mediterranean: coast, coastal range, Bekaa, desert plateau. "
        "Several national air forces sit minutes apart. IFF discipline is not "
        "optional here.",
    "PersianGulf":
        "Gulf littoral. Long overwater legs, few diverts, and summer heat that "
        "costs real performance. Civil traffic density is high — know the "
        "corridors.",
    "Nevada":
        "High desert. Field elevations above 5,000 ft; density altitude drives "
        "every takeoff, landing and climb number you brief.",
    "SinaiMap":
        "Sinai and the Nile delta. Open desert with little terrain masking, "
        "adjoining Israeli and Egyptian airspace, sparse diverts inland.",
    "Normandy":
        "1944 northern France. Short legs, poor weather, unimproved strips. "
        "Navigation is visual — assume no meaningful radio aids.",
    "TheChannel":
        "Channel coast, England to Calais. Very short legs, marginal weather, "
        "and an overwater ditching problem on every sortie.",
    "MarianaIslands":
        "Open Pacific. Guam and Saipan are effectively the only diverts, so "
        "overwater fuel planning is the mission.",
    "Falklands":
        "South Atlantic. Severe weather, high winds, very long overwater legs "
        "and almost no divert. Weather is the primary threat.",
    "Kola":
        "Arctic, 65-70N — northern Norway, Finland, and the Murmansk / "
        "Severomorsk complex. Long ranges, few diverts, and low sun with short "
        "daylight in winter.",
    "Afghanistan":
        "High mountain terrain. Elevation and ridgelines drive performance; "
        "thin air, hot days, and long distances between diverts.",
    "Iraq":
        "Mesopotamian plain and western desert. Open terrain, little masking, "
        "long sight lines in both directions.",
    "TopEndAustralia":
        "Northern Australia. Vast and sparsely based — long overland and "
        "overwater legs with very few diverts.",
    "SouthEastAsia":
        "Jungle and karst. Poor visual acuity against the terrain and weather "
        "that builds fast through the afternoon.",
    "GermanyCW":
        "Cold War inner-German border. Dense airspace, short reaction times, "
        "and heavy SAM and AAA coverage on both sides of the line.",
}

DEFAULT_THEATRE_BLURB = ""  # unknown map -> omit the slide rather than print an "author this" note to aircrew


# Default mission names per theater — used when the .miz has no sortie
# string. Better than falling back to a literal filename like 'Mission 5
# v3 edited copy.miz' on the cover slide.
DEFAULT_MISSION_NAMES: Dict[str, str] = {
    "Caucasus":         "CAUCASUS OPERATIONS",
    "Syria":            "LEVANT OPERATIONS",
    "PersianGulf":      "PERSIAN GULF OPERATIONS",
    "Nevada":           "NEVADA TRAINING SORTIE",
    "SinaiMap":         "SINAI OPERATIONS",
    "Normandy":         "NORMANDY 1944",
    "TheChannel":       "CHANNEL OPERATIONS",
    "MarianaIslands":   "MARIANAS OPERATIONS",
    "Falklands":        "FALKLANDS 1982",
    "Kola":             "KOLA OPERATIONS",
    "Afghanistan":      "AFGHANISTAN OPERATIONS",
    "Iraq":             "IRAQ OPERATIONS",
    "TopEndAustralia":  "TOP END EXERCISE",
    "SouthEastAsia":    "SOUTHEAST ASIA OPERATIONS",
    "GermanyCW":        "COLD WAR GERMANY",
}


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


def _format_freq(value: Optional[float]) -> str:
    """Format a group radio frequency as MHz to 3 dp.

    DCS is inconsistent about units and a single .miz mixes them: most groups
    store MHz (124, 251, 128.3) while some store Hz (128300000). The previous
    implementation assumed Hz and floored at 1e6, so every MHz-stored group —
    i.e. nearly all of them — rendered blank on the comms and flight tables.
    Normalise on magnitude instead of trusting the unit.
    """
    try:
        f = float(value)
    except (TypeError, ValueError):
        return ""
    if f <= 0:
        return ""
    if f >= 1_000_000:          # Hz
        f /= 1_000_000
    elif f >= 1_000:            # kHz
        f /= 1_000
    # Outside any plausible aviation radio band -> treat as no frequency.
    if f < 1 or f > 3_000:
        return ""
    return f"{f:.3f}"


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


# One-line framing per mission type for the scenario's SITUATION lead.
_MISSION_FRAME: Dict[str, str] = {
    "strike":   "Strike on fixed targets.",
    "cas":      "Close air support for troops in contact.",
    "dca":      "Defensive counter-air.",
    "sead":     "SEAD to open the ingress corridor.",
    "antiship": "Anti-shipping strike.",
    "recon":    "Reconnaissance / AFAC.",
    "tanker":   "Air-refuelling support.",
    "mixed":    "Multi-role package.",
}


# Some mission generators bake a machine-written summary into the .miz
# description and coalition tasks. It restates what this brief already renders
# as tables, using raw DCS group names — "1x Ground-9-1" means nothing to
# aircrew — and it goes stale the moment the mission is re-saved. Strip it and
# keep only what a human actually wrote.
_MACHINE_HEADERS = re.compile(
    r"^\s*(SITUATION BRIEFING|BLUE COALITION TASK ORDER|RED COALITION"
    r"|THREAT LAYDOWN|FORCES:|PLAYER FLIGHTS|SUPPORT:|CARRIER OPS:"
    r"|Theater:|Date:\s*\d{4}-|Weather:\s*Wind"
    r"|AVAILABLE AIRBASES"
    r"|(Blue|Red):\s*\d+\s+air groups"
    r"|(Air|Ground):\s*\d+\s+groups\s*$"
    r"|IADS:\s*\d)", re.IGNORECASE)
# A long, comma-heavy line with no sentence punctuation is a dumped name list
# (airbases, group names), not prose someone wrote. Requires 5+ commas so a
# genuine long sentence isn't mistaken for one.
_MACHINE_LIST = re.compile(r"^(?=(?:[^,]*,){5,})[^.!?]{60,}$")
_MACHINE_BULLET = re.compile(
    r"^\s*[-*]\s.*?(\b\d+\s*x\s|\bMHz\b|\bTACAN\b|\bICLS\b|\bAAA-\d|\bGround-\d)",
    re.IGNORECASE)


def _clean_inline(text: str) -> str:
    """Un-escape mission text stored INLINE rather than behind a DictKey.

    Only dictionary-resolved strings pass through the Lua unescaper, so an
    inline description reached the brief with its escapes intact and we
    printed a literal backslash-n instead of breaking the line.
    """
    if not text or "\\" not in text:
        return text or ""
    # Order matters: some generators double-escape ("\\n"), so collapse the
    # double form before the single one or a stray backslash survives.
    return (text.replace("\\\\n", "\n")
                .replace("\\n", "\n")
                .replace("\\\\r", "")
                .replace("\\r", "")
                .replace('\\"', '"')
                .replace("\\\\", "\\"))


def _scrub_machine_text(text: str) -> str:
    """Drop generator-written boilerplate, keep human prose.

    Returns "" when nothing human survives, so the caller can omit the section
    instead of quoting a machine summary back at the aircrew.
    """
    if not text:
        return ""
    lines = _clean_inline(text).splitlines()
    kept = [ln for ln in lines
            if not _MACHINE_HEADERS.match(ln)
            and not _MACHINE_BULLET.match(ln)
            and not _MACHINE_LIST.match(ln.strip())]
    out = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()
    if not out:
        return ""
    # Only apply the "is this still prose?" floor when we actually stripped
    # something — otherwise a short but genuine human line (e.g. "Maintain ROE
    # in a tense situation") would be thrown away for being brief.
    if len(kept) < len(lines) and len(out) < 40:
        return ""
    return out


def _format_brief_date(iso: Optional[str]) -> str:
    """YYYY-MM-DD -> '08 NOV 06'. Briefs don't print ISO dates."""
    if not iso:
        return ""
    try:
        y, m, d = str(iso).split("-")
        months = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
        return f"{int(d):02d} {months[int(m) - 1]} {y[-2:]}"
    except (ValueError, IndexError, TypeError):
        return str(iso)


# ---------------------------------------------------------------------------
# Narrative synthesis
#
# A brief is not an inventory. Listing "5x S-300PS 40B6M tr" tells aircrew
# nothing they can fly on; "an S-300 belt reaches 65 NM from bullseye 125/214,
# and nothing inside it is survivable until it's rolled back" does. Everything
# below is derived from the mission — the value added is interpretation and
# consequence, never invented fact.
# ---------------------------------------------------------------------------

# DCS unit-type fragment -> (short name, family tier). Tier drives the
# consequence sentence, not the exact model.
_SAM_FAMILIES: List[Tuple[str, str, str]] = [
    (r"S-300|SA-10",              "SA-10",   "long"),
    (r"S-200|SA-5",               "SA-5",    "long"),
    (r"Patriot|SAM Patriot",      "Patriot", "long"),
    (r"SA-11|Buk|9K37",           "SA-11",   "medium"),
    (r"Kub|1S91|SA-6",            "SA-6",    "medium"),
    (r"Hawk",                     "Hawk",    "medium"),
    (r"S-125|5p73|SA-3",          "SA-3",    "medium"),
    (r"Tor|9A331|SA-15",          "SA-15",   "short"),
    (r"Osa|9A33|SA-8",            "SA-8",    "short"),
    (r"Tunguska|2S6|SA-19",       "SA-19",   "short"),
    (r"Strela-10|SA-13",          "SA-13",   "short"),
    (r"Strela-1|SA-9",            "SA-9",    "short"),
    (r"Igla|Manpad|Stinger",      "MANPADS", "short"),
    (r"Roland",                   "Roland",  "short"),
    (r"Rapier",                   "Rapier",  "short"),
    (r"Gepard|Vulcan|ZSU|Shilka|ZU-23|AAA", "AAA", "aaa"),
]


def _sam_family(type_name: str) -> Tuple[str, str]:
    """Map a DCS SAM/AAA unit type to (short name, tier)."""
    t = type_name or ""
    for pattern, short, tier in _SAM_FAMILIES:
        if re.search(pattern, t, re.IGNORECASE):
            return short, tier
    return (t.split()[0] if t else "Unknown"), "medium"


def _narrate_enemy(threat_rows: List[Dict[str, Any]],
                   air_rows: List[Dict[str, Any]]) -> str:
    """Turn the computed threat tables into a briefable enemy picture."""
    paras: List[str] = []

    # ---- Air: what will come up, and what it means ----
    fighters, helos, other = [], [], []
    for a in air_rows or []:
        if (a.get("coalition") or "red") == "blue":
            continue
        comp = str(a.get("composition") or "").strip()
        cls = str(a.get("airframe_class") or "").lower()
        if not comp:
            continue
        # A civil airliner wandering the map is not an enemy air picture.
        if any(k in cls for k in ("unknown", "civil", "airliner")):
            continue
        if "helicopter" in cls or "helo" in cls:
            helos.append(comp)
        elif any(k in cls for k in ("bomber", "transport", "tanker", "awacs", "recon")):
            other.append(comp)
        else:
            fighters.append(comp)

    if fighters:
        lead = "Enemy fighters: " + ", ".join(fighters) + "."
        paras.append(lead + " Expect them airborne early and committed against "
                     "whatever they see first.")
    if helos:
        paras.append("Rotary: " + ", ".join(helos) + ". They work low and in the "
                     "terrain — you will lose them against the ground if you are "
                     "not looking for them.")
    if other:
        paras.append("Also airborne: " + ", ".join(other) + ".")

    # ---- Surface: lead with the system that actually shapes the plan ----
    red = [t for t in (threat_rows or []) if (t.get("coalition") or "red") != "blue"]
    if red:
        byfam: Dict[str, Dict[str, Any]] = {}
        for t in red:
            short, tier = _sam_family(str(t.get("type") or t.get("name") or ""))
            e = byfam.setdefault(short, {"tier": tier, "n": 0, "nm": 0.0, "loc": ""})
            e["n"] += 1
            try:
                nm = float(t.get("range_nm") or 0)
            except (TypeError, ValueError):
                nm = 0.0
            if nm > e["nm"]:
                e["nm"] = nm
                e["loc"] = str(t.get("location") or "")

        ranked = sorted(byfam.items(), key=lambda kv: -kv[1]["nm"])
        top, td = ranked[0]
        rest = [k for k, _ in ranked[1:] if byfam[k]["tier"] != "aaa"]
        aaa = [k for k, v in ranked if v["tier"] == "aaa"]

        loc = re.sub(r"^BE\s*", "", str(td.get("loc") or "")).strip()
        where = f" from bullseye {loc}" if loc else ""
        if td["tier"] == "long" and td["nm"] >= 1:
            s = (f"The air-defence picture is the problem. {top} reaches "
                 f"{td['nm']:.0f} NM{where}, and nothing inside that ring is "
                 f"survivable until it is rolled back.")
        elif td["nm"] >= 1:
            s = (f"{top} covers the approaches out to {td['nm']:.0f} NM{where} — "
                 f"plan around it or have it suppressed before you commit.")
        else:
            s = f"{top} is emplaced in the target area."
        if rest:
            s += " Layered under it: " + ", ".join(rest) + "."
        if aaa:
            s += (" Heavy AAA wherever their units sit — anything low over them "
                  "is exposed.")
        paras.append(s)

    return "\n\n".join(paras)


def _narrate_friendly(groups: List[dict]) -> str:
    """Describe the package as a force, not a parts list."""
    from collections import Counter
    blue = [g for g in groups if _is_player_group(g) and g.get("coalition") == "blue"]
    if not blue:
        return ""

    # Player flights, grouped by airframe, expressed in flights not raw jets.
    by_ac: Counter = Counter()
    jets: Counter = Counter()
    for g in blue:
        t = ((g.get("units") or [{}])[0].get("type")) or "?"
        by_ac[t] += 1
        jets[t] += len(g.get("units") or [])
    bits = []
    for t, nfl in by_ac.most_common(4):
        name = _airframe_profile(t)["name"]
        bits.append(f"{nfl} {name} flight{'' if nfl == 1 else 's'} "
                    f"({jets[t]} aircraft)")
    lines = [_join_prose(bits) + "."]

    # Where they come from: carriers if any are present.
    carriers = []
    for g in groups:
        if g.get("coalition") != "blue" or g.get("category") != "ship":
            continue
        for u in (g.get("units") or []):
            if re.search(r"CVN|CV_|LHA|LHD|Stennis|Forrestal",
                         str(u.get("type") or ""), re.IGNORECASE):
                carriers.append(_short_callsign(g.get("groupName")))
                break
    carriers = [c for c in carriers if c]
    if carriers:
        lines.append("Flying from " + _join_prose(carriers) + ".")

    # Support that changes how the fight is run.
    awacs = [g.get("groupName") for g in groups
             if g.get("coalition") == "blue" and (g.get("task") or "").lower() == "awacs"]
    tankers = [g.get("groupName") for g in groups
               if g.get("coalition") == "blue" and (g.get("task") or "").lower() == "refueling"]
    sup = []
    if awacs:
        sup.append(f"{_short_callsign(awacs[0])} carries the picture")
    if tankers:
        names = sorted({_short_callsign(t) for t in tankers if t})
        sup.append(_join_prose(names) + " hold the tanker tracks")
    if sup:
        s = _join_prose(sup)
        lines.append(s[:1].upper() + s[1:] + ".")

    return " ".join(lines)


def _brief_callsign(group_name: Optional[str]) -> str:
    """'Texaco-2-1' -> 'Texaco 2'.

    DCS appends a unit index to the group name. That trailing index is noise on
    a brief, but the flight number is NOT: Texaco 2, 3 and 4 are different
    tankers on different frequencies, so collapsing them all to "Texaco" makes
    the comms card ambiguous. Drop only the trailing unit index.
    """
    s = str(group_name or "").strip()
    if not s:
        return ""
    parts = [p for p in re.split(r"[-_\s]+", s) if p]
    if len(parts) >= 3 and parts[-1].isdigit() and parts[-2].isdigit():
        parts = parts[:-1]
    return " ".join(parts)


def _short_callsign(group_name: Optional[str]) -> str:
    """'Texaco-2-1' -> 'Texaco'. Brief prose uses the callsign, not the
    DCS group index."""
    base = re.split(r"[-_ ]\d", str(group_name or ""), maxsplit=1)[0]
    return base.strip() or str(group_name or "")


def _join_prose(items: List[str]) -> str:
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def _narrate_weather(wx: Optional[dict], start_seconds: Optional[float]) -> str:
    """Weather as consequence, not a data dump. A brief says what the sky will
    do to the sortie."""
    if not wx:
        return ""
    out: List[str] = []
    try:
        temp = float(wx.get("temperature_c"))
    except (TypeError, ValueError):
        temp = None
    vis_km = (wx.get("visibility_m") or 0) / 1000.0
    base_ft = (wx.get("clouds_base_m") or 0) * 3.28084
    preset = str(wx.get("clouds_preset") or "")
    rain = bool(re.search(r"rain|storm", preset, re.IGNORECASE))
    storm = bool(re.search(r"storm", preset, re.IGNORECASE))
    overcast = bool(re.search(r"rainy|overcast|preset1[0-9]|preset2[0-7]",
                              preset, re.IGNORECASE))

    if storm:
        out.append(f"Thunderstorms with a ceiling near {base_ft:,.0f} ft. "
                   "Expect turbulence, poor visibility in the cells and a real "
                   "chance the recovery goes to the alternate.")
    elif rain or overcast:
        out.append(f"Overcast around {base_ft:,.0f} ft"
                   + (" with rain" if rain else "") +
                   ". Plan for an instrument recovery and brief the approach.")
    elif base_ft > 0:
        out.append(f"Broken to scattered around {base_ft:,.0f} ft — workable.")
    else:
        out.append("Clear.")

    if vis_km >= 40:
        out.append("Visibility is unrestricted.")
    elif vis_km > 0:
        out.append(f"Visibility {vis_km:.0f} km.")

    if temp is not None and temp <= 2:
        out.append(f"Surface temperature {temp:.0f}C — icing is live in the "
                   "climb and on the tanks.")
    elif temp is not None and temp >= 32:
        out.append(f"Surface temperature {temp:.0f}C — expect degraded takeoff "
                   "performance and long legs on the numbers.")

    if start_seconds is not None:
        hour = (int(start_seconds) // 3600) % 24
        if 4 <= hour <= 7:
            out.append("Dawn launch: low light for the first cycle.")
        elif hour >= 19 or hour <= 3:
            out.append("Night launch: plan for a night recovery.")

    return " ".join(out)


def _build_scenario(
    overview: dict,
    dictionary: Dict[str, str],
    groups: Optional[List[dict]] = None,
    threats: Optional[List[dict]] = None,
    theater: Optional[str] = None,
    threat_rows: Optional[List[Dict[str, Any]]] = None,
    air_rows: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """SCENARIO: the situation, then what the enemy will do, then what we have.

    Written as prose a flight lead could read aloud. The mission's own words
    lead when the mission maker wrote any; the enemy and friendly paragraphs
    are synthesised from the computed threat tables (see _narrate_enemy /
    _narrate_friendly) so the slide carries consequence rather than an
    inventory of unit types.

    Returns "" when the mission carries nothing worth briefing so the renderer
    drops the slide instead of printing a prompt to go author one.
    """
    groups = groups or []
    threats = threats or []

    def _resolve(key: str) -> str:
        v = str(resolve_dict_key(overview.get(key) or "", dictionary)).strip()
        if v.startswith("DictKey_"):          # lookup failed
            return ""
        return _scrub_machine_text(v)

    desc = _resolve("description")
    blue_task = _resolve("descriptionBlueTask")
    red_task = _resolve("descriptionRedTask")

    parts: List[str] = []

    # ---- SITUATION ----
    mtype = _detect_mission_type(groups)
    when = " ".join(x for x in (
        _format_brief_date(overview.get("date")),
        # No start time is not "0000Z" — say nothing rather than a wrong time.
        _format_zulu(overview["start_time"])
        if overview.get("start_time") is not None else "",
    ) if x)
    stamp = ". ".join(x for x in (theater or "", when) if x)
    lead = " ".join(x for x in ((stamp + "." if stamp else ""),
                                _MISSION_FRAME.get(mtype, "")) if x).strip()
    sit = [s for s in (lead, desc) if s]
    if sit:
        parts.append("SITUATION\n" + "\n\n".join(sit))

    # ---- ENEMY ----
    # Prefer the computed threat rows (they carry range_nm + bullseye position).
    # Fall back to the raw threat list so a caller that doesn't pass them still
    # gets an enemy picture rather than a silently missing section.
    rows = list(threat_rows or [])
    if not rows and threats:
        rows = [{
            "type": t.get("type") or t.get("name"),
            "coalition": t.get("coalition"),
            "range_nm": (float(t.get("range") or 0) / 1852.0) or 0.0,
            "location": "",
        } for t in threats]
    enemy = _narrate_enemy(rows, air_rows or [])
    if red_task:
        enemy = (enemy + "\n\n" + red_task).strip() if enemy else red_task
    if enemy:
        parts.append("ENEMY FORCES\n" + enemy)

    # ---- FRIENDLY ----
    friendly = _narrate_friendly(groups)
    if blue_task:
        friendly = (friendly + " " + blue_task).strip() if friendly else blue_task
    if friendly:
        parts.append("FRIENDLY FORCES\n" + friendly)

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


def _build_commanders_intent(groups: List[dict]) -> str:
    """Commander's intent is the mission maker's to write.

    This used to emit a fill-in-the-blanks template — "[NAMED TARGET]",
    "author the intent across all elements" — which shipped verbatim to
    aircrew whenever nobody edited it. Return "" instead: the renderer omits
    the slide, and a missing intent is obvious to the author in a way a
    plausible-looking fake one is not.
    """
    return ""


# What the package actually does once it's on station, by mission type.
_FLOW_ACTION: Dict[str, str] = {
    "strike":   "Run the IP-to-target leg and egress on the planned corridor.",
    "cas":      "Check in with the JTAC and work 9-lines on station.",
    "dca":      "Hold assigned stations; commit on the AWACS picture.",
    "sead":     "Suppress threats inside the MEZ ahead of the strike.",
    "antiship": "Run the attack on the surface group and clear the area.",
    "recon":    "Work the area of interest and report.",
    "tanker":   "Hold the track and pass fuel as tasked.",
    "mixed":    "Execute assigned tasking; supporting flights enable the main effort.",
}


def _build_mission_flow(timeline: List[Dict[str, str]], groups: List[dict]) -> str:
    """Scheme of manoeuvre, derived from this mission.

    Previously a fixed six-line block printed on every brief ever generated —
    "Push at TOT-15" — while the computed timeline sat unused on the next
    slide. Emit only the lines the mission actually supports, and return ""
    when that is fewer than two, so the slide is dropped rather than padded.
    """
    timeline = timeline or []
    groups = groups or []
    waves = [r for r in timeline
             if str(r.get("phase", "")).strip().lower().startswith("cv wave")]
    by_phase = {str(r.get("phase", "")).strip().lower(): r for r in timeline}
    lines: List[str] = []

    if waves:
        first = waves[0].get("time_zulu", "")
        last = waves[-1].get("time_zulu", "")
        span = f" through {last}" if last and last != first else ""
        lines.append(f"Launch — {len(waves)} carrier waves from {first}{span}.")
    elif by_phase.get("takeoff"):
        lines.append(f"Launch — takeoff {by_phase['takeoff'].get('time_zulu', '')}.")

    push, tot = by_phase.get("push"), by_phase.get("tot")
    if push and tot and push.get("time_zulu") != tot.get("time_zulu"):
        lines.append(f"Push — {push.get('time_zulu')}, TOT {tot.get('time_zulu')}.")
    elif push and push.get("time_zulu"):
        lines.append(f"Push — coordinated push {push.get('time_zulu')}.")

    action = _FLOW_ACTION.get(_detect_mission_type(groups), "")
    if action:
        lines.append(f"Action — {action}")

    support = set()
    for g in groups:
        if g.get("coalition") != "blue":
            continue
        task = (g.get("task") or "").strip().lower()
        if task == "refueling":
            support.add("Tankers")
        elif task == "awacs":
            support.add("AWACS")
    if support:
        lines.append("Support — " + " and ".join(sorted(support))
                     + " on station. Cycle to hold coverage.")

    if by_phase.get("rtb"):
        lines.append("Recovery — RTB home plate or alternate. Divert per brief.")

    return "\n".join(lines) if len(lines) >= 2 else ""


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


def _is_carrier_group(g: dict) -> bool:
    """Carrier ship groups — anything that DCS treats as a CV/CVN/LHA-class
    deck. Used by spawn-wave timeline math and the comms slide."""
    if g.get("category") != "ship":
        return False
    utype = ((g.get("units") or [{}])[0].get("type") or "").upper()
    return any(k in utype for k in (
        "CVN", "CV_", "STENNIS", "LINCOLN", "ROOSEVELT", "VINSON",
        "WASHINGTON", "TRUMAN", "FORRESTAL", "TARAWA", "AMERICA",
        "KUZNECOW", "KUZNETSOV",
    ))


def _is_carrier_launched(flight: dict, carriers: List[dict]) -> bool:
    """A flight is carrier-launched if its first waypoint sits within
    ~3 nm of a carrier's spawn position. Cheap squared-distance check
    in lat/lon, scaled crudely — fine for differentiating carrier
    launches from runway departures even at high latitudes."""
    wps = flight.get("waypoints") or []
    if not wps:
        return False
    wp0 = wps[0]
    fl_lat = wp0.get("lat"); fl_lon = wp0.get("lon")
    if fl_lat is None or fl_lon is None:
        return False
    for c in carriers:
        units = c.get("units") or []
        if not units:
            continue
        c_lat = units[0].get("lat"); c_lon = units[0].get("lon")
        if c_lat is None or c_lon is None:
            continue
        # ~3 nm = ~0.05° at equator, scales by cos(lat) for lon.
        # Use a generous 0.1° box to be tolerant of mid-deck spawns.
        if abs(fl_lat - c_lat) < 0.1 and abs(fl_lon - c_lon) < 0.1:
            return True
    return False


def _build_carrier_spawn_waves(
    groups: List[dict],
    start_seconds: Optional[float],
) -> List[tuple]:
    """Compute carrier spawn waves for the timeline.

    Returns (absolute_seconds, TimelineRow) tuples so the caller can
    interleave them into the main timeline in chronological order.

    Rule (per Fett's SOP): a carrier deck can safely spawn 8 jets at a
    time, with 5 minutes of startup before the next wave can spawn. So a
    16-jet carrier package is wave 1 (jets 1-8) at takeoff, wave 2 at
    takeoff + 5 min. Land-based flights don't suffer this constraint.

    Returns timeline rows describing each wave; when there's only one
    wave (or no carrier-launched flights), returns []. The caller
    interleaves these into the main timeline.
    """
    if start_seconds is None:
        start_seconds = 0.0
    carriers = [g for g in groups if _is_carrier_group(g)]
    if not carriers:
        return []

    # Pull all carrier-launched player flights, sorted by group ID for
    # deterministic wave ordering.
    cv_flights = [g for g in groups
                  if _is_player_group(g) and _is_carrier_launched(g, carriers)]
    if not cv_flights:
        return []

    # Sum total jets across CV-launched flights — that's what the deck
    # has to sequence.
    total_jets = sum(len(g.get("units") or []) for g in cv_flights)
    JETS_PER_WAVE = 8
    WAVE_INTERVAL_MIN = 5
    waves = (total_jets + JETS_PER_WAVE - 1) // JETS_PER_WAVE
    if waves <= 1:
        return []  # one wave fits the deck — no spawn-order row needed

    rows: List[tuple] = []
    # Distribute flights into waves, packing units up to 8 per wave.
    wave_lists: List[List[str]] = [[] for _ in range(waves)]
    used_in_wave = 0
    wave_idx = 0
    for g in cv_flights:
        cs = (g.get("units") or [{}])[0].get("name") or g.get("groupName", "?")
        unit_count = len(g.get("units") or [])
        if used_in_wave + unit_count > JETS_PER_WAVE and wave_idx + 1 < waves:
            wave_idx += 1
            used_in_wave = 0
        wave_lists[wave_idx].append(f"{cs} ({unit_count})")
        used_in_wave += unit_count

    for i, members in enumerate(wave_lists):
        if not members:
            continue
        wave_t = start_seconds + i * WAVE_INTERVAL_MIN * 60
        rows.append((wave_t, TimelineRow(
            phase=f"CV Wave {i + 1}",
            time_zulu=_format_zulu(wave_t),
            note=", ".join(members) + (
                "  ·  spawn first" if i == 0 else f"  ·  +{i * WAVE_INTERVAL_MIN} min"),
        )))
    return rows


def _build_timeline(
    start_seconds: Optional[float],
    groups: Optional[List[dict]] = None,
    mission_type: Optional[str] = None,
) -> List[Dict[str, str]]:
    """Build a squadron/package-level phase timeline anchored on mission start,
    enriched with actual waypoint times when player flights have meaningfully
    named waypoints. Falls back to heuristic offsets when names aren't matched.
    Per-flight detail lives on each individual flight brief, not here.

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
                + (f" (from waypoint data, {len(rtb_times)} flight"
                   f"{'' if len(rtb_times) == 1 else 's'})" if rtb_times else ""))

    # Mission types that spend significant time over the AO get an
    # on-station WINDOW (start/end) instead of a single TOT — for CAS,
    # DCA, recon flights the meaningful planning value is the window
    # the package is available, not a single moment over the target.
    mtype = (mission_type or "").lower()
    is_window_mission = mtype in {"cas", "dca", "recon"}

    if is_window_mission:
        # Window start = the existing tot_t (push-into-AO time).
        # Window end heuristic: 15 min before RTB for CAS (typical
        # off-station handoff), or 10 min for DCA/recon.
        end_offset_min = 15 if mtype == "cas" else 10
        on_station_end = max(rtb_t - end_offset_min * 60, tot_t)
        on_station_label = {
            "cas":   "On-Station (CAS)",
            "dca":   "On-Station (CAP)",
            "recon": "On-Station (Recon)",
        }[mtype]
        action_timed = [
            (tot_t, TimelineRow(f"{on_station_label} Start", _format_zulu(tot_t), tot_note)),
            (on_station_end, TimelineRow(f"{on_station_label} End", _format_zulu(on_station_end),
                        f"Hand-off / off-station — RTB minus {end_offset_min} min")),
        ]
    else:
        action_timed = [(tot_t, TimelineRow("TOT", _format_zulu(tot_t), tot_note))]

    # Each row carries its absolute time (seconds-from-midnight) so the whole
    # timeline sorts chronologically. Build order is structural, NOT
    # chronological — carrier spawn waves happen near takeoff but were being
    # appended after RTB, so they printed out of order. Sorting on the real
    # time fixes it generally, not just for carriers. (v1.19.152)
    ground_t = start_seconds - 30 * 60
    estart_t = start_seconds - 10 * 60
    timed: List[tuple[float, TimelineRow]] = [
        (ground_t, TimelineRow("Ground Ops", _format_zulu(ground_t), "Pre-flight, brief, walk to jets")),
        (estart_t, TimelineRow("Engine Start", _format_zulu(estart_t), "Sequence per ground")),
        (start_seconds, TimelineRow("Takeoff", _format_zulu(start_seconds), "Rolling takeoff, flow takeoff per flight")),
        (push_t, TimelineRow("Push", _format_zulu(push_t), push_note)),
        *action_timed,
        (egress_t, TimelineRow("Egress Complete", _format_zulu(egress_t), egress_note)),
        (rtb_t, TimelineRow("RTB", _format_zulu(rtb_t), rtb_note)),
    ]

    # Interleave carrier spawn waves (empty unless a CV package needs >1 wave)
    # by their real spawn time, then stable-sort the whole timeline. Equal
    # times keep structural order (Takeoff before a CV Wave 1 at the same sec).
    timed.extend(_build_carrier_spawn_waves(groups, start_seconds))
    timed.sort(key=lambda x: x[0])
    return [asdict(r) for _, r in timed]


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

        # Count by TYPE, not name. Unit names are unique per unit
        # ("301 ZSU-23-4 Shilka | 3rd Co, 1528th AD Regt"), so counting by name
        # produced one entry per unit and compositions of 150-320 characters —
        # a table cell fits about 75, so the threat slides were three pages of
        # wrapped, repeating text. By type, six Shilkas read "6× ZSU-23-4
        # Shilka".
        type_counts = Counter(
            (m.get("type") or m.get("name") or "Unknown") for m in members
        )
        composition = " + ".join(
            f"{cnt}× {name}" for name, cnt in type_counts.most_common()
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

        # Primary name + type — used as tiebreakers and for legacy fields.
        # Still counted by full unit name: `name` is the legacy per-unit label,
        # only `composition` collapses by type.
        name_counts = Counter(m.get("name") or "Unknown" for m in members)
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


# ---------------------------------------------------------------------------
# Air-threat capability database
# ---------------------------------------------------------------------------
# Maps a DCS unit-type SUBSTRING (case-insensitive) to the capability a blue
# pilot actually cares about: a clean display name, the airframe class, primary
# A2A weapons + rough WEZ, and a terse "how to fight it" note. Longest matching
# key wins ("Su-33" beats "Su-3", "MiG-29S" beats "MiG-29"). Unknown types fall
# back to a generic "verify" profile so nothing is silently dropped.

_AIRFRAME_DB: "list[tuple[str, dict]]" = [
    # ---- Russian / Chinese fighters ----
    ("Su-27",  {"name": "Su-27",  "class": "Heavy 4th-gen fighter",
                "weapons": "R-27ER/ET (BVR ~30nm) · R-73 (WVR, HMS)",
                "notes": "Capable BVR shooter, very agile WVR — defend the R-27 early; avoid a prolonged merge."}),
    ("Su-33",  {"name": "Su-33",  "class": "Naval heavy fighter",
                "weapons": "R-27ER/ET (BVR) · R-73 (WVR)",
                "notes": "Flanker capability off a carrier — fight it like an Su-27."}),
    ("Su-30",  {"name": "Su-30",  "class": "Multirole heavy fighter",
                "weapons": "R-77 (active BVR) · R-27 · R-73 (WVR)",
                "notes": "Active-radar BVR plus Flanker agility — high threat in both regimes."}),
    ("Su-34",  {"name": "Su-34",  "class": "Strike fighter",
                "weapons": "R-77 / R-73 (self-defense)",
                "notes": "Primarily a striker but can shoot back — not a dedicated fighter."}),
    ("Su-24",  {"name": "Su-24",  "class": "Strike bomber",
                "weapons": "— (air-to-ground)",
                "notes": "Bomber, no real A2A — but its escort may be nearby."}),
    ("Su-25",  {"name": "Su-25",  "class": "Attack jet (CAS)",
                "weapons": "R-60 (short IR, self-defense)",
                "notes": "Low/slow CAS, minimal A2A — a ground threat, not an air one."}),
    ("MiG-31", {"name": "MiG-31", "class": "Long-range interceptor",
                "weapons": "R-33 / R-37 (very-long-range BVR)",
                "notes": "Extreme-range BVR — shoots from outside a normal WEZ. Fast/high, not agile; deny the geometry."}),
    ("MiG-29S",{"name": "MiG-29S","class": "Fulcrum (upgraded)",
                "weapons": "R-77 / R-27ER (BVR) · R-73 (WVR, HMS)",
                "notes": "BVR-capable AND deadly WVR (R-73 + helmet sight) — dangerous at the merge."}),
    ("MiG-29", {"name": "MiG-29", "class": "Fulcrum",
                "weapons": "R-27R (BVR) · R-73 (WVR, HMS)",
                "notes": "WVR-focused; R-73 + helmet sight make the merge very dangerous."}),
    ("MiG-25", {"name": "MiG-25", "class": "High-speed interceptor",
                "weapons": "R-40 (BVR, dated)",
                "notes": "Very fast/high but a poor turner — out-turn it, don't try to out-run it."}),
    ("MiG-23", {"name": "MiG-23", "class": "Swing-wing fighter",
                "weapons": "R-24/R-23 (BVR, dated) · R-60 (WVR)",
                "notes": "Fast in a straight line, poor turner — beat it in a turning fight."}),
    ("MiG-21", {"name": "MiG-21", "class": "Light day fighter",
                "weapons": "R-60/R-3 (short IR)",
                "notes": "WVR-only, fast and small (low RCS) — hard to see; no BVR threat."}),
    ("J-11",   {"name": "J-11",   "class": "Heavy 4th-gen fighter",
                "weapons": "R-77 / PL-12 · R-73 (WVR)",
                "notes": "Chinese Flanker — modern active BVR plus Flanker agility."}),
    ("JF-17",  {"name": "JF-17",  "class": "Multirole fighter",
                "weapons": "SD-10 (active BVR) · PL-5 (WVR)",
                "notes": "Modern active-radar BVR (SD-10 ≈ AMRAAM-class) — respect it at range."}),
    # ---- Western fighters (may appear as the red side) ----
    ("F-14",   {"name": "F-14",   "class": "Fleet-defense interceptor",
                "weapons": "AIM-54 Phoenix (very-long-range) · AIM-7 · AIM-9",
                "notes": "Phoenix = extreme-range shots — respect the AIM-54 timeline; strong BVR."}),
    ("F-15E",  {"name": "F-15E",  "class": "Strike fighter",
                "weapons": "AIM-120 (active BVR) · AIM-9",
                "notes": "Striker with full A2A — treat it like an Eagle if airborne."}),
    ("F-15",   {"name": "F-15C",  "class": "Air-superiority fighter",
                "weapons": "AIM-120 (active BVR) · AIM-7 · AIM-9",
                "notes": "Premier BVR threat — AMRAAM + big radar. Don't take a BVR fight you can't win."}),
    ("F-16",   {"name": "F-16C",  "class": "Multirole fighter",
                "weapons": "AIM-120 (active BVR) · AIM-9",
                "notes": "AMRAAM shooter, very agile WVR — dangerous in both regimes."}),
    ("FA-18",  {"name": "F/A-18C","class": "Multirole fighter",
                "weapons": "AIM-120 · AIM-7 · AIM-9",
                "notes": "AMRAAM + excellent WVR (HMS) — dangerous in both regimes."}),
    ("M-2000", {"name": "M-2000C","class": "Multirole delta",
                "weapons": "Super 530D (SARH BVR) · Magic II (WVR)",
                "notes": "Agile delta; semi-active BVR only — force the 530 into the notch."}),
    ("Mirage-F1", {"name": "Mirage F1", "class": "Fighter",
                "weapons": "Super 530 (BVR, dated) · R550 Magic (WVR)",
                "notes": "Limited BVR; quick at low level — capable WVR with Magic."}),
    ("F-5",    {"name": "F-5E",   "class": "Light fighter",
                "weapons": "AIM-9P (short IR) · guns",
                "notes": "WVR-only, small and agile — hard to spot; beat it BVR, respect the sustained turn."}),
    ("F-4",    {"name": "F-4E",   "class": "Fighter-bomber",
                "weapons": "AIM-7 (BVR, dated) · AIM-9 (WVR)",
                "notes": "Dated BVR but the AIM-7 still bites — smoky and visible."}),
    ("AV8",    {"name": "AV-8B",  "class": "VSTOL attack",
                "weapons": "AIM-9 (WVR, self-defense)",
                "notes": "Attack jet — only short-range IR for self-defense."}),
    # ---- Bombers / high-value ----
    ("Tu-160", {"name": "Tu-160", "class": "Strategic bomber",
                "weapons": "— (stand-off cruise missiles)",
                "notes": "Fast missile carrier, no A2A — high-value; may launch from stand-off."}),
    ("Tu-22",  {"name": "Tu-22M3","class": "Strategic bomber",
                "weapons": "— (stand-off missiles)",
                "notes": "Missile carrier, no A2A — high-value; can launch from range."}),
    ("Tu-95",  {"name": "Tu-95",  "class": "Strategic bomber",
                "weapons": "— (cruise missiles)",
                "notes": "Slow bomber, no A2A — high-value target."}),
    ("A-50",   {"name": "A-50",   "class": "AEW&C (AWACS)",
                "weapons": "— (none)",
                "notes": "Enemy AWACS — feeds their fighters the picture. Killing it blinds their intercepts; high-value."}),
    ("E-3",    {"name": "E-3",    "class": "AEW&C (AWACS)",
                "weapons": "— (none)",
                "notes": "Enemy AWACS — high-value; kill it to blind their fighters."}),
    ("IL-78",  {"name": "Il-78",  "class": "Tanker",
                "weapons": "— (none)",
                "notes": "Enemy tanker — no A2A; high-value (denies their fighters fuel/persistence)."}),
    ("IL-76",  {"name": "Il-76",  "class": "Transport",
                "weapons": "— (none)",
                "notes": "Transport, no A2A — high-value if tasked."}),
    # ---- Helicopters ----
    ("Ka-50",  {"name": "Ka-50",  "class": "Attack helicopter",
                "weapons": "— (Vikhr AT; some IR AA)",
                "notes": "Low-altitude attack helo — mainly a ground threat; watch low."}),
    ("Ka-52",  {"name": "Ka-52",  "class": "Attack helicopter",
                "weapons": "— (AT; some IR AA)",
                "notes": "Low-altitude attack helo — mainly a ground threat."}),
    ("Mi-24",  {"name": "Mi-24",  "class": "Attack/assault helo",
                "weapons": "— (rockets/AT; R-60 possible)",
                "notes": "Low and slow — mainly an air-to-ground threat."}),
    ("Mi-28",  {"name": "Mi-28",  "class": "Attack helicopter",
                "weapons": "— (AT; Igla)",
                "notes": "Low-altitude ground threat; some IR AA."}),
    ("Mi-8",   {"name": "Mi-8",   "class": "Transport helicopter",
                "weapons": "— (door guns)",
                "notes": "Transport helo — low/slow, minimal A2A."}),
    ("AH-64",  {"name": "AH-64",  "class": "Attack helicopter",
                "weapons": "— (Hellfire; Stinger possible)",
                "notes": "Low-altitude attack helo — primarily a ground threat."}),
]


# Recognition-silhouette family per airframe, keyed like _AIRFRAME_DB (a
# substring of the DCS type; longest match wins). Grouped by planform so one
# drawing serves a whole family — a Flanker is a Flanker. Only types we have
# artwork for map to a name; everything else stays "" and the renderer draws
# no thumbnail (better a clean row than a wrong shape). Artwork lives in
# backend/assets/aircraft/<family>.png. Expand both together.
_SILHOUETTE_DB: List[Tuple[str, str]] = [
    # ---- Flanker family (twin-tail; canard variants get the canard shape) ----
    ("Su-33", "flanker_canard"),   # navalised Flanker — canards
    ("Su-30", "flanker_canard"),   # canard Flanker variant
    ("Su-34", "flanker_canard"),   # Fullback — canards
    ("Su-37", "flanker_canard"),
    ("J-15",  "flanker_canard"),   # Chinese naval Flanker — canards
    ("Su-27", "flanker"),
    ("Su-35", "flanker"),
    ("J-11",  "flanker"),           # Chinese Flanker
    # ---- Fulcrum ----
    ("MiG-29", "fulcrum"),
    ("MiG-35", "fulcrum"),
    # ---- Frogfoot ----
    ("Su-25", "frogfoot"),
    ("Su-39", "frogfoot"),
    # ---- Foxbat / Foxhound (boxy twin-tail interceptors) ----
    ("MiG-25", "foxbat"),
    ("MiG-31", "foxbat"),
    # ---- Fishbed (tailed delta) ----
    ("MiG-21", "fishbed"),
    # ---- Flogger / Fitter (variable-sweep, single tail) ----
    ("MiG-23", "flogger"),
    ("MiG-27", "flogger"),
    ("Su-17",  "flogger"),
    ("Su-22",  "flogger"),
    # ---- Fencer (Su-24 strike) ----
    ("Su-24", "fencer"),
    # ---- Western fighters (may fly as red) ----
    ("F-15",  "eagle"),
    ("F-16",  "viper"),
    ("JF-17", "viper"),
    ("FA-18", "hornet"),
    ("F/A-18", "hornet"),
    ("F-14",  "tomcat"),
    ("M-2000", "mirage"),
    ("Mirage", "mirage"),
    ("F-4",   "phantom"),
    # ---- Bombers ----
    ("Tu-22", "backfire"),
    ("Tu-160", "backfire"),
    ("Tu-95", "bear"),
    ("Tu-142", "bear"),
    # ---- Support (transport / tanker / AWACS) ----
    ("IL-76", "candid"),
    ("IL-78", "candid"),
    ("A-50",  "mainstay"),
    # ---- Helicopters ----
    ("Ka-50", "helo_coaxial"),
    ("Ka-52", "helo_coaxial"),
    ("Mi-24", "helo_attack"),
    ("Mi-28", "helo_attack"),
    ("AH-64", "helo_attack"),
    ("Mi-8",  "helo_transport"),
    ("Mi-17", "helo_transport"),
    ("Mi-26", "helo_transport"),
    ("UH-60", "helo_transport"),
    ("UH-1",  "helo_transport"),
    ("CH-47", "helo_transport"),
    # ---- Early jets / trainers / light fighters -> generic swept fighter ----
    ("F-5",   "generic"),
    ("F-86",  "generic"),
    ("MiG-15", "generic"),
    ("MiG-17", "generic"),
    ("MiG-19", "generic"),
    ("Hawk",  "generic"),
    ("L-39",  "generic"),
    ("C-101", "generic"),
]


def _silhouette_for(dcs_type: str) -> str:
    """Recognition-silhouette family for a DCS type, or '' if we have none."""
    t = (dcs_type or "").lower()
    best, blen = "", -1
    for key, fam in _SILHOUETTE_DB:
        if key.lower() in t and len(key) > blen:
            best, blen = fam, len(key)
    return best


def _airframe_profile(dcs_type: str) -> dict:
    """Return {name, class, weapons, notes} for a DCS unit type. Longest
    substring match wins; unknown types get a generic 'verify' profile."""
    t = (dcs_type or "").lower()
    best = None
    best_len = -1
    for key, prof in _AIRFRAME_DB:
        if key.lower() in t and len(key) > best_len:
            best = prof
            best_len = len(key)
    if best:
        return best
    clean = (dcs_type or "Unknown").replace("_", " ").strip() or "Unknown"
    return {
        "name": clean,
        "class": "Unknown type",
        "weapons": "verify in mission",
        "notes": "Capabilities unknown — verify the airframe and its loadout.",
    }


def _build_air_threats(groups: List[dict], bullseye: Optional[dict] = None) -> List[Dict[str, Any]]:
    """Aggregate ENEMY aircraft by AIRFRAME TYPE across the whole mission and
    attach a capability rundown for friendly pilots — e.g. '8× Su-27' followed
    by its class, A2A weapons/WEZ, and how to fight it. The brief audience is
    blue, so only non-blue air is counted. `bullseye` is unused (kept for
    caller compatibility). Sorted by count, highest first.
    """
    from collections import Counter
    counts = Counter()
    for g in groups:
        if g.get("category") not in ("plane", "helicopter"):
            continue
        if g.get("coalition") == "blue":
            continue  # only enemy air is a threat to the blue audience
        for u in (g.get("units") or []):
            counts[u.get("type") or "Unknown"] += 1

    rows: List[AirThreatRow] = []
    for dcs_type, count in counts.most_common():
        prof = _airframe_profile(dcs_type)
        rows.append(AirThreatRow(
            composition=f"{count}× {prof['name']}",
            airframe_class=prof["class"],
            weapons=prof["weapons"],
            notes=prof["notes"],
            coalition="red",
            silhouette=_silhouette_for(dcs_type),
        ))
    return [asdict(r) for r in rows]


def _build_comms(groups: List[dict]) -> List[Dict[str, str]]:
    """Build the wing-brief comms slide.

    Per Fett's testing: don't list individual flight frequencies — that's
    handled per-flight in the Radio Presets section. The wing brief
    comms slide is the SHARED comm card: tankers, AWACS, carriers, GCI,
    AAR, guard. Things every flight needs to know about.
    """
    out: List[Dict[str, str]] = []
    seen_labels = set()

    # Tankers — list each friendly tanker by callsign. Show its real frequency
    # when the .miz has one; otherwise a dash (was rendering "0.000 MHz" for a
    # tanker with no/invalid freq). The planner can fill it in the editable
    # Comms section. Dedup by callsign so the same tanker isn't listed twice.
    for g in groups:
        if (g.get("task") or "").lower() != "refueling":
            continue
        if g.get("coalition") != "blue":
            continue  # only friendly tankers on the brief
        cs = (g.get("units") or [{}])[0].get("name") or g.get("groupName", "")
        label = f"TANKER — {_brief_callsign(cs)}"
        if label in seen_labels:
            continue
        # Freq + TACAN (mirrors the carrier row) — the tanker's TACAN is how
        # the receiver finds the track, so it belongs on the comm card next to
        # the frequency. (v1.19.152)
        info_bits = []
        f = _format_freq(g.get("frequency"))
        if f:
            info_bits.append(f"{f} MHz")
        if g.get("tacan"):
            t = g["tacan"]
            ch = f"{t.get('channel', '')}{t.get('band', '')}"
            if ch:
                info_bits.append(f"TCN {ch}")
        out.append({"label": label, "value": "  ·  ".join(info_bits) if info_bits else "—"})
        seen_labels.add(label)

    # AWACS — same pattern
    for g in groups:
        if (g.get("task") or "").lower() != "awacs":
            continue
        if g.get("coalition") != "blue":
            continue
        cs = (g.get("units") or [{}])[0].get("name") or g.get("groupName", "")
        label = f"AWACS — {_brief_callsign(cs)}"
        if label in seen_labels:
            continue
        f = _format_freq(g.get("frequency"))
        out.append({"label": label, "value": f"{f} MHz" if f else "—"})
        seen_labels.add(label)

    # Carriers — TACAN + ICLS where set; freq if available
    for g in groups:
        if g.get("category") != "ship":
            continue
        utype = ((g.get("units") or [{}])[0].get("type") or "").upper()
        if "CVN" not in utype and "CV_" not in utype and "STENNIS" not in utype \
                and "LINCOLN" not in utype and "ROOSEVELT" not in utype \
                and "VINSON" not in utype and "WASHINGTON" not in utype \
                and "TRUMAN" not in utype and "FORRESTAL" not in utype \
                and "TARAWA" not in utype:
            continue
        cs = (g.get("units") or [{}])[0].get("name") or g.get("groupName", "")
        info_bits = []
        if g.get("frequency"):
            f = _format_freq(g.get("frequency"))
            info_bits.append(f"{f} MHz")
        if g.get("tacan"):
            t = g["tacan"]
            info_bits.append(f"TCN {t.get('channel','')}{t.get('band','')}")
        if g.get("icls"):
            info_bits.append(f"ICLS {g['icls'].get('channel','')}")
        if info_bits:
            out.append({"label": f"CARRIER — {_brief_callsign(cs)}", "value": "  ·  ".join(info_bits)})

    # SOP-required slots — placeholder rows the mission maker fills in.
    # These are universal in any squadron brief; they just don't live in
    # the .miz so we surface them as edit-me prompts.
    # Standard comms slots the mission can't supply. The row stays (a squadron
    # expects to see these lines, and an SOP or the editor fills them), but the
    # value is a dash — the table convention — not "edit — add GCI freq", which
    # printed an instruction to the author onto a slide shown to aircrew.
    out.append({"label": "GCI",        "value": "—"})
    out.append({"label": "AAR Boom",   "value": "—"})
    out.append({"label": "BTW Tower",  "value": "—"})
    out.append({"label": "Approach",   "value": "—"})
    out.append({"label": "Guard",      "value": "243.000  (UHF)"})
    return out


def _collect_tankers(groups: List[dict]) -> List[Dict[str, Any]]:
    """Friendly tankers as {callsign, freq, tacan, lat, lon}.

    lat/lon come from the orbit anchor (the Orbit/Tanker waypoint, else the
    first positioned point). Used for both the editor's tanker dropdown and
    the nearest-track auto-assignment. Deduped by callsign.
    """
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for g in groups:
        if (g.get("task") or "").lower() != "refueling":
            continue
        if g.get("coalition") != "blue":
            continue
        wps = g.get("waypoints") or []
        anchor = next((w for w in wps
                       if w.get("lat") is not None
                       and re.search(r"orbit|tanker|refuel|racetrack",
                                     str(w.get("waypoint_type") or "")
                                     + str(w.get("waypoint_action") or ""),
                                     re.IGNORECASE)), None)
        anchor = anchor or next((w for w in wps if w.get("lat") is not None), None)
        cs = (g.get("units") or [{}])[0].get("name") or g.get("groupName", "")
        callsign = _brief_callsign(cs)
        if not callsign or callsign in seen:
            continue
        seen.add(callsign)
        f = _format_freq(g.get("frequency"))
        tac = ""
        if g.get("tacan"):
            t = g["tacan"]
            tac = f"{t.get('channel', '')}{t.get('band', '')}"
        out.append({
            "callsign": callsign,
            "freq": f"{f} MHz" if f else "",
            "tacan": tac,
            "lat": anchor.get("lat") if anchor else None,
            "lon": anchor.get("lon") if anchor else None,
        })
    return out


def _build_tanker_assignments(groups: List[dict]) -> List[Dict[str, str]]:
    """Auto-suggest a tanker per blue player flight — the nearest track.

    For each flight we take the tanker whose orbit anchor its route passes
    closest to (min distance over the flight's waypoints). One row per flight;
    the planner can override the tanker in the editor. Empty when no tankers
    have a positioned orbit anchor. (v1.19.153)
    """
    tankers = [t for t in _collect_tankers(groups)
               if t.get("lat") is not None and t.get("lon") is not None]
    if not tankers:
        return []
    out: List[Dict[str, str]] = []
    for g in groups:
        if not _is_player_group(g):
            continue
        wps = [w for w in (g.get("waypoints") or []) if w.get("lat") is not None]
        if not wps:
            continue
        fcs = (g.get("units") or [{}])[0].get("name") or g.get("groupName", "")
        flight = _brief_callsign(fcs)
        best, best_km = None, float("inf")
        for tk in tankers:
            d = min(_haversine_km(w["lat"], w["lon"], tk["lat"], tk["lon"]) for w in wps)
            if d < best_km:
                best_km, best = d, tk
        if best:
            out.append({
                "flight": flight,
                "tanker": best["callsign"],
                "freq": best["freq"],
                "tacan": best["tacan"],
            })
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
    popup_attacks: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Build one FlightBrief per blue player flight.

    Returns a list of plain dicts (one per flight) for round-trip
    serialization. Order matches the order player flights appear in the
    parsed mission data — that's typically the squadron's preferred order
    when groups are named alphabetically/numerically.

    `popup_attacks` is a list of frontend PopupAttackInput dicts; the same
    list is copied to every player flight's brief so each flight's standalone
    PPTX includes the appendix when downloaded individually. v1.17.8.
    """
    overview = mission_data.get("overview") or {}
    groups = mission_data.get("groups") or []
    airbases = mission_data.get("airbases") or []
    start_seconds = overview.get("start_time") or 0
    dictionary = parse_dictionary(dictionary_text)
    mission_type = _detect_mission_type(groups)

    # Mission name precedence:
    #   1. resolved sortie (real text from .miz dictionary)
    #   2. theater-specific default ("KOLA OPERATIONS", "FALKLANDS 1982")
    #   3. filename
    #   4. literal "Untitled Mission" — last resort
    # Filenames usually look like "Mission 5.2_edited_edited.miz" which
    # makes a terrible cover-slide title; the per-theater default is
    # almost always better.
    raw_sortie = overview.get("sortie") or ""
    resolved_sortie = str(resolve_dict_key(raw_sortie, dictionary)).strip()
    if resolved_sortie and not resolved_sortie.startswith("DictKey_"):
        mission_name = resolved_sortie
    else:
        mission_name = DEFAULT_MISSION_NAMES.get(theater) or filename or "Untitled Mission"

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

        # Per-flight schedule — this flight's own Takeoff / Push / TOT / Egress
        # / RTB from ITS waypoints. The wing brief's timeline is package-level;
        # this is the per-flight detail that moved here.
        ft_rows: List[TimelineRow] = []
        if wps:
            ft_rows.append(TimelineRow(
                "Takeoff", _format_zulu(_waypoint_time(wps[0], takeoff_eta, start_seconds)),
                home_plate or "Departure"))
            f_push = _find_waypoint_time(wps, ["push", "marshal", "ip"], takeoff_eta, start_seconds)
            f_tot  = _find_waypoint_time(wps, ["tgt", "target", "tot"], takeoff_eta, start_seconds)
            f_egr  = _find_waypoint_time(wps, ["egress", "egr", "fence-out", "fence out"], takeoff_eta, start_seconds)
            if f_push is not None: ft_rows.append(TimelineRow("Push", _format_zulu(f_push), "IP / start of run-in"))
            if f_tot  is not None: ft_rows.append(TimelineRow("TOT", _format_zulu(f_tot), "Time on target"))
            if f_egr  is not None: ft_rows.append(TimelineRow("Egress", _format_zulu(f_egr), "Fence out / clear of MEZ"))
            ft_rows.append(TimelineRow(
                "RTB", _format_zulu(_waypoint_time(wps[-1], takeoff_eta, start_seconds)),
                f"Divert: {divert}" if divert else (home_plate or "Recovery")))
        flight_timeline = [asdict(r) for r in ft_rows]

        # Real T/O fuel from the lead unit's loadout (DCS payload fuel is kg);
        # Joker/Bingo/RTB derive from it (35 / 20 / 13 %) like the kneeboard
        # fuel ladder. Placeholders only when the loadout carries no fuel value.
        _lead_kg = units[0].get("fuel_kg") if units else None
        if _lead_kg:
            _fuel_start = round(_lead_kg * 2.20462)
            _fuel_joker = round(_fuel_start * 0.35)
            _fuel_bingo = round(_fuel_start * 0.20)
            _fuel_rtb = round(_fuel_start * 0.13)
        else:
            _fuel_start, _fuel_joker, _fuel_bingo, _fuel_rtb = 0, 4500, 3500, 2500

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
            fuel_start_lbs=_fuel_start,
            fuel_joker_lbs=_fuel_joker,
            fuel_bingo_lbs=_fuel_bingo,
            fuel_rtb_lbs=_fuel_rtb,
            notes="",
            timeline=flight_timeline,
            group_name=g.get("groupName", ""),
            popup_attacks=list(popup_attacks or []),
        )
        out.append(asdict(brief))
    return out


# ---------------------------------------------------------------------------
# Control measures + METAR (v1.19.137)
# ---------------------------------------------------------------------------

def _fmt_ddm(lat: Optional[float], lon: Optional[float]) -> str:
    """Latitude/longitude as degrees + decimal minutes, the form the squadron
    brief uses: N71° 07.661'  E024° 29.797'."""
    if lat is None or lon is None:
        return ""
    def one(v: float, pos: str, neg: str, width: int) -> str:
        hemi = pos if v >= 0 else neg
        v = abs(v)
        d = int(v)
        m = (v - d) * 60.0
        return f"{hemi}{d:0{width}d}° {m:06.3f}'"
    return f"{one(lat, 'N', 'S', 2)}  {one(lon, 'E', 'W', 3)}"


def _latlon_to_mgrs(lat: Optional[float], lon: Optional[float]) -> str:
    if lat is None or lon is None:
        return ""
    try:
        import mgrs as _mgrs
        raw = _mgrs.MGRS().toMGRS(lat, lon, MGRSPrecision=5)
        # "35WPT1164537846" -> "35W PT 11645 37846"
        m = re.match(r"^(\d{1,2}[C-X])([A-Z]{2})(\d{5})(\d{5})$", raw)
        if m:
            return f"{m.group(1)} {m.group(2)} {m.group(3)} {m.group(4)}"
        return raw
    except Exception:
        return ""


def _build_metar(overview: dict, mission_name: str, theater: str) -> str:
    """A one-line METAR for the WX slide, styled like the squadron brief:
       METAR <STATION> <DDHHMML> <wind> <vis> <clouds> <QNH> <temp>."""
    wx = overview.get("weather")
    if not isinstance(wx, dict):
        return ""
    start = overview.get("start_time")
    date = str(overview.get("date") or "")
    dd = "  "
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", date)
    if m:
        dd = m.group(3)
    try:
        hh = int(start) // 3600
        mm = (int(start) % 3600) // 60
        stamp = f"{dd}{hh:02d}{mm:02d}L"
    except Exception:
        stamp = ""

    parts = [f"METAR {(theater or 'AO').upper()} AO", stamp]

    g = (wx.get("wind") or {}).get("atGround") or {}
    spd, dr = g.get("speed"), g.get("dir")
    if isinstance(spd, (int, float)) and isinstance(dr, (int, float)):
        kt = round(spd * 1.94384)
        parts.append("00000KT" if kt == 0 else f"{int(round(dr)) % 360:03d}{kt:02d}KT")

    vis = wx.get("visibility_m")
    if isinstance(vis, (int, float)) and vis:
        parts.append("9999" if vis >= 9999 else f"{int(vis):04d}")

    base, dens = wx.get("clouds_base_m"), wx.get("clouds_density")
    if isinstance(base, (int, float)) and isinstance(dens, (int, float)) and dens:
        cover = "FEW" if dens <= 2 else "SCT" if dens <= 4 else "BKN" if dens <= 7 else "OVC"
        parts.append(f"{cover}{int(round(base * 3.28084 / 100)):03d}")

    t = wx.get("temperature_c")
    if isinstance(t, (int, float)):
        ti = int(round(t))
        parts.append(f"M{abs(ti):02d}/" if ti < 0 else f"{ti:02d}/")

    q = wx.get("qnh_inhg")
    if isinstance(q, (int, float)):
        parts.append(f"A{int(round(q * 100)):04d}")
    return " ".join(p for p in parts if p)


def _build_weather_stats(overview: dict) -> List[Dict[str, str]]:
    """Glanceable WX cards for the weather slide: wind, vis, cloud, temp, QNH.

    Pulls the same overview.weather values _build_metar decodes, but formats
    them for a human at a glance. Keeps the weather slide from reading as a
    lonely METAR line — it becomes a proper WX board. Only cards with real
    data are returned; an empty list leaves the slide as METAR + prose.
    """
    wx = overview.get("weather")
    if not isinstance(wx, dict):
        return []
    cards: List[Dict[str, str]] = []

    g = (wx.get("wind") or {}).get("atGround") or {}
    spd, dr = g.get("speed"), g.get("dir")
    if isinstance(spd, (int, float)):
        kt = round(spd * 1.94384)
        if kt == 0:
            cards.append({"label": "WIND", "value": "CALM"})
        elif isinstance(dr, (int, float)):
            cards.append({"label": "WIND", "value": f"{int(round(dr)) % 360:03d}° / {kt} kt"})

    vis = wx.get("visibility_m")
    if isinstance(vis, (int, float)) and vis:
        cards.append({"label": "VISIBILITY",
                      "value": "10+ km" if vis >= 9999 else f"{vis / 1000:.0f} km"})

    base, dens = wx.get("clouds_base_m"), wx.get("clouds_density")
    if isinstance(base, (int, float)) and isinstance(dens, (int, float)) and dens:
        cover = "FEW" if dens <= 2 else "SCT" if dens <= 4 else "BKN" if dens <= 7 else "OVC"
        cards.append({"label": "CLOUD",
                      "value": f"{cover} {int(round(base * 3.28084)):,} ft"})

    t = wx.get("temperature_c")
    if isinstance(t, (int, float)):
        cards.append({"label": "TEMP", "value": f"{int(round(t))}°C"})

    q = wx.get("qnh_inhg")
    if isinstance(q, (int, float)):
        cards.append({"label": "QNH", "value": f"{q:.2f} inHg"})

    # Contrail floor — altitude at which the standard-atmosphere temperature
    # reaches the contrail-onset threshold, anchored on the surface temp. A
    # planning aid ("stay below to run cold"): jets above this leave persistent
    # contrails. It's an ESTIMATE — DCS's exact band shifts with humidity, and
    # CONTRAIL_ONSET_C is a single tunable constant. At ISA (15°C) it lands near
    # FL280, matching commonly-observed DCS behaviour. (v1.19.152)
    if isinstance(t, (int, float)):
        CONTRAIL_ONSET_C = -40.0          # ~Schmidt-Appleman, dry air
        LAPSE_C_PER_FT = 1.98 / 1000.0    # ISA troposphere lapse rate
        floor_ft = (float(t) - CONTRAIL_ONSET_C) / LAPSE_C_PER_FT
        if floor_ft <= 0:
            cards.append({"label": "CONTRAILS", "value": "~SFC"})  # ~ = estimate
        else:
            fl = int(round(floor_ft / 100.0 / 10.0)) * 10  # nearest FL10
            cards.append({"label": "CONTRAILS", "value": f"~FL{fl:03d}+"})

    return cards


def _build_control_measures(
    overview: dict,
    groups: List[dict],
    dmpis: Optional[List[dict]],
    theater: str,
    elevation_fn=None,
) -> List[Dict[str, str]]:
    """Build the CONTROL MEASURES table from mission reference points.

    Sources, in slide order:
      BULLSEYE      — the blue bullseye
      TARGET        — planner DMPIs (aim points)
      HOLDING AREA  — trigger zones named like a hold/marshal/CAP point
      ROZ           — other named trigger zones
      TANKER TRACK  — refuelling groups' orbit centre

    elevation_fn(lat, lon) -> feet|None fills the ELEV column; when None the
    row carries the source's own elevation or '—'.
    """
    rows: List[ControlMeasureRow] = []

    def _elev(lat, lon, own_ft=None, is_alt=False) -> str:
        # own_ft is either a ground elevation (DMPI) or a block altitude
        # (tanker track). is_alt tags the latter so it reads "26,000 FT MSL".
        if own_ft not in (None, 0, ""):
            try:
                v = int(round(float(own_ft)))
                return f"{v:,} FT{' MSL' if is_alt else ''}"
            except (TypeError, ValueError):
                pass
        if elevation_fn and lat is not None and lon is not None:
            try:
                e = elevation_fn(lat, lon)
                if isinstance(e, (int, float)):
                    ft = round(e * 3.28084)
                    # SRTM returns void/ocean garbage (-32768, deep negatives)
                    # over water; the lowest real land is the Dead Sea ~-1400.
                    if ft <= -1400:
                        return "SL"
                    return f"{ft:,} FT"
            except Exception:
                pass
        return "—"

    def _add(kind, name, lat, lon, own_ft=None, is_alt=False):
        if lat is None or lon is None:
            return
        rows.append(ControlMeasureRow(
            kind=kind, name=str(name or "").strip() or kind,
            ll=_fmt_ddm(lat, lon), mgrs=_latlon_to_mgrs(lat, lon),
            elevation=_elev(lat, lon, own_ft, is_alt)))

    # BULLSEYE (blue)
    be = (overview.get("bullseye") or {}).get("blue") or {}
    if be.get("lat") is not None:
        _add("BULLSEYE", "BULLSEYE", be.get("lat"), be.get("lon"))

    # TARGET — planner DMPIs
    for d in (dmpis or []):
        if (d.get("name") or "").strip():
            _add("TARGET", d.get("name"), d.get("lat"), d.get("lon"),
                 d.get("elevation"))

    # Trigger zones → HOLDING AREA / ROZ. Most zones in a mission are
    # scripting/sound triggers, not navigational airspace, so INCLUDE only
    # zones whose name signals real airspace and skip everything else
    # (v1.19.137 — a Caucasus mission had 17 zones, only a few navigational).
    _hold_re = re.compile(r"\b(hold|marshal|cap|orbit|anchor|wheel|push|ip)\b",
                          re.IGNORECASE)
    _roz_re = re.compile(r"\b(roz|killbox|kill\s*box|wez|mez|fez|corridor|"
                         r"station|airspace|zone\s*\d)\b", re.IGNORECASE)
    for z in (overview.get("_trigger_zones") or []):
        nm = (z.get("name") or "").strip()
        if not nm:
            continue
        if _hold_re.search(nm):
            _add("HOLDING AREA", nm, z.get("lat"), z.get("lon"))
        elif _roz_re.search(nm):
            _add("ROZ", nm, z.get("lat"), z.get("lon"))
        # else: scripting/sound/spawn zone — not a control measure, skip.

    # TANKER TRACK — refuelling groups' orbit anchor, tagged with the orbit
    # BLOCK ALTITUDE (not terrain under it — that's meaningless for a track,
    # and SRTM returns ocean garbage there anyway). Prefer the waypoint that
    # actually carries an Orbit/Tanker task; else the first positioned point.
    for g in groups:
        if (g.get("task") or "").lower() != "refueling":
            continue
        wps = g.get("waypoints") or []
        anchor = next((w for w in wps
                       if w.get("lat") is not None
                       and re.search(r"orbit|tanker|refuel|racetrack",
                                     str(w.get("waypoint_type") or "")
                                     + str(w.get("waypoint_action") or ""),
                                     re.IGNORECASE)), None)
        anchor = anchor or next((w for w in wps if w.get("lat") is not None), None)
        if anchor:
            alt_m = anchor.get("altitude_m")
            alt_ft = round(alt_m * 3.28084) if isinstance(alt_m, (int, float)) and alt_m else None
            _add("TANKER TRACK", g.get("groupName") or "TANKER",
                 anchor.get("lat"), anchor.get("lon"), own_ft=alt_ft, is_alt=True)

    return [asdict(r) for r in rows]


# ---------------------------------------------------------------------------
# Package timeline ladder (v1.19.137) — a Gantt of when each flight pushes,
# hits its action point (TOT / on-station), and recovers.
# ---------------------------------------------------------------------------

_ACTION_WP_RE = re.compile(
    r"tgt|target|ip\b|tot|cap|station|strike|attack|push|marshal|anchor|"
    r"vul|onsta|hold", re.IGNORECASE)


def _build_package_timeline(groups: List[dict],
                            start_seconds: Optional[float]) -> List[Dict[str, Any]]:
    """One ladder row per blue player flight: push / action / recovery times.

    Times are Zulu HHMM labels plus minute offsets from the package's first
    push, which the renderer uses to place the bars on a shared axis.
    """
    base = int(start_seconds) if isinstance(start_seconds, (int, float)) else 0

    rows: List[Dict[str, Any]] = []
    for g in groups:
        if not _is_player_group(g):
            continue
        wps = g.get("waypoints") or []
        timed = [w for w in wps if w.get("cumulative_eta") is not None]
        if len(timed) < 2:
            continue
        push_s = float(timed[0].get("cumulative_eta") or 0)
        land_s = float(timed[-1].get("cumulative_eta") or 0)
        # Action point: the named waypoint that reads like a target / station /
        # IP; else the highest-index interior waypoint (the turn deepest into
        # the route). Falls back to the route midpoint.
        action = None
        for w in timed[1:-1]:
            if _ACTION_WP_RE.search(str(w.get("waypoint_name") or "")
                                    + str(w.get("waypoint_type") or "")):
                action = w
                break
        if action is None and len(timed) > 2:
            action = timed[len(timed) // 2]
        act_s = float(action.get("cumulative_eta")) if action else (push_s + land_s) / 2

        units = g.get("units") or []
        callsign = (units[0].get("name") if units else "") or g.get("groupName", "")
        rows.append({
            "callsign": callsign,
            "role": _infer_role_from_task(g.get("task", "")),
            "push_z": _format_zulu(base + push_s),
            "tot_z": _format_zulu(base + act_s),
            "land_z": _format_zulu(base + land_s),
            "push_min": round(push_s / 60.0, 1),
            "tot_min": round(act_s / 60.0, 1),
            "land_min": round(land_s / 60.0, 1),
        })

    # Sort by push time so the ladder reads top-to-bottom in launch order.
    rows.sort(key=lambda r: (r["push_min"], r["callsign"]))
    return rows


def _default_roe() -> Dict[str, Any]:
    """A standard, editable ROE template. ROE isn't carried in the .miz, so
    every brief seeds this starter page and the mission maker tailors it.
    Wording follows a common exercise ROE (declared-hostile weapons control,
    numbered hostile-act / hostile-intent / SAM lines, no-fire conditions)."""
    return {
        "weapons_status": "WEAPONS TIGHT",
        "threat_posture": "YELLOW",
        "fire_authority": (
            "Weapons may be fired only at contacts positively identified or "
            "declared HOSTILE in accordance with mission ROE."),
        "hostile_authority": "MISSION COMMANDER",
        "hostile_criteria": [
            {"code": "01", "category": "HOSTILE ACT",
             "text": "Aircraft fires on, launches against, or damages friendly assets."},
            {"code": "01c", "category": "HOSTILE INTENT",
             "text": "Aircraft manoeuvres into a position indicating imminent "
                     "weapons employment against friendly assets."},
            {"code": "11", "category": "SAM THREAT",
             "text": "SAM fire-control radar lock greater than 5 seconds on "
                     "friendly assets, or a SAM launch on friendly assets."},
            {"code": "12a", "category": "SAM THREAT",
             "text": "Emitting SAM site declared hostile when it engages or "
                     "locks friendly aircraft inside its lethal range."},
        ],
        "nofire": [
            "Do not fire on unidentified aircraft.",
            "Do not fire into neutral airspace unless cleared.",
            "Do not pursue across restricted borders without mission-commander approval.",
            "Do not fire through friendly formations.",
            "Do not release CAS ordnance without JTAC clearance unless in self-defence.",
            "Do not attack civilian or non-military vehicles.",
        ],
        "abort": (
            "Abort or disengage if fuel state, weather, comms, ROE uncertainty, "
            "battle damage, or package deconfliction prevents safe continuation."),
    }


def _compute_ao_center(groups: List[dict], threats: List[dict],
                       overview: dict) -> Optional[Dict[str, Any]]:
    """Frame the operating area for the satellite background.

    Collects lat/lon from the blue player flights' waypoints and from the
    surface threats — the route and what it flies against — and falls back to
    the blue bullseye. Returns {lat, lon, span_km} centred on the bounding box,
    with span padded so the imagery shows context around the action, or None
    when nothing carries coordinates (the renderer then stays flat-dark).
    """
    pts: List[Tuple[float, float]] = []

    for g in groups:
        if not _is_player_group(g) or g.get("coalition") != "blue":
            continue
        for wp in (g.get("waypoints") or []):
            la, lo = wp.get("lat"), wp.get("lon")
            if la is not None and lo is not None:
                pts.append((float(la), float(lo)))

    for t in (threats or []):
        la, lo = t.get("lat"), t.get("lon")
        if la is not None and lo is not None:
            pts.append((float(la), float(lo)))

    if not pts:
        be = (overview.get("bullseye") or {}).get("blue") or {}
        if be.get("lat") is not None and be.get("lon") is not None:
            return {"lat": float(be["lat"]), "lon": float(be["lon"]),
                    "span_km": 160.0}
        return None

    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    lat_c = (min(lats) + max(lats)) / 2.0
    lon_c = (min(lons) + max(lons)) / 2.0

    # Bounding-box extent in km (equirectangular is plenty at AO scale).
    import math as _m
    h_km = (max(lats) - min(lats)) * 110.57
    w_km = (max(lons) - min(lons)) * 111.32 * _m.cos(_m.radians(lat_c))
    span = max(h_km, w_km) * 1.35  # pad so the action isn't edge-to-edge
    span = max(45.0, min(650.0, span))
    return {"lat": lat_c, "lon": lon_c, "span_km": round(span, 1)}


def _build_target_imagery(dmpis: Optional[List[dict]],
                          elevation_fn=None) -> List[Dict[str, Any]]:
    """One target-imagery entry per placed DMPI (aim point).

    lat/lon stay numeric so the renderer can fetch a satellite close-up
    centred there; ll/mgrs/elev/weapon are preformatted for the data strip.
    Elevation prefers the authoritative terrain lookup (elevation_fn), which
    sidesteps the unit ambiguity of a DMPI's own stored elevation.
    """
    out: List[Dict[str, Any]] = []
    for d in (dmpis or []):
        lat, lon = d.get("lat"), d.get("lon")
        if lat is None or lon is None:
            continue
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            continue

        elev = "—"
        if elevation_fn:
            try:
                e = elevation_fn(lat, lon)
                if isinstance(e, (int, float)):
                    ft = round(e * 3.28084)
                    elev = "SL" if ft <= -1400 else f"{ft:,} FT"
            except Exception:
                pass
        if elev == "—":  # fall back to the DMPI's own elevation (feet, as the
            own = d.get("elevation")  # control-measures table treats it)
            if isinstance(own, (int, float)) and own not in (0,):
                elev = f"{int(round(float(own))):,} FT"

        out.append({
            "name": (d.get("name") or "DMPI").strip() or "DMPI",
            "lat": lat, "lon": lon,
            "ll": _fmt_ddm(lat, lon),
            "mgrs": _latlon_to_mgrs(lat, lon),
            "elev": elev,
            "weapon": (d.get("weaponDelivery") or d.get("weapon")
                       or d.get("weapon_delivery") or "").strip(),
            "description": (d.get("description") or "").strip(),
            "detail": bool(d.get("detail") or d.get("detailZoom")),
        })
    return out


def build_wing_brief(
    *,
    mission_data: dict,
    theater: str,
    filename: str,
    dictionary_text: Optional[str] = None,
    popup_attacks: Optional[List[Dict[str, Any]]] = None,
    dmpis: Optional[List[dict]] = None,
    elevation_fn=None,
) -> Dict[str, Any]:
    """Build a complete WingBrief from parsed mission data.

    Args:
      mission_data: output of services.miz_parser.extract_full_mission_data
      theater: theater name (e.g. "Caucasus")
      filename: original .miz filename, used as a fallback mission_name
      dictionary_text: raw text of the .miz's l10n/DEFAULT/dictionary file,
        used to resolve DictKey_* references. Optional — falls back to
        showing the raw key if not provided.
      popup_attacks: optional list of PopupAttackInput dicts from the
        Kneeboard tab. When non-empty, the renderer emits a POPUP ATTACK
        slide with one row per profile. Schema is the frontend's
        PopupAttackInput shape (attackType, name, targetElevationFt, etc.);
        the renderer is permissive about missing fields.

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
    # Stash trigger zones onto overview so _build_control_measures can read
    # them without widening its signature (they live at mission_data top level).
    overview = {**overview, "_trigger_zones": mission_data.get("triggerZones") or []}

    # Mission name precedence: resolved sortie → unresolved sortie literal
    # → filename → "Untitled Mission". Some .miz files have a sortie DictKey
    # that resolves to an empty string (placeholder set but never authored);
    # those should fall through to the filename rather than show blank.
    # Mission name precedence: resolved sortie → theater default → filename
    # → "Untitled Mission". See DEFAULT_MISSION_NAMES for per-theater values.
    raw_sortie = overview.get("sortie") or ""
    resolved_sortie = str(resolve_dict_key(raw_sortie, dictionary)).strip()
    if resolved_sortie and not resolved_sortie.startswith("DictKey_"):
        mission_name = resolved_sortie
    else:
        mission_name = DEFAULT_MISSION_NAMES.get(theater) or filename or "Untitled Mission"

    # Build the structured tables first: the scenario narrates from the threat
    # rows, and the mission flow is derived from the timeline.
    _timeline = _build_timeline(start_seconds, groups, _detect_mission_type(groups))
    _threat_rows = _build_threats(threats, overview.get("bullseye"))
    _air_rows = _build_air_threats(groups, overview.get("bullseye"))

    brief = WingBrief(
        mission_name=str(mission_name),
        theater=theater,
        date=overview.get("date") or "",
        time_zulu=_format_zulu(start_seconds),
        coalition="blue",

        theatre_overview=_build_theatre_overview(theater),
        scenario=_build_scenario(overview, dictionary, groups=groups, threats=threats,
                                 theater=theater, threat_rows=_threat_rows, air_rows=_air_rows),
        commanders_intent=_build_commanders_intent(groups),
        mission_flow=_build_mission_flow(_timeline, groups),
        weather_brief=_narrate_weather(overview.get("weather"), start_seconds),
        notes="",

        timeline=_timeline,
        threats=_threat_rows,
        air_threats=_air_rows,
        flights=_build_flights(groups, airbases),

        comms=_build_comms(groups),
        popup_attacks=list(popup_attacks or []),
        control_measures=_build_control_measures(
            overview, groups, dmpis, theater, elevation_fn=elevation_fn),
        metar=_build_metar(overview, str(mission_name), theater),
        package_timeline=_build_package_timeline(groups, start_seconds),
        roe=_default_roe(),
        ao_center=_compute_ao_center(groups, threats, overview),
        weather_stats=_build_weather_stats(overview),
        target_imagery=_build_target_imagery(dmpis, elevation_fn=elevation_fn),
        tankers=[{"callsign": t["callsign"], "freq": t["freq"], "tacan": t["tacan"]}
                 for t in _collect_tankers(groups)],
        tanker_assignments=_build_tanker_assignments(groups),
    )
    return asdict(brief)
