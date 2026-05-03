/**
 * SOP discrepancy engine — pure comparison logic between a loaded
 * mission and an active SOP.
 *
 * Extracted out of SopCheckTab.tsx so the heuristics can be unit
 * tested without rendering React. The tab now imports `buildReport`
 * + types from here and only owns the UI layer.
 *
 * No DOM, no React, no Zustand — just functions over MissionGroup[]
 * and SOP. Easy to fixture-test in Vitest.
 *
 * Categories produced (each adds zero or more DiscrepancyRow entries
 * to the report):
 *   1. Player flight freq      — by callsign first-word match
 *   2. Guard freq              — mission GUARD vs SOP comm role=guard
 *   3. Tanker freq + TACAN     — fuzzy callsign / task match
 *   4. AWACS / support         — by task / callsign
 *   5. Carrier TACAN           — by hull type / callsign / generic CVN
 *   6. Datalink IDs            — player flight order vs SOP priority
 *   7. Laser codes             — informational SOP base reference
 */

import { isPlayerGroup, isCarrierGroup } from '../utils/groups';
import type { MissionGroup } from '../types/mission';
import type {
  SOP, SopFlightCallsign, SopTanker, SopTacanEntry,
} from './types';

export type Severity = 'red' | 'yellow' | 'gray';

export interface DiscrepancyRow {
  category: string;
  field: string;
  missionValue: string;
  sopValue: string;
  severity: Severity;
  /** Optional explanatory text shown in muted color under the row. */
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* Normalisation helpers                                              */
/* ------------------------------------------------------------------ */

/** Mission groups can store frequency in either Hz or MHz depending on how
 *  the .miz was authored. Anything ≥1e6 is Hz; smaller is already MHz. */
export function freqMhz(raw: number | null | undefined): number | null {
  if (raw == null || raw <= 0) return null;
  return raw >= 1e6 ? raw / 1e6 : raw;
}

/** Mission modulation is numeric (0=AM, 1=FM). SOP / DTC carry strings. */
export function modString(raw: number | undefined): 'AM' | 'FM' {
  return raw === 1 ? 'FM' : 'AM';
}

/** Convert any-source freq + mod to a canonical "270.800 AM" string. Returns
 *  '—' when no freq is present so blank cells render visibly. */
export function fmtFreq(mhz: number | null, mod: 'AM' | 'FM'): string {
  if (mhz == null) return '—';
  return `${mhz.toFixed(3)} ${mod}`;
}

/** Two MHz values match if they're within 0.0005 MHz (tighter than the
 *  Hornet's 0.025 step so we still flag intentional 25kHz nudges). */
export function freqsMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.0005;
}

/** Pull the "first word" of a flight name — the part DCS uses as the
 *  callsign root. "Bengal 1" → "bengal", "Enfield-2-1" → "enfield". */
export function firstWord(name: string): string {
  return (name || '').split(/[-\s]/)[0].toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Match heuristics                                                    */
/* ------------------------------------------------------------------ */

/** Match a mission tanker group against the best SOP tanker entry by
 *  callsign substring. Returns the SOP entry or null if no plausible
 *  match. */
export function matchSopTanker(g: MissionGroup, sop: SOP): SopTanker | null {
  if (!sop.tankers || sop.tankers.length === 0) return null;
  const name = g.groupName.toLowerCase();
  for (const t of sop.tankers) {
    const cs = (t.callsign || '').toLowerCase();
    if (cs && (name.includes(cs) || cs.includes(firstWord(g.groupName)))) {
      return t;
    }
  }
  // Fallback: any tanker if there's only one — gives the user a row
  // even when names don't match cleanly.
  return sop.tankers.length === 1 ? sop.tankers[0] : null;
}

/** Find the SOP TACAN entry whose role best describes a carrier group. */
export function matchCarrierTacan(g: MissionGroup, sop: SOP): SopTacanEntry | null {
  if (!sop.tacans || sop.tacans.length === 0) return null;
  const callsign = (g.tacan?.callsign || '').toLowerCase();
  const hullType = (g.units[0]?.type || '').toUpperCase();

  for (const t of sop.tacans) {
    const role = (t.role || '').toLowerCase();
    if (!role) continue;
    if (callsign && role.includes(callsign)) return t;
    if (hullType && role.toUpperCase().includes(hullType)) return t;
    if (/\b(cvn|carrier|home\s*plate|ship)\b/i.test(role)) return t;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Per-category checks                                                 */
/* ------------------------------------------------------------------ */

export function checkPlayerFlightFreqs(
  groups: MissionGroup[],
  sop: SOP,
): DiscrepancyRow[] {
  const out: DiscrepancyRow[] = [];
  const sopByFirstWord = new Map<string, SopFlightCallsign>();
  for (const f of sop.flights) {
    if (!f.callsign) continue;
    sopByFirstWord.set(firstWord(f.callsign), f);
  }

  for (const g of groups) {
    if (!isPlayerGroup(g)) continue;
    if (g.category !== 'plane' && g.category !== 'helicopter') continue;

    const word = firstWord(g.groupName);
    const sopFlight = sopByFirstWord.get(word);
    if (!sopFlight) {
      // Player flight not in SOP — info, not a problem
      out.push({
        category: 'Flight Frequency',
        field: g.groupName,
        missionValue: fmtFreq(freqMhz(g.frequency), modString(g.modulation)),
        sopValue: 'Not in SOP',
        severity: 'gray',
        reason: `Callsign "${g.groupName.split(/[-\s]/)[0]}" not present in SOP flights[].`,
      });
      continue;
    }
    if (!sopFlight.defaultFreq) continue; // SOP has no opinion

    const mzMission = freqMhz(g.frequency);
    const sopFreq = sopFlight.defaultFreq;
    if (!freqsMatch(mzMission, sopFreq)) {
      out.push({
        category: 'Flight Frequency',
        field: g.groupName,
        missionValue: fmtFreq(mzMission, modString(g.modulation)),
        sopValue: fmtFreq(sopFreq, sopFlight.defaultMod ?? 'AM'),
        severity: 'red',
        reason: `Mission radio for ${sopFlight.callsign} differs from SOP default.`,
      });
    }
  }
  return out;
}

export function checkGuardFreq(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  const guardEntry = sop.comms.find((c) => /guard/i.test(c.role));
  if (!guardEntry) return [];

  // Mission "guard" is implicit — DCS doesn't expose a single guard
  // channel as group-level data. Best we can do is check whether any
  // group has a freq matching SOP guard. If none, that's a yellow.
  const sopMhz = guardEntry.frequency;
  const anyMatch = groups.some((g) => freqsMatch(freqMhz(g.frequency), sopMhz));
  if (anyMatch) return []; // someone's tuned to it — fine

  return [{
    category: 'Guard Channel',
    field: 'GUARD',
    missionValue: 'Not assigned to any group',
    sopValue: fmtFreq(sopMhz, guardEntry.modulation ?? 'AM'),
    severity: 'yellow',
    reason: 'No mission group is tuned to the SOP guard frequency. Pilots will need to dial it manually.',
  }];
}

export function checkTankers(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  const out: DiscrepancyRow[] = [];
  const tankers = groups.filter((g) =>
    (g.task || '').toLowerCase() === 'refueling' ||
    /tanker|texaco|shell|arco|exxon/i.test(g.groupName),
  );

  for (const g of tankers) {
    const sopT = matchSopTanker(g, sop);
    if (!sopT) {
      out.push({
        category: 'Tanker',
        field: g.groupName,
        missionValue: fmtFreq(freqMhz(g.frequency), modString(g.modulation)),
        sopValue: 'No matching SOP tanker',
        severity: 'gray',
      });
      continue;
    }

    // Frequency
    if (sopT.frequency) {
      const mz = freqMhz(g.frequency);
      if (!freqsMatch(mz, sopT.frequency)) {
        out.push({
          category: 'Tanker Freq',
          field: g.groupName,
          missionValue: fmtFreq(mz, modString(g.modulation)),
          sopValue: fmtFreq(sopT.frequency, sopT.modulation ?? 'AM'),
          severity: 'red',
          reason: `Matched to SOP tanker "${sopT.callsign}".`,
        });
      }
    }

    // TACAN
    if (sopT.tacanChannel) {
      const ch = g.tacan?.channel ?? null;
      const band = g.tacan?.band ?? null;
      const sopBand = sopT.tacanBand ?? 'X';
      const matches = ch === sopT.tacanChannel && band === sopBand;
      if (!matches) {
        out.push({
          category: 'Tanker TACAN',
          field: g.groupName,
          missionValue: ch ? `${ch}${band ?? '?'}` : 'Not set',
          sopValue: `${sopT.tacanChannel}${sopBand}${sopT.tacanCallsign ? ' ' + sopT.tacanCallsign : ''}`,
          severity: 'red',
          reason: `Matched to SOP tanker "${sopT.callsign}".`,
        });
      }
    }
  }
  return out;
}

export function checkSupport(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  const out: DiscrepancyRow[] = [];
  const support = sop.supportAssets ?? [];
  if (support.length === 0) return [];

  // For each SOP support asset, look for a mission group whose task or
  // callsign matches.
  for (const asset of support) {
    const role = (asset.role || '').toLowerCase();
    const csWord = firstWord(asset.callsign);
    const match = groups.find((g) => {
      const taskLow = (g.task || '').toLowerCase();
      const nameLow = g.groupName.toLowerCase();
      if (role && taskLow === role) return true;
      if (csWord && nameLow.includes(csWord)) return true;
      return false;
    });

    if (!match) {
      out.push({
        category: 'Support Asset',
        field: `${asset.role || '—'} ${asset.callsign}`,
        missionValue: 'Not present in mission',
        sopValue: asset.frequency ? fmtFreq(asset.frequency, asset.modulation ?? 'AM') : '—',
        severity: 'gray',
        reason: 'SOP defines this asset but no matching group is in the mission.',
      });
      continue;
    }

    if (asset.frequency) {
      const mz = freqMhz(match.frequency);
      if (!freqsMatch(mz, asset.frequency)) {
        out.push({
          category: 'Support Freq',
          field: `${asset.callsign} (${match.groupName})`,
          missionValue: fmtFreq(mz, modString(match.modulation)),
          sopValue: fmtFreq(asset.frequency, asset.modulation ?? 'AM'),
          severity: 'red',
        });
      }
    }
  }
  return out;
}

export function checkCarriers(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  const out: DiscrepancyRow[] = [];
  const carriers = groups.filter(isCarrierGroup);
  for (const g of carriers) {
    const sopT = matchCarrierTacan(g, sop);
    if (!sopT) continue; // SOP doesn't speak about this carrier

    const ch = g.tacan?.channel ?? null;
    const band = g.tacan?.band ?? null;
    if (ch !== sopT.channel || band !== sopT.band) {
      out.push({
        category: 'Carrier TACAN',
        field: g.groupName,
        missionValue: ch ? `${ch}${band ?? '?'}${g.tacan?.callsign ? ' ' + g.tacan.callsign : ''}` : 'Not set',
        sopValue: `${sopT.channel}${sopT.band}${sopT.callsign ? ' ' + sopT.callsign : ''}`,
        severity: 'red',
        reason: `Matched to SOP TACAN entry "${sopT.role}".`,
      });
    }
  }
  return out;
}

export function checkDatalinkOrder(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  // This is a soft check — the auto-assign uses SOP order to pick
  // datalink IDs, so any mismatch here likely means the user hasn't
  // run Auto Assign yet. Marked yellow / informational.
  const out: DiscrepancyRow[] = [];
  if (sop.flights.length === 0) return out;

  const playerFlights = groups.filter((g) =>
    isPlayerGroup(g) && (g.category === 'plane' || g.category === 'helicopter'),
  );

  const sopWords = new Set(sop.flights.map((f) => firstWord(f.callsign)));
  const offSop = playerFlights.filter((g) => !sopWords.has(firstWord(g.groupName)));
  if (offSop.length > 0) {
    out.push({
      category: 'Datalink Roster',
      field: 'Player flights vs SOP roster',
      missionValue: `${offSop.length} flight${offSop.length !== 1 ? 's' : ''} off-SOP`,
      sopValue: `${sopWords.size} callsigns in SOP`,
      severity: 'yellow',
      reason: `Off-SOP flights: ${offSop.map((g) => g.groupName).join(', ')}. Datalink auto-assign will fall back to defaults for these.`,
    });
  }
  return out;
}

export function checkLaserCodes(_groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  // We don't have per-unit laser codes on MissionGroup — those live
  // in unit pylon weapon settings, which the frontend reads as
  // pylonOptions / unit edits. For v1 we just inform the user about
  // the SOP base value so they can verify in the Laser tab. v2 will
  // pull actual unit laser codes via the donor data structure.
  if (sop.laserCodeBase == null) return [];
  return [{
    category: 'Laser Codes',
    field: 'Base value',
    missionValue: 'Check Laser tab',
    sopValue: String(sop.laserCodeBase),
    severity: 'gray',
    reason: `SOP defines laser code base ${sop.laserCodeBase}. Per-unit codes are validated separately in v2.`,
  }];
}

/* ------------------------------------------------------------------ */
/* Aggregator                                                          */
/* ------------------------------------------------------------------ */

export function buildReport(groups: MissionGroup[], sop: SOP): DiscrepancyRow[] {
  return [
    ...checkPlayerFlightFreqs(groups, sop),
    ...checkGuardFreq(groups, sop),
    ...checkTankers(groups, sop),
    ...checkSupport(groups, sop),
    ...checkCarriers(groups, sop),
    ...checkDatalinkOrder(groups, sop),
    ...checkLaserCodes(groups, sop),
  ];
}
