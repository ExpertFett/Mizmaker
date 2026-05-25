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
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional, Tuple

DEFAULT_PORT = 4512
_TIMEOUT = 10

# Live-confirmed API base is the `/olympus/` prefix on the :3000 frontend. ------
REST_URI = "olympus/"  # command PUT path (proxy -> backend root); confirm in Phase C.
TELEMETRY_URIS = {  # GET resource paths under /olympus/ (confirmed 401-without-auth)
    "units": "olympus/units",
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
