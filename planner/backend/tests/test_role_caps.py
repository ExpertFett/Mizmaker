"""Role-capability sanity tests for services/groups.py.

Keeps the JTAC / ATC / GM / commander / observer cap matrix honest as we
add new tool-scope capabilities. If a tester ends up with wrong access
(e.g. an ATC can suddenly delete units), one of these fails loudly.
"""

from __future__ import annotations

from services.groups import ROLE_CAPS, VALID_ROLES, role_has


def test_all_five_roles_present():
    """The five named roles must exist — this guards against an accidental
    rename / removal in groups.py that would silently break the frontend
    mirror in api/groups.ts."""
    assert VALID_ROLES == {"admin", "commander", "jtac", "atc", "operator"}


def test_admin_has_everything():
    """Admin = Game Master = full access. Anything the matrix grows must
    flow to admin."""
    expected = {"manage", "spawn", "command", "delete", "effects", "markers",
                "tools_jtac", "tools_atc"}
    assert ROLE_CAPS["admin"] == expected


def test_commander_has_full_command_set_but_no_manage():
    """Commander can do anything in-mission but can't manage members."""
    assert "manage" not in ROLE_CAPS["commander"]
    for cap in ("spawn", "command", "delete", "effects", "markers", "tools_jtac", "tools_atc"):
        assert cap in ROLE_CAPS["commander"], f"commander missing {cap}"


def test_jtac_role_is_jtac_scoped():
    """JTAC gets jtac tools, effects, markers — and explicitly NOT
    spawn/command/delete/manage/atc-tools."""
    assert role_has("jtac", "tools_jtac")
    assert role_has("jtac", "effects")
    assert role_has("jtac", "markers")
    for cap in ("spawn", "command", "delete", "manage", "tools_atc"):
        assert not role_has("jtac", cap), f"jtac should NOT have {cap}"


def test_atc_role_is_atc_scoped():
    """ATC gets atc tools, effects, markers — and explicitly NOT
    spawn/command/delete/manage/jtac-tools."""
    assert role_has("atc", "tools_atc")
    assert role_has("atc", "effects")
    assert role_has("atc", "markers")
    for cap in ("spawn", "command", "delete", "manage", "tools_jtac"):
        assert not role_has("atc", cap), f"atc should NOT have {cap}"


def test_operator_has_nothing():
    """Observer role is view-only. No caps at all."""
    assert ROLE_CAPS["operator"] == set()
    for cap in ROLE_CAPS["admin"]:
        assert not role_has("operator", cap), f"operator should NOT have {cap}"


def test_unknown_role_grants_nothing():
    """Defensive: an unrecognised role string (e.g. typo in the DB column)
    should grant zero caps, not default to admin."""
    for cap in ("manage", "spawn", "command", "tools_jtac", "tools_atc"):
        assert not role_has("typo_role", cap)
    assert not role_has(None, "spawn")
    assert not role_has("", "spawn")


def test_only_admin_has_manage():
    """Member-management (invite codes, role changes) is admin-only —
    no other role should ever pick up 'manage'."""
    for role, caps in ROLE_CAPS.items():
        if role == "admin":
            assert "manage" in caps
        else:
            assert "manage" not in caps, f"{role} should not have manage"
