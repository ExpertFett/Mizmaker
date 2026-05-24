"""Tests for the Olympus bridge relay (services/olympus_bridge.py).

Covers the HTTP Basic auth-header builder and the route input-validation. The
actual relay to a live Olympus backend isn't exercised here (no live :4512 in
CI) — that's confirmed manually against a running Olympus."""

from __future__ import annotations

import base64

from services.olympus_bridge import _basic_auth, COMMANDS


class TestBasicAuth:
    def test_encodes_olympus_user_and_password(self):
        val = _basic_auth("secret")
        assert val.startswith("Basic ")
        decoded = base64.b64decode(val[len("Basic "):]).decode("utf-8")
        assert decoded == "olympus:secret"

    def test_empty_password(self):
        decoded = base64.b64decode(_basic_auth("")[len("Basic "):]).decode("utf-8")
        assert decoded == "olympus:"


class TestCommandAliases:
    def test_spawn_aliases_map_to_dispatcher_keys(self):
        assert COMMANDS["spawnGround"] == "spawnGroundUnits"
        assert COMMANDS["spawnAir"] == "spawnAircrafts"
        assert COMMANDS["spawnHelo"] == "spawnHelicopters"
        assert COMMANDS["spawnNavy"] == "spawnNavyUnits"


class TestOlympusRoutes:
    def test_status_requires_host(self, client):
        r = client.post("/api/olympus/status", json={})
        assert r.status_code == 400
        assert r.get_json()["ok"] is False

    def test_telemetry_requires_host(self, client):
        r = client.post("/api/olympus/telemetry", json={"resource": "units"})
        assert r.status_code == 400
        assert r.get_json()["ok"] is False

    def test_command_requires_host_and_command(self, client):
        r = client.post("/api/olympus/command", json={"host": "10.0.0.5"})
        assert r.status_code == 400
        assert r.get_json()["ok"] is False
