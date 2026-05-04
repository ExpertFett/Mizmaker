/**
 * Mission Goals store — squadron-style objective list.
 *
 * Mirrors the "Mission Goals" tab in DCS ME but kept simple: a flat
 * list of text objectives, each tagged blue/red/neutral/all and
 * optionally weighted with a point value.
 *
 * Where goals show up:
 *   - GoalsTab — full editor.
 *   - BriefGenTab — accessible via {goals.blue}, {goals.red},
 *     {goals.neutral}, {goals.all} template tokens.
 *   - Kneeboard "Mission Goals" card (v0.9.10).
 *   - The .miz file itself, written into the `["goals"]` block on
 *     download via the backend `missionGoals` edit handler (v0.9.13).
 *     Goals land with empty `predicates` + `rules` so DCS shows them
 *     in the briefing/scoring UI without auto-evaluating — squadrons
 *     score training sorties manually, not via DCS condition logic.
 *
 * Not yet:
 *   - Read-back on upload — uploading a .miz with a populated goals
 *     block doesn't seed the store today (the editor starts blank
 *     each session). Adding that requires a parser pass in
 *     `app.py` upload route similar to how briefing fields are
 *     resolved through the dictionary.
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
