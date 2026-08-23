import { describe, it, expect } from 'vitest';
import { buildRadioLadder, applyLadderOrder, type LadderRow } from './radioLadder';

const wp = (lat: number, lon: number) => ({
  waypoint_number: 0, waypoint_name: '', waypoint_type: '', waypoint_action: '',
  lat, lon, x: 0, y: 0, altitude_m: 0, altitude_type: 'BARO' as const,
  speed_ms: 0, speed_locked: true, eta_seconds: 0, eta_locked: false, task: null,
});

const KIRKENES = {
  name: 'Kirkenes', coalition: 'blue', x: 0, y: 0, lat: 69.72, lon: 29.89, id: 14,
  atc_radio: { uhf_mhz: 250.25, vhf_high_mhz: 121.3 },
  runways: [{ name: '23-05', ends: ['23', '05'], headings: [230, 50] }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const grp = (o: any) => ({
  groupId: 1, groupName: 'X', coalition: 'blue', category: 'plane', task: '',
  frequency: 0, modulation: 0, units: [], waypoints: [], ...o,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

const BENGAL = grp({
  groupId: 1, groupName: 'Bengal-3', task: 'CAS', frequency: 305.0,
  waypoints: [wp(69.72, 29.89), wp(69.0, 31.0)],
});

const base = {
  group: BENGAL,
  allGroups: [
    BENGAL,
    grp({ groupId: 2, groupName: 'Closeout-1', task: 'AWACS', frequency: 321.05 }),
    grp({ groupId: 3, groupName: 'Texaco-2', task: 'Refueling', frequency: 332.2,
          tacan: { channel: 119, band: 'Y', callsign: 'TX2' } }),
  ],
  coalition: 'blue',
  airbases: [KIRKENES],
  sopComms: [{ role: 'Strike', frequency: 288.0 }, { role: 'Ground Ops', frequency: 122.0 }],
};

describe('buildRadioLadder', () => {
  it('walks the sortie in phase order, not by role tier', () => {
    const phases = buildRadioLadder(base).map((r) => r.phase);
    expect(phases).toEqual([...phases].sort(
      (a, b) => ['GROUND','TOWER','DEPARTURE','CHECK-IN','TACTICAL','AWACS','TANKER','RECOVERY','GUARD']
        .indexOf(a) - ['GROUND','TOWER','DEPARTURE','CHECK-IN','TACTICAL','AWACS','TANKER','RECOVERY','GUARD'].indexOf(b)));
    expect(phases[0]).toBe('GROUND');
    expect(phases[phases.length - 1]).toBe('GUARD');
  });

  it('takes the departure field from the first waypoint', () => {
    const rows = buildRadioLadder(base);
    expect(rows.find((r) => r.phase === 'GROUND')?.agency).toBe('Kirkenes Ground');
    expect(rows.find((r) => r.phase === 'GROUND')?.freqMhz).toBe(250.25);
  });

  it('uses the SOP C2 net for check-in and ignores unrelated SOP roles', () => {
    const rows = buildRadioLadder(base).filter((r) => r.phase === 'CHECK-IN');
    expect(rows).toHaveLength(1);
    expect(rows[0].agency).toBe('Strike');
    expect(rows[0].freqMhz).toBe(288.0);
  });

  it('carries the tanker TACAN alongside its frequency', () => {
    const tkr = buildRadioLadder(base).find((r) => r.phase === 'TANKER');
    expect(tkr?.note).toBe('119Y');
  });

  it('always ends on guard', () => {
    const rows = buildRadioLadder(base);
    expect(rows.at(-1)).toMatchObject({ phase: 'GUARD', freqMhz: 243.0 });
  });

  it('degrades to what it knows when there is no flight or SOP', () => {
    const rows = buildRadioLadder({ ...base, group: undefined, sopComms: [] });
    expect(rows.some((r) => r.phase === 'CHECK-IN')).toBe(false);
    expect(rows.some((r) => r.phase === 'TACTICAL')).toBe(false);
    expect(rows.some((r) => r.phase === 'AWACS')).toBe(true);   // still known
    expect(rows.at(-1)?.phase).toBe('GUARD');
  });

  it('does not spend two rungs on one frequency in the same phase', () => {
    const rows = buildRadioLadder(base);
    const tower = rows.filter((r) => r.phase === 'TOWER').map((r) => r.freqMhz);
    expect(new Set(tower).size).toBe(tower.length);
  });
});

describe('applyLadderOrder', () => {
  const rows = [
    { id: 'a', phase: 'GROUND', agency: 'A', freqMhz: 1, modulation: 0 },
    { id: 'b', phase: 'TOWER', agency: 'B', freqMhz: 2, modulation: 0 },
    { id: 'c', phase: 'GUARD', agency: 'C', freqMhz: 3, modulation: 0 },
  ] as LadderRow[];

  it('reorders to the planner preference', () => {
    expect(applyLadderOrder(rows, ['c', 'a', 'b']).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps rows a stale order forgot, rather than dropping them', () => {
    expect(applyLadderOrder(rows, ['c']).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('ignores ids that no longer exist', () => {
    expect(applyLadderOrder(rows, ['gone', 'b']).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('passes through when there is no saved order', () => {
    expect(applyLadderOrder(rows)).toBe(rows);
  });
});
