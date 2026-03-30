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

      {/* Wind — simplified to ground only */}
      <Section title="Wind" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
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

      {/* Key settings */}
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
      </Section>

      {/* Date/Time */}
      <Section title="Date / Time" changed={hasChanges}>
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
      {/* Quick presets (also available in advanced) */}
      <Section title="Quick Presets" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {QUICK_PRESETS.map((preset) => (
            <button key={preset.label} onClick={() => update(preset.values)} style={presetBtnStyle}>
              {preset.icon} {preset.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Wind section */}
      <Section title="Wind" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
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

      {/* General */}
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
      </Section>

      {/* Date/Time */}
      <Section title="Date / Time" changed={hasChanges}>
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
      border: `1px solid ${changed ? '#3fb950' : '#1a2a3a'}`,
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
