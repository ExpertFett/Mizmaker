"""Discord OAuth (identify-only) — a signed-cookie identity gate.

No database: the signed cookie IS the session. itsdangerous (ships with
Flask) signs a minimal {id, username, global_name, avatar} payload; the
Discord token exchange uses stdlib urllib (no extra dependency).

The whole thing degrades gracefully: when DISCORD_CLIENT_ID/SECRET/REDIRECT_URI
aren't configured, the login endpoint redirects back with ?auth_error=unconfigured
and /api/auth/me returns {"user": null} — so guest mode keeps working until the
operator provisions a Discord app + env vars.

Env vars:
  DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, APP_SECRET_KEY
"""

from __future__ import annotations

import json
import os
import secrets
import urllib.parse
import urllib.request
from typing import Optional

from flask import request, redirect, jsonify, make_response
from itsdangerous import URLSafeTimedSerializer

AUTH_COOKIE = "dcsopt_auth"
STATE_COOKIE = "dcsopt_oauth_state"
COOKIE_MAX_AGE = 30 * 24 * 3600  # 30 days
STATE_MAX_AGE = 600              # 10 minutes

DISCORD_AUTHORIZE = "https://discord.com/api/oauth2/authorize"
DISCORD_TOKEN = "https://discord.com/api/oauth2/token"
DISCORD_USER = "https://discord.com/api/users/@me"


def _secret() -> str:
    # A stable per-deploy secret. The dev fallback is intentionally obvious so
    # a missing APP_SECRET_KEY in production is easy to spot (cookies signed
    # with it won't validate across a real key rotation).
    return os.environ.get("APP_SECRET_KEY") or "dev-insecure-secret-change-me"


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_secret(), salt="dcsopt-auth")


def make_auth_token(user: dict) -> str:
    """Sign a minimal identity payload into a cookie-safe token."""
    return _serializer().dumps({
        "id": user.get("id"),
        "username": user.get("username"),
        "global_name": user.get("global_name"),
        "avatar": user.get("avatar"),
    })


def read_auth_token(token: str, max_age: int = COOKIE_MAX_AGE) -> Optional[dict]:
    """Verify + decode an auth/state token. Returns the payload, or None when
    the token is missing, tampered, or expired."""
    if not token:
        return None
    try:
        return _serializer().loads(token, max_age=max_age)
    except Exception:
        return None


def _discord_config():
    return (
        os.environ.get("DISCORD_CLIENT_ID"),
        os.environ.get("DISCORD_CLIENT_SECRET"),
        os.environ.get("DISCORD_REDIRECT_URI"),
    )


def _is_https() -> bool:
    # Railway terminates TLS and forwards plain HTTP, so trust X-Forwarded-Proto.
    return request.is_secure or request.headers.get("X-Forwarded-Proto", "").lower() == "https"


def _current_user() -> Optional[dict]:
    return read_auth_token(request.cookies.get(AUTH_COOKIE, ""))


def _exchange_code(client_id: str, client_secret: str, redirect_uri: str, code: str) -> str:
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }).encode()
    req = urllib.request.Request(
        DISCORD_TOKEN, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        payload = json.loads(r.read().decode("utf-8"))
    return payload["access_token"]


def _fetch_user(access_token: str) -> dict:
    req = urllib.request.Request(
        DISCORD_USER, headers={"Authorization": f"Bearer {access_token}"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def register_auth_routes(app) -> None:
    """Attach the /api/auth/* routes to the Flask app. Call before the SPA
    catch-all so /api/auth/... is matched as a specific route."""

    @app.route("/api/auth/me", methods=["GET"])
    def auth_me():
        return jsonify({"user": _current_user()})

    @app.route("/api/auth/logout", methods=["POST"])
    def auth_logout():
        resp = make_response(jsonify({"ok": True}))
        resp.delete_cookie(AUTH_COOKIE, path="/")
        return resp

    @app.route("/api/auth/discord/login", methods=["GET"])
    def auth_discord_login():
        client_id, client_secret, redirect_uri = _discord_config()
        if not (client_id and client_secret and redirect_uri):
            return redirect("/?auth_error=unconfigured")
        state = secrets.token_urlsafe(24)
        params = urllib.parse.urlencode({
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "identify",
            "state": state,
        })
        resp = make_response(redirect(f"{DISCORD_AUTHORIZE}?{params}"))
        # Sign the state into a short-lived cookie for CSRF protection.
        resp.set_cookie(
            STATE_COOKIE, _serializer().dumps(state),
            max_age=STATE_MAX_AGE, httponly=True, samesite="Lax",
            secure=_is_https(), path="/",
        )
        return resp

    @app.route("/api/auth/discord/callback", methods=["GET"])
    def auth_discord_callback():
        client_id, client_secret, redirect_uri = _discord_config()
        if not (client_id and client_secret and redirect_uri):
            return redirect("/?auth_error=unconfigured")
        code = request.args.get("code")
        state = request.args.get("state")
        if not code or not state:
            return redirect("/?auth_error=nocode")
        # CSRF: the state echoed back by Discord must match our signed cookie.
        cookie_state = read_auth_token(
            request.cookies.get(STATE_COOKIE, ""), max_age=STATE_MAX_AGE,
        )
        if cookie_state != state:
            return redirect("/?auth_error=state")
        try:
            access_token = _exchange_code(client_id, client_secret, redirect_uri, code)
        except Exception:
            # Almost always a bad/rotated DISCORD_CLIENT_SECRET, or a redirect_uri
            # that doesn't match the one registered in the Discord app.
            return redirect("/?auth_error=token")
        try:
            user = _fetch_user(access_token)
        except Exception:
            return redirect("/?auth_error=user")
        if not user or not user.get("id"):
            return redirect("/?auth_error=user")
        resp = make_response(redirect("/?auth=ok"))
        resp.set_cookie(
            AUTH_COOKIE, make_auth_token(user),
            max_age=COOKIE_MAX_AGE, httponly=True, samesite="Lax",
            secure=_is_https(), path="/",
        )
        resp.delete_cookie(STATE_COOKIE, path="/")
        return resp
