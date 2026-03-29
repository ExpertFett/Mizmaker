/**
 * SSE hook — connects to the server event stream and updates the store
 * when other clients edit routes.
 */

import { useEffect, useRef } from 'react';
import { useMissionStore } from '../store/missionStore';

export function useSessionStream(sessionId: string | null) {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    esRef.current = es;

    es.addEventListener('route_update', (e) => {
      try {
        const { groupName, waypoints } = JSON.parse(e.data);
        const { groups } = useMissionStore.getState();
        const updated = groups.map((g) =>
          g.groupName === groupName ? { ...g, waypoints } : g,
        );
        useMissionStore.setState({ groups: updated });
      } catch (err) {
        console.error('SSE route_update parse error:', err);
      }
    });

    es.addEventListener('participant_joined', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log(`${data.name} joined (${data.group})`);
      } catch {}
    });

    es.addEventListener('participant_left', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log(`${data.name} left (${data.group})`);
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
      // SSE will auto-reconnect
      console.log('SSE connection error — will retry');
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [sessionId]);
}
