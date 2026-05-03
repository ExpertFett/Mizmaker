/**
 * missionStore — bulk-replace action tests.
 *
 * Locks in the contract for setGroups / setClientUnits /
 * setLaserCapableUnits / setOverview — the typed actions added to
 * replace ~22 direct useMissionStore.setState({...}) calls scattered
 * across the codebase.
 *
 * Pattern matches editStore.test.ts: reset state in beforeEach,
 * exercise actions via getState(), assert via getState() snapshots.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useMissionStore } from './missionStore';
import type { MissionGroup, ClientUnit, LaserCapableUnit, MissionOverviewData } from '../types/mission';

function makeGroup(over: Partial<MissionGroup> = {}): MissionGroup {
  return {
    groupId: 1, groupName: 'Bengal 1', coalition: 'blue', country: 'USA',
    category: 'plane', task: 'CAS', frequency: 270.8, modulation: 0,
    units: [], waypoints: [], ...over,
  };
}

function makeOverview(over: Partial<MissionOverviewData> = {}): MissionOverviewData {
  return {
    theater: 'Test', sortie: '', date: '2025-01-01', start_time: 0,
    description: '', descriptionBlueTask: '', descriptionRedTask: '',
    weather: {
      wind: {
        atGround: { speed: 0, dir: 0 },
        at2000: { speed: 0, dir: 0 },
        at8000: { speed: 0, dir: 0 },
      },
      temperature_c: 15, qnh_mmhg: 760, qnh_inhg: 29.92, qnh_hpa: 1013,
      clouds_base_m: 0, clouds_density: 0, clouds_thickness: 0,
      clouds_precipitation: 0, clouds_preset: '',
      visibility_m: 80000, fog_enabled: false, fog_visibility: 0, fog_thickness: 0,
      dust_enabled: false, dust_density: 0, turbulence: 0, halo_preset: '',
    },
    ...over,
  };
}

describe('missionStore bulk-replace actions', () => {
  beforeEach(() => {
    // Wipe everything we touch — leave the rest of state alone so we
    // don't accidentally break unrelated tests.
    useMissionStore.setState({
      groups: [],
      clientUnits: [],
      laserCapableUnits: [],
      overview: null,
    });
  });

  describe('setGroups', () => {
    it('replaces the groups array wholesale', () => {
      const a = makeGroup({ groupId: 1, groupName: 'Alpha' });
      const b = makeGroup({ groupId: 2, groupName: 'Bravo' });
      useMissionStore.getState().setGroups([a, b]);
      expect(useMissionStore.getState().groups).toEqual([a, b]);
    });

    it('does not touch other fields', () => {
      const cu: ClientUnit = {
        unitId: 1, name: 'P1', type: 'FA-18C', groupName: 'Bengal 1',
        groupId: 1, x: 0, y: 0, country: 'USA',
        skill: 'Client', livery_id: '',
        radioPresets: [], pylons: [],
        donors: [], teamMembers: [],
        voiceCallsignLabel: '', voiceCallsignNumber: '', stnL16: '',
        airframeChannelMin: 0, airframeChannelMax: 0,
      } as unknown as ClientUnit;
      useMissionStore.setState({ clientUnits: [cu] });
      useMissionStore.getState().setGroups([makeGroup()]);
      expect(useMissionStore.getState().clientUnits).toEqual([cu]);
    });

    it('accepts an empty array (clears groups)', () => {
      useMissionStore.setState({ groups: [makeGroup()] });
      useMissionStore.getState().setGroups([]);
      expect(useMissionStore.getState().groups).toEqual([]);
    });
  });

  describe('setClientUnits', () => {
    it('replaces clientUnits without touching groups', () => {
      useMissionStore.setState({ groups: [makeGroup()] });
      const cu = {} as ClientUnit;
      useMissionStore.getState().setClientUnits([cu]);
      expect(useMissionStore.getState().clientUnits).toEqual([cu]);
      expect(useMissionStore.getState().groups).toHaveLength(1);
    });
  });

  describe('setLaserCapableUnits', () => {
    it('replaces laserCapableUnits', () => {
      const lu = { unitId: 1, name: 'P1', laserCode: 1688 } as unknown as LaserCapableUnit;
      useMissionStore.getState().setLaserCapableUnits([lu]);
      expect(useMissionStore.getState().laserCapableUnits).toEqual([lu]);
    });
  });

  describe('setOverview', () => {
    it('replaces the overview block', () => {
      const ov = makeOverview({ theater: 'Caucasus' });
      useMissionStore.getState().setOverview(ov);
      expect(useMissionStore.getState().overview).toEqual(ov);
    });

    it('accepts null to clear overview', () => {
      useMissionStore.setState({ overview: makeOverview() });
      useMissionStore.getState().setOverview(null);
      expect(useMissionStore.getState().overview).toBeNull();
    });
  });

  describe('clear', () => {
    it('resets all the bulk-replace fields to their initial values', () => {
      useMissionStore.setState({
        groups: [makeGroup()],
        clientUnits: [{} as ClientUnit],
        laserCapableUnits: [{} as LaserCapableUnit],
        overview: makeOverview(),
      });
      useMissionStore.getState().clear();
      const s = useMissionStore.getState();
      expect(s.groups).toEqual([]);
      expect(s.clientUnits).toEqual([]);
      expect(s.laserCapableUnits).toEqual([]);
      expect(s.overview).toBeNull();
    });
  });
});
