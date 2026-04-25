"""
Lazy-loading reference data — weapon/pylon/settings from pydcs, rest from JSON.

Weapon, pylon, and launcher settings data is built from pydcs (retribution fork)
at first access.  Other data (liveries, DTC defaults, SAM ranges, airbases)
remains in static JSON files.

Sources:
  - weapons_data: pydcs Weapons class attributes
  - pylon_data: pydcs plane/helicopter classes with nested Pylon classes
  - launcher_settings: pydcs Weapons class (settings embedded in weapon dicts)
  - livery_db.json: baked database
  - dtc_defaults_fa18.json: datalinkfixer
  - sam_threat_ranges.json: static threat ranges
  - airbases.json: per-theater airbase data
"""

import json
import logging
from pathlib import Path

_DATA_DIR = Path(__file__).parent.parent / "data"
_cache = {}

logger = logging.getLogger(__name__)


def _load_json(filename: str):
    if filename not in _cache:
        filepath = _DATA_DIR / filename
        _cache[filename] = json.loads(filepath.read_text())
    return _cache[filename]


# ---------------------------------------------------------------------------
# pydcs-backed data builders
# ---------------------------------------------------------------------------

def _build_weapons_from_pydcs() -> dict:
    """Build {CLSID: weapon_name} from pydcs Weapons class."""
    from dcs.weapons_data import Weapons

    weapons = {}
    for attr_name in dir(Weapons):
        if attr_name.startswith("_"):
            continue
        val = getattr(Weapons, attr_name)
        if isinstance(val, dict) and "clsid" in val and "name" in val:
            weapons[val["clsid"]] = val["name"]
    logger.info(f"Built weapons DB from pydcs: {len(weapons)} entries")
    return weapons


def _build_pylons_from_pydcs() -> dict:
    """Build {aircraft_type: {pylon_num_str: [CLSIDs]}} from pydcs planes/helicopters."""
    from dcs.planes import plane_map
    from dcs.helicopters import helicopter_map

    all_aircraft = {}
    all_aircraft.update(plane_map)
    all_aircraft.update(helicopter_map)

    pylons = {}
    for type_id, cls in all_aircraft.items():
        if not hasattr(cls, "pylons") or not cls.pylons:
            continue

        aircraft_pylons = {}
        for pylon_num in cls.pylons:
            pylon_class_name = f"Pylon{pylon_num}"
            pylon_class = getattr(cls, pylon_class_name, None)
            if not pylon_class:
                continue

            clsids = []
            for attr_name in dir(pylon_class):
                if attr_name.startswith("_"):
                    continue
                val = getattr(pylon_class, attr_name)
                if isinstance(val, tuple) and len(val) == 2:
                    _, weapon = val
                    if isinstance(weapon, dict) and "clsid" in weapon:
                        clsid = weapon["clsid"]
                        if clsid not in clsids:
                            clsids.append(clsid)
            if clsids:
                aircraft_pylons[str(pylon_num)] = clsids

        if aircraft_pylons:
            pylons[type_id] = aircraft_pylons

    logger.info(f"Built pylon DB from pydcs: {len(pylons)} aircraft")
    return pylons


def _normalize_settings(settings: list) -> list:
    """Normalize pydcs setting dicts to match our expected format.

    pydcs uses 'VisibilityCondition' — our code expects 'visCondition'.
    """
    normalized = []
    for s in settings:
        s2 = dict(s)
        if "VisibilityCondition" in s2:
            s2["visCondition"] = s2.pop("VisibilityCondition")
        normalized.append(s2)
    return normalized


def _build_launcher_settings_from_pydcs() -> dict:
    """Build {CLSID: {displayName, settings}} from pydcs Weapons class."""
    from dcs.weapons_data import Weapons

    settings_db = {}
    for attr_name in dir(Weapons):
        if attr_name.startswith("_"):
            continue
        val = getattr(Weapons, attr_name)
        if not isinstance(val, dict) or "clsid" not in val:
            continue
        weapon_settings = val.get("settings")
        if not weapon_settings:
            continue
        settings_db[val["clsid"]] = {
            "displayName": val.get("name", ""),
            "settings": _normalize_settings(weapon_settings),
        }
    logger.info(f"Built launcher settings DB from pydcs: {len(settings_db)} entries")
    return settings_db


def _build_weapon_weights_from_pydcs() -> dict:
    """Build {CLSID: weight_kg} from pydcs Weapons class."""
    from dcs.weapons_data import Weapons

    weights = {}
    for attr_name in dir(Weapons):
        if attr_name.startswith("_"):
            continue
        val = getattr(Weapons, attr_name)
        if not isinstance(val, dict) or "clsid" not in val:
            continue
        w = val.get("weight")
        if w is not None:
            try:
                weights[val["clsid"]] = float(w)
            except (TypeError, ValueError):
                pass
    logger.info(f"Built weapon weights from pydcs: {len(weights)} entries")
    return weights


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_weapons() -> dict:
    """CLSID → human-readable weapon name."""
    if "weapons" not in _cache:
        try:
            _cache["weapons"] = _build_weapons_from_pydcs()
        except ImportError:
            logger.warning("pydcs not available — falling back to weapons_data.json")
            _cache["weapons"] = _load_json("weapons_data.json")
    return _cache["weapons"]


def get_weapon_weights() -> dict:
    """CLSID → weight in kg (float). Built from pydcs Weapons class."""
    if "weapon_weights" not in _cache:
        try:
            _cache["weapon_weights"] = _build_weapon_weights_from_pydcs()
        except ImportError:
            logger.warning("pydcs not available — no weapon weights")
            _cache["weapon_weights"] = {}
    return _cache["weapon_weights"]


def get_pylons() -> dict:
    """Aircraft type → {pylon_number: [valid CLSIDs]}."""
    if "pylons" not in _cache:
        try:
            _cache["pylons"] = _build_pylons_from_pydcs()
        except ImportError:
            logger.warning("pydcs not available — falling back to pylon_data.json")
            _cache["pylons"] = _load_json("pylon_data.json")
    return _cache["pylons"]


def get_launcher_settings() -> dict:
    """CLSID → {displayName, settings: [...]}.

    Recent pydcs versions dropped the embedded ``settings`` dicts from
    ``Weapons``, so building from pydcs can return 0 entries even when pydcs
    imports cleanly. Fall back to the baked ``launcher_settings.json`` in that
    case — that file has ~3.7MB of fuse/laser/etc settings data.
    """
    if "launcher_settings" not in _cache:
        built = None
        try:
            built = _build_launcher_settings_from_pydcs()
        except ImportError:
            logger.warning("pydcs not available — falling back to launcher_settings.json")
        if not built:
            if built is not None:
                logger.warning("pydcs returned 0 launcher settings — falling back to launcher_settings.json")
            built = _load_json("launcher_settings.json")
        _cache["launcher_settings"] = built
    return _cache["launcher_settings"]


def get_liveries() -> dict:
    """Aircraft type → [{id, name}, ...]. ~410 aircraft, ~3,820 liveries."""
    return _load_json("livery_db.json")


def get_dtc_defaults_fa18() -> dict:
    """F/A-18C DTC baseline (ALR-67, CMDS, RWR)."""
    return _load_json("dtc_defaults_fa18.json")


def get_sam_threat_ranges() -> dict:
    """SAM/AAA unit type → max range in meters. ~30 systems."""
    return _load_json("sam_threat_ranges.json")


def get_airbases() -> dict:
    """Per-theater airbase data."""
    return _load_json("airbases.json")


def get_lotatc_airbases() -> dict:
    """
    Supplementary per-theater airbase data extracted from LotAtc tile
    metadata. Covers theaters that pydcs and the curated airbases.json
    don't yet have (Kola, GermanyCW, SinaiMap) plus extras for Falklands.
    Generated from `C:\\Program Files\\LotAtc\\map\\<theater>\\airports\\*.mbtiles`
    via the metadata `center` field. Names are ICAO-style codes.
    Returns {} if the file is missing — this is a soft-optional source.
    """
    try:
        return _load_json("airbases_lotatc.json")
    except FileNotFoundError:
        return {}
