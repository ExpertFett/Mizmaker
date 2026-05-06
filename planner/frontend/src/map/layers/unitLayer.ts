import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke, RegularShape, Text } from 'ol/style';
import type { MissionUnit, MissionGroup } from '../../types/mission';
import type { ViewMode, UnitCategoryFilter } from '../../store/mapStore';
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
  // v0.9.24: replaces the old `showStatics: boolean` arg with the
  // full per-category filter. Callers without category awareness
  // can pass undefined to get the legacy "everything but statics"
  // behaviour.
  categoryFilter?: UnitCategoryFilter,
  // v0.9.29: groups the mission maker has marked hidden from
  // flight leads via useVisibilityStore. The render still draws
  // them on the mission-maker's map (they need to see what they
  // marked) but with a muted style so the user can spot intel
  // exposure at a glance without toggling preview-as-flight-lead.
  hiddenFromParticipants: Set<number> = new Set(),
): void {
  const source = layer.getSource()!;
  source.clear();

  let filteredGroups = groups;
  if (viewMode === 'blue') filteredGroups = groups.filter((g) => g.coalition === 'blue');
  else if (viewMode === 'red') filteredGroups = groups.filter((g) => g.coalition === 'red');
  else if (viewMode === 'players') filteredGroups = groups.filter((g) => isPlayerGroup(g));
  filteredGroups = filteredGroups.filter((g) => !hiddenGroupIds.has(g.groupId));
  // Per-category filter — drops groups whose category is set to false.
  // Default (filter undefined) keeps everything except statics, matching
  // pre-v0.9.24 behaviour.
  const effective: UnitCategoryFilter = categoryFilter ?? {
    plane: true, helicopter: true, vehicle: true, ship: true, static: false,
  };
  filteredGroups = filteredGroups.filter((g) => effective[g.category as keyof UnitCategoryFilter] !== false);


  for (const group of filteredGroups) {
    const firstUnit = group.units.find((u) => u.lat && u.lon);
    if (!firstUnit) continue;

    const isHiddenFromFLs = hiddenFromParticipants.has(group.groupId);
    const baseColor = COALITION_COLORS[group.coalition] || '#888';
    // Muted appearance for hidden groups — translucent fill +
    // dashed gray stroke. Distinct enough to spot at a glance
    // but not so loud that it competes with the rest of the
    // tactical picture.
    const color = isHiddenFromFLs ? `${baseColor}66` : baseColor;
    const strokeColor = isHiddenFromFLs ? '#888' : '#fff';
    const strokeDash = isHiddenFromFLs ? [3, 3] : undefined;
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

    // Prepend a 🚫 prefix to the label when the group is hidden
    // from participants — only fires for already-labelled groups
    // (player flights + carriers) so the map doesn't get noisy.
    const labelText = (showLabel ? group.groupName.slice(0, 22) : '');
    const finalLabelText = isHiddenFromFLs && labelText ? `🚫 ${labelText}` : labelText;
    const label = showLabel
      ? new Text({
          text: finalLabelText,
          offsetY: -18,
          font: `${player ? 'bold 13px' : '12px'} sans-serif`,
          fill: new Fill({
            color: isHiddenFromFLs
              ? 'rgba(170, 170, 170, 0.85)'
              : (player ? '#fff' : 'rgba(255,255,255,0.8)'),
          }),
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
          stroke: new Stroke({
            color: strokeColor,
            width: player ? 2 : 1,
            lineDash: strokeDash,
          }),
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
          stroke: new Stroke({
            color: strokeColor,
            width: 1.5,
            lineDash: strokeDash,
          }),
        }),
        text: label,
      }));
    }

    feature.setId(`group-${group.groupId}`);
    source.addFeature(feature);
  }
}
