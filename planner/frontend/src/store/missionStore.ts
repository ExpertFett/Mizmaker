import { create } from 'zustand';
import type {
  MissionGroup, MissionUnit, ThreatRing, Airbase, MissionDrawing, TriggerZone,
  MissionOverviewData, UploadResponse, ClientUnit, UnitEdit, GroupRenamerData,
  CountryInfo,
} from '../types/mission';

interface MissionState {
  sessionId: string | null;
  hostToken: string | null;
  sessionToken: string | null;       // current client's token (host or invite)
  assignedGroup: string | null;      // null = mission maker (can edit all)
  role: 'mission_maker' | 'flight_lead' | 'pilot';
  filename: string | null;
  theater: string | null;
  overview: MissionOverviewData | null;
  groups: MissionGroup[];
  units: MissionUnit[];
  threats: ThreatRing[];
  airbases: Airbase[];
  drawings: MissionDrawing[];
  triggerZones: TriggerZone[];
  clientUnits: ClientUnit[];
  allUnitsDonor: { unitId: number; name: string; type: string; groupName: string; coalition: string }[];
  pylonOptions: Record<string, any>;
  suggestions: UnitEdit[];
  allGroupsRenamer: GroupRenamerData[];
  liveryData: unknown[];
  laserClsids: string[];
  dtcFlights: string[];
  countries: CountryInfo[];
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
  hostToken: null,
  sessionToken: null,
  assignedGroup: null,
  role: 'mission_maker' as const,
  filename: null,
  theater: null,
  overview: null,
  groups: [],
  units: [],
  threats: [],
  airbases: [],
  drawings: [],
  triggerZones: [],
  clientUnits: [],
  allUnitsDonor: [],
  pylonOptions: {},
  suggestions: [],
  allGroupsRenamer: [],
  liveryData: [],
  laserClsids: [],
  dtcFlights: [],
  countries: [],
  taskLists: { air: [], ground: [], ship: [] },
  selectedGroupId: null,

  loadMission: (data) => {
    const assignedGroup = (data as any).assignedGroup || null;
    // Auto-select the assigned group for flight leads
    let autoSelectId: number | null = null;
    if (assignedGroup) {
      const g = data.groups.find((g: MissionGroup) => g.groupName === assignedGroup);
      if (g) autoSelectId = g.groupId;
    }
    set({
      sessionId: data.sessionId,
      hostToken: (data as any).hostToken || null,
      sessionToken: (data as any).token || (data as any).hostToken || null,
      assignedGroup,
      role: (data as any).role || 'mission_maker',
      filename: data.filename,
      theater: data.theater,
      overview: data.overview,
      groups: data.groups,
      units: data.units,
      threats: data.threats,
      airbases: data.airbases,
      drawings: data.drawings || [],
      triggerZones: data.triggerZones || [],
      clientUnits: data.clientUnits || [],
      allUnitsDonor: data.allUnitsDonor || [],
      pylonOptions: data.pylonOptions || {},
      suggestions: data.suggestions || [],
      allGroupsRenamer: data.allGroupsRenamer || [],
      liveryData: data.liveryData || [],
      laserClsids: data.laserClsids || [],
      dtcFlights: data.dtcFlights || [],
      countries: data.countries || [],
      taskLists: data.taskLists || { air: [], ground: [], ship: [] },
      selectedGroupId: autoSelectId,
    });
  },

  selectGroup: (groupId) => set({ selectedGroupId: groupId }),

  updateGroupData: (groups, units, threats, airbases) =>
    set({ groups, units, threats, airbases }),

  clear: () =>
    set({
      sessionId: null, hostToken: null, sessionToken: null, assignedGroup: null,
      role: 'mission_maker' as const, filename: null, theater: null, overview: null,
      groups: [], units: [], threats: [], airbases: [], drawings: [], triggerZones: [],
      clientUnits: [], allUnitsDonor: [], pylonOptions: {}, suggestions: [],
      allGroupsRenamer: [], liveryData: [], laserClsids: [], dtcFlights: [],
      countries: [],
      taskLists: { air: [], ground: [], ship: [] },
      selectedGroupId: null,
    }),

  selectedGroup: () => {
    const { groups, selectedGroupId } = get();
    return groups.find((g) => g.groupId === selectedGroupId);
  },
}));
