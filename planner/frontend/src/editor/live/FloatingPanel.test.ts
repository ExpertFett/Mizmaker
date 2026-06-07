/**
 * Tests for the FloatingPanel persistence + clamp/snap helpers.
 *
 * The clamp/snap function isn't exported (it's a closure inside the
 * component), so we test the observable behaviour: resetAllFloatingPositions
 * + the localStorage shape. Position math is exercised manually in the
 * browser; what we lock down here is the data layer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resetAllFloatingPositions } from './FloatingPanel';

const _store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (_store.has(k) ? _store.get(k)! : null),
  setItem: (k: string, v: string) => { _store.set(k, v); },
  removeItem: (k: string) => { _store.delete(k); },
  clear: () => { _store.clear(); },
  get length() { return _store.size; },
  key: (i: number) => Array.from(_store.keys())[i] ?? null,
};

describe('resetAllFloatingPositions', () => {
  beforeEach(() => { _store.clear(); });

  it('removes every dcsopt.live.floating.* key', () => {
    _store.set('dcsopt.live.floating.srs', '{"x":1,"y":2,"w":3,"h":4}');
    _store.set('dcsopt.live.floating.comms', '{"x":1,"y":2,"w":3,"h":4}');
    _store.set('dcsopt.live.floating.brevity', '{"x":1,"y":2,"w":3,"h":4}');
    resetAllFloatingPositions();
    expect(_store.size).toBe(0);
  });

  it('leaves unrelated keys alone', () => {
    _store.set('dcsopt.live.floating.srs', '{"x":1,"y":2,"w":3,"h":4}');
    _store.set('dcsopt.appMode.v1', 'editing');
    _store.set('dcsopt.live.gciRings', '[]');
    resetAllFloatingPositions();
    expect(_store.get('dcsopt.appMode.v1')).toBe('editing');
    expect(_store.get('dcsopt.live.gciRings')).toBe('[]');
    expect(_store.has('dcsopt.live.floating.srs')).toBe(false);
  });

  it('is a no-op when no floating-panel keys exist', () => {
    _store.set('dcsopt.appMode.v1', 'editing');
    expect(() => resetAllFloatingPositions()).not.toThrow();
    expect(_store.get('dcsopt.appMode.v1')).toBe('editing');
  });

  it('handles localStorage being completely empty', () => {
    expect(() => resetAllFloatingPositions()).not.toThrow();
  });
});
