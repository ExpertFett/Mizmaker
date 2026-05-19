/**
 * Shows connected participants and session controls.
 * Visible at the top of the map when in a collaborative session.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMissionStore } from '../store/missionStore';

export function ParticipantBar() {
  const { sessionId, hostToken, role } = useMissionStore();
  const [participants, setParticipants] = useState<Record<string, { name: string; group: string; connected: boolean; ready: boolean }>>({});
  const [sessionStatus, setSessionStatus] = useState<string>('planning');
  const [showReadyPrompt, setShowReadyPrompt] = useState(false);
  const isHost = role === 'mission_maker';

  // Listen for SSE events
  useEffect(() => {
    const onJoin = () => refreshParticipants();
    const onLeave = () => refreshParticipants();
    const onReadyCheck = () => setShowReadyPrompt(true);
    const onReadyResponse = () => refreshParticipants();
    const onAllReady = () => { setSessionStatus('all_ready'); setShowReadyPrompt(false); };
    const onFrozen = () => setSessionStatus('frozen');
    const onUnfrozen = () => setSessionStatus('planning');

    window.addEventListener('session:ready_check', onReadyCheck);
    window.addEventListener('session:ready_response', onReadyResponse);
    window.addEventListener('session:all_ready', onAllReady);
    window.addEventListener('session:frozen', onFrozen);
    window.addEventListener('session:unfrozen', onUnfrozen);
    window.addEventListener('session:participant_joined', onJoin);
    window.addEventListener('session:participant_left', onLeave);

    // Initial load
    refreshParticipants();

    return () => {
      window.removeEventListener('session:ready_check', onReadyCheck);
      window.removeEventListener('session:ready_response', onReadyResponse);
      window.removeEventListener('session:all_ready', onAllReady);
      window.removeEventListener('session:frozen', onFrozen);
      window.removeEventListener('session:unfrozen', onUnfrozen);
      window.removeEventListener('session:participant_joined', onJoin);
      window.removeEventListener('session:participant_left', onLeave);
    };
  }, [sessionId]);

  const refreshParticipants = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/state`);
      const data = await res.json();
      setParticipants(data.participants || {});
      setSessionStatus(data.status || 'planning');
    } catch {}
  }, [sessionId]);

  const handleReadyCheck = async () => {
    if (!sessionId || !hostToken) return;
    await fetch(`/api/sessions/${sessionId}/ready-check`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hostToken}`, 'Content-Type': 'application/json' },
    });
  };

  const handleReady = async () => {
    const { sessionToken } = useMissionStore.getState();
    if (!sessionId || !sessionToken) return;
    await fetch(`/api/sessions/${sessionId}/ready`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: true }),
    });
    setShowReadyPrompt(false);
  };

  const handleFreeze = async () => {
    if (!sessionId || !hostToken) return;
    await fetch(`/api/sessions/${sessionId}/freeze`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hostToken}` },
    });
  };

  const handleUnfreeze = async () => {
    if (!sessionId || !hostToken) return;
    await fetch(`/api/sessions/${sessionId}/unfreeze`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hostToken}` },
    });
  };

  const pList = Object.values(participants);
  if (pList.length === 0 && isHost) return null; // Solo session, no bar needed

  return (
    <>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 36,
        background: 'rgba(10, 20, 35, 0.9)', borderBottom: '1px solid #4a5258',
        display: 'flex', alignItems: 'center', padding: '0 12px', gap: 12,
        zIndex: 400, fontSize: 13,
      }}>
        {/* Status */}
        <span style={{
          color: sessionStatus === 'frozen' ? '#d29922' : sessionStatus === 'all_ready' ? '#3fb950' : '#d49a30',
          fontWeight: 600, fontSize: 12, textTransform: 'uppercase',
        }}>
          {sessionStatus === 'frozen' ? '🔒 FROZEN' : sessionStatus === 'all_ready' ? '✓ ALL READY' : '● LIVE'}
        </span>

        {/* Participants */}
        <div style={{ display: 'flex', gap: 8, flex: 1, overflow: 'hidden' }}>
          {pList.map((p, i) => (
            <span key={i} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              color: p.connected ? '#1a1f25' : '#4a5258',
              fontSize: 12,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: p.connected ? (p.ready ? '#3fb950' : '#d49a30') : '#4a5258',
              }} />
              {p.name}
              <span style={{ color: '#3a4248', fontSize: 11 }}>({p.group})</span>
            </span>
          ))}
        </div>

        {/* Host controls */}
        {isHost && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleReadyCheck} style={barBtnStyle}>Ready Check</button>
            {sessionStatus === 'frozen'
              ? <button onClick={handleUnfreeze} style={{ ...barBtnStyle, color: '#d29922' }}>Unfreeze</button>
              : <button onClick={handleFreeze} style={barBtnStyle}>Freeze</button>
            }
          </div>
        )}
      </div>

      {/* Ready check prompt for flight leads */}
      {showReadyPrompt && !isHost && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#8c9ba2', border: '2px solid #d29922', borderRadius: 8,
            padding: '24px 32px', textAlign: 'center', maxWidth: 400,
          }}>
            <h3 style={{ color: '#d29922', margin: '0 0 12px' }}>Ready Check</h3>
            <p style={{ color: '#1a1f25', fontSize: 14, margin: '0 0 20px' }}>
              Mission maker is requesting confirmation that your route is final.
            </p>
            <button onClick={handleReady} style={{
              background: '#3fb950', border: 'none', borderRadius: 6,
              color: '#7a8a92', fontSize: 15, fontWeight: 600, padding: '10px 24px', cursor: 'pointer',
            }}>
              ✓ My Route is Final
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const barBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid #4a5258', borderRadius: 3,
  color: '#1a1f25', cursor: 'pointer', fontSize: 12, padding: '4px 10px',
};
