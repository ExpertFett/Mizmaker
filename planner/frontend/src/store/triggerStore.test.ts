/**
 * triggerStore action tests.
 *
 * The trigger store carries the most state-management complexity in
 * the planner — addRule, updateRule, duplicateRule, moveRule all
 * touch the rules array AND the derived flags map. Worth locking
 * down so AtisConfigTab / CarrierSetupPanel / TriggerTab refactors
 * don't quietly drift the contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useTriggerStore } from './triggerStore';
import type { TriggerRule } from '../types/mission';

function makeRule(over: Partial<TriggerRule> = {}): TriggerRule {
  return {
    id: 1,
    name: 'Test Rule',
    enabled: true,
    oneTime: true,
    eventType: 'once',
    conditions: [],
    actions: [],
    ...over,
  };
}

describe('triggerStore', () => {
  beforeEach(() => {
    useTriggerStore.setState({
      rules: [],
      flags: [],
      audioFiles: [],
      loaded: false,
      isDirty: false,
      selectedRuleId: null,
    });
  });

  describe('loadTriggers', () => {
    it('replaces all the state and marks loaded + clean', () => {
      const r = makeRule();
      useTriggerStore.getState().loadTriggers([r], [], []);
      const s = useTriggerStore.getState();
      expect(s.rules).toEqual([r]);
      expect(s.loaded).toBe(true);
      expect(s.isDirty).toBe(false);
      expect(s.selectedRuleId).toBeNull();
    });
  });

  describe('addRule', () => {
    it('appends a new rule with auto-incremented id, selects it, marks dirty', () => {
      useTriggerStore.getState().loadTriggers([makeRule({ id: 7 })], [], []);
      useTriggerStore.getState().addRule();
      const s = useTriggerStore.getState();
      expect(s.rules).toHaveLength(2);
      expect(s.rules[1].id).toBe(8);
      expect(s.selectedRuleId).toBe(8);
      expect(s.isDirty).toBe(true);
    });

    it('starts ids at 1 when there are no rules yet', () => {
      useTriggerStore.getState().addRule();
      expect(useTriggerStore.getState().rules[0].id).toBe(1);
    });
  });

  describe('updateRule', () => {
    it('merges partial updates into the matching rule', () => {
      useTriggerStore.getState().loadTriggers(
        [makeRule({ id: 1, name: 'Old' })], [], [],
      );
      useTriggerStore.getState().updateRule(1, { name: 'New', enabled: false });
      const r = useTriggerStore.getState().rules[0];
      expect(r.name).toBe('New');
      expect(r.enabled).toBe(false);
      expect(r.oneTime).toBe(true);  // untouched
    });

    it('marks dirty', () => {
      useTriggerStore.getState().loadTriggers([makeRule()], [], []);
      useTriggerStore.getState().updateRule(1, { name: 'X' });
      expect(useTriggerStore.getState().isDirty).toBe(true);
    });

    it('is a no-op for unknown id', () => {
      useTriggerStore.getState().loadTriggers([makeRule()], [], []);
      useTriggerStore.getState().updateRule(999, { name: 'X' });
      expect(useTriggerStore.getState().rules[0].name).toBe('Test Rule');
    });
  });

  describe('deleteRule', () => {
    it('removes the rule and clears selection if it was selected', () => {
      useTriggerStore.getState().loadTriggers(
        [makeRule({ id: 1 }), makeRule({ id: 2 })], [], [],
      );
      useTriggerStore.setState({ selectedRuleId: 2 });
      useTriggerStore.getState().deleteRule(2);
      const s = useTriggerStore.getState();
      expect(s.rules.map((r) => r.id)).toEqual([1]);
      expect(s.selectedRuleId).toBeNull();
      expect(s.isDirty).toBe(true);
    });

    it('keeps selection when a different rule is deleted', () => {
      useTriggerStore.getState().loadTriggers(
        [makeRule({ id: 1 }), makeRule({ id: 2 })], [], [],
      );
      useTriggerStore.setState({ selectedRuleId: 2 });
      useTriggerStore.getState().deleteRule(1);
      expect(useTriggerStore.getState().selectedRuleId).toBe(2);
    });
  });

  describe('duplicateRule', () => {
    it('creates a copy with new id and selects it', () => {
      useTriggerStore.getState().loadTriggers(
        [makeRule({ id: 1, name: 'Source' })], [], [],
      );
      useTriggerStore.getState().duplicateRule(1);
      const s = useTriggerStore.getState();
      expect(s.rules).toHaveLength(2);
      expect(s.rules[1].id).toBe(2);
      expect(s.rules[1].name).toBe('Source (copy)');
      expect(s.selectedRuleId).toBe(2);
    });

    it('is a no-op for unknown id', () => {
      useTriggerStore.getState().loadTriggers([makeRule()], [], []);
      useTriggerStore.getState().duplicateRule(999);
      expect(useTriggerStore.getState().rules).toHaveLength(1);
    });
  });

  describe('moveRule', () => {
    it('moves a rule up by one position', () => {
      useTriggerStore.getState().loadTriggers(
        [makeRule({ id: 1 }), makeRule({ id: 2 }), makeRule({ id: 3 })], [], [],
      );
      useTriggerStore.getState().moveRule(3, 'up');
      expect(useTriggerStore.getState().rules.map((r) => r.id)).toEqual([1, 3, 2]);
    });

    it('moves a rule down by one position', () => {
      useTriggerStore.getState().loadTriggers(
        [makeRule({ id: 1 }), makeRule({ id: 2 }), makeRule({ id: 3 })], [], [],
      );
      useTriggerStore.getState().moveRule(1, 'down');
      expect(useTriggerStore.getState().rules.map((r) => r.id)).toEqual([2, 1, 3]);
    });

    it('is a no-op at the boundaries', () => {
      useTriggerStore.getState().loadTriggers(
        [makeRule({ id: 1 }), makeRule({ id: 2 })], [], [],
      );
      useTriggerStore.getState().moveRule(1, 'up');     // already first
      useTriggerStore.getState().moveRule(2, 'down');   // already last
      expect(useTriggerStore.getState().rules.map((r) => r.id)).toEqual([1, 2]);
    });
  });

  describe('replaceRulesAfterSave', () => {
    it('replaces rules, sets selection, marks clean + loaded', () => {
      useTriggerStore.getState().loadTriggers([makeRule()], [], []);
      useTriggerStore.setState({ isDirty: true });

      const fresh = [makeRule({ id: 5, name: 'Fresh' })];
      useTriggerStore.getState().replaceRulesAfterSave(fresh, 5);

      const s = useTriggerStore.getState();
      expect(s.rules).toEqual(fresh);
      expect(s.selectedRuleId).toBe(5);
      expect(s.isDirty).toBe(false);
      expect(s.loaded).toBe(true);
    });

    it('accepts null for selectedRuleId', () => {
      useTriggerStore.getState().replaceRulesAfterSave([makeRule()], null);
      expect(useTriggerStore.getState().selectedRuleId).toBeNull();
    });
  });

  describe('audioFiles', () => {
    it('addAudioFile / removeAudioFile mutate the list', () => {
      const f1 = { path: 'a.ogg', size: 100, mimeType: 'audio/ogg' } as any;
      const f2 = { path: 'b.ogg', size: 200, mimeType: 'audio/ogg' } as any;
      useTriggerStore.getState().setAudioFiles([f1]);
      useTriggerStore.getState().addAudioFile(f2);
      expect(useTriggerStore.getState().audioFiles).toEqual([f1, f2]);
      useTriggerStore.getState().removeAudioFile('a.ogg');
      expect(useTriggerStore.getState().audioFiles).toEqual([f2]);
    });
  });

  describe('clear', () => {
    it('resets every field to initial values', () => {
      useTriggerStore.getState().loadTriggers([makeRule()], [], []);
      useTriggerStore.setState({ isDirty: true, selectedRuleId: 1 });
      useTriggerStore.getState().clear();
      const s = useTriggerStore.getState();
      expect(s.rules).toEqual([]);
      expect(s.flags).toEqual([]);
      expect(s.audioFiles).toEqual([]);
      expect(s.loaded).toBe(false);
      expect(s.isDirty).toBe(false);
      expect(s.selectedRuleId).toBeNull();
    });
  });
});
