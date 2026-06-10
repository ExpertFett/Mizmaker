/**
 * SSE hook — connects to the server event stream and updates the store
 * when other clients edit routes.
 */

import { useEffect, useRef } from 'react';
import { useMissionStore } from '../store/missionStore';
import { useDrawingStore } from '../store/drawingStore';
import { useNotifyStore } from '../store/notifyStore';

/** Short human label for a unit_edit field. Falls back to the raw
 *  field name — better an ugly toast than a silent change. */
const FIELD_LABELS: Record<string, string> = {
  pylonChange: 'loadout',
  radioFrequency: 'radio freq',
  voiceCallsignLabel: 'callsign',
  voiceCallsignNumber: 'callsign',
  stnL16: 'datalink STN',
  laserCode: 'laser code',
  skill: 'AI skill',
  livery: 'livery',
  unitRename: 'unit name',
  groupRename: 'flight name',
  tacan: 'TACAN',
  icls: 'ICLS',
  groupFrequency: 'frequency',
};

/** The current client's own author identity — must mirror the
 *  derivation in MapContainer's highlight onFinish so we can
 *  suppress self-notifications on the (non-excluding)
 *  drawings_update broadcast. */
function ownAuthor(): string {
  const { assignedGroup, role } = useMissionStore.getState();
  return assignedGroup
    || (role === 'mission_maker' ? 'HOST' : role === 'co_editor' ? 'CO-ED' : role.toUpperCase());
}

export function useSessionStream(sessionId: string | null, enabled: boolean = true) {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId || !enabled) return;

    const token = useMissionStore.getState().sessionToken || '';
    const es = new EventSource(`/api/sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.addEventListener('route_update', (e) => {
      try {
        const { groupName, waypoints } = JSON.parse(e.data);
        const { groups } = useMissionStore.getState();
        const updated = groups.map((g) =>
          g.groupName === groupName ? { ...g, waypoints } : g,
        );
        useMissionStore.getState().setGroups(updated);
        // v1.19.74 — surface the change. The server excludes the
        // author's own token from this broadcast, so everyone who
        // receives it is "someone else" by construction.
        useNotifyStore.getState().push(`${groupName} updated their route`);
      } catch (err) {
        console.error('SSE route_update parse error:', err);
      }
    });

    // v1.19.74 — unit_edit was broadcast by the backend but never
    // listened to here. We don't try to APPLY remote unit edits to
    // local state (the edit queue model makes that a bigger job) —
    // but we can at least TELL the user something changed so they
    // know to look. Author excluded server-side, same as route_update.
    es.addEventListener('unit_edit', (e) => {
      try {
        const edit = JSON.parse(e.data);
        const what = FIELD_LABELS[edit.field] || edit.field || 'unit';
        const who = edit.groupName ? `${edit.groupName}` : 'A flight';
        useNotifyStore.getState().push(`${who} changed ${what}`);
      } catch {}
    });

    es.addEventListener('drawings_update', (e) => {
      try {
        const { drawings } = JSON.parse(e.data);
        // v1.19.74 — diff before applying: if a new highlight appeared
        // and it isn't ours, announce the author. (This broadcast does
        // NOT exclude the author server-side — savePlannerDrawings is
        // fire-and-broadcast — so self-suppression happens here.)
        const before = useDrawingStore.getState().drawings;
        const beforeIds = new Set(before.map((d) => d.id));
        const fresh = (drawings as typeof before).filter(
          (d) => d.type === 'highlight' && !beforeIds.has(d.id),
        );
        const me = ownAuthor();
        for (const d of fresh) {
          if (d.author && d.author !== me) {
            useNotifyStore.getState().push(`${d.author} highlighted the map`);
          }
        }
        useDrawingStore.getState().loadDrawings(drawings);
      } catch (err) {
        console.error('SSE drawings_update parse error:', err);
      }
    });

    es.addEventListener('participant_joined', (e) => {
      try {
        const data = JSON.parse(e.data);
        useNotifyStore.getState().push(`${data.name} joined (${data.group || 'no flight'})`);
      } catch {}
    });

    es.addEventListener('participant_left', (e) => {
      try {
        const data = JSON.parse(e.data);
        useNotifyStore.getState().push(`${data.name} left`);
      } catch {}
    });

    es.addEventListener('ready_check', () => {
      // Dispatch custom event for UI components to listen to
      window.dispatchEvent(new CustomEvent('session:ready_check'));
    });

    es.addEventListener('ready_response', (e) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent('session:ready_response', { detail: data }));
      } catch {}
    });

    es.addEventListener('all_ready', () => {
      window.dispatchEvent(new CustomEvent('session:all_ready'));
    });

    es.addEventListener('session_frozen', () => {
      window.dispatchEvent(new CustomEvent('session:frozen'));
    });

    es.addEventListener('session_unfrozen', () => {
      window.dispatchEvent(new CustomEvent('session:unfrozen'));
    });

    es.addEventListener('session_ended', () => {
      console.log('Session ended');
      es.close();
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        // Server rejected the connection (404, 503, etc.) — don't retry
        console.log('SSE connection closed by server');
        return;
      }
      // Network blip — EventSource will auto-reconnect
      console.log('SSE connection error — will retry');
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [sessionId, enabled]);
}
