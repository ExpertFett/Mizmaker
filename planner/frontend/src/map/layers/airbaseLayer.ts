import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import type { FeatureLike } from 'ol/Feature';
import type { Airbase } from '../../types/mission';

// Layer-level style function. OL invokes this on each render for each feature,
// so edits to the style constants take effect immediately under Vite HMR
// without needing to repopulate the layer.
function airbaseStyleFn(feature: FeatureLike): Style {
  const ab = feature.get('airbase') as Airbase | undefined;
  return new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: 'rgba(255, 235, 59, 0.95)' }),
      stroke: new Stroke({ color: '#000', width: 1.5 }),
    }),
    text: new Text({
      text: ab?.name ?? '',
      offsetY: -13,
      font: 'bold 12px sans-serif',
      fill: new Fill({ color: '#ffeb3b' }),
      stroke: new Stroke({ color: '#000', width: 3.5 }),
    }),
  });
}

export function createAirbaseLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    style: airbaseStyleFn,
    properties: { name: 'airbases' },
    zIndex: 15,
  });
}

export function populateAirbaseLayer(layer: VectorLayer, airbases: Airbase[]): void {
  const source = layer.getSource()!;
  source.clear();

  for (const ab of airbases) {
    if (!ab.lat || !ab.lon) continue;
    const feature = new Feature({
      geometry: new Point(fromLonLat([ab.lon, ab.lat])),
      airbase: ab,
    });
    // Style comes from the layer — do NOT setStyle here or it overrides
    // the layer-level style fn and blocks HMR updates.
    feature.setId(`airbase-${ab.name}`);
    source.addFeature(feature);
  }
}
