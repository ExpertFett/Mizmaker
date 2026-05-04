/**
 * goalsStore — Mission Goals list actions.
 *
 * Mirrors the test pattern from dmpiStore.test.ts. Covers add /
 * update / remove / move + the boundary cases (move at top, move at
 * bottom, update unknown id).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGoalsStore } from './goalsStore';

describe('goalsStore', () => {
  beforeEach(() => {
    useGoalsStore.setState({ goals: [] });
  });

  describe('add / update / remove', () => {
    it('add() returns a fresh id and appends a default-shaped goal', () => {
      const id = useGoalsStore.getState().add();
      const list = useGoalsStore.getState().goals;
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(id);
      expect(list[0].text).toBe('');
      expect(list[0].side).toBe('blue');
      expect(list[0].points).toBe(0);
    });

    it('add() ids are unique across multiple adds', () => {
      const ids = [
        useGoalsStore.getState().add(),
        useGoalsStore.getState().add(),
        useGoalsStore.getState().add(),
      ];
      expect(new Set(ids).size).toBe(3);
    });

    it('update() patches the matching goal', () => {
      const id = useGoalsStore.getState().add();
      useGoalsStore.getState().update(id, { text: 'Destroy SAM site', side: 'red' });
      const g = useGoalsStore.getState().goals[0];
      expect(g.text).toBe('Destroy SAM site');
      expect(g.side).toBe('red');
      expect(g.points).toBe(0);  // untouched
    });

    it('update() unknown id is a no-op', () => {
      useGoalsStore.getState().add();
      const before = useGoalsStore.getState().goals;
      useGoalsStore.getState().update('nonsense', { text: 'X' });
      expect(useGoalsStore.getState().goals).toEqual(before);
    });

    it('remove() drops the matching goal', () => {
      const a = useGoalsStore.getState().add();
      const b = useGoalsStore.getState().add();
      useGoalsStore.getState().remove(a);
      expect(useGoalsStore.getState().goals.map((g) => g.id)).toEqual([b]);
    });
  });

  describe('move', () => {
    it('move up swaps with the previous entry', () => {
      const a = useGoalsStore.getState().add();
      const b = useGoalsStore.getState().add();
      const c = useGoalsStore.getState().add();
      useGoalsStore.getState().move(c, 'up');
      expect(useGoalsStore.getState().goals.map((g) => g.id)).toEqual([a, c, b]);
    });

    it('move down swaps with the next entry', () => {
      const a = useGoalsStore.getState().add();
      const b = useGoalsStore.getState().add();
      const c = useGoalsStore.getState().add();
      useGoalsStore.getState().move(a, 'down');
      expect(useGoalsStore.getState().goals.map((g) => g.id)).toEqual([b, a, c]);
    });

    it('move up at top is a no-op', () => {
      const a = useGoalsStore.getState().add();
      const b = useGoalsStore.getState().add();
      useGoalsStore.getState().move(a, 'up');
      expect(useGoalsStore.getState().goals.map((g) => g.id)).toEqual([a, b]);
    });

    it('move down at bottom is a no-op', () => {
      const a = useGoalsStore.getState().add();
      const b = useGoalsStore.getState().add();
      useGoalsStore.getState().move(b, 'down');
      expect(useGoalsStore.getState().goals.map((g) => g.id)).toEqual([a, b]);
    });
  });

  describe('clearAll', () => {
    it('empties the list', () => {
      useGoalsStore.getState().add();
      useGoalsStore.getState().add();
      useGoalsStore.getState().clearAll();
      expect(useGoalsStore.getState().goals).toEqual([]);
    });
  });

  describe('setAll', () => {
    it('replaces the existing goals with the given list', () => {
      // Stage some local edits the user has been making.
      useGoalsStore.getState().add();
      useGoalsStore.getState().add();
      // Then "upload" arrives — replace, don't merge.
      const seeded = [
        { id: 'imp_1', text: 'From .miz A', side: 'blue' as const, points: 50, notes: '' },
        { id: 'imp_2', text: 'From .miz B', side: 'red' as const, points: 25, notes: '' },
      ];
      useGoalsStore.getState().setAll(seeded);
      const list = useGoalsStore.getState().goals;
      expect(list).toEqual(seeded);
    });

    it('accepts an empty list (mission has no goals)', () => {
      useGoalsStore.getState().add();
      useGoalsStore.getState().setAll([]);
      expect(useGoalsStore.getState().goals).toEqual([]);
    });
  });
});
