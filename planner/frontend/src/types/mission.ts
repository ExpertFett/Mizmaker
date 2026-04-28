/** TypeScript interfaces aligned to airboss DcsWaypoint/DcsGroup/DcsUnit schema */

export interface Waypoint {
  waypoint_number: number;
  waypoint_name: string;
  waypoint_type: string;
  waypoint_action: string;
  x: number;
  y: number;
  lat?: number;
  lon?: number;
  altitude_m: number;
  altitude_type: 'BARO' | 'RADIO';
  speed_ms: number;           // DCS ground speed (what gets written to .miz)
  speed_ref?: 'gs' | 'cas' | 'tas' | 'mach';  // pilot's chosen speed reference
  speed_input?: number;       // pilot's entered value in their chosen reference
  eta_seconds: number;
  eta_locked: boolean;
  speed_locked: boolean;
  airdrome_id?: number;
  task?: unknown;             // preserved original task data
  // Computed client-side
  leg_distance_nm?: number;
  leg_bearing_deg?: number;
  cumulative_eta?: number;
}

export interface MissionUnit {
  unitId: number;
  name: string;
  type: string;
  x: number;
  y: number;
  lat?: number;
  lon?: number;
  skill: string;
  category: string;
  coalition: string;
  country: string;
  groupName: string;
  groupId: number;
}

export interface MissionGroup {
  groupId: number;
  groupName: string;
  coalition: string;
  country: string;
  category: string;
  task: string;
  frequency: number;
  modulation: number;
  tacan?: { channel: number; band: string; callsign: string } | null;
  icls?: { channel: number } | null;
  units: MissionUnit[];
  waypoints: Waypoint[];
}

export interface ThreatRing {
  name: string;
  type: string;
  x: number;
  y: number;
  lat?: number;
  lon?: number;
  range: number;
  coalition: string;
}

export interface Airbase {
  name: string;
  coalition: string;
  x: number;
  y: number;
  lat?: number;
  lon?: number;
}

export interface MissionWeather {
  wind: {
    atGround: { speed: number; dir: number };
    at2000: { speed: number; dir: number };
    at8000: { speed: number; dir: number };
  };
  temperature_c: number;
  qnh_mmhg: number;
  qnh_inhg: number;
  qnh_hpa: number;
  clouds_base_m: number;
  clouds_density: number;
  clouds_thickness: number;
  clouds_precipitation: number;
  clouds_preset: string;
  visibility_m: number;
  fog_enabled: boolean;
  fog_visibility: number;
  fog_thickness: number;
  dust_enabled: boolean;
  dust_density: number;
  turbulence: number;
  halo_preset: string;
}

export interface MissionOverviewData {
  theater: string;
  sortie: string;
  date: string;
  start_time: number;
  description: string;
  descriptionBlueTask: string;
  descriptionRedTask: string;
  weather: MissionWeather;
  /** DCS bullseye per coalition. Extracted from `coalition.{side}.bullseye`
   *  in the mission Lua and converted to lat/lon by the backend. Empty
   *  object when the .miz didn't define one. */
  bullseye?: {
    blue?: { x: number; y: number; lat?: number; lon?: number };
    red?:  { x: number; y: number; lat?: number; lon?: number };
  };
}

export interface MissionDrawing {
  type: string;
  name: string;
  layer: string;
  color: string;
  fillColor?: string;
  thickness: number;
  text?: string;
  fontSize?: number;
  lat?: number;
  lon?: number;
  coords?: [number, number][];
  closed?: boolean;
  style?: string;
  polygonMode?: string;
  radius?: number;
}

export interface TriggerZone {
  zoneId: number;
  name: string;
  x: number;
  y: number;
  lat?: number;
  lon?: number;
  radius: number;
  color: string;
  hidden: boolean;
  type: number;           // 0=circle, 2=polygon
  vertices?: [number, number][];  // lat/lon pairs for polygon zones
}

/** DCS Mission Options (forcedOptions from .miz) */
export interface MissionOptions {
  // Booleans
  padlock?: boolean;
  permitCrash?: boolean;
  immortal?: boolean;
  fuel?: boolean;
  miniHUD?: boolean;
  easyRadar?: boolean;
  easyFlight?: boolean;
  externalViews?: boolean;
  birds?: boolean;
  userMarks?: boolean;
  wakeTurbulence?: boolean;
  accidental_failures?: boolean;
  easyComms?: boolean;
  RBDAI?: boolean;
  // Enums / numbers
  labels?: number;        // 0=Full, 1=Abbreviated, 2=Dot Only, 3=Neutral Dot, 4=Off
  civTraffic?: number;    // 0=Off, 1=Low, 2=Medium, 3=High
  geffect?: number;       // 0=None, 1=Realistic with recovery, 2=Realistic lethal
  optionsView?: number;   // 0=All, 1=Friendly, 2=Map Only, 3=MyAircraft
  // Catch-all for any other options
  [key: string]: unknown;
}

export interface UploadResponse {
  sessionId: string;
  filename: string;
  theater: string;
  overview: MissionOverviewData;
  groups: MissionGroup[];
  units: MissionUnit[];
  threats: ThreatRing[];
  airbases: Airbase[];
  drawings: MissionDrawing[];
  triggerZones: TriggerZone[];
  missionOptions: MissionOptions;
  clientUnits: ClientUnit[];
  allUnitsDonor: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  pylonOptions: Record<string, Record<string, PylonInfo[]>>;
  suggestions: UnitEdit[];
  allGroupsRenamer: GroupRenamerData[];
  liveryData: unknown[];
  laserClsids: string[];
  dtcFlights: string[];
  statistics: unknown;
  countries: CountryInfo[];
  taskLists: { air: string[]; ground: string[]; ship: string[] };
}

export interface ClientUnit {
  unitId: number;
  name: string;
  type: string;
  groupName: string;
  coalition: string;
  voiceCallsignLabel: string;
  voiceCallsignNumber: string;
  stnL16: string;
  donors: DonorInfo[];
  teamMembers: DonorInfo[];
  hasDatalinks: boolean;
  pylons: PylonInfo[];
  laserCode: number | null;
  fuel: number;
  flare: number;
  chaff: number;
  gun: number;
  /** Radio presets parsed from the unit's Radio[] block in the .miz.
   *  Empty when the mission designer never programmed any. The frontend
   *  RadioPresetsSection prefers these over auto-derived defaults. */
  radioPresets?: RadioPresetRadio[];
}

export interface RadioPresetRadio {
  radio: number;          // 1, 2, …
  channels: RadioPresetChannel[];
}

export interface RadioPresetChannel {
  ch: number;             // 1–20 typically
  freq_mhz: number;       // 251.000, 305.000, etc.
  modulation: number;     // 0=AM, 1=FM
  name: string;
}

/** Laser-capable unit (client or AI). Shape subset of ClientUnit for the LaserTab. */
export interface LaserCapableUnit {
  unitId: number;
  name: string;
  type: string;
  groupName: string;
  coalition: string;
  isClient: boolean;
  pylons: PylonInfo[];
  laserCode: number | null;
}

export interface DonorInfo {
  missionUnitId: number;
  name: string;
  type: string;
}

export interface PylonInfo {
  number: number;
  clsid: string;
  name: string;
  shortName: string;
  category: string;
}

export interface GroupRenamerData {
  groupId: number;
  groupName: string;
  coalition: string;
  category: string;
  unitCount: number;
  units: { unitId: number; name: string; type: string }[];
}

export interface UnitEdit {
  unitId?: number;
  groupId?: number;
  field: string;
  value: unknown;
}

export interface WaypointEdit {
  type: 'waypointMove' | 'waypointProp' | 'waypointInsert' | 'waypointDelete';
  groupId: number;
  wpIndex?: number;
  x?: number;
  y?: number;
  field?: string;
  value?: unknown;
  afterIndex?: number;
  waypointData?: Partial<Waypoint>;
}

export interface CountryInfo {
  name: string;
  coalition: string;
  unitCount: number;
  unitTypes: string[];
}

export type Coalition = 'blue' | 'red' | 'neutrals';
export type UnitCategory = 'plane' | 'helicopter' | 'vehicle' | 'ship' | 'static';

// ── Planner Drawings (user-created overlays) ─────────────────────────────

export type PlannerDrawingType = 'corridor' | 'threatRing' | 'referenceLine' | 'racetrack';

export interface PlannerDrawing {
  id: string;
  type: PlannerDrawingType;
  name: string;
  color: string;
  visible: boolean;
  coords: [number, number][];        // [lon, lat] pairs
  widthNm?: number;                  // corridor / racetrack width in NM
  radiusNm?: number;                 // threatRing radius in NM
  lineStyle?: 'solid' | 'dashed';    // referenceLine style
}

// ── Trigger & Audio types ─────────────────────────────────────────────────

export interface TriggerCondition {
  type: string;
  params: Record<string, unknown>;
  rawLua?: string;
}

export interface TriggerAction {
  type: string;
  params: Record<string, unknown>;
  rawLua?: string;
}

export interface TriggerRule {
  id: number;
  name: string;
  enabled: boolean;
  oneTime: boolean;
  eventType: 'once' | 'continuous' | 'onMissionStart';
  conditions: TriggerCondition[];
  actions: TriggerAction[];
  predicate?: string;
}

export interface FlagInfo {
  flagId: string;
  setBy: string[];
  readBy: string[];
}

export interface AudioFile {
  filename: string;
  path: string;
  sizeBytes: number;
}

export interface TriggerData {
  rules: TriggerRule[];
  flags: FlagInfo[];
  audioFiles: AudioFile[];
}
