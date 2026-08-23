import { describe, it, expect } from 'vitest';
import { clusterThreatSites, type ThreatLike } from './threatSites';

const t = (type: string, lat: number, lon: number, range: number): ThreatLike =>
  ({ type, lat, lon, range });

const family = (x: ThreatLike) => (x.type.startsWith('S-300') ? 'SA-10' : x.type);
const range = (x: ThreatLike) => x.range;

describe('clusterThreatSites', () => {
  it('merges the radars of one S-300 battery into a single site', () => {
    const sites = clusterThreatSites([
      t('S-300PS 40B6M tr', 68.00, 33.00, 75000),
      t('S-300PS 64H6E sr', 68.005, 33.004, 0),
      t('S-300PS 40B6MD sr', 67.998, 32.996, 0),
    ], family, range);
    expect(sites).toHaveLength(1);
    expect(sites[0].count).toBe(3);
  });

  it('names the site after its longest-ranged member', () => {
    const sites = clusterThreatSites([
      t('S-300PS 64H6E sr', 68.0, 33.0, 0),
      t('S-300PS 40B6M tr', 68.001, 33.001, 75000),
    ], family, range);
    expect(sites[0].lead.type).toBe('S-300PS 40B6M tr');
  });

  it('keeps two batteries of the same system apart', () => {
    const sites = clusterThreatSites([
      t('Kub 1S91 str', 68.0, 33.0, 25000),
      t('Kub 1S91 str', 68.2, 33.0, 25000),   // 12nm away
    ], family, range);
    expect(sites).toHaveLength(2);
  });

  it('never merges different systems at the same spot', () => {
    const sites = clusterThreatSites([
      t('ZSU-23-4 Shilka', 68.0, 33.0, 2500),
      t('2S6 Tunguska', 68.0, 33.0, 8000),
    ], family, range);
    expect(sites).toHaveLength(2);
  });

  it('collapses a cluster of point defence into one row with a count', () => {
    const shilkas = Array.from({ length: 12 }, (_, i) =>
      t('ZSU-23-4 Shilka', 68.0 + i * 0.002, 33.0, 2500));
    const sites = clusterThreatSites(shilkas, family, range);
    expect(sites).toHaveLength(1);
    expect(sites[0].count).toBe(12);
  });

  it('returns sites longest-ranged first', () => {
    const sites = clusterThreatSites([
      t('ZSU-23-4 Shilka', 60.0, 30.0, 2500),
      t('S-300PS 40B6M tr', 68.0, 33.0, 75000),
      t('Kub 1S91 str', 64.0, 31.0, 25000),
    ], family, range);
    expect(sites.map((s) => s.lead.type)).toEqual([
      'S-300PS 40B6M tr', 'Kub 1S91 str', 'ZSU-23-4 Shilka',
    ]);
  });

  it('skips threats with no position instead of throwing', () => {
    const sites = clusterThreatSites(
      [{ type: 'SA-2', lat: null, lon: null, range: 1 }], family, range);
    expect(sites).toHaveLength(0);
  });
});
