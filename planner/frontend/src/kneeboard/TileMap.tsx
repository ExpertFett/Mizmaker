/**
 * TileMap — renders CARTO dark map tiles behind kneeboard route overlays.
 *
 * Uses slippy-map math to compute which tiles cover the bounding box,
 * then renders them as <img> elements that html2canvas can capture.
 * Children (SVG route overlay) are positioned on top.
 */

const TILE_SIZE = 256;

export type BaseLayer = 'dark' | 'satellite';

/* Two basemaps. Both send `Access-Control-Allow-Origin: *`, so html2canvas can
   capture the card without tainting the canvas. Note the URL schemes differ:
   CARTO is {z}/{x}/{y}, ESRI is {z}/{row}/{col} i.e. {z}/{y}/{x}. Swapping them
   silently returns valid-but-wrong tiles rather than a 404. */
const LAYERS: Record<BaseLayer, {
  url: (z: number, x: number, y: number) => string;
  opacity: number;
  credit: string;
}> = {
  dark: {
    url: (z, x, y) => `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
    opacity: 0.7,
    credit: '(c) OpenStreetMap, (c) CARTO',
  },
  satellite: {
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    // Held back slightly so route lines and threat rings stay readable on top.
    opacity: 0.9,
    credit: 'Imagery (c) Esri',
  },
};

/* ---- Slippy-map tile math ---- */

function lon2tile(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
}

function lat2tile(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    Math.pow(2, zoom)
  );
}

/** Find the highest zoom level where the bbox fits within the given pixel dimensions */
function fitZoom(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  width: number,
  height: number,
): number {
  for (let z = 16; z >= 2; z--) {
    const x0 = lon2tile(minLon, z);
    const x1 = lon2tile(maxLon, z);
    const y0 = lat2tile(maxLat, z); // Note: y increases downward
    const y1 = lat2tile(minLat, z);
    const pxW = (x1 - x0) * TILE_SIZE;
    const pxH = (y1 - y0) * TILE_SIZE;
    if (pxW <= width * 1.2 && pxH <= height * 1.2) return z;
  }
  return 2;
}

export interface TileMapProps {
  /** Map viewport in pixels */
  width: number;
  height: number;
  /** Geographic bounds */
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  /** SVG overlay rendered on top of tiles */
  children?: React.ReactNode;
  /** Basemap style. Real imagery is the default — it is what makes a target
   *  area recognisable from the air. */
  layer?: BaseLayer;
  /** Suppress the attribution strip (only when the caller draws its own). */
  hideCredit?: boolean;
}

/**
 * Project a lat/lon to pixel coordinates within this TileMap.
 * Call with the same bounds you pass to <TileMap>.
 */
export function createProjection(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  width: number,
  height: number,
) {
  const zoom = fitZoom(minLat, maxLat, minLon, maxLon, width, height);

  // Center of the bbox in tile-space
  const centerTileX = (lon2tile(minLon, zoom) + lon2tile(maxLon, zoom)) / 2;
  const centerTileY = (lat2tile(maxLat, zoom) + lat2tile(minLat, zoom)) / 2;

  // Pixel offset: center of viewport maps to center of bbox
  const originPxX = centerTileX * TILE_SIZE - width / 2;
  const originPxY = centerTileY * TILE_SIZE - height / 2;

  return {
    zoom,
    originPxX,
    originPxY,
    project(lat: number, lon: number): [number, number] {
      const px = lon2tile(lon, zoom) * TILE_SIZE - originPxX;
      const py = lat2tile(lat, zoom) * TILE_SIZE - originPxY;
      return [px, py];
    },
    /** Convert a distance in meters to pixels at the map center latitude */
    metersToPixels(meters: number): number {
      const midLat = (minLat + maxLat) / 2;
      const metersPerPixel =
        (156543.03392 * Math.cos((midLat * Math.PI) / 180)) /
        Math.pow(2, zoom);
      return meters / metersPerPixel;
    },
  };
}

export function TileMap({
  width,
  height,
  minLat,
  maxLat,
  minLon,
  maxLon,
  children,
  layer = 'satellite',
  hideCredit = false,
}: TileMapProps) {
  const base = LAYERS[layer] ?? LAYERS.satellite;
  const zoom = fitZoom(minLat, maxLat, minLon, maxLon, width, height);

  // Center of the bbox in tile-space
  const centerTileX = (lon2tile(minLon, zoom) + lon2tile(maxLon, zoom)) / 2;
  const centerTileY = (lat2tile(maxLat, zoom) + lat2tile(minLat, zoom)) / 2;

  // Pixel origin (top-left of the viewport in global tile-pixel space)
  const originPxX = centerTileX * TILE_SIZE - width / 2;
  const originPxY = centerTileY * TILE_SIZE - height / 2;

  // Which tiles are visible
  const tileXMin = Math.floor(originPxX / TILE_SIZE);
  const tileXMax = Math.floor((originPxX + width) / TILE_SIZE);
  const tileYMin = Math.floor(originPxY / TILE_SIZE);
  const tileYMax = Math.floor((originPxY + height) / TILE_SIZE);

  const maxTile = Math.pow(2, zoom) - 1;

  const tiles: { x: number; y: number; left: number; top: number }[] = [];
  for (let tx = tileXMin; tx <= tileXMax; tx++) {
    for (let ty = tileYMin; ty <= tileYMax; ty++) {
      // Wrap x, clamp y
      const wrappedX = ((tx % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1);
      if (ty < 0 || ty > maxTile) continue;
      tiles.push({
        x: wrappedX,
        y: ty,
        left: tx * TILE_SIZE - originPxX,
        top: ty * TILE_SIZE - originPxY,
      });
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        borderRadius: 4,
        background: 'var(--kb-bg, #1a1a1a)',
      }}
    >
      {/* Map tiles */}
      {tiles.map((t) => (
        <img
          key={`${zoom}-${t.x}-${t.y}`}
          src={base.url(zoom, t.x, t.y)}
          crossOrigin="anonymous"
          width={TILE_SIZE}
          height={TILE_SIZE}
          style={{
            position: 'absolute',
            left: t.left,
            top: t.top,
            display: 'block',
            imageRendering: 'auto',
            opacity: base.opacity,
          }}
          alt=""
        />
      ))}
      {/* SVG overlay */}
      {children && (
        <div style={{ position: 'absolute', top: 0, left: 0, width, height }}>
          {children}
        </div>
      )}
      {/* Attribution — required by both providers' terms of use. */}
      {!hideCredit && (
        <div style={{
          position: 'absolute', right: 3, bottom: 2, fontSize: 9,
          color: 'rgba(255,255,255,0.55)', textShadow: '0 0 3px #000',
          pointerEvents: 'none',
        }}>
          {base.credit}
        </div>
      )}
    </div>
  );
}
