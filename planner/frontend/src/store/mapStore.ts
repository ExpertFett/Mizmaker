import { create } from 'zustand';

export type ViewMode = 'all' | 'blue' | 'red' | 'players';

interface MapState {
  layers: Record<string, any>;
  viewMode: ViewMode;
  addWaypointMode: boolean;
  measureMode: boolean;

  toggleLayer: (id: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setAddWaypointMode: (on: boolean) => void;
  setMeasureMode: (on: boolean) => void;
}

export const useMapStore = create<MapState>((set) => ({
  layers: {
    units: true,
    routes: true,
    threats: true,
    airbases: true,
    baseMap: 'dark',
  },
  viewMode: 'all',
  addWaypointMode: false,
  measureMode: false,

  toggleLayer: (id) =>
    set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),

  setViewMode: (mode) => set({ viewMode: mode }),
  setAddWaypointMode: (on) => set({ addWaypointMode: on, measureMode: false }),
  setMeasureMode: (on) => set({ measureMode: on, addWaypointMode: false }),
}));
