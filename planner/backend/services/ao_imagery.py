"""Satellite imagery of a mission's operating area, for briefing backgrounds.

The wing brief used to be flat dark slides with a header and a paragraph — it
read as sterile and "AI-generated." The fix that landed with mission makers was
to put real satellite imagery of the actual AO behind the slides that are about
*place* (cover, situation, threats, intent) while leaving data slides (timeline,
ROE, comms) clean. This module is the imagery half of that: given a lat/lon and
a span, it stitches ESRI World Imagery tiles into one canvas, darkens and
desaturates it so text stays legible, and optionally bakes in a gradient so the
image fades into the slide's dark background.

Design notes:
  * Same tile source the app already uses in production (the Live map and DMPI
    picker both draw ESRI World Imagery), so this introduces no new dependency
    or new external host — see LiveMap.tsx / DmpiMapPanel.tsx.
  * Same slippy-tile + threaded-fetch + LRU-cache machinery as elevation.py.
    The one wrinkle is ESRI orders its path {z}/{y}/{x} (row before column),
    not the {z}/{x}/{y} of the Terrarium DEM tiles.
  * Gradients are baked into the returned raster rather than layered as a
    semi-transparent PPTX shape. python-pptx has no first-class fill alpha, and
    a baked gradient reproduces the mockup exactly and travels intact into
    Google Slides.

Everything degrades to None on any failure (no network, tile gap, Pillow
missing): the renderer falls back to its flat-dark slide, so a brief always
renders.
"""

from __future__ import annotations

import io
import logging
import math
import threading
import urllib.request
from collections import OrderedDict
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# ESRI World Imagery — the satellite basemap the frontend already ships.
# NOTE the path order is {z}/{y}/{x}: row (y) before column (x).
_TILE_URL = ("https://server.arcgisonline.com/ArcGIS/rest/services/"
             "World_Imagery/MapServer/tile/{z}/{y}/{x}")

_FETCH_TIMEOUT_S = 6
_TILE_PX = 256

# A stitched AO background touches at most a few dozen tiles; keep a generous
# cache so re-rendering the same brief (or several briefs on one theatre) reuses
# them. 256x256 RGB ~= 196 KB, so 160 tiles ~= 31 MB.
_MAX_CACHED_TILES = 160
_MAX_PARALLEL_FETCHES = 10

# Web-Mercator zoom band. The low end frames a whole theatre; the high end
# is for target close-ups (z18 ~= building level). A full-slide canvas only
# touches a handful of tiles even at z18 because the geographic area is tiny,
# so the fetch stays cheap. ESRI World Imagery has coverage to ~z19.
_MIN_ZOOM = 4
_MAX_ZOOM = 19

_EARTH_CIRCUMFERENCE_M = 40075016.686

_tile_cache: "OrderedDict[Tuple[int, int, int], object]" = OrderedDict()
_cache_lock = threading.Lock()
_failed_tiles: set = set()


def _deg_to_worldpx(lat: float, lon: float, z: int) -> Tuple[float, float]:
    """Web-Mercator pixel coordinate of lat/lon at zoom z (256-px tiles)."""
    lat = max(-85.05112878, min(85.05112878, lat))
    n = 2.0 ** z
    lat_rad = math.radians(lat)
    x = (lon + 180.0) / 360.0 * n * _TILE_PX
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n * _TILE_PX
    return x, y


def _meters_per_pixel(lat: float, z: int) -> float:
    """Ground resolution (m/px) at a latitude and zoom."""
    return _EARTH_CIRCUMFERENCE_M * math.cos(math.radians(lat)) / (2.0 ** z * _TILE_PX)


def _pick_zoom(lat: float, span_km: float, out_w: int) -> int:
    """Highest zoom whose ground width across out_w pixels still covers span_km.

    We want span_km to fill roughly the whole canvas width, so 1 output pixel
    maps to ~1 Mercator pixel and the paste is crisp (no resample).
    """
    if span_km <= 0:
        return 9
    target_mpp = (span_km * 1000.0) / max(1, out_w)
    # mpp halves each zoom step up; find the z whose mpp is just <= target.
    z = math.log2(_EARTH_CIRCUMFERENCE_M * math.cos(math.radians(lat))
                  / (_TILE_PX * target_mpp))
    return int(max(_MIN_ZOOM, min(_MAX_ZOOM, math.floor(z))))


def _load_tile(z: int, x: int, y: int):
    """Fetch + decode one ESRI tile, cached. None when unavailable.

    x is wrapped modulo the world width; y out of range means no such tile.
    """
    n = 2 ** z
    x %= n
    if y < 0 or y >= n:
        return None
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
        logger.warning("Pillow unavailable; AO imagery disabled")
        return None

    url = _TILE_URL.format(z=z, x=x, y=y)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DCS-OPT/1.0"})
        with urllib.request.urlopen(req, timeout=_FETCH_TIMEOUT_S) as resp:
            raw = resp.read()
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:  # noqa: BLE001 - any failure means "no imagery here"
        logger.info("esri tile %s/%s/%s unavailable: %s", z, x, y, e)
        with _cache_lock:
            _failed_tiles.add(key)
        return None

    with _cache_lock:
        _tile_cache[key] = img
        while len(_tile_cache) > _MAX_CACHED_TILES:
            _tile_cache.popitem(last=False)
    return img


def _stitch(lat: float, lon: float, z: int, out_w: int, out_h: int):
    """Composite the tiles covering the out_w x out_h window centred on lat/lon.

    Returns a PIL RGB image of exactly (out_w, out_h), or None if not one tile
    could be fetched (whole-canvas failure -> caller falls back to flat dark).
    """
    from PIL import Image

    cx, cy = _deg_to_worldpx(lat, lon, z)
    left = cx - out_w / 2.0
    top = cy - out_h / 2.0

    tx0 = math.floor(left / _TILE_PX)
    ty0 = math.floor(top / _TILE_PX)
    tx1 = math.floor((left + out_w) / _TILE_PX)
    ty1 = math.floor((top + out_h) / _TILE_PX)

    cols = list(range(tx0, tx1 + 1))
    rows = list(range(ty0, ty1 + 1))
    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * _TILE_PX,
                               (ty1 - ty0 + 1) * _TILE_PX), (13, 15, 18))

    # Fetch all needed tiles concurrently; a big canvas over a dozen tiles
    # otherwise pays a dozen serial round trips.
    jobs = [(tx, ty) for ty in rows for tx in cols]
    got_any = False
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(_MAX_PARALLEL_FETCHES, max(1, len(jobs)))) as pool:
        for (tx, ty), img in zip(jobs, pool.map(lambda j: _load_tile(z, j[0], j[1]), jobs)):
            if img is None:
                continue
            got_any = True
            canvas.paste(img, ((tx - tx0) * _TILE_PX, (ty - ty0) * _TILE_PX))

    if not got_any:
        return None

    crop_x = int(round(left - tx0 * _TILE_PX))
    crop_y = int(round(top - ty0 * _TILE_PX))
    return canvas.crop((crop_x, crop_y, crop_x + out_w, crop_y + out_h))


def _apply_gradient(img, gradient: str, scrim=(13, 15, 18)):
    """Bake a gradient scrim into img so text over it stays legible.

    scrim is the colour faded in — a theme's background, so a dark theme
    scrims toward its charcoal and a light theme toward its paper (dark text
    then reads over the imagery). One layout serves both.

    gradient:
      "bottom" — clear at top, scrim at the bottom (cover: title strip)
      "left"   — scrim at the left, clearing by ~62% width (situation/intent)
      "right"  — mirror of "left"
      "full"   — a flat, even scrim over the whole frame (threats table/rings)
    """
    from PIL import Image
    w, h = img.size
    dark = Image.new("RGB", (w, h), tuple(scrim))
    light = sum(scrim) / 3.0 > 150  # light theme -> heavier scrim for dark text

    if gradient == "full":
        mask = Image.new("L", (w, h), int((0.55 if light else 0.45) * 255))
    elif gradient == "bottom":
        col = Image.new("L", (1, h))
        peak = 0.97 if light else 0.94
        for yy in range(h):
            t = yy / max(1, h - 1)
            # ramp: transparent over the top ~35%, then climb to near-opaque
            a = 0.0 if t < 0.35 else ((t - 0.35) / 0.65) ** 1.4 * peak
            col.putpixel((0, yy), int(a * 255))
        mask = col.resize((w, h))
    elif gradient in ("left", "right"):
        row = Image.new("L", (w, 1))
        floor = 0.28 if light else 0.12
        peak = 0.99 if light else 0.97
        for xx in range(w):
            t = xx / max(1, w - 1)
            if gradient == "right":
                t = 1.0 - t
            # opaque at the edge, clearing by ~62% across
            a = max(0.0, 1.0 - (t / 0.62)) * peak
            a = max(a, floor)  # keep a floor so the far side still holds text
            row.putpixel((xx, 0), int(a * 255))
        mask = row.resize((w, h))
    else:
        return img

    return Image.composite(dark, img, mask)

    if gradient == "full":
        mask = Image.new("L", (w, h), int(0.45 * 255))
    elif gradient == "bottom":
        col = Image.new("L", (1, h))
        for yy in range(h):
            t = yy / max(1, h - 1)
            # ramp: transparent over the top ~35%, then climb to near-opaque
            a = 0.0 if t < 0.35 else ((t - 0.35) / 0.65) ** 1.4 * 0.94
            col.putpixel((0, yy), int(a * 255))
        mask = col.resize((w, h))
    elif gradient in ("left", "right"):
        row = Image.new("L", (w, 1))
        for xx in range(w):
            t = xx / max(1, w - 1)
            if gradient == "right":
                t = 1.0 - t
            # opaque at the edge, clearing by ~62% across
            a = max(0.0, 1.0 - (t / 0.62)) * 0.97
            # keep a light floor so the far side is still readable-dark
            a = max(a, 0.12)
            row.putpixel((xx, 0), int(a * 255))
        mask = row.resize((w, h))
    else:
        return img

    return Image.composite(dark, img, mask)


def _apply_tint(img, tint: dict):
    """Tone imagery per a theme's tint spec (see brief_themes).

    {"duotone": [(dark_rgb), (light_rgb)]} maps greyscale onto a two-colour
    ramp (blueprint blue, NVG green, amber CRT, chart navy). Otherwise
    sat/bright enhance plus an optional {"mul": (r,g,b)} colour multiply
    (coyote sepia, aggressor red, arctic cool).
    """
    from PIL import ImageOps, ImageEnhance, Image, ImageChops
    if "duotone" in tint:
        dark, light = tint["duotone"]
        return ImageOps.colorize(img.convert("L"),
                                 black=tuple(dark), white=tuple(light)).convert("RGB")
    s = tint.get("sat", 1.0)
    b = tint.get("bright", 1.0)
    if s != 1.0:
        img = ImageEnhance.Color(img).enhance(s)
    if b != 1.0:
        img = ImageEnhance.Brightness(img).enhance(b)
    mul = tint.get("mul")
    if mul:
        layer = Image.new("RGB", img.size, tuple(mul))
        img = ImageChops.multiply(img, layer)
    return img


def fetch_ao_image(lat: float, lon: float, span_km: float,
                   out_w: int, out_h: int, *,
                   saturate: float = 0.6, brightness: float = 0.66,
                   gradient: Optional[str] = None,
                   zoom: Optional[int] = None,
                   tint: Optional[dict] = None,
                   scrim=(13, 15, 18)) -> Optional[bytes]:
    """Satellite AO background as PNG bytes, or None on any failure.

    lat/lon    — centre of the operating area
    span_km    — desired ground width across out_w (picks the zoom)
    out_w/out_h — output pixel size (match the slide aspect, e.g. 1280x720)
    saturate   — <1 desaturates (matches the mockup's muted look)
    brightness — <1 darkens for text legibility
    gradient   — see _apply_gradient; None leaves the raster evenly toned
    zoom       — force a zoom (detail insets); otherwise derived from span_km
    """
    try:
        from PIL import Image, ImageEnhance  # noqa: F401
    except ImportError:  # pragma: no cover
        return None
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return None
    if not (-85.0 <= lat <= 85.0) or not (-180.0 <= lon <= 180.0):
        return None

    z = int(zoom) if zoom is not None else _pick_zoom(lat, span_km, out_w)
    z = max(_MIN_ZOOM, min(_MAX_ZOOM, z))

    try:
        img = _stitch(lat, lon, z, out_w, out_h)
    except Exception as e:  # noqa: BLE001
        logger.info("AO stitch failed at %s,%s z%s: %s", lat, lon, z, e)
        return None
    if img is None:
        return None

    try:
        if tint:
            img = _apply_tint(img, tint)
        else:
            if saturate != 1.0:
                img = ImageEnhance.Color(img).enhance(saturate)
            if brightness != 1.0:
                img = ImageEnhance.Brightness(img).enhance(brightness)
        if gradient:
            img = _apply_gradient(img, gradient, scrim)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as e:  # noqa: BLE001
        logger.info("AO post-process failed: %s", e)
        return None


def _tile_is_placeholder(img) -> bool:
    """True if a tile is ESRI's 'Map data not yet available' grey placeholder.

    Those tiles are a near-uniform light grey; real imagery has high variance.
    Sampled small for speed.
    """
    try:
        g = img.convert("L").resize((32, 32))
        px = list(g.getdata())
        n = len(px)
        mean = sum(px) / n
        var = sum((p - mean) ** 2 for p in px) / n
        return var < 80 and mean > 140
    except Exception:  # noqa: BLE001
        return False


def best_detail_zoom(lat: float, lon: float, want: int = 18,
                     floor: int = 14) -> int:
    """Deepest zoom (<= want) whose imagery actually exists at lat/lon.

    ESRI World Imagery resolution varies by location — a city has z18-19, a
    remote area caps lower and serves a grey placeholder past its limit. Probe
    the centre tile from `want` down and return the first real one, so a target
    close-up is as tight as the imagery allows instead of a grey box.
    """
    for z in range(int(want), int(floor) - 1, -1):
        try:
            wx, wy = _deg_to_worldpx(lat, lon, z)
            img = _load_tile(z, int(wx // _TILE_PX), int(wy // _TILE_PX))
        except Exception:  # noqa: BLE001
            img = None
        if img is not None and not _tile_is_placeholder(img):
            return z
    return int(floor)


def clear_cache() -> None:
    """Drop cached tiles. For tests."""
    with _cache_lock:
        _tile_cache.clear()
        _failed_tiles.clear()
