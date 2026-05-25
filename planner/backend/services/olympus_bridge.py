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
  - Auth: HTTP Basic, base64("<user>:<rolePassword>"); only the password is
    checked (vs gameMaster / blueCommander / redCommander). Username is free.
  - Telemetry: GET http://<host>:<port>/<resource> (units, mission, ...).

CONFIRMED AGAINST LIVE (2026-05-24, vs a public Olympus on :3000):
  - The public API is served by the FRONTEND webserver on :3000 (the backend
    :4512 is internal/not-forwarded in current Olympus). All API routes live
    under the `/olympus/` prefix and require auth — GET /olympus/{mission,units,
    airbases,bullseye,logs} all return 401 without credentials (404 elsewhere).
  - TELEMETRY_URIS below are therefore prefixed `olympus/`.
  - REST_URI (command PUT path) is assumed `olympus/` (proxy -> backend root);
    still to be confirmed with a live command in Phase C.
"""

from __future__ import annotations

import base64
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


def _basic_auth(password: str) -> str:
    """HTTP Basic Authorization header value. Olympus checks only the password
    (against the role passwords); the username is recorded but free."""
    raw = f"olympus:{password or ''}".encode("utf-8")
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
