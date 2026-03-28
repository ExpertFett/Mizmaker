"""
Atmosphere math for DCS mission planning.

Converts between ground speed (GS), calibrated airspeed (CAS), true airspeed (TAS),
and Mach number based on altitude, temperature, and wind.

DCS weather quirk: wind direction is the direction the wind BLOWS TO
(opposite of real-world meteorological convention where it's FROM).
We convert to standard (FROM) for headwind/tailwind calculations.

Standard atmosphere model (ISA):
  - Sea level temp: 15°C (288.15 K)
  - Lapse rate: -6.5°C per 1000m (up to 11km)
  - Sea level pressure: 101325 Pa
  - Speed of sound at sea level: 340.3 m/s
"""

import math
from typing import Dict, Tuple

# ISA constants
ISA_TEMP_SL = 288.15       # K (15°C)
ISA_LAPSE = 0.0065         # K/m
ISA_PRESSURE_SL = 101325   # Pa
GAMMA = 1.4                # ratio of specific heats for air
R_AIR = 287.058            # J/(kg·K) specific gas constant
G = 9.80665                # m/s²
SPEED_OF_SOUND_SL = 340.294  # m/s at sea level ISA


def isa_temperature(altitude_m: float, ground_temp_c: float = 15.0) -> float:
    """Temperature in Kelvin at altitude, using ISA lapse rate with custom ground temp."""
    temp_offset = ground_temp_c - 15.0  # deviation from ISA
    if altitude_m <= 11000:
        return (ISA_TEMP_SL + temp_offset) - ISA_LAPSE * altitude_m
    # Above tropopause — constant temp
    return (ISA_TEMP_SL + temp_offset) - ISA_LAPSE * 11000


def isa_pressure(altitude_m: float, qnh_pa: float = 101325) -> float:
    """Pressure in Pa at altitude using barometric formula."""
    if altitude_m <= 11000:
        return qnh_pa * ((ISA_TEMP_SL - ISA_LAPSE * altitude_m) / ISA_TEMP_SL) ** (G / (ISA_LAPSE * R_AIR))
    # Above tropopause
    p11 = qnh_pa * ((ISA_TEMP_SL - ISA_LAPSE * 11000) / ISA_TEMP_SL) ** (G / (ISA_LAPSE * R_AIR))
    t11 = ISA_TEMP_SL - ISA_LAPSE * 11000
    return p11 * math.exp(-G * (altitude_m - 11000) / (R_AIR * t11))


def isa_density(altitude_m: float, ground_temp_c: float = 15.0, qnh_pa: float = 101325) -> float:
    """Air density in kg/m³ at altitude."""
    p = isa_pressure(altitude_m, qnh_pa)
    t = isa_temperature(altitude_m, ground_temp_c)
    return p / (R_AIR * t)


def speed_of_sound(altitude_m: float, ground_temp_c: float = 15.0) -> float:
    """Speed of sound in m/s at altitude."""
    t = isa_temperature(altitude_m, ground_temp_c)
    return math.sqrt(GAMMA * R_AIR * t)


def tas_to_cas(tas_ms: float, altitude_m: float, ground_temp_c: float = 15.0, qnh_pa: float = 101325) -> float:
    """Convert True Airspeed to Calibrated Airspeed (both in m/s)."""
    rho = isa_density(altitude_m, ground_temp_c, qnh_pa)
    rho0 = qnh_pa / (R_AIR * ISA_TEMP_SL)  # sea level density
    if rho <= 0 or rho0 <= 0:
        return tas_ms
    return tas_ms * math.sqrt(rho / rho0)


def cas_to_tas(cas_ms: float, altitude_m: float, ground_temp_c: float = 15.0, qnh_pa: float = 101325) -> float:
    """Convert Calibrated Airspeed to True Airspeed (both in m/s)."""
    rho = isa_density(altitude_m, ground_temp_c, qnh_pa)
    rho0 = qnh_pa / (R_AIR * ISA_TEMP_SL)
    if rho <= 0 or rho0 <= 0:
        return cas_ms
    return cas_ms / math.sqrt(rho / rho0)


def tas_to_mach(tas_ms: float, altitude_m: float, ground_temp_c: float = 15.0) -> float:
    """Convert TAS to Mach number."""
    a = speed_of_sound(altitude_m, ground_temp_c)
    return tas_ms / a if a > 0 else 0


def mach_to_tas(mach: float, altitude_m: float, ground_temp_c: float = 15.0) -> float:
    """Convert Mach to TAS in m/s."""
    a = speed_of_sound(altitude_m, ground_temp_c)
    return mach * a


def gs_to_tas(gs_ms: float, heading_deg: float, altitude_m: float, wind: Dict) -> float:
    """
    Estimate TAS from ground speed, accounting for wind.

    Wind is interpolated by altitude from DCS weather layers:
      atGround, at2000, at8000

    DCS wind dir = direction wind blows TO. We convert to FROM for standard math.
    """
    wind_speed, wind_from = interpolate_wind(altitude_m, wind)

    # Headwind component (positive = headwind, slows you down)
    wind_from_rad = math.radians(wind_from)
    heading_rad = math.radians(heading_deg)
    headwind = wind_speed * math.cos(wind_from_rad - heading_rad)

    # TAS ≈ GS + headwind component
    return gs_ms + headwind


def tas_to_gs(tas_ms: float, heading_deg: float, altitude_m: float, wind: Dict) -> float:
    """Estimate ground speed from TAS, accounting for wind."""
    wind_speed, wind_from = interpolate_wind(altitude_m, wind)
    wind_from_rad = math.radians(wind_from)
    heading_rad = math.radians(heading_deg)
    headwind = wind_speed * math.cos(wind_from_rad - heading_rad)
    return tas_ms - headwind


def interpolate_wind(altitude_m: float, wind: Dict) -> Tuple[float, float]:
    """
    Interpolate wind speed (m/s) and direction (FROM, degrees) at altitude.
    DCS provides wind at ground, 2000m, 8000m with dir = TO direction.
    We convert dir to FROM (add 180°).
    """
    ground = wind.get("atGround", {})
    mid = wind.get("at2000", {})
    high = wind.get("at8000", {})

    g_spd = ground.get("speed", 0)
    g_dir = (ground.get("dir", 0) + 180) % 360  # convert TO → FROM
    m_spd = mid.get("speed", 0)
    m_dir = (mid.get("dir", 0) + 180) % 360
    h_spd = high.get("speed", 0)
    h_dir = (high.get("dir", 0) + 180) % 360

    if altitude_m <= 0:
        return g_spd, g_dir
    elif altitude_m <= 2000:
        t = altitude_m / 2000
        return _lerp(g_spd, m_spd, t), _lerp_angle(g_dir, m_dir, t)
    elif altitude_m <= 8000:
        t = (altitude_m - 2000) / 6000
        return _lerp(m_spd, h_spd, t), _lerp_angle(m_dir, h_dir, t)
    else:
        return h_spd, h_dir


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _lerp_angle(a: float, b: float, t: float) -> float:
    """Interpolate between two angles (degrees), handling wraparound."""
    diff = ((b - a) + 180) % 360 - 180
    return (a + diff * t) % 360


def compute_speeds(
    gs_ms: float,
    altitude_m: float,
    heading_deg: float,
    wind: Dict,
    ground_temp_c: float = 15.0,
    qnh_pa: float = 101325,
) -> Dict:
    """
    Given ground speed, compute all speed representations.
    Returns dict with gs, tas, cas, mach (all in appropriate units).
    """
    tas = gs_to_tas(gs_ms, heading_deg, altitude_m, wind)
    cas = tas_to_cas(tas, altitude_m, ground_temp_c, qnh_pa)
    mach = tas_to_mach(tas, altitude_m, ground_temp_c)

    return {
        "gs_kts": gs_ms * 1.94384,
        "tas_kts": tas * 1.94384,
        "cas_kts": cas * 1.94384,
        "mach": round(mach, 3),
    }


def qnh_mmhg_to_pa(mmhg: float) -> float:
    """Convert QNH from mmHg to Pa."""
    return mmhg * 133.322


def qnh_mmhg_to_inhg(mmhg: float) -> float:
    """Convert QNH from mmHg to inHg."""
    return mmhg * 0.03937
