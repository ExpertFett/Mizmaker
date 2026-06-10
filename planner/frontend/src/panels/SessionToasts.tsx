/**
 * SessionToasts (v1.19.74) — bottom-left activity feed for shared
 * sessions. Renders the notifyStore ring as small fade-out chips:
 *
 *   ▎Squadron B updated their route
 *   ▎Squadron C highlighted the map
 *
 * Styling matches the mission-data strip (mono, muted, square) so it
 * reads as cockpit chrome, not a SaaS toast. Bottom-LEFT specifically:
 * the right side is owned by the weather/layers panels, the top by the
 * data strip, and bottom-right by the OL attribution.
 *
 * Mounted once in MissionEditor's root so it overlays every mode
 * (Editor / Plan / Live).
 */

import { useEffect } from 'react';
import { useNotifyStore, TOAST_TTL_MS } from '../store/notifyStore';

const MONO = "'B612 Mono', 'Consolas', monospace";

export function SessionToasts() {
  const notifications = useNotifyStore((s) => s.notifications);
  const expire = useNotifyStore((s) => s.expire);

  // TTL sweep — half-second cadence is plenty for a 6s TTL and the
  // interval only runs while at least one toast is alive.
  useEffect(() => {
    if (notifications.length === 0) return;
    const t = window.setInterval(expire, 500);
    return () => window.clearInterval(t);
  }, [notifications.length, expire]);

  if (notifications.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      left: 12,
      bottom: 40,
      zIndex: 300,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      pointerEvents: 'none',
    }}>
      {notifications.map((n) => {
        // Fade the last second of life so chips dissolve instead of
        // popping out.
        const age = Date.now() - n.ts;
        const remaining = TOAST_TTL_MS - age;
        const opacity = remaining < 1000 ? Math.max(0, remaining / 1000) : 1;
        return (
          <div
            key={n.id}
            style={{
              background: 'rgba(10, 18, 24, 0.92)',
              borderLeft: '3px solid #4a8fd4',
              border: '1px solid #1f2c3d',
              color: '#cfd7e3',
              fontFamily: MONO,
              fontSize: 12,
              padding: '6px 12px',
              maxWidth: 360,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              opacity,
              transition: 'opacity 0.4s linear',
            }}
          >
            {n.text}
          </div>
        );
      })}
    </div>
  );
}
