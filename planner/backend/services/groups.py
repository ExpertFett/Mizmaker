"""Multi-tenant groups + server profiles for the Live/DM terminal (Phase A).

A logged-in Discord user creates a GROUP (becomes admin) → invites operators
via a CODE → the group owns SERVER PROFILES (Olympus + LotATC connection info)
shared across its members. All data in Supabase (migrations/0002_groups.sql),
accessed with the service_role key; membership/role is enforced here in Flask.

Olympus role passwords are encrypted app-side (profile_crypto) and never
returned to the browser — GET only reports whether a password is set.

Degrades gracefully: with no Supabase creds, the routes return 503 and the
frontend keeps the Live tab in its "not available" state.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import json
import threading

from flask import request, jsonify, Response
from gevent.queue import Queue

from services.auth import current_user
from services.supabase_client import get_supabase
from services import profile_crypto


def _USER_AGENT_OR_DEFAULT() -> str:
    """User-Agent string for outbound webhooks. Discord wants a descriptive
    UA so they can identify our traffic + reach out if we hit rate limits.
    Matches auth.py / chart_fetcher.py's convention."""
    return "DCS-OPT/1.0 (Live Discord broadcast; +https://dcsopt.up.railway.app)"


# --------------------------------------------------------------------------
# Comms pubsub — in-memory, per-group. Survives requests via module globals.
# --------------------------------------------------------------------------
# Each group keeps a ring buffer of the last N messages (for backfill when a
# member opens CommsLog mid-session) and a list of active subscriber queues
# that receive each new message. All access is wrapped under _COMMS_LOCK.
# Survives Flask request boundaries; resets on backend restart (acceptable —
# comms are session-scoped and the audit log is best-effort, not durable).
_COMMS_HISTORY_MAX = 200
_COMMS_HISTORY: dict[str, list[dict]] = {}
_COMMS_SUBS: dict[str, list[Queue]] = {}
_COMMS_LOCK = threading.Lock()


def _comms_publish(gid: str, msg: dict) -> None:
    """Append to history + fan out to every subscriber queue for this group."""
    with _COMMS_LOCK:
        hist = _COMMS_HISTORY.setdefault(gid, [])
        hist.append(msg)
        if len(hist) > _COMMS_HISTORY_MAX:
            del hist[: len(hist) - _COMMS_HISTORY_MAX]
        subs = list(_COMMS_SUBS.get(gid, []))
    for q in subs:
        try:
            q.put_nowait(msg)
        except Exception:
            pass  # subscriber's queue full / dead — they'll drop and reconnect


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    return str(uuid.uuid4())


# --------------------------------------------------------------------------
# Data layer
# --------------------------------------------------------------------------
def ensure_user(sb, discord_user: dict) -> dict:
    """Upsert the logged-in Discord identity into `users`; return the row."""
    did = str(discord_user.get("id"))
    username = discord_user.get("global_name") or discord_user.get("username")
    avatar = discord_user.get("avatar")
    found = (sb.table("users").select("*").eq("discord_id", did).execute().data) or []
    if found:
        u = found[0]
        sb.table("users").update(
            {"username": username, "avatar": avatar, "last_login": _now_iso()}
        ).eq("id", u["id"]).execute()
        return u
    row = {
        "id": _uuid(),
        "discord_id": did,
        "username": username,
        "avatar": avatar,
        "created_at": _now_iso(),
        "last_login": _now_iso(),
    }
    inserted = sb.table("users").insert(row).execute().data
    return (inserted or [row])[0]


def role_in_group(sb, user_id: str, group_id: str) -> Optional[str]:
    rows = (
        sb.table("group_members")
        .select("role").eq("group_id", group_id).eq("user_id", user_id)
        .execute().data
    ) or []
    return rows[0]["role"] if rows else None


# --- Live-terminal access levels -------------------------------------------
# Mission roles → capabilities. 'admin' = Game Master (also the only role that
# manages the group); 'operator' = Observer (view only). Stored in
# group_members.role (free text column — no DB migration needed).
#
# Capability glossary:
#   manage     — group settings, member roles, invite codes (admin only)
#   spawn      — Olympus spawn / IADS draw-tool / SAM placement
#   command    — vector / route / engage existing units (cmdSel path)
#   delete     — Olympus deleteUnit
#   effects    — smoke, explosion, flare markers (low-risk visual cues)
#   markers    — map annotations / drawings
#   tools_jtac — 9-line builder, brevity reference highlighted, LASE coord
#   tools_atc  — ATC panel + PAR scope highlighted, runway picker
#
# JTAC + ATC roles get their named tool set PLUS effects/markers. They never
# get spawn/command/delete — those stay with admin + commander only. (Matches
# the DM model in immutable-scribbling-flurry plan: vectoring AI stays under
# canCommand; role splits only change which UI tools each user reaches for.)
ROLE_CAPS: dict[str, set[str]] = {
    "admin":     {"manage", "spawn", "command", "delete", "effects", "markers", "tools_jtac", "tools_atc"},
    "commander": {"spawn", "command", "delete", "effects", "markers", "tools_jtac", "tools_atc"},
    "jtac":      {"effects", "markers", "tools_jtac"},
    "atc":       {"effects", "markers", "tools_atc"},
    "operator":  set(),
}
VALID_ROLES = set(ROLE_CAPS)


def command_capability(command: str) -> str:
    """Which capability an Olympus command requires."""
    if command in ("spawnAircrafts", "spawnGroundUnits", "spawnHelicopters", "spawnNavyUnits"):
        return "spawn"
    if command == "deleteUnit":
        return "delete"
    if command in ("smoke", "explosion"):
        return "effects"
    return "command"  # everything else = controlling existing units


def role_has(role: Optional[str], cap: str) -> bool:
    return cap in ROLE_CAPS.get(role or "", set())


def _serialize_profile(p: dict) -> dict:
    """Public profile shape — NEVER includes the encrypted password OR
    the encrypted Discord webhook URL. Only booleans for presence."""
    return {
        "id": p["id"],
        "name": p["name"],
        "olympusHost": p.get("olympus_host"),
        "olympusPort": p.get("olympus_port"),
        "lotatcUrl": p.get("lotatc_url"),
        "hasPassword": bool(p.get("olympus_password_enc")),
        # v1.19.50 — Discord webhook presence (URL itself is encrypted and
        # never returned to the client).
        "hasDiscord": bool(p.get("discord_webhook_enc")),
        "updatedAt": p.get("updated_at"),
    }


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
def register_group_routes(app) -> None:
    """Attach /api/groups* routes. Register before the SPA catch-all."""

    def _ctx():
        """(sb, user, None) on success, or (None, None, (resp, code)) to bail."""
        discord = current_user()
        if not discord:
            return None, None, (jsonify({"error": "Not logged in"}), 401)
        sb = get_supabase()
        if sb is None:
            return None, None, (jsonify({"error": "Live features not configured on this server"}), 503)
        try:
            user = ensure_user(sb, discord)
        except Exception as e:
            return None, None, (jsonify({"error": f"User lookup failed: {e}"}), 500)
        return sb, user, None

    # ---- Groups ----------------------------------------------------------
    @app.route("/api/groups", methods=["GET"])
    def groups_list():
        sb, user, err = _ctx()
        if err:
            return err
        memberships = (
            sb.table("group_members").select("group_id, role").eq("user_id", user["id"]).execute().data
        ) or []
        out = []
        for m in memberships:
            g = (sb.table("groups").select("*").eq("id", m["group_id"]).execute().data) or []
            if g:
                out.append({"id": g[0]["id"], "name": g[0]["name"], "role": m["role"]})
        return jsonify({"groups": out, "me": {"id": user["id"], "username": user.get("username")}})

    @app.route("/api/groups", methods=["POST"])
    def groups_create():
        sb, user, err = _ctx()
        if err:
            return err
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Group name required"}), 400
        gid = _uuid()
        sb.table("groups").insert({
            "id": gid, "name": name, "created_by": user["id"], "created_at": _now_iso(),
        }).execute()
        sb.table("group_members").insert({
            "group_id": gid, "user_id": user["id"], "role": "admin", "joined_at": _now_iso(),
        }).execute()
        return jsonify({"id": gid, "name": name, "role": "admin"}), 201

    # ---- Invites ---------------------------------------------------------
    @app.route("/api/groups/<gid>/invites", methods=["POST"])
    def invite_create(gid):
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) != "admin":
            return jsonify({"error": "Admin only"}), 403
        body = request.get_json(silent=True) or {}
        role = body.get("role") if body.get("role") in VALID_ROLES else "operator"
        expires_at = None
        if body.get("expiresInHours"):
            try:
                hrs = float(body["expiresInHours"])
                expires_at = (datetime.now(timezone.utc) + timedelta(hours=hrs)).isoformat()
            except (TypeError, ValueError):
                pass
        max_uses = body.get("maxUses") if isinstance(body.get("maxUses"), int) else None
        code = secrets.token_urlsafe(8)
        sb.table("group_invites").insert({
            "code": code, "group_id": gid, "role": role, "created_by": user["id"],
            "created_at": _now_iso(), "expires_at": expires_at, "max_uses": max_uses, "uses": 0,
        }).execute()
        return jsonify({"code": code, "role": role, "expiresAt": expires_at, "maxUses": max_uses}), 201

    @app.route("/api/groups/join", methods=["POST"])
    def group_join():
        sb, user, err = _ctx()
        if err:
            return err
        body = request.get_json(silent=True) or {}
        code = (body.get("code") or "").strip()
        if not code:
            return jsonify({"error": "Invite code required"}), 400
        inv = (sb.table("group_invites").select("*").eq("code", code).execute().data) or []
        if not inv:
            return jsonify({"error": "Invalid invite code"}), 404
        inv = inv[0]
        if inv.get("expires_at"):
            try:
                if datetime.now(timezone.utc) > datetime.fromisoformat(inv["expires_at"]):
                    return jsonify({"error": "Invite expired"}), 410
            except ValueError:
                pass
        if inv.get("max_uses") is not None and inv.get("uses", 0) >= inv["max_uses"]:
            return jsonify({"error": "Invite has no uses left"}), 410
        gid = inv["group_id"]
        # Already a member? idempotent success.
        if role_in_group(sb, user["id"], gid) is None:
            sb.table("group_members").insert({
                "group_id": gid, "user_id": user["id"], "role": inv["role"], "joined_at": _now_iso(),
            }).execute()
            sb.table("group_invites").update({"uses": inv.get("uses", 0) + 1}).eq("code", code).execute()
        g = (sb.table("groups").select("*").eq("id", gid).execute().data) or []
        name = g[0]["name"] if g else "(group)"
        return jsonify({"id": gid, "name": name, "role": inv["role"]})

    # ---- Members ---------------------------------------------------------
    @app.route("/api/groups/<gid>/members", methods=["GET"])
    def members_list(gid):
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) is None:
            return jsonify({"error": "Not a member"}), 403
        members = (sb.table("group_members").select("*").eq("group_id", gid).execute().data) or []
        out = []
        for m in members:
            u = (sb.table("users").select("*").eq("id", m["user_id"]).execute().data) or []
            uname = u[0].get("username") if u else None
            out.append({"userId": m["user_id"], "username": uname, "role": m["role"]})
        return jsonify({"members": out})

    @app.route("/api/groups/<gid>/members/<target_uid>", methods=["DELETE"])
    def member_remove(gid, target_uid):
        sb, user, err = _ctx()
        if err:
            return err
        my_role = role_in_group(sb, user["id"], gid)
        # Admins can remove anyone; anyone can remove themselves (leave).
        if my_role != "admin" and target_uid != user["id"]:
            return jsonify({"error": "Admin only"}), 403
        sb.table("group_members").delete().eq("group_id", gid).eq("user_id", target_uid).execute()
        return jsonify({"ok": True})

    @app.route("/api/groups/<gid>/members/<target_uid>", methods=["PATCH"])
    def member_set_role(gid, target_uid):
        """Game Master assigns a member's mission role (gamemaster/commander/
        jtac/atc/observer → stored as admin/commander/jtac/atc/operator)."""
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) != "admin":
            return jsonify({"error": "Game Master only"}), 403
        new_role = (request.get_json(silent=True) or {}).get("role")
        if new_role not in VALID_ROLES:
            return jsonify({"error": "Invalid role"}), 400
        if target_uid == user["id"] and new_role != "admin":
            return jsonify({"error": "Can't demote yourself — assign another Game Master first."}), 400
        if role_in_group(sb, target_uid, gid) is None:
            return jsonify({"error": "Not a member"}), 404
        sb.table("group_members").update({"role": new_role}).eq("group_id", gid).eq("user_id", target_uid).execute()
        return jsonify({"ok": True, "role": new_role})

    # ---- Server profiles -------------------------------------------------
    @app.route("/api/groups/<gid>/profiles", methods=["GET"])
    def profiles_list(gid):
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) is None:
            return jsonify({"error": "Not a member"}), 403
        rows = (sb.table("server_profiles").select("*").eq("group_id", gid).execute().data) or []
        return jsonify({"profiles": [_serialize_profile(p) for p in rows]})

    @app.route("/api/groups/<gid>/profiles", methods=["POST"])
    def profile_create(gid):
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) != "admin":
            return jsonify({"error": "Admin only"}), 403
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Profile name required"}), 400
        try:
            pw_enc = profile_crypto.encrypt_secret(body.get("olympusPassword"))
            # v1.19.50 — Discord webhook URL. Encrypted-at-rest because a
            # leaked webhook lets anyone spam the channel as the bot user.
            # Discord rate-limits per-webhook so a leak is bounded but
            # still annoying.
            webhook_enc = profile_crypto.encrypt_secret(body.get("discordWebhookUrl"))
        except profile_crypto.EncKeyMissing as e:
            return jsonify({"error": str(e)}), 503
        pid = _uuid()
        sb.table("server_profiles").insert({
            "id": pid, "group_id": gid, "name": name,
            "olympus_host": body.get("olympusHost"),
            "olympus_port": int(body.get("olympusPort") or 4512),
            "olympus_password_enc": pw_enc,
            "lotatc_url": body.get("lotatcUrl"),
            "discord_webhook_enc": webhook_enc,
            "created_by": user["id"], "updated_at": _now_iso(),
        }).execute()
        return jsonify({"id": pid}), 201

    @app.route("/api/groups/<gid>/profiles/<pid>", methods=["PATCH"])
    def profile_update(gid, pid):
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) != "admin":
            return jsonify({"error": "Admin only"}), 403
        body = request.get_json(silent=True) or {}
        patch = {"updated_at": _now_iso()}
        if "name" in body:
            patch["name"] = (body.get("name") or "").strip()
        if "olympusHost" in body:
            patch["olympus_host"] = body.get("olympusHost")
        if "olympusPort" in body:
            patch["olympus_port"] = int(body.get("olympusPort") or 4512)
        if "lotatcUrl" in body:
            patch["lotatc_url"] = body.get("lotatcUrl")
        # Only touch the password when the caller explicitly sends one.
        if "olympusPassword" in body:
            try:
                patch["olympus_password_enc"] = profile_crypto.encrypt_secret(body.get("olympusPassword"))
            except profile_crypto.EncKeyMissing as e:
                return jsonify({"error": str(e)}), 503
        # v1.19.50 — same "only touch if explicitly sent" pattern for the
        # Discord webhook. Saving "" clears it; absent key leaves it alone.
        if "discordWebhookUrl" in body:
            try:
                patch["discord_webhook_enc"] = profile_crypto.encrypt_secret(body.get("discordWebhookUrl"))
            except profile_crypto.EncKeyMissing as e:
                return jsonify({"error": str(e)}), 503
        sb.table("server_profiles").update(patch).eq("id", pid).eq("group_id", gid).execute()
        return jsonify({"ok": True})

    @app.route("/api/groups/<gid>/profiles/<pid>", methods=["DELETE"])
    def profile_delete(gid, pid):
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) != "admin":
            return jsonify({"error": "Admin only"}), 403
        sb.table("server_profiles").delete().eq("id", pid).eq("group_id", gid).execute()
        return jsonify({"ok": True})

    @app.route("/api/groups/<gid>/profiles/<pid>/test", methods=["POST"])
    def profile_test(gid, pid):
        """Test Connection — any member can probe a saved server. The stored
        password is decrypted server-side and used for the Olympus relay; it is
        never sent to or from the browser. Returns reachability/auth booleans."""
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) is None:
            return jsonify({"error": "Not a member"}), 403
        rows = (
            sb.table("server_profiles").select("*")
            .eq("id", pid).eq("group_id", gid).execute().data
        ) or []
        if not rows:
            return jsonify({"error": "Profile not found"}), 404
        p = rows[0]
        try:
            pw = profile_crypto.decrypt_secret(p.get("olympus_password_enc"))
        except profile_crypto.EncKeyMissing as e:
            return jsonify({"error": str(e)}), 503
        from services.olympus_bridge import status_check
        return jsonify(status_check(p.get("olympus_host"), p.get("olympus_port") or 4512, pw or ""))

    @app.route("/api/groups/<gid>/profiles/<pid>/discord/post", methods=["POST"])
    def profile_discord_post(gid, pid):
        """Post an embed to the profile's Discord webhook (v1.19.50).

        Gated by canCommand (jtac/atc still get effects/markers but Discord
        broadcast counts as a controller action — same gate as comms_post).
        Webhook URL is decrypted server-side and never returned to the
        browser. Request body: {title?, description, color?, footer?,
        fields?: [{name, value, inline?}]}.

        Response: {ok: True} on success or {error: str, status: int}
        when the webhook returns non-2xx (Discord rate limit, deleted
        webhook, etc.).
        """
        sb, user, err = _ctx()
        if err:
            return err
        role = role_in_group(sb, user["id"], gid)
        if role is None:
            return jsonify({"error": "Not a member"}), 403
        if not role_has(role, "command"):
            return jsonify({"error": "Discord broadcast requires command capability"}), 403
        rows = (
            sb.table("server_profiles").select("*")
            .eq("id", pid).eq("group_id", gid).execute().data
        ) or []
        if not rows:
            return jsonify({"error": "Profile not found"}), 404
        p = rows[0]
        if not p.get("discord_webhook_enc"):
            return jsonify({"error": "No Discord webhook configured on this server profile"}), 400
        try:
            url = profile_crypto.decrypt_secret(p.get("discord_webhook_enc"))
        except profile_crypto.EncKeyMissing as e:
            return jsonify({"error": str(e)}), 503
        if not url or not url.startswith("https://discord.com/api/webhooks/"):
            return jsonify({"error": "Stored webhook URL is invalid"}), 400

        body = request.get_json(silent=True) or {}
        description = (body.get("description") or "").strip()
        if not description:
            return jsonify({"error": "Empty description"}), 400
        title = (body.get("title") or "").strip()
        color = body.get("color")
        footer = (body.get("footer") or "").strip()
        fields = body.get("fields") or []
        if not isinstance(fields, list):
            fields = []

        # Build Discord embed. Keep things ASCII-safe — Discord accepts
        # UTF-8 but the urllib JSON encoder also will, so emoji + ° pass.
        embed = {
            "description": description[:4000],  # Discord max 4096
            "type": "rich",
        }
        if title:
            embed["title"] = title[:256]
        if isinstance(color, int):
            embed["color"] = color
        if footer:
            embed["footer"] = {"text": footer[:2048]}
        if fields:
            embed["fields"] = [
                {"name": str(f.get("name", "?"))[:256],
                 "value": str(f.get("value", ""))[:1024],
                 "inline": bool(f.get("inline"))}
                for f in fields if isinstance(f, dict)
            ][:25]  # Discord max 25 fields

        payload = {
            "username": "DCS:OPT",
            "embeds": [embed],
        }
        import json
        import urllib.request, urllib.error
        data = json.dumps(payload).encode("utf-8")
        req_ = urllib.request.Request(
            url, data=data, method="POST",
            headers={"Content-Type": "application/json",
                     "User-Agent": _USER_AGENT_OR_DEFAULT()},
        )
        try:
            with urllib.request.urlopen(req_, timeout=8) as r:
                # Discord returns 204 No Content on success.
                if 200 <= r.status < 300:
                    return jsonify({"ok": True})
                return jsonify({"error": f"Discord returned HTTP {r.status}"}), 502
        except urllib.error.HTTPError as he:
            return jsonify({
                "error": f"Discord HTTPError {he.code}",
                "detail": he.reason or "",
            }), 502
        except urllib.error.URLError as ue:
            return jsonify({"error": f"Network error reaching Discord: {ue.reason}"}), 502
        except Exception as ex:  # pragma: no cover
            return jsonify({"error": f"{type(ex).__name__}: {ex}"}), 500

    @app.route("/api/groups/<gid>/profiles/<pid>/telemetry/<resource>", methods=["GET"])
    def profile_telemetry(gid, pid, resource):
        """Live picture — any member pulls a telemetry resource for a profile
        (mission/units/airbases/bullseye/...). Password decrypted server-side."""
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) is None:
            return jsonify({"error": "Not a member"}), 403
        rows = (
            sb.table("server_profiles").select("*")
            .eq("id", pid).eq("group_id", gid).execute().data
        ) or []
        if not rows:
            return jsonify({"error": "Profile not found"}), 404
        p = rows[0]
        try:
            pw = profile_crypto.decrypt_secret(p.get("olympus_password_enc"))
        except profile_crypto.EncKeyMissing as e:
            return jsonify({"error": str(e)}), 503
        host, port = p.get("olympus_host"), p.get("olympus_port") or 4512
        # Debug: raw-bytes hex sample for reverse-engineering binary feeds.
        if request.args.get("debug") == "hex":
            from services.olympus_bridge import fetch_telemetry_hex
            r = fetch_telemetry_hex(host, port, pw or "", resource)
            return jsonify(r), (200 if r.get("ok") else 502)
        from services.olympus_bridge import fetch_telemetry
        result = fetch_telemetry(host, port, pw or "", resource)
        resp = jsonify(result)
        resp.headers["Cache-Control"] = "no-store"  # live feed — never cache
        return resp, (200 if result.get("ok") else 502)

    @app.route("/api/groups/<gid>/profiles/<pid>/database/<category>", methods=["GET"])
    def profile_database(gid, pid, category):
        """Unit-type database for the spawn picker (member-gated; relayed +
        authed server-side). category: aircraft|helicopter|groundunit|navyunit."""
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) is None:
            return jsonify({"error": "Not a member"}), 403
        rows = (
            sb.table("server_profiles").select("*")
            .eq("id", pid).eq("group_id", gid).execute().data
        ) or []
        if not rows:
            return jsonify({"error": "Profile not found"}), 404
        p = rows[0]
        try:
            pw = profile_crypto.decrypt_secret(p.get("olympus_password_enc"))
        except profile_crypto.EncKeyMissing as e:
            return jsonify({"error": str(e)}), 503
        from services.olympus_bridge import fetch_unit_database
        result = fetch_unit_database(p.get("olympus_host"), p.get("olympus_port") or 4512, pw or "", category)
        return jsonify(result), (200 if result.get("ok") else 502)

    @app.route("/api/groups/<gid>/profiles/<pid>/unit-image/<filename>", methods=["GET"])
    def profile_unit_image(gid, pid, filename):
        """Proxy a unit photo from Olympus (member-gated; authed server-side) so
        the https browser can show it without mixed-content / CORS issues."""
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) is None:
            return jsonify({"error": "Not a member"}), 403
        rows = (
            sb.table("server_profiles").select("*")
            .eq("id", pid).eq("group_id", gid).execute().data
        ) or []
        if not rows:
            return jsonify({"error": "Profile not found"}), 404
        p = rows[0]
        try:
            pw = profile_crypto.decrypt_secret(p.get("olympus_password_enc"))
        except profile_crypto.EncKeyMissing as e:
            return jsonify({"error": str(e)}), 503
        from services.olympus_bridge import fetch_unit_image
        result = fetch_unit_image(p.get("olympus_host"), p.get("olympus_port") or 4512, pw or "", filename)
        if not result.get("ok"):
            return jsonify(result), 502
        return Response(result["raw"], mimetype=result["content_type"],
                        headers={"Cache-Control": "public, max-age=86400"})

    @app.route("/api/groups/<gid>/profiles/<pid>/command", methods=["POST"])
    def profile_command(gid, pid):
        """Send an Olympus command — gated by the member's role CAPABILITY, not a
        flat admin check. spawn*/deleteUnit/smoke/explosion need spawn/delete/
        effects; everything else needs 'command'. Observers (no caps) are
        read-only. Password decrypted server-side; command in the relay whitelist."""
        sb, user, err = _ctx()
        if err:
            return err
        member_role = role_in_group(sb, user["id"], gid)
        if member_role is None:
            return jsonify({"error": "Not a member"}), 403
        body = request.get_json(silent=True) or {}
        command = body.get("command")
        params = body.get("params") or {}
        if not command:
            return jsonify({"error": "command required"}), 400
        cap = command_capability(command)
        if not role_has(member_role, cap):
            return jsonify({"error": f"Your role ({member_role}) is not allowed to {cap}."}), 403
        rows = (
            sb.table("server_profiles").select("*")
            .eq("id", pid).eq("group_id", gid).execute().data
        ) or []
        if not rows:
            return jsonify({"error": "Profile not found"}), 404
        p = rows[0]
        try:
            pw = profile_crypto.decrypt_secret(p.get("olympus_password_enc"))
        except profile_crypto.EncKeyMissing as e:
            return jsonify({"error": str(e)}), 503
        from services.olympus_bridge import send_command
        result = send_command(p.get("olympus_host"), p.get("olympus_port") or 4512, pw or "", command, params)
        return jsonify(result), (200 if result.get("ok") else 502)

    # ----------------------------------------------------------------------
    # Trigger fire (Phase 9). DCS missions normally fire triggers via the F10
    # comm menu or via in-game events; this exposes a web-side fire mechanism
    # so the DM never has to leave the scope. Mechanism: spawn a tiny effect
    # (smoke) at a magic-encoded coordinate; a mission-side bridge script
    # listens for smoke at those coords and sets the matching user flag,
    # which the (Editor-modified) trigger's condition watches.
    #
    # The magic-coord encoding: lat = 89.0 + flagIndex * 0.000_001, lng = -179.0
    # Outside any DCS theatre projection so spawns don't visibly land on the
    # mission area; ~0.1 m precision is ample for the flag-index integer.
    # The bridge script (Editor → Scripts → "DM trigger bridge") matches lat
    # vs the encoded value and dispatches.
    # ----------------------------------------------------------------------
    @app.route("/api/groups/<gid>/profiles/<pid>/fire_trigger", methods=["POST"])
    def fire_trigger(gid, pid):
        sb, user, err = _ctx()
        if err:
            return err
        member_role = role_in_group(sb, user["id"], gid)
        if member_role is None:
            return jsonify({"error": "Not a member"}), 403
        if not role_has(member_role, "command"):
            return jsonify({"error": f"Your role ({member_role}) cannot fire triggers."}), 403
        body = request.get_json(silent=True) or {}
        flag_index = body.get("flagIndex")
        try:
            flag_index = int(flag_index)
        except (TypeError, ValueError):
            return jsonify({"error": "flagIndex required (int)"}), 400
        if not (0 < flag_index < 1_000_000):
            return jsonify({"error": "flagIndex out of range (1..999_999)"}), 400
        rows = (
            sb.table("server_profiles").select("*")
            .eq("id", pid).eq("group_id", gid).execute().data
        ) or []
        if not rows:
            return jsonify({"error": "Profile not found"}), 404
        p = rows[0]
        try:
            pw = profile_crypto.decrypt_secret(p.get("olympus_password_enc"))
        except profile_crypto.EncKeyMissing as e:
            return jsonify({"error": str(e)}), 503
        # Encode flagIndex into the latitude's microsecond field. lat = 89 +
        # flag*1e-6 stays comfortably under 90 for any flag in the allowed
        # range. lng pegged at -179 so spawns cluster at the "fire pole" and
        # the bridge script can be lat-only checked.
        lat = 89.0 + flag_index * 1e-6
        lng = -179.0
        from services.olympus_bridge import send_command
        # spawnGroundUnits fires DCS's S_EVENT_BIRTH which our bridge script
        # listens for. Soldier M4 = smallest / cheapest unit type Olympus
        # exposes; immediate=true skips spawn-points consumption; spawnPoints
        # = 0 to make sure even capped roles can fire. Coalition neutral so
        # the spawn doesn't show up to red/blue players in the F10 picture.
        units_payload = [{
            "unitType": "Soldier M4",
            "location": {"lat": lat, "lng": lng},
            "skill": "Average", "liveryID": "",
        }]
        params = {
            "units": units_payload, "coalition": "neutral", "country": "",
            "immediate": True, "spawnPoints": 0,
        }
        result = send_command(
            p.get("olympus_host"), p.get("olympus_port") or 4512, pw or "",
            "spawnGroundUnits", params,
        )
        return jsonify({
            "ok": result.get("ok", False),
            "flagIndex": flag_index,
            "encodedLat": lat,
            "encodedLng": lng,
            "raw": result,
        }), (200 if result.get("ok") else 502)

    # ----------------------------------------------------------------------
    # SRS-Server stats poll (Phase 2 of the LotATC scope, v1.17.8).
    # Member-gated; degrades gracefully when SRS_SERVER_URL is unset (returns
    # 200 + configured:false so the SRS Directory just hides the "● N on"
    # pills). When configured, returns the connected client list + freqs.
    # ----------------------------------------------------------------------
    @app.route("/api/groups/<gid>/srs_status", methods=["GET"])
    def group_srs_status(gid):
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) is None:
            return jsonify({"error": "Not a member"}), 403
        from services.srs_status import get_status
        return jsonify(get_status())

    # ----------------------------------------------------------------------
    # Controller text comms (Phase 3 of the LotATC-style scope).
    # The DM (or anyone with the `command` cap) posts typed orders; every
    # member's CommsLog SSE stream receives them within ~1s. Pure app-
    # internal lane — Olympus has no chat command, so we route through
    # our own pubsub.
    # ----------------------------------------------------------------------
    @app.route("/api/groups/<gid>/comms", methods=["GET"])
    def comms_list(gid):
        """Backfill the recent message history when a member first opens CommsLog."""
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) is None:
            return jsonify({"error": "Not a member"}), 403
        with _COMMS_LOCK:
            hist = list(_COMMS_HISTORY.get(gid, []))
        return jsonify({"messages": hist})

    @app.route("/api/groups/<gid>/comms", methods=["POST"])
    def comms_post(gid):
        """DM posts a typed order. Gated by the `command` capability (DM model)."""
        sb, user, err = _ctx()
        if err:
            return err
        member_role = role_in_group(sb, user["id"], gid)
        if member_role is None:
            return jsonify({"error": "Not a member"}), 403
        if not role_has(member_role, "command"):
            return jsonify({"error": f"Your role ({member_role}) cannot broadcast comms."}), 403
        body = request.get_json(silent=True) or {}
        text = (body.get("text") or "").strip()
        if not text:
            return jsonify({"error": "text required"}), 400
        if len(text) > 1000:
            text = text[:1000]
        msg = {
            "id": _uuid(),
            "ts": _now_iso(),
            "author": user.get("username") or "DM",
            "authorId": user["id"],
            "role": member_role,
            "text": text,
        }
        _comms_publish(gid, msg)
        return jsonify(msg)

    @app.route("/api/groups/<gid>/comms/stream", methods=["GET"])
    def comms_stream(gid):
        """SSE: every member can subscribe. Heartbeat every HEARTBEAT_INTERVAL
        seconds keeps Cloudflare from killing the connection on idle groups."""
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) is None:
            return jsonify({"error": "Not a member"}), 403

        q: Queue = Queue()
        with _COMMS_LOCK:
            _COMMS_SUBS.setdefault(gid, []).append(q)

        def generate():
            yield ": connected\n\n"
            try:
                while True:
                    try:
                        msg = q.get(timeout=30)
                        yield f"event: comms\ndata: {json.dumps(msg)}\n\n"
                    except Exception:
                        yield ": heartbeat\n\n"
            except GeneratorExit:
                pass
            finally:
                with _COMMS_LOCK:
                    try:
                        _COMMS_SUBS.get(gid, []).remove(q)
                    except (ValueError, KeyError):
                        pass

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )
