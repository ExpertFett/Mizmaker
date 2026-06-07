"""Tests for the multi-tenant groups / server-profiles API (services/groups.py).

Uses a fake Supabase client (no network, no `supabase` pkg) and a real Fernet
key. Auth is stubbed by patching services.groups.current_user so we can act as
different Discord users and exercise the membership/role gating."""

from __future__ import annotations

import os

import pytest

from services import supabase_client, profile_crypto


# --------------------------------------------------------------------------
# Fake Supabase client: dict-of-tables, chained .eq() filters, CRUD.
# --------------------------------------------------------------------------
class _Resp:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, rows: list):
        self._rows = rows            # live reference to the table's row list
        self._op = "select"
        self._payload = None
        self._filters = []

    def select(self, *_a, **_k):
        self._op = "select"; return self

    def insert(self, row):
        self._op = "insert"; self._payload = row; return self

    def update(self, data):
        self._op = "update"; self._payload = data; return self

    def delete(self):
        self._op = "delete"; return self

    def eq(self, col, val):
        self._filters.append((col, val)); return self

    def lt(self, col, val):
        self._filters.append(("__lt__" + col, val)); return self

    def _match(self, r):
        for col, val in self._filters:
            if col.startswith("__lt__"):
                c = col[len("__lt__"):]
                if not (r.get(c) is not None and r.get(c) < val):
                    return False
            elif r.get(col) != val:
                return False
        return True

    def execute(self):
        if self._op == "insert":
            row = dict(self._payload)
            self._rows.append(row)
            return _Resp([dict(row)])
        matched = [r for r in self._rows if self._match(r)]
        if self._op == "update":
            for r in matched:
                r.update(self._payload)
            return _Resp([dict(r) for r in matched])
        if self._op == "delete":
            for r in list(matched):
                self._rows.remove(r)
            return _Resp([dict(r) for r in matched])
        return _Resp([dict(r) for r in matched])


class FakeSB:
    def __init__(self):
        self.tables: dict = {}

    def table(self, name):
        return _Q(self.tables.setdefault(name, []))


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------
@pytest.fixture
def fake_sb():
    sb = FakeSB()
    supabase_client.set_client(sb)
    os.environ["PROFILE_ENC_KEY"] = profile_crypto.gen_key()
    yield sb
    supabase_client.reset_client()
    os.environ.pop("PROFILE_ENC_KEY", None)


def login(monkeypatch, discord_id: str, username: str = "User"):
    """Act as a given Discord user for subsequent requests."""
    monkeypatch.setattr(
        "services.groups.current_user",
        lambda: {"id": discord_id, "username": username},
    )


# --------------------------------------------------------------------------
# Auth / config gating
# --------------------------------------------------------------------------
class TestGating:
    def test_not_logged_in_401(self, client, monkeypatch):
        monkeypatch.setattr("services.groups.current_user", lambda: None)
        r = client.get("/api/groups")
        assert r.status_code == 401

    def test_supabase_unconfigured_503(self, client, monkeypatch):
        login(monkeypatch, "d1")
        supabase_client.set_client(None)  # simulate "not configured"
        try:
            r = client.get("/api/groups")
            assert r.status_code == 503
        finally:
            supabase_client.reset_client()


# --------------------------------------------------------------------------
# Group lifecycle
# --------------------------------------------------------------------------
class TestGroups:
    def test_create_and_list(self, client, fake_sb, monkeypatch):
        login(monkeypatch, "d1", "Fett")
        r = client.post("/api/groups", json={"name": "Bengals"})
        assert r.status_code == 201
        gid = r.get_json()["id"]
        assert r.get_json()["role"] == "admin"

        r = client.get("/api/groups")
        body = r.get_json()
        assert len(body["groups"]) == 1
        assert body["groups"][0]["id"] == gid
        assert body["groups"][0]["role"] == "admin"

    def test_create_requires_name(self, client, fake_sb, monkeypatch):
        login(monkeypatch, "d1")
        assert client.post("/api/groups", json={"name": "  "}).status_code == 400


class TestInvites:
    def test_invite_redeem_flow(self, client, fake_sb, monkeypatch):
        # Admin creates a group + invite
        login(monkeypatch, "admin1", "Admin")
        gid = client.post("/api/groups", json={"name": "VMFA-224"}).get_json()["id"]
        inv = client.post(f"/api/groups/{gid}/invites", json={"role": "operator"})
        assert inv.status_code == 201
        code = inv.get_json()["code"]

        # A second user redeems it → becomes operator
        login(monkeypatch, "op1", "Operator")
        j = client.post("/api/groups/join", json={"code": code})
        assert j.status_code == 200
        assert j.get_json()["role"] == "operator"
        # ...and now sees the group
        mine = client.get("/api/groups").get_json()["groups"]
        assert len(mine) == 1 and mine[0]["id"] == gid

    def test_bad_code_404(self, client, fake_sb, monkeypatch):
        login(monkeypatch, "d1")
        assert client.post("/api/groups/join", json={"code": "nope"}).status_code == 404

    def test_operator_cannot_invite(self, client, fake_sb, monkeypatch):
        login(monkeypatch, "admin1")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        code = client.post(f"/api/groups/{gid}/invites", json={}).get_json()["code"]
        login(monkeypatch, "op1")
        client.post("/api/groups/join", json={"code": code})
        # operator tries to create an invite
        assert client.post(f"/api/groups/{gid}/invites", json={}).status_code == 403


class TestProfiles:
    def _group(self, client, monkeypatch):
        login(monkeypatch, "admin1", "Admin")
        return client.post("/api/groups", json={"name": "G"}).get_json()["id"]

    def test_create_hides_password(self, client, fake_sb, monkeypatch):
        gid = self._group(client, monkeypatch)
        r = client.post(f"/api/groups/{gid}/profiles", json={
            "name": "Main", "olympusHost": "10.0.0.5", "olympusPort": 4512,
            "olympusPassword": "supersecret", "lotatcUrl": "http://10.0.0.5:9000",
        })
        assert r.status_code == 201

        # GET never returns the password, but flags that one is set
        profs = client.get(f"/api/groups/{gid}/profiles").get_json()["profiles"]
        assert len(profs) == 1
        p = profs[0]
        assert p["hasPassword"] is True
        assert "olympusPassword" not in p and "olympus_password_enc" not in p
        assert p["olympusHost"] == "10.0.0.5"

        # The stored value is ciphertext that decrypts back to the original
        stored = fake_sb.tables["server_profiles"][0]["olympus_password_enc"]
        assert stored and stored != "supersecret"
        assert profile_crypto.decrypt_secret(stored) == "supersecret"

    def test_operator_cannot_create_profile(self, client, fake_sb, monkeypatch):
        gid = self._group(client, monkeypatch)
        code = client.post(f"/api/groups/{gid}/invites", json={}).get_json()["code"]
        login(monkeypatch, "op1")
        client.post("/api/groups/join", json={"code": code})
        r = client.post(f"/api/groups/{gid}/profiles", json={"name": "X"})
        assert r.status_code == 403

    def test_non_member_cannot_read_profiles(self, client, fake_sb, monkeypatch):
        gid = self._group(client, monkeypatch)
        login(monkeypatch, "stranger")
        assert client.get(f"/api/groups/{gid}/profiles").status_code == 403

    def test_update_and_delete(self, client, fake_sb, monkeypatch):
        gid = self._group(client, monkeypatch)
        pid = client.post(f"/api/groups/{gid}/profiles", json={"name": "Main"}).get_json()["id"]
        assert client.patch(f"/api/groups/{gid}/profiles/{pid}", json={"name": "Renamed"}).status_code == 200
        assert client.get(f"/api/groups/{gid}/profiles").get_json()["profiles"][0]["name"] == "Renamed"
        assert client.delete(f"/api/groups/{gid}/profiles/{pid}").status_code == 200
        assert client.get(f"/api/groups/{gid}/profiles").get_json()["profiles"] == []


class TestMembers:
    def test_list_and_leave(self, client, fake_sb, monkeypatch):
        login(monkeypatch, "admin1", "Admin")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        code = client.post(f"/api/groups/{gid}/invites", json={}).get_json()["code"]
        login(monkeypatch, "op1", "Op")
        client.post("/api/groups/join", json={"code": code})

        # Admin sees both members
        login(monkeypatch, "admin1")
        members = client.get(f"/api/groups/{gid}/members").get_json()["members"]
        assert len(members) == 2
        roles = {m["role"] for m in members}
        assert roles == {"admin", "operator"}

        # Operator leaves (removes self)
        login(monkeypatch, "op1")
        # need op1's user id — fetch via members as admin first
        login(monkeypatch, "admin1")
        ms = client.get(f"/api/groups/{gid}/members").get_json()["members"]
        op_uid = next(m["userId"] for m in ms if m["role"] == "operator")
        login(monkeypatch, "op1")
        assert client.delete(f"/api/groups/{gid}/members/{op_uid}").status_code == 200
        login(monkeypatch, "admin1")
        assert len(client.get(f"/api/groups/{gid}/members").get_json()["members"]) == 1


class TestProfileConnection:
    """Test Connection endpoint — relays through the (mocked) Olympus probe."""

    def _group_and_profile(self, client, monkeypatch, password=None):
        login(monkeypatch, "admin1", "Admin")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        body = {"name": "S", "olympusHost": "10.0.0.5", "olympusPort": 4512}
        if password is not None:
            body["olympusPassword"] = password
        pid = client.post(f"/api/groups/{gid}/profiles", json=body).get_json()["id"]
        return gid, pid

    def test_ok(self, client, fake_sb, monkeypatch):
        gid, pid = self._group_and_profile(client, monkeypatch)
        monkeypatch.setattr("services.olympus_bridge.status_check",
                            lambda h, p, pw: {"ok": True, "reachable": True, "authOk": True})
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/test")
        assert r.status_code == 200 and r.get_json()["ok"] is True

    def test_passes_decrypted_password(self, client, fake_sb, monkeypatch):
        gid, pid = self._group_and_profile(client, monkeypatch, password="rolepw")
        captured = {}

        def fake(host, port, pw):
            captured.update(host=host, port=port, pw=pw)
            return {"ok": True}

        monkeypatch.setattr("services.olympus_bridge.status_check", fake)
        client.post(f"/api/groups/{gid}/profiles/{pid}/test")
        assert captured["host"] == "10.0.0.5" and captured["pw"] == "rolepw"

    def test_non_member_403(self, client, fake_sb, monkeypatch):
        gid, pid = self._group_and_profile(client, monkeypatch)
        login(monkeypatch, "stranger")
        assert client.post(f"/api/groups/{gid}/profiles/{pid}/test").status_code == 403

    def test_missing_profile_404(self, client, fake_sb, monkeypatch):
        login(monkeypatch, "admin1")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        assert client.post(f"/api/groups/{gid}/profiles/nope/test").status_code == 404


class TestTelemetry:
    def _gp(self, client, monkeypatch):
        login(monkeypatch, "admin1", "Admin")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        pid = client.post(f"/api/groups/{gid}/profiles",
                          json={"name": "S", "olympusHost": "h", "olympusPort": 3000}).get_json()["id"]
        return gid, pid

    def test_member_gets_telemetry(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp(client, monkeypatch)
        monkeypatch.setattr("services.olympus_bridge.fetch_telemetry",
                            lambda h, p, pw, res: {"ok": True, "data": {"theatre": "Caucasus"}})
        r = client.get(f"/api/groups/{gid}/profiles/{pid}/telemetry/mission")
        assert r.status_code == 200 and r.get_json()["data"]["theatre"] == "Caucasus"

    def test_non_member_403(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp(client, monkeypatch)
        login(monkeypatch, "stranger")
        assert client.get(f"/api/groups/{gid}/profiles/{pid}/telemetry/units").status_code == 403

    def test_error_maps_502(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp(client, monkeypatch)
        monkeypatch.setattr("services.olympus_bridge.fetch_telemetry",
                            lambda h, p, pw, res: {"ok": False, "error": "unreachable"})
        assert client.get(f"/api/groups/{gid}/profiles/{pid}/telemetry/mission").status_code == 502


class TestCommand:
    def _gp(self, client, monkeypatch):
        login(monkeypatch, "admin1", "Admin")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        pid = client.post(f"/api/groups/{gid}/profiles",
                          json={"name": "S", "olympusHost": "h", "olympusPort": 3000}).get_json()["id"]
        return gid, pid

    def test_admin_command_ok(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp(client, monkeypatch)
        monkeypatch.setattr("services.olympus_bridge.send_command",
                            lambda h, p, pw, c, par: {"ok": True, "response": "ok"})
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/command",
                        json={"command": "smoke", "params": {"color": "green"}})
        assert r.status_code == 200 and r.get_json()["ok"] is True

    def test_operator_cannot_command(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp(client, monkeypatch)
        code = client.post(f"/api/groups/{gid}/invites", json={}).get_json()["code"]
        login(monkeypatch, "op1")
        client.post("/api/groups/join", json={"code": code})
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/command",
                        json={"command": "deleteUnit", "params": {}})
        assert r.status_code == 403

    def test_missing_command_400(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp(client, monkeypatch)
        assert client.post(f"/api/groups/{gid}/profiles/{pid}/command", json={}).status_code == 400


class TestDatabase:
    def _gp(self, client, monkeypatch):
        login(monkeypatch, "admin1", "Admin")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        pid = client.post(f"/api/groups/{gid}/profiles",
                          json={"name": "S", "olympusHost": "h", "olympusPort": 3000}).get_json()["id"]
        return gid, pid

    def test_member_gets_db(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp(client, monkeypatch)
        monkeypatch.setattr("services.olympus_bridge.fetch_unit_database",
                            lambda h, p, pw, cat: {"ok": True, "data": {"M-1 Abrams": {"label": "M-1 Abrams"}}})
        r = client.get(f"/api/groups/{gid}/profiles/{pid}/database/groundunit")
        assert r.status_code == 200 and "M-1 Abrams" in r.get_json()["data"]

    def test_non_member_403(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp(client, monkeypatch)
        login(monkeypatch, "stranger")
        assert client.get(f"/api/groups/{gid}/profiles/{pid}/database/aircraft").status_code == 403


class TestDiscordPost:
    """v1.19.50 — POST /api/groups/<gid>/profiles/<pid>/discord/post relays a
    rich-embed payload to the profile's encrypted webhook URL.

    We stub urllib.request.urlopen so no actual HTTP fires. Admin login
    creates a profile WITH a webhook URL; tests then exercise gating +
    payload shape.
    """

    def _gp_with_webhook(self, client, monkeypatch, with_webhook=True):
        login(monkeypatch, "admin1", "Admin")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        body = {"name": "S", "olympusHost": "h", "olympusPort": 3000}
        if with_webhook:
            body["discordWebhookUrl"] = "https://discord.com/api/webhooks/12345/abc"
        pid = client.post(f"/api/groups/{gid}/profiles", json=body).get_json()["id"]
        return gid, pid

    def test_hasDiscord_surfaces_in_profile_shape(self, client, fake_sb, monkeypatch):
        """The serializer should report hasDiscord=True without ever leaking
        the URL itself."""
        gid, pid = self._gp_with_webhook(client, monkeypatch, with_webhook=True)
        r = client.get(f"/api/groups/{gid}/profiles")
        profiles = r.get_json()["profiles"]
        assert profiles[0]["hasDiscord"] is True
        # Critical: the raw URL is NEVER in the response.
        assert "discord_webhook_enc" not in profiles[0]
        assert "discordWebhookUrl" not in profiles[0]

    def test_profile_without_webhook_has_hasDiscord_false(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp_with_webhook(client, monkeypatch, with_webhook=False)
        r = client.get(f"/api/groups/{gid}/profiles")
        assert r.get_json()["profiles"][0]["hasDiscord"] is False

    def test_post_relays_embed_to_webhook(self, client, fake_sb, monkeypatch):
        """Happy path: admin sends a 9-line, backend POSTs to Discord with
        a rich embed."""
        gid, pid = self._gp_with_webhook(client, monkeypatch)
        captured = {}

        class FakeResponse:
            status = 204
            def __enter__(self): return self
            def __exit__(self, *args): pass

        def fake_urlopen(req, timeout=8):
            captured["url"] = req.full_url
            import json as _j
            captured["body"] = _j.loads(req.data.decode("utf-8"))
            return FakeResponse()

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
        r = client.post(
            f"/api/groups/{gid}/profiles/{pid}/discord/post",
            json={"title": "9-Line", "description": "test message",
                  "color": 0xff8800, "footer": "via Main"},
        )
        assert r.status_code == 200 and r.get_json()["ok"] is True
        assert captured["url"] == "https://discord.com/api/webhooks/12345/abc"
        embed = captured["body"]["embeds"][0]
        assert embed["title"] == "9-Line"
        assert embed["description"] == "test message"
        assert embed["color"] == 0xff8800
        assert embed["footer"]["text"] == "via Main"

    def test_empty_description_400(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp_with_webhook(client, monkeypatch)
        r = client.post(
            f"/api/groups/{gid}/profiles/{pid}/discord/post",
            json={"description": "  "},
        )
        assert r.status_code == 400

    def test_no_webhook_on_profile_400(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp_with_webhook(client, monkeypatch, with_webhook=False)
        r = client.post(
            f"/api/groups/{gid}/profiles/{pid}/discord/post",
            json={"description": "test"},
        )
        assert r.status_code == 400
        assert "No Discord webhook" in r.get_json()["error"]

    def test_non_command_role_403(self, client, fake_sb, monkeypatch):
        """JTAC/ATC roles get tools_* but not 'command', so they can't
        broadcast via the Discord channel."""
        gid, pid = self._gp_with_webhook(client, monkeypatch)
        # Invite a jtac-role user.
        invite = client.post(f"/api/groups/{gid}/invites",
                             json={"role": "jtac"}).get_json()["code"]
        login(monkeypatch, "jtac1", "Jtac")
        client.post("/api/groups/join", json={"code": invite})
        r = client.post(
            f"/api/groups/{gid}/profiles/{pid}/discord/post",
            json={"description": "test"},
        )
        assert r.status_code == 403
        assert "command" in r.get_json()["error"].lower()

    def test_non_member_403(self, client, fake_sb, monkeypatch):
        gid, pid = self._gp_with_webhook(client, monkeypatch)
        login(monkeypatch, "stranger")
        r = client.post(
            f"/api/groups/{gid}/profiles/{pid}/discord/post",
            json={"description": "test"},
        )
        assert r.status_code == 403

    def test_invalid_stored_url_400(self, client, fake_sb, monkeypatch):
        """If the stored URL doesn't look like a Discord webhook, bail out
        before we send any HTTP. Belt-and-braces against config drift."""
        login(monkeypatch, "admin1", "Admin")
        gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
        pid = client.post(f"/api/groups/{gid}/profiles", json={
            "name": "S", "discordWebhookUrl": "https://evil.example.com/leaked",
        }).get_json()["id"]
        r = client.post(
            f"/api/groups/{gid}/profiles/{pid}/discord/post",
            json={"description": "test"},
        )
        assert r.status_code == 400
        assert "invalid" in r.get_json()["error"].lower()

    def test_description_truncated_to_4000_chars(self, client, fake_sb, monkeypatch):
        """Discord's embed.description limit is 4096; we trim at 4000 to
        leave headroom. Important: this is silent truncation, but a 4000+
        char comms is already absurd."""
        gid, pid = self._gp_with_webhook(client, monkeypatch)
        captured = {}

        class FakeResponse:
            status = 204
            def __enter__(self): return self
            def __exit__(self, *args): pass

        def fake_urlopen(req, timeout=8):
            import json as _j
            captured["body"] = _j.loads(req.data.decode("utf-8"))
            return FakeResponse()

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
        client.post(
            f"/api/groups/{gid}/profiles/{pid}/discord/post",
            json={"description": "A" * 5000},
        )
        assert len(captured["body"]["embeds"][0]["description"]) == 4000
