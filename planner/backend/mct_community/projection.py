"""
DCS theatre <-> WGS-84 projection.

This is the shared copy of the projection every DCS tool needs in order to
speak the community standard, which is WGS-84-only. It is lifted from
DCS:OPT's planner/backend/services/projection.py (the authoritative,
community-validated parameter table) so that MissionGen, CivTraffic and
anything else can project without depending on the planner backend.

It is the Python counterpart of MCTUtils.DCS in the C# SDK.

Axis convention (the usual trap):
    DCS X = northing (metres north of the projection origin)
    DCS Y = easting  (metres east  of the projection origin)
pyproj with +axis=neu takes (northing, easting), so pass (x, y) in that order.

pyproj is imported lazily: tools that already hold lat/lon (ReadyRoom, the
Ops Bot) can import this package without needing the dependency at all.
"""

from __future__ import annotations

from typing import Dict, Optional, Tuple

# Transverse Mercator parameters per theatre, k_0 = 0.9996 on WGS84.
THEATERS: Dict[str, dict] = {
    "Caucasus":        {"lon_0": 33,   "x_0": -99517,     "y_0": -4998115},
    "Syria":           {"lon_0": 39,   "x_0": 282801,     "y_0": -3879866},
    "PersianGulf":     {"lon_0": 57,   "x_0": 75756,      "y_0": -2894933},
    "Nevada":          {"lon_0": -117, "x_0": -193996.81, "y_0": -4410028.064},
    "SinaiMap":        {"lon_0": 33,   "x_0": 169222,     "y_0": -3325313},
    "Normandy":        {"lon_0": -3,   "x_0": -195526,    "y_0": -5484813},
    "TheChannel":      {"lon_0": 3,    "x_0": 99376,      "y_0": -5636889},
    "MarianaIslands":  {"lon_0": 147,  "x_0": 238418,     "y_0": -1491840},
    "Falklands":       {"lon_0": -57,  "x_0": 147640,     "y_0": 5815417},
    "Kola":            {"lon_0": 21,   "x_0": -62702,     "y_0": -7543625},
    "Afghanistan":     {"lon_0": 63,   "x_0": -300150,    "y_0": -3759657},
    "Iraq":            {"lon_0": 45,   "x_0": 72290,      "y_0": -3680057},
    "TopEndAustralia": {"lon_0": 135,  "x_0": 500000,     "y_0": 10000000},
    "SouthEastAsia":   {"lon_0": 107,  "x_0": 200000,     "y_0": -1800000},
    "GermanyCW":       {"lon_0": 21,   "x_0": 35427.62,   "y_0": -6061633.128},
}

_transformers: Dict[str, Tuple[object, object]] = {}


class ProjectionUnavailable(RuntimeError):
    """pyproj missing, or the theatre has no published parameters."""


def _proj_string(theater: str) -> str:
    t = THEATERS[theater]
    return (
        f"+proj=tmerc +lat_0=0 +lon_0={t['lon_0']} +k_0=0.9996 "
        f"+x_0={t['x_0']} +y_0={t['y_0']} "
        "+towgs84=0,0,0,0,0,0,0 +units=m +ellps=WGS84 +no_defs +axis=neu"
    )


def _get(theater: str):
    if theater not in THEATERS:
        raise ProjectionUnavailable(
            f"No projection parameters for theatre {theater!r}. "
            f"Known: {', '.join(sorted(THEATERS))}"
        )
    if theater not in _transformers:
        try:
            from pyproj import CRS, Transformer
        except ImportError as exc:  # pragma: no cover - environment dependent
            raise ProjectionUnavailable(
                "pyproj is required to project DCS coordinates. "
                "pip install pyproj"
            ) from exc
        crs_dcs = CRS.from_proj4(_proj_string(theater))
        crs_wgs = CRS.from_epsg(4326)
        _transformers[theater] = (
            Transformer.from_crs(crs_dcs, crs_wgs, always_xy=False),
            Transformer.from_crs(crs_wgs, crs_dcs, always_xy=False),
        )
    return _transformers[theater]


def dcs_to_latlon(x: float, y: float, theater: str) -> Tuple[float, float]:
    """DCS (x=northing, y=easting) -> (lat, lon) in decimal degrees."""
    to_ll, _ = _get(theater)
    lat, lon = to_ll.transform(x, y)
    return lat, lon


def latlon_to_dcs(lat: float, lon: float, theater: str) -> Tuple[float, float]:
    """(lat, lon) -> DCS (x=northing, y=easting)."""
    _, to_dcs = _get(theater)
    x, y = to_dcs.transform(lat, lon)
    return x, y


def try_latlon(x, y, theater: str) -> Tuple[Optional[float], Optional[float]]:
    """Projection that degrades instead of raising - returns (None, None)
    when the theatre is unknown or pyproj is absent. Adapters use this so a
    missing dependency downgrades one field rather than killing the export."""
    try:
        return dcs_to_latlon(float(x), float(y), theater)
    except (ProjectionUnavailable, TypeError, ValueError):
        return None, None


def supported_theaters() -> list:
    return sorted(THEATERS)
