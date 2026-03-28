/** Group utilities — aircraft type, player detection, per-flight colors, role detection */

import type { MissionGroup } from '../types/mission';

export function getAircraftType(group: MissionGroup): string {
  if (group.units.length === 0) return group.category;
  return group.units[0].type || group.category;
}

export function isPlayerGroup(group: MissionGroup): boolean {
  return group.units.some((u) => u.skill === 'Client' || u.skill === 'Player');
}

/** Check if this is a carrier group (CVN, LHA, etc) */
export function isCarrierGroup(group: MissionGroup): boolean {
  return group.category === 'ship' &&
    group.units.some((u) => /CVN|LHA|LHD|Stennis|Kuznetsov|Admiral|Vinson/i.test(u.type));
}

/** Get the role label for AI air groups (Refuel, AWACS, etc) */
export function getAirRoleLabel(group: MissionGroup): string | null {
  if (isPlayerGroup(group)) return null;
  const task = (group.task || '').toLowerCase();
  if (task === 'refueling') return 'REFUEL';
  if (task === 'awacs') return 'AWACS';
  return null;
}

// Distinct colors for per-flight route lines
const FLIGHT_COLORS = [
  '#58a6ff', '#f78166', '#3fb950', '#d29922',
  '#a371f7', '#79c0ff', '#ffa07a', '#56d4dd',
  '#e8b84c', '#ff6b8a', '#7ee787', '#b392f0',
  '#f0883e', '#8b949e', '#da3633', '#1f6feb',
];

const AI_COLOR = '#6e40aa';

export function getFlightColor(group: MissionGroup, index: number): string {
  if (!isPlayerGroup(group)) return AI_COLOR;
  return FLIGHT_COLORS[index % FLIGHT_COLORS.length];
}
