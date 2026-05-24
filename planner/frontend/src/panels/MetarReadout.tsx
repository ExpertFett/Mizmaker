/**
 * MetarReadout — a compact, read-only weather box for Planning mode.
 *
 * Planning mode doesn't need the full Weather editor; it just needs to *read*
 * the mission's weather at a glance. This renders the METAR string (via the
 * shared generateMetar util) plus a small plain-language decode and a flight
 * category chip. No editing, no store writes.
 */

import { useMissionStore } from '../store/missionStore';
import { generateMetar } from '../utils/metar';
import { metersToFeet, msToKnots } from '../utils/conversions';
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

export function MetarReadout() {
  const overview = useMissionStore((s) => s.overview);
  const wx = overview?.weather;

  return (
    <div style={{ padding: 24, maxWidth: 560, color: '#e0e0e0' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600 }}>Weather</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#aaaaaa', lineHeight: 1.5 }}>
        Read-only METAR for this mission. Full weather is set in the editor.
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
        />
      )}
    </div>
  );
}

function Readout({ metar, wx }: { metar: string; wx: MissionWeather }) {
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

  const tempF = Math.round(wx.temperature_c * 9 / 5 + 32);
  const inHg = (wx.qnh_inhg || wx.qnh_mmhg * 0.03937).toFixed(2);
  const hPa = Math.round(wx.qnh_hpa || wx.qnh_mmhg * 1.33322);

  const cloudStr = cov === 'CLR'
    ? 'Clear'
    : `${COVERAGE_WORD[cov]} @ ${ceilFt.toLocaleString()} ft`;

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

      {/* Decoded rows */}
      <Row label="Wind" value={windStr} />
      <Row label="Visibility" value={`${visKm.toFixed(1)} km / ${visSM > 6 ? '10+' : visSM.toFixed(1)} SM`} />
      <Row label="Clouds" value={cloudStr} />
      <Row label="Temp" value={`${Math.round(wx.temperature_c)}°C / ${tempF}°F`} />
      <Row label="QNH" value={`${inHg} inHg / ${hPa} hPa`} last />
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{
      display: 'flex', padding: '8px 16px', fontSize: 14,
      borderBottom: last ? 'none' : '1px solid #2e2e2e',
    }}>
      <span style={{ width: 110, flexShrink: 0, color: '#888888' }}>{label}</span>
      <span style={{ color: '#e0e0e0', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
