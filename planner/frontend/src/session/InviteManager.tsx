/**
 * Invite management panel — mission maker generates invite links for flight leads.
 * Shows in the sidebar on the Map tab.
 */

import { useState, useCallback } from 'react';
import { useMissionStore } from '../store/missionStore';
import { isPlayerGroup } from '../utils/groups';

export function InviteManager() {
  const { sessionId, hostToken, groups } = useMissionStore();
  const [invites, setInvites] = useState<{ groupName: string; name: string; url: string; copied: boolean }[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [participantName, setParticipantName] = useState('');

  const playerGroups = groups.filter((g) => isPlayerGroup(g));

  const handleCreateInvite = useCallback(async () => {
    if (!sessionId || !hostToken || !selectedGroup) return;

    try {
      console.log('Creating invite:', { sessionId, hostToken: hostToken?.slice(0, 8), selectedGroup });
      const res = await fetch(`/api/sessions/${sessionId}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hostToken}`,
        },
        body: JSON.stringify({
          groupName: selectedGroup,
          participantName: participantName || selectedGroup,
        }),
      });
      const data = await res.json();
      console.log('Invite response:', res.status, data);
      if (data.joinUrl) {
        const fullUrl = `${window.location.origin}${data.joinUrl}`;
        setInvites((prev) => [...prev, {
          groupName: selectedGroup,
          name: participantName || selectedGroup,
          url: fullUrl,
          copied: false,
        }]);
        setSelectedGroup('');
        setParticipantName('');
      }
    } catch (e) {
      console.error('Failed to create invite:', e);
    }
  }, [sessionId, hostToken, selectedGroup, participantName]);

  const copyUrl = (index: number) => {
    navigator.clipboard.writeText(invites[index].url);
    setInvites((prev) => prev.map((inv, i) => i === index ? { ...inv, copied: true } : inv));
    setTimeout(() => {
      setInvites((prev) => prev.map((inv, i) => i === index ? { ...inv, copied: false } : inv));
    }, 2000);
  };

  if (!hostToken) return null; // Only show for mission maker

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontSize: 12, color: '#3a4248', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
      }}>
        Share Session
      </div>

      {/* Create invite */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        <select
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
          style={selectStyle}
        >
          <option value="">Select flight...</option>
          {playerGroups.map((g) => (
            <option key={g.groupId} value={g.groupName}>{g.groupName}</option>
          ))}
        </select>
        <input
          placeholder="Flight lead name (optional)"
          value={participantName}
          onChange={(e) => setParticipantName(e.target.value)}
          style={inputStyle}
        />
        <button
          onClick={handleCreateInvite}
          disabled={!selectedGroup}
          style={{
            background: selectedGroup ? '#4a5258' : '#6e7c83',
            border: '1px solid #4a5258',
            borderRadius: 4,
            color: selectedGroup ? '#d49a30' : '#4a5258',
            cursor: selectedGroup ? 'pointer' : 'not-allowed',
            fontSize: 13, padding: '6px 10px',
          }}
        >
          Generate Invite Link
        </button>
      </div>

      {/* Active invites */}
      {invites.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {invites.map((inv, i) => (
            <div key={i} style={{
              background: '#6e7c83', border: '1px solid #4a5258', borderRadius: 4,
              padding: '6px 8px', fontSize: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#1a1f25', fontWeight: 500 }}>{inv.groupName}</span>
                <span style={{ color: '#3a4248' }}>{inv.name}</span>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <input
                  readOnly
                  value={inv.url}
                  style={{ ...inputStyle, flex: 1, fontSize: 11, color: '#3a4248' }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => copyUrl(i)}
                  style={{
                    background: inv.copied ? '#1a4a2a' : '#4a5258',
                    border: 'none', borderRadius: 3,
                    color: inv.copied ? '#3fb950' : '#1a1f25',
                    cursor: 'pointer', fontSize: 11, padding: '3px 8px',
                  }}
                >
                  {inv.copied ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: '#6e7c83', border: '1px solid #4a5258', borderRadius: 4,
  color: '#1a1f25', fontSize: 13, padding: '5px 8px',
};
const inputStyle: React.CSSProperties = {
  background: '#6e7c83', border: '1px solid #4a5258', borderRadius: 4,
  color: '#1a1f25', fontSize: 13, padding: '5px 8px',
};
