import { create } from 'zustand';

export type ViewMode = 'all' | 'blue' | 'red' | 'players';
export type SpeedMode = 'gs' | 'cas' | 'tas' | 'mach';

interface MapState {
  layers: Record<string, any>;
  viewMode: ViewMode;
  hiddenGroupIds: Set<number>;
  adminMode: boolean;
  speedMode: SpeedMode;
  addWaypointMode: boolean;
  measureMode: boolean;
  editorMode: boolean;
  floatingPanelPos: { x: number; y: number };

  toggleLayer: (id: string) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleGroupVisibility: (groupId: number) => void;
  setAdminMode: (on: boolean) => void;
  setSpeedMode: (mode: SpeedMode) => void;
  setAddWaypointMode: (on: boolean) => void;
  setMeasureMode: (on: boolean) => void;
  setEditorMode: (on: boolean) => void;
  setFloatingPanelPos: (pos: { x: number; y: number }) => void;
}

export const useMapStore = create<MapState>((set) => ({
  layers: {
    units: true,
    routes: true,
    threats: true,
    airbases: true,
    statics: false,  // hidden by default — declutter
    triggerZones: true,
    baseMap: 'dark',
  },
  viewMode: 'all',
  hiddenGroupIds: new Set(),
  adminMode: false,
  speedMode: 'gs' as SpeedMode,
  addWaypointMode: false,
  measureMode: false,
  editorMode: false,
  floatingPanelPos: { x: -1, y: -1 }, // -1 = use default

  toggleLayer: (id) =>
    set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleGroupVisibility: (groupId) =>
    set((s) => {
      const next = new Set(s.hiddenGroupIds);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return { hiddenGroupIds: next };
    }),

  setAdminMode: (on) => set({ adminMode: on }),
  setSpeedMode: (mode) => set({ speedMode: mode }),
  setAddWaypointMode: (on) => set({ addWaypointMode: on, measureMode: false }),
  setMeasureMode: (on) => set({ measureMode: on, addWaypointMode: false }),
  setEditorMode: (on) => set({ editorMode: on }),
  setFloatingPanelPos: (pos) => set({ floatingPanelPos: pos }),
}));
