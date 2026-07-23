"""
/api/export/community — MCT Community Standards v2.0.0 interop export.

Round-trips the real simple.miz fixture through the endpoint and validates
the result against the schemas vendored in backend/mct_community/schemas/.
These are the published mctoolbox.uk schemas, so a pass here means the
document really is consumable by other tools that adopted the standard.
"""

import io
import json
import os
import zipfile

import pytest

from mct_community import validate as mct_validate

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "simple.miz")


@pytest.fixture
def client():
    import app as app_module
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


@pytest.fixture
def session_id(client):
    """Upload the fixture and return a live session id."""
    with open(FIXTURE, "rb") as fh:
        data = {"file": (io.BytesIO(fh.read()), "simple.miz")}
        resp = client.post("/api/upload", data=data,
                           content_type="multipart/form-data")
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return resp.get_json()["sessionId"]


def test_export_community_validates(client, session_id):
    """The happy path: every emitted document conforms to the schema."""
    resp = client.post("/api/export/community",
                       json={"sessionId": session_id, "coalition": "all"})
    assert resp.status_code == 200, resp.get_data(as_text=True)
    body = resp.get_json()

    assert body["valid"] is True, body.get("validation")
    assert body["documents"], "expected at least one document"

    for doc in body["documents"]:
        assert doc["schema"] == "community-op-task-air"
        assert doc["schema_version"] == "2.0.0"
        # Validate independently of the endpoint's own check.
        result = mct_validate.validate(doc)
        assert result.is_valid, result.report()


def test_required_root_fields_present(client, session_id):
    resp = client.post("/api/export/community", json={"sessionId": session_id})
    doc = resp.get_json()["documents"][0]
    for field in ("schema", "schema_version", "id", "created_at", "coalition",
                  "mission_context", "package", "assets", "routes"):
        assert field in doc, f"missing required root field {field}"


def test_assets_carry_required_icao_fields(client, session_id):
    """DCS has no ICAO flight fields but the schema requires them, so the
    adapter must supply defaults — a regression here silently invalidates
    every document."""
    resp = client.post("/api/export/community", json={"sessionId": session_id})
    doc = resp.get_json()["documents"][0]
    assert doc["assets"], "fixture should contain flights"
    for asset in doc["assets"]:
        for field in ("flight_type", "flight_rules", "flight_oversight",
                      "control_type", "package_id", "route_id"):
            assert asset.get(field), f"{asset['callsign']} missing {field}"


def test_routes_reference_real_waypoints(client, session_id):
    """Every leg endpoint must resolve to a waypoint in the document —
    dangling UUID references validate fine but break consumers."""
    resp = client.post("/api/export/community", json={"sessionId": session_id})
    doc = resp.get_json()["documents"][0]
    known = {wp["id"] for wp in doc.get("waypoints") or []}
    for route in doc["routes"]:
        for leg in route["legs"]:
            assert leg["start_waypoint"] in known, "dangling start_waypoint"
            assert leg["end_waypoint"] in known, "dangling end_waypoint"


def test_asset_route_ids_resolve(client, session_id):
    resp = client.post("/api/export/community", json={"sessionId": session_id})
    doc = resp.get_json()["documents"][0]
    route_ids = {r["id"] for r in doc["routes"]}
    package_ids = {p["id"] for p in doc["package"]}
    for asset in doc["assets"]:
        assert asset["route_id"] in route_ids, "asset points at a missing route"
        assert asset["package_id"] in package_ids, "asset points at a missing package"


def test_no_unresolved_dictkeys(client, session_id):
    """DCS DictKey references must be resolved or dropped, never published."""
    resp = client.post("/api/export/community", json={"sessionId": session_id})
    blob = json.dumps(resp.get_json())
    assert "DictKey_" not in blob and "DICTKEY_" not in blob


def test_flightplan_format(client, session_id):
    resp = client.post("/api/export/community",
                       json={"sessionId": session_id, "format": "flightplan"})
    doc = resp.get_json()["documents"][0]
    assert doc["schema"] == "community-flightplan"
    # The flightplan variant drops mission_context by design.
    assert "mission_context" not in doc
    assert mct_validate.validate(doc).is_valid


def test_deterministic_export(client, session_id):
    """Same session exported twice must produce identical documents, so the
    output is diffable and safe to re-publish."""
    def export():
        doc = client.post("/api/export/community",
                          json={"sessionId": session_id}).get_json()["documents"][0]
        doc.pop("created_at", None)
        return json.dumps(doc, sort_keys=True)
    assert export() == export()


def test_unknown_coalition_is_rejected(client, session_id):
    resp = client.post("/api/export/community",
                       json={"sessionId": session_id, "coalition": "purple"})
    assert resp.status_code == 400
    assert "available" in resp.get_json()


def test_missing_session_404s(client):
    resp = client.post("/api/export/community", json={"sessionId": "nope"})
    assert resp.status_code == 404
