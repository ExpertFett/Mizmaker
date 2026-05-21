/**
 * Shared kneeboard coordinate formatter.
 *
 * One place that turns a lat/lon into the format the user picked on the
 * Kneeboard tab (MGRS grid vs lat/lon DM). Before this, only the Route
 * (lineup) card honoured the toggle — every other card hardcoded MGRS
 * (or, in the DMPI card's case, lat/lon), so flipping the dropdown did
 * nothing on most cards. (v0.9.76)
 */

import { forward as toMGRS } from 'mgrs';

export type CoordFormat = 'mgrs' | 'latlon';

/** Format a coordinate pair as MGRS or lat/lon (degrees + decimal
 *  minutes). Returns an em-dash for missing values. `mgrsPrecision` is
 *  the MGRS digit count (4 = 10 m, 3 = 100 m) — callers keep their
 *  previous precision so existing cards look unchanged in MGRS mode. */
export function formatCoord(
  lat: number | undefined | null,
  lon: number | undefined | null,
  fmt: CoordFormat = 'mgrs',
  mgrsPrecision = 4,
): string {
  if (lat == null || lon == null) return '—';
  if (fmt === 'latlon') {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    const la = Math.abs(lat);
    const lo = Math.abs(lon);
    const latD = Math.floor(la);
    const latM = ((la - latD) * 60).toFixed(1);
    const lonD = Math.floor(lo);
    const lonM = ((lo - lonD) * 60).toFixed(1);
    return `${ns}${latD}°${latM}' ${ew}${lonD}°${lonM}'`;
  }
  try {
    return toMGRS([lon, lat], mgrsPrecision);
  } catch {
    return '—';
  }
}
