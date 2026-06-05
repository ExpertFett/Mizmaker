"""Tests for the Live session event recorder routes (app.py).

Validates:
  - GET on empty session returns empty list + null start time
  - POST a single event via {event: ...} → stored, recorded_at stamped
  - POST a batch via {events: [...]} → all stored
  - live_started_at is set on first POST and unchanged on subsequent
  - DELETE clears the log + start time
  - Bad POST shapes return 400 without crashing
  - AAR fallback: when the AAR body omits events, the session log is used
"""

from __future__ import annotations

import io
import time

import pytest


@pytest.fixture
def client():
    """A Flask test client with a single session pre-uploaded."""
    from app import app, _store
    app.testing = True
    # Make a minimal mission text so upload works. The session_store
    # creates events:[] on create() so we can skip the upload by injecting
    # a session directly via the store API.
    sid, host = _store.create(
        miz_bytes=b"",
        mission_text='mission = {["theatre"]="PersianGulf"}',
        theater="PersianGulf",
        filename="test.miz",
        group_waypoints={},
    )
    with app.test_client() as c:
        c.sid = sid  # stash for the tests
        yield c
    # cleanup
    _store.delete(sid)


# ── GET ────────────────────────────────────────────────────────────────────

class TestGet:
    def test_empty_session_returns_empty_list(self, client):
        r = client.get(f"/api/sessions/{client.sid}/events")
        assert r.status_code == 200
        data = r.get_json()
        assert data["events"] == []
        assert data["live_started_at"] is None

    def test_unknown_session_returns_404(self, client):
        r = client.get("/api/sessions/nope/events")
        assert r.status_code == 404


# ── POST ───────────────────────────────────────────────────────────────────

class TestPost:
    def test_single_event_stored(self, client):
        ev = {"time_min": 5, "type": "kill", "killer": "Uzi 1-1", "victim": "Hammer 1-1"}
        r = client.post(f"/api/sessions/{client.sid}/events", json={"event": ev})
        assert r.status_code == 200
        assert r.get_json()["appended"] == 1

        g = client.get(f"/api/sessions/{client.sid}/events").get_json()
        assert len(g["events"]) == 1
        stored = g["events"][0]
        assert stored["type"] == "kill"
        assert stored["killer"] == "Uzi 1-1"
        # Server stamped recorded_at
        assert "recorded_at" in stored
        assert isinstance(stored["recorded_at"], (int, float))

    def test_batch_post(self, client):
        batch = [
            {"time_min": 1, "type": "weapon", "flight": "Uzi 1-1", "weapon": "GBU-12"},
            {"time_min": 2, "type": "kill", "killer": "Uzi 1-1", "victim": "T-72"},
            {"time_min": 3, "type": "rtb",  "flight": "Uzi 1-1", "base": "Al Dhafra"},
        ]
        r = client.post(f"/api/sessions/{client.sid}/events", json={"events": batch})
        assert r.status_code == 200
        assert r.get_json()["appended"] == 3
        g = client.get(f"/api/sessions/{client.sid}/events").get_json()
        assert len(g["events"]) == 3

    def test_live_started_at_set_on_first_post(self, client):
        before = time.time()
        client.post(f"/api/sessions/{client.sid}/events",
                    json={"event": {"time_min": 0, "type": "note", "text": "go"}})
        after = time.time()
        data = client.get(f"/api/sessions/{client.sid}/events").get_json()
        assert data["live_started_at"] is not None
        assert before - 1 <= data["live_started_at"] <= after + 1

    def test_live_started_at_unchanged_on_subsequent_posts(self, client):
        client.post(f"/api/sessions/{client.sid}/events",
                    json={"event": {"time_min": 0, "type": "note"}})
        first = client.get(f"/api/sessions/{client.sid}/events").get_json()["live_started_at"]
        time.sleep(0.01)
        client.post(f"/api/sessions/{client.sid}/events",
                    json={"event": {"time_min": 1, "type": "note"}})
        second = client.get(f"/api/sessions/{client.sid}/events").get_json()["live_started_at"]
        assert first == second

    def test_bad_shape_returns_400(self, client):
        # events not a list and no event key
        r = client.post(f"/api/sessions/{client.sid}/events", json={"foo": "bar"})
        assert r.status_code == 400

    def test_non_dict_entries_silently_skipped(self, client):
        r = client.post(f"/api/sessions/{client.sid}/events",
                        json={"events": [{"type": "note"}, "garbage", 5, None, {"type": "kill"}]})
        assert r.status_code == 200
        assert r.get_json()["appended"] == 2

    def test_empty_batch_no_crash(self, client):
        r = client.post(f"/api/sessions/{client.sid}/events", json={"events": []})
        assert r.status_code == 200
        assert r.get_json()["appended"] == 0
        # live_started_at stays null when the batch was empty
        data = client.get(f"/api/sessions/{client.sid}/events").get_json()
        assert data["live_started_at"] is None


# ── DELETE ────────────────────────────────────────────────────────────────

class TestDelete:
    def test_clears_events_and_start(self, client):
        client.post(f"/api/sessions/{client.sid}/events",
                    json={"event": {"type": "kill"}})
        r = client.delete(f"/api/sessions/{client.sid}/events")
        assert r.status_code == 200
        assert r.get_json()["cleared"] is True
        data = client.get(f"/api/sessions/{client.sid}/events").get_json()
        assert data["events"] == []
        assert data["live_started_at"] is None

    def test_clear_on_unknown_session_returns_404(self, client):
        r = client.delete("/api/sessions/nope/events")
        assert r.status_code == 404


# ── AAR fallback ──────────────────────────────────────────────────────────

class TestAarFallback:
    def test_aar_uses_session_events_when_body_omits_them(self, client):
        # Populate the session log with a kill.
        client.post(f"/api/sessions/{client.sid}/events", json={"event": {
            "time_min": 12, "type": "kill", "killer": "Uzi 1-1", "victim": "T-72", "weapon": "GBU-12",
        }})
        # Generate AAR without supplying events in the body.
        r = client.post(f"/api/sessions/{client.sid}/aar",
                        json={"format": "md", "notes": ""})
        assert r.status_code == 200
        body = r.data.decode("utf-8")
        # Kill line from the session log should appear in the rendered AAR.
        assert "Uzi 1-1 → T-72" in body
        assert "GBU-12" in body
        # Stats line should reflect the 1 kill.
        assert "**Kills:** 1" in body

    def test_aar_explicit_events_override_session_log(self, client):
        # Session log has a kill; body provides a different one.
        client.post(f"/api/sessions/{client.sid}/events",
                    json={"event": {"time_min": 1, "type": "kill", "killer": "A", "victim": "B"}})
        r = client.post(f"/api/sessions/{client.sid}/aar", json={
            "format": "md",
            "events": [{"time_min": 2, "type": "loss", "unit": "C", "killer": "D"}],
        })
        assert r.status_code == 200
        body = r.data.decode("utf-8")
        # body events used → loss line present, kill from session log absent
        assert "C (by D)" in body
        assert "A → B" not in body
