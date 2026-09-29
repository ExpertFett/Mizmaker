"""Minimal mocked DCS mission environment for running the bundled AEGIS
engine under lupa (Lua 5.1 — DCS is 5.1; default lupa is 5.5 and lacks math.pow)."""


MOCK = r'''
LOG = {}
local function log(...) local t = {} for i = 1, select('#', ...) do t[#t+1] = tostring(select(i, ...)) end LOG[#LOG+1] = table.concat(t, ' ') end
env = { info = log, warning = function(m) log('WARN', m) end, error = function(m) log('ERROR', m) end }

-- permissive stub: any field is a callable stub returning a stub
local stubmt = {}
stubmt.__index = function(t, k) return setmetatable({}, stubmt) end
stubmt.__call = function() return setmetatable({}, stubmt) end
local function stub() return setmetatable({}, stubmt) end

NOW = 0
SCHED = {}
timer = {
  getTime = function() return NOW end,
  getAbsTime = function() return NOW end,
  scheduleFunction = function(f, arg, t) SCHED[#SCHED+1] = { f = f, arg = arg, t = t } return #SCHED end,
  removeFunction = function(id) if SCHED[id] then SCHED[id].dead = true end end,
}
coalition = { side = { NEUTRAL = 0, RED = 1, BLUE = 2 } }
Group = { Category = { AIRPLANE = 0, HELICOPTER = 1, GROUND = 2, SHIP = 3 } }
Unit = { Category = { GROUND_UNIT = 2 } }
AI = { Option = { Ground = { id = { ROE = 0, ALARM_STATE = 9 }, val = { ROE = {}, ALARM_STATE = {} } } } }
world = { addEventHandler = function() end, removeEventHandler = function() end, event = stub(),
          searchObjects = function() end, getAirbases = function() return {} end }
trigger = { action = { outText = function(m) log('OUT', m) end, outTextForCoalition = function(c, m) log('OUT', m) end,
            markToAll = function() end, markToCoalition = function() end, removeMark = function() end,
            circleToAll = function() end, textToAll = function() end, lineToAll = function() end,
            setMarkupColor = function() end, setMarkupText = function() end }, misc = stub() }
missionCommands = { addSubMenu = function(n) log('MENU', n) return {n} end, addCommand = function(n) log('CMD', n) end,
                    addSubMenuForCoalition = function() return {} end, addCommandForCoalition = function() end,
                    removeItem = function() end }
land = { getHeight = function() return 0 end, isVisible = function() return true end }
atmosphere = stub()
Weapon = { Category = { MISSILE = 1 }, GuidanceType = { RADAR_PASSIVE = 5 } }
Object = { Category = { UNIT = 1, WEAPON = 2 } }
net = nil  -- no EA socket in the harness
Controller = { Detection = { VISUAL = 1, OPTIC = 2, RADAR = 4, IRST = 8, RWR = 16, DLINK = 32 } }

-- ground groups: name -> side, pos, unit types
GROUPS = {}
local byName = {}
local function mkUnit(g, i, typ)
  local u = { alive = true }
  function u:getName() return g.name .. '-' .. i end
  function u:getTypeName() return typ end
  function u:isExist() return u.alive end
  function u:isActive() return g.active end
  function u:getLife() return 1 end
  function u:getPoint() return { x = g.x + i * 30, y = 0, z = g.z } end
  function u:getPosition() return { p = u:getPoint(), x = {x=1,y=0,z=0}, y = {x=0,y=1,z=0}, z = {x=0,y=0,z=1} } end
  function u:getGroup() return g.obj end
  function u:getCoalition() return g.side end
  function u:getController() return g.ctrl end
  function u:getRadar() return false, nil end
  function u:hasSensors() return true end
  function u:enableEmission(on) g.emitting = on end
  function u:getDesc() return { category = 2 } end
  function u:getID() return i end
  return u
end
function addGroup(name, side, x, z, types)
  local g = { name = name, side = side, x = x, z = z, active = false }
  g.ctrl = { setOption = function() end, getDetectedTargets = function() return {} end,
             setOnOff = function() end, pushTask = function() end, setTask = function() end,
             knowTarget = function() end, resetTask = function() end, popTask = function() end }
  setmetatable(g.ctrl, { __index = function() return function() end end })
  local units = {}
  local obj = {}
  g.obj = obj
  for i, t in ipairs(types) do units[i] = mkUnit(g, i, t) end
  function obj:getName() return name end
  function obj:isExist() return true end
  function obj:activate() g.active = true end
  function obj:getUnits() return units end
  function obj:getUnit(i) return units[i] end
  function obj:getSize() return #units end
  function obj:getCoalition() return side end
  function obj:getController() return g.ctrl end
  function obj:enableEmission(on) g.emitting = on end
  function obj:getCategory() return 2 end
  function obj:getID() return #GROUPS + 1 end
  GROUPS[#GROUPS+1] = g
  byName[name] = obj
  return g
end
Group.getByName = function(n) return byName[n] end
Unit.getByName = function() return nil end
coalition.getGroups = function(side, cat)
  local out = {}
  if cat ~= Group.Category.GROUND then return out end
  for _, g in ipairs(GROUPS) do if g.side == side then out[#out+1] = g.obj end end
  return out
end

function runTimers(untilT)
  local guard = 0
  while true do
    guard = guard + 1
    if guard > 5000 then error('timer loop runaway') end
    local best, bi = nil, nil
    for i, s in ipairs(SCHED) do if not s.dead and s.t <= untilT and (not best or s.t < best.t) then best, bi = s, i end end
    if not best then break end
    best.dead = true
    NOW = best.t
    local ok, nextT = pcall(best.f, best.arg, NOW)
    if not ok then error('scheduled fn failed at t=' .. NOW .. ': ' .. tostring(nextT)) end
    if type(nextT) == 'number' then SCHED[#SCHED+1] = { f = best.f, arg = best.arg, t = nextT } end
  end
  NOW = untilT
end
'''
