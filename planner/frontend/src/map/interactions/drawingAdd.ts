/**
 * Drawing add interaction — click on map to create planner drawings.
 * Corridor & Reference Line: polyline (double-click to finish).
 * Threat Ring: single point click.
 * Racetrack: two-point line.
 */

import { Draw } from 'ol/interaction';
import { primaryAction } from 'ol/events/condition';
import VectorSource from 'ol/source/Vector';
import { toLonLat } from 'ol/proj';
import { Style } from 'ol/style';
import type Map from 'ol/Map';
import type { PlannerDrawingType } from '../../types/mission';

const HIDDEN = new Style({});

interface DrawCallbacks {
  onFinish: (type: PlannerDrawingType, coords: [number, number][]) => void;
}

export function createDrawingAdd(
  _map: Map,
  drawType: PlannerDrawingType,
  callbacks: DrawCallbacks,
): Draw {
  let olType: 'Point' | 'LineString' = 'LineString';
  let maxPoints: number | undefined;

  if (drawType === 'threatRing') {
    olType = 'Point';
  } else if (drawType === 'racetrack') {
    maxPoints = 2;
  }
  // corridor & referenceLine: unlimited points, double-click to finish

  const draw = new Draw({
    source: new VectorSource(),
    type: olType,
    condition: primaryAction,
    style: HIDDEN,
    ...(maxPoints ? { maxPoints } : {}),
  });

  draw.getOverlay().setStyle(HIDDEN);

  draw.on('drawend', (e) => {
    const geom = e.feature.getGeometry() as any;
    let coords: [number, number][];

    if (olType === 'Point') {
      const c = geom.getCoordinates();
      coords = [toLonLat(c) as [number, number]];
    } else {
      const rawCoords: number[][] = geom.getCoordinates();
      coords = rawCoords.map((c: number[]) => toLonLat(c) as [number, number]);
    }

    callbacks.onFinish(drawType, coords);

    // Clear sketch
    setTimeout(() => {
      (draw.getOverlay().getSource() as VectorSource).clear();
    }, 0);
  });

  return draw;
}
