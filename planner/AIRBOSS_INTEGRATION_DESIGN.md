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

---

## Status Update: What the Planner Actually Does Now (2026-03-29)

**For the Airboss Claude — here's where the standalone planner is and how it all works. This should help you think about how we wire it into the PostgreSQL/FastAPI/MinIO stack.**

### What We Built

The planner is a fully functional collaborative DCS mission planning tool. A mission maker uploads a .miz file, invites flight leads via unique links, everyone plans their routes simultaneously on a shared map, and the mission maker downloads the edited .miz with all changes baked in. No data ever touches disk — everything is in-memory with a 2-hour TTL.

It's deployed at planner.v224.org behind Cloudflare → Traefik → Docker (single gevent worker, 100 concurrent green threads).

### Architecture

**Backend: Flask + gevent (planner/backend/)**

- `app.py` — the entire API. Session management, upload, edit, SSE, invite/join, ready check, download. ~940 lines.
- `services/miz_parser.py` — extracts groups, units, threats, airbases, weather, drawings from parsed Lua dict. Uses slpp for Lua→Python dict conversion.
- `services/miz_editor.py` — hierarchy-based surgical .miz editing. Navigates coalition→country→category→group[N] by brace-matching, finds groups by their depth-1 `["name"]` field, replaces the entire `["points"]` block. Never re-serializes the full Lua — only touches the bytes that changed.
- `services/unit_editor.py` — 16 surgical edit types ported from 856 (datalink, loadouts, laser codes, liveries, weather, rename, batch). Each edit is a regex find-and-replace on the raw Lua text targeting a specific unit by name.
- `services/unit_extractor.py` — extracts client units with full weapon/datalink/loadout data for the editor tabs.
- `services/projection.py` — 15-theater DCS↔LatLon conversion using pyproj Transverse Mercator.
- `services/atmosphere.py` — ISA model for CAS/TAS/Mach/GS conversions with wind correction at altitude.
- `services/waypoint_service.py` — haversine distance, bearing, ETA computation per leg.
- `services/dtc_builder.py` — F/A-18C DTC file generation from mission data.

**Frontend: React 18 + TypeScript + Vite + Zustand + OpenLayers (planner/frontend/)**

- `editor/MissionEditor.tsx` — main shell with 9 tabs: Map, Datalink, Loadouts, Laser, Livery, Weather, Rename, Batch, DTC.
- `map/MapContainer.tsx` — OpenLayers map with 5 layers (units, routes, threats, airbases, drawings). Custom pointer-based waypoint drag. Click-to-select, double-click-to-edit-popup.
- `panels/FloatingFlightPanel.tsx` — draggable per-flight editor with route/datalink/loadout sub-tabs. Per-waypoint speed reference (GS/CAS/TAS/Mach with wind correction).
- `store/missionStore.ts` — Zustand store holding all mission data + session state (sessionId, hostToken, sessionToken, assignedGroup, role).
- `store/editStore.ts` — client-side queue for unit edits (datalink, loadout, livery, etc.) that get applied at download time.
- `session/` — SSE hook, invite manager, join page, participant bar with ready check.
- `api/client.ts` — typed API client for all backend endpoints.

### Session Model (In-Memory)

```python
sessions[session_id] = {
    "miz_bytes": bytes,                    # original uploaded .miz
    "original_mission_text": str,          # never mutated — the baseline Lua
    "theater": str,
    "filename": str,
    "group_waypoints": {                   # server-authoritative waypoint state
        "Bengal 1": [wp0, wp1, wp2, ...],
        "Bengal 3": [wp0, wp1, ...],
        # ... every group in the mission
    },
    "dirty_groups": set(),                 # only these get replaced on download
    "host_token": str,                     # mission maker's auth token
    "participants": {                      # invited flight leads
        "invite_token_abc": {
            "name": "Flight Lead A",
            "group": "Bengal 1",
            "connected": True,
            "ready": False,
        },
    },
    "status": "planning",                  # planning | frozen | ready_check
    "sse_clients": [],                     # gevent Queue per connected client
    "created_at": float,
    "last_activity": float,
}
```

### How Editing Works

**Waypoint edits are server-authoritative.** The client does an optimistic local update for instant visual feedback, then POSTs to `/api/sessions/{id}/edit` with the action (move, add, delete, reorder, update). The server validates ownership (token must own the group or be the host), applies the change to `group_waypoints`, marks the group as dirty, recomputes route leg distances/bearings/ETAs, broadcasts via SSE to all other clients, and returns the authoritative waypoint array. The client replaces its local state with the server's response.

**Unit edits (datalink, loadouts, laser codes, liveries, weather, rename, batch) are still client-side queued.** These are stored in an `editStore` on the frontend and sent to the server at download time as an array of surgical edit instructions. The server applies them to the raw Lua text using regex patterns that target specific units by name. This is the 856-ported edit engine — 16 edit types covering every field that matters.

**Download** reads `original_mission_text`, replaces waypoints only for `dirty_groups` (not all groups — that caused a Cloudflare timeout when we tried processing 100+ groups), applies unit edits, repacks the .miz ZIP, and streams the file.

### How Collaborative Sessions Work

1. Mission maker uploads .miz → gets `sessionId` + `hostToken`
2. Mission maker generates invite links per flight group → each gets a unique `inviteToken` tied to one group
3. Flight lead opens `/join/{sessionId}?token={inviteToken}` → gets the full mission data with their `assignedGroup` and `role: "flight_lead"`
4. SSE connects for real-time sync with 30-second heartbeat keepalives (Cloudflare kills idle connections at 100s)
5. Flight leads see blue units only, can edit only their assigned group's waypoints/datalink/loadouts. Other flights are visible (color-coded routes for SA) but read-only.
6. Mission maker sees everything, can edit everything
7. Mission maker can trigger a ready check → flight leads confirm → mission maker downloads

The backend enforces group ownership on the edit endpoint regardless of what the frontend does — a flight lead with Bengal 1's token cannot edit Bengal 3 even with a modified client.

### What's Different From What This Document Assumed

When this design doc was written, the planner was solo-only with client-side editing. Here's what changed:

**Done (matching or exceeding the design doc's recommendations):**
- ✅ View roles are implemented: `mission_maker`, `flight_lead`, `pilot` (pilot is read-only, not yet used)
- ✅ Flight-scoped editing enforced on both frontend and backend
- ✅ Threat rings are a separate data layer (parsed into `threats[]` on upload)
- ✅ Layer visibility filtering by role (blue-only for flight leads, no red units/threats hidden from view)
- ✅ All 15 theater projections working
- ✅ Full 856 feature parity (all edit types, DTC generation)
- ✅ Server-authoritative waypoint state with SSE real-time sync
- ✅ Token-based group ownership with invite links

**Not yet done:**
- ❌ Data filtering at store level via accessors (currently done inline in components — works but not as clean)
- ❌ Layer visibility matrix as a config object (currently hardcoded conditionals)
- ❌ Response shape doesn't match the proposed airboss API format (flat structure, not nested under `mission:`)
- ❌ Still using slpp, not Lupa
- ❌ No `flightId` FK concept — groups are matched by name
- ❌ Export pipeline is a single function, not pluggable steps
- ❌ No persistent shared annotations layer (measurements, killboxes, DMPIs)

### What Airboss Integration Replaces

Here's what I think maps cleanly when you wire this into the real stack:

| Standalone Planner | Airboss Replacement |
|---|---|
| In-memory `sessions` dict | PostgreSQL `DcsMissionData` + `DcsWaypoint` tables |
| `miz_bytes` in memory | MinIO object storage |
| `original_mission_text` in memory | Stored in MinIO alongside .miz, or parsed on-demand |
| `group_waypoints` dict | `DcsWaypoint` rows keyed by `DcsGroup.id` |
| `dirty_groups` set | Compare current waypoints to original (or version tracking via `DcsMissionVersion.changes` JSONB) |
| UUID host_token | Discord OAuth session → user has `mission_maker` permission |
| HMAC invite_token per group | `PilotSlot.pilot_discord_id` → user is assigned to this flight via `Flight.id` → `DcsGroup.flight_id` |
| `participants` dict | `PilotSlot` rows with `is_connected`, `is_ready` fields (or a separate presence table) |
| SSE with gevent Queue | FastAPI SSE (airboss already has `SSEService`) or WebSocket upgrade |
| `unit_editor.py` regex edits | Same engine, but edits sourced from `PilotSlotCodes`, `FlightLoadout`, pilot preferences |
| `editStore` client-side queue | Edits POST to airboss API, stored in DB, applied on export |
| 2-hour TTL, data lost on restart | Persistent until mission archived |

### The Big Win With PostgreSQL

The in-memory model works but has real limitations:
- **One worker process.** Can't scale horizontally because sessions aren't shared. gevent gives us concurrency within one process but that's the ceiling.
- **Data loss on restart.** Container rebuild = all sessions gone. Flight leads have to re-upload and re-plan.
- **No history.** Can't diff what changed between planning iterations.
- **No access control beyond tokens.** Anyone with a valid token can do anything that token allows. No audit trail.

With PostgreSQL + the airboss auth stack:
- **Horizontal scaling.** Any worker reads/writes the same DB. SSE can use Redis pub/sub for cross-worker broadcasting.
- **Persistence.** Server restarts don't lose planning state. Resume where you left off.
- **Version history.** `DcsMissionVersion` with JSONB changes gives you a full audit trail of who changed what when.
- **Real permissions.** Discord OAuth → squadron membership → flight assignment → group ownership. No guessable tokens.
- **Concurrent edit safety.** Database transactions + row-level locking instead of Python dicts with a threading lock.
- **Multi-mission.** Plan multiple missions simultaneously with proper isolation.

### Suggested Integration Path

1. **Mount the React frontend as a route in airboss.** Replace the Zustand store hydration to fetch from airboss API endpoints instead of the Flask upload response. The component tree stays identical.

2. **Port `miz_editor.py` and `unit_editor.py` to airboss.** These are the crown jewels — the surgical .miz editing engine. They're pure Python, no Flask dependencies. Copy them into airboss's services, swap slpp for Lupa in the parser, done.

3. **Replace the session model with DB tables.** `group_waypoints` → `DcsWaypoint` rows. `dirty_groups` → compare to baseline or track via version. `participants` → `PilotSlot` presence.

4. **Replace SSE endpoint with airboss's SSEService.** Same event types (`route_update`, `participant_joined`, `ready_check`, etc.), just backed by Redis pub/sub instead of gevent Queues.

5. **Replace token auth with Discord OAuth.** The frontend currently sends `Authorization: Bearer {token}` on edit requests. In airboss, this becomes the session cookie from Discord OAuth. The backend resolves user → flight assignment → group ownership from the DB instead of checking an in-memory participants dict.

6. **Wire the export pipeline.** The standalone export does: replace dirty waypoints → apply unit edits → repack .miz. Airboss adds: apply pilot preferences (modex, livery, callsign from PilotSlot/pilot prefs) → generate per-pilot DTCs → store result in MinIO.

The frontend barely changes. The surgical Lua editing doesn't change at all. It's really a backend swap — replace in-memory state with PostgreSQL, replace tokens with Discord auth, replace gevent SSE with FastAPI SSE.
