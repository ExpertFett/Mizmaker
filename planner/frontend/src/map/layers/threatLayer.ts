import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Circle from 'ol/geom/Circle';
import { fromLonLat } from 'ol/proj';
import { getPointResolution } from 'ol/proj';
import { Style, Fill, Stroke } from 'ol/style';
import type { ThreatRing } from '../../types/mission';
import type { ViewMode } from '../../store/mapStore';

export function createThreatLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    properties: { name: 'threats' },
    zIndex: 10,
    style: new Style({
      fill: new Fill({ color: 'rgba(217, 80, 80, 0.08)' }),
      stroke: new Stroke({ color: 'rgba(217, 80, 80, 0.5)', width: 1 }),
    }),
  });
}

export function populateThreatLayer(layer: VectorLayer, threats: ThreatRing[], viewMode: ViewMode = 'all'): void {
  const source = layer.getSource()!;
  source.clear();

  const filtered = viewMode === 'all' ? threats
    : viewMode === 'red' ? threats.filter((t) => t.coalition === 'red')
    : threats; // blue/players: show all threats (enemy intel)

  for (const t of filtered) {
    if (!t.lat || !t.lon) continue;
    const center = fromLonLat([t.lon, t.lat]);
    // Convert meters to map projection units
    const resolution = getPointResolution('EPSG:3857', 1, center);
    const radiusInProjection = t.range / resolution;

    const feature = new Feature({
      geometry: new Circle(center, radiusInProjection),
      threat: t,
    });
    feature.setId(`threat-${t.name}-${t.x}-${t.y}`);
    source.addFeature(feature);
  }
}
