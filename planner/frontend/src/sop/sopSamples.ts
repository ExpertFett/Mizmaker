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
