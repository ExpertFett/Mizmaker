/**
 * DCS Airbase communications data — tower, ATIS, TACAN, ILS, runways.
 * Keyed by airbase name (must match the name from airbases.json).
 * Values are DCS defaults — actual frequencies may differ in edited missions.
 */

export interface AirbaseCommsData {
  /** ATC / Tower frequency (MHz AM) */
  tower?: number;
  /** ATIS frequency (MHz AM) — not all fields have ATIS */
  atis?: number;
  /** Ground / Approach frequency (MHz AM) */
  ground?: number;
  /** TACAN channel + band (e.g., "74X") */
  tacan?: string;
  /** ILS frequency (MHz) + runway (e.g., "109.10 / RW25") */
  ils?: string;
  /** Active runways (e.g., "08/26", "04L/22R") */
  runways?: string;
  /** Elevation in feet MSL */
  elevation?: number;
}

/** Key = lowercase airbase name for case-insensitive lookup */
const DB: Record<string, AirbaseCommsData> = {

  // ═══ CAUCASUS ═══════════════════════════════════════════════════════
  'anapa-vityazevo':       { tower: 121.0, ground: 250.0, tacan: '36X', ils: '111.50 / RW04', runways: '04/22', elevation: 141 },
  'batumi':                { tower: 131.0, atis: 260.0, tacan: '16X', ils: '110.30 / RW13', runways: '13/31', elevation: 33 },
  'beslan':                { tower: 141.0, runways: '10/28', elevation: 1667 },
  'gelendzhik':            { tower: 126.0, runways: '04/22', elevation: 72 },
  'gudauta':               { tower: 130.0, runways: '15/33', elevation: 69 },
  'kobuleti':              { tower: 133.0, atis: 262.0, tacan: '67X', ils: '111.50 / RW07', runways: '07/25', elevation: 59 },
  'krasnodar-center':      { tower: 122.0, runways: '09/27', elevation: 98 },
  'krasnodar-pashkovsky':  { tower: 128.0, ils: '111.70 / RW05', runways: '05/23', elevation: 112 },
  'krymsk':                { tower: 124.0, runways: '04/22', elevation: 66 },
  'kutaisi':               { tower: 134.0, atis: 264.0, tacan: '44X', ils: '109.75 / RW08', runways: '08/26', elevation: 147 },
  'maykop-khanskaya':      { tower: 125.0, runways: '04/22', elevation: 590 },
  'mineralnye-vody':       { tower: 135.0, ils: '111.70 / RW12', runways: '12/30', elevation: 1050 },
  'mozdok':                { tower: 137.0, runways: '08/26', elevation: 509 },
  'nalchik':               { tower: 136.0, ils: '110.50 / RW06', runways: '06/24', elevation: 1461 },
  'novorossiysk':          { tower: 123.0, runways: '04/22', elevation: 131 },
  'senaki-kolkhi':         { tower: 132.0, atis: 263.0, tacan: '31X', ils: '108.90 / RW09', runways: '09/27', elevation: 43 },
  'sochi-adler':           { tower: 127.0, atis: 261.0, ils: '111.10 / RW06', runways: '06/24', elevation: 99 },
  'soganlug':              { tower: 139.0, runways: '13/31', elevation: 1474 },
  'sukhumi-babushara':     { tower: 129.0, runways: '12/30', elevation: 13 },
  'tbilisi-lochini':       { tower: 138.0, atis: 265.0, tacan: '25X', ils: '110.30 / RW13', runways: '13R/31L', elevation: 1575 },
  'vaziani':               { tower: 140.0, atis: 266.0, tacan: '22X', ils: '108.75 / RW13', runways: '13/31', elevation: 1523 },

  // ═══ NEVADA ═════════════════════════════════════════════════════════
  'nellis':                { tower: 327.0, atis: 270.1, tacan: '12X', ils: '109.10 / RW21', runways: '03L/21R, 03R/21L', elevation: 1870 },
  'creech':                { tower: 360.6, tacan: '87X', runways: '08/26, 13/31', elevation: 3133 },
  'mccarran international':{ tower: 119.9, atis: 132.4, ils: '110.30 / RW25L', runways: '01L/19R, 01R/19L, 07L/25R, 07R/25L', elevation: 2181 },
  'groom lake':            { tower: 250.05, tacan: '18X', runways: '14L/32R, 14R/32L', elevation: 4462 },
  'tonopah test range':    { tower: 257.95, tacan: '77X', runways: '14/32', elevation: 5549 },
  'laughlin':              { tower: 123.9, runways: '16/34', elevation: 650 },
  'north las vegas':       { tower: 125.7, runways: '07/25, 12L/30R, 12R/30L', elevation: 2205 },
  'jean':                  { tower: 118.4, runways: '02L/20R, 02R/20L', elevation: 2831 },
  'boulder city':          { tower: 123.5, runways: '15/33', elevation: 2471 },
  'henderson executive':   { tower: 125.1, runways: '17L/35R, 17R/35L', elevation: 2492 },
  'mesquite':              { tower: 122.7, runways: '01/19', elevation: 1978 },
  'pahute mesa':           { tower: 124.2, runways: '18/36', elevation: 5068 },
  'tonopah':               { tower: 123.8, runways: '11/29, 15/33', elevation: 5430 },
  'beatty':                { tower: 122.8, runways: '16/34', elevation: 3170 },
  'lincoln county':        { tower: 122.9, runways: '17/35', elevation: 4817 },
  'mina':                  { tower: 123.1, runways: '13/31', elevation: 4527 },

  // ═══ PERSIAN GULF ═══════════════════════════════════════════════════
  'al dhafra':             { tower: 126.5, atis: 251.0, tacan: '96X', ils: '109.10 / RW13', runways: '13L/31R, 13R/31L', elevation: 77 },
  'al maktoum intl':       { tower: 118.65, runways: '12/30', elevation: 114 },
  'al minhad':             { tower: 121.8, tacan: '99X', ils: '110.75 / RW27', runways: '09/27', elevation: 165 },
  'bandar abbas intl':     { tower: 118.1, ils: '111.70 / RW21', runways: '03/21', elevation: 22 },
  'dubai intl':            { tower: 118.75, atis: 253.0, ils: '110.10 / RW12L', runways: '12L/30R, 12R/30L', elevation: 34 },
  'fujairah intl':         { tower: 124.6, runways: '11/29', elevation: 152 },
  'khasab':                { tower: 118.2, runways: '19/01', elevation: 95 },
  'lar':                   { tower: 127.0, runways: '09/27', elevation: 2640 },
  'liwa':                  { tower: 120.6, runways: '14/32', elevation: 381 },
  'qeshm island':          { tower: 118.05, runways: '17/35', elevation: 30 },
  'sharjah intl':          { tower: 118.6, runways: '12/30', elevation: 111 },
  'shiraz intl':           { tower: 121.9, ils: '108.90 / RW29R', runways: '11L/29R, 11R/29L', elevation: 4920 },
  'sir abu nuayr':         { tower: 122.5, runways: '13/31', elevation: 16 },

  // ═══ SYRIA ══════════════════════════════════════════════════════════
  'incirlik':              { tower: 122.1, atis: 129.4, tacan: '21X', ils: '109.30 / RW23', runways: '05/23', elevation: 238 },
  'hatay':                 { tower: 128.5, runways: '04/22', elevation: 269 },
  'gaziantep':             { tower: 120.1, runways: '10/28', elevation: 2313 },
  'adana sakirpasa':       { tower: 121.1, runways: '05/23', elevation: 65 },
  'bassel al-assad':       { tower: 118.1, tacan: '94X', ils: '109.10 / RW17R', runways: '17L/35R, 17R/35L', elevation: 157 },
  'aleppo':                { tower: 119.1, runways: '09/27', elevation: 1276 },
  'damascus':              { tower: 118.5, ils: '109.90 / RW23R', runways: '05L/23R, 05R/23L', elevation: 2020 },
  'ramat david':           { tower: 118.6, tacan: '84X', ils: '109.30 / RW09', runways: '09/27, 15/33', elevation: 185 },
  'haifa':                 { tower: 127.8, ils: '111.10 / RW16', runways: '16/34', elevation: 28 },
  'king hussein':          { tower: 118.3, runways: '13/31', elevation: 2220 },
  'muwaffaq salti':        { tower: 118.3, tacan: '73X', runways: '08/26', elevation: 2240 },
  'wujah al hajar':        { tower: 120.5, runways: '02/20', elevation: 1411 },
  'beirut':                { tower: 118.9, ils: '110.10 / RW16', runways: '16/34, 17/35', elevation: 87 },
  'larnaca':               { tower: 121.2, ils: '109.50 / RW22', runways: '04/22', elevation: 8 },
  'paphos':                { tower: 128.4, ils: '108.90 / RW29', runways: '11/29', elevation: 41 },
  'akrotiri':              { tower: 128.0, tacan: '107X', ils: '109.70 / RW28', runways: '10/28', elevation: 76 },
  'hama':                  { tower: 118.05, runways: '09/27', elevation: 1014 },
  'palmyra':               { tower: 121.9, runways: '08/26', elevation: 1267 },
  'tabqa':                 { tower: 118.5, runways: '09/27', elevation: 1059 },
  'taftanaz':              { tower: 122.0, runways: '10/28', elevation: 1020 },
  'minakh':                { tower: 120.6, runways: '10/28', elevation: 1600 },
  'abu al-duhur':          { tower: 122.4, runways: '09/27', elevation: 1591 },
  'al qusayr':             { tower: 119.2, runways: '10/28', elevation: 1765 },
  'an nasiriyah':          { tower: 122.3, runways: '04/22', elevation: 313 },
  'tiyas':                 { tower: 120.5, runways: '09/27', elevation: 1760 },
  'sayqal':                { tower: 120.6, runways: '06/24', elevation: 2355 },
  'marj ruhayyil':         { tower: 120.8, runways: '06/24', elevation: 2145 },
  'mezzeh':                { tower: 120.7, runways: '06/24', elevation: 2407 },
  'kiryat shmona':         { tower: 118.4, runways: '03/21', elevation: 320 },
  'rosh pinna':            { tower: 118.4, runways: '15/33', elevation: 922 },
  'megiddo':               { tower: 119.9, runways: '09/27', elevation: 200 },

  // ═══ SOUTH ATLANTIC ═════════════════════════════════════════════════
  'mount pleasant':        { tower: 127.0, tacan: '91X', ils: '110.10 / RW10', runways: '10/28, 04/22', elevation: 73 },
  'san carlos fob':        { tower: 130.0, runways: '10/28', elevation: 30 },
  'goose green':           { tower: 128.0, runways: '10/28', elevation: 15 },
  'port stanley':          { tower: 125.0, runways: '08/26', elevation: 75 },

  // ═══ SINAI ══════════════════════════════════════════════════════════
  'cairo west':            { tower: 118.1, runways: '05/23, 11/29', elevation: 550 },
  'cairo intl':            { tower: 121.5, ils: '110.30 / RW05C', runways: '05C/23C, 05R/23L, 05L/23R', elevation: 382 },
  'el arish':              { tower: 121.1, runways: '16/34', elevation: 121 },
  'ben gurion':            { tower: 118.3, ils: '109.50 / RW30', runways: '08/26, 12/30, 03/21', elevation: 135 },
  'ramon':                 { tower: 118.6, tacan: '55X', ils: '111.10 / RW18', runways: '18/36', elevation: 2126 },
  'nevatim':               { tower: 118.5, tacan: '59X', ils: '109.70 / RW02', runways: '02/20, 08/26', elevation: 1330 },
  'ovda':                  { tower: 118.6, tacan: '79X', runways: '02/20', elevation: 1490 },

  // ═══ MARIANA ISLANDS ════════════════════════════════════════════════
  'andersen afb':          { tower: 126.2, tacan: '54X', ils: '110.30 / RW06L', runways: '06L/24R, 06R/24L', elevation: 627 },
};

/**
 * Look up comms data for an airbase by name.
 * Tries exact match first, then substring match.
 */
export function getAirbaseComms(name: string): AirbaseCommsData | null {
  const key = name.toLowerCase().trim();
  if (DB[key]) return DB[key];

  // Fuzzy: check if any DB key is contained in the name or vice versa
  for (const [k, v] of Object.entries(DB)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* ATIS frequency suggester                                            */
/* ------------------------------------------------------------------ */

/**
 * Deterministic ATIS frequency suggestion for an airbase that doesn't
 * have a known value in the DB above.
 *
 * Output range: 250.000 – 269.975 MHz UHF (military 25 kHz grid),
 * matching the band DCS Caucasus uses for its built-in ATIS broadcasts
 * (Batumi 260.0, Sochi 261.0, etc.). Same airbase name always yields
 * the same suggestion across sessions, so users can rely on the
 * planner-generated value matching their own kneeboards.
 *
 * Use case: AtisConfigTab calls this when the user adds an airbase
 * whose DB entry has no `atis` field. The 251.0 generic default that
 * AtisConfigTab used to fall back to was the v0.9.6 pain point — every
 * airbase landed on the same channel and pilots had to manually
 * re-pick.
 */
export function suggestAtisFreq(airbaseName: string): number {
  // Simple FNV-1a-style hash. Doesn't need to be cryptographically
  // strong — just stable and well-distributed across the name space.
  let h = 2166136261;
  const key = airbaseName.toLowerCase();
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  // Map hash → 0..799 → 250.000–269.975 in 25 kHz steps.
  // 800 = (270 - 250) MHz / 0.025 MHz step.
  const step = h % 800;
  return Math.round((250 + step * 0.025) * 1000) / 1000;
}

/**
 * Best-effort ATIS frequency for an airbase. Returns the DB-known
 * value when present, the deterministic suggestion otherwise.
 *
 * Callers can branch on the discriminator:
 *   const { freq, source } = atisForAirbase(name);
 *   if (source === 'db') ...   // freq came from the static DB
 *   if (source === 'suggested') // freq came from suggestAtisFreq()
 */
export function atisForAirbase(name: string): {
  freq: number;
  source: 'db' | 'suggested';
} {
  const comms = getAirbaseComms(name);
  if (comms?.atis && comms.atis > 0) {
    return { freq: comms.atis, source: 'db' };
  }
  return { freq: suggestAtisFreq(name), source: 'suggested' };
}
