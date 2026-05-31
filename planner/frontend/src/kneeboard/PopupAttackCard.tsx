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
import { computePopupAttack, ATTACK_TYPE_LABEL, ATTACK_TYPE_DESC, type PopupAttackInput, type AttackPoint } from '../utils/popupAttack';

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
        <div style={{ fontSize: 12, color: DIM, marginTop: 2, fontStyle: 'italic' }}>
          {ATTACK_TYPE_DESC[input.attackType]}
        </div>
        {overview && <MissionDateLine date={overview.date} startTime={overview.start_time} theater={overview.theater} showTheater />}
      </div>

      {/* Top-down (plan) view — shows the angle offset relative to the run-in
          line and the target ahead. Mirrors the side-profile distances along
          the run-in axis so the two charts are visually consistent. */}
      <div style={sectionTitle}>PLAN VIEW</div>
      <div style={{ padding: '6px 16px', borderBottom: `1px solid ${BORDER}` }}>
        <PlanView profile={profile} input={input} />
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

/**
 * Plan-view (top-down) chart for the attack run.
 *
 * Convention: target at the right edge of the chart (since the pilot is
 * approaching from the left at the IP). The run-in axis is along X with
 * the angle offset applied — IP at top-left, then a turn-in toward the
 * target through the AP. PDP / RP / TGT lie along the offset line from
 * the AP into the target. Distances are scaled so the side profile and
 * plan view share the same horizontal scale where possible.
 */
function PlanView({ profile, input }: { profile: ReturnType<typeof computePopupAttack>; input: PopupAttackInput }) {
  const CHART_W = 560;
  const CHART_H = 200;
  const PAD = 30;

  // Distance from target back to the IP. Use the same range as the side
  // chart so the eye carries between the two views.
  const maxDist = Math.max(...profile.points.map((p) => p.distanceNm), 1);
  const ip = profile.points.find((p) => p.label === 'IP');
  const ap = profile.points.find((p) => p.label === 'AP');
  const pdp = profile.points.find((p) => p.label === 'PDP');
  const rp = profile.points.find((p) => p.label === 'RP');
  const tgt = profile.points.find((p) => p.label === 'TGT');
  const rec = profile.points.find((p) => p.label === 'REC');

  // Place TGT at the chart right edge. The X axis is along the target-run axis.
  const xScale = (CHART_W - 2 * PAD) / maxDist;
  // Convert (along-track NM, lateral NM) → (px, px). North is up (Y -); the
  // attack run is east-bound (X +). The IP-to-AP leg is offset off the
  // target run line by `angleOffsetDeg`; the AP-to-TGT leg lines up with
  // the target's heading.
  const xy = (alongNm: number, lateralNm: number): [number, number] => {
    const x = PAD + (maxDist - alongNm) * xScale;        // mirror: tgt at right
    // Negative lateral = north of run line on the chart; we draw with screen Y
    // increasing downward, so flip.
    const y = CHART_H / 2 - lateralNm * xScale;
    return [x, y];
  };

  // Compute lateral offset of the IP from the AP using the angleOffsetDeg.
  // IP is `apDist - ipDist` NM "behind" the AP along the run-in axis; lateral
  // = (run-in length) * sin(offset). At the AP and beyond, lateral = 0.
  const ipDist = ip?.distanceNm ?? 0;
  const apDist = ap?.distanceNm ?? 0;
  const runInLenNm = Math.max(0, apDist - ipDist);
  const offsetRad = (Math.max(0, Math.min(85, input.angleOffsetDeg)) * Math.PI) / 180;
  const ipLatNm = runInLenNm * Math.sin(offsetRad);     // perpendicular offset

  type PV = { label: string; along: number; lat: number; color: string; note?: string };
  const pvPoints: PV[] = [];
  if (ip) pvPoints.push({ label: 'IP', along: ip.distanceNm, lat: ipLatNm, color: POINT_COLOR.IP });
  if (ap) pvPoints.push({ label: 'AP', along: ap.distanceNm, lat: 0, color: POINT_COLOR.AP });
  if (pdp) pvPoints.push({ label: 'PDP', along: pdp.distanceNm, lat: 0, color: POINT_COLOR.PDP });
  if (rp) pvPoints.push({ label: 'RP', along: rp.distanceNm, lat: 0, color: POINT_COLOR.RP });
  if (tgt) pvPoints.push({ label: 'TGT', along: tgt.distanceNm, lat: 0, color: POINT_COLOR.TGT });
  if (rec) pvPoints.push({ label: 'REC', along: rec.distanceNm, lat: 0, color: POINT_COLOR.REC });

  const pathD = pvPoints.filter((p) => p.label !== 'TGT').map((p, i) => {
    const [x, y] = xy(p.along, p.lat);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  // Target-axis crosshair (extends the target heading through the TGT marker).
  const tgtMarker = tgt ? xy(tgt.distanceNm, 0) : [CHART_W - PAD, CHART_H / 2] as [number, number];

  return (
    <svg width={CHART_W} height={CHART_H} style={{ display: 'block', background: 'rgba(0,0,0,0.25)', borderRadius: 4 }}>
      {/* X axis (run line) */}
      <line x1={PAD} y1={CHART_H / 2} x2={CHART_W - PAD} y2={CHART_H / 2} stroke="#2a2a2a" strokeWidth={1} />
      {/* Target-axis crosshair (the bearing the attacker is running ON to TGT) */}
      <line x1={tgtMarker[0] - 22} y1={tgtMarker[1]} x2={tgtMarker[0] + 22} y2={tgtMarker[1]} stroke="#5a3a2a" strokeWidth={1} strokeDasharray="3 3" />
      <line x1={tgtMarker[0]} y1={tgtMarker[1] - 22} x2={tgtMarker[0]} y2={tgtMarker[1] + 22} stroke="#5a3a2a" strokeWidth={1} strokeDasharray="3 3" />
      {/* North arrow corner */}
      <g transform={`translate(${CHART_W - 36}, ${PAD - 6})`}>
        <line x1={0} y1={14} x2={0} y2={-2} stroke={DIM} strokeWidth={1.4} />
        <polygon points="0,-6 -3,2 3,2" fill={DIM} />
        <text x={0} y={24} fontSize={10} fontFamily={FONT} fill={DIM} textAnchor="middle">N</text>
      </g>

      {/* Run-in path */}
      <path d={pathD} fill="none" stroke={ACCENT} strokeWidth={2.5} />

      {/* Scale ticks (every NM) along the run line */}
      {Array.from({ length: Math.ceil(maxDist) + 1 }, (_, i) => i).map((nm) => {
        if (nm > maxDist) return null;
        const [x, y] = xy(nm, 0);
        return (
          <g key={`tick-${nm}`}>
            <line x1={x} y1={y - 3} x2={x} y2={y + 3} stroke="#3a3a3a" strokeWidth={1} />
            {nm % 2 === 0 && <text x={x} y={y + 14} fontSize={9} fontFamily={FONT} fill={DIM} textAnchor="middle">{nm}</text>}
          </g>
        );
      })}

      {/* Reference markers */}
      {pvPoints.map((p, i) => {
        const [x, y] = xy(p.along, p.lat);
        return (
          <g key={`pv-${i}-${p.label}`}>
            <circle cx={x} cy={y} r={p.label === 'TGT' ? 7 : 5} fill={p.color} stroke="#000" strokeWidth={1.2} />
            {p.label === 'TGT' && <circle cx={x} cy={y} r={11} fill="none" stroke={p.color} strokeWidth={1.2} />}
            <text x={x + 8} y={y - 6} fontSize={11} fontWeight={700} fontFamily={FONT} fill={p.color}
                  stroke="#0d131d" strokeWidth={2.5} paintOrder="stroke">{p.label}</text>
          </g>
        );
      })}

      {/* Offset annotation */}
      {input.angleOffsetDeg > 0 && ip && ap && (
        <text x={(xy(ip.distanceNm, ipLatNm)[0] + xy(ap.distanceNm, 0)[0]) / 2}
              y={(xy(ip.distanceNm, ipLatNm)[1] + xy(ap.distanceNm, 0)[1]) / 2 - 6}
              fontSize={10} fontFamily={FONT} fill={DIM} textAnchor="middle">
          {input.angleOffsetDeg}° offset
        </text>
      )}

      {/* Caption */}
      <text x={CHART_W - PAD} y={CHART_H - 6} fontSize={10} fontFamily={FONT} fill={DIM} textAnchor="end">
        TGT axis (right) · run-in (left) · scale: NM
      </text>
    </svg>
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
