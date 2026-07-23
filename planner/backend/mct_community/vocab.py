"""
Controlled vocabularies for MCT Community Standards v2.0.0.

Every list here is transcribed from the PUBLISHED SCHEMA
(mct_community/schemas/*.schema.json), not from the MCTUtils C# README.

  The README is wrong about two REQUIRED asset enums:
    flight_oversight  README says VFR/IFR/SVFR      -> schema says Public/Restricted/Classified
    flight_type       README says Scheduled/...     -> schema says S/N/G/M/X
  Coding from the README produces documents that fail validation.

Unit conventions in the standard: WGS-84 decimal degrees, feet, knots,
seconds-since-midnight-UTC. DCS gives us metres, m/s and its own vocab,
so every DCS->standard hop goes through this module.
"""

from __future__ import annotations

# --------------------------------------------------------------------------
# Legal enum values (verbatim from the schema)
# --------------------------------------------------------------------------

COALITION = ("BLUE", "RED", "NEUTRAL", "OTHER")
CONTROL_TYPE = ("Human", "AI", "Unknown")
FLIGHT_TYPE = ("S", "N", "G", "M", "X")          # ICAO: sched/non-sched/general/military/other
FLIGHT_RULES = ("I", "V", "Y", "Z")              # IFR / VFR / SVFR / VFR-on-top
FLIGHT_OVERSIGHT = ("Public", "Restricted", "Classified")
ALTITUDE_REF = ("MSL", "AGL", "FL")
SPEED_TYPE = ("IAS", "TAS", "CAS", "EAS", "GS", "MACH")
MODULATION = ("AM", "FM", "HF", "UHF", "VHF")
AIRFIELD_TYPE = ("ICAO", "CARRIER", "ROAD_BASE", "FARP", "CUSTOM")
COMMS_ROLE = ("ASSET", "ATC", "AWACS", "FAC", "GCI", "JTAC", "OTHER", "PACKAGE", "TANKER")
SURFACE = ("ASPHALT", "CONCRETE", "GRAVEL", "DIRT", "GRASS", "ICE", "OTHER")

# Flight-member roles. The README claims LEAD/WINGMAN/SPARE; the schema
# actually models element structure, which is what a real 4-ship needs.
FLIGHT_MEMBER_ROLE = ("LEAD", "WING", "ELEMENT_LEAD", "ELEMENT_WING", "SOLO")


def flight_position(index: int, flight_size: int) -> str:
    """Standard fighter flight positions from a zero-based index.

    A four-ship splits into two elements: -1 lead, -2 wing, -3 element
    lead, -4 element wing. A singleton is SOLO rather than a lone LEAD.
    Anything beyond four repeats the wing role.
    """
    if flight_size <= 1:
        return "SOLO"
    return {0: "LEAD", 1: "WING", 2: "ELEMENT_LEAD", 3: "ELEMENT_WING"}.get(index, "WING")

MISSION_TYPE = (
    "AAR", "AI", "Airlift", "AIRMOBILE", "AMBUSHCAP", "ASUW", "ASW", "AWACS",
    "BAI", "BARCAP", "CAP", "CAS", "CAS_ON_CALL", "DCA", "DEAD", "ESCORT",
    "FAC(A)", "HAVCAP", "NUCLEAR", "INTERDICTION", "INTERCEPT", "OCA_STRIKE",
    "RESCAP", "RECON", "SEAD", "STEALTH", "STRIKE", "TARCAP", "TASMO",
    "TRAINING", "TRANSPORT", "OTHER",
)

WAYPOINT_TYPE = (
    "ARRIVAL", "BINGO", "BULLSEYE", "CP", "CUSTOM", "DEPARTURE", "DIVERT",
    "EGRESS", "FENCE_IN", "FENCE_OUT", "FLYBY", "FLYOVER", "HAZARD", "HOLDING",
    "IP", "MARKPOINT", "PUSH", "REFUEL", "TURNAROUND", "TGT", "TCP",
)

# --------------------------------------------------------------------------
# Unit conversion
# --------------------------------------------------------------------------

M_TO_FT = 3.280839895
MPS_TO_KTS = 1.943844492
MMHG_TO_HPA = 1.33322


def m_to_ft(m):
    return None if m is None else round(float(m) * M_TO_FT, 1)


def mps_to_kts(mps):
    return None if mps is None else round(float(mps) * MPS_TO_KTS, 1)


# --------------------------------------------------------------------------
# Theatre names: DCS internal id -> MCT theatre string
# --------------------------------------------------------------------------

THEATRE_MAP = {
    "Caucasus": "Caucasus",
    "Syria": "Syria",
    "PersianGulf": "PersianGulf",
    "Nevada": "Nevada",
    "SinaiMap": "Sinai",
    "Normandy": "Normandy",
    "TheChannel": "TheChannel",
    "MarianaIslands": "Marianas",
    "Falklands": "SouthAtlantic",
    "Kola": "Kola",
    "Afghanistan": "Afghanistan",
    "Iraq": "Iraq",
    "TopEndAustralia": "TopEndAustralia",
    "SouthEastAsia": "SouthEastAsia",
    "GermanyCW": "GermanyCW",
}


def theatre(dcs_theater: str) -> str:
    return THEATRE_MAP.get(dcs_theater, dcs_theater)


# --------------------------------------------------------------------------
# Coalition
# --------------------------------------------------------------------------

_COALITION_MAP = {
    "blue": "BLUE",
    "red": "RED",
    "neutral": "NEUTRAL",
    "neutrals": "NEUTRAL",
}


def coalition(side: str) -> str:
    return _COALITION_MAP.get(str(side).strip().lower(), "OTHER")


# --------------------------------------------------------------------------
# Airframe: DCS type id -> human designation
# The schema takes a free string, so an unmapped type passes through
# unchanged rather than being dropped.
# --------------------------------------------------------------------------

AIRFRAME_MAP = {
    "FA-18C_hornet": "F/A-18C",
    "F-16C_50": "F-16CM",
    "F-15ESE": "F-15E",
    "F-15C": "F-15C",
    "F-14B": "F-14B",
    "F-14A-135-GR": "F-14A",
    "A-10C": "A-10C",
    "A-10C_2": "A-10C II",
    "AV8BNA": "AV-8B",
    "M-2000C": "Mirage 2000C",
    "Mirage-F1CE": "Mirage F1CE",
    "JF-17": "JF-17",
    "AJS37": "AJS 37",
    "Su-25T": "Su-25T",
    "Su-27": "Su-27",
    "Su-33": "Su-33",
    "MiG-29S": "MiG-29S",
    "MiG-21Bis": "MiG-21bis",
    "AH-64D_BLK_II": "AH-64D",
    "UH-1H": "UH-1H",
    "Mi-8MT": "Mi-8MTV2",
    "SA342M": "SA342M",
    "Ka-50_3": "Ka-50 III",
    "CH-47Fbl1": "CH-47F",
    "Hercules": "C-130J",
    "KC-135": "KC-135",
    "KC135MPRS": "KC-135 MPRS",
    "S-3B Tanker": "S-3B",
    "E-3A": "E-3A",
    "E-2D": "E-2D",
    "IL-78M": "IL-78M",
    "A-50": "A-50",
    "B_737": "B737",
    "A_320": "A320",
    "A_330": "A330",
    "B_747": "B747",
    "B_757": "B757",
    "Cessna_210N": "C210",
}


def airframe(dcs_type: str) -> str:
    if not dcs_type:
        return "UNKNOWN"
    return AIRFRAME_MAP.get(dcs_type, dcs_type)


# --------------------------------------------------------------------------
# Mission type: DCS group task -> MCT mission_type
# DCS only carries a coarse task string, so this is a lossy widening.
# Callers with better information (a squadron SOP, a brief) should override.
# --------------------------------------------------------------------------

_TASK_MAP = {
    "cas": "CAS",
    "sead": "SEAD",
    "cap": "CAP",
    "fighter sweep": "OCA_STRIKE",
    "intercept": "INTERCEPT",
    "escort": "ESCORT",
    "ground attack": "BAI",
    "pinpoint strike": "STRIKE",
    "runway attack": "OCA_STRIKE",
    "antiship strike": "ASUW",
    "anti-ship strike": "ASUW",
    "awacs": "AWACS",
    "refueling": "AAR",
    "transport": "TRANSPORT",
    "reconnaissance": "RECON",
    "afac": "FAC(A)",
    "training": "TRAINING",
    "nothing": "OTHER",
}


def mission_type(dcs_task: str, default: str = "OTHER") -> str:
    if not dcs_task:
        return default
    return _TASK_MAP.get(str(dcs_task).strip().lower(), default)


# --------------------------------------------------------------------------
# Waypoint type: DCS waypoint type/action -> MCT waypoint type
#
# DCS's own vocabulary only describes *how the AI flies the point*
# (Turning Point / Fly Over Point / Land), never its tactical role. The
# tactical role is what the standard wants, so we combine the DCS action
# with a name heuristic - the same approach brief_builder.py already uses
# to label legs.
# --------------------------------------------------------------------------

_WP_ACTION_MAP = {
    "takeoff": "DEPARTURE",
    "takeofffromrunway": "DEPARTURE",
    "takeoffparking": "DEPARTURE",
    "takeoffparkinghot": "DEPARTURE",
    "takeoffgroundhot": "DEPARTURE",
    "takeoffground": "DEPARTURE",
    "fromparkingarea": "DEPARTURE",
    "fromparkingareahot": "DEPARTURE",
    "fromrunway": "DEPARTURE",
    "landing": "ARRIVAL",
    "land": "ARRIVAL",
    "landingrefuar": "REFUEL",
    "flyoverpoint": "FLYOVER",
    "turningpoint": "FLYBY",
}

# Ordered: first hit wins, so put the specific words before the loose ones.
_WP_NAME_HINTS = (
    ("fence in", "FENCE_IN"),
    ("fence-in", "FENCE_IN"),
    ("fencein", "FENCE_IN"),
    ("fence out", "FENCE_OUT"),
    ("fence-out", "FENCE_OUT"),
    ("fenceout", "FENCE_OUT"),
    ("bullseye", "BULLSEYE"),
    ("bulls", "BULLSEYE"),
    ("tanker", "REFUEL"),
    ("refuel", "REFUEL"),
    ("aar", "REFUEL"),
    ("texaco", "REFUEL"),
    ("arco", "REFUEL"),
    ("shell", "REFUEL"),
    ("divert", "DIVERT"),
    ("alternate", "DIVERT"),
    ("bingo", "BINGO"),
    ("egress", "EGRESS"),
    ("egr", "EGRESS"),
    ("ingress", "IP"),
    ("push", "PUSH"),
    ("holding", "HOLDING"),
    ("hold", "HOLDING"),
    ("marshal", "HOLDING"),
    ("cp", "CP"),
    ("contact point", "CP"),
    ("target", "TGT"),
    ("tgt", "TGT"),
    ("dmpi", "TGT"),
    ("strike", "TGT"),
    ("ip", "IP"),
    ("initial point", "IP"),
    ("hazard", "HAZARD"),
    ("threat", "HAZARD"),
    ("markpoint", "MARKPOINT"),
    ("mark", "MARKPOINT"),
)


def waypoint_type(dcs_type: str = "", dcs_action: str = "", name: str = "") -> str:
    """Best-effort classification of a DCS waypoint into the MCT enum.

    Precedence: an explicit DCS action (takeoff/landing) is authoritative,
    because those are structural. Otherwise fall back to a name heuristic,
    then to a generic FLYBY/FLYOVER from the DCS point type.
    """
    act = str(dcs_action or "").strip().lower().replace(" ", "")
    if act in _WP_ACTION_MAP:
        return _WP_ACTION_MAP[act]

    n = str(name or "").strip().lower()
    if n:
        for needle, wp in _WP_NAME_HINTS:
            if needle in n:
                return wp

    t = str(dcs_type or "").strip().lower().replace(" ", "")
    if t in _WP_ACTION_MAP:
        return _WP_ACTION_MAP[t]
    return "CUSTOM"


# --------------------------------------------------------------------------
# Modulation. DCS stores 0 = AM, 1 = FM.
# --------------------------------------------------------------------------

def modulation(value) -> str:
    if isinstance(value, str):
        v = value.strip().upper()
        return v if v in MODULATION else "AM"
    return "FM" if int(value or 0) == 1 else "AM"


# --------------------------------------------------------------------------
# Control type from a DCS unit skill.
# --------------------------------------------------------------------------

def control_type(skills) -> str:
    """'Human' if any unit in the group is a player/client slot."""
    if isinstance(skills, str):
        skills = [skills]
    for s in skills or ():
        if str(s).strip().lower() in ("client", "player"):
            return "Human"
    return "AI" if skills else "Unknown"
