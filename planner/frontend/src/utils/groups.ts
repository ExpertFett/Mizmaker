/** Group utilities — aircraft type, player detection, per-flight colors */

import type { MissionGroup } from '../types/mission';

export function getAircraftType(group: MissionGroup): string {
  if (group.units.length === 0) return group.category;
  // Use the first unit's type — all units in a flight are the same airframe
  return group.units[0].type || group.category;
}

export function isPlayerGroup(group: MissionGroup): boolean {
  return group.units.some((u) => u.skill === 'Client' || u.skill === 'Player');
}

// Distinct colors for per-flight route lines
const FLIGHT_COLORS = [
  '#58a6ff', '#f78166', '#3fb950', '#d29922',
  '#a371f7', '#79c0ff', '#ffa07a', '#56d4dd',
  '#e8b84c', '#ff6b8a', '#7ee787', '#b392f0',
  '#f0883e', '#8b949e', '#da3633', '#1f6feb',
];

const AI_COLOR = '#6e40aa'; // Purple for AI/non-flyable routes

export function getFlightColor(group: MissionGroup, index: number): string {
  if (!isPlayerGroup(group)) return AI_COLOR;
  return FLIGHT_COLORS[index % FLIGHT_COLORS.length];
}
