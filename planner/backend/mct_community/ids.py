"""
Deterministic identifiers for MCT Community Standard documents.

The schema wants UUIDs everywhere. Minting random ones would mean the same
mission exported twice produces two unrelated documents - diffs become
meaningless and any consumer that caches by id sees churn.

So we derive UUIDv5s from stable natural keys instead. Re-exporting an
unchanged mission yields a byte-identical document, which makes the export
diffable and safe to re-publish.
"""

from __future__ import annotations

import uuid

# Namespace root for everything DCS:OPT emits. Derived once from the tool
# domain so ids are globally unlikely to collide with another tool's.
DCSOPT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "dcsopt.up.railway.app")


def stable_id(*parts: object, namespace: uuid.UUID = DCSOPT_NAMESPACE) -> str:
    """UUIDv5 from any natural key. Order matters; None parts are kept
    (as the literal 'None') so key shape stays stable if a field is absent."""
    key = "|".join(str(p) for p in parts)
    return str(uuid.uuid5(namespace, key))


def doc_id(tool: str, theatre: str, mission: str) -> str:
    return stable_id("doc", tool, theatre, mission)


def package_id(doc: str, name: str) -> str:
    return stable_id("package", doc, name)


def asset_id(doc: str, group_name: str) -> str:
    return stable_id("asset", doc, group_name)


def route_id(doc: str, group_name: str) -> str:
    return stable_id("route", doc, group_name)


def waypoint_id(doc: str, group_name: str, index: object) -> str:
    return stable_id("waypoint", doc, group_name, index)


def airfield_id(doc: str, name: str) -> str:
    return stable_id("airfield", doc, name)


def track_id(doc: str, name: str) -> str:
    return stable_id("track", doc, name)
