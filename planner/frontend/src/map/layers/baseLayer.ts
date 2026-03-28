import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';

export function createBaseLayer(): TileLayer {
  return new TileLayer({
    source: new OSM(),
    properties: { name: 'base' },
  });
}
