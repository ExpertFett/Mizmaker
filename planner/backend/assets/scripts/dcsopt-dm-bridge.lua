--[[
  DCS:OPT — DM Trigger Bridge  (v2, 2026-10-18)
  ==============================================

  Pairs with the Live → Triggers panel in DCS:OPT. The web panel sends a
  "fire trigger N" request; the backend spawns a throwaway neutral Soldier M4
  that carries N. This script catches the spawn, decodes N, sets user flag N,
  and despawns the signal group so it never affects the mission picture.

  WHY v2
  ------
  v1 encoded N into an off-map latitude (89° + N×1e-6). A live test
  (2026-10-17) showed DCS clamps that point (the soldier appeared at the map
  origin), so the encoded latitude never reached this script. v2 spawns the
  signal at a REAL in-theatre point (an airbase from the live picture) and
  carries N one of two ways:

    1. GROUP NAME (OlympusLite servers): the group is named "...DMFIRE-<N>..."
       (OlympusLite prefixes "OLITE-"). Exact; used whenever the name matches.
    2. OFFSET PAIR (DCS Olympus, which names groups itself): a 2-unit neutral
       Soldier M4 group. Unit 1 sits on the anchor, unit 2 is offset
         north = floor(N / 1000) × Q   and   east = (N mod 1000) × Q
       with Q = 2e-5° of latitude (~2.2 m; the east quantum is the same
       distance, so Q / cos(lat) in longitude). Decoded in lat/lon from the
       units' own positions, so it doesn't matter where the anchor is.

  HOW TO USE
  ----------
  1. Tag triggers as "DM Fire" in the DCS:OPT Editor → Triggers tab (flags are
     allocated from 9001). Each tagged trigger's condition must include
     FLAG IS TRUE (N).
  2. Load this script at MISSION START (Triggers → MISSION START → DO SCRIPT
     FILE), or let the Editor's Scripts tab bundle it into the .miz.
  3. From the Live terminal, click 🎬 → pick a trigger → Fire. The in-game
     trigger fires within ~1 s.

  CONFIGURATION
  -------------
  - DESPAWN: destroy the signal group after dispatch. Set false while setting
    up so you can see the spawns on the F10 map.
  - LOG: echo "DM-bridge: fired flag N" to chat.

  REQUIREMENTS
  ------------
  Pure DCS API — no MOOSE or MIST. Loaded via "Do Script File".
]]--

local CONFIG = {
  SIGNAL_TYPE = "Soldier M4",  -- the backend's signal unit type
  NAME_TAG    = "DMFIRE%-(%d+)",  -- group-name channel (Lua pattern)
  PAIR_Q_DEG  = 2e-5,          -- offset-pair quantum, degrees of latitude
  PAIR_BASE   = 1000,          -- N = north_q * PAIR_BASE + east_q
  PAIR_TOL    = 0.3,           -- max distance from an integer quantum (fraction)
  DECODE_DELAY = 0.5,          -- s after BIRTH: lets every unit of the group exist
  DESPAWN     = true,
  LOG         = true,
}

local function logMsg(s)
  if CONFIG.LOG then
    trigger.action.outText("DM-bridge: " .. s, 5, false)
  end
end

local function decodeName(gname)
  if type(gname) ~= "string" then return nil end
  local n = tonumber(string.match(gname, CONFIG.NAME_TAG))
  if n and n > 0 and n < 1000000 then return math.floor(n) end
  return nil
end

local function nearInt(v)
  local r = math.floor(v + 0.5)
  if math.abs(v - r) > CONFIG.PAIR_TOL then return nil end
  return r
end

-- Offset-pair channel: exactly two neutral SIGNAL_TYPE units.
local function decodePair(group)
  local ok, units = pcall(group.getUnits, group)
  if not ok or type(units) ~= "table" or #units ~= 2 then return nil end
  local okc, side = pcall(group.getCoalition, group)
  if not okc or side ~= coalition.side.NEUTRAL then return nil end
  for _, u in ipairs(units) do
    local okt, t = pcall(u.getTypeName, u)
    if not okt or t ~= CONFIG.SIGNAL_TYPE then return nil end
  end
  local a, b = units[1], units[2]
  local okn, na = pcall(a.getNumber, a)
  local okm, nb = pcall(b.getNumber, b)
  if okn and okm and tonumber(na) and tonumber(nb) and na > nb then a, b = b, a end
  local ok1, lat1, lon1 = pcall(coord.LOtoLL, a:getPoint())
  local ok2, lat2, lon2 = pcall(coord.LOtoLL, b:getPoint())
  if not (ok1 and ok2 and lat1 and lat2) then return nil end
  local q = CONFIG.PAIR_Q_DEG
  local north = nearInt((lat2 - lat1) / q)
  local east = nearInt((lon2 - lon1) * math.cos(math.rad(lat1)) / q)
  if not north or not east then return nil end
  if north < 0 or east < 0 or east >= CONFIG.PAIR_BASE or north >= CONFIG.PAIR_BASE then return nil end
  local n = north * CONFIG.PAIR_BASE + east
  if n <= 0 then return nil end
  return n
end

local pending = {}  -- group id -> true while a decode is scheduled / dispatched

local function dispatch(gname, gid)
  local group = Group.getByName(gname)
  if not group or not group:isExist() then pending[gid] = nil; return end
  local flag, via = decodeName(gname), "name"
  if not flag then flag, via = decodePair(group), "pair" end
  if not flag then pending[gid] = nil; return end
  trigger.action.setUserFlag(flag, 1)
  logMsg("fired flag " .. tostring(flag) .. " (" .. via .. ", " .. gname .. ")")
  if CONFIG.DESPAWN then
    pcall(group.destroy, group)
  end
  pending[gid] = nil
end

local handler = {}
function handler:onEvent(event)
  if event.id ~= world.event.S_EVENT_BIRTH then return end
  local obj = event.initiator
  if not obj then return end
  local okt, t = pcall(obj.getTypeName, obj)
  if not okt or t ~= CONFIG.SIGNAL_TYPE then return end
  local okg, group = pcall(obj.getGroup, obj)
  if not okg or not group then return end
  local okn, gname = pcall(group.getName, group)
  local oki, gid = pcall(group.getID, group)
  if not okn or not oki or pending[gid] then return end
  pending[gid] = true
  -- Decode on a later tick: BIRTH fires per unit, and destroying from inside
  -- the event handler can throw in some DCS builds.
  timer.scheduleFunction(function()
    local ok, err = pcall(dispatch, gname, gid)
    if not ok then pending[gid] = nil; env.error("DM-bridge: " .. tostring(err)) end
  end, nil, timer.getTime() + CONFIG.DECODE_DELAY)
end

world.addEventHandler(handler)
trigger.action.outText("DM-bridge v2: armed (name + offset-pair signals)", 8, false)
