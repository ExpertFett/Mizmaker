import { create } from 'zustand';
import type { WaypointEdit } from '../types/mission';

interface EditState {
  edits: WaypointEdit[];
  isDirty: boolean;
  addEdit: (edit: WaypointEdit) => void;
  clearEdits: () => void;
}

export const useEditStore = create<EditState>((set) => ({
  edits: [],
  isDirty: false,

  addEdit: (edit) =>
    set((s) => ({ edits: [...s.edits, edit], isDirty: true })),

  clearEdits: () => set({ edits: [], isDirty: false }),
}));
