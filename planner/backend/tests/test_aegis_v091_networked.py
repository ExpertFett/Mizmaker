"""AEGIS v0.9.1-beta-networked unit tests — exercises the dynamic-EW
networking helpers added on top of v0.9.0-dynamic.

We can't run the script against a real DCS runtime in CI, so these tests
stub the DCS engine globals (Group, timer, coalition, world, AI, ...)
with no-op tables and then invoke the AEGIS helpers directly against
manufactured state. That's enough to cover the *new* logic in v0.9.1
which is pure math + sector-bookkeeping; the EMCON / event-handler
plumbing it relies on is still gated behind v0.8.4 paths we don't touch.

What's covered:
- _NearestDynSectorForPos: in-range / out-of-range / multi-sector tie-break.
- _PromoteAutoSamToDynSector: SAM leaves _AUTO, lands in _DYN_<n>,
  _dynSectorDirty flips, _StopEMCON is called once.
- _RegisterDynamicEW: networking-disabled (rangeKm = 0) falls back to
  v0.9.0 "_DYN" tracking; networking-enabled creates a fresh sector and
  promotes nearby autonomous SAMs.
- _PollNextSector rebuild: setting _dynSectorDirty causes the next poll
  to rebuild sectorPollOrder from self.sectors.
"""

from __future__ import annotations

import pathlib
import pytest


SCRIPT_PATH = (
    pathlib.Path(__file__).parent.parent
    / "assets"
    / "scripts"
    / "aegis-iads-v0.9.1-beta-networked.lua"
)


# ---------------------------------------------------------------------------
# Lua runtime fixture
# ---------------------------------------------------------------------------

DCS_STUB = """
-- Minimal stubs for DCS engine globals the AEGIS module touches at load time.
-- We don't run any actual DCS-bound code paths here.
-- DCS's bundled Lua still has math.pow; lupa ships Lua 5.5 which removed it.
-- Shim so the AEGIS module body initialises cleanly.
if math.pow == nil then math.pow = function(a, b) return a ^ b end end
env = { info = function() end, warning = function() end, error = function() end }
timer = {
  getTime = function() return 0 end,
  scheduleFunction = function() end,
  removeFunction = function() end,
}
coalition = { side = { RED = 1, BLUE = 2, NEUTRAL = 0 } }
world = {
  event = setmetatable({}, { __index = function() return 0 end }),
  addEventHandler = function() end,
  searchObjects = function() end,
}
Group = { getByName = function() return nil end, Category = { GROUND = 2 } }
Unit = { getByName = function() return nil end, Category = { GROUND_UNIT = 2 } }
StaticObject = { getByName = function() return nil end }
AI = { Option = {
  Ground = { id = { ALARM_STATE = 9, ROE = 0 } },
  Air    = { id = {} },
} }
trigger = { action = setmetatable({}, { __index = function() return function() end end }) }
missionCommands = setmetatable({}, { __index = function() return function() end end })
country = { id = setmetatable({}, { __index = function() return 0 end }) }
land = { getSurfaceType = function() return 0 end }
Object = { Category = { UNIT = 1 } }
"""


@pytest.fixture
def aegis_lua():
    """Load the v0.9.1 script into a fresh Lua runtime with DCS stubs.

    Returns the lupa runtime so tests can poke at AEGIS, sectors, etc.
    """
    lupa = pytest.importorskip("lupa")
    L = lupa.LuaRuntime(unpack_returned_tuples=True)
    L.execute(DCS_STUB)
    with open(SCRIPT_PATH, "r", encoding="utf-8") as f:
        L.execute(f.read())
    # Spin up an AEGIS instance with the default constructor. We pass a
    # config that pins dynamicEwRangeKm so the v0.9.1 path is exercised.
    L.execute(
        "instance = AEGIS:New('blue', {"
        " dynamicDiscovery = true, dynamicEwRangeKm = 80, debug = false"
        " })"
    )
    return L


# ---------------------------------------------------------------------------
# _NearestDynSectorForPos
# ---------------------------------------------------------------------------

def test_nearest_dyn_sector_returns_nil_when_no_dyn_sectors(aegis_lua):
    """No dynamic sectors exist → helper returns nil regardless of position."""
    aegis_lua.execute("result = instance:_NearestDynSectorForPos({ x = 0, z = 0 }, 80)")
    assert aegis_lua.eval("result") is None


def test_nearest_dyn_sector_respects_range_km(aegis_lua):
    """An EW outside rangeKm is NOT picked even if it's the only one."""
    aegis_lua.execute(
        """
        instance:_EnsureSector('_DYN_1')
        table.insert(instance.sectors._DYN_1.ew, 'far-ew')
        instance.ewRadars['far-ew'] = {
          state = AEGIS.STATE.READY,
          pos = { x = 100000, z = 0 },  -- 100km east
        }
        near_in_range = instance:_NearestDynSectorForPos({ x = 0, z = 0 }, 80)
        near_extended = instance:_NearestDynSectorForPos({ x = 0, z = 0 }, 150)
        """
    )
    assert aegis_lua.eval("near_in_range") is None
    assert aegis_lua.eval("near_extended") == "_DYN_1"


def test_nearest_dyn_sector_picks_closest_of_many(aegis_lua):
    """When two dyn sectors are in range, the closer one wins."""
    aegis_lua.execute(
        """
        instance:_EnsureSector('_DYN_1')
        table.insert(instance.sectors._DYN_1.ew, 'ew-far')
        instance.ewRadars['ew-far'] = {
          state = AEGIS.STATE.READY,
          pos = { x = 50000, z = 0 },  -- 50km east
        }
        instance:_EnsureSector('_DYN_2')
        table.insert(instance.sectors._DYN_2.ew, 'ew-near')
        instance.ewRadars['ew-near'] = {
          state = AEGIS.STATE.READY,
          pos = { x = 10000, z = 0 },  -- 10km east — closer
        }
        winner = instance:_NearestDynSectorForPos({ x = 0, z = 0 }, 80)
        """
    )
    assert aegis_lua.eval("winner") == "_DYN_2"


def test_nearest_dyn_sector_skips_destroyed_ews(aegis_lua):
    """An EW in state DESTROYED is ignored — its sector doesn't qualify
    even though the EW entry is still in sec.ew."""
    aegis_lua.execute(
        """
        instance:_EnsureSector('_DYN_1')
        table.insert(instance.sectors._DYN_1.ew, 'ew-dead')
        instance.ewRadars['ew-dead'] = {
          state = AEGIS.STATE.DESTROYED,
          pos = { x = 5000, z = 0 },  -- close but dead
        }
        result = instance:_NearestDynSectorForPos({ x = 0, z = 0 }, 80)
        """
    )
    assert aegis_lua.eval("result") is None


def test_nearest_dyn_sector_disabled_when_range_zero(aegis_lua):
    """rangeKm = 0 means networking is disabled — always returns nil."""
    aegis_lua.execute(
        """
        instance:_EnsureSector('_DYN_1')
        table.insert(instance.sectors._DYN_1.ew, 'ew-1')
        instance.ewRadars['ew-1'] = {
          state = AEGIS.STATE.READY,
          pos = { x = 100, z = 0 },  -- right next door
        }
        result = instance:_NearestDynSectorForPos({ x = 0, z = 0 }, 0)
        """
    )
    assert aegis_lua.eval("result") is None


# ---------------------------------------------------------------------------
# _PromoteAutoSamToDynSector
# ---------------------------------------------------------------------------

def test_promote_moves_sam_and_flags_dirty(aegis_lua):
    """Promoting a SAM:
      - removes it from _AUTO.sams,
      - inserts it into the target _DYN_<n> sector's sams list,
      - sets sam.sector to the new sector name,
      - flips _dynSectorDirty so the next poll rebuilds order,
      - cancels any autonomous EMCON timer (via _StopEMCON).
    We stub _StopEMCON to confirm it's called exactly once.
    """
    aegis_lua.execute(
        """
        stopEmconCalls = 0
        instance._StopEMCON = function(self, name) stopEmconCalls = stopEmconCalls + 1 end
        instance:_EnsureSector('_AUTO')
        instance:_EnsureSector('_DYN_1')
        table.insert(instance.sectors._AUTO.sams, 'sam-a')
        instance.samSites['sam-a'] = { sector = '_AUTO', pos = { x = 0, z = 0 } }
        instance._dynSectorDirty = false
        instance:_PromoteAutoSamToDynSector('sam-a', '_DYN_1')
        auto_n  = #instance.sectors._AUTO.sams
        dyn_n   = #instance.sectors._DYN_1.sams
        new_sec = instance.samSites['sam-a'].sector
        dirty   = instance._dynSectorDirty
        """
    )
    assert aegis_lua.eval("auto_n") == 0
    assert aegis_lua.eval("dyn_n") == 1
    assert aegis_lua.eval("new_sec") == "_DYN_1"
    assert aegis_lua.eval("dirty") is True
    assert aegis_lua.eval("stopEmconCalls") == 1


def test_promote_is_noop_when_sam_not_in_auto(aegis_lua):
    """SAM that already lives in a non-_AUTO sector shouldn't move and
    shouldn't trigger _StopEMCON (no orphaned timer to cancel)."""
    aegis_lua.execute(
        """
        stopEmconCalls = 0
        instance._StopEMCON = function() stopEmconCalls = stopEmconCalls + 1 end
        instance:_EnsureSector('_DYN_OTHER')
        instance.samSites['sam-b'] = { sector = '_DYN_OTHER', pos = { x = 0, z = 0 } }
        instance:_PromoteAutoSamToDynSector('sam-b', '_DYN_1')
        sec = instance.samSites['sam-b'].sector
        """
    )
    assert aegis_lua.eval("sec") == "_DYN_OTHER"
    assert aegis_lua.eval("stopEmconCalls") == 0


# ---------------------------------------------------------------------------
# _PollNextSector lazy rebuild on dirty flag
# ---------------------------------------------------------------------------

def test_poll_rebuilds_order_when_dirty(aegis_lua):
    """_PollNextSector should pick up a freshly-added dynamic sector on
    the next call once _dynSectorDirty is set — without restarting the
    scheduled timer (the v0.9.0 'double-poll' concern)."""
    aegis_lua.execute(
        """
        instance.sectorPollOrder = {}
        instance.sectorPollIndex = 0
        instance.jammerPollCounter = 0
        instance.eaEnabled = false  -- skip jammer subsystem in the poll body
        instance:_EnsureSector('_DYN_1')
        table.insert(instance.sectors._DYN_1.ew, 'ew-1')
        instance.ewRadars['ew-1'] = {
          state = AEGIS.STATE.READY,
          pos = { x = 0, z = 0 },
        }
        -- Pretend the EW lookup inside the poll body finds nothing — that's
        -- fine, we only care that sectorPollOrder gets rebuilt.
        instance._dynSectorDirty = true
        -- Stub out the heavy poll body so we don't need full state.
        Group.getByName = function() return nil end
        instance:_PollNextSector()
        order_after = #instance.sectorPollOrder
        first       = instance.sectorPollOrder[1]
        dirty_after = instance._dynSectorDirty
        """
    )
    assert aegis_lua.eval("order_after") == 1
    assert aegis_lua.eval("first") == "_DYN_1"
    # Dirty flag is consumed on rebuild.
    assert aegis_lua.eval("dirty_after") is False


def test_poll_excludes_auto_and_empty_ew_sectors(aegis_lua):
    """The rebuild must mirror _StartEWPoll's filter: skip _AUTO, skip any
    sector with zero EWs."""
    aegis_lua.execute(
        """
        instance.sectorPollOrder = {}
        instance.sectorPollIndex = 0
        instance.jammerPollCounter = 0
        instance.eaEnabled = false
        instance:_EnsureSector('_AUTO')          -- always skipped
        instance:_EnsureSector('_DYN_1')         -- has EW → included
        table.insert(instance.sectors._DYN_1.ew, 'ew-a')
        instance.ewRadars['ew-a'] = { state = AEGIS.STATE.READY, pos = { x=0, z=0 } }
        instance:_EnsureSector('_DYN_2')         -- no EWs → skipped
        instance._dynSectorDirty = true
        Group.getByName = function() return nil end
        instance:_PollNextSector()
        order = {}
        for _, n in ipairs(instance.sectorPollOrder) do table.insert(order, n) end
        """
    )
    # Lupa list-ish proxy → realize via .values() and stringify
    proxy = aegis_lua.eval("order")
    order = [v for v in proxy.values()]
    assert order == ["_DYN_1"]


# ---------------------------------------------------------------------------
# _RegisterDynamicEW — networking-disabled path
# ---------------------------------------------------------------------------

def test_register_dynamic_ew_falls_back_when_range_zero(aegis_lua):
    """dynamicEwRangeKm = 0 disables networking — EW drops into the legacy
    '_DYN' tracking sector, _RegisterEW is called once, no promotions."""
    aegis_lua.execute(
        """
        instance.dynamicEwRangeKm = 0
        registered = {}
        instance._RegisterEW = function(self, name, sec)
          table.insert(registered, sec)
        end
        promoteCalls = 0
        instance._PromoteAutoSamToDynSector = function() promoteCalls = promoteCalls + 1 end
        instance:_RegisterDynamicEW('ewr-runtime')
        sec_passed = registered[1]
        """
    )
    assert aegis_lua.eval("sec_passed") == "_DYN"
    assert aegis_lua.eval("promoteCalls") == 0


def test_dyn_sector_counter_increments(aegis_lua):
    """Each networked _RegisterDynamicEW call should mint a fresh
    _DYN_<n> sector name with a monotonically-increasing counter."""
    aegis_lua.execute(
        """
        sectors_used = {}
        instance._RegisterEW = function(self, name, sec) table.insert(sectors_used, sec) end
        instance._GroupCenterPos = function() return nil end  -- skip promote scan
        instance:_RegisterDynamicEW('ewr-1')
        instance:_RegisterDynamicEW('ewr-2')
        instance:_RegisterDynamicEW('ewr-3')
        s1, s2, s3 = sectors_used[1], sectors_used[2], sectors_used[3]
        """
    )
    assert aegis_lua.eval("s1") == "_DYN_1"
    assert aegis_lua.eval("s2") == "_DYN_2"
    assert aegis_lua.eval("s3") == "_DYN_3"
