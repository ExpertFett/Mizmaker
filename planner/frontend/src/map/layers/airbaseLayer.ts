import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import type { Airbase } from '../../types/mission';

function createAirbaseStyle(name: string): Style {
  return new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: 'rgba(200, 164, 24, 0.8)' }),
      stroke: new Stroke({ color: 'rgba(200, 164, 24, 1)', width: 1.5 }),
    }),
    text: new Text({
      text: name,
      offsetY: -12,
      font: '10px sans-serif',
      fill: new Fill({ color: 'rgba(200, 164, 24, 0.9)' }),
      stroke: new Stroke({ color: '#000', width: 2 }),
    }),
  });
}

export function createAirbaseLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
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
    feature.setStyle(createAirbaseStyle(ab.name));
    feature.setId(`airbase-${ab.name}`);
    source.addFeature(feature);
  }
}
