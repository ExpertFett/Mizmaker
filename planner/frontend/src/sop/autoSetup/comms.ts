/**
 * Comm-asset applier (v1.19.79, task #61) — forces in-mission AI asset
 * frequencies onto the comm plan.
 *
 * The silent failure this fixes: a player tunes preset button 11 to
 * "Texaco 1 / 332.100" (built from the SOP comm plan) and calls for
 * gas — but the mission's tanker group is actually broadcasting on
 * 251.000, so nobody answers. SOP is only "enforced" if the AI is on
 * the freq the players will tune.
 *
 * This applier pairs tankers / AWACS in the mission with the comm-plan
 * nets that represent them (see matchAssetNets) and stages a
 * `groupFrequency` (+ `groupModulation` when it differs) edit to bring
 * each asset onto its net. Plan-driven only — when the active SOP has
 * no comm plan there is nothing to enforce and the applier no-ops.
 *
 * groupFrequency is written in Hz (DCS-native — the .miz stores
 * frequency in Hz and the backend writes the value verbatim), so we
 * convert the net's MHz up.
 */

import { freqMhz, freqsMatch } from '../discrepancy';
import { matchAssetNets } from '../commPlanMatch';
import type { MissionGroup, UnitEdit } from '../../types/mission';
import type { SOP } from '../types';
import type { AutoSetupAction } from './types';

export function applyCommAssetsSop(groups: MissionGroup[], sop: SOP): AutoSetupAction {
  const plan = sop.commPlan;
  if (!plan || plan.nets.length === 0) {
    return {
      category: 'Comms',
      description: 'No comm plan to enforce',
      edits: [], itemsAffected: 0,
      skippedReason: 'Active SOP has no comm plan',
    };
  }

  const pairings = matchAssetNets(groups, plan);
  if (pairings.length === 0) {
    return {
      category: 'Comms',
      description: 'No mission tankers / AWACS matched a comm-plan net',
      edits: [], itemsAffected: 0,
      skippedReason: 'No tanker / AWACS assets to align',
    };
  }

  const edits: UnitEdit[] = [];
  const details: string[] = [];
  let touched = 0;

  for (const { group, net, role } of pairings) {
    const netMhz = net.frequency!;            // matchAssetNets guarantees a freq
    const curMhz = freqMhz(group.frequency);
    const freqOff = !freqsMatch(curMhz, netMhz);
    const netMod = net.modulation === 'FM' ? 1 : 0;
    const modOff = (group.modulation === 1 ? 1 : 0) !== netMod;
    if (!freqOff && !modOff) continue;

    if (freqOff) {
      edits.push({
        groupId: group.groupId,
        field: 'groupFrequency',
        value: Math.round(netMhz * 1e6),       // MHz → Hz
      } as UnitEdit);
    }
    if (modOff) {
      edits.push({
        groupId: group.groupId,
        field: 'groupModulation',
        value: netMod,
      } as UnitEdit);
    }
    touched++;
    details.push(
      `${group.groupName} (${role.toUpperCase()}) → ${net.name} ${netMhz.toFixed(3)} ${netMod === 1 ? 'FM' : 'AM'}`,
    );
  }

  if (edits.length === 0) {
    return {
      category: 'Comms',
      description: `${pairings.length} asset${pairings.length !== 1 ? 's' : ''} already on plan`,
      edits: [], itemsAffected: 0,
      skippedReason: 'Mission tankers / AWACS already match the comm plan',
    };
  }

  return {
    category: 'Comms',
    description: `Aligned ${touched} asset${touched !== 1 ? 's' : ''} to the comm plan`,
    edits,
    itemsAffected: touched,
    details,
  };
}
