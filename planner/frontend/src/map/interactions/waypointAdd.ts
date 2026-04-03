/**
 * Waypoint add interaction — click on map to add a new waypoint.
 * Uses OL Draw interaction of type Point.
 */

import { Draw } from 'ol/interaction';
import { primaryAction } from 'ol/events/condition';
import VectorSource from 'ol/source/Vector';
import { toLonLat } from 'ol/proj';
import { Style } from 'ol/style';
import type Map from 'ol/Map';

interface AddCallbacks {
  onAdd: (lat: number, lon: number) => void;
}

// Invisible style — prevents the blue dot from appearing
const HIDDEN = new Style({});

export function createWaypointAdd(_map: Map, callbacks: AddCallbacks): Draw {
  const draw = new Draw({
    source: new VectorSource(),
    type: 'Point',
    condition: primaryAction,
    style: HIDDEN,
  });

  // Hide the overlay layer too (sketch features)
  draw.getOverlay().setStyle(HIDDEN);

  draw.on('drawend', (e) => {
    const coord = (e.feature.getGeometry() as any).getCoordinates();
    const [lon, lat] = toLonLat(coord);
    callbacks.onAdd(lat, lon);
    setTimeout(() => {
      (draw.getOverlay().getSource() as VectorSource).clear();
    }, 0);
  });

  return draw;
}
