/**
 * Carrier hull defaults — TACAN, ICLS, callsign per real-world hull
 * number. ICLS values follow common DCS squadron conventions (CSG-3 /
 * Hornet School SOP-style); the previous sequential 1, 2, 3… auto-
 * assignment ignored real-world conventions and shipped briefs with
 * unrealistic numbers.
 *
 * Two consumers right now:
 *  - editor/tabs/CarrierSetupPanel — full carrier config
 *  - editor/tabs/TacanTab — TACAN/ICLS auto-assign
 *
 * Both use detectCarrierIcls() so the same hull lookup + collision
 * avoidance applies in both places.
 */

interface IclsHullEntry {
  /** Canonical ICLS channel for this hull (squadron SOP convention).
   *  0 = no ICLS (LHA, LHD, etc.). */
  icls: number;
}

const ICLS_HULL_DB: Record<string, IclsHullEntry> = {
  'cvn-69':       { icls: 11 },  // Eisenhower
  'cvn-70':       { icls: 9 },   // Vinson
  'cvn-71':       { icls: 9 },   // Roosevelt
  'cvn-72':       { icls: 7 },   // Lincoln
  'cvn-73':       { icls: 5 },   // Washington
  'cvn-74':       { icls: 7 },   // Stennis
  'cvn-75':       { icls: 11 },  // Truman
  'cvn-76':       { icls: 13 },  // Reagan
  'cvn-77':       { icls: 13 },  // GHWB
  'cvn-78':       { icls: 15 },  // Ford
  'cvn-79':       { icls: 17 },  // Kennedy
  stennis:        { icls: 7 },
  vinson:         { icls: 9 },
  lincoln:        { icls: 7 },
  washington:     { icls: 5 },
  roosevelt:      { icls: 9 },
  truman:         { icls: 11 },
  eisenhower:     { icls: 11 },
  forrestal:      { icls: 1 },
};

/**
 * Look up the canonical ICLS for a carrier by its DCS unit type +
 * group name. Returns undefined when the hull isn't recognised — caller
 * should fall back to whatever default makes sense.
 */
export function detectCarrierIcls(unitType: string, groupName: string): number | undefined {
  const combined = (unitType + ' ' + groupName).toLowerCase();
  // Normalize "CVN 73" / "CVN_73" / "CVN-73" all to "cvn-73"
  const normalized = combined.replace(/[\s_]/g, '-');
  for (const [key, data] of Object.entries(ICLS_HULL_DB)) {
    if (normalized.includes(key)) return data.icls;
  }
  return undefined;
}

/**
 * Allocator that returns ICLS channels avoiding ones already assigned
 * to other carriers in the same mission. Walks odd channels first
 * (1, 3, 5, …) which are the canonical carrier-ops channels per SOP,
 * then evens. Pass the canonical ICLS from `detectCarrierIcls` as
 * `preferred`; falls back to first-free if the preferred one is taken.
 *
 * Usage:
 *   const used = new Set<number>();
 *   const ch = allocateIcls(detectCarrierIcls(type, name), used);
 *   used.add(ch);
 */
export function allocateIcls(preferred: number | undefined, used: Set<number>): number {
  const oddFirst = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
  const candidates = preferred && preferred > 0
    ? [preferred, ...oddFirst.filter((c) => c !== preferred)]
    : oddFirst;
  for (const c of candidates) {
    if (!used.has(c)) return c;
  }
  return preferred || 1;
}
