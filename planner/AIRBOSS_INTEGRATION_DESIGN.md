# Planner Design Principles for Airboss Integration

**Date:** 2026-03-28
**Context:** This planner will eventually be integrated into airboss as the mission map planning tool. These design principles ensure the standalone app is built in a way that makes integration smooth — no retrofitting permission scoping or data filtering after the fact.

---

## The End State

Airboss becomes a unified mission planning hub where:
- Mission makers upload .miz files and plan the full mission on an interactive map
- Flight leads see only blue assets + threat rings, and can edit only their flight's waypoints/loadout
- Pilots see their own flight route and download personalized DTC files
- On export, airboss auto-applies each pilot's modex, livery, callsign, laser codes, and datalink config to the .miz
- Planning codes (Mode 1/2/3, tactical nets, laser pools) feed directly into the mission file

The planner is the map/waypoint piece of this. It needs to be built assuming it will serve all three user roles, even though the standalone version only has one user.

---

## Design Principles

### 1. View Roles as a First-Class Concept

Add a `viewRole` concept from day one with a toggle in the standalone UI for testing:

| Role | Sees | Can Edit |
|------|------|----------|
| `mission_maker` | Everything — all coalitions, all groups, all units | All groups, all waypoints |
| `flight_lead` | Blue coalition, support assets, threat rings (NOT red unit markers) | Only their flight's group waypoints |
| `pilot` | Own flight route, support assets, threat rings | Nothing (read-only) |

Every component and interaction should check the current role. In standalone mode, this is a dropdown. In airboss, it's derived from the user's permission level and flight assignments.

### 2. Data Filtering at the Store Level

**Do NOT scatter `if (group.coalition === 'blue')` checks across components.**

The Zustand stores should expose filtered accessors:

```typescript
// missionStore
getVisibleGroups(): MissionGroup[]     // filtered by viewRole + coalition
getVisibleThreats(): ThreatRing[]      // always visible (blue needs threat picture)
getSupportAssets(): MissionGroup[]      // tankers, AWACS — always visible to all roles
getEditableGroupIds(): Set<number>     // scoped by role + flight assignment

// For standalone: filter client-side from full dataset
// For airboss: backend returns pre-filtered data, store just passes through
```

Components consume only filtered views. When integration happens, you change where the store hydrates from (upload response → airboss API) and where the role comes from (toggle → auth). Components don't change.

### 3. Threat Rings as a Separate Data Layer

**Critical:** Parse SAM/AAA positions into a standalone `threats[]` array on upload. The threat layer renders from this array, never from iterating red unit groups.

```typescript
interface ThreatRing {
  name: string;          // "SA-10 Grumble"
  type: string;          // SAM system type
  lat: number;
  lon: number;
  range_m: number;       // engagement range
  coalition: string;     // which side it belongs to
}
```

Why: When the backend filters out red units for flight leads, threat rings still render because they're a separate data structure. Flight leads need to see "there's an SA-10 ring here" to route around it, but they should NOT see the actual red group markers or positions.

### 4. Flight-Scoped Editing

All waypoint interactions (drag, edit, insert, delete) should check an `editableGroupIds` set before allowing the action:

```typescript
// In waypointDrag.ts, waypointAdd.ts, WaypointEditPopup.tsx
const editableGroupIds = useStore(s => s.getEditableGroupIds());

// Before allowing any edit:
if (!editableGroupIds.has(group.groupId)) return; // no-op
```

In `mission_maker` mode → all group IDs. In `flight_lead` mode → just their flight's group ID. In `pilot` mode → empty set.

Build the check now, populate the set differently later.

### 5. Response Shape Should Match the Future API

Structure the Flask upload response to match what the airboss endpoint will eventually return:

```json
{
  "mission": {
    "theater": "Caucasus",
    "date": "2024-06-15",
    "start_time": "08:00:00",
    "bullseye": { "lat": 42.35, "lon": 43.32 }
  },
  "groups": [],
  "threats": [],
  "support_assets": [],
  "airbases": [],
  "editable_group_ids": [3, 7, 12],
  "view_role": "mission_maker"
}
```

Even if the standalone backend always returns everything and filtering is client-side, this response shape means the airboss backend can return the exact same structure with server-side filtering. The frontend hydration code stays identical.

### 6. Group-to-Flight Linking Concept

The standalone planner doesn't have airboss's Flight model, but it should have a concept of "this group is a named player flight" with a stable identifier:

```typescript
interface MissionGroup {
  groupId: number;
  groupName: string;
  flightLabel?: string;    // e.g., "Viper 1" — derived from group name in standalone
  flightId?: number;       // null in standalone, populated by airboss integration
  isPlayerFlight: boolean;
  // ...
}
```

`flightLabel` is what the UI displays. `flightId` is the airboss FK that enables permission scoping. In standalone mode, `flightLabel` is derived from the DCS group name. In airboss, both come from the Flight ↔ DcsGroup linkage.

### 7. Export as a Pluggable Pipeline

Structure export as an ordered array of transform steps, not a monolithic function:

```python
# Backend export pipeline
pipeline = [
    apply_waypoint_edits,      # Standalone: yes
    apply_callsign_edits,      # Standalone: yes (from renamer)
    apply_datalink_edits,      # Standalone: yes (from MizFix)
    apply_laser_code_edits,    # Standalone: yes (from MizFix)
    apply_modex,               # Airboss only (from PilotSlot → pilot prefs)
    apply_livery,              # Airboss only (from pilot prefs)
    apply_loadout,             # Airboss only (from FlightLoadout)
    generate_dtc,              # Airboss only (per-pilot DTC export)
]

# Each step: (mission_text, edit_context) → mission_text
# Steps that don't apply are simply not in the pipeline
```

The standalone app runs the first 4 steps. Airboss integration adds more. The export function just iterates the pipeline — it doesn't need to know what's in it.

### 8. Lua Parsing: Use Lupa (Not slpp)

The standalone planner currently uses slpp. Airboss uses Lupa for all Lua parsing (it's already a production dependency). **Port the parser to Lupa before integration**, or ideally now so there's only one parser to maintain.

The surgical regex editing (miz_editor.py) is parser-agnostic — it operates on raw Lua text regardless of how it was parsed. Only `miz_parser.py` needs to change.

### 9. What to Show Per Role (Layer Visibility Matrix)

| Layer | mission_maker | flight_lead | pilot |
|-------|:---:|:---:|:---:|
| Blue player groups | visible | visible | own flight only |
| Blue AI groups | visible | support assets only | support assets only |
| Red groups | visible | hidden | hidden |
| Neutral groups | visible | hidden | hidden |
| Statics | hidden (unless toggled) | hidden | hidden |
| Ground vehicles | visible | hidden | hidden |
| Threat rings | visible | visible | visible |
| Airbases | visible | blue only | blue only |
| Player flight routes | visible (all) | visible (all blue, for deconfliction) | own flight only |
| AI air routes | visible | tanker/AWACS only | tanker/AWACS only |
| Bullseye | visible | visible | visible |

This matrix should be a config object that the layer rendering code references, not hardcoded conditionals.

### 10. Don't Build What Airboss Already Has

The standalone planner should NOT implement:
- Authentication (airboss has Discord OAuth + Session Fortress)
- Pilot slot management (airboss has PilotSlot model)
- Planning code assignment (airboss has FlightPlanningData + PilotSlotCodes)
- Loadout template library (airboss has FlightLoadout + LoadoutTemplate)
- Mission lifecycle (airboss has MissionStatus + approval workflow)
- Persistent storage (airboss has MinIO + PostgreSQL)

The planner handles: **map rendering, waypoint CRUD, route visualization, threat display, and .miz surgical editing.** Everything else comes from airboss on integration.

---

## Integration Checklist (When Ready)

- [ ] Port miz_parser.py from slpp to Lupa
- [ ] Fix `_find_waypoint_block()` drag→save targeting bug
- [ ] Test insert/delete waypoint editing against multiple mission files
- [ ] Verify all 15 theater projections match airboss coordinate_converter (fix airboss params where they differ)
- [ ] Add viewRole toggle and verify all layers/interactions respect it
- [ ] Add editableGroupIds gating on all edit interactions
- [ ] Separate threat rings from red unit data in the store
- [ ] Structure Flask response to match airboss API shape
- [ ] Replace Zustand hydration with fetchWithAuth + airboss endpoints
- [ ] Mount as route in airboss React app
- [ ] Wire auth from airboss Discord OAuth session

---

## Airboss Models That Matter

For reference, the airboss models the planner will eventually consume:

- **DcsGroup** — group_name, coalition, category, is_player, x/y/lat/lon, flight_id (FK to Flight)
- **DcsUnit** — unit_name, unit_type, skill, x/y/lat/lon, pylon_loadout, pilot_slot_id (FK to PilotSlot)
- **DcsWaypoint** — waypoint_number, name, type, action, x/y/lat/lon, altitude_m, altitude_type, speed_ms, eta_seconds
- **DcsSupportAsset** — tankers/AWACS with frequency, TACAN, orbit pattern
- **DcsMissionVersion** — version tracking with JSONB changes field
- **Flight** — name, flight_role, airframe, linked to DcsGroup via flight_id
- **PilotSlot** — position (1=lead), pilot_discord_id, linked to DcsUnit via pilot_slot_id
- **PilotSlotCodes** — laser_code per pilot slot
- **FlightPlanningData** — mode1/2/3 codes, tactical net, mission tasking per flight
