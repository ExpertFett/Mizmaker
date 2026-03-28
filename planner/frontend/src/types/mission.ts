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
  speed_ms: number;
  eta_seconds: number;
  eta_locked: boolean;
  speed_locked: boolean;
  airdrome_id?: number;
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

export interface MissionOverviewData {
  theater: string;
  sortie: string;
  date: string;
  start_time: number;
  description: string;
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
