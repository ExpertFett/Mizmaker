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
    matches: ['GBU-12', 'GBU_12', 'Paveway'],
  },
  {
    id: 'gbu38', name: 'GBU-38 JDAM (500 lb)', category: 'Bomb', guidance: 'GPS/INS',
    range: 'Toss to ~15 NM (alt-dependent)', envelope: 'Fire-and-forget to coords. Target = mission/TGP/markpoint coords.',
    profile: ['Build/confirm target coords', 'In LAR (launch acceptable region)', 'Pickle; maneuver freely after release'],
    switchology: ['Select JDAM, verify TGT coords (PP/markpoint)', 'CCRP/AUTO to LAR cue', 'Pickle inside LAR'],
    mistakes: ['Bad coords/elevation = miss', 'Releasing outside LAR', 'Wrong target/PP selected'],
    matches: ['GBU-38', 'GBU_38', 'GBU-31', 'GBU_31', 'JDAM'],
  },
];
