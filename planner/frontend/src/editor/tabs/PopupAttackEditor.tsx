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
import { AIRCRAFT_PRESET_LABEL, AIRCRAFT_NOTES, applyAircraftPreset, type AircraftPreset } from '../../utils/popupAttackPresets';

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0' }}>
          Popup Attack Profiles
          <span style={{ color: '#888', fontWeight: 400, marginLeft: 6 }}>— {profiles.length} defined (one card each)</span>
        </span>
        <button onClick={add} style={btn}>+ Add profile</button>
        {profiles.length > 0 && (
          <button
            onClick={() => { if (window.confirm(`Clear all ${profiles.length} popup attack profile(s)?`)) onChange([]); }}
            title="Clear every profile (also clears the localStorage backup)"
            style={{ ...btn, borderColor: '#5a3a3a', color: '#d95050' }}>
            Clear all
          </button>
        )}
      </div>
      <div style={{ fontSize: 10, color: '#666', marginBottom: 8, fontStyle: 'italic' }}>
        Profiles persist across page reloads + mission re-uploads (stored in your browser only).
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
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
        <select
          value={profile.aircraft || ''}
          onChange={(e) => onPatch({ aircraft: e.target.value || undefined })}
          title="Airframe preset — sets ingress/apex/release per NATOPS bracket"
          style={{ ...inp, width: 170 }}>
          <option value="">— Generic NATO —</option>
          {(Object.keys(AIRCRAFT_PRESET_LABEL) as AircraftPreset[]).map((k) => (
            <option key={k} value={k}>{AIRCRAFT_PRESET_LABEL[k]}</option>
          ))}
        </select>
        <button
          onClick={() => {
            // "Load airframe defaults" — bake the per-aircraft preset into the
            // editable fields so the planner sees the numbers update. Falls
            // back to the generic per-type baseline when no aircraft chosen.
            const seed = defaultPopupAttack(profile.name || `Attack ${idx + 1}`, profile.attackType, profile.aircraft);
            const d = applyAircraftPreset(seed, profile.aircraft as AircraftPreset | undefined);
            // Preserve the few "scenario" fields the planner has likely tuned
            // to the target (elev, run-in distance, offset) — only blow away
            // the geometry / speeds the airframe controls.
            onPatch({
              popupAltitudeFtMsl: d.popupAltitudeFtMsl,
              popupAngleDeg: d.popupAngleDeg,
              diveAngleDeg: d.diveAngleDeg,
              releaseAltitudeFtAgl: d.releaseAltitudeFtAgl,
              releaseSpeedKts: d.releaseSpeedKts,
              ingressAltitudeFtAgl: d.ingressAltitudeFtAgl,
              ingressSpeedKts: d.ingressSpeedKts,
              recoveryAltitudeFtAgl: d.recoveryAltitudeFtAgl,
              vipDistanceNm: d.vipDistanceNm,
            });
          }}
          title={profile.aircraft
            ? `Reset altitudes/angles/speeds to ${AIRCRAFT_PRESET_LABEL[profile.aircraft as AircraftPreset] || profile.aircraft} ${ATTACK_TYPE_LABEL[profile.attackType]} defaults`
            : `Reset altitudes/angles to generic defaults for ${ATTACK_TYPE_LABEL[profile.attackType]}`}
          style={{ ...btn, padding: '4px 7px', fontSize: 11 }}>↺</button>
        <span style={{ flex: 1, fontSize: 11, color: '#888', textAlign: 'right', minWidth: 200 }}>
          TTT ~{Math.round(prof.totals.timeToTargetSec)}s · popup {prof.totals.popupDistanceNm.toFixed(1)} NM · dive {prof.totals.diveDistanceNm.toFixed(1)} NM
        </span>
        <button onClick={onRemove} style={btnDel} title="Remove profile">×</button>
      </div>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 6, paddingLeft: 2 }}>{ATTACK_TYPE_DESC[profile.attackType]}</div>
      {profile.aircraft && AIRCRAFT_NOTES[profile.aircraft as AircraftPreset] && (
        <div style={{ fontSize: 10, color: '#7ab87a', marginBottom: 6, paddingLeft: 2, fontStyle: 'italic' }}>
          ✈ {AIRCRAFT_PRESET_LABEL[profile.aircraft as AircraftPreset]}: {AIRCRAFT_NOTES[profile.aircraft as AircraftPreset]}
        </div>
      )}
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
