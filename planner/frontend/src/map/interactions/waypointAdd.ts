/**
 * Waypoint add interaction — click on map to add a new waypoint.
 * Uses OL Draw interaction of type Point.
 */

import { Draw } from 'ol/interaction';
import VectorSource from 'ol/source/Vector';
import { toLonLat } from 'ol/proj';
import type Map from 'ol/Map';

interface AddCallbacks {
  onAdd: (lat: number, lon: number) => void;
}

export function createWaypointAdd(map: Map, callbacks: AddCallbacks): Draw {
  const draw = new Draw({
    source: new VectorSource(), // temporary, features not kept
    type: 'Point',
  });

  draw.on('drawend', (e) => {
    const coord = (e.feature.getGeometry() as any).getCoordinates();
    const [lon, lat] = toLonLat(coord);
    callbacks.onAdd(lat, lon);
    // Remove the drawn feature since we handle it through our store
    setTimeout(() => {
      (draw.getOverlay().getSource() as VectorSource).clear();
    }, 0);
  });

  return draw;
}
