/**
 * Elevation lookup via backend SRTM data.
 * Throttled to avoid flooding the backend on fast mouse moves.
 */

const cache = new Map<string, number>();
let lastRequest = 0;
let pending: ReturnType<typeof setTimeout> | null = null;
let latestLat = 0;
let latestLon = 0;
let latestCallback: ((elev: number | null) => void) | null = null;

const THROTTLE_MS = 250;

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function doFetch() {
  const lat = latestLat;
  const lon = latestLon;
  const cb = latestCallback;
  if (!cb) return;

  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached !== undefined) {
    cb(cached);
    return;
  }

  lastRequest = Date.now();
  fetch(`/api/elevation/${lat.toFixed(4)}/${lon.toFixed(4)}`)
    .then((res) => res.json())
    .then((data) => {
      const elev = data.elevation ?? null;
      if (elev !== null) cache.set(key, elev);
      // Only call back if this is still the latest request
      if (latestLat === lat && latestLon === lon) cb(elev);
    })
    .catch(() => {});
}

export function getElevation(lat: number, lon: number, callback: (elev: number | null) => void): void {
  // Cache hit — instant, no throttle needed
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached !== undefined) {
    callback(cached);
    return;
  }

  latestLat = lat;
  latestLon = lon;
  latestCallback = callback;

  // Throttle: only fire one request per THROTTLE_MS
  const now = Date.now();
  if (now - lastRequest >= THROTTLE_MS) {
    doFetch();
  } else {
    if (pending) clearTimeout(pending);
    pending = setTimeout(doFetch, THROTTLE_MS - (now - lastRequest));
  }
}
