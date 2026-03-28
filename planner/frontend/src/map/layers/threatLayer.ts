import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Circle from 'ol/geom/Circle';
import { fromLonLat, getPointResolution } from 'ol/proj';
import { Style, Fill, Stroke } from 'ol/style';
import type { ThreatRing } from '../../types/mission';
import type { ViewMode } from '../../store/mapStore';

const THREAT_STYLES: Record<string, Style> = {
  red: new Style({
    fill: new Fill({ color: 'rgba(217, 80, 80, 0.06)' }),
    stroke: new Stroke({ color: 'rgba(217, 80, 80, 0.45)', width: 1 }),
  }),
  blue: new Style({
    fill: new Fill({ color: 'rgba(74, 143, 212, 0.06)' }),
    stroke: new Stroke({ color: 'rgba(74, 143, 212, 0.45)', width: 1 }),
  }),
  neutrals: new Style({
    fill: new Fill({ color: 'rgba(143, 168, 192, 0.06)' }),
    stroke: new Stroke({ color: 'rgba(143, 168, 192, 0.4)', width: 1 }),
  }),
};

export function createThreatLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    properties: { name: 'threats' },
    zIndex: 10,
  });
}

export function populateThreatLayer(
  layer: VectorLayer,
  threats: ThreatRing[],
  viewMode: ViewMode = 'all',
): void {
  const source = layer.getSource()!;
  source.clear();

  let filtered = threats;
  if (viewMode === 'red') filtered = threats.filter((t) => t.coalition === 'red');
  else if (viewMode === 'blue') filtered = threats.filter((t) => t.coalition === 'blue' || t.coalition === 'red');
  else if (viewMode === 'players') filtered = threats; // show all threats for players

  for (const t of filtered) {
    if (!t.lat || !t.lon) continue;
    const center = fromLonLat([t.lon, t.lat]);
    const resolution = getPointResolution('EPSG:3857', 1, center);
    const radiusInProjection = t.range / resolution;

    const feature = new Feature({
      geometry: new Circle(center, radiusInProjection),
      threat: t,
    });
    feature.setStyle(THREAT_STYLES[t.coalition] || THREAT_STYLES.red);
    feature.setId(`threat-${t.name}-${t.x}-${t.y}`);
    source.addFeature(feature);
  }
}
