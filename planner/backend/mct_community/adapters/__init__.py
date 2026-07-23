"""Per-tool adapters onto the MCT Community Standard.

Each adapter takes a tool's NATIVE data structure and returns a document
that validates against the published schema. Adapters never mutate their
input, so they can be bolted onto an existing endpoint without changing
the tool's own behaviour.

    dcsopt       extract_full_mission_data() dict -> op-task-air
    missiongen   generator tables + pydcs mission -> op-task-air
    civtraffic   airway corridors -> routes/waypoints
"""

from . import dcsopt  # noqa: F401

try:  # pydcs is optional - only generators need it
    from . import pydcs_mission  # noqa: F401
except ImportError:  # pragma: no cover
    pydcs_mission = None

__all__ = ["dcsopt", "pydcs_mission"]
