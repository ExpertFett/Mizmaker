"""Optional SRS-Server stats poll for the Live SRS Directory (Phase 2).

SRS-Server (DCS-SimpleRadio-Standalone) exposes a Web Stats page on a
configurable port when enabled by the server admin. The stats page also
serves a JSON endpoint that lists connected clients and the frequencies
they're tuned to. We poll it server-side so the Live SRS Directory can
show a "● N on" pill next to each freq pilots are actually using.

Deliberately degrades gracefully:
  - When the `SRS_SERVER_URL` env var is unset, get_status() returns
    `{"configured": False}` and the endpoint short-circuits with 200 +
    that body so the frontend can render its "(server poll off)" hint
    without an error toast.
  - When the URL is set but unreachable / returns garbage, returns
    `{"configured": True, "available": False, "error": "..."}` so the
    panel knows to grey out the pills but stay otherwise functional.
  - When successful, returns `{configured: True, available: True,
    clients: [{name, coalition, freqs: [{freq_mhz, modulation}]}]}`.

The JSON shape SRS-Server returns has shifted across releases. We accept
several common shapes (top-level list, {Clients: [...]}, mixed-case keys)
and fall through to "no clients" rather than throw on an unknown shape.
That keeps the feature useful across SRS versions without committing to a
single one.

Pure stdlib (urllib) — no aiohttp dependency. The poll is invoked from a
member-gated Flask route so the timeout MUST be short (default 1.5 s) to
avoid stacking long-running requests in front of the worker pool.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional


# Allow override via env var; defaults are sensible for the most common
# SRS-Server deployment style (port 8080 web stats).
DEFAULT_STATS_PATH = "/clients-data"
DEFAULT_TIMEOUT_S = 1.5


def _coalition_name(raw: Any) -> str:
    """SRS uses ints (1=red, 2=blue, 0=spectator) and strings interchangeably."""
    if isinstance(raw, int):
        return {1: "red", 2: "blue"}.get(raw, "neutral")
    s = str(raw or "").lower().strip()
    if s in ("red", "blue", "neutral"):
        return s
    return "neutral"


def _normalise_radios(raw: Any) -> List[Dict[str, Any]]:
    """SRS-Server has carried radios as a flat list, as `Radios`, and as
    `radios`. Frequencies are usually in Hz (large ints) — we convert to MHz.
    Modulation is 0=AM, 1=FM (occasionally 2=Disabled — we drop those)."""
    items: List[Any] = []
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        for k in ("Radios", "radios"):
            v = raw.get(k)
            if isinstance(v, list):
                items = v
                break
    out: List[Dict[str, Any]] = []
    for r in items:
        if not isinstance(r, dict):
            continue
        freq = r.get("Freq") or r.get("freq") or r.get("frequency")
        mod = r.get("Modulation") or r.get("modulation")
        try:
            f = float(freq)
        except (TypeError, ValueError):
            continue
        if f <= 0:
            continue
        # Heuristic: SRS broadcasts in Hz. Anything > 1000 is treated as Hz;
        # smaller is assumed to already be MHz.
        freq_mhz = f / 1_000_000.0 if f > 1000 else f
        if mod is None:
            mod = 0
        try:
            mod = int(mod)
        except (TypeError, ValueError):
            mod = 0
        if mod == 2:  # disabled radio — pilot's not actually listening
            continue
        out.append({"freq_mhz": round(freq_mhz, 3), "modulation": mod})
    return out


def _normalise_clients(payload: Any) -> List[Dict[str, Any]]:
    """Accept several historic SRS-Server JSON shapes; return a flat client
    list keyed by name + coalition + radios."""
    raw_clients: List[Any] = []
    if isinstance(payload, list):
        raw_clients = payload
    elif isinstance(payload, dict):
        for k in ("Clients", "clients"):
            v = payload.get(k)
            if isinstance(v, list):
                raw_clients = v
                break
    out: List[Dict[str, Any]] = []
    for c in raw_clients:
        if not isinstance(c, dict):
            continue
        name = c.get("Name") or c.get("name") or ""
        if not name:
            continue
        coal = _coalition_name(c.get("Coalition") or c.get("coalition") or 0)
        # Some payloads put radios at top-level; others nest them under
        # `RadioInfo`. Try both.
        radios = _normalise_radios(c) or _normalise_radios(c.get("RadioInfo") or c.get("radioInfo"))
        out.append({"name": str(name), "coalition": coal, "freqs": radios})
    return out


def get_status(*, server_url: Optional[str] = None, timeout: float = DEFAULT_TIMEOUT_S) -> Dict[str, Any]:
    """Poll SRS-Server for connected clients. Returns a normalised status dict
    regardless of failure mode — callers never have to catch."""
    url = server_url or os.environ.get("SRS_SERVER_URL", "").strip()
    if not url:
        return {"configured": False}
    # Allow either a base URL ("http://srs.example:8080") or a full
    # stats-page URL ("http://.../clients-data") — append the default
    # path if it looks like just a host.
    if "/clients-data" not in url and "/clients" not in url:
        url = url.rstrip("/") + DEFAULT_STATS_PATH
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        payload = json.loads(data.decode("utf-8", errors="replace"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError) as e:
        return {"configured": True, "available": False, "error": str(e)[:200], "clients": []}
    clients = _normalise_clients(payload)
    return {"configured": True, "available": True, "clients": clients, "count": len(clients)}
