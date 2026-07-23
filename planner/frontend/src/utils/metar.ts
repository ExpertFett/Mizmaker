/**
 * Generate a METAR-like weather string from DCS mission weather data.
 *
 * Format: ZZZZ DDHHmmZ dddssKT vis clouds temp/dp altimeter
 * Example: ZZZZ 101125Z 19704KT P6SM CLR M01/ A3110
 *
 * Not a real METAR (no station ID, no dewpoint from DCS, no remarks) but
 * uses standard METAR encoding so pilots can read it at a glance.
 */

import type { MissionWeather } from '../types/mission';
import { resolveClouds } from './cloudPresets';

function pad2(n: number): string { return String(Math.abs(Math.round(n))).padStart(2, '0'); }
function pad3(n: number): string { return String(Math.abs(Math.round(n))).padStart(3, '0'); }

function metersToFeet(m: number): number { return m * 3.28084; }
function msToKnots(ms: number): number { return ms * 1.94384; }

export function generateMetar(
  wx: MissionWeather,
  date?: string,
  startTime?: number,
): string {
  const parts: string[] = [];

  // Station — we use ZZZZ (unknown) since DCS doesn't have real ICAO
  parts.push('ZZZZ');

  // Date/time group: DDHHmmZ
  if (date && startTime != null) {
    const day = date.split('-')[2] || '01';
    const h = Math.floor(startTime / 3600) % 24;
    const m = Math.floor((startTime % 3600) / 60);
    parts.push(`${day}${pad2(h)}${pad2(m)}Z`);
  }

  // Wind: dddssKT (meteorological "from" direction)
  const windSpeed = Math.round(msToKnots(wx.wind.atGround.speed));
  if (windSpeed === 0) {
    parts.push('00000KT');
  } else {
    const meteoDir = (wx.wind.atGround.dir + 180) % 360;
    parts.push(`${pad3(meteoDir)}${pad2(windSpeed)}KT`);
  }

  // Visibility: statute miles
  const visSM = wx.visibility_m / 1609.34;
  if (visSM > 6) {
    parts.push('P6SM');
  } else if (visSM >= 1) {
    parts.push(`${Math.round(visSM)}SM`);
  } else {
    // Fractions for low vis
    const frac = visSM < 0.25 ? '1/4' : visSM < 0.5 ? '1/2' : '3/4';
    parts.push(`${frac}SM`);
  }

  // Fog/dust modifiers
  if (wx.fog_enabled && wx.fog_visibility > 0 && wx.fog_visibility < 1000) parts.push('FG');
  else if (wx.fog_enabled) parts.push('BR');
  if (wx.dust_enabled) parts.push('DU');

  // Clouds + precipitation — driven by the preset (authoritative), falling back
  // to the legacy density scale. Precip: a rainy/stormy preset OR an explicit
  // clouds_precipitation field. This is why RainyPreset1 now reads OVC + RA
  // instead of the old "FEW, no rain".
  const clouds = resolveClouds(wx.clouds_preset, wx.clouds_density);
  const isStorm = clouds.storm || wx.clouds_precipitation === 2;
  const isRain = clouds.rain || wx.clouds_precipitation === 1;
  if (isStorm) parts.push('TS');
  else if (isRain) parts.push('RA');

  if (clouds.cat === 'CLR') {
    parts.push('CLR');
  } else {
    const ceilFt = Math.round(metersToFeet(wx.clouds_base_m));
    const ceilHundreds = pad3(Math.round(ceilFt / 100));
    parts.push(`${clouds.cat}${ceilHundreds}`);
  }

  // Temperature (no dewpoint from DCS — show temp only with slash)
  const tempC = Math.round(wx.temperature_c);
  const tempStr = tempC < 0 ? `M${pad2(tempC)}` : pad2(tempC);
  parts.push(`${tempStr}/`);

  // Altimeter: A followed by QNH in hundredths of inHg
  const altSetting = Math.round(wx.qnh_mmhg * 0.03937 * 100);
  parts.push(`A${altSetting}`);

  return parts.join(' ');
}
