import { useMissionStore } from '../../store/missionStore';
import { useMapStore, type SpeedMode } from '../../store/mapStore';
import { formatTime, metersToFeet } from '../../utils/conversions';
import { formatWind } from '../../utils/atmosphere';

const SPEED_MODES: { id: SpeedMode; label: string }[] = [
  { id: 'gs', label: 'GS' },
  { id: 'cas', label: 'CAS' },
  { id: 'tas', label: 'TAS' },
  { id: 'mach', label: 'M' },
];

export function WeatherPanel() {
  const overview = useMissionStore((s) => s.overview);
  const { speedMode, setSpeedMode } = useMapStore();

  if (!overview?.weather) return null;
  const wx = overview.weather;
  const windGnd = wx.wind.atGround;

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'rgba(10, 20, 35, 0.92)',
        borderRadius: 6,
        padding: '10px 14px',
        zIndex: 100,
        fontSize: 12,
        color: '#ccdae8',
        minWidth: 170,
      }}
    >
      {/* Mission time */}
      <div style={{ marginBottom: 6, borderBottom: '1px solid #1a2a3a', paddingBottom: 6 }}>
        <div style={{ fontSize: 11, color: '#5a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
          Mission
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
          {overview.date} {formatTime(overview.start_time)}L
        </div>
      </div>

      {/* Weather */}
      <div style={{ marginBottom: 6, borderBottom: '1px solid #1a2a3a', paddingBottom: 6 }}>
        <div style={{ fontSize: 11, color: '#5a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
          Weather
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 12, fontFamily: 'monospace' }}>
          <span style={{ color: '#5a7a8a' }}>QNH</span>
          <span>{wx.qnh_inhg} inHg / {wx.qnh_hpa} hPa</span>

          <span style={{ color: '#5a7a8a' }}>Temp</span>
          <span>{wx.temperature_c}°C / {Math.round(wx.temperature_c * 9/5 + 32)}°F</span>

          <span style={{ color: '#5a7a8a' }}>Wind</span>
          <span>{formatWind(windGnd)}</span>

          <span style={{ color: '#5a7a8a' }}>@FL200</span>
          <span>{formatWind(wx.wind.at2000)}</span>

          <span style={{ color: '#5a7a8a' }}>@FL260</span>
          <span>{formatWind(wx.wind.at8000)}</span>

          <span style={{ color: '#5a7a8a' }}>Vis</span>
          <span>{wx.visibility_m >= 10000 ? `${(wx.visibility_m / 1000).toFixed(0)}km` : `${wx.visibility_m}m`}</span>

          {wx.clouds_base_m > 0 && (
            <>
              <span style={{ color: '#5a7a8a' }}>Clouds</span>
              <span>{Math.round(metersToFeet(wx.clouds_base_m))}ft</span>
            </>
          )}
        </div>
      </div>

      {/* Speed mode toggle */}
      <div>
        <div style={{ fontSize: 11, color: '#5a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
          Speed Display
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {SPEED_MODES.map((sm) => (
            <button
              key={sm.id}
              onClick={() => setSpeedMode(sm.id)}
              style={{
                flex: 1, padding: '4px 6px', fontSize: 11,
                background: speedMode === sm.id ? '#1a3a5a' : '#0f1a28',
                border: `1px solid ${speedMode === sm.id ? '#4a8fd4' : '#1a2a3a'}`,
                borderRadius: 3,
                color: speedMode === sm.id ? '#ccdae8' : '#5a7a8a',
                cursor: 'pointer', fontWeight: speedMode === sm.id ? 600 : 400,
              }}
            >
              {sm.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
