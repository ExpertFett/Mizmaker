import { describe, it, expect } from 'vitest';
import { resolveClouds } from './cloudPresets';
import { generateMetar } from './metar';
import type { MissionWeather } from '../types/mission';

describe('resolveClouds', () => {
  it('maps rainy presets to overcast + rain (the bug: was FEW/no-rain)', () => {
    expect(resolveClouds('RainyPreset1')).toMatchObject({ cat: 'OVC', rain: true });
    expect(resolveClouds('RainyPreset3')).toMatchObject({ cat: 'OVC', rain: true, storm: true });
  });
  it('maps numbered presets to the right category', () => {
    expect(resolveClouds('Preset1').cat).toBe('FEW');
    expect(resolveClouds('Preset5').cat).toBe('SCT');
    expect(resolveClouds('Preset10').cat).toBe('BKN');
    expect(resolveClouds('Preset17')).toMatchObject({ cat: 'BKN', rain: true });
    expect(resolveClouds('Preset18').cat).toBe('OVC');
    expect(resolveClouds('Preset26')).toMatchObject({ cat: 'OVC', rain: true, storm: true });
  });
  it('falls back to the legacy density scale with no preset', () => {
    expect(resolveClouds('', 0).cat).toBe('CLR');
    expect(resolveClouds('', 8).cat).toBe('OVC');
  });
});

function wx(partial: Partial<MissionWeather>): MissionWeather {
  return {
    wind: { atGround: { speed: 2, dir: 17 }, at2000: { speed: 5, dir: 30 }, at8000: { speed: 7, dir: 7 } },
    temperature_c: -1, qnh_mmhg: 790, qnh_inhg: 31.1, qnh_hpa: 1053,
    clouds_base_m: 2900, clouds_density: 0, clouds_thickness: 0, clouds_precipitation: 0,
    clouds_preset: '', visibility_m: 80000, fog_enabled: false, fog_visibility: 0,
    fog_thickness: 0, dust_enabled: false, dust_density: 0, turbulence: 0, halo_preset: 'off',
    ...partial,
  } as MissionWeather;
}

describe('generateMetar cloud/precip', () => {
  it('RainyPreset1 renders OVC + RA, not FEW', () => {
    const m = generateMetar(wx({ clouds_preset: 'RainyPreset1' }), '2006-11-07', 36000);
    expect(m).toContain('OVC095');
    expect(m).toContain('RA');
    expect(m).not.toContain('FEW');
  });
  it('Preset1 (light scattered) renders FEW, no precip', () => {
    const m = generateMetar(wx({ clouds_preset: 'Preset1', clouds_base_m: 2500 }), '2006-11-08', 23400);
    expect(m).toContain('FEW082');
    expect(m).not.toContain('RA');
    expect(m).not.toContain('OVC');
  });
  it('storm preset renders TS', () => {
    const m = generateMetar(wx({ clouds_preset: 'Preset27' }), '2006-11-07', 36000);
    expect(m).toContain('TS');
  });
});
