/**
 * Bomb Wind Correction Tab — CCIP wind-drift calculator.
 *
 * From altitude a free-fall bomb spends many seconds in the air, and the
 * wind pushes it off the no-wind CCIP solution the whole way down. This
 * estimates how far it drifts and where to place the pipper to compensate.
 *
 * Model (first-order, slick/low-drag bomb):
 *   - Time of fall from a drag-free ballistic solve on release altitude,
 *     TAS and dive angle.
 *   - Drift ≈ wind component × time of fall (bomb assumed fully coupled to
 *     the air mass). This is the standard "aim into the wind by
 *     crosswind × TOF" rule of thumb and tends to be an upper bound — real
 *     drift is a little less because the bomb keeps its release inertia for
 *     a moment. Good for planning, not a release solution.
 *
 * Session-only, pure local state — no mission/store coupling.
 */

import { useMemo, useState } from 'react';

type WindUnit = 'kt' | 'ms';

const KT_TO_MS = 0.514444;
const FT_TO_M = 0.3048;
const M_TO_FT = 1 / FT_TO_M;
const G = 9.80665;
const D2R = Math.PI / 180;

interface Result {
  tof: number;          // s
  headwindKt: number;   // + headwind, - tailwind
  xwindKt: number;      // + from right, - from left
  rangeFt: number;      // signed: + aim long, - aim short
  defFt: number;        // signed: + aim right, - aim left
  rangeM: number;
  defM: number;
  rangeMils: number;
  defMils: number;
}

function compute(
  windDir: string, windSpeed: string, windUnit: WindUnit,
  runHeading: string, altFt: string, speedKt: string, diveDeg: string,
): Result | null {
  const dir = parseFloat(windDir);
  const spd = parseFloat(windSpeed);
  const hdg = parseFloat(runHeading);
  const alt = parseFloat(altFt);
  const tas = parseFloat(speedKt);
  const dive = parseFloat(diveDeg);
  if ([dir, spd, hdg, alt, tas, dive].some((n) => Number.isNaN(n))) return null;
  if (alt <= 0 || spd < 0 || tas < 0) return null;

  const W = windUnit === 'kt' ? spd * KT_TO_MS : spd; // m/s
  const V = tas * KT_TO_MS;                            // m/s TAS
  const H = alt * FT_TO_M;                             // m AGL
  const th = dive * D2R;

  const vz0 = V * Math.sin(th);                        // downward release vel
  const tof = (-vz0 + Math.sqrt(vz0 * vz0 + 2 * G * H)) / G;

  // Wind direction is "from"; run heading is the ground track on the run-in.
  // Both must share a reference (use true for both).
  const alpha = (dir - hdg) * D2R;
  const headwind = W * Math.cos(alpha);   // + = headwind (bomb falls short)
  const xwindR = W * Math.sin(alpha);     // + = wind from the right (bomb drifts left)

  // Correction = equal & opposite to drift. Headwind → aim long; wind from
  // the right → aim right (into the wind).
  const aimLongM = headwind * tof;
  const aimRightM = xwindR * tof;

  // Slant range release→impact, for an approximate HUD mil offset.
  const xHoriz = V * Math.cos(th) * tof;
  const slant = Math.hypot(xHoriz, H);

  return {
    tof,
    headwindKt: headwind / KT_TO_MS,
    xwindKt: xwindR / KT_TO_MS,
    rangeFt: aimLongM * M_TO_FT,
    defFt: aimRightM * M_TO_FT,
    rangeM: aimLongM,
    defM: aimRightM,
    rangeMils: slant > 0 ? (Math.abs(aimLongM) / slant) * 1000 : 0,
    defMils: slant > 0 ? (Math.abs(aimRightM) / slant) * 1000 : 0,
  };
}

const r0 = (n: number) => Math.round(n).toLocaleString();
const r1 = (n: number) => n.toFixed(1);

export function WindCalcTab() {
  const [windDir, setWindDir] = useState('030');
  const [windSpeed, setWindSpeed] = useState('25');
  const [windUnit, setWindUnit] = useState<WindUnit>('kt');
  const [runHeading, setRunHeading] = useState('090');
  const [altFt, setAltFt] = useState('15000');
  const [speedKt, setSpeedKt] = useState('450');
  const [diveDeg, setDiveDeg] = useState('30');

  const res = useMemo(
    () => compute(windDir, windSpeed, windUnit, runHeading, altFt, speedKt, diveDeg),
    [windDir, windSpeed, windUnit, runHeading, altFt, speedKt, diveDeg],
  );

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
          Bomb Wind Correction
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
          Estimate how far wind drifts a free-fall bomb during its fall and where to
          place the CCIP pipper to compensate — for precise high-altitude bombing.
        </p>
      </div>

      {/* Inputs */}
      <div style={{
        background: '#222222', border: '1px solid #3a3a3a',
        borderRadius: 6, padding: 16, marginBottom: 14,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={lblStyle}>Wind From (°)</label>
            <input type="number" value={windDir} onChange={(e) => setWindDir(e.target.value)}
              style={{ ...inputStyle, width: '100%' }} placeholder="030" min={0} max={360} />
          </div>
          <div>
            <label style={lblStyle}>Wind Speed</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" value={windSpeed} onChange={(e) => setWindSpeed(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 0 }} placeholder="25" min={0} />
              <div style={{ display: 'flex', borderRadius: 3, overflow: 'hidden', border: '1px solid #3a3a3a' }}>
                <button onClick={() => setWindUnit('kt')} style={unitBtn(windUnit === 'kt')}>kt</button>
                <button onClick={() => setWindUnit('ms')} style={unitBtn(windUnit === 'ms')}>m/s</button>
              </div>
            </div>
          </div>
          <div>
            <label style={lblStyle}>Run-in Heading (°)</label>
            <input type="number" value={runHeading} onChange={(e) => setRunHeading(e.target.value)}
              style={{ ...inputStyle, width: '100%' }} placeholder="090" min={0} max={360} />
          </div>
          <div>
            <label style={lblStyle}>Release Alt (ft AGL)</label>
            <input type="number" value={altFt} onChange={(e) => setAltFt(e.target.value)}
              style={{ ...inputStyle, width: '100%' }} placeholder="15000" min={0} />
          </div>
          <div>
            <label style={lblStyle}>Release Speed (KTAS)</label>
            <input type="number" value={speedKt} onChange={(e) => setSpeedKt(e.target.value)}
              style={{ ...inputStyle, width: '100%' }} placeholder="450" min={0} />
          </div>
          <div>
            <label style={lblStyle}>Dive Angle (°)</label>
            <input type="number" value={diveDeg} onChange={(e) => setDiveDeg(e.target.value)}
              style={{ ...inputStyle, width: '100%' }} placeholder="30" min={0} max={90} />
          </div>
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 11, color: '#777777' }}>
          Use the same heading reference (true) for wind and run-in. Dive angle 0 = level
          release, 90 = straight down.
        </p>
      </div>

      {/* Results */}
      {res === null ? (
        <div style={{
          padding: '32px 20px', textAlign: 'center',
          background: 'rgba(74, 143, 212, 0.04)',
          border: '1px solid #4a4a4a', borderRadius: 6,
          color: '#aaaaaa', fontSize: 13,
        }}>
          Enter wind, run-in heading, release altitude, speed and dive angle to compute the correction.
        </div>
      ) : (
        <div style={{
          background: '#222222', border: '1px solid #3a3a3a',
          borderRadius: 6, padding: 16, borderLeft: '3px solid #4a8fd4',
        }}>
          {/* TOF + components */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
            <Stat label="Time of Fall" value={`${r1(res.tof)} s`} accent="#4a8fd4" />
            <Stat
              label={res.headwindKt >= 0 ? 'Headwind' : 'Tailwind'}
              value={`${r0(Math.abs(res.headwindKt))} kt`}
            />
            <Stat
              label={`Crosswind ${res.xwindKt >= 0 ? 'from R' : 'from L'}`}
              value={`${r0(Math.abs(res.xwindKt))} kt`}
            />
          </div>

          {/* Aim correction — the actionable part */}
          <div style={{
            fontSize: 10, color: '#aaaaaa', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
          }}>
            Aim Correction — place pipper here, bomb drifts back onto target
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <CorrCard
              axis="Range"
              dir={Math.abs(res.rangeFt) < 1 ? 'ON' : res.rangeFt > 0 ? 'LONG' : 'SHORT'}
              ft={Math.abs(res.rangeFt)}
              m={Math.abs(res.rangeM)}
              mils={res.rangeMils}
            />
            <CorrCard
              axis="Deflection"
              dir={Math.abs(res.defFt) < 1 ? 'ON' : res.defFt > 0 ? 'RIGHT' : 'LEFT'}
              ft={Math.abs(res.defFt)}
              m={Math.abs(res.defM)}
              mils={res.defMils}
            />
          </div>

          <p style={{ margin: '14px 0 0', fontSize: 11, color: '#777777', lineHeight: 1.5 }}>
            First-order estimate for slick (low-drag) bombs: drift ≈ wind × time of fall,
            assuming the bomb fully couples to the air mass. Treat it as an upper bound and a
            planning aid — verify in the jet. Retarded/high-drag stores and strong drag will
            differ. Mils are slant-range approximations for the HUD pipper.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={lblStyle}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ?? '#e0e0e0' }}>{value}</div>
    </div>
  );
}

function CorrCard({ axis, dir, ft, m, mils }: {
  axis: string; dir: string; ft: number; m: number; mils: number;
}) {
  const muted = dir === 'ON';
  return (
    <div style={{
      background: '#262626', border: '1px solid #3a3a3a',
      borderRadius: 4, padding: '10px 12px',
    }}>
      <div style={lblStyle}>{axis}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: muted ? '#777' : '#e0e0e0' }}>
          {r0(ft)}
        </span>
        <span style={{ fontSize: 12, color: '#aaaaaa' }}>ft</span>
        <span style={{
          fontSize: 13, fontWeight: 700, marginLeft: 'auto',
          color: muted ? '#777' : '#d29922',
        }}>
          {dir}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#777777', marginTop: 2 }}>
        {r0(m)} m · ~{r0(mils)} mils
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#262626', border: '1px solid #3a3a3a', borderRadius: 3,
  color: '#cccccc', fontSize: 13, padding: '5px 8px', fontFamily: 'inherit',
  boxSizing: 'border-box',
};
const lblStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, color: '#aaaaaa',
  fontWeight: 600, marginBottom: 3, textTransform: 'uppercase',
  letterSpacing: 0.5,
};
const unitBtn = (active: boolean): React.CSSProperties => ({
  background: active ? '#4a8fd4' : '#262626',
  border: 'none',
  color: active ? '#ffffff' : '#aaaaaa',
  cursor: 'pointer', fontSize: 12, fontWeight: 600,
  padding: '0 9px', fontFamily: 'inherit',
});
