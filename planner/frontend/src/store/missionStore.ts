import { create } from 'zustand';
import type {
  MissionGroup, MissionUnit, ThreatRing, Airbase, MissionDrawing, TriggerZone,
  MissionOverviewData, MissionOptions, UploadResponse, ClientUnit, LaserCapableUnit, UnitEdit, GroupRenamerData,
  CountryInfo,
} from '../types/mission';

interface MissionState {
  sessionId: string | null;
  hostToken: string | null;
  sessionToken: string | null;       // current client's token (host or invite)
  assignedGroup: string | null;      // null = mission maker (can edit all)
  // v1.19.63 — 'co_editor' = an invited user who joined as a peer
  // mission maker (full edit access, no flight assignment). Same edit
  // capabilities as 'mission_maker' but distinct so UI can show the
  // difference between the host and a guest editor in member lists.
  role: 'mission_maker' | 'co_editor' | 'flight_lead' | 'pilot';
  filename: string | null;
  theater: string | null;
  overview: MissionOverviewData | null;
  groups: MissionGroup[];
  units: MissionUnit[];
  threats: ThreatRing[];
  airbases: Airbase[];
  drawings: MissionDrawing[];
  triggerZones: TriggerZone[];
  missionOptions: MissionOptions;
  clientUnits: ClientUnit[];
  laserCapableUnits: LaserCapableUnit[];
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
  setMissionOptions: (opts: MissionOptions) => void;
  /** Replace the whole groups array. Use when a tab applies a bulk
   *  edit (e.g. waypoint moves, flight assignments) and produces a
   *  freshly-mapped array. Same effect as the old direct dict-style
   *  setState pattern but routed through a typed action so future
   *  audit trails / undo can hook it. */
  setGroups: (groups: MissionGroup[]) => void;
  /** Replace the whole clientUnits array. Used by Datalink, Loadout,
   *  and DTC tabs when they re-derive the clientUnit list after a
   *  per-unit edit. */
  setClientUnits: (clientUnits: ClientUnit[]) => void;
  /** Replace the whole laserCapableUnits array. Mirrors setClientUnits
   *  for the laser-pylon case (LoadoutTab + LaserTab). */
  setLaserCapableUnits: (units: LaserCapableUnit[]) => void;
  /** Replace the overview block (weather, theater, sortie, etc.).
   *  Used by WeatherTab to mirror an edit back to the map's WeatherPanel
   *  display. The store is the source of truth for read-only display
   *  state; the actual edit lives in editStore as a queued edit. */
  setOverview: (overview: MissionOverviewData | null) => void;
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
  missionOptions: {},
  clientUnits: [],
  laserCapableUnits: [],
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
      groups: [...data.groups].sort((a, b) => a.groupName.localeCompare(b.groupName)),
      units: data.units,
      threats: data.threats,
      airbases: data.airbases,
      drawings: data.drawings || [],
      triggerZones: data.triggerZones || [],
      missionOptions: data.missionOptions || {},
      clientUnits: [...(data.clientUnits || [])].sort((a, b) => a.groupName.localeCompare(b.groupName)),
      laserCapableUnits: [...((data as any).laserCapableUnits || [])].sort((a: LaserCapableUnit, b: LaserCapableUnit) => a.groupName.localeCompare(b.groupName)),
      allUnitsDonor: [...(data.allUnitsDonor || [])].sort((a, b) => a.groupName.localeCompare(b.groupName)),
      pylonOptions: data.pylonOptions || {},
      suggestions: data.suggestions || [],
      allGroupsRenamer: [...(data.allGroupsRenamer || [])].sort((a, b) => (a.groupName || '').localeCompare(b.groupName || '')),
      liveryData: data.liveryData || [],
      laserClsids: data.laserClsids || [],
      dtcFlights: [...(data.dtcFlights || [])].sort((a, b) => a.localeCompare(b)),
      countries: data.countries || [],
      taskLists: data.taskLists || { air: [], ground: [], ship: [] },
      selectedGroupId: autoSelectId,
    });
  },

  selectGroup: (groupId) => set({ selectedGroupId: groupId }),

  updateGroupData: (groups, units, threats, airbases) =>
    set({ groups, units, threats, airbases }),

  setMissionOptions: (opts) => set({ missionOptions: opts }),

  setGroups: (groups) => set({ groups }),

  setClientUnits: (clientUnits) => set({ clientUnits }),

  setLaserCapableUnits: (units) => set({ laserCapableUnits: units }),

  setOverview: (overview) => set({ overview }),

  clear: () =>
    set({
      sessionId: null, hostToken: null, sessionToken: null, assignedGroup: null,
      role: 'mission_maker' as const, filename: null, theater: null, overview: null,
      groups: [], units: [], threats: [], airbases: [], drawings: [], triggerZones: [], missionOptions: {},
      clientUnits: [], laserCapableUnits: [], allUnitsDonor: [], pylonOptions: {}, suggestions: [],
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
