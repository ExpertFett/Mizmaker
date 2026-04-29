-- AEGIS IADS - Event-Driven Integrated Air Defense for DCS World
-- Copyright (C) 2026 VMFA(AW)-224 Skunkworks
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU General Public License as published by
-- the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
-- GNU General Public License for more details.
--
-- You should have received a copy of the GNU General Public License
-- along with this program. If not, see <https://www.gnu.org/licenses/>.

--[[
================================================================================
  AEGIS IADS v0.8.4-beta -- Event-Driven Integrated Air Defense for DCS World

  Phase 1: EW-driven activation, WEZ gating, altitude filtering, PD slaving
  Phase 2: Infrastructure dependencies (power, C2), EMCON cycling
  Phase 3: HARM detection (S_EVENT_SHOT), GO_DARK reaction, cooldown timer
  Phase 3.2: HARM reaction policies (selfProtect, LAST_DITCH, panic, multi-HARM)
  Phase 5: PB HARM network warning (trajectory + EW detection delay + harmInbound)
  Phase 3.3: PD improvements (alert frustration, bravery roll, orphan promotion)
  Phase 6.0: EA jammer framework (AI + player EA, jammed EMCON cycling)
  Phase 6.1: EA v2 — burn-through formula, EW contact filtering, sector jam warning,
             WSO F10 menu (mode selection, pod management, emitter alerts)
  Phase 6.3: Home-on-Jam (HOJ immunity window) + differentiated jammed EMCON timing
  Phase 6.5: EW AoE lift, gain-scaled range, bearing-aware sector EMCON
  Phase 6.6: Unified EW burn-through (β formula), observable sector jam flag,
             nearest-EW bearing gate, per-system trackingBias, HERC jammer
  Companion: IADS visualizer (DUMP protocol + bridge.py + web UI)
  + EMCON jitter (startup delay, threat memory, quick peek, double-sweep, spook)
  + Group name zone/range overrides (SAM-SA10-NORTH-1-NEZ25)
  + Squared distance optimization (no sqrt in WEZ checks)
  + EW detection range override (EW-NORTH-DET120)

  Dependencies: NONE (pure DCS scripting engine, no MOOSE/MIST required)
  
  Naming Conventions (auto-discovery):
    EW Radars:      EW-{SECTOR}[-{ID}][-DET{NM}]          e.g. EW-NORTH, EW-NORTH-2, EW-NORTH-DET120
    SAM Sites:      SAM-TYPE-SECTOR[-ID][-ZONE(NM)][-ACT(NM)]  e.g. SAM-SA10-NORTH-1-NEZ25-ACT50
    Point Defense:  PD-{TYPE}-{SECTOR}[-{ID}]              e.g. PD-SA15-NORTH-1
    Power Sources:  PWR-{TARGET}                           e.g. PWR-SA5-SOUTH-1 -> SAM-SA5-SOUTH-1
                                                              PWR-EW-NORTH -> EW-NORTH
    Command Centers:CMD-{SECTOR}[-{ID}]                    e.g. CMD-SOUTH
    EA Aircraft:    EA-{TYPE}-{ANYTHING}[-{ID}]             e.g. EA-GROWLER-BENGAL-1 (opposing coalition)

  Missile Variant Suffixes (S-300V family):
    SAM-SA12-NORTH-1          Gladiator default (41 NM WEZ)
    SAM-SA12G-NORTH-1         Giant loadout (54 NM WEZ)
    SAM-SA23-EAST-1           S-300VM Gladiator (54 NM WEZ)
    SAM-SA23G-EAST-1          S-300VM Giant (108 NM WEZ)
    SAM-SA23V4-EAST-1         S-300V4 Gladiator (81 NM WEZ)
    SAM-SA23V4G-EAST-1        S-300V4 Giant (205 NM WEZ)
  
  Zone and Activation Override Examples:
    SAM-SA10-NORTH-1              Uses global default (WEZ 40 NM, ACT 50 NM)
    SAM-SA10-NORTH-1-NEZ          NEZ with database default (20 NM)
    SAM-SA10-NORTH-1-NEZ25        NEZ at 25 NM
    SAM-SA10-NORTH-1-WEZ30        WEZ override at 30 NM
    SAM-SA10-NORTH-1-ACT60        Default WEZ, activation at 60 NM
    SAM-SA2-NORTH-1-NEZ-ACT30     NEZ + activation at 30 NM
    SAM-SA6-SOUTH-NEZ             No ID, just NEZ (suffixes are order-independent)
  
  Author: VMFA(AW)-224 Skunkworks / Claude collaboration
  Version: 0.8.4-beta
================================================================================
--]]

AEGIS = {}
AEGIS.__index = AEGIS
AEGIS.Version = "0.8.4-beta"

---------------------------------------------------------------------------
-- SYSTEM DATABASE
-- WEZ/NEZ in NM, altitude in feet, type determines behavior
---------------------------------------------------------------------------

AEGIS.SYSTEM_DB = {
  -- Type       WEZ   NEZ   ActRange AltMin  AltMax   Category     NeedsPwr    SelfProtect  TrackRadar (DCS type name)         srLabel (ESM display)
  --
  -- Base DCS systems
  SA2     = { wez=24,  nez=10,  actRange=30,  altMin=150,  altMax=80000,  cat="AREA",   needsPower=false, selfProtect=false, trackRadar="SNR_75V",                     srLabel="Fan Song",     trackingBias=1.0 },
  SA3     = { wez=10,  nez=5,   actRange=14,  altMin=600,  altMax=80000,  cat="AREA",   needsPower=false, selfProtect=false, trackRadar="snr s-125 tr",                srLabel="Low Blow",     trackingBias=1.0 },
  SA5     = { wez=125, nez=60,  actRange=150, altMin=1000, altMax=100000, cat="AREA",   needsPower=true,  selfProtect=false, trackRadar="RPC_5N62V",                    srLabel="Square Pair",  trackingBias=1.0 },
  SA6     = { wez=14,  nez=5,   actRange=18,  altMin=60,   altMax=26000,  cat="AREA",   needsPower=false, selfProtect=false, trackRadar="Kub 1S91 str",                srLabel="Straight Flush", trackingBias=1.0 },  -- Ref: 3M9M Kub, 13.5 NM effective
  SA8     = { wez=7,   nez=3.5, actRange=9,   altMin=30,   altMax=16500,  cat="SHORAD", needsPower=false, selfProtect=false,                                           srLabel="SA-8",         trackingBias=1.0 },
  SA10    = { wez=39,  nez=20,  actRange=50,  altMin=50,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300PS 40B6M tr",            srLabel="Big Bird",     trackingBias=1.0, homeOnJam=true },
  SA11    = { wez=25,  nez=12,  actRange=30,  altMin=10,   altMax=75000,  cat="AREA",   needsPower=false, selfProtect=true,                                            srLabel="Fire Dome",    trackingBias=1.0, homeOnJam=true },  -- TELAR 27 NM, missile 24.8 NM
  SA15    = { wez=8,   nez=3,   actRange=10,  altMin=10,   altMax=20000,  cat="PD",     needsPower=false, selfProtect=true,                                            srLabel="SA-15",        trackingBias=1.0 },
  SA13    = { wez=2.8, nez=1.4, actRange=4,   altMin=33,   altMax=11500,  cat="PD",     needsPower=false, selfProtect=false,                                           srLabel="SA-13",        trackingBias=1.0 },
  SA19    = { wez=4.4, nez=2,   actRange=6,   altMin=15,   altMax=11500,  cat="PD",     needsPower=false, selfProtect=false,                                           srLabel="SA-19",        trackingBias=1.0 },
  HAWK    = { wez=25,  nez=12,  actRange=30,  altMin=150,  altMax=45000,  cat="AREA",   needsPower=false, selfProtect=false, trackRadar="Hawk tr",                     srLabel="Hawk SR",      trackingBias=1.0 },       -- Ref: 24.3 NM effective
  PATRIOT = { wez=80,  nez=35,  actRange=95,  altMin=200,  altMax=80000,  cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="Patriot str",                 srLabel="Patriot",      trackingBias=1.0, homeOnJam=true },  -- PAC-2: 81 NM, PAC-3: 64.8 NM
  NASAMS  = { wez=10,  nez=5,   actRange=12,  altMin=100,  altMax=50000,  cat="AREA",   needsPower=false, selfProtect=false,                                           srLabel="Sentinel",     trackingBias=1.0 },
  GEPARD  = { wez=2,   nez=1,   actRange=3,   altMin=15,   altMax=10000,  cat="PD",     needsPower=false, selfProtect=false,                                                                   trackingBias=1.0 },
  SHILKA  = { wez=1.5, nez=0.5, actRange=2,   altMin=0,    altMax=10000,  cat="PD",     needsPower=false, selfProtect=false,                                                                   trackingBias=1.0 },
  ROLAND  = { wez=4,   nez=2,   actRange=5,   altMin=50,   altMax=16000,  cat="PD",     needsPower=false, selfProtect=false,                                                                   trackingBias=1.0 },
  RAPIER  = { wez=3,   nez=1.5, actRange=4,   altMin=50,   altMax=10000,  cat="PD",     needsPower=false, selfProtect=false,                                                                   trackingBias=1.0 },
  --
  -- CurrentHill mod
  SA15CH  = { wez=9,   nez=3,   actRange=11,  altMin=10,   altMax=33000,  cat="PD",     needsPower=false, selfProtect=true,                                                                    trackingBias=1.0 },  -- TOR-M2, WEZ/altMax pending test
  SA22    = { wez=11,  nez=5,   actRange=14,  altMin=15,   altMax=49000,  cat="PD",     needsPower=false, selfProtect=true,                                            srLabel="Pantsir",      trackingBias=1.0 },  -- Pantsir-S1, 4ch, 12 rds, 2° beamWidth
  --
  -- High Digit SAMs mod (https://github.com/Auranis/HighDigitSAMs)
  -- WEZ/NEZ values are real-world estimates pending SME/in-game verification
  SA10B   = { wez=40,  nez=25,  actRange=50,  altMin=50,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300PS 30N6 TRAILER tr",     srLabel="Big Bird",     trackingBias=1.0, homeOnJam=true },  -- HDS S-300PS variant, 90km missile
  SA10C   = { wez=49,  nez=25,  actRange=63,  altMin=33,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300PS 30N6 TRAILER tr",     srLabel="Big Bird",     trackingBias=1.0, homeOnJam=true },  -- HDS S-300PS variant, extended range
  SA12    = { wez=41,  nez=20,  actRange=50,  altMin=82,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300V 9S32 tr",              srLabel="Grill Pan",    trackingBias=1.0, homeOnJam=true },  -- S-300V Gladiator (9M83, 40.5 NM). Use SA12G for Giant loadout
  SA12G   = { wez=54,  nez=25,  actRange=64,  altMin=82,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300V 9S32 tr",              srLabel="Grill Pan",    trackingBias=1.0, homeOnJam=true },  -- S-300V Giant (9M82, 54.0 NM)
  SA17    = { wez=27,  nez=12,  actRange=30,  altMin=30,   altMax=75000,  cat="AREA",   needsPower=false, selfProtect=true,                                            srLabel="Chair Back",   trackingBias=1.0, homeOnJam=true },  -- Buk-M2, self-contained TELAR
  SA20A   = { wez=81,  nez=40,  actRange=95,  altMin=50,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300PMU1 30N6E tr",          srLabel="Big Bird",     trackingBias=1.0, homeOnJam=true },
  SA20B   = { wez=109, nez=50,  actRange=120, altMin=33,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300PMU2 30N6E2 mast tr",    srLabel="Big Bird",     trackingBias=1.0, homeOnJam=true },
  SA21    = { wez=105, nez=50,  actRange=130, altMin=50,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-400 92N6E mast tr",         srLabel="Big Bird",     trackingBias=1.0, homeOnJam=true },
  SA23    = { wez=54,  nez=25,  actRange=64,  altMin=50,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300VM 9S32ME tr",           srLabel="Grill Pan",    trackingBias=1.0, homeOnJam=true },  -- S-300VM Gladiator (9M83M, 54.0 NM). Use SA23G for Giant loadout
  SA23G   = { wez=108, nez=65,  actRange=130, altMin=50,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300VM 9S32ME tr",           srLabel="Grill Pan",    trackingBias=1.0, homeOnJam=true },  -- S-300VM Giant (9M82M, 108.0 NM)
  SA23V4  = { wez=81,  nez=40,  actRange=95,  altMin=50,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300V4 9S32M-1E tr",         srLabel="Grill Pan",    trackingBias=1.0, homeOnJam=true },  -- S-300V4 Gladiator (9M83ME, 81.0 NM). trackRadar UNVERIFIED
  SA23V4G = { wez=205, nez=100, actRange=220, altMin=50,   altMax=100000, cat="AREA",   needsPower=false, selfProtect=true,  trackRadar="S-300V4 9S32M-1E tr",         srLabel="Grill Pan",    trackingBias=1.0, homeOnJam=true },  -- S-300V4 Giant (9M82MDE, 205.2 NM). trackRadar UNVERIFIED
  SAMPT   = { wez=65,  nez=30,  actRange=75,  altMin=100,  altMax=80000,  cat="AREA",   needsPower=false, selfProtect=true,                                            srLabel="ARABEL",       trackingBias=1.0 },  -- SAMP/T Aster 30, ARH fire-and-forget. TR name UNVERIFIED
}

-- Fallback for unknown system types
AEGIS.SYSTEM_DB.UNKNOWN = { wez=15, nez=7, actRange=20, altMin=50, altMax=60000, cat="AREA", needsPower=false, selfProtect=false, trackingBias=1.0 }

---------------------------------------------------------------------------
-- JAMMER BASELINE (shared tuning knobs for all EA aircraft)
-- All EA types share this baseline; per-type JAMMER_DB provides a mult.
---------------------------------------------------------------------------

AEGIS.JAMMER_BASELINE = {
  effectRange          = 60,    -- NM: hard AoE cap (SAM layer). Nothing beyond this is affected.
  pods                 = 2,     -- full omni = both, split = 1 omni + 1 directional
  burnThroughRatio     = 0.35,  -- SAM layer: baseline fraction of target's refRange
  burnExponent         = 0.5,   -- SAM layer: √Rj (physics), tunable for gameplay
  ewBeta               = 1.8,   -- EW ECCM capability constant (√NM units, ~25 dB processing gain)
  omniHalfAngle        = 90,    -- degrees, OMNI mode beam half-angle
  wideHalfAngle        = 35,    -- degrees, WIDE mode cone pod half-angle
  dirHalfAngle         = 5,     -- degrees, directional beam half-angle
  -- Gain multipliers auto-derived from angles at Init via _BeamGain()
  directionalRangeMult = 2.0,   -- directional reach: effectRange × this = 120 NM
  omniPieHalfWidth     = 0.524, -- ±30° in radians (EW contact filtering pie)
  directionalPieHalfWidth = 1.047, -- ±60° in radians (EW contact filtering pie)
  rangeGainScale       = 0.35,  -- range scales with gain: tighter beam = more reach
  samTrackingBias      = 1.0,   -- SAM tracking radar fallback (per-system trackingBias in SYSTEM_DB overrides)
}

--- Compute antenna gain multiplier from beam half-angle.
--- Physics: Gain ~ 4pi/Omega. Compressed for gameplay: 0.4 / (1 - cos(theta))^0.29
--- Anchored at ±90 deg = 0.4x (full sphere nerf).
function AEGIS._BeamGain(halfAngleDeg)
  return 0.4 / math.pow(1 - math.cos(math.rad(halfAngleDeg)), 0.29)
end

--- WIDE mode presets: selectable beam widths.
--- Gain auto-computed at Init from AEGIS._BeamGain().
AEGIS.WIDE_PRESETS = {
  { label = "W90", angle = 45 },  -- wide, ~0.61x gain
  { label = "W70", angle = 35 },  -- default, ~0.68x gain
  { label = "W50", angle = 25 },  -- tight, ~0.80x gain
}

---------------------------------------------------------------------------
-- JAMMER DATABASE (per-type multiplier)
-- Higher mult = more effective jammer = harder for radar to burn through.
---------------------------------------------------------------------------

AEGIS.JAMMER_DB = {
  GROWLER   = { mult = 1.0 },  -- baseline (EA-18G)
  HERC      = { mult = 1.3 },  -- EC-130H Compass Call — more power, bigger airframe
}
AEGIS.JAMMER_DB.UNKNOWN = { mult = 0.5 }

---------------------------------------------------------------------------
-- STATES
---------------------------------------------------------------------------

AEGIS.STATE = {
  DARK          = "DARK",          -- No threat, emissions OFF
  AWARE         = "AWARE",         -- EW has contacts but not in my WEZ (still dark)
  ALERT         = "ALERT",         -- Contact in WEZ, fully hot
  EMCON_ON      = "EMCON_ON",      -- EMCON active: emissions silent
  EMCON_OFF     = "EMCON_OFF",     -- EMCON lifted: radar on, searching
  EMCON_ENGAGED = "EMCON_ENGAGED", -- Was EMCON, found target, weapons free
  DESTROYED     = "DESTROYED",     -- Dead
}

---------------------------------------------------------------------------
-- CONSTANTS
---------------------------------------------------------------------------

AEGIS.EW_POLL_INTERVAL         = 10     -- Seconds between EW polls
AEGIS.ALERT_TIMEOUT            = 60     -- Seconds after last WEZ contact before going dark
AEGIS.EMCON_ON_MIN            = 30     -- EMCON ON (silent) phase min seconds
AEGIS.EMCON_ON_MAX            = 120    -- EMCON ON (silent) phase max seconds
AEGIS.EMCON_OFF_MIN             = 15     -- EMCON OFF (sweep) phase min seconds
AEGIS.EMCON_OFF_MAX             = 45     -- EMCON OFF (sweep) phase max seconds
AEGIS.EMCON_DETECT_DELAY       = 5      -- Seconds after radar on before checking targets
AEGIS.EMCON_REENGAGE_MIN       = 10     -- Min seconds with no WEZ targets before re-entering EMCON
AEGIS.EMCON_REENGAGE_MAX       = 30     -- Max seconds
AEGIS.EMCON_STARTUP_JITTER     = 60     -- Max random delay before first EMCON cycle
AEGIS.EMCON_DOUBLE_SWEEP_PCT   = 15     -- % chance of quick double-sweep
AEGIS.EMCON_EARLY_TERM_PCT     = 20     -- % chance of cutting sweep short (quick peek)
AEGIS.EMCON_THREAT_SCALE       = 0.5    -- Silent phase multiplier when threat was recently seen
AEGIS.EMCON_RELAXED_SCALE      = 1.5    -- Silent phase multiplier after 3+ empty sweeps
AEGIS.EMCON_SPOOK_DURATION     = 120    -- Seconds a nearby SAM death causes extended silence
AEGIS.EMCON_SPOOK_ENABLED      = false  -- Neighbor spook feature (off by default)
AEGIS.AUTO_ASSOCIATE_RANGE_NM  = 40     -- Auto EW-to-SAM association range
AEGIS.PD_ASSOCIATE_RANGE_NM    = 5      -- Auto PD-to-parent association range
AEGIS.NM_TO_M                  = 1852   -- Conversion factor
AEGIS.FT_TO_M                  = 0.3048 -- Conversion factor

-- HARM detection
AEGIS.HARM_COOLDOWN            = 60     -- Legacy: single cooldown value (backward compat)
AEGIS.HARM_MISSILE_CATEGORY    = 6      -- DCS missileCategory for anti-radiation missiles
AEGIS.HARM_GUIDANCE            = 5      -- DCS guidance value for anti-radiation

-- HARM reaction policies (Phase 3.2)
AEGIS.HARM_REACTION_DELAY_MIN  = 6      -- Min seconds: detection (2-4s) + classification (2-3s) + crew action (2-3s)
AEGIS.HARM_REACTION_DELAY_MAX  = 9      -- Max seconds before crew reacts
AEGIS.HARM_COOLDOWN_MIN        = 45     -- Min GO_DARK cooldown (jittered)
AEGIS.HARM_COOLDOWN_MAX        = 90     -- Max GO_DARK cooldown (jittered)
AEGIS.HARM_STAY_HOT_DURATION   = 30     -- Seconds selfProtect SAM stays hot engaging ARM
AEGIS.HARM_LAST_DITCH_MIN      = 8      -- Min seconds PD gets to engage ARM before parent goes dark
AEGIS.HARM_LAST_DITCH_MAX      = 12     -- Max seconds PD gets to engage ARM
AEGIS.HARM_PANIC_PCT           = 15     -- % chance selfProtect crew panics and goes dark anyway
AEGIS.HARM_MULTI_THRESHOLD_MIN = 4      -- Min per-SAM saturation threshold (randomized at init)
AEGIS.HARM_MULTI_THRESHOLD_MAX = 8      -- Max per-SAM saturation threshold (crew personality)
AEGIS.HARM_MULTI_WINDOW        = 15     -- Seconds to count multiple HARMs for saturation check
AEGIS.HARM_EXTEND_INTERVAL     = 15     -- Seconds between weapon-alive checks when extending cooldown
AEGIS.HARM_MAX_COOLDOWN        = 180    -- Hard cap: max total seconds a HARM reaction can last (safety net)
AEGIS.HARM_BRAVERY_PCT         = 5      -- % chance ANY crew stays hot against HARM (the "nat 20")
AEGIS.HARM_DETECTION_RANGE     = 40     -- NM: max range SAM tracking radar detects inbound ARM (0 = unlimited)
AEGIS.HARM_SPEED               = 680    -- m/s: typical AGM-88 cruise speed for detection delay computation

-- Alert frustration (Phase 3.3)
AEGIS.ALERT_FRUSTRATION_MIN     = 30    -- Min seconds ALERT without WEZ contact before crew powers down
AEGIS.ALERT_FRUSTRATION_MAX     = 60    -- Max seconds
AEGIS.ALERT_FRUSTRATION_STAY_PCT = 10   -- % chance crew stays hot instead (re-rolls timeout)

-- PB HARM network warning (Phase 5)
AEGIS.PB_HARM_CHECK_DELAY      = 2      -- Seconds after PB launch to check trajectory (velocity stabilizes)
AEGIS.PB_HARM_WARN_RADIUS      = 5      -- NM: SAMs within this distance of projected path get warned
AEGIS.PB_HARM_COOLDOWN_MARGIN  = 30     -- Extra seconds added to ETA for cooldown/suppress timing
AEGIS.PB_HARM_INBOUND_MARGIN   = 30     -- Extra seconds for harmInbound flag expiry past ETA
AEGIS.PB_HARM_EW_REACTION_MIN  = 3      -- Min crew reaction after EW network warning (shorter than TOO/SP)
AEGIS.PB_HARM_EW_REACTION_MAX  = 5      -- Max crew reaction after EW network warning
AEGIS.PB_HARM_DETECTION_THRESHOLD = 3.0 -- Cumulative EW score to establish a track
AEGIS.PB_HARM_SWEEP_PERIOD     = 6      -- Seconds per EW sweep (10 RPM assumption)
AEGIS.PB_HARM_DETECTION_FLOOR  = 12     -- Minimum detection delay (2 sweeps even at close range)

-- PB HARM EW detection score table: range (NM) from HARM to EW -> score per sweep
-- Multiple EWs sum scores each sweep independently
AEGIS.PB_HARM_SCORE_TABLE = {
  { maxRange =  5, score = 1.5  },  -- 12s (2 sweeps)
  { maxRange = 10, score = 1.5  },  -- 12s
  { maxRange = 15, score = 1.2  },  -- 18s
  { maxRange = 20, score = 1.0  },  -- 18s
  { maxRange = 25, score = 0.8  },  -- 24s
  { maxRange = 30, score = 0.7  },  -- 30s
  { maxRange = 35, score = 0.5  },  -- 36s
  { maxRange = 40, score = 0.3  },  -- 60s
  { maxRange = 45, score = 0.2  },  -- 90s
  { maxRange = 50, score = 0.15 },  -- 120s
  { maxRange = 55, score = 0.10 },  -- 180s
  { maxRange = 60, score = 0.07 },  -- ~4min
  { maxRange = 65, score = 0.05 },  -- ~6min
  { maxRange = 70, score = 0.03 },  -- ~10min
}
AEGIS.PB_HARM_SCORE_FLOOR = 0.01     -- 70+ NM: effectively never detects

-- EA jammer framework (Phase 6)
AEGIS.EA_ENABLED                = true   -- EA jammer detection enabled by default
AEGIS.JAM_DETECTION_DELAY_MIN   = 1      -- Jammer ESM response time min (burn-through window)
AEGIS.JAM_DETECTION_DELAY_MAX   = 3      -- Jammer ESM response time max
-- Home-on-Jam (Phase 6.3)
AEGIS.HOJ_ENABLED               = true   -- master toggle (disable if players hate it)
AEGIS.HOJ_BASE_PCT              = 0.07   -- 7% chance per peek, escalates by +7% each consecutive peek
AEGIS.HOJ_WINDOW_MIN            = 75     -- jam immunity window min (seconds)
AEGIS.HOJ_WINDOW_MAX            = 120    -- jam immunity window max (seconds)
AEGIS.HOJ_COOLDOWN              = 60     -- seconds after HOJ window expires before re-roll eligible

-- Differentiated jammed EMCON timing (Phase 6.3)
AEGIS.JAM_EMCON_ON_MIN_HOJ      = 12     -- HOJ-capable: aggressive peek (longer on)
AEGIS.JAM_EMCON_ON_MAX_HOJ      = 25
AEGIS.JAM_EMCON_OFF_MIN_HOJ     = 20     -- HOJ-capable: short hide (more frequent peeks)
AEGIS.JAM_EMCON_OFF_MAX_HOJ     = 45
AEGIS.JAM_EMCON_ON_MIN_STD      = 5      -- Standard: cautious peek (brief on)
AEGIS.JAM_EMCON_ON_MAX_STD      = 10
AEGIS.JAM_EMCON_OFF_MIN_STD     = 60     -- Standard: long hide
AEGIS.JAM_EMCON_OFF_MAX_STD     = 150

-- EW detection range override
AEGIS.EW_DETECTION_RANGE        = 0      -- NM, 0 = no limit (DCS handles it)

-- DCS controller constants
AEGIS.ALARM = { AUTO=0, GREEN=1, RED=2 }
AEGIS.ROE   = { WEAPON_FREE=0, OPEN_FIRE=2, RETURN_FIRE=3, WEAPON_HOLD=4 }

-- Map marker ID counter
AEGIS._markerId = 90000

---------------------------------------------------------------------------
-- CONSTRUCTOR
---------------------------------------------------------------------------

function AEGIS:New(side, config)
  local self = setmetatable({}, AEGIS)
  
  if side == "red" then
    self.coalitionId = coalition.side.RED
  elseif side == "blue" then
    self.coalitionId = coalition.side.BLUE
  else
    env.error("[AEGIS] Invalid coalition: " .. tostring(side))
    return nil
  end
  self.side = side
  
  config = config or {}
  self.ewPollInterval     = config.ewPollInterval     or AEGIS.EW_POLL_INTERVAL
  self.alertTimeout       = config.alertTimeout        or AEGIS.ALERT_TIMEOUT
  self.autoAssocRange     = config.autoAssociateRange  or AEGIS.AUTO_ASSOCIATE_RANGE_NM
  self.pdAssocRange       = config.pdAssociateRange    or AEGIS.PD_ASSOCIATE_RANGE_NM
  self.emconOnMin        = config.emconOnMin         or AEGIS.EMCON_ON_MIN
  self.emconOnMax        = config.emconOnMax         or AEGIS.EMCON_ON_MAX
  self.emconOffMin         = config.emconOffMin          or AEGIS.EMCON_OFF_MIN
  self.emconOffMax         = config.emconOffMax          or AEGIS.EMCON_OFF_MAX
  self.emconDetectDelay   = config.emconDetectDelay    or AEGIS.EMCON_DETECT_DELAY
  self.emconReengageMin   = config.emconReengageMin    or AEGIS.EMCON_REENGAGE_MIN
  self.emconReengageMax   = config.emconReengageMax    or AEGIS.EMCON_REENGAGE_MAX
  self.emconStartupJitter = config.emconStartupJitter   or AEGIS.EMCON_STARTUP_JITTER
  self.emconDoubleSweep   = config.emconDoubleSweepPct  or AEGIS.EMCON_DOUBLE_SWEEP_PCT
  self.emconEarlyTerm     = config.emconEarlyTermPct    or AEGIS.EMCON_EARLY_TERM_PCT
  self.emconThreatScale   = config.emconThreatScale     or AEGIS.EMCON_THREAT_SCALE
  self.emconRelaxedScale  = config.emconRelaxedScale    or AEGIS.EMCON_RELAXED_SCALE
  self.emconSpookDuration = config.emconSpookDuration   or AEGIS.EMCON_SPOOK_DURATION
  self.emconSpookEnabled  = config.emconSpookEnabled
  if self.emconSpookEnabled == nil then self.emconSpookEnabled = AEGIS.EMCON_SPOOK_ENABLED end
  self.defaultZone        = config.defaultZone         or "WEZ"  -- "WEZ" or "NEZ"
  self.harmCooldown       = config.harmCooldown         or AEGIS.HARM_COOLDOWN
  -- HARM reaction policies (Phase 3.2)
  self.harmReactionDelayMin = config.harmReactionDelayMin or AEGIS.HARM_REACTION_DELAY_MIN
  self.harmReactionDelayMax = config.harmReactionDelayMax or AEGIS.HARM_REACTION_DELAY_MAX
  self.harmCooldownMin      = config.harmCooldownMin      or AEGIS.HARM_COOLDOWN_MIN
  self.harmCooldownMax      = config.harmCooldownMax      or AEGIS.HARM_COOLDOWN_MAX
  self.harmStayHotDuration  = config.harmStayHotDuration  or AEGIS.HARM_STAY_HOT_DURATION
  self.harmLastDitchMin     = config.harmLastDitchMin     or AEGIS.HARM_LAST_DITCH_MIN
  self.harmLastDitchMax     = config.harmLastDitchMax     or AEGIS.HARM_LAST_DITCH_MAX
  self.harmPanicPct         = config.harmPanicPct         or AEGIS.HARM_PANIC_PCT
  self.harmMultiThresholdMin = config.harmMultiThresholdMin or AEGIS.HARM_MULTI_THRESHOLD_MIN
  self.harmMultiThresholdMax = config.harmMultiThresholdMax or AEGIS.HARM_MULTI_THRESHOLD_MAX
  self.harmMultiWindow      = config.harmMultiWindow      or AEGIS.HARM_MULTI_WINDOW
  self.harmExtendInterval   = config.harmExtendInterval   or AEGIS.HARM_EXTEND_INTERVAL
  self.harmMaxCooldown      = config.harmMaxCooldown      or AEGIS.HARM_MAX_COOLDOWN
  self.harmBraveryPct       = config.harmBraveryPct       or AEGIS.HARM_BRAVERY_PCT
  self.harmDetectionRange   = config.harmDetectionRange   or AEGIS.HARM_DETECTION_RANGE
  -- PB HARM network warning
  self.pbHarmCheckDelay     = config.pbHarmCheckDelay     or AEGIS.PB_HARM_CHECK_DELAY
  self.pbHarmWarnRadius     = config.pbHarmWarnRadius     or AEGIS.PB_HARM_WARN_RADIUS
  self.pbHarmCooldownMargin = config.pbHarmCooldownMargin or AEGIS.PB_HARM_COOLDOWN_MARGIN
  self.pbHarmInboundMargin  = config.pbHarmInboundMargin  or AEGIS.PB_HARM_INBOUND_MARGIN
  self.pbHarmEwReactionMin  = config.pbHarmEwReactionMin  or AEGIS.PB_HARM_EW_REACTION_MIN
  self.pbHarmEwReactionMax  = config.pbHarmEwReactionMax  or AEGIS.PB_HARM_EW_REACTION_MAX
  self.pbHarmDetThreshold   = config.pbHarmDetThreshold   or AEGIS.PB_HARM_DETECTION_THRESHOLD
  self.pbHarmSweepPeriod    = config.pbHarmSweepPeriod    or AEGIS.PB_HARM_SWEEP_PERIOD
  self.pbHarmDetFloor       = config.pbHarmDetFloor       or AEGIS.PB_HARM_DETECTION_FLOOR
  -- Backward compat: if user set harmCooldown but not the min/max, derive jitter range
  if config.harmCooldown and not config.harmCooldownMin and not config.harmCooldownMax then
    self.harmCooldownMin = math.floor(self.harmCooldown * 0.75)
    self.harmCooldownMax = math.floor(self.harmCooldown * 1.5)
  end
  -- Backward compat: old harmMultiThreshold (single number) → use as both min and max (fixed threshold)
  if config.harmMultiThreshold and not config.harmMultiThresholdMin and not config.harmMultiThresholdMax then
    self.harmMultiThresholdMin = config.harmMultiThreshold
    self.harmMultiThresholdMax = config.harmMultiThreshold
  end
  -- Alert frustration (Phase 3.3)
  self.alertFrustrationMin     = config.alertFrustrationMin     or AEGIS.ALERT_FRUSTRATION_MIN
  self.alertFrustrationMax     = config.alertFrustrationMax     or AEGIS.ALERT_FRUSTRATION_MAX
  self.alertFrustrationStayPct = config.alertFrustrationStayPct or AEGIS.ALERT_FRUSTRATION_STAY_PCT
  self.debug              = config.debug               or false
  -- EA jammer framework (Phase 6)
  self.eaEnabled = config.eaEnabled
  if self.eaEnabled == nil then self.eaEnabled = config.ecmEnabled end  -- compat
  if self.eaEnabled == nil then self.eaEnabled = AEGIS.EA_ENABLED end
  self.jamDetectionDelayMin = config.jamDetectionDelayMin or AEGIS.JAM_DETECTION_DELAY_MIN
  self.jamDetectionDelayMax = config.jamDetectionDelayMax or AEGIS.JAM_DETECTION_DELAY_MAX
  -- Home-on-Jam (Phase 6.3)
  self.hojEnabled       = config.hojEnabled
  if self.hojEnabled == nil then self.hojEnabled = AEGIS.HOJ_ENABLED end
  self.hojBasePct       = config.hojBasePct       or AEGIS.HOJ_BASE_PCT
  self.hojWindowMin     = config.hojWindowMin     or AEGIS.HOJ_WINDOW_MIN
  self.hojWindowMax     = config.hojWindowMax     or AEGIS.HOJ_WINDOW_MAX
  self.hojCooldown      = config.hojCooldown      or AEGIS.HOJ_COOLDOWN
  -- Differentiated jammed EMCON timing
  self.jamEmconOnMinHOJ  = config.jamEmconOnMinHOJ  or AEGIS.JAM_EMCON_ON_MIN_HOJ
  self.jamEmconOnMaxHOJ  = config.jamEmconOnMaxHOJ  or AEGIS.JAM_EMCON_ON_MAX_HOJ
  self.jamEmconOffMinHOJ = config.jamEmconOffMinHOJ or AEGIS.JAM_EMCON_OFF_MIN_HOJ
  self.jamEmconOffMaxHOJ = config.jamEmconOffMaxHOJ or AEGIS.JAM_EMCON_OFF_MAX_HOJ
  self.jamEmconOnMinStd  = config.jamEmconOnMinStd  or AEGIS.JAM_EMCON_ON_MIN_STD
  self.jamEmconOnMaxStd  = config.jamEmconOnMaxStd  or AEGIS.JAM_EMCON_ON_MAX_STD
  self.jamEmconOffMinStd = config.jamEmconOffMinStd or AEGIS.JAM_EMCON_OFF_MIN_STD
  self.jamEmconOffMaxStd = config.jamEmconOffMaxStd or AEGIS.JAM_EMCON_OFF_MAX_STD
  -- EW detection range override
  self.ewDetectionRange     = config.ewDetectionRange     or AEGIS.EW_DETECTION_RANGE

  -- EA display: false = generic labels (SAM/EW), true = full group name + type tag
  self.eaDebugLabels        = config.eaDebugLabels        or false
  -- EA emitter memory: seconds to retain stale emitters after they stop radiating (0 = no memory)
  self.eaEmitterMemory      = config.eaEmitterMemory      or 60

  -- Jammer baseline: merge user overrides into a copy of the class baseline
  self.jammerBaseline = {}
  for k, v in pairs(AEGIS.JAMMER_BASELINE) do self.jammerBaseline[k] = v end
  if config.jammerBaseline then
    for k, v in pairs(config.jammerBaseline) do self.jammerBaseline[k] = v end
  end
  -- Compute and cache gain multipliers from beam angles
  local bl = self.jammerBaseline
  bl.omniGain = AEGIS._BeamGain(bl.omniHalfAngle)    -- 0.40 at 90°
  bl.wideGain = AEGIS._BeamGain(bl.wideHalfAngle)    -- 0.68 at 35°
  bl.dirGain  = AEGIS._BeamGain(bl.dirHalfAngle)     -- 2.00 at 5°
  -- Convert angles to radians for runtime checks
  bl.omniHalfAngleRad = math.rad(bl.omniHalfAngle)
  bl.wideHalfAngleRad = math.rad(bl.wideHalfAngle)
  bl.dirHalfAngleRad  = math.rad(bl.dirHalfAngle)
  -- Compute WIDE preset gains
  for _, preset in ipairs(AEGIS.WIDE_PRESETS) do
    preset.gain = AEGIS._BeamGain(preset.angle)
    preset.angleRad = math.rad(preset.angle)
  end

  -- Registries
  self.ewRadars   = {}     -- groupName -> node
  self.samSites   = {}     -- groupName -> node
  self.pdSites    = {}     -- groupName -> node
  self.powerSources   = {} -- groupName -> node
  self.commandCenters = {} -- groupName -> node
  self.sectors    = {}     -- sectorName -> { ew, sams, pds, cmd }
  self.jammers    = {}     -- groupName -> jammer node (EA aircraft)
  self.jammerPlayers = {}  -- playerName -> groupName (explicit tracking for multicrew/re-slot)
  self.eaUnitMap     = {}  -- unitId (string) -> groupName (slot-based copilot/WSO lookup)
  
  -- Overrides
  self.explicitSectors = {}    -- groupName -> sectorName
  self.siteZoneOverrides = {}  -- groupName -> "WEZ" or "NEZ"
  self.siteRangeOverrides = {} -- groupName -> { wez=NM, nez=NM }
  self.siteActRangeOverrides = {} -- groupName -> NM
  
  -- Event handler
  self.eventHandler = nil
  
  -- Map marker tracking
  self.mapMarkerIds = {}
  
  self:_Log("AEGIS v" .. AEGIS.Version .. " created [" .. side .. "]")
  return self
end

---------------------------------------------------------------------------
-- CONFIGURATION API
---------------------------------------------------------------------------

function AEGIS:AssignToSector(groupName, sectorName)
  self.explicitSectors[groupName] = sectorName
  return self
end

function AEGIS:SetEngagementZone(groupName, zone)
  self.siteZoneOverrides[groupName] = zone  -- "WEZ" or "NEZ"
  return self
end

function AEGIS:AddEWRadar(groupName, sectorName)
  self:_RegisterEW(groupName, sectorName)
  return self
end

function AEGIS:AddSAMSite(groupName, sectorName)
  if sectorName then self.explicitSectors[groupName] = sectorName end
  self:_RegisterSAM(groupName)
  return self
end

function AEGIS:AddPointDefense(groupName, parentGroupName)
  self:_RegisterPD(groupName, parentGroupName)
  return self
end

--- Manually register a power source. targetHint follows the same convention
--- as the name suffix: e.g. "SA5-SOUTH-1" to link to SAM-SA5-SOUTH-1
function AEGIS:AddPowerSource(groupName, targetHint)
  self:_RegisterPower(groupName, targetHint or "UNKNOWN")
  return self
end

--- Link a power source to a specific node (SAM or EW).
--- Kill the power source -> that node goes permanently DARK.
function AEGIS:LinkPower(pwrName, targetName)
  local pwr = self.powerSources[pwrName]
  if not pwr then
    self:_Log("LinkPower: PWR not found: " .. pwrName, true)
    return self
  end
  -- Find target in SAMs or EWs
  local target = self.samSites[targetName] or self.ewRadars[targetName]
  if not target then
    self:_Log("LinkPower: target not found: " .. targetName, true)
    return self
  end
  target.powerSource = pwrName
  table.insert(pwr.linkedTo, targetName)
  self:_Log("  PWR LINK: " .. pwrName .. " -> " .. targetName)
  return self
end

function AEGIS:AddCommandCenter(groupName, sectorName)
  self:_RegisterCommand(groupName, sectorName)
  return self
end

---------------------------------------------------------------------------
-- ACTIVATION
---------------------------------------------------------------------------

function AEGIS:Activate()
  self:_Log("=== Activating ===")
  self:_AutoDiscover()
  self:_AutoAssociateSAMs()
  self:_AutoAssociatePDs()
  self:_AutoLinkPower()
  self:_RegisterEventHandler()
  if self.debug then self:_PrintTopology() end
  self:_Log("=== Active [" .. self:_NodeCount() .. " nodes] ===")
  
  -- Immediately kill emissions on all SAMs/PDs to prevent brief radar flash
  -- at mission start. Full state init happens after delay.
  for name, _ in pairs(self.samSites) do
    local grp = Group.getByName(name)
    if grp and grp:isExist() then
      grp:enableEmission(false)
      grp:getController():setOption(AI.Option.Ground.id.ROE, AEGIS.ROE.WEAPON_HOLD)
    end
  end
  for name, _ in pairs(self.pdSites) do
    local grp = Group.getByName(name)
    if grp and grp:isExist() then
      grp:enableEmission(false)
      grp:getController():setOption(AI.Option.Ground.id.ROE, AEGIS.ROE.WEAPON_HOLD)
    end
  end
  
  -- Delay full state init + EW poll to give DCS group AI time to initialize.
  -- enableEmission(false) doesn't always stick if called too early,
  -- so we do it once now (best effort) and again on the delayed init.
  local aegis = self
  timer.scheduleFunction(function()
    aegis:_Log("Setting initial state (delayed)...")
    aegis:_SetInitialState()
    aegis:_StartEWPoll()
    -- Store global instance for hook script GUI bridge
    AEGIS._instance = aegis
    -- Start EA GUI socket listener (no-op if socket unavailable)
    if aegis._StartEASocket then aegis:_StartEASocket() end
  end, nil, timer.getTime() + 10)

  return self
end

function AEGIS:Deactivate()
  if self.eventHandler then
    world.removeEventHandler(self.eventHandler)
    self.eventHandler = nil
  end
  self:_Log("Deactivated")
end

---------------------------------------------------------------------------
-- AUTO-DISCOVERY
---------------------------------------------------------------------------

function AEGIS:_AutoDiscover()
  self:_Log("Discovering groups...")
  local groups = coalition.getGroups(self.coalitionId, Group.Category.GROUND)
  if not groups then return end
  
  for _, grp in ipairs(groups) do
    local name = grp:getName()
    
    local ewSec = name:match("^EW%-([%w]+)")
    if ewSec then self:_RegisterEW(name, ewSec) end
    
    local samType, samSec = name:match("^SAM%-([%w]+)%-([%w]+)")
    if samType then self:_RegisterSAM(name) end
    
    local pdType, pdSec = name:match("^PD%-([%w]+)%-([%w]+)")
    if pdType then self:_RegisterPD(name, nil) end
    
    local pwrRemainder = name:match("^PWR%-(.+)")
    if pwrRemainder then self:_RegisterPower(name, pwrRemainder) end
    
    local cmdSec = name:match("^CMD%-([%w]+)")
    if cmdSec then self:_RegisterCommand(name, cmdSec) end
  end

  -- EA aircraft: scan OPPOSING coalition for EA- prefixed airplane groups
  if self.eaEnabled then
    local enemySide = (self.coalitionId == coalition.side.RED)
                      and coalition.side.BLUE or coalition.side.RED
    local airGroups = coalition.getGroups(enemySide, Group.Category.AIRPLANE)
    if airGroups then
      for _, grp in ipairs(airGroups) do
        local name = grp:getName()
        local jamType = name:match("^EA%-([%w]+)%-")
        if not jamType then
          jamType = name:match("^ECM%-([%w]+)%-")
          if jamType then
            self:_Log("WARNING: " .. name .. " uses deprecated ECM- prefix, rename to EA-", true)
          end
        end
        if jamType then
          self:_RegisterJammer(name, jamType, false)
        end
      end
    end
  end
end

---------------------------------------------------------------------------
-- NODE REGISTRATION
---------------------------------------------------------------------------

function AEGIS:_RegisterEW(groupName, sectorName)
  if self.ewRadars[groupName] then return end
  local grp = Group.getByName(groupName)
  if not grp then self:_Log("EW not found: " .. groupName, true); return end

  -- Parse DET suffix: EW-SECTOR[-ID][-DET{range}]
  local detOverride = nil
  local tail = groupName:match("^EW%-[%w]+%-?(.*)")
  if tail and tail ~= "" then
    for seg in tail:gmatch("([^%-]+)") do
      local detVal = seg:match("^DET(%d+)")
      if detVal then detOverride = tonumber(detVal) end
    end
  end
  local detRange = detOverride or self.ewDetectionRange

  self.ewRadars[groupName] = {
    name = groupName,
    sector = sectorName,
    state = AEGIS.STATE.DARK,
    hasContacts = false,
    lastContact = 0,
    contacts = {},  -- cached contact positions/altitudes from last poll
    powerSource = nil,  -- linked PWR group name (nil = self-powered)
    pos = nil,          -- cached position for PB HARM detection delay
    detRange   = detRange,
    detRangeSq = (detRange > 0) and (detRange * AEGIS.NM_TO_M) ^ 2 or 0,
  }
  -- Cache EW position for detection delay calculations
  local unit = grp:getUnit(1)
  if unit then
    self.ewRadars[groupName].pos = unit:getPoint()
  end
  self:_EnsureSector(sectorName)
  table.insert(self.sectors[sectorName].ew, groupName)
  local detStr = (detRange > 0) and (" (DET " .. detRange .. " NM)") or ""
  self:_Log("  EW: " .. groupName .. " -> " .. sectorName .. detStr)
end

function AEGIS:_RegisterSAM(groupName)
  if self.samSites[groupName] then return end
  local grp = Group.getByName(groupName)
  if not grp then self:_Log("SAM not found: " .. groupName, true); return end
  
  -- Parse name: SAM-{TYPE}-{SECTOR}[-{ID}][-{ZONE}[{NM}]][-ACT{NM}]
  -- Examples: SAM-SA10-NORTH-1, SAM-SA10-NORTH-1-NEZ, SAM-SA10-NORTH-1-NEZ25
  --           SAM-SA6-SOUTH-NEZ, SAM-SA2-NORTH-1-ACT30, SAM-SA10-SOUTH-2-NEZ25-ACT50
  -- Suffixes are order-independent: ACT30-NEZ25 works too.
  local sysType = groupName:match("^SAM%-([%w]+)%-") or "UNKNOWN"
  local sysData = AEGIS.SYSTEM_DB[sysType:upper()] or AEGIS.SYSTEM_DB.UNKNOWN
  
  -- Extract sector from name: SAM-TYPE-SECTOR[-...]
  local nameSector = groupName:match("^SAM%-[%w]+%-([%w]+)")
  if nameSector and not self.explicitSectors[groupName] then
    self.explicitSectors[groupName] = nameSector
  end
  
  -- Scan all segments after SAM-TYPE-SECTOR for known prefixes
  local zoneOverride, rangeOverride, actOverride = nil, nil, nil
  local tail = groupName:match("^SAM%-[%w]+%-[%w]+%-?(.*)")
  if tail and tail ~= "" then
    for seg in tail:gmatch("([^%-]+)") do
      local zone, range = seg:match("^(WEZ)(%d*)")
      if not zone then zone, range = seg:match("^(NEZ)(%d*)") end
      if zone then
        zoneOverride = zone
        if range and range ~= "" then rangeOverride = tonumber(range) end
      else
        local actVal = seg:match("^ACT(%d+)")
        if actVal then actOverride = tonumber(actVal) end
      end
    end
  end
  
  -- Apply overrides discovered from name
  if zoneOverride then
    self.siteZoneOverrides[groupName] = zoneOverride
    if rangeOverride then
      self.siteRangeOverrides[groupName] = self.siteRangeOverrides[groupName] or {}
      if zoneOverride == "WEZ" then
        self.siteRangeOverrides[groupName].wez = rangeOverride
      elseif zoneOverride == "NEZ" then
        self.siteRangeOverrides[groupName].nez = rangeOverride
      end
    end
  end
  if actOverride then
    self.siteActRangeOverrides[groupName] = actOverride
  end
  
  self.samSites[groupName] = {
    name = groupName,
    sector = nil,
    sysType = sysType,
    sysData = sysData,
    state = AEGIS.STATE.DARK,
    emconGen = 0,              -- generation counter for EMCON timer cancellation
    lastContactTime = 0,       -- for EMCON re-engage timeout
    pos = nil,                 -- cached position from init
    -- EMCON jitter tracking
    sweepsSinceDetect = 0,     -- consecutive empty sweeps (relaxes timing)
    lastSweepHadContact = false, -- did last sweep see anything? (tightens timing)
    spooked = false,           -- neighbor was killed, extend next silent phase
    spookedUntil = 0,          -- timer.getTime() when spook wears off
    powerSource = nil,         -- linked PWR group name (nil = self-powered)
    harmCooldownUntil = 0,     -- timer.getTime() when HARM dodge cooldown expires
    -- HARM reaction tracking (Phase 3.2)
    harmEvents = {},           -- list of timestamps for multi-HARM saturation tracking
    harmMultiThreshold = math.random(self.harmMultiThresholdMin, self.harmMultiThresholdMax), -- crew personality
    harmReaction = nil,        -- current reaction: "STAY_HOT" | "LAST_DITCH" | "GO_DARK" | nil
    harmReactionGen = 0,       -- generation counter for pending reaction timers
    harmReactionPending = false, -- true while crew is processing first HARM (blocks timer restart)
    harmWeapon = nil,          -- DCS weapon object ref for in-flight check
    harmReactionStart = 0,     -- timer.getTime() when reaction began (for hard cap)
    -- PB HARM inbound flag (own-radar detection)
    harmInbound = 0,           -- timer.getTime() when set (0 = none)
    harmInboundExpiry = 0,     -- timer.getTime() when flag expires
    -- Alert frustration (Phase 3.3)
    alertWithoutWezSince = 0,    -- timer.getTime() when ALERT first had no WEZ contact (0 = has contact)
    alertFrustrationTimeout = 0, -- randomized timeout for this frustration cycle
    frustrationCooldownUntil = 0, -- timer.getTime() when frustration cooldown expires (WEZ contact overrides)
    -- EA jammer tracking
    jammed = false,            -- true when an active jammer is suppressing this SAM
    jammedEmconGen = 0,        -- generation counter for jammed EMCON timers
    jammedEmconActive = false, -- true when in jammed EMCON cycling
    -- Home-on-Jam (Phase 6.3)
    hojUntil = 0,              -- timer.getTime() when HOJ immunity window expires (0 = inactive)
    hojCooldownUntil = 0,      -- timer.getTime() when HOJ re-roll eligible (0 = ready)
    hojPeekCount = 0,          -- consecutive peeks with jammer in range (escalates probability)
    -- Critical unit tracking (mission kill detection)
    trackRadarUnit = nil,      -- DCS unit name of critical tracking radar (nil = group-kill only)
  }

  -- Cache position
  local unit = grp:getUnit(1)
  if unit then
    self.samSites[groupName].pos = unit:getPoint()
  end

  -- Critical unit tracking: find the tracking radar by DCS type name
  if sysData.trackRadar then
    local units = grp:getUnits()
    if units then
      for _, u in ipairs(units) do
        if u:getTypeName() == sysData.trackRadar then
          self.samSites[groupName].trackRadarUnit = u:getName()
          break
        end
      end
      if not self.samSites[groupName].trackRadarUnit then
        self:_Log("  WARNING: " .. groupName .. " has no " .. sysData.trackRadar
                  .. " unit (critical unit tracking disabled)", true)
      end
    end
  end

  local logMsg = "  SAM: " .. groupName .. " [" .. sysType .. " " .. sysData.cat .. "]"
  if zoneOverride then
    logMsg = logMsg .. " " .. zoneOverride
    if rangeOverride then logMsg = logMsg .. " " .. rangeOverride .. "NM" end
  end
  if actOverride then
    logMsg = logMsg .. " ACT" .. actOverride .. "NM"
  end
  if self.samSites[groupName].trackRadarUnit then
    logMsg = logMsg .. " (TR: " .. self.samSites[groupName].trackRadarUnit .. ")"
  end
  if self.samSites[groupName].pos then
    local p = self.samSites[groupName].pos
    logMsg = logMsg .. string.format(" @(%.0f, %.0f)", p.x, p.z)
  end
  self:_Log(logMsg)
end

function AEGIS:_RegisterPD(groupName, parentName)
  if self.pdSites[groupName] then return end
  local grp = Group.getByName(groupName)
  if not grp then self:_Log("PD not found: " .. groupName, true); return end
  
  local sysType = groupName:match("^PD%-([%w]+)%-") or "UNKNOWN"
  local sysData = AEGIS.SYSTEM_DB[sysType:upper()] or AEGIS.SYSTEM_DB.UNKNOWN
  
  self.pdSites[groupName] = {
    name = groupName,
    sysType = sysType,
    sysData = sysData,
    parent = parentName,  -- nil = auto-associate at init
    state = AEGIS.STATE.DARK,
    pos = nil,
  }
  
  local unit = grp:getUnit(1)
  if unit then
    self.pdSites[groupName].pos = unit:getPoint()
  end
  
  self:_Log("  PD: " .. groupName .. " [" .. sysType .. "]" 
            .. (parentName and (" -> " .. parentName) or " (parent pending)"))
end

function AEGIS:_RegisterPower(groupName, targetHint)
  if self.powerSources[groupName] then return end
  -- Cache position for display
  local pos = nil
  local grp = Group.getByName(groupName)
  if grp and grp:isExist() then
    local u = grp:getUnit(1); if u then pos = u:getPoint() end
  else
    local s = StaticObject.getByName(groupName)
    if s and s:isExist() then pos = s:getPoint() end
  end
  self.powerSources[groupName] = {
    name = groupName, targetHint = targetHint, alive = true,
    pos = pos, linkedTo = {},
  }
  self:_Log("  PWR: " .. groupName .. " (target hint: " .. targetHint .. ")")
end

function AEGIS:_RegisterCommand(groupName, sectorName)
  if self.commandCenters[groupName] then return end
  self.commandCenters[groupName] = {
    name = groupName, sector = sectorName, alive = true,
  }
  self:_EnsureSector(sectorName)
  table.insert(self.sectors[sectorName].cmd, groupName)
  self:_Log("  CMD: " .. groupName .. " -> " .. sectorName)
end

function AEGIS:_RegisterJammer(groupName, jamType, playerControlled)
  if self.jammers[groupName] then return end
  local grp = Group.getByName(groupName)
  if not grp then self:_Log("Jammer not found: " .. groupName, true); return end

  local dbKey = jamType:upper()
  local dbEntry = AEGIS.JAMMER_DB[dbKey] or AEGIS.JAMMER_DB.UNKNOWN
  local mult = dbEntry.mult or 0.5

  local pos = nil
  local heading = 0
  local unit = grp:getUnit(1)
  if unit then
    local p3 = unit:getPosition()
    if p3 then
      pos = p3.p
      heading = math.atan2(p3.x.z, p3.x.x)  -- forward vector → heading (radians)
    else
      pos = unit:getPoint()
    end
  end

  self.jammers[groupName] = {
    name = groupName,
    jamType = dbKey,
    mult = mult,
    pos = pos,
    heading = heading,
    alive = true,
    active = not playerControlled,   -- AI starts on, players start off (F10 toggle)
    playerControlled = playerControlled,
    -- Pod management
    mode = playerControlled and "OFF" or "OMNI",  -- OMNI | WIDE | DIR2 | OFF
    wideGain = nil,              -- per-jammer WIDE gain (nil = use baseline)
    wideHalfAngleRad = nil,      -- per-jammer WIDE cone (nil = use baseline)
    widePreset = "W70",          -- current WIDE preset label
    bearingLocked = false,       -- true = omni spray locked to fixed bearing
    lockedBearing = 0,           -- radians: fixed bearing for locked omni spray
    magDeclination = nil,        -- degrees: true-minus-mag offset (nil = uncalibrated)
    pod1Target = nil,            -- group name of directional pod 1 target (nil = unassigned)
    pod2Target = nil,            -- group name of directional pod 2 target (nil = unassigned)
    -- Player interaction
    groupId = grp:getID(),
    knownEmitters = {},          -- { groupName = {distSq, isEW, sysType} } — for ESM display
    menuRoot = nil,              -- F10 menu root handle
    menuRefreshScheduled = false, -- prevents duplicate 30s refresh timers
    statusActive = false,          -- persistent status display toggle
  }
  -- Map unit IDs to group name for slot-based copilot/WSO lookup
  local units = grp:getUnits()
  if units then
    for _, u in ipairs(units) do
      local uid = tostring(u:getID())
      self.eaUnitMap[uid] = groupName
    end
  end

  self:_Log("  EA: " .. groupName .. " [" .. dbKey .. " x" .. mult .. "] "
            .. (playerControlled and "PLAYER (off until F10)" or "AI OMNI")
            .. " range=" .. self.jammerBaseline.effectRange .. "NM")
end

function AEGIS:_EnsureSector(name)
  if not self.sectors[name] then
    self.sectors[name] = { ew={}, sams={}, pds={}, cmd={}, jammed=false, jamBearing=0 }
  end
end

---------------------------------------------------------------------------
-- AUTO-ASSOCIATION
---------------------------------------------------------------------------

function AEGIS:_AutoAssociateSAMs()
  self:_Log("Associating SAMs to EW...")
  local ewPos = {}
  for ewName, n in pairs(self.ewRadars) do
    local grp = Group.getByName(ewName)
    if grp and grp:isExist() then
      local u = grp:getUnit(1)
      if u then ewPos[ewName] = { pos=u:getPoint(), sector=n.sector } end
    end
  end
  
  local threshold = self.autoAssocRange * AEGIS.NM_TO_M
  
  for samName, n in pairs(self.samSites) do
    local explicit = self.explicitSectors[samName]
    if explicit then
      n.sector = explicit
      self:_EnsureSector(explicit)
      table.insert(self.sectors[explicit].sams, samName)
      self:_Log("  " .. samName .. " -> " .. explicit .. " (explicit)")
    elseif n.pos then
      local best, bestDist = nil, math.huge
      for _, ew in pairs(ewPos) do
        local d = self:_Dist(n.pos, ew.pos)
        if d < bestDist then bestDist = d; best = ew end
      end
      if best and bestDist <= threshold then
        n.sector = best.sector
        self:_EnsureSector(best.sector)
        table.insert(self.sectors[best.sector].sams, samName)
        self:_Log("  " .. samName .. " -> " .. best.sector 
                  .. " (" .. math.floor(bestDist/AEGIS.NM_TO_M) .. " NM)")
      else
        n.sector = "_AUTO"
        self:_EnsureSector("_AUTO")
        table.insert(self.sectors["_AUTO"].sams, samName)
        self:_Log("  " .. samName .. " -> AUTONOMOUS")
      end
    end
  end
end

function AEGIS:_AutoAssociatePDs()
  self:_Log("Associating PD to parents...")
  local threshold = self.pdAssocRange * AEGIS.NM_TO_M
  
  for pdName, pd in pairs(self.pdSites) do
    if pd.parent then
      self:_Log("  " .. pdName .. " -> " .. pd.parent .. " (explicit)")
      -- Add to parent's sector
      local parentNode = self.samSites[pd.parent]
      if parentNode and parentNode.sector then
        pd.sector = parentNode.sector
        self:_EnsureSector(parentNode.sector)
        table.insert(self.sectors[parentNode.sector].pds, pdName)
      end
    elseif pd.pos then
      -- Find nearest AREA SAM
      local best, bestDist, bestSector = nil, math.huge, nil
      for samName, sam in pairs(self.samSites) do
        if sam.sysData.cat == "AREA" and sam.pos then
          local d = self:_Dist(pd.pos, sam.pos)
          if d < bestDist then
            bestDist = d; best = samName; bestSector = sam.sector
          end
        end
      end
      -- Also check EW radars as potential parents
      for ewName, ew in pairs(self.ewRadars) do
        local grp = Group.getByName(ewName)
        if grp and grp:isExist() then
          local u = grp:getUnit(1)
          if u then
            local d = self:_Dist(pd.pos, u:getPoint())
            if d < bestDist then
              bestDist = d; best = ewName; bestSector = ew.sector
            end
          end
        end
      end
      
      if best and bestDist <= threshold then
        pd.parent = best
        if bestSector then
          pd.sector = bestSector
          self:_EnsureSector(bestSector)
          table.insert(self.sectors[bestSector].pds, pdName)
        end
        self:_Log("  " .. pdName .. " -> " .. best 
                  .. " (" .. math.floor(bestDist/AEGIS.NM_TO_M*10)/10 .. " NM)")
      else
        self:_Log("  " .. pdName .. " -> NO PARENT (too far)", true)
      end
    end
  end
end

---------------------------------------------------------------------------
-- AUTO-LINK POWER
---------------------------------------------------------------------------

--- Auto-link PWR groups to target nodes by naming convention.
--- PWR-SA5-SOUTH-1 -> links to SAM-SA5-SOUTH-1
--- PWR-EW-NORTH    -> links to EW-NORTH
--- Also supports manual LinkPower() calls made before Activate().
function AEGIS:_AutoLinkPower()
  self:_Log("Linking power sources...")
  
  for pwrName, pwr in pairs(self.powerSources) do
    -- Skip if already manually linked
    if #pwr.linkedTo > 0 then
      for _, t in ipairs(pwr.linkedTo) do
        self:_Log("  " .. pwrName .. " -> " .. t .. " (explicit)")
      end
    else
      local hint = pwr.targetHint
      local linked = false
      
      -- Try SAM-{hint} first (most common: PWR-SA5-SOUTH-1 -> SAM-SA5-SOUTH-1)
      local samTarget = "SAM-" .. hint
      if self.samSites[samTarget] then
        self.samSites[samTarget].powerSource = pwrName
        table.insert(pwr.linkedTo, samTarget)
        self:_Log("  " .. pwrName .. " -> " .. samTarget .. " (by name)")
        linked = true
      end
      
      -- Try hint directly (for EW: PWR-EW-NORTH -> EW-NORTH)
      if not linked and self.ewRadars[hint] then
        self.ewRadars[hint].powerSource = pwrName
        table.insert(pwr.linkedTo, hint)
        self:_Log("  " .. pwrName .. " -> " .. hint .. " (by name)")
        linked = true
      end
      
      if not linked then
        self:_Log("  WARNING: " .. pwrName .. " -> no matching node found for '" .. hint .. "'", true)
      end
    end
  end
  
  -- Warn about needsPower nodes with no power source
  for samName, sam in pairs(self.samSites) do
    if sam.sysData.needsPower and not sam.powerSource then
      self:_Log("  WARNING: " .. samName .. " needs power but has no PWR linked!", true)
    end
  end
end

---------------------------------------------------------------------------
-- INITIAL STATE
---------------------------------------------------------------------------

function AEGIS:_SetInitialState()
  for name, sam in pairs(self.samSites) do
    self:_ApplyState(name, "sam", AEGIS.STATE.DARK)
    
    -- SAMs with no network support start EMCON cycling immediately
    local sector = sam.sector
    if sector == "_AUTO" then
      self:_Log(name .. ": autonomous, starting EMCON")
      self:_StartEMCON(name)
    elseif sector then
      local hasEW = self:_SectorHasEW(sector)
      local hasC2 = self:_SectorHasC2(sector)
      if not hasEW or not hasC2 then
        self:_Log(name .. ": sector " .. sector .. " missing EW/C2, starting EMCON")
        self:_StartEMCON(name)
      end
    end
  end
  for name, _ in pairs(self.pdSites) do
    self:_ApplyState(name, "pd", AEGIS.STATE.DARK)
  end
end

---------------------------------------------------------------------------
-- STATE APPLICATION (single point for DCS commands)
---------------------------------------------------------------------------

function AEGIS:_ApplyState(groupName, nodeType, newState)
  local node
  if nodeType == "sam" then node = self.samSites[groupName]
  elseif nodeType == "pd" then node = self.pdSites[groupName]
  else return end
  
  if not node then return end
  if node.state == newState then return end
  if node.state == AEGIS.STATE.DESTROYED then return end
  
  local old = node.state
  node.state = newState
  
  local grp = Group.getByName(groupName)
  if not grp or not grp:isExist() then
    node.state = AEGIS.STATE.DESTROYED
    return
  end
  
  local ctrl = grp:getController()
  
  -- ALARM_STATE stays RED at all times. This keeps DCS AI "combat ready"
  -- internally so there's no radar warm-up delay when emissions come on.
  -- We control behavior solely via enableEmission() and ROE.
  ctrl:setOption(AI.Option.Ground.id.ALARM_STATE, AEGIS.ALARM.RED)
  
  if newState == AEGIS.STATE.DARK or newState == AEGIS.STATE.AWARE then
    grp:enableEmission(false)
    ctrl:setOption(AI.Option.Ground.id.ROE, AEGIS.ROE.WEAPON_HOLD)
    
  elseif newState == AEGIS.STATE.ALERT then
    grp:enableEmission(true)
    ctrl:setOption(AI.Option.Ground.id.ROE, AEGIS.ROE.WEAPON_FREE)
    
  elseif newState == AEGIS.STATE.EMCON_ON then
    grp:enableEmission(false)
    ctrl:setOption(AI.Option.Ground.id.ROE, AEGIS.ROE.WEAPON_HOLD)
    
  elseif newState == AEGIS.STATE.EMCON_OFF then
    grp:enableEmission(true)
    ctrl:setOption(AI.Option.Ground.id.ROE, AEGIS.ROE.WEAPON_HOLD)
    
  elseif newState == AEGIS.STATE.EMCON_ENGAGED then
    grp:enableEmission(true)
    ctrl:setOption(AI.Option.Ground.id.ROE, AEGIS.ROE.WEAPON_FREE)
  end
  
  self:_Log(groupName .. ": " .. (old or "NEW") .. " -> " .. newState)
end

---------------------------------------------------------------------------
-- EW POLLING + WEZ GATING (Phase 1 core loop)
---------------------------------------------------------------------------

function AEGIS:_StartEWPoll()
  -- Build ordered sector list (exclude _AUTO which has no EWs)
  self.sectorPollOrder = {}
  for name, sector in pairs(self.sectors) do
    if name ~= "_AUTO" and #sector.ew > 0 then
      table.insert(self.sectorPollOrder, name)
    end
  end
  table.sort(self.sectorPollOrder)  -- deterministic order
  self.sectorPollIndex = 0
  self.jammerPollCounter = 0

  local numSectors = math.max(#self.sectorPollOrder, 1)
  local subInterval = self.ewPollInterval / numSectors

  local aegis = self
  local function poll()
    local ok, err = pcall(aegis._PollNextSector, aegis)
    if not ok then
      aegis:_Warn("EW poll error (recovering): " .. tostring(err))
    end
    return timer.getTime() + subInterval
  end
  timer.scheduleFunction(poll, nil, timer.getTime() + 5)
  self:_Log("EW poll started (every " .. self.ewPollInterval .. "s, "
            .. #self.sectorPollOrder .. " sectors, sub-interval "
            .. string.format("%.1f", subInterval) .. "s)")
end

function AEGIS:_PollNextSector()
  local now = timer.getTime()
  local numSectors = #self.sectorPollOrder
  if numSectors == 0 then return end

  -- Advance round-robin index (1-based, wraps)
  self.sectorPollIndex = self.sectorPollIndex + 1
  if self.sectorPollIndex > numSectors then
    self.sectorPollIndex = 1
  end
  local sectorName = self.sectorPollOrder[self.sectorPollIndex]
  local sector = self.sectors[sectorName]
  if not sector then return end

  -- Jammer position refresh: once per full rotation (DCS API call)
  -- Emitter scan: every sub-cycle (~1.4s) for near-real-time WSO alerts
  self.jammerPollCounter = self.jammerPollCounter + 1
  local fullRotation = (self.jammerPollCounter >= numSectors)
  if fullRotation then
    self.jammerPollCounter = 0
    if self.eaEnabled then
      self:_UpdateJammerPositions()
    end
  end
  if self.eaEnabled then
    self:_ScanJammerEmitters()
  end

  local pollStart
  if self.debug then pollStart = timer.getTime() end

  -- Gather contacts from this sector's EW radars only
  local contacts = {}
  local contactCount = 0
  local sectorJammed = false
  local sectorJamBearing = 0
  local sectorJamPies = {}

  for _, ewName in ipairs(sector.ew) do
    local ew = self.ewRadars[ewName]
    if ew and ew.state ~= AEGIS.STATE.DESTROYED then
      local grp = Group.getByName(ewName)
      if not grp or not grp:isExist() or grp:getSize() == 0 then
        ew.state = AEGIS.STATE.DESTROYED
        self:_Log(ewName .. ": EW destroyed/despawned")
      elseif self:_NodeHasPower(ew) then
        -- EA contact filtering: compute jam effects on this EW before processing contacts
        local ewJamEffects = {}
        local ewJamBearing = 0
        if self.eaEnabled then
          ewJamEffects, ewJamBearing = self:_GetEWJamState(ew)
          if #ewJamEffects > 0 then
            if self.debug then
              local brgDeg = math.floor(math.deg(ewJamBearing) + 0.5) % 360
              self:_Log(ewName .. ": EW jam effects (" .. #ewJamEffects
                        .. " effects, BRG " .. brgDeg .. ")")
            end
            -- Accumulate pie geometry for on-axis SAM check
            -- (sectorJammed set later, only when a contact is actually masked)
            if ew.pos then
              for _, eff in ipairs(ewJamEffects) do
                table.insert(sectorJamPies, {
                  ewX = ew.pos.x,
                  ewZ = ew.pos.z,
                  jdx = math.cos(eff.bearingToJammer),
                  jdz = math.sin(eff.bearingToJammer),
                  cosHalf = math.cos(eff.pieHalfWidth),
                })
              end
            end
            sectorJamBearing = ewJamBearing
          end
        end

        local ctrl = grp:getController()
        if not ctrl then
          ew.state = AEGIS.STATE.DESTROYED
          self:_Warn(ewName .. ": EW has no controller (despawned?)")
        else
        local detected = ctrl:getDetectedTargets(Controller.Detection.RADAR)

        if detected and #detected > 0 then
          local addedAny = false
          for _, det in ipairs(detected) do
            if det.object and det.object:isExist() then
              local validContact = true

              -- Filter out weapons in flight (bombs, missiles) but allow decoys
              local catOk, objCat = pcall(det.object.getCategory, det.object)
              if catOk and objCat == 2 then  -- Weapon object
                -- Only allow decoys through (TALD: missileCategory=6, guidance=1)
                validContact = false
                local descOk, desc = pcall(det.object.getDesc, det.object)
                if descOk and desc and desc.missileCategory == 6 and desc.guidance == 1 then
                  validContact = true  -- Decoy, let it fool the radar
                end
              end

              if validContact then
                local pos = det.object:getPoint()
                if pos then
                  -- EW detection range cap (0 = unlimited)
                  if ew.detRangeSq > 0 and ew.pos then
                    local dx = ew.pos.x - pos.x
                    local dz = ew.pos.z - pos.z
                    if (dx*dx + dz*dz) > ew.detRangeSq then
                      pos = nil
                    end
                  end
                  -- EA jam zone filter: contact inside jam pie + beyond burn-through = masked
                  if pos and #ewJamEffects > 0 then
                    if self:_IsContactJammed(ew, pos, ewJamEffects) then
                      if self.debug then
                        self:_Log(ewName .. ": contact MASKED by EA (jam zone filter)")
                      end
                      pos = nil
                      sectorJammed = true  -- observable: jamming actually ate a contact
                    end
                  end
                  if pos then
                    table.insert(contacts, {
                      pos = pos,
                      alt = pos.y / AEGIS.FT_TO_M,
                    })
                    contactCount = contactCount + 1
                    addedAny = true
                  end
                end
              end
            end
          end

          -- Only flag contacts after filtering (DCS sees beyond our cap)
          if addedAny then
            if not ew.hasContacts then
              self:_Log(ewName .. ": contacts acquired (" .. ew.sector .. ")")
            end
            ew.hasContacts = true
            ew.lastContact = now
          elseif ew.hasContacts and (now - ew.lastContact) > self.alertTimeout then
            self:_Log(ewName .. ": contacts lost (" .. ew.sector .. ")")
            ew.hasContacts = false
          end
        else
          if ew.hasContacts and (now - ew.lastContact) > self.alertTimeout then
            self:_Log(ewName .. ": contacts lost (" .. ew.sector .. ")")
            ew.hasContacts = false
          end
        end
      end -- ctrl check
      end
    end
  end

  -- Sector jam awareness (C2 path): EW detected jamming → warn sector SAMs
  if self.eaEnabled then
    sector.jammed = sectorJammed
    sector.jamBearing = sectorJamBearing
  end

  -- WEZ checks for this sector's SAMs
  local hasC2 = self:_SectorHasC2(sectorName)
  local hasEW = self:_SectorHasEW(sectorName)
  local sectorContacts = (contactCount > 0) and contacts or nil

  for _, samName in ipairs(sector.sams) do
    local sam = self.samSites[samName]
    if sam and sam.state ~= AEGIS.STATE.DESTROYED then
      -- Per-node power check: no power = permanently dark
      if not self:_NodeHasPower(sam) then
        if sam.state ~= AEGIS.STATE.DARK then
          self:_StopEMCON(samName)
          self:_ApplyState(samName, "sam", AEGIS.STATE.DARK)
        end
      else
      -- Has power: normal operations
      -- HARM cooldown: SAM is hiding from a HARM, do not change state
      if sam.harmCooldownUntil > now then
        -- Skip all state logic while dodging HARM
      -- Jammed EMCON: jammer controls this SAM's cycling, poll hands off
      elseif sam.jammedEmconActive then
        -- Skip state logic — jammed EMCON timer chain owns state transitions
      else
      -- If in EMCON states, EMCON system handles this SAM
      local inEmcon = (sam.state == AEGIS.STATE.EMCON_ON
         or sam.state == AEGIS.STATE.EMCON_OFF
         or sam.state == AEGIS.STATE.EMCON_ENGAGED)

      if not inEmcon then
        if not hasEW or not hasC2 then
          -- Lost EW or C2 (or both): enter EMCON
          self:_StartEMCON(samName)
        elseif self.eaEnabled and sectorJammed and not sectorContacts
               and (sam.state == AEGIS.STATE.DARK or sam.state == AEGIS.STATE.AWARE) then
          -- Sector fully jammed, zero contacts: EW network blinded, C2 warns all SAMs
          -- On-axis SAMs (within jam pie cone) get aggressive jammed EMCON — they're in the threat axis
          -- Off-axis SAMs get normal EMCON — network degraded but no immediate threat
          local actNM = self:_GetActRange(sam)
          if self:_JammerOnAxis(sam, actNM, sectorJamPies) then
            self:_Log(samName .. ": sector JAMMED, threat axis (jammed EMCON)")
            self:_StartJammedEMCON(samName)
          end
          -- off-axis: EW has clean coverage in SAM's direction, stay on network
        else
          -- Full network: check activation range
          if sectorContacts then
            local inRange, nearestDist, actRange = self:_CheckActivation(sam, sectorContacts)
            local inWEZ = self:_CheckWEZ(sam, sectorContacts)

            -- For ALERT SAMs: check full WEZ (ambush sprung, use full capability)
            -- Non-NEZ SAMs: _CheckFullWEZ == _CheckWEZ, zero behavior change
            local inFullWEZ = false
            if sam.state == AEGIS.STATE.ALERT then
              inFullWEZ = self:_CheckFullWEZ(sam, sectorContacts)
            end

            -- Frustration uses full WEZ for ALERT SAMs, zone-aware WEZ otherwise
            local wezForFrustration = (sam.state == AEGIS.STATE.ALERT) and inFullWEZ or inWEZ

            if inRange or (sam.state == AEGIS.STATE.ALERT and inFullWEZ) then
              -- Either in actRange (wake up), or ALERT with full-WEZ contacts (stay hot)

              -- Frustration cooldown: crew just powered down, won't re-alert
              -- unless a real threat enters the WEZ
              if sam.frustrationCooldownUntil > now and not wezForFrustration then
                sam.lastContactTime = now
                -- Stay AWARE — crew is ignoring the orbiting contact
              else
                -- WEZ contact breaks frustration cooldown
                if wezForFrustration and sam.frustrationCooldownUntil > now then
                  self:_Log(samName .. ": WEZ contact — breaking frustration cooldown")
                  sam.frustrationCooldownUntil = 0
                end

                sam.lastContactTime = now
                self:_ApplyState(samName, "sam", AEGIS.STATE.ALERT)
                -- Own-radar HARM detection: SAM just went hot, radar paints the HARM
                self:_TriggerHarmInboundReaction(samName)

                -- Alert frustration: ALERT but nothing in the WEZ?
                if wezForFrustration then
                  sam.alertWithoutWezSince = 0  -- real threat in WEZ, reset
                elseif sam.alertWithoutWezSince == 0 then
                  -- First poll ALERT with no WEZ contact: start frustration clock
                  sam.alertWithoutWezSince = now
                  sam.alertFrustrationTimeout = math.random(self.alertFrustrationMin, self.alertFrustrationMax)
                elseif (now - sam.alertWithoutWezSince) >= sam.alertFrustrationTimeout then
                  -- Timeout: crew decides to stay hot or power down
                  if math.random(1, 100) <= self.alertFrustrationStayPct then
                    sam.alertWithoutWezSince = now
                    sam.alertFrustrationTimeout = math.random(self.alertFrustrationMin, self.alertFrustrationMax)
                    self:_Log(samName .. ": alert frustration — crew stays hot (rolled stay)")
                  else
                    local cooldown = math.random(self.alertFrustrationMin, self.alertFrustrationMax)
                    self:_Log(samName .. ": alert frustration — powering down (no WEZ contact for "
                              .. math.floor(now - sam.alertWithoutWezSince) .. "s, cooldown " .. cooldown .. "s)")
                    sam.alertWithoutWezSince = 0
                    sam.frustrationCooldownUntil = now + cooldown
                    self:_ApplyState(samName, "sam", AEGIS.STATE.AWARE)
                  end
                end
              end
            else
              -- Outside actRange AND (not ALERT or nothing in full WEZ)
              sam.alertWithoutWezSince = 0
              if self.debug and nearestDist then
                self:_Log(string.format("%s: nearest contact %.1f NM (actRange %.0f NM)",
                  samName, nearestDist, actRange))
              end
              -- Sector jammed but clean contacts elsewhere: this SAM has no contacts
              -- in its own actRange. On-axis SAMs (within jam pie cone) go jammed EMCON.
              -- Off-axis SAMs stay on the network — EW feed still has clean contacts.
              if self.eaEnabled and sectorJammed then
                local actNM = self:_GetActRange(sam)
                if self:_JammerOnAxis(sam, actNM, sectorJamPies) then
                  self:_Log(samName .. ": sector JAMMED, threat axis (jammed EMCON)")
                  self:_StartJammedEMCON(samName)
                elseif sam.state == AEGIS.STATE.ALERT then
                  self:_ApplyState(samName, "sam", AEGIS.STATE.AWARE)
                elseif sam.state == AEGIS.STATE.DARK then
                  self:_ApplyState(samName, "sam", AEGIS.STATE.AWARE)
                end
              elseif sam.state == AEGIS.STATE.ALERT then
                self:_ApplyState(samName, "sam", AEGIS.STATE.AWARE)
              elseif sam.state == AEGIS.STATE.DARK then
                self:_ApplyState(samName, "sam", AEGIS.STATE.AWARE)
              end
            end
          else
            sam.alertWithoutWezSince = 0
            if sam.state == AEGIS.STATE.ALERT
               and (now - sam.lastContactTime) > self.alertTimeout then
              self:_ApplyState(samName, "sam", AEGIS.STATE.DARK)
            elseif sam.state == AEGIS.STATE.AWARE then
              self:_ApplyState(samName, "sam", AEGIS.STATE.DARK)
            end
          end
        end
      end
      end -- harm cooldown
      end -- node has power

      -- EA jammer effect: jammed EMCON cycling
      -- Jammer is reactive — only affects SAMs that are emitting
      if self.eaEnabled then
        if self:_IsEmitting(sam) and not sam.jammedEmconActive then
          local jammed = self:_IsJammed(sam)
          if jammed then
            -- SAM is emitting + jammed + not already in jammed EMCON
            -- Schedule jam detection delay before crew shuts down
            local delay = math.random(self.jamDetectionDelayMin, self.jamDetectionDelayMax)
            local aegis = self
            local sn = samName
            timer.scheduleFunction(function()
              local s = aegis.samSites[sn]
              if not s or s.state == AEGIS.STATE.DESTROYED then return nil end
              if s.harmCooldownUntil > timer.getTime() then return nil end
              aegis:_StartJammedEMCON(sn)
              return nil
            end, nil, timer.getTime() + delay)
          end
        elseif sam.jammedEmconActive then
          -- In jammed EMCON: check if jammer left (during off-phase)
          local stillJammed = self:_IsJammed(sam)
          if not stillJammed then
            self:_StopJammedEMCON(samName)
            self:_Log(samName .. ": jammer gone (poll), exiting jammed EMCON")
          end
        else
          -- Not emitting and not in jammed EMCON: clear visual flag
          if sam.jammed then
            sam.jammed = false
          end
        end
      end
    end
  end

  -- PD slaving: mirror parent state (with HARM cooldown guard)
  for _, pdName in ipairs(sector.pds) do
    local pd = self.pdSites[pdName]
    if pd and pd.state ~= AEGIS.STATE.DESTROYED and pd.parent then
      local parentSam = self.samSites[pd.parent]
      local parentEw = self.ewRadars[pd.parent]

      -- If parent SAM is in active HARM cooldown, PD stays ALERT for defense
      if parentSam and parentSam.harmCooldownUntil and now < parentSam.harmCooldownUntil then
        if pd.state ~= AEGIS.STATE.ALERT then
          self:_ApplyState(pdName, "pd", AEGIS.STATE.ALERT)
        end
      else
        -- Normal slaving
        local parentState = AEGIS.STATE.DARK
        if parentSam then
          parentState = parentSam.state
        elseif parentEw then
          parentState = parentEw.hasContacts and AEGIS.STATE.ALERT or AEGIS.STATE.DARK
        end

        if parentState == AEGIS.STATE.ALERT
           or parentState == AEGIS.STATE.EMCON_ENGAGED then
          self:_ApplyState(pdName, "pd", AEGIS.STATE.ALERT)
        else
          self:_ApplyState(pdName, "pd", AEGIS.STATE.DARK)
        end
      end
    end
  end

  -- _AUTO sector: process autonomous SAMs once per full rotation
  -- (autonomous SAMs are managed by EMCON timers — poll just handles EA checks)
  if fullRotation then
    local autoSector = self.sectors["_AUTO"]
    if autoSector then
      for _, samName in ipairs(autoSector.sams) do
        local sam = self.samSites[samName]
        if sam and sam.state ~= AEGIS.STATE.DESTROYED and self.eaEnabled then
          if self:_IsEmitting(sam) and not sam.jammedEmconActive then
            local jammed = self:_IsJammed(sam)
            if jammed then
              local delay = math.random(self.jamDetectionDelayMin, self.jamDetectionDelayMax)
              local aegis = self
              local sn = samName
              timer.scheduleFunction(function()
                local s = aegis.samSites[sn]
                if not s or s.state == AEGIS.STATE.DESTROYED then return nil end
                if s.harmCooldownUntil > timer.getTime() then return nil end
                aegis:_StartJammedEMCON(sn)
                return nil
              end, nil, timer.getTime() + delay)
            end
          elseif sam.jammedEmconActive then
            local stillJammed = self:_IsJammed(sam)
            if not stillJammed then
              self:_StopJammedEMCON(samName)
              self:_Log(samName .. ": jammer gone (poll), exiting jammed EMCON")
            end
          else
            if sam.jammed then
              sam.jammed = false
            end
          end
        end
      end
    end
  end

  -- Performance instrumentation (debug only)
  if self.debug and pollStart then
    local elapsed = (timer.getTime() - pollStart) * 1000
    if elapsed > 1 then  -- only log if >1ms (skip noise)
      self:_Log(string.format("PERF: %s poll %.1fms (%d contacts)", sectorName, elapsed, contactCount))
    end
  end
end

---------------------------------------------------------------------------
-- WEZ CHECK
---------------------------------------------------------------------------

--- Check if any contact is within this SAM's engagement zone and altitude band.
-- Respects per-site range overrides from naming convention or API.
-- Uses squared distance to avoid sqrt.
-- @return #boolean true if at least one contact is in the zone
function AEGIS:_CheckWEZ(sam, contacts)
  if not sam.pos or not sam.sysData then return false end
  
  local zone = self.siteZoneOverrides[sam.name] or self.defaultZone
  local siteRange = self.siteRangeOverrides[sam.name]
  local rangeNM
  
  if zone == "NEZ" then
    rangeNM = (siteRange and siteRange.nez) or sam.sysData.nez
  else
    rangeNM = (siteRange and siteRange.wez) or sam.sysData.wez
  end
  
  local rangeM = rangeNM * AEGIS.NM_TO_M
  local rangeSq = rangeM * rangeM
  local altMin = sam.sysData.altMin  -- feet
  local altMax = sam.sysData.altMax  -- feet
  
  for _, contact in ipairs(contacts) do
    -- Altitude check
    if contact.alt >= altMin and contact.alt <= altMax then
      -- Range check (2D horizontal, squared -- no sqrt needed)
      local dx = sam.pos.x - contact.pos.x
      local dz = sam.pos.z - contact.pos.z
      local horizDistSq = dx*dx + dz*dz
      if horizDistSq <= rangeSq then
        return true
      end
    end
  end
  
  return false
end

--- Check if any contact is within this SAM's full (system-rated) WEZ.
-- Ignores zone overrides (NEZ/WEZ) — always uses sysData.wez.
-- Used for frustration gating on ALERT SAMs: once the ambush is sprung,
-- the SAM fights with its full capability, not the restricted NEZ.
-- @return #boolean true if at least one contact is in the full WEZ
function AEGIS:_CheckFullWEZ(sam, contacts)
  if not sam.pos or not sam.sysData then return false end
  local rangeNM = sam.sysData.wez
  local rangeM = rangeNM * AEGIS.NM_TO_M
  local rangeSq = rangeM * rangeM
  local altMin = sam.sysData.altMin
  local altMax = sam.sysData.altMax
  for _, contact in ipairs(contacts) do
    if contact.alt >= altMin and contact.alt <= altMax then
      local dx = sam.pos.x - contact.pos.x
      local dz = sam.pos.z - contact.pos.z
      local horizDistSq = dx*dx + dz*dz
      if horizDistSq <= rangeSq then
        return true
      end
    end
  end
  return false
end

--- Compute the effective activation range for a SAM in NM.
-- ACT suffix always wins. Otherwise, derive from active zone + system margin.
-- Margin = sysData.actRange - sysData.wez (the DCS AI lead time baked into each system).
-- NEZ/WEZ override shifts the engagement zone; margin preserves the same lead time.
function AEGIS:_GetActRange(sam)
  local actNM = self.siteActRangeOverrides[sam.name]
  if not actNM then
    local zone = self.siteZoneOverrides[sam.name] or self.defaultZone
    local siteRange = self.siteRangeOverrides[sam.name]
    local margin = (sam.sysData.actRange or sam.sysData.wez) - sam.sysData.wez
    if zone == "NEZ" then
      local nez = (siteRange and siteRange.nez) or sam.sysData.nez
      actNM = nez + margin
    else
      local wez = (siteRange and siteRange.wez) or sam.sysData.wez
      actNM = wez + margin
    end
  end
  return actNM
end

--- Check if any active jammer is within a given range of a SAM.
-- Used for per-SAM jammer proximity gate (only SAMs near a jammer go autonomous).
--- Check if a SAM is on the jammer's threat axis: both within actRange of an
-- active jammer AND inside at least one EW jam pie cone. Two gates (AND):
-- distance gate ensures a jammer is physically nearby, bearing gate ensures
-- the SAM sits in the approach corridor the jammer is actually protecting.
-- @param sam SAM record (needs .pos)
-- @param rangeNM activation range in NM (distance gate radius)
-- @param jamPies array of {ewX, ewZ, jdx, jdz, cosHalf} from EW loop
-- @return true if SAM is on-axis (jammer nearby AND within any EW's jam pie)
function AEGIS:_JammerOnAxis(sam, rangeNM, jamPies)
  if not sam.pos or #jamPies == 0 then return false end
  -- Distance gate: any active jammer within actRange?
  local rangeSq = (rangeNM * AEGIS.NM_TO_M) ^ 2
  local jammerNearby = false
  local nearestJamNM
  for _, j in pairs(self.jammers) do
    if j.alive and j.active and j.pos then
      local dx = sam.pos.x - j.pos.x
      local dz = sam.pos.z - j.pos.z
      local dSq = dx*dx + dz*dz
      if dSq <= rangeSq then
        jammerNearby = true
        if not nearestJamNM then
          nearestJamNM = math.sqrt(dSq) / AEGIS.NM_TO_M
        end
        break
      elseif self.debug then
        local dNM = math.sqrt(dSq) / AEGIS.NM_TO_M
        if not nearestJamNM or dNM < nearestJamNM then nearestJamNM = dNM end
      end
    end
  end
  if not jammerNearby then
    if self.debug and nearestJamNM then
      self:_Log(string.format("%s: on-axis FAIL — distance gate (nearest jammer %.0f NM, actRange %.0f NM)",
        sam.name, nearestJamNM, rangeNM))
    end
    return false
  end
  -- Bearing gate: is SAM within NEAREST EW's jam pie?
  -- Uses nearest EW only — far EWs' pies can false-positive through multi-EW formations.
  local nearestPie = nil
  local nearestDistSq = math.huge
  for _, pie in ipairs(jamPies) do
    local ex = sam.pos.x - pie.ewX
    local ez = sam.pos.z - pie.ewZ
    local dSq = ex*ex + ez*ez
    if dSq < nearestDistSq then
      nearestDistSq = dSq
      nearestPie = pie
    end
  end

  if nearestPie then
    local sx = sam.pos.x - nearestPie.ewX
    local sz = sam.pos.z - nearestPie.ewZ
    local dist = math.sqrt(nearestDistSq)
    if dist > 0 then
      local dot = (sx * nearestPie.jdx + sz * nearestPie.jdz) / dist
      if dot >= nearestPie.cosHalf then
        if self.debug then
          local offDeg = math.deg(math.acos(math.min(dot, 1)))
          local halfDeg = math.deg(math.acos(nearestPie.cosHalf))
          self:_Log(string.format("%s: on-axis PASS — jammer %.0f NM, offset %.0f° (nearest EW pie ±%.0f°)",
            sam.name, nearestJamNM, offDeg, halfDeg))
        end
        return true
      end
      if self.debug then
        local offDeg = math.deg(math.acos(math.max(math.min(dot, 1), -1)))
        local halfDeg = math.deg(math.acos(nearestPie.cosHalf))
        self:_Log(string.format("%s: on-axis FAIL — bearing gate (offset %.0f°, nearest EW pie ±%.0f°)",
          sam.name, offDeg, halfDeg))
      end
    end
  end
  return false
end

--- Check if any contact is within this SAM's activation range.
-- Used in integrated mode to go ALERT (start tracking) before WEZ.
-- actRange > WEZ gives the DCS AI time to build a fire solution.
-- @return #boolean true if at least one contact is in activation range
-- @return #number nearestDistNM — distance to nearest alt-valid contact (nil if none)
-- @return #number actNM — effective activation range used
function AEGIS:_CheckActivation(sam, contacts)
  if not sam.pos or not sam.sysData then return false end

  local actNM = self:_GetActRange(sam)
  local rangeM = actNM * AEGIS.NM_TO_M
  local rangeSq = rangeM * rangeM
  local altMin = sam.sysData.altMin
  local altMax = sam.sysData.altMax
  local nearestSq = math.huge

  for _, contact in ipairs(contacts) do
    if contact.alt >= altMin and contact.alt <= altMax then
      local dx = sam.pos.x - contact.pos.x
      local dz = sam.pos.z - contact.pos.z
      local horizDistSq = dx*dx + dz*dz
      if horizDistSq <= rangeSq then
        return true, 0, actNM
      end
      if horizDistSq < nearestSq then
        nearestSq = horizDistSq
      end
    end
  end

  if nearestSq < math.huge then
    return false, math.sqrt(nearestSq) / AEGIS.NM_TO_M, actNM
  end
  return false
end
-- Converts getDetectedTargets() output to contact format for _CheckWEZ().
-- @return #boolean true if at least one detected target is in the WEZ
function AEGIS:_DetectedInWEZ(sam, detected)
  if not detected or #detected == 0 then return false end
  
  local contacts = {}
  for _, det in ipairs(detected) do
    if det.object and det.object:isExist() then
      local validContact = true
      
      -- Filter out weapons (bombs, missiles) but allow decoys
      local catOk, objCat = pcall(function() return det.object:getCategory() end)
      if catOk and objCat == 2 then
        validContact = false
        local descOk, desc = pcall(function() return det.object:getDesc() end)
        if descOk and desc and desc.missileCategory == 6 and desc.guidance == 1 then
          validContact = true  -- Decoy
        end
      end
      
      if validContact then
        local pos = det.object:getPoint()
        if pos then
          table.insert(contacts, {
            pos = pos,
            alt = pos.y / AEGIS.FT_TO_M,
          })
        end
      end
    end
  end
  
  return self:_CheckWEZ(sam, contacts)
end

---------------------------------------------------------------------------
-- EMCON CYCLING (Phase 2 core feature)
---------------------------------------------------------------------------

--- Start EMCON cycling for a SAM. Increments generation to invalidate
--- any pending timers from a previous EMCON cycle.
--- Adds random startup jitter so SAMs don't all start cycling in sync.
function AEGIS:_StartEMCON(samName)
  local sam = self.samSites[samName]
  if not sam then return end
  
  -- Already in EMCON?
  if sam.state == AEGIS.STATE.EMCON_ON 
     or sam.state == AEGIS.STATE.EMCON_OFF 
     or sam.state == AEGIS.STATE.EMCON_ENGAGED then
    return
  end
  
  sam.emconGen = sam.emconGen + 1
  sam.sweepsSinceDetect = 0
  sam.lastSweepHadContact = false
  
  -- Random startup delay so SAMs desynchronize immediately
  local jitter = math.random(0, self.emconStartupJitter)
  self:_Log(samName .. ": entering EMCON cycle (start delay " .. jitter .. "s)")
  
  local gen = sam.emconGen
  local aegis = self
  
  if jitter > 0 then
    self:_ApplyState(samName, "sam", AEGIS.STATE.EMCON_ON)  -- silent during jitter
    timer.scheduleFunction(function()
      if not sam or sam.emconGen ~= gen then return nil end
      aegis:_EmconSilentPhase(samName, gen)
    end, nil, timer.getTime() + jitter)
  else
    self:_EmconSilentPhase(samName, gen)
  end
end

--- Stop EMCON and return to normal network operation.
function AEGIS:_StopEMCON(samName)
  local sam = self.samSites[samName]
  if not sam then return end
  sam.emconGen = sam.emconGen + 1  -- invalidate pending timers
  self:_Log(samName .. ": leaving EMCON")
end

--- EMCON silent phase: emissions off for random duration, then sweep.
--- Duration scales based on threat memory and spook state.
function AEGIS:_EmconSilentPhase(samName, gen)
  local sam = self.samSites[samName]
  if not sam or sam.emconGen ~= gen then return end
  
  self:_ApplyState(samName, "sam", AEGIS.STATE.EMCON_ON)
  
  -- Base silent duration
  local minDur = self.emconOnMin
  local maxDur = self.emconOnMax
  
  -- Threat memory: recent contact = shorter silence (crew is anxious)
  if sam.lastSweepHadContact then
    minDur = math.floor(minDur * self.emconThreatScale)
    maxDur = math.floor(maxDur * self.emconThreatScale)
  -- Relaxed: 3+ empty sweeps = longer silence (crew thinks it's safe)
  elseif sam.sweepsSinceDetect >= 3 then
    minDur = math.floor(minDur * self.emconRelaxedScale)
    maxDur = math.floor(maxDur * self.emconRelaxedScale)
  end
  
  -- Spooked: nearby SAM was killed, crew goes extra quiet
  local now = timer.getTime()
  if self.emconSpookEnabled and sam.spooked and now < sam.spookedUntil then
    minDur = math.max(minDur, self.emconSpookDuration)
    maxDur = math.max(maxDur, self.emconSpookDuration + 60)
    self:_Log(samName .. ": SPOOKED, extended silence")
    sam.spooked = false  -- one extended cycle, then back to normal
  end
  
  -- Clamp min <= max
  if minDur > maxDur then maxDur = minDur end
  if minDur < 5 then minDur = 5 end
  
  local offDuration = math.random(minDur, maxDur)
  local aegis = self
  
  timer.scheduleFunction(function()
    if not sam or sam.emconGen ~= gen then return nil end
    if sam.state == AEGIS.STATE.DESTROYED then return nil end
    
    -- Check if we should still be in EMCON (maybe network was restored)
    local sector = sam.sector
    if sector and sector ~= "_AUTO" then
      if aegis:_SectorHasEW(sector) and aegis:_SectorHasC2(sector) 
         and aegis:_NodeHasPower(sam) then
        aegis:_StopEMCON(samName)
        aegis:_ApplyState(samName, "sam", AEGIS.STATE.DARK)
        return nil
      end
    end
    
    aegis:_EmconSweepPhase(samName, gen)
  end, nil, timer.getTime() + offDuration)
end

--- EMCON sweep phase: search radar on, weapon hold. After detect delay,
--- check for targets in WEZ. If found, break EMCON and engage.
--- May terminate early (quick peek) or double-sweep based on probability.
function AEGIS:_EmconSweepPhase(samName, gen)
  local sam = self.samSites[samName]
  if not sam or sam.emconGen ~= gen then return end

  self:_ApplyState(samName, "sam", AEGIS.STATE.EMCON_OFF)

  -- PB HARM inbound: SAM just turned radar on during EMCON sweep — check harmInbound
  if self:_TriggerHarmInboundReaction(samName) then return end

  -- Chance of early termination (quick peek: ~3-5 seconds then back to silent)
  local isQuickPeek = math.random(1, 100) <= self.emconEarlyTerm
  local onDuration
  if isQuickPeek then
    onDuration = math.random(3, 6)
    self:_Log(samName .. ": quick peek (" .. onDuration .. "s)")
  else
    onDuration = math.random(self.emconOffMin, self.emconOffMax)
  end
  
  local aegis = self
  
  -- After detect delay, check for targets
  timer.scheduleFunction(function()
    if not sam or sam.emconGen ~= gen then return nil end
    if sam.state ~= AEGIS.STATE.EMCON_OFF then return nil end
    
    local grp = Group.getByName(samName)
    if not grp or not grp:isExist() then
      sam.state = AEGIS.STATE.DESTROYED
      return nil
    end
    
    local ctrl = grp:getController()
    local detected = ctrl:getDetectedTargets(Controller.Detection.RADAR)
    
    if aegis:_DetectedInWEZ(sam, detected) then
      -- BREAK EMCON -- target in WEZ
      aegis:_Log(samName .. ": EMCON BREAK - contact in WEZ!")
      sam.lastContactTime = timer.getTime()
      sam.lastSweepHadContact = true
      sam.sweepsSinceDetect = 0
      -- PB HARM check: SAM about to go weapons free, but HARM may be inbound
      if aegis:_TriggerHarmInboundReaction(samName) then return nil end
      aegis:_ApplyState(samName, "sam", AEGIS.STATE.EMCON_ENGAGED)
      aegis:_UpdatePDsForParent(samName)
      aegis:_EmconEngagedMonitor(samName, gen)
    else
      -- Track threat memory: did we see anything at all? (even outside WEZ)
      local sawAnything = detected and #detected > 0
      
      if isQuickPeek then
        -- Quick peek done, back to silent
        sam.lastSweepHadContact = sawAnything
        if not sawAnything then
          sam.sweepsSinceDetect = sam.sweepsSinceDetect + 1
        else
          sam.sweepsSinceDetect = 0
        end
        aegis:_EmconSilentPhase(samName, gen)
      else
        -- Full sweep: schedule second check near end of window
        local remaining = onDuration - aegis.emconDetectDelay
        if remaining > 5 then
          timer.scheduleFunction(function()
            if not sam or sam.emconGen ~= gen then return nil end
            if sam.state ~= AEGIS.STATE.EMCON_OFF then return nil end
            
            local g2 = Group.getByName(samName)
            if g2 and g2:isExist() then
              local c2 = g2:getController()
              local d2 = c2:getDetectedTargets(Controller.Detection.RADAR)
              if aegis:_DetectedInWEZ(sam, d2) then
                aegis:_Log(samName .. ": EMCON BREAK (2nd check) - contact in WEZ")
                sam.lastContactTime = timer.getTime()
                sam.lastSweepHadContact = true
                sam.sweepsSinceDetect = 0
                -- PB HARM check: SAM about to go weapons free
                if aegis:_TriggerHarmInboundReaction(samName) then return nil end
                aegis:_ApplyState(samName, "sam", AEGIS.STATE.EMCON_ENGAGED)
                aegis:_UpdatePDsForParent(samName)
                aegis:_EmconEngagedMonitor(samName, gen)
                return nil
              end
              -- Update threat memory with second check
              local saw2 = d2 and #d2 > 0
              sawAnything = sawAnything or saw2
            end
            
            -- Sweep complete. Update threat memory.
            sam.lastSweepHadContact = sawAnything
            if not sawAnything then
              sam.sweepsSinceDetect = sam.sweepsSinceDetect + 1
            else
              sam.sweepsSinceDetect = 0
            end
            
            -- Chance of double-sweep: brief pause then sweep again
            -- Only triggers if we saw something (outside WEZ) -- crew wants another look
            if sawAnything and math.random(1, 100) <= aegis.emconDoubleSweep then
              aegis:_Log(samName .. ": double-sweep (contact outside WEZ)")
              aegis:_ApplyState(samName, "sam", AEGIS.STATE.EMCON_ON)
              timer.scheduleFunction(function()
                if not sam or sam.emconGen ~= gen then return nil end
                aegis:_EmconSweepPhase(samName, gen)
              end, nil, timer.getTime() + math.random(5, 10))
            else
              aegis:_EmconSilentPhase(samName, gen)
            end
          end, nil, timer.getTime() + remaining)
        else
          -- Sweep window too short for second check
          sam.lastSweepHadContact = sawAnything
          if not sawAnything then
            sam.sweepsSinceDetect = sam.sweepsSinceDetect + 1
          else
            sam.sweepsSinceDetect = 0
          end
          aegis:_EmconSilentPhase(samName, gen)
        end
      end
    end
  end, nil, timer.getTime() + self.emconDetectDelay)
end

--- Monitor an EMCON-engaged SAM. When it loses targets for X seconds,
--- re-enter EMCON cycle. Timeout is rolled randomly per engagement.
function AEGIS:_EmconEngagedMonitor(samName, gen)
  local sam = self.samSites[samName]
  if not sam or sam.emconGen ~= gen then return end
  
  local aegis = self
  local checkInterval = 5  -- check every 5s (tight loop for short timeouts)
  local reengageTimeout = math.random(self.emconReengageMin, self.emconReengageMax)
  aegis:_Log(samName .. ": reengage timeout " .. reengageTimeout .. "s")
  
  local function monitor()
    if not sam or sam.emconGen ~= gen then return nil end
    if sam.state ~= AEGIS.STATE.EMCON_ENGAGED then return nil end
    
    -- Check if network was restored
    if sam.sector and sam.sector ~= "_AUTO" then
      if aegis:_SectorHasEW(sam.sector) and aegis:_SectorHasC2(sam.sector)
         and aegis:_NodeHasPower(sam) then
        aegis:_StopEMCON(samName)
        aegis:_ApplyState(samName, "sam", AEGIS.STATE.DARK)
        return nil
      end
    end
    
    local grp = Group.getByName(samName)
    if not grp or not grp:isExist() then
      sam.state = AEGIS.STATE.DESTROYED
      return nil
    end
    
    local ctrl = grp:getController()
    local detected = ctrl:getDetectedTargets(Controller.Detection.RADAR)
    
    if aegis:_DetectedInWEZ(sam, detected) then
      sam.lastContactTime = timer.getTime()
    end
    
    if (timer.getTime() - sam.lastContactTime) > reengageTimeout then
      aegis:_Log(samName .. ": engagement timeout, re-entering EMCON")
      aegis:_EmconSilentPhase(samName, gen)
      return nil
    end
    
    -- Keep monitoring
    return timer.getTime() + checkInterval
  end
  
  timer.scheduleFunction(monitor, nil, timer.getTime() + checkInterval)
end

--- Update PD sites that are children of a given SAM.
--- Respects parent HARM cooldown — PD stays ALERT during HARM defense.
function AEGIS:_UpdatePDsForParent(parentName)
  local now = timer.getTime()
  for pdName, pd in pairs(self.pdSites) do
    if pd.parent == parentName and pd.state ~= AEGIS.STATE.DESTROYED then
      local parentSam = self.samSites[parentName]
      if parentSam then
        -- If parent is in active HARM cooldown, PD stays ALERT for defense
        if parentSam.harmCooldownUntil and now < parentSam.harmCooldownUntil then
          if pd.state ~= AEGIS.STATE.ALERT then
            self:_ApplyState(pdName, "pd", AEGIS.STATE.ALERT)
          end
        elseif parentSam.state == AEGIS.STATE.ALERT
           or parentSam.state == AEGIS.STATE.EMCON_ENGAGED then
          self:_ApplyState(pdName, "pd", AEGIS.STATE.ALERT)
        else
          self:_ApplyState(pdName, "pd", AEGIS.STATE.DARK)
        end
      end
    end
  end
end

--- Promote an orphaned PD to an autonomous SAM.
--- Creates a full SAM entry from the PD's data, starts EMCON cycling.
function AEGIS:_PromoteOrphanPD(pdName)
  local pd = self.pdSites[pdName]
  if not pd or pd.state == AEGIS.STATE.DESTROYED then return end

  local grp = Group.getByName(pdName)
  if not grp or not grp:isExist() or grp:getSize() == 0 then return end

  self:_Log("  " .. pdName .. ": orphan promoted to autonomous SAM", true)

  -- Inherit sector from dead parent (entry still exists in samSites)
  local sectorName = pd.sector or "_AUTO"

  -- Create full SAM entry
  self.samSites[pdName] = {
    name = pdName,
    sector = sectorName,
    sysType = pd.sysType,
    sysData = pd.sysData,
    state = nil,                     -- nil forces _ApplyState to execute DCS commands
    emconGen = 0,
    lastContactTime = 0,
    pos = pd.pos,
    sweepsSinceDetect = 0,
    lastSweepHadContact = false,
    spooked = false,
    spookedUntil = 0,
    powerSource = nil,
    harmCooldownUntil = 0,
    harmEvents = {},
    harmReaction = nil,
    harmReactionGen = 0,
    harmWeapon = nil,
    harmReactionStart = 0,
    harmInbound = 0,
    harmInboundExpiry = 0,
    alertWithoutWezSince = 0,
    alertFrustrationTimeout = 0,
    frustrationCooldownUntil = 0,
    jammed = false,
    jammedEmconGen = 0,
    jammedEmconActive = false,
    hojUntil = 0,
    hojCooldownUntil = 0,
    hojPeekCount = 0,
    trackRadarUnit = nil,        -- PD systems (SA-15/TOR) are self-contained, no critical unit
  }

  -- Add to sector SAM list
  self:_EnsureSector(sectorName)
  table.insert(self.sectors[sectorName].sams, pdName)

  -- Remove from sector PD list
  local sec = self.sectors[sectorName]
  if sec then
    for i, p in ipairs(sec.pds) do
      if p == pdName then
        table.remove(sec.pds, i)
        break
      end
    end
  end

  -- Remove from pdSites
  self.pdSites[pdName] = nil

  -- Check if sector still has network support (parent dead ≠ sector dead)
  local hasEW = self:_SectorHasEW(sectorName)
  local hasC2 = self:_SectorHasC2(sectorName)
  if hasEW and hasC2 then
    -- Sector has EW coverage: start DARK, let poll handle activation
    self:_ApplyState(pdName, "sam", AEGIS.STATE.DARK)
  else
    -- No network: autonomous EMCON cycling
    self:_StartEMCON(pdName)
  end
end

---------------------------------------------------------------------------
-- SECTOR STATUS QUERIES
---------------------------------------------------------------------------

--- Check if a specific node has power.
--- No powerSource linked = self-powered (always true).
--- PowerSource linked = check if that PWR group is alive.
function AEGIS:_NodeHasPower(node)
  if not node.powerSource then return true end  -- self-powered
  local pwr = self.powerSources[node.powerSource]
  if not pwr then return true end  -- safety: missing PWR = assume powered
  return pwr.alive
end

function AEGIS:_SectorHasC2(sectorName)
  local sec = self.sectors[sectorName]
  if not sec then return true end
  if #sec.cmd == 0 then return true end
  for _, c in ipairs(sec.cmd) do
    if self.commandCenters[c] and self.commandCenters[c].alive then return true end
  end
  return false
end

function AEGIS:_SectorHasEW(sectorName)
  local sec = self.sectors[sectorName]
  if not sec then return false end
  for _, e in ipairs(sec.ew) do
    local n = self.ewRadars[e]
    if n and n.state ~= AEGIS.STATE.DESTROYED then
      local g = Group.getByName(e)
      if g and g:isExist() and g:getSize() > 0 then return true end
    end
  end
  return false
end

---------------------------------------------------------------------------
-- EVENT HANDLER (Deaths)
---------------------------------------------------------------------------

function AEGIS:_RegisterEventHandler()
  local aegis = self
  self.eventHandler = {
    onEvent = function(_, event)
      if event.id == world.event.S_EVENT_DEAD 
         or event.id == world.event.S_EVENT_UNIT_LOST then
        -- Delay slightly for DCS state to settle
        timer.scheduleFunction(function()
          aegis:_OnDeath()
        end, nil, timer.getTime() + 0.5)
      
      elseif event.id == world.event.S_EVENT_SHOT then
        -- HARM detection: process immediately (time-critical)
        local ok, err = pcall(function() aegis:_OnShot(event) end)
        if not ok then
          aegis:_Log("HARM handler error: " .. tostring(err), true)
        end

      elseif event.id == world.event.S_EVENT_BIRTH and aegis.eaEnabled then
        -- EA aircraft discovery: client slots don't exist at mission start in MP
        -- S_EVENT_BIRTH fires when player joins — all data available
        local ok2, err2 = pcall(function() aegis:_OnBirthEA(event) end)
        if not ok2 then
          aegis:_Log("EA birth handler error: " .. tostring(err2), true)
        end

      elseif event.id == world.event.S_EVENT_PLAYER_LEAVE_UNIT and aegis.eaEnabled then
        -- Player left EA slot — deactivate jammer
        -- DCS fires this TWICE on slot change; second time initiator is nil
        local ok3, err3 = pcall(function() aegis:_OnPlayerLeaveEA(event) end)
        if not ok3 then
          aegis:_Log("EA leave handler error: " .. tostring(err3), true)
        end
      end
    end
  }
  world.addEventHandler(self.eventHandler)
  self:_Log("Event handler registered (deaths + HARM detection"
            .. (self.eaEnabled and " + EA discovery" or "") .. ")")
end

function AEGIS:_OnDeath()
  -- Check all tracked nodes for destruction
  for ewName, n in pairs(self.ewRadars) do
    if n.state ~= AEGIS.STATE.DESTROYED then
      local g = Group.getByName(ewName)
      if not g or not g:isExist() or g:getSize() == 0 then
        self:_Log("*** EW KILLED: " .. ewName)
        n.state = AEGIS.STATE.DESTROYED
        n.hasContacts = false
      end
    end
  end
  
  for pwrName, n in pairs(self.powerSources) do
    if n.alive then
      local g = Group.getByName(pwrName)
      local s = StaticObject.getByName(pwrName)
      if not ((g and g:isExist() and g:getSize() > 0) or (s and s:isExist())) then
        self:_Log("*** PWR KILLED: " .. pwrName)
        n.alive = false
        -- Immediately force all linked nodes permanently dark
        for _, targetName in ipairs(n.linkedTo) do
          local sam = self.samSites[targetName]
          if sam and sam.state ~= AEGIS.STATE.DESTROYED then
            self:_Log("  " .. targetName .. ": lost power, permanently DARK")
            self:_StopEMCON(targetName)
            self:_ApplyState(targetName, "sam", AEGIS.STATE.DARK)
          end
          local ew = self.ewRadars[targetName]
          if ew and ew.state ~= AEGIS.STATE.DESTROYED then
            self:_Log("  " .. targetName .. ": lost power, EW offline")
            ew.state = AEGIS.STATE.DESTROYED  -- treat as dead
            ew.hasContacts = false
            -- Kill radar — ALARM_STATE=GREEN is what actually stops EW search radar
            local ewGrp = Group.getByName(targetName)
            if ewGrp and ewGrp:isExist() then
              local ctrl = ewGrp:getController()
              ctrl:setOption(AI.Option.Ground.id.ALARM_STATE, AEGIS.ALARM.GREEN)
              ewGrp:enableEmission(false)
            end
          end
        end
      end
    end
  end
  
  for cmdName, n in pairs(self.commandCenters) do
    if n.alive then
      local g = Group.getByName(cmdName)
      if not g or not g:isExist() or g:getSize() == 0 then
        self:_Log("*** CMD KILLED: " .. cmdName)
        n.alive = false
      end
    end
  end
  
  for samName, n in pairs(self.samSites) do
    if n.state ~= AEGIS.STATE.DESTROYED then
      local killed = false
      local missionKill = false

      -- Tier 1: Critical unit check (tracking radar dead = mission kill)
      if n.trackRadarUnit then
        local trUnit = Unit.getByName(n.trackRadarUnit)
        if not trUnit or not trUnit:isExist() then
          killed = true
          missionKill = true
        end
      end

      -- Tier 2: Full group check (fallback for self-contained systems, or group wiped)
      if not killed then
        local g = Group.getByName(samName)
        if not g or not g:isExist() or g:getSize() == 0 then
          killed = true
        end
      end

      if killed then
        self:_StopEMCON(samName)

        if missionKill then
          self:_Log("*** SAM MISSION KILL: " .. samName .. " (tracking radar destroyed)", true)
        else
          self:_Log("*** SAM KILLED: " .. samName)
        end
        n.state = AEGIS.STATE.DESTROYED

        -- Silence surviving units on mission kill (group still alive but combat-ineffective)
        if missionKill then
          local g = Group.getByName(samName)
          if g and g:isExist() then
            local ctrl = g:getController()
            ctrl:setOption(AI.Option.Ground.id.ALARM_STATE, AEGIS.ALARM.GREEN)
            g:enableEmission(false)
            ctrl:setOption(AI.Option.Ground.id.ROE, AEGIS.ROE.WEAPON_HOLD)
          end
        end

        -- Spook nearby EMCON SAMs -- a neighbor just died, extend their silence
        if self.emconSpookEnabled and n.pos then
          local spookRange = 30 * AEGIS.NM_TO_M  -- 30 NM
          local spookRangeSq = spookRange * spookRange
          for otherName, other in pairs(self.samSites) do
            if other ~= n and other.state ~= AEGIS.STATE.DESTROYED and other.pos then
              local dx = n.pos.x - other.pos.x
              local dz = n.pos.z - other.pos.z
              if (dx*dx + dz*dz) <= spookRangeSq then
                local inEmcon = (other.state == AEGIS.STATE.EMCON_ON
                  or other.state == AEGIS.STATE.EMCON_OFF
                  or other.state == AEGIS.STATE.EMCON_ENGAGED)
                if inEmcon then
                  other.spooked = true
                  other.spookedUntil = timer.getTime() + self.emconSpookDuration
                  self:_Log("  " .. otherName .. ": SPOOKED by " .. samName .. " death")
                end
              end
            end
          end
        end
      end
    end
  end
  
  for pdName, n in pairs(self.pdSites) do
    if n.state ~= AEGIS.STATE.DESTROYED then
      local g = Group.getByName(pdName)
      if not g or not g:isExist() or g:getSize() == 0 then
        self:_Log("*** PD KILLED: " .. pdName)
        n.state = AEGIS.STATE.DESTROYED
      end
    end
  end

  -- Orphan promotion: PDs whose parent was just destroyed become autonomous SAMs
  -- Deferred to avoid modifying pdSites/samSites during the loops above
  local orphans = {}
  for pdName, pd in pairs(self.pdSites) do
    if pd.state ~= AEGIS.STATE.DESTROYED and pd.parent then
      local parentSam = self.samSites[pd.parent]
      if parentSam and parentSam.state == AEGIS.STATE.DESTROYED then
        table.insert(orphans, pdName)
      end
    end
  end
  for _, pdName in ipairs(orphans) do
    self:_PromoteOrphanPD(pdName)
  end

  -- EA jammers: check for dead jammer aircraft
  for jamName, j in pairs(self.jammers) do
    if j.alive then
      local g = Group.getByName(jamName)
      if not g or not g:isExist() or g:getSize() == 0 then
        self:_Log("*** EA KILLED: " .. jamName, true)
        j.alive = false
        j.active = false
        -- Clear player mappings for this dead jammer
        for pName, gName in pairs(self.jammerPlayers) do
          if gName == jamName then
            self.jammerPlayers[pName] = nil
          end
        end
      end
    end
  end

  -- Note: SAMs in sectors that just lost EW/C2 will transition to EMCON
  -- on the next EW poll cycle (within ewPollInterval seconds).
  -- This is intentional -- avoids re-evaluating everything on every death.
end

---------------------------------------------------------------------------
-- EA JAMMER HANDLERS (Phase 6)
---------------------------------------------------------------------------

--- S_EVENT_BIRTH: discover EA aircraft that spawned after mission start (client slots in MP)
function AEGIS:_OnBirthEA(event)
  if not event.initiator then return end

  local ok, unit = pcall(function() return event.initiator end)
  if not ok or not unit then return end

  -- Check if this unit belongs to the opposing coalition
  local enemySide = (self.coalitionId == coalition.side.RED)
                    and coalition.side.BLUE or coalition.side.RED
  local unitCoal = unit:getCoalition()
  if unitCoal ~= enemySide then return end

  -- Check if group name matches EA- pattern (or deprecated ECM-)
  local grpOk, grp = pcall(function() return unit:getGroup() end)
  if not grpOk or not grp then return end
  local groupName = grp:getName()

  local jamType = groupName:match("^EA%-([%w]+)%-")
  if not jamType then
    jamType = groupName:match("^ECM%-([%w]+)%-")
    if jamType then
      self:_Log("WARNING: " .. groupName .. " uses deprecated ECM- prefix, rename to EA-", true)
    end
  end
  if not jamType then return end

  -- Check if this is a player
  local playerName = nil
  local pOk, pName = pcall(function() return unit:getPlayerName() end)
  if pOk and pName and pName ~= "" then playerName = pName end

  -- Map unit ID for slot-based copilot/WSO lookup
  local unitId = unit:getID()
  if unitId then self.eaUnitMap[tostring(unitId)] = groupName end

  -- Already registered? (AI groups found at _AutoDiscover, or player re-slotting)
  if self.jammers[groupName] then
    if playerName then
      self.jammerPlayers[playerName] = groupName
      local j = self.jammers[groupName]
      if not j.playerControlled then
        -- SP fix: _AutoDiscover registered as AI, but player just spawned in.
        -- Upgrade to player-controlled: stop AI jamming, give player F10 menu + GUI.
        j.playerControlled = true
        j.active = false
        j.mode = "OFF"
        j.knownEmitters = {}
        j.groupId = grp:getID()
        local p3 = unit:getPosition()
        if p3 then
          j.pos = p3.p
          j.heading = math.atan2(p3.x.z, p3.x.x)
        else
          j.pos = unit:getPoint()
        end
        self:_Log("*** EA AI->PLAYER UPGRADE: " .. playerName .. " in " .. groupName .. " — now player-controlled", true)
        self:_CreateJammerF10Menu(groupName, j.groupId)
      elseif j.playerControlled and not j.active then
        -- Restore from despawn: alive + active + refresh position/groupId
        j.alive = true
        j.active = true
        j.groupId = grp:getID()
        j.knownEmitters = {}
        local p3 = unit:getPosition()
        if p3 then
          j.pos = p3.p
          j.heading = math.atan2(p3.x.z, p3.x.x)
        else
          j.pos = unit:getPoint()
        end
        self:_Log("*** EA PLAYER RE-JOINED: " .. playerName .. " in " .. groupName .. " — jammer reactivated", true)
        self:_CreateJammerF10Menu(groupName, j.groupId)
      else
        -- Multicrew join or AI re-registration
        if not j.alive then
          j.alive = true
          j.groupId = grp:getID()
        end
        self:_Log("*** EA PLAYER JOINED: " .. playerName .. " in " .. groupName .. " (crew)", true)
      end
    end
    return
  end

  -- First time: register the jammer group
  local isPlayer = (playerName ~= nil)
  self:_RegisterJammer(groupName, jamType, isPlayer)

  if isPlayer then
    self.jammerPlayers[playerName] = groupName
    self:_Log("*** EA PLAYER JOINED: " .. playerName .. " in " .. groupName, true)
    self:_CreateJammerF10Menu(groupName, grp:getID())
  end
end

--- S_EVENT_PLAYER_LEAVE_UNIT: remove player from tracking, deactivate when last crew leaves.
--- DCS fires this TWICE on slot change — second time initiator is nil (must guard).
function AEGIS:_OnPlayerLeaveEA(event)
  if not event.initiator then return end  -- nil-guard: second fire has nil initiator

  local ok, grp = pcall(function() return event.initiator:getGroup() end)
  if not ok or not grp then return end
  local groupName = grp:getName()

  local jammer = self.jammers[groupName]
  if not jammer or not jammer.playerControlled then return end

  -- Identify leaving player and remove from tracking
  local pOk, pName = pcall(function() return event.initiator:getPlayerName() end)
  if pOk and pName and self.jammerPlayers[pName] == groupName then
    self.jammerPlayers[pName] = nil
  end

  -- Count remaining players in this group
  local remaining = 0
  for _, gn in pairs(self.jammerPlayers) do
    if gn == groupName then remaining = remaining + 1 end
  end

  if remaining == 0 then
    self:_Log("*** EA PLAYER LEFT: " .. groupName .. " — jammer deactivated (last crew out)", true)
    jammer.active = false
  else
    self:_Log("*** EA CREW LEFT: " .. groupName .. " — " .. remaining .. " crew remaining", true)
  end
end

--- Create per-group F10 menu for player-controlled EA aircraft.
--- Rebuilds entire menu tree on mode/pod change. Menu root is "EA".
---
--- Layout: modes-as-submenus so mode switch + target assignment is one menu session.
--- Fixed item counts (2 submenus + 3 commands) give stable F-key positions:
---   F1: HALF+DIR (submenu)    F2: 2xDIR (submenu)
---   F3: FULL OMNI (command)   F4: OFF (command)   F5: STATUS (command)
function AEGIS:_CreateJammerF10Menu(groupName, groupId)
  local j = self.jammers[groupName]
  if not j then return end

  -- Remove old menu tree if it exists
  if j.menuRoot then
    pcall(missionCommands.removeItemForGroup, groupId, j.menuRoot)
  end

  local aegis = self
  local bl = self.jammerBaseline
  local root = missionCommands.addSubMenuForGroup(groupId, "EA")
  j.menuRoot = root

  -- Helper: switch mode, set active flag, clear inapplicable pod assignments
  local function switchMode(jj, modeKey, modeLabel)
    jj.mode = modeKey
    if modeKey == "OFF" then
      jj.active = false
      trigger.action.outTextForGroup(groupId, "EA OFF — jammer silent", 8)
      aegis:_Log(groupName .. ": EA OFF by player", true)
    else
      jj.active = true
      trigger.action.outTextForGroup(groupId, "EA MODE: " .. modeLabel, 8)
      aegis:_Log(groupName .. ": EA mode -> " .. modeKey, true)
    end
    if modeKey == "OMNI" or modeKey == "OFF" then
      jj.pod1Target = nil
      jj.pod2Target = nil
      jj.bearingLocked = false
    elseif modeKey == "WIDE" then
      jj.pod1Target = nil  -- pod 1 is omni in this mode
    end
  end

  -- ── SUBMENUS (DCS renders these first → stable F1/F2) ──

  -- F1: WIDE — submenu with bearing lock + Pod 2 target list
  local wideStar = (j.mode == "WIDE") and " *" or ""
  local wideMenu = missionCommands.addSubMenuForGroup(groupId, "WIDE" .. wideStar, root)

  -- Bearing lock/unlock (always first inside WIDE)
  if j.bearingLocked then
    local brgStr = string.format("%03d", math.floor(math.deg(j.lockedBearing) + 0.5) % 360)
    missionCommands.addCommandForGroup(groupId, "UNLOCK BRG " .. brgStr, wideMenu, function()
      local jj = aegis.jammers[groupName]
      if not jj then return end
      if jj.mode ~= "WIDE" then switchMode(jj, "WIDE", "WIDE") end
      jj.bearingLocked = false
      trigger.action.outTextForGroup(groupId, "Pod 1: following aircraft heading", 5)
      aegis:_CreateJammerF10Menu(groupName, groupId)
    end)
  else
    missionCommands.addCommandForGroup(groupId, "LOCK BRG", wideMenu, function()
      local jj = aegis.jammers[groupName]
      if not jj then return end
      if jj.mode ~= "WIDE" then switchMode(jj, "WIDE", "WIDE") end
      jj.bearingLocked = true
      jj.lockedBearing = jj.heading
      local brg = math.floor(math.deg(jj.heading) + 0.5) % 360
      trigger.action.outTextForGroup(groupId, "Pod 1: bearing LOCKED at " .. brg, 5)
      aegis:_CreateJammerF10Menu(groupName, groupId)
    end)
  end

  -- Pod 2 target list (each entry switches to WIDE + assigns Pod 2)
  self:_BuildModeTargetMenu(groupName, groupId, wideMenu, "WIDE", "WIDE", 2)

  -- WIDE presets (selectable beam widths)
  for _, preset in ipairs(AEGIS.WIDE_PRESETS) do
    local star = (j.widePreset == preset.label) and " *" or ""
    missionCommands.addCommandForGroup(groupId, preset.label .. star, wideMenu, function()
      local jj = aegis.jammers[groupName]
      if jj then
        jj.wideGain = preset.gain
        jj.wideHalfAngleRad = preset.angleRad
        jj.widePreset = preset.label
        aegis:_CreateJammerF10Menu(groupName, groupId)
        aegis:_RefreshJammerStatus(groupName)
      end
    end)
  end

  -- Pod 2 unassign (if assigned)
  if j.pod2Target then
    missionCommands.addCommandForGroup(groupId, "UNASSIGN P2", wideMenu, function()
      local jj = aegis.jammers[groupName]
      if not jj then return end
      jj.pod2Target = nil
      trigger.action.outTextForGroup(groupId, "Pod 2: unassigned", 5)
      aegis:_Log(groupName .. ": pod2 unassigned", true)
      aegis:_CreateJammerF10Menu(groupName, groupId)
    end)
  end

  -- F2: 2xDIR — submenu with Pod 1 and Pod 2 sub-submenus
  local dirStar = (j.mode == "DIR2") and " *" or ""
  local dirMenu = missionCommands.addSubMenuForGroup(groupId, "2xDIR" .. dirStar, root)

  local p1Label = j.pod1Target and ("Pod 1 -> " .. j.pod1Target) or "Pod 1 (select)"
  local p1Menu = missionCommands.addSubMenuForGroup(groupId, p1Label, dirMenu)
  self:_BuildModeTargetMenu(groupName, groupId, p1Menu, "DIR2", "2x DIR", 1)
  if j.pod1Target then
    missionCommands.addCommandForGroup(groupId, "UNASSIGN", p1Menu, function()
      local jj = aegis.jammers[groupName]
      if not jj then return end
      jj.pod1Target = nil
      trigger.action.outTextForGroup(groupId, "Pod 1: unassigned", 5)
      aegis:_Log(groupName .. ": pod1 unassigned", true)
      aegis:_CreateJammerF10Menu(groupName, groupId)
    end)
  end

  local p2Label = j.pod2Target and ("Pod 2 -> " .. j.pod2Target) or "Pod 2 (select)"
  local p2Menu = missionCommands.addSubMenuForGroup(groupId, p2Label, dirMenu)
  self:_BuildModeTargetMenu(groupName, groupId, p2Menu, "DIR2", "2x DIR", 2)
  if j.pod2Target then
    missionCommands.addCommandForGroup(groupId, "UNASSIGN", p2Menu, function()
      local jj = aegis.jammers[groupName]
      if not jj then return end
      jj.pod2Target = nil
      trigger.action.outTextForGroup(groupId, "Pod 2: unassigned", 5)
      aegis:_Log(groupName .. ": pod2 unassigned", true)
      aegis:_CreateJammerF10Menu(groupName, groupId)
    end)
  end

  -- ── COMMANDS (DCS renders these after submenus → stable F3/F4/F5) ──

  -- F3: FULL OMNI
  local omniStar = (j.mode == "OMNI") and " *" or ""
  missionCommands.addCommandForGroup(groupId, "FULL OMNI" .. omniStar, root, function()
    local jj = aegis.jammers[groupName]
    if not jj then return end
    switchMode(jj, "OMNI", "FULL OMNI")
    aegis:_CreateJammerF10Menu(groupName, groupId)
  end)

  -- F4: OFF
  local offStar = (j.mode == "OFF") and " *" or ""
  missionCommands.addCommandForGroup(groupId, "OFF" .. offStar, root, function()
    local jj = aegis.jammers[groupName]
    if not jj then return end
    switchMode(jj, "OFF", "OFF")
    aegis:_CreateJammerF10Menu(groupName, groupId)
  end)

  -- F5: STATUS toggle
  local statusLabel = j.statusActive and "STATUS: HIDE" or "STATUS: SHOW"
  missionCommands.addCommandForGroup(groupId, statusLabel, root, function()
    local jj = aegis.jammers[groupName]
    if not jj then return end
    jj.statusActive = not jj.statusActive
    if jj.statusActive then
      aegis:_RefreshJammerStatus(groupName)
    else
      trigger.action.outTextForGroup(groupId, "", 1, true)
    end
    aegis:_CreateJammerF10Menu(groupName, groupId)
  end)

  -- Refresh persistent status display if active
  self:_RefreshJammerStatus(groupName)

  -- Schedule periodic menu refresh (30s) if not already scheduled
  if not j.menuRefreshScheduled then
    j.menuRefreshScheduled = true
    local function periodicRefresh()
      local jj = aegis.jammers[groupName]
      if not jj or not jj.alive or not jj.playerControlled then return nil end
      jj.menuRefreshScheduled = false
      aegis:_CreateJammerF10Menu(groupName, groupId)
      return nil
    end
    timer.scheduleFunction(periodicRefresh, nil, timer.getTime() + 30)
  end
end

--- Signal strength bars lookup (index 1-5).
AEGIS.STRENGTH_BARS = { "|....", "||...", "|||..", "||||.", "|||||" }

--- Compute emitter signal strength (1-5 bars) from distance.
--- Uses actRange (SAMs) or detRange/200NM (EWRs) as reference range.
function AEGIS:_EmitterStrength(distNM, refRangeNM)
  if refRangeNM <= 0 then refRangeNM = 200 end
  local ratio = math.min(distNM / refRangeNM, 1.0)
  return 5 - math.floor(ratio * 4)  -- 5=closest, 1=edge
end

--- Build emitter display label based on eaDebugLabels config.
--- Generic mode: NATO reporting name from srLabel (e.g., "Fan Song", "Big Bird"),
--- falls back to "SAM" for systems without srLabel (PD/SHORAD).
function AEGIS:_EmitterLabel(groupName, sysType, isEW)
  if self.eaDebugLabels then
    if isEW then
      return groupName .. " [EWR]"
    else
      return groupName .. " [" .. (sysType or "?") .. "]"
    end
  else
    if isEW then return "EW" end
    local sysData = sysType and AEGIS.SYSTEM_DB[sysType]
    return (sysData and sysData.srLabel) or "SAM"
  end
end

--- Resolve a pod target group name to its display label.
function AEGIS:_PodTargetLabel(targetName)
  local sam = self.samSites[targetName]
  if sam then return self:_EmitterLabel(targetName, sam.sysType, false) end
  local ew = self.ewRadars[targetName]
  if ew then return self:_EmitterLabel(targetName, nil, true) end
  return targetName  -- fallback (shouldn't happen)
end

--- Refresh persistent EA status display for a player jammer.
--- Shows mode, pod assignments, and known emitters with label + strength + relative bearing.
--- Called on emitter changes, mode changes, pod changes, and periodic refresh.
function AEGIS:_RefreshJammerStatus(jamName)
  local j = self.jammers[jamName]
  if not j or not j.statusActive or not j.playerControlled or not j.groupId then return end
  if not j.pos then return end

  local modeLabels = { OMNI = "FULL OMNI", WIDE = "WIDE", DIR2 = "2x DIR", OFF = "OFF" }
  local modeLabel = modeLabels[j.mode] or j.mode

  local lines = { "--- EA STATUS ---" }
  table.insert(lines, "Mode: " .. modeLabel)

  if j.mode == "WIDE" then
    if j.bearingLocked then
      table.insert(lines, "Pod 1: OMNI BRG " .. string.format("%03d", math.floor(math.deg(j.lockedBearing) + 0.5) % 360))
    else
      table.insert(lines, "Pod 1: OMNI HDG " .. string.format("%03d", math.floor(math.deg(j.heading) + 0.5) % 360))
    end
    local p2lbl = j.pod2Target and self:_PodTargetLabel(j.pod2Target) or nil
    table.insert(lines, "Pod 2: " .. (p2lbl and ("DIR -> " .. p2lbl) or "DIR (unassigned)"))
  elseif j.mode == "DIR2" then
    local p1lbl = j.pod1Target and self:_PodTargetLabel(j.pod1Target) or nil
    local p2lbl = j.pod2Target and self:_PodTargetLabel(j.pod2Target) or nil
    table.insert(lines, "Pod 1: " .. (p1lbl and ("DIR -> " .. p1lbl) or "DIR (unassigned)"))
    table.insert(lines, "Pod 2: " .. (p2lbl and ("DIR -> " .. p2lbl) or "DIR (unassigned)"))
  end

  -- Emitter list: label + strength + relative bearing, sorted by relative bearing
  if j.knownEmitters then
    local hdgDeg = math.floor(math.deg(j.heading) + 0.5) % 360
    local emitters = {}
    for eName, eData in pairs(j.knownEmitters) do
      local ePos, refRange = nil, 200
      local sam = self.samSites[eName]
      if sam and sam.pos then
        ePos = sam.pos
        refRange = sam.sysData and sam.sysData.actRange or 30
      else
        local ew = self.ewRadars[eName]
        if ew and ew.pos then
          ePos = ew.pos
          refRange = (ew.detRange > 0) and ew.detRange or 200
        end
      end
      if ePos then
        local absBrg = math.deg(math.atan2(ePos.z - j.pos.z, ePos.x - j.pos.x))
        absBrg = math.floor(absBrg + 0.5) % 360
        local relBrg = (absBrg - hdgDeg + 360) % 360
        local distNM = math.sqrt(eData.distSq) / AEGIS.NM_TO_M
        local str = self:_EmitterStrength(distNM, refRange)
        local lbl = self:_EmitterLabel(eName, eData.sysType, eData.isEW)
        table.insert(emitters, { label = lbl, strength = str, relBrg = relBrg })
      end
    end
    table.sort(emitters, function(a, b) return a.relBrg < b.relBrg end)
    if #emitters > 0 then
      table.insert(lines, "-- EMITTERS --")
      for _, e in ipairs(emitters) do
        table.insert(lines, string.format("  %s  %s  REL %03d",
          e.label, AEGIS.STRENGTH_BARS[e.strength], e.relBrg))
      end
    else
      table.insert(lines, "-- NO EMITTERS --")
    end
  end

  -- Display with generous duration — periodic refresh or emitter change will update
  trigger.action.outTextForGroup(j.groupId, table.concat(lines, "\n"), 35, true)
end

--- Build emitter target list inside a mode submenu. Each target command switches
--- to the specified mode AND assigns the pod in one click. Sorted by bearing, capped at 10.
function AEGIS:_BuildModeTargetMenu(groupName, groupId, parentMenu, modeKey, modeLabel, podNum)
  local j = self.jammers[groupName]
  if not j or not j.pos then return end

  local aegis = self
  local bl = self.jammerBaseline
  local maxRange = bl.effectRange * bl.directionalRangeMult
  local maxRangeM = maxRange * AEGIS.NM_TO_M
  local maxRangeSq = maxRangeM * maxRangeM

  -- Gather radiating emitters in range
  local hdgDeg = math.floor(math.deg(j.heading) + 0.5) % 360
  local emitters = {}
  for samName, sam in pairs(self.samSites) do
    if self:_IsEmitting(sam) and sam.pos then
      local dx = j.pos.x - sam.pos.x
      local dz = j.pos.z - sam.pos.z
      local distSq = dx*dx + dz*dz
      if distSq <= maxRangeSq then
        local absBrg = math.deg(math.atan2(sam.pos.z - j.pos.z, sam.pos.x - j.pos.x))
        absBrg = math.floor(absBrg + 0.5) % 360
        local relBrg = (absBrg - hdgDeg + 360) % 360
        local distNM = math.sqrt(distSq) / AEGIS.NM_TO_M
        local refRange = sam.sysData and sam.sysData.actRange or 30
        local str = self:_EmitterStrength(distNM, refRange)
        local lbl = self:_EmitterLabel(samName, sam.sysType, false)
        table.insert(emitters, { name = samName, relBrg = relBrg, label = lbl, strength = str })
      end
    end
  end
  for ewName, ew in pairs(self.ewRadars) do
    if ew.state ~= AEGIS.STATE.DESTROYED and ew.pos then
      local dx = j.pos.x - ew.pos.x
      local dz = j.pos.z - ew.pos.z
      local distSq = dx*dx + dz*dz
      if distSq <= maxRangeSq then
        local absBrg = math.deg(math.atan2(ew.pos.z - j.pos.z, ew.pos.x - j.pos.x))
        absBrg = math.floor(absBrg + 0.5) % 360
        local relBrg = (absBrg - hdgDeg + 360) % 360
        local distNM = math.sqrt(distSq) / AEGIS.NM_TO_M
        local refRange = (ew.detRange > 0) and ew.detRange or 200
        local str = self:_EmitterStrength(distNM, refRange)
        local lbl = self:_EmitterLabel(ewName, nil, true)
        table.insert(emitters, { name = ewName, relBrg = relBrg, label = lbl, strength = str })
      end
    end
  end

  -- Sort by relative bearing, cap at 10
  table.sort(emitters, function(a, b) return a.relBrg < b.relBrg end)
  local cap = math.min(#emitters, 10)

  for i = 1, cap do
    local e = emitters[i]
    local label = string.format("%s  %s  REL %03d", e.label, AEGIS.STRENGTH_BARS[e.strength], e.relBrg)
    missionCommands.addCommandForGroup(groupId, label, parentMenu, function()
      local jj = aegis.jammers[groupName]
      if not jj then return end
      -- Switch mode if not already in it
      if jj.mode ~= modeKey then
        jj.mode = modeKey
        jj.active = true
        if modeKey == "WIDE" then jj.pod1Target = nil end
        aegis:_Log(groupName .. ": EA mode -> " .. modeKey, true)
      end
      -- Assign pod
      if podNum == 1 then jj.pod1Target = e.name else jj.pod2Target = e.name end
      trigger.action.outTextForGroup(groupId,
        "EA: " .. modeLabel .. " — Pod " .. podNum .. " -> " .. e.label, 5)
      aegis:_Log(groupName .. ": pod" .. podNum .. " -> " .. e.name, true)
      aegis:_CreateJammerF10Menu(groupName, groupId)
    end)
  end
end

---------------------------------------------------------------------------
-- EA JAMMER EVALUATION (Phase 6 core logic)
---------------------------------------------------------------------------

--- Refresh jammer positions and headings (aircraft move). Called once per full EW poll rotation.
--- Also handles stale pod-target cleanup and emitter alerts for player jammers.
function AEGIS:_UpdateJammerPositions()
  for jamName, j in pairs(self.jammers) do
    if j.alive then
      local ok, grp = pcall(function() return Group.getByName(jamName) end)
      if ok and grp and grp:isExist() then
        local unit = grp:getUnit(1)
        if unit then
          local p3 = unit:getPosition()
          if p3 then
            j.pos = p3.p
            j.heading = math.atan2(p3.x.z, p3.x.x)
          else
            j.pos = unit:getPoint()
          end
        end
      else
        j.alive = false
        j.active = false
      end

      -- Pod assignments are fully persistent — WSO manages via F10 UNASSIGN.
      -- Dead targets are harmless (pod points at nothing), and the WSO knows
      -- from EMITTER LOST alerts or the persistent status display.
    end
  end
end

--- Scan emitter changes for player jammers. Runs every sub-cycle (~1.4s with
--- 7 sectors) so the WSO gets near-real-time NEW EMITTER / EMITTER LOST alerts.
--- Separated from _UpdateJammerPositions (which runs per full rotation) because
--- emitter scanning is pure table lookups — no DCS API calls.
function AEGIS:_ScanJammerEmitters()
  local bl = self.jammerBaseline
  local maxRange = bl.effectRange * bl.directionalRangeMult
  local maxRangeM = maxRange * AEGIS.NM_TO_M
  local maxRangeSq = maxRangeM * maxRangeM

  for jamName, j in pairs(self.jammers) do
    if j.alive and j.playerControlled and j.groupId and j.pos then
      local currentEmitters = {}

      for samName2, sam2 in pairs(self.samSites) do
        if self:_IsEmitting(sam2) and sam2.pos then
          local dx = j.pos.x - sam2.pos.x
          local dz = j.pos.z - sam2.pos.z
          local d2 = dx*dx + dz*dz
          if d2 <= maxRangeSq then
            currentEmitters[samName2] = { distSq = d2, isEW = false, sysType = sam2.sysType }
          end
        end
      end
      for ewName2, ew2 in pairs(self.ewRadars) do
        if ew2.state ~= AEGIS.STATE.DESTROYED and ew2.pos then
          local dx = j.pos.x - ew2.pos.x
          local dz = j.pos.z - ew2.pos.z
          local d2 = dx*dx + dz*dz
          if d2 <= maxRangeSq then
            currentEmitters[ewName2] = { distSq = d2, isEW = true }
          end
        end
      end

      local anyChange = false
      local now = timer.getTime()

      -- Merge current emitters into known, mark as live
      for eName, eData in pairs(currentEmitters) do
        local prev = j.knownEmitters[eName]
        if not prev then
          if not j.statusActive then
            local lbl = self:_EmitterLabel(eName, eData.sysType, eData.isEW)
            trigger.action.outTextForGroup(j.groupId, "NEW EMITTER: " .. lbl, 5)
          end
          anyChange = true
        elseif prev.stale then
          anyChange = true  -- returning from stale
        end
        eData.lastSeen = now
        eData.stale = false
        j.knownEmitters[eName] = eData
      end

      -- Mark emitters not in current as stale, drop expired or destroyed
      for eName, eData in pairs(j.knownEmitters) do
        if not currentEmitters[eName] then
          -- Check if destroyed — drop immediately
          local sam = self.samSites[eName]
          local ew = self.ewRadars[eName]
          if (sam and sam.state == AEGIS.STATE.DESTROYED) or (ew and ew.state == AEGIS.STATE.DESTROYED) then
            j.knownEmitters[eName] = nil
            anyChange = true
          elseif self.eaEmitterMemory > 0 then
            if not eData.stale then
              eData.stale = true
              eData.lastSeen = eData.lastSeen or now
              if not j.statusActive then
                local lbl = self:_EmitterLabel(eName, eData.sysType, eData.isEW)
                trigger.action.outTextForGroup(j.groupId, "EMITTER LOST: " .. lbl, 5)
              end
              anyChange = true
            end
            if now - eData.lastSeen > self.eaEmitterMemory then
              j.knownEmitters[eName] = nil  -- expired
              anyChange = true
            end
          else
            -- No memory, drop immediately (legacy behavior)
            if not j.statusActive then
              local lbl = self:_EmitterLabel(eName, eData.sysType, eData.isEW)
              trigger.action.outTextForGroup(j.groupId, "EMITTER LOST: " .. lbl, 5)
            end
            j.knownEmitters[eName] = nil
            anyChange = true
          end
        end
      end
      if anyChange then
        self:_ScheduleMenuRefresh(jamName)
        self:_RefreshJammerStatus(jamName)
      end
    end
  end
end

--- Schedule a deferred F10 menu rebuild for a player jammer.
--- Coalesces multiple requests within the same poll cycle.
function AEGIS:_ScheduleMenuRefresh(jamName)
  local j = self.jammers[jamName]
  if not j or not j.playerControlled or j.menuRefreshScheduled then return end
  j.menuRefreshScheduled = true
  local aegis = self
  timer.scheduleFunction(function()
    local jj = aegis.jammers[jamName]
    if jj and jj.alive and jj.playerControlled and jj.groupId then
      aegis:_CreateJammerF10Menu(jamName, jj.groupId)
    end
    if jj then jj.menuRefreshScheduled = false end
    return nil
  end, nil, timer.getTime() + 0.5)
end

--- Compute the jam effects on a specific EW from all active jammers.
--- Returns a list of effect records, each describing one jammer's influence:
---   { bearingToJammer, isOmni, burnThroughNM, pieHalfWidth }
--- Also returns jamBearing (radians) of strongest jammer.
--- EW burn-through uses physics-based β formula: BT = β / (gainMult × mult) × √dist
function AEGIS:_GetEWJamState(ew)
  if not ew.pos then return {}, 0 end

  local bl = self.jammerBaseline
  local ewDetNM = (ew.detRange > 0) and ew.detRange or 150  -- stock EW range if no cap

  local effects = {}
  local strongestBearing = 0
  local strongestBT = math.huge

  for _, j in pairs(self.jammers) do
    if j.alive and j.active and j.pos then
      -- Bearing and distance from EW to jammer
      local dx = j.pos.x - ew.pos.x
      local dz = j.pos.z - ew.pos.z
      local bearingToJammer = math.atan2(dz, dx)
      local distNM = math.sqrt(dx*dx + dz*dz) / AEGIS.NM_TO_M
      if distNM < 0.1 then distNM = 0.1 end
      local sqrtDist = math.sqrt(distNM)

      -- Check each jam component this jammer produces
      -- OMNI: always produces an omni effect on all EWs
      -- WIDE: cone pod sprays forward — check if EW is in cone
      -- DIR2: no omni, only directional on selected targets

      local omniEffect = nil
      local dirEffect = nil

      if j.mode == "OMNI" then
        -- Full omni: both pods — BT = β / (omniGain × mult) × √dist
        local bt = bl.ewBeta / (bl.omniGain * j.mult) * sqrtDist
        if bt < ewDetNM then
          omniEffect = {
            bearingToJammer = bearingToJammer,
            isOmni = true,
            burnThroughNM = bt,
            pieHalfWidth = bl.omniPieHalfWidth,
          }
        end
      elseif j.mode == "WIDE" then
        -- Wide cone: check if EW is inside configurable cone
        local bearingFromJammer = math.atan2(ew.pos.z - j.pos.z, ew.pos.x - j.pos.x)
        local refBearing = (j.bearingLocked and j.lockedBearing) or j.heading
        local offset = bearingFromJammer - refBearing
        while offset > math.pi do offset = offset - 2 * math.pi end
        while offset < -math.pi do offset = offset + 2 * math.pi end
        local coneHalf = j.wideHalfAngleRad or bl.wideHalfAngleRad
        if math.abs(offset) <= coneHalf then
          local wideGain = j.wideGain or bl.wideGain
          local bt = bl.ewBeta / (wideGain * j.mult) * sqrtDist
          if bt < ewDetNM then
            omniEffect = {
              bearingToJammer = bearingToJammer,
              isOmni = true,
              burnThroughNM = bt,
              pieHalfWidth = coneHalf,
            }
          end
        end
        -- Directional pod: only affects the selected target EW
        if j.pod2Target == ew.name then
          local bt = bl.ewBeta / (bl.dirGain * j.mult) * sqrtDist
          if bt < ewDetNM then
            dirEffect = {
              bearingToJammer = bearingToJammer,
              isOmni = false,
              burnThroughNM = bt,
              pieHalfWidth = bl.directionalPieHalfWidth,
            }
          end
        end
      elseif j.mode == "DIR2" then
        -- Both pods directional: only affect selected targets
        if j.pod1Target == ew.name or j.pod2Target == ew.name then
          local bt = bl.ewBeta / (bl.dirGain * j.mult) * sqrtDist
          if bt < ewDetNM then
            dirEffect = {
              bearingToJammer = bearingToJammer,
              isOmni = false,
              burnThroughNM = bt,
              pieHalfWidth = bl.directionalPieHalfWidth,
            }
          end
        end
      end

      if omniEffect then
        table.insert(effects, omniEffect)
        if omniEffect.burnThroughNM < strongestBT then
          strongestBT = omniEffect.burnThroughNM
          strongestBearing = bearingToJammer
        end
      end
      if dirEffect then
        table.insert(effects, dirEffect)
        if dirEffect.burnThroughNM < strongestBT then
          strongestBT = dirEffect.burnThroughNM
          strongestBearing = bearingToJammer
        end
      end
    end
  end

  return effects, strongestBearing
end

--- Check if a specific contact is masked (jammed) from an EW's perspective.
--- Uses pie geometry + cosine gradient + burn-through distance comparison.
--- @param ew — EW radar node
--- @param contactPos — DCS position {x, y, z} of the contact
--- @param effects — list from _GetEWJamState()
--- @return true if the contact is jammed (should be filtered from the feed)
function AEGIS:_IsContactJammed(ew, contactPos, effects)
  if not ew.pos or not contactPos or #effects == 0 then return false end

  -- Bearing from EW to contact
  local cdx = contactPos.x - ew.pos.x
  local cdz = contactPos.z - ew.pos.z
  local bearingToContact = math.atan2(cdz, cdx)
  local contactDistM = math.sqrt(cdx * cdx + cdz * cdz)
  local contactDistNM = contactDistM / AEGIS.NM_TO_M

  for _, eff in ipairs(effects) do
    -- Angular offset: how far is the contact from the jammer's bearing as seen by the EW?
    local angOffset = bearingToContact - eff.bearingToJammer
    -- Normalize to [-pi, pi]
    while angOffset > math.pi do angOffset = angOffset - 2 * math.pi end
    while angOffset < -math.pi do angOffset = angOffset + 2 * math.pi end

    if math.abs(angOffset) <= eff.pieHalfWidth then
      -- Contact is inside the pie — apply cosine gradient
      -- At boresight (offset=0): full jam. At edge (offset=pieHalfWidth): zero jam.
      local gradient = math.cos(angOffset * (math.pi / 2) / eff.pieHalfWidth)
      -- Effective burn-through with gradient: wider offset = less jam = larger effective BT
      -- gradient=1 at boresight: effectiveBT = burnThroughNM (full jam, contacts far from EW masked)
      -- gradient=0 at edge: effectiveBT = infinity (no jam effect)
      if gradient > 0.01 then
        -- Effective jam range: contactDistNM < (ewDetRange - burnThroughNM) * gradient
        -- Simpler: contact masked if its distance from EW exceeds burnThroughNM / gradient
        local effectiveBT = eff.burnThroughNM / gradient
        if contactDistNM > effectiveBT then
          return true  -- contact is beyond burn-through range, masked by jammer
        end
      end
    end
  end

  return false  -- contact outside all pies or inside burn-through range
end

--- Compute burn-through distance for a jammer affecting a SAM.
--- Returns burn-through range in NM if jammer has effect, or nil if out of range / no effect.
--- SAM-only: EW burn-through uses inline β formula in _GetEWJamState.
--- @param jammer — jammer node from self.jammers
--- @param targetPos — DCS position {x, y, z} of the SAM
--- @param refRange — NM: threshold for "is the SAM jammed?" (sam.wez)
--- @param burnRange — NM: fed into the formula (sam.wez * samTrackingBias)
--- @param gainMult — beam gain multiplier from _BeamGain()
function AEGIS:_ComputeBurnThrough(jammer, targetPos, refRange, burnRange, gainMult)
  if not jammer.pos or not targetPos then return nil end

  local bl = self.jammerBaseline

  -- Gain-scaled range: tighter beam = more energy per steradian = longer reach
  -- rangeMult scales linearly from 1.0 at omniGain, capped at directionalRangeMult
  local rangeMult = 1.0 + (gainMult / bl.omniGain - 1.0) * bl.rangeGainScale
  local maxRange = bl.effectRange * math.min(rangeMult, bl.directionalRangeMult)

  local dx = targetPos.x - jammer.pos.x
  local dz = targetPos.z - jammer.pos.z
  local distNM = math.sqrt(dx * dx + dz * dz) / AEGIS.NM_TO_M

  -- Hard AoE gate at gain-scaled maxRange
  if distNM > maxRange then return nil end
  if distNM < 0.1 then distNM = 0.1 end    -- prevent div-by-zero

  -- Spread factor: inverse of gain (higher gain = lower spread = deeper penetration)
  local spreadFactor = 1.0 / gainMult

  local burnThrough = burnRange * bl.burnThroughRatio
                    * spreadFactor
                    / jammer.mult
                    * math.pow(distNM / maxRange, bl.burnExponent)

  -- If burn-through >= refRange, jammer is too far/weak to have effect on this SAM
  if burnThrough >= refRange then return nil end

  return burnThrough
end

--- Check if a named SAM or EW is currently radiating (emitting radar energy).
--- Used for stale pod-target cleanup and emitter alert scanning.
function AEGIS:_IsTargetRadiating(groupName)
  local sam = self.samSites[groupName]
  if sam then return self:_IsEmitting(sam) end
  local ew = self.ewRadars[groupName]
  if ew then return ew.state ~= AEGIS.STATE.DESTROYED end
  return false
end

--- Check if a SAM is being jammed by any active jammer.
--- Returns: jammed (bool), burnThroughNM (number or nil — closest burn-through distance)
--- Uses physics-based burn-through formula from JAMMER_BASELINE.
function AEGIS:_IsJammed(sam)
  if not sam.pos then return false, nil end

  -- Home-on-Jam: immunity window active — jammer has no effect on this SAM
  if sam.hojUntil > 0 and timer.getTime() < sam.hojUntil then
    return false, nil
  end

  local bl = self.jammerBaseline
  local wez = sam.sysData.wez
  local refRange = wez
  local burnRange = wez * (sam.sysData.trackingBias or bl.samTrackingBias)

  local bestBT = nil  -- track tightest (smallest) burn-through across all jammers

  for _, j in pairs(self.jammers) do
    if j.alive and j.active and j.pos then
      -- Determine if any pod is directional-targeting this SAM
      local isDir = false
      if j.mode == "DIR2" then
        isDir = (j.pod1Target == sam.name) or (j.pod2Target == sam.name)
      elseif j.mode == "WIDE" then
        isDir = (j.pod2Target == sam.name)
      end
      if j.mode == "OMNI" then
        local bt = self:_ComputeBurnThrough(j, sam.pos, refRange, burnRange, bl.omniGain)
        if bt then
          if not bestBT or bt < bestBT then bestBT = bt end
        end
      elseif j.mode == "WIDE" then
        -- Cone pod only affects SAMs inside configurable cone
        local bearingToSam = math.atan2(sam.pos.z - j.pos.z, sam.pos.x - j.pos.x)
        local refBearing = (j.bearingLocked and j.lockedBearing) or j.heading
        local offset = bearingToSam - refBearing
        while offset > math.pi do offset = offset - 2 * math.pi end
        while offset < -math.pi do offset = offset + 2 * math.pi end
        local coneHalf = j.wideHalfAngleRad or bl.wideHalfAngleRad
        if math.abs(offset) <= coneHalf then
          local bt = self:_ComputeBurnThrough(j, sam.pos, refRange, burnRange, j.wideGain or bl.wideGain)
          if bt then
            if not bestBT or bt < bestBT then bestBT = bt end
          end
        end
      end
      if isDir then
        local bt = self:_ComputeBurnThrough(j, sam.pos, refRange, burnRange, bl.dirGain)
        if bt then
          if not bestBT or bt < bestBT then bestBT = bt end
        end
      end
    end
  end

  if bestBT then
    if self.debug then
      self:_Log(string.format("%s: JAMMED (WEZ %.0f, BT %.1f NM, jammed WEZ %.1f-%.0f NM)",
        sam.name, wez, bestBT, bestBT, wez))
    end
    return true, bestBT
  end
  return false, nil
end

---------------------------------------------------------------------------
-- JAMMED EMCON CYCLING (EA effect)
-- When a jammer detects an emitting SAM, the crew shuts down to reduce
-- exposure and enters a separate EMCON cycle with different timing.
-- Uses jammedEmconGen for timer cancellation (independent of emconGen).
---------------------------------------------------------------------------

--- Get jammed EMCON timing for a SAM based on HOJ capability.
--- HOJ-capable SAMs peek aggressively; standard SAMs are cautious.
function AEGIS:_JammedEmconTiming(sam)
  if sam.sysData.homeOnJam then
    return self.jamEmconOnMinHOJ, self.jamEmconOnMaxHOJ,
           self.jamEmconOffMinHOJ, self.jamEmconOffMaxHOJ
  else
    return self.jamEmconOnMinStd, self.jamEmconOnMaxStd,
           self.jamEmconOffMinStd, self.jamEmconOffMaxStd
  end
end

--- Start jammed EMCON cycling. SAM goes dark, then cycles briefly.
--- Called when EW poll detects a jammed emitting SAM.
function AEGIS:_StartJammedEMCON(samName)
  local sam = self.samSites[samName]
  if not sam then return end

  -- Priority: HARM cooldown wins — don't override
  if sam.harmCooldownUntil > timer.getTime() then return end

  -- Already in jammed EMCON?
  if sam.jammedEmconActive then return end

  -- Kill normal EMCON timers to prevent conflicts
  self:_StopEMCON(samName)

  sam.jammedEmconGen = sam.jammedEmconGen + 1
  sam.jammedEmconActive = true
  sam.jammed = true
  sam.hojPeekCount = 0

  self:_Log(samName .. ": JAMMED — entering jammed EMCON cycling", true)

  -- Crew shuts down
  self:_ApplyState(samName, "sam", AEGIS.STATE.DARK)

  -- Schedule first on-phase after random off-duration
  local _, _, offMin, offMax = self:_JammedEmconTiming(sam)
  local offDuration = math.random(offMin, offMax)
  local gen = sam.jammedEmconGen
  local aegis = self
  timer.scheduleFunction(function()
    if sam.jammedEmconGen ~= gen then return nil end
    aegis:_JammedEmconOnPhase(samName, gen)
    return nil
  end, nil, timer.getTime() + offDuration)
end

--- Stop jammed EMCON cycling. Cancels pending timers via generation counter.
function AEGIS:_StopJammedEMCON(samName)
  local sam = self.samSites[samName]
  if not sam then return end

  sam.jammedEmconGen = sam.jammedEmconGen + 1  -- cancel pending timers
  sam.jammedEmconActive = false
  sam.jammed = false
  sam.hojPeekCount = 0
  self:_Log(samName .. ": leaving jammed EMCON")
end

--- Check if any radar-detected contact is inside the burn-through range.
--- Returns true if at least one contact is within burnThroughNM of the SAM.
function AEGIS:_HasBurnThroughContact(samName, burnThroughNM)
  local sam = self.samSites[samName]
  if not sam or not burnThroughNM or not sam.pos then return false end
  local btM = burnThroughNM * AEGIS.NM_TO_M
  local btSq = btM * btM
  local grp = Group.getByName(samName)
  if not grp or not grp:isExist() then return false end
  local ctrl = grp:getController()
  local detected = ctrl:getDetectedTargets(Controller.Detection.RADAR)
  if not detected then return false end
  for _, det in ipairs(detected) do
    if det.object then
      local ok, cpos = pcall(function() return det.object:getPoint() end)
      if ok and cpos then
        local dx = sam.pos.x - cpos.x
        local dz = sam.pos.z - cpos.z
        if (dx * dx + dz * dz) <= btSq then
          return true
        end
      end
    end
  end
  return false
end

--- Jammed EMCON on-phase: brief radar peek. Check if jammer is still present.
--- During the jam detection delay, burn-through contacts are engageable.
function AEGIS:_JammedEmconOnPhase(samName, gen)
  local sam = self.samSites[samName]
  if not sam or sam.jammedEmconGen ~= gen then return end
  if sam.state == AEGIS.STATE.DESTROYED then return end

  -- HARM cooldown takes priority
  if sam.harmCooldownUntil > timer.getTime() then
    -- HARM reaction owns the SAM; schedule retry after cooldown
    local retryAt = sam.harmCooldownUntil + math.random(5, 15)
    local aegis = self
    timer.scheduleFunction(function()
      if sam.jammedEmconGen ~= gen then return nil end
      aegis:_JammedEmconOnPhase(samName, gen)
      return nil
    end, nil, retryAt)
    return
  end

  -- Radar on (brief peek)
  self:_ApplyState(samName, "sam", AEGIS.STATE.EMCON_OFF)

  -- PB HARM check: SAM just turned on — if harmInbound active, HARM takes over
  if self:_TriggerHarmInboundReaction(samName) then
    self:_StopJammedEMCON(samName)
    return
  end

  -- Two-phase peek:
  --   detectDelay (1-3s): crew identifies jammer, check for immediate burn-through
  --   onDuration (8-15s): full peek expires, final check, then go dark
  local detectDelay = math.random(self.jamDetectionDelayMin, self.jamDetectionDelayMax)
  local onMin, onMax = self:_JammedEmconTiming(sam)
  local onDuration = math.random(onMin, onMax)
  local aegis = self

  timer.scheduleFunction(function()
    if sam.jammedEmconGen ~= gen then return nil end
    if sam.state == AEGIS.STATE.DESTROYED then return nil end

    -- Is jammer still there?
    local stillJammed, burnThroughNM = aegis:_IsJammed(sam)
    if not stillJammed then
      -- Jammer left — exit jammed EMCON, poll will restore normal state
      aegis:_StopJammedEMCON(samName)
      aegis:_Log(samName .. ": jammer gone, exiting jammed EMCON")
      return nil
    end

    -- Home-on-Jam roll: HOJ-capable SAM tries to see through the jamming
    if aegis.hojEnabled and sam.sysData.homeOnJam then
      local hojRange = sam.sysData.actRange
      local hojRangeM = hojRange * AEGIS.NM_TO_M
      local hojRangeSq = hojRangeM * hojRangeM
      -- Find nearest active jammer within actRange
      local nearestSq = nil
      for _, j in pairs(aegis.jammers) do
        if j.alive and j.active and j.pos then
          local dx = sam.pos.x - j.pos.x
          local dz = sam.pos.z - j.pos.z
          local dSq = dx * dx + dz * dz
          if dSq <= hojRangeSq then
            if not nearestSq or dSq < nearestSq then nearestSq = dSq end
          end
        end
      end
      if nearestSq and (sam.hojCooldownUntil <= timer.getTime()) then
        sam.hojPeekCount = sam.hojPeekCount + 1
        local chance = aegis.hojBasePct * sam.hojPeekCount
        if math.random() < chance then
          -- HOJ triggered! Jam suppression suspended.
          local peekNum = sam.hojPeekCount
          local window = aegis.hojWindowMin + math.random() * (aegis.hojWindowMax - aegis.hojWindowMin)
          sam.hojUntil = timer.getTime() + window
          sam.hojCooldownUntil = sam.hojUntil + aegis.hojCooldown
          sam.hojPeekCount = 0
          aegis:_StopJammedEMCON(samName)
          aegis:_ApplyState(samName, "sam", AEGIS.STATE.ALERT)
          aegis:_Log(string.format("%s: *** HOJ TRIGGERED (peek #%d, %.0f%%) — weapons free %.0fs",
            samName, peekNum, chance * 100, window), true)
          return nil  -- exit timer chain
        else
          if aegis.debug then
            aegis:_Log(string.format("%s: HOJ roll failed (peek #%d, %.0f%%)",
              samName, sam.hojPeekCount, chance * 100))
          end
        end
      end
    end

    -- Jammer caught us. Immediate burn-through check.
    if aegis:_HasBurnThroughContact(samName, burnThroughNM) then
      aegis:_Log(samName .. ": jammed EMCON burn-through — ALERT, engaging", true)
      aegis:_ApplyState(samName, "sam", AEGIS.STATE.ALERT)
      aegis:_JammedBurnThroughMonitor(samName, gen)
      return nil
    end

    -- Jammed, no burn-through yet. Stay on for the rest of the peek window.
    local remaining = onDuration - detectDelay
    if remaining < 1 then remaining = 1 end

    timer.scheduleFunction(function()
      if sam.jammedEmconGen ~= gen then return nil end
      if sam.state == AEGIS.STATE.DESTROYED then return nil end

      -- End of peek window. Final checks.
      local stillJammed2, bt2 = aegis:_IsJammed(sam)
      if not stillJammed2 then
        aegis:_StopJammedEMCON(samName)
        aegis:_Log(samName .. ": jammer gone, exiting jammed EMCON")
        return nil
      end

      if aegis:_HasBurnThroughContact(samName, bt2) then
        aegis:_Log(samName .. ": jammed EMCON burn-through — ALERT, engaging", true)
        aegis:_ApplyState(samName, "sam", AEGIS.STATE.ALERT)
        aegis:_JammedBurnThroughMonitor(samName, gen)
        return nil
      end

      -- Still jammed, no burn-through — go dark
      aegis:_JammedEmconOffPhase(samName, gen)
      return nil
    end, nil, timer.getTime() + remaining)

    return nil
  end, nil, timer.getTime() + detectDelay)
end

--- Jammed EMCON off-phase: crew hides. Schedule next on-phase.
function AEGIS:_JammedEmconOffPhase(samName, gen)
  local sam = self.samSites[samName]
  if not sam or sam.jammedEmconGen ~= gen then return end
  if sam.state == AEGIS.STATE.DESTROYED then return end

  self:_ApplyState(samName, "sam", AEGIS.STATE.DARK)

  local _, _, offMin, offMax = self:_JammedEmconTiming(sam)
  local offDuration = math.random(offMin, offMax)
  local aegis = self
  timer.scheduleFunction(function()
    if sam.jammedEmconGen ~= gen then return nil end
    aegis:_JammedEmconOnPhase(samName, gen)
    return nil
  end, nil, timer.getTime() + offDuration)
end

--- Monitor burn-through engagement. SAM stays ALERT as long as a contact
--- remains inside burn-through range. When contacts leave, back to off-phase.
--- If jammer leaves entirely, exits jammed EMCON.
function AEGIS:_JammedBurnThroughMonitor(samName, gen)
  local sam = self.samSites[samName]
  if not sam or sam.jammedEmconGen ~= gen then return end

  local aegis = self
  local checkInterval = 5

  local function monitor()
    if sam.jammedEmconGen ~= gen then return nil end
    if sam.state == AEGIS.STATE.DESTROYED then return nil end

    -- HARM reaction took over? Stop monitoring, HARM owns it.
    if sam.harmCooldownUntil > timer.getTime() then return nil end

    -- Is jammer still there?
    local stillJammed, burnThroughNM = aegis:_IsJammed(sam)
    if not stillJammed then
      -- Jammer left — exit jammed EMCON entirely
      aegis:_StopJammedEMCON(samName)
      aegis:_Log(samName .. ": jammer gone during burn-through, exiting jammed EMCON")
      return nil
    end

    -- Check burn-through: any contact still inside burn-through range?
    local stillBurnThrough = aegis:_HasBurnThroughContact(samName, burnThroughNM)

    if stillBurnThrough then
      -- Contact still close — keep engaging
      return timer.getTime() + checkInterval
    else
      -- Contact left burn-through range — crew goes dark
      aegis:_Log(samName .. ": burn-through contact left, returning to jammed EMCON")
      aegis:_JammedEmconOffPhase(samName, gen)
      return nil
    end
  end

  timer.scheduleFunction(monitor, nil, timer.getTime() + checkInterval)
end

---------------------------------------------------------------------------
-- HARM DETECTION (Phase 3) + REACTION POLICIES (Phase 3.2)
---------------------------------------------------------------------------

--- Returns true if a SAM is currently emitting (radar on).
function AEGIS:_IsEmitting(sam)
  return sam.state == AEGIS.STATE.ALERT
      or sam.state == AEGIS.STATE.EMCON_OFF
      or sam.state == AEGIS.STATE.EMCON_ENGAGED
end

--- Check if a PB HARM inbound flag is active on this SAM.
--- Returns true if harmInbound was set and hasn't expired yet.
function AEGIS:_CheckHarmInbound(sam)
  return sam.harmInbound > 0 and timer.getTime() <= sam.harmInboundExpiry
end

--- If harmInbound is active, trigger own-radar detection and HARM reaction.
--- Called when a SAM transitions to an emitting state. Returns true if reaction triggered.
function AEGIS:_TriggerHarmInboundReaction(samName)
  local sam = self.samSites[samName]
  if not sam then return false end
  if not self:_CheckHarmInbound(sam) then return false end

  local now = timer.getTime()
  self:_Log(samName .. ": own-radar HARM detection (harmInbound active)", true)

  -- Record for multi-HARM tracking
  self:_RecordHARMEvent(sam, now)

  -- Clear the flag (consumed)
  sam.harmInbound = 0
  sam.harmInboundExpiry = 0

  -- Schedule reaction with crew delay (same as TOO/SP — classifying fast-closing contact)
  local delay = math.random(self.harmReactionDelayMin, self.harmReactionDelayMax)
  sam.harmReactionGen = sam.harmReactionGen + 1
  local gen = sam.harmReactionGen
  local aegis = self

  -- Freeze state during crew processing — prevents frustration/poll from
  -- overriding a pending HARM reaction
  sam.harmCooldownUntil = now + delay

  self:_Log("  " .. samName .. ": crew processing own-radar HARM (" .. delay .. "s)...", true)

  timer.scheduleFunction(function()
    if sam.state == AEGIS.STATE.DESTROYED then return nil end
    if sam.harmReactionGen ~= gen then return nil end
    aegis:_ExecuteHARMReaction(samName)
    return nil
  end, nil, now + delay)

  return true
end

--- Record a HARM event timestamp and prune entries outside the multi-HARM window.
function AEGIS:_RecordHARMEvent(sam, timestamp)
  table.insert(sam.harmEvents, timestamp)
  -- Prune old entries outside the window
  local cutoff = timestamp - self.harmMultiWindow
  local fresh = {}
  for _, t in ipairs(sam.harmEvents) do
    if t >= cutoff then
      table.insert(fresh, t)
    end
  end
  sam.harmEvents = fresh
end

--- Check if the HARM weapon targeting this SAM is still in flight.
--- Returns false if weapon ref is nil, stale, or destroyed.
function AEGIS:_HARMStillInFlight(sam)
  if not sam.harmWeapon then return false end
  local ok, exists = pcall(function() return sam.harmWeapon:isExist() end)
  return ok and exists
end

--- Check if a SAM has at least one alive PD child.
function AEGIS:_HasLivePD(samName)
  for _, pd in pairs(self.pdSites) do
    if pd.parent == samName and pd.state ~= AEGIS.STATE.DESTROYED then
      local grp = Group.getByName(pd.name)
      if grp and grp:isExist() and grp:getSize() > 0 then
        return true
      end
    end
  end
  return false
end

--- Force all PDs of a given parent to ALERT for HARM defense.
--- Immediate out-of-poll-cycle activation — PD needs to engage NOW.
function AEGIS:_ActivatePDsForHARM(parentName)
  for pdName, pd in pairs(self.pdSites) do
    if pd.parent == parentName and pd.state ~= AEGIS.STATE.DESTROYED then
      self:_ApplyState(pdName, "pd", AEGIS.STATE.ALERT)
      self:_Log("  PD " .. pdName .. ": ALERT for HARM defense")
    end
  end
end

--- Determine the appropriate HARM reaction for a SAM.
--- Pure decision function — no side effects.
--- @return "STAY_HOT" | "LAST_DITCH" | "GO_DARK"
function AEGIS:_DetermineHARMReaction(samName)
  local sam = self.samSites[samName]
  if not sam then return "GO_DARK" end

  -- Multi-HARM saturation: per-SAM threshold (crew personality, randomized at init)
  -- SP + live PD exception: crew has own engagement capability plus point defense — fight through it
  if #sam.harmEvents >= sam.harmMultiThreshold then
    if sam.sysData.selfProtect and self:_HasLivePD(samName) then
      self:_Log("  " .. samName .. ": " .. #sam.harmEvents
                .. " HARMs but SP+PD — fighting through saturation", true)
      return "STAY_HOT"
    end
    self:_Log("  " .. samName .. ": " .. #sam.harmEvents
              .. "/" .. sam.harmMultiThreshold .. " HARMs in "
              .. self.harmMultiWindow .. "s -- MULTI-HARM override", true)
    return "GO_DARK"
  end

  -- Nat 20: any crew might decide today's the day they earn a medal
  if math.random(1, 100) <= self.harmBraveryPct then
    self:_Log("  " .. samName .. ": DEFIANT — crew is fighting back!", true)
    return "STAY_HOT"
  end

  -- Self-protect capable?
  if sam.sysData.selfProtect then
    -- Panic check: crew loses nerve
    if math.random(1, 100) <= self.harmPanicPct then
      self:_Log("  " .. samName .. ": selfProtect but crew PANICKED", true)
      return "GO_DARK"
    end
    return "STAY_HOT"
  end

  -- Has a live PD that can try to engage the ARM?
  if self:_HasLivePD(samName) then
    return "LAST_DITCH"
  end

  -- Neither self-protect nor PD: classic GO_DARK
  return "GO_DARK"
end

--- Execute the determined HARM reaction for a SAM.
--- Called after crew reaction delay. Checks SAM is still emitting before acting.
function AEGIS:_ExecuteHARMReaction(samName)
  local sam = self.samSites[samName]
  if not sam then return end
  if sam.state == AEGIS.STATE.DESTROYED then return end

  -- HARM takes priority over jammed EMCON — cleanly stop it
  if sam.jammedEmconActive then
    self:_StopJammedEMCON(samName)
  end

  -- If SAM went dark naturally during the reaction delay, skip reaction
  -- but still set cooldown to prevent immediate re-ALERT
  if not self:_IsEmitting(sam) then
    self:_Log("  " .. samName .. ": went dark during crew delay, setting cooldown")
    sam.harmCooldownUntil = timer.getTime() + math.random(self.harmCooldownMin, self.harmCooldownMax)
    sam.harmReaction = nil
    return
  end

  local reaction = self:_DetermineHARMReaction(samName)
  local now = timer.getTime()
  sam.harmReaction = reaction

  if reaction == "STAY_HOT" then
    self:_ExecuteStayHot(samName, now)
  elseif reaction == "LAST_DITCH" then
    self:_ExecuteLastDitch(samName, now)
  else
    self:_ExecuteGoDark(samName, now)
  end
end

--- STAY_HOT: SAM has selfProtect capability, engaging ARM with own missiles.
--- Stops EMCON, switches to ALERT (weapons free), sets engagement window cooldown.
function AEGIS:_ExecuteStayHot(samName, now)
  local sam = self.samSites[samName]

  self:_Log("  " .. samName .. ": STAY_HOT (selfProtect, engaging ARM)", true)

  -- Stop EMCON cycle to prevent timer interference
  self:_StopEMCON(samName)

  -- Ensure weapons free — needed if SAM was EMCON_OFF (weapon hold)
  self:_ApplyState(samName, "sam", AEGIS.STATE.ALERT)

  -- Set cooldown to prevent EW poll from de-escalating during engagement
  sam.harmCooldownUntil = now + self.harmStayHotDuration
  sam.harmReactionStart = now

  -- After engagement window, check if HARM is still in flight before expiring
  local aegis = self
  local gen = sam.harmReactionGen
  local function stayHotExpiry()
    if sam.state == AEGIS.STATE.DESTROYED then return nil end
    if sam.harmReactionGen ~= gen then return nil end

    -- HARM still in flight? Extend.
    if aegis:_HARMStillInFlight(sam)
       and (timer.getTime() - sam.harmReactionStart) < aegis.harmMaxCooldown then
      aegis:_Log(samName .. ": STAY_HOT extending, HARM still in flight")
      sam.harmCooldownUntil = timer.getTime() + aegis.harmExtendInterval
      return timer.getTime() + aegis.harmExtendInterval
    end

    sam.harmReaction = nil
    sam.harmWeapon = nil
    aegis:_Log(samName .. ": STAY_HOT window expired, resuming normal ops")
    return nil
  end
  timer.scheduleFunction(stayHotExpiry, nil, now + self.harmStayHotDuration)
end

--- LAST_DITCH: SAM has live PD but no self-protect. PD gets a window to engage
--- the ARM, then parent goes dark.
function AEGIS:_ExecuteLastDitch(samName, now)
  local sam = self.samSites[samName]
  local lastDitchDuration = math.random(self.harmLastDitchMin, self.harmLastDitchMax)
  local cooldown = math.random(self.harmCooldownMin, self.harmCooldownMax)

  self:_Log("  " .. samName .. ": LAST_DITCH (PD engaging, "
            .. lastDitchDuration .. "s then GO_DARK, cooldown " .. cooldown .. "s)", true)

  -- Stop EMCON cycle
  self:_StopEMCON(samName)

  -- Parent stays ALERT during last-ditch window
  self:_ApplyState(samName, "sam", AEGIS.STATE.ALERT)

  -- Force PDs to ALERT immediately (bypass poll cycle)
  self:_ActivatePDsForHARM(samName)

  -- Set cooldown covering the full last-ditch + post-dark period
  sam.harmCooldownUntil = now + lastDitchDuration + cooldown
  sam.harmReactionStart = now

  -- Schedule GO_DARK after last-ditch window
  local aegis = self
  local gen = sam.harmReactionGen
  timer.scheduleFunction(function()
    if sam.state == AEGIS.STATE.DESTROYED then return nil end
    if sam.harmReactionGen ~= gen then return nil end

    aegis:_Log(samName .. ": LAST_DITCH expired, GO_DARK", true)
    aegis:_ApplyState(samName, "sam", AEGIS.STATE.DARK)
    sam.harmReaction = "GO_DARK"
  end, nil, now + lastDitchDuration)

  -- Schedule cooldown expiry with weapon-alive extension
  local function lastDitchExpiry()
    if sam.state == AEGIS.STATE.DESTROYED then return nil end
    if sam.harmReactionGen ~= gen then return nil end

    -- HARM still in flight? Extend.
    if aegis:_HARMStillInFlight(sam)
       and (timer.getTime() - sam.harmReactionStart) < aegis.harmMaxCooldown then
      aegis:_Log(samName .. ": cooldown extending, HARM still in flight")
      sam.harmCooldownUntil = timer.getTime() + aegis.harmExtendInterval
      return timer.getTime() + aegis.harmExtendInterval
    end

    sam.harmReaction = nil
    sam.harmWeapon = nil
    aegis:_Log(samName .. ": HARM cooldown expired, resuming normal ops")
    return nil
  end
  timer.scheduleFunction(lastDitchExpiry, nil, now + lastDitchDuration + cooldown)
end

--- GO_DARK: No self-protect, no PD defense by default. Classic HARM dodge with jittered cooldown.
--- When triggered by panic or multi-HARM override (bypassing LAST_DITCH), activates PDs if available.
function AEGIS:_ExecuteGoDark(samName, now)
  local sam = self.samSites[samName]
  local cooldown = math.random(self.harmCooldownMin, self.harmCooldownMax)

  self:_Log("  " .. samName .. ": GO_DARK (cooldown " .. cooldown .. "s)", true)

  -- Stop EMCON cycle
  self:_StopEMCON(samName)

  -- Go dark
  self:_ApplyState(samName, "sam", AEGIS.STATE.DARK)

  -- Activate PDs for HARM defense (covers panic/multi-HARM bypassing LAST_DITCH)
  if self:_HasLivePD(samName) then
    self:_ActivatePDsForHARM(samName)
  end

  -- Set cooldown
  sam.harmCooldownUntil = now + cooldown
  sam.harmReactionStart = now

  -- Schedule cooldown expiry with weapon-alive extension
  local aegis = self
  local gen = sam.harmReactionGen
  local function goDarkExpiry()
    if sam.state == AEGIS.STATE.DESTROYED then return nil end
    if sam.harmReactionGen ~= gen then return nil end

    -- HARM still in flight? Stay dark longer.
    if aegis:_HARMStillInFlight(sam)
       and (timer.getTime() - sam.harmReactionStart) < aegis.harmMaxCooldown then
      aegis:_Log(samName .. ": cooldown extending, HARM still in flight")
      sam.harmCooldownUntil = timer.getTime() + aegis.harmExtendInterval
      return timer.getTime() + aegis.harmExtendInterval
    end

    sam.harmReaction = nil
    sam.harmWeapon = nil
    aegis:_Log(samName .. ": HARM cooldown expired, resuming normal ops")
    return nil
  end
  timer.scheduleFunction(goDarkExpiry, nil, now + cooldown)
end

---------------------------------------------------------------------------
-- PB HARM NETWORK WARNING (Phase 5)
-- S_EVENT_SHOT catches PB ARM launch → delay → poll weapon for trajectory →
-- project ray → warn networked SAMs in the path.
---------------------------------------------------------------------------

--- Compute EW detection delay for a PB HARM based on range from HARM to sector EWs.
--- Score-per-sweep model: each sweep, EWs contribute detection score based on range.
--- Multiple EWs in sector sum scores each sweep independently.
--- @return delay in seconds, or math.huge if no live EWs can detect
function AEGIS:_ComputeEWDetectionDelay(harmPos, sectorName)
  local sec = self.sectors[sectorName]
  if not sec then return math.huge end

  -- Sum per-sweep score across all live, powered EWs in sector
  local combinedScore = 0
  for _, ewName in ipairs(sec.ew) do
    local ew = self.ewRadars[ewName]
    if ew and ew.state ~= AEGIS.STATE.DESTROYED and ew.pos and self:_NodeHasPower(ew) then
      local g = Group.getByName(ewName)
      if g and g:isExist() then
        local dx = harmPos.x - ew.pos.x
        local dz = harmPos.z - ew.pos.z
        local distM = math.sqrt(dx * dx + dz * dz)
        local distNM = distM / AEGIS.NM_TO_M

        -- Skip this EW if HARM is beyond its detection range
        if ew.detRange > 0 and distNM > ew.detRange then
          -- EW can't see this far, contributes zero score
        else
          -- Look up score from table
          local score = AEGIS.PB_HARM_SCORE_FLOOR
          for _, entry in ipairs(AEGIS.PB_HARM_SCORE_TABLE) do
            if distNM <= entry.maxRange then
              score = entry.score
              break
            end
          end
          combinedScore = combinedScore + score
        end
      end
    end
  end

  if combinedScore <= 0 then return math.huge end

  -- Sweeps needed to reach detection threshold
  local sweeps = math.ceil(self.pbHarmDetThreshold / combinedScore)
  if sweeps < 2 then sweeps = 2 end  -- minimum 2 sweeps for a track file

  local delay = sweeps * self.pbHarmSweepPeriod
  if delay < self.pbHarmDetFloor then delay = self.pbHarmDetFloor end

  return delay
end

--- Check a PB HARM's trajectory and warn networked SAMs in its path.
--- Called once, ~2s after PB launch, when weapon velocity has stabilized.
function AEGIS:_CheckPBHARMTrajectory(weapon)
  -- Is weapon still alive?
  local existOk, exists = pcall(function() return weapon:isExist() end)
  if not existOk or not exists then return end

  -- Get position and velocity
  local posOk, pos = pcall(function() return weapon:getPoint() end)
  local velOk, vel = pcall(function() return weapon:getVelocity() end)
  if not posOk or not pos or not velOk or not vel then return end

  -- Need meaningful horizontal velocity to project
  local vx, vz = vel.x, vel.z
  local speedSq = vx*vx + vz*vz
  if speedSq < 100 then return end  -- < 10 m/s horizontal, can't project

  local warnRadiusM = self.pbHarmWarnRadius * AEGIS.NM_TO_M
  local warnRadiusSq = warnRadiusM * warnRadiusM
  local warned = 0
  local now = timer.getTime()

  for samName, sam in pairs(self.samSites) do
    if sam.state ~= AEGIS.STATE.DESTROYED and sam.pos then
      -- Ray projection: closest point on trajectory to SAM position
      -- Runs for ALL SAMs regardless of EW coverage (harmInbound is universal)
      local wx = sam.pos.x - pos.x
      local wz = sam.pos.z - pos.z
      local dotWV = wx*vx + wz*vz
      local t = dotWV / speedSq  -- t > 0 = SAM is ahead of HARM

      if t > 0 then
        local cx = pos.x + t * vx
        local cz = pos.z + t * vz
        local dx = sam.pos.x - cx
        local dz = sam.pos.z - cz
        local missDistSq = dx*dx + dz*dz

        if missDistSq <= warnRadiusSq then
          local missNM = math.sqrt(missDistSq) / AEGIS.NM_TO_M
          self:_Log("  PB HARM trajectory -> " .. samName
                    .. " (miss: " .. string.format("%.1f", missNM) .. " NM"
                    .. ", ETA: " .. string.format("%.0f", t) .. "s)", true)

          -- 1. ALWAYS set harmInbound flag (own-radar detection path)
          sam.harmInbound = now
          sam.harmInboundExpiry = now + t + self.pbHarmInboundMargin
          self:_Log("  " .. samName .. ": harmInbound set (expires in "
                    .. string.format("%.0f", t + self.pbHarmInboundMargin) .. "s)")

          -- 2. EW network warning path: only if SAM has a live EW
          if sam.sector and self:_SectorHasEW(sam.sector) then
            local ewDelay = self:_ComputeEWDetectionDelay(pos, sam.sector)
            local unitReaction = math.random(self.pbHarmEwReactionMin, self.pbHarmEwReactionMax)
            local totalDelay = ewDelay + unitReaction

            if totalDelay < t then
              -- EW warning arrives before HARM impact — schedule it
              self:_Log("  " .. samName .. ": EW detection delay "
                        .. string.format("%.0f", ewDelay) .. "s + unit reaction "
                        .. unitReaction .. "s = " .. string.format("%.0f", totalDelay) .. "s")
              local aegis = self
              timer.scheduleFunction(function()
                aegis:_WarnSAMofPBHARM(samName, weapon, t - totalDelay)
                return nil
              end, nil, now + totalDelay)
            else
              self:_Log("  " .. samName .. ": EW too slow (delay "
                        .. string.format("%.0f", totalDelay)
                        .. "s > ETA " .. string.format("%.0f", t)
                        .. "s), harmInbound only", true)
            end
          else
            self:_Log("  " .. samName .. ": no EW in sector, harmInbound only")
          end

          warned = warned + 1
        end
      end
    end
  end

  if warned == 0 then
    self:_Log("  PB HARM trajectory: no SAMs in path", true)
  end
end

--- Warn a specific SAM about an inbound PB HARM detected by the network.
--- Decision depends on SAM's current state and capabilities.
function AEGIS:_WarnSAMofPBHARM(samName, weapon, eta)
  local sam = self.samSites[samName]
  if not sam then return end

  local now = timer.getTime()
  local suppressDuration = eta + self.pbHarmCooldownMargin

  if self:_IsEmitting(sam) then
    -- SAM is emitting: treat like a direct HARM reaction
    -- Record event for multi-HARM tracking
    self:_RecordHARMEvent(sam, now)
    sam.harmWeapon = weapon

    -- Use crew reaction delay + normal decision tree
    local delay = math.random(self.harmReactionDelayMin, self.harmReactionDelayMax)
    sam.harmReactionGen = sam.harmReactionGen + 1
    local gen = sam.harmReactionGen
    local aegis = self

    -- Freeze state during crew processing — prevents frustration/poll from
    -- overriding a pending HARM reaction
    sam.harmCooldownUntil = now + delay

    self:_Log("  " .. samName .. ": PB HARM warning (emitting), crew processing ("
              .. delay .. "s)...", true)

    timer.scheduleFunction(function()
      if sam.state == AEGIS.STATE.DESTROYED then return nil end
      if sam.harmReactionGen ~= gen then return nil end
      aegis:_ExecuteHARMReaction(samName)
      return nil
    end, nil, now + delay)

  else
    -- SAM is dark: suppress EMCON sweep, keep it quiet
    -- Extend harmCooldownUntil so the poll won't push it to ALERT
    -- and EMCON won't start a sweep during the HARM's flight window
    local newCooldown = now + suppressDuration

    if newCooldown > sam.harmCooldownUntil then
      sam.harmCooldownUntil = newCooldown

      -- If SAM is in EMCON cycle, stop it to prevent a sweep
      if sam.state == AEGIS.STATE.EMCON_ON or sam.state == AEGIS.STATE.EMCON_OFF
         or sam.state == AEGIS.STATE.EMCON_ENGAGED then
        self:_StopEMCON(samName)
        self:_ApplyState(samName, "sam", AEGIS.STATE.DARK)
      end

      sam.harmReaction = "PB_SUPPRESS"

      self:_Log("  " .. samName .. ": PB HARM warning (dark), suppressing for "
                .. string.format("%.0f", suppressDuration) .. "s", true)

      -- Activate PD if available — PD defends while parent stays dark
      if self:_HasLivePD(samName) then
        self:_ActivatePDsForHARM(samName)
        self:_Log("  " .. samName .. ": PD activated for PB HARM defense")
      end

      -- Schedule suppression expiry
      local aegis = self
      local gen = sam.harmReactionGen
      timer.scheduleFunction(function()
        if sam.state == AEGIS.STATE.DESTROYED then return nil end
        if sam.harmReactionGen ~= gen then return nil end
        sam.harmReaction = nil
        sam.harmCooldownUntil = 0
        aegis:_Log(samName .. ": PB HARM suppression expired, resuming normal ops")
        return nil
      end, nil, newCooldown)
    else
      self:_Log("  " .. samName .. ": PB HARM warning, already suppressed")
    end
  end
end

--- Handle S_EVENT_SHOT: detect anti-radiation missiles targeting our SAMs.
function AEGIS:_OnShot(event)
  local wpn = event.weapon
  if not wpn then return end

  -- Check if weapon is an ARM via descriptor
  local descOk, desc = pcall(function() return wpn:getDesc() end)
  if not descOk or not desc then return end
  if desc.missileCategory ~= AEGIS.HARM_MISSILE_CATEGORY then return end
  if desc.guidance ~= AEGIS.HARM_GUIDANCE then return end  -- Filter out TALDs (guidance=1)

  -- It's an ARM. Get weapon type name for logging.
  local typeOk, typeName = pcall(function() return wpn:getTypeName() end)
  typeName = typeOk and typeName or "unknown ARM"

  -- Who fired it?
  local shooterName = "unknown"
  if event.initiator then
    local snOk, sn = pcall(function() return event.initiator:getName() end)
    shooterName = snOk and sn or "unknown"
  end

  self:_Log("*** HARM LAUNCH: " .. typeName .. " by " .. shooterName, true)

  -- TOO/SP mode: getTarget() returns the specific unit being targeted
  local tgtOk, target = pcall(function() return wpn:getTarget() end)
  if not tgtOk or not target then
    -- PB mode: no direct target. Schedule trajectory check for network warning.
    self:_Log("  HARM target: nil (PB mode) -- scheduling trajectory check", true)
    local wpnRef = wpn
    local aegis = self
    timer.scheduleFunction(function()
      aegis:_CheckPBHARMTrajectory(wpnRef)
      return nil
    end, nil, timer.getTime() + self.pbHarmCheckDelay)
    return
  end

  -- Get the target unit's group name -- that's our key into samSites
  local grpOk, targetGrp = pcall(function() return target:getGroup() end)
  if not grpOk or not targetGrp then
    self:_Log("  HARM target unit has no group -- ignoring")
    return
  end

  local grpNameOk, targetGrpName = pcall(function() return targetGrp:getName() end)
  if not grpNameOk or not targetGrpName then
    self:_Log("  HARM target group name unavailable -- ignoring")
    return
  end

  -- Is this one of our tracked SAMs?
  local sam = self.samSites[targetGrpName]
  if not sam then
    -- HARM targeting a PD? Redirect to parent SAM — co-located, same threat
    local pd = self.pdSites[targetGrpName]
    if pd and pd.parent then
      sam = self.samSites[pd.parent]
      if sam then
        self:_Log("  HARM target: " .. targetGrpName .. " (PD of " .. pd.parent .. "), treating as parent HARM")
        targetGrpName = pd.parent
      end
    end
    if not sam then
      self:_Log("  HARM target: " .. targetGrpName .. " (not a tracked SAM)")
      return
    end
  end

  -- Is this SAM currently emitting?
  if not self:_IsEmitting(sam) then
    self:_Log("  " .. targetGrpName .. ": HARM inbound but NOT emitting -- ignoring")
    return
  end

  -- Detection range gate: SAM tracking radar has finite detection range against small ARM RCS.
  -- HARMs launched beyond harmDetectionRange are not detected until they close to that range.
  local now = timer.getTime()
  local detectionDelay = 0
  if self.harmDetectionRange > 0 and sam.pos then
    local wpnPosOk, wpnPos = pcall(function() return wpn:getPoint() end)
    if wpnPosOk and wpnPos then
      local dx = wpnPos.x - sam.pos.x
      local dz = wpnPos.z - sam.pos.z
      local distM = math.sqrt(dx * dx + dz * dz)
      local detRangeM = self.harmDetectionRange * AEGIS.NM_TO_M
      if distM > detRangeM then
        -- Compute time for HARM to close from launch distance to detection range
        detectionDelay = (distM - detRangeM) / AEGIS.HARM_SPEED
        self:_Log("  " .. targetGrpName .. ": HARM at " .. math.floor(distM / AEGIS.NM_TO_M)
                  .. " NM, detection gated at " .. self.harmDetectionRange
                  .. " NM (+" .. math.floor(detectionDelay) .. "s)", true)
      end
    end
  end

  -- Record HARM event for multi-HARM saturation tracking
  self:_RecordHARMEvent(sam, now)

  -- Store weapon reference for in-flight tracking (cooldown extension)
  sam.harmWeapon = wpn

  -- Problem 1 fix: crew reacts to FIRST HARM only. Subsequent HARMs increment the
  -- multi-HARM counter but do NOT restart the reaction delay timer.
  if sam.harmReactionPending then
    self:_Log("  " .. targetGrpName .. ": additional HARM (#" .. #sam.harmEvents
              .. ") -- counter updated, crew already processing", true)
    return
  end

  -- Schedule delayed reaction (crew processing time)
  local crewDelay = math.random(self.harmReactionDelayMin, self.harmReactionDelayMax)
  local totalDelay = detectionDelay + crewDelay
  sam.harmReactionGen = sam.harmReactionGen + 1
  local gen = sam.harmReactionGen
  local aegis = self
  sam.harmReactionPending = true

  -- Freeze state during crew processing — prevents frustration/poll from
  -- overriding a pending HARM reaction
  sam.harmCooldownUntil = now + totalDelay

  if detectionDelay > 0 then
    self:_Log("  " .. targetGrpName .. ": HARM detected in " .. math.floor(detectionDelay)
              .. "s, crew processing +" .. crewDelay .. "s (" .. math.floor(totalDelay) .. "s total)...", true)
  else
    self:_Log("  " .. targetGrpName .. ": HARM detected, crew processing (" .. crewDelay .. "s)...", true)
  end

  timer.scheduleFunction(function()
    if sam.state == AEGIS.STATE.DESTROYED then return nil end
    if sam.harmReactionGen ~= gen then return nil end  -- superseded

    sam.harmReactionPending = false
    aegis:_ExecuteHARMReaction(targetGrpName)
    return nil
  end, nil, now + totalDelay)
end

---------------------------------------------------------------------------
-- UTILITIES
---------------------------------------------------------------------------

function AEGIS:_Dist(a, b)
  local dx, dy, dz = a.x-b.x, a.y-b.y, a.z-b.z
  return math.sqrt(dx*dx + dy*dy + dz*dz)
end

function AEGIS:_NodeCount()
  local c = 0
  for _ in pairs(self.ewRadars) do c=c+1 end
  for _ in pairs(self.samSites) do c=c+1 end
  for _ in pairs(self.pdSites) do c=c+1 end
  for _ in pairs(self.powerSources) do c=c+1 end
  for _ in pairs(self.commandCenters) do c=c+1 end
  for _ in pairs(self.jammers) do c=c+1 end
  return c
end

function AEGIS:_Log(msg, warn)
  if self.debug or warn then
    local p = warn and "[AEGIS!] " or "[AEGIS] "
    env.info(p .. msg)
    if self.debug then trigger.action.outText(p .. msg, 8) end
  end
end

function AEGIS:_PrintTopology()
  self:_Log("=== TOPOLOGY ===")
  for name, sec in pairs(self.sectors) do
    if name ~= "_AUTO" then
      self:_Log("[" .. name .. "] EW:" .. #sec.ew .. " SAM:" .. #sec.sams 
               .. " PD:" .. #sec.pds .. " CMD:" .. #sec.cmd)
    end
  end
  local pwrCount = 0
  for _ in pairs(self.powerSources) do pwrCount = pwrCount + 1 end
  if pwrCount > 0 then
    self:_Log("PWR sources: " .. pwrCount .. " (per-node)")
    for pwrName, pwr in pairs(self.powerSources) do
      if #pwr.linkedTo > 0 then
        self:_Log("  " .. pwrName .. " -> " .. table.concat(pwr.linkedTo, ", "))
      else
        self:_Log("  " .. pwrName .. " -> UNLINKED")
      end
    end
  end
  local jamCount = 0
  for _ in pairs(self.jammers) do jamCount = jamCount + 1 end
  if jamCount > 0 then
    self:_Log("EA jammers: " .. jamCount)
    for jamName, j in pairs(self.jammers) do
      self:_Log("  " .. jamName .. " [" .. j.jamType .. "] "
                .. (j.active and "ACTIVE" or "INACTIVE")
                .. (j.playerControlled and " (player)" or " (AI)"))
    end
  end
end

---------------------------------------------------------------------------
-- F10 MAP DEBUG
---------------------------------------------------------------------------

function AEGIS:_NextMarkerId()
  AEGIS._markerId = AEGIS._markerId + 1
  return AEGIS._markerId
end

function AEGIS:StartMapDebug(interval)
  interval = interval or 15
  self.mapMarkerIds = {}
  local aegis = self
  
  local function refresh()
    aegis:_UpdateMapMarkers()
    return timer.getTime() + interval
  end
  timer.scheduleFunction(refresh, nil, timer.getTime() + 5)
  self:_Log("Map debug on (every " .. interval .. "s)")
end

function AEGIS:_UpdateMapMarkers()
  -- Clear old
  for _, id in ipairs(self.mapMarkerIds) do
    trigger.action.removeMark(id)
  end
  self.mapMarkerIds = {}
  
  -- EW radars
  for name, n in pairs(self.ewRadars) do
    local g = Group.getByName(name)
    if g and g:isExist() then
      local u = g:getUnit(1)
      if u then
        local id = self:_NextMarkerId()
        local txt = "EW: " .. name
          .. "\nSector: " .. n.sector
          .. "\nState: " .. (n.state == AEGIS.STATE.DESTROYED and "DESTROYED" or (n.hasContacts and "ACTIVE *CONTACTS*" or "ACTIVE"))
        if n.detRange > 0 then
          txt = txt .. "\nDetection: " .. n.detRange .. " NM"
        end
        local sec = self.sectors[n.sector]
        if sec and sec.jammed then
          txt = txt .. "\n*** SECTOR JAMMED ***"
        end
        trigger.action.markToAll(id, txt, u:getPoint())
        table.insert(self.mapMarkerIds, id)
      end
    end
  end
  
  -- SAM sites
  for name, n in pairs(self.samSites) do
    if n.state ~= AEGIS.STATE.DESTROYED and n.pos then
      local g = Group.getByName(name)
      if g and g:isExist() then
        local id = self:_NextMarkerId()
        local zone = self.siteZoneOverrides[name] or self.defaultZone
        local siteRange = self.siteRangeOverrides[name]
        local rangeNM
        if zone == "NEZ" then
          rangeNM = (siteRange and siteRange.nez) or n.sysData.nez
        else
          rangeNM = (siteRange and siteRange.wez) or n.sysData.wez
        end
        local actNM = self.siteActRangeOverrides[name] or n.sysData.actRange or n.sysData.wez
        local txt = "SAM: " .. name
          .. "\nType: " .. n.sysType .. " [" .. n.sysData.cat .. (n.sysData.selfProtect and " SP" or "") .. "]"
          .. "\nSector: " .. (n.sector or "?")
          .. "\nState: " .. n.state
          .. "\n" .. zone .. ": " .. rangeNM .. " NM | ACT: " .. actNM .. " NM"
          .. "\nAlt: " .. n.sysData.altMin .. "-" .. n.sysData.altMax .. " ft"
        if n.powerSource then
          txt = txt .. "\nPWR: " .. n.powerSource .. (self:_NodeHasPower(n) and " [ON]" or " [OFF]")
        end
        -- Show EMCON jitter info in debug
        if n.state == AEGIS.STATE.EMCON_ON or n.state == AEGIS.STATE.EMCON_OFF then
          txt = txt .. "\nSweeps w/o detect: " .. n.sweepsSinceDetect
          if n.spooked then txt = txt .. " *SPOOKED*" end
        end
        if n.harmCooldownUntil > timer.getTime() then
          local remaining = math.ceil(n.harmCooldownUntil - timer.getTime())
          local reaction = n.harmReaction or "GO_DARK"
          if reaction == "STAY_HOT" and not n.sysData.selfProtect then
            txt = txt .. "\n*** HARM: DEFIANT (crew fighting back!) " .. remaining .. "s ***"
          elseif reaction == "STAY_HOT" then
            txt = txt .. "\n*** HARM: STAY_HOT (selfProtect) " .. remaining .. "s ***"
          elseif reaction == "LAST_DITCH" then
            txt = txt .. "\n*** HARM: LAST_DITCH (PD engaging) " .. remaining .. "s ***"
          elseif reaction == "PB_SUPPRESS" then
            txt = txt .. "\n*** PB HARM: SUPPRESSED (network warn) " .. remaining .. "s ***"
          else
            txt = txt .. "\n*** HARM DODGE: " .. remaining .. "s ***"
          end
        end
        if self:_CheckHarmInbound(n) then
          local remaining = math.ceil(n.harmInboundExpiry - timer.getTime())
          txt = txt .. "\n*** PB HARM INBOUND: " .. remaining .. "s ***"
        end
        if n.hojUntil > 0 and n.hojUntil > timer.getTime() then
          local remaining = math.ceil(n.hojUntil - timer.getTime())
          txt = txt .. "\n*** HOJ — WEAPONS FREE: " .. remaining .. "s ***"
        end
        if n.jammedEmconActive then
          if n.state == AEGIS.STATE.ALERT then
            txt = txt .. "\n*** BURN-THROUGH (EA) ***"
          else
            txt = txt .. "\n*** JAMMED EMCON (EA) ***"
          end
        elseif n.jammed then
          txt = txt .. "\n*** JAMMED (EA) ***"
        end
        trigger.action.markToAll(id, txt, n.pos)
        table.insert(self.mapMarkerIds, id)
      end
    end
  end

  -- PD sites
  for name, n in pairs(self.pdSites) do
    if n.state ~= AEGIS.STATE.DESTROYED and n.pos then
      local g = Group.getByName(name)
      if g and g:isExist() then
        local id = self:_NextMarkerId()
        local txt = "PD: " .. name
          .. "\nType: " .. n.sysType
          .. "\nParent: " .. (n.parent or "none")
          .. "\nState: " .. n.state
        -- Show HARM defense status when PD is ALERT due to parent cooldown
        if n.parent and n.state == AEGIS.STATE.ALERT then
          local parentSam = self.samSites[n.parent]
          if parentSam and parentSam.harmCooldownUntil and timer.getTime() < parentSam.harmCooldownUntil then
            local remaining = math.ceil(parentSam.harmCooldownUntil - timer.getTime())
            txt = txt .. "\n*** HARM DEFENSE: " .. remaining .. "s ***"
          end
        end
        trigger.action.markToAll(id, txt, n.pos)
        table.insert(self.mapMarkerIds, id)
      end
    end
  end
  
  -- Power
  for name, n in pairs(self.powerSources) do
    local pos = nil
    local g = Group.getByName(name)
    if g and g:isExist() then
      local u = g:getUnit(1); if u then pos = u:getPoint() end
    else
      local s = StaticObject.getByName(name)
      if s and s:isExist() then pos = s:getPoint() end
    end
    if pos then
      local id = self:_NextMarkerId()
      local txt = "PWR: " .. name
        .. "\nTarget: " .. (n.targetHint or "unknown")
        .. "\nLinked: " .. (#n.linkedTo > 0 and table.concat(n.linkedTo, ", ") or "none")
        .. "\nStatus: " .. (n.alive and "ONLINE" or "** OFFLINE **")
      trigger.action.markToAll(id, txt, pos)
      table.insert(self.mapMarkerIds, id)
    end
  end
  
  -- Command
  for name, n in pairs(self.commandCenters) do
    local g = Group.getByName(name)
    if g and g:isExist() then
      local u = g:getUnit(1)
      if u then
        local id = self:_NextMarkerId()
        local txt = "CMD: " .. name
          .. "\nSector: " .. n.sector
          .. "\nStatus: " .. (n.alive and "ONLINE" or "** DESTROYED **")
        trigger.action.markToAll(id, txt, u:getPoint())
        table.insert(self.mapMarkerIds, id)
      end
    end
  end

  -- EA Jammers
  for name, j in pairs(self.jammers) do
    if j.alive and j.pos then
      local id = self:_NextMarkerId()
      local bl = self.jammerBaseline
      local modeLabels = { OMNI="FULL OMNI", WIDE="WIDE", DIR2="2xDIR", OFF="OFF" }
      local hdgDeg = math.floor(math.deg(j.heading) + 0.5) % 360
      local txt = "EA: " .. name
        .. "\nType: " .. j.jamType .. " (x" .. j.mult .. ")"
        .. "\nMode: " .. (modeLabels[j.mode] or j.mode)
        .. "\nActive: " .. (j.active and "YES" or "NO")
        .. "\nHDG: " .. hdgDeg
        .. "\nRange: " .. bl.effectRange .. " NM (omni) / "
        .. (bl.effectRange * bl.directionalRangeMult) .. " NM (dir)"
      if j.mode == "WIDE" then
        if j.bearingLocked then
          txt = txt .. "\nPod 1: WIDE BRG " .. (math.floor(math.deg(j.lockedBearing) + 0.5) % 360)
        else
          txt = txt .. "\nPod 1: WIDE HDG"
        end
        txt = txt .. "\nPod 2: " .. (j.pod2Target or "unassigned")
      elseif j.mode == "DIR2" then
        txt = txt .. "\nPod 1: " .. (j.pod1Target or "unassigned")
        txt = txt .. "\nPod 2: " .. (j.pod2Target or "unassigned")
      end
      txt = txt .. (j.playerControlled and "\n(Player)" or "\n(AI)")
      trigger.action.markToAll(id, txt, j.pos)
      table.insert(self.mapMarkerIds, id)
    end
  end
end

---------------------------------------------------------------------------
-- F10 MENU
---------------------------------------------------------------------------

function AEGIS:GetStatusReport()
  local l = { "=== AEGIS " .. self.side .. " ===" }
  for name, sec in pairs(self.sectors) do
    if name ~= "_AUTO" then
      local jamTag = ""
      if sec.jammed then jamTag = " JAM:YES" end
      table.insert(l, "\n[" .. name .. "]"
        .. " C2:" .. (self:_SectorHasC2(name) and "UP" or "DOWN")
        .. " EW:" .. (self:_SectorHasEW(name) and "UP" or "DOWN")
        .. jamTag)
      for _, s in ipairs(sec.sams) do
        local n = self.samSites[s]
        if n then 
          local pwrStr = ""
          if n.powerSource then
            pwrStr = self:_NodeHasPower(n) and " PWR:ON" or " PWR:OFF"
          end
          local harmStr = ""
          if n.harmCooldownUntil > timer.getTime() then
            local remaining = math.ceil(n.harmCooldownUntil - timer.getTime())
            local reaction = n.harmReaction or "GO_DARK"
            harmStr = " *HARM:" .. reaction .. " " .. remaining .. "s*"
          end
          local hojStr = ""
          if n.hojUntil > 0 and n.hojUntil > timer.getTime() then
            local remaining = math.ceil(n.hojUntil - timer.getTime())
            hojStr = " *HOJ:" .. remaining .. "s*"
          end
          local jamStr = ""
          if n.jammedEmconActive and n.state == AEGIS.STATE.ALERT then
            jamStr = " *BURN-THRU*"
          elseif n.jammedEmconActive then
            jamStr = " *JAM-EMCON*"
          elseif n.jammed then
            jamStr = " *JAMMED*"
          end
          table.insert(l, "  " .. s .. " [" .. n.state .. "]" .. pwrStr .. harmStr .. hojStr .. jamStr)
        end
      end
      for _, p in ipairs(sec.pds) do
        local n = self.pdSites[p]
        if n then table.insert(l, "  " .. p .. " [" .. n.state .. "] -> " .. (n.parent or "?")) end
      end
    end
  end
  -- EA jammers
  local jamCount = 0
  local jamActive = 0
  for _, j in pairs(self.jammers) do
    if j.alive then
      jamCount = jamCount + 1
      if j.active then jamActive = jamActive + 1 end
    end
  end
  if jamCount > 0 then
    table.insert(l, "\n[EA] " .. jamActive .. "/" .. jamCount .. " active")
    local modeLabels = { OMNI="OMNI", WIDE="WIDE", DIR2="2xDIR", OFF="OFF" }
    for name, j in pairs(self.jammers) do
      if j.alive then
        table.insert(l, "  " .. name .. " [" .. j.jamType .. " x" .. j.mult .. "] "
          .. (modeLabels[j.mode] or j.mode)
          .. (j.active and " ON" or " OFF")
          .. (j.playerControlled and " (player)" or " (AI)"))
      end
    end
  end
  return table.concat(l, "\n")
end

function AEGIS:ShowStatus(dur)
  trigger.action.outText(self:GetStatusReport(), dur or 15)
end

function AEGIS:AddF10Menu(menuName)
  menuName = menuName or "AEGIS IADS"
  local root = missionCommands.addSubMenu(menuName)
  local a = self
  missionCommands.addCommand("Status", root, function() a:ShowStatus(20) end)
  missionCommands.addCommand("Topology", root, function() a:_PrintTopology() end)
  missionCommands.addCommand("Refresh Map", root, function() a:_UpdateMapMarkers() end)
end

---------------------------------------------------------------------------
-- EA GUI BRIDGE
-- Global functions called by the EA socket listener (below) and available
-- to any hook script overlay. Query and command the jammer system.
---------------------------------------------------------------------------

--- Find the jammer group containing a player by their DCS player name.
--- Uses explicit jammerPlayers tracking table (populated by _OnBirthEA and _FindJammerBySlot).
--- Returns jammerName, jammerTable or nil, nil.
function AEGIS:_FindJammerByPlayer(playerName)
  local groupName = self.jammerPlayers[playerName]
  if groupName then
    local j = self.jammers[groupName]
    if j and j.alive then return groupName, j end
  end
  return nil, nil
end

--- Find the jammer group by DCS slot ID (e.g., "207" or "207_2").
--- Strips seat suffix (_2, _3) to get unit ID, then looks up eaUnitMap.
--- On success, caches playerName in jammerPlayers for future fast lookups.
--- Returns jammerName, jammerTable or nil, nil.
function AEGIS:_FindJammerBySlot(slot, playerName)
  if not slot then return nil, nil end
  -- Strip seat suffix: "207_2" → "207"
  local unitId = slot:match("^(%d+)")
  if not unitId then return nil, nil end
  local groupName = self.eaUnitMap[unitId]
  if not groupName then return nil, nil end
  local j = self.jammers[groupName]
  if not j or not j.alive then return nil, nil end
  -- Cache for future lookups
  if playerName then
    self.jammerPlayers[playerName] = groupName
  end
  return groupName, j
end

--- Global state query for hook script GUI.
--- Returns pipe-delimited string (11 fields):
---   groupName|mode|active|heading|brgLocked|lockedBrg|p1Target|p2Target|emitters|magDec|widePreset
--- where emitters = comma-separated "name;displayLabel;brg;strength;staleFlag" entries.
--- Returns "" if no AEGIS instance, player not in a jammer, or jammer not alive.
function AEGIS_EA_GET_STATE(playerName, slot)
  if not AEGIS._instance then return "" end
  local inst = AEGIS._instance
  local jamName, j = inst:_FindJammerByPlayer(playerName)
  if not jamName or not j then
    -- Fallback: slot-based lookup (copilot/WSO seats don't fire S_EVENT_BIRTH)
    jamName, j = inst:_FindJammerBySlot(slot, playerName)
  end
  if not jamName or not j then
    -- SP fallback: slot maps to a jammer but name lookup failed (SP name mismatch).
    -- If slot doesn't map to a jammer unit, the player isn't in one — no guessing.
    if slot then
      local baseSlot = slot:match("^(%d+)")
      if baseSlot and inst.eaUnitMap[baseSlot] then
        local gn = inst.eaUnitMap[baseSlot]
        local jj = inst.jammers[gn]
        if jj and jj.alive then
          jamName, j = gn, jj
          inst.jammerPlayers[playerName] = gn
          inst:_Log("EA GUI: SP fallback (slot " .. baseSlot .. ") matched " .. playerName .. " -> " .. gn, true)
        end
      end
    end
  end
  if not jamName or not j then return "" end

  local hdg = math.floor(math.deg(j.heading) + 0.5) % 360
  local brgLocked = j.bearingLocked and "1" or "0"
  local lockedBrg = math.floor(math.deg(j.lockedBearing) + 0.5) % 360
  local p1 = j.pod1Target or ""
  local p2 = j.pod2Target or ""

  -- Build emitter list from knownEmitters (name;displayLabel;absBrg;strength;stale)
  local emitterParts = {}
  if j.knownEmitters and j.pos then
    for eName, eData in pairs(j.knownEmitters) do
      local ePos, refRange = nil, 200
      local isEW = eData.isEW
      local sysType = eData.sysType
      local sam = inst.samSites[eName]
      if sam and sam.pos then
        ePos = sam.pos
        refRange = sam.sysData and sam.sysData.actRange or 30
      else
        local ew = inst.ewRadars[eName]
        if ew and ew.pos then
          ePos = ew.pos
          refRange = (ew.detRange > 0) and ew.detRange or 200
        end
      end
      if ePos then
        local brg = math.deg(math.atan2(ePos.z - j.pos.z, ePos.x - j.pos.x))
        brg = math.floor(brg + 0.5) % 360
        local distNM = math.sqrt(eData.distSq) / AEGIS.NM_TO_M
        local str = inst:_EmitterStrength(distNM, refRange)
        local displayLabel = inst:_EmitterLabel(eName, sysType, isEW)
        local staleFlag = (eData.stale and "1" or "0")
        table.insert(emitterParts, eName .. ";" .. displayLabel .. ";" .. brg .. ";" .. str .. ";" .. staleFlag)
      end
    end
  end

  local active = j.active and "1" or "0"
  local magDec = j.magDeclination and tostring(j.magDeclination) or ""
  return jamName .. "|" .. j.mode .. "|" .. active .. "|" .. hdg
      .. "|" .. brgLocked .. "|" .. lockedBrg
      .. "|" .. p1 .. "|" .. p2
      .. "|" .. table.concat(emitterParts, ",")
      .. "|" .. magDec
      .. "|" .. (j.widePreset or "W70")
end

--- Global command function for hook script GUI.
--- Parses colon-delimited command, executes, rebuilds F10 menu.
--- Returns "OK" or "ERR:reason".
function AEGIS_EA_CMD(playerName, cmdStr, slot)
  if not AEGIS._instance then return "ERR:no instance" end
  local inst = AEGIS._instance
  local jamName, j = inst:_FindJammerByPlayer(playerName)
  if not jamName or not j then
    jamName, j = inst:_FindJammerBySlot(slot, playerName)
  end
  if not jamName or not j then
    -- SP fallback: slot maps to a jammer but name lookup failed (SP name mismatch).
    -- If slot doesn't map to a jammer unit, the player isn't in one — no guessing.
    if slot then
      local baseSlot = slot:match("^(%d+)")
      if baseSlot and inst.eaUnitMap[baseSlot] then
        local gn = inst.eaUnitMap[baseSlot]
        local jj = inst.jammers[gn]
        if jj and jj.alive then
          jamName, j = gn, jj
          inst.jammerPlayers[playerName] = gn
          inst:_Log("EA GUI: SP fallback (slot " .. baseSlot .. ") matched " .. playerName .. " -> " .. gn, true)
        end
      end
    end
  end
  if not jamName or not j then return "ERR:not in jammer" end

  -- Parse colon-delimited command
  local parts = {}
  for part in cmdStr:gmatch("[^:]+") do
    table.insert(parts, part)
  end
  local cmd = parts[1]

  if cmd == "SET_MODE" then
    local modeKey = parts[2]
    if modeKey == "OMNI" then
      j.mode = "OMNI"; j.active = true
      j.pod1Target = nil; j.pod2Target = nil; j.bearingLocked = false
    elseif modeKey == "WIDE" then
      j.mode = "WIDE"; j.active = true
      j.pod1Target = nil  -- pod 1 is cone in this mode
    elseif modeKey == "DIR2" then
      j.mode = "DIR2"; j.active = true
    elseif modeKey == "OFF" then
      j.mode = "OFF"; j.active = false
      j.pod1Target = nil; j.pod2Target = nil; j.bearingLocked = false
    else
      return "ERR:unknown mode"
    end
    inst:_Log(jamName .. ": EA mode -> " .. modeKey .. " (GUI)", true)

  elseif cmd == "SET_POD" then
    local podNum = tonumber(parts[2])
    local target = parts[3]
    if not target then return "ERR:no target" end
    if podNum == 1 then j.pod1Target = target
    elseif podNum == 2 then j.pod2Target = target
    else return "ERR:invalid pod" end
    inst:_Log(jamName .. ": pod" .. podNum .. " -> " .. target .. " (GUI)", true)

  elseif cmd == "UNASSIGN" then
    local podNum = tonumber(parts[2])
    if podNum == 1 then j.pod1Target = nil
    elseif podNum == 2 then j.pod2Target = nil
    else return "ERR:invalid pod" end
    inst:_Log(jamName .. ": pod" .. podNum .. " unassigned (GUI)", true)

  elseif cmd == "LOCK_BRG" then
    j.bearingLocked = true
    j.lockedBearing = j.heading
    inst:_Log(jamName .. ": BRG locked (GUI)", true)

  elseif cmd == "UNLOCK_BRG" then
    j.bearingLocked = false
    inst:_Log(jamName .. ": BRG unlocked (GUI)", true)

  elseif cmd == "SET_BRG" then
    local brgVal = tonumber(parts[2])
    local mode = parts[3] or "REL"  -- backward compat with old hooks
    if brgVal and brgVal >= 0 and brgVal < 360 then
      j.bearingLocked = true
      if mode == "ABS" and j.magDeclination then
        -- Magnetic input -> true: add declination
        j.lockedBearing = math.rad(brgVal + j.magDeclination)
      else
        -- Relative input -> true: add current heading
        j.lockedBearing = j.heading + math.rad(brgVal)
      end
      while j.lockedBearing >= 2 * math.pi do j.lockedBearing = j.lockedBearing - 2 * math.pi end
      while j.lockedBearing < 0 do j.lockedBearing = j.lockedBearing + 2 * math.pi end
      inst:_Log(jamName .. ": BRG set " .. mode .. " " .. brgVal .. "° -> TRUE " ..
          math.floor(math.deg(j.lockedBearing)) .. "° (GUI)", true)
    end

  elseif cmd == "CALIBRATE" then
    local hdgDeg = math.floor(math.deg(j.heading) + 0.5) % 360
    j.magDeclination = hdgDeg
    inst:_Log(jamName .. ": MAG calibrated (declination=" .. hdgDeg .. "°) (GUI)", true)

  elseif cmd == "SET_WIDE" then
    local presetLabel = parts[2]
    local found = false
    for _, p in ipairs(AEGIS.WIDE_PRESETS) do
      if p.label == presetLabel then
        j.wideGain = p.gain
        j.wideHalfAngleRad = p.angleRad
        j.widePreset = p.label
        found = true
        break
      end
    end
    if not found then return "ERR:unknown preset" end
    inst:_Log(jamName .. ": WIDE preset -> " .. presetLabel .. " (GUI)", true)

  else
    return "ERR:unknown cmd"
  end

  -- Rebuild F10 menu so it stays in sync with GUI changes
  inst:_CreateJammerF10Menu(jamName, j.groupId)
  return "OK"
end

---------------------------------------------------------------------------
-- EA GUI Socket Listener (optional — requires require('socket') to be
-- available, i.e. MissionScripting.lua must NOT sanitize require/package).
-- If unavailable, silently no-ops. F10 menus always work regardless.
--
-- Protocol (plain ASCII over UDP, port 19410):
--   Client→Server  REQ:<playerName>              state request
--   Server→Client  S:<pipe-delimited state>      state response
--   Client→Server  CMD:<playerName>:<command>    command
--   Server→Client  R:<result>                    command result
---------------------------------------------------------------------------

do
  -- LuaSocket isn't on the mission env's default package.path.
  -- DCS mission scripts run with cwd = DCS install dir, so relative paths work.
  -- lfs is sanitized in mission env, so we can't use lfs.currentdir().
  if package then
    package.path  = "LuaSocket/?.lua;"  .. (package.path or "")
    package.cpath = "bin/?.dll;"         .. (package.cpath or "")
  end
  local ok, socket = pcall(require, "socket")
  if not ok or not socket then
    env.info("[AEGIS] EA socket: require('socket') not available — F10 menus only")
  else
    local EA_PORT = 19410
    local MAX_RECV = 50

    function AEGIS:_StartEASocket()
      local udp = socket.udp()
      if not udp then
        self:_Log("EA socket: failed to create UDP socket", true)
        return
      end
      local ok, err = udp:setsockname("*", EA_PORT)
      if not ok then
        self:_Log("EA socket: bind *:" .. EA_PORT .. " failed: " .. tostring(err), true)
        udp:close()
        return
      end
      udp:settimeout(0)
      self._eaSocket = udp
      self:_Log("EA socket: listening on UDP " .. EA_PORT)

      -- Poll timer: check for incoming requests every 0.5s
      local aegis = self
      local function eaPoll()
        if not aegis._eaSocket then return nil end  -- stop if socket closed
        local ok, err = pcall(function()
          local sock = aegis._eaSocket
          for _ = 1, MAX_RECV do
            local data, srcIP, srcPort = sock:receivefrom()
            if not data then break end

            if data:sub(1, 4) == "REQ:" then
              -- Format: REQ:playerName or REQ:playerName\0slot
              -- Null byte delimiter (player names can contain tabs/pipes but not null)
              local identity = data:sub(5)
              local playerName, slot
              local nulPos = identity:find("\0", 1, true)
              if nulPos then
                playerName = identity:sub(1, nulPos - 1)
                slot = identity:sub(nulPos + 1)
              else
                playerName = identity
              end
              local state = AEGIS_EA_GET_STATE(playerName, slot)
              if aegis.debug then
                env.info("[AEGIS] EA REQ from " .. srcIP .. ":" .. srcPort .. " player='" .. playerName .. "' slot=" .. tostring(slot) .. " resp=" .. (#state > 0 and #state .. " chars" or "EMPTY"))
              end
              sock:sendto("S:" .. state, srcIP, srcPort)

            elseif data == "DUMP" then
              -- Full IADS state dump for companion visualizer
              local parts = {}
              -- SAMs: name;x;z;state;sysType;wez;actRange;jammed;sector
              local samParts = {}
              for name, sam in pairs(aegis.samSites) do
                if sam.state ~= AEGIS.STATE.DESTROYED then
                  local x = sam.pos and math.floor(sam.pos.x) or 0
                  local z = sam.pos and math.floor(sam.pos.z) or 0
                  local wez = sam.sysData and sam.sysData.wez or 0
                  local act = sam.sysData and sam.sysData.actRange or 0
                  table.insert(samParts, name .. ";" .. x .. ";" .. z .. ";" .. sam.state
                    .. ";" .. (sam.sysType or "?") .. ";" .. wez .. ";" .. act
                    .. ";" .. (sam.jammed and "1" or "0") .. ";" .. (sam.sector or "?"))
                end
              end
              -- EWs: name;x;z;sector;hasContacts;detRange
              local ewParts = {}
              for name, ew in pairs(aegis.ewRadars) do
                if ew.state ~= AEGIS.STATE.DESTROYED then
                  local x = ew.pos and math.floor(ew.pos.x) or 0
                  local z = ew.pos and math.floor(ew.pos.z) or 0
                  table.insert(ewParts, name .. ";" .. x .. ";" .. z .. ";" .. (ew.sector or "?")
                    .. ";" .. (ew.hasContacts and "1" or "0") .. ";" .. (ew.detRange or 0))
                end
              end
              -- Jammers: name;x;z;mode;heading;active;jamType;effectRange;p1Target;p2Target;bearingLocked;lockedBearing;wideHalfAngle
              local jamParts = {}
              for name, jam in pairs(aegis.jammers) do
                if jam.alive then
                  local x = jam.pos and math.floor(jam.pos.x) or 0
                  local z = jam.pos and math.floor(jam.pos.z) or 0
                  local hdg = jam.heading and math.floor(math.deg(jam.heading)) or 0
                  local bl = AEGIS.JAMMER_BASELINE
                  local efr = bl.effectRange
                  local wideHA = jam.wideHalfAngleRad and math.floor(math.deg(jam.wideHalfAngleRad)) or bl.wideHalfAngle
                  table.insert(jamParts, name .. ";" .. x .. ";" .. z .. ";" .. (jam.mode or "OFF")
                    .. ";" .. hdg .. ";" .. (jam.active and "1" or "0") .. ";" .. (jam.jamType or "?")
                    .. ";" .. efr .. ";" .. (jam.pod1Target or "") .. ";" .. (jam.pod2Target or "")
                    .. ";" .. (jam.bearingLocked and "1" or "0")
                    .. ";" .. (jam.lockedBearing and math.floor(math.deg(jam.lockedBearing)) or 0)
                    .. ";" .. wideHA)
                end
              end
              -- Sectors: name;jammed;jamBearing
              local secParts = {}
              for name, sec in pairs(aegis.sectors) do
                secParts[#secParts+1] = name .. ";" .. (sec.jammed and "1" or "0")
                  .. ";" .. math.floor(math.deg(sec.jamBearing or 0))
              end
              local resp = "D:" .. table.concat(samParts, "|")
                .. "\n" .. table.concat(ewParts, "|")
                .. "\n" .. table.concat(jamParts, "|")
                .. "\n" .. table.concat(secParts, "|")
              sock:sendto(resp, srcIP, srcPort)

            elseif data:sub(1, 4) == "CMD:" then
              -- Format: CMD:playerName\0slot:cmdStr or CMD:playerName:cmdStr
              -- Null byte separates playerName from slot; first colon after slot = cmdStr
              local payload = data:sub(5)
              local playerName, slot, cmdStr
              local nulPos = payload:find("\0", 1, true)
              if nulPos then
                playerName = payload:sub(1, nulPos - 1)
                local rest = payload:sub(nulPos + 1)
                local colonPos = rest:find(":", 1, true)
                if colonPos then
                  slot = rest:sub(1, colonPos - 1)
                  cmdStr = rest:sub(colonPos + 1)
                end
              else
                -- No null = old format: playerName:cmdStr (first colon splits)
                local colonPos = payload:find(":", 1, true)
                if colonPos then
                  playerName = payload:sub(1, colonPos - 1)
                  cmdStr = payload:sub(colonPos + 1)
                end
              end
              if playerName and cmdStr then
                local result = AEGIS_EA_CMD(playerName, cmdStr, slot)
                sock:sendto("R:" .. result, srcIP, srcPort)
              else
                sock:sendto("R:ERR:malformed CMD", srcIP, srcPort)
              end
            end
          end
        end)
        if not ok then
          env.info("[AEGIS!] EA poll error: " .. tostring(err))
        end
        return timer.getTime() + 0.5
      end
      timer.scheduleFunction(eaPoll, nil, timer.getTime() + 1)
    end

    function AEGIS:_StopEASocket()
      if self._eaSocket then
        self._eaSocket:close()
        self._eaSocket = nil
        self:_Log("EA socket: closed")
      end
    end
  end
end
