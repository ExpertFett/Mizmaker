import { create } from 'zustand';
import type { PlannerDrawing } from '../types/mission';

interface DrawingState {
  drawings: PlannerDrawing[];
  selectedDrawingId: string | null;
  isDirty: boolean;

  selectDrawing: (id: string | null) => void;
  updateDrawing: (id: string, updates: Partial<PlannerDrawing>) => void;
  deleteDrawing: (id: string) => void;
  toggleVisibility: (id: string) => void;
  loadDrawings: (drawings: PlannerDrawing[]) => void;
  markClean: () => void;
}

export const useDrawingStore = create<DrawingState>((set) => ({
  drawings: [],
  selectedDrawingId: null,
  isDirty: false,

  selectDrawing: (id) => set({ selectedDrawingId: id }),

  updateDrawing: (id, updates) =>
    set((s) => ({
      drawings: s.drawings.map((d) => (d.id === id ? { ...d, ...updates } : d)),
      isDirty: true,
    })),

  deleteDrawing: (id) =>
    set((s) => ({
      drawings: s.drawings.filter((d) => d.id !== id),
      selectedDrawingId: s.selectedDrawingId === id ? null : s.selectedDrawingId,
      isDirty: true,
    })),

  toggleVisibility: (id) =>
    set((s) => ({
      drawings: s.drawings.map((d) => (d.id === id ? { ...d, visible: !d.visible } : d)),
      isDirty: true,
    })),

  loadDrawings: (drawings) => set({ drawings, isDirty: false }),

  markClean: () => set({ isDirty: false }),
}));
