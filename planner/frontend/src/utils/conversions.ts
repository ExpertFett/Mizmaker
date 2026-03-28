/** Unit conversions for altitude and speed */

export const metersToFeet = (m: number): number => m * 3.28084;
export const feetToMeters = (ft: number): number => ft / 3.28084;
export const msToKnots = (ms: number): number => ms * 1.94384;
export const knotsToMs = (kts: number): number => kts / 1.94384;
export const msToKmh = (ms: number): number => ms * 3.6;
export const kmhToMs = (kmh: number): number => kmh / 3.6;
export const metersToNm = (m: number): number => m / 1852;
export const nmToMeters = (nm: number): number => nm * 1852;

export function formatLatLon(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  const latDeg = Math.abs(lat);
  const lonDeg = Math.abs(lon);
  const latD = Math.floor(latDeg);
  const latM = ((latDeg - latD) * 60).toFixed(3);
  const lonD = Math.floor(lonDeg);
  const lonM = ((lonDeg - lonD) * 60).toFixed(3);
  return `${latDir}${latD}°${latM}' ${lonDir}${lonD}°${lonM}'`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
