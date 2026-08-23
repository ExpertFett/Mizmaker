/**
 * Flight lead controls — the numbers the cards used to hardcode.
 *
 * Every card derived its output from constants sitting in its own file:
 * a 4,000 lb bingo floor, a 1,000 ft MSA buffer, a 3 nm threat-clustering
 * radius, six popup-attack limits. Most were reasonable defaults. Several
 * were squadron doctrine wearing a constant's clothing — the popup limits
 * in particular were documented as "a planning sanity check your SOP
 * overrides", with no way to override them.
 *
 * This is that override surface. One typed block, grouped the way a flight
 * lead thinks about it, with the old constants as the defaults so nothing
 * changes for anyone who never opens the panel.
 *
 * Scope note. Some of these belong to the squadron and should be set once
 * (MSA buffer, popup limits, guard frequency); others are per-mission calls
 * (how many diverts, threat floor). They live together here because they
 * share a storage and defaulting mechanism — the UI is what separates them.
 */

import type { PopupLimits } from '../utils/popupValidation';

/* ------------------------------------------------------------------ fuel */

export interface FuelOptions {
  /** Bingo never computes below this, whatever the percentage says.
   *  Drives refuel decisions and trap weight. */
  bingoFloorLbs: number;
  /** Joker as a fraction of start fuel. */
  jokerPct: number;
  /** Bingo as a fraction of start fuel, before the floor applies. */
  bingoPct: number;
  /** Joker is forced at least this far above bingo, so the two calls never
   *  collapse into each other on a short-legged jet. */
  jokerMarginLbs: number;
  /** Known cruise flow in PPH. Scales the physics burn model so it passes
   *  through a number the crew has actually seen on the gauge. 0 = model
   *  only. */
  knownCruisePph: number;
  /** Check recovery fuel against the airframe's landing weight limit. */
  checkRecoveryWeight: boolean;
  /** Override the trap limit for this squadron. 0 = use the published seed
   *  in fuelModel's RECOVERY_LIMITS. */
  trapLimitLbs: number;
}

/* --------------------------------------------------------------- threats */

export interface ThreatOptions {
  /** Systems with a shorter range than this are dropped from the card. 0
   *  keeps everything — right for a low-level or CAS profile, wrong for a
   *  package pushing at 25,000 ft that cannot be touched by AAA. */
  minRangeKm: number;
  /** Same system within this distance merges into one site row. */
  siteRadiusNm: number;
  /** What the threat ring represents.
   *  'max'       — full published kinematic range (as before)
   *  'practical' — a planning fraction of it, the range it will realistically
   *                engage and hit at
   *  'both'      — practical filled, max as a dashed outer ring */
  ringBasis: 'max' | 'practical' | 'both';
  /** Practical ring as a fraction of max range. There is no per-system WEZ
   *  data in the mission or the SAM table, so this is deliberately one
   *  documented planning factor rather than invented per-system numbers. */
  practicalFactor: number;
}

/* ---------------------------------------------------- navigation/terrain */

export interface NavOptions {
  /** Clearance added over the highest terrain in the corridor. 1,000 ft is
   *  standard; 2,000 is common doctrine in terrain like Kola. */
  msaBufferFt: number;
  /** Half-width of the corridor MSA is computed over. */
  msaCorridorNm: number;
  /** Waypoints per strip-map sheet. Fewer means a bigger map. */
  waypointsPerStripPage: number;
  /** Base layer under the route and target maps. */
  mapLayer: 'satellite' | 'dark' | 'none';
  /** Pin every route map to one scale, in NM across the frame, so sheets in a
   *  deck match. 0 = each map picks its own. */
  pinnedScaleNm: number;
  /** Strip map orientation. 'track' rotates each sheet so the leg runs up the
   *  page, which is what a paper strip map actually was. */
  stripOrientation: 'north' | 'track';
}

/* --------------------------------------------------------------- diverts */

export interface DivertOptions {
  /** How many diverts to list. Previously three different numbers in three
   *  cards — 8 on Home Plate, 14 on the Airbase Reference, 4 diagrams. */
  count: number;
  /** A field counts as route-relevant within this distance of any waypoint. */
  searchRadiusNm: number;
  /** What to do with enemy-held fields. */
  enemyFields: 'hide' | 'mark' | 'include';
}

/* ----------------------------------------------------------------- comms */

export interface CommsOptions {
  /** Guard frequencies, in MHz. Empty drops the rung entirely. */
  guardMhz: number[];
  /** Labels for the jet's radios, used on preset channel tags. Two entries
   *  covers every DCS airframe worth tagging; the Hornet's L/R is only right
   *  for the Hornet. */
  radioLabels: [string, string];
}

/* ------------------------------------------------------------ weapons */

export interface WeaponOptions {
  /** Half-width of a DMPI imagery chip. */
  targetChipNm: number;
  /** Laser ladder start when the SOP does not set one. */
  laserCodeBase: number;
  /** Popup-attack protocol limits. See popupValidation.ts — these are the
   *  six numbers that decide whether a profile reads as flyable. */
  popup: PopupLimits;
}

/* --------------------------------------------------------------- weather */

export interface WeatherOptions {
  /** Ambient temperature at which a persistent contrail starts forming. */
  contrailOnsetC: number;
  /** Colder than this and there is generally too little moisture to sustain
   *  one. */
  contrailTopC: number;
  /** Show the contrail row at all. */
  showContrails: boolean;
}

/* ----------------------------------------------------------- presentation */

export interface LayoutOptions {
  /** Table row density, applied across every card that paginates. */
  density: 'compact' | 'normal' | 'large';
  /** Notes box height as a fraction of the card. */
  notesSize: 'none' | 'quarter' | 'half';
  /** Truncate store names on the station diagram, or print them in full. */
  storeNames: 'short' | 'full';
  /** Card order for the deck, as card keys. Anything not listed keeps its
   *  derived position after the ones that are. Empty = built-in order. */
  cardOrder: string[];
}

export interface KneeboardOptions {
  fuel: FuelOptions;
  threats: ThreatOptions;
  nav: NavOptions;
  diverts: DivertOptions;
  comms: CommsOptions;
  weapons: WeaponOptions;
  weather: WeatherOptions;
  layout: LayoutOptions;
}

/**
 * Defaults are exactly the constants the cards used before this existed, so
 * an existing mission renders identically until someone changes something.
 */
export const DEFAULT_OPTIONS: KneeboardOptions = {
  fuel: {
    bingoFloorLbs: 4000,
    jokerPct: 0.35,
    bingoPct: 0.20,
    jokerMarginLbs: 1000,
    knownCruisePph: 0,
    checkRecoveryWeight: true,
    trapLimitLbs: 0,
  },
  threats: {
    minRangeKm: 0,
    siteRadiusNm: 3,
    ringBasis: 'max',
    practicalFactor: 0.75,
  },
  nav: {
    msaBufferFt: 1000,
    msaCorridorNm: 5,
    waypointsPerStripPage: 7,
    mapLayer: 'satellite',
    pinnedScaleNm: 0,
    stripOrientation: 'north',
  },
  diverts: {
    count: 8,
    searchRadiusNm: 25,
    enemyFields: 'mark',
  },
  comms: {
    guardMhz: [243.0],
    radioLabels: ['L', 'R'],
  },
  weapons: {
    targetChipNm: 0.65,
    laserCodeBase: 1511,
    popup: {
      recoveryG: 4,
      terrainMarginFt: 500,
      ingressHardDeckFtAgl: 200,
      minReleaseAglFt: 1500,
      popupAngleDeg: { min: 15, max: 45 },
      diveAngleDeg: { min: 10, max: 60 },
    },
  },
  weather: {
    contrailOnsetC: -40,
    contrailTopC: -60,
    showContrails: true,
  },
  layout: {
    density: 'normal',
    notesSize: 'quarter',
    storeNames: 'short',
    cardOrder: [],
  },
};

/**
 * Fill in anything a stored options block is missing.
 *
 * Settings persist, so a mission saved before an option existed comes back
 * without it. Merging per group rather than at the top level means adding a
 * field later does not silently reset its whole section to defaults.
 */
export function resolveOptions(stored?: Partial<KneeboardOptions>): KneeboardOptions {
  if (!stored) return DEFAULT_OPTIONS;
  return {
    fuel: { ...DEFAULT_OPTIONS.fuel, ...stored.fuel },
    threats: { ...DEFAULT_OPTIONS.threats, ...stored.threats },
    nav: { ...DEFAULT_OPTIONS.nav, ...stored.nav },
    diverts: { ...DEFAULT_OPTIONS.diverts, ...stored.diverts },
    comms: { ...DEFAULT_OPTIONS.comms, ...stored.comms },
    weapons: {
      ...DEFAULT_OPTIONS.weapons,
      ...stored.weapons,
      // Nested one level deeper, so it needs its own merge or a stored block
      // missing a single limit would drop the other five.
      popup: {
        ...DEFAULT_OPTIONS.weapons.popup,
        ...stored.weapons?.popup,
        popupAngleDeg: {
          ...DEFAULT_OPTIONS.weapons.popup.popupAngleDeg,
          ...stored.weapons?.popup?.popupAngleDeg,
        },
        diveAngleDeg: {
          ...DEFAULT_OPTIONS.weapons.popup.diveAngleDeg,
          ...stored.weapons?.popup?.diveAngleDeg,
        },
      },
    },
    weather: { ...DEFAULT_OPTIONS.weather, ...stored.weather },
    layout: { ...DEFAULT_OPTIONS.layout, ...stored.layout },
  };
}

/**
 * Row counts for a paginating table at each density.
 *
 * Page one carries the threat map, which fixes how much table fits beneath
 * it — measured on a rendered card, 8 rows is the ceiling there whatever the
 * density, and the notes box does not change it (9 still overflowed with
 * notes off). So compact matches normal on page one and only earns its extra
 * rows on continuation pages, which carry no map.
 */
export const DENSITY_ROWS: Record<LayoutOptions['density'], { page1: number; pageN: number }> = {
  compact: { page1: 8, pageN: 22 },
  normal: { page1: 8, pageN: 18 },
  large: { page1: 6, pageN: 12 },
};

/** Notes box height as a fraction of card height. */
export const NOTES_FRACTION: Record<LayoutOptions['notesSize'], number> = {
  none: 0,
  quarter: 0.25,
  half: 0.5,
};
