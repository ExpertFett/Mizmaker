"""
Validation against the published MCT Community Standard schemas.

Validates offline by default, against the schemas vendored in
`mct_community/schemas/`. That keeps CI and the planner backend from
depending on mctoolbox.uk being reachable, and pins conformance to a known
schema revision.

`fetch_schema()` pulls the live copy when you want to check for drift.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

SCHEMA_DIR = os.path.join(os.path.dirname(__file__), "schemas")

_SCHEMA_FILES = {
    "community-op-task-air": "op-task-air.schema.json",
    "community-flightplan": "community-flightplan.schema.json",
}

_cache: Dict[str, dict] = {}


class ValidationError:
    __slots__ = ("path", "message", "keyword")

    def __init__(self, path: str, message: str, keyword: str = ""):
        self.path = path
        self.message = message
        self.keyword = keyword

    def __repr__(self):
        loc = self.path or "(root)"
        return f"[{loc}] {self.message}"


class ValidationResult:
    def __init__(self, errors: List[ValidationError]):
        self.errors = errors

    @property
    def is_valid(self) -> bool:
        return not self.errors

    def __bool__(self):
        return self.is_valid

    def __repr__(self):
        if self.is_valid:
            return "<ValidationResult VALID>"
        return f"<ValidationResult {len(self.errors)} error(s)>"

    def report(self, limit: int = 20) -> str:
        if self.is_valid:
            return "VALID"
        lines = [f"{len(self.errors)} error(s):"]
        for e in self.errors[:limit]:
            lines.append(f"  {e!r}")
        if len(self.errors) > limit:
            lines.append(f"  ... and {len(self.errors) - limit} more")
        return "\n".join(lines)


def load_schema(schema_name: str) -> dict:
    """Load a vendored schema by its `schema` const value."""
    if schema_name not in _SCHEMA_FILES:
        raise KeyError(
            f"Unknown schema {schema_name!r}. Known: {', '.join(_SCHEMA_FILES)}"
        )
    if schema_name not in _cache:
        path = os.path.join(SCHEMA_DIR, _SCHEMA_FILES[schema_name])
        with open(path, "r", encoding="utf-8") as fh:
            _cache[schema_name] = json.load(fh)
    return _cache[schema_name]


def fetch_schema(schema_name: str, timeout: float = 10.0) -> dict:
    """Fetch the live schema from mctoolbox.uk (drift check)."""
    from urllib.request import urlopen
    urls = {
        "community-op-task-air":
            "https://mctoolbox.uk/schema/v2.0.0/op-task-air.schema.json",
        "community-flightplan":
            "https://mctoolbox.uk/schema/v2.0.0/community-flightplan.schema.json",
    }
    with urlopen(urls[schema_name], timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def validate(document: Dict[str, Any], schema: Optional[dict] = None) -> ValidationResult:
    """Validate a document. The schema is chosen from the document's own
    `schema` field unless one is supplied explicitly."""
    try:
        import jsonschema
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "jsonschema is required to validate. pip install jsonschema"
        ) from exc

    if schema is None:
        name = document.get("schema")
        if not name:
            return ValidationResult([
                ValidationError("", "Document has no 'schema' field", "required")
            ])
        schema = load_schema(name)

    validator_cls = jsonschema.validators.validator_for(schema)
    validator = validator_cls(schema)

    errors: List[ValidationError] = []
    for err in sorted(validator.iter_errors(document), key=lambda e: list(e.path)):
        path = "/".join(str(p) for p in err.path)
        errors.append(ValidationError(path, err.message, err.validator))
    return ValidationResult(errors)


def assert_valid(document: Dict[str, Any]) -> None:
    """Raise with a readable report if the document does not conform."""
    result = validate(document)
    if not result.is_valid:
        raise AssertionError(
            f"{document.get('schema', '?')} document failed validation.\n"
            + result.report()
        )
