import { describe, it, expect } from 'vitest';
import { contrailBand, contrailSummary, toFlightLevel } from './contrails';

describe('contrailBand', () => {
  it('puts onset low on a cold Arctic day', () => {
    // Kola M4 surface temp. 39C to lose at 1.98C/1000ft.
    const { onsetFt } = contrailBand(-1);
    expect(onsetFt).toBe(19697);
  });

  it('puts onset high on a warm day', () => {
    // +20C needs 60C of lapse = ~30,300ft, still below the tropopause.
    const { onsetFt } = contrailBand(20);
    expect(onsetFt).toBe(30303);
  });

  it('reports no band when air that warm never reaches -40C below the tropopause', () => {
    // +35C would need ~37,900ft of lapse — past where the lapse stops.
    expect(contrailBand(35).onsetFt).toBeNull();
  });

  it('reports no band when the tropopause is reached first', () => {
    // +45C surface needs 85C of lapse = ~42,900ft, above the tropopause.
    expect(contrailBand(45).onsetFt).toBeNull();
  });

  it('returns surface level when it is already that cold', () => {
    expect(contrailBand(-45).onsetFt).toBe(0);
  });

  it('is safe on garbage input', () => {
    expect(contrailBand(NaN)).toEqual({ onsetFt: null, topFt: null });
  });
});

describe('contrailSummary', () => {
  it('reads as a band when both ends are below the tropopause', () => {
    expect(contrailSummary(-1)).toBe('FL197 (19,697 ft) to FL298 (29,798 ft)');
  });

  it('says "and above" when the top is past the tropopause', () => {
    expect(contrailSummary(20)).toMatch(/and above$/);
  });

  it('says none when it never gets cold enough', () => {
    expect(contrailSummary(45)).toMatch(/^None/);
  });
});

describe('toFlightLevel', () => {
  it('pads to three digits', () => {
    expect(toFlightLevel(19697)).toBe('FL197');
    expect(toFlightLevel(9000)).toBe('FL090');
  });
});
