import { create } from 'zustand';
import type { WaypointEdit, UnitEdit } from '../types/mission';

interface EditState {
  edits: (WaypointEdit | UnitEdit)[];
  isDirty: boolean;
  addEdit: (edit: WaypointEdit | UnitEdit) => void;
  clearEdits: () => void;
}

export const useEditStore = create<EditState>((set) => ({
  edits: [],
  isDirty: false,

  addEdit: (edit) =>
    set((s) => ({ edits: [...s.edits, edit], isDirty: true })),

  clearEdits: () => set({ edits: [], isDirty: false }),
}));
