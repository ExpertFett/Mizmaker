import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle, RegularShape, Text } from 'ol/style';
import type { MissionGroup } from '../../types/mission';
import type { ViewMode, UnitCategoryFilter } from '../../store/mapStore';
import { getFlightColor, isPlayerGroup, getAirRoleLabel } from '../../utils/groups';
import { hexToRgba } from '../../utils/conversions';

const AIR_CATEGORIES = new Set(['plane', 'helicopter']);

export function createRouteLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    properties: { name: 'routes' },
    zIndex: 20,
  });
}

export function filterGroups(groups: MissionGroup[], viewMode: ViewMode): MissionGroup[] {
  if (viewMode === 'all') return groups;
  if (viewMode === 'blue') return groups.filter((g) => g.coalition === 'blue');
  if (viewMode === 'red') return groups.filter((g) => g.coalition === 'red');
  if (viewMode === 'players')
    return groups.filter((g) => g.units.some((u) => u.skill === 'Client' || u.skill === 'Player'));
  return groups;
}

export function populateRouteLayer(
  layer: VectorLayer,
  groups: MissionGroup[],
  selectedGroupId: number | null,
  viewMode: ViewMode = 'all',
  hiddenGroupIds: Set<number> = new Set(),
  // v0.9.24 — same per-category filter as unitLayer. Keeps routes
  // and unit markers in sync (hiding all vehicles drops their
  // routes too, not just the markers).
  categoryFilter?: UnitCategoryFilter,
): void {
  const source = layer.getSource()!;
  source.clear();

  const effective: UnitCategoryFilter = categoryFilter ?? {
    plane: true, helicopter: true, vehicle: true, ship: true, static: false,
  };
  const filtered = filterGroups(groups, viewMode)
    .filter((g) => !hiddenGroupIds.has(g.groupId))
    .filter((g) => effective[g.category as keyof UnitCategoryFilter] !== false);

  let playerIdx = 0;
  for (const group of filtered) {
    const wps = group.waypoints.filter((w) => w.lat && w.lon);
    if (wps.length < 1) continue;

    const isSelected = group.groupId === selectedGroupId;
    const player = isPlayerGroup(group);
    const isAir = AIR_CATEGORIES.has(group.category);
    const prominent = player || isAir;
    const flightColor = getFlightColor(group, playerIdx);
    if (player) playerIdx++;

    // Selected route keeps its color — gets a white outline instead of turning white
    const lineWidth = isSelected ? 4 : player ? 3.5 : isAir ? 2 : 1;
    const lineDash = prominent ? undefined : [4, 6];

    const coords = wps.map((w) => fromLonLat([w.lon!, w.lat!]));
    if (coords.length >= 2) {
      const line = new Feature({
        geometry: new LineString(coords),
        groupId: group.groupId,
        groupName: group.groupName,
        featureType: 'route',
      });

      const styles: Style[] = [];

      // Selected: white outline behind the colored line
      if (isSelected) {
        styles.push(
          new Style({
            stroke: new Stroke({ color: '#ffffff', width: lineWidth + 4 }),
          }),
        );
      }

      // Glow for player routes (not selected — selected already has white outline)
      if (player && !isSelected) {
        styles.push(
          new Style({
            stroke: new Stroke({ color: hexToRgba(flightColor, 0.25), width: lineWidth + 6 }),
          }),
        );
      }

      // Main colored stroke — always the flight color
      styles.push(
        new Style({
          stroke: new Stroke({ color: flightColor, width: lineWidth, lineDash }),
        }),
      );

      // Direction arrows + leg distance labels
      if (prominent || isSelected) {
        const wpsWithCoords = wps.filter((w) => w.waypoint_number > 0);
        const geom = new LineString(coords);
        let segIdx = 0;
        geom.forEachSegment((start, end) => {
          const dx = end[0] - start[0];
          const dy = end[1] - start[1];
          const rotation = Math.atan2(dy, dx);
          const midX = (start[0] + end[0]) / 2;
          const midY = (start[1] + end[1]) / 2;

          // Arrow
          styles.push(
            new Style({
              geometry: new Point([midX, midY]),
              image: new RegularShape({
                points: 3,
                radius: isSelected ? 9 : player ? 7 : 5,
                rotation: -rotation + Math.PI / 2,
                fill: new Fill({ color: flightColor }),
                stroke: new Stroke({ color: isSelected ? '#fff' : '#000', width: isSelected ? 1.5 : 0.5 }),
              }),
            }),
          );

          // Leg distance label (show for player/selected routes)
          if (player || isSelected) {
            const wp = wpsWithCoords[segIdx];
            const dist = wp?.leg_distance_nm;
            if (dist && dist > 0) {
              // Leg time — use previous WP's speed (you fly the leg at departure speed)
              const prevWp = segIdx > 0 ? wpsWithCoords[segIdx - 1] : null;
              const spd = prevWp?.speed_ms || wp?.speed_ms || 0;
              const legTime = spd > 0 ? (dist * 1852) / spd : 0;
              const timeStr = legTime > 0
                ? legTime < 60 ? `${Math.round(legTime)}s` : `${Math.floor(legTime / 60)}:${Math.round(legTime % 60).toString().padStart(2, '0')}`
                : '';

              styles.push(
                new Style({
                  geometry: new Point([midX, midY]),
                  text: new Text({
                    text: `${dist.toFixed(1)}nm ${timeStr}`,
                    font: '11px monospace',
                    fill: new Fill({ color: hexToRgba(flightColor, 0.9) }),
                    stroke: new Stroke({ color: '#000', width: 2.5 }),
                    offsetY: 14,
                  }),
                }),
              );
            }
          }
          segIdx++;
        });
      }

      line.setStyle(styles);
      line.setId(`route-${group.groupId}`);
      source.addFeature(line);
    }

    // Waypoint markers (skip WP0)
    for (const wp of wps) {
      if (wp.waypoint_number === 0) continue;

      const dot = new Feature({
        geometry: new Point(fromLonLat([wp.lon!, wp.lat!])),
        groupId: group.groupId,
        groupName: group.groupName,
        wpIndex: wp.waypoint_number,
        waypoint: wp,
        featureType: 'waypoint',
      });

      // Waypoint labels
      const roleLabel = getAirRoleLabel(group);
      const wpLabel = wp.waypoint_name || `WP${wp.waypoint_number}`;
      let textStyle: Text | undefined;

      if (player || isSelected) {
        // Player routes: show WP number + name
        textStyle = new Text({
          text: `${wp.waypoint_number} ${wpLabel}`,
          offsetY: -16,
          offsetX: 10,
          textAlign: 'left',
          font: `${isSelected ? 'bold ' : ''}13px sans-serif`,
          fill: new Fill({ color: isSelected ? '#fff' : 'rgba(255,255,255,0.75)' }),
          stroke: new Stroke({ color: '#000', width: 2.5 }),
        });
      } else if (roleLabel && wp.waypoint_number === 1) {
        // Tankers/AWACS: show role label once at WP1 only
        textStyle = new Text({
          text: roleLabel,
          offsetY: 16,
          font: 'bold 11px sans-serif',
          fill: new Fill({ color: 'rgba(255,255,255,0.6)' }),
          stroke: new Stroke({ color: '#000', width: 2 }),
        });
      }

      if (player || isSelected) {
        // Player waypoints: diamonds with white outline when selected
        dot.setStyle(new Style({
          image: new RegularShape({
            points: 4,
            radius: isSelected ? 10 : 9,
            angle: Math.PI / 4,
            fill: new Fill({ color: flightColor }),
            stroke: new Stroke({ color: isSelected ? '#fff' : 'rgba(255,255,255,0.6)', width: isSelected ? 2.5 : 1.5 }),
          }),
          text: textStyle,
        }));
      } else if (isAir) {
        dot.setStyle(new Style({
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: flightColor }),
            stroke: new Stroke({ color: 'rgba(255,255,255,0.5)', width: 1 }),
          }),
          text: textStyle,
        }));
      } else {
        dot.setStyle(new Style({
          image: new CircleStyle({
            radius: 3,
            fill: new Fill({ color: flightColor }),
          }),
        }));
      }

      dot.setId(`wp-${group.groupId}-${wp.waypoint_number}`);
      source.addFeature(dot);
    }
  }
}
