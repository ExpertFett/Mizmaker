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

from flask import request, jsonify

from services.auth import current_user
from services.supabase_client import get_supabase
from services import profile_crypto


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


def _serialize_profile(p: dict) -> dict:
    """Public profile shape — NEVER includes the encrypted password."""
    return {
        "id": p["id"],
        "name": p["name"],
        "olympusHost": p.get("olympus_host"),
        "olympusPort": p.get("olympus_port"),
        "lotatcUrl": p.get("lotatc_url"),
        "hasPassword": bool(p.get("olympus_password_enc")),
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
        role = body.get("role") if body.get("role") in ("admin", "operator") else "operator"
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
        except profile_crypto.EncKeyMissing as e:
            return jsonify({"error": str(e)}), 503
        pid = _uuid()
        sb.table("server_profiles").insert({
            "id": pid, "group_id": gid, "name": name,
            "olympus_host": body.get("olympusHost"),
            "olympus_port": int(body.get("olympusPort") or 4512),
            "olympus_password_enc": pw_enc,
            "lotatc_url": body.get("lotatcUrl"),
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
        return jsonify(result), (200 if result.get("ok") else 502)

    @app.route("/api/groups/<gid>/profiles/<pid>/command", methods=["POST"])
    def profile_command(gid, pid):
        """Send an Olympus command to the server. ADMIN ONLY — control (spawn/
        delete/move/etc.) is powerful, so operators get read-only. Password
        decrypted server-side; command validated against the relay whitelist."""
        sb, user, err = _ctx()
        if err:
            return err
        if role_in_group(sb, user["id"], gid) != "admin":
            return jsonify({"error": "Admin only — control is restricted to group admins."}), 403
        body = request.get_json(silent=True) or {}
        command = body.get("command")
        params = body.get("params") or {}
        if not command:
            return jsonify({"error": "command required"}), 400
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
