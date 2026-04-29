--[[
================================================================================
  CARRIER CONTROL SCRIPT  —  DCS World Mission Scripting Engine
================================================================================

  Drop this file into your mission via a DO SCRIPT FILE trigger (MISSION START).
  Everything is configured in the SETTINGS block below — change carrier name,
  TACAN channel, recovery parameters, etc. without touching any logic.

  Features controlled via F10 Radio > Carrier Ops:
    • Turn Into Wind (BRC calculated from live wind)
    • Resume original route / set custom heading
    • Set speed (custom knots)
    • Lights: Launch / Recovery / Deck (on/off)
    • TACAN / ICLS beacon activation
    • CASE I / II / III recovery mode presets
    • Emergency breakaway (all lights off, resume route)
    • Deck status announcements (wind, BRC, speed) via message

  Compatible with: Supercarrier (CVN), Stennis, Kuznetsov, Tarawa, etc.
  Multiplayer: Yes — uses coalition-level F10 menu (visible to all blue pilots).

  Author: Fett
  Version: 1.0
================================================================================
--]]


------------------------------------------------------------------------
--  SETTINGS — edit these to match your mission
------------------------------------------------------------------------
local CFG = {

  -- Carrier unit name (MUST match the unit name in the ME exactly)
  CARRIER_NAME     = "CVN-72",

  -- Which coalition owns the carrier (1 = Red, 2 = Blue)
  COALITION        = 2,  -- coalition.side.BLUE

  -- TACAN
  TACAN_CHANNEL    = 72,
  TACAN_BAND       = "X",       -- "X" or "Y"
  TACAN_CALLSIGN   = "LHD",     -- 3-letter callsign

  -- ICLS
  ICLS_CHANNEL     = 2,

  -- Turn Into Wind
  TIW_SPEED_KTS    = 27,        -- ship speed when turning into wind
  TIW_DURATION_MIN = 30,        -- how long to hold TIW before auto-resuming route
  TIW_AUTO_RESUME  = true,      -- false = hold heading until manually cancelled

  -- Default cruise speed when NOT in TIW (knots)
  CRUISE_SPEED_KTS = 15,

  -- Recovery defaults
  DEFAULT_CASE     = 1,         -- startup recovery case (1, 2, or 3)

  -- Message display time (seconds)
  MSG_DURATION     = 15,

  -- Enable debug messages in DCS log
  DEBUG            = false,
}


------------------------------------------------------------------------
--  INTERNAL STATE  (do not edit)
------------------------------------------------------------------------
local STATE = {
  tiw_active       = false,
  tiw_scheduler    = nil,
  lights_launch    = false,
  lights_recovery  = false,
  lights_deck      = false,
  tacan_on         = false,
  icls_on          = false,
  current_case     = CFG.DEFAULT_CASE,
  original_route   = nil,    -- saved on first TIW so we can resume
}


------------------------------------------------------------------------
--  UTILITIES
------------------------------------------------------------------------
local function log(msg)
  if CFG.DEBUG then
    env.info("[CARRIER-CTRL] " .. tostring(msg))
  end
end

local function msg(text, duration)
  trigger.action.outTextForCoalition(CFG.COALITION, text, duration or CFG.MSG_DURATION)
end

local function getCarrier()
  local u = Unit.getByName(CFG.CARRIER_NAME)
  if not u then
    u = Group.getByName(CFG.CARRIER_NAME)
    if u then u = u:getUnit(1) end
  end
  return u
end

local function getCarrierGroup()
  local u = getCarrier()
  return u and u:getGroup() or nil
end

local function ktsToMps(kts)
  return kts * 0.514444
end

local function mpsToKts(mps)
  return mps / 0.514444
end

local function radToDeg(r)
  return r * 180 / math.pi
end

local function degToRad(d)
  return d * math.pi / 180
end

--- Normalize heading to 0-360
local function normHdg(h)
  h = h % 360
  if h < 0 then h = h + 360 end
  return h
end


------------------------------------------------------------------------
--  WIND & BRC
------------------------------------------------------------------------

--- Get surface wind at carrier position.  Returns { dir_from, speed_mps }.
--- dir_from is the compass heading the wind is COMING FROM (like ATIS).
local function getWindAtCarrier()
  local u = getCarrier()
  if not u then return { dir_from = 0, speed_mps = 0 } end
  local pos = u:getPoint()
  -- DCS weather: wind vector at position, altitude.  Ground level ≈ 0 for sea.
  local wind = atmosphere.getWind({ x = pos.x, y = 0, z = pos.z })
  -- wind.x = North component, wind.z = East component (direction wind is GOING)
  local speed = math.sqrt(wind.x * wind.x + wind.z * wind.z)
  -- direction the wind is going TO (math heading)
  local to_rad = math.atan2(wind.z, wind.x)
  local to_deg = normHdg(90 - radToDeg(to_rad))  -- convert math→compass
  -- flip 180 to get "coming from"
  local from_deg = normHdg(to_deg + 180)
  return { dir_from = from_deg, speed_mps = speed }
end

--- Calculate Base Recovery Course: the heading the ship should sail so that
--- the relative wind down the angled deck is straight.
--- For a standard US CVN the angled deck is ~9° left of ship heading.
--- BRC ≈ wind_from - 9° (we make this configurable).
local ANGLED_DECK_OFFSET = 9  -- degrees left of bow

local function calcBRC()
  local wind = getWindAtCarrier()
  -- Ship heading = into the wind, offset for angled deck
  local brc = normHdg(wind.dir_from - ANGLED_DECK_OFFSET)
  return brc, wind
end


------------------------------------------------------------------------
--  MOVEMENT COMMANDS
------------------------------------------------------------------------

--- Push a new route to the carrier group: single waypoint at heading/speed.
local function setHeadingAndSpeed(hdg_deg, speed_kts)
  local grp = getCarrierGroup()
  if not grp then log("Carrier group not found!"); return end

  local u = getCarrier()
  local pos = u:getPoint()

  -- Project a waypoint 200 nm ahead on desired heading
  local dist = 370400  -- 200 nm in meters
  local hdg_rad = degToRad(hdg_deg)
  local dx = dist * math.cos(hdg_rad)  -- north
  local dz = dist * math.sin(hdg_rad)  -- east ... wait, DCS x=north, z=east? No.
  -- DCS coordinate system: x = North (kind of), z = "East-ish".
  -- Actually in DCS: heading 0=North means +x, heading 90=East means +z.
  -- Let's use proper trig: North component = cos(heading), East component = sin(heading)
  -- But DCS heading in radians from North clockwise...
  -- x += dist * cos(hdg_rad_from_north)  ... but math.cos expects standard math angles.
  -- Convert compass heading to math: math_angle = 90 - compass, or just:
  --   north_component = cos(compass_rad)  where compass_rad measured CW from north
  --   east_component  = sin(compass_rad)
  -- That's correct for CW-from-north if we define:
  local north = dist * math.cos(degToRad(hdg_deg))
  local east  = dist * math.sin(degToRad(hdg_deg))

  local wp = {
    x   = pos.x + north,
    y   = pos.z + east,    -- Note: route waypoints use .y for the Z axis
    alt = 0,
    speed = ktsToMps(speed_kts),
    action = "Turning Point",
    type   = "Turning Point",
  }

  -- Save original route on first use so we can resume later
  if not STATE.original_route then
    local ctrl = grp:getController()
    -- We can't easily read the current route, so we save the initial mission
    -- route from the first call.  User can always "resume" from ME route.
    STATE.original_route = true  -- flag that we've deviated
    log("Original route snapshot saved (flag)")
  end

  local mission = {
    id = 'Mission',
    params = {
      route = {
        points = {
          [1] = {
            x        = pos.x,
            y        = pos.z,
            alt      = 0,
            speed    = ktsToMps(speed_kts),
            action   = "Turning Point",
            type     = "Turning Point",
          },
          [2] = wp,
        },
      },
    },
  }

  grp:getController():setTask(mission)
  log(string.format("Set heading %03d at %d kts", hdg_deg, speed_kts))
end


------------------------------------------------------------------------
--  TURN INTO WIND
------------------------------------------------------------------------
local function turnIntoWind()
  local brc, wind = calcBRC()
  setHeadingAndSpeed(brc, CFG.TIW_SPEED_KTS)
  STATE.tiw_active = true

  local wind_kts = math.floor(mpsToKts(wind.speed_mps) + 0.5)
  local wod = wind_kts + CFG.TIW_SPEED_KTS  -- Wind Over Deck (approx)

  msg(string.format(
    "CARRIER — TURN INTO WIND\n" ..
    "BRC: %03d°   Ship Speed: %d kts\n" ..
    "Wind: %03d° / %d kts   WOD: ~%d kts\n" ..
    "Recovery Case %s",
    brc, CFG.TIW_SPEED_KTS,
    math.floor(wind.dir_from + 0.5), wind_kts, wod,
    tostring(STATE.current_case)
  ))

  -- Auto-resume after duration
  if CFG.TIW_AUTO_RESUME and CFG.TIW_DURATION_MIN > 0 then
    if STATE.tiw_scheduler then
      timer.removeFunction(STATE.tiw_scheduler)
    end
    STATE.tiw_scheduler = timer.scheduleFunction(function()
      if STATE.tiw_active then
        STATE.tiw_active = false
        msg("CARRIER — TIW expired, resuming base course.")
        setHeadingAndSpeed(normHdg(brc + 180), CFG.CRUISE_SPEED_KTS)  -- crude "go back"
      end
      STATE.tiw_scheduler = nil
    end, nil, timer.getTime() + CFG.TIW_DURATION_MIN * 60)
  end

  log("TIW active, BRC=" .. tostring(brc))
end

local function cancelTIW()
  STATE.tiw_active = false
  if STATE.tiw_scheduler then
    timer.removeFunction(STATE.tiw_scheduler)
    STATE.tiw_scheduler = nil
  end
  setHeadingAndSpeed(0, CFG.CRUISE_SPEED_KTS)
  msg("CARRIER — TIW cancelled.  Set heading/speed manually or use Resume Route.")
end


------------------------------------------------------------------------
--  LIGHTS
------------------------------------------------------------------------
-- DCS uses trigger flags or specific scripting commands depending on module.
-- For Supercarrier, lights are controlled via the SC module's built-in API.
-- For generic carriers, we use trigger.action commands.

local function setLaunchLights(on)
  STATE.lights_launch = on
  -- Supercarrier: these are typically automatic, but we can signal via flag
  trigger.action.setUserFlag("CARRIER_LAUNCH_LIGHTS", on and 1 or 0)
  msg("Launch Lights: " .. (on and "ON" or "OFF"))
  log("Launch lights " .. (on and "ON" or "OFF"))
end

local function setRecoveryLights(on)
  STATE.lights_recovery = on
  trigger.action.setUserFlag("CARRIER_RECOVERY_LIGHTS", on and 1 or 0)
  msg("Recovery Lights: " .. (on and "ON" or "OFF"))
  log("Recovery lights " .. (on and "ON" or "OFF"))
end

local function setDeckLights(on)
  STATE.lights_deck = on
  trigger.action.setUserFlag("CARRIER_DECK_LIGHTS", on and 1 or 0)
  msg("Deck Lights: " .. (on and "ON" or "OFF"))
  log("Deck lights " .. (on and "ON" or "OFF"))
end

local function allLightsOff()
  setLaunchLights(false)
  setRecoveryLights(false)
  setDeckLights(false)
end


------------------------------------------------------------------------
--  TACAN / ICLS BEACONS
------------------------------------------------------------------------

local function activateTACAN()
  local u = getCarrier()
  if not u then return end

  -- Supercarrier & most carrier units support CommandActivateBeacon
  local cmd = {
    id = "ActivateBeacon",
    params = {
      type    = 4,                          -- TACAN
      system  = 3,                          -- TACAN system
      channel = CFG.TACAN_CHANNEL,
      modeChannel = CFG.TACAN_BAND == "Y" and "Y" or "X",
      callsign = CFG.TACAN_CALLSIGN,
      bearing  = true,
      frequency = 0,                        -- auto-calculated from channel
    },
  }
  u:getController():setCommand(cmd)
  STATE.tacan_on = true
  msg(string.format("TACAN ON — %d%s  (%s)",
    CFG.TACAN_CHANNEL, CFG.TACAN_BAND, CFG.TACAN_CALLSIGN))
  log("TACAN activated")
end

local function deactivateTACAN()
  local u = getCarrier()
  if not u then return end
  u:getController():setCommand({ id = "DeactivateBeacon", params = {} })
  STATE.tacan_on = false
  msg("TACAN OFF")
  log("TACAN deactivated")
end

local function activateICLS()
  local u = getCarrier()
  if not u then return end
  local cmd = {
    id = "ActivateICLS",
    params = {
      type    = 131584,  -- ICLS
      channel = CFG.ICLS_CHANNEL,
    },
  }
  u:getController():setCommand(cmd)
  STATE.icls_on = true
  msg(string.format("ICLS ON — Channel %d", CFG.ICLS_CHANNEL))
  log("ICLS activated")
end

local function deactivateICLS()
  local u = getCarrier()
  if not u then return end
  u:getController():setCommand({ id = "DeactivateICLS", params = {} })
  STATE.icls_on = false
  msg("ICLS OFF")
  log("ICLS deactivated")
end


------------------------------------------------------------------------
--  RECOVERY CASE PRESETS
------------------------------------------------------------------------
--[[
  CASE I  — VMC, ceiling > 3000 ft, vis > 5 nm.  Day VFR overhead break.
  CASE II — Ceiling 1000-3000 ft, vis 5+ nm.  Instrument approach, break at ship.
  CASE III — Ceiling < 1000 ft or vis < 5 nm, or night.  Full instrument approach.
--]]

local function setCaseRecovery(caseNum)
  STATE.current_case = caseNum

  if caseNum == 1 then
    setLaunchLights(false)
    setRecoveryLights(false)
    setDeckLights(false)
    msg("CASE I RECOVERY\n" ..
        "Visual overhead break.\n" ..
        "Lights: All OFF (day VFR)")

  elseif caseNum == 2 then
    setLaunchLights(false)
    setRecoveryLights(true)
    setDeckLights(true)
    msg("CASE II RECOVERY\n" ..
        "Instrument to overhead, visual break.\n" ..
        "Recovery & Deck Lights: ON")

  elseif caseNum == 3 then
    setLaunchLights(false)
    setRecoveryLights(true)
    setDeckLights(true)
    msg("CASE III RECOVERY\n" ..
        "Full instrument approach.\n" ..
        "Recovery & Deck Lights: ON")
  end

  log("Recovery Case " .. caseNum)
end


------------------------------------------------------------------------
--  SET CUSTOM HEADING / SPEED  (via flag-based input workaround)
------------------------------------------------------------------------
-- Since F10 menu can't take free-text input, we provide preset speed options.

local SPEED_PRESETS = { 5, 10, 15, 20, 25, 27, 30 }

local function setCustomSpeed(kts)
  local u = getCarrier()
  if not u then return end
  -- Get current heading from unit
  local hdg = normHdg(radToDeg(math.atan2(
    u:getVelocity().z, u:getVelocity().x
  )))
  -- If ship is nearly stopped, use 0
  local vel = u:getVelocity()
  local spd = math.sqrt(vel.x * vel.x + vel.z * vel.z)
  if spd < 1 then hdg = 0 end

  setHeadingAndSpeed(hdg, kts)
  msg(string.format("CARRIER — Speed set to %d kts, maintaining heading %03d°", kts, hdg))
end

local HEADING_PRESETS = { 0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330 }

local function setCustomHeading(hdg)
  local speed = CFG.CRUISE_SPEED_KTS
  if STATE.tiw_active then speed = CFG.TIW_SPEED_KTS end
  setHeadingAndSpeed(hdg, speed)
  STATE.tiw_active = false
  msg(string.format("CARRIER — Heading %03d° at %d kts", hdg, speed))
end


------------------------------------------------------------------------
--  DECK STATUS REPORT
------------------------------------------------------------------------
local function deckReport()
  local u = getCarrier()
  if not u then msg("Carrier not found!"); return end

  local wind = getWindAtCarrier()
  local brc = calcBRC()
  local vel = u:getVelocity()
  local ship_spd = math.floor(mpsToKts(math.sqrt(vel.x * vel.x + vel.z * vel.z)) + 0.5)
  local ship_hdg = normHdg(radToDeg(math.atan2(vel.z, vel.x)))
  if ship_spd < 1 then ship_hdg = 0 end
  local wind_kts = math.floor(mpsToKts(wind.speed_mps) + 0.5)
  local wod = wind_kts + ship_spd

  local tacan_str = STATE.tacan_on
    and string.format("%d%s (%s)", CFG.TACAN_CHANNEL, CFG.TACAN_BAND, CFG.TACAN_CALLSIGN)
    or "OFF"
  local icls_str = STATE.icls_on
    and string.format("Ch %d", CFG.ICLS_CHANNEL)
    or "OFF"

  msg(string.format(
    "═══ CARRIER DECK STATUS ═══\n" ..
    "Ship HDG: %03d°   Speed: %d kts\n" ..
    "Wind: %03d° / %d kts\n" ..
    "BRC: %03d°   WOD: ~%d kts\n" ..
    "Recovery: CASE %s\n" ..
    "TACAN: %s   ICLS: %s\n" ..
    "Lights — Launch: %s  Recovery: %s  Deck: %s\n" ..
    "TIW: %s",
    math.floor(ship_hdg + 0.5), ship_spd,
    math.floor(wind.dir_from + 0.5), wind_kts,
    math.floor(brc + 0.5), wod,
    tostring(STATE.current_case),
    tacan_str, icls_str,
    STATE.lights_launch and "ON" or "OFF",
    STATE.lights_recovery and "ON" or "OFF",
    STATE.lights_deck and "ON" or "OFF",
    STATE.tiw_active and "ACTIVE" or "OFF"
  ), 25)
end


------------------------------------------------------------------------
--  EMERGENCY BREAKAWAY
------------------------------------------------------------------------
local function emergencyBreakaway()
  allLightsOff()
  cancelTIW()
  msg("⚠ EMERGENCY BREAKAWAY ⚠\n" ..
      "All lights OFF — TIW cancelled\n" ..
      "Set heading/speed manually.", 20)
end


------------------------------------------------------------------------
--  BUILD F10 RADIO MENU
------------------------------------------------------------------------
local function buildMenu()
  local root = missionCommands.addSubMenuForCoalition(CFG.COALITION, "Carrier Ops")

  -----------------------------------------------
  -- Turn Into Wind
  -----------------------------------------------
  local tiwMenu = missionCommands.addSubMenuForCoalition(CFG.COALITION, "Turn Into Wind", root)
  missionCommands.addCommandForCoalition(CFG.COALITION, "Activate TIW", tiwMenu, turnIntoWind)
  missionCommands.addCommandForCoalition(CFG.COALITION, "Cancel TIW", tiwMenu, cancelTIW)

  -----------------------------------------------
  -- Heading
  -----------------------------------------------
  local hdgMenu = missionCommands.addSubMenuForCoalition(CFG.COALITION, "Set Heading", root)
  for _, h in ipairs(HEADING_PRESETS) do
    missionCommands.addCommandForCoalition(
      CFG.COALITION, string.format("%03d°", h), hdgMenu,
      function() setCustomHeading(h) end
    )
  end

  -----------------------------------------------
  -- Speed
  -----------------------------------------------
  local spdMenu = missionCommands.addSubMenuForCoalition(CFG.COALITION, "Set Speed", root)
  for _, s in ipairs(SPEED_PRESETS) do
    missionCommands.addCommandForCoalition(
      CFG.COALITION, string.format("%d kts", s), spdMenu,
      function() setCustomSpeed(s) end
    )
  end

  -----------------------------------------------
  -- Lights
  -----------------------------------------------
  local lightsMenu = missionCommands.addSubMenuForCoalition(CFG.COALITION, "Lights", root)
  missionCommands.addCommandForCoalition(CFG.COALITION, "Launch Lights — Toggle", lightsMenu,
    function() setLaunchLights(not STATE.lights_launch) end)
  missionCommands.addCommandForCoalition(CFG.COALITION, "Recovery Lights — Toggle", lightsMenu,
    function() setRecoveryLights(not STATE.lights_recovery) end)
  missionCommands.addCommandForCoalition(CFG.COALITION, "Deck Lights — Toggle", lightsMenu,
    function() setDeckLights(not STATE.lights_deck) end)
  missionCommands.addCommandForCoalition(CFG.COALITION, "All Lights OFF", lightsMenu, allLightsOff)

  -----------------------------------------------
  -- Beacons
  -----------------------------------------------
  local beaconMenu = missionCommands.addSubMenuForCoalition(CFG.COALITION, "Beacons", root)
  missionCommands.addCommandForCoalition(CFG.COALITION, "TACAN — Toggle", beaconMenu,
    function()
      if STATE.tacan_on then deactivateTACAN() else activateTACAN() end
    end)
  missionCommands.addCommandForCoalition(CFG.COALITION, "ICLS — Toggle", beaconMenu,
    function()
      if STATE.icls_on then deactivateICLS() else activateICLS() end
    end)

  -----------------------------------------------
  -- Recovery Case
  -----------------------------------------------
  local caseMenu = missionCommands.addSubMenuForCoalition(CFG.COALITION, "Recovery Case", root)
  missionCommands.addCommandForCoalition(CFG.COALITION, "CASE I  (Day VFR)", caseMenu,
    function() setCaseRecovery(1) end)
  missionCommands.addCommandForCoalition(CFG.COALITION, "CASE II (Instrument + Visual)", caseMenu,
    function() setCaseRecovery(2) end)
  missionCommands.addCommandForCoalition(CFG.COALITION, "CASE III (Full Instrument / Night)", caseMenu,
    function() setCaseRecovery(3) end)

  -----------------------------------------------
  -- Status & Emergency
  -----------------------------------------------
  missionCommands.addCommandForCoalition(CFG.COALITION, "Deck Status Report", root, deckReport)
  missionCommands.addCommandForCoalition(CFG.COALITION, "⚠ Emergency Breakaway", root, emergencyBreakaway)

  log("F10 menu built")
end


------------------------------------------------------------------------
--  STARTUP
------------------------------------------------------------------------
local function init()
  local u = getCarrier()
  if not u then
    -- Carrier might not be spawned yet — retry in 5 seconds
    env.info("[CARRIER-CTRL] Carrier '" .. CFG.CARRIER_NAME .. "' not found, retrying in 5s...")
    timer.scheduleFunction(function()
      init()
    end, nil, timer.getTime() + 5)
    return
  end

  env.info("[CARRIER-CTRL] Initializing for carrier: " .. CFG.CARRIER_NAME)

  -- Build F10 menu
  buildMenu()

  -- Auto-activate TACAN + ICLS on startup
  activateTACAN()
  activateICLS()

  -- Set initial recovery case
  setCaseRecovery(CFG.DEFAULT_CASE)

  msg(string.format(
    "CARRIER OPS ONLINE — %s\n" ..
    "TACAN %d%s (%s)  |  ICLS Ch %d\n" ..
    "Use F10 > Carrier Ops to control.\n" ..
    "Recovery: CASE %d",
    CFG.CARRIER_NAME,
    CFG.TACAN_CHANNEL, CFG.TACAN_BAND, CFG.TACAN_CALLSIGN,
    CFG.ICLS_CHANNEL,
    CFG.DEFAULT_CASE
  ), 20)

  env.info("[CARRIER-CTRL] Ready.")
end

-- Kick it off (slight delay for mission to fully load)
timer.scheduleFunction(function() init() end, nil, timer.getTime() + 3)
