/**
 * Tests for plannerMode helpers — most importantly that loadInitialMode
 * no longer drops the user back into Live when the previous session
 * happened to end there. (v1.19.46 bug Fett caught pre-ship: a stale
 * 'live' in localStorage meant a fresh mission upload landed straight
 * on the Live placeholder instead of the Editor.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadInitialMode } from './plannerMode';

const KEY = 'dcsopt.appMode.v1';

// Inline shim — vitest's default env is node (no localStorage). Avoids
// a jsdom/happy-dom dep just to test a 5-line function.
const _store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (_store.has(k) ? _store.get(k)! : null),
  setItem: (k: string, v: string) => { _store.set(k, v); },
  removeItem: (k: string) => { _store.delete(k); },
  clear: () => { _store.clear(); },
};

describe('loadInitialMode', () => {
  beforeEach(() => {
    _store.clear();
  });

  it('returns "editing" when nothing is persisted', () => {
    expect(loadInitialMode()).toBe('editing');
  });

  it('persists "editing"', () => {
    localStorage.setItem(KEY, 'editing');
    expect(loadInitialMode()).toBe('editing');
  });

  it('persists "planning"', () => {
    localStorage.setItem(KEY, 'planning');
    expect(loadInitialMode()).toBe('planning');
  });

  it('does NOT persist "live" — falls through to editing', () => {
    // The fix: live is per-session intent, not a sticky default.
    localStorage.setItem(KEY, 'live');
    expect(loadInitialMode()).toBe('editing');
  });

  it('falls through to editing on garbage persisted values', () => {
    localStorage.setItem(KEY, 'completely-bogus-value');
    expect(loadInitialMode()).toBe('editing');
  });
});
