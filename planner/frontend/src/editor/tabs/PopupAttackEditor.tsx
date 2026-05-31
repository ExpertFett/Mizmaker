/**
 * Profile editor for the Popup Attack kneeboard card.
 *
 * Mounted in the Kneeboard tab when cards.popupAttack is enabled. Lets the
 * planner define one or more attack profiles (Type 1 popup / lay-down), each
 * with target / popup / dive / release / ingress parameters. Renders as a
 * compact grid of inputs per profile + add/remove controls. The math lives
 * in utils/popupAttack.ts; the rendered card is kneeboard/PopupAttackCard.tsx.
 */

import { computePopupAttack, defaultPopupAttack, ATTACK_TYPE_LABEL, ATTACK_TYPE_DESC, type PopupAttackInput, type AttackType } from '../../utils/popupAttack';

interface Props {
  profiles: PopupAttackInput[];
  onChange: (next: PopupAttackInput[]) => void;
}

export function PopupAttackEditor({ profiles, onChange }: Props) {
  const update = (i: number, patch: Partial<PopupAttackInput>) =>
    onChange(profiles.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => onChange(profiles.filter((_, idx) => idx !== i));
  const add = () => onChange([
    ...profiles,
    defaultPopupAttack(`Attack ${profiles.length + 1}`),
  ]);

  return (
    <div style={{ margin: '10px 0', padding: '10px 14px', background: '#222', border: '1px solid #3a3a3a', borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0' }}>
          Popup Attack Profiles
          <span style={{ color: '#888', fontWeight: 400, marginLeft: 6 }}>— {profiles.length} defined (one card each)</span>
        </span>
        <button onClick={add} style={btn}>+ Add profile</button>
      </div>
      {profiles.length === 0 && (
        <div style={{ fontSize: 11, color: '#d29922' }}>Add at least one profile, or the card produces nothing.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {profiles.map((p, i) => (
          <ProfileRow key={i} idx={i} profile={p} onPatch={(patch) => update(i, patch)} onRemove={() => remove(i)} />
        ))}
      </div>
    </div>
  );
}

function ProfileRow({ idx, profile, onPatch, onRemove }: { idx: number; profile: PopupAttackInput; onPatch: (patch: Partial<PopupAttackInput>) => void; onRemove: () => void }) {
  // Compute a quick TTT/totals readout so the planner sees the math reacting
  // as they edit the params — without having to flip to the preview.
  const prof = computePopupAttack(profile);
  return (
    <div style={{ border: '1px solid #3a3a3a', borderRadius: 4, padding: 8, background: '#1d1d1d' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ color: '#e8833a', fontSize: 11, fontWeight: 700 }}>#{idx + 1}</span>
        <input
          value={profile.name || ''} placeholder={`Attack ${idx + 1}`}
          onChange={(e) => onPatch({ name: e.target.value })}
          style={{ ...inp, width: 160, fontWeight: 600 }} />
        <select value={profile.attackType} onChange={(e) => onPatch({ attackType: e.target.value as AttackType })}
                style={{ ...inp, width: 140 }}>
          {(Object.keys(ATTACK_TYPE_LABEL) as AttackType[]).map((k) => (
            <option key={k} value={k}>{ATTACK_TYPE_LABEL[k]}</option>
          ))}
        </select>
        <button
          onClick={() => {
            const d = defaultPopupAttack(profile.name || `Attack ${idx + 1}`, profile.attackType);
            // Preserve the few "scenario" fields the planner has likely tuned to
            // the target (elev, run-in distance, offset, speeds) — only blow
            // away the geometry the type controls.
            onPatch({
              popupAltitudeFtMsl: d.popupAltitudeFtMsl,
              popupAngleDeg: d.popupAngleDeg,
              diveAngleDeg: d.diveAngleDeg,
              releaseAltitudeFtAgl: d.releaseAltitudeFtAgl,
              ingressAltitudeFtAgl: d.ingressAltitudeFtAgl,
              recoveryAltitudeFtAgl: d.recoveryAltitudeFtAgl,
            });
          }}
          title={`Reset altitudes/angles to defaults for ${ATTACK_TYPE_LABEL[profile.attackType]}`}
          style={{ ...btn, padding: '4px 7px', fontSize: 11 }}>↺</button>
        <span style={{ flex: 1, fontSize: 11, color: '#888', textAlign: 'right' }}>
          TTT ~{Math.round(prof.totals.timeToTargetSec)}s · popup {prof.totals.popupDistanceNm.toFixed(1)} NM · dive {prof.totals.diveDistanceNm.toFixed(1)} NM
        </span>
        <button onClick={onRemove} style={btnDel} title="Remove profile">×</button>
      </div>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 6, paddingLeft: 2 }}>{ATTACK_TYPE_DESC[profile.attackType]}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        <Field label="TGT elev (ft MSL)" v={profile.targetElevationFt} onChange={(n) => onPatch({ targetElevationFt: n })} />
        <Field label="VIP dist (NM)" v={profile.vipDistanceNm} onChange={(n) => onPatch({ vipDistanceNm: n })} step={0.5} />
        <Field label="Popup alt (ft MSL)" v={profile.popupAltitudeFtMsl} onChange={(n) => onPatch({ popupAltitudeFtMsl: n })} />
        <Field label="Popup ° " v={profile.popupAngleDeg} onChange={(n) => onPatch({ popupAngleDeg: n })} />
        <Field label="Offset °" v={profile.angleOffsetDeg} onChange={(n) => onPatch({ angleOffsetDeg: n })} />
        <Field label="Dive °" v={profile.diveAngleDeg} onChange={(n) => onPatch({ diveAngleDeg: n })} />
        <Field label="Release alt (ft AGL)" v={profile.releaseAltitudeFtAgl} onChange={(n) => onPatch({ releaseAltitudeFtAgl: n })} />
        <Field label="Release kt" v={profile.releaseSpeedKts} onChange={(n) => onPatch({ releaseSpeedKts: n })} />
        <Field label="Ingress alt (ft AGL)" v={profile.ingressAltitudeFtAgl} onChange={(n) => onPatch({ ingressAltitudeFtAgl: n })} />
        <Field label="Ingress kt" v={profile.ingressSpeedKts} onChange={(n) => onPatch({ ingressSpeedKts: n })} />
      </div>
    </div>
  );
}

function Field({ label, v, onChange, step = 1 }: { label: string; v: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      <input type="number" value={v} step={step}
             onChange={(e) => onChange(Number(e.target.value))}
             style={inp} />
    </label>
  );
}

const inp: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 4,
  color: '#e0e0e0', fontSize: 12, padding: '5px 7px', fontFamily: 'inherit', outline: 'none',
};
const btn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #4a4a4a', color: '#cccccc',
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
};
const btnDel: React.CSSProperties = {
  background: 'transparent', border: '1px solid #5a3a3a', color: '#d95050',
  width: 24, height: 22, borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, lineHeight: 1,
};
