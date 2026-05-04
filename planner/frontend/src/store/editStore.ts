import { create } from 'zustand';
import type { WaypointEdit, UnitEdit } from '../types/mission';

export interface KneeboardCards {
  // Per-flight cards
  lineup: boolean;
  flight: boolean;
  comms: boolean;
  routeDetail: boolean;
  fuelLadder: boolean;
  homePlate: boolean;
  // Shared mission cards
  supportAssets: boolean;
  radioLadder: boolean;
  airbaseRef: boolean;
  bullseyeRef: boolean;
  threatCard: boolean;
  weatherBrief: boolean;
  /** SOP Comms Card — synthesised from the active SOP. Emits a placeholder
   *  if no SOP is active so the checkbox doesn't silently produce nothing. */
  sopComms: boolean;
  /** Mission Goals Card — squadron objective list grouped by side.
   *  Pulls from useGoalsStore. Renders an empty-state placeholder when
   *  the goals list is empty so an enabled checkbox can't silently
   *  produce a blank card. */
  goalsCard: boolean;
  /** DMPI Card — target list with coordinates / elevation / weapon
   *  delivery. Pulls from useDmpiStore. Renders an empty-state
   *  placeholder when the DMPI list is empty. (v0.9.16) */
  dmpiCard: boolean;
}

export interface KneeboardSettings {
  coordFormat: 'mgrs' | 'latlon';
  speedRef: 'auto' | 'cas' | 'tas' | 'gs' | 'mach';
  machThreshold: number;
  cards: KneeboardCards;
  /** Threat card information density. 'full' = current behaviour
   *  (every system named, MGRS, exact rings). 'operational' = rings
   *  + sizes shown but no designations / MGRS. 'realistic' = vague
   *  clustered threat zones, intel-summary inventory. Drives the
   *  ThreatCard's `fidelity` prop. */
  threatFidelity: 'full' | 'operational' | 'realistic';
}

interface EditState {
  edits: (WaypointEdit | UnitEdit)[];
  isDirty: boolean;
  injectKneeboards: boolean;
  kneeboardSettings: KneeboardSettings;
  addEdit: (edit: WaypointEdit | UnitEdit) => void;
  /** Remove a single queued edit by its index. Used by the Edits
   *  preview panel; existing tabs use addEdit/clearEdits and don't
   *  need to know about indices. */
  removeEditAt: (index: number) => void;
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
    threatFidelity: 'full',
    cards: {
      lineup: true, flight: true, comms: true, routeDetail: true, fuelLadder: true, homePlate: true,
      supportAssets: true, radioLadder: true, airbaseRef: true, bullseyeRef: true, threatCard: true, weatherBrief: true,
      sopComms: true, goalsCard: true, dmpiCard: true,
    },
  },

  addEdit: (edit) =>
    set((s) => ({ edits: [...s.edits, edit], isDirty: true })),

  removeEditAt: (index) =>
    set((s) => {
      if (index < 0 || index >= s.edits.length) return s;
      const next = s.edits.slice(0, index).concat(s.edits.slice(index + 1));
      return { edits: next, isDirty: next.length > 0 };
    }),

  clearEdits: () => set({ edits: [], isDirty: false }),

  setInjectKneeboards: (v) => set({ injectKneeboards: v }),

  setKneeboardSettings: (s) =>
    set((prev) => ({ kneeboardSettings: { ...prev.kneeboardSettings, ...s } })),
}));
