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
  clouds_preset: string;
  visibility_m: number;
}

export interface MissionOverviewData {
  theater: string;
  sortie: string;
  date: string;
  start_time: number;
  description: string;
  weather: MissionWeather;
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
  clientUnits: ClientUnit[];
  allUnitsDonor: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  pylonOptions: Record<string, Record<string, PylonInfo[]>>;
  suggestions: UnitEdit[];
  allGroupsRenamer: GroupRenamerData[];
  liveryData: unknown[];
  laserClsids: string[];
  dtcFlights: string[];
  statistics: unknown;
  countries: unknown[];
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

export type Coalition = 'blue' | 'red' | 'neutrals';
export type UnitCategory = 'plane' | 'helicopter' | 'vehicle' | 'ship' | 'static';
