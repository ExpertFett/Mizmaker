/**
 * Waypoint drag — raw pointer-based implementation.
 * Checks admin lock before allowing drag on non-player groups.
 */

import type Map from 'ol/Map';
import type VectorLayer from 'ol/layer/Vector';
import { toLonLat } from 'ol/proj';
import type Feature from 'ol/Feature';
import type { Point } from 'ol/geom';

interface DragCallbacks {
  onDragEnd: (groupId: number, wpIndex: number, lat: number, lon: number) => void;
  isEditLocked?: (groupId: number) => boolean;
}

export function setupWaypointDrag(
  map: Map,
  routeLayer: VectorLayer,
  callbacks: DragCallbacks,
): () => void {
  let dragging: Feature | null = null;

  function isWaypointHit(feature: any, layer: any): boolean {
    return (
      layer === routeLayer &&
      feature.get('featureType') === 'waypoint' &&
      feature.get('wpIndex') > 0
    );
  }

  function onPointerDown(e: any) {
    const hit = map.forEachFeatureAtPixel(
      e.pixel,
      (feature, layer) => isWaypointHit(feature, layer) ? feature as Feature : undefined,
      { hitTolerance: 12 },
    );

    if (hit) {
      const gid = hit.get('groupId');
      // Check admin lock
      if (callbacks.isEditLocked?.(gid)) {
        map.getTargetElement().style.cursor = 'not-allowed';
        setTimeout(() => { map.getTargetElement().style.cursor = ''; }, 300);
        return;
      }
      dragging = hit;
      map.getTargetElement().style.cursor = 'grabbing';
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onPointerMove(e: any) {
    if (!dragging) {
      const hit = map.forEachFeatureAtPixel(
        e.pixel,
        (feature, layer) => isWaypointHit(feature, layer) ? feature : undefined,
        { hitTolerance: 12 },
      );
      if (hit) {
        const gid = (hit as any).get('groupId');
        map.getTargetElement().style.cursor = callbacks.isEditLocked?.(gid) ? 'not-allowed' : 'grab';
      } else {
        map.getTargetElement().style.cursor = '';
      }
      return;
    }

    const coord = map.getCoordinateFromPixel(e.pixel);
    const geom = dragging.getGeometry() as Point;
    geom.setCoordinates(coord);
  }

  function onPointerUp() {
    if (!dragging) return;

    const geom = dragging.getGeometry() as Point;
    const coord = geom.getCoordinates();
    const [lon, lat] = toLonLat(coord);
    const groupId = dragging.get('groupId');
    const wpIndex = dragging.get('wpIndex');

    dragging = null;
    map.getTargetElement().style.cursor = '';

    if (groupId != null && wpIndex != null) {
      callbacks.onDragEnd(groupId, wpIndex, lat, lon);
    }
  }

  map.on('pointerdown' as any, onPointerDown);
  map.on('pointermove' as any, onPointerMove);
  map.on('pointerup' as any, onPointerUp);

  return () => {
    map.un('pointerdown' as any, onPointerDown);
    map.un('pointermove' as any, onPointerMove);
    map.un('pointerup' as any, onPointerUp);
  };
}
