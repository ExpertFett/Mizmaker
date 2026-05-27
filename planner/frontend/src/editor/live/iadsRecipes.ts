/**
 * IADS site recipes + geo helpers for the Live "Draw tool" IADS generator.
 *
 * Each recipe is one air-defence SITE = a group of component DCS unit types
 * (radar + launchers for an area SAM; a single self-contained vehicle for
 * SHORAD/EWR). The generator spawns every component of a site in ONE Olympus
 * `spawnGroundUnits` call so DCS links them into a functional group, which the
 * Dynamic AEGIS engine (aegis-iads-v0.9.0-beta-dynamic.lua) then auto-adopts.
 *
 * Component `type` strings are standard DCS Mission-Editor type names. The
 * IADS panel resolves them against the LIVE Olympus ground database at runtime
 * and only offers recipes whose components all exist on that server (so mods /
 * version differences degrade gracefully instead of silently failing). If a
 * type name is wrong, Olympus simply spawns nothing — edit the string here.
 *
 * dx/dy are metres EAST / NORTH from the site centre.
 */

export type IadsKind = 'ewr' | 'area' | 'shorad';

export interface IadsComponent {
  type: string;   // DCS unit type (Olympus ground-DB key)
  dx: number;     // metres east of site centre
  dy: number;     // metres north of site centre
}

export interface IadsRecipe {
  code: string;        // stable id
  label: string;       // UI label
  aegis: string;       // AEGIS system code this maps to (FYI / classification)
  kind: IadsKind;
  threat: number;      // rough engagement reach (NM) — for sorting / tier hints
  components: IadsComponent[];
}

/** Build N launcher offsets evenly spaced on a ring of the given radius (m). */
function ring(type: string, n: number, radiusM: number, startDeg = 0): IadsComponent[] {
  const out: IadsComponent[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    out.push({ type, dx: Math.round(Math.sin(a) * radiusM), dy: Math.round(Math.cos(a) * radiusM) });
  }
  return out;
}

/**
 * Curated recipes, ordered by kind then reach. Component type strings are
 * best-known DCS names; the panel hides any recipe the server's DB lacks.
 */
export const IADS_RECIPES: IadsRecipe[] = [
  // ── Early-warning radars (single unit) ──────────────────────────────────
  { code: 'ewr_1l13', label: 'EWR — 1L13 (Box Spring)', aegis: 'EWR', kind: 'ewr', threat: 0,
    components: [{ type: '1L13 EWR', dx: 0, dy: 0 }] },
  { code: 'ewr_55g6', label: 'EWR — 55G6 (Tall Rack)', aegis: 'EWR', kind: 'ewr', threat: 0,
    components: [{ type: '55G6 EWR', dx: 0, dy: 0 }] },

  // ── Area SAMs (radar(s) + launchers, one group) ─────────────────────────
  { code: 'sa2', label: 'SA-2 Guideline', aegis: 'SA2', kind: 'area', threat: 24,
    components: [{ type: 'SNR_75V', dx: 0, dy: 0 }, ...ring('S_75M_Volhov', 6, 90)] },
  { code: 'sa3', label: 'SA-3 Goa', aegis: 'SA3', kind: 'area', threat: 14,
    components: [{ type: 'snr s-125 tr', dx: 0, dy: 0 }, { type: 'p-19 s-125 sr', dx: -45, dy: 30 },
      ...ring('5p73 s-125 ln', 4, 70)] },
  { code: 'sa6', label: 'SA-6 Gainful', aegis: 'SA6', kind: 'area', threat: 18,
    components: [{ type: 'Kub 1S91 str', dx: 0, dy: 0 }, ...ring('Kub 2P25 ln', 4, 75)] },
  { code: 'sa11', label: 'SA-11 Gadfly', aegis: 'SA11', kind: 'area', threat: 30,
    components: [{ type: 'SA-11 Buk SR 9S18M1', dx: 0, dy: 0 }, { type: 'SA-11 Buk CC 9S470M1', dx: -50, dy: 40 },
      ...ring('SA-11 Buk LN 9A310M1', 4, 90)] },
  { code: 'hawk', label: 'MIM-23 Hawk', aegis: 'HAWK', kind: 'area', threat: 30,
    components: [{ type: 'Hawk tr', dx: 0, dy: 0 }, { type: 'Hawk sr', dx: -55, dy: 35 },
      { type: 'Hawk cwar', dx: 55, dy: 35 }, { type: 'Hawk pcp', dx: 0, dy: -45 }, ...ring('Hawk ln', 4, 90)] },
  { code: 'sa10', label: 'SA-10 Grumble (S-300)', aegis: 'SA10', kind: 'area', threat: 50,
    components: [{ type: 'S-300PS 40B6M tr', dx: 0, dy: 0 }, { type: 'S-300PS 40B6MD sr', dx: -60, dy: 45 },
      { type: 'S-300PS 64H6E sr', dx: 60, dy: 45 }, { type: 'S-300PS 54K6 cp', dx: 0, dy: -55 },
      ...ring('S-300PS 5P85C ln', 2, 110, 45), ...ring('S-300PS 5P85D ln', 2, 110, 225)] },
  { code: 'patriot', label: 'MIM-104 Patriot', aegis: 'PATRIOT', kind: 'area', threat: 90,
    components: [{ type: 'Patriot str', dx: 0, dy: 0 }, { type: 'Patriot cp', dx: -55, dy: 40 },
      { type: 'Patriot EPP', dx: 55, dy: 40 }, { type: 'Patriot AMG', dx: 0, dy: -50 }, ...ring('Patriot ln', 4, 95)] },

  // ── Self-contained SHORAD / PD (single vehicle = functional SAM) ─────────
  { code: 'sa15', label: 'SA-15 Tor', aegis: 'SA15', kind: 'shorad', threat: 7,
    components: [{ type: 'Tor 9A331', dx: 0, dy: 0 }] },
  { code: 'sa8', label: 'SA-8 Osa', aegis: 'SA8', kind: 'shorad', threat: 7,
    components: [{ type: 'Osa 9A33 ln', dx: 0, dy: 0 }] },
  { code: 'sa13', label: 'SA-13 Strela-10', aegis: 'SA13', kind: 'shorad', threat: 4,
    components: [{ type: 'Strela-10M3', dx: 0, dy: 0 }] },
  { code: 'sa19', label: 'SA-19 Tunguska (2S6)', aegis: 'SA19', kind: 'shorad', threat: 5,
    components: [{ type: '2S6 Tunguska', dx: 0, dy: 0 }] },
  { code: 'roland', label: 'Roland ADS', aegis: 'ROLAND', kind: 'shorad', threat: 5,
    components: [{ type: 'Roland ADS', dx: 0, dy: 0 }, { type: 'Roland Radar', dx: -30, dy: 20 }] },
  { code: 'gepard', label: 'Gepard (AAA, radar)', aegis: 'GEPARD', kind: 'shorad', threat: 3,
    components: [{ type: 'Gepard', dx: 0, dy: 0 }] },
  { code: 'shilka', label: 'ZSU-23-4 Shilka (AAA)', aegis: 'SHILKA', kind: 'shorad', threat: 2,
    components: [{ type: 'ZSU-23-4 Shilka', dx: 0, dy: 0 }] },
];

/* ── Geo helpers ─────────────────────────────────────────────────────────── */

const R_EARTH = 6371000; // m
export const NM_M = 1852;

/** Offset a lat/lng by dxEast / dyNorth metres (small-distance flat approx). */
export function offsetLatLng(lat: number, lng: number, dxEast: number, dyNorth: number) {
  const dLat = (dyNorth / R_EARTH) * (180 / Math.PI);
  const dLng = (dxEast / (R_EARTH * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

/** Great-circle destination from a point given bearing (deg) + distance (m). */
export function destPoint(lat: number, lng: number, bearingDeg: number, distM: number) {
  const d = distM / R_EARTH;
  const t = (bearingDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lng * Math.PI) / 180;
  const sinP2 = Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t);
  const p2 = Math.asin(sinP2);
  const y = Math.sin(t) * Math.sin(d) * Math.cos(p1);
  const x = Math.cos(d) - Math.sin(p1) * sinP2;
  const l2 = l1 + Math.atan2(y, x);
  return { lat: (p2 * 180) / Math.PI, lng: (((l2 * 180) / Math.PI + 540) % 360) - 180 };
}

/**
 * Distribute `n` site centres inside a circle (area-uniform), trying to keep
 * each at least `minSpacingNm` from the others. Deterministic-ish via Math.random;
 * spacing is best-effort (falls back to accepting if it can't place after tries).
 */
export function distributeSites(
  centerLat: number, centerLng: number, radiusNm: number, n: number, minSpacingNm = 0,
): { lat: number; lng: number }[] {
  const pts: { lat: number; lng: number }[] = [];
  const minSpM = minSpacingNm * NM_M;
  const radM = radiusNm * NM_M;
  for (let i = 0; i < n; i++) {
    let best: { lat: number; lng: number } | null = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const bearing = Math.random() * 360;
      const dist = Math.sqrt(Math.random()) * radM; // sqrt → uniform over area
      const p = destPoint(centerLat, centerLng, bearing, dist);
      if (minSpM <= 0 || pts.every((q) => haversineM(p.lat, p.lng, q.lat, q.lng) >= minSpM)) {
        best = p; break;
      }
      best = p; // remember last as fallback
    }
    if (best) pts.push(best);
  }
  return pts;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const p1 = (lat1 * Math.PI) / 180, p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
