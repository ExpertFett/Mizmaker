"""End-to-end planner roundtrip — upload → edit → download → re-upload.

This is the integration test that catches regressions in the
planner-private data persistence layer (mission goals, DMPIs,
hidden-from-flight-leads groups). It exercises the exact workflow
the user runs during a real testing session:

  1. Upload a fresh .miz.
  2. Stage edits for every auto-attach payload (goals, DMPIs,
     hidden groups).
  3. Download — backend writes the new blocks into the .miz.
  4. Take the downloaded bytes and upload them as a new session.
  5. Verify the new upload's response carries the parsed payloads
     matching what was written.

Each writer + parser pair is unit-tested in its own file
(test_mission_goals.py, test_planner_dmpis.py,
test_planner_hidden_groups.py). What this file adds: the bytes
go through the full /api/download → /api/upload pipeline, which
is what would break if (say) the .miz repacker dropped our
planner-private blocks or someone changed the upload response
shape.

If this test fails, a real user roundtrip will too.
"""

from __future__ import annotations

import io


def test_full_roundtrip_preserves_goals_dmpis_hidden(client, simple_miz_bytes):
    # ---- Step 1: initial upload ----
    upload_a = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(simple_miz_bytes), "simple.miz")},
        content_type="multipart/form-data",
    )
    assert upload_a.status_code == 200
    initial = upload_a.get_json()
    sid = initial["sessionId"]
    # Fresh upload of simple.miz should have no planner-private data.
    assert initial.get("missionGoals") == []
    assert initial.get("plannerDmpis") == []
    assert initial.get("plannerHiddenGroups") == []

    # ---- Step 2: stage edits across every auto-attach type ----
    goals_payload = [
        {"id": "a", "text": "Destroy SAM", "side": "blue", "points": 100, "notes": "internal-only"},
        {"id": "b", "text": "RTB by 1900Z", "side": "all", "points": 0, "notes": ""},
    ]
    dmpis_payload = [
        {"id": "x", "name": "DMPI 1", "lat": 41.5, "lon": 41.5,
         "elevation": 1000, "description": "primary",
         "weaponDelivery": "GBU-12", "notes": "primary target"},
    ]
    # Use group IDs that exist in simple.miz — the fixture has 25
    # client units across multiple groups, so 1, 2, 5 will resolve.
    hidden_payload = [1, 2, 5]

    download = client.post(
        "/api/download",
        json={
            "sessionId": sid,
            "unitEdits": [
                {"field": "missionGoals", "value": goals_payload},
                {"field": "plannerDmpis", "value": dmpis_payload},
                {"field": "plannerHiddenGroups", "value": hidden_payload},
            ],
        },
    )
    assert download.status_code == 200
    miz_bytes_v2 = download.data
    assert len(miz_bytes_v2) > 1000  # sanity — we got an actual .miz back

    # ---- Step 3: upload the downloaded .miz as a new session ----
    upload_b = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(miz_bytes_v2), "simple_v2.miz")},
        content_type="multipart/form-data",
    )
    assert upload_b.status_code == 200, (
        f"re-upload failed: {upload_b.status_code} {upload_b.data[:300]!r}"
    )
    second = upload_b.get_json()
    # New session, so different sessionId.
    assert second["sessionId"] != sid

    # ---- Step 4: verify the auto-attached payloads survived ----

    # Goals: text + side + points round-trip; ids are re-derived
    # deterministically by the parser ("goal_imported_N"); notes are
    # editor-only and intentionally NOT written into the .miz.
    parsed_goals = second.get("missionGoals", [])
    assert len(parsed_goals) == 2
    assert parsed_goals[0]["text"] == "Destroy SAM"
    assert parsed_goals[0]["side"] == "blue"
    assert parsed_goals[0]["points"] == 100
    assert parsed_goals[0]["notes"] == ""  # editor-only field stripped
    assert parsed_goals[1]["text"] == "RTB by 1900Z"
    assert parsed_goals[1]["side"] == "all"

    # DMPIs: every field except `id` round-trips exactly. `id` is
    # re-derived deterministically as "dmpi_imported_N".
    parsed_dmpis = second.get("plannerDmpis", [])
    assert len(parsed_dmpis) == 1
    d = parsed_dmpis[0]
    assert d["name"] == "DMPI 1"
    assert d["lat"] == 41.5
    assert d["lon"] == 41.5
    assert d["elevation"] == 1000
    assert d["description"] == "primary"
    assert d["weaponDelivery"] == "GBU-12"
    assert d["notes"] == "primary target"

    # Hidden groups: stable order on re-read (writer sorts).
    parsed_hidden = second.get("plannerHiddenGroups", [])
    assert sorted(parsed_hidden) == sorted(hidden_payload)


def test_roundtrip_with_no_auto_attaches_leaves_blocks_clean(client, simple_miz_bytes):
    # Confirms a download that touches NONE of the auto-attach
    # payloads doesn't accidentally inject empty blocks. This guards
    # against a footgun where a user uploads a vanilla .miz, hits
    # download with no edits, and gets back something with stray
    # planner-private keys polluting their .miz.
    upload_a = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(simple_miz_bytes), "simple.miz")},
        content_type="multipart/form-data",
    )
    sid = upload_a.get_json()["sessionId"]

    download = client.post(
        "/api/download",
        json={"sessionId": sid, "unitEdits": []},
    )
    assert download.status_code == 200

    upload_b = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(download.data), "simple_v2.miz")},
        content_type="multipart/form-data",
    )
    assert upload_b.status_code == 200
    second = upload_b.get_json()
    # All three should still be empty after the no-op roundtrip.
    assert second.get("missionGoals") == []
    assert second.get("plannerDmpis") == []
    assert second.get("plannerHiddenGroups") == []


def test_roundtrip_partial_payload(client, simple_miz_bytes):
    # Half-set: the user staged goals but no DMPIs / hidden groups.
    # Goals should round-trip; the other two should stay empty.
    upload_a = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(simple_miz_bytes), "simple.miz")},
        content_type="multipart/form-data",
    )
    sid = upload_a.get_json()["sessionId"]

    download = client.post(
        "/api/download",
        json={
            "sessionId": sid,
            "unitEdits": [{
                "field": "missionGoals",
                "value": [{"id": "a", "text": "Solo goal", "side": "blue",
                           "points": 50, "notes": ""}],
            }],
        },
    )
    assert download.status_code == 200

    upload_b = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(download.data), "simple_v2.miz")},
        content_type="multipart/form-data",
    )
    second = upload_b.get_json()
    assert len(second.get("missionGoals", [])) == 1
    assert second["missionGoals"][0]["text"] == "Solo goal"
    # Untouched payloads stay empty.
    assert second.get("plannerDmpis") == []
    assert second.get("plannerHiddenGroups") == []
