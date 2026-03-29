# Kneeboard Generation System — Design Plan

## Philosophy

Kneeboards are the final product of mission planning. Everything we've built — waypoints, weather, datalink, loadouts, atmosphere math — feeds into these cards. They're what the pilot straps to their knee.

Our system generates them automatically from mission data, rendered in the proven 600×850 dark theme. The pilot gets a complete set of cards on download — packed into the .miz KNEEBOARD directory or downloadable as a PDF/PNG bundle.

---

## Data We Already Have

Everything needed is already in the planner stores:

| Data | Source | Used In |
|------|--------|---------|
| Waypoints with lat/lon, MGRS, alt, speed, ETE | missionStore.groups[].waypoints | Lineup Card, Route Detail |
| Speed references (GS/CAS/TAS/Mach per WP) | atmosphere.ts + speed_ref per WP | Lineup Card |
| Weather (wind layers, temp, QNH, clouds) | overview.weather | Weather Card, Fuel Ladder |
| Callsigns + STN L16 | clientUnits[].voiceCallsignLabel/Number/stnL16 | Comms Card, Flight Card |
| Loadouts per pylon | clientUnits[].pylons | Flight Card |
| Donors + Team Members | clientUnits[].donors/teamMembers | Datalink Card |
| Laser codes | clientUnits[].laserCode | Flight Card |
| Support assets (tankers, AWACS) | groups filtered by task=Refueling/AWACS | Support Assets Card |
| Threat rings (SAM/AAA) | threats[] | Route Detail overlay |
| Airbases | airbases[] with frequencies (from web-editor data) | Airbase Reference |
| Mission drawings | drawings[] | Route Detail overlay |
| Theater + bullseye | overview.theater, coalition bullseye | All cards |
| Elevation data | SRTM backend | Route Detail terrain profile |
| Leg distances, bearings | waypoint_service computed | Lineup Card |
| ETE with wind correction | atmosphere.ts | Lineup Card, Fuel Ladder |

## What Airboss Will Add Later

| Data | Airboss Model | Used In |
|------|--------------|---------|
| Mode 1/2/3 codes | FlightPlanningData | IFF Card |
| Tactical net assignments | FlightPlanningData.tactical_net | Comms Card |
| Laser code pool | PilotSlotCodes | Flight Card |
| Modex/board numbers | PilotSlot | Flight Card |
| Tanker assignments (primary/alternate) | FlightTankerAssignment | Tanker Card |
| Pilot names/callsigns | PilotSlot.pilot_display_name | Flight Card |
| Mission objectives/tasking | Flight.flight_role + section_tasking | Briefing Card |

---

## Kneeboard Types

### Per-Flight Cards (one set per player group)

#### 1. Lineup Card
The primary navigation reference. One per flight.

```
┌──────────────────────────────────────────┐
│  LINEUP CARD — BENGAL 1                  │
│  FA-18C Hornet | CAP | 228.5 MHz         │
├────┬──────┬────────┬───────┬────┬────┬───┤
│ WP │ Name │ Coord  │ Alt   │ Spd│Dist│ETE│
├────┼──────┼────────┼───────┼────┼────┼───┤
│  0 │ DEPT │ MGRS   │ sfc   │ —  │ —  │ — │
│  1 │ RLY  │ MGRS   │ 20000 │280K│23.4│2:4│
│  2 │ IP   │ MGRS   │ 15000 │360K│45.2│5:3│
│  3 │ TGT  │ MGRS   │ 12000 │300K│12.1│1:4│
│  4 │ EGRS │ MGRS   │ 25000 │450K│38.7│3:5│
├────┴──────┴────────┴───────┴────┴────┴───┤
│ Total: 119.4 nm  |  ETE: 13:36           │
│ Hdg: 045° → 120° → 280° → 315°          │
├──────────────────────────────────────────┤
│ WX: QNH 30.05 | Temp 18°C | Wind 280/8  │
│ Clouds: BKN 16,400ft | Vis: 80km         │
├──────────────────────────────────────────┤
│ NOTES:                                   │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```

Data: waypoints with MGRS coords, altitude (ft MSL/AGL), speed in pilot's chosen reference, leg distance, ETE, bearings. Weather summary. Notes area fills remaining space.

#### 2. Flight Card
Per-flight member details — who's in the flight, what they're carrying.

```
┌──────────────────────────────────────────┐
│  FLIGHT CARD — BENGAL 1                  │
│  FA-18C Hornet | 4-ship | CAP            │
├──────────────────────────────────────────┤
│ # │ Callsign │ STN  │ Modex │ Laser     │
│ 1 │ BL-11    │03411 │ 200   │ —         │
│ 2 │ BL-12    │03412 │ 201   │ —         │
│ 3 │ BL-13    │03413 │ 202   │ —         │
│ 4 │ BL-14    │03414 │ 203   │ —         │
├──────────────────────────────────────────┤
│ LOADOUT (all):                           │
│ S1: AIM-9X  S2: 2x GBU-38  S3: 2x GBU38│
│ S4: ATFLIR  S5: FPU-8A     S6: AIM-120C │
│ S7: FPU-8A  S8: 2x GBU-38  S9: AIM-9X  │
│ Fuel: 10,860 lbs | FL: 60 | CH: 60      │
├──────────────────────────────────────────┤
│ DATALINK:                                │
│ Donors: MAGIC 1 (AWACS), ARCO 1         │
│ Team: Bengal 1-1, 1-2, 1-3, 1-4         │
├──────────────────────────────────────────┤
│ IFF/MODES:        (from airboss later)   │
│ Mode 1: 26  Mode 3: 1200  Mode 4: ON    │
│ Tac Net: BLUE 250.000                    │
└──────────────────────────────────────────┘
```

Data: callsigns, STN L16, loadout summary (short weapon names), fuel/flare/chaff, datalink donors+team. IFF modes come from airboss FlightPlanningData when integrated.

#### 3. Comms Card
Radio preset ladder with mission phase flow.

```
┌──────────────────────────────────────────┐
│  COMMS CARD — BENGAL 1                   │
├──────────────────────────────────────────┤
│ MISSION FLOW:                            │
│ ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐     │
│ │GRND │→│ TWR │→│DPRT │→│STRK │→...    │
│ │PB 6 │  │PB 7 │  │PB 8 │  │PB 5 │     │
│ └─────┘  └─────┘  └─────┘  └─────┘     │
├──────────────────────────────────────────┤
│ RADIO 1 PRESETS:                         │
│  1: 305.000 AM  Deckboss                 │
│  2: 308.000 AM  LSO                      │
│  3: 264.000 AM  Marshal                  │
│  5: 250.000 AM  Strike                   │
│ 15: 257.000 AM  ARCO 1                   │
├──────────────────────────────────────────┤
│ RADIO 2 PRESETS:                         │
│  1: 127.500 AM  Ground                   │
│ 15: 259.000 AM  ARCO 3                   │
│ 16: 261.000 AM  TEXACO 6                 │
├──────────────────────────────────────────┤
│ GUARD: 243.000 AM                        │
└──────────────────────────────────────────┘
```

Data: from DTC radio presets or mission unit radio config. Phase flow diagram auto-generated from waypoint actions (takeoff → turning points → landing).

#### 4. Route Detail Card
Map snapshot with waypoint overlay, threat rings, route line.

```
┌──────────────────────────────────────────┐
│  ROUTE — BENGAL 1                        │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │                                  │    │
│  │  [MAP: OpenLayers render of the  │    │
│  │   route with waypoint markers,   │    │
│  │   threat rings, tanker tracks,   │    │
│  │   bullseye reference, MGRS grid] │    │
│  │                                  │    │
│  │  WP numbers + names on route     │    │
│  │  Leg distances between WPs       │    │
│  │  Direction arrows                │    │
│  │                                  │    │
│  └──────────────────────────────────┘    │
│                                          │
│ BULLSEYE: "ROCK" N24°27' E054°32'       │
│ Total: 119.4 nm | ETE: 13:36            │
└──────────────────────────────────────────┘
```

Data: OL map render of the route with all visible layers. Auto-zoom to route extent with padding for context. Include threat rings, tanker tracks, bullseye marker.

#### 5. Fuel Ladder
Fuel state checkpoints from launch to recovery.

```
┌──────────────────────────────────────────┐
│  FUEL LADDER — BENGAL 1                  │
│  FA-18C | 2x FPU-8A | Start: 10,860 lbs │
├──────────────────────────────────────────┤
│ Phase          │ Fuel  │ Burn │ Dist     │
├────────────────┼───────┼──────┼──────────┤
│ AIRBORNE       │10,560 │  300 │ cat shot │
│ → RLY (23nm)   │ 9,800 │  760 │ 23.4nm  │
│ → IP (45nm)    │ 8,200 │1,600 │ 45.2nm  │
│ → ON STATION   │ 8,200 │    — │ loiter   │
│ ─── JOKER ───  │ 7,000 │      │          │
│ ─── BINGO ───  │ 6,000 │      │          │
│ → RTB (80nm)   │ 3,500 │2,500 │ ~80nm   │
│ → RECOVERY     │ 3,000 │  500 │ marshal  │
├──────────────────────────────────────────┤
│ ENDURANCE @ STATION:                     │
│ At 300 KCAS / Angels 20: ~45 min         │
│ At 250 KCAS / Angels 25: ~55 min         │
├──────────────────────────────────────────┤
│ TANKERS:                                 │
│ ARCO 1: 55Y, Mom Orbit, RDO 1 PB 15     │
│ TEXACO 3: 120Y, ROCK 055/85, RDO 1 PB13 │
└──────────────────────────────────────────┘
```

Data: starting fuel from unit payload, burn rates estimated from speed/alt/distance, waypoint-to-waypoint fuel consumption. Tanker assignments from support assets. Joker/Bingo are configurable per flight (default 7000/6000 for F/A-18C).

### Shared Cards (one per mission)

#### 6. Support Assets Card

```
┌──────────────────────────────────────────┐
│  SUPPORT ASSETS                          │
├──────────────────────────────────────────┤
│ TANKERS:                                 │
│ Callsign │ Type    │ TACAN │ Track/Pos   │
│ ARCO 1   │ S-3B    │ 55Y   │ Mom Orbit   │
│ ARCO 2   │ S-3B    │ 56Y   │ ROCK 092/30 │
│ TEXACO 3 │ KC-135  │ 120Y  │ ROCK 055/85 │
│ TEXACO 6 │ KC-135  │ 123Y  │ ROCK 350/38 │
├──────────────────────────────────────────┤
│ AWACS:                                   │
│ MAGIC 1  │ E-3A    │       │ ROCK 180/60 │
│CLOSEOUT 1│ E-2C    │       │ ROCK 270/45 │
├──────────────────────────────────────────┤
│ JTAC:                                    │
│ (none assigned)                          │
├──────────────────────────────────────────┤
│ CARRIER:                                 │
│ CVN-71 Roosevelt │ TACAN 54X │ BRC 020   │
│ ICLS Ch 1 | LINK4 | Case I              │
└──────────────────────────────────────────┘
```

Data: AI air groups with task=Refueling/AWACS. TACAN from unit properties. Track position from first waypoints. Carrier info from ship groups with CVN/LHA types.

#### 7. Radio Ladder (Shared)

```
┌──────────────────────────────────────────┐
│  MASTER FREQUENCY TABLE                  │
├──────────────────────────────────────────┤
│ Function    │ Freq      │ Preset         │
├─────────────┼───────────┼────────────────┤
│ DECKBOSS    │ 305.000AM │ RDO 1 PB 1     │
│ MARSHAL     │ 264.000AM │ RDO 1 PB 3     │
│ LSO         │ 308.000AM │ RDO 1 PB 2     │
│ STRIKE      │ 250.000AM │ RDO 1 PB 5     │
│ GUARD       │ 243.000AM │ RDO 1 PB G     │
│─────────────┼───────────┼────────────────│
│ ARCO 1      │ 257.000AM │ RDO 1 PB 15    │
│ ARCO 2      │ 331.200AM │ discrete       │
│ TEXACO 3    │ 259.000AM │ RDO 1 PB 13    │
│─────────────┼───────────┼────────────────│
│ MAGIC 1     │ 251.000AM │ RDO 2 PB 1     │
│ CLOSEOUT 1  │ 253.000AM │ RDO 2 PB 2     │
└──────────────────────────────────────────┘
```

Data: compiled from all support asset frequencies + mission radio presets. Organized by function.

#### 8. Airbase Reference

```
┌──────────────────────────────────────────┐
│  AIRBASE REFERENCE — PERSIAN GULF        │
├──────────────────────────────────────────┤
│ Name            │ TACAN │ ILS  │ Elev    │
├─────────────────┼───────┼──────┼─────────┤
│ Al Dhafra AFB   │ 96X   │109.75│  16ft   │
│ Al Minhad AFB   │ 99X   │110.10│ 165ft   │
│ Dubai Intl      │ —     │110.90│  34ft   │
│ Sharjah Intl    │ —     │111.35│  33ft   │
│ Khasab          │ —     │ —    │  95ft   │
├──────────────────────────────────────────┤
│ DIVERT OPTIONS:                          │
│ Fujairah Intl: 12,500ft rwy, elev 152ft │
│ Al Ain Intl: 13,500ft rwy, elev 869ft   │
└──────────────────────────────────────────┘
```

Data: from airbases.json per theater. TACAN/ILS from web-editor airfield data (would need to add these fields). Elevation from SRTM.

#### 9. Bullseye Reference

```
┌──────────────────────────────────────────┐
│  BULLSEYE REFERENCE                      │
│  "ROCK" — N24°27'12" E054°32'45"        │
├──────────────────────────────────────────┤
│                                          │
│  [Concentric circles at 20nm intervals   │
│   with cardinal direction labels         │
│   and MGRS grid overlay]                 │
│                                          │
│  Rendered as OL map snapshot             │
│  centered on bullseye position           │
│                                          │
├──────────────────────────────────────────┤
│ NOTES:                                   │
│                                          │
└──────────────────────────────────────────┘
```

#### 10. Weather Briefing

```
┌──────────────────────────────────────────┐
│  WEATHER BRIEFING                        │
│  2025-10-01 | 0430L | Persian Gulf       │
├──────────────────────────────────────────┤
│ QNH: 30.05 inHg / 1017.8 hPa            │
│ Temp: 18°C / 64°F                        │
│                                          │
│ WINDS:                                   │
│ Surface: 280°/8kts                       │
│ FL060:   282°/10kts                      │
│ FL260:   335°/11kts                      │
│                                          │
│ CLOUDS: BKN @ 16,400ft (200m thick)      │
│ VIS: 80km | FOG: None | DUST: None       │
│ TURB: Light (1.0)                        │
├──────────────────────────────────────────┤
│ SUNRISE: ~0545L  SUNSET: ~1745L          │
│ MOON: —                                  │
├──────────────────────────────────────────┤
│ DENSITY ALTITUDE @ FIELD:                │
│ Al Dhafra (16ft): ~1,200ft               │
│ @ Angels 20: std -3°C                    │
└──────────────────────────────────────────┘
```

Data: all from overview.weather + atmosphere.ts calculations.

---

## Rendering Architecture

### Client-Side Generation (preferred for standalone)

```
React Component (kneeboard template)
    ↓
ReactDOMServer.renderToStaticMarkup()
    ↓
HTML string wrapped in SVG <foreignObject>
    ↓
SVG data URL → Image() → Canvas.drawImage()
    ↓
Canvas.toBlob() → PNG
```

For route detail cards that need a map:
```
OpenLayers map → map.renderSync() → canvas export
    ↓
Compose: map canvas + data overlay canvas
    ↓
Final PNG
```

### Card Dimensions

- **Standard card**: 600×850px (portrait, your proven format)
- **Route detail**: 850×600px (landscape, more map space) OR 600×850 with map in top half
- **DCS KNEEBOARD directory**: PNG files, any resolution (DCS scales to fit)

### Packaging

On download, kneeboards are packed into the .miz:
```
KNEEBOARD/
├── FA-18C_hornet/
│   └── IMAGES/
│       ├── Bengal_1_Lineup.png
│       ├── Bengal_1_Flight.png
│       ├── Bengal_1_Comms.png
│       ├── Bengal_1_Route.png
│       └── Bengal_1_Fuel.png
├── IMAGES/
│   ├── Support_Assets.png
│   ├── Radio_Ladder.png
│   ├── Weather_Brief.png
│   ├── Airbase_Ref.png
│   └── Bullseye_Ref.png
```

Also available as: ZIP download of all PNGs, or PDF bundle.

---

## Configuration

Each kneeboard type has toggle settings:

```typescript
interface KneeboardSettings {
  // Per-flight cards
  lineupCard: boolean;
  flightCard: boolean;
  commsCard: boolean;
  routeDetail: boolean;
  fuelLadder: boolean;

  // Shared cards
  supportAssets: boolean;
  radioLadder: boolean;
  weatherBrief: boolean;
  airbaseRef: boolean;
  bullseyeRef: boolean;

  // Options
  coordFormat: 'mgrs' | 'dms' | 'ddm';
  speedRef: 'gs' | 'cas' | 'tas' | 'mach';
  altUnits: 'ft' | 'm';

  // Fuel ladder settings
  jokerFuel: number;  // default 7000
  bingoFuel: number;  // default 6000

  // Custom notes per card
  notes: Record<string, string>;
}
```

UI: a "Kneeboards" tab in the editor with checkboxes for each card type, preview of each card, and a "Generate All" button.

---

## Implementation Order

1. **Kneeboard rendering service** — HTML→Canvas→PNG pipeline, image composer
2. **Lineup Card** — proves the full pipeline end to end
3. **Route Detail Card** — proves map snapshot integration
4. **Flight Card + Comms Card** — uses client unit data
5. **Fuel Ladder** — uses atmosphere math
6. **Support Assets + Radio Ladder** — shared cards
7. **Weather + Airbase + Bullseye** — simpler shared cards
8. **Kneeboards tab in editor** — settings, preview, generate
9. **.miz packing** — write PNGs into KNEEBOARD/ directory on download
10. **PDF bundle** — alternative export format

---

## Airboss Integration Notes

When this moves to airboss:
- IFF/Mode codes come from FlightPlanningData (Mode 1, Mode 2/3 patterns)
- Tactical nets come from TacticalNetAssignment
- Laser code pools come from PilotSlotCodes
- Modex/board numbers come from PilotSlot
- Pilot names come from Discord user profiles
- Tanker assignments come from FlightTankerAssignment (primary/alternate)
- Per-pilot DTC files are generated alongside kneeboards
- Kneeboards are cached in MinIO, not regenerated on every request

The kneeboard templates don't change — they just get more data fields populated.
