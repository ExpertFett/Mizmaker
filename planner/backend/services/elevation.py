"""Terrain elevation, including above 60 degrees north.

The planner's elevation lookup was SRTM-only. SRTM covers 60S-60N, so every
query on the Kola theatre — the whole Murmansk/Kirkenes campaign — came back
null, and anything downstream that wanted terrain silently had nothing to
work with.

This adds a global fallback: AWS's public Terrarium tiles, which are
worldwide raster DEMs with the height encoded in the RGB channels. SRTM stays
the first choice where it has coverage (it is local, already cached on disk,
and needs no network round trip); Terrarium fills in the rest.

Two things make the batch path worth having separately from the single-point
one. A route profile asks for a few hundred points along a line, and those
points overwhelmingly land in a handful of tiles — so grouping by tile turns
hundreds of would-be fetches into a few. And a partial answer is useful: one
tile failing should blank its own points, not the whole profile.
"""

from __future__ import annotations

import io
import logging
import math
import threading
import urllib.request
from collections import OrderedDict

logger = logging.getLogger(__name__)

# Zoom trades resolution against tile count, and tile count is what costs
# time. A z12 tile spans 0.088 deg of longitude — about 3.5 km at 69N — so a
# 200 NM route crosses roughly a hundred of them. z10 spans four times that
# (~55 m/pixel at Kola latitudes), which is still finer than the terrain
# detail that matters for clearance planning and puts a long route inside a
# couple of dozen tiles.
TERRARIUM_ZOOM = 10

_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

_FETCH_TIMEOUT_S = 6

# Decoded tiles kept in memory. A tile is 256x256 RGB (~196 KB), so this caps
# the cache at roughly 12 MB.
_MAX_CACHED_TILES = 64

# Concurrent tile fetches per batch request. Enough to hide the latency of a
# long route without hammering the tile host.
_MAX_PARALLEL_FETCHES = 8

_tile_cache: "OrderedDict[tuple[int, int, int], object]" = OrderedDict()
_cache_lock = threading.Lock()

# Tiles that failed to fetch. Without this a route crossing a gap in coverage
# re-requests the same missing tile for every one of its points.
_failed_tiles: set = set()


def _deg_to_tile(lat: float, lon: float, z: int) -> tuple[int, int, float, float]:
    """Slippy-map tile containing lat/lon, plus the pixel within it.

    Returns (x, y, px, py) where px/py are 0-255 pixel coordinates.
    """
    lat = max(-85.05112878, min(85.05112878, lat))
    n = 2.0 ** z
    lat_rad = math.radians(lat)
    fx = (lon + 180.0) / 360.0 * n
    fy = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    x, y = int(fx), int(fy)
    return x, y, (fx - x) * 256, (fy - y) * 256


def _load_tile(z: int, x: int, y: int):
    """Fetch and decode one Terrarium tile. None when unavailable."""
    key = (z, x, y)
    with _cache_lock:
        if key in _tile_cache:
            _tile_cache.move_to_end(key)
            return _tile_cache[key]
        if key in _failed_tiles:
            return None

    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - Pillow is a declared dependency
        logger.warning("Pillow unavailable; global elevation disabled")
        return None

    url = _TILE_URL.format(z=z, x=x, y=y)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DCS-OPT/1.0"})
        with urllib.request.urlopen(req, timeout=_FETCH_TIMEOUT_S) as resp:
            raw = resp.read()
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:  # noqa: BLE001 - any failure means "no data here"
        logger.info("terrarium tile %s/%s/%s unavailable: %s", z, x, y, e)
        with _cache_lock:
            _failed_tiles.add(key)
        return None

    with _cache_lock:
        _tile_cache[key] = img
        while len(_tile_cache) > _MAX_CACHED_TILES:
            _tile_cache.popitem(last=False)
    return img


def _decode(r: int, g: int, b: int) -> float:
    """Terrarium RGB -> metres. The published encoding."""
    return (r * 256 + g + b / 256) - 32768


def terrarium_elevation(lat: float, lon: float) -> float | None:
    """Elevation in metres from the global tile set, or None."""
    x, y, px, py = _deg_to_tile(lat, lon, TERRARIUM_ZOOM)
    img = _load_tile(TERRARIUM_ZOOM, x, y)
    if img is None:
        return None
    try:
        r, g, b = img.getpixel((min(255, int(px)), min(255, int(py))))
    except Exception:  # noqa: BLE001
        return None
    return _decode(r, g, b)


def get_elevation(lat: float, lon: float, srtm_data=None) -> float | None:
    """Elevation in metres, SRTM first and Terrarium where SRTM has no data.

    `srtm_data` is the app's shared srtm.py handle. Passing it in rather than
    importing keeps this module usable (and testable) without the SRTM cache
    directory existing.
    """
    if srtm_data is not None and -60 <= lat <= 60:
        try:
            elev = srtm_data.get_elevation(lat, lon)
            if elev is not None:
                return float(elev)
        except Exception as e:  # noqa: BLE001
            logger.info("SRTM lookup failed at %s,%s: %s", lat, lon, e)
    return terrarium_elevation(lat, lon)


def get_elevations(points: list, srtm_data=None) -> list:
    """Elevations for many points, grouped by tile so each is fetched once.

    `points` is a sequence of (lat, lon). The result is the same length and
    order, with None wherever no data was available — a gap in one tile blanks
    its own points rather than failing the whole request.
    """
    out: list = [None] * len(points)

    # SRTM covers the in-range points without any network work.
    remaining: list[int] = []
    for i, pt in enumerate(points):
        try:
            lat, lon = float(pt[0]), float(pt[1])
        except (TypeError, ValueError, IndexError):
            continue
        if srtm_data is not None and -60 <= lat <= 60:
            try:
                elev = srtm_data.get_elevation(lat, lon)
                if elev is not None:
                    out[i] = float(elev)
                    continue
            except Exception:  # noqa: BLE001
                pass
        remaining.append(i)

    # Group whatever is left by tile, so a 300-point route profile crossing
    # three tiles costs three fetches rather than three hundred.
    by_tile: dict = {}
    for i in remaining:
        lat, lon = float(points[i][0]), float(points[i][1])
        x, y, px, py = _deg_to_tile(lat, lon, TERRARIUM_ZOOM)
        by_tile.setdefault((x, y), []).append((i, px, py))

    # Fetch the tiles concurrently. Serially, a route crossing twenty tiles
    # pays twenty round trips end to end, which is the difference between a
    # profile that appears and one the user gives up waiting for.
    tiles: dict = {}
    if by_tile:
        from concurrent.futures import ThreadPoolExecutor
        keys = list(by_tile.keys())
        with ThreadPoolExecutor(max_workers=min(_MAX_PARALLEL_FETCHES, len(keys))) as pool:
            for key, img in zip(keys, pool.map(
                    lambda k: _load_tile(TERRARIUM_ZOOM, k[0], k[1]), keys)):
                tiles[key] = img

    for (x, y), members in by_tile.items():
        img = tiles.get((x, y))
        if img is None:
            continue
        for i, px, py in members:
            try:
                r, g, b = img.getpixel((min(255, int(px)), min(255, int(py))))
                out[i] = _decode(r, g, b)
            except Exception:  # noqa: BLE001
                pass

    return out


def clear_cache() -> None:
    """Drop cached tiles. For tests."""
    with _cache_lock:
        _tile_cache.clear()
        _failed_tiles.clear()
