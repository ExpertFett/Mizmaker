import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Circle from 'ol/geom/Circle';
import { fromLonLat, getPointResolution } from 'ol/proj';
import { Style, Fill, Stroke } from 'ol/style';
import type { ThreatRing } from '../../types/mission';
import type { ViewMode } from '../../store/mapStore';

const THREAT_STYLES: Record<string, Style> = {
  red: new Style({
    fill: new Fill({ color: 'rgba(217, 80, 80, 0.06)' }),
    stroke: new Stroke({ color: 'rgba(217, 80, 80, 0.45)', width: 1 }),
  }),
  blue: new Style({
    fill: new Fill({ color: 'rgba(74, 143, 212, 0.06)' }),
    stroke: new Stroke({ color: 'rgba(74, 143, 212, 0.45)', width: 1 }),
  }),
  neutrals: new Style({
    fill: new Fill({ color: 'rgba(143, 168, 192, 0.06)' }),
    stroke: new Stroke({ color: 'rgba(143, 168, 192, 0.4)', width: 1 }),
  }),
};

/** EW radar rings: dashed, no fill. The radius is a NOMINAL detection range —
 *  terrain and radar horizon cut it hard for low flyers — so it must not
 *  read as a solid weapon ring. */
const EW_STYLES: Record<string, Style> = {
  red: new Style({ stroke: new Stroke({ color: 'rgba(217, 80, 80, 0.35)', width: 1, lineDash: [8, 6] }) }),
  blue: new Style({ stroke: new Stroke({ color: 'rgba(74, 143, 212, 0.35)', width: 1, lineDash: [8, 6] }) }),
  neutrals: new Style({ stroke: new Stroke({ color: 'rgba(143, 168, 192, 0.3)', width: 1, lineDash: [8, 6] }) }),
};

export function createThreatLayer(): VectorLayer {
  return new VectorLayer({
    source: new VectorSource(),
    properties: { name: 'threats' },
    zIndex: 10,
  });
}

export function populateThreatLayer(
  layer: VectorLayer,
  threats: ThreatRing[],
  viewMode: ViewMode = 'all',
): void {
  const source = layer.getSource()!;
  source.clear();

  let filtered = threats;
  // Match the literal coalition label — "Blue" means blue only, not
  // "blue's perspective". Threats from the opposing side are still
  // accessible via the Threats layer toggle in 'all' mode.
  if (viewMode === 'red') filtered = threats.filter((t) => t.coalition === 'red');
  else if (viewMode === 'blue') filtered = threats.filter((t) => t.coalition === 'blue');
  else if (viewMode === 'players') filtered = threats; // show all threats for players

  for (const t of filtered) {
    if (!t.lat || !t.lon) continue;
    const center = fromLonLat([t.lon, t.lat]);
    const resolution = getPointResolution('EPSG:3857', 1, center);
    const radiusInProjection = t.range / resolution;

    const feature = new Feature({
      geometry: new Circle(center, radiusInProjection),
      threat: t,
    });
    const styles = t.role === 'ew' ? EW_STYLES : THREAT_STYLES;
    feature.setStyle(styles[t.coalition] || styles.red);
    feature.setId(`threat-${t.name}-${t.x}-${t.y}`);
    source.addFeature(feature);
  }
}
