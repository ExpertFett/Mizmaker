/**
 * Canonical DCS cloud-preset → coverage/precip mapping.
 *
 * DCS 2.7+ replaced the free 0-10 density slider with named cloud PRESETS, and
 * each preset has a FIXED coverage and precipitation baked in. The mission's
 * separate `clouds_density` / `clouds_precipitation` fields are unreliable when
 * a preset is set (they're often left at 0), so the preset name is the source
 * of truth.
 *
 * This replaces the old "parse the digits out of the preset name" heuristic
 * that lived (duplicated) in metar.ts and MetarReadout.tsx — that mapped e.g.
 * `RainyPreset1` → "1" → FEW with no rain, when it's actually a rainy OVERCAST.
 * One table, used by the METAR generator, the Current Weather page, and the
 * kneeboard weather card.
 */

export type CloudCategory = 'CLR' | 'FEW' | 'SCT' | 'BKN' | 'OVC';

export interface ResolvedClouds {
  cat: CloudCategory;
  rain: boolean;
  storm: boolean;
  /** Human-readable coverage label for the weather brief card. */
  label: string;
}

interface PresetDef {
  cat: CloudCategory;
  rain?: boolean;
  storm?: boolean;
  label: string;
}

export const CLOUD_PRESETS: Record<string, PresetDef> = {
  Preset1: { cat: 'FEW', label: 'Light Scattered 1' },
  Preset2: { cat: 'FEW', label: 'Light Scattered 2' },
  Preset3: { cat: 'FEW', label: 'High Scattered 1' },
  Preset4: { cat: 'FEW', label: 'High Scattered 2' },
  Preset5: { cat: 'SCT', label: 'Scattered 1' },
  Preset6: { cat: 'SCT', label: 'Scattered 2' },
  Preset7: { cat: 'SCT', label: 'Scattered 3' },
  Preset8: { cat: 'SCT', label: 'High Scattered 3' },
  Preset9: { cat: 'SCT', label: 'Scattered 4' },
  Preset10: { cat: 'BKN', label: 'Broken 1' },
  Preset11: { cat: 'BKN', label: 'Broken 2' },
  Preset12: { cat: 'BKN', label: 'Broken 3' },
  Preset13: { cat: 'BKN', label: 'Broken 4' },
  Preset14: { cat: 'BKN', label: 'Broken 5' },
  Preset15: { cat: 'BKN', label: 'Broken 6' },
  Preset16: { cat: 'BKN', label: 'Broken 7' },
  Preset17: { cat: 'BKN', rain: true, label: 'Broken 8 (Rain)' },
  Preset18: { cat: 'OVC', label: 'Overcast 1' },
  Preset19: { cat: 'OVC', label: 'Overcast 2' },
  Preset20: { cat: 'OVC', label: 'Overcast 3' },
  Preset21: { cat: 'OVC', rain: true, label: 'Overcast 4 (Rain)' },
  Preset22: { cat: 'OVC', rain: true, label: 'Overcast 5 (Rain)' },
  Preset23: { cat: 'OVC', rain: true, label: 'Overcast 6 (Rain)' },
  Preset24: { cat: 'OVC', rain: true, label: 'Overcast 7 (Rain)' },
  Preset25: { cat: 'OVC', rain: true, label: 'Overcast 8 (Rain)' },
  Preset26: { cat: 'OVC', rain: true, storm: true, label: 'Overcast 9 (Storm)' },
  Preset27: { cat: 'OVC', rain: true, storm: true, label: 'Overcast 10 (Storm)' },
  RainyPreset1: { cat: 'OVC', rain: true, label: 'Overcast (Rain)' },
  RainyPreset2: { cat: 'OVC', rain: true, label: 'Overcast (Rain Heavy)' },
  RainyPreset3: { cat: 'OVC', rain: true, storm: true, label: 'Overcast (Storm)' },
};

/**
 * Resolve a mission's cloud state to a coverage category + precipitation.
 * Prefers the named preset (authoritative); falls back to the legacy 0-10
 * density scale only when no preset is set.
 */
export function resolveClouds(preset: string | undefined | null, density = 0): ResolvedClouds {
  const p = preset?.trim();
  if (p) {
    const known = CLOUD_PRESETS[p];
    if (known) return { cat: known.cat, rain: !!known.rain, storm: !!known.storm, label: known.label };
    // Unknown preset name (custom/modded) — don't fabricate coverage or rain.
    return { cat: 'SCT', rain: false, storm: false, label: p };
  }
  if (density <= 0) return { cat: 'CLR', rain: false, storm: false, label: 'Clear' };
  if (density <= 2) return { cat: 'FEW', rain: false, storm: false, label: `Few (${density}/10)` };
  if (density <= 4) return { cat: 'SCT', rain: false, storm: false, label: `Scattered (${density}/10)` };
  if (density <= 7) return { cat: 'BKN', rain: false, storm: false, label: `Broken (${density}/10)` };
  return { cat: 'OVC', rain: false, storm: false, label: `Overcast (${density}/10)` };
}
