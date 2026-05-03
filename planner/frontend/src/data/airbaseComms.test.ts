/**
 * airbaseComms — DB lookups + ATIS frequency suggester.
 *
 * The suggester needs to be deterministic (same name → same freq
 * every time) and produce values on the 25 kHz UHF grid in the
 * 250-270 MHz range. The DB-aware variant (atisForAirbase) needs to
 * prefer DB values over the suggestion.
 */

import { describe, it, expect } from 'vitest';
import { suggestAtisFreq, atisForAirbase, getAirbaseComms } from './airbaseComms';

describe('suggestAtisFreq', () => {
  it('is deterministic — same name yields same freq', () => {
    expect(suggestAtisFreq('Krymsk')).toBe(suggestAtisFreq('Krymsk'));
    expect(suggestAtisFreq('Anapa-Vityazevo')).toBe(suggestAtisFreq('Anapa-Vityazevo'));
  });

  it('is case-insensitive', () => {
    expect(suggestAtisFreq('KRYMSK')).toBe(suggestAtisFreq('krymsk'));
    expect(suggestAtisFreq('Krymsk')).toBe(suggestAtisFreq('krymsk'));
  });

  it('falls inside the 250.000 – 269.975 MHz range', () => {
    for (const name of ['Krymsk', 'Mineralnye-Vody', 'Beslan', 'Mozdok', 'Gudauta', 'Test', 'A', 'Z']) {
      const f = suggestAtisFreq(name);
      expect(f).toBeGreaterThanOrEqual(250);
      expect(f).toBeLessThan(270);
    }
  });

  it('lands on the 25 kHz grid', () => {
    for (const name of ['Krymsk', 'Mineralnye-Vody', 'Beslan']) {
      const f = suggestAtisFreq(name);
      // f * 1000 % 25 should be 0 (within float tolerance) since
      // step = 0.025 MHz = 25 kHz.
      expect(Math.round(f * 1000) % 25).toBe(0);
    }
  });

  it('produces different freqs for different names (collision unlikely)', () => {
    const freqs = ['Krymsk', 'Mineralnye-Vody', 'Beslan', 'Mozdok', 'Gudauta'].map(suggestAtisFreq);
    // All five should be distinct on a 800-slot range.
    expect(new Set(freqs).size).toBe(freqs.length);
  });
});

describe('atisForAirbase', () => {
  it('returns DB value when an airbase has one defined (Batumi)', () => {
    const dbValue = getAirbaseComms('Batumi')?.atis;
    expect(dbValue).toBeDefined();
    const r = atisForAirbase('Batumi');
    expect(r.source).toBe('db');
    expect(r.freq).toBe(dbValue);
  });

  it('falls back to the suggester when no DB ATIS exists (Krymsk)', () => {
    expect(getAirbaseComms('Krymsk')?.atis).toBeUndefined();
    const r = atisForAirbase('Krymsk');
    expect(r.source).toBe('suggested');
    expect(r.freq).toBe(suggestAtisFreq('Krymsk'));
  });

  it('handles unknown airbases by suggesting (no crash)', () => {
    const r = atisForAirbase('Unknown Field 42');
    expect(r.source).toBe('suggested');
    expect(r.freq).toBeGreaterThanOrEqual(250);
    expect(r.freq).toBeLessThan(270);
  });
});
