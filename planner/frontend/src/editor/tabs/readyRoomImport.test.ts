import { describe, it, expect } from 'vitest';
import {
  parseRrLink,
  rosterUrl,
  rosterToRows,
  isSupportedRoster,
  type RrRoster,
} from './readyRoomImport';

const ROSTER: RrRoster = {
  schema: 'readyroom.mission_roster.v1',
  mission: { id: 42, name: 'Op Foo', status: 'planning', primary_aircraft: 'FA-18C_hornet', start_at: 1736700000000 },
  wing: { id: 1, name: 'VMFA-224', tag: 'BENGAL' },
  flights: [
    {
      callsign: 'Uzi', aircraft: 'FA-18C_hornet', role: 'OCA', slots: 4,
      signups: [
        { name: 'Garrett', callsign: 'Fett', modex: '401', livery: 'VMFA-224 2023', status: 'signed' },
        { name: 'Joe', callsign: 'Sixer', modex: '403', livery: null, status: 'confirmed' },
      ],
    },
    { callsign: 'Hawk', aircraft: 'FA-18C_hornet', role: 'CAP', slots: 2, signups: [] }, // empty flight
  ],
};

describe('parseRrLink', () => {
  it('parses a full https URL', () => {
    expect(parseRrLink('https://readyroom.up.railway.app/share/abc123/missions/42/roster'))
      .toEqual({ base: 'https://readyroom.up.railway.app', token: 'abc123', missionId: 42 });
  });

  it('parses without the trailing /roster', () => {
    expect(parseRrLink('https://host/share/tok/missions/7'))
      .toEqual({ base: 'https://host', token: 'tok', missionId: 7 });
  });

  it('tolerates a trailing slash', () => {
    expect(parseRrLink('https://host/share/tok/missions/7/roster/'))
      .toEqual({ base: 'https://host', token: 'tok', missionId: 7 });
  });

  it('parses a path prefix into base', () => {
    expect(parseRrLink('https://host/app/share/tok/missions/7/roster'))
      .toEqual({ base: 'https://host/app', token: 'tok', missionId: 7 });
  });

  it('parses a bare path with empty base', () => {
    expect(parseRrLink('/share/tok/missions/9'))
      .toEqual({ base: '', token: 'tok', missionId: 9 });
  });

  it('trims surrounding whitespace', () => {
    expect(parseRrLink('  https://host/share/tok/missions/3/roster  '))
      .toEqual({ base: 'https://host', token: 'tok', missionId: 3 });
  });

  it('rejects garbage / non-share URLs / bad ids', () => {
    expect(parseRrLink('')).toBeNull();
    expect(parseRrLink('https://host/missions/42')).toBeNull();
    expect(parseRrLink('https://host/share/tok/missions/abc')).toBeNull();
    expect(parseRrLink('https://host/share//missions/42')).toBeNull();
    expect(parseRrLink('just some text')).toBeNull();
  });

  it('rosterUrl round-trips a parsed link', () => {
    const link = parseRrLink('https://host/share/tok/missions/7/roster')!;
    expect(rosterUrl(link)).toBe('https://host/share/tok/missions/7/roster');
  });
});

describe('isSupportedRoster', () => {
  it('accepts the v1 schema', () => {
    expect(isSupportedRoster(ROSTER)).toBe(true);
    expect(isSupportedRoster({ schema: 'readyroom.mission_roster.v1.2', flights: [] })).toBe(true);
  });
  it('rejects wrong/missing schema or shape', () => {
    expect(isSupportedRoster({ schema: 'readyroom.mission_roster.v2', flights: [] })).toBe(false);
    expect(isSupportedRoster({ flights: [] })).toBe(false);
    expect(isSupportedRoster({ schema: 'readyroom.mission_roster.v1' })).toBe(false); // no flights
    expect(isSupportedRoster(null)).toBe(false);
    expect(isSupportedRoster('nope')).toBe(false);
  });
});

describe('rosterToRows', () => {
  it('emits the planner sheet headers', () => {
    expect(rosterToRows(ROSTER).headers).toEqual(['Flight', 'Callsign', 'Pilot', 'Seat', 'Modex', 'Livery']);
  });

  it('emits one row per signed-up pilot, flight-then-seat, with modex + livery', () => {
    const { rows } = rosterToRows(ROSTER);
    expect(rows).toHaveLength(2); // Uzi has 2 signups; Hawk empty contributes none
    expect(rows[0]).toEqual({ Flight: 'Uzi', Callsign: 'Uzi 1-1', Pilot: 'Garrett', Seat: '1', Modex: '401', Livery: 'VMFA-224 2023' });
    expect(rows[1]).toEqual({ Flight: 'Uzi', Callsign: 'Uzi 1-2', Pilot: 'Joe', Seat: '2', Modex: '403', Livery: '' });
  });

  it('leaves Modex + Livery blank when the signup has none', () => {
    const r: RrRoster = { ...ROSTER, flights: [
      { callsign: 'Viper', aircraft: null, role: null, slots: 1, signups: [
        { name: 'Mav', callsign: null, modex: null, livery: null, status: 'signed' },
      ] },
    ] };
    expect(rosterToRows(r).rows[0].Modex).toBe('');
    expect(rosterToRows(r).rows[0].Livery).toBe('');
  });

  it('falls back to pilot callsign when name is null', () => {
    const r: RrRoster = { ...ROSTER, flights: [
      { callsign: 'Viper', aircraft: null, role: null, slots: 2, signups: [
        { name: null, callsign: 'Maverick', modex: null, livery: null, status: 'signed' },
      ] },
    ] };
    expect(rosterToRows(r).rows[0].Pilot).toBe('Maverick');
  });

  it('degrades safely on a null flight callsign (empty Callsign cell)', () => {
    const r: RrRoster = { ...ROSTER, flights: [
      { callsign: null, aircraft: null, role: null, slots: 1, signups: [
        { name: 'Solo', callsign: null, modex: null, livery: null, status: 'signed' },
      ] },
    ] };
    const row = rosterToRows(r).rows[0];
    expect(row.Callsign).toBe('');
    expect(row.Pilot).toBe('Solo');
  });

  it('produces no rows for a roster with only empty flights', () => {
    const r: RrRoster = { ...ROSTER, flights: [
      { callsign: 'Ghost', aircraft: null, role: null, slots: 4, signups: [] },
    ] };
    expect(rosterToRows(r).rows).toHaveLength(0);
  });
});
