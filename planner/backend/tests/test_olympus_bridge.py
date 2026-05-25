"""Tests for the Olympus relay core (services/olympus_bridge.py).

The actual relay to a live Olympus :4512 isn't exercised (no live backend in
CI) — we monkeypatch olympus_request to cover status_check's branch mapping
(reachable / auth-rejected / unreachable / other-HTTP) and the auth header."""

from __future__ import annotations

import base64
import hashlib
import urllib.error

from services import olympus_bridge


def _decode(v: str) -> str:
    return base64.b64decode(v[len("Basic "):]).decode("utf-8")


class TestBasicAuth:
    def test_username_role_and_sha256_password(self):
        v = olympus_bridge._basic_auth("secret")
        assert v.startswith("Basic ")
        # default role username + sha256-hex of the password (olympus.json format)
        assert _decode(v) == "Game master:" + hashlib.sha256(b"secret").hexdigest()

    def test_custom_role_username(self):
        v = olympus_bridge._basic_auth("pw", username="Blue commander")
        assert _decode(v) == "Blue commander:" + hashlib.sha256(b"pw").hexdigest()

    def test_empty_password_stays_empty(self):
        # an unconfigured/open role is stored as "" — never hash that
        assert _decode(olympus_bridge._basic_auth("")) == "Game master:"


class TestStatusCheck:
    def test_no_host(self):
        r = olympus_bridge.status_check("", 4512, "pw")
        assert r["ok"] is False and r["reachable"] is False

    def test_reachable_and_authed(self, monkeypatch):
        monkeypatch.setattr(olympus_bridge, "olympus_request",
                            lambda *a, **k: (200, {"theatre": "Caucasus"}))
        r = olympus_bridge.status_check("10.0.0.5", 4512, "pw")
        assert r == {"ok": True, "reachable": True, "authOk": True}

    def test_auth_rejected(self, monkeypatch):
        def boom(*a, **k):
            raise urllib.error.HTTPError("http://h", 401, "Unauthorized", {}, None)
        monkeypatch.setattr(olympus_bridge, "olympus_request", boom)
        r = olympus_bridge.status_check("h", 4512, "bad")
        assert r["ok"] is False and r["reachable"] is True and r["authOk"] is False

    def test_unreachable(self, monkeypatch):
        def boom(*a, **k):
            raise urllib.error.URLError("connection refused")
        monkeypatch.setattr(olympus_bridge, "olympus_request", boom)
        r = olympus_bridge.status_check("h", 4512, "pw")
        assert r["ok"] is False and r["reachable"] is False

    def test_other_http_error(self, monkeypatch):
        def boom(*a, **k):
            raise urllib.error.HTTPError("http://h", 500, "err", {}, None)
        monkeypatch.setattr(olympus_bridge, "olympus_request", boom)
        r = olympus_bridge.status_check("h", 4512, "pw")
        assert r["ok"] is False and r["reachable"] is True and r["authOk"] is None
