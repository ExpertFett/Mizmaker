/**
 * Waypoint drag — raw pointer-based implementation.
 * Avoids Translate/Modify which can grab wrong features.
 * Directly tracks pointerdown→pointermove→pointerup on waypoint features.
 */

import type Map from 'ol/Map';
import type VectorLayer from 'ol/layer/Vector';
import { toLonLat } from 'ol/proj';
import type Feature from 'ol/Feature';
import type { Point } from 'ol/geom';

interface DragCallbacks {
  onDragEnd: (groupId: number, wpIndex: number, lat: number, lon: number) => void;
}

export function setupWaypointDrag(
  map: Map,
  routeLayer: VectorLayer,
  callbacks: DragCallbacks,
): () => void {
  let dragging: Feature | null = null;
  let startPixel: [number, number] | null = null;

  function onPointerDown(e: any) {
    // Only start drag on waypoint features from the route layer
    const hit = map.forEachFeatureAtPixel(
      e.pixel,
      (feature, layer) => {
        if (
          layer === routeLayer &&
          feature.get('featureType') === 'waypoint' &&
          feature.get('wpIndex') > 0
        ) {
          return feature as Feature;
        }
        return undefined;
      },
      { hitTolerance: 10 },
    );

    if (hit) {
      dragging = hit;
      startPixel = e.pixel;
      map.getTargetElement().style.cursor = 'grabbing';
      // Prevent map pan while dragging
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onPointerMove(e: any) {
    if (!dragging) {
      // Show grab cursor on hover over draggable waypoints
      const hit = map.forEachFeatureAtPixel(
        e.pixel,
        (feature, layer) => {
          if (
            layer === routeLayer &&
            feature.get('featureType') === 'waypoint' &&
            feature.get('wpIndex') > 0
          ) {
            return true;
          }
          return undefined;
        },
        { hitTolerance: 10 },
      );
      map.getTargetElement().style.cursor = hit ? 'grab' : '';
      return;
    }

    // Move the feature geometry to follow the pointer
    const coord = map.getCoordinateFromPixel(e.pixel);
    const geom = dragging.getGeometry() as Point;
    geom.setCoordinates(coord);
  }

  function onPointerUp(e: any) {
    if (!dragging) return;

    const geom = dragging.getGeometry() as Point;
    const coord = geom.getCoordinates();
    const [lon, lat] = toLonLat(coord);
    const groupId = dragging.get('groupId');
    const wpIndex = dragging.get('wpIndex');

    dragging = null;
    startPixel = null;
    map.getTargetElement().style.cursor = '';

    if (groupId != null && wpIndex != null) {
      callbacks.onDragEnd(groupId, wpIndex, lat, lon);
    }
  }

  // Use native DOM events for reliable capture
  const target = map.getTargetElement();
  const viewport = map.getViewport();

  map.on('pointerdown', onPointerDown);
  map.on('pointermove', onPointerMove);
  map.on('pointerup', onPointerUp);

  // Return cleanup function
  return () => {
    map.un('pointerdown', onPointerDown);
    map.un('pointermove', onPointerMove);
    map.un('pointerup', onPointerUp);
  };
}
