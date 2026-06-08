/**
 * Tests for the framework-trigger auto-wire helper (v1.19.54).
 *
 * AEGIS / TIC apply now auto-add their script load triggers, so the user
 * doesn't have to bounce over to the Triggers tab and hand-wire MOOSE
 * + AEGIS / MOOSE + MIST + TIC by hand. These tests lock down:
 *   - The right bundledFile names go in (so we don't silently mis-wire).
 *   - Re-apply is idempotent (the headline complaint from the tester
 *     review of the original carriers-auto-trigger flow was that
 *     re-applying piled up duplicates).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { addFrameworkTriggers, AEGIS_BUNDLE, TIC_BUNDLE } from './frameworkTriggers';
import { useTriggerStore } from '../../store/triggerStore';

beforeEach(() => {
  // Reset trigger store between tests so rule counts start clean.
  useTriggerStore.setState({
    rules: [],
    flags: [],
    audioFiles: [],
    selectedRuleId: null,
    dmHints: {},
  } as never);
});

describe('AEGIS_BUNDLE + TIC_BUNDLE constants', () => {
  it('AEGIS_BUNDLE has MOOSE + the vetted v0.8.4 IADS file (NOT a beta variant)', () => {
    const files = AEGIS_BUNDLE.map((s) => s.bundledFile);
    expect(files).toContain('Moose_.lua');
    expect(files).toContain('aegis-iads-v0.8.4-beta.lua');
    // Make sure we don't auto-wire the UNTESTED dynamic / networked
    // variants — opt-in only via the Triggers tab.
    expect(files).not.toContain('aegis-iads-v0.9.0-beta-dynamic.lua');
    expect(files).not.toContain('aegis-iads-v0.9.1-beta-networked.lua');
  });

  it('TIC_BUNDLE has MOOSE + MIST + TIC_v1.1', () => {
    const files = TIC_BUNDLE.map((s) => s.bundledFile);
    expect(files).toContain('Moose_.lua');
    expect(files).toContain('mist.lua');
    expect(files).toContain('TIC_v1.1.lua');
  });
});

describe('addFrameworkTriggers', () => {
  it('appends one rule per script on a clean store', () => {
    const added = addFrameworkTriggers(AEGIS_BUNDLE);
    expect(added).toEqual(['MOOSE Framework', 'AEGIS IADS']);
    const rules = useTriggerStore.getState().rules;
    expect(rules).toHaveLength(2);
  });

  it('idempotent — re-applying the same bundle adds nothing', () => {
    addFrameworkTriggers(AEGIS_BUNDLE);
    expect(useTriggerStore.getState().rules).toHaveLength(2);
    const added = addFrameworkTriggers(AEGIS_BUNDLE);
    expect(added).toEqual([]);
    expect(useTriggerStore.getState().rules).toHaveLength(2);
  });

  it('partial overlap only adds the missing scripts (idempotent merge)', () => {
    // Pre-seed with just MOOSE.
    addFrameworkTriggers([{ name: 'MOOSE Framework', bundledFile: 'Moose_.lua' }]);
    expect(useTriggerStore.getState().rules).toHaveLength(1);
    // Now ask for the AEGIS bundle (MOOSE + AEGIS). Only AEGIS is new.
    const added = addFrameworkTriggers(AEGIS_BUNDLE);
    expect(added).toEqual(['AEGIS IADS']);
    expect(useTriggerStore.getState().rules).toHaveLength(2);
  });

  it('each rule is mission-start, enabled, no conditions', () => {
    addFrameworkTriggers(AEGIS_BUNDLE);
    const rules = useTriggerStore.getState().rules;
    for (const r of rules) {
      expect(r.eventType).toBe('onMissionStart');
      expect(r.enabled).toBe(true);
      expect(r.conditions).toEqual([]);
    }
  });

  it('rules carry DO_SCRIPT_FILE action with the right file param', () => {
    addFrameworkTriggers(AEGIS_BUNDLE);
    const rules = useTriggerStore.getState().rules;
    const files = rules.map((r) => (r.actions[0] as never as { params: { file: string } }).params.file);
    expect(files).toEqual(['Moose_.lua', 'aegis-iads-v0.8.4-beta.lua']);
  });

  it('rule name is prefixed "Script: " for visual grouping in the panel', () => {
    addFrameworkTriggers(AEGIS_BUNDLE);
    const names = useTriggerStore.getState().rules.map((r) => r.name);
    expect(names).toEqual(['Script: MOOSE Framework', 'Script: AEGIS IADS']);
  });
});
