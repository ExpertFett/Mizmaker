import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle, RegularShape, Text } from 'ol/style';
import type { MissionGroup } from '../../types/mission';
import type { ViewMode } from '../../store/mapStore';
import { getFlightColor, isPlayerGroup } from '../../utils/groups';

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
): void {
  const source = layer.getSource()!;
  source.clear();

  const filtered = filterGroups(groups, viewMode);

  let playerIdx = 0;
  for (const group of filtered) {
    const wps = group.waypoints.filter((w) => w.lat && w.lon);
    if (wps.length < 1) continue;

    const isSelected = group.groupId === selectedGroupId;
    const player = isPlayerGroup(group);
    const isAir = AIR_CATEGORIES.has(group.category);
    const prominent = player || isAir; // Air assets always prominent
    const flightColor = getFlightColor(group, playerIdx);
    if (player) playerIdx++;

    const color = isSelected ? '#ffffff' : flightColor;

    // Player/air routes: solid bold. Ground AI: thin dashed muted
    const lineWidth = isSelected ? 4 : player ? 3 : isAir ? 2 : 1;
    const lineDash = prominent ? undefined : [4, 6];
    const lineOpacity = prominent ? 0.9 : 0.4;

    // Route line
    const coords = wps.map((w) => fromLonLat([w.lon!, w.lat!]));
    if (coords.length >= 2) {
      const line = new Feature({
        geometry: new LineString(coords),
        groupId: group.groupId,
        groupName: group.groupName,
        featureType: 'route',
      });

      const styles: Style[] = [
        new Style({
          stroke: new Stroke({
            color: isSelected ? color : flightColor,
            width: lineWidth,
            lineDash,
          }),
        }),
      ];

      // Route direction arrows for prominent routes
      if (prominent || isSelected) {
        const geom = new LineString(coords);
        geom.forEachSegment((start, end) => {
          const dx = end[0] - start[0];
          const dy = end[1] - start[1];
          const rotation = Math.atan2(dy, dx);
          // Arrow at midpoint of segment
          const midX = (start[0] + end[0]) / 2;
          const midY = (start[1] + end[1]) / 2;
          styles.push(
            new Style({
              geometry: new Point([midX, midY]),
              image: new RegularShape({
                points: 3,
                radius: isSelected ? 7 : 5,
                rotation: -rotation + Math.PI / 2,
                fill: new Fill({ color: isSelected ? '#fff' : flightColor }),
                stroke: new Stroke({ color: '#000', width: 0.5 }),
              }),
            }),
          );
        });
      }

      line.setStyle(styles);
      line.setId(`route-${group.groupId}`);
      source.addFeature(line);
    }

    // Waypoint markers (skip WP0 — unit layer already shows group marker there)
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

      let textStyle: Text | undefined;

      if (isSelected) {
        const wpLabel = wp.waypoint_name || `WP${wp.waypoint_number}`;
        textStyle = new Text({
          text: `${wp.waypoint_number} ${wpLabel}`,
          offsetY: -14,
          offsetX: 8,
          textAlign: 'left',
          font: '11px sans-serif',
          fill: new Fill({ color: 'rgba(255,255,255,0.9)' }),
          stroke: new Stroke({ color: '#000', width: 2 }),
        });
      }

      if (player || isSelected) {
        // Player waypoints: larger filled diamonds
        dot.setStyle(new Style({
          image: new RegularShape({
            points: 4,
            radius: isSelected ? 8 : 6,
            angle: Math.PI / 4,
            fill: new Fill({ color }),
            stroke: new Stroke({ color: '#fff', width: isSelected ? 2 : 1 }),
          }),
          text: textStyle,
        }));
      } else if (isAir) {
        // AI air waypoints: visible circles (tanker/AWACS orbit points matter)
        dot.setStyle(new Style({
          image: new CircleStyle({
            radius: 4,
            fill: new Fill({ color: flightColor }),
            stroke: new Stroke({ color: 'rgba(255,255,255,0.4)', width: 1 }),
          }),
          text: textStyle,
        }));
      } else {
        // Ground/ship AI: tiny dots, no labels
        dot.setStyle(new Style({
          image: new CircleStyle({
            radius: 2,
            fill: new Fill({ color: flightColor }),
          }),
        }));
      }

      dot.setId(`wp-${group.groupId}-${wp.waypoint_number}`);
      source.addFeature(dot);
    }
  }
}
