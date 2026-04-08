/**
 * Weather Briefing Card — shared mission-wide kneeboard card.
 * Full weather summary with all wind layers, clouds, visibility, fog, dust.
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  notesBox, footerStyle,
  BORDER, TEXT, TEXT_MUTED, DIM, WARN,
} from './cardStyles';
import type { MissionOverviewData } from '../types/mission';
import { metersToFeet, msToKnots } from '../utils/conversions';

interface WeatherBriefCardProps {
  overview: MissionOverviewData;
}

function fmtWind(layer: { speed: number; dir: number }): string {
  const meteoDir = (layer.dir + 180) % 360;
  const kts = Math.round(msToKnots(layer.speed));
  if (kts === 0) return 'Calm';
  return `${Math.round(meteoDir).toString().padStart(3, '0')}°/${kts} kts`;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}Z`;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  padding: '5px 16px',
  borderBottom: `1px solid ${BORDER}`,
  fontSize: 19,
};
const lbl: React.CSSProperties = { color: TEXT_MUTED, width: 160, flexShrink: 0, fontSize: 17 };
const val: React.CSSProperties = { color: TEXT, fontWeight: 500, fontSize: 19 };

export function WeatherBriefCard({ overview }: WeatherBriefCardProps) {
  const wx = overview.weather;
  const hpa = Math.round(wx.qnh_mmhg * 1.33322);
  const inhg = (wx.qnh_mmhg * 0.03937).toFixed(2);
  const ceilFt = Math.round(metersToFeet(wx.clouds_base_m));
  const visSM = (wx.visibility_m / 1609.34).toFixed(1);
  const tempF = Math.round(wx.temperature_c * 9 / 5 + 32);

  // Flight condition
  const ceilCheck = wx.clouds_density >= 5 ? ceilFt : 99999;
  const visCheck = wx.visibility_m / 1609.34;
  let flightCat = 'VFR';
  let catColor = '#60c080';
  if (ceilCheck < 500 || visCheck < 1) { flightCat = 'LIFR'; catColor = '#d95050'; }
  else if (ceilCheck < 1000 || visCheck < 3) { flightCat = 'IFR'; catColor = '#d97050'; }
  else if (ceilCheck < 3000 || visCheck < 5) { flightCat = 'MVFR'; catColor = '#d29922'; }

  const precipLabel = wx.clouds_precipitation === 1 ? 'Rain' : wx.clouds_precipitation === 2 ? 'Thunderstorm' : 'None';

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>WEATHER BRIEFING</div>
        <div style={subtitleStyle}>
          {overview.theater} | {overview.date} | {formatTime(overview.start_time)}
        </div>
      </div>

      {/* Flight category banner */}
      <div style={{
        padding: '8px 16px',
        background: `${catColor}15`,
        borderBottom: `2px solid ${catColor}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 21, fontWeight: 700, color: catColor }}>{flightCat}</span>
        <span style={{ fontSize: 17, color: DIM }}>
          Ceiling {ceilCheck < 99999 ? `${ceilFt.toLocaleString()} ft` : 'Unlimited'} | Vis {visSM} SM
        </span>
      </div>

      {/* Pressure */}
      <div style={sectionTitle}>PRESSURE</div>
      <div style={rowStyle}>
        <span style={lbl}>QNH</span>
        <span style={val}>{hpa} hPa / {inhg} inHg / {Math.round(wx.qnh_mmhg)} mmHg</span>
      </div>

      {/* Temperature */}
      <div style={sectionTitle}>TEMPERATURE</div>
      <div style={rowStyle}>
        <span style={lbl}>Surface Temp</span>
        <span style={val}>{Math.round(wx.temperature_c)}°C / {tempF}°F</span>
      </div>

      {/* Wind layers */}
      <div style={sectionTitle}>WINDS</div>
      <div style={rowStyle}>
        <span style={lbl}>Surface</span>
        <span style={val}>{fmtWind(wx.wind.atGround)}</span>
      </div>
      <div style={rowStyle}>
        <span style={lbl}>2,000m / FL066</span>
        <span style={val}>{fmtWind(wx.wind.at2000)}</span>
      </div>
      <div style={rowStyle}>
        <span style={lbl}>8,000m / FL263</span>
        <span style={val}>{fmtWind(wx.wind.at8000)}</span>
      </div>

      {/* Clouds */}
      <div style={sectionTitle}>CLOUDS</div>
      <div style={rowStyle}>
        <span style={lbl}>Coverage</span>
        <span style={val}>
          {wx.clouds_density <= 0 ? 'Clear' :
           wx.clouds_density <= 2 ? 'Few' :
           wx.clouds_density <= 4 ? 'Scattered' :
           wx.clouds_density <= 7 ? 'Broken' : 'Overcast'}
          {wx.clouds_density > 0 ? ` (${wx.clouds_density}/10)` : ''}
        </span>
      </div>
      {wx.clouds_density > 0 && (
        <>
          <div style={rowStyle}>
            <span style={lbl}>Base / Thickness</span>
            <span style={val}>{ceilFt.toLocaleString()} ft / {Math.round(metersToFeet(wx.clouds_thickness)).toLocaleString()} ft</span>
          </div>
          {wx.clouds_preset && (
            <div style={rowStyle}>
              <span style={lbl}>Preset</span>
              <span style={val}>{wx.clouds_preset}</span>
            </div>
          )}
        </>
      )}
      <div style={rowStyle}>
        <span style={lbl}>Precipitation</span>
        <span style={{ ...val, color: wx.clouds_precipitation > 0 ? WARN : TEXT }}>{precipLabel}</span>
      </div>

      {/* Visibility */}
      <div style={sectionTitle}>VISIBILITY</div>
      <div style={rowStyle}>
        <span style={lbl}>Visibility</span>
        <span style={val}>{(wx.visibility_m / 1000).toFixed(1)} km / {visSM} SM</span>
      </div>
      {wx.fog_enabled && (
        <div style={rowStyle}>
          <span style={lbl}>Fog</span>
          <span style={{ ...val, color: WARN }}>
            Vis {wx.fog_visibility}m | Thickness {wx.fog_thickness}m
          </span>
        </div>
      )}
      {wx.dust_enabled && (
        <div style={rowStyle}>
          <span style={lbl}>Dust/Sand</span>
          <span style={{ ...val, color: WARN }}>Active (density {wx.dust_density})</span>
        </div>
      )}

      {/* Turbulence */}
      {wx.turbulence > 0 && (
        <>
          <div style={sectionTitle}>TURBULENCE</div>
          <div style={rowStyle}>
            <span style={lbl}>Ground Turb</span>
            <span style={{
              ...val,
              color: wx.turbulence > 50 ? '#d95050' : wx.turbulence > 25 ? WARN : TEXT,
            }}>
              {wx.turbulence > 50 ? 'Moderate-Severe' : wx.turbulence > 25 ? 'Light-Moderate' : 'Light'} ({wx.turbulence} m/s)
            </span>
          </div>
        </>
      )}

      {/* Notes */}
      <div style={{ padding: '8px 16px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 17, color: TEXT_MUTED, marginBottom: 4 }}>NOTES</div>
      </div>
      <div style={{ padding: '0 16px 8px', flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={notesBox} />
      </div>

      <div style={footerStyle}>Generated by DCS Mission Planner | VMFA-224(AW)</div>
    </div>
  );
}
