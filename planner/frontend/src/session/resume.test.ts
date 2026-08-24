import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { saveResumePoint, getResumePoint, clearResumePoint } from './resume';

// The suite runs in a node environment with no localStorage; the module
// guards on `typeof localStorage`, so give it a Map-backed one.
const backing = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => { backing.set(k, String(v)); },
  removeItem: (k: string) => { backing.delete(k); },
  clear: () => backing.clear(),
  get length() { return backing.size; },
  key: (i: number) => [...backing.keys()][i] ?? null,
};

const POINT = {
  sessionId: 'abc-123',
  token: 'tok-456',
  filename: 'Mission 3.miz',
  theater: 'Kola',
};

describe('resume point', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it('round-trips a saved point', () => {
    saveResumePoint(POINT);
    const p = getResumePoint();
    expect(p).toMatchObject(POINT);
    expect(p!.savedAt).toBeGreaterThan(0);
  });

  it('is empty when nothing was saved', () => {
    expect(getResumePoint()).toBeNull();
  });

  it('clears on demand', () => {
    saveResumePoint(POINT);
    clearResumePoint();
    expect(getResumePoint()).toBeNull();
  });

  it('expires with the server TTL — a two-hour-old point is not offered', () => {
    // The backend drops sessions after two hours; offering an older point
    // would put the user one click from a guaranteed "expired" message.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T10:00:00Z'));
    saveResumePoint(POINT);
    vi.setSystemTime(new Date('2026-08-23T12:01:00Z'));
    expect(getResumePoint()).toBeNull();
    // And the stale blob is gone, not lingering for the next load.
    expect(localStorage.getItem('dcsopt.resume.v1')).toBeNull();
  });

  it('survives just under the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T10:00:00Z'));
    saveResumePoint(POINT);
    vi.setSystemTime(new Date('2026-08-23T11:55:00Z'));
    expect(getResumePoint()).not.toBeNull();
  });

  it('treats corrupt storage as absent rather than throwing', () => {
    localStorage.setItem('dcsopt.resume.v1', '{not json');
    expect(getResumePoint()).toBeNull();
  });

  it('rejects a point missing its token — nothing to join with', () => {
    localStorage.setItem('dcsopt.resume.v1', JSON.stringify({
      sessionId: 'abc', filename: 'x.miz', savedAt: Date.now(),
    }));
    expect(getResumePoint()).toBeNull();
  });

  it('a new save overwrites the old point', () => {
    saveResumePoint(POINT);
    saveResumePoint({ ...POINT, sessionId: 'newer-999', filename: 'Mission 4.miz' });
    expect(getResumePoint()!.sessionId).toBe('newer-999');
  });
});
