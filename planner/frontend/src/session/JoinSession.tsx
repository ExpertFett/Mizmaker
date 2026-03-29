/**
 * Join page — flight leads land here from an invite link.
 * URL: /join/{sessionId}?token={inviteToken}
 */

import { useState, useEffect } from 'react';
import { useMissionStore } from '../store/missionStore';
import { setActiveTheater } from '../projection/dcsProjection';

export function JoinSession({ sessionId, token }: { sessionId: string; token: string }) {
  const loadMission = useMissionStore((s) => s.loadMission);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function join() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/join?token=${token}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to join session');
        }
        const data = await res.json();
        setActiveTheater(data.theater);
        loadMission(data);
      } catch (e: any) {
        setError(e.message || 'Failed to join');
      } finally {
        setLoading(false);
      }
    }
    join();
  }, [sessionId, token, loadMission]);

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={{ color: '#4a8fd4', margin: '0 0 12px' }}>Joining Session...</h2>
          <p style={{ color: '#5a7a8a', fontSize: 13 }}>Loading mission data</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={{ color: '#d95050', margin: '0 0 12px' }}>Failed to Join</h2>
          <p style={{ color: '#8fa8c0', fontSize: 13 }}>{error}</p>
          <p style={{ color: '#5a7a8a', fontSize: 12, marginTop: 12 }}>
            The session may have expired or the invite link is invalid.
          </p>
        </div>
      </div>
    );
  }

  return null; // loadMission will trigger App to show MissionEditor
}

const containerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: '100vh', background: '#080f1c', fontFamily: 'system-ui, sans-serif',
};

const cardStyle: React.CSSProperties = {
  background: '#0a1520', border: '1px solid #1a3a5a', borderRadius: 8,
  padding: '30px 40px', textAlign: 'center', maxWidth: 400,
};
