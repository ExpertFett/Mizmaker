import { useState, type RefObject } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useMapStore, type SpeedMode } from '../../store/mapStore';
import { formatTime, metersToFeet } from '../../utils/conversions';
import { formatWind } from '../../utils/atmosphere';
import { useDraggable } from './useDraggable';
import { ResizeGrip } from './ResizeGrip';

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
  const { containerRef, handleProps, resizeHandleProps, resetPosition: _resetPosition } = useDraggable('weatherPanel');
  // v1.19.110 — start collapsed so the map opens clean; the bright edge tab
  // invites a click to expand.
  const [collapsed, setCollapsed] = useState(true);

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
          // top:40 clears the 30px MissionDataStrip (was 10, which floated the
          // tab over the strip's "Discord" link). (v1.19.110)
          position: 'fixed',
          top: 40,
          right: 0,
          background: 'rgba(58, 110, 165, 0.96)',
          borderRadius: '8px 0 0 8px',
          padding: '12px 9px 12px 11px',
          zIndex: 10000,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
          border: '1px solid #7fb8ff',
          borderRight: 'none',
          boxShadow: '-2px 2px 10px rgba(0,0,0,0.45)',
        }}
        title="Show mission info"
      >
        <span style={{ color: '#ffffff', fontSize: 14, fontWeight: 800 }}>◀</span>
        <span style={{
          writingMode: 'vertical-lr',
          color: '#ffffff', fontSize: 11, fontWeight: 700,
          letterSpacing: 1.2, textTransform: 'uppercase',
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
        color: '#e0e0e0',
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
          fontSize: 9, color: '#4a4a4a', textAlign: 'center', letterSpacing: 2,
          userSelect: 'none',
        }}>⠿</div>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: 'none', border: 'none', color: '#4a4a4a',
            cursor: 'pointer', fontSize: 11, padding: '3px 8px',
            lineHeight: 1,
          }}
          title="Hide panel"
        >▶</button>
      </div>
          <div style={{ padding: '8px 14px 10px' }}>
            {/* Mission time */}
            <div style={{ marginBottom: 6, borderBottom: '1px solid #3a3a3a', paddingBottom: 6 }}>
              <div style={{ fontSize: 12, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                Mission
              </div>
              <div style={{ fontFamily: "'B612 Mono', monospace", fontSize: 14 }}>
                {overview.date} {formatTime(overview.start_time)}L
              </div>
            </div>

            {/* Weather */}
            <div style={{ marginBottom: 6, borderBottom: '1px solid #3a3a3a', paddingBottom: 6 }}>
              <div style={{ fontSize: 12, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                Weather
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 13, fontFamily: "'B612 Mono', monospace" }}>
                <span style={{ color: '#aaaaaa' }}>QNH</span>
                <span>{wx.qnh_inhg} inHg / {wx.qnh_hpa} hPa</span>

                <span style={{ color: '#aaaaaa' }}>Temp</span>
                <span>{wx.temperature_c}°C / {Math.round(wx.temperature_c * 9/5 + 32)}°F</span>

                <span style={{ color: '#aaaaaa' }}>Wind</span>
                <span>{formatWind(windGnd)}</span>

                <span style={{ color: '#aaaaaa' }}>@FL200</span>
                <span>{formatWind(wx.wind.at2000)}</span>

                <span style={{ color: '#aaaaaa' }}>@FL260</span>
                <span>{formatWind(wx.wind.at8000)}</span>

                <span style={{ color: '#aaaaaa' }}>Vis</span>
                <span>{wx.visibility_m >= 10000 ? `${(wx.visibility_m / 1000).toFixed(0)}km` : `${wx.visibility_m}m`}</span>

                {wx.clouds_base_m > 0 && (
                  <>
                    <span style={{ color: '#aaaaaa' }}>Clouds</span>
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
                    <span style={{ color: '#aaaaaa' }}>Turb</span>
                    <span>{wx.turbulence}</span>
                  </>
                )}
              </div>
            </div>

            {/* Speed mode toggle */}
            <div style={{ marginBottom: 6, borderBottom: '1px solid #3a3a3a', paddingBottom: 6 }}>
              <div style={{ fontSize: 12, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                Speed Display
              </div>
              <div style={{ display: 'flex', gap: 3 }}>
                {SPEED_MODES.map((sm) => (
                  <button
                    key={sm.id}
                    onClick={() => setSpeedMode(sm.id)}
                    style={{
                      flex: 1, padding: '4px 6px', fontSize: 12,
                      background: speedMode === sm.id ? '#4a4a4a' : '#262626',
                      border: `1px solid ${speedMode === sm.id ? '#4a8fd4' : '#3a3a3a'}`,
                      borderRadius: 3,
                      color: speedMode === sm.id ? '#e0e0e0' : '#aaaaaa',
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
              <div style={{ fontSize: 12, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                Cursor
              </div>
              <div
                ref={coordRef}
                style={{
                  color: '#cccccc',
                  fontSize: 12,
                  fontFamily: "'B612 Mono', monospace",
                  lineHeight: 1.6,
                  minHeight: 20,
                }}
              />
            </div>
          </div>
      <ResizeGrip {...resizeHandleProps} />
    </div>
    </>
  );
}
