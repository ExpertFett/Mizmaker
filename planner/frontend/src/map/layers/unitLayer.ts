import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke, RegularShape, Text } from 'ol/style';
import type { MissionUnit, MissionGroup } from '../../types/mission';
import type { ViewMode } from '../../store/mapStore';
import { isPlayerGroup, isCarrierGroup } from '../../utils/groups';

const COALITION_COLORS: Record<string, string> = {
  blue: '#4a8fd4',
  red: '#d95050',
  neutrals: '#cccccc',
};

const AIR_CATEGORIES = new Set(['plane', 'helicopter']);

export function createUnitLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    properties: { name: 'units' },
    zIndex: 30,
  });
}

export function populateUnitLayer(
  layer: VectorLayer,
  _units: MissionUnit[],
  groups: MissionGroup[],
  viewMode: ViewMode = 'all',
  hiddenGroupIds: Set<number> = new Set(),
  showStatics: boolean = false,
): void {
  const source = layer.getSource()!;
  source.clear();

  let filteredGroups = groups;
  if (viewMode === 'blue') filteredGroups = groups.filter((g) => g.coalition === 'blue');
  else if (viewMode === 'red') filteredGroups = groups.filter((g) => g.coalition === 'red');
  else if (viewMode === 'players') filteredGroups = groups.filter((g) => isPlayerGroup(g));
  filteredGroups = filteredGroups.filter((g) => !hiddenGroupIds.has(g.groupId));
  if (!showStatics) filteredGroups = filteredGroups.filter((g) => g.category !== 'static');


  for (const group of filteredGroups) {
    const firstUnit = group.units.find((u) => u.lat && u.lon);
    if (!firstUnit) continue;

    const color = COALITION_COLORS[group.coalition] || '#888';
    const player = isPlayerGroup(group);
    const isAir = AIR_CATEGORIES.has(group.category);

    // Build unit roster for tooltip
    const unitList = group.units.map((u) => ({
      name: u.name,
      type: u.type,
      skill: u.skill,
    }));

    const feature = new Feature({
      geometry: new Point(fromLonLat([firstUnit.lon!, firstUnit.lat!])),
      groupId: group.groupId,
      unit: {
        name: group.groupName,
        unitList,
        category: group.category,
        coalition: group.coalition,
        country: group.country || '',
        groupName: group.groupName,
        task: group.task,
        isPlayer: player,
      },
      featureType: 'unit',
    });

    // Only label player groups and carrier groups
    const carrier = isCarrierGroup(group);
    const showLabel = player || carrier;

    const label = showLabel
      ? new Text({
          text: group.groupName.slice(0, 22),
          offsetY: -18,
          font: `${player ? 'bold 13px' : '12px'} sans-serif`,
          fill: new Fill({ color: player ? '#fff' : 'rgba(255,255,255,0.8)' }),
          stroke: new Stroke({ color: '#000', width: 2.5 }),
        })
      : undefined;

    if (isAir) {
      // Air groups: upward triangle (like a plane silhouette)
      feature.setStyle(new Style({
        image: new RegularShape({
          points: 3,
          radius: player ? 10 : 8,
          angle: 0, // points up
          fill: new Fill({ color }),
          stroke: new Stroke({ color: '#fff', width: player ? 2 : 1 }),
        }),
        text: label,
      }));
    } else {
      // Ground/ship/static: rectangle
      feature.setStyle(new Style({
        image: new RegularShape({
          points: 4,
          radius: 10,
          radius2: 7,
          angle: 0,
          fill: new Fill({ color }),
          stroke: new Stroke({ color: '#fff', width: 1.5 }),
        }),
        text: label,
      }));
    }

    feature.setId(`group-${group.groupId}`);
    source.addFeature(feature);
  }
}
