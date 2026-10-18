"""OlympusLite relay core — server-side bridge to an OlympusLite GameGUI hook.

OlympusLite (Claude Dump/OlympusLite) is a single-file LuaSocket hook that
stands in for DCS Olympus. It serves the live picture as plain JSON and takes
one JSON command object per POST, so there is no binary decoder here. A server
profile with kind='olympuslite' routes through this module instead of
services/olympus_bridge.py; the browser keeps speaking the Olympus command
vocabulary (spawnGroundUnits / setPath / setROE / deleteUnit / smoke / ...) and
this module translates it.

API (OlympusLite README, v0.1.0):
  GET  /health    no auth   {ok, version, installed, state, mission, modelTime}
  GET  /units     any role  {time, units:[...], statics:[...], role}
  GET  /airbases  any role  [{name, id, coalition, kind, lat, lon}]
  POST /command   gm/blue/red  {"command": ..., ...} -> {ok, ...} | 400 {ok:false, error}
  Auth: "X-OLite-Key: <password>" (the password picks the role). Default port 4513.

Like the Olympus bridge, connection params only ever come from a group's stored
server profile (membership-gated in services/groups.py) — there is no open relay.
On top of that this client refuses redirects (a hostile server can't bounce the
relay at an internal address), caps response size, and only ever requests the
fixed paths above.
"""

from __future__ import annotations

import json
import math
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Optional, Tuple

DEFAULT_PORT = 4513
_TIMEOUT = 10
_MAX_BYTES = 8 * 1024 * 1024
# Bare hostname / IPv4 only — no scheme, path, userinfo, port or IPv6 literal.
_HOST_RE = re.compile(r"^[A-Za-z0-9.\-]{1,253}$")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_a, **_k):
        return None  # surface 3xx as an HTTPError instead of following it


_OPENER = urllib.request.build_opener(_NoRedirect)


def _valid_host(host: Optional[str]) -> bool:
    return bool(host) and bool(_HOST_RE.match(host)) and ".." not in host


def olite_request(host: str, port: int, password: str, method: str, path: str,
                  body: Optional[dict] = None) -> Tuple[int, Any]:
    """One request to OlympusLite. Returns (status, parsed JSON). An HTTP 400
    from /command carries a JSON {ok:false,error} body, which is returned rather
    than raised. Other HTTP errors / transport failures raise urllib.error.*."""
    if not _valid_host(host):
        raise ValueError("bad host")
    if path not in ("health", "units", "airbases", "command"):
        raise ValueError("bad path")
    url = f"http://{host}:{int(port or DEFAULT_PORT)}/{path}"
    headers = {"X-OLite-Key": password or ""}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with _OPENER.open(req, timeout=_TIMEOUT) as r:
            raw = r.read(_MAX_BYTES + 1)
            status = r.status
    except urllib.error.HTTPError as e:
        if e.code != 400:
            raise
        raw, status = e.read(_MAX_BYTES + 1), 400
    if len(raw) > _MAX_BYTES:
        raise ValueError("response too large")
    return status, json.loads(raw.decode("utf-8", errors="replace"))


def _err(e: Exception, host: str, port: int) -> dict:
    if isinstance(e, urllib.error.HTTPError):
        if e.code in (401, 403):
            return {"ok": False, "error": "OlympusLite rejected the password (role auth)."}
        return {"ok": False, "error": f"OlympusLite returned HTTP {e.code}."}
    if isinstance(e, ValueError) and str(e) == "bad host":
        return {"ok": False, "error": "Server host must be a bare hostname or IP (no http://, no path)."}
    return {"ok": False, "error": f"Can't reach OlympusLite at {host}:{port or DEFAULT_PORT} ({e})."}


# --------------------------------------------------------------------------
# Picture mapping: OlympusLite JSON -> the decoded-Olympus unit shape LiveMap uses
# --------------------------------------------------------------------------
_COALITION = {"neutral": 0, "red": 1, "blue": 2}
_CATEGORY = {"air": "Aircraft", "helicopter": "Helicopter", "ground": "GroundUnit", "ship": "NavyUnit"}


def map_unit(u: dict) -> dict:
    """One OlympusLite unit -> the field names olympus_bridge.decode_units emits.
    olympusID is the DCS unit id (what commands then send back as ID). Heading
    goes degrees -> radians (Olympus convention). `controlled` marks units this
    tool spawned (OLITE-* groups), the closest analogue to Olympus-controlled."""
    life = u.get("life")
    hdg = u.get("heading")
    out = {
        "olympusID": u.get("id"),
        "unitID": u.get("id"),
        "groupID": u.get("groupId"),
        "name": u.get("type"),          # Olympus `name` = DCS type name
        "unitName": u.get("name"),
        "groupName": u.get("group"),
        "category": _CATEGORY.get(u.get("category"), u.get("category") or ""),
        "coalition": _COALITION.get(u.get("coalition"), 0),
        "alive": 1 if (life is None or life > 0) else 0,
        "human": 1 if u.get("player") else 0,
        "controlled": 1 if u.get("spawned") else 0,
        "position": {"lat": u.get("lat"), "lng": u.get("lon"), "alt": u.get("alt")},
        "speed": u.get("speed"),
    }
    if isinstance(hdg, (int, float)):
        out["heading"] = math.radians(hdg)
        out["track"] = out["heading"]
    if life is not None and u.get("life0"):
        out["health"] = max(0, min(100, round(100 * life / u["life0"])))
    if u.get("player"):
        out["callsign"] = u["player"]
    return out


def map_airbases(rows: list) -> dict:
    """[{name,id,coalition,kind,lat,lon}] -> Olympus {airbases: {k: {...}}}."""
    out = {}
    for i, a in enumerate(rows or []):
        out[str(i)] = {
            "callsign": a.get("name") or "",
            "unitId": a.get("id"),
            "coalition": a.get("coalition") or "neutral",
            "latitude": a.get("lat"),
            "longitude": a.get("lon"),
            "kind": a.get("kind"),
        }
    return {"airbases": out}


# Last picture per server, so commands keyed by Olympus-style numeric ID can be
# resolved to the group / unit NAMES OlympusLite commands take. Filled by every
# units poll; a command for an unknown ID triggers one fresh fetch.
_PICTURE: dict = {}
_PICTURE_LOCK = threading.Lock()
_PICTURE_TTL = 5.0


def _remember(host: str, port: int, units: list) -> None:
    by_id = {u.get("id"): u for u in units if u.get("id") is not None}
    with _PICTURE_LOCK:
        _PICTURE[(host, int(port or DEFAULT_PORT))] = (time.monotonic(), by_id)


def _fetch_units(host: str, port: int, password: str) -> list:
    _status, payload = olite_request(host, port, password, "GET", "units")
    units = (payload.get("units") or []) if isinstance(payload, dict) else []
    _remember(host, port, units)
    return units


def _lookup(host: str, port: int, password: str, uid) -> Optional[dict]:
    key = (host, int(port or DEFAULT_PORT))
    with _PICTURE_LOCK:
        hit = _PICTURE.get(key)
    if hit and time.monotonic() - hit[0] < _PICTURE_TTL and uid in hit[1]:
        return hit[1][uid]
    for u in _fetch_units(host, port, password):
        if u.get("id") == uid:
            return u
    return None


def fetch_telemetry(host: str, port: int, password: str, resource: str) -> dict:
    """Same contract as olympus_bridge.fetch_telemetry: {ok, data} | {ok:False, error}."""
    if not host:
        return {"ok": False, "error": "No OlympusLite host configured."}
    try:
        if resource == "units":
            return {"ok": True, "data": [map_unit(u) for u in _fetch_units(host, port, password)]}
        if resource == "airbases":
            _s, rows = olite_request(host, port, password, "GET", "airbases")
            return {"ok": True, "data": map_airbases(rows if isinstance(rows, list) else [])}
        if resource == "mission":
            _s, h = olite_request(host, port, password, "GET", "health")
            h = h if isinstance(h, dict) else {}
            return {"ok": True, "data": {
                "backend": "olympuslite", "version": h.get("version"),
                "installed": h.get("installed"), "state": h.get("state"),
                "mission": h.get("mission"), "elapsedTime": h.get("modelTime"),
            }}
    except Exception as e:
        return _err(e, host, port)
    if resource in ("bullseye", "logs", "markers", "drawings"):
        return {"ok": True, "data": {}}  # not served by OlympusLite v0.1
    return {"ok": False, "error": f"Unknown resource '{resource}'."}


def status_check(host: str, port: int, password: str) -> dict:
    """Test Connection: /health (no auth) for reachability, then /units for auth."""
    if not host:
        return {"ok": False, "reachable": False, "error": "No OlympusLite host configured."}
    try:
        olite_request(host, port, password, "GET", "health")
    except Exception as e:
        r = _err(e, host, port)
        return {"ok": False, "reachable": isinstance(e, urllib.error.HTTPError), "error": r["error"]}
    try:
        olite_request(host, port, password, "GET", "units")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return {"ok": False, "reachable": True, "authOk": False,
                    "error": "OlympusLite rejected the password (role auth)."}
        return {"ok": False, "reachable": True, "authOk": None, "error": f"OlympusLite returned HTTP {e.code}."}
    except Exception as e:
        return {"ok": False, "reachable": True, "authOk": None, "error": _err(e, host, port)["error"]}
    return {"ok": True, "reachable": True, "authOk": True}


# --------------------------------------------------------------------------
# Command translation: Olympus vocabulary -> OlympusLite command objects
# --------------------------------------------------------------------------
_SPAWN_CAT = {"spawnAircrafts": "air", "spawnHelicopters": "helicopter",
              "spawnGroundUnits": "ground", "spawnNavyUnits": "ship"}
# Spacing between units placed at one click, metres (Olympus stacks them; DCS
# ground/ship units spawned on the same spot collide).
_SPACING = {"air": 150.0, "helicopter": 60.0, "ground": 25.0, "ship": 400.0}
_ROE = {1: "free", 2: "designated", 3: "return", 4: "hold"}          # LiveMap Seg i+1
_ALARM = {0: "auto", 1: "green", 2: "red"}
_REACTION = {0: "none", 1: "evade", 2: "passive", 3: "bypass"}       # none/manoeuvre/passive/evade
_SMOKE = {"green", "red", "white", "orange", "blue"}
_NAME_RE = re.compile(r"[^A-Za-z0-9\-_ ]")
SUPPORTED = frozenset(set(_SPAWN_CAT) | {
    "setPath", "deleteUnit", "setROE", "setAlarmState", "setReactionToThreat",
    "setEmissionsCountermeasures", "smoke", "explosion",
})


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _loc(params: dict) -> Optional[Tuple[float, float]]:
    loc = params.get("location") or {}
    lat, lng = _num(loc.get("lat")), _num(loc.get("lng"))
    if lat is None or lng is None or not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return None
    return lat, lng


def _offset(lat: float, lng: float, i: int, spacing: float) -> Tuple[float, float]:
    """Unit i of a click-placed group: a line abreast to the east."""
    if i == 0:
        return lat, lng
    d = spacing * i
    return lat, lng + d / (111_320.0 * max(0.05, math.cos(math.radians(lat))))


def translate_spawn(command: str, params: dict) -> dict:
    cat = _SPAWN_CAT[command]
    coalition = str(params.get("coalition") or "").lower()
    if coalition not in _COALITION:
        raise ValueError("coalition must be red|blue|neutral")
    src = params.get("units") or []
    if not isinstance(src, list) or not src:
        raise ValueError("units must be a non-empty list")
    units = []
    for i, s in enumerate(src[:32]):
        if not isinstance(s, dict) or not isinstance(s.get("unitType"), str):
            raise ValueError(f"units[{i}].unitType is required")
        ll = _loc(s)
        if ll is None:
            raise ValueError(f"units[{i}].location is missing or invalid")
        lat, lon = _offset(ll[0], ll[1], i, _SPACING[cat])
        u = {"type": s["unitType"], "lat": lat, "lon": lon}
        if s.get("skill"):
            u["skill"] = s["skill"]
        if s.get("liveryID"):
            u["livery"] = s["liveryID"]
        if s.get("heading") is not None and _num(s.get("heading")) is not None:
            u["heading"] = _num(s["heading"])
        alt = _num(s.get("altitude"))
        if cat in ("air", "helicopter") and alt is not None:
            u["alt"] = alt
        units.append(u)
    # groupName is a DCS:OPT extension (Olympus names groups itself); the DM
    # trigger signal carries its flag in it (services/dm_trigger.py).
    raw_name = params.get("groupName") if isinstance(params.get("groupName"), str) else src[0]["unitType"]
    name = _NAME_RE.sub("", raw_name).strip() or cat
    return {"command": "spawn", "category": cat, "coalition": coalition,
            "name": name[:40], "units": units, "altType": "asl"}


def translate(command: str, params: dict, resolve) -> list:
    """Olympus (command, params) -> list of OlympusLite command bodies.
    `resolve(ID)` returns the OlympusLite unit dict for an Olympus-style ID, or
    None. Raises ValueError with a user-facing message on bad/unsupported input."""
    params = params or {}
    if command in _SPAWN_CAT:
        return [translate_spawn(command, params)]
    if command == "smoke":
        ll = _loc(params)
        if ll is None:
            raise ValueError("smoke needs a location")
        color = str(params.get("color") or "red").lower()
        return [{"command": "smoke", "lat": ll[0], "lon": ll[1],
                 "color": color if color in _SMOKE else "red"}]
    if command == "explosion":
        ll = _loc(params)
        if ll is None:
            raise ValueError("explosion needs a location")
        intensity = _num(params.get("intensity")) or 50
        # OlympusLite has plain HE only; explosionType (napalm/phosphorous/fire) is dropped.
        return [{"command": "explosion", "lat": ll[0], "lon": ll[1],
                 "power": max(1.0, min(10000.0, intensity * 2))}]
    if command not in SUPPORTED:
        raise ValueError(f"'{command}' isn't supported on an OlympusLite server yet.")

    uid = params.get("ID")
    u = resolve(uid) if uid is not None else None
    if u is None:
        raise ValueError(f"unit {uid} isn't in the live picture")
    group = u.get("group")

    if command == "deleteUnit":
        # Delete FIRST, then the effect at its last position: an explosion first
        # can kill the unit, and the delete then fails "no such unit" (seen live).
        out = [{"command": "delete", "unit": u.get("name")}]
        if params.get("explosion"):
            out.append({"command": "explosion", "lat": u.get("lat"), "lon": u.get("lon"), "power": 100})
        return out
    if command == "setPath":
        path = params.get("path") or []
        if not isinstance(path, list) or not path:
            raise ValueError("setPath needs a path")
        last = path[-1] if isinstance(path[-1], dict) else {}
        lat, lng = _num(last.get("lat")), _num(last.get("lng"))
        if lat is None or lng is None:
            raise ValueError("setPath point is invalid")
        # OlympusLite v0.1 moves to ONE destination; multi-point paths go to the last point.
        return [{"command": "move", "group": group, "lat": lat, "lon": lng}]
    if command == "setROE":
        v = _ROE.get(int(_num(params.get("ROE")) or -1))
        if not v:
            raise ValueError("ROE must be 1..4")
        return [{"command": "options", "group": group, "roe": v}]
    if command == "setAlarmState":
        v = _ALARM.get(int(_num(params.get("alarmState")) if _num(params.get("alarmState")) is not None else -1))
        if not v:
            raise ValueError("alarmState must be 0..2")
        return [{"command": "options", "group": group, "alarm": v}]
    if command == "setReactionToThreat":
        v = _REACTION.get(int(_num(params.get("reactionToThreat")) if _num(params.get("reactionToThreat")) is not None else -1))
        if not v:
            raise ValueError("reactionToThreat must be 0..3")
        return [{"command": "options", "group": group, "reaction": v}]
    if command == "setEmissionsCountermeasures":
        v = _num(params.get("emissionsCountermeasures"))
        if v is None or int(v) not in (0, 1, 2, 3):
            raise ValueError("emissionsCountermeasures must be 0..3")
        # 0 = Silent -> radar off; Attack/Defend/Free -> radar on.
        return [{"command": "options", "group": group, "emission": int(v) != 0}]
    raise ValueError(f"'{command}' isn't supported on an OlympusLite server yet.")


def send_command(host: str, port: int, password: str, command: str, params: dict) -> dict:
    """Translate an Olympus command and POST it (or its parts) to /command.
    Returns {ok, response} | {ok:False, error}, matching olympus_bridge."""
    if not host:
        return {"ok": False, "error": "No OlympusLite host configured."}
    try:
        bodies = translate(command, params or {}, lambda uid: _lookup(host, port, password, uid))
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:  # resolve() hit the network
        return _err(e, host, port)
    responses = []
    for body in bodies:
        try:
            status, resp = olite_request(host, port, password, "POST", "command", body)
        except Exception as e:
            return _err(e, host, port)
        if status != 200 or not (isinstance(resp, dict) and resp.get("ok")):
            err = resp.get("error") if isinstance(resp, dict) else None
            # The cosmetic explosion after a delete is best-effort (gm-only server-side).
            if body["command"] == "explosion" and command == "deleteUnit":
                continue
            return {"ok": False, "error": f"OlympusLite: {err or 'command failed'}"}
        responses.append(resp)
    return {"ok": True, "status": 200, "response": responses[-1] if len(responses) == 1 else responses}


# --------------------------------------------------------------------------
# Unit-type database for the spawn picker (OlympusLite serves none) — built
# from pydcs' type tables in the same {key: UnitDbEntry} shape Olympus serves.
# --------------------------------------------------------------------------
_DB_CACHE: dict = {}


def _ground_type(cls_group: str, t) -> str:
    if cls_group == "AirDefence":
        nm = (getattr(t, "name", "") or "")
        if nm.startswith(("AAA", "SPAAA")):
            return "AAA"
        if nm.startswith("EWR"):
            return "Radar (EWR)"
        return "SAM Site"  # launchers AND their radars (STR/TR/SR), like Olympus' SAM bucket
    return {"Armor": "Tank", "Artillery": "Artillery", "Infantry": "Infantry",
            "Unarmed": "Unarmed", "MissilesSS": "Missile", "Fortification": "Structure",
            "Carriage": "Train", "Locomotive": "Train"}.get(cls_group, cls_group)


def fetch_unit_database(_host: str, _port: int, _password: str, category: str) -> dict:
    if category not in ("aircraft", "helicopter", "groundunit", "navyunit"):
        return {"ok": False, "error": f"Unknown category '{category}'."}
    if category in _DB_CACHE:
        return {"ok": True, "data": _DB_CACHE[category]}
    try:
        import dcs.helicopters
        import dcs.planes
        import dcs.ships
        import dcs.vehicles
    except Exception as e:  # pragma: no cover - pydcs is a hard dependency
        return {"ok": False, "error": f"Unit database unavailable ({e})."}
    data: dict = {}
    if category in ("aircraft", "helicopter"):
        table = dcs.planes.plane_map if category == "aircraft" else dcs.helicopters.helicopter_map
        for key, t in table.items():
            data[key] = {"name": key, "label": key, "shortLabel": key, "category": category,
                         "type": "Aircraft" if category == "aircraft" else "Helicopter",
                         "loadouts": [], "liveries": {}}
    elif category == "groundunit":
        for grp in ("AirDefence", "Armor", "Artillery", "Infantry", "Unarmed",
                    "MissilesSS", "Fortification", "Carriage", "Locomotive"):
            holder = getattr(dcs.vehicles, grp, None)
            for t in vars(holder).values() if holder else []:
                key = getattr(t, "id", None)
                if not isinstance(key, str) or key not in dcs.vehicles.vehicle_map:
                    continue
                e = {"name": key, "label": getattr(t, "name", key) or key, "shortLabel": key,
                     "category": "groundunit", "type": _ground_type(grp, t)}
                if getattr(t, "threat_range", 0):
                    e["engagementRange"] = t.threat_range
                if getattr(t, "detection_range", 0):
                    e["acquisitionRange"] = t.detection_range
                data[key] = e
    else:
        for key, t in dcs.ships.ship_map.items():
            data[key] = {"name": key, "label": getattr(t, "name", key) or key, "shortLabel": key,
                         "category": "navyunit", "type": "Ship"}
    _DB_CACHE[category] = data
    return {"ok": True, "data": data}


def fetch_unit_image(*_a, **_k) -> dict:
    return {"ok": False, "error": "OlympusLite serves no unit images."}


def fetch_telemetry_hex(*_a, **_k) -> dict:
    return {"ok": False, "error": "OlympusLite serves JSON; no binary feed to dump."}
