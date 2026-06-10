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

/* ──────────────────────────────────────────────────────────────────────
 * Comm Plan (v1.19.77) — the wing's radio architecture, modelled from
 * real squadron radio-preset kneeboards (VF-103 Tomcat + VMFA-224
 * Hornet cards, 2026-06-10).
 *
 * Two layers:
 *   1. NET CATALOG — wing-wide named nets. "Texaco 1 = 332.100 AM" is
 *      true in every cockpit. AI-variant services (e.g. "AI Tower CVN"
 *      at +.050 from the human "Tower CVN") are separate first-class
 *      nets, because DCS AI ATC and human SRS controllers must not
 *      share a freq. MIDS voice nets carry a channel instead of a
 *      frequency (Hornet intra-flight rides MIDS A/B, not a radio).
 *   2. BUTTON MAPS — per airframe × per radio: preset button → net.
 *      Buttons 1-10 are typically the wing-standard core; tails flex
 *      per airframe. Counts vary (Tomcat Rear carries 24, Front 20)
 *      and placement is band-driven — a 142 MHz JTAC net can only sit
 *      on a radio that tunes VHF.
 * ────────────────────────────────────────────────────────────────────── */

export type CommNetKind = 'radio' | 'midsA' | 'midsB';

export interface CommNet {
  /** Stable id — button maps reference nets by id so a freq change
   *  propagates everywhere without rewriting maps. */
  id: string;
  /** Short display name, exactly as it appears on the kneeboard card
   *  ("Texaco 1", "AI Tower CVN", "Marshal CVN", "Vic Common"). */
  name: string;
  kind: CommNetKind;
  /** MHz — radio nets only. */
  frequency?: number;
  modulation?: Modulation;
  /** MIDS voice channel (1-126) — midsA/midsB nets only. */
  midsChannel?: number;
  notes?: string;
}

export interface RadioButtonMap {
  /** DCS aircraft type this map belongs to (e.g. "FA-18C_hornet",
   *  "F-14B"). One SOP can carry maps for several airframes. */
  aircraft: string;
  /** 1-based radio index matching the .miz Radio[n] table. */
  radio: number;
  /** Display label for the radio ("Radio 1", "Rear", "COMM 2").
   *  Cosmetic — the kneeboard card prints it as the column header. */
  radioLabel?: string;
  /** Preset button number → net id. Sparse: missing buttons are
   *  simply unprogrammed. */
  buttons: Record<number, string>;
}

export interface CommPlan {
  nets: CommNet[];
  maps: RadioButtonMap[];
}

export function makeEmptyCommPlan(): CommPlan {
  return { nets: [], maps: [] };
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

  /** Named comm frequencies (used as deconflict pool base).
   *  NOTE (v1.19.77): superseded by `commPlan` for squadrons that
   *  define one — kept for backward compatibility with existing SOPs
   *  and as the lightweight option for groups without a full plan. */
  comms: SopCommEntry[];

  /** Wing comm plan: net catalog + per-airframe/per-radio preset
   *  button maps. Optional — older SOPs won't have it. When present
   *  AND the SOP is active, preset ladders, DTC COMM pages, and the
   *  radio kneeboard card all derive from this. */
  commPlan?: CommPlan;

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
