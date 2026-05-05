/**
 * Visibility store — mission-maker-controlled per-group intel filter.
 *
 * The use case: the mission maker has 3 units on the battlefield.
 * They want flight leads who join the planning session to see ONE
 * (the briefed target) and NOT the other two (the surprise SAM
 * that pops up at the IP, the trap convoy, etc.). Without this,
 * flight leads can pre-plan their evasion against threats they
 * shouldn't know about until game time.
 *
 * Architecture:
 *   - The mission maker has the role 'mission_maker' (default for
 *     uploaders) and ALWAYS sees every group, regardless of this
 *     store's contents. They use the Visibility tab to flag
 *     groups they want hidden.
 *   - Joined participants have role 'flight_lead'. The map render
 *     layer filters out groups whose ID is in this set.
 *
 * Persistence: session-only in v0.9.25 — re-uploading a planner
 * .miz won't preserve the hidden list yet. v0.9.26 adds the
 * `["plannerHiddenGroups"]` writer + parser (mirrors the v0.9.15
 * plannerDmpis pattern).
 *
 * Why a separate store from `mapStore.hiddenGroupIds`:
 *   - mapStore.hiddenGroupIds is local view-state — the user
 *     temporarily hides groups for their own clutter management.
 *     Doesn't affect what other participants see.
 *   - This store is mission-maker authored and applies only to
 *     other participants. Two distinct concepts, kept separate
 *     so a local hide doesn't accidentally affect the broadcast
 *     intel picture.
 */

import { create } from 'zustand';

interface VisibilityState {
  /** Group IDs the mission maker has marked hidden from flight
   *  leads. Mission makers themselves still see these groups —
   *  the filter only fires on the flight-lead-side render. */
  hiddenForParticipants: Set<number>;

  /** Toggle one group's visibility flag. */
  toggle: (groupId: number) => void;
  /** Hide a specific group (idempotent). */
  hide: (groupId: number) => void;
  /** Show a specific group (remove from the hidden set). */
  show: (groupId: number) => void;
  /** Bulk replace — used by the upload path in v0.9.26 to seed
   *  from a parsed .miz, and by "Hide all / Show all" buttons in
   *  the Visibility tab. */
  setAll: (ids: number[]) => void;
  /** Clear the hidden set entirely (everyone sees everything). */
  clearAll: () => void;
}

export const useVisibilityStore = create<VisibilityState>((set) => ({
  hiddenForParticipants: new Set(),

  toggle: (groupId) =>
    set((s) => {
      const next = new Set(s.hiddenForParticipants);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return { hiddenForParticipants: next };
    }),

  hide: (groupId) =>
    set((s) => {
      if (s.hiddenForParticipants.has(groupId)) return s;
      const next = new Set(s.hiddenForParticipants);
      next.add(groupId);
      return { hiddenForParticipants: next };
    }),

  show: (groupId) =>
    set((s) => {
      if (!s.hiddenForParticipants.has(groupId)) return s;
      const next = new Set(s.hiddenForParticipants);
      next.delete(groupId);
      return { hiddenForParticipants: next };
    }),

  setAll: (ids) => set({ hiddenForParticipants: new Set(ids) }),

  clearAll: () => set({ hiddenForParticipants: new Set() }),
}));
