/**
 * Datalink applier — extracted from DatalinkTab's handleAutoAssignAll.
 *
 * For each player flight (group of clientUnits), assigns:
 *   - voiceCallsignLabel  — 2-char abbreviation of SOP callsign or group name
 *   - voiceCallsignNumber — flight digit + member digit ("12" = flight 1 wing 2)
 *   - stnL16              — 5-digit unique address derived from flight order
 *
 * SOP integration: if a SOP flight callsign matches the group's first
 * word ("Bengal" matches "Bengal 1"), the abbreviation is taken from
 * the SOP callsign. Otherwise we fall back to abbreviating the group
 * name itself.
 */

import type { ClientUnit, UnitEdit } from '../../types/mission';
import type { SOP } from '../types';
import type { AutoSetupAction } from './types';

/** 2-char callsign abbreviation: consonant skeleton when possible
 *  ("Bengal" → "BN"), else first two chars. Keeps the L16 voice
 *  channel labels short enough to fit the cockpit display. */
export function abbreviateCallsign(name: string): string {
  const clean = name.trim().toUpperCase();
  if (clean.length <= 2) return clean;
  const consonants = clean.replace(/[^BCDFGHJKLMNPQRSTVWXYZ]/g, '');
  if (consonants.length >= 2) return consonants.slice(0, 2);
  return clean.slice(0, 2);
}

export function applyDatalinkSop(clientUnits: ClientUnit[], sop: SOP): AutoSetupAction {
  if (clientUnits.length === 0) {
    return {
      category: 'Datalink',
      description: 'No client units with datalinks',
      edits: [], itemsAffected: 0,
      skippedReason: 'Mission has no Client/Player units',
    };
  }

  // Group clientUnits by groupName, preserving insertion order.
  const grouped = new Map<string, ClientUnit[]>();
  for (const u of clientUnits) {
    if (!grouped.has(u.groupName)) grouped.set(u.groupName, []);
    grouped.get(u.groupName)!.push(u);
  }

  // SOP first-word lookup so a group named "HornetA1" can be
  // labelled with the squadron-canonical "Bengal" abbreviation.
  const sopByFirstWord = new Map<string, string>();
  for (const f of sop.flights) {
    if (!f.callsign) continue;
    const firstWord = f.callsign.split(/[-\s]/)[0].toLowerCase();
    sopByFirstWord.set(firstWord, f.callsign);
  }

  const edits: UnitEdit[] = [];
  const details: string[] = [];
  let stnFlight = 1;

  for (const [groupName, units] of grouped) {
    const baseName = groupName.replace(/\s*\d+\s*$/, '').trim() || groupName;
    const sopCallsign = sopByFirstWord.get(baseName.toLowerCase());
    const csLabel = abbreviateCallsign(sopCallsign || baseName);

    // Flight digit from the group name's trailing number; falls back
    // to our running counter when the group has no number.
    const flightMatch = groupName.match(/(\d+)\s*$/);
    const flightNum = flightMatch ? parseInt(flightMatch[1], 10) : stnFlight;

    for (let i = 0; i < units.length; i++) {
      const memberNum = i + 1;
      const csNumber = String(flightNum) + String(memberNum);
      const stn = String(stnFlight * 10 + memberNum).padStart(5, '0');

      edits.push({ unitId: units[i].unitId, field: 'voiceCallsignLabel', value: csLabel });
      edits.push({ unitId: units[i].unitId, field: 'voiceCallsignNumber', value: csNumber });
      edits.push({ unitId: units[i].unitId, field: 'stnL16', value: stn });
    }
    const labelTag = sopCallsign ? `${csLabel} (${sopCallsign})` : csLabel;
    details.push(`${groupName}: ${units.length} unit${units.length !== 1 ? 's' : ''} → ${labelTag}`);
    stnFlight++;
  }

  return {
    category: 'Datalink',
    description: `Assigned ${grouped.size} flight${grouped.size !== 1 ? 's' : ''} (${edits.length / 3} unit${edits.length / 3 !== 1 ? 's' : ''})`,
    edits,
    itemsAffected: grouped.size,
    details,
  };
}
