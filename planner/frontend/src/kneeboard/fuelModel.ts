/**
 * Fuel consumption model for DCS aircraft.
 *
 * Uses engine performance data extracted from DCS game files (CoreMods)
 * combined with standard aerodynamic equations to estimate fuel flow
 * at any altitude/speed/weight combination.
 *
 * F/A-18C data source: CoreMods/aircraft/FA-18C/FA-18C.lua
 *   cemax = 1.24 kg/(kgf·h) — SFC at mil power
 *   cefor = 2.56 kg/(kgf·h) — SFC at full AB
 *   Engine thrust table: {Mach, mil_N, AB_N} at sea level
 *   dpdh_m = 3500, dpdh_f = 6500 — altitude thrust lapse
 *
 * Real F404-GE-402 specs (Wikipedia):
 *   Mil thrust: 11,000 lbf per engine (22,000 total)
 *   TSFC mil: 0.81 lb/(lbf·h)
 *   TSFC AB: 1.74 lb/(lbf·h)
 */

// ── Standard atmosphere ──────────────────────────────────────────────────

/** Air density (kg/m³) at pressure altitude in feet, ISA */
function airDensity(altFt: number): number {
  const altM = altFt * 0.3048;
  if (altM <= 11000) {
    // Troposphere
    const T = 288.15 - 0.0065 * altM;
    const p = 101325 * Math.pow(T / 288.15, 5.2561);
    return p / (287.05 * T);
  } else {
    // Stratosphere (up to ~20km)
    const T = 216.65;
    const p = 22632 * Math.exp(-0.0001577 * (altM - 11000));
    return p / (287.05 * T);
  }
}

// ── Aircraft performance database ────────────────────────────────────────

interface AircraftPerf {
  /** Wing area m² */
  S: number;
  /** Zero-lift drag coefficient (clean, subsonic) */
  Cd0: number;
  /** Induced drag factor: Cd = Cd0 + K * CL² */
  K: number;
  /** Specific fuel consumption at cruise partial throttle, lb/(lbf·h).
   *  This is higher than mil SFC because partial throttle is less efficient. */
  sfcCruise: number;
  /** Empty weight lbs */
  emptyLbs: number;
  /** Max internal fuel lbs */
  maxFuelLbs: number;
  /** Number of engines */
  nEngines: number;
}

/**
 * Aircraft performance data.
 * Cd0 and K are approximated from known L/D ratios and flight test data.
 * SFC values are tuned to match known cruise fuel flows.
 *
 * F/A-18C: Known cruise ~4000-6000 PPH at M0.75-0.85, 25-35k ft, ~40k lbs GW
 *   At those conditions drag ≈ 4000-5000 lbf, so SFC ≈ 1.0-1.2 gives right range.
 *   DCS cemax = 1.24 kg/(kgf·h) ≈ 1.24 lb/(lbf·h) (same units).
 *   Real mil SFC = 0.81, but cruise throttle is less efficient → ~0.95-1.1.
 */
const AIRCRAFT_DB: Record<string, AircraftPerf> = {
  'FA-18C_hornet': {
    S: 37.16,       // 400 ft² wing area
    Cd0: 0.022,     // clean subsonic
    K: 0.12,        // moderate aspect ratio (AR ~3.5)
    sfcCruise: 1.05, // tuned: between real 0.81 (mil) and DCS 1.24 (mil)
    emptyLbs: 25640, // ~11631 kg
    maxFuelLbs: 10800, // ~4900 kg internal
    nEngines: 2,
  },
  'F-14A-135-GR': {
    S: 54.5,
    Cd0: 0.021,
    K: 0.085,       // variable sweep, good L/D
    sfcCruise: 1.05,
    emptyLbs: 43735,
    maxFuelLbs: 16200,
    nEngines: 2,
  },
  'F-14B': {
    S: 54.5,
    Cd0: 0.021,
    K: 0.085,
    sfcCruise: 0.95, // F110 engines more efficient than TF30
    emptyLbs: 43735,
    maxFuelLbs: 16200,
    nEngines: 2,
  },
  'F-16C_50': {
    S: 27.87,        // 300 ft²
    Cd0: 0.019,
    K: 0.12,
    sfcCruise: 0.95,
    emptyLbs: 19700,
    maxFuelLbs: 7000,
    nEngines: 1,
  },
  'F-15ESE': {
    S: 56.5,
    Cd0: 0.024,
    K: 0.10,
    sfcCruise: 1.0,
    emptyLbs: 36450,
    maxFuelLbs: 13100,
    nEngines: 2,
  },
  'F-15C': {
    S: 56.5,
    Cd0: 0.021,
    K: 0.10,
    sfcCruise: 1.0,
    emptyLbs: 28600,
    maxFuelLbs: 13455,
    nEngines: 2,
  },
  'A-10C': {
    S: 47.01,
    Cd0: 0.032,      // straight wing, lots of stuff hanging off
    K: 0.065,         // high aspect ratio
    sfcCruise: 0.70,  // TF34 turbofan, very efficient
    emptyLbs: 24959,
    maxFuelLbs: 11000,
    nEngines: 2,
  },
  'A-10C_2': {
    S: 47.01,
    Cd0: 0.032,
    K: 0.065,
    sfcCruise: 0.70,
    emptyLbs: 24959,
    maxFuelLbs: 11000,
    nEngines: 2,
  },
  'AV8BNA': {
    S: 21.37,
    Cd0: 0.025,
    K: 0.14,
    sfcCruise: 1.05,  // Pegasus engine
    emptyLbs: 14867,
    maxFuelLbs: 7760,
    nEngines: 1,
  },
};

const DEFAULT_PERF: AircraftPerf = {
  S: 37.16,
  Cd0: 0.024,
  K: 0.12,
  sfcCruise: 1.05,
  emptyLbs: 25000,
  maxFuelLbs: 10000,
  nEngines: 2,
};

// ── Fuel flow calculation ────────────────────────────────────────────────

/**
 * Estimate fuel flow (lbs/hr total, both engines) for level cruise flight.
 *
 * @param altFt - Pressure altitude in feet
 * @param speedMs - True airspeed in m/s (DCS speed_ms is ground speed,
 *                  but close enough for planning without wind correction)
 * @param weightLbs - Current gross weight in lbs
 * @param aircraftType - DCS unit type string
 * @returns Fuel flow in lbs/hr (total for all engines)
 */
export function estimateFuelFlow(
  altFt: number,
  speedMs: number,
  weightLbs: number,
  aircraftType: string,
): number {
  const perf = AIRCRAFT_DB[aircraftType] || DEFAULT_PERF;
  const rho = airDensity(altFt);
  const V = Math.max(speedMs, 50); // floor to avoid div/0
  const W = weightLbs * 4.44822;   // weight in Newtons

  // Lift coefficient for level flight: L = W
  const qS = 0.5 * rho * V * V * perf.S;
  const CL = W / qS;

  // Drag coefficient
  const CD = perf.Cd0 + perf.K * CL * CL;

  // Drag force in Newtons
  const drag_N = CD * qS;

  // Convert drag to lbf for SFC calculation
  const drag_lbf = drag_N / 4.44822;

  // Fuel flow = SFC × thrust_required (thrust = drag in level flight)
  const fuelFlowLbsHr = perf.sfcCruise * drag_lbf;

  // Clamp to reasonable range: idle flow (~1200 PPH for twin) to mil (~18000 PPH)
  const idleFlow = perf.nEngines * 600;
  const maxFlow = perf.nEngines * 10000;
  return Math.max(idleFlow, Math.min(maxFlow, fuelFlowLbsHr));
}

/**
 * Get aircraft perf data for display purposes.
 */
export function getAircraftPerf(aircraftType: string): AircraftPerf {
  return AIRCRAFT_DB[aircraftType] || DEFAULT_PERF;
}
