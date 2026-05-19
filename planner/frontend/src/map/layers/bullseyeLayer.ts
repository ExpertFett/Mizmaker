/**
 * Bullseye layer — renders the per-coalition bullseye reference points
 * on the main map. DCS uses bullseye as the navigation/comms anchor for
 * BRAA calls and threat positions, so pilots and mission designers
 * both want to see exactly where it sits before they start measuring.
 *
 * Each side gets its own bullseye in DCS (`coalition.{blue|red}.bullseye
 * = {x, y}`). The backend converts the DCS xyz coords to lat/lon during
 * upload and emits both blue + red entries on `overview.bullseye`.
 *
 * Visual: a target-style concentric ring with a center dot, color-coded
 * to the side (BLUE blue, RED red). Label below shows "BE-BLUE" /
 * "BE-RED" so the marker reads at a glance even when both coalitions'
 * bullseyes overlap on a small map.
 */

import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke, Circle as CircleStyle, Text } from 'ol/style';
import type { FeatureLike } from 'ol/Feature';
import type { MissionOverviewData } from '../../types/mission';

// Side colours mirror the rest of the map's coalition palette so a
// blue bullseye doesn't look out of place next to blue waypoints.
const SIDE_COLOR: Record<string, string> = {
  blue: '#4a8fd4',
  red:  '#d95050',
};

function bullseyeStyleFn(feature: FeatureLike): Style[] {
  const side = (feature.get('side') as string) || 'blue';
  const color = SIDE_COLOR[side] || '#aaaaaa';

  // Two-ring target with a centre dot — classic bullseye glyph.
  // Outer ring is hollow, inner ring is hollow, centre is filled.
  return [
    new Style({
      image: new CircleStyle({
        radius: 12,
        fill: new Fill({ color: 'rgba(0,0,0,0.001)' }),  // transparent fill so OL hits the stroke
        stroke: new Stroke({ color, width: 1.5 }),
      }),
    }),
    new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: 'rgba(0,0,0,0.001)' }),
        stroke: new Stroke({ color, width: 1.5 }),
      }),
    }),
    new Style({
      image: new CircleStyle({
        radius: 2.5,
        fill: new Fill({ color }),
      }),
      text: new Text({
        text: `BE-${side.toUpperCase()}`,
        offsetY: 22,
        font: 'bold 11px sans-serif',
        fill: new Fill({ color }),
        stroke: new Stroke({ color: '#000', width: 3 }),
      }),
    }),
  ];
}

export function createBullseyeLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    style: bullseyeStyleFn,
    properties: { name: 'bullseye' },
    // Sit above airbases (zIndex 15) so the marker isn't masked when
    // a bullseye lands on top of an airfield.
    zIndex: 17,
  });
}

export function populateBullseyeLayer(
  layer: VectorLayer,
  bullseye: MissionOverviewData['bullseye'] | undefined,
): void {
  const source = layer.getSource()!;
  source.clear();

  if (!bullseye) return;

  for (const side of ['blue', 'red'] as const) {
    const be = bullseye[side];
    // Some old missions emit bullseye = {x:0, y:0} when never set; skip
    // zero-coord entries so we don't drop a marker in the middle of
    // the ocean. Backend already conditions on lat/lon presence but
    // this is a belt-and-braces.
    if (!be || be.lat == null || be.lon == null) continue;
    if (be.lat === 0 && be.lon === 0) continue;
    const feature = new Feature({
      geometry: new Point(fromLonLat([be.lon, be.lat])),
      side,
    });
    feature.setId(`bullseye-${side}`);
    source.addFeature(feature);
  }
}
