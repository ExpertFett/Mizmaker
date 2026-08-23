/**
 * Collapse raw threat units into SITES.
 *
 * The mission file lists a threat per unit, which is not how a briefer counts
 * them. One S-300 battery shows up as three separate entries — "40B6M tr",
 * "40B6MD sr", "64H6E sr" are the track and search radars of the SAME site —
 * and a defended airfield contributes a dozen individual Shilkas. Kola M4
 * produced 44 rows from 7 distinct systems, which paginated into three
 * threat cards whose 2nd and 3rd added nothing the 1st had not already said.
 *
 * Grouping by system and position gives one row per emplacement, with a count
 * when several launchers share it.
 */

/** Two units of the same system this close are one emplacement. Generous
 *  enough to catch a battery's dispersed radars, tight enough to keep two
 *  separate batteries defending the same airfield apart. */
const SITE_RADIUS_NM = 3;

const NM_PER_DEG_LAT = 60;

export interface ThreatLike {
  type: string;
  lat?: number | null;
  lon?: number | null;
  range: number;
  name?: string;
}

export interface ThreatSite<T extends ThreatLike> {
  /** The unit that names the site — the longest-ranged of the group. */
  lead: T;
  /** Every unit assigned here, lead included. */
  members: T[];
  /** Launchers/vehicles at this site. */
  count: number;
}

/** Rough nm between two lat/lon, good enough for clustering. */
function roughNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * NM_PER_DEG_LAT;
  const dLon = (aLon - bLon) * NM_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Group threats into sites.
 *
 * `familyOf` decides what counts as "the same system" — pass the NATO
 * designation so an S-300's search and track radars land together rather
 * than reading as two separate threats. Falls back to the raw type.
 *
 * Input order is preserved in the sense that the longest-ranged unit of each
 * cluster becomes its lead; sites come back sorted by that lead's range,
 * which is the order a threat card wants to print them in.
 */
export function clusterThreatSites<T extends ThreatLike>(
  threats: T[],
  familyOf: (t: T) => string,
  rangeOf: (t: T) => number,
  radiusNm: number = SITE_RADIUS_NM,
): ThreatSite<T>[] {
  // Longest-ranged first, so each cluster's first member is its lead and the
  // site inherits the designation that actually matters to the aircrew.
  const ordered = [...threats].sort((a, b) => rangeOf(b) - rangeOf(a));

  const sites: ThreatSite<T>[] = [];
  for (const t of ordered) {
    if (t.lat == null || t.lon == null) continue;
    const family = familyOf(t);
    const home = sites.find((s) =>
      familyOf(s.lead) === family &&
      s.lead.lat != null && s.lead.lon != null &&
      roughNm(s.lead.lat, s.lead.lon, t.lat!, t.lon!) <= radiusNm);
    if (home) {
      home.members.push(t);
      home.count++;
    } else {
      sites.push({ lead: t, members: [t], count: 1 });
    }
  }
  return sites;
}
