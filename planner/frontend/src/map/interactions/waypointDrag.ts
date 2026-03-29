/**
 * Waypoint drag — raw pointer-based implementation.
 * Checks admin lock before allowing drag on non-player groups.
 * Route lines update in real-time as waypoints are dragged.
 */

import type Map from 'ol/Map';
import type VectorLayer from 'ol/layer/Vector';
import { toLonLat } from 'ol/proj';
import type Feature from 'ol/Feature';
import type { Point, LineString } from 'ol/geom';

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
  let routeFeature: Feature | null = null;
  let routeCoordIndex: number = -1;

  function isWaypointHit(feature: any, layer: any): boolean {
    return (
      layer === routeLayer &&
      feature.get('featureType') === 'waypoint' &&
      feature.get('wpIndex') > 0
    );
  }

  /**
   * Find the route LineString feature for a group and determine which
   * coordinate index corresponds to the dragged waypoint.
   */
  function findRouteAndIndex(groupId: number, wpIndex: number): void {
    const source = routeLayer.getSource();
    if (!source) return;

    // Find the route line feature for this group
    const routeFeat = source.getFeatureById(`route-${groupId}`) as Feature | null;
    if (!routeFeat) return;

    const geom = routeFeat.getGeometry();
    if (!geom || geom.getType() !== 'LineString') return;

    routeFeature = routeFeat;

    // The route coords are built from waypoints that have lat/lon, in order.
    // WP0 is skipped for dots but IS in the route line (it's the departure point).
    // wpIndex is the waypoint_number (1-based for non-departure WPs).
    // Route coords include WP0, so the coord index for wpIndex N is N.
    // But if some WPs lack coords they're filtered out, so we match by finding
    // the waypoint feature positions in the line.
    const lineGeom = geom as LineString;
    const lineCoords = lineGeom.getCoordinates();

    // Find WP0 + all waypoint features for this group to build index mapping
    const wpFeatures: { wpIdx: number; coord: number[] }[] = [];
    source.getFeatures().forEach((f) => {
      if (f.get('groupId') === groupId && f.get('featureType') === 'waypoint') {
        const pt = f.getGeometry() as Point;
        wpFeatures.push({ wpIdx: f.get('wpIndex'), coord: pt.getCoordinates() });
      }
    });

    // WP0 (departure) is at coords[0] in the line, then WP1 at coords[1], etc.
    // Since route is built from all waypoints with valid lat/lon in order,
    // wpIndex maps to that same position in the line coordinates.
    // Best approach: match the dragged WP's current position to find its index.
    const draggedWpFeat = wpFeatures.find((w) => w.wpIdx === wpIndex);
    if (!draggedWpFeat) {
      routeCoordIndex = wpIndex; // fallback
      return;
    }

    const [dx, dy] = draggedWpFeat.coord;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < lineCoords.length; i++) {
      const dist = Math.abs(lineCoords[i][0] - dx) + Math.abs(lineCoords[i][1] - dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    routeCoordIndex = bestIdx;
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
      findRouteAndIndex(gid, hit.get('wpIndex'));
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

    // Move the waypoint dot
    const geom = dragging.getGeometry() as Point;
    geom.setCoordinates(coord);

    // Update the route line in real-time
    if (routeFeature && routeCoordIndex >= 0) {
      const lineGeom = routeFeature.getGeometry() as LineString;
      const coords = lineGeom.getCoordinates();
      if (routeCoordIndex < coords.length) {
        coords[routeCoordIndex] = coord;
        lineGeom.setCoordinates(coords);
      }
    }
  }

  function onPointerUp() {
    if (!dragging) return;

    const geom = dragging.getGeometry() as Point;
    const coord = geom.getCoordinates();
    const [lon, lat] = toLonLat(coord);
    const groupId = dragging.get('groupId');
    const wpIndex = dragging.get('wpIndex');

    dragging = null;
    routeFeature = null;
    routeCoordIndex = -1;
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
