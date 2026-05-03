/**
 * editStore — actions unit test.
 *
 * First frontend test in the repo. Establishes the Vitest pattern
 * (per Phase 3 of the standing safety-net plan: "build a frontend
 * test foundation"). Future tests follow the same shape:
 *   - reset store state at start
 *   - exercise actions directly via getState()
 *   - assert via getState() snapshots
 *
 * No DOM, no React rendering — these are pure-logic action tests.
 * The bigger payoff (component / interaction tests via @testing-
 * library) is the next layer, deliberately deferred until we have
 * a few of these in place to confirm the harness works.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useEditStore } from './editStore';
import type { UnitEdit, WaypointEdit } from '../types/mission';

describe('editStore', () => {
  beforeEach(() => {
    // Reset the queue and dirty flag before each test. We can't reset
    // the whole store (kneeboardSettings has computed defaults the
    // tests shouldn't touch) — only the fields the actions own.
    useEditStore.setState({ edits: [], isDirty: false });
  });

  describe('addEdit', () => {
    it('appends an edit and marks the store dirty', () => {
      const edit: UnitEdit = { unitId: 1, field: 'skill', value: 'Excellent' };
      useEditStore.getState().addEdit(edit);
      const state = useEditStore.getState();
      expect(state.edits).toHaveLength(1);
      expect(state.edits[0]).toEqual(edit);
      expect(state.isDirty).toBe(true);
    });

    it('preserves order across multiple additions', () => {
      const a: UnitEdit = { unitId: 1, field: 'skill', value: 'Excellent' };
      const b: UnitEdit = { unitId: 2, field: 'livery', value: 'Aggressor' };
      const c: WaypointEdit = { type: 'waypointMove', groupId: 7, wpIndex: 2, x: 1, y: 2 };
      const { addEdit } = useEditStore.getState();
      addEdit(a);
      addEdit(b);
      addEdit(c);
      expect(useEditStore.getState().edits).toEqual([a, b, c]);
    });
  });

  describe('removeEditAt', () => {
    it('removes the edit at the given index', () => {
      const a: UnitEdit = { unitId: 1, field: 'skill', value: 'A' };
      const b: UnitEdit = { unitId: 2, field: 'skill', value: 'B' };
      const c: UnitEdit = { unitId: 3, field: 'skill', value: 'C' };
      const { addEdit, removeEditAt } = useEditStore.getState();
      addEdit(a); addEdit(b); addEdit(c);

      removeEditAt(1);  // drop the middle one

      expect(useEditStore.getState().edits).toEqual([a, c]);
    });

    it('clears isDirty when the queue is emptied by the last removal', () => {
      const e: UnitEdit = { unitId: 1, field: 'skill', value: 'X' };
      const { addEdit, removeEditAt } = useEditStore.getState();
      addEdit(e);
      expect(useEditStore.getState().isDirty).toBe(true);

      removeEditAt(0);

      const state = useEditStore.getState();
      expect(state.edits).toHaveLength(0);
      expect(state.isDirty).toBe(false);
    });

    it('keeps isDirty true when there are still edits left', () => {
      const a: UnitEdit = { unitId: 1, field: 'skill', value: 'A' };
      const b: UnitEdit = { unitId: 2, field: 'skill', value: 'B' };
      const { addEdit, removeEditAt } = useEditStore.getState();
      addEdit(a); addEdit(b);

      removeEditAt(0);

      const state = useEditStore.getState();
      expect(state.edits).toHaveLength(1);
      expect(state.isDirty).toBe(true);
    });

    it('is a no-op for an out-of-range index', () => {
      const a: UnitEdit = { unitId: 1, field: 'skill', value: 'A' };
      useEditStore.getState().addEdit(a);
      const before = [...useEditStore.getState().edits];

      useEditStore.getState().removeEditAt(99);
      useEditStore.getState().removeEditAt(-1);

      expect(useEditStore.getState().edits).toEqual(before);
    });
  });

  describe('clearEdits', () => {
    it('empties the queue and resets isDirty', () => {
      const a: UnitEdit = { unitId: 1, field: 'skill', value: 'A' };
      const b: UnitEdit = { unitId: 2, field: 'skill', value: 'B' };
      const { addEdit, clearEdits } = useEditStore.getState();
      addEdit(a); addEdit(b);

      clearEdits();

      const state = useEditStore.getState();
      expect(state.edits).toHaveLength(0);
      expect(state.isDirty).toBe(false);
    });
  });

  describe('setKneeboardSettings', () => {
    it('merges partial updates without dropping unrelated fields', () => {
      const before = useEditStore.getState().kneeboardSettings;
      useEditStore.getState().setKneeboardSettings({ coordFormat: 'latlon' });
      const after = useEditStore.getState().kneeboardSettings;
      expect(after.coordFormat).toBe('latlon');
      // The cards / speedRef / machThreshold shouldn't have moved.
      expect(after.cards).toEqual(before.cards);
      expect(after.speedRef).toBe(before.speedRef);
      expect(after.machThreshold).toBe(before.machThreshold);
    });
  });
});
