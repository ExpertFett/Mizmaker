import { describe, it, expect } from 'vitest';
import { presetLabel, freqWithPreset, presetsForUnits } from './radioPresets';

const ch = (n: number, f: number) => ({ ch: n, freq_mhz: f, modulation: 0, name: '' });

// VMFA-224 runs Strike on channel 5 of both radios.
const HORNET = [
  { radio: 1, channels: [ch(1, 305.0), ch(5, 288.0), ch(9, 321.0)] },
  { radio: 2, channels: [ch(1, 228.55), ch(5, 288.0), ch(9, 321.05)] },
];

describe('presetLabel', () => {
  it('collapses to one number when both radios share the channel', () => {
    expect(presetLabel(288.0, HORNET)).toBe('(5)');
  });

  it('names the radio when only one carries it', () => {
    expect(presetLabel(305.0, HORNET)).toBe('(1L)');
    expect(presetLabel(228.55, HORNET)).toBe('(1R)');
  });

  it('spells out both sides when the channels differ', () => {
    const split = [
      { radio: 1, channels: [ch(5, 251.0)] },
      { radio: 2, channels: [ch(7, 251.0)] },
    ];
    expect(presetLabel(251.0, split)).toBe('(5L/7R)');
  });

  it('returns empty for an unprogrammed frequency', () => {
    expect(presetLabel(332.2, HORNET)).toBe('');
  });

  it('tolerates float drift but not a real neighbouring channel', () => {
    expect(presetLabel(288.0004, HORNET)).toBe('(5)');
    expect(presetLabel(288.025, HORNET)).toBe('');
  });

  it('is safe on missing or malformed input', () => {
    expect(presetLabel(288.0, undefined)).toBe('');
    expect(presetLabel(null, HORNET)).toBe('');
    expect(presetLabel(NaN, HORNET)).toBe('');
    expect(presetLabel(288.0, [])).toBe('');
  });
});

describe('freqWithPreset', () => {
  it('appends only when there is a preset', () => {
    expect(freqWithPreset('288.000 AM', 288.0, HORNET)).toBe('288.000 AM (5)');
    expect(freqWithPreset('332.200 AM', 332.2, HORNET)).toBe('332.200 AM');
  });
});

describe('presetsForUnits', () => {
  it('takes the first unit that actually has presets', () => {
    expect(presetsForUnits([{}, { radioPresets: [] }, { radioPresets: HORNET }])).toBe(HORNET);
    expect(presetsForUnits([])).toBeUndefined();
    expect(presetsForUnits(undefined)).toBeUndefined();
  });
});
