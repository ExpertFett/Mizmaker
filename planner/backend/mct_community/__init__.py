"""
mct_community - MCT Community Standards v2.0.0 for the DCS:OPT toolset.

The community standard is two JSON documents published at mctoolbox.uk:

    community-op-task-air   plan + who is present + the environment
    community-flightplan    the same spine without mission_context

MCTUtils (the reference SDK) is C#/.NET and cannot be consumed from this
stack, so the SCHEMA - not the library - is the contract. This package is
the Python-side implementation of that contract, shared by DCS:OPT,
MissionGen and CivTraffic.

    from mct_community import build, validate, vocab, ids
    from mct_community.adapters import dcsopt

    doc = dcsopt.to_op_task_air(mission_data, theater="Syria", coalition="blue")
    validate.assert_valid(doc)

Tool-specific data goes under `extensions.dcsopt` - the schema requires
parsers to ignore namespaces they don't recognise, which is what makes
our DTC cartridges, SOP and DCS x/y survive a round trip through other
people's tools.
"""

from . import build, ids, projection, validate, vocab  # noqa: F401

__all__ = ["build", "ids", "projection", "validate", "vocab", "adapters"]

SCHEMA_VERSION = build.SCHEMA_VERSION

# Stamped into every document's `tool_source` so consumers can tell which
# tool and build produced a file.
TOOL_SOURCE = "DCS:OPT/mct_community 0.1.0"
