/**
 * Session activity notifications (v1.19.74) — small toast feed for
 * "someone else changed something" events in a shared session.
 *
 * Fett's ask: "on the planner in a live session make a little
 * notification when a flight makes a change." The SSE events were
 * already arriving and being applied silently — a flight lead watching
 * the map had no idea a wingman just moved a waypoint unless they
 * happened to be staring at the exact spot.
 *
 * Deliberately dumb: an append-only ring of the last few events with
 * timestamps. The SessionToasts component handles TTL fade-out. No
 * persistence — notifications are conversational, not a log. (The AAR
 * event recorder is the audit trail; this is just awareness.)
 */

import { create } from 'zustand';

export interface SessionNotification {
  id: number;
  text: string;
  /** Epoch ms when the event arrived. Toasts fade after TOAST_TTL_MS. */
  ts: number;
}

export const TOAST_TTL_MS = 6000;
const MAX_TOASTS = 4;

interface NotifyState {
  notifications: SessionNotification[];
  push: (text: string) => void;
  expire: () => void;
  clear: () => void;
}

let nextId = 1;

export const useNotifyStore = create<NotifyState>((set) => ({
  notifications: [],

  push: (text) =>
    set((s) => {
      const next = [...s.notifications, { id: nextId++, text, ts: Date.now() }];
      // Ring buffer — oldest drops when over the cap so a burst of
      // edits can't fill the screen.
      return { notifications: next.slice(-MAX_TOASTS) };
    }),

  /** Drop expired entries. Called on a timer by SessionToasts. */
  expire: () =>
    set((s) => {
      const cutoff = Date.now() - TOAST_TTL_MS;
      const live = s.notifications.filter((n) => n.ts > cutoff);
      return live.length === s.notifications.length ? s : { notifications: live };
    }),

  clear: () => set({ notifications: [] }),
}));
