import { useState, useEffect, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore } from '../../store/editStore';
import type { MissionWeather } from '../../types/mission';

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
  clouds_precipitation: boolean;
  fog_enabled: boolean;
  fog_visibility: number;
  fog_thickness: number;
  visibility_m: number;
  ground_turbulence: number;
  day: number;
  month: number;
  year: number;
  start_time: number;
}

const PRESETS = [
  'Clear Sky',
  'Partly Cloudy',
  'Overcast',
  'Light Rain',
  'Heavy Storm',
  'Foggy',
  'Dust Storm',
];

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
    clouds_density: 0,
    clouds_thickness: 0,
    clouds_precipitation: false,
    fog_enabled: false,
    fog_visibility: 6000,
    fog_thickness: 0,
    visibility_m: weather.visibility_m,
    ground_turbulence: 0,
    day: d || 1,
    month: m || 6,
    year: y || 2024,
    start_time: startTime,
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

export function WeatherTab() {
  const overview = useMissionStore((s) => s.overview);
  const addEdit = useEditStore((s) => s.addEdit);

  const [weather, setWeather] = useState<WeatherState | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

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
      addEdit({ field: 'weather', value: next } as any);

      // Sync back to store so WeatherPanel on map view stays current
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
              visibility_m: next.visibility_m,
            },
            start_time: next.start_time,
          },
        });
      }

      return next;
    });
  }, [addEdit]);

  // Wind updates also sync to store (same pattern)
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
      addEdit({ field: 'weather', value: next } as any);

      // Sync wind changes to store too
      const { overview } = useMissionStore.getState();
      if (overview) {
        useMissionStore.setState({
          overview: {
            ...overview,
            weather: { ...overview.weather, wind: next.wind },
          },
        });
      }

      return next;
    });
  }, [addEdit]);

  if (!weather) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 14, padding: 20 }}>
        No weather data available for this mission.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#ccdae8' }}>
          Weather Editor
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5a7a8a' }}>
          Configure weather conditions, wind layers, clouds, fog, and mission date/time.
        </p>
      </div>

      {/* Preset buttons */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#5a7a8a', marginBottom: 6, fontWeight: 600 }}>Presets</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => update({ clouds_base_m: weather.clouds_base_m })}
              style={presetBtnStyle}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Wind section */}
      <Section title="Wind" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {([
            ['atGround', 'Ground'],
            ['at2000', '2000m'],
            ['at8000', '8000m'],
          ] as const).map(([layer, label]) => (
            <div key={layer} style={cardStyle}>
              <div style={{ fontSize: 12, color: '#8fa8c0', fontWeight: 600, marginBottom: 8 }}>{label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={fieldLabelStyle}>
                  Speed (m/s)
                  <input
                    type="number"
                    value={weather.wind[layer].speed}
                    onChange={(e) => updateWind(layer, 'speed', Number(e.target.value))}
                    style={{
                      ...numInputStyle,
                      ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
                    }}
                    min={0}
                    max={50}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Direction (deg)
                  <input
                    type="number"
                    value={weather.wind[layer].dir}
                    onChange={(e) => updateWind(layer, 'dir', Number(e.target.value))}
                    style={{
                      ...numInputStyle,
                      ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
                    }}
                    min={0}
                    max={359}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Clouds section */}
      <Section title="Clouds" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <label style={fieldLabelStyle}>
            Base (m)
            <input
              type="number"
              value={weather.clouds_base_m}
              onChange={(e) => update({ clouds_base_m: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
              min={0}
            />
          </label>
          <label style={fieldLabelStyle}>
            Density (0-10)
            <input
              type="number"
              value={weather.clouds_density}
              onChange={(e) => update({ clouds_density: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
              min={0}
              max={10}
            />
          </label>
          <label style={fieldLabelStyle}>
            Thickness (m)
            <input
              type="number"
              value={weather.clouds_thickness}
              onChange={(e) => update({ clouds_thickness: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
              min={0}
            />
          </label>
          <label style={{ ...fieldLabelStyle, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}>
            <input
              type="checkbox"
              checked={weather.clouds_precipitation}
              onChange={(e) => update({ clouds_precipitation: e.target.checked })}
            />
            Precipitation
          </label>
        </div>
      </Section>

      {/* Fog section */}
      <Section title="Fog" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <label style={{ ...fieldLabelStyle, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input
              type="checkbox"
              checked={weather.fog_enabled}
              onChange={(e) => update({ fog_enabled: e.target.checked })}
            />
            Enable Fog
          </label>
          {weather.fog_enabled && (
            <>
              <label style={fieldLabelStyle}>
                Visibility (m)
                <input
                  type="number"
                  value={weather.fog_visibility}
                  onChange={(e) => update({ fog_visibility: Number(e.target.value) })}
                  style={{
                    ...numInputStyle,
                    ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
                  }}
                  min={0}
                />
              </label>
              <label style={fieldLabelStyle}>
                Thickness (m)
                <input
                  type="number"
                  value={weather.fog_thickness}
                  onChange={(e) => update({ fog_thickness: Number(e.target.value) })}
                  style={{
                    ...numInputStyle,
                    ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
                  }}
                  min={0}
                />
              </label>
            </>
          )}
        </div>
      </Section>

      {/* General section */}
      <Section title="General" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={fieldLabelStyle}>
            Temperature (C)
            <input
              type="number"
              value={weather.temperature_c}
              onChange={(e) => update({ temperature_c: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
            />
          </label>
          <label style={fieldLabelStyle}>
            QNH (mmHg)
            <input
              type="number"
              value={weather.qnh_mmhg}
              onChange={(e) => update({ qnh_mmhg: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
            />
          </label>
          <label style={fieldLabelStyle}>
            Visibility (m)
            <input
              type="number"
              value={weather.visibility_m}
              onChange={(e) => update({ visibility_m: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
              min={0}
            />
          </label>
          <label style={fieldLabelStyle}>
            Ground Turbulence
            <input
              type="number"
              value={weather.ground_turbulence}
              onChange={(e) => update({ ground_turbulence: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
              min={0}
            />
          </label>
        </div>
      </Section>

      {/* Date/Time section */}
      <Section title="Date / Time" changed={hasChanges}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={fieldLabelStyle}>
            Day
            <input
              type="number"
              value={weather.day}
              onChange={(e) => update({ day: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
              min={1}
              max={31}
            />
          </label>
          <label style={fieldLabelStyle}>
            Month
            <input
              type="number"
              value={weather.month}
              onChange={(e) => update({ month: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
              min={1}
              max={12}
            />
          </label>
          <label style={fieldLabelStyle}>
            Year
            <input
              type="number"
              value={weather.year}
              onChange={(e) => update({ year: Number(e.target.value) })}
              style={{
                ...numInputStyle,
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
            />
          </label>
          <label style={fieldLabelStyle}>
            Start Time
            <input
              type="text"
              value={formatTime(weather.start_time)}
              onChange={(e) => update({ start_time: parseTime(e.target.value) })}
              placeholder="HH:MM"
              style={{
                ...numInputStyle,
                width: 80,
                fontFamily: 'monospace',
                ...(hasChanges ? { borderLeft: '3px solid #3fb950' } : {}),
              }}
            />
          </label>
        </div>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

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
        fontSize: 13,
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
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const presetBtnStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  color: '#8fa8c0',
  cursor: 'pointer',
  fontSize: 12,
  padding: '6px 12px',
  fontFamily: 'inherit',
  transition: 'background 0.15s',
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
  fontSize: 11,
  color: '#5a7a8a',
  fontWeight: 600,
};

const numInputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontSize: 13,
  padding: '4px 6px',
  width: 90,
  outline: 'none',
  fontFamily: 'inherit',
};
