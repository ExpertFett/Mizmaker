/**
 * Session resume point — so a refresh or crash does not eat the mission.
 *
 * The backend keeps every uploaded session alive for two hours (and through
 * deploys, via Supabase), and the queued-edit list already persists per
 * session in localStorage. What was missing was the key to all of it: the
 * frontend held sessionId only in memory, so one F5 forgot it and dumped the
 * user back on the upload screen with their session still sitting on the
 * server, unreachable. A tester lost work exactly this way.
 *
 * This stores the minimum needed to walk back in — session id, the token the
 * /join endpoint already accepts, and the filename to show on the resume
 * banner. Rehydration itself is just the existing invite-join flow pointed at
 * your own session.
 */

const KEY = 'dcsopt.resume.v1';

/** Matches the backend's session TTL. A point older than this is offered
 *  nowhere — the server will have dropped the session anyway. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface ResumePoint {
  sessionId: string;
  /** Host or participant token — whatever /join accepted for this user. */
  token: string;
  filename: string;
  theater: string;
  savedAt: number;
}

export function saveResumePoint(p: Omit<ResumePoint, 'savedAt'>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, savedAt: Date.now() }));
  } catch { /* quota / private mode — best-effort */ }
}

export function getResumePoint(): ResumePoint | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ResumePoint;
    if (!p?.sessionId || !p?.token) return null;
    if (Date.now() - (p.savedAt ?? 0) > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return p;
  } catch { return null; }
}

export function clearResumePoint(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch { /* swallow */ }
}

/** Age as a human line for the banner ("4 min ago"). */
export function resumeAge(p: ResumePoint): string {
  const min = Math.max(0, Math.round((Date.now() - p.savedAt) / 60000));
  if (min < 1) return 'moments ago';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m ago`;
}
