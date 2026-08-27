"""PKT intelligence packet — assembled from the same mission data as the brief.

A PKT (intel packet) is the classified hand-out a flight lead gets alongside
the brief (the sign-up sheet's "INTL PACKET" column). It carries the order of
battle and, above all, RECOGNITION + how-to-fight: one card per enemy airframe
type and per surface-threat type, so aircrew can ID and defeat what they meet.

This module builds the packet's data; services/pkt_renderer.py draws it.
Recognition art is the in-house silhouette library (copyright-safe), the same
one the brief's air-threats slide uses.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from services.brief_builder import (
    _build_air_threats, _build_threats, _build_flights, _silhouette_for,
    _sam_family, _format_zulu, DEFAULT_MISSION_NAMES,
)

# --------------------------------------------------------------------------
# Per-airframe A2A tactics ("how to fight it"). Keyed by a substring of the
# canonical airframe name (longest match wins), so "MiG-29S" -> MiG-29. Each
# is a short list of intel bullets in the PKT recognition-card voice.
# --------------------------------------------------------------------------
_AIR_TTP: List[tuple] = [
    ("Su-33", ["A2A: R-27ER/ET (BVR) · R-73 + helmet sight (WVR)",
               "Naval Flanker — heavy, long legs, canards; strong sustained turn",
               "Premier BVR threat with numbers — respect the R-27ER timeline",
               "Fight it: stay BVR; only merge with an energy/number advantage"]),
    ("Su-27", ["A2A: R-27ER/ET (BVR, big motor) · R-73 + helmet sight (WVR)",
               "Big radar, long detection; excellent sustained turn & energy",
               "Long legs — persistent, will re-engage",
               "Fight it: don't take a BVR fight you can't win; deny the merge"]),
    ("Su-35", ["A2A: R-77 / R-27ER (BVR) · R-73 + helmet sight (WVR)",
               "Thrust-vectoring — exceptional low-speed/high-alpha; huge radar",
               "The most dangerous Flanker — avoid the phone booth entirely",
               "Fight it: kill it BVR or don't engage; never go slow with it"]),
    ("MiG-29", ["A2A: R-77 / R-27ER (BVR) · R-73 + helmet sight (WVR)",
                "Excellent instantaneous turn; high-off-boresight IR missiles",
                "Very dangerous at the merge — respect the R-73 / HMS",
                "Fuel-limited — shorter engagements than a Flanker",
                "Fight it: deny the merge, stay BVR, don't go one-circle"]),
    ("MiG-31", ["A2A: R-33 SARH long-range (~60 NM) · R-40T IR",
                "Very fast / very high; poor turner; carries no gun",
                "Fight it: beam or drag the R-33, then force a turning fight"]),
    ("MiG-25", ["A2A: R-40 (BVR, dated) · R-60 (WVR)",
                "Very fast / very high, but a poor turner",
                "Fight it: out-turn it — don't try to out-run it"]),
    ("MiG-23", ["A2A: R-24 / R-23 (BVR, dated) · R-60 (WVR)",
                "Variable-sweep; fast in a straight line, poor turner",
                "Fight it: beat it in a sustained turning fight"]),
    ("MiG-21", ["A2A: R-60 / R-3 (short-range IR) — WVR only, no BVR",
                "Excellent acceleration & climb, high T/W; corner ~360 KIAS",
                "Fuel-restricted — short engagement times",
                "Small, low-RCS — hard to see; fight it: use BVR, don't bleed"]),
    ("Su-24", ["A2A: none of note — R-60 self-defense at best",
               "Variable-sweep strike aircraft — a striker, not a fighter",
               "Fight it: high-value; intercept before weapons release"]),
    ("Su-25", ["A2A: R-60 self-defense only — minimal air threat",
               "Low/slow ground-attack — a CAS problem, not an air one",
               "Fight it: it's a surface threat; watch the low block"]),
    ("J-11", ["A2A: R-77 / PL-12 (active BVR) · R-73 (WVR)",
              "Chinese Flanker — modern active BVR plus Flanker agility",
              "Fight it: treat as a Su-27 with AMRAAM-class missiles"]),
    ("F-15", ["A2A: AIM-120 (active BVR) · AIM-7 · AIM-9",
              "Premier BVR threat — AMRAAM + big radar",
              "Fight it: don't take a BVR fight you can't win"]),
    ("F-16", ["A2A: AIM-120 (active BVR) · AIM-9",
              "AMRAAM shooter, very agile WVR — dangerous in both regimes",
              "Fight it: respect the AMRAAM timeline; deny the merge"]),
    ("F-14", ["A2A: AIM-54 Phoenix (very long range) · AIM-7 · AIM-9",
              "Phoenix = extreme-range shots — respect the AIM-54 timeline",
              "Fight it: defeat the 54 early; strong BVR platform"]),
    ("F/A-18", ["A2A: AIM-120 · AIM-7 · AIM-9 (+ HMS)",
                "AMRAAM + excellent WVR — dangerous in both regimes",
                "Fight it: deny the merge, respect the AMRAAM"]),
    ("M-2000", ["A2A: Super 530D (SARH BVR) · Magic II (WVR)",
                "Agile delta; semi-active BVR only",
                "Fight it: force the 530 into the notch; capable WVR"]),
    ("F-4", ["A2A: AIM-7 (BVR, dated) · AIM-9 (WVR)",
             "Dated BVR but the AIM-7 still bites; smoky/visible",
             "Fight it: out-turn it; respect the Sparrow"]),
    ("F-5", ["A2A: AIM-9P (short IR) · guns — WVR only",
             "Small and agile, hard to spot; no BVR threat",
             "Fight it: beat it BVR; respect the sustained turn"]),
    ("Tu-", ["A2A: none — stand-off missile carrier",
             "Strategic bomber — high-value; may launch from range",
             "Fight it: intercept before launch; no defensive A2A"]),
    ("A-50", ["A2A: none — AEW&C",
              "Enemy AWACS — feeds their fighters the picture",
              "Fight it: killing it blinds their intercepts; high-value"]),
    ("E-3", ["A2A: none — AEW&C",
             "Enemy AWACS — high-value; kill it to blind their fighters"]),
    ("IL-78", ["A2A: none — tanker",
               "Denies their fighters fuel/persistence; high-value"]),
]


def _air_ttp(name: str) -> List[str]:
    t = (name or "").lower()
    best, blen = None, -1
    for key, bullets in _AIR_TTP:
        if key.lower() in t and len(key) > blen:
            best, blen = bullets, len(key)
    return best or ["Capabilities unknown — verify airframe and loadout.",
                    "Fight it: treat as hostile; ID before committing."]


# --------------------------------------------------------------------------
# Per-SAM defeat tactics. Keyed by the short designation _sam_family returns
# (SA-10, SA-6, ...). WEZ figures are the planner's own (SAM range table).
# --------------------------------------------------------------------------
_SAM_TACTICS: Dict[str, List[str]] = {
    "SA-10": ["Strategic, long-range area defence — must be suppressed or avoided",
              "High-altitude reach; terrain-masking gives little relief up close",
              "Defeat: stand off outside the ring, SEAD/DEAD, or route around"],
    "SA-5": ["Very-long-range, high-altitude — a stand-off / high-flyer threat",
             "Poor against low, manoeuvring targets",
             "Defeat: stay low or well outside; break lock on launch"],
    "SA-2": ["Medium-high altitude; big, visible missile",
             "Defeat: notch/beam, terrain-mask, or out-manoeuvre the launch"],
    "SA-3": ["Low-to-medium altitude point defence, short-legged",
             "Defeat: stay outside the ring or mask on terrain"],
    "SA-6": ["Tactical, mobile — the classic mover you SEAD first",
             "Defeat: notch the CW, terrain-mask, react to the launch"],
    "SA-11": ["Tactical, mobile, self-contained — quick reaction",
              "Defeat: notch, terrain-mask; pre-emptive SEAD on known sites"],
    "SA-15": ["SHORAD, very quick reaction — dangerous at low altitude",
              "Defeat: stay above its ceiling / outside the ring; don't loiter low"],
    "SA-13": ["SHORAD IR — short-range, heat-seeking",
              "Defeat: stay high and fast; flares on the low block"],
    "SA-19": ["Gun + short-range SAM (Tunguska) — lethal low and close",
              "Defeat: stay above ~10k over it; do not overfly"],
    "SA-8": ["SHORAD, mobile — short reach",
             "Defeat: stay outside/above; react to launch"],
    "SA-9": ["SHORAD IR — short-range",
             "Defeat: stay high; flares low"],
    "SA-19/SA-15": ["SHORAD — quick, low", "Defeat: don't loiter low"],
    "Hawk": ["Medium-range Western SAM (may appear as red)",
             "Defeat: stand off or SEAD; notch the illuminator"],
    "Patriot": ["Long-range Western SAM — strategic reach",
                "Defeat: stand off outside the ring; SEAD/DEAD"],
    "ZSU-23": ["Radar AAA (Shilka) — lethal low and close, no missile",
               "Defeat: stay above ~10,000 ft over it; never overfly low"],
    "ZU-23": ["Optical/AAA — low-altitude gun threat",
              "Defeat: stay high; deny low overflight"],
    "AAA": ["Anti-aircraft artillery — low-altitude gun threat",
            "Defeat: stay above its effective ceiling"],
}


def _sam_tactics(name: str) -> List[str]:
    short, _tier = _sam_family(name or "")
    return _SAM_TACTICS.get(short, [
        "Surface-to-air threat — verify type and range ring",
        "Defeat: avoid the WEZ, terrain-mask, or suppress"])


def build_pkt(*, mission_data: dict, theater: str, filename: str,
              marking: str = "TOP SECRET // REL TO COALITION",
              decl_on: str = "") -> Dict[str, Any]:
    """Assemble a PKT intel packet from parsed mission data."""
    overview = mission_data.get("overview") or {}
    groups = mission_data.get("groups") or []
    threats = mission_data.get("threats") or []
    airbases = mission_data.get("airbases") or []
    bullseye = overview.get("bullseye")

    mission_name = (DEFAULT_MISSION_NAMES.get(theater) or filename
                    or "Untitled Mission")

    # --- Enemy air: one recognition entry per airframe TYPE, with TTPs ---
    air_rows = _build_air_threats(groups, bullseye)
    air: List[Dict[str, Any]] = []
    for a in air_rows:
        if (a.get("coalition") or "red") == "blue":
            continue
        comp = a.get("composition") or ""
        m = re.match(r"\s*(\d+)\s*[x×]\s*(.+)", comp)
        count = m.group(1) if m else ""
        name = (m.group(2) if m else comp).strip()
        air.append({
            "name": name,
            "reporting": _reporting_name(name, a.get("airframe_class") or ""),
            "role": a.get("airframe_class") or "",
            "count": count,
            "weapons": a.get("weapons") or "",
            "silhouette": a.get("silhouette") or _silhouette_for(name),
            "ttps": _air_ttp(name),
        })

    # --- Surface threats: one entry per SAM TYPE, with WEZ + defeat tactics ---
    thr_rows = _build_threats(threats, bullseye)
    seen = set()
    surface: List[Dict[str, Any]] = []
    for t in thr_rows:
        comp = t.get("composition") or t.get("name") or ""
        short, tier = _sam_family(comp)
        if short in seen:
            continue
        seen.add(short)
        surface.append({
            "name": short,
            "tier": (t.get("tier") or tier or "").upper(),
            "wez": t.get("range_nm"),
            "composition": comp,
            "tactics": _sam_tactics(comp),
        })

    return {
        "packet_id": _packet_id(mission_name),
        "marking": marking or "TOP SECRET // REL TO COALITION",
        "decl_on": decl_on or "",
        "mission_name": str(mission_name),
        "theater": theater,
        "date": overview.get("date") or "",
        "time_zulu": _format_zulu(overview.get("start_time")),
        "ao_center": _ao_center(mission_data),
        "friendly": _friendly_oob(groups, airbases),
        "air_threats": air,
        "surface_threats": surface,
    }


def _reporting_name(name: str, cls: str) -> str:
    """Best-effort NATO reporting name from the type / class string."""
    t = (name or "").lower()
    table = [("su-33", "Flanker-D"), ("su-27", "Flanker"), ("su-35", "Flanker-E"),
             ("su-30", "Flanker-C"), ("su-34", "Fullback"), ("su-24", "Fencer"),
             ("su-25", "Frogfoot"), ("mig-31", "Foxhound"), ("mig-29", "Fulcrum"),
             ("mig-25", "Foxbat"), ("mig-23", "Flogger"), ("mig-21", "Fishbed"),
             ("j-11", "Flanker (PRC)"), ("tu-22", "Backfire"), ("tu-95", "Bear"),
             ("tu-160", "Blackjack"), ("a-50", "Mainstay"), ("il-76", "Candid"),
             ("il-78", "Midas")]
    for key, rep in table:
        if key in t:
            return rep
    return cls or ""


def _packet_id(mission_name: str) -> str:
    slug = re.sub(r"[^A-Z0-9]+", "-", str(mission_name).upper()).strip("-")
    return f"PKT-{slug[:24]}" if slug else "PKT"


def _ao_center(mission_data: dict):
    try:
        from services.brief_builder import _compute_ao_center
        ov = mission_data.get("overview") or {}
        return _compute_ao_center(mission_data.get("groups") or [],
                                  mission_data.get("threats") or [], ov)
    except Exception:
        return None


def _friendly_oob(groups: List[dict], airbases: List[dict]) -> Dict[str, Any]:
    flights = _build_flights(groups, airbases)
    carrier = None
    for g in groups:
        if g.get("coalition") != "blue" or g.get("category") != "ship":
            continue
        for u in (g.get("units") or []):
            if re.search(r"CVN|CV_|Stennis|Forrestal|Roosevelt|Vinson|Washington|Truman|Lincoln|Nimitz",
                         str(u.get("type") or ""), re.IGNORECASE):
                carrier = (u.get("name") or g.get("groupName") or "").strip()
                break
        if carrier:
            break
    return {"carrier": carrier, "flights": flights}
