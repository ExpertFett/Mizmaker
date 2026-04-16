/**
 * Squadron SOP (Standard Operating Procedures) data model.
 *
 * An SOP captures a squadron's preferred callsigns, frequencies, TACAN
 * channels, and laser code schemes. When an SOP is active, the planner's
 * auto-assign buttons (callsigns, comms deconflict, TACAN, laser codes)
 * pull their defaults from the SOP instead of generic DCS/856 defaults.
 */

export type Modulation = 'AM' | 'FM';
export type TacanBand = 'X' | 'Y';

/** A flight callsign the squadron prefers to use (e.g. "Bengal", "Uzi"). */
export interface SopFlightCallsign {
  /** Display name (e.g. "Bengal"). Matched against DCS's callsign enum. */
  callsign: string;
  /** Optional — lower value = higher priority. */
  priority?: number;
  /** Optional default radio freq for this flight (MHz). */
  defaultFreq?: number;
  /** Optional default modulation. Defaults to AM. */
  defaultMod?: Modulation;
}

/** A tanker entry — callsign + TACAN + freq. */
export interface SopTanker {
  callsign: string;
  frequency?: number;
  modulation?: Modulation;
  tacanChannel?: number;
  tacanBand?: TacanBand;
  tacanCallsign?: string;
  notes?: string;
}

/** An AWACS/JTAC/other support asset. */
export interface SopSupportAsset {
  callsign: string;
  role?: string;        // "AWACS", "JTAC", "Commander"
  frequency?: number;
  modulation?: Modulation;
  tacanChannel?: number;
  tacanBand?: TacanBand;
  notes?: string;
}

/** A named comm frequency: ATC, Strike Primary, Mission Common, etc. */
export interface SopCommEntry {
  role: string;         // "Strike Primary", "CAP", "Departure", ...
  frequency: number;    // MHz
  modulation?: Modulation;
  notes?: string;
}

/** A named TACAN channel outside tankers/AWACS (home plate, STPT, etc.). */
export interface SopTacanEntry {
  role: string;         // "Home Plate", "Ship", ...
  channel: number;
  band: TacanBand;
  callsign?: string;
  notes?: string;
}

export interface SOP {
  /** Internal uuid. */
  id: string;
  /** Display name, e.g. "VMFA-224(AW) Bengals SOP". */
  name: string;
  /** Squadron / org designator. */
  squadron?: string;
  /** Free-form notes. */
  notes?: string;
  /** Unix ms when last saved. */
  updatedAt: number;

  /** Preferred flight callsigns in priority order. */
  flights: SopFlightCallsign[];

  tankers?: SopTanker[];
  supportAssets?: SopSupportAsset[];

  /** Named comm frequencies (used as deconflict pool base). */
  comms: SopCommEntry[];

  /** Named TACAN entries. */
  tacans: SopTacanEntry[];

  /** Starting laser code for auto-assign (e.g. 1611). */
  laserCodeBase?: number;

  /** Optional raw image / file attachment (base64) — for reference only.
   *  Deprecated: prefer `attachments` for multiple items. */
  attachment?: SopAttachment;

  /** Multiple attachments — e.g. the kneeboard PNGs extracted from an OZP.
   *  Each may be tagged by airframe (`aircraft`) or category so the UI can
   *  group them. Leave `aircraft` blank for SOP-wide references. */
  attachments?: SopAttachment[];
}

export interface SopAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
  /** Aircraft folder this came from (e.g. "FA-18C_hornet"). Empty = SOP-wide. */
  aircraft?: string;
  /** Short human category (e.g. "Common Comms", "Tanker SOP"). */
  category?: string;
}

export function makeEmptySop(name = 'New SOP'): SOP {
  return {
    id: makeId(),
    name,
    updatedAt: Date.now(),
    flights: [],
    comms: [],
    tacans: [],
  };
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
  }
  return `sop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
