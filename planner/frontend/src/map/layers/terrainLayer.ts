/**
 * Terrain elevation via invisible terrain-rgb tile layer.
 * Uses AWS Terrain Tiles (free, no API key) as primary source.
 * Elevation encoded in RGB pixels: elevation = (R * 256 + G + B / 256) - 32768
 *
 * Also supports MapTiler terrain-rgb if VITE_MAPTILER_KEY is set.
 * MapTiler decode: elevation = (R * 65536 + G * 256 + B) * 0.1 - 10000
 */

import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || '';

export const TERRAIN_HEIGHT_LAYER_NAME = '__terrain_rgb';

// Use MapTiler if key available, otherwise AWS terrain tiles (free, no key)
const useMaptiler = !!MAPTILER_KEY;

export function createTerrainRgbLayer(): TileLayer {
  const source = useMaptiler
    ? new XYZ({
        url: `https://api.maptiler.com/tiles/terrain-rgb/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
        maxZoom: 12,
        tileSize: 512,
        crossOrigin: '',
      })
    : new XYZ({
        url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
        maxZoom: 15,
        tileSize: 256,
        crossOrigin: 'anonymous',
        attributions: 'Elevation: AWS/Mapzen Terrarium',
      });

  return new TileLayer({
    source,
    properties: { name: TERRAIN_HEIGHT_LAYER_NAME },
    opacity: 0,
    zIndex: 0,
  });
}

export function createHillshadeLayer(): TileLayer | null {
  if (!MAPTILER_KEY) return null;

  return new TileLayer({
    source: new XYZ({
      url: `https://api.maptiler.com/tiles/hillshades/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
      maxZoom: 12,
      tileSize: 256,
      crossOrigin: 'anonymous',
    }),
    properties: { name: 'hillshade' },
    opacity: 0.3,
    visible: false,
    zIndex: 1,
  });
}

/**
 * Decode elevation from terrain-rgb pixel data.
 * Terrarium (AWS) format: elevation = (R * 256 + G + B / 256) - 32768
 * MapTiler format: elevation = (R * 65536 + G * 256 + B) * 0.1 - 10000
 */
export function decodeElevation(rgba: Uint8ClampedArray | number[] | null): number | null {
  if (!rgba || rgba.length < 3) return null;
  if (rgba[0] === 0 && rgba[1] === 0 && rgba[2] === 0) return null;

  if (useMaptiler) {
    return (rgba[0] * 65536 + rgba[1] * 256 + rgba[2]) * 0.1 - 10000;
  }
  // Terrarium encoding
  return rgba[0] * 256 + rgba[1] + rgba[2] / 256 - 32768;
}

/**
 * Get terrain elevation at a screen pixel from the terrain-rgb tile layer.
 * Returns elevation in meters, or null if tile not yet loaded.
 */
export function getElevationFromLayer(
  terrainLayer: TileLayer,
  pixel: number[],
): number | null {
  try {
    const data = terrainLayer.getData(pixel);
    if (!data) return null;
    return decodeElevation(data as Uint8ClampedArray);
  } catch {
    return null;
  }
}
