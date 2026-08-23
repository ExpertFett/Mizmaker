/**
 * Drag-to-build side profile for a popup attack.
 *
 * The numeric editor beside this can already set every parameter, but nobody
 * plans an attack by typing an apex altitude — you draw the profile and read
 * the numbers off it. This renders the computed geometry as a side view and
 * puts handles on the points a planner actually reasons about, writing the
 * drag back into the same PopupAttackInput the form edits. Both views stay
 * live against one source of truth.
 *
 * What each handle means:
 *   AP      horizontal → run-in distance from the action point to the target
 *   PDP     vertical   → apex altitude
 *           horizontal → climb angle (back-solved from the AP→apex leg)
 *   RP      vertical   → release altitude
 *           horizontal → dive angle (back-solved from the apex→release leg)
 *   IP      vertical   → ingress altitude
 *
 * Angles are back-solved rather than dragged directly because the leg on
 * screen IS the angle — moving the release point further out and expecting
 * the dive angle to stay put would make the drawing lie about the geometry.
 *
 * Findings from popupValidation are drawn on the profile, so an unflyable
 * pull-out shows up as a red handle where it happens rather than as a line
 * of text somewhere else.
 */

import { useRef, useState, useCallback } from 'react';
import {
  computePopupAttack, type PopupAttackInput, type AttackPoint,
} from '../../utils/popupAttack';
import { validatePopupAttack, type PopupFinding } from '../../utils/popupValidation';

const FT_PER_NM = 6076.115;

const W = 620;
const H = 260;
const PAD = { left: 52, right: 16, top: 14, bottom: 30 };

/** Handles the planner can grab, keyed by the profile point they sit on. */
type HandleId = 'IP' | 'AP' | 'PDP' | 'RP';

interface Props {
  profile: PopupAttackInput;
  onPatch: (patch: Partial<PopupAttackInput>) => void;
}

/** Degrees of a leg rising `vertFt` over `horizNm`, clamped to something a
 *  jet could fly so a drag past the target cannot produce a 0° or 90° leg. */
function legAngleDeg(vertFt: number, horizNm: number, min: number, max: number): number {
  const horizFt = Math.max(1, horizNm) * FT_PER_NM;
  const deg = (Math.atan2(Math.max(0, vertFt), horizFt) * 180) / Math.PI;
  return Math.min(max, Math.max(min, Math.round(deg)));
}

export function PopupProfileCanvas({ profile, onPatch }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<HandleId | null>(null);

  const computed = computePopupAttack(profile);
  const findings = validatePopupAttack(profile);
  const pts = computed.points;

  // --- scales ----------------------------------------------------------
  const maxDist = Math.max(1, ...pts.map((p) => p.distanceNm));
  const maxAlt = Math.max(profile.popupAltitudeFtMsl, ...pts.map((p) => p.altitudeFtMsl)) * 1.12;
  const minAlt = Math.min(profile.targetElevationFt, ...pts.map((p) => p.altitudeFtMsl));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xOf = (nm: number) => PAD.left + (nm / maxDist) * plotW;
  const yOf = (ft: number) => PAD.top + plotH - ((ft - minAlt) / Math.max(1, maxAlt - minAlt)) * plotH;
  const nmOf = (x: number) => ((x - PAD.left) / plotW) * maxDist;
  const ftOf = (y: number) => minAlt + ((PAD.top + plotH - y) / plotH) * Math.max(1, maxAlt - minAlt);

  const at = (label: string): AttackPoint | undefined => pts.find((p) => p.label === label);

  // --- drag ------------------------------------------------------------
  const applyDrag = useCallback((id: HandleId, nm: number, ft: number) => {
    const tElev = profile.targetElevationFt;
    const ap = pts.find((p) => p.label === 'AP');
    const pdp = pts.find((p) => p.label === 'PDP');

    switch (id) {
      case 'IP':
        // Vertical only — the IP marker is a fixed 5 NM of run-in for context.
        onPatch({ ingressAltitudeFtAgl: Math.max(0, Math.round((ft - tElev) / 50) * 50) });
        break;

      case 'AP':
        // How far out the pull-up happens. The chart's own AP sits at a fixed
        // 5 NM, so this drives the target distance instead.
        onPatch({ vipDistanceNm: Math.max(0.5, Math.round(nm * 2) / 2) });
        break;

      case 'PDP': {
        // Apex altitude, and the climb angle implied by where it now sits
        // relative to the action point.
        const apexMsl = Math.max(tElev + profile.ingressAltitudeFtAgl + 100,
                                 Math.round(ft / 100) * 100);
        const patch: Partial<PopupAttackInput> = { popupAltitudeFtMsl: apexMsl };
        if (ap) {
          patch.popupAngleDeg = legAngleDeg(
            apexMsl - ap.altitudeFtMsl, nm - ap.distanceNm, 5, 60);
        }
        onPatch(patch);
        break;
      }

      case 'RP': {
        // Release altitude, and the dive angle implied by the leg down from
        // the apex.
        const relAgl = Math.max(0, Math.round((ft - tElev) / 100) * 100);
        const patch: Partial<PopupAttackInput> = { releaseAltitudeFtAgl: relAgl };
        if (pdp) {
          patch.diveAngleDeg = legAngleDeg(
            pdp.altitudeFtMsl - (tElev + relAgl), nm - pdp.distanceNm, 5, 75);
        }
        onPatch(patch);
        break;
      }
    }
  }, [profile, pts, onPatch]);

  const onMove = (e: React.MouseEvent) => {
    if (!dragging || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    // The SVG scales to its container, so client px must be mapped back
    // through the viewBox before they mean anything in chart units.
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    applyDrag(dragging, nmOf(x), ftOf(y));
  };

  // --- findings, by the handle they belong to ---------------------------
  const fieldToHandle: Partial<Record<PopupFinding['field'], HandleId>> = {
    ingressAltitudeFtAgl: 'IP',
    vipDistanceNm: 'AP',
    popupAltitudeFtMsl: 'PDP',
    popupAngleDeg: 'PDP',
    releaseAltitudeFtAgl: 'RP',
    diveAngleDeg: 'RP',
  };
  const handleLevel = (id: HandleId): 'error' | 'caution' | null => {
    const mine = findings.filter((f) => fieldToHandle[f.field] === id);
    if (mine.some((f) => f.level === 'error')) return 'error';
    return mine.length ? 'caution' : null;
  };
  const HANDLE_COLOR = { error: '#e06666', caution: '#e0b566' } as const;

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.distanceNm)},${yOf(p.altitudeFtMsl)}`).join(' ');
  const groundY = yOf(profile.targetElevationFt);

  const handles: HandleId[] = profile.attackType === 'type1'
    || profile.attackType === 'type2' || profile.attackType === 'type3'
    ? ['IP', 'AP', 'PDP', 'RP']
    : ['IP', 'AP', 'RP'];

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{
          width: '100%', background: '#141414', border: '1px solid #333333',
          borderRadius: 4, cursor: dragging ? 'grabbing' : 'default',
          touchAction: 'none', userSelect: 'none',
        }}
        onMouseMove={onMove}
        onMouseUp={() => setDragging(null)}
        onMouseLeave={() => setDragging(null)}
      >
        {/* altitude gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const ft = minAlt + f * (maxAlt - minAlt);
          return (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yOf(ft)} y2={yOf(ft)}
                    stroke="#2a2a2a" strokeWidth={1} />
              <text x={PAD.left - 6} y={yOf(ft) + 4} fill="#777777" fontSize={10} textAnchor="end">
                {Math.round(ft / 100) * 100 >= 1000
                  ? `${(Math.round(ft / 100) / 10).toFixed(1)}k`
                  : Math.round(ft / 100) * 100}
              </text>
            </g>
          );
        })}

        {/* ground */}
        <line x1={PAD.left} x2={W - PAD.right} y1={groundY} y2={groundY}
              stroke="#5a4a3a" strokeWidth={2} />

        {/* the profile itself */}
        <path d={path} fill="none" stroke="#7aa7ff" strokeWidth={2} />

        {/* distance axis */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text key={f} x={xOf(f * maxDist)} y={H - 10} fill="#777777" fontSize={10} textAnchor="middle">
            {(f * maxDist).toFixed(1)}
          </text>
        ))}
        <text x={PAD.left} y={H - 10} fill="#555555" fontSize={9} textAnchor="start" />

        {/* fixed markers the planner does not drag */}
        {['TGT', 'REC'].map((label) => {
          const p = at(label);
          if (!p) return null;
          return (
            <g key={label}>
              <circle cx={xOf(p.distanceNm)} cy={yOf(p.altitudeFtMsl)} r={3} fill="#888888" />
              <text x={xOf(p.distanceNm)} y={yOf(p.altitudeFtMsl) - 8}
                    fill="#888888" fontSize={10} textAnchor="middle">{label}</text>
            </g>
          );
        })}

        {/* draggable handles */}
        {handles.map((id) => {
          const p = at(id);
          if (!p) return null;
          const level = handleLevel(id);
          const color = level ? HANDLE_COLOR[level] : '#7aa7ff';
          return (
            <g key={id}
               onMouseDown={(e) => { e.preventDefault(); setDragging(id); }}
               style={{ cursor: 'grab' }}>
              {/* Generous invisible target — a 5px dot is hard to grab. */}
              <circle cx={xOf(p.distanceNm)} cy={yOf(p.altitudeFtMsl)} r={14} fill="transparent" />
              <circle cx={xOf(p.distanceNm)} cy={yOf(p.altitudeFtMsl)} r={6}
                      fill={dragging === id ? color : '#141414'}
                      stroke={color} strokeWidth={2} />
              <text x={xOf(p.distanceNm)} y={yOf(p.altitudeFtMsl) - 12}
                    fill={color} fontSize={11} fontWeight={600} textAnchor="middle">{id}</text>
            </g>
          );
        })}
      </svg>

      <div style={{ display: 'flex', justifyContent: 'space-between',
                    fontSize: 10, color: '#777777', padding: '3px 2px 0' }}>
        <span>Drag IP / AP / PDP / RP. Altitude ft MSL, distance NM along the run.</span>
        <span>
          {Math.round(profile.popupAngleDeg)}° climb · {Math.round(profile.diveAngleDeg)}° dive
        </span>
      </div>

      <PopupFindingsList findings={findings} />
    </div>
  );
}

/** Findings under the chart. Errors first — a profile that cannot be flown
 *  matters more than one that is merely unusual. */
export function PopupFindingsList({ findings }: { findings: PopupFinding[] }) {
  if (findings.length === 0) {
    return (
      <div style={{ fontSize: 11, color: '#7fd97f', padding: '6px 2px 0' }}>
        ✔ Within protocol — geometry closes, pull-out clears, angles in bracket.
      </div>
    );
  }
  const ordered = [...findings].sort(
    (a, b) => Number(b.level === 'error') - Number(a.level === 'error'));
  return (
    <div style={{ padding: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {ordered.map((f, i) => (
        <div key={i} style={{
          fontSize: 11, lineHeight: 1.35,
          color: f.level === 'error' ? '#e06666' : '#e0b566',
          display: 'flex', gap: 6,
        }}>
          <span style={{ fontWeight: 700, flexShrink: 0 }}>
            {f.level === 'error' ? '✖' : '⚠'}
          </span>
          <span>{f.message}</span>
        </div>
      ))}
    </div>
  );
}
