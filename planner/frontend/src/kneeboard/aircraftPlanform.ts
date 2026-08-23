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
 * are recognisable planforms, not scale drawings: enough to tell a Hornet
 * from a Warthog at kneeboard size and to put each station in the right
 * place along the span.
 *
 * All coordinates are in a 100 x 100 box, nose up.
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
  /** Vertical tail fins drawn as separate strokes, left half only. */
  fins?: [number, number][][];
  stations: StationPos[];
  label: string;
}

/** Build the closed outline path from a left half. */
export function planformPath(p: Planform): string {
  const left = p.half.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const right = [...p.half].reverse().map(([x, y]) => `L${100 - x},${y}`).join(' ');
  return `${left} ${right} Z`;
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

const HORNET: Planform = {
  label: 'F/A-18C',
  half: [
    [50, 2], [47, 10], [45, 19],          // radome
    [43, 26], [40, 33],                    // LERX
    [37, 40], [10, 51], [8, 55],           // wing leading edge to tip
    [36, 59],                              // trailing edge inboard
    [33, 62], [26, 68], [30, 72],          // horizontal stab
    [38, 74], [41, 84], [46, 88], [50, 88],
  ],
  fins: [[[42, 62], [38, 78]]],
  stations: [
    { number: 1, x: 9, y: 53 },   // left wingtip
    { number: 2, x: 19, y: 54 },  // left outboard
    { number: 3, x: 29, y: 55 },  // left inboard
    { number: 4, x: 43, y: 58 },  // left cheek
    { number: 5, x: 50, y: 66 },  // centerline
    { number: 6, x: 57, y: 58 },  // right cheek
    { number: 7, x: 71, y: 55 },
    { number: 8, x: 81, y: 54 },
    { number: 9, x: 91, y: 53 },
  ],
};

const TOMCAT: Planform = {
  label: 'F-14',
  half: [
    [50, 2], [46, 11], [44, 20],
    [41, 27], [38, 34],                    // glove
    [34, 38], [12, 50], [11, 55],          // swept wing
    [34, 58],
    [30, 64], [22, 70], [27, 74],          // stab
    [36, 76], [40, 86], [46, 90], [50, 90],
  ],
  fins: [[[40, 60], [37, 76]]],
  stations: [
    { number: 1, x: 22, y: 50 },
    { number: 2, x: 34, y: 52 },
    { number: 3, x: 43, y: 62 },
    { number: 4, x: 47, y: 68 },
    { number: 5, x: 53, y: 68 },
    { number: 6, x: 57, y: 62 },
    { number: 7, x: 66, y: 52 },
    { number: 8, x: 78, y: 50 },
  ],
};

const VIPER: Planform = {
  label: 'F-16C',
  half: [
    [50, 3], [46, 12], [44, 22],
    [42, 30], [40, 38],                    // blended body
    [38, 44], [13, 58], [12, 62],          // delta wing
    [38, 64],
    [34, 68], [26, 73], [31, 77],          // stab
    [39, 79], [42, 87], [46, 90], [50, 90],
  ],
  fins: [[[46, 62], [46, 80]]],
  stations: [
    { number: 1, x: 12, y: 60 },
    { number: 2, x: 21, y: 60 },
    { number: 3, x: 30, y: 60 },
    { number: 4, x: 40, y: 62 },
    { number: 5, x: 50, y: 70 },
    { number: 6, x: 60, y: 62 },
    { number: 7, x: 70, y: 60 },
    { number: 8, x: 79, y: 60 },
    { number: 9, x: 88, y: 60 },
  ],
};

const WARTHOG: Planform = {
  label: 'A-10C',
  half: [
    [50, 6], [45, 12], [43, 22],
    [42, 34], [6, 40], [5, 46],            // straight wing
    [42, 50],
    [40, 58], [36, 62],                    // nacelle
    [34, 70], [20, 74], [22, 80],          // stab
    [40, 82], [44, 88], [50, 88],
  ],
  fins: [[[22, 74], [22, 88]]],
  stations: [
    { number: 1, x: 7, y: 44 },
    { number: 2, x: 14, y: 44 },
    { number: 3, x: 21, y: 44 },
    { number: 4, x: 28, y: 45 },
    { number: 5, x: 35, y: 46 },
    { number: 6, x: 43, y: 50 },
    { number: 7, x: 50, y: 54 },
    { number: 8, x: 57, y: 50 },
    { number: 9, x: 65, y: 46 },
    { number: 10, x: 72, y: 45 },
    { number: 11, x: 79, y: 44 },
  ],
};

/** Fallback: a plain swept-wing jet. Used when we do not carry an outline
 *  for the airframe, so the picture is generic on purpose. */
const GENERIC: Planform = {
  label: '',
  half: [
    [50, 3], [46, 13], [44, 24],
    [40, 34], [12, 52], [11, 57],
    [38, 60],
    [32, 66], [24, 71], [29, 75],
    [38, 78], [43, 86], [47, 89], [50, 89],
  ],
  fins: [[[44, 62], [41, 78]]],
  stations: [],
};

const BY_PATTERN: [RegExp, Planform][] = [
  [/^FA-18|^F\/A-18|hornet/i, HORNET],
  [/^F-14|tomcat/i, TOMCAT],
  [/^F-16|viper|falcon/i, VIPER],
  [/^A-10|warthog|thunderbolt/i, WARTHOG],
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
