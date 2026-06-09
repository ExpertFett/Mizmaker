/**
 * SOP library store — persists saved SOPs to localStorage so they survive
 * page reloads. One SOP can be "active" at a time; auto-assigns consult it
 * when present.
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import type { SOP } from './types';

const STORAGE_KEY = 'mizresearch.sops.v1';
const ACTIVE_KEY = 'mizresearch.activeSop.v1';

function loadFromStorage(): { sops: SOP[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const sops: SOP[] = raw ? JSON.parse(raw) : [];
    const activeId = localStorage.getItem(ACTIVE_KEY);
    return {
      sops: Array.isArray(sops) ? sops : [],
      activeId: activeId && sops.some((s) => s.id === activeId) ? activeId : null,
    };
  } catch {
    return { sops: [], activeId: null };
  }
}

function saveSops(sops: SOP[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sops));
  } catch (err) {
    console.error('SOP save failed (localStorage full?):', err);
  }
}

function saveActive(id: string | null) {
  try {
    if (id == null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

interface SopState {
  sops: SOP[];
  activeId: string | null;

  /** Convenience — the currently-active SOP object, or null. */
  getActive: () => SOP | null;

  /** Add a new SOP to the library. Returns the stored SOP. */
  addSop: (sop: SOP) => SOP;
  /** Replace an existing SOP (matched by id). */
  updateSop: (sop: SOP) => void;
  /** Remove from library. Clears active if it was active. */
  deleteSop: (id: string) => void;
  /** Set the active SOP. Pass null to deactivate. */
  setActive: (id: string | null) => void;
  /** Replace the entire library (used for bulk import). */
  replaceAll: (sops: SOP[]) => void;
  /** Wipe every SOP from localStorage. Useful for a "clear browser
   *  state" button in the SOP UI when users want to start fresh
   *  (e.g. after testing with a proprietary kneeboard image). */
  clearAll: () => void;
}

const initial = loadFromStorage();

export const useSopStore = create<SopState>((set, get) => ({
  sops: initial.sops,
  activeId: initial.activeId,

  getActive: () => {
    const { sops, activeId } = get();
    return activeId ? sops.find((s) => s.id === activeId) || null : null;
  },

  addSop: (sop) => {
    set((s) => {
      const next = [...s.sops, sop];
      saveSops(next);
      return { sops: next };
    });
    return sop;
  },

  updateSop: (sop) => {
    set((s) => {
      const next = s.sops.map((x) => (x.id === sop.id ? { ...sop, updatedAt: Date.now() } : x));
      saveSops(next);
      return { sops: next };
    });
  },

  deleteSop: (id) => {
    set((s) => {
      const next = s.sops.filter((x) => x.id !== id);
      saveSops(next);
      const activeId = s.activeId === id ? null : s.activeId;
      saveActive(activeId);
      return { sops: next, activeId };
    });
  },

  setActive: (id) => {
    saveActive(id);
    set({ activeId: id });
  },

  replaceAll: (sops) => {
    saveSops(sops);
    set({ sops });
  },

  clearAll: () => {
    saveSops([]);
    saveActive(null);
    set({ sops: [], activeId: null });
  },
}));

/**
 * v1.19.69 — shared selector for the active SOP. Replaces 5 duplicate
 * call sites that all did:
 *
 *   useSopStore((s) => s.activeId ? s.sops.find((x) => x.id === s.activeId) || null : null)
 *
 * Two reasons to consolidate:
 *
 * 1. The inline ternary + `|| null` chain returns DIFFERENT references
 *    on `undefined` vs `null` outcomes, which can trip React 18's
 *    useSyncExternalStore "getSnapshot should be cached to avoid an
 *    infinite loop" warning under StrictMode. Splitting into separate
 *    scalar/array reads + a useMemo gives a stable identity guarantee.
 *
 * 2. Single place to add cached lookup-by-id later if perf matters.
 */
export function useActiveSop(): SOP | null {
  const sops = useSopStore((s) => s.sops);
  const activeId = useSopStore((s) => s.activeId);
  return useMemo(
    () => (activeId ? (sops.find((s) => s.id === activeId) ?? null) : null),
    [sops, activeId],
  );
}
