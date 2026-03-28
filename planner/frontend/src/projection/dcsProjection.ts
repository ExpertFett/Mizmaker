/**
 * DCS coordinate projection — converts between DCS (x, y) and WGS84 (lat, lon).
 *
 * Uses proj4js with Transverse Mercator parameters from pydcs / web-editor.
 * Critical axis convention: DCS X = northing, Y = easting.
 * The +axis=neu in the proj string handles this so we pass [y, x] to inverse.
 */

import proj4 from 'proj4';

interface TheaterConfig {
  lon_0: number;
  x_0: number;
  y_0: number;
}

const THEATER_CONFIGS: Record<string, TheaterConfig> = {
  Caucasus:        { lon_0: 33,   x_0: -99517,        y_0: -4998115 },
  Syria:           { lon_0: 39,   x_0: 282801,        y_0: -3879866 },
  PersianGulf:     { lon_0: 57,   x_0: 75756,         y_0: -2894933 },
  Nevada:          { lon_0: -117, x_0: -193996.81,    y_0: -4410028.064 },
  SinaiMap:        { lon_0: 33,   x_0: 169222,        y_0: -3325313 },
  Normandy:        { lon_0: -3,   x_0: -195526,       y_0: -5484813 },
  TheChannel:      { lon_0: 3,    x_0: 99376,         y_0: -5636889 },
  MarianaIslands:  { lon_0: 147,  x_0: 238418,        y_0: -1491840 },
  Falklands:       { lon_0: -57,  x_0: 147640,        y_0: 5815417 },
  Kola:            { lon_0: 21,   x_0: -62702,        y_0: -7543625 },
  Afghanistan:     { lon_0: 63,   x_0: -300150,       y_0: -3759657 },
  Iraq:            { lon_0: 45,   x_0: 72290,         y_0: -3680057 },
  TopEndAustralia: { lon_0: 135,  x_0: 500000,        y_0: 10000000 },
  SouthEastAsia:   { lon_0: 107,  x_0: 200000,        y_0: -1800000 },
  GermanyCW:       { lon_0: 21,   x_0: 35427.62,      y_0: -6061633.128 },
};

let projector: proj4.Converter | null = null;
let activeTheater: string | null = null;

export function setActiveTheater(name: string): void {
  const cfg = THEATER_CONFIGS[name];
  if (!cfg) throw new Error(`Unknown theater: ${name}`);

  projector = proj4(
    `+proj=tmerc +lat_0=0 +lon_0=${cfg.lon_0} +k_0=0.9996 ` +
    `+x_0=${cfg.x_0} +y_0=${cfg.y_0} ` +
    `+towgs84=0,0,0,0,0,0,0 +units=m +vunits=m +ellps=WGS84 +no_defs +axis=neu`
  );
  activeTheater = name;
}

export function dcsToLatLon(x: number, y: number): { lat: number; lon: number } {
  if (!projector) throw new Error('Call setActiveTheater first');
  // projector.inverse([y, x]) returns [lon, lat] because of +axis=neu
  const [lon, lat] = projector.inverse([y, x]);
  return { lat, lon };
}

export function latLonToDcs(lat: number, lon: number): { x: number; y: number } {
  if (!projector) throw new Error('Call setActiveTheater first');
  // projector.forward([lon, lat]) returns [y_dcs, x_dcs]
  const [y, x] = projector.forward([lon, lat]);
  return { x, y };
}

export function getActiveTheater(): string | null {
  return activeTheater;
}

export function getSupportedTheaters(): string[] {
  return Object.keys(THEATER_CONFIGS);
}
