"""
Shared pytest fixtures for the mission-planner backend.

Every test gets a Flask test client and helpers to upload a fixture .miz
and run edits against the session. Keeps tests compact and deterministic.
"""

from __future__ import annotations

import io
import os
import sys
import zipfile
from pathlib import Path

import pytest

# Make the backend package importable when pytest is run from the backend dir
# or from the project root — don't rely on setup.py.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def flask_app():
    """Import the Flask app once per test session."""
    from app import app as _app  # noqa: E402
    _app.config["TESTING"] = True
    return _app


@pytest.fixture
def client(flask_app):
    """Fresh Flask test client per test — isolates sessions between tests."""
    return flask_app.test_client()


@pytest.fixture
def simple_miz_bytes() -> bytes:
    """Raw bytes of the small Case_III_Joe fixture — 30 KB, 25 clients."""
    path = FIXTURE_DIR / "simple.miz"
    if not path.exists():
        pytest.skip(f"Fixture missing: {path}")
    return path.read_bytes()


@pytest.fixture
def uploaded_session(client, simple_miz_bytes):
    """Uploads the simple fixture and returns the parsed response JSON.

    Tests that just need a valid session id / hostToken can depend on this;
    tests that want a raw upload (e.g. parameterize over multiple fixtures)
    should use `simple_miz_bytes` directly.
    """
    data = {"file": (io.BytesIO(simple_miz_bytes), "simple.miz")}
    resp = client.post("/api/upload", data=data, content_type="multipart/form-data")
    assert resp.status_code == 200, f"upload failed: {resp.status_code} {resp.data!r}"
    return resp.get_json()


def download_edited(client, session_id: str, unit_edits: list) -> dict:
    """Call /api/download with edits and return the unpacked archive contents.

    Returns a dict of {zip_entry_name: decoded_utf8_string_or_bytes} for
    `mission`, `options`, and `l10n/DEFAULT/dictionary` — the three files
    our edit engine writes to. Binary entries (kneeboards) are excluded.
    """
    resp = client.post(
        "/api/download",
        json={"sessionId": session_id, "unitEdits": unit_edits},
    )
    assert resp.status_code == 200, f"download failed: {resp.status_code} {resp.data[:300]!r}"
    contents: dict[str, str] = {}
    with zipfile.ZipFile(io.BytesIO(resp.data)) as zf:
        for name in ("mission", "options", "l10n/DEFAULT/dictionary"):
            try:
                contents[name] = zf.read(name).decode("utf-8")
            except KeyError:
                pass
    return contents


@pytest.fixture
def download_edited_fn():
    """Fixture-style wrapper so tests can inject the helper as an argument."""
    return download_edited
