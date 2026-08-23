/**
 * Terrain samples along a route, for the vertical profile card.
 *
 * Two jobs, kept apart so the geometry is testable without a network:
 * `sampleRoute` decides WHERE to look, `fetchRouteTerrain` goes and looks.
 *
 * MSA is sampled across a corridor rather than down the centreline. A minimum
 * safe altitude derived from the ground directly under the course says nothing
 * about the ridge half a mile off it, which is the thing that actually kills
 * people — so each sample also probes a set distance either side of track and
 * takes the worst.
 */

const NM_PER_DEG_LAT = 60;
const M_TO_FT = 3.28084;

/** Half-width of the corridor MSA is computed over. */
export const MSA_CORRIDOR_NM = 5;

/** Clearance added to the highest terrain in the corridor. */
export const MSA_BUFFER_FT = 1000;

export interface RouteSample {
  /** Cumulative distance from the first waypoint, NM. */
  distNm: number;
  lat: number;
  lon: number;
  /** Planned altitude here, ft MSL, interpolated between waypoints. */
  plannedAltFt: number;
  /** Index of the leg this sample falls on (0 = first→second waypoint). */
  leg: number;
  /** Terrain height, ft MSL. Filled in by fetchRouteTerrain; null where no
   *  data was available. */
  terrainFt?: number | null;
  /** Highest terrain within MSA_CORRIDOR_NM either side, ft MSL. */
  corridorFt?: number | null;
}

interface WpLike {
  lat?: number | null;
  lon?: number | null;
  altitude_m: number;
}

function nmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * NM_PER_DEG_LAT;
  const dLon = (aLon - bLon) * NM_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Evenly spaced samples along the route.
 *
 * `maxSamples` bounds the request: a 400 NM route at 1 NM spacing would be
 * 400 points before the corridor triples it, so the spacing stretches on long
 * routes rather than the point count growing without limit.
 */
export function sampleRoute(waypoints: WpLike[], maxSamples = 160): RouteSample[] {
  const wps = waypoints.filter((w) => w.lat != null && w.lon != null);
  if (wps.length < 2) return [];

  const legLens: number[] = [];
  let total = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const d = nmBetween(wps[i].lat!, wps[i].lon!, wps[i + 1].lat!, wps[i + 1].lon!);
    legLens.push(d);
    total += d;
  }
  if (total <= 0) return [];

  const n = Math.max(2, Math.min(maxSamples, Math.ceil(total)));
  const out: RouteSample[] = [];
  for (let s = 0; s < n; s++) {
    const target = (s / (n - 1)) * total;
    // Walk legs to find where this distance lands.
    let acc = 0;
    let leg = 0;
    while (leg < legLens.length - 1 && acc + legLens[leg] < target) {
      acc += legLens[leg];
      leg++;
    }
    const f = legLens[leg] > 0 ? (target - acc) / legLens[leg] : 0;
    const a = wps[leg], b = wps[leg + 1];
    out.push({
      distNm: target,
      lat: a.lat! + (b.lat! - a.lat!) * f,
      lon: a.lon! + (b.lon! - a.lon!) * f,
      plannedAltFt: (a.altitude_m + (b.altitude_m - a.altitude_m) * f) * M_TO_FT,
      leg,
    });
  }
  return out;
}

/** Points either side of track at `sample`, used for the corridor MSA. */
export function corridorPoints(
  samples: RouteSample[],
  i: number,
  halfWidthNm = MSA_CORRIDOR_NM,
): [number, number][] {
  const s = samples[i];
  // Track direction from the neighbouring samples; the perpendicular is what
  // we offset along.
  const prev = samples[Math.max(0, i - 1)];
  const next = samples[Math.min(samples.length - 1, i + 1)];
  const dLat = next.lat - prev.lat;
  const dLon = (next.lon - prev.lon) * Math.cos((s.lat * Math.PI) / 180);
  const len = Math.hypot(dLat, dLon) || 1;
  // Perpendicular unit vector, converted back to degrees.
  const pLat = -dLon / len;
  const pLon = dLat / len / Math.cos((s.lat * Math.PI) / 180);
  const dDeg = halfWidthNm / NM_PER_DEG_LAT;
  return [
    [s.lat + pLat * dDeg, s.lon + pLon * dDeg],
    [s.lat - pLat * dDeg, s.lon - pLon * dDeg],
  ];
}

/** Round up to the next 100 ft, the way an MSA is published. */
export function roundMsa(ft: number): number {
  return Math.ceil(ft / 100) * 100;
}

/** Highest corridor terrain per leg, plus the buffer. */
export function msaPerLeg(samples: RouteSample[]): Map<number, number> {
  const worst = new Map<number, number>();
  for (const s of samples) {
    const h = s.corridorFt ?? s.terrainFt;
    if (h == null) continue;
    const cur = worst.get(s.leg);
    if (cur == null || h > cur) worst.set(s.leg, h);
  }
  const out = new Map<number, number>();
  for (const [leg, h] of worst) out.set(leg, roundMsa(Math.max(0, h) + MSA_BUFFER_FT));
  return out;
}

/**
 * Fill in terrain for a set of samples.
 *
 * One request for the centreline and both corridor offsets together — the
 * server groups them by source tile, so asking for three times the points
 * costs very little more than asking for one.
 */
export async function fetchRouteTerrain(samples: RouteSample[]): Promise<RouteSample[]> {
  if (samples.length === 0) return samples;

  const points: [number, number][] = [];
  for (const s of samples) points.push([s.lat, s.lon]);
  for (let i = 0; i < samples.length; i++) points.push(...corridorPoints(samples, i));

  let elev: (number | null)[];
  try {
    const res = await fetch('/api/elevation/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    });
    if (!res.ok) throw new Error(`elevation ${res.status}`);
    elev = (await res.json()).elevations;
  } catch {
    // No terrain is a degraded profile, not a broken card — the planned
    // altitude line still draws.
    return samples.map((s) => ({ ...s, terrainFt: null, corridorFt: null }));
  }

  const n = samples.length;
  return samples.map((s, i) => {
    const centre = elev[i];
    const left = elev[n + i * 2];
    const right = elev[n + i * 2 + 1];
    // Terrarium carries bathymetry, so open water reads as seabed depth.
    // Clamp at sea level: a profile is about what you can hit.
    const toFt = (m: number | null | undefined) =>
      m == null ? null : Math.max(0, m) * M_TO_FT;
    const c = toFt(centre);
    const worst = [c, toFt(left), toFt(right)]
      .filter((v): v is number => v != null);
    return {
      ...s,
      terrainFt: c,
      corridorFt: worst.length ? Math.max(...worst) : null,
    };
  });
}
