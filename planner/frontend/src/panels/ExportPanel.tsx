import { useMissionStore } from '../store/missionStore';
import { useEditStore } from '../store/editStore';
import { exportJson, closeSession } from '../api/client';
import type { WaypointEdit } from '../types/mission';

export function ExportPanel() {
  const { sessionId, filename, clear } = useMissionStore();
  const { edits, isDirty, clearEdits } = useEditStore();

  const handleDownload = async () => {
    if (!sessionId) { alert('No session'); return; }

    const isWaypointEdit = (e: any): e is WaypointEdit =>
      'type' in e && typeof e.type === 'string' && e.type.startsWith('waypoint');
    const unitEdits = edits.filter((e) => !isWaypointEdit(e));

    console.log('Downloading:', { sessionId, unitEditsCount: unitEdits.length });

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, unitEdits: unitEdits }),
      });

      console.log('Download response:', res.status, res.statusText);

      if (!res.ok) {
        const err = await res.text();
        alert(`Download failed: ${res.status} ${err}`);
        return;
      }

      const blob = await res.blob();
      console.log('Blob:', blob.size, 'bytes', blob.type);

      if (blob.size === 0) { alert('Empty file returned'); return; }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Append _edited to filename so users don't confuse original and modified .miz
      const baseName = (filename || 'mission.miz').replace(/\.miz$/i, '');
      a.download = `${baseName}_edited.miz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      clearEdits();
    } catch (e: any) {
      console.error('Download error:', e);
      alert(`Download error: ${e.message}`);
    }
  };

  const handleExportJson = async () => {
    if (!sessionId) return;
    try {
      const data = await exportJson(sessionId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (filename || 'mission').replace('.miz', '') + '_planning.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const handleNewFile = async () => {
    if (sessionId) {
      await closeSession(sessionId);
    }
    clearEdits();
    clear();
  };

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a2a3a' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button onClick={handleDownload} style={{ ...btnStyle, width: '100%' }}>
          {isDirty ? 'Download .miz *' : 'Download .miz'}
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleExportJson} style={{ ...btnStyle, flex: 1, background: '#1a3a2a' }}>
            JSON
          </button>
          <button onClick={handleNewFile} style={{ ...btnStyle, flex: 1, background: '#2a1a1a', color: '#d95050' }}>
            New
          </button>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#0f2a4a',
  border: '1px solid #1a3a5a',
  borderRadius: 4,
  color: '#ccdae8',
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
