/**
 * DMPI store — Designated Mean Points of Impact.
 *
 * Lifted out of DmpiTab's local useState in v0.9.5 so the map can
 * write coordinates back when the user picks on it. Two pieces of
 * state matter:
 *   1. dmpis[] — the list rendered in DmpiTab.
 *   2. pickingForId — when set, the map enters DMPI placement mode:
 *      next click anywhere on the map captures (lat, lon) and writes
 *      them into the named DMPI's row.
 *
 * Session-only — DMPIs are NOT written into the .miz today (per the
 * tab's own docstring). Refactoring to persist them is a separate
 * concern; this store keeps the same scope.
 */

import { create } from 'zustand';

export interface Dmpi {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  description: string;
  weaponDelivery: string;
  notes: string;
}

interface DmpiState {
  dmpis: Dmpi[];
  /** When non-null, the map is armed to capture the next click and
   *  write its coordinates into the named DMPI. UI shows a banner +
   *  crosshair cursor. */
  pickingForId: string | null;

  add: () => string;                          // returns the new DMPI's id
  update: (id: string, patch: Partial<Dmpi>) => void;
  remove: (id: string) => void;

  startPicking: (id: string) => void;
  /** Map calls this on a click while picking. Updates the DMPI's
   *  lat/lon and clears picking mode. */
  finishPicking: (lat: number, lon: number) => void;
  cancelPicking: () => void;
}

function makeId(): string {
  return `dmpi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const useDmpiStore = create<DmpiState>((set, get) => ({
  dmpis: [],
  pickingForId: null,

  add: () => {
    const id = makeId();
    set((s) => ({
      dmpis: [
        ...s.dmpis,
        {
          id,
          name: `DMPI ${s.dmpis.length + 1}`,
          lat: 0,
          lon: 0,
          elevation: 0,
          description: '',
          weaponDelivery: '',
          notes: '',
        },
      ],
    }));
    return id;
  },

  update: (id, patch) =>
    set((s) => ({
      dmpis: s.dmpis.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),

  remove: (id) =>
    set((s) => ({
      dmpis: s.dmpis.filter((d) => d.id !== id),
      // If the removed DMPI was the active pick target, clear the mode.
      pickingForId: s.pickingForId === id ? null : s.pickingForId,
    })),

  startPicking: (id) => set({ pickingForId: id }),

  finishPicking: (lat, lon) => {
    const targetId = get().pickingForId;
    if (!targetId) return;
    set((s) => ({
      dmpis: s.dmpis.map((d) =>
        d.id === targetId ? { ...d, lat, lon } : d,
      ),
      pickingForId: null,
    }));
  },

  cancelPicking: () => set({ pickingForId: null }),
}));
