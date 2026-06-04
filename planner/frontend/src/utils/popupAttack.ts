/**
 * Popup attack geometry — physics-based reference-point calculator.
 *
 * Given target / popup / dive / release / ingress parameters, computes the
 * along-track distance and altitude of each key reference point so the side
 * profile chart and kneeboard card can render the attack run honestly. Math
 * is intentionally simple (constant climb/dive angles, no weapon ballistics,
 * no terrain) — these are PLANNING figures, not a sim solver. Instructors can
 * tweak numbers; aircrew use the chart for the geometry, not the precise drop
 * solution.
 *
 * Reference points (acronyms used in the card legend):
 *   IP   — Initial Point (display anchor, before the run-in)
 *   AP   — Action Point / Visual IP — pilot pulls up here
 *   PDP  — Pull-Down Point — apex of the climb, roll into the dive
 *   RP   — Release Point
 *   TGT  — Target (ground)
 *   REC  — Recovery / egress complete
 */

export type AttackType = 'type1' | 'type2' | 'type3' | 'laydown' | 'loft' | 'dive';

export const ATTACK_TYPE_LABEL: Record<AttackType, string> = {
  type1: 'Type 1 Popup',
  type2: 'Type 2 Popup',
  type3: 'Type 3 Popup',
  laydown: 'Lay-Down',
  loft: 'Loft (Toss)',
  dive: 'Straight Dive',
};

/** Per-attack-type description shown beside the type chip in the editor +
 *  card. Keeps the geometry mental model in front of the user. */
export const ATTACK_TYPE_DESC: Record<AttackType, string> = {
  type1: 'High-angle popup, 30°+ dive — visual delivery from above the apex.',
  type2: 'Medium-angle popup, ~15–30° dive — compromise of stand-off and accuracy.',
  type3: 'Low-angle popup, ~10–15° dive — flatter run, shorter exposure peak.',
  laydown: 'Level release with retarded weapons — ingress alt through release.',
  loft: 'Toss / Loft — wings-level pull through the release; bomb arcs onto target.',
  dive: 'Roll-in from cruise into a straight dive — no popup, no level run-in.',
};

export interface PopupAttackInput {
  attackType: AttackType;
  /** Free-text label so a mission with multiple profiles can name each one. */
  name?: string;
  /** Optional aircraft type ID — when set, the editor "reset" button + the
   *  defaultPopupAttack helper apply that airframe's NATOPS/community-derived
   *  preset on top of the per-type baseline. See popupAttackPresets.ts. */
  aircraft?: string;
  /** Target ground elevation in feet MSL. */
  targetElevationFt: number;
  /** Distance from target to the Action Point along the attack run (NM). */
  vipDistanceNm: number;
  /** Apex altitude reached during the climb, in feet MSL. */
  popupAltitudeFtMsl: number;
  /** Climb angle held during the popup (deg). */
  popupAngleDeg: number;
  /** Ingress heading offset from target heading (deg) — for note only; the
   *  side profile is along-track and doesn't visualise the lateral offset. */
  angleOffsetDeg: number;
  diveAngleDeg: number;
  /** Release altitude above target ground (ft AGL). */
  releaseAltitudeFtAgl: number;
  releaseSpeedKts: number;
  ingressAltitudeFtAgl: number;
  ingressSpeedKts: number;
  /** Recovery (post-pull-out) altitude above target (ft AGL).
   *  Defaults to ingressAltitudeFtAgl when omitted — back to deck. */
  recoveryAltitudeFtAgl?: number;
}

export interface AttackPoint {
  label: string;
  distanceNm: number;       // along-track from chart origin (the Start point)
  altitudeFtMsl: number;
  /** Short caption for the chart marker / table row. */
  note?: string;
}

export interface PopupAttackProfile {
  input: PopupAttackInput;
  /** Ordered along-track waypoints — connect with straight segments for the
   *  side-profile chart. Last entry is the recovery / egress point. */
  points: AttackPoint[];
  totals: {
    ingressDisplayNm: number;
    popupDistanceNm: number;
    diveDistanceNm: number;
    recoveryDistanceNm: number;
    timeToTargetSec: number;
  };
}

const FT_PER_NM = 6076.115;
const INGRESS_DISPLAY_NM = 5; // visual run-in shown before the Action Point

/** Compute a popup attack profile from its input parameters. Pure function —
 *  always safe to call; physically nonsensical inputs (e.g. negative climb
 *  angle, popup altitude below ingress) won't throw but produce a degenerate
 *  profile the chart will still render. */
export function computePopupAttack(input: PopupAttackInput): PopupAttackProfile {
  const tElev = input.targetElevationFt;
  const ingressMsl = tElev + input.ingressAltitudeFtAgl;
  const releaseMsl = tElev + input.releaseAltitudeFtAgl;
  const recoveryAgl = input.recoveryAltitudeFtAgl ?? input.ingressAltitudeFtAgl;
  const recoveryMsl = tElev + recoveryAgl;

  const points: AttackPoint[] = [];

  // Start / IP marker — a 5 NM run-in for chart context.
  points.push({ label: 'IP', distanceNm: 0, altitudeFtMsl: ingressMsl, note: `${input.ingressSpeedKts} kt` });

  // Action Point (Visual IP) — pull-up here.
  const apDist = INGRESS_DISPLAY_NM;
  points.push({
    label: 'AP', distanceNm: apDist, altitudeFtMsl: ingressMsl,
    note: input.attackType === 'laydown' ? 'Visual IP' : `Pull up ${input.popupAngleDeg}°`,
  });

  if (input.attackType === 'laydown') {
    // Lay-down: ingress altitude through to release (over target).
    const tgtDist = apDist + Math.max(0, input.vipDistanceNm);
    points.push({
      label: 'RP', distanceNm: tgtDist, altitudeFtMsl: releaseMsl,
      note: `${input.releaseSpeedKts} kt level`,
    });
    points.push({ label: 'TGT', distanceNm: tgtDist, altitudeFtMsl: tElev, note: 'Target' });
    const recDist = tgtDist + 1.5;
    points.push({ label: 'REC', distanceNm: recDist, altitudeFtMsl: recoveryMsl, note: 'Egress' });
    return {
      input, points,
      totals: {
        ingressDisplayNm: INGRESS_DISPLAY_NM,
        popupDistanceNm: 0,
        diveDistanceNm: 0,
        recoveryDistanceNm: 1.5,
        timeToTargetSec: (Math.max(0, input.vipDistanceNm) / Math.max(1, input.ingressSpeedKts)) * 3600,
      },
    };
  }

  if (input.attackType === 'loft') {
    // Loft / Toss: ingress level → pull up at the Action Point → release
    // while still climbing at the popup altitude. The bomb arcs onto the
    // target as a stand-off projectile; no dive segment. PDP = RP here.
    const climbVertFt = input.popupAltitudeFtMsl - ingressMsl;
    const climbHorizFt = climbVertFt / Math.tan((Math.max(1, input.popupAngleDeg) * Math.PI) / 180);
    const climbHorizNm = Math.max(0, climbHorizFt / FT_PER_NM);
    const rpDist = apDist + climbHorizNm;
    points.push({
      label: 'RP', distanceNm: rpDist, altitudeFtMsl: input.popupAltitudeFtMsl,
      note: `Release climbing ${input.popupAngleDeg}° · ${input.releaseSpeedKts} kt`,
    });
    // Target sits stand-off — beyond the release point along the run line.
    const tgtDist = rpDist + Math.max(0.5, input.vipDistanceNm * 0.4);
    points.push({ label: 'TGT', distanceNm: tgtDist, altitudeFtMsl: tElev, note: 'Target (stand-off)' });
    // Recovery: pilot continues the pull through and recovers, modelled as
    // a level segment back at recovery altitude past the target.
    const recDist = tgtDist + 1.5;
    points.push({ label: 'REC', distanceNm: recDist, altitudeFtMsl: recoveryMsl, note: 'Recover & egress' });
    return {
      input, points,
      totals: {
        ingressDisplayNm: INGRESS_DISPLAY_NM,
        popupDistanceNm: climbHorizNm,
        diveDistanceNm: 0,
        recoveryDistanceNm: 1.5,
        timeToTargetSec: ((climbHorizNm + (tgtDist - rpDist)) / Math.max(1, (input.ingressSpeedKts + input.releaseSpeedKts) / 2)) * 3600,
      },
    };
  }

  if (input.attackType === 'dive') {
    // Straight dive: pilot ingresses at altitude, rolls in at the Action
    // Point, holds the dive angle to release, then recovers. No level
    // run-in past AP, no climb segment. Ingress altitude is the dive entry
    // altitude (popup alt input is ignored — we use ingressAltitudeFtAgl).
    const diveVertFt = ingressMsl - releaseMsl;
    const diveHorizFt = diveVertFt / Math.tan((Math.max(1, input.diveAngleDeg) * Math.PI) / 180);
    const diveHorizNm = Math.max(0, diveHorizFt / FT_PER_NM);
    const rpDist = apDist + diveHorizNm;
    points.push({
      label: 'RP', distanceNm: rpDist, altitudeFtMsl: releaseMsl,
      note: `${input.releaseSpeedKts} kt · ${input.diveAngleDeg}° dive`,
    });
    const tgtDist = rpDist + 0.5;
    points.push({ label: 'TGT', distanceNm: tgtDist, altitudeFtMsl: tElev, note: 'Target' });
    const recDist = tgtDist + 1.5;
    points.push({ label: 'REC', distanceNm: recDist, altitudeFtMsl: recoveryMsl, note: 'Egress' });
    const avgSpd = (input.ingressSpeedKts + input.releaseSpeedKts) / 2;
    return {
      input, points,
      totals: {
        ingressDisplayNm: INGRESS_DISPLAY_NM,
        popupDistanceNm: 0,
        diveDistanceNm: diveHorizNm,
        recoveryDistanceNm: 1.5,
        timeToTargetSec: ((diveHorizNm + 0.5) / Math.max(1, avgSpd)) * 3600,
      },
    };
  }

  // Type 1 / Type 2 / Type 3 popup geometry — identical math, the type
  // label and the typical dive-angle bracket are what differ in practice.
  const popupVertFt = input.popupAltitudeFtMsl - ingressMsl;
  const popupHorizFt = popupVertFt / Math.tan((Math.max(1, input.popupAngleDeg) * Math.PI) / 180);
  const popupHorizNm = Math.max(0, popupHorizFt / FT_PER_NM);
  const pdpDist = apDist + popupHorizNm;
  points.push({
    label: 'PDP', distanceNm: pdpDist, altitudeFtMsl: input.popupAltitudeFtMsl,
    note: `Apex · roll & pull ${input.diveAngleDeg}°`,
  });

  const diveVertFt = input.popupAltitudeFtMsl - releaseMsl;
  const diveHorizFt = diveVertFt / Math.tan((Math.max(1, input.diveAngleDeg) * Math.PI) / 180);
  const diveHorizNm = Math.max(0, diveHorizFt / FT_PER_NM);
  const rpDist = pdpDist + diveHorizNm;
  points.push({
    label: 'RP', distanceNm: rpDist, altitudeFtMsl: releaseMsl,
    note: `${input.releaseSpeedKts} kt · ${input.diveAngleDeg}° dive`,
  });

  // Target — approximated 0.5 NM past release on the chart (weapon ballistics
  // are out of scope; the marker is there so the chart shows the target
  // ground point relative to the release).
  const tgtDist = rpDist + 0.5;
  points.push({ label: 'TGT', distanceNm: tgtDist, altitudeFtMsl: tElev, note: 'Target' });

  const recDist = tgtDist + 1.5;
  points.push({ label: 'REC', distanceNm: recDist, altitudeFtMsl: recoveryMsl, note: 'Egress' });

  const avgSpeed = (input.ingressSpeedKts + input.releaseSpeedKts) / 2;
  const totalRunNm = tgtDist - INGRESS_DISPLAY_NM;
  const ttt = (totalRunNm / Math.max(1, avgSpeed)) * 3600;

  return {
    input, points,
    totals: {
      ingressDisplayNm: INGRESS_DISPLAY_NM,
      popupDistanceNm: popupHorizNm,
      diveDistanceNm: diveHorizNm,
      recoveryDistanceNm: 1.5,
      timeToTargetSec: ttt,
    },
  };
}

/** A sensible starter set for a fresh profile. Defaults track real-world
 *  brackets per attack type so a new profile lands in a usable place
 *  without the planner having to read NATOPS first.
 *
 *  When `aircraft` is provided, the per-airframe preset (see
 *  popupAttackPresets.ts) overrides the generic NATO-bracket defaults — so
 *  picking "A-10C" produces 350 KIAS / 12K MSL apex instead of 480 / 8K. */
export function defaultPopupAttack(
  name = 'Attack 1',
  attackType: AttackType = 'type1',
  aircraft?: string,
): PopupAttackInput {
  const base = {
    attackType,
    name,
    aircraft,
    targetElevationFt: 100,
    vipDistanceNm: 8,
    angleOffsetDeg: 25,
    releaseSpeedKts: 480,
    ingressSpeedKts: 480,
    recoveryAltitudeFtAgl: 500,
  } as const;
  // Build the generic per-type baseline first; the per-airframe preset (if
  // any) is layered on top below. Aircraft presets live in
  // popupAttackPresets.ts; we delay the import to runtime to keep this
  // file free of a circular dep (the presets module imports types from
  // here). Using a require-style guard so headless test envs without the
  // presets module still get the generic baseline.
  let baseline: PopupAttackInput;
  switch (attackType) {
    case 'type1':
      // High-angle popup: 40° climb to ~8000 MSL, 30° dive to ~2000 AGL release.
      baseline = { ...base, popupAltitudeFtMsl: 8000, popupAngleDeg: 40, diveAngleDeg: 30,
               releaseAltitudeFtAgl: 2000, ingressAltitudeFtAgl: 500 };
      break;
    case 'type2':
      // Medium-angle popup: 30° climb to ~5000 MSL, 20° dive to ~1500 AGL.
      baseline = { ...base, popupAltitudeFtMsl: 5000, popupAngleDeg: 30, diveAngleDeg: 20,
               releaseAltitudeFtAgl: 1500, ingressAltitudeFtAgl: 500 };
      break;
    case 'type3':
      // Low-angle popup: 20° climb to ~3000 MSL, 12° dive to ~1000 AGL.
      baseline = { ...base, popupAltitudeFtMsl: 3000, popupAngleDeg: 20, diveAngleDeg: 12,
               releaseAltitudeFtAgl: 1000, ingressAltitudeFtAgl: 500 };
      break;
    case 'laydown':
      // Level release with retarded weapons — ingress = release alt.
      baseline = { ...base, popupAltitudeFtMsl: 500, popupAngleDeg: 0, diveAngleDeg: 0,
               releaseAltitudeFtAgl: 500, ingressAltitudeFtAgl: 500 };
      break;
    case 'loft':
      // Toss: 4-G pull through ~25° climb, release climbing at ~6000 MSL.
      baseline = { ...base, popupAltitudeFtMsl: 6000, popupAngleDeg: 25, diveAngleDeg: 0,
               releaseAltitudeFtAgl: 5500, ingressAltitudeFtAgl: 500, vipDistanceNm: 6 };
      break;
    case 'dive':
      // Roll-in dive from 15K, 30° dive to ~3K AGL release.
      baseline = { ...base, popupAltitudeFtMsl: 15000, popupAngleDeg: 0, diveAngleDeg: 30,
               releaseAltitudeFtAgl: 3000, ingressAltitudeFtAgl: 15000, recoveryAltitudeFtAgl: 2000 };
      break;
  }
  // Caller surfaces the aircraft preset on top via `applyAircraftPreset` from
  // popupAttackPresets — we do NOT eagerly merge here to avoid a circular
  // import. The editor's "load airframe defaults" button + the add-profile
  // path do the merge. Returning the baseline with `aircraft` recorded.
  return baseline;
}
