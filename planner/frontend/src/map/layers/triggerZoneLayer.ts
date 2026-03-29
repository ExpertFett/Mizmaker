import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import { fromLonLat } from 'ol/proj';
import { circular } from 'ol/geom/Polygon';
import { Style, Fill, Stroke, Text } from 'ol/style';
import type { TriggerZone } from '../../types/mission';

export function createTriggerZoneLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    properties: { name: 'triggerZones' },
    zIndex: 12,
  });
}

/**
 * Parse a CSS rgba() string to extract components.
 */
function parseRgba(color: string): { r: number; g: number; b: number; a: number } {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]*)\)/);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] ? +m[4] : 1 };
  }
  return { r: 255, g: 255, b: 255, a: 0.15 };
}

export function populateTriggerZoneLayer(
  layer: VectorLayer,
  zones: TriggerZone[],
  visible: boolean = true,
): void {
  const source = layer.getSource()!;
  source.clear();

  if (!visible) return;

  for (const zone of zones) {
    if (zone.hidden) continue;
    if (!zone.lat || !zone.lon) continue;

    const center = fromLonLat([zone.lon, zone.lat]);
    const { r, g, b, a } = parseRgba(zone.color);
    const fillColor = `rgba(${r},${g},${b},${Math.min(a, 0.25)})`;
    const strokeColor = `rgba(${r},${g},${b},${Math.min(a * 3, 0.8)})`;

    let feature: Feature;

    if (zone.type === 2 && zone.vertices && zone.vertices.length >= 3) {
      // Polygon zone
      const coords = zone.vertices.map((v) => fromLonLat([v[1], v[0]]));
      coords.push(coords[0]); // close the ring
      feature = new Feature({
        geometry: new Polygon([coords]),
        zoneId: zone.zoneId,
        zoneName: zone.name,
        featureType: 'triggerZone',
      });
    } else {
      // Circle zone — approximate with a 64-sided polygon for rendering
      const geom = circular(
        [zone.lon, zone.lat],
        zone.radius,
        64,
      );
      geom.transform('EPSG:4326', 'EPSG:3857');
      feature = new Feature({
        geometry: geom,
        zoneId: zone.zoneId,
        zoneName: zone.name,
        featureType: 'triggerZone',
        radius: zone.radius,
        center,
      });
    }

    const styles: Style[] = [
      new Style({
        fill: new Fill({ color: fillColor }),
        stroke: new Stroke({ color: strokeColor, width: 2, lineDash: [8, 4] }),
      }),
    ];

    // Zone name label at center
    if (zone.name) {
      styles.push(
        new Style({
          geometry: new Point(center),
          text: new Text({
            text: zone.name,
            font: 'bold 12px sans-serif',
            fill: new Fill({ color: `rgba(${r},${g},${b},0.9)` }),
            stroke: new Stroke({ color: '#000', width: 2.5 }),
          }),
        }),
      );
    }

    feature.setStyle(styles);
    feature.setId(`zone-${zone.zoneId}`);
    source.addFeature(feature);
  }
}
