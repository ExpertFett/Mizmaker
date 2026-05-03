/**
 * Radio Presets applier — builds 20-channel preset lists for every
 * player flight's COMM1 (Radio[1]) and dispatches a single
 * `radioPresets` edit per flight.
 *
 * Channel allocation (mirrors RadioPresetsSection.buildAutoPresets):
 *   Ch 1   — own flight primary freq
 *   Ch 2   — AWACS (if present in mission)
 *   Ch 3-4 — Tankers (SOP entries first; falls back to mission)
 *   Ch N   — SOP common comms (Strike Primary, Marshal, Tower, ...)
 *   Ch N+  — Other player flights (intra-package coordination)
 *   Ch 20  — GUARD (243.000 AM)
 *
 * Only Radio[1] is built — Hornet has Radio[2] but most squadrons
 * leave that for STRIKE/MARSHAL via the DTC side (which is its own
 * Auto-Setup applier when we add it). Other airframes only have one
 * radio anyway. Pilots can edit individual channels in the tab.
 */

import { isPlayerGroup } from '../../utils/groups';
import type { MissionGroup, UnitEdit } from '../../types/mission';
import type { SOP } from '../types';
import type { AutoSetupAction } from './types';

const PRESET_COUNT = 20;
const GUARD_CHANNEL_SPEC = { freq_mhz: 243.0, modulation: 0, name: 'GUARD' };

interface ChannelSpec {
  ch: number;
  freq_mhz: number;
  modulation: 0 | 1;
  name: string;
}

/** Mission frequency may be Hz or MHz — normalise to MHz. */
function freqMhz(raw: number): number {
  if (raw <= 0) return 0;
  return raw >= 1e6 ? raw / 1e6 : raw;
}

function buildChannelsForFlight(
  flight: MissionGroup,
  allGroups: MissionGroup[],
  sop: SOP,
): ChannelSpec[] {
  const channels: ChannelSpec[] = [];

  // Ch 1 — own primary
  if (flight.frequency > 0) {
    channels.push({
      ch: 1,
      freq_mhz: freqMhz(flight.frequency),
      modulation: flight.modulation === 1 ? 1 : 0,
      name: (flight.units[0]?.name || flight.groupName).slice(0, 12),
    });
  }

  // Ch 2 — AWACS
  const awacs = allGroups.find((g) => (g.task || '').toLowerCase() === 'awacs');
  if (awacs && awacs.frequency > 0) {
    channels.push({
      ch: channels.length + 1,
      freq_mhz: freqMhz(awacs.frequency),
      modulation: awacs.modulation === 1 ? 1 : 0,
      name: 'AWACS',
    });
  }

  // Ch 3-4 — Tankers. SOP first.
  const sopTankers = (sop.tankers || [])
    .filter((t) => t.callsign && t.frequency)
    .slice(0, 2);
  if (sopTankers.length > 0) {
    for (const t of sopTankers) {
      channels.push({
        ch: channels.length + 1,
        freq_mhz: t.frequency!,
        modulation: t.modulation === 'FM' ? 1 : 0,
        name: t.callsign.slice(0, 12),
      });
    }
  } else {
    const tankers = allGroups
      .filter((g) => (g.task || '').toLowerCase() === 'refueling' && g.frequency > 0)
      .slice(0, 2);
    for (const t of tankers) {
      channels.push({
        ch: channels.length + 1,
        freq_mhz: freqMhz(t.frequency),
        modulation: t.modulation === 1 ? 1 : 0,
        name: (t.units[0]?.name || t.groupName).slice(0, 12),
      });
    }
  }

  // SOP common comms (skip GUARD — it goes on Ch 20).
  for (const c of sop.comms) {
    if (channels.length >= PRESET_COUNT - 1) break;
    if (!c.role || !c.frequency) continue;
    if (/guard/i.test(c.role)) continue;
    channels.push({
      ch: channels.length + 1,
      freq_mhz: c.frequency,
      modulation: c.modulation === 'FM' ? 1 : 0,
      name: c.role.slice(0, 12),
    });
  }

  // Other player flights for intra-package coordination.
  const others = allGroups.filter((g) =>
    g.groupId !== flight.groupId
    && isPlayerGroup(g)
    && g.coalition === flight.coalition
    && g.frequency > 0,
  );
  for (const g of others) {
    if (channels.length >= PRESET_COUNT - 1) break;
    channels.push({
      ch: channels.length + 1,
      freq_mhz: freqMhz(g.frequency),
      modulation: g.modulation === 1 ? 1 : 0,
      name: (g.units[0]?.name || g.groupName).slice(0, 12),
    });
  }

  // Ch 20 — GUARD anchored regardless. Override SOP guard freq if defined.
  const sopGuard = sop.comms.find((c) => /guard/i.test(c.role));
  channels.push({
    ch: PRESET_COUNT,
    freq_mhz: sopGuard?.frequency ?? GUARD_CHANNEL_SPEC.freq_mhz,
    modulation: sopGuard?.modulation === 'FM' ? 1 : 0,
    name: 'GUARD',
  });

  return channels;
}

export function applyRadioSop(groups: MissionGroup[], sop: SOP): AutoSetupAction {
  const playerFlights = groups.filter((g) =>
    isPlayerGroup(g) && (g.category === 'plane' || g.category === 'helicopter'),
  );

  if (playerFlights.length === 0) {
    return {
      category: 'Radio',
      description: 'No player flights to configure',
      edits: [], itemsAffected: 0,
      skippedReason: 'Mission has no Client/Player groups',
    };
  }

  const edits: UnitEdit[] = [];
  const details: string[] = [];

  for (const flight of playerFlights) {
    const channels = buildChannelsForFlight(flight, groups, sop);
    if (channels.length === 0) continue;

    edits.push({
      groupId: flight.groupId,
      field: 'radioPresets',
      value: { radio: 1, channels },
    } as UnitEdit);
    details.push(`${flight.groupName}: ${channels.length} channel${channels.length !== 1 ? 's' : ''} on COMM1`);
  }

  return {
    category: 'Radio',
    description: `Built COMM1 presets for ${edits.length} flight${edits.length !== 1 ? 's' : ''}`,
    edits,
    itemsAffected: edits.length,
    details,
  };
}
