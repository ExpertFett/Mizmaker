"""Unit extraction and weapon resolution from parsed DCS mission dicts.

Ported from 856's lua_parser.py — extracts client units, loadout data,
datalink info, liveries, statistics, and country breakdowns.
"""

import re
import json
import os
from collections import OrderedDict

from reference.loader import (
    get_weapons,
    get_weapon_weights,
    get_pylons,
    get_launcher_settings,
)


# ─── Reference data (lazy-loaded from pydcs) ─────────────────────────────

WEAPONS_DB = get_weapons()
WEAPON_WEIGHTS = get_weapon_weights()
PYLON_DB = get_pylons()
LAUNCHER_SETTINGS_DB = get_launcher_settings()

# Set of CLSIDs that have a laser_code setting
LASER_CLSIDS = set()
for _clsid, _info in LAUNCHER_SETTINGS_DB.items():
    for _s in _info.get("settings", []):
        if _s.get("control") == "laserCode":
            LASER_CLSIDS.add(_clsid)
            break


# ─── Task and preset constants ─────────────────────────────────────────────

AIR_TASKS = [
    "Nothing", "CAS", "CAP", "SEAD", "Strike", "Escort", "AFAC",
    "Refueling", "AWACS", "Transport", "Recon", "Intercept",
    "Fighter Sweep", "Ground Attack", "Antiship Strike", "Runway Attack",
]
GROUND_TASKS = ["Ground Nothing", "Ground Attack", "Ground CAS", "Ground AFAC", "Fire At Point"]
SHIP_TASKS = ["Nothing", "Patrolling", "Ground Attack", "Escort", "Antiship Strike"]

COALITION_COLORS = {"blue": "#4a90d9", "red": "#d94a4a", "neutrals": "#a0a0a0"}

WEATHER_PRESETS = {
    "Clear Sky": {
        "clouds": {"density": 0, "thickness": 200, "base": 300, "iprecptns": 0},
        "enable_fog": False, "fogVisibility": 0, "fogThickness": 0,
        "visibility": {"distance": 80000}, "groundTurbulence": 0,
        "enable_dust": False, "dustDensity": 0,
    },
    "Partly Cloudy": {
        "clouds": {"density": 3, "thickness": 400, "base": 1500, "iprecptns": 0},
        "enable_fog": False, "fogVisibility": 0, "fogThickness": 0,
        "visibility": {"distance": 50000}, "groundTurbulence": 15,
        "enable_dust": False, "dustDensity": 0,
    },
    "Overcast": {
        "clouds": {"density": 7, "thickness": 800, "base": 600, "iprecptns": 0},
        "enable_fog": False, "fogVisibility": 0, "fogThickness": 0,
        "visibility": {"distance": 30000}, "groundTurbulence": 25,
        "enable_dust": False, "dustDensity": 0,
    },
    "Light Rain": {
        "clouds": {"density": 8, "thickness": 1000, "base": 500, "iprecptns": 1},
        "enable_fog": False, "fogVisibility": 0, "fogThickness": 0,
        "visibility": {"distance": 15000}, "groundTurbulence": 35,
        "enable_dust": False, "dustDensity": 0,
    },
    "Heavy Storm": {
        "clouds": {"density": 10, "thickness": 1500, "base": 300, "iprecptns": 2},
        "enable_fog": False, "fogVisibility": 0, "fogThickness": 0,
        "visibility": {"distance": 8000}, "groundTurbulence": 80,
        "enable_dust": False, "dustDensity": 0,
    },
    "Foggy": {
        "clouds": {"density": 1, "thickness": 200, "base": 300, "iprecptns": 0},
        "enable_fog": True, "fogVisibility": 500, "fogThickness": 100,
        "visibility": {"distance": 4000}, "groundTurbulence": 0,
        "enable_dust": False, "dustDensity": 0,
    },
    "Dust Storm": {
        "clouds": {"density": 0, "thickness": 200, "base": 300, "iprecptns": 0},
        "enable_fog": False, "fogVisibility": 0, "fogThickness": 0,
        "visibility": {"distance": 2000}, "groundTurbulence": 60,
        "enable_dust": True, "dustDensity": 3000,
    },
}

UNIT_CATEGORIES = ("plane", "helicopter", "vehicle", "ship", "static")

SAM_THREAT_RANGES = {
    "S-300PS 40B6M tr": 120000, "S-300PS 64H6E sr": 120000,
    "S-300PS 40B6MD sr": 120000, "Kub 1S91 str": 24000,
    "SA-11 Buk LN 9A310M1": 45000, "SA-11 Buk SR 9S18M1": 45000,
    "Tor 9A331": 12000, "SA-15 Gauntlet": 12000,
    "2S6 Tunguska": 8000, "Tunguska": 8000,
    "Strela-10M3": 5000, "Strela-1 9P31": 4200,
    "ZSU-23-4 Shilka": 2500, "SA-9 Gaskin MT-LB 9M31": 4200,
    "Hawk pcp": 45000, "Hawk ln": 45000,
    "MIM-104 Patriot": 100000, "Roland ADS": 8000,
    "Avenger": 5500, "M6 Linebacker": 8000, "M163 Vulcan": 1500,
    "rapier_fsa_launcher": 7000, "rapier_fsa_optical_tracker_unit": 7000,
    "Osa 9A33 ln": 9000, "SA-8 Osa": 9000,
    "ZU-23 Emplacement": 2500, "ZU-23 Emplacement Closed": 2500,
}


# ─── Weapon name helpers ───────────────────────────────────────────────────

def resolve_clsid(clsid: str) -> str:
    """Get human-readable weapon name from CLSID."""
    return WEAPONS_DB.get(clsid, clsid)


def short_weapon_name(name: str) -> str:
    """Shorten verbose DCS weapon display names for the UI.

    Strips rack prefixes (BRU-33, TER-9A, etc.), adapter text, verbose
    descriptions, and reduces names like 'BRU-55 with 2 x GBU-38 - JDAM,
    500lb GPS Guided Bomb' down to '2x GBU-38 JDAM'.
    """
    if not name or name.startswith("{"):
        return name

    s = name

    # Strip "(Special Weapons Adapter)" prefix/suffix
    s = re.sub(r'\(Special Weapons Adapter\)\s*', '', s).strip()

    # Strip rack prefixes: BRU-33, TER-9A, MER-*, MBD*
    s = re.sub(
        r'^(?:BRU-\d+[A-Z]?|TER-\d+[A-Z]?|MER-\d+[A-Z]?|MBD\d[A-Z]*[\w-]*)'
        r'\s*(?:with|:)?\s*', '', s).strip()

    # Strip adapter prefixes: "AUF 2 -", "CLB 4 -", "14-3-M2 -", "30-6-M2 -"
    s = re.sub(r'^(?:AUF|CLB|MBD|ABD)\s*\d+\s*-\s*', '', s).strip()
    s = re.sub(r'^\d+-\d+-M\d+\s*-\s*', '', s).strip()

    # Strip rack suffixes: "(TER)", "(MER)", "(Dual)", "(Triple)"
    s = re.sub(r'\s*\((?:TER|MER|Dual|Triple)\)\s*$', '', s).strip()

    # Strip LAU-117/118 parenthetical
    s = re.sub(r'\s*\(LAU-\d+\)\s*', ' ', s).strip()

    # Strip LAU-115/127 adapter chains
    s = re.sub(r'^LAU-\d+[A-Z/]*\s+with\s+\d+\s*x\s+(?:LAU-\d+[A-Z/]*\s+)?',
               '', s).strip()
    s = re.sub(r'^LAU-\d+[A-Z/]*\s+with\s+', '', s).strip()
    s = re.sub(r'^LAU-\d+[A-Z/]*\s*-\s*', '', s).strip()
    s = re.sub(r'^LAU-\d+[A-Z/]*\s+(?=AIM|AGM|R-|Kh-)', '', s).strip()

    # "N x Weapon" multiplier pattern
    m = re.match(r'^(\d+)\s*x\s+(.*)', s)
    if m:
        count = m.group(1)
        weapon = m.group(2)
        # Nested rack+pod: "2 x LAU-131 - 7 x ..."
        inner = re.match(r'(?:LAU-\d+|M261|M260)\s*-\s*(\d+)\s*x\s+(.*)',
                         weapon)
        if inner:
            return f"{count}x {_shorten_rocket_payload(inner.group(1), inner.group(2))}"
        # Rocket payload without pod prefix: "7 x Laser Guided Rkts..."
        if re.search(r'Rkts|Hydra|Zuni|APKWS', weapon):
            return f"{count}x {_shorten_rocket_payload(count, weapon)}"
        return f"{count}x {_shorten_single(weapon)}"

    s = _shorten_single(s)
    return s.strip()


def _shorten_rocket_payload(count: str, rest: str) -> str:
    """Shorten a rocket payload description."""
    if 'APKWS' in rest:
        warhead = re.search(r'(M\d+\w*)\s*(?:MPP|HE|WP)', rest)
        wh = warhead.group(1) if warhead else ''
        return f"APKWS {wh}".strip()
    warhead = re.search(r'(M\d+\w*|Mk\s*\d+\w*|WTU-\d+\w*)', rest)
    wh = warhead.group(1) if warhead else ''
    if 'Zuni' in rest:
        return f"Zuni {wh}".strip()
    if 'Hydra' in rest or 'Rkts' in rest:
        return f"Hydra {wh}".strip()
    return f"Rockets {wh}".strip()


def _shorten_single(name: str) -> str:
    """Shorten a single weapon name (no multiplier prefix)."""
    s = name.strip()

    # Fuel tanks
    if re.search(r'fuel.tank|ext.tank|drop.tank|ptt', s, re.IGNORECASE):
        # Look for a designator like "FPU-8A" at the start
        m = re.match(r'((?:FPU|PTB|MFT)[\w/.-]+)', s)
        if m:
            return f"{m.group(1)} Fuel Tank"
        return "Fuel Tank"

    # Targeting pods
    if re.search(r'targeting.pod|(?<!\w)flir|litening|sniper|lantirn|damocles',
                 s, re.IGNORECASE):
        for pod in ['ATFLIR', 'LITENING', 'Sniper', 'LANTIRN', 'Damocles']:
            if pod.lower() in s.lower():
                return f"{pod} TGP"
        m = re.match(r'([\w/.-]+)', s)
        return f"{m.group(1)} TGP" if m else s

    # Laser spot tracker
    if 'LST' in s or 'Spot Tracker' in s:
        return 'AN/ASQ-173 LST/SCAM'

    # AIM missiles
    m = re.match(r'(AIM-\d+\w*)\s*([\w-]+)?', s)
    if m:
        result = m.group(1)
        if m.group(2) and m.group(2) not in ('-',):
            result += f" {m.group(2)}"
        return result

    # AGM missiles
    m = re.match(r'(AGM-\d+\w*)\s*-?\s*'
                 r'(Maverick\s*\w+|HARM|Harpoon|SLAM-ER|SLAM|Shrike|Bullpup)?',
                 s)
    if m and m.group(0).strip():
        designation = m.group(1)
        nickname = m.group(2)
        if nickname:
            return f"{designation} {nickname.strip()}"
        return designation

    # GBU guided bombs
    m = re.match(r'(GBU-\d+(?:\([^)]*\))?(?:\d+)?(?:/\w+)?)\s*'
                 r'(?:-\s*)?(JDAM|Paveway\s*\w*)?', s)
    if m:
        result = m.group(1)
        if m.group(2):
            result += f" {m.group(2).strip()}"
        return result

    # Mk bombs
    m = re.match(r'(Mk-?\d+\w*(?:\s*AIR)?)', s, re.IGNORECASE)
    if m:
        result = m.group(1)
        if 'AIR' in s.upper() and 'AIR' not in result.upper():
            result += ' AIR'
        return result

    # Russian bombs
    m = re.match(r'((?:FAB|OFAB|BetAB|RBK|KAB|SAB|PTAB|BAP)-\d+[\w-]*)', s)
    if m:
        return m.group(1).strip().rstrip('-')

    # Russian rockets
    m = re.match(r'(S-\d+\w+)', s)
    if m:
        return m.group(1)

    # Russian missiles
    m = re.match(r'((?:R-\d+\w*|Kh-\d+\w*))', s)
    if m:
        return m.group(1)

    # Durandal
    if 'Durandal' in s:
        return 'BLU-107 Durandal'

    # Smoke generators — keep the color
    m = re.match(r'(Smoke Generator\s*-\s*\w+)', s, re.IGNORECASE)
    if m:
        return m.group(1).strip()

    # Generic: strip everything after " - "
    m = re.match(r'([\w/.()\s-]+?)\s*-\s', s)
    if m:
        return m.group(1).strip()

    return s


def categorize_weapon(name: str) -> str:
    """Categorize a weapon by its display name."""
    n = name.lower()

    # A/A missiles
    if any(k in n for k in [
        'aim-9', 'aim-7', 'aim-54', 'aim-120', 'sidewinder', 'amraam',
        'sparrow', 'phoenix', 'captive aim', 'catm', 'acmi',
        'r-27', 'r-73', 'r-77', 'r-60', 'r-13', 'r-3',
        'magic', 'mica', 'super 530', 'derby', 'python',
        'pl-5', 'pl-8', 'pl-12', 'iris-t',
    ]) or ('aam' in n and 'slam' not in n):
        return 'A/A'

    # A/G missiles (AGM, anti-ship, ATGM)
    if any(k in n for k in [
        'agm-', 'maverick', 'harpoon', 'slam', 'penguin', 'walleye',
        'hellfire', 'tow', 'ataka', 'vikhr', 'shturm', 'hot-3',
        'kh-', 'c-801', 'c-802', 'harm', 'shrike', 'sidearm',
        'bullpup', 'jsow', 'alarm', 'martel', 'sea eagle',
        'exocet', 'kormoran', 'as-30', 'nord',
        'atgm', 'anti-radiation', 'anti-ship', 'standoff',
    ]):
        return 'A/G Missile'

    # Guided bombs (GPS, laser, TV)
    if any(k in n for k in [
        'gbu-', 'jdam', 'paveway', 'lgb', 'laser guided',
        'kab-', 'eogb', 'gps guided', 'tv guided',
    ]):
        return 'Guided Bomb'

    # Decoys
    if any(k in n for k in [
        'tald', 'decoy', 'mald', 'adt', 'chaff', 'flare pod',
    ]):
        return 'Decoy'

    # Unguided bombs and dispensers
    if any(k in n for k in [
        'mk-8', 'mk82', 'mk83', 'mk84', 'mk 8', 'mk-20',
        'bdu', 'bomb', 'fab-', 'ofab', 'betab', 'rbk-',
        'snakeye', 'retarded', 'cbu', 'cluster', 'rockeye',
        'bru-', 'bru33', 'bru55', 'bru41', 'bru42',
        'sab-', 'ptab', 'suu-', 'luu-',
        'an-m', 'mc-', 'm117', 'sc ', 'sd ',
    ]):
        return 'Bomb'

    # Rockets
    if any(k in n for k in [
        'rocket', 'hydra', 'zuni', 'ffar', 'hvar', 'wgr',
        'lau-10', 'lau-61', 'lau-68', 'lau-131', 'lau-3',
        's-5', 's-8', 's-13', 's-24', 's-25', 'b-8', 'ub-',
        'rp-3', 'sneb', 'matra', 'rkts', 'arakm', 'apkws',
    ]):
        return 'Rocket'

    # Fuel tanks
    if any(k in n for k in ['fuel', 'tank', 'ptt']):
        return 'Fuel'

    # Pods (targeting, ECM, recon, data)
    if any(k in n for k in [
        'pod', 'flir', 'litening', 'sniper', 'lantirn', 'targeting',
        'an/a', 'ecm', 'jammer', 'mercury', 'tgp',
        'designat', 'recon', 'data link', 'kab-d', 'mws',
    ]):
        return 'Pod'

    # Gun pods
    if any(k in n for k in [
        'gun', 'cannon', 'gau', 'gsh', 'sppu', 'gunpod', 'upk',
        'akan', 'aden', 'defa', 'brauning', 'm3p', 'm134', 'm60',
        'pkt', 'kord',
    ]):
        return 'Gun Pod'

    # Smoke
    if 'smoke' in n:
        return 'Smoke'

    return 'Other'


# ─── Launcher settings helpers ─────────────────────────────────────────────

def get_launcher_settings(clsid: str) -> dict | None:
    """Get the settings schema for a CLSID (for the frontend UI)."""
    return LAUNCHER_SETTINGS_DB.get(clsid)


def build_default_settings(clsid: str) -> dict:
    """Build a dict of default setting values for a CLSID.

    Returns the settings as they should appear in the mission file,
    only including settings that are visible given the default selections.
    """
    entry = LAUNCHER_SETTINGS_DB.get(clsid)
    if not entry:
        return {}

    settings_schema = entry["settings"]

    # First pass: collect all default values
    defaults = {}
    for s in settings_schema:
        if s.get("readOnly"):
            continue
        defaults[s["id"]] = s["defValue"]

    # Second pass: filter by visibility conditions
    # Only include settings whose conditions are satisfied by the defaults
    visible = {}
    for s in settings_schema:
        if s.get("readOnly"):
            continue
        vis = s.get("visCondition")
        if vis and not _check_visibility(vis, defaults):
            continue
        # DCS mission files strip the "NN_prfx_" prefix from setting IDs
        mission_key = _schema_id_to_mission_key(s["id"])
        visible[mission_key] = s["defValue"]

    return visible


def _schema_id_to_mission_key(schema_id: str) -> str:
    """Convert a launcher schema setting ID to the key DCS writes in mission files.

    Schema IDs like '01_prfx_arm_delay_ctrl_FMU139CB_LD' become
    'arm_delay_ctrl_FMU139CB_LD' in the mission file.

    IDs like 'NFP_00_prfx_arm_delay_ctrl_M904E4' become
    'NFP_arm_delay_ctrl_M904E4' -- the NFP_ prefix is preserved,
    only the NN_prfx_ part is stripped.
    """
    m = re.match(r'((?:NFP_)?)\d+_prfx_(.*)', schema_id)
    if m:
        return m.group(1) + m.group(2)
    return schema_id


def _check_visibility(conditions: list, values: dict) -> bool:
    """Evaluate a VisibilityCondition against a set of values."""
    # conditions is [cond1, "and"/"or", cond2, ...]
    result = True
    current_op = "and"

    for item in conditions:
        if isinstance(item, str) and item in ("and", "or"):
            current_op = item
            continue

        if isinstance(item, dict):
            cond_id = item["id"]
            cond_val = item["value"]
            current_val = values.get(cond_id)
            match = (current_val == cond_val)
            if item.get("bNot"):
                match = not match

            if current_op == "and":
                result = result and match
            else:
                result = result or match

    return result


# ─── Pylon options ─────────────────────────────────────────────────────────

def get_pylon_options(aircraft_type: str) -> dict:
    """Get valid weapon options per station for an aircraft type.

    Returns {station_number: [{clsid, name, shortName, category, weight}, ...]}
    Enriched with weapon weights from pydcs.
    """
    pylons = PYLON_DB.get(aircraft_type, {})
    result = {}
    for station, clsids in pylons.items():
        if isinstance(clsids, list):
            result[int(station)] = [
                {
                    "clsid": c,
                    "name": resolve_clsid(c),
                    "shortName": short_weapon_name(resolve_clsid(c)),
                    "category": categorize_weapon(resolve_clsid(c)),
                    "weight": WEAPON_WEIGHTS.get(c),
                }
                for c in clsids
                if c != "<CLEAN>"
            ]
    return result


# ─── Iteration helpers ─────────────────────────────────────────────────────

def _iter_units(mission: dict):
    """Yield (coalition_name, country_name, category, group, unit) for air units.

    Only iterates over 'plane' and 'helicopter' categories.
    Handles both dict-style and list-style Lua table outputs from slpp.
    """
    coalitions = mission.get("coalition", {})
    for coal_name, coal in coalitions.items():
        countries = coal.get("country", {})
        if isinstance(countries, dict):
            countries = list(countries.values())
        for country in countries:
            if not isinstance(country, dict):
                continue
            country_name = country.get("name", "?")
            for cat in ("plane", "helicopter"):
                cat_data = country.get(cat, {})
                if not cat_data:
                    continue
                groups = cat_data.get("group", {})
                if isinstance(groups, dict):
                    groups = list(groups.values())
                for group in groups:
                    if not isinstance(group, dict):
                        continue
                    units = group.get("units", {})
                    if isinstance(units, dict):
                        units = list(units.values())
                    for unit in units:
                        if isinstance(unit, dict):
                            yield coal_name, country_name, cat, group, unit


def _iter_all_units(mission: dict):
    """Yield (coalition_name, country_name, category, group, unit) for ALL unit categories.

    Iterates over plane, helicopter, vehicle, and ship categories.
    Handles both dict-style and list-style Lua table outputs from slpp.
    """
    coalitions = mission.get("coalition", {})
    for coal_name, coal in coalitions.items():
        countries = coal.get("country", {})
        if isinstance(countries, dict):
            countries = list(countries.values())
        for country in countries:
            if not isinstance(country, dict):
                continue
            country_name = country.get("name", "?")
            for cat in ("plane", "helicopter", "vehicle", "ship"):
                cat_data = country.get(cat, {})
                if not cat_data:
                    continue
                groups = cat_data.get("group", {})
                if isinstance(groups, dict):
                    groups = list(groups.values())
                for group in groups:
                    if not isinstance(group, dict):
                        continue
                    units = group.get("units", {})
                    if isinstance(units, dict):
                        units = list(units.values())
                    for unit in units:
                        if isinstance(unit, dict):
                            yield coal_name, country_name, cat, group, unit


def _iter_all_units_with_static(mission: dict):
    """Yield (coalition, country_name, category, group, unit) including statics.

    Iterates over all UNIT_CATEGORIES: plane, helicopter, vehicle, ship, static.
    Handles both dict-style and list-style Lua table outputs from slpp.
    """
    coalitions = mission.get("coalition", {})
    for coal_name, coal in coalitions.items():
        countries = coal.get("country", {})
        if isinstance(countries, dict):
            countries = list(countries.values())
        for country in countries:
            if not isinstance(country, dict):
                continue
            country_name = country.get("name", "?")
            for cat in UNIT_CATEGORIES:
                cat_data = country.get(cat, {})
                if not cat_data:
                    continue
                groups = cat_data.get("group", {})
                if isinstance(groups, dict):
                    groups = list(groups.values())
                for group in groups:
                    if not isinstance(group, dict):
                        continue
                    units = group.get("units", {})
                    if isinstance(units, dict):
                        units = list(units.values())
                    for unit in units:
                        if isinstance(unit, dict):
                            yield coal_name, country_name, cat, group, unit


# ─── Unit ID map ───────────────────────────────────────────────────────────

def build_unit_id_map(mission: dict) -> dict:
    """Build a map of unitId -> unit name for all units (for donor resolution)."""
    id_map = {}
    for _, _, _, _, unit in _iter_units(mission):
        uid = unit.get("unitId")
        if uid is not None:
            id_map[uid] = {
                "name": unit.get("name", "?"),
                "type": unit.get("type", "?"),
            }
    return id_map


# ─── Client unit extraction ───────────────────────────────────────────────

def find_client_units(mission: dict) -> list:
    """Find all client (player) units and extract datalink info."""
    unit_id_map = build_unit_id_map(mission)
    clients = []

    for coal_name, country_name, cat, group, unit in _iter_units(mission):
        if unit.get("skill") != "Client":
            continue

        props = unit.get("AddPropAircraft", {})
        datalinks = unit.get("datalinks", {})
        link16 = datalinks.get("Link16", {})
        network = link16.get("network", {})

        # Extract donors
        donors_raw = network.get("donors", {})
        if isinstance(donors_raw, dict):
            donors_raw = list(donors_raw.values())
        donors = []
        for d in donors_raw:
            if isinstance(d, dict):
                mid = d.get("missionUnitId")
                if mid is not None:
                    mid = int(mid)
                    info = unit_id_map.get(mid, {})
                    donors.append({
                        "missionUnitId": mid,
                        "name": info.get("name", f"Unit {mid}"),
                        "type": info.get("type", "?"),
                    })

        # Extract team members
        members_raw = network.get("teamMembers", {})
        if isinstance(members_raw, dict):
            members_raw = list(members_raw.values())
        members = []
        for m in members_raw:
            if isinstance(m, dict):
                mid = m.get("missionUnitId")
                if mid is not None:
                    mid = int(mid)
                    info = unit_id_map.get(mid, {})
                    members.append({
                        "missionUnitId": mid,
                        "name": info.get("name", f"Unit {mid}"),
                        "type": info.get("type", "?"),
                    })

        # Extract loadout
        payload = unit.get("payload", {})
        pylons_raw = payload.get("pylons", {})
        # Lupa returns lists for sequential int-keyed tables, slpp returns dicts
        if isinstance(pylons_raw, list):
            pylons_raw = {i + 1: v for i, v in enumerate(pylons_raw) if isinstance(v, dict)}
        elif isinstance(pylons_raw, dict):
            pylons_raw = {int(k): v for k, v in pylons_raw.items() if isinstance(v, dict)}
        pylons = []
        laser_code = None
        for pnum in sorted(pylons_raw.keys()):
            p = pylons_raw[pnum]
            clsid = p.get("CLSID", "")
            full_name = resolve_clsid(clsid)
            pylons.append({
                "number": pnum,
                "clsid": clsid,
                "name": full_name,
                "shortName": short_weapon_name(full_name),
            })
            # Extract laser code from first laser-carrying pylon
            if laser_code is None and clsid in LASER_CLSIDS:
                settings = p.get("settings", {})
                if isinstance(settings, dict) and "laser_code" in settings:
                    laser_code = int(settings["laser_code"])

        clients.append({
            "unitId": int(unit.get("unitId", 0)),
            "name": unit.get("name", "?"),
            "type": unit.get("type", "?"),
            "groupName": group.get("name", "?"),
            "coalition": coal_name,
            "voiceCallsignLabel": props.get("VoiceCallsignLabel", ""),
            "voiceCallsignNumber": props.get("VoiceCallsignNumber", ""),
            "stnL16": props.get("STN_L16", ""),
            "donors": donors,
            "teamMembers": members,
            "hasDatalinks": bool(datalinks),
            "pylons": pylons,
            "laserCode": laser_code,
            "fuel": payload.get("fuel", 0),
            "flare": payload.get("flare", 0),
            "chaff": payload.get("chaff", 0),
            "gun": payload.get("gun", 0),
        })

    return clients


# Short-form CLSID patterns for laser-guided weapons (DCS ME sometimes writes
# these instead of full UUIDs, e.g. "{GBU-24}", "{BRU33*GBU-12}").
import re as _re_laser
_LASER_SHORTFORM = _re_laser.compile(
    r'GBU[-\s_]?1[0246]|GBU[-\s_]?24|GBU[-\s_]?27|GBU[-\s_]?28|'
    r'Paveway|LGB|KAB[-\s_]?500L|KAB[-\s_]?1500L|LJDAM|'
    r'AGM[-\s_]?65[EKL]|AGM[-\s_]?114[KL]|APKWS|Maverick[-\s_]?E',
    _re_laser.IGNORECASE,
)


def _pylon_is_laser(clsid: str) -> bool:
    """True if CLSID is a laser-guided weapon (full UUID in LASER_CLSIDS OR short form)."""
    if not clsid:
        return False
    if clsid in LASER_CLSIDS:
        return True
    return bool(_LASER_SHORTFORM.search(clsid))


def find_laser_capable_units(mission: dict) -> list:
    """Find ALL air units (client or AI) carrying laser-guided weapons or
    with an existing laser_code set. Used by the LaserTab so mission makers
    can edit AI flight laser codes (JTAC birds, buddy-lase flights, etc.).

    Returns a list of {unitId, name, type, groupName, coalition, isClient,
    pylons[], laserCode} — a subset of find_client_units' shape.
    """
    out = []
    for coal_name, _country, _cat, group, unit in _iter_units(mission):
        payload = unit.get("payload", {})
        pylons_raw = payload.get("pylons", {})
        if isinstance(pylons_raw, list):
            pylons_raw = {i + 1: v for i, v in enumerate(pylons_raw) if isinstance(v, dict)}
        elif isinstance(pylons_raw, dict):
            pylons_raw = {int(k): v for k, v in pylons_raw.items() if isinstance(v, dict)}

        pylons = []
        laser_code = None
        has_laser_weapon = False
        for pnum in sorted(pylons_raw.keys()):
            p = pylons_raw[pnum]
            clsid = p.get("CLSID", "")
            full_name = resolve_clsid(clsid)
            pylons.append({
                "number": pnum,
                "clsid": clsid,
                "name": full_name,
                "shortName": short_weapon_name(full_name),
            })
            if _pylon_is_laser(clsid):
                has_laser_weapon = True
            if laser_code is None:
                settings = p.get("settings", {})
                if isinstance(settings, dict) and "laser_code" in settings:
                    try:
                        laser_code = int(settings["laser_code"])
                    except (TypeError, ValueError):
                        pass

        if not has_laser_weapon and laser_code is None:
            continue

        out.append({
            "unitId": int(unit.get("unitId", 0)),
            "name": unit.get("name", "?"),
            "type": unit.get("type", "?"),
            "groupName": group.get("name", "?"),
            "coalition": coal_name,
            "isClient": unit.get("skill") == "Client",
            "pylons": pylons,
            "laserCode": laser_code,
        })
    return out


# ─── Donor selection ───────────────────────────────────────────────────────

def get_all_units_for_donor_selection(mission: dict) -> list:
    """Get all units (not just clients) for the donor selection dropdown."""
    units = []
    for coal_name, _, _, group, unit in _iter_units(mission):
        uid = unit.get("unitId")
        if uid is not None:
            units.append({
                "unitId": int(uid),
                "name": unit.get("name", "?"),
                "type": unit.get("type", "?"),
                "groupName": group.get("name", "?"),
                "coalition": coal_name,
            })
    return units


# ─── Group extraction ──────────────────────────────────────────────────────

def extract_all_groups(mission: dict) -> list:
    """Extract all groups with their units for the group renamer tab."""
    seen = set()
    groups = []

    for coal_name, _, cat, group, unit in _iter_all_units(mission):
        gid = group.get("groupId")
        if gid is None:
            continue
        gid = int(gid)

        if gid not in seen:
            seen.add(gid)
            units_raw = group.get("units", {})
            if isinstance(units_raw, dict):
                units_list = sorted(units_raw.values(),
                                    key=lambda u: int(u.get("unitId", 0)) if isinstance(u, dict) else 0)
            else:
                units_list = units_raw

            unit_entries = []
            for u in units_list:
                if isinstance(u, dict):
                    unit_entries.append({
                        "unitId": int(u.get("unitId", 0)),
                        "name": u.get("name", "?"),
                        "type": u.get("type", "?"),
                    })

            groups.append({
                "groupId": gid,
                "groupName": group.get("name", "?"),
                "coalition": coal_name,
                "category": cat,
                "unitCount": len(unit_entries),
                "units": unit_entries,
            })

    return groups


# ─── Livery extraction ─────────────────────────────────────────────────────

def extract_livery_data(mission: dict) -> list:
    """Extract all units with livery info, grouped by unit type.

    Returns list of dicts: {type, coalition, category, units: [{unitId, name, groupName, livery_id}]}
    """
    by_type = OrderedDict()

    for coal_name, _, cat, group, unit in _iter_all_units(mission):
        utype = unit.get("type", "?")
        uid = unit.get("unitId")
        if uid is None:
            continue
        livery = unit.get("livery_id", "")
        key = utype
        if key not in by_type:
            by_type[key] = {
                "type": utype,
                "coalition": coal_name,
                "category": cat,
                "units": [],
                "liveries": set(),
            }
        by_type[key]["units"].append({
            "unitId": int(uid),
            "name": unit.get("name", "?"),
            "groupName": group.get("name", "?"),
            "livery_id": livery,
        })
        if livery:
            by_type[key]["liveries"].add(livery)

    result = []
    for entry in by_type.values():
        entry["liveries"] = sorted(entry["liveries"])
        result.append(entry)
    # Sort by category then type
    result.sort(key=lambda x: (x["category"], x["type"]))
    return result


# ─── Statistics ────────────────────────────────────────────────────────────

def extract_statistics(mission: dict) -> dict:
    """Extract mission statistics."""
    stats = {"totalUnits": 0, "totalGroups": 0, "planes": 0, "helicopters": 0,
             "vehicles": 0, "ships": 0, "statics": 0, "samAaa": 0, "typeBreakdown": {}}
    group_ids = set()
    cat_map = {"plane": "planes", "helicopter": "helicopters", "vehicle": "vehicles",
               "ship": "ships", "static": "statics"}
    for _, _, cat, group, unit in _iter_all_units_with_static(mission):
        stats["totalUnits"] += 1
        field = cat_map.get(cat)
        if field:
            stats[field] += 1
        utype = unit.get("type", "?")
        stats["typeBreakdown"][utype] = stats["typeBreakdown"].get(utype, 0) + 1
        if utype in SAM_THREAT_RANGES:
            stats["samAaa"] += 1
        gid = group.get("groupId")
        if gid:
            group_ids.add(gid)
    stats["totalGroups"] = len(group_ids)
    return stats


# ─── Country extraction ───────────────────────────────────────────────────

def extract_countries(mission: dict) -> list:
    """Extract country list with unit type breakdowns for batch edit."""
    country_data = {}
    for coal_name, country_name, cat, group, unit in _iter_all_units_with_static(mission):
        key = (coal_name, country_name)
        if key not in country_data:
            country_data[key] = {
                "name": country_name,
                "coalition": coal_name,
                "color": COALITION_COLORS.get(coal_name, "#888"),
                "unitCount": 0,
                "unitTypes": {},
                "categories": {},
            }
        cd = country_data[key]
        cd["unitCount"] += 1
        utype = unit.get("type", "?")
        cd["unitTypes"][utype] = cd["unitTypes"].get(utype, 0) + 1
        cd["categories"][cat] = cd["categories"].get(cat, 0) + 1

    return sorted(country_data.values(), key=lambda c: (-c["unitCount"], c["name"]))


# ─── Datalink suggestions ─────────────────────────────────────────────────

def generate_datalink_suggestions(client_units: list) -> list:
    """Generate auto-fill suggestions for datalink callsigns and STNs.

    For each group, uses the lead aircraft's callsign label and STN as the base,
    then suggests consistent label, number, and STN for all wingmen.

    Returns a list of suggested edits: {unitId, field, value, reason}
    """
    # Group units by groupName, preserving order
    groups = {}
    for u in client_units:
        g = u["groupName"]
        if g not in groups:
            groups[g] = []
        groups[g].append(u)

    suggestions = []

    for group_name, units in groups.items():
        if len(units) < 2:
            continue

        lead = units[0]
        lead_label = lead["voiceCallsignLabel"]
        lead_number = lead["voiceCallsignNumber"]
        lead_stn = lead["stnL16"]

        # Skip groups where lead has no callsign data. "ED" is DCS's
        # default placeholder (Eagle Dynamics) for units the mission
        # designer never set — treating it as a real callsign would
        # propagate "ED" to every wingman, which is what the user saw
        # on auto-assign. Treat as unset.
        if not lead_label or lead_label.strip().upper() == "ED":
            continue
        if not lead_number or not lead_stn:
            continue

        # Parse lead's number to get flight number
        # Format is typically "XY" where X=flight, Y=member (e.g., "11" = flight 1 member 1)
        if len(lead_number) < 2:
            continue
        flight_num = lead_number[:-1]  # everything except last digit
        lead_member = lead_number[-1]  # last digit (should be "1" for lead)

        # Parse lead's STN to compute base
        try:
            lead_stn_int = int(lead_stn)
        except (ValueError, TypeError):
            continue

        for i, unit in enumerate(units[1:], start=2):
            # Expected values
            expected_label = lead_label
            expected_number = flight_num + str(int(lead_member) + i - 1)
            expected_stn = str(lead_stn_int + i - 1).zfill(len(lead_stn))

            # Only suggest if current value differs
            if unit["voiceCallsignLabel"] != expected_label:
                suggestions.append({
                    "unitId": unit["unitId"],
                    "field": "voiceCallsignLabel",
                    "value": expected_label,
                    "current": unit["voiceCallsignLabel"],
                })

            if unit["voiceCallsignNumber"] != expected_number:
                suggestions.append({
                    "unitId": unit["unitId"],
                    "field": "voiceCallsignNumber",
                    "value": expected_number,
                    "current": unit["voiceCallsignNumber"],
                })

            if unit["stnL16"] != expected_stn:
                suggestions.append({
                    "unitId": unit["unitId"],
                    "field": "stnL16",
                    "value": expected_stn,
                    "current": unit["stnL16"],
                })

    return suggestions
