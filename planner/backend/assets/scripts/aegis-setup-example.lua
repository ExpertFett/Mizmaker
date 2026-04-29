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
  AEGIS v0.7.3 Test Setup

  Load order in ME triggers:
    1. aegis-iads.lua       (TIME MORE 1)
    2. aegis-test-setup.lua (TIME MORE 2)

  NO MOOSE REQUIRED.

  ME Group naming (zone override via name suffix):
    EW-NORTH                    1L13 or 55G6 EWR
    EW-NORTH-DET120             EWR with 120 NM detection cap
    SAM-SA10-NORTH-1            S-300 using default WEZ (40 NM)
    SAM-SA10-NORTH-2-NEZ        S-300 using NEZ (20 NM) — ambush
    SAM-SA6-SOUTH-1-NEZ25       SA-6 using NEZ at 25 NM
    SAM-SA6-SOUTH-2-WEZ10       SA-6 with reduced WEZ (10 NM)
    PD-SA15-NORTH-1             SA-15, place within 5 NM of parent SAM
    PWR-SOUTH-1                 External power (only for fixed sites)
    ECM-GROWLER-BENGAL-1        ECM aircraft (opposing coalition, requires ecmEnabled)
--]]

local iads = AEGIS:New("red", {
  ewPollInterval     = 10,
  alertTimeout       = 60,
  pdAssociateRange   = 5,
  defaultZone        = "WEZ",
  -- EMCON timing
  emconOnMin         = 30,     -- silent phase min (seconds)
  emconOnMax         = 120,    -- silent phase max
  emconOffMin        = 15,     -- sweep phase min
  emconOffMax        = 45,     -- sweep phase max
  emconDetectDelay   = 5,
  emconReengageMin     = 10,
  emconReengageMax     = 30,
  -- EMCON jitter
  emconStartupJitter   = 60,   -- max random delay before first EMCON cycle
  emconDoubleSweepPct  = 15,   -- % chance of quick double-sweep
  emconEarlyTermPct    = 20,   -- % chance of cutting sweep short (quick peek)
  emconThreatScale     = 0.5,  -- silent phase shorter when threat recently seen
  emconRelaxedScale    = 1.5,  -- silent phase longer after 3+ empty sweeps
  emconSpookDuration   = 120,  -- seconds of extended silence after nearby SAM death
  emconSpookEnabled    = false, -- neighbor spook (off by default, enable for realism)
  -- HARM reaction policies (Phase 3.2)
  harmReactionDelayMin = 8,      -- crew processing time min (detection + classification + action)
  harmReactionDelayMax = 12,     -- crew processing time max
  harmCooldownMin      = 45,     -- GO_DARK cooldown min (jittered)
  harmCooldownMax      = 90,     -- GO_DARK cooldown max
  harmStayHotDuration  = 30,     -- selfProtect engagement window
  harmLastDitchMin     = 8,      -- PD defense window min
  harmLastDitchMax     = 12,     -- PD defense window max
  harmPanicPct         = 15,     -- % chance selfProtect crew panics -> GO_DARK
  harmMultiThreshold   = 2,      -- HARMs within window that force GO_DARK
  harmMultiWindow      = 15,     -- seconds to count multi-HARM saturation
  harmBraveryPct       = 5,      -- % chance any crew stays hot (nat 20 bravery roll)
  -- Alert frustration (Phase 3.3)
  alertFrustrationMin  = 30,     -- min seconds ALERT without WEZ contact before powering down
  alertFrustrationMax  = 60,     -- max seconds
  alertFrustrationStayPct = 10,  -- % chance crew stays hot instead
  -- PB HARM network warning (Phase 5)
  pbHarmCheckDelay     = 2,      -- seconds after PB launch to check trajectory
  pbHarmWarnRadius     = 5,      -- NM: SAMs within this of projected path get warned
  pbHarmCooldownMargin = 30,     -- extra seconds added to ETA for suppression timing
  -- ECM jammer framework (Phase 6)
  ecmEnabled           = true,   -- scan for ECM- aircraft in opposing coalition
  debug              = true,
})

-- Optional: override a site to use NEZ (ambush setup)
-- iads:SetEngagementZone("SAM-SA6-SOUTH-1", "NEZ")

-- Optional: manually assign a SAM to a different sector
-- iads:AssignToSector("SAM-SA10-SPECIAL-1", "NORTH")

-- Optional: manually parent a PD to a specific SAM
-- iads:AddPointDefense("PD-SA15-NORTH-1", "SAM-SA10-NORTH-1")

iads:Activate()
iads:AddF10Menu()
iads:StartMapDebug(15)
