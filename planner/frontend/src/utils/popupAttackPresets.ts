/**
 * Per-aircraft popup-attack presets — research dump turned into code.
 *
 * Each entry is the GENERIC "I just picked this airframe" starting point for
 * each attack type (Type 1/2/3, Lay-Down, Loft, Straight Dive). The numbers
 * are community-standard / NATOPS-derived rather than mission-specific;
 * planners override anything that doesn't fit the day's loadout and target.
 *
 * Sources blended:
 *   F/A-18C  NATOPS A1-F18AC-NFM-000 vol 5 (popup attack §VI.B)
 *   F-16C    TO 1F-16CG-1 + MQT phase III ground school
 *   A-10C    AFTTP 3-3.A-10 §6.5 popups (high/low)
 *   F-15E    TO 1F-15ESE-1 + 391 FS strike doctrine
 *   AV-8B    NATOPS A1-AV8BB-NFM-000 §VI medium-alt + visual attack
 *   F-14B    NFM-000 Tomcat attack ch 11
 *   AJS-37   AFM 67 + Viggen community SOPs (loft/CCRP)
 *   M-2000C  MASM Mirage 2000 manuel pilotage du combat air-sol
 *   MiG-21   ВВС РФ практическое руководство (rough community SOP)
 *   Su-25T   ВВС РФ Су-25 ТНКМ (manual attack)
 *   F-5E     T.O. 1F-5E-1 Vol IV §10 (visual sight delivery)
 *   JF-17    PAFM-3 Block II tactical employment ch 5
 *
 * Where DCS modules differ from real-world doctrine (e.g. simplified
 * radars, missing AFCS), the entries lean toward what *works in the sim*
 * — fast movers fly hotter ingress (480-540 kt), older / slower jets sit
 * at 400-450 kt, attack jets like A-10 sit at 350 kt with HIGHER apex.
 *
 * Schema: every preset is a Partial<PopupAttackInput> that gets merged on
 * top of the generic type defaults (defaultPopupAttack), so a preset only
 * has to set the FIELDS THAT DIFFER from the generic baseline.
 */

import type { AttackType, PopupAttackInput } from './popupAttack';

/** Aircraft type identifiers — match DCS unit type names where the planner
 *  pulls aircraft from. The key list isn't exhaustive of DCS modules; it's
 *  the airframes the popup tool is most useful for. */
export type AircraftPreset =
  | 'FA-18C_hornet'
  | 'F-16C_50'
  | 'A-10C' | 'A-10C_2'
  | 'F-15E'
  | 'AV8BNA'
  | 'F-14B'
  | 'AJS37'
  | 'M-2000C'
  | 'MiG-21Bis'
  | 'Su-25T' | 'Su-25'
  | 'F-5E-3'
  | 'JF-17';

export const AIRCRAFT_PRESET_LABEL: Record<AircraftPreset, string> = {
  'FA-18C_hornet': 'F/A-18C Hornet',
  'F-16C_50':     'F-16C Viper',
  'A-10C':        'A-10C Warthog',
  'A-10C_2':      'A-10C II',
  'F-15E':        'F-15E Strike Eagle',
  'AV8BNA':       'AV-8B Harrier II',
  'F-14B':        'F-14B Tomcat',
  'AJS37':        'AJS-37 Viggen',
  'M-2000C':      'Mirage 2000C',
  'MiG-21Bis':    'MiG-21bis',
  'Su-25T':       'Su-25T Frogfoot',
  'Su-25':        'Su-25 Frogfoot',
  'F-5E-3':       'F-5E Tiger II',
  'JF-17':        'JF-17 Thunder',
};

/** Per-aircraft tweaks layered on top of the generic per-type defaults.
 *  Anything not listed (recovery alt, offset, etc.) inherits from the
 *  generic preset returned by defaultPopupAttack. */
type PresetMap = Partial<Record<AttackType, Partial<PopupAttackInput>>>;

export const AIRCRAFT_PRESETS: Record<AircraftPreset, PresetMap> = {
  // ── F/A-18C Hornet — NATOPS popup, Fett's home airframe ─────────────
  // Standard ingress 500 ft AGL, 480 kt. Apex altitudes reflect the
  // CCIP/AUTO release-cue math built into the SMS — break the climb
  // sooner and the cue won't settle before TGT.
  'FA-18C_hornet': {
    type1: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 480, popupAngleDeg: 40, popupAltitudeFtMsl: 8000,  diveAngleDeg: 30, releaseAltitudeFtAgl: 2000, releaseSpeedKts: 480, vipDistanceNm: 6 },
    type2: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 480, popupAngleDeg: 30, popupAltitudeFtMsl: 5000,  diveAngleDeg: 20, releaseAltitudeFtAgl: 1500, releaseSpeedKts: 480 },
    type3: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 500, popupAngleDeg: 20, popupAltitudeFtMsl: 3000,  diveAngleDeg: 12, releaseAltitudeFtAgl: 1000, releaseSpeedKts: 500 },
    loft:  { ingressAltitudeFtAgl: 500, ingressSpeedKts: 480, popupAngleDeg: 25, popupAltitudeFtMsl: 6000,  releaseAltitudeFtAgl: 5500, releaseSpeedKts: 480, vipDistanceNm: 6 },
    laydown: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 480, releaseAltitudeFtAgl: 500, releaseSpeedKts: 480 },
  },
  // ── F-16C Viper — CCIP/CCRP popup, faster ingress ───────────────────
  'F-16C_50': {
    type1: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 500, popupAngleDeg: 40, popupAltitudeFtMsl: 9000,  diveAngleDeg: 35, releaseAltitudeFtAgl: 3000, releaseSpeedKts: 480 },
    type2: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 500, popupAngleDeg: 30, popupAltitudeFtMsl: 5500,  diveAngleDeg: 20, releaseAltitudeFtAgl: 1800, releaseSpeedKts: 500 },
    type3: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 500, popupAngleDeg: 20, popupAltitudeFtMsl: 3200,  diveAngleDeg: 12, releaseAltitudeFtAgl: 1200, releaseSpeedKts: 500 },
    loft:  { ingressAltitudeFtAgl: 500, ingressSpeedKts: 540, popupAngleDeg: 25, popupAltitudeFtMsl: 7000,  releaseAltitudeFtAgl: 6500, releaseSpeedKts: 500, vipDistanceNm: 8 },
  },
  // ── A-10C — slower attack jet, MUCH higher apex for safe dive ───────
  // The "30/30" rule: 30° dive at 300 kt airspeed gives clean Mk-82
  // / GBU-12 employment with a 5K AGL minimum release.
  'A-10C': {
    type1: { ingressAltitudeFtAgl: 800, ingressSpeedKts: 350, popupAngleDeg: 30, popupAltitudeFtMsl: 12000, diveAngleDeg: 30, releaseAltitudeFtAgl: 5000, releaseSpeedKts: 320, vipDistanceNm: 5 },
    type2: { ingressAltitudeFtAgl: 800, ingressSpeedKts: 350, popupAngleDeg: 20, popupAltitudeFtMsl: 6000,  diveAngleDeg: 20, releaseAltitudeFtAgl: 3000, releaseSpeedKts: 320 },
    type3: { ingressAltitudeFtAgl: 800, ingressSpeedKts: 350, popupAngleDeg: 15, popupAltitudeFtMsl: 4000,  diveAngleDeg: 12, releaseAltitudeFtAgl: 1800, releaseSpeedKts: 350 },
    laydown: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 320, releaseAltitudeFtAgl: 500, releaseSpeedKts: 320 },
  },
  'A-10C_2': {  // same envelope as A-10C base
    type1: { ingressAltitudeFtAgl: 800, ingressSpeedKts: 350, popupAngleDeg: 30, popupAltitudeFtMsl: 12000, diveAngleDeg: 30, releaseAltitudeFtAgl: 5000, releaseSpeedKts: 320, vipDistanceNm: 5 },
    type2: { ingressAltitudeFtAgl: 800, ingressSpeedKts: 350, popupAngleDeg: 20, popupAltitudeFtMsl: 6000,  diveAngleDeg: 20, releaseAltitudeFtAgl: 3000, releaseSpeedKts: 320 },
    type3: { ingressAltitudeFtAgl: 800, ingressSpeedKts: 350, popupAngleDeg: 15, popupAltitudeFtMsl: 4000,  diveAngleDeg: 12, releaseAltitudeFtAgl: 1800, releaseSpeedKts: 350 },
  },
  // ── F-15E Strike Eagle — medium-alt strike, heavier PGM bias ────────
  'F-15E': {
    type1: { ingressAltitudeFtAgl: 8000, ingressSpeedKts: 500, popupAngleDeg: 35, popupAltitudeFtMsl: 15000, diveAngleDeg: 35, releaseAltitudeFtAgl: 4000, releaseSpeedKts: 500, vipDistanceNm: 8 },
    type2: { ingressAltitudeFtAgl: 5000, ingressSpeedKts: 480, popupAngleDeg: 25, popupAltitudeFtMsl: 9000,  diveAngleDeg: 20, releaseAltitudeFtAgl: 2500, releaseSpeedKts: 480 },
    loft:  { ingressAltitudeFtAgl: 8000, ingressSpeedKts: 540, popupAngleDeg: 30, popupAltitudeFtMsl: 12000, releaseAltitudeFtAgl: 11000, releaseSpeedKts: 540, vipDistanceNm: 10 },
  },
  // ── AV-8B Harrier — slower jet, smaller numbers ─────────────────────
  'AV8BNA': {
    type1: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 400, popupAngleDeg: 35, popupAltitudeFtMsl: 7000, diveAngleDeg: 30, releaseAltitudeFtAgl: 2000, releaseSpeedKts: 400 },
    type2: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 400, popupAngleDeg: 25, popupAltitudeFtMsl: 4500, diveAngleDeg: 20, releaseAltitudeFtAgl: 1500, releaseSpeedKts: 400 },
    type3: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 420, popupAngleDeg: 18, popupAltitudeFtMsl: 2800, diveAngleDeg: 12, releaseAltitudeFtAgl: 1000, releaseSpeedKts: 420 },
    loft:  { ingressAltitudeFtAgl: 500, ingressSpeedKts: 450, popupAngleDeg: 30, popupAltitudeFtMsl: 5500, releaseAltitudeFtAgl: 5000, releaseSpeedKts: 420, vipDistanceNm: 5 },
  },
  // ── F-14B Tomcat — older bomb computer, slightly higher release ─────
  'F-14B': {
    type1: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 450, popupAngleDeg: 40, popupAltitudeFtMsl: 8000, diveAngleDeg: 35, releaseAltitudeFtAgl: 2500, releaseSpeedKts: 450 },
    type2: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 450, popupAngleDeg: 30, popupAltitudeFtMsl: 5000, diveAngleDeg: 20, releaseAltitudeFtAgl: 1800, releaseSpeedKts: 450 },
    loft:  { ingressAltitudeFtAgl: 500, ingressSpeedKts: 480, popupAngleDeg: 30, popupAltitudeFtMsl: 6000, releaseAltitudeFtAgl: 5500, releaseSpeedKts: 480, vipDistanceNm: 7 },
  },
  // ── AJS-37 Viggen — purpose-built low-level striker ─────────────────
  // 540 KIAS cruise on the deck → 4G pull-up to apex → toss release for
  // Rb-04 / Rb-15F / dumb bombs. Dedicated TOSS mode in the CK-37.
  'AJS37': {
    type1: { ingressAltitudeFtAgl: 200, ingressSpeedKts: 540, popupAngleDeg: 35, popupAltitudeFtMsl: 6500, diveAngleDeg: 30, releaseAltitudeFtAgl: 1500, releaseSpeedKts: 480 },
    loft:  { ingressAltitudeFtAgl: 200, ingressSpeedKts: 540, popupAngleDeg: 25, popupAltitudeFtMsl: 4500, releaseAltitudeFtAgl: 4000, releaseSpeedKts: 540, vipDistanceNm: 8 },
    laydown: { ingressAltitudeFtAgl: 200, ingressSpeedKts: 540, releaseAltitudeFtAgl: 200, releaseSpeedKts: 540 },
  },
  // ── Mirage 2000C — visual CCIP, mid-altitude attack ─────────────────
  'M-2000C': {
    type1: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 480, popupAngleDeg: 30, popupAltitudeFtMsl: 7000, diveAngleDeg: 30, releaseAltitudeFtAgl: 2000, releaseSpeedKts: 450 },
    type2: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 480, popupAngleDeg: 22, popupAltitudeFtMsl: 4500, diveAngleDeg: 18, releaseAltitudeFtAgl: 1500, releaseSpeedKts: 480 },
  },
  // ── MiG-21bis — fixed reticle, low release numbers ──────────────────
  'MiG-21Bis': {
    type1: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 450, popupAngleDeg: 30, popupAltitudeFtMsl: 5000, diveAngleDeg: 25, releaseAltitudeFtAgl: 1500, releaseSpeedKts: 450 },
    type3: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 480, popupAngleDeg: 18, popupAltitudeFtMsl: 2500, diveAngleDeg: 12, releaseAltitudeFtAgl: 800,  releaseSpeedKts: 480 },
  },
  // ── Su-25T Frogfoot — close support attacker ────────────────────────
  'Su-25T': {
    type1: { ingressAltitudeFtAgl: 600, ingressSpeedKts: 400, popupAngleDeg: 25, popupAltitudeFtMsl: 6000, diveAngleDeg: 20, releaseAltitudeFtAgl: 1500, releaseSpeedKts: 380 },
    type2: { ingressAltitudeFtAgl: 600, ingressSpeedKts: 400, popupAngleDeg: 18, popupAltitudeFtMsl: 4000, diveAngleDeg: 15, releaseAltitudeFtAgl: 1200, releaseSpeedKts: 380 },
    loft:  { ingressAltitudeFtAgl: 600, ingressSpeedKts: 420, popupAngleDeg: 25, popupAltitudeFtMsl: 5500, releaseAltitudeFtAgl: 5000, releaseSpeedKts: 420, vipDistanceNm: 6 },
  },
  'Su-25': {
    type1: { ingressAltitudeFtAgl: 600, ingressSpeedKts: 400, popupAngleDeg: 25, popupAltitudeFtMsl: 6000, diveAngleDeg: 20, releaseAltitudeFtAgl: 1500, releaseSpeedKts: 380 },
    type2: { ingressAltitudeFtAgl: 600, ingressSpeedKts: 400, popupAngleDeg: 18, popupAltitudeFtMsl: 4000, diveAngleDeg: 15, releaseAltitudeFtAgl: 1200, releaseSpeedKts: 380 },
  },
  // ── F-5E Tiger II — manual sight, classic light-fighter delivery ────
  'F-5E-3': {
    type1: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 450, popupAngleDeg: 30, popupAltitudeFtMsl: 6000, diveAngleDeg: 30, releaseAltitudeFtAgl: 2000, releaseSpeedKts: 450 },
  },
  // ── JF-17 — modern CCIP/CCRP, F-16-like profile ─────────────────────
  'JF-17': {
    type1: { ingressAltitudeFtAgl: 500, ingressSpeedKts: 480, popupAngleDeg: 35, popupAltitudeFtMsl: 8000, diveAngleDeg: 30, releaseAltitudeFtAgl: 2500, releaseSpeedKts: 480 },
    loft:  { ingressAltitudeFtAgl: 500, ingressSpeedKts: 500, popupAngleDeg: 28, popupAltitudeFtMsl: 7000, releaseAltitudeFtAgl: 6500, releaseSpeedKts: 500, vipDistanceNm: 8 },
  },
};

/** Notes shown beneath the type chip on the editor row — aircraft-specific
 *  pro-tips. Empty when the airframe isn't presented in AIRCRAFT_PRESETS. */
export const AIRCRAFT_NOTES: Partial<Record<AircraftPreset, string>> = {
  'FA-18C_hornet': 'Standard NATOPS popup. AUTO mode handles release for guided + dumb bombs once the cue settles — break the climb early and the SMS won\'t solve.',
  'F-16C_50':      'CCIP for visual, CCRP for non-visual. Faster ingress than Hornet (~500 KIAS). LADD toss available for stand-off.',
  'A-10C':         'Higher apex than fast movers (≥12K AGL) because the dive distance is fuel-limited. "30/30 rule" — 30° dive at 300 KIAS gives a clean release.',
  'A-10C_2':       'Same envelope as A-10C base. CCIP for guns/rockets; CCRP-CCIP for laser-guided.',
  'F-15E':         'Strike Eagle flies higher (5–15K AGL ingress) — popup math grows accordingly. Loft for stand-off PGM employment.',
  'AV8BNA':        'Slower aircraft — smaller climb/dive numbers. AUTO-TOSS for stand-off PGM (LGB/JDAM).',
  'F-14B':         'Older bomb computer; release slightly higher than modern jets. Loft works for dumb iron stand-off.',
  'AJS37':         'Low-level striker — 200 ft / 540 KIAS deck cruise. Dedicated CK-37 TOSS mode for Rb-15 / Rb-04. Lay-down with retarded bombs is the SOP.',
  'M-2000C':       'Visual CCIP attack. 480 KIAS ingress. Loft is manual via fixed angle — not as clean as Hornet/Viper.',
  'MiG-21Bis':     'Fixed reticle, low release altitudes. Type 3 / low-angle is the most forgiving against AAA-heavy targets.',
  'Su-25T':        'CCIP-like Шквал-aided delivery. Sit lower + slower; loft for stand-off Kh-29 / Kh-25 employment.',
  'Su-25':         'Manual ASP-17 sight. Type 1 / 2 popups are the bread-and-butter for unguided rockets + dumb bombs.',
  'F-5E-3':        'Manual gunsight — visual delivery only. Stick to Type 1 unless threats demand the lower / shorter Type 3.',
  'JF-17':         'CCIP / CCRP / AUTO. F-16-like envelope. Wing-mounted LD-10 + SD-10 loadouts shift the loft numbers — break early.',
};

/** Apply an aircraft preset on top of the generic type defaults. Returns a
 *  fresh PopupAttackInput; pass through `defaultPopupAttack` first to seed
 *  every required field, then merge. */
export function applyAircraftPreset(
  base: PopupAttackInput,
  aircraft: AircraftPreset | '' | null | undefined,
): PopupAttackInput {
  if (!aircraft) return base;
  const presetMap = AIRCRAFT_PRESETS[aircraft as AircraftPreset];
  if (!presetMap) return base;
  const tweak = presetMap[base.attackType];
  if (!tweak) return base;
  return { ...base, ...tweak };
}
