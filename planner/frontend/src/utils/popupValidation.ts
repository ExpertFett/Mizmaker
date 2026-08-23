/**
 * Protocol checks for a popup attack profile.
 *
 * computePopupAttack is deliberately permissive — it renders whatever
 * geometry it is handed, including profiles that would fly a jet into the
 * ground. This module is the other half: it says whether the numbers a
 * planner has dragged out sit inside the brackets a popup attack is flown
 * within, and where they do not, by how much.
 *
 * Two kinds of finding:
 *   'error'   — the profile does not close, or it kills you. Geometry that
 *               cannot be flown as drawn.
 *   'caution' — flyable, but outside the usual bracket or thin on margin.
 *
 * The brackets below are general fighter-attack values rather than any one
 * airframe's numbers, and the weapon-related ones are deliberately
 * conservative. They are a planning sanity check, not clearance to employ —
 * a squadron SOP wins wherever the two disagree.
 */

import type { PopupAttackInput } from './popupAttack';
import { computePopupAttack } from './popupAttack';

const FT_PER_NM = 6076.115;
const KTS_TO_FPS = 1.68781;
const G_FT_S2 = 32.174;

/** Pull-out load factor assumed for the recovery computation. 4g is a
 *  routine, briefable pull — not a max-performance recovery. */
const RECOVERY_G = 4;

/** Margin required between the bottom of the pull-out and the ground. */
const TERRAIN_MARGIN_FT = 500;

/** Lowest altitude worth flying an ingress at. Below this the profile is
 *  likelier to hit terrain than to defeat a radar. */
const INGRESS_HARD_DECK_FT_AGL = 200;

/** Bands a popup is normally flown inside. Outside is not automatically
 *  wrong — it earns a caution, not an error. */
const POPUP_ANGLE_DEG = { min: 15, max: 45 };
const DIVE_ANGLE_DEG = { min: 10, max: 60 };
const APEX_ABOVE_INGRESS_FT = { min: 1500 };

/** Minimum release altitude for frag clearance with unguided bombs. */
const MIN_RELEASE_AGL_FT = 1500;

/** Slant range brackets, deliberately loose — a planning guard, not an
 *  employment envelope. */
const SLANT_RANGE_NM = { min: 0.5, max: 8 };

export type FindingLevel = 'error' | 'caution';

export interface PopupFinding {
  level: FindingLevel;
  /** Which input to blame, so the UI can flag the handle being dragged. */
  field: keyof PopupAttackInput | 'geometry';
  message: string;
}

/**
 * Altitude given up recovering from a dive at `diveDeg` and `speedKts`.
 *
 * Standard pull-out geometry: the jet flies an arc of radius V^2/(g(n-1))
 * and loses R(1 - cos theta) of altitude completing it.
 */
export function pulloutLossFt(diveDeg: number, speedKts: number): number {
  const v = Math.max(1, speedKts) * KTS_TO_FPS;
  const radiusFt = (v * v) / (G_FT_S2 * (RECOVERY_G - 1));
  const theta = (Math.max(0, diveDeg) * Math.PI) / 180;
  return radiusFt * (1 - Math.cos(theta));
}

/** Slant range from the release point to the target. */
export function slantRangeNm(input: PopupAttackInput): number {
  const profile = computePopupAttack(input);
  const rp = profile.points.find((p) => p.label === 'RP');
  const tgt = profile.points.find((p) => p.label === 'TGT');
  if (!rp || !tgt) return 0;
  const horizNm = Math.abs(tgt.distanceNm - rp.distanceNm);
  const vertNm = Math.abs(rp.altitudeFtMsl - tgt.altitudeFtMsl) / FT_PER_NM;
  return Math.hypot(horizNm, vertNm);
}

export function validatePopupAttack(input: PopupAttackInput): PopupFinding[] {
  const out: PopupFinding[] = [];
  const add = (level: FindingLevel, field: PopupFinding['field'], message: string) =>
    out.push({ level, field, message });

  const ingressMsl = input.targetElevationFt + input.ingressAltitudeFtAgl;
  const isPopup = input.attackType === 'type1'
    || input.attackType === 'type2'
    || input.attackType === 'type3';
  const dives = input.attackType !== 'laydown' && input.attackType !== 'loft';

  // --- the profile has to close ----------------------------------------
  if (isPopup) {
    const apexAboveIngress = input.popupAltitudeFtMsl - ingressMsl;
    if (apexAboveIngress <= 0) {
      add('error', 'popupAltitudeFtMsl',
        `Apex ${Math.round(input.popupAltitudeFtMsl).toLocaleString()} ft MSL is at or below ingress `
        + `(${Math.round(ingressMsl).toLocaleString()} ft MSL) — there is no climb to fly.`);
    } else if (apexAboveIngress < APEX_ABOVE_INGRESS_FT.min) {
      add('caution', 'popupAltitudeFtMsl',
        `Only ${Math.round(apexAboveIngress).toLocaleString()} ft of climb above ingress; `
        + `${APEX_ABOVE_INGRESS_FT.min.toLocaleString()} ft is the usual minimum to get the nose `
        + 'down and acquire.');
    }

    if (input.popupAltitudeFtMsl <= input.targetElevationFt + input.releaseAltitudeFtAgl) {
      add('error', 'releaseAltitudeFtAgl',
        'Release altitude is at or above the apex — the dive never descends to it.');
    }
  }

  // --- recovery --------------------------------------------------------
  if (dives) {
    const loss = pulloutLossFt(input.diveAngleDeg, input.releaseSpeedKts);
    const spare = input.releaseAltitudeFtAgl - loss;
    if (spare < TERRAIN_MARGIN_FT) {
      add('error', 'releaseAltitudeFtAgl',
        `A ${Math.round(input.diveAngleDeg)}° dive at ${Math.round(input.releaseSpeedKts)} kt gives up `
        + `${Math.round(loss).toLocaleString()} ft in a ${RECOVERY_G}g pull-out. Releasing at `
        + `${Math.round(input.releaseAltitudeFtAgl).toLocaleString()} ft AGL leaves `
        + `${Math.round(spare).toLocaleString()} ft — under the ${TERRAIN_MARGIN_FT} ft floor.`);
    } else if (spare < TERRAIN_MARGIN_FT * 2) {
      add('caution', 'releaseAltitudeFtAgl',
        `Pull-out bottoms out ${Math.round(spare).toLocaleString()} ft above the target — thin.`);
    }
  }

  // --- weapon release --------------------------------------------------
  if (input.attackType !== 'laydown' && input.releaseAltitudeFtAgl < MIN_RELEASE_AGL_FT) {
    add('caution', 'releaseAltitudeFtAgl',
      `${Math.round(input.releaseAltitudeFtAgl).toLocaleString()} ft AGL is below the `
      + `${MIN_RELEASE_AGL_FT.toLocaleString()} ft frag-clearance rule of thumb for unguided bombs.`);
  }

  const slant = slantRangeNm(input);
  if (slant > SLANT_RANGE_NM.max) {
    add('caution', 'diveAngleDeg',
      `Release slant range ${slant.toFixed(1)} NM is long — check the weapon's max range.`);
  } else if (slant > 0 && slant < SLANT_RANGE_NM.min) {
    add('caution', 'diveAngleDeg',
      `Release slant range ${slant.toFixed(1)} NM is inside ${SLANT_RANGE_NM.min} NM — check arming time.`);
  }

  // --- angles ----------------------------------------------------------
  if (isPopup
      && (input.popupAngleDeg < POPUP_ANGLE_DEG.min || input.popupAngleDeg > POPUP_ANGLE_DEG.max)) {
    add('caution', 'popupAngleDeg',
      `${Math.round(input.popupAngleDeg)}° climb is outside the usual `
      + `${POPUP_ANGLE_DEG.min}–${POPUP_ANGLE_DEG.max}° popup bracket.`);
  }
  if (dives
      && (input.diveAngleDeg < DIVE_ANGLE_DEG.min || input.diveAngleDeg > DIVE_ANGLE_DEG.max)) {
    add('caution', 'diveAngleDeg',
      `${Math.round(input.diveAngleDeg)}° dive is outside the usual `
      + `${DIVE_ANGLE_DEG.min}–${DIVE_ANGLE_DEG.max}° bracket.`);
  }

  // --- run-in ----------------------------------------------------------
  if (input.ingressAltitudeFtAgl < INGRESS_HARD_DECK_FT_AGL) {
    add('error', 'ingressAltitudeFtAgl',
      `Ingress at ${Math.round(input.ingressAltitudeFtAgl)} ft AGL is below the `
      + `${INGRESS_HARD_DECK_FT_AGL} ft hard deck.`);
  }
  if (input.vipDistanceNm <= 0) {
    add('error', 'vipDistanceNm',
      'Action point is on top of the target — there is no run-in to pull up from.');
  }

  return out;
}

/** Worst finding level present, or null when the profile is clean. */
export function worstLevel(findings: PopupFinding[]): FindingLevel | null {
  if (findings.some((f) => f.level === 'error')) return 'error';
  if (findings.length > 0) return 'caution';
  return null;
}
