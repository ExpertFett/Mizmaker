/**
 * Auto-generate planner drawings from mission data.
 * Analyzes groups by task type and waypoints to create:
 * - Racetrack orbits for Tankers, AWACS, CAP
 * - Corridors for player flight routes
 */

import type { MissionGroup, PlannerDrawing } from '../types/mission';
import { isPlayerGroup } from './groups';

/**
 * Given all mission groups, generate planner drawings automatically.
 */
export function generateDrawings(groups: MissionGroup[]): PlannerDrawing[] {
  const drawings: PlannerDrawing[] = [];

  for (const group of groups) {
    const task = (group.task || '').toLowerCase();

    // Tanker → racetrack orbit
    if (task === 'refueling') {
      const rt = buildOrbitFromGroup(group, 'racetrack');
      if (rt) {
        drawings.push({
          id: `auto-tanker-${group.groupId}`,
          type: 'racetrack',
          name: `${group.groupName} (Tanker)`,
          color: '#d29922',
          visible: true,
          coords: rt.coords,
          widthNm: rt.widthNm,
        });
      }
    }

    // AWACS → racetrack orbit
    if (task === 'awacs') {
      const rt = buildOrbitFromGroup(group, 'racetrack');
      if (rt) {
        drawings.push({
          id: `auto-awacs-${group.groupId}`,
          type: 'racetrack',
          name: `${group.groupName} (AWACS)`,
          color: '#a371f7',
          visible: true,
          coords: rt.coords,
          widthNm: rt.widthNm,
        });
      }
    }

    // CAP → racetrack orbit
    if (task === 'cap') {
      const rt = buildOrbitFromGroup(group, 'racetrack');
      if (rt) {
        drawings.push({
          id: `auto-cap-${group.groupId}`,
          type: 'racetrack',
          name: `${group.groupName} (CAP)`,
          color: '#d49a30',
          visible: true,
          coords: rt.coords,
          widthNm: rt.widthNm,
        });
      }
    }

    // Player flights → corridor from route
    if (isPlayerGroup(group)) {
      const corridor = buildCorridorFromGroup(group);
      if (corridor) {
        drawings.push({
          id: `auto-corridor-${group.groupId}`,
          type: 'corridor',
          name: `${group.groupName}`,
          color: group.coalition === 'blue' ? '#d49a30' : '#d95050',
          visible: false,  // hidden by default — opt-in, avoids clutter
          coords: corridor.coords,
          widthNm: 3,
        });
      }
    }
  }

  return drawings;
}

/**
 * Build racetrack orbit coordinates from a group's waypoints.
 * Strategy:
 * 1. Try to find orbit task data in waypoint tasks (DCS orbit command)
 * 2. Fall back to using the first two non-takeoff/landing turning points
 */
function buildOrbitFromGroup(
  group: MissionGroup,
  _type: 'racetrack',
): { coords: [number, number][]; widthNm: number } | null {
  const wps = group.waypoints;
  if (wps.length < 2) return null;

  // First, try to extract orbit data from waypoint task dicts
  // DCS orbit tasks have nested structure: task.params.tasks[n].params with pattern, point, speed
  for (const wp of wps) {
    const orbitData = extractOrbitFromTask(wp.task);
    if (orbitData) return orbitData;
  }

  // Fallback: find turning points (skip WP0 which is usually takeoff/start)
  const turningPoints = wps.filter(
    (wp) =>
      wp.waypoint_number > 0 &&
      wp.lat != null && wp.lon != null &&
      wp.waypoint_action !== 'Landing' &&
      wp.waypoint_action !== 'From Runway' &&
      wp.waypoint_type !== 'Land'
  );

  if (turningPoints.length >= 2) {
    // Use the first two turning points as the racetrack legs
    const p1 = turningPoints[0];
    const p2 = turningPoints[1];
    return {
      coords: [[p1.lon!, p1.lat!], [p2.lon!, p2.lat!]],
      widthNm: 5,
    };
  }

  return null;
}

/**
 * Try to extract orbit point/point2 from a DCS waypoint task dict.
 * The task structure in DCS is deeply nested:
 *   task.params.tasks[1].id = "Orbit"
 *   task.params.tasks[1].params.pattern = "Race-Track"
 *   task.params.tasks[1].params.point = { x, y }  (DCS coords, already have lat/lon on wp)
 */
function extractOrbitFromTask(
  task: unknown,
): { coords: [number, number][]; widthNm: number } | null {
  if (!task || typeof task !== 'object') return null;

  const taskObj = task as any;
  const params = taskObj.params;
  if (!params) return null;

  // Check nested tasks array
  const tasks = params.tasks;
  if (!tasks || typeof tasks !== 'object') return null;

  // Iterate through tasks (could be 1-indexed Lua table or array)
  const taskEntries = Array.isArray(tasks) ? tasks : Object.values(tasks);
  for (const t of taskEntries) {
    if (!t || typeof t !== 'object') continue;
    const tObj = t as any;

    if (tObj.id === 'Orbit' && tObj.params) {
      // We found an orbit — but the coordinates are in DCS x/y, not lat/lon
      // The waypoint itself has the orbit start position in lat/lon already
      // For Race-Track, there might be a point2 offset
      // For now, we can't reliably get the second point from here since
      // orbit coords are in DCS projection and we don't have the converter on frontend
      // Fall through to the waypoint-based fallback
      return null;
    }

    // Also check for ControlledTask wrapping
    if (tObj.id === 'ControlledTask' && tObj.params?.task?.id === 'Orbit') {
      return null; // same issue — coords in DCS projection
    }
  }

  return null;
}

/**
 * Build corridor from a player group's waypoints (excluding takeoff/landing).
 */
function buildCorridorFromGroup(
  group: MissionGroup,
): { coords: [number, number][] } | null {
  const routePoints = group.waypoints.filter(
    (wp) =>
      wp.lat != null && wp.lon != null &&
      wp.waypoint_action !== 'From Runway' &&
      wp.waypoint_type !== 'Land' &&
      wp.waypoint_action !== 'Landing'
  );

  if (routePoints.length < 2) return null;

  return {
    coords: routePoints.map((wp) => [wp.lon!, wp.lat!] as [number, number]),
  };
}
