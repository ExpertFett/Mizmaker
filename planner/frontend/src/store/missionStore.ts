import { create } from 'zustand';
import type {
  MissionGroup, MissionUnit, ThreatRing, Airbase, MissionDrawing,
  MissionOverviewData, UploadResponse, ClientUnit, UnitEdit, GroupRenamerData,
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
  drawings: MissionDrawing[];
  clientUnits: ClientUnit[];
  allUnitsDonor: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  pylonOptions: Record<string, any>;
  suggestions: UnitEdit[];
  allGroupsRenamer: GroupRenamerData[];
  liveryData: unknown[];
  laserClsids: string[];
  dtcFlights: string[];
  taskLists: { air: string[]; ground: string[]; ship: string[] };
  selectedGroupId: number | null;

  loadMission: (data: UploadResponse) => void;
  selectGroup: (groupId: number | null) => void;
  updateGroupData: (groups: MissionGroup[], units: MissionUnit[], threats: ThreatRing[], airbases: Airbase[]) => void;
  clear: () => void;
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
  drawings: [],
  clientUnits: [],
  allUnitsDonor: [],
  pylonOptions: {},
  suggestions: [],
  allGroupsRenamer: [],
  liveryData: [],
  laserClsids: [],
  dtcFlights: [],
  taskLists: { air: [], ground: [], ship: [] },
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
      drawings: data.drawings || [],
      clientUnits: data.clientUnits || [],
      allUnitsDonor: data.allUnitsDonor || [],
      pylonOptions: data.pylonOptions || {},
      suggestions: data.suggestions || [],
      allGroupsRenamer: data.allGroupsRenamer || [],
      liveryData: data.liveryData || [],
      laserClsids: data.laserClsids || [],
      dtcFlights: data.dtcFlights || [],
      taskLists: data.taskLists || { air: [], ground: [], ship: [] },
      selectedGroupId: null,
    }),

  selectGroup: (groupId) => set({ selectedGroupId: groupId }),

  updateGroupData: (groups, units, threats, airbases) =>
    set({ groups, units, threats, airbases }),

  clear: () =>
    set({
      sessionId: null, filename: null, theater: null, overview: null,
      groups: [], units: [], threats: [], airbases: [], drawings: [],
      clientUnits: [], allUnitsDonor: [], pylonOptions: {}, suggestions: [],
      allGroupsRenamer: [], liveryData: [], laserClsids: [], dtcFlights: [],
      taskLists: { air: [], ground: [], ship: [] },
      selectedGroupId: null,
    }),

  selectedGroup: () => {
    const { groups, selectedGroupId } = get();
    return groups.find((g) => g.groupId === selectedGroupId);
  },
}));
