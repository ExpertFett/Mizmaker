"""Tests for the controller text comms endpoints (Phase 3 of the LotATC scope).

Endpoints under test:
  GET  /api/groups/<gid>/comms          — backfill recent messages (any member)
  POST /api/groups/<gid>/comms          — broadcast (canCommand gating)
  GET  /api/groups/<gid>/comms/stream   — SSE fan-out (any member)

For the broadcast lane we test (a) the role gating mirrors the rest of the
group API (admin/commander OK, operator/jtac/atc NOT), (b) the request body
is validated, (c) the history endpoint reflects what was posted in order,
and (d) the in-memory pubsub correctly fans out to subscriber queues. We do
NOT open a real EventSource — the SSE generator is a stateful gevent loop
that hangs forever waiting for messages; instead we drive the pubsub via
the module-level helpers and assert the queues receive what we expect.

Reuses the FakeSB + login() helpers from test_groups so the auth + tenancy
plumbing matches the rest of the suite.
"""

from __future__ import annotations

import os

import pytest

from services import groups as groups_mod, profile_crypto, supabase_client

from tests.test_groups import FakeSB, login  # reuse the existing fixtures


@pytest.fixture
def fake_sb():
    sb = FakeSB()
    supabase_client.set_client(sb)
    os.environ["PROFILE_ENC_KEY"] = profile_crypto.gen_key()
    # Clear the comms pubsub between tests so cross-test history doesn't
    # leak (these are module-level globals).
    groups_mod._COMMS_HISTORY.clear()
    groups_mod._COMMS_SUBS.clear()
    yield sb
    supabase_client.reset_client()
    os.environ.pop("PROFILE_ENC_KEY", None)
    groups_mod._COMMS_HISTORY.clear()
    groups_mod._COMMS_SUBS.clear()


def _make_group(client, monkeypatch, *, owner_id: str = "admin1", owner_name: str = "Admin") -> str:
    login(monkeypatch, owner_id, owner_name)
    return client.post("/api/groups", json={"name": "G"}).get_json()["id"]


def _add_member(client, monkeypatch, gid: str, *, member_id: str, role: str) -> None:
    """Drop a user into the group with the given role via invite + role PATCH."""
    # Admin opens an invite at the desired role; the joiner gets that role.
    login(monkeypatch, "admin1")
    code = client.post(
        f"/api/groups/{gid}/invites", json={"role": role}
    ).get_json()["code"]
    login(monkeypatch, member_id, member_id.title())
    client.post("/api/groups/join", json={"code": code})


# --------------------------------------------------------------------------
# POST gating + body validation
# --------------------------------------------------------------------------
class TestCommsPost:
    def test_admin_can_broadcast(self, client, fake_sb, monkeypatch):
        gid = _make_group(client, monkeypatch)
        r = client.post(f"/api/groups/{gid}/comms", json={"text": "Uzi 1-1 vector 080 for 18"})
        assert r.status_code == 200
        msg = r.get_json()
        assert msg["text"] == "Uzi 1-1 vector 080 for 18"
        assert msg["author"] == "Admin"
        assert msg["role"] == "admin"
        assert msg["id"] and msg["ts"]  # populated

    def test_commander_can_broadcast(self, client, fake_sb, monkeypatch):
        gid = _make_group(client, monkeypatch)
        _add_member(client, monkeypatch, gid, member_id="cmdr1", role="commander")
        login(monkeypatch, "cmdr1", "Cmdr")
        r = client.post(f"/api/groups/{gid}/comms", json={"text": "Push"})
        assert r.status_code == 200

    @pytest.mark.parametrize("role", ["operator", "jtac", "atc"])
    def test_non_command_roles_blocked(self, client, fake_sb, monkeypatch, role):
        gid = _make_group(client, monkeypatch)
        _add_member(client, monkeypatch, gid, member_id=f"u_{role}", role=role)
        login(monkeypatch, f"u_{role}")
        r = client.post(f"/api/groups/{gid}/comms", json={"text": "hi"})
        assert r.status_code == 403
        # The error names the user's role so it's actionable.
        assert role in r.get_json()["error"]

    def test_non_member_blocked(self, client, fake_sb, monkeypatch):
        gid = _make_group(client, monkeypatch)
        login(monkeypatch, "stranger")
        assert client.post(f"/api/groups/{gid}/comms", json={"text": "x"}).status_code == 403

    def test_empty_text_400(self, client, fake_sb, monkeypatch):
        gid = _make_group(client, monkeypatch)
        assert client.post(f"/api/groups/{gid}/comms", json={"text": ""}).status_code == 400
        assert client.post(f"/api/groups/{gid}/comms", json={"text": "   "}).status_code == 400
        assert client.post(f"/api/groups/{gid}/comms", json={}).status_code == 400

    def test_long_text_truncated_to_1000(self, client, fake_sb, monkeypatch):
        gid = _make_group(client, monkeypatch)
        long_text = "A" * 1500
        r = client.post(f"/api/groups/{gid}/comms", json={"text": long_text})
        assert r.status_code == 200
        assert len(r.get_json()["text"]) == 1000


# --------------------------------------------------------------------------
# GET history backfill
# --------------------------------------------------------------------------
class TestCommsHistory:
    def test_empty_history(self, client, fake_sb, monkeypatch):
        gid = _make_group(client, monkeypatch)
        r = client.get(f"/api/groups/{gid}/comms")
        assert r.status_code == 200
        assert r.get_json()["messages"] == []

    def test_history_preserves_order(self, client, fake_sb, monkeypatch):
        gid = _make_group(client, monkeypatch)
        for line in ("first", "second", "third"):
            client.post(f"/api/groups/{gid}/comms", json={"text": line})
        msgs = client.get(f"/api/groups/{gid}/comms").get_json()["messages"]
        assert [m["text"] for m in msgs] == ["first", "second", "third"]

    def test_history_member_only(self, client, fake_sb, monkeypatch):
        gid = _make_group(client, monkeypatch)
        client.post(f"/api/groups/{gid}/comms", json={"text": "ops only"})
        login(monkeypatch, "stranger")
        assert client.get(f"/api/groups/{gid}/comms").status_code == 403

    def test_operator_can_read_history(self, client, fake_sb, monkeypatch):
        """DM model: operator can't broadcast but CAN read the audit log."""
        gid = _make_group(client, monkeypatch)
        client.post(f"/api/groups/{gid}/comms", json={"text": "package brief at 0500Z"})
        _add_member(client, monkeypatch, gid, member_id="op1", role="operator")
        login(monkeypatch, "op1")
        msgs = client.get(f"/api/groups/{gid}/comms").get_json()["messages"]
        assert len(msgs) == 1 and msgs[0]["text"] == "package brief at 0500Z"


# --------------------------------------------------------------------------
# In-memory pubsub (drives the SSE stream)
# --------------------------------------------------------------------------
class TestPubsub:
    def test_publish_appends_to_history(self):
        groups_mod._comms_publish("gA", {"id": "m1", "text": "hello"})
        assert groups_mod._COMMS_HISTORY["gA"] == [{"id": "m1", "text": "hello"}]

    def test_publish_fans_out_to_subscribers(self):
        from gevent.queue import Queue
        q1, q2 = Queue(), Queue()
        groups_mod._COMMS_SUBS["gA"] = [q1, q2]
        msg = {"id": "m1", "text": "hello"}
        groups_mod._comms_publish("gA", msg)
        # Both subscribers receive the same payload.
        assert q1.get_nowait() == msg
        assert q2.get_nowait() == msg

    def test_publish_isolates_groups(self):
        from gevent.queue import Queue
        q_a, q_b = Queue(), Queue()
        groups_mod._COMMS_SUBS["gA"] = [q_a]
        groups_mod._COMMS_SUBS["gB"] = [q_b]
        groups_mod._comms_publish("gA", {"id": "m1"})
        assert q_a.get_nowait() == {"id": "m1"}
        # B's queue stays empty — different tenant.
        assert q_b.qsize() == 0

    def test_history_ring_buffer_caps_at_max(self):
        """The history bounded to _COMMS_HISTORY_MAX entries — old ones drop."""
        # Bump the cap down to 5 for the test so we don't push 200 messages.
        original_max = groups_mod._COMMS_HISTORY_MAX
        groups_mod._COMMS_HISTORY_MAX = 5
        try:
            for i in range(8):
                groups_mod._comms_publish("gA", {"id": f"m{i}", "n": i})
            hist = groups_mod._COMMS_HISTORY["gA"]
            assert len(hist) == 5
            # The oldest entries (n=0,1,2) dropped; we keep 3..7.
            assert [m["n"] for m in hist] == [3, 4, 5, 6, 7]
        finally:
            groups_mod._COMMS_HISTORY_MAX = original_max
