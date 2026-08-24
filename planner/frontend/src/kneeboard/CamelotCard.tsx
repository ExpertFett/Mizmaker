/**
 * Camelot Kneeboard — the squadron's own flight-card layout, auto-filled.
 *
 * Built from a photographed squadron card: a printed white grid with black
 * section headers and orange accents, meant to be readable in daylight and
 * written on. Every cell the mission can answer is filled — crew with tail
 * numbers, IFF, the laser ladder, radio presets, flight plan, home field,
 * tanker line — and every cell it cannot stays a blank box, because a blank
 * box on this card is a feature: it is where the flight lead writes.
 *
 * Deliberately single-theme. The original is a piece of paper; this renders
 * as one regardless of the app's night/day setting.
 */

import type {
  MissionGroup, MissionOverviewData, ClientUnit, Airbase,
} from '../types/mission';
import { getAircraftType } from '../utils/groups';
import { assignFlightLaserCodes, DEFAULT_LASER_BASE } from '../sop/flightLaserCodes';
import { presetLabel } from './radioPresets';

/** Per-flight fields the mission cannot answer; typed by the planner in the
 *  Kneeboard tab. Everything absent renders as an empty write-on cell. */
export interface CamelotOverrides {
  event?: string;
  midsA?: string;
  midsB?: string;
  push?: string;
  /** Mode 3 base — crew rows count up from it ("3211" -> 3211..3214). */
  m3Base?: string;
  /** Mode 1, one value for the flight. */
  m1?: string;
}

interface Props {
  group: MissionGroup;
  clientUnits: ClientUnit[];
  allGroups: MissionGroup[];
  airbases: Airbase[];
  overview?: MissionOverviewData;
  overrides?: CamelotOverrides;
  laserCodeBase?: number;
  flightDataOverride?: { tacan?: string; icls?: string; iffM1?: string; iffM3?: string };
  notes?: string;
}

/* Paper palette — fixed on purpose; see header comment. */
const INK = '#111111';
const PAPER = '#ffffff';
const ORANGE = '#e8720c';
const HEAD_BG = '#1a1a1a';
const HEAD_FG = '#ffffff';
const GRID = '#333333';
const FAINT = '#666666';

const cellBase: React.CSSProperties = {
  // border-box, or the paddings inflate every fixed column by ~14px and the
  // one auto column (Pilot) gets crushed to nothing.
  boxSizing: 'border-box',
  border: `1px solid ${GRID}`,
  padding: '2px 6px',
  fontSize: 15,
  color: INK,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const headCell: React.CSSProperties = {
  ...cellBase,
  background: HEAD_BG,
  color: HEAD_FG,
  fontWeight: 700,
  textAlign: 'center',
  fontSize: 13,
};

function fmtDate(date?: string): string {
  // overview.date arrives ISO-ish ("2006-11-08"); the card prints M/D/YYYY.
  if (!date) return '';
  const m = date.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return date;
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

/** Squadron loadout shorthand is not derivable, so compress the pylons into
 *  the closest honest thing: "2xGBU-12 2xAIM-9X". */
function remarkFor(cu: ClientUnit): string {
  const counts = new Map<string, number>();
  for (const p of cu.pylons ?? []) {
    if (!p.name) continue;
    const n = (p.shortName || p.name).replace(/\s*[[(].*$/, '');
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()].map(([n, c]) => `${c}x${n}`).slice(0, 3).join(' ');
}

export function CamelotCard({
  group, clientUnits, allGroups, airbases, overview,
  overrides = {}, laserCodeBase, flightDataOverride, notes,
}: Props) {
  const flightUnits = clientUnits.filter((u) => u.groupName === group.groupName);
  const codes = assignFlightLaserCodes(clientUnits, laserCodeBase ?? DEFAULT_LASER_BASE);
  const rep = flightUnits[0];
  const presets = rep?.radioPresets;

  const m1 = overrides.m1 ?? flightDataOverride?.iffM1 ?? '';
  const m3Base = parseInt(overrides.m3Base ?? flightDataOverride?.iffM3 ?? '', 10);

  // Crew rows always print four lines like the paper card — a short flight
  // leaves write-on blanks.
  const crew = Array.from({ length: Math.max(4, flightUnits.length) }, (_, i) => {
    const cu = flightUnits[i];
    if (!cu) return null;
    return {
      modex: cu.onboardNum || '',
      // The unit name IS the slot callsign in squadron missions
      // ("Bengal-1-1"); the Pilot column stays blank on purpose — who flies
      // which slot is decided at brief time and written in by hand, exactly
      // like the paper card.
      tac: cu.name,
      pilot: '',
      m1,
      m3: Number.isFinite(m3Base) ? String(m3Base + i) : '',
      laser: codes.get(cu.unitId) ?? '',
      remark: remarkFor(cu),
    };
  });

  // Radio presets, per radio. Named channels are what the paper card lists;
  // when a mission names none, the frequency itself stands in — a blank COMM
  // block is worse than one that says 305.000.
  const commRows = (radio: number) => {
    const chans = (presets ?? [])
      .filter((r) => r.radio === radio)
      .flatMap((r) => r.channels);
    const named = chans.filter((c) => (c.name || '').trim());
    const src = named.length > 0 ? named : chans.filter((c) => c.freq_mhz > 0);
    return src.slice(0, 8).map((c) => ({
      ch: String(c.ch),
      name: (c.name || '').trim() || c.freq_mhz.toFixed(3),
    }));
  };
  const comm1 = commRows(1);
  const comm2 = commRows(2);

  // Flight plan straight off the route.
  const plan = (group.waypoints ?? [])
    .filter((w) => w.lat != null)
    .slice(0, 8)
    .map((w) => ({ n: String(w.waypoint_number), name: w.waypoint_name || `WP${w.waypoint_number}` }));

  // Home field: nearest airbase with a runway to WP0.
  const wp0 = group.waypoints?.[0];
  const home = (() => {
    if (wp0?.lat == null || wp0?.lon == null) return null;
    let best: Airbase | null = null; let bd = 0.15;
    for (const a of airbases) {
      if (a.lat == null || a.lon == null || !(a.runways?.length)) continue;
      const d = Math.hypot(a.lat - wp0.lat, (a.lon - wp0.lon) * 0.4);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  })();
  const rwy = home?.runways?.[0];
  const rwyLabel = rwy?.ends?.length
    ? rwy.ends.map((e) => (/^\d$/.test(e) ? `0${e}` : e)).join('/')
    : (rwy?.name ?? '');

  // Tanker line: the coalition's tankers, TACANs joined the way the card
  // writes them ("118Y/119Y"), frequency shown as its preset when programmed.
  const tankers = allGroups.filter(
    (g) => g.coalition === group.coalition && (g.task || '').toLowerCase() === 'refueling');
  // The paper card compresses shared callsigns: "Texaco 1/2", not
  // "Texaco-1 / Texaco-2". Do the same when the tankers share a base name.
  const tankerNames = (() => {
    const named = tankers.slice(0, 2).map((t) => t.groupName);
    const parts = named.map((n) => n.match(/^(.*?)[-\s](\d+)$/));
    if (named.length > 1 && parts.every(Boolean)
        && new Set(parts.map((m) => m![1])).size === 1) {
      return `${parts[0]![1]} ${parts.map((m) => m![2]).join('/')}`;
    }
    return named.join(' / ');
  })();
  const tankerTcn = tankers.map((t) => (t.tacan ? `${t.tacan.channel}${t.tacan.band}` : null))
    .filter(Boolean).slice(0, 2).join('/');
  const tankerFreqPreset = (() => {
    for (const t of tankers) {
      const p = presetLabel(t.frequency, presets);
      if (p) return p.replace(/[()]/g, '');
    }
    const f = tankers[0]?.frequency;
    return f && f > 0 ? f.toFixed(1) : '';
  })();
  const tankerFl = (() => {
    const orbit = tankers[0]?.waypoints?.find((w) => w.altitude_m > 1000);
    return orbit ? String(Math.round(orbit.altitude_m * 3.28084 / 100)) : '';
  })();

  // The middle block is drawn as one 6-column grid so the three sections
  // stay row-aligned like the printed card. Row count covers the longest.
  const midRows = Math.max(8, comm1.length, plan.length);

  return (
    <div style={{
      width: 600, height: 850, background: PAPER, color: INK,
      fontFamily: "'Arial', sans-serif", padding: 10,
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header strip */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            <td style={{ ...cellBase, width: 92, textAlign: 'center', fontWeight: 700 }}>
              {fmtDate(overview?.date)}
            </td>
            <td style={{ ...headCell, width: 62 }}>EVENT</td>
            <td style={{ ...cellBase, width: 120, textAlign: 'center', fontWeight: 700, color: ORANGE, fontSize: 17 }}>
              {overrides.event ?? ''}
            </td>
            <td style={{ ...cellBase, textAlign: 'center', fontWeight: 700 }}>
              {group.groupName}
              <span style={{ fontWeight: 400, color: FAINT, fontSize: 12 }}>
                {' '}{getAircraftType(group).replace(/_/g, ' ').slice(0, 10)}
              </span>
            </td>
            <td style={{ ...headCell, width: 50 }}>MIDS</td>
            <td style={{ ...cellBase, width: 46, textAlign: 'center' }}>A {overrides.midsA ?? ''}</td>
            <td style={{ ...cellBase, width: 46, textAlign: 'center' }}>B {overrides.midsB ?? ''}</td>
          </tr>
        </tbody>
      </table>

      {/* Crew */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: -1 }}>
        <thead>
          <tr>
            <th style={{ ...headCell, width: 50 }}>A/C</th>
            <th style={{ ...headCell, width: 118 }}>TAC C/S</th>
            <th style={headCell}>Pilot</th>
            <th style={{ ...headCell, width: 44 }}>M1</th>
            <th style={{ ...headCell, width: 56 }}>M3</th>
            <th style={{ ...headCell, width: 44 }}>A/A</th>
            <th style={{ ...headCell, width: 56 }}>Laser</th>
            <th style={{ ...headCell, width: 92 }}>Remark</th>
          </tr>
        </thead>
        <tbody>
          {crew.map((c, i) => (
            <tr key={i} style={{ height: 24 }}>
              <td style={{ ...cellBase, textAlign: 'center' }}>{c?.modex ?? ''}</td>
              <td style={cellBase}>{c?.tac ?? ''}</td>
              <td style={cellBase}>{c?.pilot ?? ''}</td>
              <td style={{ ...cellBase, textAlign: 'center' }}>{c?.m1 ?? ''}</td>
              <td style={{ ...cellBase, textAlign: 'center' }}>{c?.m3 ?? ''}</td>
              <td style={{ ...cellBase, textAlign: 'center' }} />
              <td style={{ ...cellBase, textAlign: 'center', fontWeight: 700 }}>{c?.laser ?? ''}</td>
              <td style={{ ...cellBase, fontSize: 13 }}>{c?.remark ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* TIMES | COMM 1 | COMM 2 | FLIGHT PLAN */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: -1 }}>
        <thead>
          <tr>
            <th style={{ ...headCell, width: 118 }} colSpan={2}>TIMES</th>
            <th style={headCell} colSpan={2}>COMM 1</th>
            <th style={{ ...headCell, width: 120 }}>COMM 2</th>
            <th style={headCell} colSpan={2}>FLIGHT PLAN</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: midRows }, (_, i) => {
            const c1 = comm1[i];
            const c2 = comm2[i];
            const fp = plan[i];
            // TIMES column: first row is the push time, the rest are blanks
            // until the airfield block takes over the bottom rows.
            const afRow = i - (midRows - 4);
            const afLabels = home
              ? [
                  { l: home.name, v: '', head: true },
                  { l: 'TCN', v: flightDataOverride?.tacan ?? '' },
                  { l: 'RWY', v: rwyLabel },
                  { l: `ICLS`, v: flightDataOverride?.icls ?? '' },
                ]
              : [];
            const af = afRow >= 0 && afRow < afLabels.length ? afLabels[afRow] : null;
            return (
              <tr key={i} style={{ height: 22 }}>
                {af ? (
                  af.head ? (
                    <td colSpan={2} style={{ ...headCell, textAlign: 'left' }}>{af.l}</td>
                  ) : (
                    <>
                      <td style={{ ...cellBase, width: 58, fontWeight: 700 }}>{af.l}</td>
                      <td style={{ ...cellBase, width: 60, textAlign: 'center' }}>{af.v}</td>
                    </>
                  )
                ) : (
                  <>
                    <td style={{ ...cellBase, width: 58 }}>{i === 0 ? 'Push' : ''}</td>
                    <td style={{ ...cellBase, width: 60, textAlign: 'center', fontWeight: 700 }}>
                      {i === 0 ? (overrides.push ?? '') : ''}
                    </td>
                  </>
                )}
                <td style={{ ...cellBase, width: 36, textAlign: 'center', color: ORANGE, fontWeight: 700 }}>
                  {c1?.ch ?? ''}
                </td>
                <td style={cellBase}>{c1?.name ?? ''}</td>
                <td style={{ ...cellBase }}>
                  {c2 ? `${c2.ch}  ${c2.name}` : ''}
                </td>
                <td style={{ ...cellBase, width: 32, textAlign: 'center', color: ORANGE, fontWeight: 700 }}>
                  {fp?.n ?? ''}
                </td>
                <td style={cellBase}>{fp?.name ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Tanker line */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: -1 }}>
        <tbody>
          <tr style={{ height: 24 }}>
            <td style={{ ...headCell, width: 66 }}>TANKER</td>
            <td style={cellBase}>{tankerNames}</td>
            <td style={{ ...headCell, width: 44 }}>TCN</td>
            <td style={{ ...cellBase, width: 92, textAlign: 'center' }}>{tankerTcn}</td>
            <td style={{ ...headCell, width: 34 }}>FL</td>
            <td style={{ ...cellBase, width: 44, textAlign: 'center' }}>{tankerFl}</td>
            <td style={{ ...headCell, width: 46 }}>Freq</td>
            <td style={{ ...cellBase, width: 56, textAlign: 'center' }}>{tankerFreqPreset}</td>
            <td style={{ ...headCell, width: 44 }}>Take</td>
            <td style={{ ...cellBase, width: 58, textAlign: 'center' }}>as req</td>
          </tr>
        </tbody>
      </table>

      {/* Mission notes — free text, the bottom third of the paper card */}
      <div style={{
        border: `1px solid ${GRID}`, borderTop: 'none', flex: 1, padding: '4px 8px',
        fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        overflow: 'hidden',
      }}>
        <span style={{ fontWeight: 700 }}>Mission Notes: </span>
        {notes ?? ''}
      </div>

      <div style={{ fontSize: 10, color: FAINT, paddingTop: 3, flexShrink: 0 }}>
        {group.groupName} | Generated by DCS:OPT | VMFA-224(AW)
      </div>
    </div>
  );
}
