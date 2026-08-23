/**
 * Field elevations for the airfield diagrams.
 *
 * One batch request for every field on the card set rather than one each —
 * the server groups points by source tile, so four fields usually cost a
 * single tile fetch.
 */

import type { Airbase } from '../types/mission';

const M_TO_FT = 3.28084;

export async function fetchFieldElevations(fields: Airbase[]): Promise<(number | null)[]> {
  const points = fields
    .filter((a) => a.lat != null && a.lon != null)
    .map((a) => [a.lat!, a.lon!]);
  if (points.length === 0) return fields.map(() => null);

  try {
    const res = await fetch('/api/elevation/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    });
    if (!res.ok) throw new Error(`elevation ${res.status}`);
    const { elevations } = await res.json();
    // A field below sea level is real (Death Valley), but a negative reading
    // at an airfield is far likelier to be bathymetry bleeding in from a
    // coastal sample, so floor it.
    return (elevations as (number | null)[]).map(
      (m) => (m == null ? null : Math.max(0, m) * M_TO_FT));
  } catch {
    // No elevation is a diagram without one, not a broken card.
    return fields.map(() => null);
  }
}
