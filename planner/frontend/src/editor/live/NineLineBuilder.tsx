/**
 * 9-line CAS builder — Phase 6 controller-scope addition.
 *
 * Standard NATO/USN 9-line format for a CAS check-in. The DM fills the
 * fields, the component emits a single formatted message ready to drop
 * into the comms log composer. Numbers are labeled left-aligned the
 * way Marines read them on a kneeboard:
 *
 *   1. IP/BP
 *   2. Heading (mag) / offset (L/R)
 *   3. Distance (NM from IP/BP)
 *   4. Target elevation (ft MSL)
 *   5. Target description
 *   6. Target location (MGRS or lat/lon)
 *   7. Mark type / code
 *   8. Friendlies (location / distance)
 *   9. Egress
 *   Restrictions: any (final attack heading limits, etc.)
 *
 * Fields are free-text — controllers tweak per mission. Defaults nudge
 * pilots toward the right answer (e.g. egress = "S" instead of blank).
 */

import { useState } from 'react';

const C = {
  bg: 'rgba(13,19,29,0.96)',
  border: '#243349',
  borderHi: '#3a6ea5',
  accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.18)',
  text: '#dce6f2',
  textDim: '#8aa0ba',
  amber: '#ffd24a',
};

interface NineLine {
  ip: string;
  headingDeg: string;
  offset: 'L' | 'R' | '';
  distanceNm: string;
  targetElevFt: string;
  targetDesc: string;
  targetLoc: string;
  markType: string;
  friendlies: string;
  egress: string;
  restrictions: string;
}

const EMPTY: NineLine = {
  ip: '', headingDeg: '', offset: '', distanceNm: '',
  targetElevFt: '', targetDesc: '', targetLoc: '',
  markType: 'No mark', friendlies: 'None within 1 km',
  egress: 'S', restrictions: 'None',
};

export function format9Line(n: NineLine): string {
  const lines = [
    'CAS 9-LINE',
    `1. IP/BP: ${n.ip || '—'}`,
    `2. Heading: ${n.headingDeg ? `${n.headingDeg}°${n.offset ? ` offset ${n.offset}` : ''}` : '—'}`,
    `3. Distance: ${n.distanceNm ? `${n.distanceNm} NM` : '—'}`,
    `4. Tgt elev: ${n.targetElevFt ? `${n.targetElevFt} ft MSL` : '—'}`,
    `5. Tgt desc: ${n.targetDesc || '—'}`,
    `6. Tgt loc: ${n.targetLoc || '—'}`,
    `7. Mark: ${n.markType || '—'}`,
    `8. Friendlies: ${n.friendlies || '—'}`,
    `9. Egress: ${n.egress || '—'}`,
  ];
  if (n.restrictions && n.restrictions !== 'None') lines.push(`Restrictions: ${n.restrictions}`);
  return lines.join('\n');
}

export function NineLineBuilder({ onClose, onSubmit }: {
  onClose?: () => void;
  /** Fired with the formatted 9-line string when the DM clicks Send. */
  onSubmit?: (text: string) => void;
}) {
  const [n, setN] = useState<NineLine>(EMPTY);
  const set = (k: keyof NineLine, v: string) => setN((p) => ({ ...p, [k]: v }));

  const submit = () => {
    if (onSubmit) onSubmit(format9Line(n));
  };
  const copy = () => {
    try { navigator.clipboard?.writeText(format9Line(n)); } catch { /* ignore */ }
  };

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: C.accentDim, borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.text }}>
        <span>📋 9-LINE BUILDER</span>
        {onClose && <span onClick={onClose} style={{ cursor: 'pointer', color: C.textDim, fontWeight: 400 }}>×</span>}
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', maxHeight: 460 }}>
        <Field label="1. IP/BP">
          <input value={n.ip} onChange={(e) => set('ip', e.target.value)} style={inp} placeholder="IP DELTA" />
        </Field>
        <Field label="2. Heading">
          <input value={n.headingDeg} onChange={(e) => set('headingDeg', e.target.value)} style={{ ...inp, width: 70 }} placeholder="080" />
          <select value={n.offset} onChange={(e) => set('offset', e.target.value)} style={{ ...inp, width: 84 }}>
            <option value="">no offset</option>
            <option value="L">offset L</option>
            <option value="R">offset R</option>
          </select>
        </Field>
        <Field label="3. Distance (NM)">
          <input value={n.distanceNm} onChange={(e) => set('distanceNm', e.target.value)} style={{ ...inp, width: 90 }} placeholder="6.5" />
        </Field>
        <Field label="4. Tgt elev (ft MSL)">
          <input value={n.targetElevFt} onChange={(e) => set('targetElevFt', e.target.value)} style={{ ...inp, width: 90 }} placeholder="320" />
        </Field>
        <Field label="5. Tgt description">
          <input value={n.targetDesc} onChange={(e) => set('targetDesc', e.target.value)} style={inp} placeholder="3× BMP-2 in revetment" />
        </Field>
        <Field label="6. Tgt location">
          <input value={n.targetLoc} onChange={(e) => set('targetLoc', e.target.value)} style={inp} placeholder="38T LB 12345 67890 / N42° 38° lat/lon" />
        </Field>
        <Field label="7. Mark type / code">
          <input value={n.markType} onChange={(e) => set('markType', e.target.value)} style={inp} placeholder="No mark / Sparkle / Laser 1688" />
        </Field>
        <Field label="8. Friendlies">
          <input value={n.friendlies} onChange={(e) => set('friendlies', e.target.value)} style={inp} placeholder="None within 1 km / 400 m SW" />
        </Field>
        <Field label="9. Egress">
          <input value={n.egress} onChange={(e) => set('egress', e.target.value)} style={{ ...inp, width: 110 }} placeholder="S / SE to IP DELTA" />
        </Field>
        <Field label="Restrictions">
          <input value={n.restrictions} onChange={(e) => set('restrictions', e.target.value)} style={inp} placeholder="FAH 060–120 / no fly over road" />
        </Field>

        <div style={{ marginTop: 6, padding: 6, background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`, borderRadius: 4, fontFamily: 'ui-monospace, monospace', fontSize: 10, color: C.amber, whiteSpace: 'pre-wrap' }}>
          {format9Line(n)}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button onClick={copy} style={btnDim}>Copy</button>
          <button onClick={() => setN(EMPTY)} style={btnDim}>Clear</button>
          {onSubmit && (
            <button onClick={submit}
                    style={{ flex: 1, padding: '6px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#cfe6ff', background: C.accentDim, border: `1px solid ${C.accent}`, borderRadius: 3, cursor: 'pointer' }}>
              SEND TO COMMS
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, letterSpacing: 1, color: C.textDim, textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{children}</div>
    </label>
  );
}

const inp: React.CSSProperties = {
  flex: 1, background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.border}`,
  color: C.text, padding: '4px 7px', fontSize: 11, fontFamily: 'inherit',
  borderRadius: 3, outline: 'none',
};
const btnDim: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim,
  padding: '5px 10px', fontSize: 11, borderRadius: 3, cursor: 'pointer',
};
