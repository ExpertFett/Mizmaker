/**
 * Mission Goals store — squadron-style objective list.
 *
 * Mirrors the "Mission Goals" tab in DCS ME but kept simple for v1:
 * a flat list of text objectives, each tagged blue/red/neutral/all
 * and optionally weighted with a point value. Session-only — goals
 * are NOT written into the .miz's `goals` block today (that's a
 * Phase-2 feature requiring a new backend edit handler + DCS
 * condition predicate machinery, which I scoped out of this release
 * to keep the change reviewable).
 *
 * Where goals show up:
 *   - GoalsTab — full editor.
 *   - BriefGenTab — accessible via {goals.blue}, {goals.red},
 *     {goals.neutral}, {goals.all} template tokens.
 *
 * Where they DON'T show up yet (intentional):
 *   - The .miz file itself (no backend edit dispatch).
 *   - The Briefing tab description (would need a render path).
 *   - Kneeboards (separate card, follow-up).
 */

import { create } from 'zustand';

export type GoalSide = 'blue' | 'red' | 'neutral' | 'all';

export interface MissionGoal {
  id: string;
  text: string;
  side: GoalSide;
  /** Optional numeric weight. Squadrons that score training sorties
   *  use this; teams that don't can leave at 0. */
  points: number;
  /** Free-form notes shown only in the editor — not exported to
   *  briefing tokens. Used for "remember: only if leader survives"
   *  kind of context. */
  notes: string;
}

interface GoalsState {
  goals: MissionGoal[];

  add: () => string;                          // returns the new goal's id
  update: (id: string, patch: Partial<MissionGoal>) => void;
  remove: (id: string) => void;
  /** Move a goal up or down in the list. Used for the order pilots
   *  see goals in the brief — typically primary objective first. */
  move: (id: string, direction: 'up' | 'down') => void;
  clearAll: () => void;
}

function makeId(): string {
  return `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const useGoalsStore = create<GoalsState>((set) => ({
  goals: [],

  add: () => {
    const id = makeId();
    set((s) => ({
      goals: [
        ...s.goals,
        {
          id,
          text: '',
          side: 'blue',
          points: 0,
          notes: '',
        },
      ],
    }));
    return id;
  },

  update: (id, patch) =>
    set((s) => ({
      goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    })),

  remove: (id) =>
    set((s) => ({
      goals: s.goals.filter((g) => g.id !== id),
    })),

  move: (id, direction) =>
    set((s) => {
      const idx = s.goals.findIndex((g) => g.id === id);
      if (idx === -1) return s;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= s.goals.length) return s;
      const next = [...s.goals];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return { goals: next };
    }),

  clearAll: () => set({ goals: [] }),
}));
