/**
 * Weapon-employment reference data for the F/A-18C-centric Hornet School.
 *
 * Reference-level content for kneeboard cards: envelope/range, employment
 * profile, key switchology, and common mistakes per store. Values are the
 * commonly-cited/training figures — NOT a substitute for current NATOPS or
 * the live DCS module. The card carries a "verify" disclaimer. Add stores by
 * appending to WEAPONS; the card + picker pick them up automatically.
 */

export type WeaponCategory = 'A/A' | 'A/G' | 'Anti-ship' | 'Bomb' | 'Gun';

export interface WeaponSpec {
  id: string;
  name: string;
  category: WeaponCategory;
  guidance: string;        // IR, SARH, ARH, PB/Laser, GPS/INS, etc.
  range: string;           // employment range (training figure)
  envelope: string;        // launch/WEZ notes
  profile: string[];       // employment profile (alt / airspeed / dive / mode)
  switchology: string[];   // HOTAS/MFD steps
  mistakes: string[];      // common errors
  /** Case-insensitive substrings matched against a flight's pylon item names
   *  (PylonInfo.name) to auto-inject this card. Pylon names vary by DCS build
   *  ("AIM-9X" vs "AIM_9X" vs "CATM-9X-LAU"), so list every variant you've
   *  seen. Empty / undefined = never auto-included (manual-pick only). */
  matches?: string[];
}

/** Auto-detect which weapon cards belong on a flight by scanning its pylon
 *  item names. Returns the unique WeaponSpec ids whose `matches` patterns
 *  appear in any of the supplied names. Order follows WEAPONS declaration. */
export function matchWeaponsToLoadout(pylonItemNames: string[]): string[] {
  const lowered = pylonItemNames.map((n) => (n || '').toLowerCase()).filter(Boolean);
  if (lowered.length === 0) return [];
  const out: string[] = [];
  for (const w of WEAPONS) {
    const pats = w.matches || [];
    if (pats.length === 0) continue;
    const hit = pats.some((p) => {
      const ps = p.toLowerCase();
      return lowered.some((n) => n.includes(ps));
    });
    if (hit) out.push(w.id);
  }
  return out;
}

export const WEAPONS: WeaponSpec[] = [
  {
    id: 'aim9x', name: 'AIM-9X Sidewinder', category: 'A/A', guidance: 'IR (HOBS)',
    range: '~0.5–10 NM', envelope: 'High off-boresight, all-aspect IR. Best inside 5 NM; uncage with tone.',
    profile: ['WPN page → select AIM-9X', 'SLAVE to radar/HMD or BORE', 'Uncage (sensor on target), shoot in tone'],
    switchology: ['Weapon select: cycle to 9X (HOTAS or MFD)', 'TDC/HMD cue → growl', 'Uncage = N/G uncage; pickle to fire'],
    mistakes: ['Firing out of NEZ at long range', 'Forgetting to uncage before launch', 'No flare discipline = own jet decoyed'],
    matches: ['AIM-9X', 'AIM_9X', 'CATM-9X', '9X-LAU'],
  },
  {
    id: 'aim7', name: 'AIM-7M Sparrow', category: 'A/A', guidance: 'SARH',
    range: '~10–25 NM', envelope: 'Semi-active — you must keep STT lock through impact. No support after launch.',
    profile: ['Radar STT lock', 'In-range cue (Rmax/Raero/Rne)', 'Shoot, SUPPORT to active... no — support to impact'],
    switchology: ['Cycle weapon to 7', 'Lock target STT', 'Pickle inside Rmax; hold lock until splash'],
    mistakes: ['Breaking lock before impact (missile goes dumb)', 'Launching beyond Rmax', 'Notching target lost = missile defeated'],
    matches: ['AIM-7', 'AIM_7', 'Sparrow'],
  },
  {
    id: 'aim120', name: 'AIM-120C AMRAAM', category: 'A/A', guidance: 'ARH (active)',
    range: '~10–35 NM', envelope: 'Loft + active terminal. Support to MAR (pitbull), then crank/notch.',
    profile: ['STT or TWS launch', 'Shoot at/inside Rtr for Pk', 'Crank ~30° after launch; support to A-pole'],
    switchology: ['Cycle weapon to 120', 'TWS: bug target / STT lock', 'Pickle; monitor time-to-active (M) then maneuver'],
    mistakes: ['Maddog spam', 'Going cold before pitbull (missile loses track)', 'Ignoring Rtr/Rpi cues'],
    matches: ['AIM-120', 'AIM_120', 'AMRAAM'],
  },
  {
    id: 'gun', name: 'M61A2 20mm Gun', category: 'Gun', guidance: 'Funnel / LCOS / EEGS',
    range: 'A/A <0.5 NM · A/G strafe ~0.8–1.2 NM', envelope: '578 rds. A/A use funnel/snapshoot; A/G strafe 10–15° dive.',
    profile: ['A/A: pipper on target, in-range, trigger', 'A/G strafe: track final ~10–15° dive, fire 0.8–1.2 NM'],
    switchology: ['GUN select (HOTAS)', 'A/G: GUN on STORES, set rounds', 'Trigger to fire'],
    mistakes: ['Strafing too low/too steep (frag/ground)', 'Long bursts overheat', 'Closure too high = no rounds on target'],
    // Gun is the internal M61; not on a pylon. Auto-inject doesn't include it
    // (no matches) — pilots can manually pick the card from the Kneeboard tab.
  },
  {
    id: 'agm65', name: 'AGM-65E/F Maverick', category: 'A/G', guidance: 'Laser (E) / IR (F)',
    range: '~3–12 NM', envelope: 'Lock seeker before launch (LOAL/LOBL). F = IIR, E = laser-guided.',
    profile: ['MAV page → uncage seeker', 'Slew/auto-track target, get LOCK', 'In-range, pickle (fire-and-forget)'],
    switchology: ['Select MAV on STORES', 'TDC slew to target; ground-stabilize/track', 'Confirm lock cross; pickle'],
    mistakes: ['Launching without seeker lock', 'Wrong polarity/contrast (IR)', 'Masking the seeker in the dive'],
    matches: ['AGM-65', 'AGM_65', 'Maverick'],
  },
  {
    id: 'agm88', name: 'AGM-88C HARM', category: 'A/G', guidance: 'Anti-radiation',
    range: '~10–40+ NM', envelope: 'SP/TOO/PB modes. Needs an emitting radar; HAS page for handoff.',
    profile: ['HARM page → select mode (TOO/SP/PB)', 'Handoff/select emitter', 'In-range, shoot'],
    switchology: ['Select HARM on STORES', 'HAS/HARM page → emitter list', 'TOO: designate emitter; pickle'],
    mistakes: ['PB at wrong range (no target)', 'Firing at a SAM that just went dark', 'Mode confusion (SP vs TOO)'],
    matches: ['AGM-88', 'AGM_88', 'HARM'],
  },
  {
    id: 'gbu12', name: 'GBU-12 Paveway II', category: 'Bomb', guidance: 'Laser (PB)',
    range: 'Toss/level/dive — needs laser to impact', envelope: '500 lb LGB. Self- or buddy-lase; code must match.',
    profile: ['AUTO/CCRP delivery to target', 'Laser ON ~8–10 s to impact', 'Keep target lased until splash'],
    switchology: ['Select GBU-12, set laser code', 'Designate target (TGP/TDC)', 'Pickle in AUTO; lase to impact'],
    mistakes: ['Laser code mismatch', 'Lasing too early (long bomb) or too late', 'Masking TGP / losing the spot'],
    matches: ['GBU-12', 'GBU_12'],
  },
  {
    id: 'gbu38', name: 'GBU-38 JDAM (500 lb)', category: 'Bomb', guidance: 'GPS/INS',
    range: 'Toss to ~15 NM (alt-dependent)', envelope: 'Fire-and-forget to coords. Target = mission/TGP/markpoint coords.',
    profile: ['Build/confirm target coords', 'In LAR (launch acceptable region)', 'Pickle; maneuver freely after release'],
    switchology: ['Select JDAM, verify TGT coords (PP/markpoint)', 'CCRP/AUTO to LAR cue', 'Pickle inside LAR'],
    mistakes: ['Bad coords/elevation = miss', 'Releasing outside LAR', 'Wrong target/PP selected'],
    matches: ['GBU-38', 'GBU_38'],
  },
  {
    id: 'aim9m', name: 'AIM-9M Sidewinder', category: 'A/A', guidance: 'IR (all-aspect)',
    range: '~0.5–10 NM', envelope: 'All-aspect legacy IR — NO high-off-boresight. Slave to radar/SEAM; best rear-quarter, kill inside the NEZ (~5 NM).',
    profile: ['SLAVE to radar lock or SEAM/BORE scan', 'Uncage seeker, get a hard tone', 'Shoot in tone inside the NEZ (~5 NM)'],
    switchology: ['Cycle weapon to 9 (AIM-9M/L)', 'SEAM/uncage to lock the seeker', 'Pickle in a strong growl'],
    mistakes: ['Expecting a 9X off-boresight shot — it cannot', 'Head-on at long range (out of NEZ)', 'Firing without uncaging = no track', 'Sun / flares defeat it easily'],
    matches: ['AIM-9M', 'AIM_9M', 'AIM-9L', 'AIM-9P', 'AIM-9J'],
  },
  {
    id: 'harpoon', name: 'AGM-84D Harpoon', category: 'Anti-ship', guidance: 'Active radar (sea-skim)',
    range: '~60+ NM', envelope: 'Fire-and-forget anti-ship. RBL/BOL search modes; sea-skimming active terminal. You set a SEARCH AREA, not a lock.',
    profile: ['HARPOON page → pick RBL (range/bearing) or BOL', 'Point the search box over the target ship', 'Pickle; missile flies out, searches, and skims in autonomously'],
    switchology: ['Select AGM-84 on STORES', 'HARPOON page → mode RBL/BOL; set bearing/range or waypoint', 'Confirm the search area covers the ship; pickle'],
    mistakes: ['Search area off the target = missile finds nothing', 'Neutrals/friendlies inside the seeker box (it hits the first hull)', 'Firing beyond the search-pattern range setting'],
    matches: ['AGM-84D', 'AGM-84A', 'AGM_84D', 'AGM_84A'],
  },
  {
    id: 'slamer', name: 'AGM-84H SLAM-ER', category: 'A/G', guidance: 'GPS/INS + IIR datalink',
    range: '~60+ NM', envelope: 'Standoff precision land-attack. GPS midcourse, man-in-the-loop IIR terminal via datalink — needs the DL relay to steer the aimpoint.',
    profile: ['Preplanned waypoints/route to the target', 'Release from altitude for range', 'At terminal: take datalink control, refine the aimpoint, guide to impact'],
    switchology: ['Select SLAM-ER; load mission/waypoints', 'Pickle inside LAR', 'Terminal: DL page → lock aimpoint, steer to impact'],
    mistakes: ['Losing the datalink (no terminal control = miss)', 'Bad terminal aimpoint slew', 'Releasing outside LAR / too low for range'],
    matches: ['AGM-84E', 'AGM-84H', 'SLAM', 'AGM_84E', 'AGM_84H'],
  },
  {
    id: 'jsow', name: 'AGM-154 JSOW', category: 'A/G', guidance: 'GPS/INS (glide)',
    range: '~15 NM low · 40+ NM high', envelope: 'Unpowered glide — range scales hugely with launch altitude & speed. JSOW-A = submunitions (area); JSOW-C = unitary BROACH (point/penetrate).',
    profile: ['High & fast for max standoff', 'Confirm target coords + elevation', 'Release inside LAR; it glides autonomously to coords'],
    switchology: ['Select AGM-154; verify TGT coords (PP/markpoint)', 'CCRP/AUTO to LAR cue', 'Pickle inside LAR'],
    mistakes: ['Low/slow launch = falls short', 'Bad coords or elevation = miss', 'Wrong variant (A soft/area vs C hard/point)'],
    matches: ['AGM-154', 'JSOW', 'AGM_154'],
  },
  {
    id: 'gbu16', name: 'GBU-16 Paveway II', category: 'Bomb', guidance: 'Laser (PB)',
    range: 'Toss/level/dive — needs laser to impact', envelope: '1000 lb LGB. Same technique as GBU-12, heavier warhead / longer time-of-fall. Self- or buddy-lase; codes must match.',
    profile: ['AUTO/CCRP delivery to target', 'Laser ON ~8–10 s to impact', 'Keep the spot on target until splash'],
    switchology: ['Select GBU-16, set laser code', 'Designate target (TGP/TDC)', 'Pickle in AUTO; lase to impact'],
    mistakes: ['Laser code mismatch', 'Lasing too early (long) or too late (short)', 'Masking the TGP / losing the spot in the dive'],
    matches: ['GBU-16', 'GBU_16'],
  },
  {
    id: 'gbu10', name: 'GBU-10 Paveway II', category: 'Bomb', guidance: 'Laser (PB)',
    range: 'Toss/level/dive — needs laser to impact', envelope: '2000 lb LGB — big warhead for hardened/large targets. Long time-of-fall; lead the lase accordingly.',
    profile: ['AUTO/CCRP or loft to target', 'Laser ON in the terminal ~10 s to impact', 'Hold the spot until splash'],
    switchology: ['Select GBU-10, set laser code', 'Designate target (TGP/TDC)', 'Pickle in AUTO; lase to impact'],
    mistakes: ['Laser code mismatch', 'Lase timing (heavy bomb = long fall)', 'Losing the spot / TGP mask'],
    matches: ['GBU-10', 'GBU_10'],
  },
  {
    id: 'gbu24', name: 'GBU-24 Paveway III', category: 'Bomb', guidance: 'Laser (LLLGB)',
    range: 'Low- or high-alt LOAL — flexible trajectory', envelope: '2000 lb Paveway III. Low-level, low-drag; flies a smarter trajectory than PW-II. Good stand-off and steep terminal on hardened targets.',
    profile: ['LOAL release (level/loft) — bomb flies out then acquires', 'Begin lasing in the terminal per the profile', 'Steep terminal — keep the spot on the aimpoint'],
    switchology: ['Select GBU-24, set laser code + profile', 'Designate target (TGP)', 'Pickle; lase in the terminal window'],
    mistakes: ['Lasing too early on a LOAL profile (bomb dives short)', 'Code mismatch', 'Wrong loft/level profile for the range'],
    matches: ['GBU-24', 'GBU_24'],
  },
  {
    id: 'gbu31', name: 'GBU-31 JDAM (2000 lb)', category: 'Bomb', guidance: 'GPS/INS',
    range: 'Toss to ~15 NM (alt-dependent)', envelope: '2000 lb JDAM, fire-and-forget to coords. (V)1 = Mk-84 blast/frag; (V)3 = BLU-109 penetrator for hardened targets.',
    profile: ['Build/confirm target coords + elevation', 'In LAR, pickle', 'Maneuver freely after release'],
    switchology: ['Select GBU-31, verify TGT coords (PP/markpoint)', 'CCRP/AUTO to LAR cue', 'Pickle inside LAR'],
    mistakes: ['Bad coords/elevation = miss', 'Releasing outside LAR', 'Penetrator vs blast variant mismatched to target'],
    matches: ['GBU-31', 'GBU_31'],
  },
  {
    id: 'gbu32', name: 'GBU-32 JDAM (1000 lb)', category: 'Bomb', guidance: 'GPS/INS',
    range: 'Toss to ~15 NM (alt-dependent)', envelope: '1000 lb JDAM — mid-weight between GBU-38 (500) and GBU-31 (2000). Fire-and-forget to coords.',
    profile: ['Build/confirm target coords + elevation', 'In LAR, pickle', 'Free to maneuver after release'],
    switchology: ['Select GBU-32, verify TGT coords', 'CCRP/AUTO to LAR cue', 'Pickle inside LAR'],
    mistakes: ['Bad coords/elevation', 'Outside LAR at release', 'Wrong PP/target selected'],
    matches: ['GBU-32', 'GBU_32'],
  },
  {
    id: 'mk80', name: 'Mk-80 GP Bombs (Mk-82/83/84)', category: 'Bomb', guidance: 'Unguided (CCIP/CCRP)',
    range: 'Visual — dive or level; drag setting sets the floor', envelope: 'Low-drag (LDGP) or high-drag (Snakeye/BSU/AIR) for low-level. Mk-82 500 lb · Mk-83 1000 lb · Mk-84 2000 lb.',
    profile: ['CCIP: roll in, track pipper onto target, pickle in the dive', 'CCRP: designate, fly steering, pickle at the cue', 'Low-level = high-drag (Snakeye) to clear own frag'],
    switchology: ['Select the Mk-8x on STORES; set qty/interval (ripple)', 'A/G master mode → CCIP or CCRP', 'Pipper/steering on target; pickle'],
    mistakes: ['Low-drag pull-off too low = own frag', 'CCIP too shallow / too fast = pipper off', 'Wrong pickle altitude / no wind correction'],
    matches: ['Mk-82', 'Mk_82', 'Mk 82', 'Mk-83', 'Mk_83', 'Mk 83', 'Mk-84', 'Mk_84', 'Mk 84', 'Snakeye'],
  },
  {
    id: 'cbu99', name: 'CBU-99 Rockeye', category: 'Bomb', guidance: 'Unguided cluster',
    range: 'Visual dive — set burst altitude (HOF)', envelope: 'Mk-20/CBU-99 anti-armour cluster. Height-of-function sets the pattern — higher HOF = wider/thinner, lower = tighter/denser.',
    profile: ['Dive delivery (CCIP), roll in on the target array', 'Release at the planned altitude for your HOF', 'Pattern walks along the run-in axis — line up the column'],
    switchology: ['Select CBU-99; set fuze / HOF (burst altitude)', 'A/G CCIP', 'Pipper on the array; pickle'],
    mistakes: ['HOF too high = pattern too thin to kill', 'Too low = pattern too small / self-frag', 'Bad run-in axis misses the column'],
    matches: ['CBU-99', 'CBU_99', 'Mk-20', 'Rockeye', 'CBU-87', 'CBU-97'],
  },
  {
    id: 'walleye', name: 'AGM-62 Walleye II', category: 'A/G', guidance: 'TV (electro-optical)',
    range: 'Standoff glide — LOS to a high-contrast aimpoint', envelope: 'Unpowered TV-guided glide bomb. Lock a high-contrast aimpoint before release, then fire-and-forget (or man-in-the-loop via the AWW-13 datalink pod). Needs altitude/speed for standoff.',
    profile: ['Point the TV at the target, get a crisp contrast lock', 'Release in-range from altitude', 'It glides autonomously to the locked point (or steer via datalink)'],
    switchology: ['Select AGM-62; slew TV seeker to the aimpoint', 'Confirm a stable contrast lock (track box)', 'Pickle in-range'],
    mistakes: ['Low-contrast scene (haze/uniform terrain) = no track', 'Low/slow release = falls short', 'Locking the wrong high-contrast edge, not the target'],
    matches: ['AGM-62', 'Walleye'],
  },
  {
    id: 'hydra', name: 'Rockets (Hydra-70 / Zuni)', category: 'A/G', guidance: 'Unguided',
    range: '~1–2 NM effective', envelope: 'LAU-61/68 pods of 70 mm Hydra-70, or LAU-10 127 mm Zuni (heavier, longer standoff, better vs light armour/structures). Area/soft targets — CCIP pipper, allow for dispersion.',
    profile: ['Shallow dive (~10–20°), wings level, stable', 'CCIP pipper on target ~1–1.5 NM', 'Fire a pair/salvo; do not press too close (frag)'],
    switchology: ['Select rockets on STORES; set salvo qty', 'A/G CCIP', 'Pipper on target; trigger/pickle'],
    mistakes: ['Firing too far = huge dispersion', 'Too close / too steep = own frag', 'Skidding the jet = rockets scatter'],
    matches: ['LAU-61', 'LAU-68', 'LAU-131', 'Hydra', 'Zuni', 'HYDRA-70', 'FFAR'],
  },
];
