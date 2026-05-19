import { useState, type RefObject } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useMapStore, type SpeedMode } from '../../store/mapStore';
import { formatTime, metersToFeet } from '../../utils/conversions';
import { formatWind } from '../../utils/atmosphere';
import { useDraggable } from './useDraggable';

const SPEED_MODES: { id: SpeedMode; label: string }[] = [
  { id: 'gs', label: 'GS' },
  { id: 'cas', label: 'CAS' },
  { id: 'tas', label: 'TAS' },
  { id: 'mach', label: 'M' },
];

export function WeatherPanel({
  coordRef,
}: {
  coordRef: RefObject<HTMLDivElement | null>;
}) {
  const overview = useMissionStore((s) => s.overview);
  const { speedMode, setSpeedMode } = useMapStore();
  const { containerRef, handleProps, resetPosition: _resetPosition } = useDraggable('weatherPanel');
  const [collapsed, setCollapsed] = useState(false);

  if (!overview?.weather) return null;
  const wx = overview.weather;
  const windGnd = wx.wind.atGround;

  return (
    <>
    {/* Collapsed tab — fixed position so it's always above OL canvas */}
    {collapsed && (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed',
          top: 10,
          right: 0,
          background: 'rgba(10, 20, 35, 0.95)',
          borderRadius: '6px 0 0 6px',
          padding: '10px 6px 10px 8px',
          zIndex: 10000,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
          border: '1px solid #4a5258',
          borderRight: 'none',
        }}
        title="Show mission info"
      >
        <span style={{ color: '#d49a30', fontSize: 12, fontWeight: 700 }}>◀</span>
        <span style={{
          writingMode: 'vertical-lr',
          color: '#3a4248', fontSize: 10, fontWeight: 600,
          letterSpacing: 1, textTransform: 'uppercase',
        }}>MISSION</span>
      </div>
    )}

    {/* Expanded panel */}
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: 'rgba(10, 20, 35, 0.92)',
        borderRadius: 6,
        padding: 0,
        zIndex: 1000,
        fontSize: 13,
        color: '#1a1f25',
        minWidth: 170,
        overflow: 'hidden',
        display: collapsed ? 'none' : 'block',
      }}
    >
      {/* Drag handle + collapse button */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'rgba(20, 40, 70, 0.4)',
        borderBottom: '1px solid rgba(26, 42, 58, 0.5)',
      }}>
        <div {...handleProps} style={{
          ...handleProps.style,
          flex: 1,
          padding: '4px 14px 2px',
          fontSize: 9, color: '#4a5258', textAlign: 'center', letterSpacing: 2,
          userSelect: 'none',
        }}>⠿</div>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: 'none', border: 'none', color: '#4a5258',
            cursor: 'pointer', fontSize: 11, padding: '3px 8px',
            lineHeight: 1,
          }}
          title="Hide panel"
        >▶</button>
      </div>
          <div style={{ padding: '8px 14px 10px' }}>
            {/* Mission time */}
            <div style={{ marginBottom: 6, borderBottom: '1px solid #4a5258', paddingBottom: 6 }}>
              <div style={{ fontSize: 12, color: '#3a4248', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                Mission
              </div>
              <div style={{ fontFamily: "'B612 Mono', monospace", fontSize: 14 }}>
                {overview.date} {formatTime(overview.start_time)}L
              </div>
            </div>

            {/* Weather */}
            <div style={{ marginBottom: 6, borderBottom: '1px solid #4a5258', paddingBottom: 6 }}>
              <div style={{ fontSize: 12, color: '#3a4248', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                Weather
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 13, fontFamily: "'B612 Mono', monospace" }}>
                <span style={{ color: '#3a4248' }}>QNH</span>
                <span>{wx.qnh_inhg} inHg / {wx.qnh_hpa} hPa</span>

                <span style={{ color: '#3a4248' }}>Temp</span>
                <span>{wx.temperature_c}°C / {Math.round(wx.temperature_c * 9/5 + 32)}°F</span>

                <span style={{ color: '#3a4248' }}>Wind</span>
                <span>{formatWind(windGnd)}</span>

                <span style={{ color: '#3a4248' }}>@FL200</span>
                <span>{formatWind(wx.wind.at2000)}</span>

                <span style={{ color: '#3a4248' }}>@FL260</span>
                <span>{formatWind(wx.wind.at8000)}</span>

                <span style={{ color: '#3a4248' }}>Vis</span>
                <span>{wx.visibility_m >= 10000 ? `${(wx.visibility_m / 1000).toFixed(0)}km` : `${wx.visibility_m}m`}</span>

                {wx.clouds_base_m > 0 && (
                  <>
                    <span style={{ color: '#3a4248' }}>Clouds</span>
                    <span>{Math.round(metersToFeet(wx.clouds_base_m))}ft{wx.clouds_preset ? ` (${wx.clouds_preset})` : ''}</span>
                  </>
                )}

                {wx.fog_enabled && (
                  <>
                    <span style={{ color: '#d29922' }}>Fog</span>
                    <span style={{ color: '#d29922' }}>{wx.fog_visibility || 'ON'}m</span>
                  </>
                )}

                {wx.dust_enabled && (
                  <>
                    <span style={{ color: '#d29922' }}>Dust</span>
                    <span style={{ color: '#d29922' }}>ON</span>
                  </>
                )}

                {(wx.turbulence ?? 0) > 0 && (
                  <>
                    <span style={{ color: '#3a4248' }}>Turb</span>
                    <span>{wx.turbulence}</span>
                  </>
                )}
              </div>
            </div>

            {/* Speed mode toggle */}
            <div style={{ marginBottom: 6, borderBottom: '1px solid #4a5258', paddingBottom: 6 }}>
              <div style={{ fontSize: 12, color: '#3a4248', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                Speed Display
              </div>
              <div style={{ display: 'flex', gap: 3 }}>
                {SPEED_MODES.map((sm) => (
                  <button
                    key={sm.id}
                    onClick={() => setSpeedMode(sm.id)}
                    style={{
                      flex: 1, padding: '4px 6px', fontSize: 12,
                      background: speedMode === sm.id ? '#4a5258' : '#6e7c83',
                      border: `1px solid ${speedMode === sm.id ? '#d49a30' : '#4a5258'}`,
                      borderRadius: 3,
                      color: speedMode === sm.id ? '#1a1f25' : '#3a4248',
                      cursor: 'pointer', fontWeight: speedMode === sm.id ? 600 : 400,
                    }}
                  >
                    {sm.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Cursor coordinates */}
            <div>
              <div style={{ fontSize: 12, color: '#3a4248', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                Cursor
              </div>
              <div
                ref={coordRef}
                style={{
                  color: '#1a1f25',
                  fontSize: 12,
                  fontFamily: "'B612 Mono', monospace",
                  lineHeight: 1.6,
                  minHeight: 20,
                }}
              />
            </div>
          </div>
    </div>
    </>
  );
}
