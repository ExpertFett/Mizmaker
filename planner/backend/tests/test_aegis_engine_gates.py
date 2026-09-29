"""Bundled AEGIS engine fixes (DCS:OPT, 2026-09-28), run against the real Lua
under a mocked DCS environment:

- altitude FLOOR is AGL (was feet MSL, so terrain counted against low flyers)
- minimum-range dead zone on wake-up decisions (none existed)
- AEGIS:_Warn defined (its absence killed the EW poll loop on the first error)
"""
from pathlib import Path

import pytest

lua51 = pytest.importorskip("lupa.lua51")

from tests.aegis_lua_mock import MOCK  # noqa: E402

SCRIPTS = Path(__file__).parent.parent / "assets" / "scripts"
ENGINES = [
    "aegis-iads-v0.8.4-beta.lua",
    "aegis-iads-v0.9.0-beta-dynamic.lua",
    "aegis-iads-v0.9.1-beta-networked.lua",
]
NM, FT = 1852.0, 0.3048


def _runtime(engine: str, config: str = "{}"):
    lua = lua51.LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    # 3,000 ft plateau east of x = 50 km, sea level elsewhere
    lua.execute("land.getHeight = function(p) if p.x > 50000 then return 3000 * 0.3048 end return 0 end")
    lua.execute((SCRIPTS / engine).read_text(encoding="utf-8"))
    lua.execute(f'I = AEGIS:New("red", {config})')
    return lua


def _gate(lua, fn, sam_type, sam, tgt):
    return bool(lua.eval(f"""(function()
      local s = {{ name = "S", pos = {{ x = {sam[0]}, y = {sam[1]}, z = {sam[2]} }},
                  sysData = AEGIS.SYSTEM_DB.{sam_type}, state = AEGIS.STATE.DARK }}
      local c = I:_MakeContact({{ x = {tgt[0]}, y = {tgt[1]}, z = {tgt[2]} }})
      return I:{fn}(s, {{ c }})
    end)()"""))


CASES = [
    ("SA-3, 300 ft AGL over 3,000 ft plateau", "_CheckWEZ", "SA3", (60000, 900, 0), (60000 + 5 * NM, 3300 * FT, 0), False),
    ("SA-3, 1,000 ft AGL over plateau", "_CheckWEZ", "SA3", (60000, 900, 0), (60000 + 5 * NM, 4000 * FT, 0), True),
    ("SA-10, jet overhead: no wake", "_CheckActivation", "SA10", (0, 0, 0), (1 * NM, 5000 * FT, 0), False),
    ("SA-10, jet at 10 NM: wakes", "_CheckActivation", "SA10", (0, 0, 0), (10 * NM, 5000 * FT, 0), True),
    ("SA-10, overhead: no EMCON break", "_CheckWEZ", "SA10", (0, 0, 0), (1 * NM, 5000 * FT, 0), False),
    ("SA-10 ALERT, overhead: stays hot", "_CheckFullWEZ", "SA10", (0, 0, 0), (1 * NM, 5000 * FT, 0), True),
    ("SA-10, 2 NM but 30,000 ft (slant outside dead zone)", "_CheckActivation", "SA10", (0, 0, 0), (2 * NM, 30000 * FT, 0), True),
    ("Shilka has no dead zone", "_CheckWEZ", "SHILKA", (0, 0, 0), (0.5 * NM, 1000 * FT, 0), True),
]


@pytest.mark.parametrize("engine", ENGINES)
@pytest.mark.parametrize("name,fn,sam_type,sam,tgt,expected", CASES, ids=[c[0] for c in CASES])
def test_gate(engine, name, fn, sam_type, sam, tgt, expected):
    assert _gate(_runtime(engine), fn, sam_type, sam, tgt) is expected


@pytest.mark.parametrize("engine", ENGINES)
def test_switches_off_restore_original_behaviour(engine):
    lua = _runtime(engine, "{ minRangeEnabled = false, altFloorAGL = false }")
    assert _gate(lua, "_CheckActivation", "SA10", (0, 0, 0), (1 * NM, 5000 * FT, 0))
    assert _gate(lua, "_CheckWEZ", "SA3", (60000, 900, 0), (60000 + 5 * NM, 3300 * FT, 0))


@pytest.mark.parametrize("engine", ENGINES)
def test_warn_is_defined(engine):
    lua = _runtime(engine)
    assert lua.eval("type(AEGIS._Warn)") == "function"
