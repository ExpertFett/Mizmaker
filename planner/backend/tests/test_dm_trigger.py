"""DM trigger-fire signal (services/dm_trigger.py + the fire_trigger route +
assets/scripts/dcsopt-dm-bridge.lua v2, run under lupa against a mocked DCS API).

Regression for the 2026-10-17 live test: the v1 off-map latitude (89 + flag*1e-6)
was clamped by DCS to the map origin, so the bridge never decoded it."""

from __future__ import annotations

import math
import os

import pytest

from services import dm_trigger
from tests.test_groups import login  # noqa: F401  (fake_sb fixture re-exported below)
from tests.test_groups import fake_sb  # noqa: F401

BRIDGE = os.path.join(os.path.dirname(__file__), "..", "assets", "scripts", "dcsopt-dm-bridge.lua")

OLYMPUS_AIRBASES = {"airbases": {
    "1": {"callsign": "Anapa-Vityazevo", "coalition": "red", "latitude": 45.013, "longitude": 37.359},
    "0": {"callsign": "Batumi", "coalition": "blue", "latitude": 41.609, "longitude": 41.601},
}}
OLITE_AIRBASES = {"airbases": {
    "0": {"callsign": "CVN-71", "kind": "ship", "latitude": 43.0, "longitude": 36.0},
    "1": {"callsign": "FARP London", "kind": "helipad", "latitude": 44.0, "longitude": 39.0},
    "2": {"callsign": "Kutaisi", "kind": "airdrome", "latitude": 42.176, "longitude": 42.482},
}}


# --------------------------------------------------------------------------
# Pure encoding
# --------------------------------------------------------------------------
class TestEncoding:
    def test_anchor_olympus_first_in_key_order(self):
        assert dm_trigger.pick_anchor(OLYMPUS_AIRBASES)[2] == "Batumi"

    def test_anchor_olympuslite_prefers_airdrome_never_ship(self):
        assert dm_trigger.pick_anchor(OLITE_AIRBASES)[2] == "Kutaisi"
        only_ship = {"airbases": {"0": OLITE_AIRBASES["airbases"]["0"]}}
        assert dm_trigger.pick_anchor(only_ship) is None
        farp = {"airbases": {k: v for k, v in OLITE_AIRBASES["airbases"].items() if k != "2"}}
        assert dm_trigger.pick_anchor(farp)[2] == "FARP London"

    def test_anchor_empty_or_bad(self):
        assert dm_trigger.pick_anchor({}) is None
        assert dm_trigger.pick_anchor({"airbases": {"0": {"latitude": "x"}}}) is None
        assert dm_trigger.pick_anchor(None) is None

    @pytest.mark.parametrize("flag", [1, 999, 1000, 9001, 9999, 123456, 999999])
    @pytest.mark.parametrize("lat", [41.6, 69.2])  # Caucasus, Kola
    def test_pair_round_trip(self, flag, lat):
        lat2, lng2 = dm_trigger.pair_point(lat, 33.0, flag)
        assert dm_trigger.decode_pair(lat, 33.0, lat2, lng2) == flag

    def test_pair_survives_metre_of_error(self):
        lat, lng = 69.2, 33.0
        lat2, lng2 = dm_trigger.pair_point(lat, lng, 9001)
        # ~0.5 m north and east of where it should be
        lat2 += 0.5 / 111_320
        lng2 += 0.5 / (111_320 * math.cos(math.radians(lat)))
        assert dm_trigger.decode_pair(lat, lng, lat2, lng2) == 9001

    def test_pair_stays_close_to_anchor(self):
        lat2, lng2 = dm_trigger.pair_point(45.0, 37.0, 999999)
        assert (lat2 - 45.0) * 111_320 < 2300  # within ~2.2 km north
        assert (lng2 - 37.0) * 111_320 * math.cos(math.radians(45)) < 2300

    def test_spawn_params_kinds(self):
        lite = dm_trigger.spawn_params("olympuslite", 9001, (42.0, 42.0))
        assert lite["groupName"] == "DMFIRE-9001" and len(lite["units"]) == 1
        oly = dm_trigger.spawn_params("olympus", 9001, (42.0, 42.0))
        assert "groupName" not in oly and len(oly["units"]) == 2
        for p in (lite, oly):
            assert p["coalition"] == "neutral"
            assert all(u["unitType"] == "Soldier M4" for u in p["units"])
            assert all(abs(u["location"]["lat"]) < 80 for u in p["units"])  # never off-map

    def test_olympuslite_relay_names_the_group(self):
        from services import olympuslite_bridge
        body = olympuslite_bridge.translate_spawn(
            "spawnGroundUnits", dm_trigger.spawn_params("olympuslite", 9001, (42.0, 42.0)))
        assert body["name"] == "DMFIRE-9001"  # hook makes it OLITE-DMFIRE-9001
        # ordinary spawns still name the group after the unit type
        plain = olympuslite_bridge.translate_spawn("spawnGroundUnits", {
            "coalition": "red", "units": [{"unitType": "T-72B", "location": {"lat": 42, "lng": 42}}]})
        assert plain["name"] == "T-72B"


# --------------------------------------------------------------------------
# Route
# --------------------------------------------------------------------------
def _profile(client, monkeypatch, kind="olympus"):
    login(monkeypatch, "admin1", "Admin")
    gid = client.post("/api/groups", json={"name": "G"}).get_json()["id"]
    pid = client.post(f"/api/groups/{gid}/profiles",
                      json={"name": "S", "olympusHost": "h", "kind": kind}).get_json()["id"]
    return gid, pid


class TestFireRoute:
    @pytest.mark.parametrize("kind,mod,airbases", [
        ("olympus", "olympus_bridge", OLYMPUS_AIRBASES),
        ("olympuslite", "olympuslite_bridge", OLITE_AIRBASES),
    ])
    def test_fire_spawns_at_anchor(self, client, fake_sb, monkeypatch, kind, mod, airbases):
        gid, pid = _profile(client, monkeypatch, kind)
        sent = {}
        monkeypatch.setattr(f"services.{mod}.fetch_telemetry",
                            lambda h, p, pw, res: {"ok": True, "data": airbases})

        def send(h, p, pw, c, par):
            sent.update(command=c, params=par)
            return {"ok": True}

        monkeypatch.setattr(f"services.{mod}.send_command", send)
        if kind == "olympuslite":  # a pre-0.2.0 hook: no direct flag command
            monkeypatch.setattr("services.olympuslite_bridge.supports_flag", lambda *a: False)
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/fire_trigger", json={"flagIndex": 9001})
        j = r.get_json()
        assert r.status_code == 200 and j["ok"] is True, j
        assert sent["command"] == "spawnGroundUnits"
        u0 = sent["params"]["units"][0]["location"]
        assert (u0["lat"], u0["lng"]) == (j["anchor"]["lat"], j["anchor"]["lng"])
        if kind == "olympuslite":
            assert j["channel"] == "name" and sent["params"]["groupName"] == "DMFIRE-9001"
        else:
            assert j["channel"] == "pair"
            u1 = sent["params"]["units"][1]["location"]
            assert dm_trigger.decode_pair(u0["lat"], u0["lng"], u1["lat"], u1["lng"]) == 9001

    def test_no_anchor_409(self, client, fake_sb, monkeypatch):
        gid, pid = _profile(client, monkeypatch)
        monkeypatch.setattr("services.olympus_bridge.fetch_telemetry",
                            lambda h, p, pw, res: {"ok": True, "data": {"airbases": {}}})
        monkeypatch.setattr("services.olympus_bridge.send_command",
                            lambda *a: pytest.fail("must not spawn without an anchor"))
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/fire_trigger", json={"flagIndex": 9001})
        assert r.status_code == 409

    def test_airbases_unreachable_502(self, client, fake_sb, monkeypatch):
        gid, pid = _profile(client, monkeypatch)
        monkeypatch.setattr("services.olympus_bridge.fetch_telemetry",
                            lambda h, p, pw, res: {"ok": False, "error": "down"})
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/fire_trigger", json={"flagIndex": 9001})
        assert r.status_code == 502 and r.get_json()["error"] == "down"

    @pytest.mark.parametrize("flag", [0, -1, 1_000_000, "x", None])
    def test_bad_flag_400(self, client, fake_sb, monkeypatch, flag):
        gid, pid = _profile(client, monkeypatch)
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/fire_trigger", json={"flagIndex": flag})
        assert r.status_code == 400

    def test_operator_403(self, client, fake_sb, monkeypatch):
        gid, pid = _profile(client, monkeypatch)
        code = client.post(f"/api/groups/{gid}/invites", json={}).get_json()["code"]
        login(monkeypatch, "op1")
        client.post("/api/groups/join", json={"code": code})
        r = client.post(f"/api/groups/{gid}/profiles/{pid}/fire_trigger", json={"flagIndex": 9001})
        assert r.status_code == 403


# --------------------------------------------------------------------------
# Bridge script under a mocked DCS mission environment
# --------------------------------------------------------------------------
lupa = pytest.importorskip("lupa")

# Map origin + a flat projection: x = metres north, z = metres east. Enough to
# exercise the decode; the real TM projection only matters over the ~2 km pair.
MOCK = r"""
ORIGIN_LAT, ORIGIN_LON = 42.0, 42.0
local M = 111320
coord = {}
function coord.LOtoLL(p)
  local lat = ORIGIN_LAT + p.x / M
  return lat, ORIGIN_LON + p.z / (M * math.cos(math.rad(ORIGIN_LAT))), 0
end
function coord.LLtoLO(lat, lon)
  return { x = (lat - ORIGIN_LAT) * M, y = 0, z = (lon - ORIGIN_LON) * M * math.cos(math.rad(ORIGIN_LAT)) }
end
coalition = { side = { NEUTRAL = 0, RED = 1, BLUE = 2 } }
world = { event = { S_EVENT_BIRTH = 15 }, handlers = {} }
function world.addEventHandler(h) world.handlers[#world.handlers + 1] = h end
FLAGS, CHAT, TIMERS, NOW = {}, {}, {}, 0
trigger = { action = {} }
function trigger.action.setUserFlag(n, v) FLAGS[n] = v end
function trigger.action.outText(s) CHAT[#CHAT + 1] = s end
env = { error = function(s) CHAT[#CHAT + 1] = "ERR " .. s end }
timer = {}
function timer.getTime() return NOW end
function timer.scheduleFunction(f, a, t) TIMERS[#TIMERS + 1] = { f = f, a = a, t = t } end
function runTimers(dt)
  NOW = NOW + dt
  local due = TIMERS; TIMERS = {}
  for _, tm in ipairs(due) do if tm.t <= NOW then tm.f(tm.a) else TIMERS[#TIMERS + 1] = tm end end
end

GROUPS, NEXT_ID = {}, 1
Group = {}
function Group.getByName(n) return GROUPS[n] end
-- spawn(name, side, {{type, lat, lon}, ...}) -> fires BIRTH per unit, like addGroup
function spawn(name, side, list)
  local g = { name = name, side = side, id = NEXT_ID, units = {}, alive = true }
  NEXT_ID = NEXT_ID + 1
  function g:getName() return self.name end
  function g:getID() return self.id end
  function g:getCoalition() return self.side end
  function g:isExist() return self.alive end
  function g:getUnits() return self.units end
  function g:destroy() self.alive = false; GROUPS[self.name] = nil end
  GROUPS[name] = g
  for i, s in ipairs(list) do
    local p = coord.LLtoLO(s[2], s[3])
    local u = { t = s[1], p = p, n = i }
    function u:getTypeName() return self.t end
    function u:getPoint() return self.p end
    function u:getNumber() return self.n end
    function u:getGroup() return g end
    g.units[i] = u
  end
  for _, u in ipairs(g.units) do
    for _, h in ipairs(world.handlers) do h:onEvent({ id = 15, initiator = u }) end
  end
  return g
end
"""


@pytest.fixture
def L():
    rt = lupa.LuaRuntime(unpack_returned_tuples=True)
    rt.execute(MOCK)
    with open(BRIDGE, encoding="utf-8") as f:
        rt.execute(f.read())
    return rt


def _spawn(L, name, side, units):
    lua_units = L.table_from([L.table_from(u) for u in units])
    return L.globals().spawn(name, side, lua_units)


def _flags(L):
    return dict(L.globals().FLAGS.items())


class TestBridgeScript:
    def test_name_channel_olympuslite(self, L):
        g = _spawn(L, "OLITE-DMFIRE-9001", 0, [["Soldier M4", 42.1, 42.1]])
        assert _flags(L) == {}  # decoded on a later tick, not inside the event
        L.globals().runTimers(1)
        assert _flags(L) == {9001: 1}
        assert g.alive is False  # despawned

    def test_name_channel_with_uniqueness_suffix(self, L):
        _spawn(L, "OLITE-DMFIRE-9002-17", 0, [["Soldier M4", 42.1, 42.1]])
        L.globals().runTimers(1)
        assert _flags(L) == {9002: 1}

    @pytest.mark.parametrize("flag", [9001, 1, 999999])
    def test_pair_channel_olympus(self, L, flag):
        params = dm_trigger.spawn_params("olympus", flag, (42.3, 42.2))
        units = [["Soldier M4", u["location"]["lat"], u["location"]["lng"]] for u in params["units"]]
        g = _spawn(L, "Olympus-77", 0, units)
        L.globals().runTimers(1)
        assert _flags(L) == {flag: 1}
        assert g.alive is False

    def test_pair_fires_once_per_group(self, L):
        params = dm_trigger.spawn_params("olympus", 9003, (42.3, 42.2))
        units = [["Soldier M4", u["location"]["lat"], u["location"]["lng"]] for u in params["units"]]
        _spawn(L, "Olympus-78", 0, units)  # two BIRTH events
        assert len(L.globals().TIMERS) == 1

    def test_v1_off_map_clamp_does_not_fire(self, L):
        # what DCS actually did on 2026-10-17: one soldier at the map origin
        _spawn(L, "OLITE-Soldier M4", 0, [["Soldier M4", 42.0, 42.0]])
        L.globals().runTimers(1)
        assert _flags(L) == {}

    def test_ignores_non_neutral_and_other_types(self, L):
        params = dm_trigger.spawn_params("olympus", 9004, (42.3, 42.2))
        locs = [(u["location"]["lat"], u["location"]["lng"]) for u in params["units"]]
        _spawn(L, "Olympus-79", 1, [["Soldier M4", *locs[0]], ["Soldier M4", *locs[1]]])  # red
        _spawn(L, "Olympus-80", 0, [["T-72B", *locs[0]], ["T-72B", *locs[1]]])
        _spawn(L, "Blue infantry", 2, [["Soldier M4", 42.1, 42.1], ["Soldier M4", 42.1001, 42.1]])
        L.globals().runTimers(1)
        assert _flags(L) == {}

    def test_same_flag_can_fire_again_after_despawn(self, L):
        _spawn(L, "OLITE-DMFIRE-9005", 0, [["Soldier M4", 42.1, 42.1]])
        L.globals().runTimers(1)
        L.globals().FLAGS[9005] = 0
        _spawn(L, "OLITE-DMFIRE-9005", 0, [["Soldier M4", 42.1, 42.1]])
        L.globals().runTimers(1)
        assert _flags(L) == {9005: 1}
