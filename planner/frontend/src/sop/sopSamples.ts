import type { SOP } from './types';
import { makeId } from './types';

/** A fully-populated sample SOP that doubles as the download template. */
export function makeSampleSop(): SOP {
  return {
    id: makeId(),
    name: 'VMFA-224(AW) Bengals — Sample SOP',
    squadron: 'VMFA-224(AW)',
    notes: 'Sample SOP to edit. Add/remove entries as needed.',
    updatedAt: Date.now(),
    laserCodeBase: 1611,
    flights: [
      { callsign: 'Bengal', priority: 1, defaultFreq: 251.0, defaultMod: 'AM' },
      { callsign: 'Uzi', priority: 2, defaultFreq: 252.0, defaultMod: 'AM' },
      { callsign: 'Enfield', priority: 3, defaultFreq: 253.0, defaultMod: 'AM' },
      { callsign: 'Springfield', priority: 4, defaultFreq: 254.0, defaultMod: 'AM' },
      { callsign: 'Hornet', priority: 5, defaultFreq: 255.0, defaultMod: 'AM' },
    ],
    tankers: [
      { callsign: 'Texaco', frequency: 269.5, modulation: 'AM', tacanChannel: 51, tacanBand: 'Y', tacanCallsign: 'TX1' },
      { callsign: 'Arco',   frequency: 270.5, modulation: 'AM', tacanChannel: 52, tacanBand: 'Y', tacanCallsign: 'AR1' },
      { callsign: 'Shell',  frequency: 271.5, modulation: 'AM', tacanChannel: 53, tacanBand: 'Y', tacanCallsign: 'SH1' },
    ],
    supportAssets: [
      { callsign: 'Magic',   role: 'AWACS', frequency: 248.0, modulation: 'AM' },
      { callsign: 'Darkstar', role: 'AWACS', frequency: 249.0, modulation: 'AM' },
      { callsign: 'Axeman',  role: 'JTAC', frequency: 240.0, modulation: 'AM' },
    ],
    comms: [
      { role: 'Strike Primary',      frequency: 238.0, modulation: 'AM' },
      { role: 'Strike Common',       frequency: 239.0, modulation: 'AM' },
      { role: 'Combat Air Patrol',   frequency: 241.0, modulation: 'AM' },
      { role: 'Marshal',             frequency: 305.0, modulation: 'AM' },
      { role: 'Tower',               frequency: 300.0, modulation: 'AM' },
      { role: 'Approach / Departure', frequency: 302.5, modulation: 'AM' },
      { role: 'Guard',               frequency: 243.0, modulation: 'AM', notes: 'Emergency only' },
    ],
    tacans: [
      { role: 'Home Plate (CVN)', channel: 74, band: 'X', callsign: 'TR' },
      { role: 'Secondary Ship',   channel: 75, band: 'X', callsign: 'GW' },
    ],
  };
}


// ── Starter SOP variants ────────────────────────────────────────────────
//
// For users without their own SOP — pick a starter, tweak the squadron
// name / specific freqs, and you've got a working SOP in 30 seconds
// instead of typing 30+ rows of values from scratch.

export type StarterKind = 'modern-carrier' | 'modern-land' | 'cold-war' | 'empty';

const STARTER_NAMES: Record<StarterKind, string> = {
  'modern-carrier':  'Starter — Modern Carrier Ops',
  'modern-land':     'Starter — Modern Land-Based',
  'cold-war':        'Starter — Cold War (1985)',
  'empty':           'Starter — Blank Skeleton',
};

const STARTER_NOTES: Record<StarterKind, string> = {
  'modern-carrier':  'Modern carrier-based F/A-18 ops. Edit squadron, freqs, TACAN channels for your wing/scenario.',
  'modern-land':     'Modern land-based ops (NATO / coalition). Edit airfield TACAN, replace tanker callsigns with your AOR.',
  'cold-war':        'Cold War conventions: VHF FM ground, UHF AM air, simpler comms. Edit per scenario.',
  'empty':           'Blank skeleton — fill in everything from your squadron source documents.',
};

export function makeStarterSop(kind: StarterKind): SOP {
  if (kind === 'empty') {
    return {
      id: makeId(),
      name: STARTER_NAMES[kind],
      notes: STARTER_NOTES[kind],
      updatedAt: Date.now(),
      flights: [],
      tankers: [],
      supportAssets: [],
      comms: [],
      tacans: [],
    };
  }

  if (kind === 'modern-carrier') {
    return {
      id: makeId(),
      name: STARTER_NAMES[kind],
      notes: STARTER_NOTES[kind],
      updatedAt: Date.now(),
      laserCodeBase: 1511,
      flights: [
        { callsign: 'Enfield',     priority: 1, defaultFreq: 251.000, defaultMod: 'AM' },
        { callsign: 'Springfield', priority: 2, defaultFreq: 252.000, defaultMod: 'AM' },
        { callsign: 'Uzi',         priority: 3, defaultFreq: 253.000, defaultMod: 'AM' },
        { callsign: 'Colt',        priority: 4, defaultFreq: 254.000, defaultMod: 'AM' },
      ],
      tankers: [
        { callsign: 'Texaco', frequency: 271.500, modulation: 'AM', tacanChannel: 41, tacanBand: 'Y', tacanCallsign: 'TX1' },
        { callsign: 'Arco',   frequency: 272.500, modulation: 'AM', tacanChannel: 43, tacanBand: 'Y', tacanCallsign: 'AR1' },
        { callsign: 'Shell',  frequency: 273.500, modulation: 'AM', tacanChannel: 45, tacanBand: 'Y', tacanCallsign: 'SH1' },
      ],
      supportAssets: [
        { callsign: 'Magic',  role: 'AWACS', frequency: 263.000, modulation: 'AM' },
        { callsign: 'Overlord', role: 'GCI', frequency: 264.000, modulation: 'AM' },
      ],
      comms: [
        { role: 'Marshal',     frequency: 305.000, modulation: 'AM' },
        { role: 'Tower',       frequency: 311.000, modulation: 'AM' },
        { role: 'Strike',      frequency: 280.000, modulation: 'AM' },
        { role: 'Departure',   frequency: 315.000, modulation: 'AM' },
        { role: 'Guard',       frequency: 243.000, modulation: 'AM', notes: 'Emergency only' },
      ],
      tacans: [
        { role: 'CVN (home plate)', channel: 74, band: 'X', callsign: 'STN' },
      ],
    };
  }

  if (kind === 'modern-land') {
    return {
      id: makeId(),
      name: STARTER_NAMES[kind],
      notes: STARTER_NOTES[kind],
      updatedAt: Date.now(),
      laserCodeBase: 1511,
      flights: [
        { callsign: 'Dodge',   priority: 1, defaultFreq: 251.000, defaultMod: 'AM' },
        { callsign: 'Pontiac', priority: 2, defaultFreq: 252.000, defaultMod: 'AM' },
        { callsign: 'Ford',    priority: 3, defaultFreq: 253.000, defaultMod: 'AM' },
        { callsign: 'Chevy',   priority: 4, defaultFreq: 254.000, defaultMod: 'AM' },
      ],
      tankers: [
        { callsign: 'Texaco', frequency: 271.500, modulation: 'AM', tacanChannel: 41, tacanBand: 'Y', tacanCallsign: 'TX1' },
        { callsign: 'Arco',   frequency: 272.500, modulation: 'AM', tacanChannel: 43, tacanBand: 'Y', tacanCallsign: 'AR1' },
      ],
      supportAssets: [
        { callsign: 'Magic',   role: 'AWACS', frequency: 263.000, modulation: 'AM' },
        { callsign: 'Axeman',  role: 'JTAC',  frequency: 240.000, modulation: 'AM' },
      ],
      comms: [
        { role: 'Tower',     frequency: 250.000, modulation: 'AM' },
        { role: 'Ground',    frequency: 252.500, modulation: 'AM' },
        { role: 'Approach',  frequency: 255.000, modulation: 'AM' },
        { role: 'Strike',    frequency: 280.000, modulation: 'AM' },
        { role: 'Guard',     frequency: 243.000, modulation: 'AM', notes: 'Emergency only' },
      ],
      tacans: [
        { role: 'Home airfield', channel: 100, band: 'X' },
      ],
    };
  }

  // cold-war
  return {
    id: makeId(),
    name: STARTER_NAMES[kind],
    notes: STARTER_NOTES[kind],
    updatedAt: Date.now(),
    laserCodeBase: 1688,
    flights: [
      { callsign: 'Eagle',   priority: 1, defaultFreq: 251.000, defaultMod: 'AM' },
      { callsign: 'Falcon',  priority: 2, defaultFreq: 252.000, defaultMod: 'AM' },
      { callsign: 'Phantom', priority: 3, defaultFreq: 253.000, defaultMod: 'AM' },
      { callsign: 'Raven',   priority: 4, defaultFreq: 254.000, defaultMod: 'AM' },
    ],
    tankers: [
      { callsign: 'Texaco', frequency: 270.000, modulation: 'AM', tacanChannel: 25, tacanBand: 'Y', tacanCallsign: 'TX1' },
    ],
    supportAssets: [
      { callsign: 'Sentry',   role: 'AWACS', frequency: 260.000, modulation: 'AM' },
      { callsign: 'Mainstay', role: 'GCI',   frequency: 261.000, modulation: 'AM' },
    ],
    comms: [
      { role: 'Tower',     frequency: 250.000, modulation: 'AM' },
      { role: 'Approach',  frequency: 255.000, modulation: 'AM' },
      { role: 'Strike',    frequency: 280.000, modulation: 'AM' },
      { role: 'Ground FM', frequency:  30.000, modulation: 'FM', notes: 'Common ground tac VHF' },
      { role: 'Guard',     frequency: 243.000, modulation: 'AM' },
    ],
    tacans: [
      { role: 'Home airfield', channel: 50, band: 'X' },
    ],
  };
}
