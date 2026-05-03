import { create } from 'zustand';
import type { TriggerRule, FlagInfo, AudioFile } from '../types/mission';

interface TriggerState {
  rules: TriggerRule[];
  flags: FlagInfo[];
  audioFiles: AudioFile[];
  loaded: boolean;
  isDirty: boolean;
  selectedRuleId: number | null;

  loadTriggers: (rules: TriggerRule[], flags: FlagInfo[], audioFiles: AudioFile[]) => void;
  addRule: () => void;
  updateRule: (id: number, updates: Partial<TriggerRule>) => void;
  deleteRule: (id: number) => void;
  duplicateRule: (id: number) => void;
  moveRule: (id: number, direction: 'up' | 'down') => void;
  selectRule: (id: number | null) => void;
  setAudioFiles: (files: AudioFile[]) => void;
  addAudioFile: (file: AudioFile) => void;
  removeAudioFile: (path: string) => void;
  markClean: () => void;
  /** Apply server-confirmed rules after a save round-trip. AtisConfigTab
   *  + CarrierSetupPanel call this once /api/triggers responds; we
   *  replace rules, highlight the just-saved rule, and mark the store
   *  clean. Doesn't touch flags or audioFiles (callers assume those
   *  are unaffected by the kind of edits these tabs make). */
  replaceRulesAfterSave: (rules: TriggerRule[], selectedRuleId: number | null) => void;
  clear: () => void;
}

export const useTriggerStore = create<TriggerState>((set, get) => ({
  rules: [],
  flags: [],
  audioFiles: [],
  loaded: false,
  isDirty: false,
  selectedRuleId: null,

  loadTriggers: (rules, flags, audioFiles) =>
    set({ rules, flags, audioFiles, loaded: true, isDirty: false, selectedRuleId: null }),

  addRule: () => {
    const { rules } = get();
    const maxId = rules.reduce((max, r) => Math.max(max, r.id), 0);
    const newRule: TriggerRule = {
      id: maxId + 1,
      name: `New Trigger ${maxId + 1}`,
      enabled: true,
      oneTime: true,
      eventType: 'once',
      conditions: [],
      actions: [],
    };
    set({ rules: [...rules, newRule], selectedRuleId: newRule.id, isDirty: true });
  },

  updateRule: (id, updates) => {
    const { rules } = get();
    set({
      rules: rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      isDirty: true,
      flags: recomputeFlags(rules.map((r) => (r.id === id ? { ...r, ...updates } : r))),
    });
  },

  deleteRule: (id) => {
    const { rules, selectedRuleId } = get();
    const newRules = rules.filter((r) => r.id !== id);
    set({
      rules: newRules,
      selectedRuleId: selectedRuleId === id ? null : selectedRuleId,
      isDirty: true,
      flags: recomputeFlags(newRules),
    });
  },

  duplicateRule: (id) => {
    const { rules } = get();
    const source = rules.find((r) => r.id === id);
    if (!source) return;
    const maxId = rules.reduce((max, r) => Math.max(max, r.id), 0);
    const newRule: TriggerRule = {
      ...structuredClone(source),
      id: maxId + 1,
      name: `${source.name} (copy)`,
    };
    set({ rules: [...rules, newRule], selectedRuleId: newRule.id, isDirty: true });
  },

  moveRule: (id, direction) => {
    const { rules } = get();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= rules.length) return;
    const next = [...rules];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    set({ rules: next, isDirty: true });
  },

  selectRule: (id) => set({ selectedRuleId: id }),

  setAudioFiles: (files) => set({ audioFiles: files }),

  addAudioFile: (file) =>
    set((s) => ({ audioFiles: [...s.audioFiles, file] })),

  removeAudioFile: (path) =>
    set((s) => ({ audioFiles: s.audioFiles.filter((f) => f.path !== path) })),

  markClean: () => set({ isDirty: false }),

  replaceRulesAfterSave: (rules, selectedRuleId) =>
    set({ rules, selectedRuleId, isDirty: false, loaded: true }),

  clear: () =>
    set({
      rules: [], flags: [], audioFiles: [],
      loaded: false, isDirty: false, selectedRuleId: null,
    }),
}));


function recomputeFlags(rules: TriggerRule[]): FlagInfo[] {
  const flagMap: Record<string, { setBy: string[]; readBy: string[] }> = {};

  for (const rule of rules) {
    for (const cond of rule.conditions) {
      const f = cond.params?.flag as string | undefined;
      if (f != null) {
        if (!flagMap[f]) flagMap[f] = { setBy: [], readBy: [] };
        if (!flagMap[f].readBy.includes(rule.name)) flagMap[f].readBy.push(rule.name);
      }
      const f2 = cond.params?.flag2 as string | undefined;
      if (f2 != null) {
        if (!flagMap[f2]) flagMap[f2] = { setBy: [], readBy: [] };
        if (!flagMap[f2].readBy.includes(rule.name)) flagMap[f2].readBy.push(rule.name);
      }
    }
    for (const act of rule.actions) {
      const f = act.params?.flag as string | undefined;
      if (f != null) {
        if (!flagMap[f]) flagMap[f] = { setBy: [], readBy: [] };
        if (!flagMap[f].setBy.includes(rule.name)) flagMap[f].setBy.push(rule.name);
      }
    }
  }

  return Object.entries(flagMap)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([flagId, info]) => ({ flagId, ...info }));
}
