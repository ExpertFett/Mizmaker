/**
 * Atmosphere math for speed conversions and wind calculations.
 *
 * Converts between GS (ground speed), TAS (true airspeed),
 * CAS (calibrated airspeed), and Mach based on altitude, temp, wind.
 *
 * DCS wind dir = direction wind blows TO (opposite of meteorological FROM).
 */

const ISA_TEMP_SL = 288.15;    // K (15°C)
const ISA_LAPSE = 0.0065;      // K/m
const GAMMA = 1.4;
const R_AIR = 287.058;         // J/(kg·K)
const G = 9.80665;

export interface WindLayer {
  speed: number;  // m/s
  dir: number;    // degrees (DCS convention: direction wind blows TO)
}

export interface Weather {
  wind: {
    atGround: WindLayer;
    at2000: WindLayer;
    at8000: WindLayer;
  };
  temperature_c: number;
  qnh_mmhg: number;
  qnh_inhg: number;
  qnh_hpa: number;
  clouds_base_m: number;
  clouds_preset: string;
  visibility_m: number;
}

function isaTemperature(alt_m: number, groundTempC: number = 15): number {
  const offset = groundTempC - 15;
  if (alt_m <= 11000) return (ISA_TEMP_SL + offset) - ISA_LAPSE * alt_m;
  return (ISA_TEMP_SL + offset) - ISA_LAPSE * 11000;
}

function isaPressure(alt_m: number, qnh_pa: number = 101325): number {
  if (alt_m <= 11000) {
    return qnh_pa * Math.pow((ISA_TEMP_SL - ISA_LAPSE * alt_m) / ISA_TEMP_SL, G / (ISA_LAPSE * R_AIR));
  }
  const p11 = qnh_pa * Math.pow((ISA_TEMP_SL - ISA_LAPSE * 11000) / ISA_TEMP_SL, G / (ISA_LAPSE * R_AIR));
  const t11 = ISA_TEMP_SL - ISA_LAPSE * 11000;
  return p11 * Math.exp(-G * (alt_m - 11000) / (R_AIR * t11));
}

function isaDensity(alt_m: number, groundTempC: number, qnh_pa: number): number {
  return isaPressure(alt_m, qnh_pa) / (R_AIR * isaTemperature(alt_m, groundTempC));
}

export function speedOfSound(alt_m: number, groundTempC: number = 15): number {
  return Math.sqrt(GAMMA * R_AIR * isaTemperature(alt_m, groundTempC));
}

function interpolateWind(alt_m: number, wind: Weather['wind']): { speed: number; fromDeg: number } {
  // Convert DCS "TO" direction to meteorological "FROM"
  const g = { speed: wind.atGround.speed, from: (wind.atGround.dir + 180) % 360 };
  const m = { speed: wind.at2000.speed, from: (wind.at2000.dir + 180) % 360 };
  const h = { speed: wind.at8000.speed, from: (wind.at8000.dir + 180) % 360 };

  if (alt_m <= 0) return { speed: g.speed, fromDeg: g.from };
  if (alt_m <= 2000) {
    const t = alt_m / 2000;
    return { speed: lerp(g.speed, m.speed, t), fromDeg: lerpAngle(g.from, m.from, t) };
  }
  if (alt_m <= 8000) {
    const t = (alt_m - 2000) / 6000;
    return { speed: lerp(m.speed, h.speed, t), fromDeg: lerpAngle(m.from, h.from, t) };
  }
  return { speed: h.speed, fromDeg: h.from };
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a) + 180) % 360 - 180;
  return (a + diff * t + 360) % 360;
}

/** Estimate TAS from ground speed using wind at altitude */
export function gsToTas(gs_ms: number, heading_deg: number, alt_m: number, wind: Weather['wind']): number {
  const { speed, fromDeg } = interpolateWind(alt_m, wind);
  const headwind = speed * Math.cos((fromDeg - heading_deg) * Math.PI / 180);
  return gs_ms + headwind;
}

/** TAS to CAS */
export function tasToCas(tas_ms: number, alt_m: number, groundTempC: number, qnh_pa: number): number {
  const rho = isaDensity(alt_m, groundTempC, qnh_pa);
  const rho0 = qnh_pa / (R_AIR * ISA_TEMP_SL);
  return tas_ms * Math.sqrt(rho / rho0);
}

/** TAS to Mach */
export function tasToMach(tas_ms: number, alt_m: number, groundTempC: number): number {
  const a = speedOfSound(alt_m, groundTempC);
  return a > 0 ? tas_ms / a : 0;
}

/** Mach to TAS */
export function machToTas(mach: number, alt_m: number, groundTempC: number): number {
  return mach * speedOfSound(alt_m, groundTempC);
}

/** CAS to TAS */
export function casToTas(cas_ms: number, alt_m: number, groundTempC: number, qnh_pa: number): number {
  const rho = isaDensity(alt_m, groundTempC, qnh_pa);
  const rho0 = qnh_pa / (R_AIR * ISA_TEMP_SL);
  return cas_ms / Math.sqrt(rho / rho0);
}

/** Estimate ground speed from TAS using wind at altitude */
export function tasToGs(tas_ms: number, heading_deg: number, alt_m: number, wind: Weather['wind']): number {
  const { speed, fromDeg } = interpolateWind(alt_m, wind);
  const headwind = speed * Math.cos((fromDeg - heading_deg) * Math.PI / 180);
  return tas_ms - headwind;
}

export type SpeedMode = 'gs' | 'cas' | 'tas' | 'mach';

/**
 * Convert a pilot-entered speed in any reference to DCS ground speed (m/s).
 * This is the reverse of convertSpeed — used when the pilot edits speed.
 *
 * For GS: input is knots, convert to m/s
 * For CAS: input is knots, convert CAS→TAS→GS
 * For TAS: input is knots, convert TAS→GS
 * For Mach: input is Mach number, convert Mach→TAS→GS
 */
export function speedRefToGs(
  inputValue: number,
  mode: SpeedMode,
  alt_m: number,
  heading_deg: number,
  wx: Weather,
): number {
  const qnh_pa = wx.qnh_mmhg * 133.322;

  switch (mode) {
    case 'gs':
      return inputValue / 1.94384; // knots to m/s
    case 'cas': {
      const cas_ms = inputValue / 1.94384;
      const tas_ms = casToTas(cas_ms, alt_m, wx.temperature_c, qnh_pa);
      return tasToGs(tas_ms, heading_deg, alt_m, wx.wind);
    }
    case 'tas': {
      const tas_ms = inputValue / 1.94384;
      return tasToGs(tas_ms, heading_deg, alt_m, wx.wind);
    }
    case 'mach': {
      const tas_ms = machToTas(inputValue, alt_m, wx.temperature_c);
      return tasToGs(tas_ms, heading_deg, alt_m, wx.wind);
    }
  }
}

/**
 * Convert a stored ground speed (m/s) to the requested display mode.
 * Returns the speed in knots (or Mach number for 'mach' mode).
 */
export function convertSpeed(
  gs_ms: number,
  alt_m: number,
  heading_deg: number,
  wx: Weather,
  mode: SpeedMode,
): number {
  const qnh_pa = wx.qnh_mmhg * 133.322;
  const tas = gsToTas(gs_ms, heading_deg, alt_m, wx.wind);

  switch (mode) {
    case 'gs': return gs_ms * 1.94384;
    case 'tas': return tas * 1.94384;
    case 'cas': return tasToCas(tas, alt_m, wx.temperature_c, qnh_pa) * 1.94384;
    case 'mach': return tasToMach(tas, alt_m, wx.temperature_c);
  }
}

/**
 * Compute ETE (estimated time enroute) for a leg in seconds.
 * Uses ground speed (accounts for wind).
 */
export function computeEte(distance_m: number, gs_ms: number): number {
  return gs_ms > 0 ? distance_m / gs_ms : 0;
}

/** Format wind for display: "280°/8kts" */
export function formatWind(layer: WindLayer): string {
  const fromDir = (layer.dir + 180) % 360;
  const kts = Math.round(layer.speed * 1.94384);
  return `${Math.round(fromDir).toString().padStart(3, '0')}°/${kts}kts`;
}
