import { create } from 'zustand';
import type {
  MissionGroup, MissionUnit, ThreatRing, Airbase,
  MissionOverviewData, UploadResponse,
} from '../types/mission';

interface MissionState {
  sessionId: string | null;
  filename: string | null;
  theater: string | null;
  overview: MissionOverviewData | null;
  groups: MissionGroup[];
  units: MissionUnit[];
  threats: ThreatRing[];
  airbases: Airbase[];
  selectedGroupId: number | null;

  loadMission: (data: UploadResponse) => void;
  selectGroup: (groupId: number | null) => void;
  updateGroupData: (groups: MissionGroup[], units: MissionUnit[], threats: ThreatRing[], airbases: Airbase[]) => void;
  clear: () => void;

  // Convenience getters
  selectedGroup: () => MissionGroup | undefined;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  sessionId: null,
  filename: null,
  theater: null,
  overview: null,
  groups: [],
  units: [],
  threats: [],
  airbases: [],
  selectedGroupId: null,

  loadMission: (data) =>
    set({
      sessionId: data.sessionId,
      filename: data.filename,
      theater: data.theater,
      overview: data.overview,
      groups: data.groups,
      units: data.units,
      threats: data.threats,
      airbases: data.airbases,
      selectedGroupId: null,
    }),

  selectGroup: (groupId) => set({ selectedGroupId: groupId }),

  updateGroupData: (groups, units, threats, airbases) =>
    set({ groups, units, threats, airbases }),

  clear: () =>
    set({
      sessionId: null,
      filename: null,
      theater: null,
      overview: null,
      groups: [],
      units: [],
      threats: [],
      airbases: [],
      selectedGroupId: null,
    }),

  selectedGroup: () => {
    const { groups, selectedGroupId } = get();
    return groups.find((g) => g.groupId === selectedGroupId);
  },
}));
