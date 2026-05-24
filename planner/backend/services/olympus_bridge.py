"""Olympus Bridge — relays DCS:OPT plan data to a LIVE DCS Olympus backend.

Olympus runs a REST API in-DCS (the DLL) on port 4512. This module is a
SERVER-SIDE relay (DCS:OPT's Flask backend -> Olympus), so the browser never
makes cross-origin / mixed-content calls to a local Olympus. Run DCS:OPT on the
same network as your DCS/Olympus server; its backend reaches Olympus over LAN.

Protocol (reverse-engineered from github.com/Pax1601/DCSOlympus —
backend/core/src/server.cpp + commands.cpp + commands.h):
  - Commands: PUT http://<host>:<port>/<REST_URI> with body {"<command>": {params}}.
    The server iterates the top-level keys -> scheduler->handleRequest(key, value).
  - Auth: HTTP Basic, base64("<user>:<rolePassword>"), compared (plaintext) against
    gameMaster / blueCommander / redCommander passwords. Any username works.
  - Telemetry: GET http://<host>:<port>/<resource> (units, mission, airbases, ...).
  - Spawn body: {category, coalition, country, airbaseName?, spawnOptions:[
        {unitType, lat, lng, alt, heading, loadout, payload, liveryID, skill}]}.

⚠️ CONFIRM-AGAINST-LIVE — two values we could NOT pull from source; defaults are
best-guesses. A 30-second DevTools capture (F12 -> Network, spawn one unit)
confirms them, then update the constants below:
  - REST_URI: the command-PUT base path (server.cpp PUTs to root -> "").
  - TELEMETRY_URIS / COMMANDS: the exact GET resource strings + dispatcher key
    casing (camelCase of the C++ command class names is the assumption).
"""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional, Tuple

from flask import request, jsonify

DEFAULT_PORT = 4512
_TIMEOUT = 10

# ⚠️ CONFIRM-AGAINST-LIVE (see module docstring) -----------------------------
REST_URI = ""  # command PUT target path; server.cpp submits commands to root.
TELEMETRY_URIS = {  # GET resource paths on the Olympus backend
    "units": "units",
    "mission": "mission",
    "airbases": "airbases",
    "bullseye": "bullseye",
    "markers": "markers",
    "drawings": "drawings",
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
    """Build the HTTP Basic Authorization header value. Olympus only checks the
    password (against the role passwords); the username is recorded but free."""
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


def register_olympus_routes(app) -> None:
    """Attach the /api/olympus/* relay routes. Stateless — each request carries
    the Olympus connection params {host, port, password}."""

    def _conn() -> Tuple[dict, str, Any, str]:
        d = request.get_json(silent=True) or {}
        host = (d.get("host") or "").strip()
        port = d.get("port") or DEFAULT_PORT
        password = d.get("password") or ""
        return d, host, port, password

    @app.route("/api/olympus/status", methods=["POST"])
    def olympus_status():
        _d, host, port, password = _conn()
        if not host:
            return jsonify({"ok": False, "error": "No Olympus host provided."}), 400
        try:
            _status, payload = olympus_request(
                host, port, password, "GET", TELEMETRY_URIS["mission"])
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return jsonify({"ok": False, "reachable": True, "authOk": False,
                                "error": "Olympus rejected the password (role auth)."})
            return jsonify({"ok": False, "reachable": True, "authOk": None,
                            "error": f"Olympus returned HTTP {e.code}."})
        except Exception as e:
            return jsonify({"ok": False, "reachable": False,
                            "error": f"Can't reach Olympus at {host}:{port} ({e})."})
        return jsonify({"ok": True, "reachable": True, "authOk": True, "mission": payload})

    @app.route("/api/olympus/telemetry", methods=["POST"])
    def olympus_telemetry():
        d, host, port, password = _conn()
        if not host:
            return jsonify({"ok": False, "error": "No Olympus host provided."}), 400
        resource = d.get("resource") or "units"
        path = TELEMETRY_URIS.get(resource, resource)
        try:
            _status, payload = olympus_request(host, port, password, "GET", path)
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 502
        return jsonify({"ok": True, "data": payload})

    @app.route("/api/olympus/command", methods=["POST"])
    def olympus_command():
        d, host, port, password = _conn()
        command = d.get("command")
        params = d.get("params") or {}
        if not host or not command:
            return jsonify({"ok": False, "error": "host and command are required."}), 400
        key = COMMANDS.get(command, command)  # alias -> dispatcher key (or pass through)
        try:
            _status, payload = olympus_request(
                host, port, password, "PUT", REST_URI, body={key: params})
        except urllib.error.HTTPError as e:
            return jsonify({"ok": False, "error": f"Olympus returned HTTP {e.code}."}), 502
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 502
        return jsonify({"ok": True, "command": key, "response": payload})
