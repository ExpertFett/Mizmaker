import { useState, useEffect, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { MissionWeather } from '../../types/mission';

/* ------------------------------------------------------------------ */
/* DCS Cloud Presets                                                   */
/* ------------------------------------------------------------------ */

const DCS_CLOUD_PRESETS: { id: string; label: string; description: string }[] = [
  { id: '', label: 'None / Custom', description: 'No preset — manual cloud settings' },
  { id: 'Preset1', label: 'FEW070', description: 'Few clouds at 7,000 ft' },
  { id: 'Preset2', label: 'FEW080', description: 'Few clouds at 8,000 ft' },
  { id: 'Preset3', label: 'FEW090', description: 'Few clouds at 9,000 ft' },
  { id: 'Preset4', label: 'FEW100', description: 'Few scattered at 10,000 ft' },
  { id: 'Preset5', label: 'SCT080', description: 'Scattered at 8,000 ft' },
  { id: 'Preset6', label: 'SCT100', description: 'Scattered at 10,000 ft' },
  { id: 'Preset7', label: 'BKN070', description: 'Broken at 7,000 ft' },
  { id: 'Preset8', label: 'BKN080', description: 'Broken at 8,000 ft' },
  { id: 'Preset9', label: 'BKN100', description: 'Broken at 10,000 ft' },
  { id: 'Preset10', label: 'OVC050', description: 'Overcast at 5,000 ft' },
  { id: 'Preset11', label: 'OVC070', description: 'Overcast at 7,000 ft' },
  { id: 'Preset12', label: 'OVC080', description: 'Overcast thick at 8,000 ft' },
  { id: 'Preset13', label: 'OVC100', description: 'Overcast thick at 10,000 ft' },
  { id: 'Preset14', label: 'OVC120', description: 'Overcast thick at 12,000 ft' },
  { id: 'Preset15', label: 'OVC+RA050', description: 'Overcast + rain at 5,000 ft' },
  { id: 'Preset16', label: 'OVC+RA070', description: 'Overcast + rain at 7,000 ft' },
  { id: 'Preset17', label: 'OVC+RA080', description: 'Overcast + rain at 8,000 ft' },
  { id: 'Preset18', label: 'OVC+RA090', description: 'Overcast + rain at 9,000 ft' },
  { id: 'Preset19', label: 'OVC+TSRA050', description: 'Overcast + thunderstorm at 5,000 ft' },
  { id: 'Preset20', label: 'OVC+TSRA060', description: 'Overcast + thunderstorm at 6,000 ft' },
  { id: 'Preset21', label: 'OVC+TSRA070', description: 'Overcast + thunderstorm at 7,000 ft' },
  { id: 'Preset22', label: 'OVC+TSRA080', description: 'Overcast + thunderstorm at 8,000 ft' },
  { id: 'Preset23', label: 'OVC+TSRA090', description: 'Overcast + heavy TS at 9,000 ft' },
  { id: 'Preset24', label: 'OVC+TSRA100', description: 'Overcast + heavy TS at 10,000 ft' },
  { id: 'Preset25', label: 'OVC+SN050', description: 'Overcast + snow at 5,000 ft' },
  { id: 'Preset26', label: 'OVC+SN070', description: 'Overcast + snow at 7,000 ft' },
  { id: 'Preset27', label: 'OVC+SN100', description: 'Overcast + heavy snow at 10,000 ft' },
  { id: 'RasPreset1', label: 'RAS FEW', description: 'WWII — Few clouds' },
  { id: 'RasBPreset1', label: 'RAS BKN', description: 'WWII — Broken clouds' },
  { id: 'RasBPreset2', label: 'RAS OVC', description: 'WWII — Overcast' },
  { id: 'RasBPreset3', label: 'RAS OVC+RA', description: 'WWII — Overcast + rain' },
];

/* ------------------------------------------------------------------ */
/* Quick Weather Presets                                               */
/* ------------------------------------------------------------------ */

interface QuickPreset {
  label: string;
  icon: string;
  values: Partial<WeatherState>;
}

const QUICK_PRESETS: QuickPreset[] = [
  {
    label: 'Clear Sky', icon: '\u2600\uFE0F',
    values: {
      clouds_density: 0, clouds_thickness: 200, clouds_base_m: 300, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 80000, ground_turbulence: 0, dust_enabled: false, dust_density: 0,
    },
  },
  {
    label: 'Partly Cloudy', icon: '\u26C5',
    values: {
      clouds_density: 3, clouds_thickness: 400, clouds_base_m: 1500, clouds_precipitation: 0,
      clouds_preset: 'Preset5', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 50000, ground_turbulence: 15, dust_enabled: false, dust_density: 0,
    },
  },
  {
    label: 'Overcast', icon: '\u2601\uFE0F',
    values: {
      clouds_density: 7, clouds_thickness: 800, clouds_base_m: 600, clouds_precipitation: 0,
      clouds_preset: 'Preset11', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 30000, ground_turbulence: 25, dust_enabled: false, dust_density: 0,
    },
  },
  {
    label: 'Light Rain', icon: '\uD83C\uDF27\uFE0F',
    values: {
      clouds_density: 8, clouds_thickness: 1000, clouds_base_m: 500, clouds_precipitation: 1,
      clouds_preset: 'Preset16', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 15000, ground_turbulence: 35, dust_enabled: false, dust_density: 0,
    },
  },
  {
    label: 'Heavy Storm', icon: '\u26C8\uFE0F',
    values: {
      clouds_density: 10, clouds_thickness: 1500, clouds_base_m: 300, clouds_precipitation: 2,
      clouds_preset: 'Preset22', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 8000, ground_turbulence: 80, dust_enabled: false, dust_density: 0,
    },
  },
  {
    label: 'Foggy', icon: '\uD83C\uDF2B\uFE0F',
    values: {
      clouds_density: 1, clouds_thickness: 200, clouds_base_m: 300, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: true, fog_visibility: 500, fog_thickness: 100,
      visibility_m: 4000, ground_turbulence: 0, dust_enabled: false, dust_density: 0,
    },
  },
  {
    label: 'Dust Storm', icon: '\uD83C\uDF2A\uFE0F',
    values: {
      clouds_density: 0, clouds_thickness: 200, clouds_base_m: 300, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 2000, ground_turbulence: 60, dust_enabled: true, dust_density: 3000,
    },
  },
];

/* ------------------------------------------------------------------ */
/* Advanced Weather Presets — categorized, realistic scenarios          */
/* ------------------------------------------------------------------ */

interface AdvancedPreset {
  label: string;
  icon: string;
  category: 'vfr' | 'ifr' | 'precip' | 'extreme' | 'carrier' | 'regional';
  description: string;
  values: Partial<WeatherState>;
}

const PRESET_CATEGORIES: Record<string, { label: string; color: string }> = {
  vfr:      { label: 'VFR Conditions',     color: '#60c080' },
  ifr:      { label: 'IFR / Low Vis',      color: '#d29922' },
  precip:   { label: 'Precipitation',       color: '#4a8fd4' },
  extreme:  { label: 'Extreme / Hazardous', color: '#d95050' },
  carrier:  { label: 'Carrier Ops',         color: '#b07ed8' },
  regional: { label: 'Regional / Seasonal', color: '#8aaabe' },
};

const ADVANCED_PRESETS: AdvancedPreset[] = [
  // ── VFR Conditions ──
  {
    label: 'CAVOK', icon: '\u2600\uFE0F', category: 'vfr',
    description: 'Ceiling & visibility OK. Perfect flying weather, unlimited visibility.',
    values: {
      clouds_density: 0, clouds_thickness: 200, clouds_base_m: 3000, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 80000, ground_turbulence: 0, dust_enabled: false, dust_density: 0,
      temperature_c: 22, qnh_mmhg: 760,
    },
  },
  {
    label: 'Blue Sky Thermals', icon: '\uD83C\uDF24\uFE0F', category: 'vfr',
    description: 'Clear with afternoon thermal turbulence. Bumpy below 5,000 ft.',
    values: {
      clouds_density: 1, clouds_thickness: 300, clouds_base_m: 2500, clouds_precipitation: 0,
      clouds_preset: 'Preset1', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 70000, ground_turbulence: 40, dust_enabled: false, dust_density: 0,
      temperature_c: 32, qnh_mmhg: 758,
    },
  },
  {
    label: 'High Scattered', icon: '\u26C5', category: 'vfr',
    description: 'Scattered clouds at 10,000 ft. Good VFR, light winds.',
    values: {
      clouds_density: 3, clouds_thickness: 400, clouds_base_m: 3000, clouds_precipitation: 0,
      clouds_preset: 'Preset6', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 60000, ground_turbulence: 10, dust_enabled: false, dust_density: 0,
      temperature_c: 20, qnh_mmhg: 760,
    },
  },
  {
    label: 'Fair Weather', icon: '\uD83C\uDF25\uFE0F', category: 'vfr',
    description: 'Few clouds at 7,000 ft, light haze. Standard training day.',
    values: {
      clouds_density: 2, clouds_thickness: 300, clouds_base_m: 2100, clouds_precipitation: 0,
      clouds_preset: 'Preset1', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 40000, ground_turbulence: 15, dust_enabled: false, dust_density: 0,
      temperature_c: 24, qnh_mmhg: 759,
    },
  },
  {
    label: 'Hazy Sunshine', icon: '\uD83D\uDE36\u200D\uD83C\uDF2B\uFE0F', category: 'vfr',
    description: 'Clear sky but reduced vis from haze. 10-15 km visibility.',
    values: {
      clouds_density: 0, clouds_thickness: 200, clouds_base_m: 3000, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 12000, ground_turbulence: 5, dust_enabled: false, dust_density: 0,
      temperature_c: 28, qnh_mmhg: 757,
    },
  },

  // ── IFR / Low Visibility ──
  {
    label: 'Marginal VFR', icon: '\uD83C\uDF25\uFE0F', category: 'ifr',
    description: 'Ceiling 3,000 ft, vis 5 km. Borderline VFR/IFR.',
    values: {
      clouds_density: 6, clouds_thickness: 600, clouds_base_m: 900, clouds_precipitation: 0,
      clouds_preset: 'Preset8', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 5000, ground_turbulence: 20, dust_enabled: false, dust_density: 0,
      temperature_c: 14, qnh_mmhg: 752,
    },
  },
  {
    label: 'Low IFR', icon: '\u2601\uFE0F', category: 'ifr',
    description: 'Ceiling 500 ft, vis 1.5 km. Instrument approach required.',
    values: {
      clouds_density: 9, clouds_thickness: 1200, clouds_base_m: 150, clouds_precipitation: 0,
      clouds_preset: 'Preset10', fog_enabled: true, fog_visibility: 1500, fog_thickness: 200,
      visibility_m: 3000, ground_turbulence: 15, dust_enabled: false, dust_density: 0,
      temperature_c: 8, qnh_mmhg: 748,
    },
  },
  {
    label: 'Morning Fog', icon: '\uD83C\uDF2B\uFE0F', category: 'ifr',
    description: 'Dense valley fog, 200m vis. Burns off by midday.',
    values: {
      clouds_density: 2, clouds_thickness: 200, clouds_base_m: 300, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: true, fog_visibility: 200, fog_thickness: 150,
      visibility_m: 1500, ground_turbulence: 0, dust_enabled: false, dust_density: 0,
      temperature_c: 6, qnh_mmhg: 758,
    },
  },
  {
    label: 'Marine Layer', icon: '\uD83C\uDF2B\uFE0F', category: 'ifr',
    description: 'Coastal stratus 800 ft, clear above. Classic SoCal/Med morning.',
    values: {
      clouds_density: 8, clouds_thickness: 400, clouds_base_m: 250, clouds_precipitation: 0,
      clouds_preset: 'Preset10', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 8000, ground_turbulence: 5, dust_enabled: false, dust_density: 0,
      temperature_c: 16, qnh_mmhg: 760,
    },
  },
  {
    label: 'Overcast Low', icon: '\u2601\uFE0F', category: 'ifr',
    description: 'Solid overcast at 2,000 ft. Dull grey sky, decent ground vis.',
    values: {
      clouds_density: 8, clouds_thickness: 900, clouds_base_m: 600, clouds_precipitation: 0,
      clouds_preset: 'Preset11', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 15000, ground_turbulence: 20, dust_enabled: false, dust_density: 0,
      temperature_c: 12, qnh_mmhg: 750,
    },
  },

  // ── Precipitation ──
  {
    label: 'Drizzle', icon: '\uD83C\uDF26\uFE0F', category: 'precip',
    description: 'Light drizzle from low overcast. Wet but flyable.',
    values: {
      clouds_density: 7, clouds_thickness: 800, clouds_base_m: 400, clouds_precipitation: 1,
      clouds_preset: 'Preset15', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 10000, ground_turbulence: 15, dust_enabled: false, dust_density: 0,
      temperature_c: 10, qnh_mmhg: 748,
    },
  },
  {
    label: 'Steady Rain', icon: '\uD83C\uDF27\uFE0F', category: 'precip',
    description: 'Moderate continuous rain. Reduced vis, slick runways.',
    values: {
      clouds_density: 9, clouds_thickness: 1200, clouds_base_m: 300, clouds_precipitation: 1,
      clouds_preset: 'Preset17', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 6000, ground_turbulence: 30, dust_enabled: false, dust_density: 0,
      temperature_c: 12, qnh_mmhg: 745,
    },
  },
  {
    label: 'Thunderstorm', icon: '\u26C8\uFE0F', category: 'precip',
    description: 'Active CB with heavy rain. Severe turbulence, low ceilings.',
    values: {
      clouds_density: 10, clouds_thickness: 1500, clouds_base_m: 200, clouds_precipitation: 2,
      clouds_preset: 'Preset21', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 4000, ground_turbulence: 75, dust_enabled: false, dust_density: 0,
      temperature_c: 18, qnh_mmhg: 742,
    },
  },
  {
    label: 'Snow Showers', icon: '\uD83C\uDF28\uFE0F', category: 'precip',
    description: 'Intermittent snow from broken deck. 3-5 km vis in showers.',
    values: {
      clouds_density: 7, clouds_thickness: 800, clouds_base_m: 600, clouds_precipitation: 1,
      clouds_preset: 'Preset25', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 4000, ground_turbulence: 25, dust_enabled: false, dust_density: 0,
      temperature_c: -4, qnh_mmhg: 748,
    },
  },
  {
    label: 'Heavy Snow', icon: '\u2744\uFE0F', category: 'precip',
    description: 'Continuous heavy snow. Near whiteout, 1-2 km vis.',
    values: {
      clouds_density: 10, clouds_thickness: 1500, clouds_base_m: 200, clouds_precipitation: 2,
      clouds_preset: 'Preset27', fog_enabled: true, fog_visibility: 800, fog_thickness: 100,
      visibility_m: 1500, ground_turbulence: 30, dust_enabled: false, dust_density: 0,
      temperature_c: -8, qnh_mmhg: 740,
    },
  },
  {
    label: 'Freezing Rain', icon: '\uD83E\uDDCA', category: 'precip',
    description: 'Rain with sub-zero temps. Severe icing hazard.',
    values: {
      clouds_density: 9, clouds_thickness: 1000, clouds_base_m: 300, clouds_precipitation: 1,
      clouds_preset: 'Preset16', fog_enabled: true, fog_visibility: 1000, fog_thickness: 100,
      visibility_m: 3000, ground_turbulence: 20, dust_enabled: false, dust_density: 0,
      temperature_c: -2, qnh_mmhg: 744,
    },
  },

  // ── Extreme / Hazardous ──
  {
    label: 'Severe Turbulence', icon: '\uD83D\uDCA8', category: 'extreme',
    description: 'Strong gusty winds, mountain wave. Clear but violent ride.',
    values: {
      clouds_density: 2, clouds_thickness: 300, clouds_base_m: 2000, clouds_precipitation: 0,
      clouds_preset: 'Preset3', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 50000, ground_turbulence: 90, dust_enabled: false, dust_density: 0,
      temperature_c: 8, qnh_mmhg: 745,
      wind: { atGround: { speed: 15, dir: 270 }, at2000: { speed: 25, dir: 280 }, at8000: { speed: 40, dir: 290 } },
    },
  },
  {
    label: 'Dust Storm', icon: '\uD83C\uDF2A\uFE0F', category: 'extreme',
    description: 'Severe dust, vis under 2 km. Desert ops nightmare.',
    values: {
      clouds_density: 0, clouds_thickness: 200, clouds_base_m: 300, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 1500, ground_turbulence: 65, dust_enabled: true, dust_density: 3500,
      temperature_c: 40, qnh_mmhg: 752,
      wind: { atGround: { speed: 12, dir: 180 }, at2000: { speed: 18, dir: 190 }, at8000: { speed: 25, dir: 200 } },
    },
  },
  {
    label: 'Sandstorm', icon: '\uD83C\uDFDC\uFE0F', category: 'extreme',
    description: 'Dense sand, near-zero vis. Brownout conditions on approach.',
    values: {
      clouds_density: 0, clouds_thickness: 200, clouds_base_m: 300, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 500, ground_turbulence: 80, dust_enabled: true, dust_density: 5000,
      temperature_c: 44, qnh_mmhg: 750,
      wind: { atGround: { speed: 18, dir: 200 }, at2000: { speed: 22, dir: 210 }, at8000: { speed: 30, dir: 220 } },
    },
  },
  {
    label: 'Blizzard', icon: '\uD83C\uDF28\uFE0F', category: 'extreme',
    description: 'Whiteout blizzard. Zero vis, high winds, no-fly conditions.',
    values: {
      clouds_density: 10, clouds_thickness: 2000, clouds_base_m: 100, clouds_precipitation: 2,
      clouds_preset: 'Preset27', fog_enabled: true, fog_visibility: 200, fog_thickness: 200,
      visibility_m: 500, ground_turbulence: 85, dust_enabled: false, dust_density: 0,
      temperature_c: -15, qnh_mmhg: 735,
      wind: { atGround: { speed: 15, dir: 330 }, at2000: { speed: 22, dir: 340 }, at8000: { speed: 35, dir: 350 } },
    },
  },

  // ── Carrier Ops ──
  {
    label: 'Case I Recovery', icon: '\u2693', category: 'carrier',
    description: 'Ceiling >3,000 ft, vis >5 NM. Day VFR carrier pattern.',
    values: {
      clouds_density: 2, clouds_thickness: 300, clouds_base_m: 1500, clouds_precipitation: 0,
      clouds_preset: 'Preset1', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 30000, ground_turbulence: 10, dust_enabled: false, dust_density: 0,
      temperature_c: 22, qnh_mmhg: 760,
      wind: { atGround: { speed: 8, dir: 0 }, at2000: { speed: 10, dir: 350 }, at8000: { speed: 15, dir: 340 } },
    },
  },
  {
    label: 'Case II Recovery', icon: '\u2693', category: 'carrier',
    description: 'Ceiling 1,000-3,000 ft, vis >5 NM. Instrument departure, visual approach.',
    values: {
      clouds_density: 6, clouds_thickness: 600, clouds_base_m: 600, clouds_precipitation: 0,
      clouds_preset: 'Preset8', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 15000, ground_turbulence: 20, dust_enabled: false, dust_density: 0,
      temperature_c: 18, qnh_mmhg: 755,
      wind: { atGround: { speed: 10, dir: 0 }, at2000: { speed: 14, dir: 350 }, at8000: { speed: 20, dir: 340 } },
    },
  },
  {
    label: 'Case III Recovery', icon: '\u2693', category: 'carrier',
    description: 'Ceiling <1,000 ft or vis <5 NM. Full instrument approach, ball call at 3/4 mi.',
    values: {
      clouds_density: 9, clouds_thickness: 1000, clouds_base_m: 200, clouds_precipitation: 0,
      clouds_preset: 'Preset10', fog_enabled: true, fog_visibility: 2000, fog_thickness: 100,
      visibility_m: 5000, ground_turbulence: 25, dust_enabled: false, dust_density: 0,
      temperature_c: 14, qnh_mmhg: 748,
      wind: { atGround: { speed: 12, dir: 0 }, at2000: { speed: 16, dir: 350 }, at8000: { speed: 22, dir: 340 } },
    },
  },

  // ── Regional / Seasonal ──
  {
    label: 'Persian Gulf Summer', icon: '\uD83C\uDFDC\uFE0F', category: 'regional',
    description: 'Hot, hazy, light dust. Typical Gulf summer ops, 45C+.',
    values: {
      clouds_density: 0, clouds_thickness: 200, clouds_base_m: 3000, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 8000, ground_turbulence: 35, dust_enabled: true, dust_density: 1500,
      temperature_c: 46, qnh_mmhg: 752,
    },
  },
  {
    label: 'Caucasus Winter', icon: '\u2744\uFE0F', category: 'regional',
    description: 'Cold overcast, scattered snow. Short daylight, frozen runways.',
    values: {
      clouds_density: 7, clouds_thickness: 800, clouds_base_m: 500, clouds_precipitation: 1,
      clouds_preset: 'Preset25', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 8000, ground_turbulence: 20, dust_enabled: false, dust_density: 0,
      temperature_c: -6, qnh_mmhg: 745,
      wind: { atGround: { speed: 8, dir: 30 }, at2000: { speed: 14, dir: 40 }, at8000: { speed: 22, dir: 50 } },
    },
  },
  {
    label: 'Mediterranean Summer', icon: '\u2600\uFE0F', category: 'regional',
    description: 'Hot, clear, thermal bumps. Classic Syria/Cyprus ops.',
    values: {
      clouds_density: 1, clouds_thickness: 200, clouds_base_m: 2500, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 50000, ground_turbulence: 30, dust_enabled: false, dust_density: 0,
      temperature_c: 36, qnh_mmhg: 758,
    },
  },
  {
    label: 'Channel Autumn', icon: '\uD83C\uDF43', category: 'regional',
    description: 'Cool, overcast, drizzle. English Channel / Normandy conditions.',
    values: {
      clouds_density: 8, clouds_thickness: 900, clouds_base_m: 400, clouds_precipitation: 1,
      clouds_preset: 'Preset15', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 8000, ground_turbulence: 25, dust_enabled: false, dust_density: 0,
      temperature_c: 10, qnh_mmhg: 748,
      wind: { atGround: { speed: 8, dir: 240 }, at2000: { speed: 14, dir: 250 }, at8000: { speed: 22, dir: 260 } },
    },
  },
  {
    label: 'Monsoon', icon: '\uD83C\uDF0A', category: 'regional',
    description: 'Heavy tropical rain, low ceilings, high humidity. SE Asia conditions.',
    values: {
      clouds_density: 10, clouds_thickness: 1500, clouds_base_m: 200, clouds_precipitation: 2,
      clouds_preset: 'Preset22', fog_enabled: true, fog_visibility: 1500, fog_thickness: 100,
      visibility_m: 3000, ground_turbulence: 50, dust_enabled: false, dust_density: 0,
      temperature_c: 30, qnh_mmhg: 746,
      wind: { atGround: { speed: 10, dir: 180 }, at2000: { speed: 16, dir: 190 }, at8000: { speed: 24, dir: 200 } },
    },
  },
  {
    label: 'Arctic Clear', icon: '\u2B50', category: 'regional',
    description: 'Crystal clear polar air, extreme cold. Great vis but sub-zero.',
    values: {
      clouds_density: 0, clouds_thickness: 200, clouds_base_m: 3000, clouds_precipitation: 0,
      clouds_preset: '', fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      visibility_m: 80000, ground_turbulence: 5, dust_enabled: false, dust_density: 0,
      temperature_c: -20, qnh_mmhg: 770,
    },
  },
];

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

interface WeatherState {
  wind: {
    atGround: { speed: number; dir: number };
    at2000: { speed: number; dir: number };
    at8000: { speed: number; dir: number };
  };
  temperature_c: number;
  qnh_mmhg: number;
  clouds_base_m: number;
  clouds_density: number;
  clouds_thickness: number;
  clouds_precipitation: number;
  clouds_preset: string;
  fog_enabled: boolean;
  fog_visibility: number;
  fog_thickness: number;
  dust_enabled: boolean;
  dust_density: number;
  visibility_m: number;
  ground_turbulence: number;
  day: number;
  month: number;
  year: number;
  start_time: number;
}

function weatherFromOverview(weather: MissionWeather, date: string, startTime: number): WeatherState {
  const [y, m, d] = date.split('-').map(Number);
  return {
    wind: {
      atGround: { ...weather.wind.atGround },
      at2000: { ...weather.wind.at2000 },
      at8000: { ...weather.wind.at8000 },
    },
    temperature_c: weather.temperature_c,
    qnh_mmhg: weather.qnh_mmhg,
    clouds_base_m: weather.clouds_base_m,
    clouds_density: weather.clouds_density ?? 0,
    clouds_thickness: weather.clouds_thickness ?? 200,
    clouds_precipitation: weather.clouds_precipitation ?? 0,
    clouds_preset: weather.clouds_preset ?? '',
    fog_enabled: weather.fog_enabled ?? false,
    fog_visibility: weather.fog_visibility ?? 0,
    fog_thickness: weather.fog_thickness ?? 0,
    dust_enabled: weather.dust_enabled ?? false,
    dust_density: weather.dust_density ?? 0,
    visibility_m: weather.visibility_m,
    ground_turbulence: weather.turbulence ?? 0,
    day: d || 1,
    month: m || 6,
    year: y || 2024,
    start_time: startTime,
  };
}

/** Build the weather edit payload that _replace_weather_block expects */
function toBackendFormat(w: WeatherState): Record<string, unknown> {
  return {
    wind: w.wind,
    clouds: {
      base: w.clouds_base_m,
      density: w.clouds_density,
      thickness: w.clouds_thickness,
      iprecptns: w.clouds_precipitation,
      preset: w.clouds_preset,
    },
    fog: {
      enabled: w.fog_enabled,
      visibility: w.fog_visibility,
      thickness: w.fog_thickness,
    },
    dust: {
      enabled: w.dust_enabled,
      density: w.dust_density,
    },
    visibility: w.visibility_m,
    temperature: w.temperature_c,
    qnh: w.qnh_mmhg,
    groundTurbulence: w.ground_turbulence,
    date: { day: w.day, month: w.month, year: w.year },
    startTime: w.start_time,
  };
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function WeatherTab() {
  const overview = useMissionStore((s) => s.overview);
  const addEdit = useEditStore((s) => s.addEdit);

  const [weather, setWeather] = useState<WeatherState | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');

  useEffect(() => {
    if (overview?.weather) {
      setWeather(weatherFromOverview(overview.weather, overview.date, overview.start_time));
    }
  }, [overview]);

  const update = useCallback((partial: Partial<WeatherState>) => {
    setWeather((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      setHasChanges(true);
      // Queue edit in the format _replace_weather_block expects
      addEdit({ field: 'weather', value: toBackendFormat(next) } as any);

      // Sync back to store so WeatherPanel on map stays current
      const { overview } = useMissionStore.getState();
      if (overview) {
        useMissionStore.setState({
          overview: {
            ...overview,
            weather: {
              ...overview.weather,
              wind: next.wind,
              temperature_c: next.temperature_c,
              qnh_mmhg: next.qnh_mmhg,
              qnh_inhg: Math.round(next.qnh_mmhg * 0.03937 * 100) / 100,
              qnh_hpa: Math.round(next.qnh_mmhg * 1.33322 * 10) / 10,
              clouds_base_m: next.clouds_base_m,
              clouds_density: next.clouds_density,
              clouds_thickness: next.clouds_thickness,
              clouds_precipitation: next.clouds_precipitation,
              clouds_preset: next.clouds_preset,
              visibility_m: next.visibility_m,
              fog_enabled: next.fog_enabled,
              fog_visibility: next.fog_visibility,
              fog_thickness: next.fog_thickness,
              dust_enabled: next.dust_enabled,
              dust_density: next.dust_density,
              turbulence: next.ground_turbulence,
            },
            date: `${next.year}-${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}`,
            start_time: next.start_time,
          },
        });
      }

      return next;
    });
  }, [addEdit]);

  const updateWind = useCallback((layer: 'atGround' | 'at2000' | 'at8000', field: 'speed' | 'dir', value: number) => {
    setWeather((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        wind: {
          ...prev.wind,
          [layer]: { ...prev.wind[layer], [field]: value },
        },
      };
      setHasChanges(true);
      addEdit({ field: 'weather', value: toBackendFormat(next) } as any);

      const { overview } = useMissionStore.getState();
      if (overview) {
        useMissionStore.setState({
          overview: { ...overview, weather: { ...overview.weather, wind: next.wind } },
        });
      }
      return next;
    });
  }, [addEdit]);

  if (!weather) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 15, padding: 20 }}>
        No weather data available for this mission.
      </div>
    );
  }

  return (
    <div>
      {/* Header with mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
            Weather Editor
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#5a7a8a' }}>
            {mode === 'simple'
              ? 'Pick a preset or cloud layer. Switch to Advanced for full control.'
              : 'Full control over all weather parameters.'}
          </p>
        </div>
        <div style={{ display: 'flex', background: '#0f1a28', border: '1px solid #1a2a3a', borderRadius: 4, overflow: 'hidden' }}>
          <button
            onClick={() => setMode('simple')}
            style={{
              padding: '6px 14px', fontSize: 13, border: 'none', cursor: 'pointer',
              background: mode === 'simple' ? '#1a3a5a' : 'transparent',
              color: mode === 'simple' ? '#ccdae8' : '#5a7a8a', fontWeight: mode === 'simple' ? 600 : 400,
            }}
          >
            Simple
          </button>
          <button
            onClick={() => setMode('advanced')}
            style={{
              padding: '6px 14px', fontSize: 13, border: 'none', cursor: 'pointer',
              background: mode === 'advanced' ? '#1a3a5a' : 'transparent',
              color: mode === 'advanced' ? '#ccdae8' : '#5a7a8a', fontWeight: mode === 'advanced' ? 600 : 400,
            }}
          >
            Advanced
          </button>
        </div>
      </div>

      {mode === 'simple' ? (
        <SimpleMode weather={weather} update={update} updateWind={updateWind} hasChanges={hasChanges} />
      ) : (
        <AdvancedMode weather={weather} update={update} updateWind={updateWind} hasChanges={hasChanges} />
      )}
    </div>
  );
}

/* ================================================================== */
/* SIMPLE MODE                                                        */
/* ================================================================== */

function SimpleMode({
  weather, update, updateWind, hasChanges,
}: {
  weather: WeatherState;
  update: (p: Partial<WeatherState>) => void;
  updateWind: (layer: 'atGround' | 'at2000' | 'at8000', field: 'speed' | 'dir', value: number) => void;
  hasChanges: boolean;
}) {
  return (
    <>
      {/* Weather summary card */}
      <WeatherSummary weather={weather} />

      {/* Quick presets */}
      <Section title="Quick Presets" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {QUICK_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => update(preset.values)}
              style={{
                ...presetBtnStyle,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                minWidth: 90, padding: '10px 14px',
              }}
            >
              <span style={{ fontSize: 20 }}>{preset.icon}</span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* DCS Cloud Preset dropdown */}
      <Section title="DCS Cloud Layer" changed={hasChanges}>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#5a7a8a' }}>
          DCS uses named cloud presets that override manual density/thickness. Select a preset to set cloud layers automatically.
        </p>
        <select
          value={weather.clouds_preset}
          onChange={(e) => update({ clouds_preset: e.target.value })}
          style={selectStyle}
        >
          {DCS_CLOUD_PRESETS.map((cp) => (
            <option key={cp.id} value={cp.id}>
              {cp.label} — {cp.description}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
          <label style={fieldLabelStyle}>
            Cloud Base (m)
            <input
              type="number" value={weather.clouds_base_m} min={0} max={15000}
              onChange={(e) => update({ clouds_base_m: Number(e.target.value) })}
              style={numInputStyle}
            />
          </label>
          <label style={{ ...fieldLabelStyle, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}>
            <input type="checkbox" checked={weather.clouds_precipitation > 0}
              onChange={(e) => update({ clouds_precipitation: e.target.checked ? 1 : 0 })}
              style={{ accentColor: '#4a8fd4' }}
            />
            Precipitation
          </label>
        </div>
      </Section>

      {/* Wind with wind rose */}
      <Section title="Wind" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <WindRose speed={weather.wind.atGround.speed} dir={weather.wind.atGround.dir} />
          {([
            ['atGround', 'Ground'],
            ['at2000', '6,600 ft'],
            ['at8000', '26,000 ft'],
          ] as const).map(([layer, label]) => (
            <div key={layer} style={cardStyle}>
              <div style={{ fontSize: 13, color: '#8fa8c0', fontWeight: 600, marginBottom: 8 }}>{label}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={fieldLabelStyle}>
                  Speed (m/s)
                  <input type="number" value={weather.wind[layer].speed} min={0} max={50}
                    onChange={(e) => updateWind(layer, 'speed', Number(e.target.value))}
                    style={numInputStyle} />
                </label>
                <label style={fieldLabelStyle}>
                  Dir (deg)
                  <input type="number" value={weather.wind[layer].dir} min={0} max={359}
                    onChange={(e) => updateWind(layer, 'dir', Number(e.target.value))}
                    style={numInputStyle} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Key settings + QNH display */}
      <Section title="Conditions" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={fieldLabelStyle}>
            Temperature (C)
            <input type="number" value={weather.temperature_c}
              onChange={(e) => update({ temperature_c: Number(e.target.value) })} style={numInputStyle} />
          </label>
          <label style={fieldLabelStyle}>
            QNH (mmHg)
            <input type="number" value={weather.qnh_mmhg}
              onChange={(e) => update({ qnh_mmhg: Number(e.target.value) })} style={numInputStyle} />
          </label>
          <label style={fieldLabelStyle}>
            Visibility (m)
            <input type="number" value={weather.visibility_m} min={0}
              onChange={(e) => update({ visibility_m: Number(e.target.value) })} style={numInputStyle} />
          </label>
          <label style={{ ...fieldLabelStyle, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}>
            <input type="checkbox" checked={weather.fog_enabled}
              onChange={(e) => update({ fog_enabled: e.target.checked })} style={{ accentColor: '#4a8fd4' }} />
            Fog
          </label>
          {weather.fog_enabled && (
            <label style={fieldLabelStyle}>
              Fog Vis (m)
              <input type="number" value={weather.fog_visibility} min={0}
                onChange={(e) => update({ fog_visibility: Number(e.target.value) })} style={numInputStyle} />
            </label>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <QnhDisplay mmhg={weather.qnh_mmhg} />
        </div>
      </Section>

      {/* Date/Time with quick buttons */}
      <Section title="Date / Time" changed={hasChanges}>
        <TimeOfDayButtons current={weather.start_time} onSelect={(s) => update({ start_time: s })} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={fieldLabelStyle}>
            Day
            <input type="number" value={weather.day} min={1} max={31}
              onChange={(e) => update({ day: Number(e.target.value) })} style={numInputStyle} />
          </label>
          <label style={fieldLabelStyle}>
            Month
            <input type="number" value={weather.month} min={1} max={12}
              onChange={(e) => update({ month: Number(e.target.value) })} style={numInputStyle} />
          </label>
          <label style={fieldLabelStyle}>
            Year
            <input type="number" value={weather.year}
              onChange={(e) => update({ year: Number(e.target.value) })} style={numInputStyle} />
          </label>
          <label style={fieldLabelStyle}>
            Start Time
            <input type="text" value={formatTime(weather.start_time)} placeholder="HH:MM"
              onChange={(e) => update({ start_time: parseTime(e.target.value) })}
              style={{ ...numInputStyle, width: 80, fontFamily: 'monospace' }} />
          </label>
        </div>
      </Section>
    </>
  );
}

/* ================================================================== */
/* ADVANCED MODE                                                       */
/* ================================================================== */

function AdvancedMode({
  weather, update, updateWind, hasChanges,
}: {
  weather: WeatherState;
  update: (p: Partial<WeatherState>) => void;
  updateWind: (layer: 'atGround' | 'at2000' | 'at8000', field: 'speed' | 'dir', value: number) => void;
  hasChanges: boolean;
}) {
  return (
    <>
      {/* Weather summary card */}
      <WeatherSummary weather={weather} />

      {/* Quick presets row */}
      <Section title="Quick Presets" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {QUICK_PRESETS.map((preset) => (
            <button key={preset.label} onClick={() => update(preset.values)} style={presetBtnStyle}>
              {preset.icon} {preset.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Advanced scenario presets — categorized */}
      <Section title="Scenario Presets" changed={hasChanges}>
        {Object.entries(PRESET_CATEGORIES).map(([catId, catMeta]) => {
          const presets = ADVANCED_PRESETS.filter((p) => p.category === catId);
          if (presets.length === 0) return null;
          return (
            <div key={catId} style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: catMeta.color,
                textTransform: 'uppercase', letterSpacing: 0.8,
                marginBottom: 6, paddingBottom: 4,
                borderBottom: `1px solid ${catMeta.color}30`,
              }}>{catMeta.label}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => update(preset.values)}
                    title={preset.description}
                    style={{
                      background: '#0a1218',
                      border: `1px solid ${catMeta.color}30`,
                      borderRadius: 6,
                      color: '#8fa8c0',
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: '6px 12px',
                      fontFamily: 'inherit',
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{preset.icon}</span>
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      {/* Wind section with wind rose */}
      <Section title="Wind" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <WindRose speed={weather.wind.atGround.speed} dir={weather.wind.atGround.dir} />
          {([
            ['atGround', 'Ground'],
            ['at2000', '2,000m / 6,600 ft'],
            ['at8000', '8,000m / 26,000 ft'],
          ] as const).map(([layer, label]) => (
            <div key={layer} style={cardStyle}>
              <div style={{ fontSize: 13, color: '#8fa8c0', fontWeight: 600, marginBottom: 8 }}>{label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={fieldLabelStyle}>
                  Speed (m/s)
                  <input type="number" value={weather.wind[layer].speed}
                    onChange={(e) => updateWind(layer, 'speed', Number(e.target.value))}
                    style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} min={0} max={50} />
                </label>
                <label style={fieldLabelStyle}>
                  Direction (deg)
                  <input type="number" value={weather.wind[layer].dir}
                    onChange={(e) => updateWind(layer, 'dir', Number(e.target.value))}
                    style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} min={0} max={359} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Crosswind calculator */}
      <Section title="Crosswind Calculator" changed={hasChanges}>
        <CrosswindCalculator weather={weather} />
      </Section>

      {/* Clouds */}
      <Section title="Clouds" changed={hasChanges}>
        <div style={{ marginBottom: 10 }}>
          <label style={{ ...fieldLabelStyle, marginBottom: 4 }}>DCS Cloud Preset</label>
          <select value={weather.clouds_preset} onChange={(e) => update({ clouds_preset: e.target.value })} style={selectStyle}>
            {DCS_CLOUD_PRESETS.map((cp) => (
              <option key={cp.id} value={cp.id}>{cp.label} — {cp.description}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <label style={fieldLabelStyle}>
            Base (m)
            <input type="number" value={weather.clouds_base_m}
              onChange={(e) => update({ clouds_base_m: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} min={0} />
          </label>
          <label style={fieldLabelStyle}>
            Density (0-10)
            <input type="number" value={weather.clouds_density}
              onChange={(e) => update({ clouds_density: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} min={0} max={10} />
          </label>
          <label style={fieldLabelStyle}>
            Thickness (m)
            <input type="number" value={weather.clouds_thickness}
              onChange={(e) => update({ clouds_thickness: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} min={0} />
          </label>
          <label style={{ ...fieldLabelStyle, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}>
            <input type="checkbox" checked={weather.clouds_precipitation > 0}
              onChange={(e) => update({ clouds_precipitation: e.target.checked ? 1 : 0 })} />
            Precipitation
          </label>
        </div>
      </Section>

      {/* Fog */}
      <Section title="Fog" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <label style={{ ...fieldLabelStyle, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input type="checkbox" checked={weather.fog_enabled}
              onChange={(e) => update({ fog_enabled: e.target.checked })} />
            Enable Fog
          </label>
          {weather.fog_enabled && (
            <>
              <label style={fieldLabelStyle}>
                Visibility (m)
                <input type="number" value={weather.fog_visibility}
                  onChange={(e) => update({ fog_visibility: Number(e.target.value) })}
                  style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} min={0} />
              </label>
              <label style={fieldLabelStyle}>
                Thickness (m)
                <input type="number" value={weather.fog_thickness}
                  onChange={(e) => update({ fog_thickness: Number(e.target.value) })}
                  style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} min={0} />
              </label>
            </>
          )}
        </div>
      </Section>

      {/* Dust */}
      <Section title="Dust" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <label style={{ ...fieldLabelStyle, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input type="checkbox" checked={weather.dust_enabled}
              onChange={(e) => update({ dust_enabled: e.target.checked })} />
            Enable Dust
          </label>
          {weather.dust_enabled && (
            <label style={fieldLabelStyle}>
              Dust Density
              <input type="number" value={weather.dust_density}
                onChange={(e) => update({ dust_density: Number(e.target.value) })}
                style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} min={0} />
            </label>
          )}
        </div>
      </Section>

      {/* General + QNH display */}
      <Section title="General" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={fieldLabelStyle}>
            Temperature (C)
            <input type="number" value={weather.temperature_c}
              onChange={(e) => update({ temperature_c: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} />
          </label>
          <label style={fieldLabelStyle}>
            QNH (mmHg)
            <input type="number" value={weather.qnh_mmhg}
              onChange={(e) => update({ qnh_mmhg: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} />
          </label>
          <label style={fieldLabelStyle}>
            Visibility (m)
            <input type="number" value={weather.visibility_m} min={0}
              onChange={(e) => update({ visibility_m: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} />
          </label>
          <label style={fieldLabelStyle}>
            Ground Turbulence
            <input type="number" value={weather.ground_turbulence} min={0}
              onChange={(e) => update({ ground_turbulence: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} />
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <QnhDisplay mmhg={weather.qnh_mmhg} />
        </div>
      </Section>

      {/* Density Altitude */}
      <Section title="Density Altitude" changed={hasChanges}>
        <DensityAltitude weather={weather} />
      </Section>

      {/* Date/Time with quick buttons */}
      <Section title="Date / Time" changed={hasChanges}>
        <TimeOfDayButtons current={weather.start_time} onSelect={(s) => update({ start_time: s })} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={fieldLabelStyle}>
            Day
            <input type="number" value={weather.day} min={1} max={31}
              onChange={(e) => update({ day: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} />
          </label>
          <label style={fieldLabelStyle}>
            Month
            <input type="number" value={weather.month} min={1} max={12}
              onChange={(e) => update({ month: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} />
          </label>
          <label style={fieldLabelStyle}>
            Year
            <input type="number" value={weather.year}
              onChange={(e) => update({ year: Number(e.target.value) })}
              style={{ ...numInputStyle, ...(hasChanges ? changedBorder : {}) }} />
          </label>
          <label style={fieldLabelStyle}>
            Start Time
            <input type="text" value={formatTime(weather.start_time)} placeholder="HH:MM"
              onChange={(e) => update({ start_time: parseTime(e.target.value) })}
              style={{ ...numInputStyle, width: 80, fontFamily: 'monospace', ...(hasChanges ? changedBorder : {}) }} />
          </label>
        </div>
      </Section>

    </>
  );
}

/* ================================================================== */
/* Shared UI                                                           */
/* ================================================================== */

function Section({ title, changed, children }: { title: string; changed: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 20,
      border: '1px solid #1a2a3a',
      borderRadius: 4,
      background: '#0a1520',
    }}>
      <div style={{
        padding: '8px 14px',
        borderBottom: '1px solid #1a2a3a',
        fontSize: 14,
        fontWeight: 600,
        color: '#8fa8c0',
      }}>
        {title}
      </div>
      <div style={{ padding: '12px 14px' }}>
        {children}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Weather Summary Card — METAR-style readout                          */
/* ================================================================== */

function weatherSummaryText(w: WeatherState): string {
  const parts: string[] = [];

  // Wind
  const gnd = w.wind.atGround;
  if (gnd.speed > 0) {
    parts.push(`Wind ${String(Math.round(gnd.dir)).padStart(3, '0')}/${Math.round(gnd.speed * 1.944)}kts`);
  } else {
    parts.push('Wind calm');
  }

  // Visibility
  if (w.visibility_m >= 9999) parts.push('Vis >10km');
  else if (w.visibility_m >= 1000) parts.push(`Vis ${(w.visibility_m / 1000).toFixed(1)}km`);
  else parts.push(`Vis ${w.visibility_m}m`);

  // Clouds
  if (w.clouds_preset) {
    const cp = DCS_CLOUD_PRESETS.find((p) => p.id === w.clouds_preset);
    if (cp) parts.push(cp.label);
  } else if (w.clouds_density > 0) {
    const cov = w.clouds_density <= 2 ? 'FEW' : w.clouds_density <= 4 ? 'SCT' : w.clouds_density <= 7 ? 'BKN' : 'OVC';
    parts.push(`${cov} ${Math.round(w.clouds_base_m * 3.281 / 100).toString().padStart(3, '0')}`);
  } else {
    parts.push('SKC');
  }

  // Precip
  if (w.clouds_precipitation === 1) parts.push('RA');
  else if (w.clouds_precipitation === 2) parts.push(w.temperature_c <= 0 ? 'SN' : 'TSRA');

  // Temp
  const t = Math.round(w.temperature_c);
  parts.push(`${t < 0 ? 'M' : ''}${String(Math.abs(t)).padStart(2, '0')}C`);

  // QNH
  const hpa = Math.round(w.qnh_mmhg * 1.33322);
  parts.push(`Q${hpa}`);

  // Fog
  if (w.fog_enabled) parts.push('FG');
  // Dust
  if (w.dust_enabled) parts.push('DU');

  return parts.join(' ');
}

function flightConditionLabel(w: WeatherState): { label: string; color: string } {
  const ceilFt = w.clouds_density >= 5 ? w.clouds_base_m * 3.281 : 99999;
  const visM = w.fog_enabled ? Math.min(w.visibility_m, w.fog_visibility) : w.visibility_m;
  const visSM = visM / 1609.34;

  if (ceilFt < 500 || visSM < 1) return { label: 'LIFR', color: '#d95050' };
  if (ceilFt < 1000 || visSM < 3) return { label: 'IFR', color: '#d97050' };
  if (ceilFt < 3000 || visSM < 5) return { label: 'MVFR', color: '#d29922' };
  return { label: 'VFR', color: '#60c080' };
}

function WeatherSummary({ weather }: { weather: WeatherState }) {
  const metar = weatherSummaryText(weather);
  const fc = flightConditionLabel(weather);
  const windKts = Math.round(weather.wind.atGround.speed * 1.944);
  const visSM = (weather.visibility_m / 1609.34).toFixed(1);
  const ceilFt = weather.clouds_density >= 5
    ? Math.round(weather.clouds_base_m * 3.281)
    : null;

  return (
    <div style={{
      background: '#080f1c', border: '1px solid #1a2a3a', borderRadius: 6,
      padding: '12px 16px', marginBottom: 16,
      display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
    }}>
      {/* Flight condition badge */}
      <div style={{
        background: `${fc.color}20`, border: `2px solid ${fc.color}`,
        borderRadius: 6, padding: '6px 14px', textAlign: 'center',
        minWidth: 60,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: fc.color }}>{fc.label}</div>
        <div style={{ fontSize: 10, color: '#5a7a8a', marginTop: 2 }}>Flight Rules</div>
      </div>

      {/* Key stats */}
      <div style={{ display: 'flex', gap: 20, flex: 1, flexWrap: 'wrap' }}>
        <StatChip label="Wind" value={windKts > 0 ? `${String(Math.round(weather.wind.atGround.dir)).padStart(3, '0')}/${windKts}kt` : 'Calm'} />
        <StatChip label="Vis" value={`${visSM} SM`} />
        {ceilFt !== null && <StatChip label="Ceiling" value={`${ceilFt} ft`} />}
        <StatChip label="Temp" value={`${Math.round(weather.temperature_c)}C`} />
        <StatChip label="QNH" value={`${Math.round(weather.qnh_mmhg * 1.33322)} hPa`} />
        {weather.fog_enabled && <StatChip label="Fog" value={`${weather.fog_visibility}m`} warn />}
        {weather.dust_enabled && <StatChip label="Dust" value="Active" warn />}
      </div>

      {/* METAR string */}
      <div style={{
        fontFamily: 'monospace', fontSize: 12, color: '#6a8a9a',
        background: '#0a1218', padding: '6px 10px', borderRadius: 4,
        border: '1px solid #12202e', width: '100%', letterSpacing: 0.5,
      }}>
        {metar}
      </div>
    </div>
  );
}

function StatChip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: warn ? '#d29922' : '#ccdae8' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#5a7a8a', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

/* ================================================================== */
/* Time-of-Day Quick Buttons                                           */
/* ================================================================== */

const TIME_PRESETS: { label: string; icon: string; seconds: number }[] = [
  { label: 'Dawn',      icon: '\uD83C\uDF05', seconds: 5 * 3600 + 30 * 60 },
  { label: 'Morning',   icon: '\uD83C\uDF04', seconds: 8 * 3600 },
  { label: 'Noon',      icon: '\u2600\uFE0F', seconds: 12 * 3600 },
  { label: 'Afternoon', icon: '\uD83C\uDF24\uFE0F', seconds: 15 * 3600 },
  { label: 'Dusk',      icon: '\uD83C\uDF07', seconds: 18 * 3600 + 30 * 60 },
  { label: 'Night',     icon: '\uD83C\uDF19', seconds: 22 * 3600 },
  { label: 'Midnight',  icon: '\uD83C\uDF11', seconds: 0 },
  { label: 'Pre-Dawn',  icon: '\uD83C\uDF03', seconds: 3 * 3600 + 30 * 60 },
];

function TimeOfDayButtons({ current, onSelect }: { current: number; onSelect: (s: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
      {TIME_PRESETS.map((tp) => {
        const active = Math.abs(current - tp.seconds) < 1800;
        return (
          <button
            key={tp.label}
            onClick={() => onSelect(tp.seconds)}
            style={{
              background: active ? 'rgba(74, 143, 212, 0.15)' : '#0a1218',
              border: `1px solid ${active ? 'rgba(74, 143, 212, 0.4)' : '#1a2a3a'}`,
              borderRadius: 12, color: active ? '#4a8fd4' : '#6a8a9a',
              cursor: 'pointer', fontSize: 11, padding: '4px 10px',
              fontWeight: active ? 600 : 400, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span style={{ fontSize: 14 }}>{tp.icon}</span> {tp.label}
          </button>
        );
      })}
    </div>
  );
}

/* ================================================================== */
/* Wind Rose Visualization                                             */
/* ================================================================== */

function WindRose({ speed, dir }: { speed: number; dir: number }) {
  const size = 80;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const kts = Math.round(speed * 1.944);

  // Arrow pointing in wind direction (FROM)
  const rad = ((dir - 90) * Math.PI) / 180;
  const tipX = cx + r * 0.85 * Math.cos(rad);
  const tipY = cy + r * 0.85 * Math.sin(rad);
  const tailX = cx - r * 0.5 * Math.cos(rad);
  const tailY = cy - r * 0.5 * Math.sin(rad);

  // Arrowhead
  const headLen = 8;
  const headAng = 0.4;
  const lx = tipX - headLen * Math.cos(rad - headAng);
  const ly = tipY - headLen * Math.sin(rad - headAng);
  const rx = tipX - headLen * Math.cos(rad + headAng);
  const ry = tipY - headLen * Math.sin(rad + headAng);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Compass ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a2a3a" strokeWidth={1.5} />
        {/* Cardinal labels */}
        {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([lbl, deg]) => {
          const a = ((Number(deg) - 90) * Math.PI) / 180;
          return (
            <text key={lbl as string} x={cx + (r + 7) * Math.cos(a)} y={cy + (r + 7) * Math.sin(a)}
              fill="#5a7a8a" fontSize={8} fontWeight={600} textAnchor="middle" dominantBaseline="central">
              {lbl as string}
            </text>
          );
        })}
        {/* Tick marks */}
        {Array.from({ length: 36 }, (_, i) => i * 10).map((d) => {
          const a = ((d - 90) * Math.PI) / 180;
          const inner = d % 90 === 0 ? r - 6 : d % 30 === 0 ? r - 4 : r - 2;
          return (
            <line key={d} x1={cx + inner * Math.cos(a)} y1={cy + inner * Math.sin(a)}
              x2={cx + r * Math.cos(a)} y2={cy + r * Math.sin(a)}
              stroke="#2a3a4a" strokeWidth={d % 90 === 0 ? 1.5 : 0.5} />
          );
        })}
        {/* Wind arrow */}
        {kts > 0 && (
          <>
            <line x1={tailX} y1={tailY} x2={tipX} y2={tipY} stroke="#4a8fd4" strokeWidth={2} />
            <polygon points={`${tipX},${tipY} ${lx},${ly} ${rx},${ry}`} fill="#4a8fd4" />
          </>
        )}
        {/* Center dot */}
        <circle cx={cx} cy={cy} r={2} fill="#5a7a8a" />
      </svg>
      <div style={{ fontSize: 11, color: '#8fa8c0', marginTop: 2, fontFamily: 'monospace' }}>
        {kts > 0 ? `${String(Math.round(dir)).padStart(3, '0')}/${kts}kt` : 'Calm'}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Crosswind Calculator                                                */
/* ================================================================== */

function CrosswindCalculator({ weather }: { weather: WeatherState }) {
  const [runwayHdg, setRunwayHdg] = useState(0);

  const windDir = weather.wind.atGround.dir;
  const windSpd = weather.wind.atGround.speed * 1.944; // kts
  const diff = ((windDir - runwayHdg + 540) % 360) - 180;
  const diffRad = (diff * Math.PI) / 180;
  const headwind = Math.round(windSpd * Math.cos(diffRad));
  const crosswind = Math.round(Math.abs(windSpd * Math.sin(diffRad)));
  const crossDir = Math.sin(diffRad) > 0 ? 'R' : Math.sin(diffRad) < 0 ? 'L' : '';

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={fieldLabelStyle}>
        Runway Heading
        <input
          type="number" value={runwayHdg} min={0} max={360} step={10}
          onChange={(e) => setRunwayHdg(Number(e.target.value) % 360)}
          style={{ ...numInputStyle, width: 70 }}
        />
      </label>
      <div style={{
        display: 'flex', gap: 20, padding: '8px 16px',
        background: '#0a1218', borderRadius: 6, border: '1px solid #12202e',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 18, fontWeight: 700,
            color: headwind >= 0 ? '#60c080' : '#d95050',
          }}>
            {Math.abs(headwind)} kt
          </div>
          <div style={{ fontSize: 10, color: '#5a7a8a', textTransform: 'uppercase' }}>
            {headwind >= 0 ? 'Headwind' : 'Tailwind'}
          </div>
        </div>
        <div style={{ width: 1, background: '#1a2a3a' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: crosswind > 15 ? '#d95050' : crosswind > 10 ? '#d29922' : '#ccdae8' }}>
            {crosswind} kt {crossDir}
          </div>
          <div style={{ fontSize: 10, color: '#5a7a8a', textTransform: 'uppercase' }}>Crosswind</div>
        </div>
      </div>
      {crosswind > 25 && (
        <div style={{ fontSize: 11, color: '#d95050', fontWeight: 600 }}>
          Exceeds limits for most aircraft
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* QNH Unit Converter                                                  */
/* ================================================================== */

function QnhDisplay({ mmhg }: { mmhg: number }) {
  const inhg = (mmhg * 0.03937).toFixed(2);
  const hpa = Math.round(mmhg * 1.33322);
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '6px 12px',
      background: '#0a1218', borderRadius: 4, border: '1px solid #12202e',
      fontSize: 13, fontFamily: 'monospace',
    }}>
      <span style={{ color: '#8fa8c0' }}>{mmhg} <span style={{ color: '#5a7a8a', fontSize: 10 }}>mmHg</span></span>
      <span style={{ color: '#1a2a3a' }}>|</span>
      <span style={{ color: '#8fa8c0' }}>{inhg} <span style={{ color: '#5a7a8a', fontSize: 10 }}>inHg</span></span>
      <span style={{ color: '#1a2a3a' }}>|</span>
      <span style={{ color: '#8fa8c0' }}>{hpa} <span style={{ color: '#5a7a8a', fontSize: 10 }}>hPa</span></span>
    </div>
  );
}

/* ================================================================== */
/* Density Altitude Calculator                                         */
/* ================================================================== */

function DensityAltitude({ weather, fieldElevFt }: { weather: WeatherState; fieldElevFt?: number }) {
  const [elevation, setElevation] = useState(fieldElevFt ?? 0);

  // Pressure altitude = field elev + (29.92 - altimeter setting in inHg) * 1000
  const inhg = weather.qnh_mmhg * 0.03937;
  const pressureAlt = elevation + (29.92 - inhg) * 1000;

  // Density altitude = pressure alt + (120 * (OAT - ISA temp at pressure alt))
  // ISA temp at alt: 15 - (2 * pressureAlt / 1000)
  const isaTemp = 15 - 2 * (pressureAlt / 1000);
  const densityAlt = Math.round(pressureAlt + 120 * (weather.temperature_c - isaTemp));

  const warning = densityAlt > 8000 ? '#d95050' : densityAlt > 5000 ? '#d29922' : '#60c080';

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={fieldLabelStyle}>
        Field Elev (ft)
        <input
          type="number" value={elevation} min={-1000} max={15000}
          onChange={(e) => setElevation(Number(e.target.value))}
          style={{ ...numInputStyle, width: 80 }}
        />
      </label>
      <div style={{
        display: 'flex', gap: 20, padding: '8px 16px',
        background: '#0a1218', borderRadius: 6, border: '1px solid #12202e',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#8fa8c0' }}>
            {Math.round(pressureAlt).toLocaleString()} ft
          </div>
          <div style={{ fontSize: 10, color: '#5a7a8a', textTransform: 'uppercase' }}>Pressure Alt</div>
        </div>
        <div style={{ width: 1, background: '#1a2a3a' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: warning }}>
            {densityAlt.toLocaleString()} ft
          </div>
          <div style={{ fontSize: 10, color: '#5a7a8a', textTransform: 'uppercase' }}>Density Alt</div>
        </div>
        <div style={{ width: 1, background: '#1a2a3a' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#8fa8c0' }}>
            {isaTemp.toFixed(1)}C
          </div>
          <div style={{ fontSize: 10, color: '#5a7a8a', textTransform: 'uppercase' }}>ISA Temp</div>
        </div>
      </div>
      {densityAlt > 8000 && (
        <div style={{ fontSize: 11, color: '#d95050', fontWeight: 600 }}>
          High DA — degraded performance
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* ATIS-style Readback                                                 */
/* ================================================================== */

function AtisReadback({ weather }: { weather: WeatherState }) {
  const letters = 'ALPHA BRAVO CHARLIE DELTA ECHO FOXTROT GOLF HOTEL INDIA JULIET KILO LIMA MIKE NOVEMBER OSCAR PAPA QUEBEC ROMEO SIERRA TANGO UNIFORM VICTOR WHISKEY XRAY YANKEE ZULU'.split(' ');
  // Use hour as info letter index
  const hr = Math.floor(weather.start_time / 3600);
  const infoLetter = letters[hr % 26];

  const windKts = Math.round(weather.wind.atGround.speed * 1.944);
  const windDir = String(Math.round(weather.wind.atGround.dir)).padStart(3, '0');
  const visSM = weather.visibility_m / 1609.34;
  const hpa = Math.round(weather.qnh_mmhg * 1.33322);
  const inhg = (weather.qnh_mmhg * 0.03937).toFixed(2);
  const temp = Math.round(weather.temperature_c);
  const dewpoint = Math.round(weather.temperature_c - (weather.fog_enabled ? 1 : 8));
  const timeStr = formatTime(weather.start_time);

  let sky = '';
  if (weather.clouds_preset) {
    const cp = DCS_CLOUD_PRESETS.find((p) => p.id === weather.clouds_preset);
    if (cp) sky = cp.description;
  } else if (weather.clouds_density > 0) {
    const cov = weather.clouds_density <= 2 ? 'Few' : weather.clouds_density <= 4 ? 'Scattered' : weather.clouds_density <= 7 ? 'Broken' : 'Overcast';
    sky = `${cov} at ${Math.round(weather.clouds_base_m * 3.281).toLocaleString()} feet`;
  } else {
    sky = 'Sky clear';
  }

  const precip = weather.clouds_precipitation === 1 ? ' Rain in the area.' : weather.clouds_precipitation === 2 ? ' Thunderstorm activity in the area.' : '';
  const fogNote = weather.fog_enabled ? ` Fog, visibility ${weather.fog_visibility} meters.` : '';
  const dustNote = weather.dust_enabled ? ' Dust and sand in the vicinity.' : '';
  const turbNote = weather.ground_turbulence > 50 ? ' Caution: moderate to severe turbulence below 5,000 feet.' : weather.ground_turbulence > 25 ? ' Light to moderate turbulence below 3,000 feet.' : '';

  const atis = `Information ${infoLetter}, ${timeStr} Zulu. Wind ${windDir} at ${windKts} knots. Visibility ${visSM >= 10 ? 'greater than 10' : visSM.toFixed(1)} statute miles. ${sky}.${precip}${fogNote}${dustNote} Temperature ${temp}, dewpoint ${dewpoint}. Altimeter ${inhg}, QNH ${hpa}.${turbNote} Advise on initial contact you have information ${infoLetter}.`;

  return (
    <div style={{
      fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
      color: '#8fa8c0', background: '#0a1218',
      padding: '10px 14px', borderRadius: 6,
      border: '1px solid #12202e', whiteSpace: 'pre-wrap',
    }}>
      <div style={{ fontSize: 10, color: '#5a7a8a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontWeight: 700 }}>
        ATIS Information {infoLetter}
      </div>
      {atis}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const changedBorder = { borderLeft: '3px solid #3fb950' };

const presetBtnStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#8fa8c0',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 12px',
  fontFamily: 'inherit',
  transition: 'all 0.15s',
};

const cardStyle: React.CSSProperties = {
  background: '#080f1c',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  padding: 12,
  minWidth: 140,
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: '#5a7a8a',
  fontWeight: 600,
};

const numInputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontSize: 14,
  padding: '4px 6px',
  width: 90,
  outline: 'none',
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontSize: 13,
  padding: '6px 8px',
  width: '100%',
  maxWidth: 500,
  outline: 'none',
  fontFamily: 'inherit',
};
