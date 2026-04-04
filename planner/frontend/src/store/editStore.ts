import { create } from 'zustand';
import type { WaypointEdit, UnitEdit } from '../types/mission';

export interface KneeboardCards {
  // Per-flight cards
  lineup: boolean;
  flight: boolean;
  comms: boolean;
  routeDetail: boolean;
  fuelLadder: boolean;
  // Shared mission cards
  supportAssets: boolean;
  radioLadder: boolean;
  airbaseRef: boolean;
  bullseyeRef: boolean;
  weatherBrief: boolean;
}

export interface KneeboardSettings {
  coordFormat: 'mgrs' | 'latlon';
  speedRef: 'auto' | 'cas' | 'tas' | 'gs' | 'mach';
  machThreshold: number;
  cards: KneeboardCards;
}

interface EditState {
  edits: (WaypointEdit | UnitEdit)[];
  isDirty: boolean;
  injectKneeboards: boolean;
  kneeboardSettings: KneeboardSettings;
  addEdit: (edit: WaypointEdit | UnitEdit) => void;
  clearEdits: () => void;
  setInjectKneeboards: (v: boolean) => void;
  setKneeboardSettings: (s: Partial<KneeboardSettings>) => void;
}

export const useEditStore = create<EditState>((set) => ({
  edits: [],
  isDirty: false,
  injectKneeboards: false,
  kneeboardSettings: {
    coordFormat: 'mgrs', speedRef: 'auto', machThreshold: 18000,
    cards: {
      lineup: true, flight: true, comms: true, routeDetail: true, fuelLadder: true,
      supportAssets: true, radioLadder: true, airbaseRef: true, bullseyeRef: true, weatherBrief: true,
    },
  },

  addEdit: (edit) =>
    set((s) => ({ edits: [...s.edits, edit], isDirty: true })),

  clearEdits: () => set({ edits: [], isDirty: false }),

  setInjectKneeboards: (v) => set({ injectKneeboards: v }),

  setKneeboardSettings: (s) =>
    set((prev) => ({ kneeboardSettings: { ...prev.kneeboardSettings, ...s } })),
}));
