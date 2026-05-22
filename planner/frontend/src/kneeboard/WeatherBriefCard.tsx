/**
 * Weather Briefing Card — shared mission-wide kneeboard card.
 * Full weather summary with all wind layers, clouds, visibility, fog, dust.
 */

import {
  cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle,
  notesBox, footerStyle, MissionDateLine,
  BORDER, TEXT, TEXT_MUTED, DIM, WARN,
} from './cardStyles';
import type { MissionOverviewData } from '../types/mission';
import { metersToFeet, msToKnots } from '../utils/conversions';
import { generateMetar } from '../utils/metar';

interface WeatherBriefCardProps {
  overview: MissionOverviewData;
  /** Planner-typed notes rendered inside the NOTES box. (v0.9.70) */
  notes?: string;
}

function fmtWind(layer: { speed: number; dir: number }): string {
  // DCS stores wind direction as the "from" direction in DCS coordinates.
  // Add 180° to convert to standard meteorological "from" reporting.
  const meteoDir = (layer.dir + 180) % 360;
  const kts = Math.round(msToKnots(layer.speed));
  if (kts === 0) return 'Calm';
  return `${Math.round(meteoDir).toString().padStart(3, '0')}°/${kts} kts`;
}

/**
 * DCS cloud preset names → friendly description (coverage + special weather).
 * When a mission uses a preset, the legacy density field is meaningless — the
 * preset is the source of truth.
 */
const CLOUD_PRESETS: Record<string, { coverage: string; rain?: boolean; storm?: boolean }> = {
  Preset1: { coverage: 'Light Scattered 1' },
  Preset2: { coverage: 'Light Scattered 2' },
  Preset3: { coverage: 'High Scattered 1' },
  Preset4: { coverage: 'High Scattered 2' },
  Preset5: { coverage: 'Scattered 1' },
  Preset6: { coverage: 'Scattered 2' },
  Preset7: { coverage: 'Scattered 3' },
  Preset8: { coverage: 'High Scattered 3' },
  Preset9: { coverage: 'Scattered 4' },
  Preset10: { coverage: 'Broken 1' },
  Preset11: { coverage: 'Broken 2' },
  Preset12: { coverage: 'Broken 3' },
  Preset13: { coverage: 'Broken 4' },
  Preset14: { coverage: 'Broken 5' },
  Preset15: { coverage: 'Broken 6' },
  Preset16: { coverage: 'Broken 7' },
  Preset17: { coverage: 'Broken 8 (Rain)', rain: true },
  Preset18: { coverage: 'Overcast 1' },
  Preset19: { coverage: 'Overcast 2' },
  Preset20: { coverage: 'Overcast 3' },
  Preset21: { coverage: 'Overcast 4 (Rain)', rain: true },
  Preset22: { coverage: 'Overcast 5 (Rain)', rain: true },
  Preset23: { coverage: 'Overcast 6 (Rain)', rain: true },
  Preset24: { coverage: 'Overcast 7 (Rain)', rain: true },
  Preset25: { coverage: 'Overcast 8 (Rain)', rain: true },
  Preset26: { coverage: 'Overcast 9 (Storm)', rain: true, storm: true },
  Preset27: { coverage: 'Overcast 10 (Storm)', rain: true, storm: true },
  RainyPreset1: { coverage: 'Overcast (Rain)', rain: true },
  RainyPreset2: { coverage: 'Overcast (Rain Heavy)', rain: true },
  RainyPreset3: { coverage: 'Overcast (Storm)', rain: true, storm: true },
};

function describeClouds(preset: string, density: number): { coverage: string; rain: boolean; storm: boolean } {
  // Prefer preset when set — legacy density is unreliable with presets.
  if (preset && preset.trim()) {
    const known = CLOUD_PRESETS[preset];
    if (known) return { coverage: known.coverage, rain: !!known.rain, storm: !!known.storm };
    return { coverage: preset, rain: false, storm: false };  // unknown preset, show raw name
  }
  // Legacy 0-10 density scale
  if (density <= 0) return { coverage: 'Clear', rain: false, storm: false };
  if (density <= 2) return { coverage: `Few (${density}/10)`, rain: false, storm: false };
  if (density <= 4) return { coverage: `Scattered (${density}/10)`, rain: false, storm: false };
  if (density <= 7) return { coverage: `Broken (${density}/10)`, rain: false, storm: false };
  return { coverage: `Overcast (${density}/10)`, rain: false, storm: false };
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  padding: '5px 16px',
  borderBottom: `1px solid ${BORDER}`,
  fontSize: 19,
};
const lbl: React.CSSProperties = { color: TEXT_MUTED, width: 160, flexShrink: 0, fontSize: 17 };
const val: React.CSSProperties = { color: TEXT, fontWeight: 500, fontSize: 19 };

export function WeatherBriefCard({ overview, notes }: WeatherBriefCardProps) {
  const wx = overview.weather;
  // Guard: a mission with no weather block would crash every dereference
  // below (and generateMetar). Render a graceful placeholder instead.
  if (!wx) {
    return (
      <div style={cardRoot}>
        <div style={headerStyle}>
          <div style={titleStyle}>WEATHER BRIEFING</div>
          <div style={subtitleStyle}>{overview.theater}</div>
          <MissionDateLine date={overview.date} startTime={overview.start_time} />
        </div>
        <div style={{ padding: '24px 16px', fontSize: 17, color: DIM, textAlign: 'center' }}>
          No weather data available for this mission.
        </div>
        {notes && notes.trim() && (
          <div style={{ padding: '0 16px 8px' }}>
            <div style={notesBox}>
              <div style={{ fontSize: 17, color: TEXT, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35 }}>
                {notes.trim()}
              </div>
            </div>
          </div>
        )}
        <div style={footerStyle}>Generated by DCS:OPT | VMFA-224(AW)</div>
      </div>
    );
  }
  const hpa = Math.round(wx.qnh_mmhg * 1.33322);
  const inhg = (wx.qnh_mmhg * 0.03937).toFixed(2);
  const ceilFt = Math.round(metersToFeet(wx.clouds_base_m));
  const visSM = (wx.visibility_m / 1609.34).toFixed(1);
  const tempF = Math.round(wx.temperature_c * 9 / 5 + 32);

  // Determine cloud coverage from preset (preferred) or density (legacy)
  const cloudInfo = describeClouds(wx.clouds_preset, wx.clouds_density);
  const hasOvercast = /Overcast|Broken/i.test(cloudInfo.coverage);

  // Flight condition — use ceiling only if Broken/Overcast (per FAA convention)
  const ceilCheck = hasOvercast ? ceilFt : 99999;
  const visCheck = wx.visibility_m / 1609.34;
  let flightCat = 'VFR';
  let catColor = '#60c080';
  if (ceilCheck < 500 || visCheck < 1) { flightCat = 'LIFR'; catColor = '#d95050'; }
  else if (ceilCheck < 1000 || visCheck < 3) { flightCat = 'IFR'; catColor = '#d97050'; }
  else if (ceilCheck < 3000 || visCheck < 5) { flightCat = 'MVFR'; catColor = '#d29922'; }

  // Precipitation — preset's rain flag wins if a preset is set, else legacy iprecptns
  let precipLabel = 'None';
  if (cloudInfo.storm) precipLabel = 'Thunderstorm';
  else if (cloudInfo.rain) precipLabel = 'Rain';
  else if (!wx.clouds_preset) {
    if (wx.clouds_precipitation === 1) precipLabel = 'Rain';
    else if (wx.clouds_precipitation === 2) precipLabel = 'Thunderstorm';
  }

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>WEATHER BRIEFING</div>
        <div style={subtitleStyle}>
          {overview.theater}
        </div>
        <MissionDateLine date={overview.date} startTime={overview.start_time} />
      </div>

      {/* METAR-style summary */}
      <div style={{
        padding: '6px 16px',
        background: 'var(--kb-surface, #222)',
        fontFamily: "'B612 Mono', monospace",
        fontSize: 16,
        color: TEXT,
        letterSpacing: 0.5,
        flexShrink: 0,
        borderBottom: `1px solid ${BORDER}`,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {generateMetar(wx, overview.date, overview.start_time)}
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
        <span style={val}>{cloudInfo.coverage}</span>
      </div>
      {(cloudInfo.coverage !== 'Clear') && ceilFt > 0 && (
        <div style={rowStyle}>
          <span style={lbl}>Base / Thickness</span>
          <span style={val}>
            {ceilFt.toLocaleString()} ft
            {wx.clouds_thickness > 0 ? ` / ${Math.round(metersToFeet(wx.clouds_thickness)).toLocaleString()} ft` : ''}
          </span>
        </div>
      )}
      <div style={rowStyle}>
        <span style={lbl}>Precipitation</span>
        <span style={{ ...val, color: precipLabel !== 'None' ? WARN : TEXT }}>{precipLabel}</span>
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
        <div style={notesBox}>
          {notes && notes.trim() && (
            <div style={{
              fontSize: 17, color: TEXT,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.35,
            }}>
              {notes.trim()}
            </div>
          )}
        </div>
      </div>

      <div style={footerStyle}>Generated by DCS:OPT | VMFA-224(AW)</div>
    </div>
  );
}
