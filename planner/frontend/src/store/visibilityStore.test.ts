/**
 * visibilityStore — per-group intel-control filter tests.
 *
 * Mirrors the dmpiStore / goalsStore test patterns. Covers the
 * five actions plus the boundary cases (toggle off-existing,
 * hide-already-hidden, show-not-hidden, setAll replaces, clearAll
 * empties).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useVisibilityStore } from './visibilityStore';

describe('visibilityStore', () => {
  beforeEach(() => {
    useVisibilityStore.setState({ hiddenForParticipants: new Set() });
  });

  describe('toggle', () => {
    it('adds a group to the set when not present', () => {
      useVisibilityStore.getState().toggle(42);
      expect(useVisibilityStore.getState().hiddenForParticipants.has(42)).toBe(true);
    });

    it('removes a group from the set when present', () => {
      useVisibilityStore.getState().toggle(42);
      useVisibilityStore.getState().toggle(42);
      expect(useVisibilityStore.getState().hiddenForParticipants.has(42)).toBe(false);
    });

    it('handles multiple groups independently', () => {
      useVisibilityStore.getState().toggle(1);
      useVisibilityStore.getState().toggle(2);
      useVisibilityStore.getState().toggle(3);
      const s = useVisibilityStore.getState().hiddenForParticipants;
      expect(s.size).toBe(3);
      useVisibilityStore.getState().toggle(2);
      expect(useVisibilityStore.getState().hiddenForParticipants.has(2)).toBe(false);
      expect(useVisibilityStore.getState().hiddenForParticipants.size).toBe(2);
    });
  });

  describe('hide / show', () => {
    it('hide is idempotent', () => {
      useVisibilityStore.getState().hide(7);
      useVisibilityStore.getState().hide(7);
      const s = useVisibilityStore.getState().hiddenForParticipants;
      expect(s.size).toBe(1);
      expect(s.has(7)).toBe(true);
    });

    it('show removes only the targeted group', () => {
      useVisibilityStore.getState().hide(7);
      useVisibilityStore.getState().hide(8);
      useVisibilityStore.getState().show(7);
      const s = useVisibilityStore.getState().hiddenForParticipants;
      expect(s.has(7)).toBe(false);
      expect(s.has(8)).toBe(true);
    });

    it('show on a not-hidden group is a no-op', () => {
      useVisibilityStore.getState().hide(7);
      useVisibilityStore.getState().show(99);
      expect(useVisibilityStore.getState().hiddenForParticipants.has(7)).toBe(true);
      expect(useVisibilityStore.getState().hiddenForParticipants.size).toBe(1);
    });
  });

  describe('setAll', () => {
    it('replaces the set with the provided IDs', () => {
      useVisibilityStore.getState().hide(1);
      useVisibilityStore.getState().setAll([10, 20, 30]);
      const s = useVisibilityStore.getState().hiddenForParticipants;
      expect(s.has(1)).toBe(false);
      expect(s.has(10)).toBe(true);
      expect(s.has(20)).toBe(true);
      expect(s.has(30)).toBe(true);
      expect(s.size).toBe(3);
    });

    it('accepts empty array (mission has no hidden groups)', () => {
      useVisibilityStore.getState().hide(1);
      useVisibilityStore.getState().setAll([]);
      expect(useVisibilityStore.getState().hiddenForParticipants.size).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('empties the set', () => {
      useVisibilityStore.getState().hide(1);
      useVisibilityStore.getState().hide(2);
      useVisibilityStore.getState().clearAll();
      expect(useVisibilityStore.getState().hiddenForParticipants.size).toBe(0);
    });
  });
});
