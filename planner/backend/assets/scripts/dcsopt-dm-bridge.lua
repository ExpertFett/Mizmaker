--[[
  DCS:OPT — DM Trigger Bridge
  ============================

  Pairs with the Live → Triggers panel in DCS:OPT. The web panel sends a
  "fire trigger N" request to Olympus, which spawns a Soldier M4 at a
  magic coordinate where the latitude microseconds encode N. This script
  catches the spawn, decodes N, sets the matching user flag, and despawns
  the throwaway unit so it never affects the mission picture.

  HOW TO USE
  ----------
  1. Tag triggers as "DM Fire" in the DCS:OPT Editor → Triggers tab. The
     editor will modify each tagged trigger's condition to also fire when
     its assigned user flag is set, AND it tells the web panel which flag
     index pairs with which trigger.
  2. Load this script into your mission's Triggers → TriggerOnce → "Do
     Script File" at MISSION START. (Or via the Scripts tab in DCS:OPT,
     which auto-injects it at .miz download.)
  3. From the Live terminal, click 🎬 → pick a trigger → Fire. The
     in-game trigger fires within ~1 s.

  CONFIGURATION
  -------------
  - SIGNAL_LAT_BASE: the integer-latitude region the web side encodes its
    fire requests into. Don't change unless you also change the backend's
    encoding. 89° = far north, outside every DCS theatre.
  - DESPAWN: whether to destroy the signal unit after dispatching. Set to
    false during initial setup so you can see the spawns happen in DCS's
    F10 map (helps confirm the bridge is wired).
  - LOG: prefix for trigger.action.outText() messages. Useful to see what
    the bridge is doing in the chat box.

  REQUIREMENTS
  ------------
  Pure DCS API — no MOOSE or MIST dependency. Should work in any mission
  with the standard scripting environment. Loaded via "Do Script File".
]]--

local CONFIG = {
  SIGNAL_LAT_BASE = 89,        -- integer-latitude region the backend writes into
  SIGNAL_LAT_MAX  = 90,        -- exclusive upper bound (89.x is fire-pole, 90+ ignored)
  ENCODE_RES_DEG  = 1e-6,      -- backend lat = 89 + flagIndex * 1e-6
  DESPAWN         = true,      -- destroy signal unit after dispatch (set false to debug)
  LOG             = true,      -- print "DM-bridge: fired flag N" to chat
}

local function logMsg(s)
  if CONFIG.LOG then
    trigger.action.outText("DM-bridge: " .. s, 5, false)
  end
end

local function decodeFlag(lat)
  -- Reverse the backend encoding: flag = round((lat - 89) / 1e-6).
  local delta = lat - CONFIG.SIGNAL_LAT_BASE
  if delta < 0 or delta > 1 then return nil end
  local idx = math.floor(delta / CONFIG.ENCODE_RES_DEG + 0.5)
  if idx <= 0 or idx > 999999 then return nil end
  return idx
end

local handler = {}
function handler:onEvent(event)
  if event.id ~= world.event.S_EVENT_BIRTH then return end
  local obj = event.initiator
  if not obj then return end
  -- Only ground units carry the signal; ignore air/navy births.
  local ok, cat = pcall(Object.getCategory, obj)
  if not ok or cat ~= Object.Category.UNIT then return end
  local ok2, point = pcall(obj.getPoint, obj)
  if not ok2 or not point then return end
  -- Convert the spawn point back to lat/lng for decoding. coord.LOtoLL
  -- returns lat, lon (DCS uses lon, we use lng — same thing).
  local cok, lat, lon = pcall(coord.LOtoLL, point)
  if not cok or not lat then return end
  if lat < CONFIG.SIGNAL_LAT_BASE or lat >= CONFIG.SIGNAL_LAT_MAX then return end
  local flag = decodeFlag(lat)
  if not flag then return end
  -- Fire: set the user flag the (Editor-modified) trigger condition watches.
  trigger.action.setUserFlag(flag, 1)
  logMsg("fired flag " .. tostring(flag) .. " from spawn at lat " .. string.format("%.6f", lat))
  if CONFIG.DESPAWN then
    -- Schedule destroy on the next tick — destroying mid-event-handler
    -- can throw in some DCS builds.
    timer.scheduleFunction(function() pcall(obj.destroy, obj) end, nil, timer.getTime() + 0.1)
  end
end

world.addEventHandler(handler)
trigger.action.outText("DM-bridge: armed (listening for signals at lat ~89°)", 8, false)
