/**
 * Top-down aircraft outlines and station positions for the station-loadout
 * diagram.
 *
 * A numbered table tells you station 3 has a GBU-12. It does not tell you
 * that station 3 is the left inboard wing — which is what you need when you
 * are checking asymmetry, or telling someone which side the pod is on. So
 * the loadout gets drawn on a picture of the jet.
 *
 * Outlines are authored as a LEFT HALF and mirrored, which keeps them
 * symmetrical by construction and halves the coordinates to get wrong. They
 * trace the real planform features that make an airframe recognisable —
 * the Hornet's LERX and canted twin tails, the Tomcat's glove and wide
 * tunnel, the Viper's blended body and single fin, the Warthog's straight
 * wing and podded nacelles — at proportions taken from each aircraft's
 * span-to-length ratio.
 *
 * All coordinates are in a 100 x 100 box, nose up. Left half runs nose to
 * tail down the aircraft's left side (viewer's left, looking down from above).
 */

/** One station's position on the outline, in the same 100x100 space. */
export interface StationPos {
  /** DCS station number. */
  number: number;
  x: number;
  y: number;
}

export interface Planform {
  /** Left-half outline points, nose first, running down the left side to
   *  the tail. Mirrored across x=50 to close the shape. */
  half: [number, number][];
  /** Vertical tails, drawn as filled shapes. Left half only; mirrored. */
  fins?: [number, number][][];
  /** Extra outlines drawn on top — nacelles, intakes. Left half, mirrored. */
  details?: [number, number][][];
  stations: StationPos[];
  label: string;
}

/** Closed outline path from a left half. */
export function planformPath(p: Planform): string {
  const left = p.half.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const right = [...p.half].reverse().map(([x, y]) => `L${100 - x},${y}`).join(' ');
  return `${left} ${right} Z`;
}

/** Closed path for one mirrored sub-shape (fin, nacelle). */
export function subShapePath(pts: [number, number][], mirror = false): string {
  const p = mirror ? pts.map(([x, y]) => [100 - x, y] as [number, number]) : pts;
  return p.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + ' Z';
}

/** Evenly spaced stations for an airframe we have no outline for. Keeps the
 *  diagram honest: the shape is generic, so the positions only claim an
 *  ordering, not a real location on that jet. */
function evenStations(count: number): StationPos[] {
  if (count <= 0) return [];
  if (count === 1) return [{ number: 1, x: 50, y: 58 }];
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    x: 12 + (i * 76) / (count - 1),
    y: 56,
  }));
}

/**
 * F/A-18C Hornet. Span 37.5ft, length 56ft — noticeably longer than wide,
 * with the LERX carrying the wing root well forward and the tails canted
 * outboard ahead of the stabilators.
 */
const HORNET: Planform = {
  label: 'F/A-18C',
  half: [
    [50, 1], [48.2, 6], [46.6, 12],           // radome
    [45.4, 18], [44.8, 23],                    // forward fuselage / cockpit
    [43.6, 27], [41, 31],                      // LERX begins
    [38.5, 36], [37.2, 41],                    // LERX sweeping out to the root
    [34, 44],                                  // wing leading edge root
    [12, 55], [9.5, 56.5],                     // leading edge to tip
    [10.5, 60], [13, 60.5],                    // wingtip (rail)
    [33, 63],                                  // trailing edge back to root
    [36.5, 64],
    [34, 68], [25, 74], [24, 76.5],            // stabilator
    [30, 78], [36, 76],                        // stabilator root
    [38.5, 82], [40, 88],                      // engine nacelle
    [43.5, 92], [46, 93], [50, 93],
  ],
  fins: [
    // Canted outboard, leading edge swept, sitting ahead of the stabilators.
    [[40, 60], [36.5, 70], [34.5, 78], [37, 78], [40.5, 70], [42.5, 61]],
  ],
  details: [
    // Intake, the feature that reads as "Hornet" from above.
    [[42.5, 33], [38.5, 38], [38, 52], [41.5, 52], [43.5, 38]],
  ],
  stations: [
    { number: 1, x: 11, y: 58 },   // left wingtip — AIM-9 rail
    { number: 2, x: 20, y: 57 },   // left outboard
    { number: 3, x: 29, y: 55 },   // left inboard
    { number: 4, x: 41, y: 50 },   // left cheek — AIM-7 / pod
    { number: 5, x: 50, y: 62 },   // centreline
    { number: 6, x: 59, y: 50 },   // right cheek
    { number: 7, x: 71, y: 55 },
    { number: 8, x: 80, y: 57 },
    { number: 9, x: 89, y: 58 },
  ],
};

/**
 * F-14 Tomcat. Very wide flat tunnel between widely spaced nacelles, big
 * gloves, twin fins set well apart. Drawn wings-forward.
 */
const TOMCAT: Planform = {
  label: 'F-14',
  half: [
    [50, 1], [47.5, 6], [45.5, 12],            // long radome
    [44, 18], [43, 24],                        // cockpit
    [41.5, 28],
    [39, 31], [36, 34],                        // glove leading edge
    [30, 37],
    [11, 47], [9, 49],                         // swept wing to tip
    [10.5, 52], [13, 53],
    [31, 56],                                  // trailing edge to the tunnel
    [30, 60],                                  // tunnel — the wide flat body
    [28, 66], [21, 71], [20, 74],              // stabilator
    [26, 76], [30, 74],
    [30, 80], [33, 86],                        // nacelle
    [37, 90], [43, 92], [50, 92],
  ],
  fins: [
    [[34, 58], [31, 68], [30, 76], [33, 76], [36, 67], [37.5, 59]],
  ],
  details: [
    // Rectangular intake, set out from the tunnel.
    [[38, 34], [32.5, 40], [32, 62], [37, 62], [39.5, 40]],
  ],
  stations: [
    { number: 1, x: 27, y: 45 },   // left glove
    { number: 2, x: 35, y: 52 },
    { number: 3, x: 44, y: 64 },   // left tunnel
    { number: 4, x: 47.5, y: 70 },
    { number: 5, x: 52.5, y: 70 },
    { number: 6, x: 56, y: 64 },   // right tunnel
    { number: 7, x: 65, y: 52 },
    { number: 8, x: 73, y: 45 },   // right glove
  ],
};

/**
 * F-16C. Blended body, cropped delta, single fin, wing much further aft
 * than the Hornet's.
 */
const VIPER: Planform = {
  label: 'F-16C',
  half: [
    [50, 1], [47.8, 7], [46.2, 14],            // radome
    [45.2, 21], [44.6, 28],                    // cockpit
    [44, 34],
    [43, 40], [41.5, 46],                      // blended body widening
    [40, 50],
    [14, 63], [12.5, 64.5],                    // delta leading edge to tip
    [13.5, 68], [16, 68.5],
    [39, 70],                                  // trailing edge
    [40.5, 72],
    [37, 75], [28, 79], [27, 82],              // stabilator
    [33, 83.5], [39, 81],
    [41, 86], [44, 91], [47, 93], [50, 93],
  ],
  fins: [
    // Single centreline fin — authored on the centre so mirroring is a no-op.
    [[50, 62], [47.5, 74], [46.5, 84], [50, 84]],
  ],
  details: [
    // Chin intake.
    [[46.5, 36], [43.5, 42], [43.5, 56], [50, 56], [50, 36]],
  ],
  stations: [
    { number: 1, x: 13, y: 66 },   // left wingtip
    { number: 2, x: 21, y: 65 },
    { number: 3, x: 29, y: 64 },
    { number: 4, x: 38, y: 62 },
    { number: 5, x: 50, y: 70 },   // centreline
    { number: 6, x: 62, y: 62 },
    { number: 7, x: 71, y: 64 },
    { number: 8, x: 79, y: 65 },
    { number: 9, x: 87, y: 66 },
  ],
};

/**
 * A-10C. Straight untapered wing, engines podded high on the rear fuselage,
 * twin fins on a straight tailplane. Span exceeds length, unlike the fighters.
 */
const WARTHOG: Planform = {
  label: 'A-10C',
  half: [
    [50, 4], [47, 8], [45, 14],                // blunt nose
    [43.5, 20], [43, 26],                      // cockpit / gun bay
    [42.5, 32],
    [42, 36],
    [6, 40], [4.5, 42],                        // straight leading edge to tip
    [5, 46], [7, 47],
    [42, 50],                                  // straight trailing edge
    [41, 56],
    [39, 62],
    [37, 68],
    [36, 72],
    [17, 74], [16, 78],                        // straight tailplane
    [36, 80],
    [40, 84], [45, 88], [50, 88],
  ],
  fins: [
    // Endplate fins at the tailplane tips — the Warthog's signature.
    [[17, 72], [15.5, 80], [15.5, 88], [19, 88], [20, 80], [20.5, 73]],
  ],
  details: [
    // Podded nacelle.
    [[38, 52], [31, 55], [30.5, 68], [37, 68], [39.5, 55]],
  ],
  stations: [
    { number: 1, x: 7, y: 45 },
    { number: 2, x: 13, y: 45 },
    { number: 3, x: 19, y: 45 },
    { number: 4, x: 26, y: 45 },
    { number: 5, x: 33, y: 46 },
    { number: 6, x: 41, y: 48 },
    { number: 7, x: 50, y: 52 },   // centreline
    { number: 8, x: 59, y: 48 },
    { number: 9, x: 67, y: 46 },
    { number: 10, x: 74, y: 45 },
    { number: 11, x: 81, y: 45 },
  ],
};

/**
 * AH-64 and helicopters generally: fuselage with stub wings. Rotor is not
 * drawn — it would swamp the stations, which is what the diagram is for.
 */
const APACHE: Planform = {
  label: 'AH-64',
  half: [
    [50, 2], [46, 6], [44, 12],                // nose / sensor turret
    [43, 20], [42.5, 30],                      // cockpit tandem
    [41, 38],
    [24, 42], [23, 45],                        // stub wing
    [24, 50], [41, 52],
    [42, 60], [43.5, 70],                      // tailboom
    [45, 78],
    [38, 82], [37, 86],                        // stabilator
    [46, 88], [48, 94], [50, 94],
  ],
  stations: [
    { number: 1, x: 26, y: 46 },
    { number: 2, x: 34, y: 46 },
    { number: 3, x: 66, y: 46 },
    { number: 4, x: 74, y: 46 },
    { number: 5, x: 50, y: 30 },   // nose / FCR mast
    { number: 6, x: 50, y: 16 },
  ],
};

/** Fallback: a plain swept-wing jet. Used when we do not carry an outline
 *  for the airframe, so the picture is generic on purpose. */
const GENERIC: Planform = {
  label: '',
  half: [
    [50, 2], [47.5, 8], [46, 16],
    [45, 24], [44, 32],
    [41, 38],
    [13, 54], [11.5, 56],
    [12.5, 60], [15, 60.5],
    [39, 63],
    [36, 68], [27, 74], [26, 77],
    [32, 79], [38, 77],
    [41, 84], [45, 90], [48, 92], [50, 92],
  ],
  fins: [[[44, 62], [40.5, 72], [39, 82], [42.5, 82], [45.5, 72], [47, 63]]],
  stations: [],
};

const BY_PATTERN: [RegExp, Planform][] = [
  [/^FA-18|^F\/A-18|hornet/i, HORNET],
  [/^F-14|tomcat/i, TOMCAT],
  [/^F-16|viper|falcon/i, VIPER],
  [/^A-10|warthog|thunderbolt/i, WARTHOG],
  [/^AH-64|apache/i, APACHE],
];

/**
 * Outline + station positions for an airframe.
 *
 * `stationCount` comes from the actual loadout, so an airframe we know still
 * gets sensible positions if a mission reports more or fewer pylons than the
 * table expects — the table is trimmed or the generic spread takes over,
 * rather than silently dropping stores off the diagram.
 */
export function planformFor(aircraftType: string, stationCount: number): Planform {
  const match = BY_PATTERN.find(([re]) => re.test(aircraftType || ''));
  if (match) {
    const p = match[1];
    if (stationCount <= p.stations.length) {
      return { ...p, stations: p.stations.filter((s) => s.number <= stationCount) };
    }
    // More stations than the outline knows — fall back to an even spread on
    // the right shape rather than pretending the extras do not exist.
    return { ...p, stations: evenStations(stationCount) };
  }
  return { ...GENERIC, label: aircraftType || '', stations: evenStations(stationCount) };
}
