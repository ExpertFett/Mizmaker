/**
 * PopupAttackCard — kneeboard reference for a popup / lay-down attack profile.
 *
 * Renders the side profile (altitude vs along-track distance) with labelled
 * reference points (IP / AP / PDP / RP / TGT / REC) above a parameter table.
 * One card per profile; the Kneeboard tab paginates when several profiles
 * are configured.
 *
 * Reference points are produced by utils/popupAttack.ts — the math module
 * is decoupled so testers can verify the geometry independently.
 */

import { cardRoot, headerStyle, titleStyle, subtitleStyle, sectionTitle, footerStyle, BORDER, TEXT, DIM, ACCENT, FONT, MissionDateLine } from './cardStyles';
import type { MissionOverviewData } from '../types/mission';
import { computePopupAttack, ATTACK_TYPE_LABEL, type PopupAttackInput, type AttackPoint } from '../utils/popupAttack';

const POINT_COLOR: Record<string, string> = {
  IP:  '#4a9eff',
  AP:  '#e8833a',
  PDP: '#3fb950',
  RP:  '#c090d0',
  TGT: '#d95050',
  REC: '#d29922',
};

interface PopupAttackCardProps {
  input: PopupAttackInput;
  overview?: MissionOverviewData;
  /** Display index (1-based) when several profiles ride along — e.g. "(2/3)". */
  index?: number;
  total?: number;
}

export function PopupAttackCard({ input, overview, index, total }: PopupAttackCardProps) {
  const profile = computePopupAttack(input);

  // Chart dimensions inside the card content area.
  const CHART_W = 560;
  const CHART_H = 260;
  const PAD_L = 60, PAD_R = 24, PAD_T = 16, PAD_B = 36;

  const xs = profile.points.map((p) => p.distanceNm);
  const ys = profile.points.map((p) => p.altitudeFtMsl);
  const xMin = 0;
  const xMax = Math.max(...xs, 1);
  const yMin = Math.min(...ys, input.targetElevationFt);
  const yMax = Math.max(...ys, input.popupAltitudeFtMsl + 500);
  const yRange = Math.max(1, yMax - yMin);
  const xRange = Math.max(1, xMax - xMin);

  const px = (d: number) => PAD_L + ((d - xMin) / xRange) * (CHART_W - PAD_L - PAD_R);
  const py = (a: number) => CHART_H - PAD_B - ((a - yMin) / yRange) * (CHART_H - PAD_T - PAD_B);

  // Build the trajectory polyline. The TGT point sits at ground level and
  // shouldn't bend the aircraft trajectory line; skip it for the polyline
  // and render it separately as a marker on the ground.
  const trajectory = profile.points.filter((p) => p.label !== 'TGT');
  const pathD = trajectory.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.distanceNm).toFixed(1)} ${py(p.altitudeFtMsl).toFixed(1)}`).join(' ');

  // Y-axis gridlines / labels — 4 ticks, rounded to nearest 1000 ft.
  const yTicks: number[] = [];
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    const v = yMin + (yRange * i) / tickCount;
    yTicks.push(Math.round(v / 500) * 500);
  }
  const xTicks: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const v = xMin + (xRange * i) / 6;
    xTicks.push(Number(v.toFixed(1)));
  }

  return (
    <div style={cardRoot}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          POPUP ATTACK
          {total && total > 1 ? <span style={{ fontSize: 15, color: DIM, marginLeft: 8 }}>({index}/{total})</span> : null}
          <span style={{ fontSize: 14, color: ACCENT, marginLeft: 10, fontWeight: 700, border: `1px solid ${ACCENT}`, borderRadius: 3, padding: '1px 7px' }}>
            {ATTACK_TYPE_LABEL[input.attackType]}
          </span>
        </div>
        <div style={subtitleStyle}>
          {input.name || 'Attack profile'} · TGT elev {input.targetElevationFt.toLocaleString()} ft ·
          {' '}TTT ~{Math.round(profile.totals.timeToTargetSec)}s
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Side-profile chart */}
      <div style={sectionTitle}>SIDE PROFILE</div>
      <div style={{ padding: '6px 16px', borderBottom: `1px solid ${BORDER}` }}>
        <svg width={CHART_W} height={CHART_H} style={{ display: 'block', background: 'rgba(0,0,0,0.25)', borderRadius: 4 }}>
          {/* Grid */}
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD_L} y1={py(v)} x2={CHART_W - PAD_R} y2={py(v)} stroke="#2a2a2a" strokeWidth={1} />
              <text x={PAD_L - 6} y={py(v) + 4} fontSize={11} fontFamily={FONT} fill={DIM} textAnchor="end">
                {v.toLocaleString()}
              </text>
            </g>
          ))}
          {xTicks.map((v) => (
            <g key={`x${v}`}>
              <line x1={px(v)} y1={PAD_T} x2={px(v)} y2={CHART_H - PAD_B} stroke="#222222" strokeWidth={1} />
              <text x={px(v)} y={CHART_H - PAD_B + 14} fontSize={11} fontFamily={FONT} fill={DIM} textAnchor="middle">
                {v}
              </text>
            </g>
          ))}
          {/* Axis labels */}
          <text x={PAD_L - 44} y={CHART_H / 2} fontSize={11} fontFamily={FONT} fill={DIM}
                transform={`rotate(-90, ${PAD_L - 44}, ${CHART_H / 2})`} textAnchor="middle">
            Altitude (ft MSL)
          </text>
          <text x={(CHART_W + PAD_L - PAD_R) / 2} y={CHART_H - 6} fontSize={11} fontFamily={FONT} fill={DIM} textAnchor="middle">
            Distance (NM)
          </text>

          {/* Ground line (target elevation) */}
          <line x1={PAD_L} y1={py(input.targetElevationFt)} x2={CHART_W - PAD_R} y2={py(input.targetElevationFt)}
                stroke="#5a3a2a" strokeWidth={1.5} strokeDasharray="4 3" />

          {/* Trajectory polyline */}
          <path d={pathD} fill="none" stroke={ACCENT} strokeWidth={2.5} />

          {/* Reference-point markers */}
          {profile.points.map((p, i) => {
            const color = POINT_COLOR[p.label] || ACCENT;
            const x = px(p.distanceNm);
            const y = py(p.altitudeFtMsl);
            const labelAbove = p.label !== 'TGT';
            return (
              <g key={`pt${i}-${p.label}`}>
                <circle cx={x} cy={y} r={5} fill={color} stroke="#000" strokeWidth={1.2} />
                <text x={x} y={labelAbove ? y - 10 : y + 18}
                      fontSize={11} fontWeight={700} fontFamily={FONT} fill={color}
                      stroke="#0d131d" strokeWidth={2.5} paintOrder="stroke" textAnchor="middle">
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Parameter table */}
      <div style={sectionTitle}>REFERENCE POINTS</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
        <thead>
          <tr style={{ background: 'rgba(255,165,0,0.08)' }}>
            <th style={th}>PT</th>
            <th style={th}>DIST (NM)</th>
            <th style={th}>ALT (ft MSL)</th>
            <th style={{ ...th, textAlign: 'left' }}>NOTE</th>
          </tr>
        </thead>
        <tbody>
          {profile.points.map((p, i) => (
            <PointRow key={i} pt={p} idx={i} />
          ))}
        </tbody>
      </table>

      {/* Parameter summary */}
      <div style={sectionTitle}>PARAMETERS</div>
      <div style={{ padding: '6px 16px', fontSize: 14, color: TEXT, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 18px', flexShrink: 0 }}>
        <Param k="VIP distance"   v={`${input.vipDistanceNm} NM`} />
        <Param k="Target elev"    v={`${input.targetElevationFt.toLocaleString()} ft MSL`} />
        <Param k="Popup alt"      v={`${input.popupAltitudeFtMsl.toLocaleString()} ft MSL`} />
        <Param k="Popup angle"    v={`${input.popupAngleDeg}°`} />
        <Param k="Dive angle"     v={`${input.diveAngleDeg}°`} />
        <Param k="Angle offset"   v={`${input.angleOffsetDeg}°`} />
        <Param k="Release alt"    v={`${input.releaseAltitudeFtAgl.toLocaleString()} ft AGL`} />
        <Param k="Release speed"  v={`${input.releaseSpeedKts} kt`} />
        <Param k="Ingress alt"    v={`${input.ingressAltitudeFtAgl.toLocaleString()} ft AGL`} />
        <Param k="Ingress speed"  v={`${input.ingressSpeedKts} kt`} />
      </div>

      <div style={footerStyle}>Generated by DCS:OPT | VMFA-224(AW)</div>
    </div>
  );
}

function PointRow({ pt, idx }: { pt: AttackPoint; idx: number }) {
  const color = POINT_COLOR[pt.label] || ACCENT;
  return (
    <tr style={{ background: idx % 2 ? 'rgba(255,165,0,0.04)' : 'transparent' }}>
      <td style={{ ...td, color, fontWeight: 700, textAlign: 'center' }}>{pt.label}</td>
      <td style={{ ...td, textAlign: 'center' }}>{pt.distanceNm.toFixed(1)}</td>
      <td style={{ ...td, textAlign: 'center' }}>{pt.altitudeFtMsl.toLocaleString()}</td>
      <td style={td}>{pt.note || ''}</td>
    </tr>
  );
}

function Param({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px dashed #2a2a2a`, padding: '2px 0' }}>
      <span style={{ color: DIM }}>{k}</span>
      <span style={{ color: TEXT, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

const th: React.CSSProperties = { padding: '4px 8px', fontSize: 12, fontWeight: 700, color: TEXT, borderBottom: `1px solid ${BORDER}`, textAlign: 'center', fontFamily: FONT };
const td: React.CSSProperties = { padding: '4px 8px', fontSize: 14, color: TEXT, fontFamily: FONT, borderBottom: `1px solid rgba(255,255,255,0.04)` };

/** Page-count helper for the Kneeboard tab — one card per profile. */
export function popupAttackCardCount(profiles: PopupAttackInput[]): number {
  return profiles.length;
}
