"""DM trigger-fire signal encoding (pairs with assets/scripts/dcsopt-dm-bridge.lua v2).

The web panel can't set a DCS user flag directly, so the backend spawns a
throwaway neutral Soldier M4 that carries the flag index and the mission-side
bridge script decodes it on S_EVENT_BIRTH.

v1 encoded the flag into an off-map latitude (89 + flag*1e-6). DCS clamps such a
point (live test 2026-10-17: the soldier appeared at the map origin), so the
signal now spawns at a REAL in-theatre anchor (an airbase from the live picture)
and carries the flag one of two ways:

  olympuslite  group name "DMFIRE-<flag>" (OlympusLite names groups from the
               request; it prefixes "OLITE-"). One unit, exact.
  olympus      DCS Olympus names groups itself, so: a 2-unit group, unit 1 on the
               anchor, unit 2 offset north = flag // 1000 quanta and east =
               flag % 1000 quanta, quantum = 2e-5 deg of latitude (~2.2 m) and
               the same distance east. The bridge decodes from the two units'
               own lat/lon, so the anchor can be anywhere on the map.

Keep the constants in step with the bridge script's CONFIG block.
"""

from __future__ import annotations

import math
from typing import Optional, Tuple

SIGNAL_TYPE = "Soldier M4"
NAME_PREFIX = "DMFIRE-"
PAIR_Q_DEG = 2e-5
PAIR_BASE = 1000
FLAG_MIN, FLAG_MAX = 1, 999_999


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def pick_anchor(airbases_data) -> Optional[Tuple[float, float, str]]:
    """(lat, lng, name) of a land airbase from an Olympus-shaped airbases payload
    ({airbases: {k: {callsign, latitude, longitude, kind?}}}, which both relay
    kinds return). When kinds are reported (OlympusLite) it takes an airdrome,
    else a helipad, never a ship. Olympus reports no kind, so it takes the first
    entry in key order: DCS's world.getAirbases() order, map airdromes first."""
    bases = (airbases_data or {}).get("airbases") if isinstance(airbases_data, dict) else None
    if not isinstance(bases, dict):
        return None

    def key(k):
        return (0, int(k)) if str(k).isdigit() else (1, str(k))

    rows = []
    for k in sorted(bases, key=key):
        a = bases[k] if isinstance(bases[k], dict) else {}
        lat, lng = _num(a.get("latitude")), _num(a.get("longitude"))
        if lat is None or lng is None or not (-80 <= lat <= 80) or not (-180 <= lng <= 180):
            continue
        rows.append((a.get("kind"), lat, lng, str(a.get("callsign") or k)))
    if not rows:
        return None
    if not any(kind for kind, *_ in rows):  # Olympus: no kinds reported
        _, lat, lng, name = rows[0]
        return lat, lng, name
    for want in ("airdrome", "helipad"):     # land only — never a ship
        for kind, lat, lng, name in rows:
            if kind == want:
                return lat, lng, name
    return None


def pair_point(lat: float, lng: float, flag: int) -> Tuple[float, float]:
    """Unit 2 of the offset pair for `flag`, given unit 1 at (lat, lng)."""
    north, east = divmod(int(flag), PAIR_BASE)
    return (lat + north * PAIR_Q_DEG,
            lng + east * PAIR_Q_DEG / math.cos(math.radians(lat)))


def decode_pair(lat1: float, lon1: float, lat2: float, lon2: float, tol: float = 0.3) -> Optional[int]:
    """Python mirror of the bridge's decodePair (used by tests)."""
    n = (lat2 - lat1) / PAIR_Q_DEG
    e = (lon2 - lon1) * math.cos(math.radians(lat1)) / PAIR_Q_DEG
    rn, re_ = round(n), round(e)
    if abs(n - rn) > tol or abs(e - re_) > tol:
        return None
    if not (0 <= rn < PAIR_BASE and 0 <= re_ < PAIR_BASE):
        return None
    flag = rn * PAIR_BASE + re_
    return flag if flag > 0 else None


def spawn_params(kind: str, flag: int, anchor: Tuple[float, float]) -> dict:
    """spawnGroundUnits params for the profile kind. `groupName` is a DCS:OPT
    extension the OlympusLite relay honours; real Olympus ignores it."""
    lat, lng = anchor
    unit = {"unitType": SIGNAL_TYPE, "skill": "Average", "liveryID": ""}
    if kind == "olympuslite":
        units = [{**unit, "location": {"lat": lat, "lng": lng}}]
        extra = {"groupName": f"{NAME_PREFIX}{int(flag)}"}
    else:
        lat2, lng2 = pair_point(lat, lng, flag)
        units = [{**unit, "location": {"lat": lat, "lng": lng}},
                 {**unit, "location": {"lat": lat2, "lng": lng2}}]
        extra = {}
    return {"units": units, "coalition": "neutral", "country": "",
            "immediate": True, "spawnPoints": 0, **extra}
