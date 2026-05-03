"""
YAML-driven E2E scenario runner — Phase 1.3 of the standing safety-net
plan. Each scenario in tests/e2e/scenarios/*.yaml describes a mission,
a sequence of edits, and a list of assertions. The runner loads each,
runs it through the Flask test client, and asserts on the unzipped
output.

Why YAML and not more pytest classes:
- Scenarios are data, not logic. They get added/tweaked frequently
  and shouldn't require a Python edit + import.
- Adding a scenario is a 10-line YAML file, not a 30-line test class.
- A future Claude diagnostic agent (Phase 1.3 stretch goal) can read
  the YAML directly to understand intent without needing to parse
  Python AST.

Scenario file format:

    name: <human-readable>
    mission: simple.miz                   # filename relative to tests/fixtures/
    edits:                                # list of edit dicts (same shape as
                                          # the unitEdits[] payload to /api/download)
      - field: <fieldname>
        value: <yaml-shaped value>
        unitId: <optional>                # for unit-level edits
        groupId: <optional>               # for group-level edits
    asserts:
      - file: mission | options | l10n/DEFAULT/dictionary
        grep: '<regex>'                   # must match
        # OR:
        not_grep: '<regex>'               # must NOT match

Each scenario becomes a parameterized pytest case named after the YAML
filename (e.g. tests/e2e/scenarios/briefing_sortie.yaml ->
test_scenario[briefing_sortie]). Failures show up in standard pytest
output and CI surfaces them automatically.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import pytest
import yaml

from tests.conftest import download_edited

SCENARIOS_DIR = Path(__file__).parent / "e2e" / "scenarios"
FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _scenario_paths() -> list[Path]:
    if not SCENARIOS_DIR.exists():
        return []
    return sorted(SCENARIOS_DIR.glob("*.yaml"))


@pytest.mark.parametrize(
    "scenario_path",
    _scenario_paths(),
    ids=lambda p: p.stem,
)
def test_scenario(client, scenario_path: Path) -> None:
    """Run a single YAML-defined E2E scenario."""
    spec = yaml.safe_load(scenario_path.read_text(encoding="utf-8"))
    if not spec:
        pytest.skip(f"{scenario_path.name} is empty")

    name = spec.get("name", scenario_path.stem)

    # Resolve the fixture mission file
    mission_filename = spec.get("mission", "simple.miz")
    fixture_path = FIXTURES_DIR / mission_filename
    if not fixture_path.exists():
        pytest.skip(f"[{name}] fixture {mission_filename} missing")
    mission_bytes = fixture_path.read_bytes()

    # Upload
    data = {"file": (io.BytesIO(mission_bytes), mission_filename)}
    upload_resp = client.post("/api/upload", data=data, content_type="multipart/form-data")
    assert upload_resp.status_code == 200, \
        f"[{name}] upload failed: {upload_resp.status_code} {upload_resp.data[:300]!r}"
    sid = upload_resp.get_json()["sessionId"]

    # Apply edits via /api/download
    edits = spec.get("edits", []) or []
    files = download_edited(client, sid, edits)

    # Run assertions. Each is one of:
    #   - {file: <name>, grep: <regex>}            value must be present
    #   - {file: <name>, not_grep: <regex>}        value must NOT be present
    asserts = spec.get("asserts", []) or []
    for i, a in enumerate(asserts):
        target = a.get("file")
        if target not in ("mission", "options", "l10n/DEFAULT/dictionary"):
            pytest.fail(
                f"[{name}] assertion {i}: unsupported file '{target}'. "
                f"Use mission | options | l10n/DEFAULT/dictionary."
            )

        text = files.get(target, "")
        if not text:
            pytest.fail(
                f"[{name}] assertion {i}: file '{target}' not present in output"
            )

        if "grep" in a:
            assert re.search(a["grep"], text), (
                f"[{name}] assertion {i}: grep {a['grep']!r} not found in {target}"
            )
        elif "not_grep" in a:
            assert not re.search(a["not_grep"], text), (
                f"[{name}] assertion {i}: grep {a['not_grep']!r} unexpectedly "
                f"present in {target}"
            )
        else:
            pytest.fail(
                f"[{name}] assertion {i}: must have either 'grep' or 'not_grep'"
            )
