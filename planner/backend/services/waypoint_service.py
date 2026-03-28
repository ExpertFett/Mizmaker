"""
Route computation — ETA, distance, bearing between waypoints.
Uses Haversine formula on lat/lon coordinates.
"""

import math
from typing import List, Dict


def compute_leg(prev: Dict, curr: Dict) -> Dict:
    """Compute distance, bearing, and ETA for a leg between two waypoints."""
    lat1 = prev.get("lat")
    lon1 = prev.get("lon")
    lat2 = curr.get("lat")
    lon2 = curr.get("lon")

    if lat1 is None or lat2 is None:
        return {"distance_m": 0, "distance_nm": 0, "bearing_deg": 0, "eta_seconds": 0}

    dist = _haversine(lat1, lon1, lat2, lon2)
    brg = _bearing(lat1, lon1, lat2, lon2)

    speed = curr.get("speed_ms", 0)
    eta = dist / speed if speed > 0 else 0

    return {
        "distance_m": round(dist, 1),
        "distance_nm": round(dist / 1852, 2),
        "bearing_deg": round(brg, 1),
        "eta_seconds": round(eta, 1),
    }


def recompute_route(waypoints: List[Dict]) -> List[Dict]:
    """Recompute leg data for all waypoints in order."""
    for i, wp in enumerate(waypoints):
        if i == 0:
            wp["leg_distance_nm"] = 0
            wp["leg_bearing_deg"] = 0
            wp["cumulative_eta"] = 0
        else:
            leg = compute_leg(waypoints[i - 1], wp)
            wp["leg_distance_nm"] = leg["distance_nm"]
            wp["leg_bearing_deg"] = leg["bearing_deg"]
            wp["cumulative_eta"] = waypoints[i - 1].get("cumulative_eta", 0) + leg["eta_seconds"]
    return waypoints


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two lat/lon points."""
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing in degrees from point 1 to point 2."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlam = math.radians(lon2 - lon1)

    y = math.sin(dlam) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlam)
    brg = math.degrees(math.atan2(y, x))
    return (brg + 360) % 360
