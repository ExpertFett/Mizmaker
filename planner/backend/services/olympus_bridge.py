"""Olympus relay core — server-side bridge to a LIVE DCS Olympus backend.

Olympus runs a REST API in-DCS (the DLL) on port 4512. This is the SERVER-SIDE
relay (DCS:OPT backend -> Olympus) so the browser never makes cross-origin /
mixed-content calls and never sees the role password. In the multi-tenant app
the connection params come from a group's stored server_profile (host/port +
encrypted password), reached only via the membership-gated endpoint in
services/groups.py — there is intentionally NO open/anonymous relay route.

Protocol (reverse-engineered from github.com/Pax1601/DCSOlympus —
backend/core/src/server.cpp + commands.cpp + commands.h):
  - Commands: PUT http://<host>:<port>/<REST_URI> with body {"<command>": {params}}.
  - Auth: HTTP Basic, base64("<roleUsername>:<rolePassword>").
  - Telemetry: GET http://<host>:<port>/<resource> (units, mission, ...).

CONFIRMED AGAINST LIVE (2026-05-24, vs a public Olympus on :3000):
  - The public API is served by the FRONTEND webserver on :3000 (the backend
    :4512 is internal/not-forwarded in current Olympus). All API routes live
    under the `/olympus/` prefix and require auth — GET /olympus/{mission,units,
    airbases,bullseye,logs} all return 401 without credentials (404 elsewhere).
  - TELEMETRY_URIS below are therefore prefixed `olympus/`.
  - REST_URI (command PUT path) is assumed `olympus/` (proxy -> backend root);
    still to be confirmed with a live command in Phase C.
  - AUTH: the Basic *username* selects the ROLE and must be exactly
    "Game master" / "Blue commander" / "Red commander" (a free username 401s).
    olympus.json stores SHA256-hashed role passwords and the client sends the
    HASH, so the relay sends sha256-hex of the (plaintext) role password. We
    default the role to "Game master" (full control — the DM-terminal role).
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional, Tuple

DEFAULT_PORT = 4512
_TIMEOUT = 10

# Live-confirmed API base is the `/olympus/` prefix on the :3000 frontend. ------
REST_URI = "olympus"  # command PUT path (client uses _REST_ADDRESS="./olympus").
OLYMPUS_COMMAND_MODE = ""  # X-Command-Mode header (client default ""; role auth governs).
# Commands the relay will forward (PUT /olympus body {<command>: params}).
# Reverse-engineered from the live client's ServerManager.
COMMAND_WHITELIST = frozenset({
    "spawnAircrafts", "spawnHelicopters", "spawnGroundUnits", "spawnNavyUnits",
    "deleteUnit", "cloneUnits", "setPath", "smoke", "explosion", "attackUnit",
    "followUnit", "landAt", "landAtPoint", "refuel", "changeSpeed", "setSpeed",
    "setSpeedType", "changeAltitude", "setAltitude", "setAltitudeType", "setROE",
    "setAlarmState", "setReactionToThreat", "setEmissionsCountermeasures",
    "setOnOff", "setFollowRoads", "setOperateAs", "bombPoint", "carpetBomb",
    "bombBuilding", "fireAtArea", "setRacetrack", "setAdvancedOptions",
    "setEngagementProperties", "setLaserCode",
})
TELEMETRY_URIS = {  # GET resource paths under /olympus/ (confirmed 401-without-auth)
    # units is a DELTA feed keyed by ?time=<ms>; time=0 forces the FULL snapshot
    # every poll (so the map shows the complete picture, not just what changed).
    "units": "olympus/units?time=0",
    "mission": "olympus/mission",
    "airbases": "olympus/airbases",
    "bullseye": "olympus/bullseye",
    "logs": "olympus/logs",
    "markers": "olympus/markers",
    "drawings": "olympus/drawings",
}
# Friendly alias -> dispatcher key (camelCase of the C++ command classes).
COMMANDS = {
    "spawnGround": "spawnGroundUnits",
    "spawnAir": "spawnAircrafts",
    "spawnHelo": "spawnHelicopters",
    "spawnNavy": "spawnNavyUnits",
    "move": "move",
    "clone": "clone",
    "delete": "delete",
    "setTask": "setTask",
    "smoke": "smoke",
    "explosion": "explosion",
}
# ---------------------------------------------------------------------------


# Olympus maps the HTTP Basic *username* to a role; the supplied password is
# checked against that role's password. "Game master" = full control (the
# DM-terminal role). Others: "Blue commander", "Red commander". (Live-confirmed.)
OLYMPUS_ROLE_USER = "Game master"


def _basic_auth(password: str, username: str = OLYMPUS_ROLE_USER) -> str:
    """HTTP Basic Authorization header value. The username selects the Olympus
    role (default "Game master"). olympus.json stores SHA256-hashed role
    passwords and the client sends the HASH, so we hash the (plaintext) role
    password to sha256 hex before sending. An empty password stays empty (an
    unconfigured/open role is stored as "" — hashing that would never match)."""
    pw = password or ""
    sent = hashlib.sha256(pw.encode("utf-8")).hexdigest() if pw else ""
    raw = f"{username}:{sent}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def olympus_request(
    host: str, port: int, password: str, method: str,
    path: str = "", body: Optional[dict] = None,
) -> Tuple[int, Any]:
    """One request to the Olympus backend. Returns (status, parsed_json_or_text).
    Raises urllib.error.* on transport/HTTP failures (caller maps to a response)."""
    base = f"http://{host}:{int(port)}/"
    url = urllib.parse.urljoin(base, path or "")
    headers = {"Authorization": _basic_auth(password)}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
        text = r.read().decode("utf-8", errors="replace")
        try:
            return r.status, json.loads(text)
        except Exception:
            return r.status, text


def fetch_telemetry(host: str, port: int, password: str, resource: str) -> dict:
    """GET a telemetry resource (mission/units/airbases/bullseye/...).
    Returns {ok: True, data: <parsed JSON>} or {ok: False, error: str}. If the
    body isn't JSON (e.g. Olympus's binary unit feed), reports its size instead
    of dumping raw text, and caps very large text payloads."""
    path = TELEMETRY_URIS.get(resource)
    if not path:
        return {"ok": False, "error": f"Unknown resource '{resource}'."}
    if not host:
        return {"ok": False, "error": "No Olympus host configured."}
    if resource == "units":
        # Binary delta feed — fetch raw bytes and decode to a list of units.
        r = _raw_get(host, port, password, path)
        if not r["ok"]:
            return r
        return {"ok": True, "data": decode_units(r["raw"])}
    try:
        _status, payload = olympus_request(host, port or DEFAULT_PORT, password, "GET", path)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return {"ok": False, "error": "Olympus rejected the password (role auth)."}
        return {"ok": False, "error": f"Olympus returned HTTP {e.code}."}
    except Exception as e:
        return {"ok": False, "error": f"Can't reach Olympus at {host}:{port or DEFAULT_PORT} ({e})."}
    if isinstance(payload, str):
        # Non-JSON body (e.g. binary unit protocol) — don't ship raw text.
        return {"ok": True, "data": {"_nonJson": True, "bytes": len(payload)}}
    return {"ok": True, "data": payload}


# --------------------------------------------------------------------------
# Units binary decoder
#
# The /olympus/units feed is a packed DELTA protocol (validated against a live
# server). Layout: [uint64 LE update time] then per unit:
#   [uint32 LE olympusID] then repeating (1-byte DataIndex)(value) until 0xff.
# We decode the leading scalar/string fields (enough for a map/list); when a
# complex list field (ammo/contacts/path/...) appears we skip to the next unit
# boundary — a 0xff followed by a fresh [uint32 id][0x01 category][u16 len][ascii]
# signature — instead of fully parsing the variable-length structures.
# --------------------------------------------------------------------------
import struct  # noqa: E402

# Full DataIndex -> (key, wire-type) table, reverse-engineered from the Olympus
# client's Unit.setData switch + DataExtractor (github.com/Pax1601/DCSOlympus).
# Types map 1:1 to the client's extractors so we consume EVERY field's exact
# byte length and never lose sync (the old heuristic dropped units whenever a
# complex field — ammo/contacts/activePath — appeared, which freshly spawned
# units carry, so spawns at the tail of the feed silently vanished).
_UNIT_FIELDS = {
    1: ("category", "str"), 2: ("alive", "bool"), 3: ("alarmState", "u8"),
    4: ("radarState", "bool"), 5: ("human", "bool"), 6: ("controlled", "bool"),
    7: ("coalition", "u8"), 8: ("country", "u8"), 9: ("name", "str"),
    10: ("unitName", "str"), 11: ("callsign", "str"), 12: ("unitID", "u32"),
    13: ("groupID", "u32"), 14: ("groupName", "str"), 15: ("state", "u8"),
    16: ("task", "str"), 17: ("hasTask", "bool"), 18: ("position", "latlng"),
    19: ("speed", "f64"), 20: ("horizontalVelocity", "f64"), 21: ("verticalVelocity", "f64"),
    22: ("heading", "f64"), 23: ("track", "f64"), 24: ("isActiveTanker", "bool"),
    25: ("isActiveAWACS", "bool"), 26: ("onOff", "bool"), 27: ("followRoads", "bool"),
    28: ("fuel", "u16"), 29: ("desiredSpeed", "f64"), 30: ("desiredSpeedType", "bool"),
    31: ("desiredAltitude", "f64"), 32: ("desiredAltitudeType", "bool"), 33: ("leaderID", "u32"),
    34: ("formationOffset", "offset"), 35: ("targetID", "u32"), 36: ("targetPosition", "latlng"),
    37: ("ROE", "u8"), 38: ("reactionToThreat", "u8"), 39: ("emissionsCountermeasures", "u8"),
    40: ("TACAN", "tacan"), 41: ("radio", "radio"), 42: ("generalSettings", "gensettings"),
    43: ("ammo", "ammo"), 44: ("contacts", "contacts"), 45: ("activePath", "activepath"),
    46: ("isLeader", "bool"), 47: ("operateAs", "u8"), 48: ("shotsScatter", "u8"),
    49: ("shotsIntensity", "u8"), 50: ("health", "u8"), 51: ("racetrackLength", "f64"),
    52: ("racetrackAnchor", "latlng"), 53: ("racetrackBearing", "f64"), 54: ("timeToNextTasking", "f64"),
    55: ("barrelHeight", "f64"), 56: ("muzzleVelocity", "f64"), 57: ("aimTime", "f64"),
    58: ("shotsToFire", "u32"), 59: ("shotsBaseInterval", "f64"), 60: ("shotsBaseScatter", "f64"),
    61: ("engagementRange", "f64"), 62: ("targetingRange", "f64"), 63: ("aimMethodRange", "f64"),
    64: ("acquisitionRange", "f64"), 65: ("airborne", "bool"),
}
_END = 0xFF


def _read_field(data: bytes, o: int, t: str):
    """Read one field value at offset o, returning (value_or_None, new_offset).
    Complex aggregate fields (radio/ammo/...) are consumed exactly but return
    None so they aren't shipped to the browser."""
    if t in ("bool", "u8"):
        return data[o], o + 1
    if t == "u16":
        return struct.unpack_from("<H", data, o)[0], o + 2
    if t == "u32":
        return struct.unpack_from("<I", data, o)[0], o + 4
    if t == "f64":
        return struct.unpack_from("<d", data, o)[0], o + 8
    if t == "str":  # uint16 length prefix + that many bytes (null-trimmed)
        ln = struct.unpack_from("<H", data, o)[0]
        return data[o + 2:o + 2 + ln].split(b"\x00")[0].decode("latin1"), o + 2 + ln
    if t == "latlng":  # 3 x float64 (lat, lng, alt)
        lat, lng, alt = struct.unpack_from("<ddd", data, o)
        return {"lat": lat, "lng": lng, "alt": alt}, o + 24
    if t == "offset":  # x, y, z float64 — consumed, not stored
        return None, o + 24
    if t == "tacan":  # bool + u8 + char(1) + str(4)
        return None, o + 7
    if t == "radio":  # u32 + u8 + u8
        return None, o + 6
    if t == "gensettings":  # 5 bools
        return None, o + 5
    if t == "ammo":  # u16 count, then count x {u16, str(33), u8, u8, u8} = 38 bytes
        size = struct.unpack_from("<H", data, o)[0]
        return None, o + 2 + size * 38
    if t == "contacts":  # u16 count, then count x {u32, u8} = 5 bytes
        size = struct.unpack_from("<H", data, o)[0]
        return None, o + 2 + size * 5
    if t == "activepath":  # u16 count, then count x latlng (24 bytes)
        size = struct.unpack_from("<H", data, o)[0]
        return None, o + 2 + size * 24
    raise ValueError(t)


def _next_unit_boundary(data: bytes, o: int) -> int:
    """Fallback resync (only used if an unknown DataIndex appears): find the next
    0xff that begins a fresh unit: 0xff [u32 id][0x01][u16 len][ascii]."""
    i = o
    n = len(data)
    while i < n - 9:
        if (data[i] == _END and data[i + 5] == 0x01 and data[i + 7] == 0x00
                and 0 < data[i + 6] < 64 and 32 <= data[i + 8] < 127):
            return i + 1
        i += 1
    return n


def decode_units(raw: bytes, limit: int = 5000) -> list:
    """Decode the Olympus units binary feed into a list of unit dicts. Consumes
    every field exactly (sync-safe); truncated tails are skipped, not fatal."""
    units = []
    n = len(raw)
    if n < 12:
        return units
    o = 8  # skip the uint64 update-time header
    while o < n - 4 and len(units) < limit:
        try:
            oly_id = struct.unpack_from("<I", raw, o)[0]
            o += 4
            u = {"olympusID": oly_id}
            while o < n:
                idx = raw[o]
                o += 1  # consume the index byte
                if idx == _END:
                    break
                spec = _UNIT_FIELDS.get(idx)
                if spec is None:
                    o = _next_unit_boundary(raw, o - 1)  # unknown field -> resync
                    break
                key, typ = spec
                val, o = _read_field(raw, o, typ)
                if val is not None:
                    u[key] = val
            units.append(u)
        except Exception:
            o = _next_unit_boundary(raw, o)
    return units


def _raw_get(host: str, port: int, password: str, path: str) -> dict:
    """GET raw bytes from Olympus. Returns {ok, raw} or {ok:False, error}."""
    base = f"http://{host}:{int(port or DEFAULT_PORT)}/"
    url = urllib.parse.urljoin(base, path)
    req = urllib.request.Request(url, headers={"Authorization": _basic_auth(password)}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            return {"ok": True, "raw": r.read()}
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return {"ok": False, "error": "Olympus rejected the password (role auth)."}
        return {"ok": False, "error": f"Olympus returned HTTP {e.code}."}
    except Exception as e:
        return {"ok": False, "error": f"Can't reach Olympus at {host}:{port or DEFAULT_PORT} ({e})."}


def fetch_telemetry_hex(host: str, port: int, password: str, resource: str, limit: int = 4096) -> dict:
    """DEBUG: return the first `limit` RAW bytes (hex) of a telemetry resource +
    total size, for reverse-engineering binary feeds (units). Reads raw bytes
    (no utf-8 decode, unlike olympus_request) so the hex is faithful."""
    path = TELEMETRY_URIS.get(resource)
    if not path:
        return {"ok": False, "error": f"Unknown resource '{resource}'."}
    if not host:
        return {"ok": False, "error": "No Olympus host configured."}
    r = _raw_get(host, port, password, path)
    if not r["ok"]:
        return r
    raw = r["raw"]
    n = max(0, int(limit))
    return {"ok": True, "bytes": len(raw), "hex": raw[:n].hex()}


_DB_CATEGORIES = {"aircraft", "helicopter", "groundunit", "navyunit"}


def fetch_unit_database(host: str, port: int, password: str, category: str) -> dict:
    """Fetch an Olympus unit-type database (for the spawn picker). Served by the
    :3000 frontend at /api/databases/units/<category>database (authed). Returns
    {ok, data: {unitType: {label, category, coalition, type, ...}}}."""
    if category not in _DB_CATEGORIES:
        return {"ok": False, "error": f"Unknown category '{category}'."}
    if not host:
        return {"ok": False, "error": "No Olympus host configured."}
    r = _raw_get(host, port, password, f"api/databases/units/{category}database")
    if not r["ok"]:
        return r
    try:
        return {"ok": True, "data": json.loads(r["raw"].decode("utf-8", errors="replace"))}
    except Exception as e:
        return {"ok": False, "error": f"Database parse failed: {e}"}


_IMG_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
_IMG_CT = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml", "webp": "image/webp"}


def fetch_unit_image(host: str, port: int, password: str, filename: str) -> dict:
    """Fetch a unit photo from Olympus (served at images/units/<filename>).
    Returns {ok, raw: bytes, content_type} or {ok:False, error}. Filename is
    validated (no path traversal) before it touches the URL."""
    if not _IMG_RE.match(filename or "") or "/" in filename or "\\" in filename:
        return {"ok": False, "error": "Bad filename."}
    if not host:
        return {"ok": False, "error": "No Olympus host configured."}
    r = _raw_get(host, port, password, f"images/units/{filename}")
    if not r["ok"]:
        return r
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {"ok": True, "raw": r["raw"], "content_type": _IMG_CT.get(ext, "application/octet-stream")}


def send_command(host: str, port: int, password: str, command: str, params: dict) -> dict:
    """Send an Olympus command: PUT /olympus body {command: params}, with the
    Basic auth + X-Command-Mode header the client uses. Returns {ok, response}
    or {ok:False, error}. Command must be in COMMAND_WHITELIST."""
    if command not in COMMAND_WHITELIST:
        return {"ok": False, "error": f"Command '{command}' not allowed."}
    if not host:
        return {"ok": False, "error": "No Olympus host configured."}
    base = f"http://{host}:{int(port or DEFAULT_PORT)}/"
    url = urllib.parse.urljoin(base, REST_URI)
    body = json.dumps({command: params or {}}).encode("utf-8")
    headers = {
        "Authorization": _basic_auth(password),
        "Content-Type": "application/json",
        "X-Command-Mode": OLYMPUS_COMMAND_MODE,
    }
    req = urllib.request.Request(url, data=body, headers=headers, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            text = r.read().decode("utf-8", errors="replace")
            try:
                resp = json.loads(text)
            except Exception:
                resp = text
            return {"ok": True, "status": r.status, "response": resp}
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return {"ok": False, "error": "Olympus rejected the password/role for this command."}
        return {"ok": False, "error": f"Olympus returned HTTP {e.code}."}
    except Exception as e:
        return {"ok": False, "error": f"Can't reach Olympus at {host}:{port or DEFAULT_PORT} ({e})."}


def status_check(host: str, port: int, password: str) -> dict:
    """Probe an Olympus backend for a profile "Test Connection": is it reachable,
    and does the password pass role auth? Returns booleans only (no payload echo,
    to avoid leaking arbitrary response bodies back to the browser)."""
    if not host:
        return {"ok": False, "reachable": False, "error": "No Olympus host configured."}
    try:
        olympus_request(host, port or DEFAULT_PORT, password, "GET", TELEMETRY_URIS["mission"])
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return {"ok": False, "reachable": True, "authOk": False,
                    "error": "Olympus rejected the password (role auth)."}
        return {"ok": False, "reachable": True, "authOk": None,
                "error": f"Olympus returned HTTP {e.code}."}
    except Exception as e:
        return {"ok": False, "reachable": False,
                "error": f"Can't reach Olympus at {host}:{port or DEFAULT_PORT} ({e})."}
    return {"ok": True, "reachable": True, "authOk": True}
