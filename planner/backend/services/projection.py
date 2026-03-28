"""
DCS coordinate projection — converts between DCS (x, y) and WGS84 (lat, lon).

Each DCS theater uses a Transverse Mercator projection with theater-specific parameters.
Parameters sourced from pydcs / dcs-web-editor (authoritative, community-validated).

Key axis convention:
  DCS X = northing (meters north of projection origin)
  DCS Y = easting  (meters east of projection origin)
  pyproj expects (easting, northing) → pass (y, x)
"""

from typing import Tuple, Optional, Dict
from pyproj import Transformer, CRS

# Theater projection parameters (from web-editor index.ts / pydcs terrain modules)
# All use Transverse Mercator with scale_factor=0.9996 on WGS84
THEATERS: Dict[str, dict] = {
    "Caucasus":        {"lon_0": 33,   "x_0": -99517,        "y_0": -4998115},
    "Syria":           {"lon_0": 39,   "x_0": 282801,        "y_0": -3879866},
    "PersianGulf":     {"lon_0": 57,   "x_0": 75756,         "y_0": -2894933},
    "Nevada":          {"lon_0": -117, "x_0": -193996.81,    "y_0": -4410028.064},
    "SinaiMap":        {"lon_0": 33,   "x_0": 169222,        "y_0": -3325313},
    "Normandy":        {"lon_0": -3,   "x_0": -195526,       "y_0": -5484813},
    "TheChannel":      {"lon_0": 3,    "x_0": 99376,         "y_0": -5636889},
    "MarianaIslands":  {"lon_0": 147,  "x_0": 238418,        "y_0": -1491840},
    "Falklands":       {"lon_0": -57,  "x_0": 147640,        "y_0": 5815417},
    "Kola":            {"lon_0": 21,   "x_0": -62702,        "y_0": -7543625},
    "Afghanistan":     {"lon_0": 63,   "x_0": -300150,       "y_0": -3759657},
    "Iraq":            {"lon_0": 45,   "x_0": 72290,         "y_0": -3680057},
    "TopEndAustralia": {"lon_0": 135,  "x_0": 500000,        "y_0": 10000000},
    "SouthEastAsia":   {"lon_0": 107,  "x_0": 200000,        "y_0": -1800000},
    "GermanyCW":       {"lon_0": 21,   "x_0": 35427.62,      "y_0": -6061633.128},
}

# Cache transformers per theater
_transformers: Dict[str, Tuple[Transformer, Transformer]] = {}


def _get_proj_string(theater: str) -> str:
    t = THEATERS[theater]
    return (
        f"+proj=tmerc +lat_0=0 +lon_0={t['lon_0']} +k_0=0.9996 "
        f"+x_0={t['x_0']} +y_0={t['y_0']} "
        "+towgs84=0,0,0,0,0,0,0 +units=m +ellps=WGS84 +no_defs +axis=neu"
    )


def _get_transformers(theater: str) -> Tuple[Transformer, Transformer]:
    if theater not in _transformers:
        proj_str = _get_proj_string(theater)
        crs_dcs = CRS.from_proj4(proj_str)
        crs_wgs = CRS.from_epsg(4326)
        to_ll = Transformer.from_crs(crs_dcs, crs_wgs, always_xy=False)
        to_dcs = Transformer.from_crs(crs_wgs, crs_dcs, always_xy=False)
        _transformers[theater] = (to_ll, to_dcs)
    return _transformers[theater]


def dcs_to_latlon(x: float, y: float, theater: str) -> Tuple[float, float]:
    """Convert DCS (x=northing, y=easting) to (lat, lon)."""
    to_ll, _ = _get_transformers(theater)
    lat, lon = to_ll.transform(x, y)
    return lat, lon


def latlon_to_dcs(lat: float, lon: float, theater: str) -> Tuple[float, float]:
    """Convert (lat, lon) to DCS (x=northing, y=easting)."""
    _, to_dcs = _get_transformers(theater)
    x, y = to_dcs.transform(lat, lon)
    return x, y


def dcs_to_mgrs(x: float, y: float, theater: str) -> Optional[str]:
    """Convert DCS (x, y) to MGRS string."""
    lat, lon = dcs_to_latlon(x, y, theater)
    try:
        import mgrs as mgrs_lib
        m = mgrs_lib.MGRS()
        return m.toMGRS(lat, lon, MGRSPrecision=5)
    except ImportError:
        return None


def get_supported_theaters() -> list:
    return list(THEATERS.keys())
