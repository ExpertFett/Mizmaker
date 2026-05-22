"""Tests for the Discord OAuth identity gate (services/auth.py).

Covers the signed-cookie round-trip and the /api/auth/* endpoints, including
the graceful 'unconfigured' degrade when DISCORD_* env vars are unset.
"""

from __future__ import annotations

import pytest

from services.auth import make_auth_token, read_auth_token, AUTH_COOKIE


class TestAuthToken:
    def test_round_trip(self):
        user = {"id": "123", "username": "fett", "global_name": "Fett", "avatar": "abc"}
        out = read_auth_token(make_auth_token(user))
        assert out == {"id": "123", "username": "fett", "global_name": "Fett", "avatar": "abc"}

    def test_extra_fields_are_dropped(self):
        # Only the minimal identity fields are signed in.
        out = read_auth_token(make_auth_token({"id": "1", "email": "x@y.z", "secret": "nope"}))
        assert set(out.keys()) == {"id", "username", "global_name", "avatar"}
        assert "email" not in out

    def test_garbage_and_empty_return_none(self):
        assert read_auth_token("not-a-real-token") is None
        assert read_auth_token("") is None

    def test_expired_returns_none(self):
        tok = make_auth_token({"id": "1"})
        assert read_auth_token(tok, max_age=-1) is None  # -1 forces expiry


class TestAuthRoutes:
    def test_me_without_cookie_is_null(self, client):
        r = client.get("/api/auth/me")
        assert r.status_code == 200
        assert r.get_json() == {"user": None}

    def test_me_with_cookie_returns_user(self, client):
        tok = make_auth_token({"id": "42", "username": "bengal", "global_name": None, "avatar": None})
        client.set_cookie(AUTH_COOKIE, tok)
        r = client.get("/api/auth/me")
        body = r.get_json()
        assert body["user"]["id"] == "42"
        assert body["user"]["username"] == "bengal"

    def test_logout_clears_cookie(self, client):
        r = client.post("/api/auth/logout")
        assert r.status_code == 200
        assert r.get_json() == {"ok": True}
        assert AUTH_COOKIE in r.headers.get("Set-Cookie", "")

    def test_login_unconfigured_redirects(self, client, monkeypatch):
        for k in ("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI"):
            monkeypatch.delenv(k, raising=False)
        r = client.get("/api/auth/discord/login")
        assert r.status_code == 302
        assert "auth_error=unconfigured" in r.headers["Location"]

    def test_login_configured_redirects_to_discord(self, client, monkeypatch):
        monkeypatch.setenv("DISCORD_CLIENT_ID", "cid")
        monkeypatch.setenv("DISCORD_CLIENT_SECRET", "csecret")
        monkeypatch.setenv("DISCORD_REDIRECT_URI", "https://x/api/auth/discord/callback")
        r = client.get("/api/auth/discord/login")
        assert r.status_code == 302
        loc = r.headers["Location"]
        assert loc.startswith("https://discord.com/api/oauth2/authorize")
        assert "scope=identify" in loc
        assert "client_id=cid" in loc

    def test_callback_bad_state_redirects_failed(self, client, monkeypatch):
        monkeypatch.setenv("DISCORD_CLIENT_ID", "cid")
        monkeypatch.setenv("DISCORD_CLIENT_SECRET", "csecret")
        monkeypatch.setenv("DISCORD_REDIRECT_URI", "https://x/cb")
        # No matching state cookie → CSRF check fails.
        r = client.get("/api/auth/discord/callback?code=abc&state=nope")
        assert r.status_code == 302
        assert "auth_error=failed" in r.headers["Location"]
