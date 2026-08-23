/**
 * Shared types for the AI Mission Commander.
 *
 * CmdrUnit is a structural subset of LiveMap's UnitT — deliberately NOT an
 * import, so this tree has no dependency on the 3k-line LiveMap module (and no
 * import cycle when LiveMap pulls the panel back in). LiveMap's unit objects
 * are assignable to it as-is.
 *
 * Everything the executors touch arrives through CommanderEnv, so the whole
 * execution path is testable without a live Olympus or a React tree.
 */

import type { UnitDbEntry } from '../../../api/groups';

export interface CmdrUnit {
  olympusID?: number;
  /** DCS type string, e.g. "FA-18C_hornet". */
  name?: string;
  /** In-mission callsign. */
  unitName?: string;
  category?: string;
  /** 0 = neutral, 1 = red, 2 = blue. */
  coalition?: number;
  alive?: number;
  /** 0 = a Mission-Editor unit; commanding it abandons its scripted mission. */
  controlled?: number;
  /** 1 = a real player. Never command these. */
  human?: number;
  ROE?: number;                 // 1-based on the wire
  reactionToThreat?: number;    // 0-based
  alarmState?: number;          // 0-based
  emissionsCountermeasures?: number;  // 0-based
  heading?: number;             // radians
  track?: number;               // radians
  speed?: number;               // m/s
  position?: { lat: number; lng: number; alt?: number };  // alt in metres
  targetID?: number;
  isLeader?: boolean;
  groupName?: string;
  airborne?: boolean;
  fuel?: number;
}

export interface CmdrAirbase {
  name: string;
  lat: number;
  lng: number;
  coalition: unknown;
}

export interface CmdrLatLng { lat: number; lng: number }

/** Mirrors the role capabilities in api/groups.ts. Backend still enforces. */
export interface CmdrCaps {
  spawn: boolean;
  command: boolean;
  delete: boolean;
  effects: boolean;
}

export type CmdrDbCategory = 'aircraft' | 'helicopter' | 'groundunit' | 'navyunit';

/** Everything the tool executors need, injected rather than imported. */
export interface CommanderEnv {
  /** Live snapshot — read at EXECUTION time, not proposal time. */
  getUnits: () => CmdrUnit[];
  getAirbases: () => CmdrAirbase[];
  getBullseye: () => CmdrLatLng | null;
  caps: CmdrCaps;
  send: (command: string, params: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** Lazily-loaded, cached per category by the panel. */
  getUnitDb: (cat: CmdrDbCategory) => Promise<Record<string, UnitDbEntry>>;
}

export interface ToolExecResult {
  text: string;
  isError?: boolean;
}
