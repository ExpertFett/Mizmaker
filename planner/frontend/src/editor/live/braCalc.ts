/**
 * BRA / BRAA call math + formatting for the LotATC-style controller scope.
 *
 * "BRA" = Bearing / Range / Altitude — the standard radar control call format.
 * Optional aspect angle ("BRAA") derives the target's aspect off the bearing
 * line from the anchor (hot / flank / beam / cold), used in the picture-call
 * summary. Bearings are reported as TRUE for now (magnetic-variation hook is
 * stubbed but unused until we wire a per-theatre magvar table).
 *
 * Distance uses the same haversine helper as the kneeboard route capture.
 */

/** A point on the surface with optional altitude in FEET MSL. */
export interface LL { lat: number; lng: number; altFt?: number; }

export interface BraCall {
  /** True bearing 0..359° (anchor → target). */
  bearingDeg: number;
  /** Slant-ish range in nautical miles (great-circle, ignores altitude). */
  rangeNm: number;
  /** Target altitude in thousands of feet (rounded), or null when unknown. */
  altThousands: number | null;
}

export interface BraaCall extends BraCall {
  /** Aspect angle (0..180°) — angle between (anchor→target) and the target's
   *  track. 0 = hot (head-on), 180 = cold (tail-on), 90 = beam. Null when
   *  the target has no track/heading data. */
  aspectDeg: number | null;
  /** Coarse aspect bucket for the call: HOT / FLANK / BEAM / COLD / null. */
  aspectLabel: AspectLabel | null;
}

export type AspectLabel = 'HOT' | 'FLANK' | 'BEAM' | 'COLD';

const NM_PER_M = 1 / 1852;
const R_EARTH_M = 6371000;
const FT_PER_M = 3.28084;

/** True bearing from a → b in degrees, 0..360 (north = 0, clockwise). */
export function trueBearingDeg(a: LL, b: LL): number {
  const f1 = (a.lat * Math.PI) / 180;
  const f2 = (b.lat * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Great-circle distance between two LLs in metres. */
export function distanceM(a: LL, b: LL): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Compute a BRA call from anchor → target. Altitude pulled from `target.altFt`
 *  if present; otherwise null. */
export function computeBra(anchor: LL, target: LL): BraCall {
  const bearing = trueBearingDeg(anchor, target);
  const range = distanceM(anchor, target) * NM_PER_M;
  const alt = target.altFt != null && Number.isFinite(target.altFt)
    ? Math.round(target.altFt / 1000)
    : null;
  return { bearingDeg: bearing, rangeNm: range, altThousands: alt };
}

/** Compute a BRAA (BRA + aspect). `targetTrackDeg` is the target's track or
 *  heading in degrees true; pass null/undefined to skip aspect. */
export function computeBraa(
  anchor: LL, target: LL, targetTrackDeg: number | null | undefined,
): BraaCall {
  const bra = computeBra(anchor, target);
  if (targetTrackDeg == null || !Number.isFinite(targetTrackDeg)) {
    return { ...bra, aspectDeg: null, aspectLabel: null };
  }
  // Aspect = angle between (target → anchor) and the target's track.
  // Bearing anchor→target reversed gives target→anchor; aspect is the
  // smallest angular difference vs. the track.
  const reverseBearing = (bra.bearingDeg + 180) % 360;
  let diff = Math.abs(reverseBearing - targetTrackDeg);
  if (diff > 180) diff = 360 - diff;
  const aspectLabel: AspectLabel =
    diff < 30 ? 'HOT'
    : diff < 60 ? 'FLANK'
    : diff < 120 ? 'BEAM'
    : 'COLD';
  return { ...bra, aspectDeg: diff, aspectLabel };
}

/** Format a BRA call as a controller-style string:
 *  `BRA 075° / 12 NM / 18K` or `BRA 075 / 12 / 18`. */
export function formatBra(bra: BraCall, opts: { decorate?: boolean } = {}): string {
  const { decorate = true } = opts;
  const brg = String(Math.round(bra.bearingDeg) % 360).padStart(3, '0');
  const rng = bra.rangeNm >= 10 ? bra.rangeNm.toFixed(0) : bra.rangeNm.toFixed(1);
  const alt = bra.altThousands == null
    ? '—'
    : `${bra.altThousands}${decorate ? 'K' : ''}`;
  return decorate
    ? `BRA ${brg}° / ${rng} NM / ${alt}`
    : `${brg}/${rng}/${alt}`;
}

/** Format a BRAA call including aspect. Drops aspect cleanly when unknown. */
export function formatBraa(bra: BraaCall): string {
  const base = formatBra(bra);
  return bra.aspectLabel ? `${base} ${bra.aspectLabel}` : base;
}

/** Convert metres → feet (utility used when reading position.alt from
 *  Olympus telemetry, which arrives in metres). */
export function metresToFeet(m: number | undefined | null): number | undefined {
  if (m == null || !Number.isFinite(m)) return undefined;
  return m * FT_PER_M;
}
