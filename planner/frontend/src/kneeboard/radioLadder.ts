/**
 * Build a comm LADDER — the frequencies a flight dials, in the order it
 * dials them.
 *
 * The card this replaces listed every group in the coalition sorted into
 * role tiers: 41 rows, a roster rather than a ladder. Nobody reads a comm
 * card that way. A ladder walks the sortie — start-up, tower, departure,
 * check-in, tactical, tanker, AWACS, recovery, guard — so a pilot can work
 * down it as the flight progresses.
 *
 * Every row is derived from the mission: field radios from the theater
 * airfield data, the C2 net from the SOP, tankers and AWACS from the groups
 * carrying those tasks, and the flight's own frequency from its group.
 * Nothing needs typing in. Rows the mission cannot answer are dropped rather
 * than printed as blanks — an empty row on a kneeboard is noise.
 */

import type { Airbase, MissionGroup } from '../types/mission';
import { toMhz } from '../utils/frequency';

/** Ordering is the point of this card — the numbers are the ladder. */
export const PHASES = [
  'GROUND', 'TOWER', 'DEPARTURE', 'CHECK-IN', 'TACTICAL',
  'AWACS', 'TANKER', 'MARSHAL', 'RECOVERY', 'GUARD',
] as const;

export type LadderPhase = typeof PHASES[number];

export interface LadderRow {
  /** Stable across rebuilds so a saved custom order keeps matching. */
  id: string;
  phase: LadderPhase;
  /** Who you are talking to. */
  agency: string;
  /** 0 when the mission carries no frequency for this agency — a carrier's
   *  comms live in the squadron SOP, not the .miz. The rung still earns its
   *  place when it carries a TACAN. */
  freqMhz: number;
  modulation: number;
  /** TACAN or other tag worth carrying alongside the frequency. */
  note?: string;
}

const CARRIER_RE = /CVN|CV_|LHA|LHD|Stennis|Forrestal|Kuznetsov|Vinson|Roosevelt|Truman|Washington|Lincoln/i;

/** SOP roles that mean "the controlling agency you check in with". */
const COMMAND_RE = /command|strike|check.?in|c2|control/i;

/** SOP roles for the recovery stack. */
const MARSHAL_RE = /marshal|approach|paddles|lso/i;
const BOAT_TOWER_RE = /boat.?tower|cv.?tower|mother/i;

/** International emergency frequencies. Always the bottom rung. */
const GUARD_UHF = 243.0;

interface BuildInput {
  /** The flight this ladder is for. Drives home plate and intra-flight. */
  group?: MissionGroup;
  /** Every group in the mission, for tankers/AWACS/carriers. */
  allGroups: MissionGroup[];
  coalition: string;
  airbases: Airbase[];
  sopComms: { role: string; frequency: number }[];
}

function nmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * 60;
  const dLon = (aLon - bLon) * 60 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** The airfield a waypoint sits on, if any. */
function fieldAt(airbases: Airbase[], lat?: number, lon?: number): Airbase | undefined {
  if (lat == null || lon == null) return undefined;
  let best: Airbase | undefined;
  let bestDist = 5; // nm — beyond this it is not "at" the field
  for (const a of airbases) {
    if (a.lat == null || a.lon == null) continue;
    const d = nmBetween(lat, lon, a.lat, a.lon);
    if (d < bestDist) { bestDist = d; best = a; }
  }
  return best;
}

export function buildRadioLadder(input: BuildInput): LadderRow[] {
  const { group, allGroups, coalition, airbases, sopComms } = input;
  const rows: LadderRow[] = [];
  const push = (r: LadderRow) => {
    // A rung needs to tell the pilot something: a frequency, or failing that
    // a TACAN.
    if (r.freqMhz <= 0 && !r.note) return;

    // One rung per frequency per phase — a field whose ground and tower share
    // a radio should not eat two. But when several AGENCIES share a frequency
    // (a squadron running every tanker on one push), dropping the duplicates
    // silently hid every callsign but the first. Name them all on the one
    // rung instead: the frequency is shared, the callsigns are not.
    const existing = r.freqMhz > 0
      ? rows.find((x) => x.freqMhz === r.freqMhz && x.phase === r.phase)
      : undefined;
    if (existing) {
      if (!existing.agency.split(' / ').includes(r.agency)) {
        existing.agency = `${existing.agency} / ${r.agency}`;
      }
      if (r.note && !existing.note?.includes(r.note)) {
        existing.note = existing.note ? `${existing.note} · ${r.note}` : r.note;
      }
      return;
    }
    rows.push(r);
  };

  const wps = group?.waypoints || [];
  const home = fieldAt(airbases, wps[0]?.lat, wps[0]?.lon);
  const last = wps[wps.length - 1];
  const recoveryField = fieldAt(airbases, last?.lat, last?.lon);

  // --- departure -------------------------------------------------------
  if (home?.atc_radio) {
    const r = home.atc_radio;
    // DCS gives a field one ATC radio set rather than split ground/tower/
    // departure positions, so the same numbers serve each rung. Listing the
    // rung is still what makes the card readable in sequence.
    if (r.uhf_mhz) push({ id: 'gnd', phase: 'GROUND', agency: `${home.name} Ground`, freqMhz: r.uhf_mhz, modulation: 0 });
    if (r.uhf_mhz) push({ id: 'twr', phase: 'TOWER', agency: `${home.name} Tower`, freqMhz: r.uhf_mhz, modulation: 0 });
    if (r.vhf_high_mhz) push({ id: 'twr-v', phase: 'TOWER', agency: `${home.name} Tower (VHF)`, freqMhz: r.vhf_high_mhz, modulation: 0 });
  }

  // --- check-in with the controlling agency ----------------------------
  // SOP frequencies bypass the mission parser, so normalise here — a sheet
  // read by the vision extractor can come back in Hz.
  for (const c of sopComms.filter((c) => COMMAND_RE.test(c.role) && c.frequency > 0)) {
    push({ id: `cmd-${c.role}`, phase: 'CHECK-IN', agency: c.role, freqMhz: toMhz(c.frequency), modulation: 0 });
  }

  // --- the flight's own net --------------------------------------------
  if (group && group.frequency > 0) {
    push({
      id: 'tac', phase: 'TACTICAL', agency: `${group.groupName} (intra-flight)`,
      freqMhz: group.frequency, modulation: group.modulation,
    });
  }

  const friendly = allGroups.filter((g) => g.coalition === coalition && g.frequency > 0);

  // --- AWACS -----------------------------------------------------------
  for (const g of friendly.filter((g) => (g.task || '').toLowerCase() === 'awacs')) {
    push({ id: `awacs-${g.groupId}`, phase: 'AWACS', agency: g.groupName, freqMhz: g.frequency, modulation: g.modulation });
  }

  // --- tankers, nearest to the route first -----------------------------
  const tankers = friendly.filter((g) => (g.task || '').toLowerCase() === 'refueling');
  for (const g of tankers) {
    push({
      id: `tkr-${g.groupId}`, phase: 'TANKER', agency: g.groupName,
      freqMhz: g.frequency, modulation: g.modulation,
      note: g.tacan ? `${g.tacan.channel}${g.tacan.band}` : undefined,
    });
  }

  // --- recovery --------------------------------------------------------
  // A flight parked on a boat carries `link_unit` — the unit id of its actual
  // mother. This mission has three carriers, so picking "the first carrier in
  // the coalition" would have sent Bengal-3 to the wrong deck. Fall back to
  // any carrier only when the flight is not deck-launched.
  const motherUnit = wps[0]?.link_unit;
  const allShips = allGroups.filter(
    (g) => g.coalition === coalition && g.category === 'ship'
      && (g.units || []).some((u) => CARRIER_RE.test(u.type || '')));
  const carrier = (motherUnit != null
    ? allShips.find((g) => (g.units || []).some((u) => u.unitId === motherUnit))
    : undefined) ?? (motherUnit != null ? undefined : allShips[0]);

  if (carrier) {
    // Marshal/tower for the boat live in the SOP; the .miz gives a carrier no
    // group frequency at all.
    for (const c of sopComms.filter((c) => MARSHAL_RE.test(c.role) && c.frequency > 0)) {
      push({ id: `mar-${c.role}`, phase: 'MARSHAL', agency: c.role, freqMhz: toMhz(c.frequency), modulation: 0 });
    }
    for (const c of sopComms.filter((c) => BOAT_TOWER_RE.test(c.role) && c.frequency > 0)) {
      push({ id: `cvt-${c.role}`, phase: 'RECOVERY', agency: c.role, freqMhz: toMhz(c.frequency), modulation: 0 });
    }
  }
  if (carrier) {
    // A carrier's radio lives on the UNIT, not the group — the group reads 0.
    // Prefer the deck the flight is actually tied to.
    const deck = (carrier.units || []).find((u) => u.unitId === motherUnit)
      ?? (carrier.units || []).find((u) => CARRIER_RE.test(u.type || ''));
    push({
      id: `rec-cv-${carrier.groupId}`, phase: 'RECOVERY', agency: carrier.groupName,
      freqMhz: carrier.frequency > 0 ? carrier.frequency : (deck?.frequency ?? 0),
      modulation: carrier.modulation,
      note: carrier.tacan
        ? `${carrier.tacan.channel}${carrier.tacan.band}${carrier.tacan.callsign ? ' ' + carrier.tacan.callsign : ''}`
        : undefined,
    });
  }
  if (recoveryField?.atc_radio?.uhf_mhz && recoveryField.name !== home?.name) {
    push({
      id: 'rec-fld', phase: 'RECOVERY', agency: `${recoveryField.name} Tower`,
      freqMhz: recoveryField.atc_radio.uhf_mhz, modulation: 0,
    });
  }

  // --- guard -----------------------------------------------------------
  push({ id: 'guard', phase: 'GUARD', agency: 'GUARD', freqMhz: GUARD_UHF, modulation: 0 });

  return sortByPhase(rows);
}

function sortByPhase(rows: LadderRow[]): LadderRow[] {
  return [...rows].sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
}

/**
 * Apply a planner's custom rung order.
 *
 * `order` is a list of row ids. Ids no longer present are ignored (the
 * mission changed under the saved order) and rows the order does not mention
 * keep their derived position at the end, so a stale order degrades into a
 * partial preference instead of dropping rungs.
 */
export function applyLadderOrder(rows: LadderRow[], order?: string[]): LadderRow[] {
  if (!order?.length) return rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: LadderRow[] = [];
  for (const id of order) {
    const row = byId.get(id);
    if (row) { out.push(row); byId.delete(id); }
  }
  return [...out, ...byId.values()];
}
