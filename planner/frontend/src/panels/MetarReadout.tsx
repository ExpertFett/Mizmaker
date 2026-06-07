/**
 * Current Weather — the planning-mode read-only weather page.
 *
 * Renamed from MetarReadout to MetarReadout-with-full-detail (v1.19.51) so
 * planners get every weather datum the mission carries without bouncing
 * over to the Editor's Weather tab. Read-only by design — full editing
 * stays in WeatherTab.
 *
 * Layout:
 *   - METAR + flight category (unchanged from the v0.4 version).
 *   - Winds at altitude (ground / 2,000 / 8,000 ft DCS layers).
 *   - Atmosphere (temp, ISA deviation, QNH, SL density alt).
 *   - Tactical signature (contrail floor — the v1.19.47 contrailAltitudeFt
 *     math). This is the headline ask Fett's tester had.
 *   - Clouds + precipitation (preset, base/top, coverage, precip, halo).
 *   - Hazards (fog, dust, turbulence) — only if active.
 *   - Mission time (date + start clock).
 */

import { useMissionStore } from '../store/missionStore';
import { generateMetar } from '../utils/metar';
import { metersToFeet, msToKnots } from '../utils/conversions';
import { contrailAltitudeFt } from '../utils/atmosphere';
import type { MissionWeather } from '../types/mission';

type Coverage = 'CLR' | 'FEW' | 'SCT' | 'BKN' | 'OVC';

function coverageOf(preset: string, density: number): Coverage {
  if (preset && preset.trim()) {
    const n = parseInt(preset.replace(/[^\d]/g, ''), 10);
    if (isNaN(n)) return 'SCT';
    if (n <= 4) return 'FEW';
    if (n <= 9) return 'SCT';
    if (n <= 16) return 'BKN';
    return 'OVC';
  }
  if (density <= 0) return 'CLR';
  if (density <= 2) return 'FEW';
  if (density <= 4) return 'SCT';
  if (density <= 7) return 'BKN';
  return 'OVC';
}

const COVERAGE_WORD: Record<Coverage, string> = {
  CLR: 'Clear', FEW: 'Few', SCT: 'Scattered', BKN: 'Broken', OVC: 'Overcast',
};

const PRECIP_WORD: Record<number, string> = {
  0: 'None', 1: 'Rain', 2: 'Thunderstorm', 3: 'Snow', 4: 'Snow storm',
};

/** Seconds-of-day → "HHMM" (no leading zero handling needed at int math).
 *  Used for the mission start clock. */
function secondsToHHMM(s: number | undefined | null): string {
  if (s == null || !Number.isFinite(s)) return '—';
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s / 60) % 60);
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

/** Surface-temp ISA deviation in °C, signed. Standard day = 15°C. */
function isaDeviation(tempC: number): number {
  return Math.round(tempC - 15);
}

/** Density altitude at SEA LEVEL (ft) — a clean signal of how non-standard
 *  the day is. Uses the same rule-of-thumb formula as the editor's Density
 *  Altitude card: DA = PressureAlt + 120 × (OAT − ISA temp at PA). At sea
 *  level: ISA = 15°C, PA = (29.92 − inHg) × 1000. */
function densityAltSL(tempC: number, qnhInHg: number): number {
  const pressureAlt = (29.92 - qnhInHg) * 1000;  // ft
  return Math.round(pressureAlt + 120 * (tempC - 15));
}

export function MetarReadout() {
  const overview = useMissionStore((s) => s.overview);
  const wx = overview?.weather;

  return (
    <div style={{ padding: 24, maxWidth: 720, color: '#e0e0e0' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600 }}>Current Weather</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#aaaaaa', lineHeight: 1.5 }}>
        Mission weather snapshot — METAR, wind layers, atmosphere, signature.
        Read-only here; full editing lives on the editor's Weather tab.
      </p>

      {!wx ? (
        <div style={{
          padding: '18px 16px', background: '#1c1c1c', border: '1px dashed #3a3a3a',
          borderRadius: 6, fontSize: 13, color: '#999999', textAlign: 'center',
        }}>
          No weather data in this mission.
        </div>
      ) : (
        <Readout
          metar={generateMetar(wx, overview?.date, overview?.start_time)}
          wx={wx}
          date={overview?.date}
          startSec={overview?.start_time}
        />
      )}
    </div>
  );
}

function Readout({ metar, wx, date, startSec }: {
  metar: string;
  wx: MissionWeather;
  date?: string;
  startSec?: number;
}) {
  const cov = coverageOf(wx.clouds_preset, wx.clouds_density);
  const ceilFt = Math.round(metersToFeet(wx.clouds_base_m));
  const visSM = wx.visibility_m / 1609.34;
  const visKm = wx.visibility_m / 1000;

  // Flight category (FAA): ceiling counts only when Broken/Overcast.
  const ceilForCat = cov === 'BKN' || cov === 'OVC' ? ceilFt : Infinity;
  let cat = 'VFR', catColor = '#3fb950';
  if (ceilForCat < 500 || visSM < 1) { cat = 'LIFR'; catColor = '#d95050'; }
  else if (ceilForCat < 1000 || visSM < 3) { cat = 'IFR'; catColor = '#d97050'; }
  else if (ceilForCat < 3000 || visSM < 5) { cat = 'MVFR'; catColor = '#d29922'; }

  // Surface wind (meteorological "from" direction).
  const windKt = Math.round(msToKnots(wx.wind.atGround.speed));
  const windDir = Math.round((wx.wind.atGround.dir + 180) % 360).toString().padStart(3, '0');
  const windStr = windKt === 0 ? 'Calm' : `${windDir}° / ${windKt} kt`;

  // Winds aloft — both DCS layers, expressed in the same meteorological convention.
  const w2kKt = Math.round(msToKnots(wx.wind.at2000.speed));
  const w2kDir = Math.round((wx.wind.at2000.dir + 180) % 360).toString().padStart(3, '0');
  const w2kStr = w2kKt === 0 ? 'Calm' : `${w2kDir}° / ${w2kKt} kt`;
  const w8kKt = Math.round(msToKnots(wx.wind.at8000.speed));
  const w8kDir = Math.round((wx.wind.at8000.dir + 180) % 360).toString().padStart(3, '0');
  const w8kStr = w8kKt === 0 ? 'Calm' : `${w8kDir}° / ${w8kKt} kt`;

  const tempF = Math.round(wx.temperature_c * 9 / 5 + 32);
  const dev = isaDeviation(wx.temperature_c);
  const devStr = dev === 0 ? 'ISA' : `ISA${dev > 0 ? '+' : ''}${dev}`;
  const inHg = (wx.qnh_inhg || wx.qnh_mmhg * 0.03937);
  const hPa = Math.round(wx.qnh_hpa || wx.qnh_mmhg * 1.33322);
  const da = densityAltSL(wx.temperature_c, inHg);

  // Contrail floor — the headline new field for the planning page.
  const contrailFt = contrailAltitudeFt(wx.temperature_c, -40);
  const contrailRounded = contrailFt == null
    ? null
    : Math.round(contrailFt / 100) * 100;
  const contrailStr =
    contrailRounded == null ? '—'
    : contrailRounded === 0 ? 'Surface (arctic)'
    : contrailRounded >= 36000 ? '36,000+ ft (above tropopause)'
    : `${contrailRounded.toLocaleString()} ft (FL${Math.round(contrailRounded / 100)})`;
  const contrailColor =
    contrailRounded == null ? '#cccccc'
    : contrailRounded === 0 ? '#d95050'
    : contrailRounded < 20000 ? '#d95050'
    : contrailRounded < 28000 ? '#d29922'
    : '#60c080';

  // Clouds detail
  const cloudThicknessFt = wx.clouds_thickness > 0
    ? Math.round(metersToFeet(wx.clouds_thickness))
    : null;
  const cloudTopFt = cloudThicknessFt && ceilFt
    ? ceilFt + cloudThicknessFt
    : null;
  const cloudStr = cov === 'CLR'
    ? 'Clear'
    : `${COVERAGE_WORD[cov]} @ ${ceilFt.toLocaleString()} ft`
      + (cloudTopFt ? ` · tops ${cloudTopFt.toLocaleString()} ft` : '')
      + (wx.clouds_preset ? ` · ${wx.clouds_preset}` : '');
  const precip = PRECIP_WORD[wx.clouds_precipitation] || 'None';

  // Hazards (only render when active)
  const fogActive = wx.fog_enabled && wx.fog_visibility > 0;
  const dustActive = wx.dust_enabled;
  const turbActive = wx.turbulence > 0;

  return (
    <div style={{ background: '#222222', border: '1px solid #3a3a3a', borderRadius: 6, overflow: 'hidden' }}>
      {/* METAR string */}
      <div style={{
        padding: '12px 16px',
        fontFamily: "'B612 Mono', 'Consolas', monospace",
        fontSize: 15, letterSpacing: 0.5, color: '#9cd0ff',
        background: '#1a1a1a', borderBottom: '1px solid #3a3a3a',
        wordBreak: 'break-word',
      }}>
        {metar}
      </div>

      {/* Flight category */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', borderBottom: `2px solid ${catColor}`, background: `${catColor}14`,
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: catColor }}>{cat}</span>
        <span style={{ fontSize: 12, color: '#aaaaaa' }}>
          Ceiling {ceilForCat < Infinity ? `${ceilFt.toLocaleString()} ft` : 'Unlimited'} · Vis {visSM > 6 ? '10+' : visSM.toFixed(1)} SM
        </span>
      </div>

      {/* WINDS */}
      <SectionHead>Winds</SectionHead>
      <Row label="Surface" value={windStr} />
      <Row label="2,000 ft" value={w2kStr} />
      <Row label="8,000 ft" value={w8kStr} />

      {/* ATMOSPHERE */}
      <SectionHead>Atmosphere</SectionHead>
      <Row label="Temperature" value={`${Math.round(wx.temperature_c)}°C / ${tempF}°F · ${devStr}`} />
      <Row label="QNH" value={`${inHg.toFixed(2)} inHg / ${hPa} hPa`} />
      <Row label="Density Alt (SL)" value={`${da.toLocaleString()} ft`}
           valueColor={da > 3000 ? '#d29922' : da < -2000 ? '#9cd0ff' : undefined} />

      {/* SIGNATURE — contrails */}
      <SectionHead>Tactical Signature</SectionHead>
      <Row
        label="Contrail Floor"
        value={contrailStr}
        valueColor={contrailColor}
        hint="Altitude where ambient temp drops to −40°C. Pushing above leaves a visible / IR-detectable trail. ISA-anchored to surface temp; ignores humidity (DCS doesn't model it)."
      />

      {/* CLOUDS */}
      <SectionHead>Clouds & Precipitation</SectionHead>
      <Row label="Layer" value={cloudStr} />
      <Row label="Visibility" value={`${visKm.toFixed(1)} km / ${visSM > 6 ? '10+' : visSM.toFixed(1)} SM`} />
      <Row label="Precipitation" value={precip}
           valueColor={wx.clouds_precipitation >= 2 ? '#d29922' : undefined} />
      {wx.halo_preset && wx.halo_preset.trim() !== '' && (
        <Row label="Halo / Pillar" value={wx.halo_preset} />
      )}

      {/* HAZARDS — conditional */}
      {(fogActive || dustActive || turbActive) && <SectionHead>Hazards</SectionHead>}
      {fogActive && (
        <Row label="Fog"
             value={`${wx.fog_visibility} m visibility · ${Math.round(metersToFeet(wx.fog_thickness))} ft thick`}
             valueColor="#d29922" />
      )}
      {dustActive && (
        <Row label="Dust" value={`Density ${wx.dust_density}`} valueColor="#d29922" />
      )}
      {turbActive && (
        <Row label="Turbulence" value={`${wx.turbulence} m/s`}
             valueColor={wx.turbulence > 10 ? '#d95050' : '#d29922'} />
      )}

      {/* TIME */}
      <SectionHead>Mission Time</SectionHead>
      <Row label="Date" value={date || '—'} />
      <Row label="Start (local)" value={secondsToHHMM(startSec)} last />
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '8px 16px 4px',
      fontSize: 10, letterSpacing: 1.5, fontWeight: 700,
      color: '#8aa0ba', textTransform: 'uppercase',
      background: '#1a1f28', borderTop: '1px solid #2e2e2e',
    }}>
      {children}
    </div>
  );
}

function Row({ label, value, last, valueColor, hint }: {
  label: string;
  value: string;
  last?: boolean;
  valueColor?: string;
  hint?: string;
}) {
  return (
    <div title={hint} style={{
      display: 'flex', padding: '8px 16px', fontSize: 14,
      borderBottom: last ? 'none' : '1px solid #2e2e2e',
      cursor: hint ? 'help' : 'default',
    }}>
      <span style={{ width: 150, flexShrink: 0, color: '#888888' }}>{label}</span>
      <span style={{ color: valueColor || '#e0e0e0', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
