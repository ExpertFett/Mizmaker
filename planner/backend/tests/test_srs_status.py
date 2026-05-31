"""Tests for the optional SRS-Server stats poll (services/srs_status.py).

The service has to handle several JSON shapes (top-level list, {Clients},
mixed-case keys) without throwing, and degrade gracefully when the env var
is unset or the upstream is unreachable. These tests pin those behaviours
down so a future SRS-Server upgrade doesn't silently break the panel.

We monkey-patch urllib.request.urlopen so no network is involved.
"""

from __future__ import annotations

import io
import json
import os
import urllib.error

import pytest

from services import srs_status


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

class _FakeResp:
    def __init__(self, payload: bytes):
        self._payload = payload
    def read(self) -> bytes:
        return self._payload
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False


def _patch_urlopen(monkeypatch, *, payload=None, raise_=None):
    def _fake_urlopen(req, timeout=None):  # noqa: ARG001
        if raise_ is not None:
            raise raise_
        body = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
        return _FakeResp(body)
    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)


# --------------------------------------------------------------------------
# Configuration / env-var gating
# --------------------------------------------------------------------------

class TestConfigured:
    def test_unset_env_returns_unconfigured(self, monkeypatch):
        monkeypatch.delenv("SRS_SERVER_URL", raising=False)
        out = srs_status.get_status()
        assert out == {"configured": False}

    def test_blank_env_returns_unconfigured(self, monkeypatch):
        monkeypatch.setenv("SRS_SERVER_URL", "   ")
        assert srs_status.get_status() == {"configured": False}

    def test_explicit_arg_overrides_env(self, monkeypatch):
        monkeypatch.delenv("SRS_SERVER_URL", raising=False)
        _patch_urlopen(monkeypatch, payload=[])
        out = srs_status.get_status(server_url="http://srs.example:8080")
        assert out["configured"] is True
        assert out["available"] is True
        assert out["clients"] == []


# --------------------------------------------------------------------------
# Failure modes
# --------------------------------------------------------------------------

class TestFailures:
    def test_unreachable_returns_available_false(self, monkeypatch):
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, raise_=urllib.error.URLError("connection refused"))
        out = srs_status.get_status()
        assert out["configured"] is True
        assert out["available"] is False
        assert "connection refused" in out["error"]
        assert out["clients"] == []

    def test_garbage_json_handled(self, monkeypatch):
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, payload=b"<html>nope</html>")
        out = srs_status.get_status()
        assert out["available"] is False
        assert out["clients"] == []

    def test_timeout_handled(self, monkeypatch):
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, raise_=TimeoutError("slow"))
        out = srs_status.get_status()
        assert out["available"] is False


# --------------------------------------------------------------------------
# Payload shape handling — multiple SRS-Server versions in the wild.
# --------------------------------------------------------------------------

class TestPayloadShapes:
    def test_top_level_list_of_clients(self, monkeypatch):
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, payload=[
            {"Name": "Fett", "Coalition": 2, "Radios": [
                {"Freq": 264000000, "Modulation": 0},
            ]},
        ])
        out = srs_status.get_status()
        assert out["count"] == 1
        c = out["clients"][0]
        assert c["name"] == "Fett"
        assert c["coalition"] == "blue"
        assert c["freqs"] == [{"freq_mhz": 264.0, "modulation": 0}]

    def test_clients_key_uppercase(self, monkeypatch):
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, payload={"Clients": [
            {"Name": "Joker", "Coalition": "red", "Radios": [
                {"Freq": 30_500_000, "Modulation": 1},
            ]},
        ]})
        out = srs_status.get_status()
        assert out["clients"][0]["coalition"] == "red"
        assert out["clients"][0]["freqs"] == [{"freq_mhz": 30.5, "modulation": 1}]

    def test_lowercase_keys(self, monkeypatch):
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, payload={"clients": [
            {"name": "Maverick", "coalition": "blue", "radios": [
                {"freq": 251_000_000, "modulation": 0},
            ]},
        ]})
        out = srs_status.get_status()
        assert out["clients"][0]["name"] == "Maverick"
        assert out["clients"][0]["freqs"] == [{"freq_mhz": 251.0, "modulation": 0}]

    def test_freq_already_in_mhz(self, monkeypatch):
        """SRS-Server occasionally exposes MHz directly. Anything < 1000 is
        treated as MHz so we don't double-divide and produce sub-Hz values."""
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, payload=[
            {"Name": "X", "Coalition": 2, "Radios": [{"Freq": 264.0, "Modulation": 0}]},
        ])
        out = srs_status.get_status()
        assert out["clients"][0]["freqs"] == [{"freq_mhz": 264.0, "modulation": 0}]

    def test_zero_freq_and_disabled_radio_dropped(self, monkeypatch):
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, payload=[
            {"Name": "X", "Coalition": 2, "Radios": [
                {"Freq": 0, "Modulation": 0},           # off
                {"Freq": 264000000, "Modulation": 2},   # disabled
                {"Freq": 264000000, "Modulation": 0},   # the real one
            ]},
        ])
        out = srs_status.get_status()
        assert out["clients"][0]["freqs"] == [{"freq_mhz": 264.0, "modulation": 0}]

    def test_client_without_name_dropped(self, monkeypatch):
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, payload=[
            {"Name": "", "Coalition": 2, "Radios": []},
            {"Name": "Real", "Coalition": 2, "Radios": []},
        ])
        out = srs_status.get_status()
        assert out["count"] == 1
        assert out["clients"][0]["name"] == "Real"

    def test_radio_info_nested(self, monkeypatch):
        """Some payloads nest radios under RadioInfo.Radios."""
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        _patch_urlopen(monkeypatch, payload=[
            {"Name": "X", "Coalition": 2,
             "RadioInfo": {"Radios": [{"Freq": 305_000_000, "Modulation": 0}]}},
        ])
        out = srs_status.get_status()
        assert out["clients"][0]["freqs"] == [{"freq_mhz": 305.0, "modulation": 0}]


# --------------------------------------------------------------------------
# URL handling
# --------------------------------------------------------------------------

class TestUrlHandling:
    def test_base_url_appends_default_path(self, monkeypatch):
        called = {}
        def _fake(req, timeout=None):  # noqa: ARG001
            called["url"] = req.full_url
            return _FakeResp(b"[]")
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080")
        monkeypatch.setattr("urllib.request.urlopen", _fake)
        srs_status.get_status()
        assert called["url"].endswith("/clients-data")

    def test_full_url_used_as_is(self, monkeypatch):
        called = {}
        def _fake(req, timeout=None):  # noqa: ARG001
            called["url"] = req.full_url
            return _FakeResp(b"[]")
        monkeypatch.setenv("SRS_SERVER_URL", "http://srs.example:8080/clients")
        monkeypatch.setattr("urllib.request.urlopen", _fake)
        srs_status.get_status()
        assert called["url"] == "http://srs.example:8080/clients"
