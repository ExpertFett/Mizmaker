/**
 * Contrail band estimate.
 *
 * A visible trail hands your position to anyone looking up, so the altitude
 * it starts at is tactical information — worth having on the weather card
 * next to the winds rather than guessed at in the air.
 *
 * Contrails need the ambient air cold enough for the exhaust plume to freeze
 * out. The practical threshold is around -40°C; by roughly -60°C there is too
 * little moisture aloft for a trail to persist. We find those two altitudes
 * from the mission's surface temperature using the ISA lapse rate, which is
 * how DCS itself derives temperature with altitude.
 *
 * This is an estimate: DCS's own contrail rendering is not documented in
 * terms a mission file exposes, and real onset shifts with humidity. It puts
 * the crew within a few thousand feet, which is what matters when deciding
 * whether to push a CAP up or hold it down.
 */

/** ISA temperature lapse, °C per 1000 ft. */
const LAPSE_C_PER_KFT = 1.98;

/** Ambient temperature at which a persistent trail starts to form. */
const ONSET_C = -40;

/** Colder than this and there is generally too little moisture to sustain
 *  one — the top of the band, not a hard ceiling. */
const TOP_C = -60;

/** Above the tropopause the ISA lapse stops, so extrapolating past it would
 *  invent temperatures that never occur. */
const TROPOPAUSE_FT = 36089;

export interface ContrailBand {
  /** Altitude in feet where trails begin. null = never gets cold enough. */
  onsetFt: number | null;
  /** Altitude in feet where they stop persisting, or null if that is above
   *  the tropopause (i.e. trails continue as high as the jet can go). */
  topFt: number | null;
}

/** Altitude at which the air reaches `targetC`, or null if it never does
 *  below the tropopause. */
function altitudeForTemp(surfaceTempC: number, targetC: number): number | null {
  const drop = surfaceTempC - targetC;
  if (drop <= 0) return 0;                       // already that cold on deck
  const ft = Math.round((drop / LAPSE_C_PER_KFT) * 1000);
  return ft > TROPOPAUSE_FT ? null : ft;
}

export function contrailBand(
  surfaceTempC: number,
  onsetC: number = ONSET_C,
  topC: number = TOP_C,
): ContrailBand {
  if (!Number.isFinite(surfaceTempC)) return { onsetFt: null, topFt: null };
  return {
    onsetFt: altitudeForTemp(surfaceTempC, onsetC),
    topFt: altitudeForTemp(surfaceTempC, topC),
  };
}

/** Flight-level form ("FL197") for the card. */
export function toFlightLevel(ft: number): string {
  return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
}

/** One-line summary for the weather card. */
export function contrailSummary(
  surfaceTempC: number,
  onsetC: number = ONSET_C,
  topC: number = TOP_C,
): string {
  const { onsetFt, topFt } = contrailBand(surfaceTempC, onsetC, topC);
  if (onsetFt == null) return `None — air stays warmer than ${onsetC}°C to the tropopause`;
  const from = onsetFt === 0 ? 'surface' : `${toFlightLevel(onsetFt)} (${onsetFt.toLocaleString()} ft)`;
  if (topFt == null) return `${from} and above`;
  return `${from} to ${toFlightLevel(topFt)} (${topFt.toLocaleString()} ft)`;
}
